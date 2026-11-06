/**
 * aiyayi-net — 小伙伴的联网工具（aiyayi_fetch + aiyayi_cdp）。
 *
 * 目的：让"阿依娅伊的小伙伴"（aiyayi-worker 预设的 subagent）在默认情况下
 * **不用** web_search / web_fetch，而是用这两个内置工具联网；只有用户当轮
 * 明确点名 web_search/web_fetch 时才允许用它。见 README 坑 #25。
 *
 * 为什么用 node 内建能力、不依赖 playwright：
 * - 小伙伴执行环境（DSH runtime node）没有 playwright / playwright-core /
 *   chromium / chrome / msedge（实测 require.resolve 全部 NOT available），
 *   persona 里写"用无头 Playwright chromium.launch()"是空指令，模型照做必报错，
 *   只能退回环境里现成可用的 web_fetch —— 这就是 1.2.7 首版软约束失败的原因。
 * - 但 DSH runtime 的 node 有：全局 fetch、node:http、node:net、node v24 内置
 *   全局 WebSocket。这些内建能力足够做"模拟浏览器抓取"和"CDP 接管浏览器"，
 *   不依赖任何外置 npm 包。
 *
 * 两个工具：
 * - aiyayi_fetch：静态/普通网页抓取。node 内建 fetch + 自定义 UA + 超时 + 重试，
 *   返回 status + 正文（截断保护）。替代 web_fetch 的主力。
 * - aiyayi_cdp：动态页面/需登录态抓取。裸 WebSocket 连用户已启动的浏览器
 *   （--remote-debugging-port，见 browser-cdp-drive 技能），CDP JSON-RPC：
 *   Page.navigate 导航、Runtime.evaluate 在页面上下文执行 JS 拿渲染后 DOM、
 *   Network.getAllCookies 抓含 httpOnly 的 Cookie。
 *
 * 两个工具都注册到 aiyayi-worker 预设作用域，由 cordis.patch.yml 挂载。
 * 零外置依赖（只用 node 内建 + 全局 fetch/WebSocket），跨 DSH 可靠。
 */
import { registerOwnTool } from './own-tools.js'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'

/** Loader 身份。 */
export const name = 'aiyayi-net'

/** 需要的服务。 */
export const inject = ['tools']

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/** 模拟常见浏览器的 UA，避免被目标站当脚本拒绝。 */
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 抓取结果正文上限：防止把整个页面塞爆上下文。 */
const MAX_BODY = 20000
const MAX_CDP_RESULT = 12000

/**
 * 截断到上限，保留头尾（中间替换省略标记），返回计数。
 */
function truncate(text, max) {
  const s = String(text ?? '')
  if (s.length <= max) return s
  const head = Math.floor(max * 0.6)
  const tail = max - head - '…[中段省略]…'.length
  return `${s.slice(0, head)}…[中段省略]…${s.slice(-tail)}`
}

/** 轻量文本清洗：压缩空行、去控制符，方便贴回上下文。 */
function tidy(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * CDP 单次 JSON-RPC 调用。node v24 全局 WebSocket。
 * @param {string} wsUrl 例如 ws://127.0.0.1:9222/devtools/page/xxxx
 * @param {string} method CDP 方法名
 * @param {object} [params]
 * @returns {Promise<any>} data 域（不发 result 则返回 undefined）
 */
function cdpCall(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    let ws
    try {
      ws = new WebSocket(wsUrl)
    } catch (e) {
      return reject(new Error(`无法创建 WebSocket 连接：${e?.message ?? e}`))
    }
    const timeout = setTimeout(() => {
      try { ws.close() } catch { /* ignore */ }
      reject(new Error(`CDP 调用超时（${method}）`))
    }, 15000)
    const id = Math.floor(Math.random() * 1e9)
    const onMessage = (event) => {
      let msg
      try { msg = JSON.parse(String(event.data)) } catch { return }
      if (msg?.id !== id) return
      clearTimeout(timeout)
      if (msg.error) {
        reject(new Error(`CDP ${method} 错误：${msg.error.message ?? JSON.stringify(msg.error)}`))
        return
      }
      resolve(msg.result)
    }
    ws.onmessage = onMessage
    ws.onopen = () => {
      ws.send(JSON.stringify({ id, method, params: params ?? {} }))
    }
    ws.onerror = (e) => {
      clearTimeout(timeout)
      reject(new Error(`CDP WebSocket 错误：${e?.message ?? '连接失败'}`))
    }
  })
}

/**
 * 用 HTTP 接口 http://127.0.0.1:<port>/json/list 拿一个可用页面 target 的 ws URL。
 * 优先选有 url 且非 devtools 的页面；拿不到就退回浏览器级 target。
 */
async function findPageWs(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`CDP HTTP 端口返回 ${res.status}`)
  const list = await res.json()
  if (!Array.isArray(list) || list.length === 0) throw new Error('CDP 端口没有任何页面 target')
  // 优先普通 page，且不要扩展/后台页 target。
  const page =
    list.find((t) => t.type === 'page' && !/^chrome-extension:|\/background/.test(String(t.url ?? '')) && t.webSocketDebuggerUrl) ||
    list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ||
    list.find((t) => t.webSocketDebuggerUrl)
  if (!page) throw new Error('CDP 端口可连但没有可用的页面 target')
  return page.webSocketDebuggerUrl
}

/** 从 /json/version 探测端口是否活着、并拿到浏览器级 ws（用于 Network.getAllCookies）。 */
async function probePort(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`端口 ${port} 返回 ${res.status}，浏览器调试端口可能没开对`)
  const data = await res.json()
  return { ws: data.webSocketDebuggerUrl, browser: data.Browser }
}

/* ------------------------------------------------------------------ *
 * 自主拉起 headless 浏览器（aiyayi_cdp 找不到现成端口时用）。
 * ------------------------------------------------------------------ */

/** Windows 上常见的 Chrome/Edge 可执行路径，按命中顺序探测。 */
const WIN_BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
/** 非 Windows 的常见路径（macOS/Linux，尽力尝试）。 */
const POSIX_BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]

/** 找一个系统里实际存在的浏览器可执行文件路径。 */
function findBrowser() {
  const candidates = platform() === 'win32' ? WIN_BROWSER_CANDIDATES : POSIX_BROWSER_CANDIDATES
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch { /* ignore */ }
  }
  return null
}

/** 当前由本工具自主拉起、还活着的浏览器进程（避免泄漏）。 */
const managedProcs = new Set()

/** 独立一次拉起 headless 浏览器，返回 { url（http 端口探测地址）, cleanup }。 */
async function launchHeadless(port) {
  const browser = findBrowser()
  if (!browser) throw new Error('没找到系统 Chrome/Edge，无法自主拉起 headless 浏览器')
  // 独立 user-data-dir，避免影响用户日常浏览器、避免配置目录开调试端口被拒。
  const userDataDir = mkdtempSync(join(tmpdir(), 'dsh-aiyayi-browser-'))
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDataDir,
    'about:blank',
  ]
  const proc = spawn(browser, args, { stdio: 'ignore' })
  managedProcs.add(proc)
  // 轮询直到调试端口就绪。
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null && proc.exitCode !== undefined) {
      throw new Error(`浏览器进程启动即退出（code ${proc.exitCode}）`)
    }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) {
        const cleanup = () => {
          managedProcs.delete(proc)
          try { proc.kill() } catch { /* ignore */ }
          try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
        }
        // 进程自然退出时清 user-data-dir。
        proc.on('exit', () => { try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ } })
        return { cleanup, browser }
      }
    } catch { /* 没就绪，继续等 */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  try { proc.kill() } catch { /* ignore */ }
  throw new Error(`超时等不到 headless 浏览器调试端口 ${port} 就绪`)
}

/** 所有自主拉起的浏览器进程在模块卸载时一并清理。 */
function cleanupAll() {
  for (const proc of managedProcs) { try { proc.kill() } catch { /* ignore */ } }
  managedProcs.clear()
}

/**
 * 注册 aiyayi_fetch。
 * 参数：url（必填）、maxBody（可选，默认 20000）、retries（可选，默认 2）。
 */
const registerFetch = (ctx) =>
  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'aiyayi_fetch',
        description:
          '直接抓取一个网页 URL，返回状态码 + 页面正文（文本）。你自己带着浏览器 UA、有超时和重试，是替代 web_fetch 的内置联网工具。适合抓静态页面、API 返回、HTML 文档的正文。动态渲染（JS 后才出现内容）或需要登录态（httpOnly Cookie）的页面用 aiyayi_cdp 走 CDP 接管浏览器。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', description: '要抓的完整 URL，例如 https://example.com/page' },
            maxBody: { type: 'integer', description: '返回正文最大字符数，默认 20000' },
            retries: { type: 'integer', description: '失败重试次数，默认 2' },
          },
          required: ['url'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: { type: 'integer' },
              ok: { type: 'boolean' },
              body: { type: 'string' },
              finalUrl: { type: 'string' },
            },
            required: ['status', 'ok', 'body'],
          },
          render: (_args, value) =>
            TEXT_BLOCK(
              `抓取结果：HTTP ${value.status}${value.ok ? '' : '（异常）'}，来源 ${value.finalUrl || '未知'}，正文 ${value.body?.length ?? 0} 字符。\n--- 正文 ---\n${value.body ?? ''}`,
            ),
        },
        async execute(args) {
          const url = String(args?.url ?? '').trim()
          if (!/^https?:\/\//i.test(url)) throw new Error('需要完整 http(s) URL')
          const maxBody = Number.isInteger(args?.maxBody) && args.maxBody > 0 ? Math.min(args.maxBody, 100000) : MAX_BODY
          let retries = Number.isInteger(args?.retries) && args.retries >= 0 ? Math.min(args.retries, 3) : 2
          let lastErr = null
          let finalUrl = url
          while (retries >= 0) {
            try {
              const res = await fetch(url, {
                signal: AbortSignal.timeout(15000),
                redirect: 'follow',
                headers: {
                  'user-agent': DEFAULT_UA,
                  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
                  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
                },
              })
              finalUrl = res.url || url
              const text = await res.text()
              return {
                status: res.status,
                ok: res.ok,
                body: tidy(truncate(text, maxBody)),
                finalUrl,
              }
            } catch (e) {
              lastErr = e
              retries -= 1
              if (retries < 0) break
              await new Promise((r) => setTimeout(r, 300))
            }
          }
          throw new Error(`aiyayi_fetch 抓取失败：${lastErr?.message ?? lastErr}`)
        },
      }),
    'aiyayi-net.aiyayi_fetch()',
  )

/**
 * 注册 aiyayi_cdp。
 * 参数：port（可选，默认 9222）、action=eval / navigate / cookies / navigate_eval。
 */
const registerCdp = (ctx) =>
  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'aiyayi_cdp',
        description:
          '通过 CDP（Chrome DevTools Protocol）拿动态渲染后的页面内容或 Cookie。若探测到用户已开的 --remote-debugging-port 浏览器就接管它（保留登录态）；若没有，会自动 spawn 一个 headless 浏览器（--headless=new）抓取，抓完即关。可访问已启动浏览器的页面、执行 JS提取渲染后内容（比 aiyayi_fetch 更能抓 JS 动态页面），需要登录态时接管用户浏览器抓 httpOnly Cookie。你连接用裸 WebSocket（node 内建），零外置依赖。action：navigate_eval=跳 URL 再取正文（最常用）；navigate=只跳转；eval=在当前页执行 JS 取结果；cookies=拿 Cookie（含 httpOnly，可过滤 domain）。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ['eval', 'navigate', 'navigate_eval', 'cookies'], description: '要做什么。' },
            port: { type: 'integer', description: 'CDP 端口，默认 9222；没有现成端口时会另找空闲端口自动拉起 headless。' },
            auto_launch: { type: 'boolean', description: '是否允许在没找到现成调试端口时自动拉起 headless 浏览器，默认 true。设为 false 则只接管用户已开的调试浏览器。' },
            url: { type: 'string', description: 'navigate / navigate_eval 用：要打开的 URL。' },
            expression: { type: 'string', description: 'eval 用：要在页面上下文执行的 JS 表达式（应返回可 JSON 序列化的值，如 document.title / document.body.innerText）。' },
            domain: { type: 'string', description: 'cookies 用：只返回该域名（或与该域匹配）的 Cookie；省略返回全部。' },
            titleAndText: { type: 'boolean', description: 'navigate_eval 用：额外返回页面 title（默认已含）。' },
          },
          required: ['action'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string' },
              result: {},
            },
            required: ['action', 'result'],
          },
          render: (_args, value) => {
            const r = value?.result ?? {}
            const lines = []
            if (typeof r.text === 'string' && r.text) lines.push(`--- 页面正文 ---\n${r.text}`)
            else if (typeof r.value === 'string' && r.value) lines.push(`--- 结果 ---\n${r.value}`)
            else if (r.value !== undefined && typeof r.value !== 'string') lines.push(`--- 结果 ---\n${JSON.stringify(r.value, null, 2)}`)
            if (typeof r.cookies === 'string' && r.cookies) lines.push(`--- Cookie（${r.count ?? '?'} 条）---\n${r.cookies}`)
            if (Number.isInteger(r.count) && !lines.length) lines.push(`共 ${r.count} 条（结构见返回）。`)
            return TEXT_BLOCK(`CDP ${value?.action ?? ''}：${lines.length ? '\n' + lines.join('\n\n') : JSON.stringify(r)}`)
          },
        },
        async execute(args) {
          const action = args?.action
          const port = Number.isInteger(args?.port) && args.port > 0 ? args.port : 9222
          const autoLaunch = args?.auto_launch !== false

          // 先探测指定端口是否已有浏览器；没有且允许自动拉起，就 spawn 一个 headless。
          // 若自动拉起成功，后续一切要用它的端口（同一个 headless 实例）。
          let launched = null
          let livePort = port
          if (autoLaunch) {
            let open = false
            try {
              await probePort(port)
              open = true
            } catch { open = false }
            if (!open) {
              // 换个空闲端口拉起（避开占用的 9222）。
              for (let p = port; p < port + 20; p++) {
                try { await probePort(p); continue } catch { /* 空闲 */ }
                try {
                  launched = await launchHeadless(p)
                  livePort = p
                  break
                } catch {
                  /* 换下一个端口重试 */
                }
              }
              if (!launched) throw new Error(`无法自主拉起 headless 浏览器（指定端口 ${port} 不可用）`)
            }
          }

          try {
            if (action === 'cookies') {
              const { ws } = await probePort(livePort)
              const { cookies } = await cdpCall(ws, 'Network.getAllCookies')
              const list = Array.isArray(cookies) ? cookies : []
              const domain = String(args?.domain ?? '').toLowerCase()
              const filtered = domain
                ? list.filter((c) => {
                    const d = String(c?.domain ?? '').toLowerCase()
                    return d === domain || d === `.${domain}` || d.endsWith(`.${domain}`)
                  })
                : list
              const plain = filtered.map((c) => ({
                name: c?.name,
                value: c?.value,
                domain: c?.domain,
                httpOnly: !!c?.httpOnly,
                path: c?.path,
              }))
              return { action, result: { count: plain.length, cookies: truncate(JSON.stringify(plain, null, 2), MAX_CDP_RESULT), autoLaunched: !!launched } }
            }

            // eval / navigate / navigate_eval：需要连到某个 page target 的 ws。
            const pageWs = await findPageWs(livePort)

            if (action === 'navigate') {
              const url = String(args?.url ?? '').trim()
              if (!/^https?:\/\//i.test(url)) throw new Error('navigate 需要完整 http(s) URL')
              await cdpCall(pageWs, 'Page.navigate', { url })
              if (launched) await new Promise((r) => setTimeout(r, 3000))
              return { action, result: { status: 'navigated', url, autoLaunched: !!launched } }
            }

            if (action === 'eval') {
              const expr = String(args?.expression ?? '').trim()
              if (!expr) throw new Error('eval 需要一个 expression（要执行的 JS）')
              try { await cdpCall(pageWs, 'Runtime.enable') } catch { /* 幂等 */ }
              const r = await cdpCall(pageWs, 'Runtime.evaluate', {
                expression: expr,
                returnByValue: true,
                awaitPromise: true,
              })
              if (r?.exceptionDetails) {
                throw new Error(`页面内 JS 抛错：${r.exceptionDetails.text ?? '未知'}`)
              }
              const value = r?.result?.value
              return { action, result: { value: typeof value === 'string' ? tidy(truncate(value, MAX_CDP_RESULT)) : value, autoLaunched: !!launched } }
            }

            if (action === 'navigate_eval') {
              const url = String(args?.url ?? '').trim()
              if (!/^https?:\/\//i.test(url)) throw new Error('navigate_eval 需要完整 http(s) URL')
              await cdpCall(pageWs, 'Page.enable').catch(() => {})
              await cdpCall(pageWs, 'Page.navigate', { url })
              // 等网络空闲近似：固定延时 + DOM ready 探测。
              await new Promise((r) => setTimeout(r, 3500))
              try { await cdpCall(pageWs, 'Runtime.enable') } catch { /* 幂等 */ }
              const r = await cdpCall(pageWs, 'Runtime.evaluate', {
                expression: `({title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 40000) : ''})`,
                returnByValue: true,
              })
              const { title, url: finalUrl, text } = r?.result?.value ?? {}
              return {
                action,
                result: {
                  title,
                  url: finalUrl,
                  text: tidy(truncate(text, MAX_CDP_RESULT)),
                  autoLaunched: !!launched,
                },
              }
            }

            throw new Error(`未知 action "${String(action)}"，可用：eval / navigate / navigate_eval / cookies`)
          } finally {
            // 自主拉起的 headless 用完即关，不残留。
            if (launched) launched.cleanup()
          }
        },
      }),
    'aiyayi-net.aiyayi_cdp()',
  )

/**
 * 注册两个联网工具到作用域。只在 aiyayi-worker 预设挂载（小伙伴）；本体不挂。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  registerOwnTool('aiyayi_fetch')
  registerOwnTool('aiyayi_cdp')
  registerFetch(ctx)
  registerCdp(ctx)
  // 模块卸载时清理所有自主拉起的浏览器进程（防御性兜底）。
  // ctx.effect(setup, label)：setup 立即执行，其返回值作为 dispose 时调用的清理函数。
  ctx.effect(() => () => cleanupAll(), 'aiyayi-net.cleanup()')
}