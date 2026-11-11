/**
 * 微信通道配置归一化（4.6）。
 *
 * 配置形态（profile patch 的 insert config，或记忆根下 weixin/config.json）：
 *
 * {
 *   "enabled": false,                       // 默认关闭，必须显式 true 才跑长轮询
 *   "accounts": [{ "accountId": "xxx@im.bot", "credentialRef": "env:WEIXIN_ILINK_CREDENTIAL" }],
 *   "route": { "mode": "per-user", "sessionPrefix": "weixin-" },
 *   "allowlist": [],                        // 空 = 只放行已显式绑定的用户
 *   "bindings": { "<from_user_id>": "<sessionId>" },
 *   "poll": { "longPollTimeoutMs": 35000, "staleTokenPauseMs": 3600000 },
 *   "send": { "chunkLimit": 1800 }
 * }
 *
 * 关键点：
 *   - **token 绝不进配置文件**：accountId → credentialRef → 凭据文件/环境变量。
 *   - 微信没有 appId 概念，身份就是 accountId（= ilink_bot_id）。
 *   - credentialRef 解析后必须落在 weixin/ 目录内（拒绝 ../ 穿越）。
 */
import { DEFAULT_BASE_URL, DEFAULT_LONG_POLL_TIMEOUT_MS } from './protocol.js'

/** 默认 -14 暂停时长（官方 session-guard.ts:3，1 小时） */
export const DEFAULT_STALE_TOKEN_PAUSE_MS = 60 * 60 * 1000
/** 出站分片上限（字符） */
export const DEFAULT_CHUNK_LIMIT = 1800

/**
 * 归一化账号列表。acc 可为
 *   { accountId, credentialRef }
 *   "accountId"（字符串简写，credentialRef 自动取 accounts/<accountId>.json）
 * 无效项（缺 accountId / 重复）丢弃。
 * @returns {Array<{accountId: string, credentialRef: string}>}
 */
export function normalizeAccounts(raw) {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const out = []
  for (const item of list) {
    let accountId = ''
    let credentialRef = ''
    if (typeof item === 'string') {
      accountId = item.trim()
      credentialRef = accountId ? `accounts/${safeFileStem(accountId)}.json` : ''
    } else if (item && typeof item === 'object') {
      accountId = typeof item.accountId === 'string' ? item.accountId.trim() : ''
      credentialRef =
        typeof item.credentialRef === 'string' ? item.credentialRef.trim() : ''
      if (accountId && !credentialRef) credentialRef = `accounts/${safeFileStem(accountId)}.json`
    }
    if (!accountId || seen.has(accountId)) continue
    seen.add(accountId)
    out.push({ accountId, credentialRef })
  }
  return out
}

/**
 * 账号 ID 归一化成安全文件名。
 * 对齐官方 accounts.ts:26-34：`b0f5860fdecb@im.bot` → `b0f5860fdecb-im-bot`
 * （非 [A-Za-z0-9_-] 一律换成 `-`，所以 `@` 和 `.` 都变 `-`）。
 * 这同时挡住 `../` 这类路径成分。
 */
export function safeFileStem(accountId) {
  return String(accountId ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
}

/**
 * 归一化整个配置。缺省值全部在这里定，调用方不再各自补。
 * `enabled` 只有严格 `true` 才算开——字符串 "true"、1 都不算（防误开）。
 */
export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const routeRaw = src.route && typeof src.route === 'object' ? src.route : {}
  const pollRaw = src.poll && typeof src.poll === 'object' ? src.poll : {}
  const sendRaw = src.send && typeof src.send === 'object' ? src.send : {}
  const allowlist = Array.isArray(src.allowlist)
    ? src.allowlist.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : []
  const bindings =
    src.bindings && typeof src.bindings === 'object' && !Array.isArray(src.bindings)
      ? Object.fromEntries(
          Object.entries(src.bindings).filter(
            ([k, v]) => typeof k === 'string' && k && typeof v === 'string' && v,
          ),
        )
      : {}
  const longPollTimeoutMs = positiveInt(pollRaw.longPollTimeoutMs, DEFAULT_LONG_POLL_TIMEOUT_MS)
  const staleTokenPauseMs = positiveInt(pollRaw.staleTokenPauseMs, DEFAULT_STALE_TOKEN_PAUSE_MS)
  const chunkLimit = positiveInt(sendRaw.chunkLimit, DEFAULT_CHUNK_LIMIT)
  return {
    enabled: src.enabled === true,
    accounts: normalizeAccounts(src.accounts),
    route: {
      // 目前只实现 per-user（每个微信用户一个持久会话）；保留字段位给以后 group 模式
      mode: routeRaw.mode === 'per-user' ? 'per-user' : 'per-user',
      sessionPrefix:
        typeof routeRaw.sessionPrefix === 'string' && routeRaw.sessionPrefix
          ? routeRaw.sessionPrefix
          : 'weixin-',
    },
    allowlist,
    bindings,
    baseUrl: typeof src.baseUrl === 'string' && src.baseUrl ? src.baseUrl : DEFAULT_BASE_URL,
    botAgent: typeof src.botAgent === 'string' && src.botAgent ? src.botAgent : undefined,
    poll: { longPollTimeoutMs, staleTokenPauseMs },
    send: { chunkLimit },
  }
}

function positiveInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.trunc(n)
}

/**
 * 解析 credentialRef → 绝对路径。
 *   - `env:NAME` → { kind: 'env', name: 'NAME' }
 *   - 其他 → { kind: 'file', path: <weixinDir>/<ref> }，**必须仍在 weixinDir 内**
 * @returns {{kind: 'env', name: string} | {kind: 'file', path: string} | {kind: 'invalid', reason: string}}
 */
export function resolveCredentialRef(credentialRef, weixinDir, pathApi) {
  const ref = String(credentialRef ?? '').trim()
  if (!ref) return { kind: 'invalid', reason: 'credentialRef 为空' }
  if (ref.startsWith('env:')) {
    const name = ref.slice(4).trim()
    if (!name) return { kind: 'invalid', reason: 'env: 后缺少变量名' }
    return { kind: 'env', name }
  }
  const { resolve, relative, isAbsolute, join } = pathApi
  const base = resolve(weixinDir)
  const target = isAbsolute(ref) ? resolve(ref) : resolve(base, ref)
  const rel = relative(base, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { kind: 'invalid', reason: `credentialRef 越出 weixin 目录: ${ref}` }
  }
  return { kind: 'file', path: join(base, rel) }
}
