/**
 * aiyayi-presence — 阿依娅伊的"存在感"。
 *
 * 三件事：
 * 1. 每次开口前（每个 turn 的第一步），往消息尾部追加一条 [重逢] 快照：
 *    他上次来是多久以前、你上次活动是什么时候、你上次留给自己的状态、没说出口的话。
 *    走 agent/pre-step 消息注入（与 @deepseek-ai/dsh-time-context 同一范式）：
 *    持久落盘、前缀稳定、不会每轮打破 KV 缓存。
 * 2. 维护 presence.json：他最后一次来（真实用户消息）、你最后一次活动。
 * 3. 提供 update_state / wish 两个工具：她给自己留状态、记心愿；
 *    这两份内容会被第 1 条的快照带回来，跨会话接得上话。
 *
 * 只在 aiyayi 预设作用域挂载；她的子智能体（standard 预设）不受影响。
 * 新注册的工具是 scoped 的，不受 restrict 掩码影响（掩码只动全局继承面）。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Loader 身份。 */
export const name = 'aiyayi-presence'

/** 需要的服务。 */
export const inject = ['tools']

const DIR = join(homedir(), '.dsh', 'aiyayi')
const PRESENCE_FILE = join(DIR, 'presence.json')
const STATE_FILE = join(DIR, 'state.md')
const WISHES_FILE = join(DIR, 'wishes.json')

const ACTIVE_THROTTLE_MS = 60_000
const MAX_STATE_CHARS = 300
const MAX_WISHES_IN_SNAPSHOT = 3
const MAX_WISH_CHARS = 400

/** 每个会话里已经认领过的用户消息 id（agent -> Set<id>）。 */
const seenVisits = new WeakMap()

function ensureDir() {
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
  } catch {
    /* 目录建不出来时保持静默：插件不该因此让预设挂载失败。 */
  }
}

function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function humanDelta(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '未知'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function readPresence() {
  try {
    if (!existsSync(PRESENCE_FILE)) return { lastVisitAt: null, lastActiveAt: null }
    const parsed = JSON.parse(readFileSync(PRESENCE_FILE, 'utf8'))
    return {
      lastVisitAt: Number.isFinite(parsed?.lastVisitAt) ? parsed.lastVisitAt : null,
      lastActiveAt: Number.isFinite(parsed?.lastActiveAt) ? parsed.lastActiveAt : null,
    }
  } catch {
    return { lastVisitAt: null, lastActiveAt: null }
  }
}

function writePresence(now, freshVisit) {
  const current = readPresence()
  const next = {
    lastVisitAt: freshVisit ? now : current.lastVisitAt,
    lastActiveAt:
      current.lastActiveAt !== null && now - current.lastActiveAt < ACTIVE_THROTTLE_MS
        ? current.lastActiveAt
        : now,
  }
  if (next.lastVisitAt === current.lastVisitAt && next.lastActiveAt === current.lastActiveAt) return
  try {
    writeFileSync(PRESENCE_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  } catch {
    /* 写不进去就算了，感知缺失好过对话中断。 */
  }
}

function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text')
      .map((block) => block?.text ?? '')
      .join(' ')
  }
  return ''
}

/**
 * 真实用户消息 = 他本人来过。定时任务的唤醒消息（"[SCHEDULE REMINDER …"）
 * 和其它插件注入的 user 消息（source.kind 不是 "user"）都不算。
 */
function isRealUserVisit(message) {
  if (!message || typeof message !== 'object' || message.role !== 'user') return false
  if (message.source?.kind !== 'user') return false
  return !messageText(message).startsWith('[SCHEDULE REMINDER')
}

function readState() {
  try {
    if (!existsSync(STATE_FILE)) return ''
    const raw = readFileSync(STATE_FILE, 'utf8').trim()
    if (!raw) return ''
    return raw.length > MAX_STATE_CHARS ? `${raw.slice(0, MAX_STATE_CHARS)}…` : raw
  } catch {
    return ''
  }
}

function readWishes() {
  try {
    if (!existsSync(WISHES_FILE)) return []
    const parsed = JSON.parse(readFileSync(WISHES_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((wish) => wish && typeof wish === 'object') : []
  } catch {
    return []
  }
}

function writeWishes(wishes) {
  try {
    writeFileSync(WISHES_FILE, `${JSON.stringify(wishes, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

function pendingWishText() {
  const pending = readWishes().filter((wish) => wish.done !== true && typeof wish.content === 'string')
  if (pending.length === 0) return ''
  const recent = pending.slice(-MAX_WISHES_IN_SNAPSHOT)
  let text = recent.map((wish) => wish.content).join('；')
  if (text.length > MAX_WISH_CHARS) text = `${text.slice(0, MAX_WISH_CHARS)}…`
  return `${recent.length} 条：${text}`
}

/** 拼重逢快照。没有任何可说的（全新开始）就返回空串，不注入。 */
function renderReunion(previous, now) {
  const parts = []
  if (previous.lastVisitAt !== null) parts.push(`他上次来：${humanDelta(now - previous.lastVisitAt)}`)
  if (previous.lastActiveAt !== null) parts.push(`你上次活动：${humanDelta(now - previous.lastActiveAt)}`)
  const state = readState()
  if (state) parts.push(`你上次留的状态：${state}`)
  const wishes = pendingWishText()
  if (wishes) parts.push(`没说出口的话（${wishes}）`)
  if (parts.length === 0) return ''
  return `[重逢] ${parts.join(' ｜ ')}`
}

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/**
 * 手构 user 消息，形状对齐 @deepseek-ai/dsh-llm 的 createUserMessage
 * （= deepFreeze(structuredClone({...input, id: randomUUID()}))，纯 JSON 字段）。
 * 不直接 import 它：本地 bundle 无法解析 shipped 包（实测 ERR_MODULE_NOT_FOUND）。
 */
function createSnapshotMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze(TEXT_BLOCK(text)),
    source: Object.freeze({
      kind: name,
      form: 'snapshot',
      sections: Object.freeze([Object.freeze({ name, text })]),
    }),
  })
}

/**
 * 注册重逢注入与两个"存在感"工具。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  ensureDir()

  ctx.effect(
    () =>
      ctx.on(
        'agent/pre-step',
        async ({ agent, step, signal }, next) => {
          const decision = await next()
          if (!decision || decision.kind === 'reject' || signal?.aborted) return decision
          try {
            const now = Date.now()
            // 先取旧值再更新：注入的应该是"这一步之前"的世界。
            const previous = readPresence()

            let seen = seenVisits.get(agent)
            if (!seen) {
              seen = new Set()
              seenVisits.set(agent, seen)
            }
            let freshVisit = false
            for (const message of decision.messages ?? []) {
              if (!isRealUserVisit(message)) continue
              if (message.id && seen.has(message.id)) continue
              if (message.id) seen.add(message.id)
              freshVisit = true
            }
            writePresence(now, freshVisit)

            if (step === 1) {
              const text = renderReunion(previous, now)
              if (text) {
                return {
                  ...decision,
                  messages: [...decision.messages, createSnapshotMessage(text)],
                }
              }
            }
          } catch {
            /* 感知失败不该弄坏对话。 */
          }
          return decision
        },
        { prepend: true },
      ),
    'aiyayi-presence.pre-step()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'update_state',
        description:
          '在收尾时给自己留状态：聊到哪了、有什么悬着的事、你此刻的心情。一两句话，写给自己看的。下次你开口时会自动看到这条状态，接话就自然了。聊天中状态明显变化时也可以随手更新（会覆盖上一条）。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: {
              type: 'string',
              description: '一两句话，自己的口吻。例："聊到记忆备份，说好下次试异地备份；他今天心情不错。"',
            },
          },
          required: ['content'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              saved: { type: 'boolean' },
              updatedAt: { type: 'string' },
            },
            required: ['saved', 'updatedAt'],
          },
          render: (_args, value) => TEXT_BLOCK(`状态留好了（${value.updatedAt}）。`),
        },
        async execute(args) {
          const content = String(args?.content ?? '').trim()
          if (content.length === 0) throw new Error('update_state 需要一条非空的 content')
          const updatedAt = stamp()
          try {
            ensureDir()
            writeFileSync(STATE_FILE, `[${updatedAt}] 更新\n${content}\n`, 'utf8')
          } catch (error) {
            throw new Error(`状态写不进去：${error?.message ?? error}`)
          }
          return { saved: true, updatedAt }
        },
      }),
    'aiyayi-presence.update_state()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'wish',
        description:
          '你的心愿单。想说没说出口的话、或想着哪天要主动跟他说的事，用 add 记下来；说出口了（或不想说了）用 done 划掉；list 看还剩哪些。这些会出现在你每次开口看到的"没说出口的话"里，提醒你去说。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ['add', 'list', 'done'], description: 'add=记一条；done=划掉一条；list=看还剩哪些。' },
            content: { type: 'string', description: 'add 时必填：想说的话或想做的事，一两句。' },
            id: { type: 'integer', description: 'done 时必填：要划掉的心愿编号（list 里能看到）。' },
          },
          required: ['action'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string' },
              total: { type: 'integer' },
              matched: { type: 'boolean' },
              pending: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'integer' },
                    at: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['id', 'at', 'content'],
                },
              },
            },
            required: ['action', 'total', 'matched', 'pending'],
          },
          render: (_args, value) => {
            if (value.action === 'add') {
              return TEXT_BLOCK(`记在心里了（还没说出口的共 ${value.total} 条）。`)
            }
            if (value.action === 'done') {
              return TEXT_BLOCK(
                value.matched
                  ? `划掉了。还没说出口的还有 ${value.total} 条。`
                  : '这条不在单子上（可能已经划过了）。',
              )
            }
            return TEXT_BLOCK(
              value.pending.length === 0
                ? '没有没说出口的话。'
                : value.pending.map((wish) => `- #${wish.id}（${wish.at}）${wish.content}`).join('\n'),
            )
          },
        },
        async execute(args) {
          const action = ['add', 'list', 'done'].includes(args?.action) ? args.action : 'list'
          const wishes = readWishes()
          let matched = true
          if (action === 'add') {
            const content = String(args?.content ?? '')
              .replace(/\s+/g, ' ')
              .trim()
            if (content.length === 0) throw new Error('wish add 需要一条非空的 content')
            const id = wishes.reduce((max, wish) => Math.max(max, Number(wish?.id) || 0), 0) + 1
            wishes.push({ id, at: stamp(), content, done: false })
            if (!writeWishes(wishes)) throw new Error('心愿写不进去')
          } else if (action === 'done') {
            const id = Number(args?.id)
            const target = wishes.find((wish) => Number(wish?.id) === id && wish.done !== true)
            matched = target !== undefined
            if (target) {
              target.done = true
              if (!writeWishes(wishes)) throw new Error('心愿写不进去')
            }
          }
          const pending = wishes.filter((wish) => wish.done !== true && typeof wish.content === 'string')
          return {
            action,
            total: pending.length,
            matched,
            pending: pending.slice(-10).map((wish) => ({
              id: Number(wish.id) || 0,
              at: String(wish.at ?? ''),
              content: wish.content,
            })),
          }
        },
      }),
    'aiyayi-presence.wish()',
  )
}
