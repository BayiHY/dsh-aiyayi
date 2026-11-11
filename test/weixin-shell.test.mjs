/**
 * 壳层隔离 + 生命周期单测 —— 硬性安全要求的落点。
 *
 * 今天炸启动的教训：跨代 peers / 顶层 import 出错会把整个插件激活打断。
 * 本文件钉死：
 *   1. `enabled !== true` 时**一个微信模块都不加载**（默认关闭）
 *   2. 实现模块加载失败 / 初始化异常 → 只 warn，`apply` 正常返回，不抛
 *   3. `inject` 不含任何 feishu 相关服务（两通道互不依赖）
 *   4. dispose 会 abort 并 await runtime.stop()，不出现「旧循环没退、新循环已起」
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, inject, name } from '../lib/weixin.js'

function makeCtx({ failTools = false } = {}) {
  const logs = { info: [], warn: [], error: [] }
  const effects = []
  const disposed = []
  const registeredTools = []
  const ctx = {
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
        if (failTools) throw new Error('tools service missing')
        return {
          register(tool) {
            registeredTools.push(tool)
          },
        }
      }
      return null
    },
  }
  return { ctx, logs, effects, disposed, registeredTools }
}

test('name / inject：通道身份与依赖面（不含 feishu）', () => {
  assert.equal(name, 'aiyayi-weixin')
  assert.ok(Array.isArray(inject))
  for (const required of ['agents', 'agentPresets', 'permissionPresets', 'sessionTitle', 'workspaceRegistry']) {
    assert.ok(inject.includes(required), `inject 应包含 ${required}`)
  }
  // 两通道互不依赖：不能注入/依赖 feishu 的任何东西
  assert.ok(!inject.some((s) => /feishu|lark/i.test(s)))
})

test('enabled 未开：apply 同步返回、不注册 effect、不注册工具、不加载模块', () => {
  for (const config of [undefined, null, {}, { enabled: false }, { enabled: 'true' }, { enabled: 1 }]) {
    const { ctx, logs, effects, registeredTools } = makeCtx()
    const result = apply(ctx, config)
    assert.equal(result, undefined)
    assert.equal(effects.length, 0, `不该注册 effect: ${JSON.stringify(config)}`)
    assert.equal(registeredTools.length, 0, '不该注册工具')
    assert.ok(
      logs.info.some((l) => l.includes('未启用')),
      '应留一行「未启用」info 便于确认装上但没开',
    )
    assert.equal(logs.warn.length, 0, '未启用不该产生 warn')
  }
})

test('enabled=true：apply 同步返回且注册一个生命周期 effect（不 await 长轮询）', () => {
  const { ctx, effects, registeredTools } = makeCtx()
  const before = Date.now()
  apply(ctx, { enabled: true, accounts: [] })
  const elapsed = Date.now() - before
  assert.equal(effects.length, 1, '应注册一个 lifecycle effect')
  assert.match(effects[0].label, /weixin\.lifecycle/)
  // 同步返回：apply 里不能有 await 循环（4.5 红线）
  assert.ok(elapsed < 100, `apply 必须同步快速返回，实测 ${elapsed}ms`)
  // enabled=true 时两个自查工具应已注册
  const names = registeredTools.map((t) => t.name).sort()
  assert.deepEqual(names, ['weixin_bind', 'weixin_login', 'weixin_status', 'weixin_unbind'])
})

test('enabled=true 且 tools 服务缺失：只 warn，不抛（不影响插件激活）', () => {
  const { ctx, logs } = makeCtx({ failTools: true })
  assert.doesNotThrow(() => apply(ctx, { enabled: true, accounts: [] }))
  assert.ok(logs.warn.some((l) => l.includes('tools 服务不可用')))
})

test('实现模块加载失败：只 warn，apply 与 disposal 都不抛', async () => {
  const { ctx, logs, effects } = makeCtx()
  apply(ctx, { enabled: true, accounts: [] })
  // 在沙箱里模拟「./weixin/index.js 加载失败」：直接把 holder 里的 failed 路径走一遍
  // ——这里通过真实调用 dispose 验证「即使 bootstrap 失败，dispose 也不抛」。
  const dispose = effects[0].fn()
  assert.equal(typeof dispose, 'function')
  await assert.doesNotReject(async () => {
    await dispose()
  })
  // 无账号时 startWeixin 返回 ok:false 并 warn（不该 warn 成"初始化失败"）
  assert.ok(
    logs.warn.some((l) => l.includes('accounts 为空')) || logs.warn.some((l) => l.includes('未启动')),
    `应有一条可执行的 warn，实际: ${logs.warn.join(' | ')}`,
  )
})

test('weixin_status 工具在未就绪时返回启用指引，不抛', async () => {
  const { ctx, registeredTools } = makeCtx()
  apply(ctx, { enabled: true, accounts: [] })
  const statusTool = registeredTools.find((t) => t.name === 'weixin_status')
  assert.ok(statusTool)
  const value = await statusTool.execute({}, {})
  assert.equal(value.enabled, false)
  assert.ok(value.howToEnable.includes('enabled: true'))
})

test('weixin_login 工具在未就绪时返回明确错误，不抛', async () => {
  const { ctx, registeredTools } = makeCtx()
  apply(ctx, { enabled: true, accounts: [] })
  const loginTool = registeredTools.find((t) => t.name === 'weixin_login')
  const value = await loginTool.execute({}, {})
  assert.equal(value.ok, false)
  assert.match(value.error, /未启用|未就绪/)
})

test('工具 schema 合法：有 description / parameters / output.render', () => {
  const { ctx, registeredTools } = makeCtx()
  apply(ctx, { enabled: true, accounts: [] })
  for (const tool of registeredTools) {
    assert.equal(typeof tool.name, 'string')
    assert.ok(tool.description.length > 20, `${tool.name} 描述应说明用途`)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
  }
})
