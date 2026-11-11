/**
 * weixin_bind / weixin_unbind 后端回归测试（1.5.28 新增）。
 *
 * 覆盖李浩要的「把微信接进指定会话」语义：
 *   1. bindUser direct 模式（给 userId）→ 立即绑定 + 落盘 + 可覆盖改绑
 *   2. bindUser autoNext 模式（不给 userId）→ 落待绑定目标（pending-bind.json），30 分钟 TTL
 *   3. consumePendingBindIfAny → 下一条消息的发送者自动绑到目标会话（幂等，绑定失败不影响投递）
 *   4. 待绑定目标过期 / 目标会话已不在运行 → 不自动绑定
 *   5. unbindUser 按 userId 解单人 / 按 sessionId 解所有
 *   6. decideInbound 路由：空 allowlist 下已绑定用户放行、未绑定用户拒绝（bound-only）
 *
 * 用 mock ctx（ctx.get('agents') 返回 Map），直接驱动 export 出来的后端函数，
 * 不碰网络 / 长轮询。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  readBindings,
  readPendingBind,
  writePendingBind,
  clearPendingBind,
  takePendingBind,
} from '../lib/weixin/accounts.js'
import { bindUser, unbindUser, consumePendingBindIfAny } from '../lib/weixin/index.js'
import { decideInbound } from '../lib/weixin/protocol.js'

const USER = 'o9cq803ifYjGZC81vq6fwHyt6INE@im.wechat'
const SESSION = 'weixin-11111111-2222-3333-4444-555555555555'

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aiyayi-weixin-bind-'))
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
  const logs = { info: [], warn: [], error: [] }
  return {
    logger: {
      info: (m) => logs.info.push(String(m)),
      warn: (m) => logs.warn.push(String(m)),
      error: (m) => logs.error.push(String(m)),
    },
    logs,
  }
}

/** mock ctx：getAgent 依赖 ctx.get('agents').get(sessionId) */
function makeCtx(runningSessions = new Set([SESSION])) {
  const { logger, logs } = makeLogger()
  const agents = new Map()
  for (const sid of runningSessions) agents.set(sid, { id: sid })
  const ctx = {
    logger,
    get(service) {
      if (service === 'agents') return agents
      return null
    },
  }
  return { ctx, logs, agents }
}

test('pending-bind 落盘：write → read → clear 往返', (t) => {
  const root = tempRoot(t)
  assert.equal(readPendingBind(root), null)
  writePendingBind(root, { sessionId: SESSION, createdAt: 123 })
  assert.deepEqual(readPendingBind(root), { sessionId: SESSION, createdAt: 123 })
  clearPendingBind(root)
  assert.equal(readPendingBind(root), null)
})

test('takePendingBind：有效目标取出即清；过期目标标记 expired', (t) => {
  const root = tempRoot(t)
  const now = 1_700_000_000_000
  const ttl = 30 * 60 * 1000

  writePendingBind(root, { sessionId: SESSION, createdAt: now })
  // 未过期：返回 pending；**不**清（take 只读，清是调用方 consumePendingBindIfAny 单独做的）
  const got = takePendingBind(root, { now: now + 1000, ttlMs: ttl })
  assert.deepEqual(got, { sessionId: SESSION, createdAt: now })
  assert.deepEqual(readPendingBind(root), { sessionId: SESSION, createdAt: now }, '有效目标 take 不清（幂等靠调用方 clear）')

  // 过期：返回 expired，并清掉
  writePendingBind(root, { sessionId: SESSION, createdAt: now })
  const expired = takePendingBind(root, { now: now + ttl + 1, ttlMs: ttl })
  assert.equal(expired.expired, true)
  assert.equal(expired.sessionId, SESSION)
  assert.equal(readPendingBind(root), null, '过期目标应被清掉')
})

test('bindUser direct：给 userId 立即绑定并落盘，返回 previousSessionId 支持改绑', async (t) => {
  const root = tempRoot(t)
  const NEW = 'weixin-99999999-8888-7777-6666-555555555555'
  const { ctx } = makeCtx(new Set([SESSION, NEW]))
  const runtime = { prefix: 'weixin-' }

  // 首次绑定
  const r1 = await bindUser(ctx, root, runtime, { userId: USER, sessionId: SESSION })
  assert.equal(r1.ok, true)
  assert.equal(r1.mode, 'direct')
  assert.equal(r1.previousSessionId, null)
  assert.equal(r1.bound, true)
  assert.equal(r1.totalBound, 1)
  // 落盘确认
  assert.equal(readBindings(root)[USER], SESSION)

  // 改绑到新会话：previousSessionId 应记录旧值
  const r2 = await bindUser(ctx, root, runtime, { userId: USER, sessionId: NEW })
  assert.equal(r2.ok, true)
  assert.equal(r2.previousSessionId, SESSION)
  assert.equal(readBindings(root)[USER], NEW)
})

test('bindUser direct：userId 形态校验（拒绝非 @im.wechat/@im.bot）', async (t) => {
  const root = tempRoot(t)
  const { ctx } = makeCtx()
  const runtime = { prefix: 'weixin-' }
  const r = await bindUser(ctx, root, runtime, { userId: 'someone@qq.com', sessionId: SESSION })
  assert.equal(r.ok, false)
  assert.match(r.error, /autoNext/)
  assert.equal(readBindings(root)[USER], undefined, '非法 userId 不应写入绑定')
})

test('bindUser：目标会话不在运行 → 拒绝，不落盘', async (t) => {
  const root = tempRoot(t)
  // 不运行任何会话
  const { ctx } = makeCtx(new Set())
  const runtime = { prefix: 'weixin-' }
  const r = await bindUser(ctx, root, runtime, { userId: USER, sessionId: SESSION })
  assert.equal(r.ok, false)
  assert.match(r.error, /不在运行/)
  assert.equal(readPendingBind(root), null, '会话不在运行不该落待绑定目标')
  assert.equal(readBindings(root)[USER], undefined)
})

test('bindUser autoNext：不给 userId 落待绑定目标，30 分钟 TTL', async (t) => {
  const root = tempRoot(t)
  const { ctx } = makeCtx()
  const runtime = { prefix: 'weixin-' }
  const r = await bindUser(ctx, root, runtime, { sessionId: SESSION })
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'autoNext')
  assert.equal(r.pending, true)
  assert.equal(r.expiresInMinutes, 30)
  assert.match(r.nextStep, /发一条任意消息/)
  assert.deepEqual(readPendingBind(root).sessionId, SESSION)
})

test('consumePendingBindIfAny：下一条消息的发送者自动绑到目标会话（幂等）', (t) => {
  const root = tempRoot(t)
  const { ctx } = makeCtx()
  writePendingBind(root, { sessionId: SESSION, createdAt: Date.now() })
  const bindings = {}
  const info = { from: USER }

  // 消费：发送者被绑到 SESSION
  consumePendingBindIfAny({ ctx, root, bindings, fromUserId: USER, info })
  assert.equal(bindings[USER], SESSION, '内存 binding 应更新')
  assert.equal(readBindings(root)[USER], SESSION, '落盘 binding 应更新')
  assert.equal(readPendingBind(root), null, '绑定成功后待绑定目标应清掉（幂等）')

  // 再跑一次：没有 pending，不报错、不改 binding
  consumePendingBindIfAny({ ctx, root, bindings, fromUserId: USER, info })
  assert.equal(bindings[USER], SESSION)
})

test('consumePendingBindIfAny：目标会话不在运行 → 放弃自动绑定', (t) => {
  const root = tempRoot(t)
  const { ctx, logs } = makeCtx(new Set()) // 没有运行中的会话
  writePendingBind(root, { sessionId: SESSION, createdAt: Date.now() })
  const bindings = {}
  consumePendingBindIfAny({ ctx, root, bindings, fromUserId: USER, info: { from: USER } })
  assert.equal(bindings[USER], undefined, '会话不在运行不该绑')
  assert.ok(logs.warn.some((l) => l.includes('已不在运行')))
})

test('consumePendingBindIfAny：待绑定目标过期 → 不自动绑定并清掉', (t) => {
  const root = tempRoot(t)
  const { ctx } = makeCtx()
  const now = Date.now()
  writePendingBind(root, { sessionId: SESSION, createdAt: now - 31 * 60 * 1000 }) // 31 分钟前
  const bindings = {}
  consumePendingBindIfAny({ ctx, root, bindings, fromUserId: USER, info: { from: USER } })
  assert.equal(bindings[USER], undefined)
  assert.equal(readPendingBind(root), null, '过期目标应被清掉')
})

test('unbindUser：按 userId 解单人', (t) => {
  const root = tempRoot(t)
  const { ctx } = makeCtx()
  // 先绑上
  writePendingBind(root, { sessionId: SESSION, createdAt: Date.now() })
  const bindings = {}
  consumePendingBindIfAny({ ctx, root, bindings, fromUserId: USER, info: { from: USER } })
  assert.equal(readBindings(root)[USER], SESSION)

  const r = unbindUser(ctx, root, { userId: USER })
  assert.equal(r.ok, true)
  assert.equal(r.totalBound, 0)
  assert.deepEqual(r.removed, [{ userId: USER, sessionId: SESSION }])
  assert.equal(readBindings(root)[USER], undefined)
})

test('unbindUser：按 sessionId 解掉所有指向它的用户', (t) => {
  const root = tempRoot(t)
  const { ctx } = makeCtx()
  const USER2 = 'o9cqOTHERuser1234567890abcdef@im.wechat'
  // 用 pending-bind 消费机制分别把两人绑到同一会话（覆盖真实持久化路径）
  writePendingBind(root, { sessionId: SESSION, createdAt: Date.now() })
  consumePendingBindIfAny({ ctx, root, bindings: {}, fromUserId: USER, info: { from: USER } })
  writePendingBind(root, { sessionId: SESSION, createdAt: Date.now() })
  consumePendingBindIfAny({ ctx, root, bindings: {}, fromUserId: USER2, info: { from: USER2 } })
  assert.equal(readBindings(root)[USER], SESSION)
  assert.equal(readBindings(root)[USER2], SESSION)

  const r = unbindUser(ctx, root, { sessionId: SESSION })
  assert.equal(r.ok, true)
  assert.equal(r.totalBound, 0)
  assert.equal(r.removed.length, 2)
  assert.deepEqual(readBindings(root), {})
})

test('unbindUser：查无此人 / 查无此会话 → 明确错误', (t) => {
  const root = tempRoot(t)
  const { ctx } = makeCtx()
  const r1 = unbindUser(ctx, root, { userId: USER })
  assert.equal(r1.ok, false)
  assert.match(r1.error, /没有 .* 的绑定记录/)
  const r2 = unbindUser(ctx, root, { sessionId: SESSION })
  assert.equal(r2.ok, false)
  assert.match(r2.error, /没有任何用户绑到会话/)
  const r3 = unbindUser(ctx, root, {})
  assert.equal(r3.ok, false)
  assert.match(r3.error, /至少给 userId 或 sessionId/)
})

test('decideInbound 路由：空 allowlist 下已绑定放行 / 未绑定拒绝（bound-only）', () => {
  const USER2 = 'o9cqOTHERuser1234567890abcdef@im.wechat'
  // 有绑定：USER 放行
  const allowed = decideInbound({ msg: { from_user_id: USER }, allowlist: [], bindings: { [USER]: SESSION } })
  assert.equal(allowed.allow, true)
  assert.equal(allowed.reason, 'bound')
  // 无绑定：拒绝
  const denied = decideInbound({ msg: { from_user_id: USER2 }, allowlist: [], bindings: { [USER]: SESSION } })
  assert.equal(denied.allow, false)
  assert.equal(denied.reason, 'unbound')
  // 非空 allowlist：以 allowlist 为准（不在名单拒绝）
  const al = decideInbound({
    msg: { from_user_id: USER },
    allowlist: [USER2],
    bindings: { [USER]: SESSION },
  })
  assert.equal(al.allow, false)
  assert.equal(al.reason, 'not-in-allowlist')
})
