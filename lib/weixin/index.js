/**
 * 微信通道运行时（lib/weixin/index.js）—— 由 lib/weixin.js 薄壳在 enabled 时动态 import。
 *
 * 职责（4.5 生命周期）：
 *   start：
 *     读配置 → 逐账号 拿锁 / 读凭证 → `void pollLoop(...)`（**绝不 await**）
 *     返回 { stop, status, login } 句柄给壳层
 *   stop：
 *     signal.abort() → await Promise.allSettled(loops) → 释放锁（游标随轮次已落盘）
 *
 * 回发链路：监听宿主 `session/event`，攒 assistant/message 文本，turn/end 单条回发
 * （防刷屏；多文本段按 step 顺序累积不覆盖——坑 #73 的教训同样适用）。
 *
 * 安全（硬要求）：
 *   - 这里抛出的任何异常都不能冒到宿主：壳层 try/catch，内部再兜一层。
 *   - 未授权 sender 一律丢弃并记日志；**绝不静默建会话**。
 */
import { isAbsolute, join, relative, resolve } from 'node:path'

import {
  acquireAccountLock,
  ensureWeixinDirs,
  loadCredential,
  readBindings,
  readJson,
  readOutboundReceipts,
  reverseLookupBinding,
  setBinding,
  setContextToken,
  weixinDir,
  writeBindings,
} from './accounts.js'
import { normalizeConfig, resolveCredentialRef, safeFileStem } from './config.js'
import { pollLoop } from './poll.js'
import { describeInbound, sendSystemNotice, sendText } from './send.js'
import { createAiyayiSession, getAgent, safeDeliverToSession } from './session.js'
import { decideInbound, extractInboundText, fingerprint, maskId } from './protocol.js'

/** 通道日志前缀（与 feishu 的 `aiyayi-feishu: ...` 对齐）。 */
const LOG = 'aiyayi-weixin'

/**
 * 启动微信通道。
 *
 * @param {object} ctx 宿主 ctx（logger / 各服务）
 * @param {object} rawConfig patch 里的 config（原始，未归一化）
 * @param {{root: string, permissionPreset?: string}} env 壳层解析出的环境
 * @returns {Promise<{ok: boolean, reason?: string, stop: Function, status: Function, login: Function|null}>}
 */
export async function startWeixin(ctx, rawConfig, env = {}) {
  const root = env.root
  if (!root) {
    ctx.logger.warn(`${LOG}: 记忆根不可达，微信通道未启动（不影响宿主与飞书通道）。`)
    return { ok: false, reason: 'no-root', stop: async () => {}, status: () => ({ ok: false }), login: null }
  }

  const fileConfig = readJson(join(weixinDir(root), 'config.json'), null)
  const config = normalizeConfig(mergeConfigLayers(rawConfig, fileConfig))
  const permissionPreset = env.permissionPreset || 'workspace-write'

  const runtime = {
    stopped: false,
    controller: new AbortController(),
    loops: [], // {accountId, stem, promise, lock}
    prefix: config.route.sessionPrefix,
    accounts: new Map(), // stem → {accountId, token, baseUrl, botAgent}
    pendingReplies: new Map(), // sessionId → 累积 assistant 文本
  }

  const stop = async (reason = 'dispose') => {
    if (runtime.stopped) return
    runtime.stopped = true
    ctx.logger.info(`${LOG}: 正在停止（${reason}）：中止 ${runtime.loops.length} 个轮询循环`)
    runtime.controller.abort()
    // 4.5：只 abort 不等待会出现「旧循环没退、新循环已起」= 同账号双轮询抢消息。
    const settled = await Promise.allSettled(runtime.loops.map((l) => l.promise))
    const rejected = settled.filter((s) => s.status === 'rejected')
    if (rejected.length) {
      ctx.logger.warn(`${LOG}: ${rejected.length} 个轮询循环异常结束（已忽略，不影响宿主）`)
    }
    for (const loop of runtime.loops) {
      try {
        loop.lock?.release?.()
      } catch (error) {
        ctx.logger.warn(`${LOG}: 释放账号锁失败 ${maskId(loop.accountId)}: ${String(error)}`)
      }
    }
    runtime.loops = []
    runtime.pendingReplies.clear()
    ctx.logger.info(`${LOG}: 已停止（${reason}）`)
  }

  const status = () => {
    const bindings = readBindings(root)
    return {
      ok: true,
      enabled: config.enabled,
      running: !runtime.stopped && runtime.loops.length > 0,
      root,
      accounts: [...runtime.accounts.entries()].map(([stem, account]) => {
        const loop = runtime.loops.find((l) => l.stem === stem)
        return {
          accountId: maskId(account.accountId),
          stem,
          baseUrl: account.baseUrl,
          tokenFp: fingerprint(account.token),
          polling: Boolean(loop),
        }
      }),
      bindings,
      allowlist: config.allowlist,
      // 语义明示：空 allowlist ≠ 放行所有人（官方 2.4.8 是危险的空白名单语义）
      allowlistMode: config.allowlist.length ? 'allowlist' : 'bound-only',
      recentOutbound: readOutboundReceipts(root, 10),
    }
  }

  // ── 没有账号：只 warn，不抛（硬要求 1） ───────────────────────────────────
  if (!config.accounts.length) {
    ctx.logger.warn(
      `${LOG}: 微信通道已启用但 accounts 为空（缺 accountId/credentialRef），长轮询未启动。`,
    )
    return { ok: false, reason: 'no-accounts', stop, status, login: null }
  }

  ensureWeixinDirs(root)

  // config.bindings 合并进落盘绑定表（config 优先，便于手工指定/首绑）
  if (Object.keys(config.bindings).length) {
    const existing = readBindings(root)
    let changed = false
    for (const [fromUserId, sessionId] of Object.entries(config.bindings)) {
      if (existing[fromUserId] !== sessionId) {
        existing[fromUserId] = sessionId
        changed = true
      }
    }
    if (changed) {
      try {
        writeBindings(root, existing)
      } catch (error) {
        ctx.logger.warn(`${LOG}: 合并 config.bindings 失败: ${String(error)}`)
      }
    }
  }

  // ── 逐账号：拿锁 → 读凭证 → void pollLoop ───────────────────────────────
  for (const entry of config.accounts) {
    const stem = safeFileStem(entry.accountId)
    if (!stem) {
      ctx.logger.warn(`${LOG}: 账号 ID 无法归一化成文件名，跳过: ${maskId(entry.accountId)}`)
      continue
    }
    const lock = acquireAccountLock(root, stem)
    if (!lock.ok) {
      // 坑 7：不能静默双跑
      const holder = lock.holder ?? {}
      ctx.logger.warn(
        `${LOG}: 账号 ${maskId(entry.accountId)} 被占用（pid=${holder.pid ?? '?'}，` +
          `心跳 ${holder.heartbeatAt ? new Date(holder.heartbeatAt).toISOString() : '?'}），` +
          `跳过该账号的长轮询——同一微信号同时只能有一个实例在轮询。`,
      )
      continue
    }

    const credential = readAccountCredential({ ctx, root, entry, config })
    if (!credential) {
      lock.release()
      continue
    }

    const account = {
      accountId: credential.accountId || entry.accountId,
      stem,
      token: credential.token,
      baseUrl: credential.baseUrl || config.baseUrl,
      botAgent: config.botAgent,
    }
    runtime.accounts.set(stem, account)

    ctx.logger.info(
      `${LOG}: 账号 ${maskId(account.accountId)} 开始长轮询 base=${account.baseUrl} ` +
        `tokenFp=${fingerprint(account.token)} allowlist=${
          config.allowlist.length ? `${config.allowlist.length} 条` : '空（只放行已绑定用户）'
        }`,
    )

    // 4.5 红线：绝不 await 这个 promise
    const promise = pollLoop({
      ctx,
      root,
      account,
      signal: runtime.controller.signal,
      longPollTimeoutMs: config.poll.longPollTimeoutMs,
      staleTokenPauseMs: config.poll.staleTokenPauseMs,
      onMessages: async (msgs, meta) => {
        await handleInbound({
          ctx,
          root,
          config,
          runtime,
          permissionPreset,
          account: meta.account,
          msgs,
        })
      },
    })
      .then((result) => {
        ctx.logger.info(`${LOG}: 账号 ${maskId(account.accountId)} 轮询结束（${result.reason}）`)
        return result
      })
      .catch((error) => {
        // 循环异常不能冒到宿主（硬要求 1）：只停该账号
        ctx.logger.warn(
          `${LOG}: 账号 ${maskId(account.accountId)} 轮询异常退出（该账号停用，其他账号与飞书不受影响）: ${String(
            error,
          )}`,
        )
      })
      .finally(() => {
        try {
          lock.release()
        } catch {
          /* 忽略 */
        }
      })

    runtime.loops.push({ accountId: account.accountId, stem, promise, lock })
  }

  // ── 回发：监听 session/event，turn/end 单条发出 ────────────────────────
  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        try {
          handleSessionEvent({ ctx, root, runtime, session, event })
        } catch (error) {
          ctx.logger.warn(`${LOG}: session/event 处理失败: ${String(error)}`)
        }
      }),
    'aiyayi-weixin.reply-relay()',
  )

  ctx.logger.info(
    `${LOG}: 已就绪（${runtime.loops.length}/${config.accounts.length} 个账号轮询中，` +
      `已绑定 ${Object.keys(readBindings(root)).length} 个用户）`,
  )

  return {
    ok: true,
    stop,
    status,
    login: (opts = {}) => runLogin(ctx, root, config, opts),
  }
}

/**
 * 解析某账号的凭证。
 * 支持两种来源：
 *   - `credentialRef` = `env:NAME` → 进程环境变量里的 token
 *   - `credentialRef` = 文件（默认 accounts/<stem>.json），必须仍在 weixin/ 目录内
 */
function readAccountCredential({ ctx, root, entry, config }) {
  const resolved = resolveCredentialRef(entry.credentialRef, weixinDir(root), {
    resolve,
    relative,
    isAbsolute,
    join,
  })
  if (resolved.kind === 'invalid') {
    ctx.logger.warn(`${LOG}: credentialRef 无效（${resolved.reason}），账号 ${maskId(entry.accountId)} 跳过`)
    return null
  }
  if (resolved.kind === 'env') {
    const raw = process.env[resolved.name]
    if (!raw || !String(raw).trim()) {
      ctx.logger.warn(`${LOG}: 环境变量 ${resolved.name} 为空，账号 ${maskId(entry.accountId)} 跳过`)
      return null
    }
    return { accountId: entry.accountId, token: String(raw).trim(), baseUrl: config.baseUrl }
  }
  const credential = loadCredential(root, safeFileStem(entry.accountId), entry.accountId)
  if (!credential) {
    ctx.logger.warn(
      `${LOG}: 账号 ${maskId(entry.accountId)} 没有可用凭证（${entry.credentialRef}）。` +
        `先扫码登录：weixin_login 工具，或 work/weixin-probe 的 login 命令。`,
    )
    return null
  }
  return credential
}

// ─── 入站处理 ───────────────────────────────────────────────────────────────

async function handleInbound({ ctx, root, config, runtime, permissionPreset, account, msgs }) {
  const bindings = readBindings(root)
  for (const msg of msgs) {
    const verdict = decideInbound({ msg, allowlist: config.allowlist, bindings })
    const info = describeInbound(msg)

    // 先缓存 context_token（不涉及授权；出站要用它跟随官方协议形态）
    if (msg?.context_token && verdict.fromUserId) {
      try {
        setContextToken(root, account.stem, verdict.fromUserId, msg.context_token, {
          lastMessageId: msg.message_id,
          lastText: extractInboundText(msg).slice(0, 120),
        })
      } catch (error) {
        ctx.logger.warn(`${LOG}: 缓存 context_token 失败: ${String(error)}`)
      }
    }

    if (!verdict.allow) {
      ctx.logger.warn(
        `${LOG}: 丢弃未授权消息 from=${info.from} msg=${info.messageId} reason=${verdict.reason}` +
          `（空 allowlist 只放行已绑定用户：要放行请加 allowlist，或先在 bindings 里绑定）`,
      )
      continue
    }

    const text = extractInboundText(msg)
    ctx.logger.info(
      `${LOG}: 收到消息 from=${info.from} msg=${info.messageId} text=${info.text} ` +
        `items=${info.itemTypes || '(none)'} contextToken=${info.contextToken}`,
    )

    if (!text.trim()) {
      ctx.logger.info(`${LOG}: 消息正文为空（可能是纯媒体），未投递`)
      continue
    }

    let sessionId = bindings[verdict.fromUserId]
    if (sessionId && !getAgent(ctx, sessionId)) {
      // 映射指向的会话已不在运行（HMR/宿主重启回收）：自动新建重绑，绝不静默吞消息。
      ctx.logger.warn(`${LOG}: 绑定的会话 ${sessionId} 已不在运行，自动新建并重新绑定`)
      sessionId = null
    }

    if (!sessionId) {
      try {
        const created = await createAiyayiSession(ctx, {
          root,
          name: `微信 ${maskId(verdict.fromUserId)}`,
          sessionPrefix: runtime.prefix,
          permissionPreset,
        })
        sessionId = created.sessionId
        setBinding(root, verdict.fromUserId, sessionId)
        bindings[verdict.fromUserId] = sessionId
        ctx.logger.info(`${LOG}: 已为用户 ${maskId(verdict.fromUserId)} 新建并绑定会话 ${sessionId}`)
        await sendSystemNotice({
          ctx,
          root,
          account,
          to: verdict.fromUserId,
          text: `已接入阿依娅伊会话 ${sessionId}，现在可以直接在微信里说话了。`,
          signal: runtime.controller.signal,
        })
      } catch (error) {
        ctx.logger.warn(`${LOG}: 新建会话失败（本条消息未投递）: ${String(error)}`)
        await sendSystemNotice({
          ctx,
          root,
          account,
          to: verdict.fromUserId,
          text: '创建会话失败，请稍后再试。',
          signal: runtime.controller.signal,
        }).catch(() => {})
        continue
      }
    }

    const delivered = await safeDeliverToSession(ctx, sessionId, text)
    if (!delivered) {
      ctx.logger.warn(`${LOG}: 投递到会话 ${sessionId} 失败（消息已收下但未进会话）`)
      continue
    }
    ctx.logger.info(`${LOG}: 已投递到会话 ${sessionId}`)
  }
}

// ─── 回发 relay ─────────────────────────────────────────────────────────────

function handleSessionEvent({ ctx, root, runtime, session, event }) {
  const sessionId = session?.id
  if (!sessionId) return
  // 只有微信前缀的会话才可能是回发目标，先做廉价过滤
  if (!String(sessionId).startsWith(runtime.prefix)) return
  const header = session?.header ?? {}
  if (header.origin === 'subagent' || typeof header.parentSession === 'string') return

  if (event?.type === 'assistant/message') {
    // 坑 #62：载荷在 event.data.message（event.message 不存在）
    const message = event.data?.message
    if (!message) return
    const text = extractAssistantText(message).trim()
    if (!text) return
    const bindings = readBindings(root)
    if (!reverseLookupBinding(bindings, sessionId)) return // 没绑定的会话不攒
    // 坑 #73：按 step 渐进追加，不覆盖
    const prev = runtime.pendingReplies.get(sessionId)
    runtime.pendingReplies.set(sessionId, prev ? `${prev}\n\n${text}` : text)
    return
  }

  if (event?.type === 'turn/end' || event?.type === 'turn/start') {
    // turn/start 时冲掉上一轮残留（异常没等到 turn/end 的兜底）
    const text = runtime.pendingReplies.get(sessionId)
    runtime.pendingReplies.delete(sessionId)
    if (!text) return
    flushReply({ ctx, root, runtime, sessionId, text })
  }
}

function flushReply({ ctx, root, runtime, sessionId, text }) {
  const bindings = readBindings(root)
  const fromUserId = reverseLookupBinding(bindings, sessionId)
  if (!fromUserId) return
  const account = pickAccount(runtime)
  if (!account) {
    ctx.logger.warn(`${LOG}: 没有可用账号，回发跳过（会话 ${sessionId}）`)
    return
  }
  void sendText({
    ctx,
    root,
    account,
    to: fromUserId,
    text,
    signal: runtime.controller.signal,
    reason: 'reply',
  })
    .then((result) => {
      if (!result.ok) {
        ctx.logger.warn(
          `${LOG}: 回发部分失败 to=${maskId(fromUserId)} sent=${result.sent} failed=${result.failed}`,
        )
      }
    })
    .catch((error) => {
      if (error?.weixinAborted) return
      ctx.logger.warn(`${LOG}: 回发异常: ${String(error)}`)
    })
}

/** 选一个已加载的账号（每账号私聊场景取首个即可）。 */
function pickAccount(runtime) {
  for (const account of runtime.accounts.values()) return account
  return null
}

/** 从宿主 assistant 消息里抽文本（与 feishu-logic.extractText 同形）。 */
function extractAssistantText(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

// ─── 扫码登录入口（供工具调用） ─────────────────────────────────────────────

async function runLogin(ctx, root, config, opts = {}) {
  const { loginWithQr } = await import('./login.js')
  const accountId =
    typeof opts.accountId === 'string' && opts.accountId
      ? opts.accountId
      : config.accounts[0]?.accountId
  if (!accountId) {
    return { ok: false, message: '没有配置任何账号（先在 weixin.accounts 里写 accountId）' }
  }
  const stem = safeFileStem(accountId)
  const existing = loadCredential(root, stem, accountId)
  const result = await loginWithQr({
    ctx,
    root,
    stem,
    signal: opts.signal,
    maxMs: opts.maxMs,
    localToken: existing?.token ?? '',
    onVerifyCodeNeeded: opts.onVerifyCodeNeeded,
    onQrReady: opts.onQrReady,
  })
  ctx.logger.info(
    `${LOG}: 登录流程结束 ok=${result.ok}${result.message ? ` message=${result.message}` : ''}` +
      (result.pngPath ? ` png=${result.pngPath}` : ''),
  )
  return result
}

/** 供测试/工具用：不启动长轮询，只读一次状态。 */
export function weixinConfigView(config) {
  const normalized = normalizeConfig(config)
  return { ...normalized, accounts: normalized.accounts.map((a) => ({ ...a })) }
}

/**
 * 合并两层配置：patch config 覆盖记忆根下的 weixin/config.json。
 * accounts 特殊处理——patch 给了就整体覆盖，避免「半合并」出诡异账号集合。
 */
export function mergeConfigLayers(patchConfig, fileConfig) {
  const patch =
    patchConfig && typeof patchConfig === 'object' && !Array.isArray(patchConfig) ? patchConfig : {}
  const file = fileConfig && typeof fileConfig === 'object' && !Array.isArray(fileConfig) ? fileConfig : {}
  const merged = { ...file, ...patch }
  if (Array.isArray(patch.accounts)) merged.accounts = patch.accounts
  else if (Array.isArray(file.accounts)) merged.accounts = file.accounts
  return merged
}
