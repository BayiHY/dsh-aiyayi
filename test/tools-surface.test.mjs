/**
 * 工具面 + 注入面自检（1.5.0）。
 *
 * 为什么要有这道闸：`lib/index.js` 的工具 schema 一旦不合规（顶层 `required`
 * 出现在属性里、additionalProperties 位置不对…），激活会静默失败、整个 preset
 * 被登记处摘掉，而 `node --check` 与纯逻辑单测全是绿的（见 README 坑 #1）。
 * 这里用假 ctx 走一遍真实 `apply()`，把注册的工具、注入的段落、pre-step 消息
 * 都拿到手逐条断言，不依赖真实 DSH 进程。
 *
 * 另外验两件事：
 *  - `memory_location` / `memory_relocate` 真的注册上了，且名字进了 own-tools 白名单；
 *  - 指路根不可达时，pre-step 注入的是 `[记忆位置] ⚠` 警告行，而不是"建议迁移"那行。
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-tools-'))
const root = join(sandbox, 'root')
mkdirSync(join(root, 'memories'), { recursive: true })
writeFileSync(join(root, 'memory.md'), '# 阿依娅伊的记忆\n- [2026-11-01] 事情｜测试条目\n', 'utf8')
process.env.AIYAYI_HOME = root

const { apply: applyMemory, name: memoryName } = await import(libUrl('index.js'))
const { apply: applyPresence } = await import(libUrl('presence.js'))
const { __testing: homeTesting } = await import(libUrl('home.js'))

// **测试隔离**：指路文件也定向到沙盘。不隔离的话，若真机已经把记忆搬走
// （2026-11-09 用户真搬到了 F 盘），这里的 status 会是 migrated，
// 那些"未搬家"的断言就全部假失败——测试不该依赖真机处于哪种状态。
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

const toolDefs = []
const sections = []
const preStepHandlers = []

/** 假 ctx：只实现插件真正用到的 effect/on/tools/systemPrompt。 */
const makeCtx = () => ({
  effect(fn) {
    fn()
    return () => {}
  },
  on(event, handler) {
    if (event === 'agent/pre-step') preStepHandlers.push(handler)
    return () => {}
  },
  tools: {
    register(def) {
      toolDefs.push(def)
      return () => {}
    },
  },
  systemPrompt: {
    section(def) {
      sections.push(def)
      return () => {}
    },
  },
})

applyMemory(makeCtx())
check('aiyayi-memory 模块名不变（Loader id 靠它）', memoryName === 'aiyayi-memory', memoryName)

const names = toolDefs.map((def) => def.name)
check(
  '五个记忆工具全注册上（含 1.5.0 新增两个）',
  ['remember', 'recall', 'memory_organize', 'memory_location', 'memory_relocate'].every((n) => names.includes(n)),
  names,
)

/* 逐个工具做 schema 体检：只允许标准 JSON Schema 形状。 */
for (const def of toolDefs) {
  const params = def.parameters ?? {}
  check(`${def.name}: parameters 是 object`, params.type === 'object', params.type)
  check(`${def.name}: parameters 有 properties`, params.properties !== undefined && typeof params.properties === 'object', params.properties)
  check(
    `${def.name}: properties 里没有塞 required:true（坑 #1 的写法）`,
    Object.values(params.properties ?? {}).every((prop) => prop.required === undefined),
    JSON.stringify(params.properties ?? {}),
  )
  check(`${def.name}: output.schema 顶层 type 是 object`, def.output?.schema?.type === 'object', def.output?.schema?.type)
  check(`${def.name}: 有 render（模型看到的是 render 的文本）`, typeof def.output?.render === 'function', typeof def.output?.render)
  check(`${def.name}: output.schema 的 required 都在 properties 里`, requiredInProps(def.output?.schema), summariseRequired(def.output?.schema))
}

function requiredInProps(schema) {
  const required = schema?.required ?? []
  const props = Object.keys(schema?.properties ?? {})
  return required.every((key) => props.includes(key))
}
function summariseRequired(schema) {
  return JSON.stringify({ required: schema?.required ?? [], properties: Object.keys(schema?.properties ?? {}) })
}

/* memory_location 只读：调一次，断言它不建目录不写文件，且字段齐。 */
const locTool = toolDefs.find((def) => def.name === 'memory_location')
const beforeTree = JSON.stringify(listing(root))
const locResult = await locTool.execute({})
const afterTree = JSON.stringify(listing(root))
check(
  'memory_location 返回 root/source/decided/reachable/pointer',
  typeof locResult.root === 'string' &&
    typeof locResult.source === 'string' &&
    typeof locResult.decided === 'boolean' &&
    typeof locResult.reachable === 'boolean' &&
    typeof locResult.pointer === 'string',
  JSON.stringify(locResult),
)
check('memory_location 只读：调用前后目录内容不变', beforeTree === afterTree, `${beforeTree} → ${afterTree}`)
check('memory_location 的 render 文本带真实路径', locTool.output.render({}, locResult)[0].text.includes(root), locTool.output.render({}, locResult)[0].text)
check('detail 里有位置/来源/体检信息', /来源：/.test(locResult.detail) && /体检：/.test(locResult.detail), locResult.detail)

// 1.5.1 防误判三件套：status 独立字段、正向自检、状态说明不像报错。
check('memory_location 返回独立 status 字段', typeof locResult.status === 'string' && locResult.status.length > 0, JSON.stringify(locResult))
check('未搬家时 status 是 ok（不是故障）', locResult.status === 'ok', locResult.status)
check('statusText 明说"正常"', /正常/.test(locResult.statusText ?? ''), locResult.statusText)
check('返回正向自检 relocateSupported', locResult.relocateSupported === true, JSON.stringify(locResult))
check('返回 codeVersion（代码里的版本，不读 package.json）', /^\d+\.\d+\.\d+$/.test(locResult.codeVersion ?? ''), locResult.codeVersion)
check('返回 layoutVersion', Number.isInteger(locResult.layoutVersion), locResult.layoutVersion)
check('detail 里有自检行', /自检：/.test(locResult.detail), locResult.detail)
check('detail 里点了"回退怎么办"', /回退/.test(locResult.detail), locResult.detail)
check('detail 里写了优先级（指路文件 > 环境变量 > 默认）', /环境变量/.test(locResult.detail) && /默认/.test(locResult.detail), locResult.detail)

/* memory_relocate：dryRun 不需要 confirm，且必须先能出计划。 */
const relTool = toolDefs.find((def) => def.name === 'memory_relocate')
// 目标必须落在**非系统盘**：dryRun 同样走 preflight，而 preflight 会按规矩拒系统盘目标。
const { statSync: statForDrive } = await import('node:fs')
const nonSystemDrive = ['G:', 'F:', 'I:', 'J:', 'E:', 'D:'].find((drive) => {
  try {
    return statForDrive(`${drive}\\`).isDirectory()
  } catch {
    return false
  }
})
const wouldBeTarget = nonSystemDrive ? join(`${nonSystemDrive}\\`, 'aiyayi-tools-target-probe') : join(sandbox, 'somewhere')
const dryOut = await relTool.execute({ target: wouldBeTarget, dryRun: true, confirm: true })
check('dryRun 返回计划而不是直接搬', dryOut.dryRun === true && dryOut.ok === true, JSON.stringify(dryOut))
check('dryRun 不谎报校验通过', dryOut.hashMatched === false, dryOut.hashMatched)
check('dryRun 后目标目录仍不存在', !existsSyncSafe(wouldBeTarget), wouldBeTarget)

/* memory_relocate 的 confirm 闸：没传 true 必须直接拒绝，且不做任何写操作。 */
let confirmErr = null
try {
  await relTool.execute({ target: wouldBeTarget })
} catch (error) {
  confirmErr = error
}
check('memory_relocate 不传 confirm:true 直接拒绝', confirmErr !== null && /confirm/.test(confirmErr.message), confirmErr?.message)
check('拒绝文案提示可以先 dryRun', /dryRun/.test(confirmErr?.message ?? ''), confirmErr?.message)
check('拒绝时没有创建目标目录', !existsSyncSafe(wouldBeTarget), wouldBeTarget)

function existsSyncSafe(p) {
  try {
    return statSyncSafe(p)
  } catch {
    return false
  }
}
function statSyncSafe(p) {
  const { statSync } = require('node:fs')
  statSync(p)
  return true
}
function listing(p) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      out.push(abs.slice(p.length))
      if (entry.isDirectory()) walk(abs)
    }
  }
  walk(p)
  return out.sort()
}

/* presence 侧：注入行接上、位置提示按可达性分支。 */
applyPresence(makeCtx())
check('presence 注册了 pre-step 监听器', preStepHandlers.length > 0, preStepHandlers.length)
check('systemPrompt 段落注册了（核心记忆）', sections.length > 0 && typeof sections[0].text === 'function', sections.length)

const presenceHandler = preStepHandlers[0]
const safeAgent = { id: 'a1', session: { id: 's1' } }
const decision = { kind: 'proceed', messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }] }
const result = await presenceHandler({ agent: safeAgent, step: 1, signal: new AbortController().signal }, async () => decision)
const text = (result.messages.at(-1)?.content ?? []).map((b) => b.text).join('\n')
check('pre-step 注入了 [时间] 行', text.includes('[时间] 现在'), text)

// 可达 + 未搬家（沙盘在 C 的 tmpdir 上 → 算系统盘）。
// 1.5.1 起这行改叫 `[记忆]`；**1.5.3 起改成"待办"口吻且只在本会话首轮给一次**。
// 断言不再写死路径（那太脆），验的是这次真正修好的行为：
// 首轮给出待办、后续不再重复、文案要求她"主动提"而不是把"正常"当无事。
const locLine = text.split('\n').find((line) => line.includes('[记忆]'))
check('首轮 pre-step 带 [记忆] 待办行（系统盘且未搬家）', locLine !== undefined, text)
check('文案是待办口吻而不是"正常"（1.5.3 修的就是这个）', locLine !== undefined && /该跟他说一句/.test(locLine), locLine)
check('文案明确要求"主动提一句"', locLine !== undefined && /主动提/.test(locLine), locLine)
check('提示行给了推荐盘线索', locLine !== undefined && /推荐/.test(locLine), locLine)
check(
  '提示行不再声称"正常"（否则她又会当成不用管）',
  locLine !== undefined && !/未搬家（正常）/.test(locLine),
  locLine,
)

// 关键：**同一会话第二次开口不再念这条**（娅伊提出"每次都念很烦"的分寸问题）。
const second = await presenceHandler({ agent: safeAgent, step: 1, signal: new AbortController().signal }, async () => decision)
const secondText = (second.messages.at(-1)?.content ?? []).map((b) => b.text).join('\n')
check('同会话第二轮不再重复 [记忆] 待办（不每轮念）', !secondText.includes('[记忆]'), secondText)
check('第二轮仍有 [时间]（别的注入不受影响）', secondText.includes('[时间] 现在'), secondText)

// 造一个"不可达"的指路根：注入必须变成 ⚠ 警告，而不是建议迁移。
// 注意指路文件是**固定位置**的（~/.dsh/aiyayi/location.json），不是跟着 root 走；
// 测试里必须先用 setPointerPath 把它换到沙盘，否则要么测不到、要么写脏真机。
// （homeTesting 已在文件顶部 import 并隔离过一次，这里直接复用，别重复声明。）
const { pointerFile } = await import(libUrl('home.js'))
homeTesting.setPointerPath(join(sandbox, 'sandbox-pointer', 'location.json'))
mkdirSync(join(sandbox, 'sandbox-pointer'), { recursive: true })
const ghostRoot = join(sandbox, 'no-such-dir-yet')
writeFileSync(pointerFile(), `${JSON.stringify({ version: 1, root: ghostRoot }, null, 2)}\n`, 'utf8')
homeTesting.pointerCacheReset()

const broken = await presenceHandler({ agent: safeAgent, step: 1, signal: new AbortController().signal }, async () => decision)
const brokenText = (broken.messages.at(-1)?.content ?? []).map((b) => b.text).join('\n')
check('不可达时注入的是 ⚠ 警告行（不是"建议迁移"）', brokenText.includes('[记忆] ⚠'), brokenText)
check('不可达时警告行带真实路径与来源', brokenText.includes(ghostRoot) && brokenText.includes('location.json'), brokenText)
check('不可达时没有建出那个空目录', !existsSyncSafe(ghostRoot), ghostRoot)

// 无论正常/失败都清沙盘（断言失败时会抛错跳过下面那行，实测会留垃圾目录）。
process.on('exit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 清理失败不该盖掉真正的测试结果 */
  }
})
rmSync(sandbox, { recursive: true, force: true })
console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)
