/**
 * 长轮询循环（4.5 生命周期 + 4.2 重构项 + 4.7 错误分类）。
 *
 * 与探针 commands/listen.mjs 的关键差别：
 *   1. **每轮都检查 AbortSignal**，且 getupdates 的 fetch 接了 signal → 卸载/热重载
 *      能在 1 秒内打断在飞的长轮询（探针要等最长 18.3s）。
 *   2. **-14 用 pauseUntil 时间戳**，不 `await sleep(1h)`：暂停期内睡短觉，可被
 *      signal 立即打断（4.5 明文要求）。
 *   3. `longpolling_timeout_ms` 服务端下发即采纳（4.2）。
 *   4. 连续失败 3 次退避 30s，否则 2s；客户端超时**不算失败**（4.7）。
 *   5. 游标推进后立刻落盘（续传 = 天然幂等），message_id 只作二级幂等键。
 *
 * 这个文件不做任何「建会话/投递/回发」的决策——那些由 runtime 注入的 onMessages
 * 回调负责，保证循环本身可单测。
 */
import { getUpdates } from './api.js'
import { loadCursor, saveCursor } from './accounts.js'
import { classifyUpdatesResponse, DEFAULT_LONG_POLL_TIMEOUT_MS } from './protocol.js'

/** 官方 monitor.ts:14-16 的退避常量 */
export const MAX_CONSECUTIVE_FAILURES = 3
export const BACKOFF_DELAY_MS = 30_000
export const RETRY_DELAY_MS = 2_000
/** -14 暂停期内的检查粒度（短睡，可被 abort 打断） */
export const PAUSE_POLL_SLICE_MS = 5_000

/**
 * 可被 signal 打断的 sleep。
 *
 * **不要 unref 这个定时器**：unref 的定时器在事件循环里没有其它 ref 的工作时会被丢弃，
 * 结果就是「退避 sleep 永远不返回、轮询循环静默停摆」——这类挂起没有任何日志，
 * 最难查（本版单测实测踩到：业务错误退避 2s 后 promise 永不 resolve）。
 * 循环的退出靠 abort 打断，不靠让进程自然退出。
 *
 * @returns {Promise<boolean>} true = 正常睡完；false = 被 abort 打断
 */
export function sleepInterruptible(ms, signal) {
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
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * @param {object} opts
 * @param {object} opts.ctx 宿主 ctx（logger）
 * @param {string} opts.root 记忆根
 * @param {{accountId: string, stem: string, token: string, baseUrl: string}} opts.account
 * @param {AbortSignal} opts.signal
 * @param {(msgs: any[], meta: object) => Promise<void>|void} opts.onMessages 入站消息处理回调
 * @param {number} [opts.longPollTimeoutMs] 首轮兜底超时
 * @param {number} [opts.staleTokenPauseMs] -14 暂停时长
 * @param {object} [opts.deps] 测试注入点 { getUpdatesImpl }
 * @param {() => number} [opts.now]
 * @returns {Promise<{reason: string, polls: number, msgsSeen: number}>}
 */
export async function pollLoop({
  ctx,
  root,
  account,
  signal,
  onMessages,
  longPollTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS,
  staleTokenPauseMs = 60 * 60 * 1000,
  deps = {},
  now = Date.now,
} = {}) {
  // 坑 13：Cordis 的 ctx 是 Proxy，访问未在 inject 声明的属性会**直接抛错**，
  // 可选链拦不住。这里只能用手册确认过的 ctx.logger（feishu.js 同惯例）。
  const logger = ctx?.logger
  const getUpdatesImpl = deps.getUpdatesImpl ?? getUpdates
  const tag = `aiyayi-weixin[${account.stem}]`

  let getUpdatesBuf = ''
  try {
    const cursor = loadCursor(root, account.stem)
    getUpdatesBuf = cursor.getUpdatesBuf || ''
    if (getUpdatesBuf) logger?.info?.(`${tag}: 游标续传（${getUpdatesBuf.length} 字节）`)
  } catch (error) {
    logger?.warn?.(`${tag}: 读游标失败（从空游标开始）: ${String(error)}`)
  }

  let nextTimeoutMs = longPollTimeoutMs
  let consecutiveFailures = 0
  let msgsSeen = 0
  let pauseUntil = 0
  let polls = 0
  const seenMessageIds = new Set()
  const SEEN_LIMIT = 2000

  const markSeen = (messageId) => {
    if (!messageId) return false
    const key = String(messageId)
    if (seenMessageIds.has(key)) return true
    seenMessageIds.add(key)
    if (seenMessageIds.size > SEEN_LIMIT) {
      const oldest = seenMessageIds.values().next().value
      if (oldest !== undefined) seenMessageIds.delete(oldest)
    }
    return false
  }

  while (!signal?.aborted) {
    // -14 暂停：短睡切片，随时可被打断（绝不 sleep(1h) 死等）
    if (pauseUntil > now()) {
      const wait = Math.min(PAUSE_POLL_SLICE_MS, pauseUntil - now())
      logger?.debug?.(`${tag}: token 失效暂停中，还剩 ${Math.max(0, pauseUntil - now())}ms`)
      const slept = await sleepInterruptible(wait, signal)
      if (!slept) break
      continue
    }

    polls += 1
    let resp
    try {
      resp = await getUpdatesImpl({
        baseUrl: account.baseUrl,
        token: account.token,
        getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
        signal,
        logger,
        botAgent: account.botAgent,
      })
    } catch (error) {
      if (error?.weixinAborted || signal?.aborted) {
        logger?.info?.(`${tag}: 长轮询被中止，退出循环`)
        return { reason: 'aborted', polls, msgsSeen }
      }
      consecutiveFailures += 1
      const wait =
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS
      logger?.warn?.(
        `${tag}: getUpdates 异常（${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}），退避 ${wait}ms: ${error?.message ?? error}`,
      )
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) consecutiveFailures = 0
      const slept = await sleepInterruptible(wait, signal)
      if (!slept) break
      continue
    }

    if (signal?.aborted) break

    // 服务端建议的下次长轮询超时（4.2：收到即采纳）
    if (Number.isFinite(resp?.longpolling_timeout_ms) && resp.longpolling_timeout_ms > 0) {
      if (resp.longpolling_timeout_ms !== nextTimeoutMs) {
        logger?.info?.(
          `${tag}: 服务端下发 longpolling_timeout_ms=${resp.longpolling_timeout_ms}ms（原 ${nextTimeoutMs}ms）`,
        )
      }
      nextTimeoutMs = resp.longpolling_timeout_ms
    }

    const verdict = classifyUpdatesResponse(resp)
    if (verdict.isError) {
      if (verdict.staleToken) {
        // -14：暂停该账号全部请求，**保留 token**，到期用原 token 重试（官方语义）。
        pauseUntil = now() + staleTokenPauseMs
        logger?.warn?.(
          `${tag}: errcode=-14 bot_token 失效，暂停该账号 ${Math.round(staleTokenPauseMs / 1000)}s 后重试（保留原 token）`,
        )
        continue
      }
      consecutiveFailures += 1
      const wait =
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS
      logger?.warn?.(
        `${tag}: getUpdates 业务错误 ret=${verdict.ret} errcode=${verdict.errcode} ` +
          `errmsg=${resp?.errmsg ?? ''}（${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}），退避 ${wait}ms`,
      )
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) consecutiveFailures = 0
      const slept = await sleepInterruptible(wait, signal)
      if (!slept) break
      continue
    }

    consecutiveFailures = 0
    pauseUntil = 0

    // 游标推进：官方只在非空时覆盖（monitor.ts:152）。
    if (typeof resp?.get_updates_buf === 'string' && resp.get_updates_buf !== '') {
      getUpdatesBuf = resp.get_updates_buf
      try {
        saveCursor(root, account.stem, getUpdatesBuf, { msgsSeen })
      } catch (error) {
        logger?.warn?.(`${tag}: 游标落盘失败（不影响本轮消费）: ${String(error)}`)
      }
    }

    const list = Array.isArray(resp?.msgs) ? resp.msgs : []
    if (!list.length) {
      // 客户端超时 = 正常控制流（长轮询就是这样），立即下一轮
      logger?.debug?.(
        `${tag}: ${resp?._clientTimeout ? '客户端超时' : '空响应'}，继续轮询`,
      )
      continue
    }

    // message_id 二级幂等（主判据是游标续传；这里只防同一批次/游标回退时重复）
    const fresh = []
    for (const msg of list) {
      msgsSeen += 1
      if (markSeen(msg?.message_id)) {
        logger?.info?.(`${tag}: 跳过已处理 message_id=${msg.message_id}`)
        continue
      }
      fresh.push(msg)
    }
    if (fresh.length) {
      try {
        await onMessages?.(fresh, { account, msgsSeen })
      } catch (error) {
        if (error?.weixinAborted) return { reason: 'aborted', polls, msgsSeen }
        logger?.warn?.(`${tag}: 入站处理异常（不终止轮询）: ${String(error)}`)
      }
    }
    try {
      saveCursor(root, account.stem, getUpdatesBuf, { msgsSeen })
    } catch {
      /* 已在上方记过 */
    }
  }

  return { reason: signal?.aborted ? 'aborted' : 'loop-exit', polls, msgsSeen }
}
