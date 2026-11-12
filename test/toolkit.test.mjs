/**
 * 工具包中间层（lib/toolkit.js）本地单测。
 *
 * 覆盖要点（任务书 + 设计方案 docs/开发方案-工具包中间层.md）：
 *   1) toolkit_cmd 白名单通过/拒绝（publish/push 等变更类、元字符拼接）；输出截断；超时杀进程；
 *   2) toolkit_read 存在 / 不存在 / 目录 / maxBytes 截断；
 *   3) toolkit_write 白名单内成功+覆盖自动备份、白名单外拒绝、路径穿越拒绝、超 64KB 拒绝；
 *   4) 调用留痕：JSONL 追加、环形截断（超 500→留最新）、损坏行不抛、写留痕失败不抛；
 *   5) 工具注册/schema/own-tools 放行 + 工具目录 add/remove/list；
 *   6b) 回归：宿主 schema 校验只接受单 type 字符串（1.5.39，type 数组 = 注册必败）。
 *
 * 全程在临时沙盘里造记忆根（AIYAYI_HOME 定向 + 指路文件隔离），绝不碰真实记忆目录。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-toolkit-'))
const root = join(sandbox, 'root') // 充当记忆根（toolkit_write 的默认白名单根）
mkdirSync(root, { recursive: true })
process.env.AIYAYI_HOME = root

const tk = await import(libUrl('toolkit.js'))
const { __testing: homeTesting } = await import(libUrl('home.js'))
// 指路文件隔离到沙盘，避免真机 location.json 覆盖 AIYAYI_HOME。
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ------------------------------------------------------------------ *
 * 1. 纯函数：白名单匹配 / 元字符 / 变更类黑名单 / 脱敏 / 截断
 * ------------------------------------------------------------------ */
const WL = tk.mergeConfig({}).cmdWhitelist
check('白名单：git log 通过', tk.matchesWhitelist('git log', WL) === 'git log')
check('白名单：git log --oneline 通过（前缀整词）', tk.matchesWhitelist('git log --oneline', WL) === 'git log')
check('白名单：git logfile 不通过（不是整词）', tk.matchesWhitelist('git logfile', WL) === null)
check('白名单：大小写不敏感（GIT STATUS）', tk.matchesWhitelist('GIT STATUS', WL) === 'git status')
check('白名单：dir /b 通过', tk.matchesWhitelist('dir /b', WL) === 'dir')
check('白名单：git push 不通过', tk.matchesWhitelist('git push origin main', WL) === null)
check('白名单：npm publish 不通过', tk.matchesWhitelist('npm publish', WL) === null)
check('白名单：rm -rf 不通过', tk.matchesWhitelist('rm -rf /', WL) === null)
check('元字符：重定向 > 拒绝', tk.findShellMetachar('git log > out.txt') === '>')
check('元字符：追加 >> 拒绝', tk.findShellMetachar('git log >> out.txt') === '>')
check('元字符：管道 | 拒绝', tk.findShellMetachar('git status | rm -rf /') === '|')
check('元字符：命令替换 $( 拒绝', tk.findShellMetachar('git log $(whoami)') === '$')
check('元字符：反引号拒绝', tk.findShellMetachar('git log `whoami`') === '`')
check('元字符：串接 ; 拒绝', tk.findShellMetachar('git status; rm x') === ';')
check('元字符：干净的 git log 放行', tk.findShellMetachar('git log --oneline') === null)
check('元字符：括号不拦（子 shell 以 ( 开头本来就过不了白名单前缀；$ 已拦命令替换）', tk.findShellMetachar('node -e "console.log(1)"') === null)
check('黑名单：npm publish → publish（动词在第二个词）', tk.findDenyWord('npm publish --access public', tk.mergeConfig({}).cmdDenyWords) === 'publish')
check('黑名单：git push → push', tk.findDenyWord('git push origin main', tk.mergeConfig({}).cmdDenyWords) === 'push')
check('黑名单：rm -rf → rm（动词在第一个词）', tk.findDenyWord('rm -rf /', tk.mergeConfig({}).cmdDenyWords) === 'rm')
check('黑名单：git log 不误伤', tk.findDenyWord('git log --oneline', tk.mergeConfig({}).cmdDenyWords) === null)
check('黑名单：dir /b 不误伤（开关词跳过）', tk.findDenyWord('dir /b', tk.mergeConfig({}).cmdDenyWords) === null)
check('脱敏：--token=xxx 打码', !tk.redactSensitive('git status --token=supersecretvalue123').includes('supersecretvalue123'))
check('脱敏：bearer 打码', !tk.redactSensitive('curl -H "Bearer abcdef123456"').includes('abcdef123456'), tk.redactSensitive('curl -H "Bearer abcdef123456"'))
check('脱敏：URL 用户名密码打码', !tk.redactSensitive('https://user:pass123@host/x').includes('pass123'))
check('截断：超长标注 [truncated]', tk.truncateWithMark('x'.repeat(3000), 2048).truncated === true && tk.truncateWithMark('x'.repeat(3000), 2048).text.endsWith('[truncated]'))
check('截断：不超长原样返回', tk.truncateWithMark('short', 2048).truncated === false)

/* ------------------------------------------------------------------ *
 * 2. toolkit_cmd：成功 / 拒绝 / 截断 / 超时
 * ------------------------------------------------------------------ */
const cfgCmd = tk.mergeConfig({
  cmdWhitelist: ['node -e', ...WL],
  usageEnabled: false, // 本节不留痕（留痕在独立小节专项测）
})

const good = await tk.runCmd({ cmd: 'node -e "console.log(\'hello-toolkit-9183\')"', timeoutMs: 15000 }, cfgCmd)
check('cmd：成功执行返回 ok:true', good.ok === true, JSON.stringify(good))
check('cmd：stdout 带输出', good.stdout.includes('hello-toolkit-9183'), good.stdout)
check('cmd：exitCode 0', good.exitCode === 0)
check('cmd：durationMs 是数字', typeof good.durationMs === 'number' && good.durationMs >= 0)
check('cmd：whitelisted 记录命中前缀', good.whitelisted === 'node -e', good.whitelisted)
check('cmd：未被截断', good.truncated === false)

const denied1 = await tk.runCmd({ cmd: 'npm publish' }, cfgCmd)
check('cmd：npm publish 拒绝（ok:false + denied:true）', denied1.ok === false && denied1.denied === true, JSON.stringify(denied1))
check('cmd：拒绝理由提到变更类', denied1.reason.includes('变更'), denied1.reason)
const denied2 = await tk.runCmd({ cmd: 'git push origin main' }, cfgCmd)
check('cmd：git push 拒绝', denied2.ok === false && denied2.denied === true && denied2.reason.includes('push'), JSON.stringify(denied2))
const denied3 = await tk.runCmd({ cmd: 'rm -rf /' }, cfgCmd)
check('cmd：rm 拒绝', denied3.ok === false && denied3.denied === true, JSON.stringify(denied3))
const denied4 = await tk.runCmd({ cmd: 'mkdir新建目录' }, cfgCmd)
check('cmd：mkdir 拒绝', denied4.ok === false && denied4.denied === true, JSON.stringify(denied4))
const denied5 = await tk.runCmd({ cmd: 'node --eval "x"' }, cfgCmd)
check('cmd：白名单外（node --eval 非白名单前缀）拒绝', denied5.ok === false && denied5.denied === true && denied5.reason.includes('白名单'), JSON.stringify(denied5))
const denied6 = await tk.runCmd({ cmd: 'git status > out.txt' }, cfgCmd)
check('cmd：重定向拼接拒绝（元字符）', denied6.ok === false && denied6.denied === true && denied6.reason.includes('元字符'), JSON.stringify(denied6))
const denied7 = await tk.runCmd({ cmd: 'git log | rm -rf /' }, cfgCmd)
check('cmd：管道串接拒绝（元字符）', denied7.ok === false && denied7.denied === true, JSON.stringify(denied7))

const big = await tk.runCmd({ cmd: 'node -e "console.log(\'x\'.repeat(5000))"', timeoutMs: 15000 }, cfgCmd)
check('cmd：超 2KB 输出被截断并标注', big.truncated === true && big.stdout.includes('[truncated]'), `len=${big.stdout.length}`)
check('cmd：截断后长度 = 2048 + 标记', big.stdout.length === 2048 + '\n[truncated]'.length, big.stdout.length)

const slow = await tk.runCmd({ cmd: 'node -e "setTimeout(function(){}, 8000)"', timeoutMs: 500 }, cfgCmd)
check('cmd：超时返回 timedOut:true 且 ok:false', slow.timedOut === true && slow.ok === false, JSON.stringify(slow))
check('cmd：超时 exitCode null', slow.exitCode === null)
check('cmd：超时耗时接近超时值（<3s 而非等满 8s）', slow.durationMs < 3000, slow.durationMs)

const badCwd = await tk.runCmd({ cmd: 'node -v', cwd: join(sandbox, 'no-such-dir') }, cfgCmd)
check('cmd：cwd 不存在 → error 不抛', badCwd.ok === false && badCwd.denied === false && badCwd.error.includes('cwd'), JSON.stringify(badCwd))
const empty = await tk.runCmd({ cmd: '   ' }, cfgCmd)
check('cmd：空命令 → error 不抛', empty.ok === false && empty.error.length > 0, JSON.stringify(empty))

/* ------------------------------------------------------------------ *
 * 3. toolkit_read：存在 / 不存在 / 目录 / 截断
 * ------------------------------------------------------------------ */
const cfgRead = tk.mergeConfig({ usageEnabled: false })
const readFile = join(root, 'readme-探针.txt')
writeFileSync(readFile, 'A'.repeat(100), 'utf8')
const r1 = tk.doRead({ path: readFile }, cfgRead)
check('read：存在 → ok:true exists:true', r1.ok === true && r1.exists === true, JSON.stringify(r1))
check('read：size/mtime/isFile 字段齐', r1.size === 100 && typeof r1.mtime === 'string' && r1.isFile === true && r1.isDir === false, JSON.stringify(r1))
check('read：内容完整（100 字节 < 默认 8KB）', r1.content === 'A'.repeat(100) && r1.truncated === false)

const r2 = tk.doRead({ path: join(root, 'no-such-file-xyz.txt') }, cfgRead)
check('read：不存在 → ok:true exists:false（读不到是正常答案）', r2.ok === true && r2.exists === false && r2.content === '', JSON.stringify(r2))

mkdirSync(join(root, 'sub-dir'), { recursive: true })
const r3 = tk.doRead({ path: join(root, 'sub-dir') }, cfgRead)
check('read：目录 → isDir:true 不给内容', r3.ok === true && r3.isDir === true && r3.isFile === false && r3.content === '', JSON.stringify(r3))

const r4 = tk.doRead({ path: readFile, maxBytes: 10 }, cfgRead)
check('read：maxBytes 10 → 前 10 字节 + truncated', r4.content === 'A'.repeat(10) && r4.truncated === true, JSON.stringify(r4))
const r5 = tk.doRead({ path: readFile, maxBytes: 999999 }, cfgRead)
check('read：maxBytes 超上限被 clamp 到 64KB（不炸）', r5.ok === true && r5.content.length === 100, JSON.stringify(r5))
const r6 = tk.doRead({ path: '' }, cfgRead)
check('read：空 path → error 不抛', r6.ok === false && r6.error.length > 0, JSON.stringify(r6))

/* ------------------------------------------------------------------ *
 * 4. toolkit_write：白名单内成功+备份 / 白名单外拒绝 / 穿越 / 超限
 * ------------------------------------------------------------------ */
const cfgWrite = tk.mergeConfig({ usageEnabled: false })
const w1 = tk.doWrite({ path: join(root, 'notes', 'w-探针.md'), content: '# 第一版内容\n' }, cfgWrite)
check('write：记忆根内子目录成功（目录自建）', w1.ok === true && w1.bytes > 0, JSON.stringify(w1))
check('write：文件真实落盘且内容一致', existsSync(w1.path) && readFileSync(w1.path, 'utf8') === '# 第一版内容\n', w1.path)
check('write：新建无备份', w1.backupPath === null, w1.backupPath)

const w2 = tk.doWrite({ path: join(root, 'notes', 'w-探针.md'), content: '# 第二版内容\n' }, cfgWrite)
check('write：覆盖成功', w2.ok === true && readFileSync(w2.path, 'utf8') === '# 第二版内容\n', JSON.stringify(w2))
check('write：覆盖前自动留 .bak（同目录时间戳后缀）', typeof w2.backupPath === 'string' && w2.backupPath.includes('.bak-') && existsSync(w2.backupPath), w2.backupPath)
check('write：.bak 内容是第一版', w2.backupPath && readFileSync(w2.backupPath, 'utf8') === '# 第一版内容\n', w2.backupPath && readFileSync(w2.backupPath, 'utf8'))

const outside = join(sandbox, 'outside')
mkdirSync(outside, { recursive: true })
const w3 = tk.doWrite({ path: join(outside, 'evil.txt'), content: 'x' }, cfgWrite)
check('write：白名单外拒绝', w3.ok === false && w3.denied === true && !existsSync(join(outside, 'evil.txt')), JSON.stringify(w3))
check('write：拒绝理由列出允许的根目录', w3.reason.includes(root), w3.reason)

const w4 = tk.doWrite({ path: join(root, '..', '..', 'escape-探针.txt'), content: 'x' }, cfgWrite)
check('write：路径穿越（..）被拒（resolve 后不在白名单内）', w4.ok === false && w4.denied === true && !existsSync(join(sandbox, 'escape-探针.txt')), JSON.stringify(w4))

const w5 = tk.doWrite({ path: join(root, 'too-big.txt'), content: 'x'.repeat(64 * 1024 + 1) }, cfgWrite)
check('write：超 64KB 拒绝', w5.ok === false && w5.denied === true && w5.reason.includes('上限'), JSON.stringify(w5))
const w6 = tk.doWrite({ path: join(root, 'just-fit.txt'), content: 'x'.repeat(64 * 1024) }, cfgWrite)
check('write：恰好 64KB 通过', w6.ok === true, JSON.stringify(w6))

const w7 = tk.doWrite({ path: join(root, 'sub-dir'), content: 'x' }, cfgWrite)
check('write：目标已是目录 → error 拒绝', w7.ok === false && w7.error.length > 0, JSON.stringify(w7))

// writeExtraPaths：默认白名单之上追加工作区目录。
const workspaceDocs = join(sandbox, 'docs')
const cfgExtra = tk.mergeConfig({ usageEnabled: false, writeExtraPaths: [workspaceDocs] })
const w8 = tk.doWrite({ path: join(workspaceDocs, '经验.md'), content: '经验正文' }, cfgExtra)
check('write：writeExtraPaths 追加目录可写', w8.ok === true && existsSync(join(workspaceDocs, '经验.md')), JSON.stringify(w8))
// writePaths：给数组 = 完全接管，记忆根不再放行（锁死语义，防误配静默放宽）。
const cfgTakeover = tk.mergeConfig({ usageEnabled: false, writePaths: [workspaceDocs] })
const w9 = tk.doWrite({ path: join(root, '被接管后应拒绝.md'), content: 'x' }, cfgTakeover)
check('write：writePaths 接管后记忆根不再可写', w9.ok === false && w9.denied === true, JSON.stringify(w9))
const w10 = tk.doWrite({ path: join(workspaceDocs, '接管后可写.md'), content: 'x' }, cfgTakeover)
check('write：writePaths 接管后新白名单生效', w10.ok === true, JSON.stringify(w10))

/* ------------------------------------------------------------------ *
 * 5. 调用留痕：JSONL 追加 / 环形 / 损坏不抛 / 失败不抛 / 开关
 * ------------------------------------------------------------------ */
const usageFile = join(sandbox, 'usage', 'usage.jsonl')
const cfgUsage = tk.mergeConfig({ usagePath: usageFile, usageMaxLines: 500 })
const logger = tk.createUsageLogger(cfgUsage, () => {})

const rec1 = tk.__testing.makeRec('toolkit_read', 'C:\\x\\y.txt')
rec1.status = 'success'
rec1.ok = true
logger(rec1)
check('留痕：写入一条 JSONL（文件自建）', existsSync(usageFile) && readFileSync(usageFile, 'utf8').trim().split('\n').length === 1, existsSync(usageFile) ? readFileSync(usageFile, 'utf8') : 'file missing')
const parsed1 = JSON.parse(readFileSync(usageFile, 'utf8').trim())
check('留痕：记录字段齐（ts/tool/args/status/denyReason/durationMs/outBytes/truncated）',
  typeof parsed1.ts === 'string' && parsed1.tool === 'toolkit_read' && typeof parsed1.args === 'string' &&
  parsed1.status === 'success' && typeof parsed1.denyReason === 'string' && typeof parsed1.durationMs === 'number' &&
  typeof parsed1.outBytes === 'number' && typeof parsed1.truncated === 'boolean', JSON.stringify(parsed1))
check('留痕：readUsage 读回 1 条', tk.readUsage(50, cfgUsage).length === 1)

// 工具真跑一次，留痕里 args 脱敏（直调实现要显式传 logger，apply 路径由中间层传入）。
const cfgTrace = tk.mergeConfig({ usagePath: join(sandbox, 'usage', 'trace.jsonl') })
await tk.runCmd({ cmd: 'git status --token=supersecret-trace-9527' }, cfgTrace, tk.createUsageLogger(cfgTrace, () => {}))
const traceRecs = tk.readUsage(10, tk.mergeConfig({ usagePath: join(sandbox, 'usage', 'trace.jsonl') }))
check('留痕：runCmd 落了一条（退出码非 0 也留痕）', traceRecs.length === 1 && traceRecs[0].tool === 'toolkit_cmd', JSON.stringify(traceRecs))
check('留痕：args 里凭证已脱敏', !JSON.stringify(traceRecs).includes('supersecret-trace-9527'), JSON.stringify(traceRecs))
check('留痕：拒绝原因留痕到 denyReason', typeof traceRecs[0].denyReason === 'string', JSON.stringify(traceRecs[0]))

// 环形控制：上限 5 行，写 8 条 → 只留最新 5 条。
const ringFile = join(sandbox, 'usage', 'ring.jsonl')
const cfgRing = tk.mergeConfig({ usagePath: ringFile, usageMaxLines: 5 })
const ringLogger = tk.createUsageLogger(cfgRing, () => {})
for (let i = 1; i <= 8; i++) {
  const rec = tk.__testing.makeRec('toolkit_read', `item-${i}`)
  rec.ok = true
  ringLogger(rec)
}
const ringLines = readFileSync(ringFile, 'utf8').trim().split('\n')
check('留痕：环形截断到 5 行', ringLines.length === 5, ringLines.length)
check('留痕：保留的是最新 5 条（item-4..8）', ringLines[0].includes('item-4') && ringLines[4].includes('item-8'), ringLines.map((l) => JSON.parse(l).args).join(','))
check('留痕：readUsage(3) 返回最近 3 条', tk.readUsage(3, cfgRing).length === 3 && tk.readUsage(3, cfgRing)[2].args.includes('item-8'), JSON.stringify(tk.readUsage(3, cfgRing)))

// 损坏文件：坏行跳过、好行保留、不抛。
const corruptFile = join(sandbox, 'usage', 'corrupt.jsonl')
writeFileSync(corruptFile, '这不是JSON\n{"tool":"好行"}\n\n{"tool":"坏行",\n', 'utf8')
const cfgCorrupt = tk.mergeConfig({ usagePath: corruptFile })
let corruptRead = null
let corruptThrew = null
try {
  corruptRead = tk.readUsage(50, cfgCorrupt)
} catch (error) {
  corruptThrew = error
}
check('留痕：损坏行不抛', corruptThrew === null, corruptThrew)
check('留痕：损坏行跳过、好行保留（1/3）', corruptRead?.length === 1 && corruptRead[0].tool === '好行', JSON.stringify(corruptRead))

// 留痕写入本身失败（usagePath 落在文件下面 → mkdir 必败）不抛、不影响主流程。
const blockedFile = join(sandbox, 'blocked.txt')
writeFileSync(blockedFile, '我是文件不是目录\n', 'utf8')
const cfgBlocked = tk.mergeConfig({ usagePath: join(blockedFile, 'sub', 'usage.jsonl') })
const blockedLogger = tk.createUsageLogger(cfgBlocked, () => {})
let blockedThrew = null
try {
  blockedLogger(tk.__testing.makeRec('toolkit_read', 'x'))
} catch (error) {
  blockedThrew = error
}
check('留痕：写入失败不抛（只 warn）', blockedThrew === null, blockedThrew)

// 开关：usageEnabled:false 不落盘。
const offFile = join(sandbox, 'usage', 'off.jsonl')
tk.createUsageLogger(tk.mergeConfig({ usagePath: offFile, usageEnabled: false }), () => {})(tk.__testing.makeRec('toolkit_read', 'x'))
check('留痕：usageEnabled:false 不写文件', !existsSync(offFile))

// 留痕文件不存在时 readUsage 返回空数组。
check('留痕：文件不存在 readUsage → []', tk.readUsage(10, tk.mergeConfig({ usagePath: join(sandbox, 'usage', 'never.jsonl') })).length === 0)

/* ------------------------------------------------------------------ *
 * 6. 工具注册 / schema / own-tools 放行 / 工具目录 add-remove-list
 * ------------------------------------------------------------------ */
const registered = []
const cleanups = []
const disposedFlags = new Map() // 工具名 → 读取"是否已反注册"的函数
const makeCtx = () => ({
  effect(fn, _label) {
    cleanups.push(fn())
    return () => {}
  },
  tools: {
    register(def) {
      registered.push(def)
      let disposed = false
      disposedFlags.set(def.name, () => disposed)
      return () => {
        disposed = true
      }
    },
  },
  logger: { info: () => {}, warn: () => {} },
})
const api = tk.apply(makeCtx(), {
  usageEnabled: false,
  // 注册走真实配置：execute 转发用例要用 'node -e'，这里同款放开。
  cmdWhitelist: ['node -e', ...tk.mergeConfig({}).cmdWhitelist],
})
check('注册：三个工具已注册', registered.length === 3 && registered.map((d) => d.name).join(',') === 'toolkit_cmd,toolkit_read,toolkit_write', registered.map((d) => d.name).join(','))
check('注册：目录 list 与之一致', api.list().join(',') === 'toolkit_cmd,toolkit_read,toolkit_write', api.list())

for (const def of registered) {
  check(`schema：${def.name} parameters 是 object 且有 properties`, def.parameters?.type === 'object' && Object.keys(def.parameters?.properties ?? {}).length > 0, JSON.stringify(def.parameters))
  const schema = def.output?.schema
  check(`schema：${def.name} output.schema required 都在 properties 里`,
    schema?.type === 'object' && (schema.required ?? []).every((k) => (schema.properties ?? {})[k] !== undefined), JSON.stringify(schema))
  check(`schema：${def.name} 有 render`, typeof def.output?.render === 'function')
  check(`schema：${def.name} 有 execute 且是函数`, typeof def.execute === 'function')
}
const cmdDef = registered.find((d) => d.name === 'toolkit_cmd')
check('schema：toolkit_cmd 必填 cmd', JSON.stringify(cmdDef.parameters.required) === JSON.stringify(['cmd']))
const writeDef = registered.find((d) => d.name === 'toolkit_write')
check('schema：toolkit_write 必填 path+content', JSON.stringify(writeDef.parameters.required) === JSON.stringify(['path', 'content']))

/* ------------------------------------------------------------------ *
 * 6b. 回归（1.5.39）：宿主 schema 校验——type 只接受单字符串
 *
 * 宿主 tools.register() 的 JSON Schema 校验不接受 type 数组（报错
 * "must be a single type string (type arrays are not supported)"，
 * 错误类 UNSUPPORTED_SCHEMA）。1.5.38 的三处 type:['integer','null']
 * 写法导致 toolkit 三件套注册全部失败，又被 apply() 的逐工具 try/catch
 * 吞成 warn——表面看不出来。这里把宿主那条规则复刻成守门员：apply()
 * （= 插件激活）注册出来的每个 schema 逐层扫描，任何 type 不是字符串
 * 即 FAIL；并反向验证「type 数组必被拒」，防守门员本身失明。
 * ------------------------------------------------------------------ */
function collectSchemaTypeNodes(node, path, hits) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return hits
  if ('type' in node && node.type !== undefined) hits.push({ path: `${path}.type`, value: node.type })
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    collectSchemaTypeNodes(child, `${path}.properties.${key}`, hits)
  }
  if (node.items) collectSchemaTypeNodes(node.items, `${path}.items`, hits)
  for (const combinator of ['anyOf', 'oneOf', 'allOf']) {
    for (const [i, child] of (node[combinator] ?? []).entries()) {
      collectSchemaTypeNodes(child, `${path}.${combinator}[${i}]`, hits)
    }
  }
  return hits
}
function hostValidateSchema(def) {
  const violations = []
  for (const [scope, schema] of [['parameters', def.parameters], ['output.schema', def.output?.schema]]) {
    if (!schema) continue
    for (const hit of collectSchemaTypeNodes(schema, scope, [])) {
      if (typeof hit.value !== 'string') {
        violations.push(`${hit.path} = ${JSON.stringify(hit.value)}（宿主会报 UNSUPPORTED_SCHEMA，注册必失败）`)
      }
    }
  }
  return violations
}
for (const def of registered) {
  const violations = hostValidateSchema(def)
  check(`回归：${def.name} schema 通过宿主校验（所有 type 都是单字符串）`, violations.length === 0, violations.join('；'))
}
const cmdSchema = cmdDef.output.schema
const readDef = registered.find((d) => d.name === 'toolkit_read')
check('回归：toolkit_cmd.exitCode 是单类型 integer 且不在 required（1.5.39 修复点）',
  cmdSchema.properties.exitCode.type === 'integer' && !cmdSchema.required.includes('exitCode'),
  JSON.stringify(cmdSchema.properties.exitCode))
check('回归：toolkit_read.mtime 是单类型 string 且不在 required（1.5.39 修复点）',
  readDef.output.schema.properties.mtime.type === 'string' && !readDef.output.schema.required.includes('mtime'),
  JSON.stringify(readDef.output.schema.properties.mtime))
check('回归：toolkit_write.backupPath 是单类型 string 且不在 required（1.5.39 修复点）',
  writeDef.output.schema.properties.backupPath.type === 'string' && !writeDef.output.schema.required.includes('backupPath'),
  JSON.stringify(writeDef.output.schema.properties.backupPath))
const probeDef = { name: 'probe', parameters: { type: 'object', properties: { x: { type: ['string', 'null'] } } } }
check('回归：守门员能抓出 type 数组写法（防校验器失明）',
  hostValidateSchema(probeDef).length === 1 && hostValidateSchema(probeDef)[0].includes('UNSUPPORTED_SCHEMA'),
  JSON.stringify(hostValidateSchema(probeDef)))

const { isOwnTool, OWN_TOOLS } = await import(libUrl('own-tools.js'))
check('own-tools：三个工具名被放行', isOwnTool('toolkit_cmd') && isOwnTool('toolkit_read') && isOwnTool('toolkit_write'))
check('own-tools：静态兜底表含三名', OWN_TOOLS.includes('toolkit_cmd') && OWN_TOOLS.includes('toolkit_read') && OWN_TOOLS.includes('toolkit_write'))
check('own-tools：陌生名不放行', isOwnTool('rm_rf_del_everything') === false)

// 工具目录：add / remove / 卸载兜底。
const extraDef = { name: 'toolkit_extra', description: '测试自定义工具', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'object' } } }
api.add('toolkit_extra', extraDef, async () => ({ ok: true }))
check('目录：add 注册新工具（list 变 4）', api.list().length === 4 && registered.length === 4, api.list())
check('目录：add 后尚未反注册', disposedFlags.get('toolkit_extra')() === false)
api.remove('toolkit_extra')
check('目录：remove 反注册并移出目录', api.list().length === 3 && registered.length === 4)
check('目录：remove 真的调了 disposer', disposedFlags.get('toolkit_extra')() === true)
check('目录：重复 remove 返回 false', api.remove('toolkit_extra') === false)
for (const cleanup of cleanups) cleanup()
check('目录：卸载兜底清空整个目录', api.list().length === 0, api.list())
check('目录：卸载兜底真的反注册了内置工具', disposedFlags.get('toolkit_cmd')() === true)

// 工具执行转发：走注册出来的 execute 壳，结果与直调底层一致。
const viaShell = await cmdDef.execute({ cmd: 'node -e "console.log(\'via-execute-9527\')"' })
check('转发：execute 壳把调用交给底层实现', viaShell.ok === true && viaShell.stdout.includes('via-execute-9527'), JSON.stringify(viaShell))

/* ------------------------------------------------------------------ *
 * 收尾清理
 * ------------------------------------------------------------------ */
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
