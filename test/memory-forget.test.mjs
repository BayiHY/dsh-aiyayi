/**
 * memory_organize forget 的精确定位回归测试（1.6.2）。
 *
 * 事故背景（2026-11-13 实测）：清理记忆时 forget 连着扑空 4 次，两个病根——
 *  ① 同一条记忆在不同档案里有多个副本：旧实现要求"恰好命中一条"，2 条就判
 *     歧义、直接拒绝，于是明明看见它在却删不掉；
 *  ② 拿显示层的时间戳（`[2026-11-13 12:50]`）当 match：存储行可能是
 *     `2026-11-13T12:50:33`（秒/T 分隔/全角），`line.includes(needle)` 找不到
 *     连续串，直接扑空。
 *
 * 这个文件验五件事：
 *  1) 唯一命中照旧删掉（老行为不能坏）；
 *  2) 同内容多份 → 列候选、**一条都不删**（安全底线：绝不"命中几条删几条"）；
 *  3) 时间戳能当 match 定位，包括存储层带秒/T 分隔、显示层只到分钟的形态；
 *  4) 0 命中 → 说清在哪些文件找过、有没有近似匹配（不删任何东西）；
 *  5) which / path / line 消歧。
 *
 * 另外按宿主口径校验 output.schema：required 的键必须存在且非 undefined；
 * additionalProperties:false 时未声明的键会被拒；type 只收单个字符串（坑 #77）。
 *
 * 全部 fixture 在 %TEMP% 下造，用 AIYAYI_HOME + 指路文件双定向，
 * **绝不碰真实记忆库**（D:\阿依娅伊\记忆）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-forget-'))
const root = join(sandbox, 'root')
mkdirSync(join(root, 'memories'), { recursive: true })
process.env.AIYAYI_HOME = root

const { apply } = await import(libUrl('index.js'))
const { __testing: homeTesting, coreFile, treeDir } = await import(libUrl('home.js'))

// 指路文件也搬进沙盘：真机上的 location.json 指向 D:\阿依娅伊\记忆，不隔离就会被它接管。
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()
homeTesting.setOverride(undefined)

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
const forget = (args) => organize.execute({ action: 'forget', ...args })

/* ------------------------------------------------------------------ *
 * fixture（每个用例前重写一遍，互不干扰）
 * ------------------------------------------------------------------ */
const CORE = [
  '# 阿依娅伊的核心记忆',
  '',
  '- [2026-11-13 10:00] 用户｜他喜欢安静地聊，不喜欢被追问',
  '- [2026-11-13 12:50] 事情｜清理记忆时 forget 连着扑空四次',
  '- [2026-11-14 09:30] 关系｜说好每天给他留一句状态',
  '',
  '<!-- 索引 -->',
  '用户/沟通偏好：说话节奏',
  '<!-- /索引 -->',
  '',
].join('\n')

const EXPERIENCE = [
  '- [2026-11-13 12:50] dsh-aiyayi 1.6.1 已发布，profile 已装版',
  '- [2026-11-13 12:50] dsh-aiyayi 1.6.1 已发布，profile 已装版',
  '- [2026-11-13 12:50] dsh-aiyayi 1.6.1 已发布，profile 已装版',
  '',
].join('\n')

// 故意用 T 分隔 + 秒：显示层是 `[2026-11-13 12:50]`，原始行不是连续串。
const RELEASE = ['- [2026-11-13T12:50:33] 发布流程六步走完', '- [2026-11-10 08:00] 发版前先跑一遍测试', ''].join('\n')

const TASTE = ['- [2026-11-11 20:00] 他口味偏淡，不吃香菜', ''].join('\n')

// 第二条档案里的副本：证明"不给 path 时跨档案列候选"，也用于 path 消歧。
const PLUGIN = ['- [2026-11-13 12:50] dsh-aiyayi 1.6.1 已发布，profile 已装版', ''].join('\n')

const fileOf = {
  core: () => join(root, 'memory.md'),
  experience: () => join(root, 'memories', '事情', '经验.md'),
  release: () => join(root, 'memories', '事情', '发布.md'),
  plugin: () => join(root, 'memories', '事情', '插件.md'),
  taste: () => join(root, 'memories', '用户', '口味.md'),
}

const ALL_FILES = [
  () => join(root, 'memory.md'),
  () => join(root, 'memories', '事情', '经验.md'),
  () => join(root, 'memories', '事情', '发布.md'),
  () => join(root, 'memories', '事情', '插件.md'),
  () => join(root, 'memories', '用户', '口味.md'),
]

function seed() {
  writeFileSync(fileOf.core(), CORE, 'utf8')
  mkdirSync(join(root, 'memories', '事情'), { recursive: true })
  mkdirSync(join(root, 'memories', '用户'), { recursive: true })
  writeFileSync(fileOf.experience(), EXPERIENCE, 'utf8')
  writeFileSync(fileOf.release(), RELEASE, 'utf8')
  writeFileSync(fileOf.plugin(), PLUGIN, 'utf8')
  writeFileSync(fileOf.taste(), TASTE, 'utf8')
}

const read = (file) => readFileSync(file, 'utf8')
const countOf = (file, needle) => read(file).split(/\r?\n/).filter((line) => line.includes(needle)).length
const lineNumberOf = (file, needle) => read(file).split(/\r?\n/).findIndex((line) => line.includes(needle)) + 1

/* ------------------------------------------------------------------ *
 * 宿主口径的 schema 校验
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
 * 0. 隔离与 schema 自检
 * ------------------------------------------------------------------ */
console.log('\n=== 0. 隔离与 schema 自检 ===')
check('记忆根确实被定向到 %TEMP% 沙盘（不碰真实记忆库）', coreFile() === join(root, 'memory.md') && treeDir() === join(root, 'memories'), `${coreFile()} / ${treeDir()}`)
check('沙盘在系统临时目录下', resolve(root).startsWith(resolve(tmpdir())), root)

const schemaProblems = schemaTypeProblems(organize.output.schema)
check('output.schema 没有 type 数组 / required 不在 properties 的坑', schemaProblems.length === 0, schemaProblems.join('\n        '))
const forgetParams = organize.parameters.properties
check(
  'forget 的消歧参数 which / line 已声明（additionalProperties:false 不声明就会被宿主拒）',
  forgetParams.which?.type === 'integer' && forgetParams.line?.type === 'integer',
  JSON.stringify(Object.keys(forgetParams)),
)
const outProps = organize.output.schema.properties
check(
  'output.schema 声明了 candidates / nearMatches / searched / matchedBy / removedFrom',
  ['candidates', 'nearMatches', 'searched', 'matchedBy', 'removedFrom'].every((key) => outProps[key] !== undefined),
  JSON.stringify(Object.keys(outProps)),
)
check(
  'candidates / nearMatches 复用同一份候选结构，带 path/file/line/time/content/preview',
  ['path', 'file', 'line', 'time', 'kind', 'content', 'preview'].every((key) => outProps.candidates.items.properties[key] !== undefined) &&
    outProps.nearMatches.items === outProps.candidates.items,
  JSON.stringify(outProps.candidates.items.properties),
)

/* ------------------------------------------------------------------ *
 * 1. 唯一命中：照旧删掉（老行为不能坏）
 * ------------------------------------------------------------------ */
console.log('\n=== 1. 唯一命中删除 ===')
seed()
const beforeCore = read(fileOf.core())
const unique = await forget({ match: '安静地聊' })
check('唯一命中 → done:true', unique.done === true, JSON.stringify(unique))
check('唯一命中 → 说的是子串命中', unique.matchedBy === 'substring', unique.matchedBy)
check('唯一命中 → removedFrom = core', unique.removedFrom === 'core', unique.removedFrom)
check('那条真没了', !read(fileOf.core()).includes('安静地聊'), read(fileOf.core()))
check('别的条目没被牵连', read(fileOf.core()).includes('说好每天给他留一句状态') && read(fileOf.core()).includes('清理记忆时 forget 连着扑空四次'))
check('索引段没被动', read(fileOf.core()).includes('用户/沟通偏好：说话节奏'))
check('detail 带删掉的原文与行号', /删掉了（核心记忆 第 \d+ 行/.test(unique.detail), unique.detail)
check('删完不留两行连续空行', !read(fileOf.core()).includes(`${'用户/沟通偏好：说话节奏'}\n\n`), JSON.stringify(read(fileOf.core()).slice(-60)))
checkOutputShape('唯一命中', unique)

/* ------------------------------------------------------------------ *
 * 2. 同内容多份：列候选、一条都不删
 * ------------------------------------------------------------------ */
console.log('\n=== 2. 同内容多份 → 报错列候选且不删 ===')
seed()
const beforeExperience = read(fileOf.experience())
const beforeFiles = ALL_FILES.map((file) => read(file()))
const ambiguous = await forget({ match: 'dsh-aiyayi 1.6.1 已发布', path: '事情/经验' })
check('多命中 → done:false（不硬删）', ambiguous.done === false, JSON.stringify(ambiguous))
check('多命中 → 候选 3 条', ambiguous.candidates.length === 3, JSON.stringify(ambiguous.candidates))
check('候选带文件路径/行号/时间戳/摘要', ambiguous.candidates.every((c) => typeof c.file === 'string' && c.file.endsWith('.md') && Number.isInteger(c.line) && c.time === '2026-11-13 12:50' && c.preview.includes('dsh-aiyayi 1.6.1')), JSON.stringify(ambiguous.candidates))
check('候选 path 是分类路径', ambiguous.candidates.every((c) => c.path === '事情/经验'), ambiguous.candidates.map((c) => c.path))
check('多命中 → 文件一个字节都没动', read(fileOf.experience()) === beforeExperience)
check('多命中 → 所有档案都没动', ALL_FILES.map((file) => read(file())).join('|') === beforeFiles.join('|'))
check('detail 列出全部候选并给出 which 出路', /命中 3 条记忆/.test(ambiguous.detail) && /which/.test(ambiguous.detail) && /事情\/经验｜第 \d+ 行/.test(ambiguous.detail), ambiguous.detail)
check('detail 明说"一条都没删"', /一条都没删/.test(ambiguous.detail), ambiguous.detail)
checkOutputShape('多命中候选', ambiguous)

/* 不写 path 时：核心 + 全部档案都找，候选跨档案列出来（旧实现只看核心 → 直接报没找到） */
seed()
const crossFile = await forget({ match: 'dsh-aiyayi 1.6.1 已发布' })
const crossPaths = [...new Set(crossFile.candidates.map((c) => c.path))]
check('不给 path → 跨档案找（核心 + 全部档案）', crossFile.done === false && crossFile.candidates.length === 4, JSON.stringify(crossFile.candidates))
check('跨档案候选里同时有 事情/经验 和 事情/插件', crossPaths.includes('事情/经验') && crossPaths.includes('事情/插件'), crossPaths.join(','))
check('不给 path 时 searched 列出找过的全部文件', crossFile.searched.length === 5 && crossFile.searched.includes('core'), crossFile.searched.join(','))
check('跨档案歧义同样不删', countOf(fileOf.experience(), '1.6.1 已发布') === 3 && countOf(fileOf.plugin(), '1.6.1 已发布') === 1)
checkOutputShape('跨档案候选', crossFile)

/* ------------------------------------------------------------------ *
 * 3. 时间戳当 match 能定位（含秒/T 分隔的存储形态）
 * ------------------------------------------------------------------ */
console.log('\n=== 3. 时间戳定位 ===')
seed()
const byStamp = await forget({ match: '[2026-11-13 12:50]', path: '事情/发布' })
check('显示层时间戳对得上 T 分隔+秒的存储行（timestamp 模式）', byStamp.done === true && byStamp.matchedBy === 'timestamp', JSON.stringify(byStamp))
check('显示层时间戳真的删掉了那一行', !read(fileOf.release()).includes('发布流程六步走完'), read(fileOf.release()))
check('同一档案里的其它条目还在', read(fileOf.release()).includes('发版前先跑一遍测试'))
checkOutputShape('时间戳定位', byStamp)

seed()
const stampOnlyTime = await forget({ match: '12:50', path: '事情/发布' })
check('只写时刻（12:50）也能定位（子串先命中 T12:50:33）', stampOnlyTime.done === true && stampOnlyTime.matchedBy === 'substring', JSON.stringify(stampOnlyTime))

seed()
const stampCombo = await forget({ match: '2026-11-13 12:50 发布流程', path: 'core' })
check('「时间戳 + 内容」写法：核心没有 → done:false 且不删', stampCombo.done === false && read(fileOf.core()) === CORE, JSON.stringify(stampCombo))
checkOutputShape('时间戳+内容未命中', stampCombo)

/* 多份同内容用时间戳 match 也要列候选，不能猜着删 */
seed()
const stampAmbiguous = await forget({ match: '2026-11-13 12:50', path: '事情/经验' })
check('时间戳命中多份 → 列 3 条候选、不删', stampAmbiguous.done === false && stampAmbiguous.candidates.length === 3 && read(fileOf.experience()) === EXPERIENCE, JSON.stringify(stampAmbiguous.candidates))
checkOutputShape('时间戳多命中', stampAmbiguous)

/* ------------------------------------------------------------------ *
 * 4. 0 命中诊断：在哪些文件找的 + 近似匹配
 * ------------------------------------------------------------------ */
console.log('\n=== 4. 0 命中诊断 ===')
seed()
// 故意多加空格和感叹号：原样子串一定扑空，归一化后能对上。
const near = await forget({ match: '清理记忆时 forget  连着扑空四次!!', path: 'core' })
check('0 命中 → done:false', near.done === false, JSON.stringify(near))
check('0 命中 → nearMatches 给出"你是不是要找这条"', near.nearMatches.length === 1 && near.nearMatches[0].content.includes('清理记忆时 forget 连着扑空四次'), JSON.stringify(near.nearMatches))
check('0 命中 → 近似匹配只是提示，文件没动', read(fileOf.core()) === CORE)
check('0 命中 → 说清在哪些文件找的', /找过的地方（1 个文件/.test(near.detail) && near.searched.join(',') === 'core', near.detail)
check('0 命中 → detail 提示"没删"', /一条都没删/.test(near.detail), near.detail)
checkOutputShape('近似匹配诊断', near)

seed()
const nothing = await forget({ match: 'zzz 完全不存在的东西 zzz', path: 'core' })
check('真 0 命中 → 没有近似匹配也给可操作提示', nothing.done === false && nothing.nearMatches.length === 0 && /没有近似匹配/.test(nothing.detail), nothing.detail)
check('真 0 命中 → 给出 match/path/line 三条出路', /连续片段/.test(nothing.detail) && /path/.test(nothing.detail) && /line/.test(nothing.detail), nothing.detail)
checkOutputShape('真 0 命中', nothing)

seed()
const nothingGlobal = await forget({ match: 'zzz 完全不存在的东西 zzz' })
check('不给 path 的 0 命中 → searched 是核心 + 全部档案（5 个）', nothingGlobal.done === false && nothingGlobal.searched.length === 5, JSON.stringify(nothingGlobal.searched))

/* 时间戳差一位：放宽到"同一天"给近似命中 */
seed()
const nearStamp = await forget({ match: '2026-11-13 12:51', path: 'core' })
check('时间戳差一分钟 → 归到同一天的近似命中', nearStamp.done === false && nearStamp.nearMatches.some((c) => c.content.includes('清理记忆时 forget 连着扑空四次')), JSON.stringify(nearStamp.nearMatches))
checkOutputShape('时间戳近似', nearStamp)

/* ------------------------------------------------------------------ *
 * 5. which / path / line 消歧
 * ------------------------------------------------------------------ */
console.log('\n=== 5. which / path / line 消歧 ===')
seed()
const picked = await forget({ match: 'dsh-aiyayi 1.6.1 已发布', path: '事情/经验', which: 2 })
check('which:2 → 只删一条', picked.done === true && picked.removedFrom === '事情/经验', JSON.stringify(picked))
check('which:2 → 3 份变 2 份', countOf(fileOf.experience(), '1.6.1 已发布') === 2, read(fileOf.experience()))
check('which 删完把剩下的副本列出来', picked.candidates.length === 2, JSON.stringify(picked.candidates))
check('which 删完提示"还有几份没动"', /还命中 2 条副本/.test(picked.detail), picked.detail)
checkOutputShape('which 消歧', picked)

const pickedAgain = await forget({ match: 'dsh-aiyayi 1.6.1 已发布', path: '事情/经验', which: 1 })
check('再删一次 which:1 → 剩 1 份', pickedAgain.done === true && countOf(fileOf.experience(), '1.6.1 已发布') === 1, read(fileOf.experience()))
const pickedLast = await forget({ match: 'dsh-aiyayi 1.6.1 已发布', path: '事情/经验', which: 1 })
check('第三次删完 → 0 份、候选空', pickedLast.done === true && countOf(fileOf.experience(), '1.6.1 已发布') === 0 && pickedLast.candidates.length === 0, read(fileOf.experience()))

seed()
const outOfRange = await forget({ match: 'dsh-aiyayi 1.6.1 已发布', path: '事情/经验', which: 9 })
check('which 越界 → 不删，改回列候选', outOfRange.done === false && outOfRange.candidates.length === 3 && read(fileOf.experience()) === EXPERIENCE, JSON.stringify(outOfRange))
check('which 越界 → detail 说明超出范围', /超出 1~3/.test(outOfRange.detail), outOfRange.detail)
checkOutputShape('which 越界', outOfRange)

seed()
const byLine = await forget({ line: lineNumberOf(fileOf.core(), '说好每天给他留一句状态'), path: 'core' })
check('line 行号定位 → 删掉那一行', byLine.done === true && byLine.matchedBy === 'line' && !read(fileOf.core()).includes('说好每天给他留一句状态'), JSON.stringify(byLine))
check('line 定位 → 别的条目还在', read(fileOf.core()).includes('安静地聊') && read(fileOf.core()).includes('清理记忆时 forget 连着扑空四次'))
checkOutputShape('line 定位', byLine)

seed()
const byLineGlobal = await forget({ line: lineNumberOf(fileOf.core(), '清理记忆时 forget 连着扑空四次') })
check('不写 path 时 line 按核心记忆算（老语义保留）', byLineGlobal.done === true && byLineGlobal.removedFrom === 'core', JSON.stringify(byLineGlobal))

seed()
const emptyLine = await forget({ line: 999, path: 'core' })
check('line 越界 → 不删且说明不是条目行', emptyLine.done === false && read(fileOf.core()) === CORE && /不是条目行/.test(emptyLine.detail), emptyLine.detail)
checkOutputShape('line 越界', emptyLine)

/* path 消歧：同一内容既有核心副本又有档案副本时，path 指谁删谁 */
seed()
writeFileSync(fileOf.core(), `${CORE}- [2026-11-13 12:50] 事情｜dsh-aiyayi 1.6.1 已发布，profile 已装版\n`, 'utf8')
const pathPicked = await forget({ match: 'dsh-aiyayi 1.6.1 已发布', path: 'core' })
check('path:"core" 只删核心那份，档案里的副本不动', pathPicked.done === true && pathPicked.removedFrom === 'core' && countOf(fileOf.experience(), '1.6.1 已发布') === 3, JSON.stringify(pathPicked))

/* ------------------------------------------------------------------ *
 * 6. 参数校验与收尾
 * ------------------------------------------------------------------ */
console.log('\n=== 6. 参数校验 ===')
seed()
let missing = null
try {
  await forget({})
} catch (error) {
  missing = error
}
check('既没 match 也没 line → 抛错（提示可以用时间戳或行号）', missing !== null && /match/.test(missing.message) && /line/.test(missing.message), missing?.message)
const badWhich = await forget({ match: '安静地聊', which: 0 }).catch((error) => error)
check('which:0 → 抛错（序号从 1 开始）', badWhich instanceof Error && /从 1 开始/.test(badWhich.message), String(badWhich?.message))
check('收尾：沙盘之外的真实记忆库没有被指向（coreFile 仍指向沙盘）', coreFile().startsWith(resolve(sandbox)), coreFile())

process.on('exit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 清理失败不该盖掉真正的测试结果 */
  }
})
console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)
