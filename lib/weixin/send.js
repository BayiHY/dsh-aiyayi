/**
 * 出站：给微信用户发文本（4.3 context-token-guard + 4.7 错误分类）。
 *
 * 设计纪律（全部来自实测结论，别凭直觉改）：
 *   1. **有 context_token 就带上；没有就带上能拿到的最好值照发**，但强制记录
 *      `withContextToken` 布尔值。不做硬门禁（缺 token 也能送达，5-D/6-E1..3 实测），
 *      也不做补发队列（基于已被推翻的假设）。
 *   2. **ret=-3 是永久失败，不重试**（收件人无会话，唯一可靠的失败判据）。
 *   3. **ret=0 不自动重试**。微信侧无法确认送达，重试的代价是用户收到重复消息，
 *      比丢一条更糟（4.7「类别 C 绝不能自动重试」）。
 *   4. 分片后**逐条发**（item_list 官方约定每请求只放一个 item）。
 *   5. token / context_token 只以脱敏形式进日志。
 */
import { sendMessage } from './api.js'
import { appendOutboundReceipt, getContextToken } from './accounts.js'
import {
  buildTextSendBody,
  classifySendError,
  clip,
  extractInboundText,
  fingerprint,
  generateClientId,
  maskId,
  maskSecret,
  splitText,
} from './protocol.js'

/**
 * 发一条长文本（内部按 chunkLimit 分片逐条发）。
 *
 * @param {object} opts
 * @param {object} opts.ctx 宿主 ctx（用 ctx.logger——坑 13：别读未 inject 的属性）
 * @param {string} opts.root 记忆根
 * @param {{accountId: string, stem: string, token: string, baseUrl: string}} opts.account
 * @param {string} opts.to 收件人 from_user_id
 * @param {string} opts.text 正文
 * @param {number} [opts.chunkLimit]
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.reason] 日志标签（reply / manual / onboard）
 * @returns {Promise<{ok: boolean, sent: number, failed: number, results: object[]}>}
 */
export async function sendText({
  ctx,
  root,
  account,
  to,
  text,
  chunkLimit = 1800,
  signal,
  reason = 'reply',
  botAgent,
} = {}) {
  // 坑 13：ctx 是 Proxy，未 inject 的属性一读就抛，可选链拦不住 → 只能用 ctx.logger
  const logger = ctx?.logger
  const chunks = splitText(text, chunkLimit)
  if (!chunks.length) return { ok: true, sent: 0, failed: 0, results: [] }
  if (!to) {
    logger?.warn?.('aiyayi-weixin: 出站缺少收件人，已跳过')
    return { ok: false, sent: 0, failed: chunks.length, results: [] }
  }

  const contextToken = getContextToken(root, account.stem, to)
  const withContextToken = Boolean(contextToken)
  const results = []
  let sent = 0
  let failed = 0

  for (let index = 0; index < chunks.length; index++) {
    const piece = chunks[index]
    const clientId = generateClientId()
    const body = buildTextSendBody({
      to,
      text: piece,
      contextToken,
      clientId,
      botAgent,
    })
    const startedAt = Date.now()
    try {
      const resp = await sendMessage({
        baseUrl: account.baseUrl,
        token: account.token,
        body,
        signal,
        logger,
      })
      const ms = Date.now() - startedAt
      sent += 1
      results.push({ ok: true, messageId: resp.message_id, clientId, ms })
      appendOutboundReceipt(root, {
        at: new Date().toISOString(),
        accountId: maskId(account.accountId),
        to: maskId(to),
        // 收件人明文只在本机流水里（排查关联需要），token 永不落
        toUserId: to,
        clientId,
        serverMessageId: resp.message_id ?? null,
        withContextToken,
        contextTokenFp: withContextToken ? fingerprint(contextToken) : null,
        reason,
        part: index + 1,
        parts: chunks.length,
        ms,
        ret: resp.ret ?? 0,
        chars: piece.length,
      })
      logger?.info?.(
        `aiyayi-weixin: 发出回复 to=${maskId(to)} part=${index + 1}/${chunks.length} ` +
          `len=${piece.length} msg=${resp.message_id ?? '(none)'} clientId=${clientId} ` +
          `ret=${resp.ret ?? 0} withContextToken=${withContextToken} ${ms}ms`,
      )
    } catch (error) {
      const ms = Date.now() - startedAt
      // 外部中止不算发送失败，直接向上抛让循环/调用方收尾
      if (error?.weixinAborted) throw error
      const kind = classifySendError(error)
      failed += 1
      results.push({
        ok: false,
        clientId,
        kind,
        error: String(error?.message ?? error),
        ms,
      })
      appendOutboundReceipt(root, {
        at: new Date().toISOString(),
        accountId: maskId(account.accountId),
        toUserId: to,
        clientId,
        withContextToken,
        contextTokenFp: withContextToken ? fingerprint(contextToken) : null,
        reason,
        part: index + 1,
        parts: chunks.length,
        ms,
        ok: false,
        kind,
        error: clip(String(error?.message ?? error), 300),
      })
      logger?.warn?.(
        `aiyayi-weixin: 发送失败 to=${maskId(to)} part=${index + 1}/${chunks.length} ` +
          `kind=${kind} withContextToken=${withContextToken} ${ms}ms: ${error?.message ?? error}`,
      )
      // -3 永久失败：后面几片也不用试了（同一收件人，必然同样失败）
      if (kind === 'invalid-args') break
    }
  }

  return { ok: failed === 0, sent, failed, results }
}

/**
 * 发一条「入站即回执」类提示（建会话成功、未授权提示等）。
 * 与 sendText 同一条链路，只是日志 reason 不同，便于事后分辨。
 */
export async function sendSystemNotice(opts) {
  return sendText({ ...opts, reason: opts.reason || 'notice' })
}

/** 从入站消息里取正文（纯文本/语音转写/媒体占位）。 */
export { extractInboundText }

/** 供日志用的入站摘要（脱敏）。 */
export function describeInbound(msg) {
  const text = extractInboundText(msg)
  return {
    from: maskId(msg?.from_user_id),
    messageId: msg?.message_id ?? null,
    text: JSON.stringify(String(text).slice(0, 60)),
    hasContextToken: Boolean(msg?.context_token),
    contextToken: msg?.context_token ? maskSecret(msg.context_token) : '(none)',
    itemTypes: (Array.isArray(msg?.item_list) ? msg.item_list : []).map((i) => i?.type).join(','),
  }
}
