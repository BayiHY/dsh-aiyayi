/**
 * 长轮询循环的生命周期与可靠性单测（4.8「生命周期层 / 可靠性层」逐项）。
 *
 * 这是本版最关键的测试文件——今天炸启动的教训就是"生命周期挂不住"。
 * 钉死：
 *   - AbortSignal 能立刻打断在飞的长轮询（不是等 18s）
 *   - -14 用 pauseUntil 时间戳，不死睡 1 小时，且暂停期可被 abort 打断
 *   - 客户端超时 = 正常控制流，不累计失败次数
 *   - longpolling_timeout_ms 收到即采纳
 *   - 游标推进后落盘（续传天然幂等）；message_id 作二级幂等
 *   - 连续 3 次失败退避 30s
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ensureWeixinDirs, loadCursor, saveCursor } from '../lib/weixin/accounts.js'
import { pollLoop, sleepInterruptible } from '../lib/weixin/poll.js'

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aiyayi-weixin-poll-'))
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
  })
  return dir
}

function makeLogger() {
  const lines = []
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    debug: (m) => lines.push(`debug ${m}`),
    error: (m) => lines.push(`error ${m}`),
  }
}

const ACCOUNT = { accountId: 'acc@im.bot', stem: 'acc-im-bot', token: 'tok', baseUrl: 'http://x' }

test('sleepInterruptible：abort 立刻返回 false，不睡满', async () => {
  const controller = new AbortController()
  const startedAt = Date.now()
  setTimeout(() => controller.abort(), 20)
  const slept = await sleepInterruptible(5000, controller.signal)
  assert.equal(slept, false)
  assert.ok(Date.now() - startedAt < 1000, '应在 abort 后立刻返回')
})

test('sleepInterruptible：已 abort 的 signal 直接返回 false', async () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal(await sleepInterruptible(5000, controller.signal), false)
})

test('pollLoop：abort 能立刻打断在飞的长轮询（不等 fetch 超时）', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const controller = new AbortController()

  let pollsStarted = 0
  // 模拟一个"永不返回除非被 abort"的长轮询
  const getUpdatesImpl = ({ signal }) =>
    new Promise((resolve, reject) => {
      pollsStarted += 1
      const timer = setTimeout(() => resolve({ ret: 0, msgs: [], get_updates_buf: 'b' }), 60_000)
      const onAbort = () => {
        clearTimeout(timer)
        const err = new Error('aborted')
        err.weixinAborted = true
        reject(err)
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })

  const startedAt = Date.now()
  const promise = pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    deps: { getUpdatesImpl },
  })
  // 等第一轮真正进去
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(pollsStarted, 1)
  controller.abort()
  const result = await promise
  const elapsed = Date.now() - startedAt
  assert.equal(result.reason, 'aborted')
  assert.ok(elapsed < 2000, `abort 后应在 1s 量级退出，实测 ${elapsed}ms`)
})

test('pollLoop：-14 触发 pauseUntil 而不是死睡 1 小时，且暂停期可被 abort 打断', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const controller = new AbortController()

  let calls = 0
  const getUpdatesImpl = async () => {
    calls += 1
    return { ret: -14, errcode: -14, errmsg: 'stale token' }
  }

  const startedAt = Date.now()
  const promise = pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    staleTokenPauseMs: 60 * 60 * 1000, // 1 小时
    deps: { getUpdatesImpl },
  })
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(calls, 1, '只该打一次 -14 请求，然后进暂停')
  // 暂停中：不应再打请求
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(calls, 1, '暂停期内不该继续请求服务端')
  controller.abort()
  const result = await promise
  const elapsed = Date.now() - startedAt
  assert.equal(result.reason, 'aborted')
  assert.ok(elapsed < 2000, `暂停应可被 abort 打断，实测 ${elapsed}ms`)
  assert.ok(
    logger.lines.some((l) => l.includes('-14') && l.includes('暂停')),
    '应记一条 -14 暂停日志',
  )
})

test('pollLoop：客户端超时算正常控制流，不累计失败次数', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const controller = new AbortController()

  let calls = 0
  const getUpdatesImpl = async () => {
    calls += 1
    if (calls >= 3) controller.abort()
    // 客户端超时的空响应（api.js 就是这么返回的）
    return { ret: 0, msgs: [], get_updates_buf: 'buf', _clientTimeout: true }
  }

  await pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    deps: { getUpdatesImpl },
  })
  assert.ok(calls >= 3, '超时后应立刻继续下一轮')
  assert.equal(
    logger.lines.filter((l) => l.startsWith('warn')).length,
    0,
    '客户端超时不该产生 warn（不是失败）',
  )
})

test('pollLoop：longpolling_timeout_ms 收到即采纳（下一轮用它）', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const controller = new AbortController()
  const timeouts = []

  let calls = 0
  const getUpdatesImpl = async ({ timeoutMs }) => {
    calls += 1
    timeouts.push(timeoutMs)
    if (calls === 1) {
      return { ret: 0, msgs: [], get_updates_buf: 'b1', longpolling_timeout_ms: 12000 }
    }
    controller.abort()
    return { ret: 0, msgs: [], get_updates_buf: 'b2' }
  }

  await pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    longPollTimeoutMs: 35000,
    deps: { getUpdatesImpl },
  })
  assert.deepEqual(timeouts, [35000, 12000], '第二轮应使用服务端下发的 12000ms')
})

test('pollLoop：游标推进后落盘（续传幂等），入站消息交给 onMessages', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const controller = new AbortController()
  const seen = []

  const msg1 = { message_id: '7526219523554115848', from_user_id: 'u1', item_list: [] }
  let calls = 0
  const getUpdatesImpl = async () => {
    calls += 1
    if (calls === 1) return { ret: 0, msgs: [msg1], get_updates_buf: 'cursor-1' }
    controller.abort()
    return { ret: 0, msgs: [], get_updates_buf: 'cursor-1' }
  }

  await pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    deps: { getUpdatesImpl },
    onMessages: async (msgs) => {
      for (const m of msgs) seen.push(m.message_id)
    },
  })

  assert.deepEqual(seen, ['7526219523554115848'])
  const cursor = loadCursor(root, ACCOUNT.stem)
  assert.equal(cursor.getUpdatesBuf, 'cursor-1')
  assert.equal(cursor.msgsSeen, 1)
})

test('pollLoop：重启后从游标续传（首轮请求带旧游标）', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  saveCursor(root, ACCOUNT.stem, 'saved-cursor', { msgsSeen: 5 })
  const logger = makeLogger()
  const controller = new AbortController()
  const sent = []

  const getUpdatesImpl = async ({ getUpdatesBuf }) => {
    sent.push(getUpdatesBuf)
    controller.abort()
    return { ret: 0, msgs: [], get_updates_buf: 'saved-cursor' }
  }

  await pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    deps: { getUpdatesImpl },
  })
  assert.deepEqual(sent, ['saved-cursor'], '首轮必须带上次落盘的游标')
})

test('pollLoop：同一 message_id 重复下发只处理一次（二级幂等）', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const controller = new AbortController()
  const seen = []

  const dup = { message_id: '9007199254740993', from_user_id: 'u1', item_list: [] }
  let calls = 0
  const getUpdatesImpl = async () => {
    calls += 1
    // 同一个 message_id 在两轮里都出现（游标回退/重复投递）
    if (calls <= 2) return { ret: 0, msgs: [dup], get_updates_buf: `c${calls}` }
    controller.abort()
    return { ret: 0, msgs: [], get_updates_buf: 'c3' }
  }

  await pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    deps: { getUpdatesImpl },
    onMessages: async (msgs) => {
      for (const m of msgs) seen.push(m.message_id)
    },
  })
  assert.deepEqual(seen, ['9007199254740993'], '重复 message_id 只处理一次')
  assert.ok(logger.lines.some((l) => l.includes('跳过已处理')))
})

test('pollLoop：网络异常连续 3 次退避 30s，且 30s 退避可被 abort 打断', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const controller = new AbortController()
  let calls = 0

  const getUpdatesImpl = async () => {
    calls += 1
    throw new Error('ECONNRESET')
  }

  const startedAt = Date.now()
  const promise = pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    deps: { getUpdatesImpl },
  })
  // 前两次退避各 2s；第三次退避 30s 期间 abort
  await new Promise((r) => setTimeout(r, 4600))
  controller.abort()
  const result = await promise
  const elapsed = Date.now() - startedAt
  assert.equal(result.reason, 'aborted')
  assert.ok(
    logger.lines.some((l) => l.includes('退避 30000ms')),
    `第 3 次失败应退避 30s，日志: ${logger.lines.join(' | ')}`,
  )
  assert.ok(elapsed < 10000, `abort 应能打断 30s 退避，实测 ${elapsed}ms`)
})

test('pollLoop：onMessages 抛错不终止轮询', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const controller = new AbortController()
  let calls = 0
  let handled = 0

  const getUpdatesImpl = async () => {
    calls += 1
    if (calls === 1) {
      return { ret: 0, msgs: [{ message_id: '1', from_user_id: 'u' }], get_updates_buf: 'a' }
    }
    if (calls === 2) {
      return { ret: 0, msgs: [{ message_id: '2', from_user_id: 'u' }], get_updates_buf: 'b' }
    }
    controller.abort()
    return { ret: 0, msgs: [], get_updates_buf: 'b' }
  }

  await pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    deps: { getUpdatesImpl },
    onMessages: async () => {
      handled += 1
      if (handled === 1) throw new Error('handler boom')
    },
  })
  assert.equal(handled, 2, '第一条处理抛错后，第二条仍应被处理')
  assert.ok(logger.lines.some((l) => l.includes('入站处理异常')))
})

test('pollLoop：业务错误（非 -14）也会退避并继续，不退出循环', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const controller = new AbortController()
  let calls = 0
  const getUpdatesImpl = async () => {
    calls += 1
    if (calls === 1) return { ret: -1, errcode: -1, errmsg: 'server busy' }
    controller.abort()
    return { ret: 0, msgs: [], get_updates_buf: 'ok' }
  }
  const result = await pollLoop({
    ctx: { logger },
    root,
    account: ACCOUNT,
    signal: controller.signal,
    deps: { getUpdatesImpl },
  })
  assert.equal(result.reason, 'aborted')
  assert.ok(logger.lines.some((l) => l.includes('业务错误')))
})
