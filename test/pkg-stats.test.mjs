/**
 * 1.5.42：`pkg_stats`（lib/pkg-stats.js）单测 —— 查 npm 下载量 + 代码仓热度（同步）。
 *
 * 覆盖要点：
 *   1) 各平台正常返回（mock fetch）：npm 三窗口 + registry（latest 版本 / 发布时间）、
 *      GitHub 直连、Gitee、GitCode。**npm 的 start/end 必须原样带回**（end 滞后约 2 天是实测坑）。
 *   2) GitHub 三路：直连成功 → source='direct'；直连失败走代理成功 → source='gh-proxy'；
 *      代理 403 限流 → 两路原因都写进 unavailable 且**不抛**；配置关掉代理 → 只报直连原因。
 *   3) 全平台失败：结构仍然合法（所有字段齐、类型对、unavailable 有值、ok=false）。
 *   4) 超时：fetch 完全不认 signal 也必须在总预算内返回（withBudget 兜底），超时如实进 unavailable。
 *   5) 安全：域名白名单（非白名单主机直接抛、请求不发）、repo/package 注入字符被拒。
 *   6) schema 守门员：单 type 字符串、required 列全 properties、additionalProperties:false
 *      不多键；归一函数对脏输入、以及每个真实分支的输出都过一遍宿主校验规则。
 *
 * 说明：本文件**全部用 mock fetch**，不打真网（真网实测见 CHANGELOG 1.5.42 的实测一节）。
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const ps = await import(libUrl('pkg-stats.js'))
const tk = await import(libUrl('toolkit.js'))

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ------------------------------------------------------------------ *
 * 0. 宿主校验器复刻（同 toolkit.test.mjs / toolkit-async.test.mjs 的子集）
 * ------------------------------------------------------------------ */
const hostTypes = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']
const isPlainRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
function hostValidateValue(schema, value, path = 'value') {
  const out = []
  const type = schema?.type
  if (type === undefined) return []
  if (typeof type !== 'string' || !hostTypes.includes(type)) {
    out.push(`${path}.type 必须是单 type 字符串`)
    return out
  }
  if (type === 'object') {
    if (!isPlainRecord(value)) return [`"${path}" must be an object`]
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) out.push(`missing required property "${path === '' ? key : `${path}.${key}`}"`)
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) continue
      out.push(...hostValidateValue(child, value[key], path === '' ? key : `${path}.${key}`))
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) out.push(`"${path}.${key}" is not a declared property`)
      }
    }
    return out
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`"${path}" must be an array`]
    if (schema.items) value.forEach((entry, i) => out.push(...hostValidateValue(schema.items, entry, `${path}[${i}]`)))
    return out
  }
  if (type === 'string') return typeof value === 'string' ? [] : [`"${path}" must be a string`]
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [`"${path}" must be a boolean`]
  if (type === 'integer') {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) ? [] : [`"${path}" must be an integer`]
  }
  return out
}
/** required 必须把 properties 全列进去（1.5.40 的教训，1.5.42 延续）。 */
function requiredCoversAll(schema) {
  const props = Object.keys(schema.properties ?? {})
  const required = schema.required ?? []
  return props.every((key) => required.includes(key))
}
/** 逐层扫 schema，任何 type 不是字符串即违例（宿主 UNSUPPORTED_SCHEMA）。 */
function collectSchemaTypeNodes(node, path, hits) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return hits
  if ('type' in node && node.type !== undefined) hits.push({ path: `${path}.type`, value: node.type })
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    collectSchemaTypeNodes(child, `${path}.properties.${key}`, hits)
  }
  if (node.items) collectSchemaTypeNodes(node.items, `${path}.items`, hits)
  return hits
}
function checkOutput(label, schema, value) {
  const violations = hostValidateValue(schema, value)
  check(label, violations.length === 0, `${violations.join('；')}\n        实际输出: ${JSON.stringify(value)}`)
  return value
}

/* ------------------------------------------------------------------ *
 * 1. schema 结构（坑 #77 / #78）
 * ------------------------------------------------------------------ */
const SCHEMA = ps.PKG_STATS_SCHEMA
check('schema：名字是 pkg_stats', SCHEMA.name === 'pkg_stats', SCHEMA.name)
check('schema：parameters.type 是单字符串 object', SCHEMA.parameters?.type === 'object', JSON.stringify(SCHEMA.parameters?.type))
check('schema：parameters 两个参数都可省（required 为空）', Array.isArray(SCHEMA.parameters.required) && SCHEMA.parameters.required.length === 0, JSON.stringify(SCHEMA.parameters.required))
check('schema：parameters.additionalProperties=false', SCHEMA.parameters.additionalProperties === false)
check('schema：output.schema.type 是单字符串 object', SCHEMA.output.schema.type === 'object', JSON.stringify(SCHEMA.output.schema.type))
check('schema：output.schema.additionalProperties=false', SCHEMA.output.schema.additionalProperties === false)
check('schema：output required 列全顶层 properties（坑 #78）', requiredCoversAll(SCHEMA.output.schema), JSON.stringify({
  props: Object.keys(SCHEMA.output.schema.properties), required: SCHEMA.output.schema.required,
}))
check('schema：每个平台子对象的 required 也列全 properties',
  ['npm', 'github', 'gitee', 'gitcode'].every((key) => requiredCoversAll(SCHEMA.output.schema.properties[key])),
  JSON.stringify(['npm', 'github', 'gitee', 'gitcode'].map((k) => SCHEMA.output.schema.properties[k].required)))
check('schema：npm 三个窗口子 schema 的 required 也列全',
  ['lastDay', 'lastWeek', 'lastMonth'].every((k) => requiredCoversAll(SCHEMA.output.schema.properties.npm.properties[k])))
check('schema：全篇没有 type 数组（宿主 UNSUPPORTED_SCHEMA）',
  collectSchemaTypeNodes(SCHEMA.parameters, 'parameters', []).every((h) => typeof h.value === 'string')
  && collectSchemaTypeNodes(SCHEMA.output.schema, 'output.schema', []).every((h) => typeof h.value === 'string'),
  JSON.stringify([...collectSchemaTypeNodes(SCHEMA.parameters, 'parameters', []), ...collectSchemaTypeNodes(SCHEMA.output.schema, 'output.schema', [])]))
check('schema：有 render', typeof SCHEMA.output.render === 'function')
check('schema：description 里写清了三个实测坑（end 滞后 / 代理 / GitCode 无匿名 API）',
  SCHEMA.description.includes('end 日期滞后') && SCHEMA.description.includes('gh-proxy.com') && SCHEMA.description.includes('GitCode 无匿名 API'),
  SCHEMA.description)

/* ------------------------------------------------------------------ *
 * 2. mock fetch 路由器
 * ------------------------------------------------------------------ */
/**
 * 造一个按 URL 分派的假 fetch。routes: (url) => ({status, body}) | 'hang' | 'throw'
 * body 可以是对象（自动 JSON）或字符串。
 */
function makeFetch(routes) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    const handler = routes(String(url), options)
    if (handler === 'hang') return new Promise(() => {}) // 永不 resolve，模拟不认 signal 的卡死
    if (handler === 'throw') {
      const error = new Error('fetch failed')
      error.cause = { code: 'ECONNRESET' }
      throw error
    }
    const { status = 200, body = '' } = handler ?? {}
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(),
      text: async () => text,
      json: async () => JSON.parse(text),
    }
  }
  return { fetchImpl, calls }
}

const HAPPY = {
  npmLastDay: { downloads: 744, start: '2026-11-10', end: '2026-11-10', package: 'dsh-aiyayi' },
  npmLastWeek: { downloads: 4549, start: '2026-11-04', end: '2026-11-10', package: 'dsh-aiyayi' },
  npmLastMonth: { downloads: 4851, start: '2026-10-12', end: '2026-11-10', package: 'dsh-aiyayi' },
  registry: {
    'dist-tags': { latest: '1.5.41' },
    time: { '1.5.41': '2026-11-12T07:17:11.900Z', modified: '2026-11-12T07:17:12.169Z' },
  },
  github: {
    stargazers_count: 42, forks_count: 7, watchers_count: 42, subscribers_count: 3,
    open_issues_count: 5, pushed_at: '2026-11-12T07:19:36Z',
  },
  gitee: { stargazers_count: 11, forks_count: 2, watchers_count: 1, open_issues_count: 4 },
  gitcode: { stars: 125, forks: 3 },
}

const happyRoutes = (url) => {
  if (url.includes('api.npmjs.org/downloads/point/last-day/')) return { status: 200, body: HAPPY.npmLastDay }
  if (url.includes('api.npmjs.org/downloads/point/last-week/')) return { status: 200, body: HAPPY.npmLastWeek }
  if (url.includes('api.npmjs.org/downloads/point/last-month/')) return { status: 200, body: HAPPY.npmLastMonth }
  if (url.includes('registry.npmjs.org/')) return { status: 200, body: HAPPY.registry }
  if (url.startsWith('https://api.github.com/repos/')) return { status: 200, body: HAPPY.github }
  if (url.startsWith('https://gh-proxy.com/')) return { status: 200, body: HAPPY.github }
  if (url.startsWith('https://gitee.com/api/v5/repos/')) return { status: 200, body: HAPPY.gitee }
  if (url.startsWith('https://gitcode.com/api/v5/')) return { status: 200, body: HAPPY.gitcode }
  return { status: 404, body: { message: 'unrouted' } }
}

/* ------------------------------------------------------------------ *
 * 3. 正常路径：各平台都取到
 * ------------------------------------------------------------------ */
const happy = await ps.executePkgStats({}, { fetchImpl: makeFetch(happyRoutes).fetchImpl, logUsage: () => {}, warn: () => {} })
checkOutput('正常：输出过宿主校验', SCHEMA.output.schema, happy)
check('正常：ok=true', happy.ok === true, JSON.stringify(happy.ok))
check('正常：默认 package 是 dsh-aiyayi', happy.package === 'dsh-aiyayi', happy.package)
check('正常：默认 repo 是 BayiHY/dsh-aiyayi', happy.repo === 'BayiHY/dsh-aiyayi', happy.repo)
check('正常：version 取自 registry dist-tags.latest', happy.version === '1.5.41', happy.version)
check('正常：versionPublishedAt 取自 registry time[latest]', happy.npm.versionPublishedAt === '2026-11-12T07:17:11.900Z', happy.npm.versionPublishedAt)
check('正常：lastDay 下载量 744', happy.npm.lastDay.downloads === 744, JSON.stringify(happy.npm.lastDay))
check('正常：lastWeek 下载量 4549', happy.npm.lastWeek.downloads === 4549, JSON.stringify(happy.npm.lastWeek))
check('正常：lastMonth 下载量 4851', happy.npm.lastMonth.downloads === 4851, JSON.stringify(happy.npm.lastMonth))
check('正常：start/end 原样带回（end 滞后坑——"last-day" 的 end 不是今天）',
  happy.npm.lastDay.start === '2026-11-10' && happy.npm.lastDay.end === '2026-11-10'
  && happy.npm.lastWeek.start === '2026-11-04' && happy.npm.lastWeek.end === '2026-11-10',
  JSON.stringify([happy.npm.lastDay, happy.npm.lastWeek]))
check('正常：npm.unavailable 全空（取到了就不该有原因）',
  happy.npm.unavailable === '' && happy.npm.lastDay.unavailable === '' && happy.npm.lastWeek.unavailable === '' && happy.npm.lastMonth.unavailable === '',
  JSON.stringify(happy.npm))
check('正常：GitHub 直连成功，source=direct', happy.github.source === 'direct' && happy.github.unavailable === '', JSON.stringify(happy.github))
check('正常：GitHub stars=42 / forks=7 / openIssues=5',
  happy.github.stars === 42 && happy.github.forks === 7 && happy.github.openIssues === 5, JSON.stringify(happy.github))
check('正常：Gitee watchers=1（关注数，语义与 GitHub 不同）', happy.gitee.watchers === 1 && happy.gitee.stars === 11, JSON.stringify(happy.gitee))
check('正常：GitCode 取到时不留 unavailable 且计数来自响应（stars/forks 两套字段名都认）',
  happy.gitcode.unavailable === '' && happy.gitcode.stars === 125 && happy.gitcode.forks === 3,
  JSON.stringify(happy.gitcode))
check('正常：fetchedAt 是 ISO 时间', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(happy.fetchedAt), happy.fetchedAt)
check('正常：error 是空串（不是 undefined/null）', happy.error === '', JSON.stringify(happy.error))

/* 3b. 只请求了白名单域名、且都是 GET。 */
const happyFetch = makeFetch(happyRoutes)
await ps.executePkgStats({}, { fetchImpl: happyFetch.fetchImpl, logUsage: () => {}, warn: () => {} })
const hosts = [...new Set(happyFetch.calls.map((call) => new URL(call.url).hostname))]
check('正常：只敲了白名单域名', hosts.every((host) => ps.ALLOWED_HOSTS.includes(host)), JSON.stringify(hosts))
check('正常：全部是 GET', happyFetch.calls.every((call) => call.options.method === 'GET'), JSON.stringify(happyFetch.calls.map((c) => c.options.method)))
check('正常：GitHub 直连成功时不该再打代理（省一次第三方暴露）',
  !happyFetch.calls.some((call) => call.url.startsWith('https://gh-proxy.com/')),
  JSON.stringify(happyFetch.calls.map((c) => c.url)))

/* 3c. 包名/仓库名编码进 URL 时逐段编码（@scope/name 不把 / 编掉）。 */
const scopedFetch = makeFetch((url) => {
  if (url.includes('registry.npmjs.org/')) return { status: 200, body: { 'dist-tags': { latest: '9.9.9' }, time: { '9.9.9': '2026-01-01T00:00:00Z' } } }
  if (url.includes('api.npmjs.org/downloads/point/')) return { status: 200, body: { downloads: 1, start: '2026-11-10', end: '2026-11-10' } }
  return { status: 404, body: { message: 'nope' } }
})
const scoped = await ps.executePkgStats({ package: '@scope/pkg', repo: 'some-owner/some.repo' }, { fetchImpl: scopedFetch.fetchImpl, logUsage: () => {}, warn: () => {}, cfg: { pkgStatsAllowGithubProxy: false } })
check('编码：@scope/name 逐段编码成 %40scope/pkg（/ 保留、@ 编成 %40）',
  scopedFetch.calls.some((call) => call.url === 'https://registry.npmjs.org/%40scope/pkg'),
  JSON.stringify(scopedFetch.calls.map((c) => c.url).filter((u) => u.includes('registry'))))
check('编码：repo 段随参数走（some-owner/some.repo）',
  scopedFetch.calls.some((call) => call.url.includes('/repos/some-owner/some.repo')),
  JSON.stringify(scopedFetch.calls.map((c) => c.url).filter((u) => u.includes('/repos/'))))
checkOutput('编码：scoped 包名路径输出也过宿主校验', SCHEMA.output.schema, scoped)

/* ------------------------------------------------------------------ *
 * 4. GitHub 三路
 * ------------------------------------------------------------------ */
// 4a. 直连失败 → 代理成功
const directFail = makeFetch((url) => {
  if (url.startsWith('https://api.github.com/')) return 'throw'
  if (url.startsWith('https://gh-proxy.com/')) return { status: 200, body: HAPPY.github }
  return happyRoutes(url)
})
const viaProxy = await ps.executePkgStats({}, { fetchImpl: directFail.fetchImpl, logUsage: () => {}, warn: () => {} })
checkOutput('GitHub 代理：直连抛错走代理成功的输出过宿主校验', SCHEMA.output.schema, viaProxy)
check('GitHub 代理：source=gh-proxy', viaProxy.github.source === 'gh-proxy', JSON.stringify(viaProxy.github))
check('GitHub 代理：计数来自代理', viaProxy.github.stars === 42 && viaProxy.github.openIssues === 5, JSON.stringify(viaProxy.github))
check('GitHub 代理：两路都打过（直连 + 代理）',
  directFail.calls.some((c) => c.url.startsWith('https://api.github.com/')) && directFail.calls.some((c) => c.url.startsWith('https://gh-proxy.com/')),
  JSON.stringify(directFail.calls.map((c) => c.url).filter((u) => u.includes('github'))))
check('GitHub 代理：npm/gitee 不受影响（失败隔离）', viaProxy.npm.lastWeek.downloads === 4549 && viaProxy.gitee.stars === 11, JSON.stringify({ npm: viaProxy.npm.lastWeek, gitee: viaProxy.gitee }))

// 4b. 直连失败 + 代理 403 限流
const bothFail = makeFetch((url) => {
  if (url.startsWith('https://api.github.com/')) return 'throw'
  if (url.startsWith('https://gh-proxy.com/')) {
    return { status: 403, body: { message: 'API rate limit exceeded for 1.2.3.4.' } }
  }
  return happyRoutes(url)
})
let bothFailThrew = null
let bothFailResult = null
try {
  bothFailResult = await ps.executePkgStats({}, { fetchImpl: bothFail.fetchImpl, logUsage: () => {}, warn: () => {} })
} catch (error) {
  bothFailThrew = error
}
check('GitHub 两路全挂：不抛异常', bothFailThrew === null, String(bothFailThrew))
checkOutput('GitHub 两路全挂：输出仍过宿主校验', SCHEMA.output.schema, bothFailResult)
check('GitHub 两路全挂：unavailable 有值且带上代理 403 的原话',
  typeof bothFailResult.github.unavailable === 'string'
  && bothFailResult.github.unavailable.length > 0
  && bothFailResult.github.unavailable.includes('403')
  && bothFailResult.github.unavailable.includes('rate limit'),
  bothFailResult.github.unavailable)
check('GitHub 两路全挂：直连原因也写进去了（两路都报）',
  bothFailResult.github.unavailable.includes('直连') && bothFailResult.github.unavailable.includes('gh-proxy.com'),
  bothFailResult.github.unavailable)
check('GitHub 两路全挂：source 是空串、计数归 0（不编数）',
  bothFailResult.github.source === '' && bothFailResult.github.stars === 0 && bothFailResult.github.forks === 0,
  JSON.stringify(bothFailResult.github))
check('GitHub 两路全挂：其他平台照常返回', bothFailResult.npm.lastDay.downloads === 744 && bothFailResult.gitee.stars === 11, JSON.stringify({ npm: bothFailResult.npm.lastDay, gitee: bothFailResult.gitee }))

// 4c. 配置关掉代理 → 只报直连原因，且**不许打代理**（第三方暴露的开关必须真管用）
const noProxy = makeFetch((url) => {
  if (url.startsWith('https://api.github.com/')) return 'throw'
  return happyRoutes(url)
})
const noProxyResult = await ps.executePkgStats({}, { fetchImpl: noProxy.fetchImpl, logUsage: () => {}, warn: () => {}, cfg: { pkgStatsAllowGithubProxy: false } })
check('GitHub 代理开关：关掉后完全不打 gh-proxy.com',
  !noProxy.calls.some((c) => c.url.startsWith('https://gh-proxy.com/')),
  JSON.stringify(noProxy.calls.map((c) => c.url).filter((u) => u.includes('github'))))
check('GitHub 代理开关：unavailable 说明是按配置不走代理',
  noProxyResult.github.unavailable.includes('pkgStatsAllowGithubProxy=false') && noProxyResult.github.source === '',
  noProxyResult.github.unavailable)
checkOutput('GitHub 代理开关：关掉代理的输出过宿主校验', SCHEMA.output.schema, noProxyResult)

// 4d. 直连 404（仓库不存在）也要走代理一次（直连不通/不存在都算"直连没拿到"）
const direct404 = makeFetch((url) => {
  if (url.startsWith('https://api.github.com/')) return { status: 404, body: { message: 'Not Found' } }
  if (url.startsWith('https://gh-proxy.com/')) return { status: 404, body: { message: 'Not Found' } }
  return happyRoutes(url)
})
const notFound = await ps.executePkgStats({ repo: 'BayiHY/no-such-repo' }, { fetchImpl: direct404.fetchImpl, logUsage: () => {}, warn: () => {} })
check('GitHub 404：unavailable 带 404 与服务端原话',
  notFound.github.unavailable.includes('404') && notFound.github.unavailable.includes('Not Found'),
  notFound.github.unavailable)
checkOutput('GitHub 404：输出过宿主校验', SCHEMA.output.schema, notFound)

/* ------------------------------------------------------------------ *
 * 5. GitCode：无匿名 API（401）
 * ------------------------------------------------------------------ */
const gitcode401 = await ps.collectGitcode('BayiHY', 'dsh-aiyayi', {
  fetchImpl: makeFetch((url) => (url === 'https://gitcode.com/api/v5/repos/BayiHY/dsh-aiyayi'
    ? { status: 400, body: { error_code: 400, error_message: 'Orchestration error: Invalid header parameter: private-token, required' } }
    : { status: 404, body: {} })).fetchImpl,
  deadline: Date.now() + 5000,
  requestTimeoutMs: 3000,
})
check('GitCode：请求打在白名单内的 gitcode.com（不是 api.gitcode.com）',
  true) // 由下一行的 mock 命中条件证明：路由只匹配 gitcode.com 主站路径
check('GitCode：400 时 unavailable 带状态码 + 服务端 error_message 原话',
  gitcode401.unavailable.includes('400') && gitcode401.unavailable.includes('Invalid header parameter: private-token'),
  gitcode401.unavailable)
check('GitCode：无匿名 API 时明确点出需 private-token',
  gitcode401.unavailable.includes('private-token'), gitcode401.unavailable)
check('GitCode：明确说明页面 UI 数字不作接口确证',
  gitcode401.unavailable.includes('UI 数字'), gitcode401.unavailable)
check('GitCode：取不到时 stars/forks 归 0（不编数）', gitcode401.stars === 0 && gitcode401.forks === 0, JSON.stringify(gitcode401))

/* ------------------------------------------------------------------ *
 * 6. 全平台失败：结构仍然合法
 * ------------------------------------------------------------------ */
const allFail = makeFetch(() => ({ status: 500, body: { message: 'boom-9527' } }))
const allFailResult = await ps.executePkgStats({}, { fetchImpl: allFail.fetchImpl, logUsage: () => {}, warn: () => {} })
checkOutput('全失败：输出仍过宿主校验（一个字段都不能少）', SCHEMA.output.schema, allFailResult)
check('全失败：ok=false', allFailResult.ok === false, JSON.stringify(allFailResult.ok))
check('全失败：package/repo 仍然回填（不是空串——参数解析成功了）',
  allFailResult.package === 'dsh-aiyayi' && allFailResult.repo === 'BayiHY/dsh-aiyayi',
  JSON.stringify({ package: allFailResult.package, repo: allFailResult.repo }))
check('全失败：version 是空串',
  allFailResult.version === '', JSON.stringify(allFailResult.version))
check('全失败：三窗口都带 unavailable 且 downloads=0',
  [allFailResult.npm.lastDay, allFailResult.npm.lastWeek, allFailResult.npm.lastMonth].every((w) => w.downloads === 0 && w.unavailable.length > 0 && w.start === ''),
  JSON.stringify(allFailResult.npm))
check('全失败：github/gitee/gitcode 的 unavailable 都有值',
  [allFailResult.github, allFailResult.gitee, allFailResult.gitcode].every((p) => p.unavailable.length > 0),
  JSON.stringify({ github: allFailResult.github.unavailable, gitee: allFailResult.gitee.unavailable, gitcode: allFailResult.gitcode.unavailable }))
check('全失败：error 有值且点明"全部平台都没取到"', allFailResult.error.includes('全部平台都没取到'), allFailResult.error)

// 6b. 网络层抛错（不是 HTTP 错误）也照样归到 unavailable
const throwAll = makeFetch(() => 'throw')
const throwResult = await ps.executePkgStats({}, { fetchImpl: throwAll.fetchImpl, logUsage: () => {}, warn: () => {} })
checkOutput('网络层抛错：输出过宿主校验', SCHEMA.output.schema, throwResult)
check('网络层抛错：原因里带底层 code（ECONNRESET）',
  throwResult.github.unavailable.includes('ECONNRESET') || throwResult.gitee.unavailable.includes('ECONNRESET'),
  JSON.stringify({ github: throwResult.github.unavailable, gitee: throwResult.gitee.unavailable }))

/* ------------------------------------------------------------------ *
 * 7. 超时
 * ------------------------------------------------------------------ */
// 7a. fetch 完全不认 signal（永不 resolve）→ withBudget 必须在总预算内收口
const hangFetch = makeFetch(() => 'hang')
const timeoutStarted = Date.now()
const timeoutResult = await ps.executePkgStats({}, {
  fetchImpl: hangFetch.fetchImpl,
  logUsage: () => {},
  warn: () => {},
  cfg: { pkgStatsTimeoutMs: 300, pkgStatsRequestTimeoutMs: 200 },
})
const timeoutMs = Date.now() - timeoutStarted
check('超时：总预算内返回（< 1500ms，证明没被永不 resolve 的 fetch 拖死）', timeoutMs < 1500, `${timeoutMs}ms`)
checkOutput('超时：输出过宿主校验', SCHEMA.output.schema, timeoutResult)
check('超时：ok=false', timeoutResult.ok === false, JSON.stringify(timeoutResult.ok))
check('超时：npm 三窗口 unavailable 都说明超时',
  [timeoutResult.npm.lastDay, timeoutResult.npm.lastWeek, timeoutResult.npm.lastMonth].every((w) => w.unavailable.includes('超时')),
  JSON.stringify(timeoutResult.npm))
check('超时：github/gitee/gitcode 的 unavailable 也说明超时',
  [timeoutResult.github, timeoutResult.gitee, timeoutResult.gitcode].every((p) => p.unavailable.includes('超时')),
  JSON.stringify({ g: timeoutResult.github.unavailable, e: timeoutResult.gitee.unavailable, c: timeoutResult.gitcode.unavailable }))
check('超时：不抛异常（上面能走到这行就说明没抛）', true)

// 7b. AbortSignal.timeout 真的抛 TimeoutError 时，describeError 要认出来
const abortError = new Error('The operation was aborted due to timeout')
abortError.name = 'TimeoutError'
check('超时：TimeoutError 被 describeError 认成"超时"', ps.describeError(abortError, 5000).includes('超时'), ps.describeError(abortError, 5000))
check('超时：普通错误不被误判成超时', !ps.describeError(new Error('ECONNREFUSED')).includes('超时'), ps.describeError(new Error('ECONNREFUSED')))

/* ------------------------------------------------------------------ *
 * 8. 安全：域名白名单 + 参数注入
 * ------------------------------------------------------------------ */
const rejectCases = [
  ['非白名单域名', 'https://evil.example.com/repos/x/y'],
  ['http 协议（只允许 https）', 'http://api.github.com/repos/x/y'],
  ['URL 里带凭据', 'https://user:pass@api.github.com/repos/x/y'],
  ['IP 直连（不是白名单主机名）', 'https://127.0.0.1/repos/x/y'],
  ['白名单域名的子域也不行', 'https://sub.api.github.com/repos/x/y'],
]
for (const [label, url] of rejectCases) {
  let threw = null
  try {
    ps.assertAllowedUrl(url)
  } catch (error) {
    threw = error
  }
  check(`白名单：拒绝${label}`, threw !== null && /白名单|https|凭据/.test(String(threw?.message ?? '')), String(threw))
}
for (const host of ps.ALLOWED_HOSTS) {
  let threw = null
  try {
    ps.assertAllowedUrl(`https://${host}/probe`)
  } catch (error) {
    threw = error
  }
  check(`白名单：放行 ${host}`, threw === null, String(threw))
}

// 参数注入：repo/package 只允许字母数字与 -_. (package 另允许 @ ~)
const badRepos = [
  '../etc/passwd',
  'owner/../../etc',
  'owner/name?x=1',
  'owner/name#frag',
  'owner/na me',
  'owner/name%2f..%2f',
  'owner',
  'a/b/c',
  'owner/name\\..\\',
  'owner/ name',
]
for (const repo of badRepos) {
  let threw = null
  try {
    ps.normalizePkgStatsArgs({ repo }, {})
  } catch (error) {
    threw = error
  }
  check(`注入：repo=${JSON.stringify(repo)} 被拒`, threw !== null, '没抛（可能被放过）')
}
const badPackages = ['../evil', 'a b', 'a?b', 'a#b', '@scope', '@/name', 'a/b/c', '']
for (const pkg of badPackages) {
  let threw = null
  try {
    ps.assertSafePackageName(pkg)
  } catch (error) {
    threw = error
  }
  check(`注入：package=${JSON.stringify(pkg)} 被拒`, threw !== null, '没抛（可能被放过）')
}
check('注入：合法 repo 正常通过', (() => {
  const norm = ps.normalizePkgStatsArgs({ repo: 'BayiHY/dsh-aiyayi' }, {})
  return norm.owner === 'BayiHY' && norm.name === 'dsh-aiyayi' && norm.repo === 'BayiHY/dsh-aiyayi'
})())
check('注入：合法带点带横线的 repo 通过', (() => {
  const norm = ps.normalizePkgStatsArgs({ repo: 'a_b.c-d/e_f.g-h' }, {})
  return norm.repo === 'a_b.c-d/e_f.g-h'
})())
check('注入：package 的 @scope/name 通过', ps.assertSafePackageName('@scope/pkg') === '@scope/pkg')
check('注入：package 的 ~ 通过（npm 允许）', ps.assertSafePackageName('a~b') === 'a~b')

// 参数非法 → 工具返回合法形状 + error，不抛
let badArgThrew = null
let badArgResult = null
try {
  badArgResult = await ps.executePkgStats({ repo: 'owner/../../etc' }, { fetchImpl: makeFetch(happyRoutes).fetchImpl, logUsage: () => {}, warn: () => {} })
} catch (error) {
  badArgThrew = error
}
check('参数非法：不抛异常', badArgThrew === null, String(badArgThrew))
checkOutput('参数非法：输出过宿主校验', SCHEMA.output.schema, badArgResult)
check('参数非法：ok=false + error 说明参数不合法 + package/repo 空串',
  badArgResult.ok === false && badArgResult.error.includes('参数不合法') && badArgResult.package === '' && badArgResult.repo === '',
  JSON.stringify(badArgResult))

/* ------------------------------------------------------------------ *
 * 9. 归一函数：脏输入也要合规（坑 #78 的教训——别漏分支）
 * ------------------------------------------------------------------ */
checkOutput('归一：空对象产出合规形状', SCHEMA.output.schema, ps.shapePkgStatsOutput({}))
checkOutput('归一：脏输入（null/undefined/字符串混进数值位）产出合规形状', SCHEMA.output.schema,
  ps.shapePkgStatsOutput({
    ok: 'yes',
    package: null,
    version: undefined,
    repo: 42,
    npm: { lastDay: null, lastWeek: { downloads: '99', start: null, end: undefined }, lastMonth: { downloads: -5 }, versionPublishedAt: null, unavailable: undefined },
    github: { stars: '10', forks: null, watchers: 1.5, openIssues: undefined, unavailable: null, source: 0 },
    gitee: null,
    gitcode: { stars: NaN, forks: Infinity },
    fetchedAt: null,
    error: undefined,
  }))
check('归一：负数下载量被夹到 0', ps.shapePkgStatsOutput({ npm: { lastMonth: { downloads: -5 } } }).npm.lastMonth.downloads === 0)
check('归一：小数被截断成整数（宿主 integer 校验）',
  ps.shapePkgStatsOutput({ github: { stars: 1.9 } }).github.stars === 1)
check('归一：NaN/Infinity 归 0',
  ps.shapePkgStatsOutput({ github: { stars: NaN, forks: Infinity } }).github.stars === 0
  && ps.shapePkgStatsOutput({ github: { stars: NaN, forks: Infinity } }).github.forks === 0)

/* ------------------------------------------------------------------ *
 * 10. 注册 / own-tools / 经 execute 壳（真跑一次，用 mock 换掉全局 fetch）
 * ------------------------------------------------------------------ */
check('注册：TOOL_NAMES 含 pkg_stats 且共 6 个',
  tk.TOOL_NAMES.includes('pkg_stats') && tk.TOOL_NAMES.length === 6, JSON.stringify(tk.TOOL_NAMES))
check('注册：DEFAULT_CONFIG 有 1.5.42 的配置项',
  tk.DEFAULT_CONFIG.pkgStatsDefaultPackage === 'dsh-aiyayi'
  && tk.DEFAULT_CONFIG.pkgStatsDefaultRepo === 'BayiHY/dsh-aiyayi'
  && tk.DEFAULT_CONFIG.pkgStatsTimeoutMs === 15000
  && tk.DEFAULT_CONFIG.pkgStatsRequestTimeoutMs === 8000
  && tk.DEFAULT_CONFIG.pkgStatsAllowGithubProxy === true,
  JSON.stringify({
    p: tk.DEFAULT_CONFIG.pkgStatsDefaultPackage, r: tk.DEFAULT_CONFIG.pkgStatsDefaultRepo,
    t: tk.DEFAULT_CONFIG.pkgStatsTimeoutMs, rt: tk.DEFAULT_CONFIG.pkgStatsRequestTimeoutMs,
    proxy: tk.DEFAULT_CONFIG.pkgStatsAllowGithubProxy,
  }))

const { isOwnTool, OWN_TOOLS } = await import(libUrl('own-tools.js'))
check('own-tools：pkg_stats 被放行', isOwnTool('pkg_stats') === true)
check('own-tools：静态兜底表含 pkg_stats', OWN_TOOLS.includes('pkg_stats'))

const registered = []
const ctx = {
  effect(fn) { fn(); return () => {} },
  tools: { register(def) { registered.push(def); return () => {} } },
  logger: { info: () => {}, warn: () => {} },
}
tk.apply(ctx, { usageEnabled: false })
check('注册：经 apply() 注册出 6 个工具（含 pkg_stats）',
  registered.map((d) => d.name).join(',') === 'toolkit_cmd,toolkit_read,toolkit_write,watch_read,mem_sync,pkg_stats',
  registered.map((d) => d.name).join(','))
const pkgDef = registered.find((d) => d.name === 'pkg_stats')
check('注册：pkg_stats 的 output.schema 就是本模块那份', pkgDef?.output?.schema === SCHEMA.output.schema)
check('注册：pkg_stats 的 required 列全（注册面再核一次）', requiredCoversAll(pkgDef.output.schema))

// 经 execute 壳真调一次：临时替换 globalThis.fetch（壳只认全局 fetch）。
const originalFetch = globalThis.fetch
globalThis.fetch = makeFetch(happyRoutes).fetchImpl
let shellResult = null
let shellThrew = null
try {
  shellResult = await pkgDef.execute({})
} catch (error) {
  shellThrew = error
} finally {
  globalThis.fetch = originalFetch
}
check('转发：经 execute 壳调用不抛', shellThrew === null, String(shellThrew))
checkOutput('转发：经 execute 壳调用输出过宿主校验', SCHEMA.output.schema, shellResult)
check('转发：经 execute 壳调用拿到真实形状（ok / 版本 / 下载量）',
  shellResult.ok === true && shellResult.version === '1.5.41' && shellResult.npm.lastMonth.downloads === 4851,
  JSON.stringify({ ok: shellResult.ok, version: shellResult.version, m: shellResult.npm.lastMonth }))

// render：正常 / 参数非法 / 平台不可用三种都要能出文本，不许抛
for (const [label, value] of [
  ['正常', happy],
  ['参数非法', badArgResult],
  ['两路全挂', bothFailResult],
  ['全失败', allFailResult],
]) {
  let renderThrew = null
  let blocks = null
  try {
    blocks = SCHEMA.output.render({}, value)
  } catch (error) {
    renderThrew = error
  }
  check(`render：${label} 能出文本块且不抛`,
    renderThrew === null && Array.isArray(blocks) && blocks.length === 1 && blocks[0].type === 'text' && blocks[0].text.length > 0,
    String(renderThrew ?? JSON.stringify(blocks)?.slice(0, 200)))
}
check('render：正常路径的文本含下载量与 star',
  SCHEMA.output.render({}, happy)[0].text.includes('4851') && SCHEMA.output.render({}, happy)[0].text.includes('★42'),
  SCHEMA.output.render({}, happy)[0].text)
check('render：走代理时正文明确写出第三方代理',
  SCHEMA.output.render({}, viaProxy)[0].text.includes('gh-proxy.com'),
  SCHEMA.output.render({}, viaProxy)[0].text)

/* ------------------------------------------------------------------ *
 * 11. 源码静态核对（几条安全约定不能只靠"看着像"）
 * ------------------------------------------------------------------ */
const source = readFileSync(join(HERE, '..', 'lib', 'pkg-stats.js'), 'utf8')
check('源码：白名单只列了 6 个域名',
  ps.ALLOWED_HOSTS.length === 6
  && ['api.npmjs.org', 'registry.npmjs.org', 'api.github.com', 'gh-proxy.com', 'gitee.com', 'gitcode.com'].every((h) => ps.ALLOWED_HOSTS.includes(h)),
  JSON.stringify(ps.ALLOWED_HOSTS))
check('源码：白名单是冻结的（运行时改不动）', Object.isFrozen(ps.ALLOWED_HOSTS))
check('源码：注释里写明了 gh-proxy.com 是第三方代理、会暴露仓库路径',
  source.includes('第三方代理') && source.includes('会看到你查询的仓库路径'),
  '注释缺失')
check('源码：没有 shell 调用（不 spawn/exec 外部命令）',
  !/\bspawnSync?\s*\(|\bexecSync\s*\(|\bchild_process\b/.test(source),
  '出现了 child_process 痕迹')
check('源码：所有外部请求都经过 fetchJson（→ assertAllowedUrl）',
  (source.match(/fetchImpl\s*\(/g) ?? []).length === 1,
  `fetchImpl 直接调用次数：${(source.match(/fetchImpl\s*\(/g) ?? []).length}`)

console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
if (!ok) process.exitCode = 1
