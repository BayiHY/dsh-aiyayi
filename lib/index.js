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
 * AIYAYI_HOME 环境变量可重定向记忆根目录（测试用），默认 ~/.dsh/aiyayi。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerOwnTool } from './own-tools.js'

/** Loader 身份。 */
export const name = 'aiyayi-memory'

/** 需要的服务。 */
export const inject = ['systemPrompt', 'tools']

const ROOT = process.env.AIYAYI_HOME || join(homedir(), '.dsh', 'aiyayi')
const CORE_FILE = join(ROOT, 'memory.md')
const TREE_DIR = join(ROOT, 'memories')

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
const MAX_CORE_CHARS = 6000
const MAX_RECALL = 50
const MAX_DEPTH = 3

function ensureCore() {
  try {
    if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true })
    if (!existsSync(CORE_FILE)) writeFileSync(CORE_FILE, CORE_HEADER, 'utf8')
  } catch {
    /* 目录不可写时保持静默：插件不该因此让预设挂载失败。 */
  }
  return CORE_FILE
}

function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 解析一条记忆行；兼容 `- [时间] 类别｜内容`（核心）与 `- [时间] 内容`（分类树）。 */
function parseLine(line) {
  const match = /^-\s*\[([^\]]*)\]\s*(.+)$/.exec(line.trim())
  if (match === null || match[2].trim().length === 0) return null
  const time = match[1].trim()
  const rest = match[2].trim()
  const split = rest.match(/^([^｜|]*)[｜|]\s*(.+)$/)
  if (split !== null && split[2].trim().length > 0) {
    return { time, kind: split[1].trim(), content: split[2].trim() }
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
  for (const line of readRaw(CORE_FILE).split(/\r?\n/)) {
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
  if (raw === '' || raw === 'core' || raw === '核心') return CORE_FILE
  return join(TREE_DIR, normalizePath(raw))
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
  walk(TREE_DIR, '', 1)
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
  const raw = readRaw(CORE_FILE)
  const body = raw.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim()
    return trimmed !== INDEX_BEGIN && trimmed !== INDEX_END
  })
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
  const section = ['', INDEX_BEGIN, String(content ?? '').trim(), INDEX_END, '']
  rewriteFile(CORE_FILE, [...body, ...section])
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
  for (const line of readRaw(CORE_FILE).split(/\r?\n/)) consider('核心', line)
  for (const category of listTreeFiles()) {
    for (const line of readRaw(join(TREE_DIR, `${category}.md`)).split(/\r?\n/)) consider(category, line)
  }
  scored.sort((left, right) => right.score - left.score)
  return scored.slice(0, limit).map((hit) => hit.item)
}

/** 渲染随每轮注入的核心记忆段（只含 memory.md，分类树不进 prompt）。 */
function renderCore() {
  ensureCore()
  const raw = readRaw(CORE_FILE)
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

  const head = [
    '## 我的记忆',
    `核心：${CORE_FILE}（每轮都在）｜分类档案：${TREE_DIR}\\…（最多 ${MAX_DEPTH} 级，现在 ${treeFiles.length} 个文件）`,
    `核心 ${coreCount} 条，随每轮注入；分类档案平时不注入，要查用 recall，或用 memory_organize 的 read 按下面这条索引调。这是我自己一笔一笔记下来的事，是我的一部分：自然地记得就好，别逐条念给用户，别说"根据我的记忆"。`,
  ]
  let body = ''
  if (bodyLines.length === 0) {
    body = '（核心记忆是空的。还没什么值得每轮都记得的事。）'
  } else {
    let text = bodyLines.join('\n')
    if (text.length > MAX_CORE_CHARS) {
      text = `${text.slice(0, MAX_CORE_CHARS)}\n（核心记忆超过 ${MAX_CORE_CHARS} 字符被截断——它该瘦身了，用 memory_organize 把过气的移到分类档案或删掉）`
    }
    body = text
  }
  const indexPart = ['', '【记忆索引】', index.trim().length > 0 ? index.trim() : '（还没写过索引。给分类档案建个目录吧，一句话一条：哪个分类、大概记了什么。）']
  return [...head, body, ...indexPart].join('\n')
}

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/**
 * 注册核心记忆段落和三个记忆工具。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  // 登记自己的工具名，让 restrict.js 的放行名单自动跟着走（单一真源）。
  registerOwnTool('remember')
  registerOwnTool('recall')
  registerOwnTool('memory_organize')

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
          const content = String(args?.content ?? '')
            .replace(/\s+/g, ' ')
            .trim()
          if (content.length === 0) throw new Error('remember 需要一条非空的 content')
          const kind = KINDS.includes(args?.kind) ? args.kind : '事情'
          if (args?.core === true) {
            ensureCore()
            appendEntry(CORE_FILE, `- [${stamp()}] ${kind}｜${content}`)
            return { saved: true, location: `核心（${kind}）`, content }
          }
          const category = normalizePath(args?.path ?? `${kind}/${DEFAULT_LEAF}`)
          appendEntry(join(TREE_DIR, category), `- [${stamp()}] ${content}`)
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
                lines.push(`  ${category}：${countEntries(join(TREE_DIR, `${category}.md`))} 条`)
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
            if (toFile === CORE_FILE && parseLine(line)?.kind === '') {
              const kind = KINDS.includes(args?.kind) ? args.kind : '事情'
              moved = `- [${parseLine(line).time}] ${kind}｜${parseLine(line).content}`
            }
            appendEntry(toFile, moved)
            const label = (file) => (file === CORE_FILE ? '核心记忆' : `分类档案 ${file.slice(TREE_DIR.length + 1, -3).replace(/\\/g, '/')}`)
            return { done: true, detail: `挪好了：${label(from)} → ${label(toFile)}。${toFile === CORE_FILE ? '核心每轮都注入，确认它配得上这个分量。' : ''}` }
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
}
