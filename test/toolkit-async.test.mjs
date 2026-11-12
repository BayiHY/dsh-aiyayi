/**
 * 1.5.41：工具箱"真异步"能力 + 两个具体工具（lib/toolkit-async.js / lib/toolkit-extra.js）单测。
 *
 * 覆盖要点（对应任务书 E 节）：
 *   1) 异步 helper：`startDetachedTask` **立刻返回**（不等后台）、后台跑完**真的调了**
 *      `exec.agent.followup`，且消息结构合法（`source` 里没有 undefined 字段——坑 #65）；
 *      失败/抛异常也投递（不许静默吞）；`delivery=no-agent` 时不抛；task 表可查。
 *   2) watch_read：**立刻返回**结构（status/taskId/hint 齐、字段过宿主输出校验）；
 *      参数夹取与 argv 组装；关键指标抽取；超时正文；脚本目录缺失走同步报错。
 *   3) mem_sync：路径越界拒绝、敏感内容拒绝（喂假 diff）、无改动 noop、正常路径
 *      （**临时仓库**模拟 git，绝不碰真记忆库）、仓库顶与记忆根不一致拒绝、
 *      单远端失败如实报告。
 *   4) schema：两个新工具的 output.schema 逐字段过宿主校验（单 type 字符串 / required 列全 /
 *      additionalProperties:false），且归一函数对脏输入也合规（坑 #77 / #78）。
 *
 * 环境隔离：AIYAYI_HOME 定向到临时沙盘 + 指路文件隔到沙盘（同 toolkit.test.mjs 的做法），
 * 绝不碰真实记忆目录；gh_repo 没有 node_modules，createUserMessage 的加载器用 __testing 注入。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-toolkit-1541-'))
const root = join(sandbox, 'root') // 记忆根（mem_sync 的"记忆仓库"就建在这儿）
mkdirSync(root, { recursive: true })
process.env.AIYAYI_HOME = root

const ta = await import(libUrl('toolkit-async.js'))
const tx = await import(libUrl('toolkit-extra.js'))
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
 * 0. 宿主校验器复刻（同 toolkit.test.mjs 6c 节，仅本包 schema 用到的子集）
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
/** required 必须把 properties 全列进去（1.5.40 的教训，1.5.41 延续）。 */
function requiredCoversAll(schema) {
  const props = Object.keys(schema.properties ?? {})
  const required = schema.required ?? []
  return props.every((key) => required.includes(key))
}
function checkOutput(label, schema, value) {
  const violations = hostValidateValue(schema, value)
  check(label, violations.length === 0, `${violations.join('；')}\n        实际输出: ${JSON.stringify(value)}`)
  return value
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
check('异步 helper：消息结构 = {content:[{type:text,text}], source:{kind:user}}',
  message?.content?.length === 1 && message.content[0].type === 'text' && message.content[0].text === '【单测】后台跑完了' && message.source?.kind === 'user',
  JSON.stringify(message))
check('异步 helper：source 里没有 undefined 字段（坑 #65）',
  Object.entries(message?.source ?? {}).every(([, v]) => v !== undefined) && Object.keys(message.source).length === 1,
  JSON.stringify(message?.source))
check('异步 helper：整条消息能无损 JSON 往返（宿主 snapshotJsonValue 同款判据）',
  JSON.stringify(JSON.parse(JSON.stringify(message))) === JSON.stringify(message))
check('异步 helper：构建器本身也不含 undefined', (() => {
  const payload = ta.buildTaskMessagePayload('x')
  return JSON.stringify(payload) === JSON.stringify({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } })
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
 * 2. watch_read：参数、argv、指标抽取、超时正文、缺目录、立刻返回结构
 * ------------------------------------------------------------------ */
check('watch_read：默认 rounds=6 / listenSec=0', (() => {
  const n = tx.normalizeWatchArgs({}, {})
  return n.rounds === 6 && n.listenSec === 0
})(), JSON.stringify(tx.normalizeWatchArgs({}, {})))
check('watch_read：显式参数生效', (() => {
  const n = tx.normalizeWatchArgs({ rounds: 9, listenSec: 12 }, {})
  return n.rounds === 9 && n.listenSec === 12
})())
check('watch_read：超上限被夹取（rounds 999→20 / listenSec 9999→120）', (() => {
  const n = tx.normalizeWatchArgs({ rounds: 999, listenSec: 9999 }, {})
  return n.rounds === 20 && n.listenSec === 120
})(), JSON.stringify(tx.normalizeWatchArgs({ rounds: 999, listenSec: 9999 }, {})))
check('watch_read：非法值退回默认（rounds 0 / listenSec -3）', (() => {
  const n = tx.normalizeWatchArgs({ rounds: 0, listenSec: -3 }, {})
  return n.rounds === 6 && n.listenSec === 0
})(), JSON.stringify(tx.normalizeWatchArgs({ rounds: 0, listenSec: -3 }, {})))

const argvs = tx.buildWatchArgv('C:/x/watch_read.py', { rounds: 6, listenSec: 12 })
check('watch_read：argv 是数组且参数名与脚本一致（--scan-rounds/--scan-sec/--listen）',
  Array.isArray(argvs) && argvs.includes('--scan-rounds') && argvs.includes('--scan-sec') && argvs.includes('--listen')
  && argvs[argvs.length - 1] === '12', JSON.stringify(argvs))
check('watch_read：argv 里没有 shell 拼接痕迹', argvs.every((a) => !/[|&;<>`$]/.test(a)), JSON.stringify(argvs))

const sampleStdout = [
  '=== SKG Watch V7 统一读取 2026-11-12T15:00:00 ===',
  '目标 MAC: F6:D7:7C:5B:E9:BA | 模式: [...] | 监听: 12s | 入库: 是',
  '',
  '===== 读取汇总 =====',
  '连接: ✓  通知帧: 42 条',
  '电量: 87%',
  '今日运动: 步数 3421 步 | 距离 2410 m | 卡路里 121 kcal',
  '睡眠: 23:10 → 07:02, 总 420min = 浅睡 240 + 深睡 120 + REM 60 (清醒 30)',
  '实时心率流(2A37): 3 个采样 — 15:00:01 72bpm, 15:00:02 74bpm',
].join('\n')
const keyLines = tx.extractWatchKeyLines(sampleStdout)
check('watch_read：关键指标抽取命中连接/电量/运动/睡眠/心率五行',
  keyLines.length >= 5 && keyLines.some((l) => l.startsWith('电量')) && keyLines.some((l) => l.startsWith('睡眠')), JSON.stringify(keyLines))
check('watch_read：抽取不含日志噪声行', !keyLines.some((l) => l.includes('目标 MAC')), JSON.stringify(keyLines))

const reportOk = tx.composeWatchReport({
  exitCode: 0, timedOut: false, stdout: sampleStdout, stderr: '', keyLines, timeoutMs: 180000, rounds: 6, listenSec: 12,
})
check('watch_read：正常正文含关键指标段与脚本输出末尾段',
  reportOk.includes('关键指标') && reportOk.includes('脚本输出末尾') && reportOk.includes('3421'), reportOk.slice(0, 200))
const reportTimeout = tx.composeWatchReport({
  exitCode: -1, timedOut: true, stdout: '', stderr: '', keyLines: [], timeoutMs: 180000, rounds: 6, listenSec: 0,
})
check('watch_read：超时正文明确说"没戴/没在广播"',
  reportTimeout.includes('超时') && reportTimeout.includes('没戴'), reportTimeout)
const reportFail = tx.composeWatchReport({
  exitCode: 1, timedOut: false, stdout: '❌ 6 轮扫描均未发现 F6:D7:7C:5B:E9:BA', stderr: '', keyLines: [], timeoutMs: 180000, rounds: 6, listenSec: 0,
})
check('watch_read：失败正文带退出码与原始输出', reportFail.includes('退出码 1') && reportFail.includes('未发现'), reportFail)

// 脚本目录不存在：watch_read 同步报错（不白起后台任务）。
const badWatch = tx.executeWatchRead({}, { cfg: { watchDir: join(sandbox, 'no-such-dir') }, logUsage: () => {} })
check('watch_read：脚本目录不存在 → ok:false / status:error（同步返回，不起后台任务）',
  badWatch.ok === false && badWatch.status === 'error' && badWatch.taskId === '' && badWatch.error.includes('不存在'), JSON.stringify(badWatch))
checkOutput('watch_read：缺目录路径的输出过宿主校验', tx.WATCH_SCHEMA.output.schema, badWatch)

// 正常受理：造一个脚本文件（不会被真跑，因为我们要的只是"立刻返回"这一路）。
const fakeWatchDir = join(sandbox, 'ble_direct')
mkdirSync(fakeWatchDir, { recursive: true })
writeFileSync(join(fakeWatchDir, 'watch_read.py'), '# fake\n', 'utf8')
const usageRecords = []
const watchExec = { agent: { id: 'sess-watch', followup: () => {} } }
const watchStartedAt = Date.now()
const watchResult = tx.executeWatchRead({ rounds: 2, listenSec: 0 }, {
  cfg: {
    watchDir: fakeWatchDir,
    // 用 node 当"python"，脚本内容无所谓——只验证立刻返回；18 秒后超时兜底杀进程。
    watchPython: process.execPath,
    watchTimeoutMs: 8000,
  },
  logUsage: (rec) => usageRecords.push(rec),
  warn: () => {},
  exec: watchExec,
})
const watchReturnMs = Date.now() - watchStartedAt
check('watch_read：立刻返回 status=started', watchResult.status === 'started' && watchResult.ok === true, JSON.stringify(watchResult))
check('watch_read：返回 taskId（tk- 前缀）', /^tk-[0-9a-f]{8}$/.test(watchResult.taskId), watchResult.taskId)
check('watch_read：hint 说明"约 25-100 秒，结果会作为消息推回会话"',
  watchResult.hint.includes('25-100') && watchResult.hint.includes('推回会话'), watchResult.hint)
check('watch_read：返回耗时 < 300ms（真异步，不等脚本）', watchReturnMs < 300, `${watchReturnMs}ms`)
check('watch_read：kind 恒为 watch_read', watchResult.kind === 'watch_read', watchResult.kind)
check('watch_read：error 空串（不是 undefined/null）', watchResult.error === '', JSON.stringify(watchResult.error))
checkOutput('watch_read：started 路径的输出过宿主校验', tx.WATCH_SCHEMA.output.schema, watchResult)
check('watch_read：立刻返回时写了留痕（status=started）', usageRecords.some((r) => r.tool === 'watch_read' && r.status === 'started'), JSON.stringify(usageRecords))
// 让后台任务跑完（node 跑一个 .py 会很快失败退出 → 走 error 分支并投递）。
const watchRecord = await ta.waitForTask(watchResult.taskId)
check('watch_read：后台任务最终落定为 success/error/timeout 之一',
  ['success', 'error', 'timeout'].includes(watchRecord?.status), JSON.stringify(watchRecord))
check('watch_read：后台任务留下文本摘要（投递正文非空）', (watchRecord?.summary ?? '').length > 0, watchRecord?.summary)
check('watch_read：后台完成也写留痕（任务级记录）',
  usageRecords.some((r) => r.tool === 'watch_read' && r.args.includes('task=')), JSON.stringify(usageRecords.map((r) => r.args)))

/* ------------------------------------------------------------------ *
 * 3. mem_sync
 * ------------------------------------------------------------------ */
// 3a. 敏感内容扫描（纯函数，喂假 diff）
const fakeDiff = [
  'diff --git a/memory.md b/memory.md',
  '+++ b/memory.md',
  '+ 正常内容一行',
  '+OPENAI_KEY=sk-abcdefghijklmnopqrstuvwx1234',
  '+// npm: npm_abcdefghijklmnopqrstuvwxyz',
  '+github_pat = ghp_abcdefghijklmnopqrstuvwx',
  '+-----BEGIN RSA PRIVATE KEY-----',
  '+password: hunter2hard',
  '+token = abcdef1234567890',
].join('\n')
const hits = tx.scanSensitive(fakeDiff)
const hitNames = hits.map((h) => h.name)
check('mem_sync 扫描：sk- 命中', hitNames.includes('sk-key'), JSON.stringify(hits))
check('mem_sync 扫描：npm_ 命中', hitNames.includes('npm-token'), JSON.stringify(hits))
check('mem_sync 扫描：ghp_ 命中', hitNames.includes('github-token'), JSON.stringify(hits))
check('mem_sync 扫描：私钥块命中', hitNames.includes('private-key'), JSON.stringify(hits))
check('mem_sync 扫描：password= 命中', hitNames.includes('password'), JSON.stringify(hits))
check('mem_sync 扫描：token= 命中', hitNames.includes('token'), JSON.stringify(hits))
check('mem_sync 扫描：行号准确（sk- 在第 4 行）', hits.find((h) => h.name === 'sk-key')?.line === 4, JSON.stringify(hits.find((h) => h.name === 'sk-key')))
check('mem_sync 扫描：脱敏片段不含凭证明文',
  hits.every((h) => !h.masked.includes('hunter2hard') && !h.masked.includes('abcdefghijklmnopqrstuvwx')), JSON.stringify(hits.map((h) => h.masked)))
check('mem_sync 扫描：干净文本零命中', tx.scanSensitive('+ 一切正常\n+ 没有密钥').length === 0)

// 3b. 越界守卫
check('mem_sync 越界：根内路径放行', (() => {
  try {
    tx.assertInsideRoot(join(root, 'a', 'b.md'), root)
    return true
  } catch {
    return false
  }
})())
check('mem_sync 越界：根外路径抛错', (() => {
  try {
    tx.assertInsideRoot(join(sandbox, 'elsewhere', 'x.md'), root)
    return false
  } catch (error) {
    return String(error.message).includes('越界')
  }
})())
check('mem_sync 越界：同级前缀不算包含（root-evil 不在 root 内）',
  tx.isInsidePath(join(sandbox, 'root-evil', 'x'), root) === false)
check('mem_sync 越界：根自己算在内', tx.isInsidePath(root, root) === true)

// 3c. 默认 commit message
check('mem_sync：默认 message 形如「记忆更新 2026-11-12 15:00」',
  tx.defaultCommitMessage(new Date(2026, 10, 12, 15, 0)).startsWith('记忆更新 2026-11-12 15:0'), tx.defaultCommitMessage(new Date(2026, 10, 12, 15, 0)))

// 3d. 非 git 仓库：明确报错（不猜、不自动 init）
const notRepo = tx.executeMemSync({}, { cfg: {}, logUsage: () => {}, warn: () => {} })
check('mem_sync：记忆根不是 git 仓库 → status=error 且提示 init',
  notRepo.status === 'error' && notRepo.ok === false && notRepo.hint.includes('不是 git 仓库'), JSON.stringify(notRepo))
checkOutput('mem_sync：非仓库路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, notRepo)

// 3e. 建一个**临时**记忆仓库（绝不碰真记忆库）
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: '测试',
  GIT_AUTHOR_EMAIL: 'test@local',
  GIT_COMMITTER_NAME: '测试',
  GIT_COMMITTER_EMAIL: 'test@local',
  GIT_TERMINAL_PROMPT: '0',
}
const runGit = (args, cwd = root) => spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv, windowsHide: true })
runGit(['init', '-b', 'master'])
runGit(['config', 'user.name', '阿依娅伊'])
runGit(['config', 'user.email', 'aiyayi@local'])
writeFileSync(join(root, 'memory.md'), '# 记忆\n- [2026-11-12] 测试条目\n', 'utf8')
runGit(['add', '-A'])
runGit(['commit', '-m', '初始提交'])
check('mem_sync 临时仓库：初始化成功且在 master', runGit(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() === 'master')

// 无改动 → noop（1.5.43 起：**先用 dummy 远端配置**把"配了远端但没改动"这条路径单独测，
//   不配远端时的 noop 在新版测试文件 test/mem-sync-1543.test.mjs 里另测）
const CFG_PUSH = { memPushRemotes: ['gitee'], memBranch: 'master' }
const noop = tx.executeMemSync({}, { cfg: CFG_PUSH, logUsage: () => {}, warn: () => {} })
check('mem_sync：无改动 → status=noop / ok:true / hint 说没有待提交的改动',
  noop.status === 'noop' && noop.ok === true && noop.hint.includes('没有待提交的改动'), JSON.stringify(noop))
check('mem_sync：noop 时 commit 是空串、pushed/hits 是空数组',
  noop.commit === '' && Array.isArray(noop.pushed) && noop.pushed.length === 0 && noop.hits.length === 0, JSON.stringify(noop))
checkOutput('mem_sync：noop 路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, noop)

// 敏感内容 → 拒绝（已跟踪文件的改动 + 未跟踪文件两条路都要扫到）
// 1.5.43 起必须给远端配置才会走到扫描（没配远端直接 noop 零副作用），故这里用 CFG_PUSH。
writeFileSync(join(root, 'memory.md'), '# 记忆\n- [2026-11-12] 测试条目\n+ sk-abcdefghijklmnop1234567890\n', 'utf8')
const denied = tx.executeMemSync({}, { cfg: CFG_PUSH, logUsage: () => {}, warn: () => {} })
check('mem_sync：已跟踪文件里的 sk- → status=denied',
  denied.status === 'denied' && denied.ok === false && denied.error === '命中敏感内容', JSON.stringify(denied))
check('mem_sync：拒绝时给出脱敏后的位置（含行号、不含原文）',
  denied.hits.length > 0 && denied.hits.some((h) => h.includes('第') && h.includes('sk-key')) && !denied.hits.join(' ').includes('abcdefghijklmnop1234567890'),
  JSON.stringify(denied.hits))
check('mem_sync：拒绝时没有产生提交（HEAD 未变）', (() => {
  const head = runGit(['rev-parse', '--short', 'HEAD']).stdout.trim()
  return !denied.commit && head === runGit(['log', '-1', '--format=%h']).stdout.trim()
})(), JSON.stringify(denied.commit))
checkOutput('mem_sync：拒绝路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, denied)

// 未跟踪文件里的密钥 → 同样拒绝（git diff 看不到它，必须单独扫）
writeFileSync(join(root, 'memory.md'), '# 记忆\n- [2026-11-12] 测试条目\n', 'utf8')
writeFileSync(join(root, '新笔记.md'), 'token = abcdef1234567890\n', 'utf8')
const denyUntracked = tx.executeMemSync({}, { cfg: CFG_PUSH, logUsage: () => {}, warn: () => {} })
check('mem_sync：未跟踪文件里的 token= 也拒绝（并指到文件名）',
  denyUntracked.status === 'denied' && denyUntracked.hits.some((h) => h.includes('新笔记.md')), JSON.stringify(denyUntracked.hits))
rmSync(join(root, '新笔记.md'), { force: true })

// 正常路径：提交 + push（远端不存在 → 全失败，但要如实逐条报告，且提交本身成功）
writeFileSync(join(root, 'memory.md'), '# 记忆\n- [2026-11-12] 测试条目\n- [2026-11-12] 新增一条\n', 'utf8')
const normal = tx.executeMemSync({ message: '记忆更新 2026-11-12 15:00（单测）' }, {
  cfg: { memPushRemotes: ['gitee', 'gitcode'], memBranch: 'master' },
  logUsage: () => {},
  warn: () => {},
})
check('mem_sync：正常路径 commit 非空（真的提交了）', normal.commit.length > 0, JSON.stringify(normal))
check('mem_sync：正常路径逐远端报告（两个远端都试了）',
  normal.pushed.length === 2 && normal.pushed.map((p) => p.remote).join(',') === 'gitee,gitcode', JSON.stringify(normal.pushed))
check('mem_sync：远端不存在时如实报失败（不谎报成功）',
  normal.pushed.every((p) => p.ok === false && p.error.length > 0) && normal.status === 'partial', JSON.stringify(normal))
check('mem_sync：提交信息真的用了我传的 message',
  runGit(['log', '-1', '--format=%s']).stdout.trim() === '记忆更新 2026-11-12 15:00（单测）', runGit(['log', '-1', '--format=%s']).stdout.trim())
check('mem_sync：提交作者是 阿依娅伊 <aiyayi@local>',
  runGit(['log', '-1', '--format=%an <%ae>']).stdout.trim() === '阿依娅伊 <aiyayi@local>', runGit(['log', '-1', '--format=%an <%ae>']).stdout.trim())
checkOutput('mem_sync：正常提交（推送失败）路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, normal)
check('mem_sync：提交后工作区干净（git add -A 到位）', runGit(['status', '--porcelain']).stdout.trim() === '', runGit(['status', '--porcelain']).stdout)

// 单远端成功 / 单远端失败：用本地 bare 仓库当远端，验证"一个失败不影响另一个"。
const bareRemote = join(sandbox, 'bare-gitee.git')
runGit(['init', '--bare', '-b', 'master', bareRemote], sandbox)
runGit(['remote', 'add', 'gitee', bareRemote])
runGit(['remote', 'add', 'gitcode', join(sandbox, 'no-such-remote.git')])
writeFileSync(join(root, 'memory.md'), '# 记忆\n- [2026-11-12] 再新增一条\n', 'utf8')
const mixed = tx.executeMemSync({}, { cfg: { memPushRemotes: ['gitee', 'gitcode'], memBranch: 'master' }, logUsage: () => {}, warn: () => {} })
check('mem_sync：一个远端成功一个失败 → status=partial、ok:false（1.5.43：部分失败不再假报成功）',
  mixed.status === 'partial' && mixed.ok === false, JSON.stringify(mixed))
check('mem_sync：partial 的 hint 附上本仓库真实存在的远端名（1.5.43）',
  mixed.hint.includes('本仓库现有远端') && mixed.hint.includes('gitcode') && mixed.hint.includes('gitee'), mixed.hint)
check('mem_sync：partial 的 error 是机器可读的「推送未全部成功」',
  mixed.error === '推送未全部成功', JSON.stringify(mixed.error))
check('mem_sync：成功的远端 ok:true（真的推进 bare 仓库了）',
  mixed.pushed.find((p) => p.remote === 'gitee')?.ok === true, JSON.stringify(mixed.pushed))
check('mem_sync：失败的远端 ok:false 且带 error，没拖累另一个',
  mixed.pushed.find((p) => p.remote === 'gitcode')?.ok === false && mixed.pushed.find((p) => p.remote === 'gitcode').error.length > 0, JSON.stringify(mixed.pushed))
check('mem_sync：bare 远端真的收到了提交（不再用"只看返回值"做证据）',
  spawnSync('git', ['log', '-1', '--format=%s', 'master'], { cwd: bareRemote, encoding: 'utf8', env: gitEnv }).stdout.trim().length > 0,
  spawnSync('git', ['log', '-1', '--format=%s', 'master'], { cwd: bareRemote, encoding: 'utf8', env: gitEnv }).stdout.trim())
checkOutput('mem_sync：部分成功路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, mixed)
// 全部成功
const allOk = tx.executeMemSync({}, { cfg: { memPushRemotes: ['gitee'], memBranch: 'master' }, logUsage: () => {}, warn: () => {} })
check('mem_sync：无改动时不会重复提交（第二次调用是 noop）', allOk.status === 'noop', JSON.stringify(allOk))

// 3f. 仓库顶与记忆根不一致 → 拒绝（防在别人的仓库子目录里提交）
const nested = join(sandbox, 'outer-repo')
mkdirSync(join(nested, '记忆'), { recursive: true })
runGit(['init', '-b', 'master'], nested)
runGit(['config', 'user.name', '阿依娅伊'], nested)
runGit(['config', 'user.email', 'aiyayi@local'], nested)
process.env.AIYAYI_HOME = join(nested, '记忆')
homeTesting.pointerCacheReset()
const mismatch = tx.executeMemSync({}, { cfg: {}, logUsage: () => {}, warn: () => {} })
check('mem_sync：记忆根是别的仓库的子目录 → status=denied（仓库顶不一致）',
  mismatch.status === 'denied' && mismatch.hint.includes('不一致'), JSON.stringify(mismatch))
checkOutput('mem_sync：仓库顶不一致路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, mismatch)
// 记忆根不可达 → error（不建目录、不写东西）
process.env.AIYAYI_HOME = join(sandbox, 'unreachable-root')
homeTesting.pointerCacheReset()
const unreachable = tx.executeMemSync({}, { cfg: {}, logUsage: () => {}, warn: () => {} })
check('mem_sync：记忆根不可达 → status=error（不建目录）',
  unreachable.status === 'error' && !existsSync(join(sandbox, 'unreachable-root')), JSON.stringify(unreachable))
process.env.AIYAYI_HOME = root
homeTesting.pointerCacheReset()

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
// 见 test/toolkit-manifest.test.mjs）。这里只断言"工具面是 1.5.44 的形态"，
// 实现的 schema / 归一函数 / execute 入口继续在下面直接测（实现文件保留，清单脚本复用同一套逻辑）。
check('注册：工具面是 1.5.44 形态（3 基础 + 2 清单管理，不再有 watch_read/mem_sync/pkg_stats）',
  registered.map((d) => d.name).join(',') === 'toolkit_cmd,toolkit_read,toolkit_write,toolbox_list,toolbox_reload',
  registered.map((d) => d.name).join(','))
check('注册：目录 list 与之一致（5 个）', api.list().length === 5, api.list())
check('注册：watch_read / mem_sync 已不在 TOOL_NAMES（实现保留、不注册）',
  !tk.TOOL_NAMES.includes('watch_read') && !tk.TOOL_NAMES.includes('mem_sync'), JSON.stringify(tk.TOOL_NAMES))

// schema 结构仍然逐条校验**导出物**（实现文件保留，清单加载器与独立脚本要复用，
// 所以 schema 合规性必须继续被钉住，只是不再经 apply() 注册）。
for (const [name, def] of [['watch_read', tx.WATCH_SCHEMA], ['mem_sync', tx.MEM_SYNC_SCHEMA]]) {
  check(`schema：${name} 存在`, Boolean(def?.name === name))
  check(`schema：${name} parameters.type 是单字符串 object`, def?.parameters?.type === 'object', JSON.stringify(def?.parameters))
  check(`schema：${name} output.schema.type 是单字符串 object`, def?.output?.schema?.type === 'object', JSON.stringify(def?.output?.schema))
  check(`schema：${name} required 列全 properties（坑 #78 的教训）`, requiredCoversAll(def.output.schema), JSON.stringify(def.output.schema.required))
  check(`schema：${name} 每个 properties 的 type 都是单字符串`,
    Object.values(def.output.schema.properties).every((p) => typeof p.type === 'string'), JSON.stringify(def.output.schema.properties))
  check(`schema：${name} 有 render`, typeof def?.output?.render === 'function')
  check(`schema：${name} 的 required 参数都在 properties 里`,
    (def.parameters.required ?? []).every((k) => def.parameters.properties[k] !== undefined), JSON.stringify(def.parameters.required))
}

// 归一函数：脏输入也必须合规（每个分支都过 shape，别再有"某条路径漏字段"）。
checkOutput('归一：watch_read 对空对象产出合规形状', tx.WATCH_SCHEMA.output.schema, tx.shapeWatchOutput({}))
checkOutput('归一：watch_read 对脏输入（undefined/null 混杂）产出合规形状', tx.WATCH_SCHEMA.output.schema,
  tx.shapeWatchOutput({ ok: null, status: undefined, taskId: null, kind: undefined, hint: null, error: undefined }))
checkOutput('归一：mem_sync 对空对象产出合规形状', tx.MEM_SYNC_SCHEMA.output.schema, tx.shapeMemSyncOutput({}))
checkOutput('归一：mem_sync 对脏 pushed/hits 产出合规形状', tx.MEM_SYNC_SCHEMA.output.schema,
  tx.shapeMemSyncOutput({ status: null, ok: 'yes', commit: null, pushed: [{ remote: null, ok: 'true', error: undefined }, null], hits: [null, 3], hint: null, error: undefined }))

// 直接调导出的 execute（1.5.43 起它们不再经 apply() 注册，但实现与签名必须保持可用——
// 1.5.44 的本地清单脚本与加载器都靠这个入口/逻辑）。空远端配置是 1.5.43 的零副作用 noop 语义。
const watchViaShell = await tx.executeWatchRead({}, { cfg: {}, logUsage: () => {}, warn: () => {}, exec: { agent: { id: 'sess-shell', followup: () => {} } } })
checkOutput('转发：watch_read 的 execute 直调也过宿主校验', tx.WATCH_SCHEMA.output.schema, watchViaShell)
check('转发：watch_read 直调返回 started 或明确的 error（二选一，绝不抛）',
  (watchViaShell.status === 'started' && watchViaShell.taskId.length > 0)
  || (watchViaShell.status === 'error' && watchViaShell.ok === false && watchViaShell.error.length > 0),
  JSON.stringify(watchViaShell))
const memViaShell = await tx.executeMemSync({}, { cfg: { memPushRemotes: [] }, logUsage: () => {}, warn: () => {} })
checkOutput('转发：mem_sync 的 execute 直调也过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, memViaShell)
check('转发：mem_sync 直调在空远端配置下是 noop（零副作用，1.5.43 语义）',
  memViaShell.status === 'noop' && memViaShell.ok === true, JSON.stringify(memViaShell))

/* 4b. exec 透传证据：起一个真任务，断言**后台完成时 followup 真的被调到**
 *     （这是 1.5.41 的命门——签名从 `(args)=>` 改成 `(args, exec)=>` 就是为了这个）。
 *     用一个假 watchDir + node 当 python：脚本立刻失败退出 → 走 error 分支 → 仍必须投递。
 *     1.5.43 起 watch_read 不再经 apply() 注册，这里直接调它的 execute（签名与透传行为不变，
 *     1.5.44 的清单脚本复用同一套投递纪律；清单链路的真任务覆盖在 toolkit-manifest.test.mjs）。 */
const shellFollowups = []
const shellStarted = await tx.executeWatchRead({ rounds: 1, listenSec: 0 }, {
  cfg: { usageEnabled: false, watchDir: fakeWatchDir, watchPython: process.execPath, watchTimeoutMs: 8000 },
  logUsage: () => {},
  warn: () => {},
  exec: { agent: { id: 'sess-shell2', followup: (m) => shellFollowups.push(m) } },
})
check('透传：直调 execute 起的任务 status=started', shellStarted.status === 'started', JSON.stringify(shellStarted))
const shellRecord = await ta.waitForTask(shellStarted.taskId)
check('透传：exec.agent.followup 被真的调到（异步结果能回注会话）', shellFollowups.length === 1, JSON.stringify(shellFollowups))
check('透传：投递的消息结构合法且 source 无 undefined',
  shellFollowups[0]?.source?.kind === 'user' && Object.values(shellFollowups[0].source).every((v) => v !== undefined)
  && JSON.stringify(shellFollowups[0]) === JSON.stringify(JSON.parse(JSON.stringify(shellFollowups[0]))),
  JSON.stringify(shellFollowups[0]))
check('透传：投递记 delivery=sent', shellRecord?.delivery === 'sent', JSON.stringify(shellRecord))
check('透传：投递正文带了任务标记（能看懂是哪个任务）', (shellRecord?.summary ?? '').includes('watch_read'), shellRecord?.summary)

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
