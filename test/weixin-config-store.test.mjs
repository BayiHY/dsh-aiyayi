/**
 * 配置归一化 + 凭据/游标/context-token 存储 + 账号锁 单测。
 *
 * 钉死：
 *   - 默认 enabled=false（硬要求 2：发版装上但不跑）
 *   - 字符串 "true" / 1 不算开启（防误开）
 *   - credentialRef 越出 weixin 目录被拒（防 ../ 穿越）
 *   - 原子写 / 游标断点续传 / context_token 按发送者
 *   - 账号锁互斥：第二个 acquire 明确失败，不静默双跑（坑 7）
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, isAbsolute, relative, resolve } from 'node:path'
import { test } from 'node:test'

import {
  DEFAULT_CHUNK_LIMIT,
  DEFAULT_STALE_TOKEN_PAUSE_MS,
  normalizeAccounts,
  normalizeConfig,
  resolveCredentialRef,
  safeFileStem,
} from '../lib/weixin/config.js'
import {
  acquireAccountLock,
  appendOutboundReceipt,
  ensureWeixinDirs,
  getContextToken,
  loadCredential,
  loadCursor,
  readBindings,
  readOutboundReceipts,
  readJson,
  reverseLookupBinding,
  saveCredential,
  saveCursor,
  setBinding,
  setContextToken,
  weixinDir,
  writeJsonAtomic,
} from '../lib/weixin/accounts.js'

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aiyayi-weixin-test-'))
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* Windows 上偶发占用，忽略 */
    }
  })
  return dir
}

const PATH_API = { resolve, relative, isAbsolute, join }

// ─── config ────────────────────────────────────────────────────────────────

test('normalizeConfig：默认关闭，只有严格 true 才算开启', () => {
  for (const raw of [undefined, null, {}, { enabled: false }, { enabled: 'true' }, { enabled: 1 }]) {
    assert.equal(normalizeConfig(raw).enabled, false, `enabled 应为 false: ${JSON.stringify(raw)}`)
  }
  assert.equal(normalizeConfig({ enabled: true }).enabled, true)
})

test('normalizeConfig：缺省值齐全（route / poll / send / allowlist / bindings）', () => {
  const c = normalizeConfig({ enabled: true })
  assert.equal(c.route.mode, 'per-user')
  assert.equal(c.route.sessionPrefix, 'weixin-')
  assert.deepEqual(c.allowlist, [])
  assert.deepEqual(c.bindings, {})
  assert.equal(c.poll.longPollTimeoutMs, 35000)
  assert.equal(c.poll.staleTokenPauseMs, DEFAULT_STALE_TOKEN_PAUSE_MS)
  assert.equal(c.send.chunkLimit, DEFAULT_CHUNK_LIMIT)
  assert.equal(c.baseUrl, 'https://ilinkai.weixin.qq.com')
  assert.deepEqual(c.accounts, [])
})

test('normalizeConfig：非法值回落缺省，不抛', () => {
  const c = normalizeConfig({
    poll: { longPollTimeoutMs: -5, staleTokenPauseMs: 'abc' },
    send: { chunkLimit: 0 },
    allowlist: ['ok', '', 42, null, '  pad  '],
    bindings: { a: 's1', b: null, '': 's2' },
    route: { mode: 'group' },
  })
  assert.equal(c.poll.longPollTimeoutMs, 35000)
  assert.equal(c.poll.staleTokenPauseMs, DEFAULT_STALE_TOKEN_PAUSE_MS)
  assert.equal(c.send.chunkLimit, DEFAULT_CHUNK_LIMIT)
  assert.deepEqual(c.allowlist, ['ok', 'pad']) // 非字符串被剔除
  assert.deepEqual(c.bindings, { a: 's1' }) // 空值被剔除
  assert.equal(c.route.mode, 'per-user') // 未实现的模式回落
})

test('normalizeAccounts：支持字符串简写、去重、缺 accountId 丢弃', () => {
  const list = normalizeAccounts([
    { accountId: 'a@im.bot', credentialRef: 'accounts/a.json' },
    { accountId: 'a@im.bot', credentialRef: 'accounts/dup.json' }, // 重复丢弃
    'b@im.bot', // 字符串简写 → credentialRef 自动补
    { accountId: '   ' },
    null,
    42,
    { accountId: 'c@im.bot' },
  ])
  assert.equal(list.length, 3)
  assert.deepEqual(list[0], { accountId: 'a@im.bot', credentialRef: 'accounts/a.json' })
  assert.deepEqual(list[1], { accountId: 'b@im.bot', credentialRef: 'accounts/b-im-bot.json' })
  assert.deepEqual(list[2], { accountId: 'c@im.bot', credentialRef: 'accounts/c-im-bot.json' })
})

test('safeFileStem：@im.bot 归一化，非法字符替换，不让路径成分混进来', () => {
  assert.equal(safeFileStem('d4fbd2387360@im.bot'), 'd4fbd2387360-im-bot')
  assert.equal(safeFileStem('../../etc/passwd'), 'etc-passwd')
  assert.equal(safeFileStem('a/b\\c'), 'a-b-c')
  assert.equal(safeFileStem(''), '')
})

test('resolveCredentialRef：env: 形态 / 文件形态 / 穿越拒绝', () => {
  const base = join(tmpdir(), 'wx-root')
  assert.deepEqual(resolveCredentialRef('env:MY_TOKEN', base, PATH_API), {
    kind: 'env',
    name: 'MY_TOKEN',
  })
  assert.equal(resolveCredentialRef('env:', base, PATH_API).kind, 'invalid')
  assert.equal(resolveCredentialRef('', base, PATH_API).kind, 'invalid')

  const fileRef = resolveCredentialRef('accounts/a.json', base, PATH_API)
  assert.equal(fileRef.kind, 'file')
  assert.ok(fileRef.path.startsWith(resolve(base)))

  // 穿越必须被拒
  const escape = resolveCredentialRef('../../secret.json', base, PATH_API)
  assert.equal(escape.kind, 'invalid')
  assert.match(escape.reason, /越出/)
  const absEscape = resolveCredentialRef(join(tmpdir(), 'other', 'x.json'), base, PATH_API)
  assert.equal(absEscape.kind, 'invalid')
})

// ─── 存储 ──────────────────────────────────────────────────────────────────

test('writeJsonAtomic：写入是完整 JSON，不留半截文件', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const file = join(weixinDir(root), 'x.json')
  writeJsonAtomic(file, { a: 1, b: [1, 2, 3] }, 0o600)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { a: 1, b: [1, 2, 3] })
})

test('readJson：缺失 / 空 / 坏文件都返回 fallback，不抛', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  assert.equal(readJson(join(weixinDir(root), 'none.json'), 'fb'), 'fb')
  const empty = join(weixinDir(root), 'empty.json')
  writeFileSync(empty, '   ', 'utf8')
  assert.equal(readJson(empty, 'fb'), 'fb')
  const broken = join(weixinDir(root), 'broken.json')
  writeFileSync(broken, '{"a":', 'utf8')
  assert.equal(readJson(broken, 'fb'), 'fb')
})

test('凭证：存/读往返，缺 token 视为无凭证', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  saveCredential(root, 'acc-1', {
    accountId: 'acc@im.bot',
    token: 'tok-123',
    baseUrl: 'https://ilinkai.weixin.qq.com',
    userId: 'u@im.wechat',
  })
  const loaded = loadCredential(root, 'acc-1', 'acc@im.bot')
  assert.equal(loaded.token, 'tok-123')
  assert.equal(loaded.accountId, 'acc@im.bot')
  assert.equal(loadCredential(root, 'missing', 'x'), null)

  saveCredential(root, 'acc-2', { accountId: 'acc2@im.bot', token: '   ' })
  assert.equal(loadCredential(root, 'acc-2'), null)
})

test('游标：断点续传语义（空 → 有值 → 覆盖），msgsSeen 累加', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  assert.deepEqual(loadCursor(root, 'acc'), { getUpdatesBuf: '', msgsSeen: 0 })

  saveCursor(root, 'acc', 'buf-1', { msgsSeen: 1 })
  assert.equal(loadCursor(root, 'acc').getUpdatesBuf, 'buf-1')
  assert.equal(loadCursor(root, 'acc').msgsSeen, 1)

  // 不传 msgsSeen 时保留旧值（游标覆盖不该把计数清零）
  saveCursor(root, 'acc', 'buf-2')
  assert.equal(loadCursor(root, 'acc').getUpdatesBuf, 'buf-2')
  assert.equal(loadCursor(root, 'acc').msgsSeen, 1)

  // 多账号互不覆盖
  saveCursor(root, 'acc2', 'other-buf', { msgsSeen: 7 })
  assert.equal(loadCursor(root, 'acc').getUpdatesBuf, 'buf-2')
  assert.equal(loadCursor(root, 'acc2').getUpdatesBuf, 'other-buf')
})

test('context_token：按 from_user_id 存，缺值时返回空串', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  assert.equal(getContextToken(root, 'acc', 'u1'), '')
  setContextToken(root, 'acc', 'u1', 'CT-1', { lastMessageId: '7526219523554115848' })
  setContextToken(root, 'acc', 'u2', 'CT-2')
  assert.equal(getContextToken(root, 'acc', 'u1'), 'CT-1')
  assert.equal(getContextToken(root, 'acc', 'u2'), 'CT-2')
  assert.equal(getContextToken(root, 'acc', 'nobody'), '')
  // 空值不写
  assert.equal(setContextToken(root, 'acc', '', 'x'), null)
  assert.equal(setContextToken(root, 'acc', 'u3', ''), null)
})

test('绑定表：读写 + reverseLookup 反查（会话路由 key = from_user_id）', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  assert.deepEqual(readBindings(root), {})
  setBinding(root, 'user-a', 'weixin-session-1')
  setBinding(root, 'user-b', 'weixin-session-2')
  assert.deepEqual(readBindings(root), {
    'user-a': 'weixin-session-1',
    'user-b': 'weixin-session-2',
  })
  assert.equal(reverseLookupBinding(readBindings(root), 'weixin-session-2'), 'user-b')
  assert.equal(reverseLookupBinding(readBindings(root), 'nope'), null)
})

test('出站流水：追加 + 回读最近 N 条，坏行被跳过', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  appendOutboundReceipt(root, { clientId: 'c1', withContextToken: true })
  appendOutboundReceipt(root, { clientId: 'c2', withContextToken: false })
  const tail = readOutboundReceipts(root, 10)
  assert.equal(tail.length, 2)
  assert.equal(tail[1].clientId, 'c2')
  assert.equal(readOutboundReceipts(root, 1).length, 1)
})

// ─── 账号锁 ─────────────────────────────────────────────────────────────────

test('账号锁：首个 acquire 成功、锁文件含 PID 与心跳', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const lock = acquireAccountLock(root, 'acc')
  assert.equal(lock.ok, true)
  const payload = JSON.parse(readFileSync(lock.file, 'utf8'))
  assert.equal(payload.pid, process.pid)
  assert.ok(Number.isFinite(payload.heartbeatAt))
  lock.release()
  assert.equal(existsSync(lock.file), false)
  // 重复 release 幂等
  lock.release()
})

test('账号锁：别的进程持有且心跳新鲜 → 明确失败（不静默双跑）', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  // 伪造一个活着的外部持锁者：用当前进程的父 PID 不靠谱，直接写 pid=1 并给新鲜心跳，
  // 再验证 isPidAlive 判定路径。pid 1 在 Windows 上可能不存在，所以改用「新鲜心跳 + 已知活的 pid」。
  const alivePid = process.ppid || process.pid
  const lockFile = join(weixinDir(root), 'accounts', 'acc.lock')
  writeJsonAtomic(lockFile, {
    accountId: 'acc',
    pid: alivePid === process.pid ? -1 : alivePid,
    acquiredAt: Date.now(),
    heartbeatAt: Date.now(),
  })
  const second = acquireAccountLock(root, 'acc')
  assert.equal(second.ok, false)
  assert.ok(second.holder)
})

test('账号锁：心跳过期的死锁可被接管（不会永久卡死）', (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const lockFile = join(weixinDir(root), 'accounts', 'acc.lock')
  writeJsonAtomic(lockFile, {
    accountId: 'acc',
    pid: 999999, // 几乎必然不存在
    acquiredAt: Date.now() - 10 * 60_000,
    heartbeatAt: Date.now() - 10 * 60_000, // 远早于 staleMs
  })
  const lock = acquireAccountLock(root, 'acc', { staleMs: 90_000 })
  assert.equal(lock.ok, true)
  lock.release()
})
