/**
 * 微信 iLink 协议层（纯函数，无 IO、无状态）。
 *
 * 来源：work/weixin-probe/lib/api.mjs 的纯函数部分（已对官方插件
 * @tencent-weixin/openclaw-weixin@2.4.10 源码逐行核对，并用真实微信号验证过）。
 * 迁移依据：docs/经验-微信通道自研.md 4.1（可直接复用）与 4.2（需重构）。
 *
 * 纪律：
 *   - 本文件不 import 除 node: 内置之外的任何东西，也**不做任何网络/磁盘 IO**，
 *     保证可单测（4.9 阶段 2 的验收标准）。
 *   - 任何 token 都不得以明文经过这里进日志的路径（脱敏函数在 accounts.js/util 层）。
 */
import crypto from 'node:crypto'

// ─── 端点与常量（官方源码出处见 docs/经验-微信通道自研.md 1.1） ───────────────

/** accounts.ts:13 DEFAULT_BASE_URL */
export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
/** accounts.ts:14 CDN_BASE_URL（本阶段不用，仅登记） */
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
/** login-qr.ts:39 FIXED_BASE_URL —— QR 相关请求固定走这个 base */
export const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com'

/** package.json:73 ilink_appid 实测值 */
export const ILINK_APP_ID = 'bot'
/** 上报的 channel_version（跟随官方协议版本） */
export const CHANNEL_VERSION = '2.4.10'
/** login-qr.ts:36 */
export const DEFAULT_ILINK_BOT_TYPE = '3'

/** session-guard.ts:6 STALE_TOKEN_ERRCODE —— bot_token 失效 */
export const STALE_TOKEN_ERRCODE = -14
/** 参数非法（收件人无会话）—— 唯一可靠的出站失败判据（坑 1 / 4.7 A 类） */
export const INVALID_ARGS_ERRCODE = -3

/** api.ts:211-215 */
export const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
export const DEFAULT_API_TIMEOUT_MS = 15_000
export const DEFAULT_CONFIG_TIMEOUT_MS = 10_000
/** login-qr.ts:33 */
export const QR_LONG_POLL_TIMEOUT_MS = 35_000

/** 本插件自报身份（base_info.bot_agent，官方注释：仅观测用，不参与鉴权/路由） */
export const BOT_AGENT = 'dsh-aiyayi-weixin/1.5.27'

/** MessageItem.type */
export const ITEM_TYPE = Object.freeze({
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
  TOOL_CALL_START: 11,
  TOOL_CALL_RESULT: 12,
})

/** message_type */
export const MESSAGE_TYPE = Object.freeze({ NONE: 0, USER: 1, BOT: 2 })
/** message_state */
export const MESSAGE_STATE = Object.freeze({ NEW: 0, GENERATING: 1, FINISH: 2 })

// ─── header 构造（4.1 可直接复用） ────────────────────────────────────────────

/**
 * api.ts:99-107 —— iLink-App-ClientVersion: uint32 = major<<16 | minor<<8 | patch
 * 官方注释里的例子 1.0.11 → 65547 可自校验。
 * @param {string} version 形如 "2.4.10"
 * @returns {number} uint32
 */
export function buildClientVersion(version) {
  const parts = String(version)
    .split('.')
    .map((p) => parseInt(p, 10))
  const major = Number.isFinite(parts[0]) ? parts[0] : 0
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0
  const patch = Number.isFinite(parts[2]) ? parts[2] : 0
  return (((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)) >>> 0
}

export const ILINK_APP_CLIENT_VERSION = buildClientVersion(CHANNEL_VERSION)

/**
 * api.ts:222-225 —— X-WECHAT-UIN: base64(随机 uint32 的十进制字符串)
 * 每请求新随机。
 */
export function randomWechatUin(randomBytes = crypto.randomBytes) {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

/** api.ts:228-238 —— 所有请求共用的两个 iLink 头（GET/POST 都带）。 */
export function commonHeaders() {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  }
}

/**
 * api.ts:240-254 —— POST 头（GET 只用 commonHeaders）。
 * @param {{token?: string, randomBytes?: Function}} opts
 */
export function postHeaders({ token, randomBytes } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(randomBytes),
    ...commonHeaders(),
  }
  if (token && String(token).trim()) headers.Authorization = `Bearer ${String(token).trim()}`
  return headers
}

// ─── uint64 精度保护（坑 2 / 4.1「必须原样搬」） ──────────────────────────────

/** 线上是 uint64、JSON 数字会丢精度的字段。 */
const LOSSLESS_ID_FIELDS = new Set(['message_id', 'msg_id', 'svr_id'])

/**
 * api.ts:524-577 —— 在 JSON.parse **之前**把 uint64 字段的数字字面量包成字符串。
 * 扫描器只认「对象属性名的值」，不改动字符串内部文本，因此
 * `{"text":"message_id":123}` 这类内容不会被误改。
 * @param {string} rawText
 * @returns {any}
 */
export function parseWeixinJson(rawText) {
  const text = String(rawText ?? '')
  let output = ''
  let i = 0
  const n = text.length
  while (i < n) {
    if (text[i] !== '"') {
      output += text[i++]
      continue
    }
    const strStart = i
    i++
    let escaped = false
    while (i < n) {
      const ch = text[i++]
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') break
    }
    const strToken = text.slice(strStart, i)
    output += strToken

    let cursor = i
    while (/\s/.test(text[cursor] ?? '')) cursor++
    if (text[cursor] !== ':') continue

    let key
    try {
      key = JSON.parse(strToken)
    } catch {
      continue
    }
    if (typeof key !== 'string' || !LOSSLESS_ID_FIELDS.has(key)) continue

    output += text.slice(i, cursor + 1)
    cursor++
    while (/\s/.test(text[cursor] ?? '')) output += text[cursor++]
    const numStart = cursor
    if (text[cursor] === '-') cursor++
    while (/\d/.test(text[cursor] ?? '')) cursor++
    const isBareMinus = cursor === numStart + 1 && text[numStart] === '-'
    if (cursor > numStart && !isBareMinus) {
      output += `"${text.slice(numStart, cursor)}"`
      i = cursor
    } else {
      i = numStart
    }
  }
  return JSON.parse(output)
}

// ─── 出站报文（4.1 可直接复用） ──────────────────────────────────────────────

/** base_info：POST body 里的公共元信息（get_bot_qrcode 除外） */
export function baseInfo(botAgent = BOT_AGENT) {
  return { channel_version: CHANNEL_VERSION, bot_agent: botAgent }
}

/** send.ts:52-54 的 client_id 格式 */
export function generateClientId(prefix = 'dsh-aiyayi-weixin') {
  return `${prefix}:${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

/**
 * send.ts:56-80 —— 出站文本消息体。
 * from_user_id 留空、message_type=2(BOT)、message_state=2(FINISH)、item_list 单条。
 * context_token 有则带（值不校验，但跟随官方协议形态，见 2.2）。
 * @param {{to: string, text: string, contextToken?: string, clientId?: string, runId?: string, botAgent?: string}} opts
 */
export function buildTextSendBody({ to, text, contextToken, clientId, runId, botAgent } = {}) {
  const msg = {
    from_user_id: '',
    to_user_id: to,
    client_id: clientId || generateClientId(),
    message_type: MESSAGE_TYPE.BOT,
    message_state: MESSAGE_STATE.FINISH,
    item_list: [{ type: ITEM_TYPE.TEXT, text_item: { text: String(text ?? '') } }],
  }
  if (contextToken) msg.context_token = contextToken
  if (runId) msg.run_id = runId
  return { msg, base_info: baseInfo(botAgent) }
}

/**
 * 长文本分片（4.4.1「分片可复用」）。微信侧 item_list 官方约定**每请求只放一个 item**，
 * 所以分片后必须逐条发，不能塞进同一个 item_list。
 * 切点优先换行，其次硬切；绝不产出空片。
 * @param {string} text
 * @param {number} limit 单片上限（字符数，按 UTF-16 码元计，够用）
 * @returns {string[]}
 */
export function splitText(text, limit = 1800) {
  const src = String(text ?? '')
  if (!src) return []
  const max = Math.max(1, Math.trunc(limit))
  if (src.length <= max) return [src]
  const chunks = []
  let rest = src
  while (rest.length > max) {
    // 在窗口内从后往前找一个换行，找不到就硬切
    let cut = rest.lastIndexOf('\n', max)
    if (cut <= 0) cut = max
    // 别把片切成纯空白（换行正好在开头时丢弃这个换行）
    const piece = rest.slice(0, cut)
    if (piece.trim()) chunks.push(piece)
    rest = rest.slice(cut)
    // 吞掉紧跟的分隔换行，避免下一片以空行开头
    while (rest.startsWith('\n')) rest = rest.slice(1)
  }
  if (rest.trim()) chunks.push(rest)
  return chunks
}

// ─── 入站消息解析 ────────────────────────────────────────────────────────────

/**
 * 从 item_list 里取文本（文本项优先，其次语音转文字，其次媒体占位）。
 * @param {any} msg WeixinMessage
 * @returns {string}
 */
export function extractInboundText(msg) {
  const items = Array.isArray(msg?.item_list) ? msg.item_list : []
  for (const item of items) {
    if (item?.type === ITEM_TYPE.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text)
    }
    if (item?.type === ITEM_TYPE.VOICE && item.voice_item?.text) {
      return String(item.voice_item.text)
    }
  }
  for (const item of items) {
    if (item?.type === ITEM_TYPE.IMAGE) return '[图片]'
    if (item?.type === ITEM_TYPE.FILE) return '[文件]'
    if (item?.type === ITEM_TYPE.VIDEO) return '[视频]'
    if (item?.type === ITEM_TYPE.VOICE) return '[语音]'
  }
  return ''
}

/**
 * 入站准入判定（安全要求：空 allowlist 时只允许**已被显式绑定**的用户）。
 *
 * 官方 2.4.8 的空白名单 = 放行所有 sender，这里刻意不跟随——
 * 空白名单语义收紧为「只放行已经绑定过会话的用户」（bindings 里有的），
 * 未绑定用户的陌生消息一律丢弃并记日志，绝不静默建会话。
 *
 * @param {object} opts
 * @param {any} opts.msg WeixinMessage
 * @param {string} opts.accountId
 * @param {string[]} [opts.allowlist] 非空 = 授权白名单（from_user_id）
 * @param {Record<string,string>} [opts.bindings] from_user_id → sessionId（已显式绑定）
 * @returns {{allow: boolean, reason: string, fromUserId: string}}
 */
export function decideInbound({ msg, allowlist, bindings } = {}) {
  const fromUserId = String(msg?.from_user_id ?? '').trim()
  if (!fromUserId) return { allow: false, reason: 'no-from-user-id', fromUserId }
  // 自己发的 bot 消息不回灌（message_type=2）。官方个人号场景偶见，防自问自答。
  if (msg?.message_type === MESSAGE_TYPE.BOT) {
    return { allow: false, reason: 'bot-echo', fromUserId }
  }
  const list = Array.isArray(allowlist) ? allowlist.filter((x) => typeof x === 'string' && x.trim()) : []
  if (list.length > 0) {
    const allowed = list.some((entry) => entry.trim() === fromUserId)
    return { allow: allowed, reason: allowed ? 'allowlist' : 'not-in-allowlist', fromUserId }
  }
  const bound = bindings && typeof bindings === 'object' && bindings[fromUserId]
  return { allow: Boolean(bound), reason: bound ? 'bound' : 'unbound', fromUserId }
}

// ─── 错误分类（4.7） ─────────────────────────────────────────────────────────

/**
 * 判定 getupdates 响应是否业务错误（ret 与 errcode 都比，官方 monitor.ts:115-117）。
 * @returns {{isError: boolean, staleToken: boolean, ret?: number, errcode?: number}}
 */
export function classifyUpdatesResponse(resp) {
  const ret = resp?.ret
  const errcode = resp?.errcode
  const retBad = ret !== undefined && ret !== null && ret !== 0
  const codeBad = errcode !== undefined && errcode !== null && errcode !== 0
  const staleToken = ret === STALE_TOKEN_ERRCODE || errcode === STALE_TOKEN_ERRCODE
  return { isError: retBad || codeBad, staleToken, ret, errcode }
}

/**
 * 出站错误分类（4.7）：
 *   -3  → permanent（永久失败，不重试）
 *   -14 → stale-token（凭证失效，暂停该账号）
 *   其他 → transient（不自动重试，只记录；ret=0 也可能没送达，见坑 1）
 * @param {any} err 抛出的错误（可能带 response）
 * @returns {'invalid-args'|'stale-token'|'transient'}
 */
export function classifySendError(err) {
  const resp = err?.response ?? {}
  const ret = resp.ret
  if (ret === INVALID_ARGS_ERRCODE || err?.errcode === INVALID_ARGS_ERRCODE) return 'invalid-args'
  if (ret === STALE_TOKEN_ERRCODE || err?.errcode === STALE_TOKEN_ERRCODE) return 'stale-token'
  return 'transient'
}

// ─── 脱敏（4.8 安全层） ──────────────────────────────────────────────────────

/** 秘密值 → `***末4位(len=N)`；空值 `(empty)`。 */
export function maskSecret(value) {
  if (value === undefined || value === null) return '(none)'
  const s = String(value)
  if (!s) return '(empty)'
  const tail = s.length <= 4 ? '' : s.slice(-4)
  return `***${tail}(len=${s.length})`
}

/** 秘密值的稳定指纹（sha256 前 8 位），用于跨轮次比对，不可逆。 */
export function fingerprint(value) {
  if (!value) return '(none)'
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8)
}

/** 用户 ID 这类半敏感标识：保留头尾。 */
export function maskId(value) {
  const s = String(value ?? '')
  if (!s) return '(none)'
  if (s.length <= 8) return `…${s.slice(-2)}(len=${s.length})`
  return `${s.slice(0, 4)}…${s.slice(-4)}(len=${s.length})`
}

/** 截断长字符串，避免把整条 base64 塞进日志。 */
export function clip(value, n = 400) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  if (!str) return ''
  return str.length <= n ? str : `${str.slice(0, n)}…(+${str.length - n})`
}
