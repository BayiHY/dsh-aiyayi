/**
 * 炸启动防护的**真实**回归测试（硬性安全要求 1 的落点）。
 *
 * 今天（2026-11-11）吃过炸启动的亏：跨代 peer / 顶层 import 出错会把整个插件激活
 * 打断，宿主直接起不来。所以微信模块必须「能失败而不影响宿主启动」。
 *
 * 这个文件不 mock：它在临时目录里复制一份 lib/weixin.js 壳，配一份**故意坏掉**的
 * ./weixin/index.js，然后真的 import 壳并真的 apply —— 验证：
 *   1. import 壳本身成功（壳不顶层 import 实现）
 *   2. apply() 正常返回、不抛
 *   3. 只产生 warn，且 warn 明确说"不影响宿主与飞书通道"
 *   4. 工具仍注册（可自查），dispose 不抛
 *   5. 各种坏法：语法错误 / 顶层 throw / 缺导出 / 依赖解析失败
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

const SHELL_SOURCE = new URL('../lib/weixin.js', import.meta.url)

function makeCtx() {
  const logs = { info: [], warn: [], error: [] }
  const effects = []
  const registeredTools = []
  return {
    logs,
    effects,
    registeredTools,
    ctx: {
      logger: {
        info: (m) => logs.info.push(String(m)),
        warn: (m) => logs.warn.push(String(m)),
        error: (m) => logs.error.push(String(m)),
        debug: () => {},
      },
      effect(fn, label) {
        effects.push({ fn, label })
        return () => {}
      },
      on() {
        return () => {}
      },
      get(service) {
        if (service === 'tools') {
          return { register: (t) => registeredTools.push(t) }
        }
        return null
      },
    },
  }
}

/**
 * 造一个临时包：lib/weixin.js（照抄壳）+ lib/home.js、lib/own-tools.js 桩
 * + 指定的 lib/weixin/index.js（坏的那份）。
 */
async function buildBrokenPackage(t, brokenIndexSource) {
  const dir = mkdtempSync(join(tmpdir(), 'aiyayi-weixin-broken-'))
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
  })
  mkdirSync(join(dir, 'lib', 'weixin'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'probe', version: '1.5.27' }), 'utf8')

  // 壳照抄（真的那份），确保测的是真实代码路径
  const shellSource = await import('node:fs').then((fs) => fs.readFileSync(SHELL_SOURCE, 'utf8'))
  writeFileSync(join(dir, 'lib', 'weixin.js'), shellSource, 'utf8')

  // 依赖桩：壳只用到 resolveRoot / registerOwnTool
  writeFileSync(
    join(dir, 'lib', 'home.js'),
    `export function resolveRoot() { return { root: ${JSON.stringify(join(dir, 'mem'))} } }\n`,
    'utf8',
  )
  writeFileSync(
    join(dir, 'lib', 'own-tools.js'),
    'export function registerOwnTool(name) { return name }\n',
    'utf8',
  )

  if (brokenIndexSource !== null) {
    writeFileSync(join(dir, 'lib', 'weixin', 'index.js'), brokenIndexSource, 'utf8')
  }
  return { dir, shellUrl: pathToFileURL(join(dir, 'lib', 'weixin.js')).href }
}

const BROKEN_CASES = [
  ['语法错误', 'export function startWeixin( { this is not valid javascript'],
  ['顶层 throw', 'throw new Error("boom at module top level")'],
  ['缺 startWeixin 导出', 'export const something = 1'],
  ['startWeixin 是同步抛错的函数', 'export function startWeixin() { throw new Error("sync init boom") }'],
  [
    'startWeixin 返回 rejected promise',
    'export async function startWeixin() { throw new Error("async init boom") }',
  ],
  [
    '依赖解析失败（import 不存在的包）',
    'import missing from "@tencent/nonexistent-package"\nexport async function startWeixin() { return { ok: true } }',
  ],
  ['空文件', ''],
]

/**
 * 触发 effect（宿主在激活时会调它），并等 bootstrap 落定。
 * apply 只登记 effect，真正启动在 effect 回调里——异步失败必须落成 warn。
 */
async function runEffectAndSettle(effects, settleMs = 300) {
  const dispose = effects[0].fn()
  await new Promise((resolve) => setTimeout(resolve, settleMs))
  return dispose
}

for (const [label, source] of BROKEN_CASES) {
  test(`微信实现坏掉（${label}）时：壳仍可 import、apply 不抛、只 warn`, async (t) => {
    const { shellUrl } = await buildBrokenPackage(t, source)
    // 1) 壳本身必须能 import（证明壳没有顶层 import 实现）
    const shell = await import(shellUrl)
    assert.equal(shell.name, 'aiyayi-weixin')
    assert.equal(typeof shell.apply, 'function')

    // 2) apply 必须同步返回、不抛
    const { ctx, logs, effects } = makeCtx()
    assert.doesNotThrow(() => shell.apply(ctx, { enabled: true, accounts: [] }))

    // 3) 触发 effect（宿主会调），等异步 bootstrap 落定 —— 坏了只能 warn
    const dispose = await runEffectAndSettle(effects)
    assert.equal(logs.error.length, 0, '不该有 error 级日志')
    assert.ok(
      logs.warn.some((l) => l.includes('不影响宿主')),
      `warn 必须明确"不影响宿主与飞书通道"，实际: ${logs.warn.join(' | ')}`,
    )

    // 4) dispose 也不能抛（卸载路径同样要安全）
    assert.equal(effects.length, 1)
    await assert.doesNotReject(async () => {
      await dispose()
    })
  })
}

test('实现模块整个缺失时：壳仍可 import、apply 不抛、只 warn', async (t) => {
  const { shellUrl } = await buildBrokenPackage(t, null) // 不写 index.js
  const shell = await import(shellUrl)
  const { ctx, logs, effects } = makeCtx()
  assert.doesNotThrow(() => shell.apply(ctx, { enabled: true, accounts: [] }))
  const dispose = await runEffectAndSettle(effects)
  assert.equal(logs.error.length, 0)
  assert.ok(logs.warn.some((l) => l.includes('不影响宿主')))
  await assert.doesNotReject(async () => {
    await dispose()
  })
})

test('实现模块坏掉时工具仍注册（能自查，不会连"为什么没开"都问不到）', async (t) => {
  const { shellUrl } = await buildBrokenPackage(t, 'throw new Error("broken")')
  const shell = await import(shellUrl)
  const { ctx, registeredTools, effects } = makeCtx()
  shell.apply(ctx, { enabled: true, accounts: [] })
  await runEffectAndSettle(effects)
  assert.deepEqual(
    registeredTools.map((tool) => tool.name).sort(),
    ['weixin_bind', 'weixin_login', 'weixin_status', 'weixin_unbind'],
  )
  // 未就绪时 status 工具仍能给出可执行答复
  const status = await registeredTools.find((tool) => tool.name === 'weixin_status').execute({}, {})
  assert.equal(status.enabled, false)
  assert.ok(status.howToEnable.includes('enabled: true'))
})

test('飞书通道的代码路径完全没被 import（两通道零耦合）', async () => {
  const fs = await import('node:fs')
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const files = [
    '../lib/weixin.js',
    '../lib/weixin/index.js',
    '../lib/weixin/protocol.js',
    '../lib/weixin/api.js',
    '../lib/weixin/config.js',
    '../lib/weixin/accounts.js',
    '../lib/weixin/poll.js',
    '../lib/weixin/send.js',
    '../lib/weixin/session.js',
    '../lib/weixin/login.js',
    '../lib/weixin/qr.js',
  ]
  for (const rel of files) {
    const source = read(rel)
    assert.ok(!/from\s+['"][^'"]*feishu/.test(source), `${rel} 不该 import feishu`)
    assert.ok(!/from\s+['"]@larksuiteoapi/.test(source), `${rel} 不该 import 飞书 SDK`)
    // 协议层零外部依赖：只允许 node: 内置 + 相对路径 + vendor（CJS require）
    const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const spec of specifiers) {
      assert.ok(
        spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'),
        `${rel} 引入了外部依赖 ${spec}（本插件必须零 peer 依赖）`,
      )
    }
  }
})

test('协议层不 peer 依赖任何 @deepseek-ai / 第三方包（4.9 阶段 4 红线）', async () => {
  const fs = await import('node:fs')
  for (const rel of ['../lib/weixin/protocol.js', '../lib/weixin/api.js', '../lib/weixin/qr.js', '../lib/weixin/poll.js']) {
    const source = fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.ok(!/from\s+['"]@/.test(source), `${rel} 不该 import 任何 @scope 包`)
  }
})
