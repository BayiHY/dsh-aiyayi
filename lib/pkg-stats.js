/**
 * aiyayi-toolkit / `pkg_stats`（1.5.42 新增）：查 npm 下载量 + 代码仓热度（**同步**）。
 *
 * 为什么同步：都是几个 HTTP GET，实测 0.3–4.5 秒；按 1.5.41 的分档原则（坑 #79：宿主
 * agent loop 同步 await 工具），这种"几秒内出结果"的活直接同步返回最省事——不用 followup、
 * 不用惦记 task 表。
 *
 * 各平台**实测事实**（2026-11-12 本机复核，见 docs/经验-宿主工具schema校验与feishu_bind自动绑定.md）：
 *   · npm 统计 API（api.npmjs.org）可用，但 **end 日期滞后约 2 天**——`last-day` 不是"今天"，
 *     所以每个窗口都把 start/end 原样带回，不给调用方留"这数是今天的"的误读空间。
 *   · GitHub API **直连在本机不通**（curl `(35) Recv failure`、fetch `fetch failed`），
 *     兜底走 `gh-proxy.com` 第三方代理；代理会限流（403 时原样带回 message）。
 *   · **GitCode 没有匿名 API**：`gitcode.com/api/v5/...` 返 400
 *     `Invalid header parameter: private-token, required`，`api.gitcode.com/api/v5/...` 返 401，
 *     两者都要 private-token。页面上的 star/fork 是异步渲染的 UI 数字，不是接口确证，
 *     本工具**不去抓页面**，一律把原因写进 `gitcode.unavailable`。
 *   · Gitee API 可用；注意 `watchers_count` 是"关注数"（本仓库 1），与 GitHub 的 watchers 语义不同。
 *   · npm registry 必须显式走 `registry.npmjs.org`（本机 .npmrc 默认指 npmmirror 镜像），
 *     这里直接 HTTP GET，不 shell 调 npm。
 *
 * 安全（四层，都在本文件里）：
 *   1. **域名白名单**：只允许 https GET 到 api.npmjs.org / registry.npmjs.org / api.github.com /
 *      gh-proxy.com / gitee.com / gitcode.com；其他主机一律抛错、请求根本不发。
 *   2. **参数字符校验**：owner / repo 段落只允许 `A-Za-z0-9._-`（且不许 `.`/`..`），
 *      npm 包名按 `[@scope/]name` 形态校验；拼接前再 `encodeURIComponent`，双重防注入。
 *   3. **gh-proxy.com 是第三方代理**：它能看到你查询的仓库路径（owner/repo 会出现在它的
 *      访问日志里）。只有 GitHub 直连失败时才用它，且可用 `pkgStatsAllowGithubProxy: false` 关掉。
 *   4. 总量兜底：整次调用 15 秒总预算（`pkgStatsTimeoutMs`），单请求 ≤ 8 秒
 *      （`pkgStatsRequestTimeoutMs`）；超时如实落进对应字段的 unavailable，绝不抛未捕获异常。
 *
 * 输出形状一律从 `shapePkgStatsOutput()` 单一出口归一（坑 #78 的教训）：
 *   · type 只能单字符串；properties 全列进 required；additionalProperties:false 时不许返回未声明字段；
 *   · 可空语义用**约定值**（空串 / 0 / false）承担，绝不用 null 或"字段缺失"；
 *   · 取不到的项一律写 `unavailable: "原因"`，不编、不静默吞。
 */

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/**
 * 可访问的域名白名单（只允许 https GET，**精确主机名匹配**，子域不自动放行）。
 * 这份清单是任务书钦定的六条，一条不多——所以 GitCode 那一路只能打
 * `gitcode.com`（主站路径），**打不到它真正在用的 `api.gitcode.com`**
 * （后者不在白名单里，见 collectGitcode 的注释）。宁可少一条数据也不私自放宽白名单。
 */
export const ALLOWED_HOSTS = Object.freeze([
  'api.npmjs.org',
  'registry.npmjs.org',
  'api.github.com',
  'gh-proxy.com', // 第三方代理，见文件头安全第 3 条
  'gitee.com',
  'gitcode.com',
])

const ALLOWED_HOST_SET = new Set(ALLOWED_HOSTS)

/** 统一 UA（npm/GitHub 都要求带 UA，否则可能 403）。 */
const USER_AGENT = 'dsh-aiyayi-pkg-stats (+https://github.com/BayiHY/dsh-aiyayi)'

/** 默认值（也可被 cordis.patch.yml 的 config 覆盖）。 */
export const PKG_STATS_DEFAULTS = Object.freeze({
  pkgStatsDefaultPackage: 'dsh-aiyayi',
  pkgStatsDefaultRepo: 'BayiHY/dsh-aiyayi',
  pkgStatsTimeoutMs: 15000,
  pkgStatsRequestTimeoutMs: 8000,
  pkgStatsAllowGithubProxy: true,
  // GitHub 直连快速失败预算：本机直连是 reset，给 4 秒足够判死，别把 15 秒预算烧在它身上。
  pkgStatsGithubDirectTimeoutMs: 4000,
})

/* ================================================================== *
 * 一、URL 白名单 + 参数校验（防注入）
 * ================================================================== */

/**
 * 断言 URL 只指向白名单主机（并只允许 https、不带凭据）。
 * 不合规直接抛——请求根本不会发出去，这是白名单的落点。
 * @returns {URL}
 */
export function assertAllowedUrl(rawUrl) {
  let url
  try {
    url = new URL(String(rawUrl ?? ''))
  } catch {
    throw new Error(`非法 URL：${String(rawUrl ?? '')}`)
  }
  if (url.protocol !== 'https:') throw new Error(`只允许 https，拒绝 ${url.protocol}//${url.host}`)
  if (url.username || url.password) throw new Error('URL 不允许携带凭据')
  const host = url.hostname.toLowerCase()
  if (!ALLOWED_HOST_SET.has(host)) {
    throw new Error(`域名不在白名单：${host}（只允许 ${ALLOWED_HOSTS.join(' / ')}）`)
  }
  return url
}

/** 单段名字校验：只允许字母数字 `-_.`，不许空、不许 `.`/`..`、限长 100。
 *  **不 trim 单段**：`owner/ name` 这种带内部空格的一律拒绝，不做"悄悄改成 owner/name"
 *  的静默改写（参数被改写比被拒绝更难查）。整体参数的空白在 normalizePkgStatsArgs 里去掉。 */
export function assertSafeSegment(value, label = 'segment') {
  const text = String(value ?? '')
  if (!text) throw new Error(`${label} 不能为空`)
  if (text.length > 100) throw new Error(`${label} 过长：${text.length} 字符`)
  if (text === '.' || text === '..') throw new Error(`${label} 不允许是 ${text}`)
  if (!/^[A-Za-z0-9._-]+$/.test(text)) {
    throw new Error(`${label} 含非法字符：${text}（只允许字母数字 - _ .，且不许带空白）`)
  }
  return text
}

/** npm 包名校验：`name` 或 `@scope/name`，两段各自只允许 `A-Za-z0-9._~-`（npm 允许 ~）。 */
export function assertSafePackageName(value) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('package 不能为空')
  if (text.length > 140) throw new Error(`package 过长：${text.length} 字符`)
  const parts = text.split('/')
  if (parts.length > 2) throw new Error(`package 形态非法：${text}`)
  const check = (part, label) => {
    if (!part) throw new Error(`package 形态非法：${text}（${label} 为空）`)
    if (!/^[A-Za-z0-9._~-]+$/.test(part)) throw new Error(`package 含非法字符：${text}`)
  }
  if (parts.length === 2) {
    if (!parts[0].startsWith('@')) throw new Error(`package 形态非法：${text}（带 / 时必须是 @scope/name）`)
    check(parts[0].slice(1), 'scope')
    check(parts[1], 'name')
  } else {
    check(parts[0], 'name')
  }
  return text
}

/** npm API 路径：`@scope/name` → `@scope/name`（逐段编码，别把 / 也编码掉）。 */
export function encodePackagePath(pkgName) {
  return String(pkgName).split('/').map((part) => encodeURIComponent(part)).join('/')
}

/** 参数归一：缺省走 config → 内置默认；给了就校验。 */
export function normalizePkgStatsArgs(args = {}, cfg = {}) {
  const pkgRaw = String(args?.package ?? '').trim() || String(cfg?.pkgStatsDefaultPackage ?? '').trim() || PKG_STATS_DEFAULTS.pkgStatsDefaultPackage
  const repoRaw = String(args?.repo ?? '').trim() || String(cfg?.pkgStatsDefaultRepo ?? '').trim() || PKG_STATS_DEFAULTS.pkgStatsDefaultRepo
  const pkg = assertSafePackageName(pkgRaw)
  const parts = repoRaw.split('/').filter((part) => part !== '')
  if (parts.length !== 2) throw new Error(`repo 形态非法：${repoRaw}（应形如 owner/name）`)
  const [owner, name] = parts
  // 注意：owner/name 这里**不 trim**——带内部空白的写法直接由 assertSafeSegment 拒掉，
  // 免得 `owner/ name` 被悄悄改成 `owner/name` 发出去（参数静默改写比报错更难查）。
  return {
    package: pkg,
    repo: `${assertSafeSegment(owner, 'repo.owner')}/${assertSafeSegment(name, 'repo.name')}`,
    owner: assertSafeSegment(owner, 'repo.owner'),
    name: assertSafeSegment(name, 'repo.name'),
  }
}

/* ================================================================== *
 * 二、HTTP：单请求超时 + 错误体原样带回
 * ================================================================== */

/** 从错误里判断是不是超时（AbortSignal.timeout 抛 TimeoutError；手工 abort 抛 AbortError）。 */
function isTimeoutError(error) {
  const name = String(error?.name ?? '')
  return name === 'TimeoutError' || name === 'AbortError' || /aborted due to timeout/i.test(String(error?.message ?? ''))
}

/** 错误一句话（含 timeout 归类）。 */
export function describeError(error, budgetMs = 0) {
  if (isTimeoutError(error)) return `超时（${budgetMs || '?'}ms 内没响应）`
  const message = String(error?.message ?? error ?? '').trim()
  const cause = String(error?.cause?.code ?? error?.cause?.message ?? '').trim()
  const base = message || '未知错误'
  if (cause && !base.includes(cause)) return `${base}（${cause}）`
  return base
}

/** HTTP 失败一句话：状态码 + 服务端 message 原文（403 限流要能看见原因）。
 *  兼容各家不同的错误字段名：`message`（GitHub/Gitee）/ `error`（npm）/ `error_message`（GitCode）。
 *  `status:0` 表示请求在传输层就挂了（连不上/被 reset/超时），此时**没有状态码**，
 *  要把 `error` 里的底层原因（如 ECONNRESET）原样带上，否则只剩一句无用的 "HTTP 0"。 */
export function describeHttpFailure(response, label) {
  const prefix = label ? `${label}：` : ''
  const status = Number(response?.status) || 0
  let detail = ''
  if (response?.json && typeof response.json === 'object') {
    const json = response.json
    detail = String(json.message ?? json.error ?? json.error_message ?? json.msg ?? '').trim()
  }
  if (!detail) detail = String(response?.text ?? '').slice(0, 300).replace(/\s+/g, ' ').trim()
  if (status === 0) {
    const reason = String(response?.error ?? '').trim()
    // `error` 是 fetchJson 兜住的网络层原因（可能是 describeError 的中文描述，也可能只是 HTTP 0）
    const base = reason && reason !== 'HTTP 0' ? reason : '请求未拿到 HTTP 响应'
    return `${prefix}${base}${detail ? `：${detail}` : ''}`
  }
  return `${prefix}HTTP ${status}${detail ? `：${detail}` : ''}`
}

/**
 * 发一个 GET 并尽力解析 JSON。
 * @param {string} url
 * @param {{deadline:number, requestTimeoutMs:number, fetchImpl:Function, headers?:object}} options
 * @returns {Promise<{ok:boolean, status:number, text:string, json:any, error:string}>}
 *   网络层/超时失败时 `error` 非空且 `ok:false`（**不抛**，调用方按平台归类）。
 */
export async function fetchJson(url, options = {}) {
  const { deadline = Date.now() + 15000, requestTimeoutMs = 8000, fetchImpl = globalThis.fetch, headers = {} } = options
  assertAllowedUrl(url) // 白名单不符直接抛：这是唯一会抛的分支（配置/参数错，属于调用方错误）
  const remaining = deadline - Date.now()
  if (remaining <= 0) return { ok: false, status: 0, text: '', json: null, error: '总超时（15 秒预算已用完，请求未发）' }
  const budgetMs = Math.max(500, Math.min(requestTimeoutMs, remaining))
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(budgetMs),
    })
    let text = ''
    try {
      text = await response.text()
    } catch (error) {
      return { ok: false, status: response?.status ?? 0, text: '', json: null, error: describeError(error, budgetMs) }
    }
    let json = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    const ok = response?.ok === true
    return { ok, status: response?.status ?? 0, text, json, error: ok ? '' : `HTTP ${response?.status ?? '?'}` }
  } catch (error) {
    return { ok: false, status: 0, text: '', json: null, error: describeError(error, budgetMs) }
  }
}

/**
 * 总预算兜底：就算注进来的 fetch 完全不看 signal，也不让整次调用超过 15 秒。
 * 超时返回 `{timedOut:true}`，不抛。
 *
 * **这个定时器故意不 `unref()`**：它是有界的一次性计时（最长 15 秒，`finally` 里必清），
 * 而且当某个 fetch 永不 resolve 时，它往往是**唯一还撑着事件循环的东西**——
 * unref 掉会让 Node 认为没事可做、直接退出，表现是 `unsettled top-level await`
 * 加一个退出码 0（单测当场踩到过）。有界计时器不 unref 不会漏活进程。
 */
export function withBudget(promise, deadline, hint = '总超时') {
  const remaining = Math.max(0, deadline - Date.now())
  let timer = null
  const timeout = new Promise((done) => {
    timer = setTimeout(() => done({ timedOut: true, error: `${hint}（${remaining}ms 预算已用完）` }), remaining)
  })
  return Promise.race([
    Promise.resolve(promise).catch((error) => ({ timedOut: false, error: describeError(error) })),
    timeout,
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/* ================================================================== *
 * 三、各平台采集（每个都自己吞错，只回 unavailable）
 * ================================================================== */

const NPM_WINDOWS = [
  ['lastDay', 'last-day'],
  ['lastWeek', 'last-week'],
  ['lastMonth', 'last-month'],
]

function emptyWindow() {
  return { downloads: 0, start: '', end: '', unavailable: '' }
}

/** npm 三个下载窗口（逐窗口独立成败，一个失败不影响另外两个）。 */
export async function collectNpmDownloads(pkg, options = {}) {
  const results = await Promise.all(NPM_WINDOWS.map(async ([key, window]) => {
    const url = `https://api.npmjs.org/downloads/point/${window}/${encodePackagePath(pkg)}`
    const res = await fetchJson(url, options)
    if (!res.ok) {
      return [key, { ...emptyWindow(), unavailable: describeHttpFailure({ ...res, json: res.json }, `npm ${window}`) }]
    }
    const downloads = res.json?.downloads
    if (!Number.isFinite(downloads)) {
      return [key, { ...emptyWindow(), unavailable: `npm ${window}：返回里没有 downloads 字段` }]
    }
    // start/end 原样带回：npm 的 end 日期滞后约 2 天，"last-day" 不是今天（实测坑）。
    return [key, {
      downloads: Math.max(0, Math.trunc(downloads)),
      start: String(res.json?.start ?? ''),
      end: String(res.json?.end ?? ''),
      unavailable: '',
    }]
  }))
  return Object.fromEntries(results)
}

/** npm registry：latest 版本号 + 发布时间（直接 HTTP GET，不 shell 调 npm）。 */
export async function collectNpmVersion(pkg, options = {}) {
  const url = `https://registry.npmjs.org/${encodePackagePath(pkg)}`
  const res = await fetchJson(url, { ...options, requestTimeoutMs: Math.max(options.requestTimeoutMs ?? 8000, 8000) })
  if (!res.ok) return { version: '', publishedAt: '', unavailable: describeHttpFailure(res, 'npm registry') }
  const latest = String(res.json?.['dist-tags']?.latest ?? '').trim()
  if (!latest) return { version: '', publishedAt: '', unavailable: 'npm registry：返回里没有 dist-tags.latest' }
  const publishedAt = String(res.json?.time?.[latest] ?? '').trim()
  return { version: latest, publishedAt, unavailable: publishedAt ? '' : 'npm registry：没有该版本的发布时间' }
}

function shapeRepoCounts(json) {
  const num = (value) => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0)
  // 主字段按 GitHub/Gitee 的 `*_count` 命名；同时容忍简写（`stars`/`forks`/`watchers`），
  // 免得某个平台换个字段名就整段归 0（GitCode 这类平台文档不一，留个兜底）。
  return {
    stars: num(json?.stargazers_count ?? json?.stars),
    forks: num(json?.forks_count ?? json?.forks),
    watchers: num(json?.watchers_count ?? json?.subscribers_count ?? json?.watchers),
    openIssues: num(json?.open_issues_count ?? json?.open_issues ?? json?.issues),
  }
}

/**
 * GitHub：直连 api.github.com 优先，失败走 gh-proxy.com 第三方代理。
 *
 * ⚠ **gh-proxy.com 是第三方代理**：把 `https://api.github.com/repos/{owner}/{repo}` 整个路径
 * 交给它转发，等于把你查询的仓库路径暴露给这个第三方（会进它的访问日志）。只在本机直连
 * 失败时用它，`pkgStatsAllowGithubProxy: false` 可关掉这条兜底。
 */
export async function collectGithub(owner, name, options = {}) {
  const { cfg = {}, ...fetchOptions } = options
  const allowProxy = cfg?.pkgStatsAllowGithubProxy !== false
  const directTimeout = Number(cfg?.pkgStatsGithubDirectTimeoutMs) || PKG_STATS_DEFAULTS.pkgStatsGithubDirectTimeoutMs
  const directUrl = `https://api.github.com/repos/${owner}/${name}`
  const direct = await fetchJson(directUrl, { ...fetchOptions, requestTimeoutMs: Math.min(fetchOptions.requestTimeoutMs ?? 8000, directTimeout) })
  if (direct.ok) {
    return { ...shapeRepoCounts(direct.json), unavailable: '', source: 'direct' }
  }
  const directReason = describeHttpFailure(direct, 'api.github.com')

  if (!allowProxy) {
    return { stars: 0, forks: 0, watchers: 0, openIssues: 0, unavailable: `直连失败（${directReason}）；按配置 pkgStatsAllowGithubProxy=false 不走代理`, source: '' }
  }

  // 代理形态：把 GitHub 的 URL 原样作为路径段交给 gh-proxy.com。
  const proxyUrl = `https://gh-proxy.com/https://api.github.com/repos/${owner}/${name}`
  const proxied = await fetchJson(proxyUrl, fetchOptions)
  if (proxied.ok) {
    return { ...shapeRepoCounts(proxied.json), unavailable: '', source: 'gh-proxy' }
  }
  const proxyReason = describeHttpFailure(proxied, 'gh-proxy.com')
  return {
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    unavailable: `两路都失败：直连（${directReason}）；第三方代理 gh-proxy.com（${proxyReason}）`,
    source: '',
  }
}

/** Gitee（可用；watchers_count 语义是"关注数"，与 GitHub watchers 不同）。 */
export async function collectGitee(owner, name, options = {}) {
  const url = `https://gitee.com/api/v5/repos/${owner}/${name}`
  const res = await fetchJson(url, options)
  if (!res.ok) {
    return { stars: 0, forks: 0, watchers: 0, openIssues: 0, unavailable: describeHttpFailure(res, 'gitee') }
  }
  return { ...shapeRepoCounts(res.json), unavailable: '' }
}

/**
 * GitCode：**没有匿名 API**（实测 `gitcode.com/api/v5/...` 返 400
 * `Invalid header parameter: private-token, required`；`api.gitcode.com/api/v5/...` 返 401，
 * 两者都要 private-token）。
 *
 * **为什么打 gitcode.com 而不是 api.gitcode.com**：白名单是任务书钦定的六条，
 * `api.gitcode.com` 不在其中（精确主机名匹配，不放子域）。所以这一路走主站路径
 * `gitcode.com/api/v5/...`——它在白名单内，且服务端会把**真实原因原话**带回来
 * （error_message），正好满足"取不到就如实报原因"的要求。
 *
 * 这里仍然发一次请求的意义：如果哪天 GitCode 开了匿名访问，这行代码会自动接上；
 * 页面上看到的 star/fork 是异步渲染的 **UI 数字**，不是接口确证，本工具不抓页面。
 */
export async function collectGitcode(owner, name, options = {}) {
  const url = `https://gitcode.com/api/v5/repos/${owner}/${name}`
  const res = await fetchJson(url, options)
  if (res.ok) {
    const counts = shapeRepoCounts(res.json)
    return { stars: counts.stars, forks: counts.forks, unavailable: '' }
  }
  const reason = describeHttpFailure(res, 'gitcode.com/api/v5')
  const hint = res.status === 401 || res.status === 400
    ? '（GitCode 无匿名 API，需 private-token；本工具不带任何凭据，故取不到。页面上的 star/fork 是 UI 数字，不作接口确证）'
    : ''
  return { stars: 0, forks: 0, unavailable: `${reason}${hint}` }
}

/* ================================================================== *
 * 四、主流程
 * ================================================================== */

/** 平台级不可用原因（npm 整体失败时给）。 */
function firstUnavailable(list) {
  for (const item of list) if (item?.unavailable) return item.unavailable
  return ''
}

/**
 * pkg_stats 主流程（同步返回，内部并发请求，总预算 15 秒）。
 * @param {{package?:string, repo?:string}} args
 * @param {{cfg?:object, logUsage?:Function, warn?:Function, fetchImpl?:Function, now?:Function}} deps
 * @returns {Promise<object>} 恒为 shapePkgStatsOutput 归一的合法形状；除参数非法外不抛。
 */
export async function executePkgStats(args = {}, deps = {}) {
  const { cfg = {}, logUsage, warn, fetchImpl = globalThis.fetch, now = () => new Date() } = deps
  const startedAt = now()
  const rec = {
    ts: startedAt.toISOString(),
    tool: 'pkg_stats',
    args: '',
    status: 'success',
    denyReason: '',
    durationMs: 0,
    outBytes: 0,
    truncated: false,
    ok: false,
    exitCode: null,
    error: '',
  }
  const started = Date.now()

  let normalized
  try {
    normalized = normalizePkgStatsArgs(args, cfg)
  } catch (error) {
    const message = String(error?.message ?? error)
    rec.status = 'denied'
    rec.denyReason = message
    rec.args = `package=${String(args?.package ?? '')} repo=${String(args?.repo ?? '')}`.slice(0, 200)
    rec.error = message
    rec.durationMs = Date.now() - started
    try {
      logUsage?.(rec)
    } catch {
      /* 留痕自己不该抛 */
    }
    return shapePkgStatsOutput({
      ok: false,
      package: '',
      version: '',
      repo: '',
      error: `参数不合法：${message}`,
      fetchedAt: startedAt.toISOString(),
    })
  }

  const timeoutMs = Number(cfg?.pkgStatsTimeoutMs) || PKG_STATS_DEFAULTS.pkgStatsTimeoutMs
  const requestTimeoutMs = Number(cfg?.pkgStatsRequestTimeoutMs) || PKG_STATS_DEFAULTS.pkgStatsRequestTimeoutMs
  const deadline = started + timeoutMs
  const fetchOptions = { deadline, requestTimeoutMs, fetchImpl }
  rec.args = `package=${normalized.package} repo=${normalized.repo}`

  // 各平台**并发**跑：总耗时 ≈ 最慢那个，而不是七次请求相加。
  const [windowResults, registryResult, githubResult, giteeResult, gitcodeResult] = await Promise.all([
    withBudget(collectNpmDownloads(normalized.package, fetchOptions), deadline, '总超时（npm 下载量）'),
    withBudget(collectNpmVersion(normalized.package, fetchOptions), deadline, '总超时（npm registry）'),
    withBudget(collectGithub(normalized.owner, normalized.name, { ...fetchOptions, cfg }), deadline, '总超时（GitHub）'),
    withBudget(collectGitee(normalized.owner, normalized.name, fetchOptions), deadline, '总超时（Gitee）'),
    withBudget(collectGitcode(normalized.owner, normalized.name, fetchOptions), deadline, '总超时（GitCode）'),
  ])

  // 每个分支都要能落成"合法的空壳 + unavailable"，绝不因为某个平台炸掉就少字段。
  const windows = windowResults?.timedOut
    ? Object.fromEntries(NPM_WINDOWS.map(([key]) => [key, { ...emptyWindow(), unavailable: windowResults.error }]))
    : (windowResults ?? {})
  const lastDay = windows.lastDay ?? { ...emptyWindow(), unavailable: 'npm：未取到 last-day' }
  const lastWeek = windows.lastWeek ?? { ...emptyWindow(), unavailable: 'npm：未取到 last-week' }
  const lastMonth = windows.lastMonth ?? { ...emptyWindow(), unavailable: 'npm：未取到 last-month' }

  const npmVersion = registryResult?.timedOut
    ? { version: '', publishedAt: '', unavailable: registryResult.error }
    : (registryResult ?? { version: '', publishedAt: '', unavailable: 'npm registry：未取到' })
  const github = githubResult?.timedOut
    ? { stars: 0, forks: 0, watchers: 0, openIssues: 0, unavailable: githubResult.error, source: '' }
    : (githubResult ?? { stars: 0, forks: 0, watchers: 0, openIssues: 0, unavailable: 'GitHub：未取到', source: '' })
  const gitee = giteeResult?.timedOut
    ? { stars: 0, forks: 0, watchers: 0, openIssues: 0, unavailable: giteeResult.error }
    : (giteeResult ?? { stars: 0, forks: 0, watchers: 0, openIssues: 0, unavailable: 'Gitee：未取到' })
  const gitcode = gitcodeResult?.timedOut
    ? { stars: 0, forks: 0, unavailable: gitcodeResult.error }
    : (gitcodeResult ?? { stars: 0, forks: 0, unavailable: 'GitCode：未取到' })

  const npmUnavailable = firstUnavailable([lastDay, lastWeek, lastMonth])
  const anyNpmWindow = !lastDay.unavailable || !lastWeek.unavailable || !lastMonth.unavailable
  const ok = anyNpmWindow || !npmVersion.unavailable || !github.unavailable || !gitee.unavailable

  const errorParts = []
  if (!ok) {
    errorParts.push(`全部平台都没取到：npm（${npmUnavailable || 'registry 失败'}）、GitHub（${github.unavailable || '失败'}）、Gitee（${gitee.unavailable || '失败'}）`)
  }

  const fetchedAt = new Date().toISOString()
  const result = shapePkgStatsOutput({
    ok,
    package: normalized.package,
    version: npmVersion.version,
    repo: normalized.repo,
    npm: {
      lastDay,
      lastWeek,
      lastMonth,
      versionPublishedAt: npmVersion.publishedAt,
      unavailable: anyNpmWindow ? '' : `npm 下载量全部失败：${npmUnavailable || '未知原因'}`,
    },
    github,
    gitee,
    gitcode,
    fetchedAt,
    error: errorParts.join('；'),
  })

  rec.status = ok ? 'success' : 'error'
  rec.ok = ok
  rec.error = result.error
  rec.outBytes = JSON.stringify(result).length
  rec.durationMs = Date.now() - started
  try {
    logUsage?.(rec)
  } catch {
    /* 留痕失败不影响结果 */
  }
  try {
    warn?.(`aiyayi-toolkit: pkg_stats ${result.package}@${result.version || '?'} ok=${ok} ${rec.durationMs}ms`)
  } catch {
    /* logger 缺了就算了 */
  }
  return result
}

/* ================================================================== *
 * 五、输出归一 + schema
 * ================================================================== */

function shapeWindow(raw) {
  const downloads = Number.isFinite(raw?.downloads) ? Math.max(0, Math.trunc(raw.downloads)) : 0
  return {
    downloads,
    start: String(raw?.start ?? ''),
    end: String(raw?.end ?? ''),
    unavailable: String(raw?.unavailable ?? ''),
  }
}

function shapeCount(raw, key) {
  const value = raw?.[key]
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

/** pkg_stats 输出归一：字段与 PKG_STATS_SCHEMA.output.schema 一一对应。 */
export function shapePkgStatsOutput(raw = {}) {
  const npm = raw?.npm ?? {}
  return {
    ok: raw?.ok === true,
    package: String(raw?.package ?? ''),
    version: String(raw?.version ?? ''),
    repo: String(raw?.repo ?? ''),
    npm: {
      lastDay: shapeWindow(npm.lastDay),
      lastWeek: shapeWindow(npm.lastWeek),
      lastMonth: shapeWindow(npm.lastMonth),
      versionPublishedAt: String(npm.versionPublishedAt ?? ''),
      unavailable: String(npm.unavailable ?? ''),
    },
    github: {
      stars: shapeCount(raw?.github, 'stars'),
      forks: shapeCount(raw?.github, 'forks'),
      watchers: shapeCount(raw?.github, 'watchers'),
      openIssues: shapeCount(raw?.github, 'openIssues'),
      unavailable: String(raw?.github?.unavailable ?? ''),
      source: String(raw?.github?.source ?? ''),
    },
    gitee: {
      stars: shapeCount(raw?.gitee, 'stars'),
      forks: shapeCount(raw?.gitee, 'forks'),
      watchers: shapeCount(raw?.gitee, 'watchers'),
      openIssues: shapeCount(raw?.gitee, 'openIssues'),
      unavailable: String(raw?.gitee?.unavailable ?? ''),
    },
    gitcode: {
      stars: shapeCount(raw?.gitcode, 'stars'),
      forks: shapeCount(raw?.gitcode, 'forks'),
      unavailable: String(raw?.gitcode?.unavailable ?? ''),
    },
    fetchedAt: String(raw?.fetchedAt ?? ''),
    error: String(raw?.error ?? ''),
  }
}

const WINDOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    downloads: { type: 'integer', description: '该窗口内的下载次数（取不到时为 0，看 unavailable）。' },
    start: { type: 'string', description: '统计窗口起始日（YYYY-MM-DD，原样来自 npm）。' },
    end: { type: 'string', description: '统计窗口结束日（YYYY-MM-DD，原样来自 npm）。⚠ npm 的 end 滞后约 2 天，"last-day" 不是今天。' },
    unavailable: { type: 'string', description: '取不到的原因；成功时为空字符串。' },
  },
  required: ['downloads', 'start', 'end', 'unavailable'],
}

export const PKG_STATS_SCHEMA = {
  name: 'pkg_stats',
  description:
    '同步：查一个 npm 包的下载量（昨日/近 7 天/近 30 天，含统计窗口 start/end 原样）与 latest 版本、发布时间，外加同一仓库在 GitHub / Gitee / GitCode 的热度（star / fork / watcher / open issues）。参数都可省（默认 dsh-aiyayi / BayiHY/dsh-aiyayi）。几秒内返回；某个平台挂了只影响它自己那一段，失败原因写在对应字段的 unavailable 里（取不到不编数）。注意：① npm 统计的 end 日期滞后约 2 天，"last-day" 不是今天；② GitHub 直连在本机不通时经第三方代理 gh-proxy.com 兜底（该代理会看到你查询的仓库路径）；③ GitCode 无匿名 API，stars/forks 恒为 0 且 unavailable 说明原因。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      package: { type: 'string', description: 'npm 包名（默认 dsh-aiyayi；支持 @scope/name）。只允许字母数字与 . _ ~ -。' },
      repo: { type: 'string', description: '代码仓 owner/name（默认 BayiHY/dsh-aiyayi；两段只允许字母数字与 . _ -）。' },
    },
    required: [],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', description: '是否至少有一个平台取到了数据（全失败为 false，但结构仍然合法）。' },
        package: { type: 'string', description: '查询的 npm 包名；参数非法时为空字符串。' },
        version: { type: 'string', description: 'npm latest 版本号；取不到时为空字符串（原因见 npm.unavailable）。' },
        repo: { type: 'string', description: '查询的 owner/name；参数非法时为空字符串。' },
        npm: {
          type: 'object',
          additionalProperties: false,
          properties: {
            lastDay: WINDOW_SCHEMA,
            lastWeek: WINDOW_SCHEMA,
            lastMonth: WINDOW_SCHEMA,
            versionPublishedAt: { type: 'string', description: 'latest 版本的发布时间（ISO，来自 registry 的 time 字段）；取不到时为空字符串。' },
            unavailable: { type: 'string', description: 'npm 下载量整体失败的原因；只要有一个窗口成功就为空字符串。' },
          },
          required: ['lastDay', 'lastWeek', 'lastMonth', 'versionPublishedAt', 'unavailable'],
        },
        github: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stars: { type: 'integer', description: 'star 数（取不到时为 0，看 unavailable）。' },
            forks: { type: 'integer', description: 'fork 数（取不到时为 0）。' },
            watchers: { type: 'integer', description: 'GitHub 的 watchers_count（取不到时为 0）。' },
            openIssues: { type: 'integer', description: 'open issues 数（取不到时为 0）。' },
            unavailable: { type: 'string', description: '取不到的原因（直连与代理两路都会写上）；成功时为空字符串。' },
            source: { type: 'string', description: '数据来源："direct"=直连 api.github.com；"gh-proxy"=经第三方代理 gh-proxy.com；空字符串=没取到。' },
          },
          required: ['stars', 'forks', 'watchers', 'openIssues', 'unavailable', 'source'],
        },
        gitee: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stars: { type: 'integer', description: 'star 数（取不到时为 0）。' },
            forks: { type: 'integer', description: 'fork 数（取不到时为 0）。' },
            watchers: { type: 'integer', description: 'Gitee 的 watchers_count = 关注数，语义与 GitHub watchers 不同（本仓库实测 1）。' },
            openIssues: { type: 'integer', description: 'open issues 数（取不到时为 0）。' },
            unavailable: { type: 'string', description: '取不到的原因；成功时为空字符串。' },
          },
          required: ['stars', 'forks', 'watchers', 'openIssues', 'unavailable'],
        },
        gitcode: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stars: { type: 'integer', description: 'star 数（GitCode 无匿名 API，正常恒为 0，看 unavailable）。' },
            forks: { type: 'integer', description: 'fork 数（同上，正常恒为 0）。' },
            unavailable: { type: 'string', description: '取不到的原因（无匿名 API / HTTP 状态 + 服务端原话）；取到时为空字符串。' },
          },
          required: ['stars', 'forks', 'unavailable'],
        },
        fetchedAt: { type: 'string', description: '本次采集完成时间（ISO）。' },
        error: { type: 'string', description: '整体失败/参数非法的一句话原因；正常时为空字符串。' },
      },
      required: ['ok', 'package', 'version', 'repo', 'npm', 'github', 'gitee', 'gitcode', 'fetchedAt', 'error'],
    },
    render: (_args, value) => {
      if (!value.package) return TEXT_BLOCK(`pkg_stats 参数不合法：${value.error}`)
      const lines = [`${value.package}${value.version ? `@${value.version}` : ''}（${value.repo}）`]
      const win = (label, item) => (item.unavailable
        ? `  ${label}：取不到（${item.unavailable}）`
        : `  ${label}：${item.downloads} 次（${item.start} → ${item.end}）`)
      lines.push(win('昨日', value.npm.lastDay))
      lines.push(win('近 7 天', value.npm.lastWeek))
      lines.push(win('近 30 天', value.npm.lastMonth))
      if (value.npm.versionPublishedAt) lines.push(`  发布时间：${value.npm.versionPublishedAt}`)
      if (value.npm.unavailable) lines.push(`  npm：${value.npm.unavailable}`)
      const repoLine = (label, item) => (item.unavailable
        ? `  ${label}：取不到（${item.unavailable}）`
        : `  ${label}：★${item.stars} fork ${item.forks} watch ${item.watchers} issues ${item.openIssues}`)
      lines.push(repoLine('GitHub', value.github))
      if (value.github.source === 'gh-proxy') lines.push('  （GitHub 直连失败，数据经第三方代理 gh-proxy.com）')
      lines.push(repoLine('Gitee', value.gitee))
      lines.push(value.gitcode.unavailable
        ? `  GitCode：取不到（${value.gitcode.unavailable}）`
        : `  GitCode：★${value.gitcode.stars} fork ${value.gitcode.forks}`)
      if (value.error) lines.push(`！${value.error}`)
      return TEXT_BLOCK(lines.join('\n'))
    },
  },
}

/** 给单测的出口（生产路径都走上面的导出函数）。 */
export const __testing = {
  isTimeoutError,
  emptyWindow,
  NPM_WINDOWS,
  USER_AGENT,
}
