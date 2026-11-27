/**
 * 1.5.41：工具箱"真异步"能力单测（lib/toolkit-async.js）+ 工具面注册形态。
 *
 * 覆盖要点：
 *   1) 异步 helper：`startDetachedTask` **立刻返回**（不等后台）、后台跑完**真的调了**
 *      `exec.agent.followup`，且消息结构合法（`source` 里没有 undefined 字段——坑 #65）；
 *      失败/抛异常也投递（不许静默吞）；`delivery=no-agent` 时不抛；task 表可查；
 *      1.6.1：投递正文带自报家门头行「〔工具结果〕<kind> · 后台任务 <taskId>」。
 *   2) 注册：工具面是 1.6.1 形态（3 基础 + 3 清单管理），watch_read / mem_sync / pkg_stats
 *      不在 TOOL_NAMES。
 *
 * **1.6.1 变更**：本文件原有 watch_read / mem_sync 段（依赖 lib/toolkit-extra.js）随该实现
 * 文件一并删除（理由见 lib/toolkit.js 头注释：test/ 不进 npm 包，"单测用"不成立）；
 * 真清单工具链路（taskId / followup 透传）的覆盖在 test/toolkit-manifest.test.mjs。
 *
 * 环境隔离：AIYAYI_HOME 定向到临时沙盘 + 指路文件隔到沙盘，绝不碰真实记忆目录；
 * gh_repo 没有 node_modules，createUserMessage 的加载器用 __testing 注入。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-toolkit-1541-'))
const root = join(sandbox, 'root') // 记忆根（tk.apply 的 resolveRoot 落在这儿）
mkdirSync(root, { recursive: true })
process.env.AIYAYI_HOME = root

const ta = await import(libUrl('toolkit-async.js'))
const tk = await import(libUrl('toolkit.js'))
const { __testing: homeTesting } = await import(libUrl('home.js'))
// 指路文件隔到沙盘：不然真机的 location.json 会覆盖 AIYAYI_HOME，mem_sync 就指向真记忆库了。
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ------------------------------------------------------------------ *
 * 1. 异步 helper：立刻返回 + 后台完成投递
 * ------------------------------------------------------------------ */
// 注入假的 createUserMessage（gh_repo 无 node_modules，@deepseek-ai/dsh-llm 装不出来）。
const createdMessages = []
ta.__testing.setCreateUserMessageLoader(async () => (input) => {
  createdMessages.push(input)
  return { ...input, __built: true }
})
ta.__testing.clearTasks()

const followups = []
let releaseGate = null
const gate = new Promise((resolveGate) => {
  releaseGate = resolveGate
})
const fakeExec = { agent: { id: 'sess-1541', followup: (message) => followups.push(message) } }

const startedAt = Date.now()
const handle = ta.startDetachedTask({
  exec: fakeExec,
  kind: 'unit_async',
  label: '单测任务',
  hint: '立刻返回的提示',
  run: async () => {
    await gate
    return { status: 'success', text: '【单测】后台跑完了', error: '' }
  },
})
const returnMs = Date.now() - startedAt
check('异步 helper：立刻返回 status=started', handle.status === 'started', JSON.stringify(handle))
check('异步 helper：taskId 形如 tk-xxxxxxxx', /^tk-[0-9a-f]{8}$/.test(handle.taskId), handle.taskId)
check('异步 helper：kind 原样带回', handle.kind === 'unit_async', handle.kind)
check('异步 helper：hint 可覆盖', handle.hint === '立刻返回的提示', handle.hint)
check('异步 helper：返回耗时 < 50ms（证明没 await 到后台）', returnMs < 50, `${returnMs}ms`)
check('异步 helper：返回时后台还没跑完（followup 尚未调用）', followups.length === 0, followups.length)
const liveRecord = ta.getTask(handle.taskId)
check('异步 helper：task 表里记得到，状态 running', liveRecord?.status === 'running' && liveRecord.kind === 'unit_async', JSON.stringify(liveRecord))

releaseGate()
const record = await ta.waitForTask(handle.taskId)
check('异步 helper：任务最终 success', record?.status === 'success', JSON.stringify(record))
check('异步 helper：followup 被调用一次', followups.length === 1, followups.length)
const message = followups[0]
check('异步 helper：消息结构 = {content:[{type:text,text}], source:{kind:user}}（1.5.45 身份标注 + 1.6.1 自报家门头行）',
  message?.content?.length === 1 && message.content[0].type === 'text'
  && message.content[0].text === `〔系统提示·非用户发言〕〔工具结果〕unit_async · 后台任务 ${handle.taskId}\n\n【单测】后台跑完了`
  && message.source?.kind === 'user',
  JSON.stringify(message))
check('异步 helper：头行自报家门（〔工具结果〕kind · 后台任务 taskId + 空行 + 正文）',
  ta.buildTaskResultHeader('unit_async', handle.taskId) === `〔工具结果〕unit_async · 后台任务 ${handle.taskId}`
  && message.content[0].text.startsWith(`〔系统提示·非用户发言〕〔工具结果〕unit_async · 后台任务 ${handle.taskId}\n\n`),
  JSON.stringify(message.content[0].text))
check('异步 helper：source 里没有 undefined 字段（坑 #65）',
  Object.entries(message?.source ?? {}).every(([, v]) => v !== undefined) && Object.keys(message.source).length === 1,
  JSON.stringify(message?.source))
check('异步 helper：整条消息能无损 JSON 往返（宿主 snapshotJsonValue 同款判据）',
  JSON.stringify(JSON.parse(JSON.stringify(message))) === JSON.stringify(message))
check('异步 helper：构建器本身也不含 undefined（1.5.45 text 带身份标注）', (() => {
  const payload = ta.buildTaskMessagePayload('x')
  return JSON.stringify(payload) === JSON.stringify({ content: [{ type: 'text', text: '〔系统提示·非用户发言〕x' }], source: { kind: 'user' } })
})())
check('异步 helper：投递成功记 delivery=sent', record?.delivery === 'sent', record?.delivery)
check('异步 helper：durationMs 是正整数', Number.isInteger(record?.durationMs) && record.durationMs >= 0, record?.durationMs)

// 失败也要投递（不许静默吞）。
const failFollowups = []
const failExec = { agent: { id: 'sess-fail', followup: (m) => failFollowups.push(m) } }
const failHandle = ta.startDetachedTask({
  exec: failExec,
  kind: 'unit_async_fail',
  run: async () => {
    throw new Error('后台炸了-9527')
  },
})
const failRecord = await ta.waitForTask(failHandle.taskId)
check('异步 helper：run 抛异常 → 任务记 error', failRecord?.status === 'error' && failRecord.error.includes('后台炸了-9527'), JSON.stringify(failRecord))
check('异步 helper：run 抛异常也投递（不静默吞）', failFollowups.length === 1 && failFollowups[0].content[0].text.includes('后台炸了-9527'), JSON.stringify(failFollowups))

// 主动返回 timeout / error 也要投递。
const timeouts = []
const timeoutExec = { agent: { id: 'sess-to', followup: (m) => timeouts.push(m) } }
const timeoutHandle = ta.startDetachedTask({
  exec: timeoutExec,
  kind: 'unit_async_timeout',
  run: async () => ({ status: 'timeout', text: '【单测】超时了', error: '超时 180s' }),
})
const timeoutRecord = await ta.waitForTask(timeoutHandle.taskId)
check('异步 helper：run 返回 timeout → 记录 timeout 且投递', timeoutRecord?.status === 'timeout' && timeouts.length === 1, JSON.stringify(timeoutRecord))

// 拿不到 exec.agent：不抛、任务仍收尾、投递记 no-agent。
const silentHandle = ta.startDetachedTask({
  exec: {},
  kind: 'unit_async_noagent',
  run: async () => ({ status: 'success', text: '没有 agent 也要收尾' }),
})
const silentRecord = await ta.waitForTask(silentHandle.taskId)
check('异步 helper：没有 exec.agent 时不抛，delivery=no-agent', silentRecord?.status === 'success' && silentRecord.delivery === 'no-agent', JSON.stringify(silentRecord))

// followup 自己抛错：不逃逸、记 failed。
const boomFollowups = []
const boomExec = { agent: { id: 'sess-boom', followup: () => { boomFollowups.push(1); throw new Error('append 重入失败') } } }
const boomWarns = []
const boomHandle = ta.startDetachedTask({
  exec: boomExec,
  kind: 'unit_async_boom',
  warn: (msg) => boomWarns.push(msg),
  run: async () => ({ status: 'success', text: '投递会失败' }),
})
const boomRecord = await ta.waitForTask(boomHandle.taskId)
check('异步 helper：followup 抛错不逃逸（坑 #68 同款保护），记 delivery=failed',
  boomRecord?.delivery === 'failed' && boomRecord.deliveryError.includes('append 重入失败'), JSON.stringify(boomRecord))
check('异步 helper：投递失败有 warn（不静默）', boomWarns.some((m) => m.includes('投递失败')), JSON.stringify(boomWarns))

// 嵌套形状 {agent:{...}} 也认（少量宿主版本会包一层）。
check('异步 helper：pickAgent 认裸 Agent', ta.pickAgent({ agent: { followup() {} } }) !== null)
check('异步 helper：pickAgent 认包一层的 {agent:{agent}}', ta.pickAgent({ agent: { agent: { followup() {} } } }) !== null)
check('异步 helper：pickAgent 对空 exec 返回 null', ta.pickAgent({}) === null && ta.pickAgent(null) === null)

// onFinish 回调：留痕链路要能拿到完整记录。
let finishRecord = null
const finished = ta.startDetachedTask({
  exec: fakeExec,
  kind: 'unit_async_finish',
  run: async () => ({ status: 'success', text: '收尾回调' }),
  onFinish: ({ record: r }) => {
    finishRecord = r
  },
})
await ta.waitForTask(finished.taskId)
check('异步 helper：onFinish 拿到完整记录', finishRecord?.taskId === finished.taskId && finishRecord.status === 'success', JSON.stringify(finishRecord))

/* ------------------------------------------------------------------ *
 * 2. 1.23.0 A 案：忙闲分流（running→steer / idle→followup / 老宿主降级 / env 急停）
 * ------------------------------------------------------------------ */
{
  const savedDeliver = process.env.AIYAYI_ASYNC_DELIVER
  const savedRedeliver = process.env.AIYAYI_ASYNC_REDELIVER
  delete process.env.AIYAYI_ASYNC_REDELIVER
  try {
    // idle agent：走 followup，不碰 steer
    const idleCalls = { followup: 0, steer: 0 }
    const idleExec = { agent: { id: 'a-idle', status: 'idle', followup: () => { idleCalls.followup += 1 }, steer: () => { idleCalls.steer += 1 } } }
    const h1 = ta.startDetachedTask({ exec: idleExec, kind: 'unit_dispatch_idle', run: async () => ({ status: 'success', text: 'x' }) })
    const r1 = await ta.waitForTask(h1.taskId)
    check('A案：idle → followup 被调、steer 没被调', idleCalls.followup === 1 && idleCalls.steer === 0 && r1.delivery === 'sent', JSON.stringify({ idleCalls, delivery: r1.delivery }))

    // running agent：走 steer（next-step 插话）
    const runCalls = { followup: 0, steer: 0 }
    const runExec = { agent: { id: 'a-run', status: 'running', followup: () => { runCalls.followup += 1 }, steer: () => { runCalls.steer += 1 } } }
    const h2 = ta.startDetachedTask({ exec: runExec, kind: 'unit_dispatch_run', run: async () => ({ status: 'success', text: 'x' }) })
    const r2 = await ta.waitForTask(h2.taskId)
    check('A案：running → steer 被调、followup 没被调', runCalls.steer === 1 && runCalls.followup === 0 && r2.delivery === 'sent', JSON.stringify({ runCalls, delivery: r2.delivery }))

    // 老宿主（无 steer/status）：降级 followup，不炸
    const oldCalls = { followup: 0 }
    const oldExec = { agent: { id: 'a-old', followup: () => { oldCalls.followup += 1 } } }
    const h3 = ta.startDetachedTask({ exec: oldExec, kind: 'unit_dispatch_old', run: async () => ({ status: 'success', text: 'x' }) })
    const r3 = await ta.waitForTask(h3.taskId)
    check('A案：老宿主（无 steer/status）降级 followup', oldCalls.followup === 1 && r3.delivery === 'sent', JSON.stringify({ oldCalls, delivery: r3.delivery }))

    // 急停开关：AIYAYI_ASYNC_DELIVER=followup 时 running 也走 followup
    process.env.AIYAYI_ASYNC_DELIVER = 'followup'
    const killCalls = { followup: 0, steer: 0 }
    const killExec = { agent: { id: 'a-kill', status: 'running', followup: () => { killCalls.followup += 1 }, steer: () => { killCalls.steer += 1 } } }
    const h4 = ta.startDetachedTask({ exec: killExec, kind: 'unit_dispatch_kill', run: async () => ({ status: 'success', text: 'x' }) })
    const r4 = await ta.waitForTask(h4.taskId)
    check('A案：AIYAYI_ASYNC_DELIVER=followup 急停生效（running 也走 followup）', killCalls.followup === 1 && killCalls.steer === 0 && r4.delivery === 'sent', JSON.stringify({ killCalls, delivery: r4.delivery }))
  } finally {
    if (savedDeliver === undefined) delete process.env.AIYAYI_ASYNC_DELIVER
    else process.env.AIYAYI_ASYNC_DELIVER = savedDeliver
    if (savedRedeliver === undefined) delete process.env.AIYAYI_ASYNC_REDELIVER
    else process.env.AIYAYI_ASYNC_REDELIVER = savedRedeliver
  }
}

/* ------------------------------------------------------------------ *
 * 3. 1.23.0 B 案：失败痕迹落盘（<记忆根>/async-pending/）+ 补投钩子
 * ------------------------------------------------------------------ */
{
  const savedRedeliver = process.env.AIYAYI_ASYNC_REDELIVER
  delete process.env.AIYAYI_ASYNC_REDELIVER
  try {
    const { readdirSync } = await import('node:fs')
    const pendingDir = join(root, 'async-pending')
    const countFiles = () => {
      try {
        return readdirSync(pendingDir).filter((f) => f.endsWith('.json')).length
      } catch {
        return 0
      }
    }
    // 前置清理：第 1 段 no-agent/boom 用例按 B 案新逻辑也落了痕迹，先清空目录再计数，
    // 消除段间污染（时间在前的新文件名下，旧痕迹稳定排在最前，不清则本段断言必挂）。
    try {
      readdirSync(pendingDir).filter((f) => f.endsWith('.json')).forEach((f) => rmSync(join(pendingDir, f)))
    } catch {
      /* 目录还没建就当空 */
    }
    const before = countFiles()

    // no-agent → 痕迹落盘 + persisted=true（不再只留内存 warn）
    const h5 = ta.startDetachedTask({ exec: {}, kind: 'unit_pending_noagent', run: async () => ({ status: 'success', text: 'B案结果正文' }) })
    const r5 = await ta.waitForTask(h5.taskId)
    check('B案：no-agent 时 persisted=true 且痕迹落盘', r5.delivery === 'no-agent' && r5.deliveryPersisted === true && countFiles() === before + 1, JSON.stringify({ delivery: r5.delivery, persisted: r5.deliveryPersisted, count: countFiles(), before }))

    // takePendingReceipt 读到最旧一条，正文带自报家门头行
    const pending = ta.takePendingReceipt()
    check('B案：takePendingReceipt 读到痕迹（正文带自报家门头行）',
      pending !== null && typeof pending.file === 'string' && pending.record.text.startsWith(`〔工具结果〕unit_pending_noagent`),
      JSON.stringify(pending?.record ?? null).slice(0, 200))

    // env 急停：AIYAYI_ASYNC_REDELIVER=0 → takePendingReceipt 恒 null（痕迹留盘不自动投）
    process.env.AIYAYI_ASYNC_REDELIVER = '0'
    check('B案：AIYAYI_ASYNC_REDELIVER=0 时 takePendingReceipt 返回 null', ta.takePendingReceipt() === null)
    delete process.env.AIYAYI_ASYNC_REDELIVER

    // 补投钩子（toolkit.js apply 挂的第 2 个 pre-step）：注入补投消息并删痕迹
    const redeliverHandlers = []
    const ctx2 = {
      effect(fn) { fn(); return () => {} },
      on(event, handler) {
        if (event === 'agent/pre-step') redeliverHandlers.push(handler)
        return () => {}
      },
      tools: { register() { return () => {} } },
      logger: { info: () => {}, warn: () => {} },
    }
    tk.apply(ctx2, { usageEnabled: false })
    check('B案：apply 挂了 2 个 pre-step 钩子（清单问题 + 回执补投）', redeliverHandlers.length === 2, String(redeliverHandlers.length))
    const decision3 = await redeliverHandlers[1]({ agent: { id: 'sess-redeliver' } }, async () => ({ kind: 'ok', messages: [] }))
    const redeliverText = (decision3.messages ?? []).map((m) => m.content?.[0]?.text ?? '').join('\n')
    check('B案：补投钩子注入 [异步回执补投] 消息且含原正文', redeliverText.includes('[异步回执补投]') && redeliverText.includes('B案结果正文'), redeliverText.slice(0, 200))
    check('B案：补投后痕迹文件已删（count 回到 before）', countFiles() === before, `${countFiles()} vs ${before}`)

    // steer 抛错 → delivery=failed 且也留痕（失败不静默不丢失）
    const boomSteer = { agent: { id: 'a-boom', status: 'running', followup: () => {}, steer: () => { throw new Error('steer 炸了') } } }
    const h6 = ta.startDetachedTask({ exec: boomSteer, kind: 'unit_pending_boom', run: async () => ({ status: 'success', text: 'y' }) })
    const r6 = await ta.waitForTask(h6.taskId)
    check('B案：steer 抛错 → delivery=failed 且 persisted=true', r6.delivery === 'failed' && r6.deliveryPersisted === true, JSON.stringify({ delivery: r6.delivery, persisted: r6.deliveryPersisted }))
    // 清掉这条测试痕迹，别污染后续用例
    const p2 = ta.takePendingReceipt()
    if (p2) ta.discardPendingReceipt(p2.file)
  } finally {
    if (savedRedeliver === undefined) delete process.env.AIYAYI_ASYNC_REDELIVER
    else process.env.AIYAYI_ASYNC_REDELIVER = savedRedeliver
  }
}

/* ------------------------------------------------------------------ *
 * 4. 注册 / schema / own-tools
 * ------------------------------------------------------------------ */
const registered = []
const makeCtx = () => ({
  effect(fn) {
    fn()
    return () => {}
  },
  tools: {
    register(def) {
      registered.push(def)
      return () => {}
    },
  },
  logger: { info: () => {}, warn: () => {} },
})
const api = tk.apply(makeCtx(), { usageEnabled: false })
// 1.5.43 / 1.5.44：watch_read / mem_sync / pkg_stats 已移出工具面（改由本机清单驱动，
// 见 test/toolkit-manifest.test.mjs）。1.6.1：管理工具加到三个（+ toolbox_remove）。
check('注册：工具面是 1.6.1 形态（3 基础 + 3 清单管理，不再有 watch_read/mem_sync/pkg_stats）',
  registered.map((d) => d.name).join(',') === 'toolkit_cmd,toolkit_read,toolkit_write,toolbox_list,toolbox_reload,toolbox_remove',
  registered.map((d) => d.name).join(','))
check('注册：目录 list 与之一致（6 个）', api.list().length === 6, api.list())
check('注册：watch_read / mem_sync / pkg_stats 已不在 TOOL_NAMES',
  !tk.TOOL_NAMES.includes('watch_read') && !tk.TOOL_NAMES.includes('mem_sync') && !tk.TOOL_NAMES.includes('pkg_stats'), JSON.stringify(tk.TOOL_NAMES))

/* ------------------------------------------------------------------ *
 * 收尾
 * ------------------------------------------------------------------ */
const cleanup = () => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 清理失败不盖掉测试结果 */
  }
}
process.on('exit', cleanup)
cleanup()

console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)
