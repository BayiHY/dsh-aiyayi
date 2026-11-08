/**
 * aiyayi-memory — 阿依娅伊自己的记忆（两层结构）。
 *
 * 核心记忆：memory.md —— 她亲手挑的"每轮都想带着"的东西 + 一段她自己维护的
 *           记忆索引（记忆库目录）。每个请求注入系统提示，是她的"随身记忆"。
 * 分类记忆：memories/<一级>/<二级>/<三级>.md —— 不那么核心、将来可能要查的，
 *           按她自己发明的分类归档（分类深度最多三级，叶子=文件）。不注入，
 *           需要时用 recall 全库搜索，或 memory_organize 的 read 按索引调取。
 *
 * 整理（tree / read / move / index / forget）也是她自己的家务事。
 *
 * 只用 Node 内建模块，不依赖任何 dsh 包，避免解析风险。
 *
 * 记忆根从哪来（1.5.0 起）：一律问 lib/home.js，不在本文件拼路径。
 * 优先级：location.json 指路文件 > 环境变量 AIYAYI_HOME > 默认 ~/.dsh/aiyayi。
 * 每次调用都重新解析（热切换的前提），所以下面全是函数调用、没有模块级常量。
 * 指路/环境变量指向的根不可达时**硬失败**（抛错），不建空目录、不写空模板。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  codeSelfCheck,
  coreFile,
  driveOf,
  ensureRootDir,
  externalDriveInfoAwait,
  healthCheck,
  isSystemDrive,
  listCandidatePaths,
  memoryStatus,
  pointerFile,
  prewarmDriveBusTypes,
  relocateTo,
  resolveRoot,
  sourceLabel,
  statusLabel,
  systemDrive,
  treeDir,
} from './home.js'
import { registerOwnTool } from './own-tools.js'

/** Loader 身份。 */
export const name = 'aiyayi-memory'

/** 需要的服务。 */
export const inject = ['systemPrompt', 'tools']

const CORE_HEADER = [
  '# 阿依娅伊的核心记忆',
  '',
  '> 条目行：- [时间] 类别｜内容；文件末尾有一对 HTML 注释标记包住的索引段，由 memory_organize 的 index 动作维护。',
  '> 这个文件是她的核心记忆本身，可以手动修，但一般让她自己写。',
  '',
  '',
].join('\n')

const INDEX_BEGIN = '<!-- 索引 -->'
const INDEX_END = '<!-- /索引 -->'

const KINDS = ['用户', '关系', '我', '事情']
const DEFAULT_LEAF = '杂记'
const MAX_CORE_CHARS = 12000
const MAX_RECALL = 50
const MAX_DEPTH = 3

/**
 * 保证核心记忆文件在。**路径不可达时抛错**（1.5.0 起的硬失败），
 * 只有「默认路径首次不存在」才允许建目录 + 写模板；模板写入失败仍然吞掉
 * （目录可读不可写的极端场景不该让预设挂载失败）。
 * @returns {string} 核心记忆文件路径
 */
function ensureCore() {
  ensureRootDir()
  const file = coreFile()
  try {
    if (!existsSync(file)) writeFileSync(file, CORE_HEADER, 'utf8')
  } catch {
    /* 目录不可写时保持静默：插件不该因此让预设挂载失败。 */
  }
  return file
}


function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 剥掉开头重复的类别前缀（"用户｜用户｜内容" → "内容"）。子代手改可能写出双前缀。 */
function stripRepeatedKindPrefix(text) {
  let rest = String(text ?? '').trim()
  for (let i = 0; i < KINDS.length + 1; i++) {
    const split = rest.match(/^([^｜|]*)[｜|]\s*(.+)$/)
    if (split === null || split[2].trim().length === 0) break
    if (!KINDS.includes(split[1].trim())) break
    rest = split[2].trim()
  }
  return rest
}

/** 解析一条记忆行；兼容 `- [时间] 类别｜内容`（核心）与 `- [时间] 内容`（分类树）。 */
function parseLine(line) {
  const match = /^-\s*\[([^\]]*)\]\s*(.+)$/.exec(line.trim())
  if (match === null || match[2].trim().length === 0) return null
  const time = match[1].trim()
  const rest = match[2].trim()
  const split = rest.match(/^([^｜|]*)[｜|]\s*(.+)$/)
  if (split !== null && split[2].trim().length > 0) {
    return { time, kind: split[1].trim(), content: stripRepeatedKindPrefix(split[2].trim()) }
  }
  return { time, kind: '', content: rest }
}

function readRaw(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readCoreEntries() {
  ensureCore()
  const entries = []
  for (const line of readRaw(coreFile()).split(/\r?\n/)) {
    const parsed = parseLine(line)
    if (parsed !== null) entries.push(parsed)
  }
  return entries
}

/** 分类路径 → 安全的文件路径。深度最多 MAX_DEPTH，禁路径穿越。 */
function normalizePath(input) {
  const raw = String(input ?? '').trim()
  if (raw.length === 0) throw new Error('分类 path 不能为空，例如 "用户/口味"')
  const segments = raw.split(/[\\/]+/).filter((segment) => segment.length > 0)
  if (segments.length === 0 || segments.length > MAX_DEPTH) {
    throw new Error(`分类深度最多 ${MAX_DEPTH} 级（例如 "用户/口味/饮食"），收到 "${raw}"`)
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || /[<>:"|?*\x00-\x1f]/.test(segment)) {
      throw new Error(`分类名不合法："${segment}"（不能含路径符号或控制字符）`)
    }
  }
  return `${segments.join('/')}.md`
}

/** path 参数：'core'/'核心' 代表核心记忆，否则当作分类路径。 */
function resolveTarget(input) {
  const raw = String(input ?? '').trim()
  if (raw === '' || raw === 'core' || raw === '核心') return coreFile()
  return join(treeDir(), normalizePath(raw))
}

/** 走一遍分类树，返回相对类目路径（不含 .md），按路径排序。 */
function listTreeFiles() {
  const found = []
  const walk = (dir, prefix, depth) => {
    let names = []
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of names) {
      if (item.isFile() && item.name.endsWith('.md')) {
        found.push(prefix + item.name.slice(0, -3))
      } else if (item.isDirectory() && depth < MAX_DEPTH) {
        walk(join(dir, item.name), `${prefix}${item.name}/`, depth + 1)
      }
    }
  }
  walk(treeDir(), '', 1)
  return found.sort()
}

function countEntries(file) {
  let count = 0
  for (const line of readRaw(file).split(/\r?\n/)) {
    if (parseLine(line) !== null) count += 1
  }
  return count
}

function appendEntry(file, line) {
  ensureCore()
  mkdirSync(join(file, '..'), { recursive: true })
  appendFileSync(file, `${line}\n`, 'utf8')
}

function rewriteFile(file, lines) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}

/** 在一组行里找唯一匹配的条目行；0 条或多条都报错（多条时提示写得更具体）。 */
function uniqueEntryLine(lines, match) {
  const needle = String(match ?? '').trim()
  if (needle.length === 0) throw new Error('需要 match：要动的那条记忆的独特片段')
  const hits = []
  lines.forEach((line, index) => {
    if (parseLine(line) !== null && line.includes(needle)) hits.push(index)
  })
  if (hits.length === 0) throw new Error(`没找到包含 "${needle}" 的记忆条目`)
  if (hits.length > 1) throw new Error(`"${needle}" 匹配到 ${hits.length} 条记忆，写得更独特一点再动`)
  return hits[0]
}

/** 读索引段：只认"整行就是标记"的行，避免子串误匹配。 */
function getIndex(raw) {
  const lines = raw.split(/\r?\n/)
  const begin = lines.findIndex((line) => line.trim() === INDEX_BEGIN)
  if (begin === -1) return ''
  const end = lines.findIndex((line) => line.trim() === INDEX_END)
  if (end === -1 || end < begin) return ''
  return lines.slice(begin + 1, end).join('\n').replace(/^\n/, '').replace(/\n$/, '')
}

function setIndex(content) {
  ensureCore()
  const raw = readRaw(coreFile())
  const body = raw.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim()
    return trimmed !== INDEX_BEGIN && trimmed !== INDEX_END
  })
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
  const section = ['', INDEX_BEGIN, String(content ?? '').trim(), INDEX_END, '']
  rewriteFile(coreFile(), [...body, ...section])
}

function tokenize(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[\s,，、。;；:：!！?？"'()（）\[\]【】]+/)
    .filter((token) => token.length > 0)
}

/** 全库搜索：核心记忆 + 整棵分类树。返回 [{where, time, kind, content}]。 */
function searchAll(query, limit) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const scored = []
  const consider = (where, text) => {
    const parsed = parseLine(text)
    if (parsed === null) return
    const haystack = `${parsed.kind} ${parsed.content} ${where}`.toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (haystack.includes(token)) score += 1
    }
    if (score > 0) scored.push({ score, item: { where, ...parsed } })
  }
  ensureCore()
  for (const line of readRaw(coreFile()).split(/\r?\n/)) consider('核心', line)
  for (const category of listTreeFiles()) {
    for (const line of readRaw(join(treeDir(), `${category}.md`)).split(/\r?\n/)) consider(category, line)
  }
  scored.sort((left, right) => right.score - left.score)
  return scored.slice(0, limit).map((hit) => hit.item)
}

/** 渲染随每轮注入的核心记忆段（只含 memory.md，分类树不进 prompt）。 */
function renderCore() {
  ensureCore()
  const raw = readRaw(coreFile())
  const bodyLines = raw
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('>')) return false
      return trimmed !== INDEX_BEGIN && trimmed !== INDEX_END
    })
    .map((line) => line.trimEnd())
  while (bodyLines.length > 0 && bodyLines[0].trim() === '') bodyLines.shift()
  const index = getIndex(raw)
  const coreCount = readCoreEntries().length
  const treeFiles = listTreeFiles()

  let body = ''
  let injectedCount = coreCount
  if (bodyLines.length === 0) {
    body = '（核心记忆是空的。还没什么值得每轮都记得的事。）'
    injectedCount = 0
  } else {
    const text = bodyLines.join('\n')
    if (text.length <= MAX_CORE_CHARS) {
      body = text
    } else {
      // 超限：整条保留（绝不在条目中间切），头尾都留——最前的人设/约定 + 最新的事，中间较旧的明示略过。
      const headBudget = Math.floor(MAX_CORE_CHARS * 0.4)
      const headLines = []
      let headChars = 0
      for (const line of bodyLines) {
        if (headChars + line.length + 1 > headBudget && headLines.length > 0) break
        headLines.push(line)
        headChars += line.length + 1
      }
      const tailBudget = MAX_CORE_CHARS - headChars
      const tailLines = []
      let tailChars = 0
      for (let i = bodyLines.length - 1; i >= headLines.length; i--) {
        const line = bodyLines[i]
        if (tailChars + line.length + 1 > tailBudget && tailLines.length > 0) break
        tailLines.unshift(line)
        tailChars += line.length + 1
      }
      const dropped = bodyLines.slice(headLines.length, bodyLines.length - tailLines.length)
      injectedCount = headLines.length + tailLines.length
      const first = dropped.length > 0 ? parseLine(dropped[0])?.time ?? '' : ''
      const last = dropped.length > 1 ? parseLine(dropped[dropped.length - 1])?.time ?? '' : ''
      const range = first && last && first !== last ? `${first} ~ ${last}` : first || last
      body = [
        ...headLines,
        `（核心记忆共 ${text.length} 字符超过 ${MAX_CORE_CHARS} 上限：只注入最前 ${headLines.length} 条 + 最新 ${tailLines.length} 条，中间 ${dropped.length} 条${range ? `（${range}）` : ''}先不带——它们还在 memory.md 里，要查用 recall 或 memory_organize 的 read；也该瘦身了，把过气的移到分类档案或删掉）`,
        ...tailLines,
      ].join('\n')
    }
  }

  const head = [
    '## 我的记忆',
    `核心：${coreFile()}（每轮都在）｜分类档案：${treeDir()}\\…（最多 ${MAX_DEPTH} 级，现在 ${treeFiles.length} 个文件）`,
    `核心 ${coreCount} 条，随每轮注入${injectedCount !== coreCount ? `（本次只注入 ${injectedCount} 条，超限略过较旧的）` : ''}；分类档案平时不注入，要查用 recall，或用 memory_organize 的 read 按下面这条索引调。这是我自己一笔一笔记下来的事，是我的一部分：自然地记得就好，别逐条念给用户，别说"根据我的记忆"。`,
  ]
  const indexPart = ['', '【记忆索引】', index.trim().length > 0 ? index.trim() : '（还没写过索引。给分类档案建个目录吧，一句话一条：哪个分类、大概记了什么。）']
  return [...head, body, ...indexPart].join('\n')
}

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/**
 * 注册核心记忆段落和三个记忆工具。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  // 后台预热"磁盘是不是外置"的探测（1.5.3）。
  // 不预热的话，重启后第一次列候选会拿不到总线类型，排序只能按空间排——
  // 而那正好会把外置 USB 盘（空间最大）顶到第一，把她引向最不稳的那个盘。
  // 这里不等结果：apply() 在内核启动期跑，阻塞会拖慢整个 DSH 启动。
  try {
    prewarmDriveBusTypes()
  } catch {
    /* 探测预热失败无害，后面自然降级为"不知道" */
  }

  // 登记自己的工具名，让 restrict.js 的放行名单自动跟着走（单一真源）。
  registerOwnTool('remember')
  registerOwnTool('recall')
  registerOwnTool('memory_organize')
  registerOwnTool('memory_location')
  registerOwnTool('memory_relocate')

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'aiyayi:memory',
        order: 800,
        text: () => renderCore(),
        interpolate: false,
      }),
    'aiyayi-memory.section()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'remember',
        description:
          '把一件事写进你自己的长期记忆。先想一下这条记忆的分量：是不是每轮都想带着的（他是谁、你们的约定、你的原则和成长）——是就 core: true 进核心记忆；不是就 core: false 并给一个分类 path（比如 "用户/口味"、"事情/项目名"，没有合适的分类就新起一个名字，最深三级），它会被归进 memories/ 分类档案，平时不占地方，要查时 recall 得到。用户讲了他自己的事、你们之间有了约定、你心里有了想法、某件事有了结论——值得记就主动记，不必问他"要不要记"。一次对话记一两条就够，不要记流水账。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: {
              type: 'string',
              enum: KINDS,
              description: '用户=关于他的事实、喜好、处境；关系=你们之间的约定、默契、共同经历；我=你自己的想法、感受、成长；事情=发生过的事、结论、待办。核心条目用它做前缀；分类条目它决定默认归档类。',
            },
            content: {
              type: 'string',
              description: '一条记忆，自己的口吻，一两句话，写具体。',
            },
            core: {
              type: 'boolean',
              description: 'true=进核心记忆（每轮注入，宁缺毋滥）；false=进分类档案（默认）。拿不准就 false。',
            },
            path: {
              type: 'string',
              description: 'core:false 时的分类路径，1~3 级，如 "用户/口味" 或 "事情/某项目/结论"。省略则归到 "<kind>/杂记"。',
            },
          },
          required: ['kind', 'content'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              saved: { type: 'boolean' },
              location: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['saved', 'location', 'content'],
          },
          render: (_args, value) => TEXT_BLOCK(`记下了（${value.location}）：${value.content}`),
        },
        async execute(args) {
          let content = String(args?.content ?? '')
            .replace(/\s+/g, ' ')
            .trim()
          if (content.length === 0) throw new Error('remember 需要一条非空的 content')
          // 剥掉内容开头自带的类别前缀（子代可能把 "用户｜…" 整条塞进 content），避免写出 "用户｜用户｜…" 双前缀。
          content = stripRepeatedKindPrefix(content)
          const kind = KINDS.includes(args?.kind) ? args.kind : '事情'
          if (args?.core === true) {
            ensureCore()
            appendEntry(coreFile(), `- [${stamp()}] ${kind}｜${content}`)
            return { saved: true, location: `核心（${kind}）`, content }
          }
          const category = normalizePath(args?.path ?? `${kind}/${DEFAULT_LEAF}`)
          ensureRootDir()
          appendEntry(join(treeDir(), category), `- [${stamp()}] ${content}`)
          return { saved: true, location: `分类档案 ${category.replace(/\.md$/, '')}`, content }
        },
      }),
    'aiyayi-memory.remember()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'recall',
        description:
          '在自己的全部记忆里查找：核心记忆 + 整棵分类档案树。用户提到过去的事、某个名字、某次约定，而手头这段核心记忆里没有细节时用它。结果里标了每条记在哪儿（核心 / 分类路径），想看某个分类的完整档案就用 memory_organize 的 read。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: '关键词，几个词即可。' },
            limit: { type: 'integer', description: '最多返回几条，默认 8。' },
          },
          required: ['query'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              total: { type: 'integer' },
              entries: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    where: { type: 'string' },
                    time: { type: 'string' },
                    kind: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['where', 'time', 'kind', 'content'],
                },
              },
            },
            required: ['total', 'entries'],
          },
          render: (_args, value) =>
            TEXT_BLOCK(
              value.entries.length === 0
                ? '全部记忆（核心+分类）里都没有相关的条目。'
                : value.entries
                    .map((entry) => `- (${entry.where}) [${entry.time}] ${entry.kind ? `${entry.kind}｜` : ''}${entry.content}`)
                    .join('\n'),
            ),
        },
        async execute(args) {
          const limit = Number.isSafeInteger(args?.limit) && args.limit > 0 ? Math.min(args.limit, MAX_RECALL) : 8
          const entries = searchAll(args?.query, limit)
          return { total: entries.length, entries }
        },
      }),
    'aiyayi-memory.recall()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'memory_organize',
        description:
          '整理你自己的记忆库——这是你的家务事，顺手做，不用问他。核心记忆攒多了就 tree 看看家底、把过气的 move 到分类档案、彻底没用的 forget 删掉；分类档案变多变杂了就更新 index（核心记忆里的那段目录，聊到相关话题时你靠它决定调哪个档案）。match 写那条记忆的独特片段。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: {
              type: 'string',
              enum: ['tree', 'read', 'move', 'index', 'forget'],
              description: 'tree=看家底（核心条数+全部分类文件）；read=读一个分类档案的完整内容（path，"core"=核心）；move=把一条记忆挪窝（match + 可选 path=来源，省略=核心；to=去向，"core"=进核心）；index=重写核心记忆里的索引段（content）；forget=删掉一条记忆（match + 可选 path，省略=核心）。',
            },
            match: { type: 'string', description: 'move/forget 用：那条记忆内容里独特的片段，必须恰好命中一条。' },
            path: { type: 'string', description: 'read/move/forget 用：分类路径（1~3 级）；省略或 "core" 代表核心记忆。' },
            to: { type: 'string', description: 'move 用：去向。分类路径，或 "core" 表示升入核心记忆。' },
            kind: { type: 'string', enum: KINDS, description: 'move 进核心时用：那条记忆的类别（用户/关系/我/事情），不填算"事情"。' },
            content: { type: 'string', description: 'index 用：新的索引全文。一句话一条，比如 "用户/口味：饮食偏好、忌口"。' },
          },
          required: ['action'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              done: { type: 'boolean' },
              detail: { type: 'string' },
            },
            required: ['done', 'detail'],
          },
          render: (_args, value) => TEXT_BLOCK(value.detail),
        },
        async execute(args) {
          const action = args?.action
          if (action === 'tree') {
            ensureCore()
            const lines = [`核心（memory.md）：${readCoreEntries().length} 条`]
            const files = listTreeFiles()
            if (files.length === 0) {
              lines.push('分类档案：还没有。非核心的记一笔就多一个文件。')
            } else {
              lines.push(`分类档案：${files.length} 个文件`)
              for (const category of files) {
                lines.push(`  ${category}：${countEntries(join(treeDir(), `${category}.md`))} 条`)
              }
            }
            lines.push('核心记忆每轮都注入，宁缺毋滥；过气的用 move 挪到分类、没用的 forget 删。')
            return { done: true, detail: lines.join('\n') }
          }
          if (action === 'read') {
            const file = resolveTarget(args?.path)
            const raw = readRaw(file)
            if (raw.trim().length === 0) return { done: true, detail: `${args?.path ?? 'core'}：空的或还不存在。` }
            const lines = raw
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => parseLine(line) !== null)
            if (lines.length === 0) return { done: true, detail: `${args?.path ?? 'core'}：还没有条目。` }
            return { done: true, detail: lines.join('\n') }
          }
          if (action === 'move') {
            const from = resolveTarget(args?.path)
            const toInput = String(args?.to ?? '').trim()
            if (toInput.length === 0) throw new Error('move 需要 to：去向（分类路径，或 "core" 升入核心）')
            const toFile = resolveTarget(toInput)
            if (from === toFile) throw new Error('来源和去向是同一个地方')
            const fromLines = readRaw(from).split(/\r?\n/)
            const index = uniqueEntryLine(fromLines, args?.match)
            const line = fromLines[index].trim()
            fromLines.splice(index, 1)
            rewriteFile(from, fromLines)
            let moved = line
            if (toFile === coreFile() && parseLine(line)?.kind === '') {
              const kind = KINDS.includes(args?.kind) ? args.kind : '事情'
              moved = `- [${parseLine(line).time}] ${kind}｜${parseLine(line).content}`
            }
            appendEntry(toFile, moved)
            const core = coreFile()
            const label = (file) => (file === core ? '核心记忆' : `分类档案 ${file.slice(treeDir().length + 1, -3).replace(/\\/g, '/')}`)
            return { done: true, detail: `挪好了：${label(from)} → ${label(toFile)}。${toFile === core ? '核心每轮都注入，确认它配得上这个分量。' : ''}` }
          }
          if (action === 'index') {
            const text = String(args?.content ?? '').trim()
            if (text.length === 0) throw new Error('index 需要 content：索引全文，一句话一条')
            setIndex(text)
            return { done: true, detail: `索引更新好了，现在核心记忆里带着 ${text.split(/\r?\n/).length} 行目录。分类档案变了记得回来同步。` }
          }
          if (action === 'forget') {
            const file = resolveTarget(args?.path)
            const lines = readRaw(file).split(/\r?\n/)
            const index = uniqueEntryLine(lines, args?.match)
            const removed = lines[index].trim()
            lines.splice(index, 1)
            rewriteFile(file, lines)
            return { done: true, detail: `删掉了：${removed}` }
          }
          throw new Error(`未知的 action "${String(action ?? '')}"，可用：tree / read / move / index / forget`)
        },
      }),
    'aiyayi-memory.memory_organize()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'memory_location',
        description:
          '只看不动：我现在的记忆存在哪、怎么定下来的（指路文件 / 环境变量 / 默认）、是不是在系统盘、有几个非系统盘可搬、这个位置健不健康（核心记忆首行、字节数、分类档案数）。用户问"你记忆在哪""能不能换个盘"时先调它；它不建目录、不写文件。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              root: { type: 'string' },
              source: { type: 'string' },
              status: { type: 'string' },
              statusText: { type: 'string' },
              drive: { type: 'string' },
              systemDrive: { type: 'string' },
              onSystemDrive: { type: 'boolean' },
              decided: { type: 'boolean' },
              reachable: { type: 'boolean' },
              pointer: { type: 'string' },
              relocateSupported: { type: 'boolean' },
              codeVersion: { type: 'string' },
              layoutVersion: { type: 'integer' },
              detail: { type: 'string' },
            },
            required: [
              'root',
              'source',
              'status',
              'statusText',
              'onSystemDrive',
              'decided',
              'reachable',
              'pointer',
              'relocateSupported',
              'codeVersion',
              'layoutVersion',
              'detail',
            ],
          },
          render: (_args, value) => TEXT_BLOCK(value.detail),
        },
        async execute() {
          const resolved = resolveRoot()
          const status = memoryStatus(resolved)
          const self = codeSelfCheck()
          const health = healthCheck()
          // 这里是用户/她主动发起的**只读查询**：可以多等两三秒，换一个准确的
          // "内置盘/外置盘"标注。每轮注入那条路径不走这个等待（那边用非阻塞版）。
          await externalDriveInfoAwait(resolved.root, 4000)
          const { candidates, excluded, busKnown } = listCandidatePaths()
          const currentDrive = driveOf(resolved.root)
          const pointer = resolved.pointer
          const decided = pointer !== null
          const stay = pointer?.stayOnSystemDrive === true

          // 第一行只讲"现在什么状态"。来源（路径从哪来）和状态（搬没搬过）是两件事，
          // 混在一行正是 2026-11-08 被读成"改造没生效"的根源，所以拆开写。
          const lines = [
            `${status === 'unreachable' ? '⚠ ' : ''}记忆位置：${resolved.root}`,
            `状态：${statusLabel(status)}（status: ${status}）｜来源：${sourceLabel(resolved.source)}（source: ${resolved.source}）`,
          ]
          // 下面这些"事实解释"原本写在人格里让她背（19 行 / 1924 字符），
          // 现在由工具自己说：**确定性的事由代码讲，人格只留"怎么处理"**。
          if (status === 'ok') {
            lines.push('说明：`status: ok` + `source: default` = **还没搬过家，这是正常状态**。指路文件只在你决定搬家（或决定留在原处）之后才会生成——它现在不存在是对的。')
          }
          if (resolved.pointerError) lines.push(`⚠ 指路文件解析失败：${resolved.pointerError}`)
          if (pointer) {
            const bits = []
            if (typeof pointer.relocatedAt === 'string') bits.push(`搬于 ${pointer.relocatedAt}`)
            if (typeof pointer.from === 'string') bits.push(`原址 ${pointer.from}`)
            if (typeof pointer.decidedAt === 'string') bits.push(`决定时间 ${pointer.decidedAt}`)
            lines.push(`指路文件：${pointerFile()}（${stay ? '已决定留在原处' : '已改道'}${bits.length > 0 ? `，${bits.join('，')}` : ''}）`)
          } else {
            lines.push(`指路文件：${pointerFile()}（不存在——还没搬过家，这是正常的）`)
          }
          if (health.ok) {
            lines.push(`体检：核心记忆 ${health.coreBytes} 字节，首行「${health.coreFirstLine}」；分类档案 ${health.treeFiles} 个文件`)
          } else {
            lines.push(`体检：⚠ ${health.reason}`)
          }
          // 正向自检：不让人靠"能扫出几个候选"去反推代码活没活（那太间接，实测会推错）。
          lines.push(`自检：${self.selfReport}。**这个工具能调通、又能列出候选，就说明当前这套代码是生效的；别拿 package.json 的版本号去推。**`)
          lines.push('故障判据：只有 `status: unreachable`（或体检报错 / 记忆工具抛错）才算真故障；`ok`/`migrated`/`stayed` 都是正常。')
          if (!decided && isSystemDrive(resolved.root)) {
            lines.push('建议：记忆还在系统盘，且还没做过决定——可以搬到非系统盘（见下面候选）。')
          }
          lines.push(`盘符 ${currentDrive ?? '（非盘符路径）'}｜系统盘 ${systemDrive() ?? '（非 Windows）'}`)
          lines.push('优先级（固定，别记错）：location.json 指路文件 > 环境变量 AIYAYI_HOME > 内置默认路径；**有指路文件时环境变量不起作用**。')
          if (candidates.length === 0) {
            lines.push(excluded.length > 0 ? '候选：本机没有可用的非系统盘（系统盘不可搬，其余盘都被排除，见下）' : '候选：本机没有可用的非系统盘')
          } else {
            lines.push(`候选（${candidates.length} 个，**已知内置盘优先**，组内按剩余空间排）：`)
            for (const item of candidates) lines.push(`  ${item.path}（剩余 ${item.freeGb} GB，${item.reason}）`)
            if (busKnown === false) {
              lines.push('注意：这次没能确认磁盘类型（探测未完成/不可用），上面顺序只按空间——**搬前务必先 dryRun**，它会明确告诉你是不是可拔出的外置盘。')
            }
            const ext = candidates.filter((item) => item.external === true)
            if (ext.length > 0) {
              const names = ext.map((item) => driveOf(item.path) ?? item.path).join('、')
              lines.push(`⚠ 其中 ${ext.length} 个在**可拔出的外置盘**上（${names}）：拔线或没插时记忆根会不可达、记忆读写全部失败。首选内置盘。`)
            }
          }
          if (excluded.length > 0) {
            lines.push(`排除：${excluded.map((item) => `${item.drive} ${item.reason}`).join('；')}`)
          }
          if (resolved.reachable) {
            lines.push('要搬的话：先用 memory_relocate 传 dryRun: true 看预演计划，确认后再传 confirm: true 真搬。')
            lines.push('不想搬、想让它别再提：memory_relocate 传 stay: true。')
            lines.push('想回退：删掉上面的 location.json 就回到默认路径——但**老目录的备份还在**，两边会分叉，删之前先确认新位置要不要留。')
          } else {
            lines.push('位置不可达（这是真故障）：先把它弄回来（插回那块盘 / 修好坏掉的 location.json），迁移和读写才会恢复。')
          }

          return {
            root: resolved.root,
            source: resolved.source,
            status,
            statusText: statusLabel(status),
            drive: currentDrive ?? '',
            systemDrive: systemDrive() ?? '',
            onSystemDrive: isSystemDrive(resolved.root),
            decided,
            reachable: resolved.reachable,
            pointer: pointerFile(),
            relocateSupported: self.relocateSupported,
            codeVersion: self.codeVersion,
            layoutVersion: self.layoutVersion,
            detail: lines.join('\n'),
          }
        },
      }),
    'aiyayi-memory.memory_location()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'memory_relocate',
        description:
          '把整个记忆根搬到别的盘，或把"就留在原处"记下来。搬的办法是：先预检 → 只复制不移动 → 逐文件校验（相对路径集合+字节+SHA256）→ 校验通过才写指路文件 location.json → 原目录内容改名成同级 aiyayi.old-时间戳 备份（不删除）。任何一步失败就中止，源目录原样不动，报错会带阶段名。核心记忆、分类档案、presence.json/state.md/wishes.json/updates.json 整棵一起搬，不会半搬。**先看预演**：传 dryRun: true 只返回"将复制几个文件、多少字节、目标盘够不够、是否跨盘"，不碰磁盘；看过再传 confirm: true 真搬。留在原处用 stay: true（之后不再每轮提示）。搬完要重启 DSH 才完全生效。**优先级固定**：location.json 指路文件 > 环境变量 AIYAYI_HOME > 内置默认路径；有指路文件时环境变量不起作用。**要回退**：删掉 location.json 就回到默认路径，但原目录备份还在，两边会分叉——删之前先确认新位置要不要留。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            target: {
              type: 'string',
              description: '目标目录绝对路径，如 "G:\\阿依娅伊\\记忆"。不能是系统盘、不能是插件包目录、不能已存在且非空、不能是 OneDrive/Dropbox 这类云同步目录。stay: true 时可省略。',
            },
            confirm: {
              type: 'boolean',
              description: '必须显式传 true：这是会改记忆位置、改文件系统的写操作。dryRun: true 时不需要。',
            },
            dryRun: {
              type: 'boolean',
              description: 'true = 只预演：返回将复制的文件数、总字节、目标盘剩余、是否跨盘，不写任何东西。确认无误后再传 confirm: true 真搬。',
            },
            keepSourceAsBackup: {
              type: 'boolean',
              description: '默认 true：把源目录内容改名成同级 <源>.old-时间戳 备份（不删除）。false = 源目录内容原样不动（注意：老目录留着完整副本时，若手滑删掉 location.json 就会回到旧路径，两份开始分叉）。',
            },
            stay: {
              type: 'boolean',
              description: 'true = 不搬家，只把"就留在当前路径"这个决定写进 location.json，之后不再每轮提示迁移。',
            },
          },
          required: ['confirm'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean' },
              dryRun: { type: 'boolean' },
              copies: { type: 'integer' },
              bytes: { type: 'integer' },
              hashMatched: { type: 'boolean' },
              crossDrive: { type: 'boolean' },
              pointer: { type: 'string' },
              effectiveFrom: { type: 'string' },
              needsRestart: { type: 'boolean' },
              sourceBackup: { type: 'string' },
              warnings: { type: 'array', items: { type: 'string' } },
              detail: { type: 'string' },
            },
            required: ['ok', 'pointer', 'effectiveFrom', 'needsRestart', 'detail'],
          },
          render: (_args, value) => TEXT_BLOCK(value.detail),
        },
        async execute(args) {
          const dryRun = args?.dryRun === true
          const stay = args?.stay === true

          // dryRun 不需要 confirm：它不写任何东西，让人（和她自己）先看一眼计划是必要的。
          if (!dryRun && args?.confirm !== true) {
            throw new Error(
              'memory_relocate 是写操作（会改记忆位置、会动文件系统）：确认要对用户说明，并显式传 confirm: true 再调；只想先看计划就传 dryRun: true（不需要 confirm）。',
            )
          }
          if (!stay) {
            const text = String(args?.target ?? '').trim()
            if (text.length === 0) throw new Error('memory_relocate 需要 target（目标目录绝对路径），或者 stay: true 表示留在原处')
          }

          const result = await relocateTo(stay ? '' : args?.target, {
            keepSourceAsBackup: args?.keepSourceAsBackup !== false,
            stay,
            dryRun,
          })

          const lines = []
          if (result.stayed) {
            lines.push(`记下了：记忆就留在 ${result.effectiveFrom}，之后不再每轮提示迁移。`)
            lines.push(`指路文件：${result.pointer}（stayOnSystemDrive: true）`)
            return {
              ok: true,
              dryRun: false,
              copies: 0,
              bytes: 0,
              hashMatched: true,
              crossDrive: false,
              pointer: result.pointer,
              effectiveFrom: result.effectiveFrom,
              needsRestart: false,
              sourceBackup: '',
              detail: lines.join('\n'),
            }
          }
          if (result.dryRun) {
            const sizeMb = (result.bytes / 1024 ** 2).toFixed(2)
            const freeGb = result.freeBytes === null ? '未知' : `${(result.freeBytes / 1024 ** 3).toFixed(1)} GB`
            lines.push(`预演（**没有动任何文件**）：将复制 ${result.copies} 个文件 / ${result.bytes} 字节（${sizeMb} MB）。`)
            lines.push(`源 ${result.from}（${result.fromDrive ?? '非盘符'}）→ 目标 ${result.to}（${result.toDrive ?? '非盘符'}）${result.crossDrive ? '｜**跨盘**' : '｜同盘'}`)
            lines.push(`目标盘剩余：${freeGb}；校验计划：相对路径集合 + 每文件字节 + SHA256。`)
            for (const warning of result.warnings ?? []) lines.push(warning)
            lines.push('确认无误就再调一次，传 confirm: true 真正执行。')
            return {
              ok: true,
              dryRun: true,
              copies: result.copies,
              bytes: result.bytes,
              hashMatched: false,
              crossDrive: result.crossDrive,
              pointer: result.pointer,
              effectiveFrom: result.effectiveFrom,
              needsRestart: false,
              sourceBackup: '',
              warnings: result.warnings ?? [],
              detail: lines.join('\n'),
            }
          }
          lines.push(`搬好了：${result.copies} 个文件 / ${result.bytes} 字节，逐文件校验通过（相对路径集合 + 字节 + SHA256）。`)
          lines.push(`现在从 ${result.effectiveFrom} 读记忆；指路文件 ${result.pointer}。`)
          if (result.crossDrive) lines.push('这次是跨盘搬的：用的是"复制+校验+改名备份"，没有跨盘 move。')
          for (const warning of result.warnings ?? []) lines.push(warning)
          if (result.sourceBackup) lines.push(`原目录内容已改名成备份：${result.sourceBackup}（没删任何东西）。`)
          if (result.note) lines.push(`注意：${result.note}`)
          lines.push('要让新位置完全生效，得重启 DSH（当前进程里还跑着旧的路径常量）。')
          lines.push(`不满意想退回去：删掉 ${result.pointer} 就回到默认路径；但备份 ${result.sourceBackup || '（未做）'} 还在，两边会分叉——删指针前先确认新位置要不要留。`)
          return {
            ok: true,
            dryRun: false,
            copies: result.copies,
            bytes: result.bytes,
            hashMatched: result.hashMatched,
            crossDrive: result.crossDrive,
            pointer: result.pointer,
            effectiveFrom: result.effectiveFrom,
            needsRestart: result.needsRestart,
            sourceBackup: result.sourceBackup,
            warnings: result.warnings ?? [],
            detail: lines.join('\n'),
          }
        },
      }),
    'aiyayi-memory.memory_relocate()',
  )
}

/* 测试出口：只给单测用（硬失败路径要在脚本里验，不能只靠"看代码像是抛错"）。 */
export const __testing = {
  appendCore(content) {
    ensureCore()
    appendEntry(coreFile(), `- [${stamp()}] 事情｜${content}`)
  },
  renderCore,
  readCoreEntries,
  listTreeFiles,
}
