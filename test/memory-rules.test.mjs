/**
 * memory_organize move → rules 回归测试（1.14.0）。
 *
 * 工具描述早就写了 `to: "rules"` = 升为规则，但 1.13.0 的实现没接上——那条记忆
 * 会被当成条目行 append 进 rules.md（带上 `- [时间]` 前缀），规则文件于是长出一堆
 * "条目"，既不是成段说明文字，也不再是能渲染的规则。这个文件把修正钉住。
 *
 * 钉的五件事：
 *  1) move 到 rules：源处真的删掉，rules.md 末尾多出**普通段落**（无时间戳/条目前缀）；
 *  2) 段落之间空行隔开，多段互不粘连；内容去重——同样内容再 move 一次不会留两份；
 *  3) move 进 core 的行为保持不变（分类条目补类别前缀）；
 *  4) 三文件边界不变：move 的来源不能是 rules.md / index.md，去向不能是 index.md；
 *  5) 输出形状：返回对象必须在 output.schema 里声明过（additionalProperties:false）。
 *
 * fixture 全在 %TEMP% 沙盘里造，用 AIYAYI_HOME + 指路文件双定向，
 * **绝不碰真实记忆库**（`<记忆根>`）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-rules-'))
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
 * 假 ctx
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
const move = (args) => organize.execute({ action: 'move', ...args })

/* ------------------------------------------------------------------ *
 * fixture
 * ------------------------------------------------------------------ */
const CORE = [
  '# 核心记忆',
  '',
  '- [2026-11-13 10:00] 事情｜先跑测试再发版，别凭感觉',
  '- [2026-11-13 10:05] 用户｜他喜欢安静地聊',
  '',
].join('\n')

const RULES_SEED = ['# 规则', '', '先验证，再动手。', ''].join('\n')

const EXPERIENCE = ['- [2026-11-13 12:50] 经验条目：改文件前先备份。', ''].join('\n')

const coreFile_ = () => join(root, 'memory.md')
const rulesFile_ = () => join(root, 'rules.md')
const indexFile_ = () => join(root, 'index.md')
const experienceFile = () => join(root, 'memories', '事情', '经验.md')

function seed() {
  mkdirSync(join(root, 'memories', '事情'), { recursive: true })
  writeFileSync(coreFile_(), CORE, 'utf8')
  writeFileSync(rulesFile_(), RULES_SEED, 'utf8')
  writeFileSync(indexFile_(), '<!-- 索引 -->\n事情/经验：单向沉淀\n<!-- /索引 -->\n', 'utf8')
  writeFileSync(experienceFile(), EXPERIENCE, 'utf8')
}

const read = (file) => readFileSync(file, 'utf8')
/** 规则文件按空行切段（与 appendRulesParagraph 的去重口径一致），返回 trim 后的段数组。 */
const blocks = (text) => text.split(/\n\s*\n/).map((block) => block.trim()).filter((block) => block.length > 0)

/* ------------------------------------------------------------------ *
 * 宿主口径的 schema 校验（与 memory-forget 同一套）
 * ------------------------------------------------------------------ */
function schemaTypeProblems(schema, path = '$') {
  const problems = []
  if (schema === null || typeof schema !== 'object') return problems
  if (schema.type !== undefined && typeof schema.type !== 'string') problems.push(`${path}.type 必须是单个字符串（坑 #77）`)
  if (schema.properties !== undefined) {
    for (const [key, prop] of Object.entries(schema.properties)) problems.push(...schemaTypeProblems(prop, `${path}.properties.${key}`))
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
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${path}: 应为 object`]
    for (const key of schema.required ?? []) if (value[key] === undefined) problems.push(`${path}.${key}: required 但缺失`)
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
  if (type === 'integer') return Number.isInteger(value) ? [] : [`${path}: 应为 integer`]
  if (type === 'string') return typeof value === 'string' ? [] : [`${path}: 应为 string`]
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [`${path}: 应为 boolean`]
  if (type === 'number') return typeof value === 'number' ? [] : [`${path}: 应为 number`]
  return problems
}

function checkOutputShape(label, result) {
  const problems = validate(organize.output.schema, result)
  check(`${label}：返回对象符合 output.schema`, problems.length === 0, problems.join('\n        '))
}

/* ------------------------------------------------------------------ *
 * 0. 隔离与自检
 * ------------------------------------------------------------------ */
console.log('\n=== 0. 隔离与 schema 自检 ===')
check('记忆根确实被定向到 %TEMP% 沙盘', coreFile() === join(root, 'memory.md') && treeDir() === join(root, 'memories'), `${coreFile()} / ${treeDir()}`)
const schemaProblems = schemaTypeProblems(organize.output.schema)
check('output.schema 没有 type 数组 / required 不在 properties 的坑', schemaProblems.length === 0, schemaProblems.join('\n        '))
check('to 参数描述里写明 "rules" = 升为规则', /"rules" 表示升为规则/.test(organize.parameters.properties.to.description), organize.parameters.properties.to.description)

/* ------------------------------------------------------------------ *
 * 1. 核心条目升为规则
 * ------------------------------------------------------------------ */
console.log('\n=== 1. 核心条目 → rules ===')
seed()
const coreBefore = read(coreFile_())
const raised = await move({ path: 'core', match: '先跑测试再发版', to: 'rules' })
const rulesAfter = read(rulesFile_())
check('move 到 rules → done:true', raised.done === true, JSON.stringify(raised))
check('detail 说清是落成普通段落', /普通段落/.test(raised.detail), raised.detail)
check('源处真的删掉了（核心记忆里没这条了）', !read(coreFile_()).includes('先跑测试再发版'), read(coreFile_()))
check('核心里的其它条目一条没动', read(coreFile_()).includes('他喜欢安静地聊') && read(coreFile_()).length < coreBefore.length)
check('rules.md 末尾多出这段内容', rulesAfter.trimEnd().endsWith('先跑测试再发版，别凭感觉'), rulesAfter)
check('落进去的是内容本身：没有条目前缀/时间戳', !rulesAfter.includes('- [2026-') && !/\n\s*- \[/.test(rulesAfter.slice(RULES_SEED.length)), rulesAfter)
check('原有规则一个字没动（只剩末尾多出的段落）', rulesAfter.startsWith(RULES_SEED.trimEnd()), JSON.stringify(rulesAfter))
check('新段落与上一段之间恰好一个空行', rulesAfter.includes('先验证，再动手。\n\n先跑测试再发版'), JSON.stringify(rulesAfter))
check('段落数：原有 2 段 + 新增 1 段 = 3 段', blocks(rulesAfter).length === 3, JSON.stringify(blocks(rulesAfter)))
const rulesHealth = fileHealth(rulesAfter, { nonEntry: true })
check('rules.md 不是条目档案：entries 仍是 0、不预警', rulesHealth.entries === 0 && rulesHealth.warnings.length === 0, JSON.stringify(rulesHealth))
checkOutputShape('核心条目升为规则', raised)

/* ------------------------------------------------------------------ *
 * 2. 分类档案条目升为规则
 * ------------------------------------------------------------------ */
console.log('\n=== 2. 分类档案条目 → rules ===')
seed()
const fromCategory = await move({ path: '事情/经验', match: '改文件前先备份', to: 'rules' })
check('分类档案条目 → rules：done:true', fromCategory.done === true, JSON.stringify(fromCategory))
check('源档案里的条目删掉了', !read(experienceFile()).includes('改文件前先备份'), JSON.stringify(read(experienceFile())))
check('rules.md 里落成了普通段落（不带时间戳）', read(rulesFile_()).trimEnd().endsWith('经验条目：改文件前先备份。'), JSON.stringify(read(rulesFile_())))
checkOutputShape('分类条目升为规则', fromCategory)

/* ------------------------------------------------------------------ *
 * 3. 幂等：同样的内容再 move 一次，rules.md 不留两份
 * ------------------------------------------------------------------ */
console.log('\n=== 3. 重复 move 同一内容 → 幂等 ===')
const rulesOnce = read(rulesFile_())
// 把同样的内容再记回核心（时间戳故意不同：去重按内容比，不按行原文比）
writeFileSync(coreFile_(), `${read(coreFile_())}- [2026-11-19 09:00] 事情｜经验条目：改文件前先备份。\n`, 'utf8')
const dup = await move({ path: 'core', match: '经验条目：改文件前先备份', to: 'rules' })
check('重复 move → done:true（不是报错）', dup.done === true, JSON.stringify(dup))
check('重复 move → rules.md 逐字节没变（没重复追加）', read(rulesFile_()) === rulesOnce, JSON.stringify(read(rulesFile_())))
check('重复 move → 段落数还是 3 段', blocks(read(rulesFile_())).length === 3, JSON.stringify(blocks(read(rulesFile_()))))
check('重复 move → 同样内容只出现一次', read(rulesFile_()).split('经验条目：改文件前先备份').length - 1 === 1, JSON.stringify(read(rulesFile_())))
check('重复 move → detail 说明"没重复追加"', /没重复追加/.test(dup.detail), dup.detail)
check('重复 move → 来源那条照样删掉了（不留两份）', !read(coreFile_()).includes('经验条目：改文件前先备份'), JSON.stringify(read(coreFile_())))
checkOutputShape('重复 move 幂等', dup)

/* 不同内容再 move：两段之间仍然只有一个空行 */
seed()
await move({ path: 'core', match: '先跑测试再发版', to: 'rules' })
const second = await move({ path: '事情/经验', match: '改文件前先备份', to: 'rules' })
const twoRules = read(rulesFile_())
check('两段不同内容依次落盘 → 4 段（头 + 1 条原有 + 2 条新增）', blocks(twoRules).length === 4, JSON.stringify(blocks(twoRules)))
check('两段新增之间也恰有一个空行（不粘连）', twoRules.includes('先跑测试再发版，别凭感觉\n\n经验条目：改文件前先备份。'), JSON.stringify(twoRules))
check('没有连续空行', !twoRules.includes('\n\n\n'), JSON.stringify(twoRules))
checkOutputShape('连续两次升为规则', second)

/* ------------------------------------------------------------------ *
 * 4. move 进 core 的行为不变
 * ------------------------------------------------------------------ */
console.log('\n=== 4. move 进 core 不变 ===')
seed()
const toCore = await move({ path: '事情/经验', match: '改文件前先备份', to: 'core', kind: '关系' })
check('分类条目 → core：done:true', toCore.done === true, JSON.stringify(toCore))
check('进核心时补上了类别前缀 `- [时间] 关系｜内容`', /- \[2026-11-13 12:50\] 关系｜经验条目：改文件前先备份。/.test(read(coreFile_())), JSON.stringify(read(coreFile_())))
check('源档案里的条目删掉了', !read(experienceFile()).includes('改文件前先备份'), JSON.stringify(read(experienceFile())))
check('没碰 rules.md', read(rulesFile_()) === RULES_SEED, JSON.stringify(read(rulesFile_())))
checkOutputShape('move 进 core', toCore)

/* 核心 → 分类档案的老路也照旧 */
seed()
const toCategory = await move({ path: 'core', match: '他喜欢安静地聊', to: '用户/沟通' })
check('核心 → 分类档案：done:true', toCategory.done === true, JSON.stringify(toCategory))
check('落进分类档案的是条目行（不带 - [时间] 前缀）', /用户｜他喜欢安静地聊/.test(read(join(root, 'memories', '用户', '沟通.md'))), JSON.stringify(read(join(root, 'memories', '用户', '沟通.md'))))
check('新分类档案自动登记进 index.md（老行为没坏）', /^- 用户\/沟通\s*$/m.test(read(indexFile_())), read(indexFile_()))
checkOutputShape('move 进分类档案', toCategory)

/* ------------------------------------------------------------------ *
 * 5. 三文件边界不变
 * ------------------------------------------------------------------ */
console.log('\n=== 5. 三文件边界 ===')
seed()
let rulesErr = null
try {
  await move({ path: 'rules', match: '先验证', to: 'core' })
} catch (error) {
  rulesErr = error
}
let indexErr = null
try {
  await move({ path: 'index', match: '单向沉淀', to: 'core' })
} catch (error) {
  indexErr = error
}
let toIndexErr = null
try {
  await move({ path: 'core', match: '他喜欢安静地聊', to: 'index' })
} catch (error) {
  toIndexErr = error
}
let sameErr = null
try {
  await move({ path: 'core', match: '他喜欢安静地聊', to: 'core' })
} catch (error) {
  sameErr = error
}
check('来源是 rules → 拒绝', rulesErr !== null && /rules\.md/.test(rulesErr.message), rulesErr?.message ?? '没有抛错')
check('来源是 index → 拒绝', indexErr !== null && /index\.md/.test(indexErr.message), indexErr?.message ?? '没有抛错')
check('去向是 index → 拒绝', toIndexErr !== null && /index/.test(toIndexErr.message), toIndexErr?.message ?? '没有抛错')
check('来源和去向同一处 → 拒绝', sameErr !== null && /同一个地方/.test(sameErr.message), sameErr?.message ?? '没有抛错')
check('拒绝之后三个文件都没动', read(coreFile_()) === CORE && read(rulesFile_()) === RULES_SEED, `${read(coreFile_())} / ${read(rulesFile_())}`)

/* ------------------------------------------------------------------ *
 * 6. 空/只有空白的 rules.md：落段不留多余空行
 * ------------------------------------------------------------------ */
console.log('\n=== 6. 空 rules.md 落段 ===')
seed()
writeFileSync(rulesFile_(), '\n\n  \n', 'utf8')
const intoEmpty = await move({ path: 'core', match: '先跑测试再发版', to: 'rules' })
check('rules.md 只有空白时 → 落段成功', intoEmpty.done === true, JSON.stringify(intoEmpty))
check('不留下开头空行', read(rulesFile_()) === '先跑测试再发版，别凭感觉\n', JSON.stringify(read(rulesFile_())))
checkOutputShape('空白 rules.md 落段', intoEmpty)

/* ------------------------------------------------------------------ *
 * 7. 收尾
 * ------------------------------------------------------------------ */
console.log('\n=== 7. 收尾 ===')
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
