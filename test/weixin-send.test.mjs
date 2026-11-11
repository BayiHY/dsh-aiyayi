/**
 * 出站链路单测（4.7 错误分类 + 4.3 context-token-guard + 4.8 安全层）。
 *
 * 钉死（都是实测结论驱动的设计，别凭直觉改）：
 *   - 有 context_token 就带上；缺失照发，但日志/流水必须记 withContextToken=false
 *   - ret=-3 永久失败不重试（后续分片也不再试）
 *   - ret=0 不自动重试（重复消息比丢一条更糟）
 *   - 长文本分片后逐条发（item_list 每请求只放一个 item）
 *   - token / context_token 明文不出现在日志与流水里
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ensureWeixinDirs, readOutboundReceipts, setContextToken, weixinDir } from '../lib/weixin/accounts.js'
import { sendText } from '../lib/weixin/send.js'

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aiyayi-weixin-send-'))
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

const ACCOUNT = {
  accountId: 'acc@im.bot',
  stem: 'acc-im-bot',
  // 真实形态的 token（脱敏测试要用它确认不落明文）
  token: 'd4fbd2387360@im.bot:06000092867fa241b96a964736cb6ea3ddd023',
  baseUrl: 'http://127.0.0.1:1', // 必然连不上；发送失败路径也要能测
}

/** 用 fetch stub 拦截真实网络。 */
function stubFetch(t, handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url: String(url), method: init?.method, body, headers: init?.headers })
    return handler({ url: String(url), init, body })
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('sendText：带 context_token 时请求体里有它，流水记 withContextToken=true', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  setContextToken(root, ACCOUNT.stem, 'user-a', 'CT-REAL-TOKEN')
  const logger = makeLogger()
  const calls = stubFetch(t, () => jsonResponse({ ret: 0, message_id: '7526219523554115848' }))

  const result = await sendText({
    ctx: { logger },
    root,
    account: ACCOUNT,
    to: 'user-a',
    text: '你好',
  })

  assert.equal(result.ok, true)
  assert.equal(result.sent, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.msg.context_token, 'CT-REAL-TOKEN')
  assert.equal(calls[0].body.msg.to_user_id, 'user-a')
  assert.equal(calls[0].body.msg.message_type, 2)
  assert.equal(calls[0].body.msg.item_list.length, 1)

  const receipts = readOutboundReceipts(root, 10)
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].withContextToken, true)
  assert.equal(receipts[0].serverMessageId, '7526219523554115848')
  assert.ok(receipts[0].clientId.startsWith('dsh-aiyayi-weixin:'))
  // token 明文不能进流水
  const raw = readFileSync(join(weixinDir(root), 'outbound.jsonl'), 'utf8')
  assert.ok(!raw.includes(ACCOUNT.token), 'token 明文不得出现在流水里')
  assert.ok(!raw.includes('CT-REAL-TOKEN'), 'context_token 明文不得出现在流水里')
})

test('sendText：缺 context_token 照发（不做硬门禁），但记 withContextToken=false', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const calls = stubFetch(t, () => jsonResponse({ ret: 0, message_id: '123' }))

  const result = await sendText({
    ctx: { logger },
    root,
    account: ACCOUNT,
    to: 'user-without-token',
    text: '照发',
  })

  assert.equal(result.ok, true)
  // 字段彻底不出现（与 #5-D 的报文一致）
  assert.equal('context_token' in calls[0].body.msg, false)
  const receipts = readOutboundReceipts(root, 5)
  assert.equal(receipts[0].withContextToken, false)
  const infoLogs = logger.lines.filter((l) => l.startsWith('info'))
  assert.ok(
    infoLogs.some((l) => l.includes('withContextToken=false')),
    `日志必须显式记 withContextToken=false，实际: ${logger.lines.join(' | ')}`,
  )
})

test('sendText：ret=-3 是永久失败，不重试，且后续分片不再发', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const calls = stubFetch(t, () => jsonResponse({ ret: -3, errmsg: 'invalid arguments' }))

  const result = await sendText({
    ctx: { logger },
    root,
    account: ACCOUNT,
    to: 'ghost',
    text: 'a'.repeat(100),
    chunkLimit: 20, // 会切成 5 片
  })

  assert.equal(result.ok, false)
  assert.equal(result.failed, 1)
  assert.equal(calls.length, 1, '-3 之后不该继续发后续分片')
  assert.equal(result.results[0].kind, 'invalid-args')
  assert.ok(logger.lines.some((l) => l.includes('kind=invalid-args')))
  const receipts = readOutboundReceipts(root, 10)
  assert.equal(receipts[0].ok, false)
  assert.equal(receipts[0].kind, 'invalid-args')
})

test('sendText：ret=0 成功一次就停（不自动重试），长文本逐片发', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  let n = 0
  const calls = stubFetch(t, () => {
    n += 1
    return jsonResponse({ ret: 0, message_id: String(1000 + n) })
  })

  const result = await sendText({
    ctx: { logger },
    root,
    account: ACCOUNT,
    to: 'user-a',
    text: 'x'.repeat(45), // chunkLimit=20 → 3 片
    chunkLimit: 20,
  })

  assert.equal(result.ok, true)
  assert.equal(result.sent, 3)
  assert.equal(calls.length, 3, '3 片就 3 次请求，不该有自动重试')
  // 每片都是独立请求、独立 client_id、单 item
  const clientIds = new Set(calls.map((c) => c.body.msg.client_id))
  assert.equal(clientIds.size, 3)
  for (const call of calls) assert.equal(call.body.msg.item_list.length, 1)
  // 片内容拼回去等于原文
  assert.equal(calls.map((c) => c.body.msg.item_list[0].text_item.text).join(''), 'x'.repeat(45))
})

test('sendText：HTTP 500 归为 transient，不重试，记流水', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const calls = stubFetch(t, () => new Response('server error', { status: 500 }))

  const result = await sendText({
    ctx: { logger },
    root,
    account: ACCOUNT,
    to: 'user-a',
    text: 'hi',
  })
  assert.equal(result.ok, false)
  assert.equal(calls.length, 1, '不自动重试')
  assert.equal(result.results[0].kind, 'transient')
})

test('sendText：空文本不发请求；缺收件人不发请求', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const calls = stubFetch(t, () => jsonResponse({ ret: 0 }))

  const empty = await sendText({ ctx: { logger }, root, account: ACCOUNT, to: 'u', text: '' })
  assert.equal(empty.sent, 0)
  assert.equal(calls.length, 0)

  const noTo = await sendText({ ctx: { logger }, root, account: ACCOUNT, to: '', text: 'hi' })
  assert.equal(noTo.ok, false)
  assert.equal(calls.length, 0)
})

test('sendText：请求头带 Bearer token 与 iLink 头，且日志里没有 token 明文', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const logger = makeLogger()
  const calls = stubFetch(t, () => jsonResponse({ ret: 0, message_id: '1' }))

  await sendText({ ctx: { logger }, root, account: ACCOUNT, to: 'u', text: 'hi' })

  const headers = calls[0].headers
  assert.equal(headers.Authorization, `Bearer ${ACCOUNT.token}`)
  assert.equal(headers['iLink-App-Id'], 'bot')
  assert.equal(headers.AuthorizationType, 'ilink_bot_token')
  assert.ok(headers['iLink-App-ClientVersion'])

  const allLogs = logger.lines.join('\n')
  assert.ok(!allLogs.includes(ACCOUNT.token), 'token 明文不得进日志')
  assert.ok(!allLogs.includes('06000092867fa241'), 'token 片段也不该出现')
})
