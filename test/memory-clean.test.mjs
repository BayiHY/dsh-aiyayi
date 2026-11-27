/**
 * memory_organize clean 动作回归测试（1.14.0）。
 *
 * 背景：precompact 之类的注入会把整段快照/提示词灌进**分类档案**，而 move/forget
 * 只认条目行，那些垃圾段落根本清不掉——266KB 那次事故里，人只能拿别的工具手改文件。
 * clean 就是给这个场景补的口子，这个文件把它钉住。
 *
 * 钉的六件事：
 *  1) 干净档案：一字不动、不留备份、removedLines:0；
 *  2) 有垃圾：垃圾行删掉、条目行一条不少、结构行（标题/引用/分隔线/索引段）保留；
 *  3) 备份：改之前在同目录留 .bak-YYYYMMDD-HHMMSS，内容等于原文；
 *  4) 边界：core / rules / index / 不存在的档案 / 不传 path 全部拒绝，且不留备份；
 *  5) 口径同源：clean 删掉的行数 == tree/read 报的 nonEntry（两套口径不能互相打脸）；
 *  6) 输出形状：返回对象必须在 output.schema 里声明过（additionalProperties:false）。
 *
 * fixture 全在 %TEMP% 沙盘里造，用 AIYAYI_HOME + 指路文件双定向，
 * **绝不碰真实记忆库**（`<记忆根>`）。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-clean-'))
const root = join(sandbox, 'root')
mkdirSync(join(root, 'memories'), { recursive: true })
process.env.AIYAYI_HOME = root

const { apply, __testing } = await import(libUrl('index.js'))
const { __testing: homeTesting, coreFile, treeDir } = await import(libUrl('home.js'))

homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()
homeTesting.setOverride(undefined)

const { fileHealth } = __testing

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ------------------------------------------------------------------ *
 * 假 ctx：只实现 apply() 真正用到的 effect / tools.register / systemPrompt
 * ------------------------------------------------------------------ */
const tools = new Map()
apply({
  effect(fn) {
    fn()
    return () => {}
  },
  tools: {
    register(def) {
      tools.set(def.name, def)
      return () => {}
    },
  },
  systemPrompt: {
    section() {
      return () => {}
    },
  },
})

const organize = tools.get('memory_organize')
const clean = (args) => organize.execute({ action: 'clean', ...args })

/* ------------------------------------------------------------------ *
 * fixture
 * ------------------------------------------------------------------ */
const CATEGORY = join(root, 'memories', '事情', '经验.md')

// 干净档案：标题 + 条目 + 分隔线 + 引用说明（结构行都该原样保留）。
const CLEAN = [
  '# 经验',
  '',
  '- [2026-11-13 12:50] 外置盘没插时记忆不可达，先看 location.json。',
  '- [2026-11-13 13:05] 发版前先跑一遍 node --test。',
  '',
  '---',
  '',
  '> 说明：这是经验沉淀档案。',
  '',
].join('\n')

// 污染档案：条目 + 灌进来的整段垃圾（还夹着连续空行/行首空行）。
const DIRTY = [
  '',
  '',
  '# 经验',
  '',
  '- [2026-11-13 12:50] 外置盘没插时记忆不可达，先看 location.json。',
  '## MCP resource servers',
  '> 说明：这是经验沉淀档案。',
  '下面这几十行是 precompact 误注入进来的服务器说明，压根不是条目。',
  '',
  '',
  '',
  '【你是谁】你是阿依娅伊（整段人格段被灌进来了）。',
  '- [2026-11-13 13:05] 发版前先跑一遍 node --test。',
  'This is a raw paragraph of prompt text with no entry prefix at all.',
  '',
  '---',
  '',
  '- [2026-11-13 14:20] 结论：先备份再改文件。',
  '',
  '',
].join('\n')

function seed(text) {
  mkdirSync(join(root, 'memories', '事情'), { recursive: true })
  writeFileSync(CATEGORY, text, 'utf8')
  // 清掉上一轮留下的备份，避免"备份存在"的断言被历史文件蒙对。
  for (const name of readdirSync(join(root, 'memories', '事情'))) {
    if (name.includes('.bak-')) rmSync(join(root, 'memories', '事情', name), { force: true })
  }
  writeFileSync(join(root, 'memory.md'), '- [2026-11-13 10:00] 事情｜核心那条\n', 'utf8')
  writeFileSync(join(root, 'rules.md'), '# 规则\n\n先验证，再动手。\n', 'utf8')
  writeFileSync(join(root, 'index.md'), '<!-- 索引 -->\n事情/经验：单向沉淀\n<!-- /索引 -->\n', 'utf8')
}

const read = (file) => readFileSync(file, 'utf8')
const backups = () => readdirSync(join(root, 'memories', '事情')).filter((name) => name.includes('.bak-'))
const splitLines = (text) => text.split(/\r?\n/)

/* ------------------------------------------------------------------ *
 * 宿主口径的 schema 校验（与 memory-forget 同一套）
 * ------------------------------------------------------------------ */
function schemaTypeProblems(schema, path = '$') {
  const problems = []
  if (schema === null || typeof schema !== 'object') return problems
  if (schema.type !== undefined && typeof schema.type !== 'string') {
    problems.push(`${path}.type 必须是单个字符串（坑 #77：宿主只收单 type）`)
  }
  if (schema.properties !== undefined) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      problems.push(...schemaTypeProblems(prop, `${path}.properties.${key}`))
    }
    for (const key of schema.required ?? []) {
      if (schema.properties[key] === undefined) problems.push(`${path}: required 里的 ${key} 不在 properties 里（坑 #1）`)
    }
  }
  if (schema.items !== undefined) problems.push(...schemaTypeProblems(schema.items, `${path}.items`))
  return problems
}

function validate(schema, value, path = '$') {
  const problems = []
  const type = schema.type
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${path}: 应为 object，实际 ${typeof value}`]
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) problems.push(`${path}.${key}: required 但缺失/undefined`)
    }
    const props = schema.properties ?? {}
    for (const [key, item] of Object.entries(value)) {
      if (props[key] === undefined) problems.push(`${path}.${key}: output.schema 没声明（additionalProperties:false 会被宿主拒）`)
      else problems.push(...validate(props[key], item, `${path}.${key}`))
    }
    return problems
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: 应为 array`]
    value.forEach((item, index) => problems.push(...validate(schema.items ?? {}, item, `${path}[${index}]`)))
    return problems
  }
  if (type === 'integer') return Number.isInteger(value) ? [] : [`${path}: 应为 integer，实际 ${JSON.stringify(value)}`]
  if (type === 'string') return typeof value === 'string' ? [] : [`${path}: 应为 string，实际 ${JSON.stringify(value)}`]
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [`${path}: 应为 boolean`]
  if (type === 'number') return typeof value === 'number' ? [] : [`${path}: 应为 number`]
  return problems
}

function checkOutputShape(label, result) {
  const problems = validate(organize.output.schema, result)
  check(`${label}：返回对象符合 output.schema（多一字段/少一 required 都会被宿主拒）`, problems.length === 0, problems.join('\n        '))
}

/* ------------------------------------------------------------------ *
 * 0. 隔离 + schema/参数自检
 * ------------------------------------------------------------------ */
console.log('\n=== 0. 隔离与 schema 自检 ===')
check('记忆根确实被定向到 %TEMP% 沙盘（不碰真实记忆库）', coreFile() === join(root, 'memory.md') && treeDir() === join(root, 'memories'), `${coreFile()} / ${treeDir()}`)
check('沙盘在系统临时目录下', resolve(root).startsWith(resolve(tmpdir())), root)

const schemaProblems = schemaTypeProblems(organize.output.schema)
check('output.schema 没有 type 数组 / required 不在 properties 的坑', schemaProblems.length === 0, schemaProblems.join('\n        '))
const params = organize.parameters.properties
check('action 的 enum 里有 clean（否则 schema 层就拦住了）', Array.isArray(params.action.enum) && params.action.enum.includes('clean'), JSON.stringify(params.action.enum))
check('action 的 enum 里有 schema（新增，否则 schema 层就拦住了）', Array.isArray(params.action.enum) && params.action.enum.includes('schema'), JSON.stringify(params.action.enum))
check('action 的 enum 保留了 tree/read/move/index/forget', ['tree', 'read', 'move', 'index', 'forget'].every((name) => params.action.enum.includes(name)), JSON.stringify(params.action.enum))
check('action 描述里写了 clean 的用法', /clean=清理分类档案/.test(params.action.description), params.action.description)
check('path 描述里提到 clean 只能用分类档案', /clean 的 path 必填/.test(params.path.description), params.path.description)
check('工具描述里写了 clean 动作（tree/read/move/index/forget 一个没删）', /clean/.test(organize.description) && ['tree', 'read', 'move', 'index', 'forget'].every((word) => organize.description.includes(word)), organize.description)
const outProps = organize.output.schema.properties
check('output.schema 声明了 clean 的 6 个字段', ['beforeBytes', 'afterBytes', 'beforeEntries', 'afterEntries', 'removedLines', 'backupPath'].every((key) => outProps[key] !== undefined), JSON.stringify(Object.keys(outProps)))

/* ------------------------------------------------------------------ *
 * 1. 干净档案：一字不动、不留备份
 * ------------------------------------------------------------------ */
console.log('\n=== 1. 干净档案无变化 ===')
seed(CLEAN)
const cleanResult = await clean({ path: '事情/经验' })
check('干净档案 → done:true（不是错误）', cleanResult.done === true, JSON.stringify(cleanResult))
check('干净档案 → removedLines:0', cleanResult.removedLines === 0, JSON.stringify(cleanResult))
check('干净档案 → beforeBytes == afterBytes', cleanResult.beforeBytes === cleanResult.afterBytes && cleanResult.beforeBytes === Buffer.byteLength(CLEAN, 'utf8'), JSON.stringify(cleanResult))
check('干净档案 → 条目数前后一致', cleanResult.beforeEntries === 2 && cleanResult.afterEntries === 2, JSON.stringify(cleanResult))
check('干净档案 → 没留备份（backupPath 空且磁盘上没有 .bak）', cleanResult.backupPath === '' && backups().length === 0, `${cleanResult.backupPath} / ${backups().join(',')}`)
check('干净档案 → 文件逐字节没动', read(CATEGORY) === CLEAN, JSON.stringify(read(CATEGORY)))
checkOutputShape('干净档案', cleanResult)

/* ------------------------------------------------------------------ *
 * 2. 有垃圾：删垃圾、条目一条不少、结构行保留
 * ------------------------------------------------------------------ */
console.log('\n=== 2. 有垃圾段落被清 ===')
seed(DIRTY)
const beforeHealth = fileHealth(DIRTY)
const dirtyBefore = read(CATEGORY)
const cleaned = await clean({ path: '事情/经验' })
const afterText = read(CATEGORY)
const afterHealth = fileHealth(afterText)
check('污染档案 → done:true 且 removedLines > 0', cleaned.done === true && cleaned.removedLines > 0, JSON.stringify(cleaned))
check('删掉的行数 == tree/read 报的 nonEntry（口径同源，不能两套）', cleaned.removedLines === beforeHealth.nonEntry, `removedLines=${cleaned.removedLines} nonEntry=${beforeHealth.nonEntry}`)
check('beforeEntries == 前一次健康度的 entries', cleaned.beforeEntries === beforeHealth.entries, `${cleaned.beforeEntries} vs ${beforeHealth.entries}`)
check('清完 nonEntry 归零（tree 复核不会再报比例型污染）', afterHealth.nonEntry === 0 && afterHealth.ratio === 0, JSON.stringify(afterHealth))
check(
  '标题形状的注入行按同一口径算结构行、clean 不动它 → tree 仍报注入指纹（已知口径边界）',
  afterHealth.warnings.some((warning) => warning.includes('整段注入痕迹')) && afterText.includes('## MCP resource servers'),
  JSON.stringify(afterHealth.warnings),
)
check(
  'detail 把这条边界说清（别让人以为 clean 没生效）',
  /还剩 1 行命中注入指纹/.test(cleaned.detail) && /手动删掉那一行/.test(cleaned.detail),
  cleaned.detail,
)
check('条目行全部保留（3 条都在）', ['外置盘没插时记忆不可达', '发版前先跑一遍 node --test', '结论：先备份再改文件'].every((needle) => afterText.includes(needle)), afterText)
check('条目数一条没少', afterHealth.entries === cleaned.beforeEntries && cleaned.afterEntries === 3, `${cleaned.beforeEntries} → ${cleaned.afterEntries}`)
check('整段灌进来的正文垃圾都没了', !afterText.includes('下面这几十行是 precompact 误注入') && !afterText.includes('【你是谁】') && !afterText.includes('raw paragraph of prompt text'), afterText)
check('标题/引用/分隔线这类结构行保留', afterText.includes('# 经验') && afterText.includes('---') && afterText.includes('> 说明：这是经验沉淀档案。'), afterText)
check('首尾不留空行（第一行是标题、末尾只有一个换行）', splitLines(afterText)[0] === '# 经验' && afterText.endsWith('\n') && !afterText.endsWith('\n\n'), JSON.stringify(afterText.slice(0, 12) + '...' + afterText.slice(-12)))
check('连续空行折叠成一个（不再有 \\n\\n\\n）', !afterText.includes('\n\n\n'), JSON.stringify(afterText))
check('字节数如实变小且与实测一致', cleaned.afterBytes === Buffer.byteLength(afterText, 'utf8') && cleaned.afterBytes < cleaned.beforeBytes, `${cleaned.beforeBytes} → ${cleaned.afterBytes}`)
check('path 返回的是分类档案标签', cleaned.path === '分类档案 事情/经验', cleaned.path)
checkOutputShape('污染档案清理', cleaned)

/* ------------------------------------------------------------------ *
 * 3. 备份：改之前留 .bak-时间戳，内容 == 原文
 * ------------------------------------------------------------------ */
console.log('\n=== 3. 备份先落盘 ===')
check('磁盘上正好多了 1 个备份', backups().length === 1, backups().join(','))
const bakName = backups()[0] ?? ''
check('备份名是 经验.md.bak-YYYYMMDD-HHMMSS（同目录）', /^经验\.md\.bak-\d{8}-\d{6}(?:-\d+)?$/.test(bakName), bakName)
check('返回的 backupPath 指向那个备份', cleaned.backupPath === join(root, 'memories', '事情', bakName) && existsSync(cleaned.backupPath), `${cleaned.backupPath} / ${bakName}`)
check('备份内容 == 清理前的原文（逐字节）', read(cleaned.backupPath) === dirtyBefore, JSON.stringify(read(cleaned.backupPath).slice(0, 80)))
check('备份文件本身不被 tree 当成分类档案（.bak- 不是 .md 结尾）', !__testing.listTreeFiles().some((name) => name.includes('.bak-')), __testing.listTreeFiles().join(','))

/* 再清一次：已经干净了 → removedLines:0、不再新增备份、文件不变 */
const again = await clean({ path: '事情/经验' })
check('清过再清 → removedLines:0、done:true', again.done === true && again.removedLines === 0, JSON.stringify(again))
check('清过再清 → 不再多留备份、文件不变', backups().length === 1 && read(CATEGORY) === afterText, `${backups().join(',')} / ${JSON.stringify(read(CATEGORY))}`)
checkOutputShape('清过再清', again)

/* ------------------------------------------------------------------ *
 * 4. 边界：只认分类档案
 * ------------------------------------------------------------------ */
console.log('\n=== 4. 边界：core / rules / index / 不存在 / 缺 path ===')
async function expectThrow(label, args, pattern) {
  let error = null
  try {
    await clean(args)
  } catch (caught) {
    error = caught
  }
  check(label, error !== null && pattern.test(error.message), error?.message ?? '没有抛错')
}

seed(DIRTY)
await expectThrow('path:"core" → 拒绝（核心记忆不是分类档案）', { path: 'core' }, /不能作用于核心记忆/)
await expectThrow('path:"核心"（中文别名）→ 同样拒绝', { path: '核心' }, /不能作用于核心记忆/)
await expectThrow('path:"rules" → 拒绝', { path: 'rules' }, /rules\.md/)
await expectThrow('path:"index" → 拒绝', { path: 'index' }, /index\.md/)
await expectThrow('不传 path → 报错（path 必填）', {}, /clean 需要 path/)
await expectThrow('path 指向不存在的档案 → 报错', { path: '事情/不存在' }, /不存在/)
await expectThrow('path 越界（4 级）→ 报错', { path: '事情/一/二/三/四' }, /深度最多/)
await expectThrow('path 带路径穿越 → 报错', { path: '../逃出去' }, /不合法/)
check('拒绝之后原档案逐字节没动', read(CATEGORY) === DIRTY, JSON.stringify(read(CATEGORY)))
check('拒绝之后 memory.md / rules.md 也没动', read(join(root, 'memory.md')) === '- [2026-11-13 10:00] 事情｜核心那条\n' && read(join(root, 'rules.md')) === '# 规则\n\n先验证，再动手。\n')
check('拒绝之后没有多出备份', backups().length === 0, backups().join(','))

/* ------------------------------------------------------------------ *
 * 5. 索引段里的目录行不能被当垃圾删（结构行是跨行状态）
 * ------------------------------------------------------------------ */
console.log('\n=== 5. 索引段整段保留 ===')
const WITH_INDEX = [
  '- [2026-11-13 12:50] 一条真条目。',
  '<!-- 索引 -->',
  '用户/口味：饮食偏好，不是条目行',
  '事情/经验：单向沉淀，也不是条目行',
  '<!-- /索引 -->',
].join('\n')
seed(WITH_INDEX)
const indexKeep = await clean({ path: '事情/经验' })
check('索引段里的目录行全部保留（不会被当成非条目垃圾）', read(CATEGORY).includes('用户/口味：饮食偏好') && read(CATEGORY).includes('事情/经验：单向沉淀'), read(CATEGORY))
check('索引段的标记行也保留', read(CATEGORY).includes('<!-- 索引 -->') && read(CATEGORY).includes('<!-- /索引 -->'), read(CATEGORY))
check('只有索引段时 removedLines:0（那些行本来就是结构行）', indexKeep.removedLines === 0, JSON.stringify(indexKeep))
checkOutputShape('索引段保留', indexKeep)

/* ------------------------------------------------------------------ *
 * 6. 收尾
 * ------------------------------------------------------------------ */
console.log('\n=== 6. 收尾 ===')
check('沙盘之外的真实记忆库没有被指向（coreFile 仍指向沙盘）', coreFile().startsWith(resolve(sandbox)), coreFile())

process.on('exit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 清理失败不该盖掉真正的测试结果 */
  }
})
console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)
