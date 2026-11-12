/**
 * 1.5.44：本地工具清单（lib/toolkit-manifest.js）单测。
 *
 * 覆盖要点（对应任务书"测试要求"）：
 *   1) **清单解析**：合法 / 非法 JSON / 缺必填字段 / name 不合规 / mode:"sync" 被拒 /
 *      version≠1 / 重名 / timeoutMs 越界 / params 类型非法 / ~ 与 %变量% 展开；
 *   2) **加载**：enabled:false 不注册、enabled:true 注册、脚本不存在时**显式报错**、
 *      清单不存在只记日志不报错、条目坏掉不影响其他条目；
 *   3) **异步**：调用立刻返回 taskId（不等脚本跑完）、后台跑完 followup 真的被调到、
 *      超时被杀并报回、非 0 退出码报回带 stderr 摘要；
 *   4) **管理工具**：toolbox_list / toolbox_reload 输出正确、重载能注销旧工具；
 *   5) **工具面**：TOOL_NAMES 只剩 3+2、own-tools 超集（清单工具动态放行）、
 *      包内不再注册 mem_sync / watch_read / pkg_stats。
 *
 * 环境隔离：AIYAYI_HOME 定向到 %TEMP% 沙盘 + 指路文件也隔到沙盘，
 * **绝不在真实记忆根上测**；createUserMessage 用 __testing 注入（gh_repo 没有 node_modules）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-manifest-1544-'))
const root = join(sandbox, 'root')
mkdirSync(join(root, 'memories'), { recursive: true })
process.env.AIYAYI_HOME = root

const mf = await import(libUrl('toolkit-manifest.js'))
const tk = await import(libUrl('toolkit.js'))
const ta = await import(libUrl('toolkit-async.js'))
const { __testing: homeTesting } = await import(libUrl('home.js'))
// 指路文件隔到沙盘：不然真机的 location.json 会把记忆根指走（= 真在真实记忆根上测，绝对不行）。
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ------------------------------------------------------------------ *
 * 0. 测试夹具：脚本放沙盘，清单写到沙盘根
 * ------------------------------------------------------------------ */

/** 造一个"立刻成功"的脚本：stdout 输出 JSON。 */
function makeScript(name, source) {
  const file = join(sandbox, name)
  writeFileSync(file, source, 'utf8')
  return file
}

const SCRIPT_OK = makeScript('ok.js', `
process.stdout.write(JSON.stringify({ ok: true, status: 'done', hint: '脚本跑完了', value: 42 }) + '\\n')
`)
const SCRIPT_SLOW = makeScript('slow.js', `
setTimeout(() => { process.stdout.write(JSON.stringify({ ok: true, hint: '慢活跑完了' })) }, 1500)
`)
const SCRIPT_FAIL = makeScript('fail.js', `
process.stderr.write('boom: 读不到配置文件\\n另一行 stderr\\n')
process.exit(7)
`)
const SCRIPT_HANG = makeScript('hang.js', `setTimeout(() => {}, 60000)\n`)
const SCRIPT_BADJSON = makeScript('badjson.js', `process.stdout.write('这不是 JSON，只是一段普通输出')\n`)

const manifestPath = join(root, 'toolbox.json')
const writeManifest = (obj) => writeFileSync(manifestPath, JSON.stringify(obj, null, 2), 'utf8')

/* ------------------------------------------------------------------ *
 * 1. 纯函数：路径展开 / 解释器选择 / 参数 schema
 * ------------------------------------------------------------------ */
check('expandPath：~ 展开成家目录', mf.expandPath('~/x/y').endsWith(join('x', 'y')) && !mf.expandPath('~/x/y').startsWith('~'))
check('expandPath：%变量% 展开', mf.expandPath('%AIYAYI_TEST_VAR%/a', { AIYAYI_TEST_VAR: 'C:/t' }) === 'C:/t/a')
check('expandPath：${变量} 展开', mf.expandPath('${AIYAYI_TEST_VAR}/b', { AIYAYI_TEST_VAR: 'D:/u' }) === 'D:/u/b')
check('expandPath：未定义变量原样保留（后面报"脚本不存在"，比静默清空好查）', mf.expandPath('%NO_SUCH_VAR%/x', {}) === '%NO_SUCH_VAR%/x')
check('interpreterFor：.js 用 process.execPath', mf.interpreterFor('a/b.js').kind === 'node' && mf.interpreterFor('a/b.js').cmd === process.execPath)
check('interpreterFor：.py 默认 python', mf.interpreterFor('a/b.py').kind === 'python' && mf.interpreterFor('a/b.py').cmd === 'python')
check('interpreterFor：.ps1 带 -File 前缀', mf.interpreterFor('a/b.ps1').prefix.includes('-File'))
check('interpreterFor：.exe 直接执行', mf.interpreterFor('a/b.exe').kind === 'exe' && mf.interpreterFor('a/b.exe').prefix.length === 0)

const ps1 = mf.buildParamsSchema({ message: { type: 'string', description: '说明', required: true }, n: { type: 'number' } })
check('buildParamsSchema：三类型都收', ps1.ok && Object.keys(ps1.properties).length === 2 && ps1.required.join(',') === 'message')
const ps2 = mf.buildParamsSchema({ arr: { type: 'array' } })
check('buildParamsSchema：非三类型拒（array）', ps2.ok === false && ps2.problems[0].includes('只支持'))
const ps3 = mf.buildParamsSchema({ 'bad-name': { type: 'string' } })
check('buildParamsSchema：参数名不合规拒', ps3.ok === false)
check('buildParamsSchema：undefined 是合法的（无参数工具）', mf.buildParamsSchema(undefined).ok === true)

/* ------------------------------------------------------------------ *
 * 2. 清单解析：合法 / 非法 / 缺字段 / 名字不合规 / mode:sync 被拒
 * ------------------------------------------------------------------ */
const goodEntry = {
  name: 'demo_tool',
  enabled: true,
  script: SCRIPT_OK.replace(/\\/g, '/'),
  description: '演示工具',
  timeoutMs: 5000,
  mode: 'async',
}
const parsedGood = mf.parseManifestText(JSON.stringify({ version: 1, tools: [goodEntry] }), { path: manifestPath })
check('解析：合法清单 ok=true 且没有 problems', parsedGood.ok === true && parsedGood.problems.length === 0 && parsedGood.entries.length === 1, JSON.stringify(parsedGood.problems))
check('解析：脚本存在性被核实（scriptExists）', parsedGood.entries[0].scriptExists === true)
check('解析：timeoutMs 原样保留', parsedGood.entries[0].timeoutMs === 5000)

const broken = mf.parseManifestText('{ "version": 1, "tools": [ {  ', { path: manifestPath })
check('解析：非法 JSON → fatal 非空且带行列位置', broken.ok === false && broken.fatal.includes('语法错误') && broken.fatal.includes('行'), broken.fatal)

const emptyFile = mf.parseManifestText('   ', { path: manifestPath })
check('解析：空文件 → fatal（不是静默当成没配）', emptyFile.ok === false && emptyFile.fatal.includes('空文件'))

const missingName = mf.parseManifestText(JSON.stringify({ version: 1, tools: [{ script: 'C:/x.js', description: 'd' }] }))
check('解析：缺 name → problems 里有原因', missingName.problems.some((p) => p.reason.includes('name')), JSON.stringify(missingName.problems))

const badName = mf.parseManifestText(JSON.stringify({ version: 1, tools: [{ ...goodEntry, name: 'Bad-Name' }] }))
check('解析：name 不合规（大写/连字符）→ problems 有原因', badName.problems.some((p) => p.reason.includes('name 不合规')), JSON.stringify(badName.problems))

const missingScript = mf.parseManifestText(JSON.stringify({ version: 1, tools: [{ ...goodEntry, script: '' }] }))
check('解析：缺 script → problems 有原因', missingScript.problems.some((p) => p.reason.includes('script')), JSON.stringify(missingScript.problems))

const missingDesc = mf.parseManifestText(JSON.stringify({ version: 1, tools: [{ ...goodEntry, description: '' }] }))
check('解析：缺 description → problems 有原因', missingDesc.problems.some((p) => p.reason.includes('description')))

const syncMode = mf.parseManifestText(JSON.stringify({ version: 1, tools: [{ ...goodEntry, mode: 'sync' }] }))
check('解析：mode:"sync" 被拒（不是降级成异步）',
  syncMode.problems.length === 1 && syncMode.problems[0].reason.includes('只允许 async'), JSON.stringify(syncMode.problems))

const scriptMissing = mf.parseManifestText(JSON.stringify({ version: 1, tools: [{ ...goodEntry, script: join(sandbox, 'nope.js').replace(/\\/g, '/') }] }))
check('解析：脚本不存在 → problems 里有"脚本不存在"', scriptMissing.problems.some((p) => p.reason.includes('脚本不存在')), JSON.stringify(scriptMissing.problems))

const relativeScript = mf.parseManifestText(JSON.stringify({ version: 1, tools: [{ ...goodEntry, script: './a.js' }] }))
check('解析：相对路径 → problems 有"必须是绝对路径"', relativeScript.problems.some((p) => p.reason.includes('绝对路径')))

const dup = mf.parseManifestText(JSON.stringify({ version: 1, tools: [goodEntry, { ...goodEntry, description: '第二份' }] }))
check('解析：重名 → 第二条 problems 有"重名"', dup.problems.some((p) => p.reason.includes('重名')), JSON.stringify(dup.problems))

const badVersion = mf.parseManifestText(JSON.stringify({ version: 2, tools: [] }))
check('解析：version≠1 → fatal', badVersion.ok === false && badVersion.fatal.includes('version'), badVersion.fatal)

const timeoutCap = mf.parseManifestText(JSON.stringify({ version: 1, tools: [{ ...goodEntry, timeoutMs: 99999999 }] }))
check('解析：timeoutMs 超上限 → 夹到 300000 并记 warning',
  timeoutCap.entries[0].timeoutMs === mf.MAX_TIMEOUT_MS && timeoutCap.warnings.length === 1, JSON.stringify(timeoutCap))

const noToolsArray = mf.parseManifestText(JSON.stringify({ version: 1 }))
check('解析：缺 tools 数组 → fatal', noToolsArray.ok === false && noToolsArray.fatal.includes('tools'))

const envExpand = mf.parseManifestText(
  JSON.stringify({ version: 1, tools: [{ ...goodEntry, script: '%AIYAYI_TEST_DIR%/ok.js' }] }),
  { env: { AIYAYI_TEST_DIR: sandbox.replace(/\\/g, '/') } },
)
check('解析：%变量% 展开后能通过存在性检查', envExpand.problems.length === 0 && envExpand.entries[0].scriptExists === true, JSON.stringify(envExpand.problems))

/* ------------------------------------------------------------------ *
 * 3. 加载：清单不存在 / 条目坏掉不影响别人 / enabled 语义
 * ------------------------------------------------------------------ */
const noManifest = (() => {
  const dir = join(sandbox, 'empty-root')
  mkdirSync(dir, { recursive: true })
  return mf.loadManifest({ root: dir })
})()
check('加载：清单不存在 → exists:false 且 ok:true（不报错）', noManifest.exists === false && noManifest.ok === true && noManifest.fatal === '')

writeManifest({
  version: 1,
  tools: [
    { ...goodEntry, name: 'on_tool', script: SCRIPT_OK.replace(/\\/g, '/') },
    { ...goodEntry, name: 'off_tool', enabled: false },
    { ...goodEntry, name: 'sync_tool', mode: 'sync' },
    { ...goodEntry, name: 'gone_tool', script: join(sandbox, 'ghost.js').replace(/\\/g, '/') },
  ],
})

const registered = []
const disposed = new Set()
const makeCtx = () => ({
  effect(fn) { fn(); return () => {} },
  on() { return () => {} },
  tools: {
    register(def) {
      registered.push(def)
      return () => disposed.add(def.name)
    },
  },
  logger: { info: () => {}, warn: () => {} },
})
const api = tk.apply(makeCtx(), { usageEnabled: false })
const names = registered.map((d) => d.name)
check('注册：三个基础工具 + 两个管理工具都在', ['toolkit_cmd', 'toolkit_read', 'toolkit_write', 'toolbox_list', 'toolbox_reload'].every((n) => names.includes(n)), names.join(','))
check('注册：enabled:true 的清单工具注册上了', names.includes('on_tool'), names.join(','))
check('注册：enabled:false 的不注册', !names.includes('off_tool'), names.join(','))
check('注册：mode:sync 的不注册', !names.includes('sync_tool'), names.join(','))
check('注册：脚本不存在的不注册', !names.includes('gone_tool'), names.join(','))
check('注册：包内不再有 mem_sync / watch_read / pkg_stats', !names.includes('mem_sync') && !names.includes('watch_read') && !names.includes('pkg_stats'), names.join(','))
check('注册：清单工具在 own-tools 里被动态放行', (await import(libUrl('own-tools.js'))).isOwnTool('on_tool') === true)
check('注册：TOOL_NAMES 只剩 3+2', tk.TOOL_NAMES.join(',') === 'toolkit_cmd,toolkit_read,toolkit_write,toolbox_list,toolbox_reload', tk.TOOL_NAMES.join(','))
check('注册：目录 list 与注册面一致', api.list().join(',') === names.join(','), api.list().join(','))

/* 3b. 清单 JSON 坏掉：必须报回会话（不许静默） */
const issuesByCtx = []
const badCtx = (collected) => ({
  effect(fn) { fn(); return () => {} },
  on(event, handler) {
    if (event === 'agent/pre-step') collected.push(handler)
    return () => {}
  },
  tools: { register() { return () => {} } },
  logger: { info: () => {}, warn: () => {} },
})
writeFileSync(manifestPath, '{ "version": 1, "tools": [', 'utf8')
const badHandlers = []
tk.apply(badCtx(badHandlers), { usageEnabled: false })
check('坏清单：注册了 pre-step 上报钩子', badHandlers.length === 1)
const injected = []
const decision = await badHandlers[0]({ agent: { id: 'sess-1' } }, async () => ({ kind: 'ok', messages: [] }))
const texts = (decision.messages ?? []).map((m) => m.content?.[0]?.text ?? '').join('\n')
check('坏清单：会话里被注入了一条"工具清单有问题"', texts.includes('[工具清单]') && texts.includes('语法错误'), JSON.stringify(texts).slice(0, 300))
check('坏清单：注入的消息结构合法（source 无 undefined、可 JSON 往返）',
  decision.messages.at(-1)?.source?.kind === 'aiyayi-toolkit'
  && Object.values(decision.messages.at(-1)?.source ?? {}).every((v) => v !== undefined)
  && JSON.stringify(decision.messages.at(-1)) === JSON.stringify(JSON.parse(JSON.stringify(decision.messages.at(-1)))))
const decision2 = await badHandlers[0]({ agent: { id: 'sess-1' } }, async () => ({ kind: 'ok', messages: [] }))
check('坏清单：同一个 agent 不重复刷屏', (decision2.messages ?? []).length === 0)

/* 3c. 条目级问题也报回会话（带工具名与原因） */
writeManifest({ version: 1, tools: [{ ...goodEntry, name: 'bad_mode', mode: 'sync' }] })
const entryHandlers = []
tk.apply(badCtx(entryHandlers), { usageEnabled: false })
const entryDecision = await entryHandlers[0]({ agent: { id: 'sess-2' } }, async () => ({ kind: 'ok', messages: [] }))
const entryText = (entryDecision.messages ?? []).map((m) => m.content?.[0]?.text ?? '').join('\n')
check('条目问题：注入文本里有工具名和原因', entryText.includes('bad_mode') && entryText.includes('只允许 async'), entryText.slice(0, 300))

/* ------------------------------------------------------------------ *
 * 4. 异步：立刻返回 taskId / 后台跑完 followup / 超时 / 失败
 * ------------------------------------------------------------------ */
ta.__testing.setCreateUserMessageLoader(async () => (input) => ({ ...input, __built: true }))
ta.__testing.clearTasks()

const followups = []
const fakeExec = { agent: { id: 'sess-async', followup: (message) => followups.push(message) } }

/** 用"最朴素"的 manager 直接起一个清单工具（不经 apply，避免受当前清单状态影响）。 */
function makeManagerWith(entryRaw) {
  const parsed = mf.parseManifestText(JSON.stringify({ version: 1, tools: [entryRaw] }), { path: manifestPath })
  const entry = parsed.entries[0]
  check(`夹具：${entryRaw.name} 校验通过`, parsed.problems.length === 0, JSON.stringify(parsed.problems))
  const defs = new Map()
  const manager = mf.createManifestManager({
    addTool: (name, def, impl) => { defs.set(name, { def, impl }) },
    removeTool: (name) => defs.delete(name),
    registerOwnTool: () => {},
    cfg: { manifestPath },
    env: { ...process.env },
  })
  return { entry, defs, manager }
}

// 4a) 成功路径：立刻返回 + 后台 followup
{
  const { entry } = makeManagerWith({ ...goodEntry, name: 'fast_tool', script: SCRIPT_OK.replace(/\\/g, '/'), timeoutMs: 10000 })
  const startedAt = Date.now()
  const handle = mf.executeManifestTool(entry, {}, { exec: fakeExec, cfg: {} })
  const elapsed = Date.now() - startedAt
  check('异步：立刻返回（<300ms，不等脚本跑完）', elapsed < 300, `${elapsed}ms`)
  check('异步：返回 status=started 且带 taskId', handle.status === 'started' && handle.taskId.startsWith('tk-'), JSON.stringify(handle))
  check('异步：返回结构过 shape 归一（字段齐全）', Object.keys(handle).join(',') === 'ok,status,taskId,tool,hint,error')
  const record = await ta.waitForTask(handle.taskId)
  check('异步：后台跑完 followup 真的被调到', followups.length === 1, JSON.stringify(followups))
  check('异步：投递正文带工具名与退出码', (record.summary ?? '').includes('fast_tool') && (record.summary ?? '').includes('退出码 0'), record.summary)
  check('异步：投递正文带了脚本 stdout 的 JSON 内容', (record.summary ?? '').includes('脚本跑完了'), record.summary)
  check('异步：任务记录 status=success / delivery=sent', record.status === 'success' && record.delivery === 'sent', JSON.stringify(record))
}

// 4b) 慢脚本：调用方不受阻塞
{
  followups.length = 0
  const { entry } = makeManagerWith({ ...goodEntry, name: 'slow_tool', script: SCRIPT_SLOW.replace(/\\/g, '/'), timeoutMs: 10000 })
  const startedAt = Date.now()
  const handle = mf.executeManifestTool(entry, {}, { exec: fakeExec, cfg: {} })
  const elapsed = Date.now() - startedAt
  check('异步：慢脚本（1.5 秒）也是立刻返回', elapsed < 300 && handle.status === 'started', `${elapsed}ms`)
  check('异步：慢脚本此刻还没投递（证明没在等）', followups.length === 0, JSON.stringify(followups))
  const record = await ta.waitForTask(handle.taskId)
  check('异步：慢脚本跑完后投递了一条', followups.length === 1 && (record.summary ?? '').includes('慢活跑完了'), record.summary)
}

// 4c) 超时：被杀 + 报回
{
  followups.length = 0
  const { entry } = makeManagerWith({ ...goodEntry, name: 'hang_tool', script: SCRIPT_HANG.replace(/\\/g, '/'), timeoutMs: 1200 })
  const handle = mf.executeManifestTool(entry, {}, { exec: fakeExec, cfg: {} })
  const record = await ta.waitForTask(handle.taskId)
  check('异步：超时任务记录 status=timeout', record.status === 'timeout', JSON.stringify({ status: record.status, error: record.error }))
  check('异步：超时投递正文写明超时上限', (record.summary ?? '').includes('超时') && (record.summary ?? '').includes('1200ms'), record.summary)
  check('异步：超时也投递了（不静默）', followups.length === 1, JSON.stringify(followups))
}

// 4d) 非 0 退出码：报回退出码 + stderr 摘要
{
  followups.length = 0
  const { entry } = makeManagerWith({ ...goodEntry, name: 'fail_tool', script: SCRIPT_FAIL.replace(/\\/g, '/'), timeoutMs: 10000 })
  const handle = mf.executeManifestTool(entry, {}, { exec: fakeExec, cfg: {} })
  const record = await ta.waitForTask(handle.taskId)
  check('异步：失败任务 status=error', record.status === 'error', JSON.stringify(record.status))
  check('异步：失败正文带退出码 7', (record.summary ?? '').includes('退出码 7'), record.summary)
  check('异步：失败正文带 stderr 摘要', (record.summary ?? '').includes('boom: 读不到配置文件'), record.summary)
}

// 4e) 非 JSON 输出也能读（原样展示）
{
  followups.length = 0
  const { entry } = makeManagerWith({ ...goodEntry, name: 'plain_tool', script: SCRIPT_BADJSON.replace(/\\/g, '/'), timeoutMs: 10000 })
  const handle = mf.executeManifestTool(entry, {}, { exec: fakeExec, cfg: {} })
  const record = await ta.waitForTask(handle.taskId)
  check('异步：非 JSON 输出原样展示且判成功（退出码 0）', record.status === 'success' && (record.summary ?? '').includes('这不是 JSON'), record.summary)
}

// 4f) 脚本在注册后被删：execute 时预检同步报错（不起后台任务）
{
  const throwaway = makeScript('vanish.js', 'process.stdout.write("x")')
  const { entry } = makeManagerWith({ ...goodEntry, name: 'vanish_tool', script: throwaway.replace(/\\/g, '/') })
  rmSync(throwaway)
  const before = ta.listTasks().length
  const handle = mf.executeManifestTool(entry, {}, { exec: fakeExec, cfg: {} })
  check('预检：脚本没了 → 同步返回 error（不起后台任务）', handle.ok === false && handle.status === 'error' && handle.error.includes('脚本不存在'), JSON.stringify(handle))
  check('预检：task 表没多出记录', ta.listTasks().length === before)
}

// 4g) 环境变量/参数透传：脚本能拿到 AIYAYI_TOOLBOX_ARGS 与清单 env
{
  followups.length = 0
  const echo = makeScript('echo.js', `
const args = JSON.parse(process.env.AIYAYI_TOOLBOX_ARGS || '{}')
const [fixed] = process.argv.slice(2)
process.stdout.write(JSON.stringify({
  ok: true,
  hint: 'echo',
  tool: args.tool,
  message: args.args.message,
  fixed,
  env: process.env.AIYAYI_TEST_ENV,
  root: process.env.AIYAYI_TOOLBOX_ROOT,
}) + '\\n')
`)
  const { entry } = makeManagerWith({
    ...goodEntry,
    name: 'echo_tool',
    script: echo.replace(/\\/g, '/'),
    args: ['fixed-arg'],
    env: { AIYAYI_TEST_ENV: 'from-manifest' },
  })
  const handle = mf.executeManifestTool(entry, { message: '你好' }, { exec: fakeExec, cfg: { __root: root, __manifestPath: manifestPath } })
  const record = await ta.waitForTask(handle.taskId)
  const summary = record.summary ?? ''
  check('透传：AIYAYI_TOOLBOX_ARGS 带了工具名与调用参数', summary.includes('"tool": "echo_tool"') && summary.includes('你好'), summary)
  check('透传：固定 args 作为 argv 传入', summary.includes('fixed-arg'), summary)
  check('透传：清单 env 注入到脚本环境', summary.includes('from-manifest'), summary)
  check('透传：记忆根经 AIYAYI_TOOLBOX_ROOT 传入', summary.includes(root.replace(/\\/g, '\\\\')) || summary.includes(root), summary)
}

/* ------------------------------------------------------------------ *
 * 5. 管理工具：toolbox_list / toolbox_reload
 * ------------------------------------------------------------------ */
writeManifest({
  version: 1,
  tools: [
    { ...goodEntry, name: 'list_on', script: SCRIPT_OK.replace(/\\/g, '/') },
    { ...goodEntry, name: 'list_off', enabled: false },
    { ...goodEntry, name: 'list_gone', script: join(sandbox, 'no-such.js').replace(/\\/g, '/') },
  ],
})
const mgrRegistered = new Map()
const manager = mf.createManifestManager({
  addTool: (name, def, impl) => mgrRegistered.set(name, { def, impl }),
  removeTool: (name) => mgrRegistered.delete(name),
  registerOwnTool: () => {},
  cfg: { manifestPath },
  env: { ...process.env },
})
const loadReport = manager.load()
check('加载报告：注册了 enabled 的那条', loadReport.registered.join(',') === 'list_on', JSON.stringify(loadReport))
check('加载报告：enabled:false 与脚本缺失都被列进 skipped', loadReport.skipped.some((s) => s.includes('list_off')) && loadReport.skipped.some((s) => s.includes('list_gone')), JSON.stringify(loadReport.skipped))
check('加载报告：脚本缺失在 problems 里有原因', loadReport.problems.some((p) => p.includes('脚本不存在')), JSON.stringify(loadReport.problems))

const listTool = registered.find((d) => d.name === 'toolbox_list')
check('toolbox_list：注册面里有它', Boolean(listTool))
// 用当前 apply 出来的那份（清单此时是上面写的那份）
const listValue = await registered.find((d) => d.name === 'toolbox_list').execute({})
check('toolbox_list：返回结构过 schema（字段齐全）', Object.keys(listValue).join(',') === 'ok,exists,path,root,error,tools,problems', Object.keys(listValue).join(','))
check('toolbox_list：列出清单里的每一条（含 enabled:false）', listValue.tools.length === 3 && listValue.tools.map((t) => t.name).join(',') === 'list_on,list_off,list_gone', JSON.stringify(listValue.tools.map((t) => t.name)))
check('toolbox_list：每条都有 name/enabled/mode/script/scriptExists/registered/timeoutMs/reason',
  listValue.tools.every((t) => ['name', 'enabled', 'mode', 'script', 'scriptExists', 'registered', 'timeoutMs', 'reason'].every((k) => k in t)))
check('toolbox_list：mode 全部是 async', listValue.tools.every((t) => t.mode === 'async'))
check('toolbox_list：脚本缺失的那条 scriptExists=false 且有 reason', listValue.tools.some((t) => t.scriptExists === false && t.reason.includes('脚本不存在')), JSON.stringify(listValue.tools))
// 语义：toolbox_list 只巡检、不注册（这几条是刚写进清单的，还没 reload 过 → registered 全 false）。
check('toolbox_list：只巡检不改状态（新清单条目 registered 全为 false）', listValue.tools.every((t) => t.registered === false), JSON.stringify(listValue.tools.map((t) => [t.name, t.registered])))

// reload：改清单后重载，旧工具被注销、新工具注册上
writeManifest({ version: 1, tools: [{ ...goodEntry, name: 'reloaded_tool', script: SCRIPT_OK.replace(/\\/g, '/') }] })
const reloadValue = await registered.find((d) => d.name === 'toolbox_reload').execute({})
check('toolbox_reload：返回结构过 schema', Object.keys(reloadValue).join(',') === 'ok,exists,path,removed,registered,skipped,problems,hint,error', Object.keys(reloadValue).join(','))
check('toolbox_reload：注销了旧的 on_tool', reloadValue.removed.includes('on_tool'), JSON.stringify(reloadValue.removed))
check('toolbox_reload：注册了新的 reloaded_tool', reloadValue.registered.includes('reloaded_tool'), JSON.stringify(reloadValue.registered))
check('toolbox_reload：没有 problems 时 ok=true', reloadValue.ok === true, JSON.stringify(reloadValue))
check('toolbox_reload：旧工具真的被 disposer 摘掉了', disposed.has('on_tool'))
const namesAfterReload = api.list()
check('toolbox_reload：目录里不再有 on_tool、已有 reloaded_tool', !namesAfterReload.includes('on_tool') && namesAfterReload.includes('reloaded_tool'), namesAfterReload.join(','))

// reload 遇到坏清单：注销旧工具 + 明确报错
writeFileSync(manifestPath, 'not json at all', 'utf8')
const reloadBad = await registered.find((d) => d.name === 'toolbox_reload').execute({})
check('toolbox_reload：坏清单 → ok=false 且 problems 里有语法错误', reloadBad.ok === false && reloadBad.problems.some((p) => p.includes('语法错误')), JSON.stringify(reloadBad))
check('toolbox_reload：坏清单也把旧清单工具注销了（不留半死状态）', reloadBad.removed.includes('reloaded_tool'), JSON.stringify(reloadBad.removed))

/* ------------------------------------------------------------------ *
 * 6. schema / own-tools / 包内不再有那三个工具
 * ------------------------------------------------------------------ */
const hostTypes = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']
function collectTypeNodes(node, path, hits) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return hits
  if ('type' in node && node.type !== undefined) hits.push({ path, value: node.type })
  for (const [key, child] of Object.entries(node.properties ?? {})) collectTypeNodes(child, `${path}.${key}`, hits)
  if (node.items) collectTypeNodes(node.items, `${path}.items`, hits)
  return hits
}
for (const def of registered) {
  const violations = collectTypeNodes(def.parameters, 'parameters', []).concat(collectTypeNodes(def.output?.schema, 'output', []))
    .filter((node) => typeof node.value !== 'string' || !hostTypes.includes(node.value))
  check(`schema：${def.name} type 全是单字符串`, violations.length === 0, JSON.stringify(violations))
  const out = def.output?.schema
  check(`schema：${def.name} output 的 required 都在 properties 里`,
    (out.required ?? []).every((k) => (out.properties ?? {})[k] !== undefined), JSON.stringify(out.required))
  check(`schema：${def.name} 有 render 且是函数`, typeof def.output?.render === 'function')
}
const manifestDef = mf.buildToolDef(mf.parseManifestText(JSON.stringify({ version: 1, tools: [{
  ...goodEntry, name: 'schema_tool', params: { message: { type: 'string', required: true } },
}] })).entries[0])
check('schema：清单工具 parameters 反映 params 声明', manifestDef.parameters.properties.message?.type === 'string' && manifestDef.parameters.required.join(',') === 'message', JSON.stringify(manifestDef.parameters))
check('schema：清单工具 output 五字段 required 齐全', manifestDef.output.schema.required.join(',') === 'ok,status,taskId,tool,hint,error')
const renderText = manifestDef.output.render({}, mf.shapeManifestOutput({ ok: true, status: 'started', taskId: 'tk-1', tool: 'schema_tool', hint: '开跑' }))
check('render：成功路径给出 hint + taskId', JSON.stringify(renderText).includes('tk-1'), JSON.stringify(renderText))
const renderFail = manifestDef.output.render({}, mf.shapeManifestOutput({ ok: false, status: 'error', tool: 'schema_tool', error: '脚本不存在' }))
check('render：失败路径给出原因', JSON.stringify(renderFail).includes('脚本不存在'), JSON.stringify(renderFail))

const ownTools = await import(libUrl('own-tools.js'))
check('own-tools：三个基础工具 + 两个管理工具都在静态表里',
  ['toolkit_cmd', 'toolkit_read', 'toolkit_write', 'toolbox_list', 'toolbox_reload'].every((n) => ownTools.OWN_TOOLS.includes(n)), ownTools.OWN_TOOLS.join(','))
check('own-tools：mem_sync / watch_read / pkg_stats 不在静态表里（已移出安装包）',
  ['mem_sync', 'watch_read', 'pkg_stats'].every((n) => !ownTools.OWN_TOOLS.includes(n)), ownTools.OWN_TOOLS.join(','))
check('own-tools：三者仍被判为"自己的工具"→ 会不会误挡？答：不再注册，isOwnTool 无意义；但 registered 动态放行可用',
  ownTools.isOwnTool('on_tool') === true || ownTools.isOwnTool('reloaded_tool') === true)

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
