/**
 * 坑 13 回归测试：**Cordis ctx 是 Proxy，读未 inject 的属性会直接抛错**。
 *
 * 2026-11-11 首次开启微信通道时踩到：
 *   poll.js:78 / send.js:53 / login.js:64 写的是 `ctx?.weixinLogger ?? ctx?.logger`，
 *   但 `lib/weixin.js` 的 inject 里没有 `weixinLogger`。Cordis 的 ctx 是 Proxy，
 *   取未声明注入的属性会**抛异常，可选链 `?.` 拦不住**（它只拦 null/undefined，
 *   拦不住 getter 抛错）。结果：通道装配成功、打出「已就绪」，1 毫秒后长轮询
 *   第一行就炸，整条通道静默死亡：
 *     Error: cannot get property "weixinLogger" without inject
 *
 * 为什么原有测试没抓到：weixin-*.test.mjs 里的 ctx 都是**普通对象**
 * （`{ logger }`），读未知属性只得到 undefined，被 `?? ctx.logger` 兜住了。
 * 所以本文件刻意用**会抛错的 Proxy** 当 ctx —— 这才是宿主的真实行为。
 *
 * 钉死两条：
 *   1. 静态：三处源码不得再出现 `weixinLogger`（以及任何绕开 ctx.logger 的别名读法）
 *   2. 行为：用抛错 Proxy 当 ctx，pollLoop / sendText / loginWithQr 三条真实路径
 *      都必须能正常跑完（证明装配路径不碰任何未 inject 的属性）
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { inject } from '../lib/weixin.js'
import { ensureWeixinDirs, loadCredential } from '../lib/weixin/accounts.js'
import { loginWithQr } from '../lib/weixin/login.js'
import { pollLoop } from '../lib/weixin/poll.js'
import { sendText } from '../lib/weixin/send.js'

const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aiyayi-weixin-ctx-'))
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

/**
 * 造一个**行为对齐 Cordis** 的 ctx：
 *   - 读 `logger` 或 inject 里声明的服务 → 正常返回
 *   - 读**任何其它属性** → 抛错（和 Cordis 的 "cannot get property X without inject" 同义）
 *
 * 这是本文件的核心。别把它换回普通对象，换了就等于把这条测试废掉。
 */
function makeStrictCtx({ injected = inject, extra = {} } = {}) {
  const allowed = new Set(['logger', ...injected, ...Object.keys(extra)])
  const backing = { logger: makeLogger(), ...extra }
  return new Proxy(backing, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (!allowed.has(prop)) {
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      }
      return target[prop]
    },
    has(target, prop) {
      if (typeof prop === 'symbol') return false
      if (!allowed.has(prop)) {
        throw new Error(`cannot check property "${String(prop)}" without inject`)
      }
      return Reflect.has(target, prop)
    },
  })
}

// ─── 1. 静态守卫 ────────────────────────────────────────────────────────────

test('静态：poll/send/login 三处不得再读 weixinLogger（坑 13）', () => {
  for (const file of ['weixin/poll.js', 'weixin/send.js', 'weixin/login.js']) {
    const source = readFileSync(join(LIB_DIR, file), 'utf8')
    assert.ok(
      !source.includes('weixinLogger'),
      `${file} 仍出现 weixinLogger —— ctx 未 inject 该属性，运行时会直接抛错`,
    )
  }
})

test('静态：ctx 上只允许读 ctx.logger 与 inject 声明的服务', () => {
  // 兜底扫描：把 lib/weixin/ 下所有 `ctx.<名字>` 读法收集起来，逐个对照 inject。
  // 只做「反引号/模板字符串里出现 ctx.xxx」这类常见误写的低成本拦截，
  // 真正的把关是下面的行为测试。
  const allowed = new Set(['logger', ...inject])
  const files = ['weixin/index.js', 'weixin/poll.js', 'weixin/send.js', 'weixin/login.js', 'weixin/session.js']
  const offenders = []
  for (const file of files) {
    const source = readFileSync(join(LIB_DIR, file), 'utf8')
    for (const match of source.matchAll(/\bctx\??\.([A-Za-z_$][\w$]*)/g)) {
      const prop = match[1]
      if (!allowed.has(prop) && !['get', 'on', 'effect'].includes(prop)) {
        offenders.push(`${file}: ctx.${prop}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `读了未 inject 的 ctx 属性：\n${offenders.join('\n')}`)
})

test('静态：inject 数组不含 weixinLogger（真要注入得在壳里声明）', () => {
  assert.ok(
    !inject.includes('weixinLogger'),
    'inject 里没有 weixinLogger，所以任何文件都不能读它',
  )
})

// ─── 2. 行为守卫：抛错 Proxy 当 ctx，三条真实路径都要跑通 ────────────────────

test('pollLoop + 严格 ctx：长轮询第一行不再抛错（坑 13 的直接复现点）', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const ctx = makeStrictCtx()
  const controller = new AbortController()

  let polls = 0
  const getUpdatesImpl = async () => {
    polls += 1
    if (polls === 1) {
      return {
        ret: 0,
        msgs: [
          {
            message_id: 'm-1',
            from_user_id: 'user-a',
            item_list: [{ type: 1, text_item: { text: '你好' } }],
          },
        ],
        get_updates_buf: 'buf-1',
      }
    }
    // 第二轮挂住，等 abort
    await new Promise((resolve) => {
      controller.signal.addEventListener('abort', resolve, { once: true })
    })
    const err = new Error('aborted')
    err.weixinAborted = true
    throw err
  }

  const seen = []
  const promise = pollLoop({
    ctx,
    root,
    account: { accountId: 'acc@im.bot', stem: 'acc-im-bot', token: 'tok', baseUrl: 'http://x' },
    signal: controller.signal,
    deps: { getUpdatesImpl },
    onMessages: async (msgs) => {
      seen.push(...msgs.map((m) => m.message_id))
    },
  })

  // 给它足够时间跑完第一轮；若 pollLoop 读非法属性，这里会直接拿到 reject
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(polls >= 2, true, `长轮询应持续推进，实际只打了 ${polls} 轮`)
  assert.deepEqual(seen, ['m-1'], '入站消息应被消费')

  controller.abort()
  const result = await promise
  assert.equal(result.reason, 'aborted')
  // 日志确实通过 ctx.logger 打出来了（证明取到了正确对象）
  assert.ok(ctx.logger.lines.length > 0, '应通过 ctx.logger 留下日志')
})

test('sendText + 严格 ctx：出站链路不读未 inject 属性', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const ctx = makeStrictCtx()

  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ret: 0, message_id: 'srv-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  const result = await sendText({
    ctx,
    root,
    account: {
      accountId: 'acc@im.bot',
      stem: 'acc-im-bot',
      token: 'acc@im.bot:secret',
      baseUrl: 'http://x',
    },
    to: 'user-a',
    text: '收到',
  })

  assert.equal(result.ok, true)
  assert.equal(result.sent, 1)
  assert.ok(
    ctx.logger.lines.some((l) => l.includes('发出回复')),
    `应通过 ctx.logger 记出站日志，实际: ${ctx.logger.lines.join(' | ')}`,
  )
})

test('loginWithQr + 严格 ctx：扫码登录全流程不读未 inject 属性', async (t) => {
  const root = tempRoot(t)
  ensureWeixinDirs(root)
  const ctx = makeStrictCtx()

  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  let statusCalls = 0
  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.includes('get_bot_qrcode')) {
      return new Response(
        JSON.stringify({
          qrcode: 'qr-abc',
          // 官方这里是 URL 而不是图片（坑 4）；renderPng 会把它编码成 QR
          qrcode_img_content: 'https://weixin.qq.com/x/abc',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (href.includes('get_qrcode_status')) {
      statusCalls += 1
      return new Response(
        JSON.stringify({
          status: 'confirmed',
          ilink_bot_id: 'acc@im.bot',
          bot_token: 'bot-token-xyz',
          baseurl: 'https://ilinkai.weixin.qq.com',
          ilink_user_id: 'user@im.wechat',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`未预期的请求: ${href}`)
  }

  const result = await loginWithQr({ ctx, root, stem: 'acc-im-bot', maxMs: 5000 })

  assert.equal(result.ok, true, `登录应成功，实际: ${JSON.stringify(result)}`)
  assert.equal(result.accountId, 'acc@im.bot')
  assert.equal(statusCalls >= 1, true)
  // 凭证落盘
  const credential = loadCredential(root, 'acc-im-bot', 'acc@im.bot')
  assert.equal(credential?.token, 'bot-token-xyz')
  assert.ok(
    ctx.logger.lines.some((l) => l.includes('登录成功')),
    `应通过 ctx.logger 记登录成功，实际: ${ctx.logger.lines.join(' | ')}`,
  )
})

// ─── 3. 反证：普通对象 ctx 会掩盖这个 bug（说明为什么必须用 Proxy） ─────────

test('反证：普通对象 ctx 读未知属性只得到 undefined（这就是当初漏测的原因）', () => {
  const plain = { logger: makeLogger() }
  // 普通对象不抛，`weixinLogger` 得到 undefined → `?? ctx.logger` 兜住 → bug 隐形
  assert.equal(plain.weixinLogger, undefined)
  // 严格 ctx 则直接抛 —— 两相对照，说明本文件的 Proxy 才是有效守卫
  assert.throws(() => makeStrictCtx().weixinLogger, /without inject/)
})
