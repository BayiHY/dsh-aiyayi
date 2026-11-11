/**
 * 扫码登录状态机（可编程调用版）。
 *
 * 对齐官方 login-qr.ts:334-476，与探针 commands/login.mjs 的差别：
 *   - 不再自己读 stdin（插件没有终端）。need_verifycode 时通过 onVerifyCodeNeeded
 *     回调交给上层（插件里落一个请求文件 + 日志提示，用户回填后重调）。
 *   - 支持 external AbortSignal（宿主卸载能立刻停）。
 *   - 二维码 PNG 写盘路径由调用方给（默认 <root>/weixin/qrcode.png）。
 *
 * 状态机关键点（全部实测/源码核对）：
 *   - qrcode_img_content 是 **URL 不是图片**（坑 4）
 *   - 二维码真实寿命 **121 秒**（坑 5），过期就刷新，最多 3 次
 *   - binded_redirect 不是失败（本地凭证仍有效）
 *   - confirmed 缺 ilink_bot_id 视为失败
 *   - scaned_but_redirect 要用 redirect_host 换 base 继续轮询
 */
import fs from 'node:fs'
import path from 'node:path'

import { fetchBotQrcode, getQrcodeStatus } from './api.js'
import { saveCredential, ensureWeixinDirs } from './accounts.js'
import { renderPng } from './qr.js'
import {
  DEFAULT_ILINK_BOT_TYPE,
  FIXED_BASE_URL,
  fingerprint,
  maskId,
  maskSecret,
} from './protocol.js'

/** 官方上限（login-qr.ts:253 MAX_QR_REFRESH_COUNT） */
export const MAX_QR_REFRESH = 3
/** 官方登录轮询间隔（login-qr.ts:486） */
export const POLL_INTERVAL_MS = 1000

/**
 * 扫码登录。
 *
 * @param {object} opts
 * @param {object} opts.ctx 宿主 ctx（logger）
 * @param {string} opts.root 记忆根
 * @param {string} opts.stem 账号文件名 stem（safeFileStem(accountId)）
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.maxMs] 整体上限，默认 10 分钟
 * @param {string} [opts.localToken] 已有 token（进 local_token_list，可能触发 binded_redirect）
 * @param {(info: {attempt: number, retry: boolean}) => Promise<string|null>} [opts.onVerifyCodeNeeded]
 *        手机要求配对数字时调用；返回数字串则立即重试，返回 null 视为放弃。
 * @param {(qr: {url: string, pngPath: string, qrcode: string}) => void} [opts.onQrReady]
 * @param {number} [opts.scale] PNG 缩放，默认 8
 * @returns {Promise<{ok: boolean, accountId?: string, baseUrl?: string, userId?: string,
 *                    pngPath?: string, alreadyConnected?: boolean, message?: string}>}
 */
export async function loginWithQr({
  ctx,
  root,
  stem,
  signal,
  maxMs = 10 * 60_000,
  localToken = '',
  onVerifyCodeNeeded,
  onQrReady,
  scale = 8,
} = {}) {
  // 坑 13：ctx 是 Proxy，未 inject 的属性一读就抛，可选链拦不住 → 只能用 ctx.logger
  const logger = ctx?.logger
  ensureWeixinDirs(root)
  const qrPngPath = path.join(root, 'weixin', 'qrcode.png')
  const deadline = Date.now() + maxMs
  const localTokenList = localToken ? [localToken] : []

  let qrRefreshCount = 1
  let currentBaseUrl = FIXED_BASE_URL
  let pendingVerifyCode
  let scannedLogged = false
  let qr

  const issueQr = async (reason) => {
    if (reason) logger?.info?.(`aiyayi-weixin: ${reason}`)
    const resp = await fetchBotQrcode({
      baseUrl: FIXED_BASE_URL,
      botType: DEFAULT_ILINK_BOT_TYPE,
      localTokenList,
      signal,
      logger,
    })
    if (!resp?.qrcode || !resp?.qrcode_img_content) {
      throw new Error(`get_bot_qrcode 返回异常: ${JSON.stringify(resp).slice(0, 300)}`)
    }
    return resp
  }

  const showQr = (resp) => {
    const png = renderPng(resp.qrcode_img_content, { scale, quietZone: 4 })
    fs.writeFileSync(qrPngPath, png)
    logger?.info?.(
      `aiyayi-weixin: 二维码已生成（121 秒内有效，请立刻用手机微信扫描）URL=${
        resp.qrcode_img_content
      } PNG=${qrPngPath} qrcode=${maskSecret(resp.qrcode)}`,
    )
    try {
      onQrReady?.({ url: resp.qrcode_img_content, pngPath: qrPngPath, qrcode: resp.qrcode })
    } catch (error) {
      logger?.warn?.(`aiyayi-weixin: onQrReady 回调异常: ${String(error)}`)
    }
  }

  qr = await issueQr(null)
  showQr(qr)

  while (Date.now() < deadline) {
    if (signal?.aborted) return { ok: false, message: '登录被中止', pngPath: qrPngPath }
    let status
    try {
      status = await getQrcodeStatus({
        baseUrl: currentBaseUrl,
        qrcode: qr.qrcode,
        verifyCode: pendingVerifyCode,
        signal,
        logger,
      })
    } catch (error) {
      if (error?.weixinAborted) return { ok: false, message: '登录被中止', pngPath: qrPngPath }
      logger?.warn?.(`aiyayi-weixin: 登录轮询异常，1s 后重试: ${error?.message ?? error}`)
      await sleepInterruptible(POLL_INTERVAL_MS, signal)
      continue
    }

    const st = status?.status
    if (st && st !== 'wait') logger?.info?.(`aiyayi-weixin: 登录状态 ${st}`)

    switch (st) {
      case 'wait':
        break

      case 'scaned':
        if (pendingVerifyCode) {
          logger?.info?.('aiyayi-weixin: 配对码已通过')
          pendingVerifyCode = undefined
        }
        if (!scannedLogged) {
          logger?.info?.('aiyayi-weixin: 已扫码，请在手机上确认')
          scannedLogged = true
        }
        break

      case 'need_verifycode': {
        const first = !pendingVerifyCode
        logger?.info?.(
          `aiyayi-weixin: ${first ? '手机要求输入配对数字' : '上次配对码不匹配，请重新输入'}`,
        )
        const code = onVerifyCodeNeeded
          ? await onVerifyCodeNeeded({ attempt: qrRefreshCount, retry: !first })
          : null
        if (!code) {
          logger?.warn?.('aiyayi-weixin: 没有拿到配对码，登录流程停止')
          return { ok: false, message: '需要配对码但未提供', pngPath: qrPngPath }
        }
        pendingVerifyCode = String(code).trim()
        continue // 官方也是立刻 continue，不 sleep
      }

      case 'verify_code_blocked':
        logger?.warn?.('aiyayi-weixin: 多次输入错误被服务端锁定')
        pendingVerifyCode = undefined
        qrRefreshCount += 1
        if (qrRefreshCount > MAX_QR_REFRESH) {
          return { ok: false, message: '多次输入错误且刷新次数用尽', pngPath: qrPngPath }
        }
        currentBaseUrl = FIXED_BASE_URL
        qr = await issueQr(`刷新二维码（${qrRefreshCount}/${MAX_QR_REFRESH}）`)
        scannedLogged = false
        showQr(qr)
        break

      case 'expired':
        qrRefreshCount += 1
        if (qrRefreshCount > MAX_QR_REFRESH) {
          return { ok: false, message: '二维码多次失效', pngPath: qrPngPath }
        }
        currentBaseUrl = FIXED_BASE_URL
        qr = await issueQr(`二维码已过期，刷新中（${qrRefreshCount}/${MAX_QR_REFRESH}）`)
        scannedLogged = false
        showQr(qr)
        break

      case 'scaned_but_redirect':
        if (status.redirect_host) {
          currentBaseUrl = `https://${status.redirect_host}`
          logger?.info?.(`aiyayi-weixin: IDC 重定向 → ${currentBaseUrl}`)
        } else {
          logger?.warn?.('aiyayi-weixin: scaned_but_redirect 但缺 redirect_host，继续用当前 host')
        }
        break

      case 'binded_redirect': {
        logger?.info?.(
          'aiyayi-weixin: 服务端回 binded_redirect —— 此 bot 已绑过本机，不发新凭证',
        )
        if (localToken) {
          return {
            ok: true,
            alreadyConnected: true,
            pngPath: qrPngPath,
            message: '服务端认为已绑定，本地凭证继续有效',
          }
        }
        return {
          ok: false,
          message: '服务端认为已绑定，但本地没有凭证文件；需要先在服务端解绑',
          pngPath: qrPngPath,
        }
      }

      case 'confirmed': {
        if (!status.ilink_bot_id) {
          return { ok: false, message: '登录已确认但响应缺 ilink_bot_id', pngPath: qrPngPath }
        }
        if (!status.bot_token) {
          return { ok: false, message: '登录已确认但响应缺 bot_token', pngPath: qrPngPath }
        }
        const credential = {
          accountId: status.ilink_bot_id,
          token: status.bot_token,
          baseUrl: status.baseurl || FIXED_BASE_URL,
          userId: status.ilink_user_id,
          savedAt: new Date().toISOString(),
          loginMethod: 'qr',
        }
        saveCredential(root, stem, credential)
        logger?.info?.(
          `aiyayi-weixin: 登录成功 accountId=${maskId(credential.accountId)} ` +
            `tokenFp=${fingerprint(credential.token)} baseUrl=${credential.baseUrl} ` +
            `userId=${maskId(credential.userId)} 凭证已写入 accounts/${stem}.json`,
        )
        return {
          ok: true,
          accountId: credential.accountId,
          baseUrl: credential.baseUrl,
          userId: credential.userId,
          pngPath: qrPngPath,
        }
      }

      default:
        if (st) logger?.warn?.(`aiyayi-weixin: 未知登录状态 ${JSON.stringify(st)}，继续轮询`)
    }

    await sleepInterruptible(POLL_INTERVAL_MS, signal)
  }

  return {
    ok: false,
    message: `${Math.round(maxMs / 1000)}s 内未完成扫码`,
    pngPath: qrPngPath,
  }
}

/** 可被 signal 打断的 sleep。 */
function sleepInterruptible(ms, signal) {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(true), Math.max(0, ms))
    if (typeof timer.unref === 'function') timer.unref()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}
