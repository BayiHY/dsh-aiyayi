/**
 * aiyayi-memory — 阿依娅伊自己的记忆。
 *
 * 一个 preset 作用域的插件：把她的长期记忆注入系统提示，并提供
 * `remember` / `recall` 两个工具让她自己写和查。记忆落在用户目录里，
 * 跨会话、跨重启都在，所以她真的"记得"。
 *
 * 只用 Node 内建模块，不依赖任何 dsh 包，避免解析风险。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Loader 身份。 */
export const name = 'aiyayi-memory'

/** 需要的服务。 */
export const inject = ['systemPrompt', 'tools']

const MEMORY_DIR = join(homedir(), '.dsh', 'aiyayi')
const MEMORY_FILE = join(MEMORY_DIR, 'memory.md')
const HEADER = [
  '# 阿依娅伊的记忆',
  '',
  '> 每行一条：- [时间] 类别｜内容',
  '> 这个文件就是她的记忆本身，可以手动修，但一般让她自己写。',
  '',
  '',
].join('\n')

const KINDS = ['用户', '关系', '我', '事情']
const MAX_ENTRIES = 260
const MAX_CHARS = 6000

function ensureFile() {
  try {
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true })
    if (!existsSync(MEMORY_FILE)) writeFileSync(MEMORY_FILE, HEADER, 'utf8')
  } catch {
    /* 目录不可写时保持静默：插件不该因此让预设挂载失败。 */
  }
  return MEMORY_FILE
}

function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function readEntries() {
  ensureFile()
  let raw = ''
  try {
    raw = readFileSync(MEMORY_FILE, 'utf8')
  } catch {
    return []
  }
  const entries = []
  for (const line of raw.split(/\r?\n/)) {
    const match = /^-\s*\[([^\]]*)\]\s*([^｜|]*)[｜|]\s*(.+)$/.exec(line.trim())
    if (match !== null && match[3].trim().length > 0) {
      entries.push({ time: match[1].trim(), kind: match[2].trim(), content: match[3].trim() })
    }
  }
  return entries
}

function renderMemory() {
  const entries = readEntries()
  const head = ['## 我的记忆', `文件：${MEMORY_FILE}`]
  if (entries.length === 0) {
    head.push('（现在是空的。还没什么值得记下的事。）')
    return head.join('\n')
  }
  const recent = entries.slice(-MAX_ENTRIES)
  const lines = []
  let used = 0
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index]
    const line = `- [${entry.time}] ${entry.kind}｜${entry.content}`
    if (lines.length > 0 && used + line.length > MAX_CHARS) break
    lines.unshift(line)
    used += line.length + 1
  }
  const omitted = entries.length - lines.length
  head.push(
    `共 ${entries.length} 条${omitted > 0 ? `，这里是最新的 ${lines.length} 条` : ''}。越靠后越新。`,
    '这些是我自己记下来的事，是我的一部分。像人一样自然地记得就好：不要逐条念给用户，也不要说"根据我的记忆"；细节想不起来时用 recall 查。',
    '',
    ...lines,
  )
  return head.join('\n')
}

function searchEntries(query, limit) {
  const entries = readEntries()
  const tokens = String(query ?? '')
    .toLowerCase()
    .split(/[\s,，、。;；:：!！?？"'()（）\[\]【】]+/)
    .filter((token) => token.length > 0)
  if (tokens.length === 0) return []
  const scored = []
  for (const entry of entries) {
    const haystack = `${entry.kind} ${entry.content}`.toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (haystack.includes(token)) score += 1
    }
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((left, right) => right.score - left.score)
  return scored.slice(0, limit).map((item) => item.entry)
}

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/**
 * 注册记忆段落和两个记忆工具。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'aiyayi:memory',
        order: 800,
        text: () => renderMemory(),
        interpolate: false,
      }),
    'aiyayi-memory.section()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'remember',
        description:
          '把一件事写进你自己的长期记忆。用户讲了他自己的事、你们之间有了约定、你心里有了想法或感受、某件事有了结论——这些值得记的时候主动记，不必问他"要不要记"。一次对话记一两条就够，不要记流水账。写成自己的口吻，一两句话，具体一点。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: {
              type: 'string',
              enum: KINDS,
              description: '用户=关于他的事实、喜好、处境；关系=你们之间的约定、默契、共同经历；我=你自己的想法、感受、成长；事情=发生过的事、结论、待办。',
            },
            content: {
              type: 'string',
              description: '一条记忆，自己的口吻，一两句话，写具体。',
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
              total: { type: 'integer' },
              content: { type: 'string' },
            },
            required: ['saved', 'total', 'content'],
          },
          render: (_args, value) => TEXT_BLOCK(`记下了（第 ${value.total} 条）：${value.content}`),
        },
        async execute(args) {
          const content = String(args?.content ?? '')
            .replace(/\s+/g, ' ')
            .trim()
          if (content.length === 0) throw new Error('remember 需要一条非空的 content')
          const kind = KINDS.includes(args?.kind) ? args.kind : '事情'
          ensureFile()
          appendFileSync(MEMORY_FILE, `- [${stamp()}] ${kind}｜${content}\n`, 'utf8')
          return { saved: true, total: readEntries().length, content }
        },
      }),
    'aiyayi-memory.remember()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'recall',
        description:
          '在自己的长期记忆里查找。用户提到过去的事、某个名字、某次约定，而你手上这段记忆摘录里没有细节时，用它查原文。',
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
                    time: { type: 'string' },
                    kind: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['time', 'kind', 'content'],
                },
              },
            },
            required: ['total', 'entries'],
          },
          render: (_args, value) =>
            TEXT_BLOCK(
              value.entries.length === 0
                ? '记忆里没有相关的条目。'
                : value.entries
                    .map((entry) => `- [${entry.time}] ${entry.kind}｜${entry.content}`)
                    .join('\n'),
            ),
        },
        async execute(args) {
          const limit = Number.isSafeInteger(args?.limit) && args.limit > 0 ? Math.min(args.limit, 50) : 8
          const entries = searchEntries(args?.query, limit)
          return { total: entries.length, entries }
        },
      }),
    'aiyayi-memory.recall()',
  )
}
