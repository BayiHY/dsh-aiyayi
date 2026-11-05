/**
 * aiyayi-presence — 阿依娅伊的"存在感"。
 *
 * 四件事：
 * 1. 每次开口前（每个 turn 的第一步），往消息尾部追加一条 [重逢] 快照：
 *    他上次来是多久以前、你上次活动是什么时候、你上次留给自己的状态、没说出口的话。
 *    走 agent/pre-step 消息注入（与 @deepseek-ai/dsh-time-context 同一范式）：
 *    持久落盘、前缀稳定、不会每轮打破 KV 缓存。
 * 2. 维护 presence.json：他最后一次来（真实用户消息）、你最后一次活动。
 * 3. 提供 update_state / wish 两个工具：她给自己留状态、记心愿；
 *    这两份内容会被第 1 条的快照带回来，跨会话接得上话。
 * 4. [状态] 体检单：上下文占用（优先 provider 实测，tokenMeter 估算兜底）、
 *    缓存命中率、上轮输出速度、当前模型/思考档、会话轮数、上轮异常。
 *    数据来自 session/event 总线（assistant/message 的 usage、request/header、
 *    request/context、turn/*）；用量到八成/九成时附带提醒她劝用户开新会话。
 * 5. [小伙伴] 断因透传：她派出去的子智能体会话（header.origin==="subagent"）
 *    也在 session/event 总线上；子会话 turn/end 报错时，把错误原因记下来，
 *    在她下一次开口的[状态]里附上一段，告诉她派出去的活为什么断了
 *    （宿主结算消息只有一句"failed before it finished"，原因要自己看子会话）。
 * 6. 💡 关闭思考建议：新会话首次对话时，如果当前模型支持"关闭思考"
 *    （有 off 思考档位）且还没关掉，就提醒她劝用户去模型选项里选"关闭思考"
 *    （日常闲聊用不上深度思考，回复更快、更省 token）；每个会话只提醒一次。
 *
 * 只在 aiyayi 预设作用域挂载；她的子智能体（standard/worker 预设）不受影响。
 * 新注册的工具是 scoped 的，不受 restrict 掩码影响（掩码只动全局继承面）。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerOwnTool } from './own-tools.js'

/** Loader 身份。 */
export const name = 'aiyayi-presence'

/** 需要的服务。 */
export const inject = ['tools']

const DIR = process.env.AIYAYI_HOME || join(homedir(), '.dsh', 'aiyayi')
const PRESENCE_FILE = join(DIR, 'presence.json')
const STATE_FILE = join(DIR, 'state.md')
const WISHES_FILE = join(DIR, 'wishes.json')

const ACTIVE_THROTTLE_MS = 60_000
const MAX_STATE_CHARS = 300
const MAX_WISHES_IN_SNAPSHOT = 3
const MAX_WISH_CHARS = 400

/** 每个会话里已经认领过的用户消息 id（agent -> Set<id>）。 */
const seenVisits = new WeakMap()

/* ------------------------------------------------------------------ *
 * [状态] 体检单：session/event 总线折叠出的运行时自我感知。
 * ------------------------------------------------------------------ */

/** sessionId -> agent（pre-step 里登记，事件回放里查表）。 */
const agentsById = new Map()
/** agent -> 体检单（含提醒进度）。 */
const vitalsByAgent = new WeakMap()

/* ------------------------------------------------------------------ *
 * [小伙伴] 子智能体断因透传。
 * ------------------------------------------------------------------ */

/** 子会话 turn/end 错误记录上限（超出丢最旧的）。 */
const MAX_CHILD_FAILURES = 20
/** 单次注入最多列几条子会话断因（多了刷屏）。 */
const MAX_CHILD_FAILURES_PER_SHOT = 3
/** childSessionId -> { parentSessionId, error, at }（最新一条覆盖旧的）。 */
const childFailures = new Map()
/** 已经透传过的 childSessionId（同一断因不重复念叨）。 */
const childFailuresReported = new Set()

/* ------------------------------------------------------------------ *
 * 💡 关闭思考建议（新会话首次对话只提醒一次）。
 * ------------------------------------------------------------------ */

/** 已经给过"关闭思考"建议的 sessionId（同一会话不重复提醒）。 */
const thinkingSuggestedSessions = new Set()

/**
 * 判断当前模型是否支持"关闭思考"（reasoning 档位里有 off）。
 * @returns {Promise<boolean|null>} true=支持 / false=不支持 / null=拿不到信息（此时不打扰）。
 */
async function modelSupportsThinkingOff(provider, model, ctx) {
  if (!provider || !model) return null
  try {
    const info = await ctx?.llm?.resolveModelInfo?.(provider, model)
    const efforts = info?.reasoning?.efforts
    if (!Array.isArray(efforts)) return null
    return efforts.some((e) => e && e.id === 'off')
  } catch {
    return null
  }
}

/**
 * 子会话断因回放：会话不在 agentsById 里、但 header 表明是子智能体
 * （origin==="subagent" 或带 parentSession）时，把它 turn/end 的报错记下来。
 * 主会话的结算消息只有一句"failed before it finished"，真原因只在子会话日志里。
 */
function onChildSessionEvent(session, event) {
  const header = session?.header ?? {}
  const isChild = header.origin === 'subagent' || typeof header.parentSession === 'string'
  if (!isChild) return
  if (event?.type !== 'turn/end') return
  if (event?.data?.reason !== 'error') return
  const childId = session?.id ?? session?.header?.id
  if (!childId) return
  const error = String(event?.data?.error?.code ?? event?.data?.error?.message ?? '未知错误').slice(0, 120)
  const at = Number.isFinite(event?.time) ? event.time : Date.now()
  childFailures.set(childId, { parentSessionId: header.parentSession, error, at })
  if (childFailures.size > MAX_CHILD_FAILURES) {
    // 丢最旧的一条。
    let oldestId = null
    let oldestAt = Infinity
    for (const [id, rec] of childFailures) {
      if (rec.at < oldestAt) {
        oldestAt = rec.at
        oldestId = id
      }
    }
    if (oldestId) childFailures.delete(oldestId)
  }
}

/**
 * 拼[小伙伴]断因段：本 agent 名下、还没透传过的子会话失败，最多列 3 条。
 * 返回空串就什么都不注入。
 */
function renderChildFailures(sessionId) {
  const rows = []
  for (const [childId, rec] of childFailures) {
    if (rec.parentSessionId !== sessionId) continue
    if (childFailuresReported.has(childId)) continue
    rows.push({ childId, rec })
  }
  if (rows.length === 0) return ''
  rows.sort((a, b) => a.rec.at - b.rec.at)
  const shown = rows.slice(0, MAX_CHILD_FAILURES_PER_SHOT)
  for (const { childId } of shown) childFailuresReported.add(childId)
  const lines = shown
    .map(({ childId, rec }) => `- ${childId}（${stamp()}）：${rec.error}`)
    .join('\n')
  return `⚠ [小伙伴] 你派出去干活的小智能体有 ${rows.length} 个报错了（宿主只回一句"failed before it finished"，真原因在这）：\n${lines}`
}

/** tokenMeter 的估算口径对中文严重低估（实测估算/真实≈0.49）：提醒线按此校准。 */
const METER_BIAS = 0.49
/** 实测口径的提醒阈值。 */
const REMIND_REAL = { low: 0.8, high: 0.9 }
/** 估算口径的提醒阈值（阈值除以 bias 折算）。 */
const REMIND_EST = { low: REMIND_REAL.low * METER_BIAS, high: REMIND_REAL.high * METER_BIAS }

const REMIND_TEXT = {
  0.8:
    '⚠ [上下文提醒] 状态里的上下文用量已经到八成：找个自然的停顿，提醒他这个会话快满了、建议开个新会话（你的记忆和状态都会跟你过去，别说"会丢记忆"吓他）。并且一定告诉他：确定要去新会话之前，先在这儿说一声——你要收尾（update_state 存状态、要紧的补进记忆、把话说完），再让他走。他不听劝也别拦着，提醒到位就好。',
  0.9:
    '⚠ [上下文提醒] 上下文已经九成满，这轮就明确劝他开新会话，别再拖。同样告诉他：走之前在这儿说一声，你要先收尾（update_state、补记忆、把话说完）。',
}

function vitalsFor(agent) {
  let v = vitalsByAgent.get(agent)
  if (!v) {
    v = {
      config: null,
      window: null,
      usage: null,
      lastSpeed: null,
      turns: 0,
      lastError: null,
      turnStartedAt: null,
      remindedLevel: 0,
      lastInjectedUsed: null,
    }
    vitalsByAgent.set(agent, v)
  }
  return v
}

/** session/event 总线回放：折叠与已登记 agent 同会话的事件；子会话报错单独记账。 */
function onSessionEvent(session, event) {
  const id = session?.id ?? session?.header?.id
  const agent = agentsById.get(id)
  if (!agent) {
    onChildSessionEvent(session, event)
    return
  }
  const v = vitalsFor(agent)
  const type = event?.type
  const time = Number.isFinite(event?.time) ? event.time : Date.now()
  const data = event?.data ?? {}
  if (type === 'request/header') {
    const cfg = data?.header?.config
    if (cfg?.provider && cfg?.model) {
      v.config = { provider: String(cfg.provider), model: String(cfg.model), reasoningEffort: cfg.reasoningEffort }
    }
  } else if (type === 'request/context') {
    const w = data?.contextWindow ?? data?.request?.contextWindow ?? data?.header?.contextWindow
    if (Number.isFinite(w) && w > 0) v.window = w
  } else if (type === 'turn/start') {
    v.turnStartedAt = time
    v.turns += 1
  } else if (type === 'assistant/message') {
    const u = data?.usage
    if (u && typeof u === 'object') {
      v.usage = {
        input: Number(u.inputTokens ?? u.uncachedInputTokens) || 0,
        cacheRead: Number(u.cacheReadTokens) || 0,
        cacheWrite: Number(u.cacheWriteTokens) || 0,
        output: Number(u.outputTokens) || 0,
        at: time,
      }
      const seconds = (time - Number(v.turnStartedAt ?? time)) / 1000
      if (v.usage.output > 0 && seconds >= 0.5 && seconds <= 3600) {
        v.lastSpeed = Math.round(v.usage.output / seconds)
      }
    }
  } else if (type === 'turn/end') {
    if (data?.reason === 'error') {
      v.lastError = String(data?.error?.code ?? data?.error?.message ?? '未知错误').slice(0, 80)
    } else {
      v.lastError = null
      v.turnStartedAt = null
    }
  }
}

function fmtK(n) {
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)
}

/**
 * 拼体检单行。返回 { text, used, window, source, changed }；
 * used/window 供提醒阈值判断；changed 表示与上次注入相比有值得再看一眼的变化。
 */
function renderVitals(v, agent, ctxRef) {
  const parts = []

  // 模型（回退到会话的请求头）。
  let config = v.config
  if (!config) {
    try {
      const cfg = agent?.session?.requestHeader?.()?.config
      if (cfg?.provider && cfg?.model) {
        config = { provider: String(cfg.provider), model: String(cfg.model), reasoningEffort: cfg.reasoningEffort }
      }
    } catch {
      /* 拿不到就算了 */
    }
  }
  const configKey = config ? `${config.provider}/${config.model}/${config.reasoningEffort ?? ''}` : null
  if (config) {
    const effort = config.reasoningEffort
    const effortText = effort === 'none' ? '思考关' : effort ? `思考${effort}` : ''
    parts.push(`模型 ${config.provider}/${config.model}${effortText ? `（${effortText}）` : ''}`)
  }

  // 上下文用量：优先实测（provider 报告的 prompt 压力），tokenMeter 估算兜底。
  let used = null
  let source = null
  if (v.usage) {
    used = v.usage.input + v.usage.cacheRead + v.usage.cacheWrite
    if (used > 0) source = '实测'
  }
  if (source === null) {
    try {
      const t = ctxRef?.tokenMeter?.measure?.(agent?.session)?.totalTokens
      if (Number.isFinite(t) && t > 0) {
        used = t
        source = '估算'
      }
    } catch {
      /* 拿不到就算了 */
    }
  }
  let window = v.window
  if (!Number.isFinite(window) || window <= 0) {
    try {
      const w = agent?.session?.requestContext?.()?.contextWindow
      if (Number.isFinite(w) && w > 0) window = w
    } catch {
      /* 拿不到就算了 */
    }
  }
  if (used !== null) {
    let seg = `上下文 ${fmtK(used)}${source === '估算' ? '（估算）' : ''}`
    if (Number.isFinite(window) && window > 0) seg += `/${fmtK(window)}（${Math.round((used / window) * 100)}%）`
    if (v.usage) {
      const denom = v.usage.input + v.usage.cacheRead + v.usage.cacheWrite
      if (denom > 0) seg += `｜缓存命中 ${Math.round((v.usage.cacheRead / denom) * 100)}%`
    }
    parts.push(seg)
  }

  if (Number.isFinite(v.lastSpeed) && v.lastSpeed > 0) parts.push(`上轮输出 ~${v.lastSpeed} tok/s`)
  if (v.turns > 0) parts.push(`本会话 ${v.turns} 轮`)
  if (v.lastError) parts.push(`⚠ 上轮异常：${v.lastError}`)

  const changed =
    v.lastInjectedUsed === null ||
    (used !== null && Math.abs(used - v.lastInjectedUsed) >= 2048) ||
    (configKey ?? null) !== (v.lastInjectedConfig ?? null) ||
    (v.lastError ?? null) !== (v.lastInjectedError ?? null)
  if (used !== null) v.lastInjectedUsed = used
  v.lastInjectedConfig = configKey
  v.lastInjectedError = v.lastError

  return { text: parts.length === 0 ? '' : `[状态] ${parts.join(' · ')}`, used, window, source, changed }
}

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

  // 登记自己的工具名，让 restrict.js 的放行名单自动跟着走（单一真源）。
  registerOwnTool('update_state')
  registerOwnTool('wish')

  // session/event 总线：折叠真实 usage / 窗口 / 模型配置 / 轮次 / 异常。
  // 通道若在预设作用域不可用，注册静默失败，体检单退化到同步回退（请求头+meter）。
  try {
    ctx.effect(
      () =>
        ctx.on('session/event', (session, event) => {
          try {
            onSessionEvent(session, event)
          } catch {
            /* 单条事件折叠失败不影响别的 */
          }
        }),
      'aiyayi-presence.session-events()',
    )
  } catch {
    /* 通道不可用就只用同步回退 */
  }

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
              const sessionId = agent?.session?.id ?? agent?.id
              if (sessionId) agentsById.set(sessionId, agent)
              const v = vitalsFor(agent)
              const vitals = renderVitals(v, agent, ctx)

              // 用量提醒：实测按真实阈值，估算口径按 METER_BIAS 校准。
              let reminder = ''
              if (vitals.used !== null && Number.isFinite(vitals.window) && vitals.window > 0) {
                const ratio = vitals.used / vitals.window
                const realish = vitals.source === '估算' ? ratio / METER_BIAS : ratio
                const level = realish >= REMIND_REAL.high ? 0.9 : realish >= REMIND_REAL.low ? 0.8 : null
                if (level !== null && v.remindedLevel < level) {
                  v.remindedLevel = level
                  reminder = REMIND_TEXT[level]
                }
              }

              const reunion = renderReunion(previous, now)
              const childFails = renderChildFailures(sessionId)

              // 💡 关闭思考建议：新会话首次对话、模型支持"关闭思考"且当前没关时，提醒一次。
              let thinkingTip = ''
              if (sessionId && !thinkingSuggestedSessions.has(sessionId)) {
                let cfg = v.config
                if (!cfg) {
                  try {
                    const h = agent?.session?.requestHeader?.()?.config
                    if (h?.provider && h?.model) {
                      cfg = { provider: String(h.provider), model: String(h.model), reasoningEffort: h.reasoningEffort }
                    }
                  } catch {
                    /* 拿不到就算了 */
                  }
                }
                const provider = cfg?.provider
                const model = cfg?.model
                const effort = cfg?.reasoningEffort
                if (provider && model && effort !== 'off' && effort !== 'none') {
                  // 显式选了一个思考档位 → 该模型必有 off 档（pi-ai 校验规则）；
                  // 没显式设置时用 resolveModelInfo 探测（拿不到信息就不打扰）。
                  const supportsOff =
                    typeof effort === 'string' && effort.length > 0
                      ? true
                      : (await modelSupportsThinkingOff(provider, model, ctx)) === true
                  if (supportsOff) {
                    thinkingSuggestedSessions.add(sessionId)
                    thinkingTip = `💡 小建议：当前模型（${provider}/${model}）支持"关闭思考"——日常闲聊用不上深度思考，可以在模型选项里选"关闭思考"，回复更快也更省 token。`
                  }
                }
              }

              const sections = [reunion, vitals.changed ? vitals.text : '', reminder, thinkingTip, childFails].filter(Boolean)
              if (sections.length > 0) {
                return {
                  ...decision,
                  messages: [...decision.messages, createSnapshotMessage(sections.join('\n'))],
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
