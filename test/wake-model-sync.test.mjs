/**
 * 唤醒对齐模型自检（1.5.7）。
 *
 * 为什么有这道闸：宿主 coldResume 只从 durable descriptor 读 spawn 时冻结的
 * 旧 provider/model 重建子代；本体切模型后若子代不在 agents 注册表（DSH 重启/
 * 激活释放/已 dispose），propagateModelToChildren 拿不到 agent 会静默跳过，
 * 子会话日志没有 model/selection 事件 → 冷唤醒沿用旧模型，额度错/无法推进。
 *
 * 修复：createWorkerApply（挂 preset-aiyayi-worker，即"小伙伴"）注册
 * agent/inbox/inserted 监听，趁唤醒消息插入（早于 wakeDriver→preStep）把
 * 父会话当前模型 select 到子代，wake 首步即用新模型。
 *
 * 这里用假 ctx + 假 agent 走一遍 createWorkerApply，验证：
 *  - 确实注册了 agent/inbox/inserted 监听；
 *  - 父模型与子代不同路由 → 调 select 且传的是父模型；
 *  - 父模型与子代同路由 → 不调 select（幂等）；
 *  - 拿不到父会话/父模型 → 静默跳过（不抛错）。
 */
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const { createWorkerApply } = await import(libUrl('presence.js'))

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/** 假 agents 注册表：记录 select 调用，方便断言。 */
function makeAgents() {
  const calls = []
  const entries = new Map()
  return {
    calls,
    entries,
    get(id) {
      return entries.get(id)
    },
    put(id, model) {
      const agent = { model }
      entries.set(id, agent)
      return agent
    },
  }
}

/** 假 model：current() 返回固定 selection，select() 记录调用。 */
function makeModel(selection, calls) {
  return {
    current() {
      return selection
    },
    select(sel) {
      calls.push(sel)
    },
  }
}

/** 假 ctx：只记录 on 注册的 agent/inbox/inserted 监听。 */
function makeCtx(agents) {
  const inboxHandlers = []
  return {
    inboxHandlers,
    effect(fn) {
      fn()
      return () => {}
    },
    on(event, handler) {
      if (event === 'agent/inbox/inserted') inboxHandlers.push(handler)
      if (event === 'agent/pre-step') return () => {}
      if (event === 'session/event') return () => {}
      return () => {}
    },
    get(key) {
      if (key === 'agents') return agents
      return null
    },
  }
}

const PARENT = 'parent-session-1'
const CHILD = 'child-session-1'

// 场景 A：父模型与子代不同路由 → 唤醒首步 select 父模型。
{
  const agents = makeAgents()
  const childSelection = { provider: 'deepseek', model: 'old-model' }
  const parentSelection = { provider: 'deepseek', model: 'new-model' }
  const childModel = makeModel(childSelection, agents.calls)
  const parentAgent = agents.put(PARENT, makeModel(parentSelection, agents.calls))
  const ctx = makeCtx(agents)
  const childAgent = { session: { header: { parentSession: PARENT } }, model: childModel }
  createWorkerApply('aiyayi-presence-worker')(ctx)
  const handler = ctx.inboxHandlers[0]
  check('createWorkerApply 注册了 agent/inbox/inserted 监听', typeof handler === 'function', typeof handler)
  if (handler) {
    handler({ agent: childAgent })
    check(
      '父模型与子代不同路由 → select 被调且传父模型',
      agents.calls.length === 1 &&
        agents.calls[0].provider === 'deepseek' &&
        agents.calls[0].model === 'new-model',
      JSON.stringify(agents.calls),
    )
  }
}

// 场景 B：父模型与子代同路由 → 不调 select（幂等，避免反复写日志）。
{
  const agents = makeAgents()
  const childSelection = { provider: 'deepseek', model: 'same-model' }
  const parentSelection = { provider: 'deepseek', model: 'same-model' }
  const childModel = makeModel(childSelection, agents.calls)
  agents.put(PARENT, makeModel(parentSelection, agents.calls))
  const ctx = makeCtx(agents)
  const childAgent = { session: { header: { parentSession: PARENT } }, model: childModel }
  createWorkerApply('aiyayi-presence-worker')(ctx)
  const handler = ctx.inboxHandlers[0]
  handler({ agent: childAgent })
  check('父模型与子代同路由 → 不调 select（幂等）', agents.calls.length === 0, JSON.stringify(agents.calls))
}

// 场景 C：子会话没有父会话映射 → 静默跳过，不抛错。
{
  const agents = makeAgents()
  const childModel = makeModel({ provider: 'deepseek', model: 'm' }, agents.calls)
  const ctx = makeCtx(agents)
  const childAgent = { session: { header: {} }, model: childModel }
  createWorkerApply('aiyayi-presence-worker')(ctx)
  const handler = ctx.inboxHandlers[0]
  let threw = false
  try {
    handler({ agent: childAgent })
  } catch {
    threw = true
  }
  check('无父会话映射 → 静默跳过不抛错', !threw && agents.calls.length === 0, `threw=${threw} calls=${agents.calls.length}`)
}

// 场景 D：父会话在注册表但无当前模型 → 静默跳过不抛错。
{
  const agents = makeAgents()
  const childModel = makeModel({ provider: 'deepseek', model: 'm' }, agents.calls)
  agents.put(PARENT, makeModel(null, agents.calls))
  const ctx = makeCtx(agents)
  const childAgent = { session: { header: { parentSession: PARENT } }, model: childModel }
  createWorkerApply('aiyayi-presence-worker')(ctx)
  const handler = ctx.inboxHandlers[0]
  let threw = false
  try {
    handler({ agent: childAgent })
  } catch {
    threw = true
  }
  check('父会话无当前模型 → 静默跳过不抛错', !threw && agents.calls.length === 0, `threw=${threw}`)
}

console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)
