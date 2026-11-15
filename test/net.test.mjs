/**
 * aiyayi-net 测试（1.8）：aiyayi_fetch / aiyayi_cdp 的 schema 闸 + 网络层行为 + 参数校验。
 *
 * 为什么要有这个文件：`lib/net.js`（477 行）注册 `aiyayi_fetch` 和 `aiyayi_cdp`，
 * 是小伙伴的唯一联网通道，之前零测试覆盖；现有 tools-surface schema 闸只加载
 * index.js + presence.js，够不着它。
 *
 * **本项目不打真实网络。** 全部用 stub：
 *  - `globalThis.fetch` 临时替换成可编程的假 fetch（照 test/weixin-send.test.mjs 的写法）。
 *    被测代码里写的是裸 `fetch(...)`，运行时解析到 globalThis，所以能拦得住。
 *  - `globalThis.WebSocket` 临时替换成假 WebSocket（只做 JSON-RPC 应答，不连端口）。
 *  - `aiyayi_cdp` 一律传 `auto_launch: false`——默认 true 会在探不到端口时
 *    **真去 spawn headless 浏览器**，测试里绝不能走那条路。
 *
 * 覆盖：
 *  - schema 闸：两个工具名、参数 schema（含 action 的 enum）、output.schema、render、own-tools 放行；
 *  - aiyayi_fetch：UA/accept 头、默认 20000 与上限 100000 的正文截断（保头尾）、
 *    tidy 清洗（控制符/CRLF/空行折叠）、非 200 不抛错但 ok=false、
 *    重定向取 res.url 作为 finalUrl、重试次数（默认 2 次共 3 试、上限 3、0 表示不重试）、
 *    超时/网络错误重试耗尽后的报错、URL 协议校验、超时 signal 真的传给了 fetch；
 *  - aiyayi_cdp：action 缺省/未知、port 默认 9222、auto_launch:false 时**不探测**端口、
 *    navigate/eval/navigate_eval 的必填参数校验、cookies 的按域名过滤 + 结果截断、
 *    eval 的返回值清洗与页面内 JS 抛错、WebSocket 建不起来时的报错文案；
 *  - aiyayi_cdp 需要真实 CDP 端点才能验的部分（真导航、真取渲染后 DOM、真 Cookie），
 *    本测试**只验参数与错误分支**，不连任何端口。
 *
 * 跑法：node --test test/net.test.mjs（可单跑，不依赖其他测试文件）
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const { apply, name: moduleName, inject } = await import(libUrl('net.js'))
const { isOwnTool } = await import(libUrl('own-tools.js'))

/* ================================================================== *
 * 假 ctx（照 tools-surface 的写法）
 * ================================================================== */

const toolDefs = []
const makeCtx = () => ({
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  tools: {
    register(def) {
      toolDefs.push(def)
      return () => {}
    },
  },
})

const returnedDisposers = []
apply({
  effect(fn) {
    const dispose = fn()
    returnedDisposers.push(typeof dispose === 'function' ? dispose : () => {})
    return () => {}
  },
  tools: {
    register(def) {
      toolDefs.push(def)
      return () => {}
    },
  },
})

const fetchTool = toolDefs.find((def) => def.name === 'aiyayi_fetch')
const cdpTool = toolDefs.find((def) => def.name === 'aiyayi_cdp')

/* ================================================================== *
 * stub 工具
 * ================================================================== */

/** 替换 globalThis.fetch，记录每次调用；handler 决定返回/抛错。 */
function stubFetch(t, handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), init }
    calls.push(call)
    return handler(call)
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

/** 造一个"够用"的 Response：被测代码只读 status/ok/url/text()。 */
function fakeResponse({ body = '', status = 200, url = '' } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    text: async () => body,
  }
}

/** 替换 globalThis.WebSocket：按 JSON-RPC 方法名回包，不连任何端口。 */
function stubWebSocket(t, responder) {
  const original = globalThis.WebSocket
  const connections = []

  class FakeWebSocket {
    constructor(url) {
      this.url = url
      this.sent = []
      this.closed = false
      connections.push(this)
      setTimeout(() => this.onopen?.(), 0)
    }

    send(payload) {
      const msg = JSON.parse(payload)
      this.sent.push(msg)
      let reply
      try {
        reply = responder(msg)
      } catch (e) {
        reply = { error: { message: String(e?.message ?? e) } }
      }
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: msg.id, ...reply }) }), 0)
    }

    close() {
      this.closed = true
    }
  }

  globalThis.WebSocket = FakeWebSocket
  t.after(() => {
    globalThis.WebSocket = original
  })
  return connections
}

/** CDP 的 HTTP 侧：/json/version 与 /json/list 给标准形状。 */
function cdpHttpStub(t, { pages = [{ type: 'page', url: 'https://example.test/', webSocketDebuggerUrl: 'ws://stub/page' }] } = {}) {
  return stubFetch(t, ({ url }) => {
    if (url.endsWith('/json/version')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: 'ws://stub/browser', Browser: 'Stub/1.0' }),
      }
    }
    if (url.endsWith('/json/list')) {
      return { status: 200, ok: true, json: async () => pages }
    }
    throw new Error(`测试不该请求这个 URL：${url}`)
  })
}

/* ================================================================== *
 * 一、schema 闸
 * ================================================================== */

test('模块身份：name / inject / 两个工具都注册上', () => {
  assert.equal(moduleName, 'aiyayi-net')
  assert.deepEqual(inject, ['tools'])
  assert.ok(fetchTool, 'apply() 应该注册 aiyayi_fetch')
  assert.ok(cdpTool, 'apply() 应该注册 aiyayi_cdp')
  assert.deepEqual(toolDefs.map((def) => def.name).sort(), ['aiyayi_cdp', 'aiyayi_fetch'])
})

test('schema 闸：aiyayi_fetch 参数与 output.schema 合规', () => {
  const params = fetchTool.parameters
  assert.equal(params.type, 'object')
  assert.equal(params.additionalProperties, false)
  assert.deepEqual(params.required, ['url'])
  assert.deepEqual(Object.keys(params.properties).sort(), ['maxBody', 'retries', 'url'])
  assert.equal(params.properties.url.type, 'string')
  assert.equal(params.properties.maxBody.type, 'integer')
  assert.equal(params.properties.retries.type, 'integer')
  // 坑 #1：required 不能塞进属性里。
  for (const prop of Object.values(params.properties)) assert.equal(prop.required, undefined)

  const schema = fetchTool.output.schema
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false)
  for (const key of schema.required) assert.ok(Object.keys(schema.properties).includes(key), `required 里的 ${key} 不在 properties`)
  assert.deepEqual(schema.required, ['status', 'ok', 'body'])
  assert.equal(typeof fetchTool.output.render, 'function')
})

test('schema 闸：aiyayi_cdp 参数与 output.schema 合规', () => {
  const params = cdpTool.parameters
  assert.equal(params.type, 'object')
  assert.equal(params.additionalProperties, false)
  assert.deepEqual(params.required, ['action'])
  assert.deepEqual(Object.keys(params.properties).sort(), ['action', 'auto_launch', 'domain', 'expression', 'port', 'titleAndText', 'url'])
  // action 是 enum：模型只能从这四种里选，写错要在 schema 层就被拦。
  assert.deepEqual(params.properties.action.enum, ['eval', 'navigate', 'navigate_eval', 'cookies'])
  assert.equal(params.properties.port.type, 'integer')
  assert.equal(params.properties.auto_launch.type, 'boolean')
  assert.equal(params.properties.titleAndText.type, 'boolean')
  for (const prop of Object.values(params.properties)) assert.equal(prop.required, undefined)

  const schema = cdpTool.output.schema
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, ['action', 'result'])
  assert.equal(typeof cdpTool.output.render, 'function')
})

test('own-tools 白名单放行两个联网工具（restrict 不会收掉）', () => {
  assert.equal(isOwnTool('aiyayi_fetch'), true)
  assert.equal(isOwnTool('aiyayi_cdp'), true)
})

test('apply() 注册了卸载清理 effect，重复调用不炸', () => {
  assert.equal(returnedDisposers.length, 3) // fetch + cdp + cleanupAll
  for (const dispose of returnedDisposers) {
    assert.doesNotThrow(() => dispose())
    assert.doesNotThrow(() => dispose())
  }
})

/* ================================================================== *
 * 二、aiyayi_fetch：正常路径
 * ================================================================== */

test('fetch：返回 status/ok/body/finalUrl，并带上浏览器 UA 与 accept 头', async (t) => {
  const calls = stubFetch(t, () => fakeResponse({ body: '<h1>你好</h1>', status: 200 }))
  const out = await fetchTool.execute({ url: 'https://example.test/page' })

  assert.equal(out.status, 200)
  assert.equal(out.ok, true)
  assert.equal(out.body, '<h1>你好</h1>')
  assert.equal(out.finalUrl, 'https://example.test/page')

  const init = calls[0].init
  assert.match(init.headers['user-agent'], /^Mozilla\/5\.0 .*Chrome\/\d+/)
  assert.match(init.headers.accept, /text\/html/)
  assert.match(init.headers['accept-language'], /zh-CN/)
  assert.equal(init.redirect, 'follow')
})

test('fetch：超时 signal 真的传给了 fetch（有界等待，不是裸请求）', async (t) => {
  let seenSignal = null
  stubFetch(t, ({ init }) => {
    seenSignal = init.signal
    return fakeResponse({ body: 'ok' })
  })
  await fetchTool.execute({ url: 'https://example.test/' })
  assert.ok(seenSignal instanceof AbortSignal, '应当把 AbortSignal 传给 fetch')
  assert.equal(seenSignal.aborted, false, '请求开始时 signal 不该已中止')
})

test('fetch：非 200 不抛错，原样返回 status 与 ok=false', async (t) => {
  stubFetch(t, () => fakeResponse({ body: 'Not Found', status: 404 }))
  const out = await fetchTool.execute({ url: 'https://example.test/missing' })
  assert.equal(out.status, 404)
  assert.equal(out.ok, false)
  assert.equal(out.body, 'Not Found')

  const rendered = fetchTool.output.render({}, out)[0].text
  assert.match(rendered, /HTTP 404（异常）/)
  assert.match(rendered, /--- 正文 ---\nNot Found/)
})

test('fetch：重定向被 follow，finalUrl 取响应的最终 URL', async (t) => {
  stubFetch(t, () => fakeResponse({ body: '落地页', url: 'https://example.test/final' }))
  const out = await fetchTool.execute({ url: 'https://example.test/start' })
  assert.equal(out.finalUrl, 'https://example.test/final')
  assert.equal(out.body, '落地页')
})

test('fetch：tidy 清洗 CRLF、控制符、多余空行', async (t) => {
  const messy = '第一行\r\n第二行\u0007\u0000\r\n\r\n\r\n\r\n第三行   \r\n'
  stubFetch(t, () => fakeResponse({ body: messy }))
  const out = await fetchTool.execute({ url: 'https://example.test/' })
  // 控制符去掉、CRLF 归一、3+ 空行压成一个空行，首尾 trim。
  assert.equal(out.body, '第一行\n第二行\n\n第三行')
})

/* ================================================================== *
 * 三、aiyayi_fetch：截断
 * ================================================================== */

test('fetch：默认正文上限 20000（保留头尾，中段省略）', async (t) => {
  const body = `${'A'.repeat(30000)}${'Z'.repeat(30000)}`
  stubFetch(t, () => fakeResponse({ body }))
  const out = await fetchTool.execute({ url: 'https://example.test/big' })
  assert.equal(out.body.length, 20000)
  assert.match(out.body, /…\[中段省略\]…/)
  // 保头尾：开头是 A、结尾是 Z。
  assert.ok(out.body.startsWith('A'))
  assert.ok(out.body.endsWith('Z'))
})

test('fetch：maxBody 生效，且硬上限 100000', async (t) => {
  const body = 'B'.repeat(30000)
  stubFetch(t, () => fakeResponse({ body }))

  const small = await fetchTool.execute({ url: 'https://example.test/', maxBody: 1000 })
  assert.equal(small.body.length, 1000)

  const big = await fetchTool.execute({ url: 'https://example.test/', maxBody: 150000 })
  assert.equal(big.body.length, 30000, '正文比上限短时不该截断')

  const huge = await fetchTool.execute({ url: 'https://example.test/', maxBody: 999999 })
  assert.equal(huge.body.length, 30000)
})

test('fetch：maxBody 传 0/负数/非整数时回落默认 20000', async (t) => {
  stubFetch(t, () => fakeResponse({ body: 'C'.repeat(50000) }))
  for (const bad of [0, -1, '500', 2.5]) {
    const out = await fetchTool.execute({ url: 'https://example.test/', maxBody: bad })
    assert.equal(out.body.length, 20000, `maxBody=${bad} 应回落默认值`)
  }
})

/* ================================================================== *
 * 四、aiyayi_fetch：失败与重试
 * ================================================================== */

test('fetch：URL 协议校验（只认 http/https 完整 URL）', async (t) => {
  const calls = stubFetch(t, () => fakeResponse({ body: '不该走到这里' }))
  for (const bad of ['', '   ', 'example.com', 'ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)']) {
    await assert.rejects(() => fetchTool.execute({ url: bad }), /需要完整 http\(s\) URL/, `应当拒绝：${bad}`)
  }
  assert.equal(calls.length, 0, '非法 URL 不该发起任何请求')
})

test('fetch：默认重试 2 次（总共 3 次尝试）后抛错', async (t) => {
  const calls = stubFetch(t, () => {
    throw new Error('模拟网络中断')
  })
  await assert.rejects(() => fetchTool.execute({ url: 'https://example.test/' }), /aiyayi_fetch 抓取失败：模拟网络中断/)
  assert.equal(calls.length, 3)
})

test('fetch：retries:0 只试一次；retries 上限 3（最多 4 次）', async (t) => {
  let calls = stubFetch(t, () => {
    throw new Error('断网')
  })
  await assert.rejects(() => fetchTool.execute({ url: 'https://example.test/', retries: 0 }))
  assert.equal(calls.length, 1, 'retries:0 不该重试')

  calls = stubFetch(t, () => {
    throw new Error('断网')
  })
  await assert.rejects(() => fetchTool.execute({ url: 'https://example.test/', retries: 99 }))
  assert.equal(calls.length, 4, 'retries 应被夹到 3')
})

test('fetch：超时中止（AbortError）会被重试，耗尽后报错里带原始原因', async (t) => {
  const calls = stubFetch(t, () => {
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    throw err
  })
  await assert.rejects(
    () => fetchTool.execute({ url: 'https://example.test/slow', retries: 1 }),
    /抓取失败：The operation was aborted due to timeout/,
  )
  assert.equal(calls.length, 2)
})

test('fetch：中途恢复则不抛错（重试真的有用）', async (t) => {
  let n = 0
  const calls = stubFetch(t, () => {
    n += 1
    if (n === 1) throw new Error('第一次失败')
    return fakeResponse({ body: '第二次成功' })
  })
  const out = await fetchTool.execute({ url: 'https://example.test/', retries: 1 })
  assert.equal(out.body, '第二次成功')
  assert.equal(calls.length, 2)
})

/* ================================================================== *
 * 五、aiyayi_cdp：schema 之外可测的参数与错误分支
 * （需要真实 CDP 端点才能验的部分不在这里，见文件头）
 * ================================================================== */

test('cdp：auto_launch:false 时只探测页面 target，不探测端口、不拉起浏览器', async (t) => {
  const calls = cdpHttpStub(t)
  stubWebSocket(t, () => ({ result: {} }))

  await cdpTool.execute({ action: 'navigate', url: 'https://example.test/', port: 9333, auto_launch: false })
  // 只应有 /json/list，没有 /json/version（那条是"端口活着吗"的探测）。
  assert.deepEqual(calls.map((c) => c.url), ['http://127.0.0.1:9333/json/list'])
})

test('cdp：port 默认 9222', async (t) => {
  const calls = cdpHttpStub(t)
  stubWebSocket(t, () => ({ result: {} }))
  await cdpTool.execute({ action: 'navigate', url: 'https://example.test/', auto_launch: false })
  assert.equal(calls[0].url, 'http://127.0.0.1:9222/json/list')
})

test('cdp：navigate / navigate_eval 只接受完整 http(s) URL', async (t) => {
  cdpHttpStub(t)
  stubWebSocket(t, () => ({ result: {} }))

  await assert.rejects(() => cdpTool.execute({ action: 'navigate', url: 'example.com', auto_launch: false }), /navigate 需要完整 http\(s\) URL/)
  await assert.rejects(() => cdpTool.execute({ action: 'navigate', url: 'file:///etc/passwd', auto_launch: false }), /navigate 需要完整 http\(s\) URL/)
  await assert.rejects(() => cdpTool.execute({ action: 'navigate_eval', url: '', auto_launch: false }), /navigate_eval 需要完整 http\(s\) URL/)
})

test('cdp：eval 必须有 expression；未知 action 报可用清单', async (t) => {
  cdpHttpStub(t)
  stubWebSocket(t, () => ({ result: {} }))

  await assert.rejects(() => cdpTool.execute({ action: 'eval', auto_launch: false }), /eval 需要一个 expression（要执行的 JS）/)
  await assert.rejects(() => cdpTool.execute({ action: 'eval', expression: '   ', auto_launch: false }), /eval 需要一个 expression/)
  await assert.rejects(() => cdpTool.execute({ action: '截图', auto_launch: false }), /未知 action "截图"，可用：eval \/ navigate \/ navigate_eval \/ cookies/)
})

test('cdp：页面 target 列表为空 / 全是无 ws 的条目时报错', async (t) => {
  cdpHttpStub(t, { pages: [] })
  await assert.rejects(() => cdpTool.execute({ action: 'navigate', url: 'https://example.test/', auto_launch: false }), /CDP 端口没有任何页面 target/)

  cdpHttpStub(t, { pages: [{ type: 'page', url: 'https://example.test/' }] })
  await assert.rejects(() => cdpTool.execute({ action: 'navigate', url: 'https://example.test/', auto_launch: false }), /可连但没有可用的页面 target/)
})

test('cdp：优先选普通 page，跳过扩展/后台页 target', async (t) => {
  cdpHttpStub(t, {
    pages: [
      { type: 'page', url: 'chrome-extension://abc/panel.html', webSocketDebuggerUrl: 'ws://stub/extension' },
      { type: 'page', url: 'https://example.test/background', webSocketDebuggerUrl: 'ws://stub/background' },
      { type: 'page', url: 'https://example.test/real', webSocketDebuggerUrl: 'ws://stub/real' },
    ],
  })
  const connections = stubWebSocket(t, () => ({ result: {} }))
  await cdpTool.execute({ action: 'navigate', url: 'https://example.test/', auto_launch: false })
  assert.equal(connections.length, 1)
  assert.equal(connections[0].url, 'ws://stub/real')
})

test('cdp：navigate 成功后返回 navigated + 目标 URL', async (t) => {
  cdpHttpStub(t)
  const connections = stubWebSocket(t, (msg) => {
    assert.equal(msg.method, 'Page.navigate')
    assert.deepEqual(msg.params, { url: 'https://example.test/target' })
    return { result: { frameId: 'F1' } }
  })
  const out = await cdpTool.execute({ action: 'navigate', url: 'https://example.test/target', auto_launch: false })
  assert.equal(out.action, 'navigate')
  assert.equal(out.result.status, 'navigated')
  assert.equal(out.result.url, 'https://example.test/target')
  assert.equal(out.result.autoLaunched, false)
  assert.equal(connections.length, 1)
})

test('cdp：eval 的字符串返回值会 tidy + 截断', async (t) => {
  cdpHttpStub(t)
  stubWebSocket(t, (msg) => {
    if (msg.method === 'Runtime.evaluate') {
      return { result: { result: { value: '  标题\u0007\r\n\r\n\r\n正文  ' } } }
    }
    return { result: {} }
  })
  const out = await cdpTool.execute({ action: 'eval', expression: 'document.title', auto_launch: false })
  assert.equal(out.result.value, '标题\n\n正文')

  // render 把字符串结果放"--- 结果 ---"块里。
  const rendered = cdpTool.output.render({}, out)[0].text
  assert.match(rendered, /CDP eval：/)
  assert.match(rendered, /--- 结果 ---\n标题/)
})

test('cdp：eval 超过 12000 字符会被截断', async (t) => {
  cdpHttpStub(t)
  stubWebSocket(t, (msg) =>
    msg.method === 'Runtime.evaluate' ? { result: { result: { value: 'X'.repeat(20000) } } } : { result: {} },
  )
  const out = await cdpTool.execute({ action: 'eval', expression: 'document.body.innerText', auto_launch: false })
  assert.equal(out.result.value.length, 12000)
  assert.match(out.result.value, /中段省略/)
})

test('cdp：页面内 JS 抛错时转成可读报错（不把裸 CDP 结构透给模型）', async (t) => {
  cdpHttpStub(t)
  stubWebSocket(t, (msg) =>
    msg.method === 'Runtime.evaluate'
      ? { result: { exceptionDetails: { text: 'Uncaught TypeError: x is undefined' } } }
      : { result: {} },
  )
  await assert.rejects(
    () => cdpTool.execute({ action: 'eval', expression: 'x.y', auto_launch: false }),
    /页面内 JS 抛错：Uncaught TypeError: x is undefined/,
  )
})

test('cdp：CDP 协议返回 error 时转成可读报错', async (t) => {
  cdpHttpStub(t)
  stubWebSocket(t, () => ({ error: { message: 'Target closed' } }))
  await assert.rejects(
    () => cdpTool.execute({ action: 'navigate', url: 'https://example.test/', auto_launch: false }),
    /CDP Page\.navigate 错误：Target closed/,
  )
})

test('cdp：cookies 按域名过滤（精确 / 点号前缀 / 子域都算）', async (t) => {
  stubFetch(t, () => ({
    status: 200,
    ok: true,
    json: async () => ({ webSocketDebuggerUrl: 'ws://stub/browser', Browser: 'Stub/1.0' }),
  }))
  stubWebSocket(t, (msg) => {
    assert.equal(msg.method, 'Network.getAllCookies')
    return {
      result: {
        cookies: [
          { name: 'a', value: '1', domain: 'example.com', path: '/', httpOnly: false },
          { name: 'b', value: '2', domain: '.example.com', path: '/', httpOnly: true },
          { name: 'c', value: '3', domain: 'sub.example.com', path: '/', httpOnly: true },
          { name: 'd', value: '4', domain: 'other.com', path: '/', httpOnly: false },
        ],
      },
    }
  })

  const out = await cdpTool.execute({ action: 'cookies', domain: 'example.com', auto_launch: false })
  assert.equal(out.action, 'cookies')
  assert.equal(out.result.count, 3)
  const parsed = JSON.parse(out.result.cookies)
  assert.deepEqual(parsed.map((c) => c.name), ['a', 'b', 'c'])
  // httpOnly 要如实标出来（这是"接管浏览器抓登录态"的关键信息）。
  assert.equal(parsed.find((c) => c.name === 'b').httpOnly, true)

  const all = await cdpTool.execute({ action: 'cookies', auto_launch: false })
  assert.equal(all.result.count, 4)
})

test('cdp：cookies 结果超过 12000 字符会被截断', async (t) => {
  stubFetch(t, () => ({
    status: 200,
    ok: true,
    json: async () => ({ webSocketDebuggerUrl: 'ws://stub/browser', Browser: 'Stub/1.0' }),
  }))
  stubWebSocket(t, () => ({
    result: {
      cookies: Array.from({ length: 400 }, (_, i) => ({
        name: `cookie_${i}`,
        value: 'v'.repeat(60),
        domain: 'example.com',
        path: '/',
        httpOnly: true,
      })),
    },
  }))
  const out = await cdpTool.execute({ action: 'cookies', auto_launch: false })
  assert.equal(out.result.count, 400)
  assert.equal(out.result.cookies.length, 12000)
  assert.match(out.result.cookies, /中段省略/)
})

test('cdp：探不到调试端口时如实报错（auto_launch:false 下不偷偷拉起浏览器）', async (t) => {
  // 模拟端口没人监听：/json/version 的 fetch 直接抛。
  stubFetch(t, () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:9222')
    throw err
  })
  await assert.rejects(
    () => cdpTool.execute({ action: 'cookies', auto_launch: false }),
    /ECONNREFUSED/,
  )
})

test('cdp：HTTP 端口返回非 200 时给出"端口可能没开对"的提示', async (t) => {
  stubFetch(t, () => ({ status: 403, ok: false, json: async () => ({}) }))
  await assert.rejects(
    () => cdpTool.execute({ action: 'cookies', auto_launch: false }),
    /端口 9222 返回 403，浏览器调试端口可能没开对/,
  )
})

test('cdp：WebSocket 建不起来时报错清晰（不挂死）', async (t) => {
  stubFetch(t, () => ({
    status: 200,
    ok: true,
    json: async () => ({ webSocketDebuggerUrl: 'ws://stub/browser', Browser: 'Stub/1.0' }),
  }))
  const original = globalThis.WebSocket
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('WebSocket 不可用')
    }
  }
  t.after(() => {
    globalThis.WebSocket = original
  })
  await assert.rejects(
    () => cdpTool.execute({ action: 'cookies', auto_launch: false }),
    /无法创建 WebSocket 连接：WebSocket 不可用/,
  )
})

test('cdp：render 对不同结果形状给出可读文本', () => {
  const withText = cdpTool.output.render({}, { action: 'navigate_eval', result: { title: 'T', url: 'u', text: '正文' } })[0].text
  assert.match(withText, /CDP navigate_eval：/)
  assert.match(withText, /--- 页面正文 ---\n正文/)

  const withObject = cdpTool.output.render({}, { action: 'eval', result: { value: { a: 1 } } })[0].text
  assert.match(withObject, /--- 结果 ---/)
  assert.match(withObject, /"a": 1/)

  const onlyCount = cdpTool.output.render({}, { action: 'cookies', result: { count: 0 } })[0].text
  assert.match(onlyCount, /共 0 条/)
})

/*
 * 没测的部分（需要真实 CDP 端点，本测试刻意不连）：
 *  - navigate / navigate_eval 的**真导航**与渲染后 DOM 提取（要真 Chrome + 网络）；
 *  - cookies 的**真** Network.getAllCookies（上面用假 WebSocket 只验过滤与截断逻辑）；
 *  - auto_launch 的自动拉起 headless（会 spawn 真实浏览器进程，测试里禁用）；
 *  - cdpCall 的 15 秒超时（真要等 15 秒，不划算；错误分支已用协议 error 覆盖）。
 */
