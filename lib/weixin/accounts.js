/**
 * 微信通道本地状态存储 + 账号级互斥锁。
 *
 * 目录（记忆根下 weixin/，含 token，不入 git）：
 *   config.json                     通道配置（patch config 优先，这里只做兜底/持久化）
 *   accounts/<stem>.json            凭证 {accountId, token, baseUrl, userId, savedAt}
 *   accounts/<stem>.sync.json       get_updates_buf 游标（4.2：按账号分文件，不互相覆盖）
 *   accounts/<stem>.context.json    按 from_user_id 缓存的 context_token（2.2/4.3）
 *   accounts/<stem>.lock            长轮询互斥锁（PID + 心跳，坑 7 / 4.3 session-lock）
 *   bindings.json                   from_user_id → sessionId（会话路由 + 空白名单的准入依据）
 *   outbound.jsonl                  出站流水（delivery-receipt：message_id/client_id/withContextToken）
 *
 * 与探针 lib/store.mjs 的差别：
 *   - 单文件压平 → 按账号分文件（对齐官方 accounts/<id>.json + .sync.json 布局）
 *   - 新增账号文件锁（探针没有，坑 7 要求插件化后必须有）
 *   - 新增出站流水（4.3 delivery-receipt，失败可能静默，必须能事后排查）
 */
import fs from 'node:fs'
import path from 'node:path'

/** weixin 子目录名（记忆根下）。 */
export function weixinDir(root) {
  return path.join(root, 'weixin')
}

export function accountsDir(root) {
  return path.join(weixinDir(root), 'accounts')
}

export function ensureWeixinDirs(root) {
  const dir = weixinDir(root)
  fs.mkdirSync(path.join(dir, 'accounts'), { recursive: true })
  return dir
}

/** 原子写 JSON：先写临时文件再 rename，避免崩在半截把凭证写坏。 */
export function writeJsonAtomic(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
  try {
    fs.chmodSync(tmp, mode)
  } catch {
    /* Windows 上 chmod 基本是空操作，失败无妨 */
  }
  fs.renameSync(tmp, file)
}

/** 读 JSON；缺失/损坏/空文件都返回 fallback（绝不因状态文件坏掉抛错）。 */
export function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    const raw = fs.readFileSync(file, 'utf-8').trim()
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

// ─── 凭证 ───────────────────────────────────────────────────────────────────

function credentialFile(root, stem) {
  return path.join(accountsDir(root), `${stem}.json`)
}

/**
 * 读账号凭证。
 * @returns {{accountId: string, token: string, baseUrl: string, userId?: string} | null}
 */
export function loadCredential(root, stem, expectedAccountId = null) {
  const data = readJson(credentialFile(root, stem), null)
  if (!data || typeof data !== 'object') return null
  const token = typeof data.token === 'string' ? data.token.trim() : ''
  if (!token) return null
  const accountId = typeof data.accountId === 'string' && data.accountId ? data.accountId : expectedAccountId
  if (!accountId) return null
  return {
    accountId,
    token,
    baseUrl: typeof data.baseUrl === 'string' && data.baseUrl ? data.baseUrl : undefined,
    userId: typeof data.userId === 'string' ? data.userId : undefined,
  }
}

export function saveCredential(root, stem, credential) {
  writeJsonAtomic(credentialFile(root, stem), credential, 0o600)
  return credential
}

// ─── 游标 ───────────────────────────────────────────────────────────────────

function cursorFile(root, stem) {
  return path.join(accountsDir(root), `${stem}.sync.json`)
}

/** @returns {{getUpdatesBuf: string, savedAt: string, msgsSeen: number}} */
export function loadCursor(root, stem) {
  const data = readJson(cursorFile(root, stem), null)
  if (!data || typeof data !== 'object') return { getUpdatesBuf: '', msgsSeen: 0 }
  return {
    getUpdatesBuf: typeof data.getUpdatesBuf === 'string' ? data.getUpdatesBuf : '',
    msgsSeen: Number.isFinite(data.msgsSeen) ? data.msgsSeen : 0,
    savedAt: data.savedAt,
  }
}

export function saveCursor(root, stem, getUpdatesBuf, { msgsSeen } = {}) {
  const prev = loadCursor(root, stem)
  const next = {
    getUpdatesBuf: getUpdatesBuf ?? '',
    savedAt: new Date().toISOString(),
    msgsSeen: msgsSeen ?? prev.msgsSeen ?? 0,
  }
  writeJsonAtomic(cursorFile(root, stem), next, 0o644)
  return next
}

// ─── context_token（按 from_user_id） ────────────────────────────────────────

function contextFile(root, stem) {
  return path.join(accountsDir(root), `${stem}.context.json`)
}

/** @returns {Record<string, {contextToken: string, updatedAt: string, lastMessageId?: string}>} */
export function loadContextTokens(root, stem) {
  const data = readJson(contextFile(root, stem), {})
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

export function setContextToken(root, stem, fromUserId, contextToken, extra = {}) {
  if (!fromUserId || !contextToken) return null
  const all = loadContextTokens(root, stem)
  all[fromUserId] = {
    contextToken,
    updatedAt: new Date().toISOString(),
    ...extra,
  }
  writeJsonAtomic(contextFile(root, stem), all, 0o600)
  return all[fromUserId]
}

export function getContextToken(root, stem, fromUserId) {
  const all = loadContextTokens(root, stem)
  const rec = all?.[fromUserId]
  return typeof rec?.contextToken === 'string' && rec.contextToken ? rec.contextToken : ''
}

// ─── 绑定表（from_user_id → sessionId） ──────────────────────────────────────

function bindingsFile(root) {
  return path.join(weixinDir(root), 'bindings.json')
}

export function readBindings(root) {
  const data = readJson(bindingsFile(root), {})
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

export function writeBindings(root, bindings) {
  writeJsonAtomic(bindingsFile(root), bindings, 0o600)
  return bindings
}

export function setBinding(root, fromUserId, sessionId) {
  const all = readBindings(root)
  all[fromUserId] = sessionId
  writeBindings(root, all)
  return all
}

/** sessionId → from_user_id 反查（回发用，4.4.1 reverseLookup 同义）。 */
export function reverseLookupBinding(bindings, sessionId) {
  for (const [fromUserId, sid] of Object.entries(bindings ?? {})) {
    if (sid === sessionId) return fromUserId
  }
  return null
}

// ─── 待绑定目标（weixin_bind 的 autoNext 模式，对齐 feishu 的 pending-bind） ──
//
// 场景：李浩在 DSH 里说「把微信接进这个会话」，但此时他还不知道自己的
// from_user_id（也没必要知道）。工具先落一个「待绑定目标」，下一条微信消息
// 进来时把它的 sender 绑到该会话——与飞书的 bot_p2p_chat_entered_v1 自动绑
// 同一个套路，区别只是微信没有「进单聊」事件，只能用"下一条消息"当触发器。

/** 待绑定目标文件名（与 bindings.json 同目录同风格）。 */
const PENDING_BIND_FILE = 'pending-bind.json'
/** 待绑定目标有效期：超时后下一条消息不再自动绑定（避免几天后突然绑上）。 */
export const PENDING_BIND_TTL_MS = 30 * 60 * 1000

function pendingBindFile(root) {
  return path.join(weixinDir(root), PENDING_BIND_FILE)
}

/** 读待绑定目标 {sessionId, createdAt}；不存在/损坏/为 null 返回 null。 */
export function readPendingBind(root) {
  const data = readJson(pendingBindFile(root), null)
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null
}

export function writePendingBind(root, pending) {
  writeJsonAtomic(pendingBindFile(root), pending, 0o600)
  return pending
}

/** 清除待绑定目标（写 null，保留文件语义明确）。 */
export function clearPendingBind(root) {
  writeJsonAtomic(pendingBindFile(root), null, 0o600)
}

/**
 * 取出**仍有效**的待绑定目标。过期则顺手清掉并返回 `{expired:true}`。
 * @returns {{sessionId: string, createdAt: number} | {expired: true} | null}
 */
export function takePendingBind(root, { now = Date.now(), ttlMs = PENDING_BIND_TTL_MS } = {}) {
  const pending = readPendingBind(root)
  if (!pending?.sessionId) return null
  if (now - Number(pending.createdAt ?? 0) > ttlMs) {
    clearPendingBind(root)
    return { expired: true, sessionId: pending.sessionId }
  }
  return pending
}

// ─── 出站流水（delivery-receipt，4.3） ───────────────────────────────────────

function receiptFile(root) {
  return path.join(weixinDir(root), 'outbound.jsonl')
}

/**
 * 记一条出站流水。因为 ret=0 也可能没送达（坑 1），必须能事后查：
 * message_id + client_id + withContextToken 是事后关联的唯一凭据。
 */
export function appendOutboundReceipt(root, record) {
  try {
    fs.mkdirSync(weixinDir(root), { recursive: true })
    fs.appendFileSync(receiptFile(root), `${JSON.stringify(record)}\n`, 'utf-8')
  } catch {
    /* 流水写失败不能影响发消息本身 */
  }
}

export function readOutboundReceipts(root, limit = 50) {
  try {
    const file = receiptFile(root)
    if (!fs.existsSync(file)) return []
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean)
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

// ─── 账号级互斥锁（坑 7 / 4.3 session-lock） ────────────────────────────────

/** 心跳超过这个时长视为持锁进程已死，可被接管。 */
export const DEFAULT_LOCK_STALE_MS = 90_000
/** 心跳写盘间隔。 */
export const DEFAULT_LOCK_HEARTBEAT_MS = 30_000

function lockFile(root, stem) {
  return path.join(accountsDir(root), `${stem}.lock`)
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM = 进程存在但没权限发信号；ESRCH = 不存在
    return error?.code === 'EPERM'
  }
}

/**
 * 抢账号锁。单账号长轮询互斥是硬约束：**不能只靠进程内标志**（热重载时
 * 旧循环未必已退、也可能有别的 DSH 实例）。
 *
 * @returns {{ok: true, release: Function, file: string} | {ok: false, holder: object|null, file: string}}
 */
export function acquireAccountLock(root, stem, { staleMs = DEFAULT_LOCK_STALE_MS } = {}) {
  const file = lockFile(root, stem)
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const existing = readJson(file, null)
  if (existing && typeof existing === 'object') {
    const samePid = existing.pid === process.pid
    const fresh = Number.isFinite(existing.heartbeatAt) && Date.now() - existing.heartbeatAt < staleMs
    const alive = isPidAlive(existing.pid)
    // 同 PID 直接接管（HMR 后旧锁残留；同进程内不可能真有两个循环，靠 runtime 句柄保证）
    if (!samePid && fresh && alive) {
      return { ok: false, holder: existing, file }
    }
  }

  const payload = {
    accountId: stem,
    pid: process.pid,
    acquiredAt: Date.now(),
    heartbeatAt: Date.now(),
  }
  writeJsonAtomic(file, payload, 0o644)

  const heartbeat = setInterval(() => {
    try {
      const current = readJson(file, null)
      // 锁已被别人接管就不再续心跳（避免抢回来）
      if (!current || current.pid !== process.pid) {
        clearInterval(heartbeat)
        return
      }
      writeJsonAtomic(file, { ...current, heartbeatAt: Date.now() }, 0o644)
    } catch {
      /* 心跳失败不改状态 */
    }
  }, DEFAULT_LOCK_HEARTBEAT_MS)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()

  let released = false
  return {
    ok: true,
    file,
    release() {
      if (released) return
      released = true
      clearInterval(heartbeat)
      try {
        const current = readJson(file, null)
        if (current && current.pid === process.pid) fs.unlinkSync(file)
      } catch {
        /* 删不掉就算了，stale 会被接管 */
      }
    },
  }
}
