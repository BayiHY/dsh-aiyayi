/**
 * 微信 iLink 协议 —— HTTP IO 层。
 *
 * 与探针 work/weixin-probe/lib/api.mjs 的差别（4.2「需重构」）：
 *   1. **每个请求都接外部 AbortSignal**（官方 api.ts:389-436 combineAbortSignals 同法）。
 *      不接的话热重载/卸载要等最长一个长轮询周期（实测约 18.3s）才退——插件体验是
 *      「点了没反应」，而且旧循环没退、新循环已起 = 同账号双轮询抢消息（坑 7）。
 *   2. 内部超时 controller 与外部 signal 合并：谁先触发都立即打断 fetch。
 *   3. 区分「外部 abort」与「客户端超时」：前者必须终止循环，后者是长轮询的正常控制流。
 *
 * 只用 node: 内置 fetch / AbortController，零 npm 依赖。
 */
import {
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_CONFIG_TIMEOUT_MS,
  DEFAULT_LONG_POLL_TIMEOUT_MS,
  FIXED_BASE_URL,
  DEFAULT_BASE_URL,
  DEFAULT_ILINK_BOT_TYPE,
  QR_LONG_POLL_TIMEOUT_MS,
  baseInfo,
  commonHeaders,
  maskSecret,
  parseWeixinJson,
  postHeaders,
  clip,
} from './protocol.js'

/** 外部中止时抛的错误（调用方据此终止循环，不当失败计数）。 */
export class WeixinAbortError extends Error {
  constructor(message = 'weixin request aborted') {
    super(message)
    this.name = 'WeixinAbortError'
    this.weixinAborted = true
  }
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`
}

export function buildUrl(baseUrl, endpoint) {
  return new URL(endpoint, ensureTrailingSlash(baseUrl || DEFAULT_BASE_URL)).toString()
}

/** 每个请求的脱敏描述（绝不落 Authorization 明文，qrcode/verify_code 也脱敏）。 */
export function describeRequest({ method, url, hasToken }) {
  const u = new URL(url)
  for (const key of ['qrcode', 'verify_code']) {
    if (u.searchParams.has(key)) u.searchParams.set(key, maskSecret(u.searchParams.get(key)))
  }
  const search = u.searchParams.toString() ? `?${u.searchParams}` : ''
  return `${method} ${u.origin}${u.pathname}${search} auth=${hasToken ? 'bearer' : 'none'}`
}

/**
 * 合并「内部超时」与「外部停止信号」。
 * 返回 { signal, cleanup, timedOut() }。
 */
function combineSignal(externalSignal, timeoutMs) {
  const controller = new AbortController()
  let timedOut = false
  let timer = null
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
  }
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      if (timer !== null) clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    },
  }
}

/**
 * 统一 JSON 请求。
 * @returns {Promise<{status:number, raw:string, json:any, ms:number}>}
 * @throws {WeixinAbortError} 外部中止
 * @throws {Error} 超时（err.weixinTimeout = true）、HTTP 错误、网络错误
 */
export async function requestJson({
  method,
  baseUrl,
  endpoint,
  body,
  token,
  timeoutMs,
  signal,
  logger,
  label = 'request',
} = {}) {
  const url = buildUrl(baseUrl, endpoint)
  const desc = describeRequest({ method, url, hasToken: Boolean(token && String(token).trim()) })
  if (signal?.aborted) throw new WeixinAbortError(`${label}: aborted before send`)
  const { signal: combined, timedOut, cleanup } = combineSignal(signal, timeoutMs)
  const startedAt = Date.now()
  logger?.debug?.(`${label}: -> ${desc} timeout=${timeoutMs ?? 'none'}`)
  try {
    const res = await fetch(url, {
      method,
      headers: method === 'GET' ? commonHeaders() : postHeaders({ token }),
      ...(method === 'GET' ? {} : { body }),
      signal: combined,
    })
    const raw = await res.text()
    const ms = Date.now() - startedAt
    let json
    let parseError
    try {
      json = parseWeixinJson(raw)
    } catch (error) {
      parseError = String(error?.message ?? error)
    }
    logger?.debug?.(`${label}: <- status=${res.status} ${ms}ms raw=${clip(raw, 300)}`)
    if (!res.ok) {
      const error = new Error(`${label} HTTP ${res.status}: ${clip(raw, 600)}`)
      error.httpStatus = res.status
      error.raw = raw
      throw error
    }
    if (parseError) {
      const error = new Error(`${label} 响应不是合法 JSON: ${parseError}; raw=${clip(raw, 400)}`)
      error.raw = raw
      error.parseError = parseError
      throw error
    }
    return { status: res.status, raw, json, ms }
  } catch (error) {
    const ms = Date.now() - startedAt
    // 外部中止优先判定：这是「有人要求停」，不是失败。
    if (signal?.aborted) throw new WeixinAbortError(`${label}: aborted after ${ms}ms`)
    if (error?.name === 'AbortError') {
      if (timedOut()) {
        const timeoutError = new Error(`${label}: 客户端超时 ${timeoutMs}ms`)
        timeoutError.weixinTimeout = true
        throw timeoutError
      }
      throw new WeixinAbortError(`${label}: aborted by signal`)
    }
    throw error
  } finally {
    cleanup()
  }
}

// ─── 登录（QR） ─────────────────────────────────────────────────────────────

/** login-qr.ts:95-106 —— body 只有 local_token_list，**不带 base_info** */
export async function fetchBotQrcode({
  baseUrl = FIXED_BASE_URL,
  botType = DEFAULT_ILINK_BOT_TYPE,
  localTokenList = [],
  signal,
  logger,
} = {}) {
  const { json } = await requestJson({
    method: 'POST',
    baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    body: JSON.stringify({ local_token_list: localTokenList }),
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    signal,
    logger,
    label: 'get_bot_qrcode',
  })
  return json
}

/**
 * login-qr.ts:128-145 —— GET 长轮询，客户端超时/网关超时都视为 wait 继续。
 * 外部 abort 仍然抛（循环要能立刻停）。
 */
export async function getQrcodeStatus({
  baseUrl = FIXED_BASE_URL,
  qrcode,
  verifyCode,
  signal,
  logger,
  timeoutMs = QR_LONG_POLL_TIMEOUT_MS,
} = {}) {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`
  try {
    const { json } = await requestJson({
      method: 'GET',
      baseUrl,
      endpoint,
      timeoutMs,
      signal,
      logger,
      label: 'get_qrcode_status',
    })
    return json
  } catch (error) {
    if (error?.weixinAborted) throw error
    if (error?.weixinTimeout) return { status: 'wait', _clientTimeout: true }
    // 网关超时（Cloudflare 524 等）官方也当 wait 继续轮询
    logger?.warn?.(`get_qrcode_status 网络错误，按 wait 继续: ${error?.message ?? error}`)
    return { status: 'wait', _networkError: String(error?.message ?? error) }
  }
}

// ─── 收消息 ─────────────────────────────────────────────────────────────────

/**
 * api.ts:444-487 —— 长轮询 getupdates。
 * **客户端超时返回空响应**（返回 `_clientTimeout: true`）——这是长轮询的正常控制流，
 * 不是失败，调用方直接再轮询。外部 abort 抛 WeixinAbortError。
 */
export async function getUpdates({
  baseUrl = DEFAULT_BASE_URL,
  token,
  getUpdatesBuf = '',
  timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS,
  signal,
  logger,
  botAgent,
} = {}) {
  try {
    const { json, raw } = await requestJson({
      method: 'POST',
      baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: JSON.stringify({ get_updates_buf: getUpdatesBuf ?? '', base_info: baseInfo(botAgent) }),
      token,
      timeoutMs,
      signal,
      logger,
      label: 'getupdates',
    })
    return { ...json, _raw: raw }
  } catch (error) {
    if (error?.weixinAborted) throw error
    if (error?.weixinTimeout) {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf, _clientTimeout: true }
    }
    throw error
  }
}

// ─── 发消息 ─────────────────────────────────────────────────────────────────

/**
 * api.ts:580-596 —— ret 非 0 抛错（错误对象带 response，供 classifySendError 判 -3/-14）。
 */
export async function sendMessage({
  baseUrl = DEFAULT_BASE_URL,
  token,
  body,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
  signal,
  logger,
} = {}) {
  const { json, raw, ms } = await requestJson({
    method: 'POST',
    baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body: JSON.stringify(body),
    token,
    timeoutMs,
    signal,
    logger,
    label: 'sendmessage',
  })
  if (json?.ret && json.ret !== 0) {
    const error = new Error(`sendMessage ret=${json.ret} errmsg=${json.errmsg ?? '(none)'}`)
    error.response = json
    error.raw = raw
    throw error
  }
  return { ...json, _raw: raw, _ms: ms }
}

// ─── 辅助端点 ───────────────────────────────────────────────────────────────

/** api.ts:599-616 —— 拿 typing_ticket。**不能当 token 有效性探针**（坑 3）。 */
export async function getConfig({
  baseUrl = DEFAULT_BASE_URL,
  token,
  ilinkUserId,
  contextToken,
  timeoutMs = DEFAULT_CONFIG_TIMEOUT_MS,
  signal,
  logger,
  botAgent,
} = {}) {
  const { json, ms } = await requestJson({
    method: 'POST',
    baseUrl,
    endpoint: 'ilink/bot/getconfig',
    body: JSON.stringify({
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: baseInfo(botAgent),
    }),
    token,
    timeoutMs,
    signal,
    logger,
    label: 'getconfig',
  })
  return { ...json, _ms: ms }
}
