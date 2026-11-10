/**
 * aiyayi-presence — 阿依娅伊的"存在感"。
 *
 * 八件事：
 * 1. 每次开口前（每个 turn 的第一步），往消息尾部追加一条 [重逢] 快照：
 *    他上次来是多久以前、你上次活动是什么时候、你上次留给自己的状态、没说出口的话。
 *    走 agent/pre-step 消息注入（与 @deepseek-ai/dsh-time-context 同一范式）：
 *    持久落盘、前缀稳定、不会每轮打破 KV 缓存。
 *    同一条快照里还带 [时间]（她的钟，每轮都有）、插件版本、[闹钟] 巡检行。
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
 * 7. [小伙伴] 子代模型跟随：子智能体的模型在 spawn 时从本体当前模型冻结，
 *    本体之后切换模型（额度用完换模型继续）不会自动传到子代，子代还在旧模型
 *    上继续、照样报额度错。这里在 session/event 总线上登记所有子会话，检测到
 *    本体自己的模型变了（model/selection 事件，或 request/header 路由变化），
 *    就对名下每个子会话调 agent.model.select(新模型)——子会话的模型选择投影
 *    记 pending，它下一步 prep 就会用新模型（尽力而为：agents 注册表拿不到或
 *    单个子同步失败都不影响本体）。
 * 8. [闹钟] 闹钟巡检：每轮把"你自己名下还没到期、或刚到过点的定时任务"
 *    注入一行，让她不用每次自己去 schedule_list 才想得起来。直接读宿主的
 *    schedule 存储（storages/schedule.json，只读），不依赖 schedule 服务——
 *    本插件也挂在小伙伴预设上，那边没有 schedule，inject 不能加。
 *    这一行同时兼任概念纠正：闹钟不是清单，到点是真叫她起床干活。
 *
 * 只在 aiyayi 预设作用域挂载；她的子智能体（standard/worker 预设）不受影响。
 * 新注册的工具是 scoped 的，不受 restrict 掩码影响（掩码只动全局继承面）。
 */
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ensureRootDir,
  healthCheck,
  isSystemDrive,
  listCandidatePaths,
  memoryStatus,
  presenceFile,
  resolveRoot,
  sourceLabel,
  stateFile,
  wishesFile,
} from './home.js'
import { registerOwnTool } from './own-tools.js'

/** Loader 身份。 */
export const name = 'aiyayi-presence'

/** 需要的服务。 */
export const inject = ['tools']

/**
 * 记忆根从哪来：一律问 lib/home.js（1.5.0 起）。优先级 location.json 指路文件 >
 * AIYAYI_HOME > 默认 ~/.dsh/aiyayi。下面全是函数调用：每次用都重新解析（热切换的前提）。
 * 注意：本文件里还留着一次 `homedir()`——那是 L496 附近宿主闹钟存储的兜底
 * （认 DSH_HOME / DSH_SCHEDULE_STORE），属宿主存储不是记忆，**别接 home.js**。
 */

/** 本包根目录（presence.js 在 lib/ 下，上一级就是包根），读 package.json 拿版本。 */
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 自己的插件版本：package.json 现读、进程内缓存，不写死——升级改版本号就自动跟上。 */
let cachedVersion = null
function readLocalVersion() {
  if (cachedVersion !== null) return cachedVersion
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
    cachedVersion = typeof pkg?.version === 'string' ? pkg.version.trim() : ''
  } catch {
    cachedVersion = ''
  }
  return cachedVersion
}

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
 * [小伙伴] 子代模型跟随：本体切模型 → 名下子会话 model.select 同步。
 * ------------------------------------------------------------------ */

/** 见过的子会话上限（超出丢最旧登记，防无界增长）。 */
const MAX_CHILD_SESSIONS = 64
/** childSessionId -> parentSessionId（凡子会话都登记，不只报错的）。 */
const childSessions = new Map()

/**
 * 登记一个子会话：本体名下、还可能在跑的子智能体。
 * @param {object} session 子会话对象（session/event 总线广播的任意会话）。
 */
function trackChildSession(session) {
  const header = session?.header ?? {}
  const isChild = header.origin === 'subagent' || typeof header.parentSession === 'string'
  if (!isChild) return
  const childId = session?.id ?? header.id
  const parentId = typeof header.parentSession === 'string' ? header.parentSession : null
  if (!childId || !parentId) return
  childSessions.set(childId, parentId)
  if (childSessions.size > MAX_CHILD_SESSIONS) {
    // Map 保持插入序，删最旧的（第一个）。
    const oldest = childSessions.keys().next().value
    if (oldest !== undefined) childSessions.delete(oldest)
  }
}

/**
 * 本体模型变了 → 把新模型同步给名下每个还在跑的子会话。
 * 内核：子代模型在 spawn 时从父会话 requestHeader 冻结（resolveChildAgentOptions），
 * 之后父切模型不会自动传播；但子会话自己的模型选择投影（AgentModel.select 写
 * pending）会在它下一步 prep 生效，覆盖 spawn 冻结值。所以这里对每个子 agent
 * 调 model.select —— 全程尽力而为，拿不到 agents 注册表就静默跳过。
 * @param {string} parentSessionId 本体会话 id
 * @param {{provider:string, model:string, reasoningEffort?:string}} selection 新模型
 * @param {object} ctx preset 作用域上下文（取 agents 注册表）
 */
function propagateModelToChildren(parentSessionId, selection, ctx) {
  if (!parentSessionId || !selection?.provider || !selection?.model) return
  let agents = null
  try {
    agents = ctx?.get?.('agents') ?? null
  } catch {
    agents = null
  }
  if (!agents) return
  for (const [childId, parentId] of childSessions) {
    if (parentId !== parentSessionId) continue
    try {
      const childAgent = agents.get?.(childId)
      const select = childAgent?.model?.select
      if (typeof select !== 'function') continue
      select.call(childAgent.model, selection)
    } catch {
      /* 单个子会话同步失败不影响其它 */
    }
  }
}

/**
 * 子代被唤醒时，把模型对齐到父会话当前模型（1.5.7 修复）。
 *
 * 根因：本体切模型后，若子代此刻不在 agents 注册表（DSH 重启 / 激活释放 /
 * 已 dispose），propagateModelToChildren 因 agents.get(childId) 拿不到 agent
 * 会静默跳过，子会话日志里没有 model/selection 事件；随后冷唤醒（coldResume）
 * 只从 durable descriptor 读 spawn 时冻结的旧 provider/model 重建子代，
 * 于是子代沿用旧模型继续，额度错/无法推进任务。
 *
 * 修法：借 agent/inbox/inserted —— 唤醒消息插入 inbox 发生在 wakeDriver→preStep
 * 之前，此时把父会话当前模型写进子会话日志（model/selection 事件），
 * wake 首步 pre-step 的 model.current() 就会读到新模型（不是等下一步）。
 *
 * @param {object} agent 当前子代 agent（agent/inbox/inserted 事件注入的 agent）
 * @param {object} ctx preset 作用域上下文（取 agents 注册表找父会话）
 */
function syncModelWithParentOnWake(agent, ctx) {
  try {
    if (!agent) return
    const header = agent.session?.header ?? {}
    const parentId = typeof header.parentSession === 'string' ? header.parentSession : null
    if (!parentId) return
    let agents = null
    try {
      agents = ctx?.get?.('agents') ?? null
    } catch {
      agents = null
    }
    if (!agents) return
    const parentAgent = agents.get?.(parentId)
    const parentSelection = parentAgent?.model?.current?.()
    if (!parentSelection?.provider || !parentSelection?.model) return
    const childSelection = agent.model?.current?.()
    // 同 provider+model 路由就不动（不同才 select）。
    if (
      childSelection?.provider === parentSelection.provider &&
      childSelection?.model === parentSelection.model
    ) {
      return
    }
    const select = agent.model?.select
    if (typeof select !== 'function') return
    select.call(agent.model, parentSelection)
  } catch {
    /* 单次对齐失败不影响唤醒。 */
  }
}

/* ------------------------------------------------------------------ *
 * 💡 关闭思考建议（新会话首次对话只提醒一次）。
 * ------------------------------------------------------------------ */

/** 已经给过"关闭思考"建议的 sessionId（同一会话不重复提醒）。 */
const thinkingSuggestedSessions = new Set()

/**
 * 已经给过"记忆搬家待办"的 sessionId（1.5.3）。
 *
 * 为什么按会话记而不是按天记（2026-11-08 娅伊提出"隔几天才提一次"的分寸问题）：
 * 1. 模型数不准天：让它"自己掌握隔几天提一次"，结果必然时提时不提——
 *    而"该提却没提"正是这次用户抱怨的问题，不能把它交给一个不可靠的判据。
 * 2. 会话边界是现成的、可靠的节拍：新会话=新的一次开口机会，提一次合适；
 *    同一会话里反复念才烦人。
 * 3. 真要"永久不再提"，用 memory_relocate 的 stay:true 落盘（跨会话生效），
 *    那是用户明确决定，不是模型自己猜的节奏。
 * 上限截断，防止长跑进程里无限增长。
 */
const MAX_TRACKED_SESSIONS = 512
const locationTodoShownSessions = new Set()

/** 记一个 sessionId 到指定"已提示"集合（超上限丢最旧的；多套集合共用）。 */
function markTrackedSession(set, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return
  set.add(sessionId)
  if (set.size > MAX_TRACKED_SESSIONS) {
    const oldest = set.values().next().value
    if (oldest !== undefined) set.delete(oldest)
  }
}

function markLocationTodoShown(sessionId) {
  markTrackedSession(locationTodoShownSessions, sessionId)
}

/**
 * 已经注入过"[闹钟·异常]"检查结果的 sessionId（1.5.6）。
 * 节拍与上面的搬家待办一致：新会话首轮检查，真的有异常才注入并记"已给过"；
 * 空过不记号——之后哪轮出现异常仍会报，不因开局干净就把后到的异常吞掉。
 */
const alarmAnomalyShownSessions = new Set()

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
  // 子代模型跟随：先登记这个子会话（本体名下、还可能在跑），
  // 本体之后切模型时把它也一起同步（见 propagateModelToChildren）。
  trackChildSession(session)
  if (event?.type !== 'turn/end') return
  if (event?.data?.reason !== 'error') return
  const childId = session?.id ?? session?.header?.id
  if (!childId) return
  const error = String(event?.data?.error?.message ?? event?.data?.error?.code ?? '未知错误').slice(0, 120)
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
 * 拼断因段：本 agent 名下、还没透传过的子会话失败，最多列 3 条。
 * label/noun 用来区分"本体看小伙伴"（默认）与"小伙伴看检索员"两种口吻。
 * 返回空串就什么都不注入。
 */
function renderChildFailures(sessionId, { label = '小伙伴', noun = '小智能体' } = {}) {
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
  return `⚠ [${label}] 你派出去干活的${noun}有 ${rows.length} 个报错了（宿主只回一句"failed before it finished"，真原因在这）：\n${lines}`
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
function onSessionEvent(session, event, ctx) {
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
  if (type === 'model/selection') {
    // 本体自己切了模型（用户在模型选项里换了，或配额用完换模型继续）：
    // 把新模型同步给名下每个还在跑的子会话，它们下一步就用新模型。
    const sel = data
    if (sel?.provider && sel?.model) {
      const selection = {
        provider: String(sel.provider),
        model: String(sel.model),
        ...(typeof sel.reasoningEffort === 'string' ? { reasoningEffort: sel.reasoningEffort } : {}),
      }
      propagateModelToChildren(id, selection, ctx)
      v.config = selection
    }
  } else if (type === 'request/header') {
    const cfg = data?.header?.config
    if (cfg?.provider && cfg?.model) {
      const prev = v.config
      const next = {
        provider: String(cfg.provider),
        model: String(cfg.model),
        reasoningEffort: cfg.reasoningEffort,
      }
      // 路由（provider/model）变了也算切模型（有时只有 request/header 没有
      // model/selection 事件）：同样同步给子会话。
      if (prev && (prev.provider !== next.provider || prev.model !== next.model)) {
        propagateModelToChildren(id, next, ctx)
      }
      v.config = next
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

/**
 * 记忆根不存在就建（只对默认路径生效；指路/环境变量不可达时抛错=硬失败）。
 * 返回值是 resolveRoot() 的结果，供调用方判断可达性。
 */
function ensureDir() {
  try {
    return ensureRootDir()
  } catch {
    // 记忆根不可达不该让预设挂载失败，但**绝不**静默回退默认路径：
    // 返回不可达的事实，让上层按需报错（tool 会抛，注入会变成警告行）。
    return resolveRoot()
  }
}

function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 渲染"当前时间"行——她自己的钟。
 *
 * 为什么自带而不依赖 @deepseek-ai/dsh-time-context：那个宿主插件默认
 * refreshIntervalMs=600000（10 分钟节流，见其 lib/index.js L183），距上次
 * 采样不到 10 分钟就跳过注入。实测 2026-11-07 09:21 有采样、09:23 用户问
 * "现在几点"就问不到，她只能派 subagent 跑 Get-Date 才知道 09:24。
 * 宿主那个是"偶尔校准"，这一行是"每轮都有"，两者不冲突。
 *
 * 输出格式：2026-11-07 09:24:03 周五 (UTC+08:00)
 * @param {Date} now - 当前时刻
 * @returns {string} 一行本地时间
 */
function renderNow(now) {
  const pad = (n) => String(n).padStart(2, '0')
  const offsetMin = -now.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const offset = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} 周${WEEKDAYS[now.getDay()]} (${offset})`
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

/* ------------------------------------------------------------------ *
 * [记忆] 每轮一行：不可达给警告，在系统盘且未决定给一句可在行动的提示，
 * 其余（已搬家 / 已决定留原处）不出现。
 *
 * 为什么每轮都注入而不是只首轮：用户随时可能开始"搬家"的对话，提示不该只在
 * 首轮露一下；但一旦做了决定（location.json 存在，含 stayOnSystemDrive:true）
 * 就永久安静，否则每次重启都骚扰。
 * 1.5.1 起刻意压成一行（见下方函数注释），细节全部留给 memory_location。
 * ------------------------------------------------------------------ */

/**
 * 渲染记忆位置提示行。
 *
 * 1.5.1 把它压成一行（2026-11-08 娅伊提出）：这行每轮都注入，原来四五句
 * 等于每轮重复一遍，真正有价值的只有"还没决定"和"候选在哪"。
 *
 * 1.5.3 改语气与**频率**（2026-11-08 用户实测反馈）：
 *
 * ① 语气：原来写「默认路径未搬家（**正常**）」，娅伊读成"没事、不用管"，
 *    于是新会话开场她不主动提，要等用户问才说。问题是这行想表达的是"没坏"，
 *    而她的行为读的是"该不该做点什么"。→ 改成**待办**口吻。
 *
 * ② 频率：她提了一个很实在的分寸问题——"每次你一开口我就念一遍该搬家了，
 *    也挺烦人"。这是真的：这行每回合都在。但**不能**靠模型自己掌握"隔几天提一次"
 *    （它没有可靠的跨轮记忆来数天，硬要它记就会时提时不提）。
 *    所以频率由代码定：**每个会话只在第一次开口时给这条待办**，之后同会话内
 *    不再出现（用户真要问，随时调 memory_location 就有）。跨会话会再出现一次——
 *    新会话=新的一次开口机会，那时提一句是合适的，不构成"每轮念"。
 * @param {{firstOfSession?:boolean}} opts
 * @returns {string} 空串 = 不需要提示（位置可达且不在系统盘，或已经做过决定）
 */
function renderMemoryLocationLine(opts = {}) {
  const resolved = resolveRoot()
  const status = memoryStatus(resolved)

  // 不可达警告 > 建议迁移：两者互斥，择一（不可达时用户先要解决的问题是这个）。
  if (status === 'unreachable') {
    return `[记忆] ⚠ 不可达：${resolved.root}（${sourceLabel(resolved.source)}）。读不到不等于丢了——先让那块盘回来或修 location.json，别新建空目录顶替。`
  }
  // 已做过决定（location.json 存在，含"就留在原处"）→ 不再提示。
  if (status === 'migrated' || status === 'stayed') return ''
  if (!isSystemDrive(resolved.root)) return ''

  // 待办只在"本会话第一次开口"给；之后同会话内不再重复（用户问起时工具里随时能查）。
  if (opts.firstOfSession !== true) return ''

  // 只放"未搬家 + 首选盘"，明细留给 memory_location。
  //
  // **磁盘类型还不知道时绝不报具体盘**（1.5.3 关键）。
  // 这里用的是非阻塞探测：首轮很可能还没探完（PowerShell 要 2.6 秒），
  // 此时 candidates[0] 是按"剩余空间最大"排出来的——而空间最大的往往正是
  // 外置 USB 盘。实测踩过：探测没完成时这行又推荐了 I:（外置盘），
  // 等于把刚修好的坑原样还回来。所以：不知道就说"先跑 memory_location 确认"。
  let count = 0
  let lead = ''
  let busKnown = false
  try {
    const listed = listCandidatePaths()
    count = listed.candidates.length
    busKnown = listed.busKnown === true
    // 只有确认过磁盘类型时，首选才可信（排序已把已知内置盘放前面）。
    const first = listed.candidates[0]
    if (busKnown && first !== undefined && first.external !== null) lead = first.path
  } catch {
    /* 枚举失败也照样提示，只是不报候选数 */
  }

  const head = `【该跟他说一句】记忆在系统盘 ${resolved.root}，还没搬过家。`
  if (count === 0) {
    return `[记忆] ${head}本机暂无非系统盘候选（memory_location 看每个盘被排除的原因）。他没问就先别强推，等他聊到备份/换盘时再说。`
  }
  if (lead === '') {
    // 不知道磁盘类型：只给数量和"去确认"，绝不点名某个盘。
    return `[记忆] ${head}有 ${count} 个非系统盘可搬（**磁盘类型还没确认，别点名推荐**）。**这次开口先主动提一句**："要不要把记忆搬到非系统盘、免得跟着系统盘一起坏？我先用 memory_location 确认哪个是内置盘、再跑个预演给你看"——别自己直接搬，等他点头。他要说"不用搬"就用 memory_relocate 的 stay:true 记下，之后永久不再提；同一次对话别反复念。`
  }
  return `[记忆] ${head}推荐 ${lead}（内置盘，共 ${count} 个候选见 memory_location）。**这次开口先主动提一句**："要不要把记忆搬到非系统盘、免得跟着系统盘一起坏？我先跑个预演给你看"——别自己直接搬，等他点头。他要说"不用搬"就用 memory_relocate 的 stay:true 记下，之后永久不再提；同一次对话别反复念。`
}


/* ------------------------------------------------------------------ *
 * [闹钟] 闹钟巡检：直接读宿主 schedule 存储（只读，不经 schedule 服务）。
 *
 * 为什么不用 schedule_list 工具：本插件同时挂在 aiyayi-worker 预设上，
 * 那边没有 schedule 服务，inject 不能加；而且每轮都调一次工具会多一次
 * 工具往返。宿主把任务落在 storages/schedule.json，结构稳定
 * （tables.tasks[id] = { record, status, target, lastDelivery }）。
 * 只读、失败静默：读不到就当没有闹钟，绝不影响对话。
 * ------------------------------------------------------------------ */

/**
 * 宿主的定时任务存储。
 *
 * 路径解析顺序：`DSH_SCHEDULE_STORE`（显式覆盖，测试用）→ `$DSH_HOME/storages` →
 * `~/.dsh/storages`。别硬编码 `~/.dsh`：`DSH_HOME` 一旦指向别处（换盘、便携版、
 * 多套并存），写死的路径就会静默读不到——而且读不到的表现是"这行不出现"，
 * 没有任何报错，最难排查。
 */
const SCHEDULE_FILE =
  process.env.DSH_SCHEDULE_STORE ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'schedule.json')

/** 一次最多列几个闹钟（多了刷屏）。 */
const MAX_ALARMS_IN_SNAPSHOT = 3
/** 只列"即将到期 / 刚过点还没处理"的窗口：过点超过这么久的当成陈迹不提。 */
const ALARM_STALE_MS = 60 * 60 * 1000
/** 注入里附带的第一条 prompt 摘要长度上限（留够"查什么"，不刷屏）。 */
const ALARM_PROMPT_CHARS = 60

/** 截字：不切断半个 emoji/代理对，只在码点边界停。 */
function clipText(text, max) {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  if (chars.length <= max) return chars.join('')
  return `${chars.slice(0, max).join('')}…`
}

/**
 * 判断一个 record 是不是"会重复"的提醒。
 *
 * 不能只看 `kind !== "at"`：`rrule` 也可能是 `FREQ=DAILY;COUNT=1`（一次性），
 * 而她建的一次性闹钟恰恰常写成这种 RUULE 形式。真正的判据是规则里有没有
 * COUNT=1 —— 只有一次就不算重复。
 * @param {object} record - 宿主存储里的任务 record。
 * @returns {boolean} 是否会再次触发。
 */
function isRecurringRecord(record) {
  const rule = typeof record?.rrule === 'string' ? record.rrule : ''
  const kind = typeof record?.kind === 'string' ? record.kind : ''
  if (rule) return !/\bCOUNT\s*=\s*1\b/i.test(rule)
  // 非 rrule 类型：at 是一次性；after/every/daily/weekly/cron 都会再触发。
  if (kind === 'at') return false
  return kind.length > 0
}

/** 把 ISO 时刻渲染成 "11-08 09:30"（本地时区）。 */
function renderAlarmTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 读宿主存储里属于当前会话的活跃任务。
 * @param {string} sessionId - 当前会话 id。
 * @returns {Array<{title: string, at: number, iso: string, status: string}>}
 */
function readOwnAlarms(sessionId) {
  if (!sessionId) return []
  try {
    if (!existsSync(SCHEDULE_FILE)) return []
    const parsed = JSON.parse(readFileSync(SCHEDULE_FILE, 'utf8'))
    const tasks = parsed?.tables?.tasks
    if (!tasks || typeof tasks !== 'object') return []
    const out = []
    for (const entry of Object.values(tasks)) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry.record ?? {}
      const target = entry.target ?? {}
      // 只认"到点会被投递进来的那个会话"，也就是 target.sessionId。
      // 不能拿 involvedSessionIds 匹配：宿主把"谁 schedule_view 看过它"也记进去，
      // 实测我在当前会话 schedule_view 了一下，这条就多挂了当前会话——那样每个
      // 看过它的会话都会冒出一行"你名下有闹钟"，而其实到点根本不会在那里响。
      if (target.sessionId !== sessionId) continue
      // status: active（还没到点或周期还在）、ended（已跑完）、inactive（暂停）。
      if (entry.status !== 'active') continue
      const at = Date.parse(record.scheduledAt ?? '')
      if (!Number.isFinite(at)) continue
      out.push({
        title: typeof record.title === 'string' ? record.title : '未命名闹钟',
        at,
        iso: record.scheduledAt,
        status: entry.status,
        // 带上 prompt 摘要：光有标题的话，到点她只知道"有个叫查补天的闹钟"，
        // 具体查哪个单号、查完怎么处理全在 prompt 里。宿主投递时虽然会把
        // prompt 原样递进来，但那要等到点；提前给她一句摘要，她才能判断
        // 这个闹钟还该不该留、要不要改。
        prompt: typeof record.prompt === 'string' ? record.prompt : '',
        recurring: isRecurringRecord(record),
      })
    }
    out.sort((a, b) => a.at - b.at)
    return out
  } catch {
    return []
  }
}

/**
 * 拼 [闹钟] 巡检行。
 *
 * 【为什么这里只说"还没到点"，不说"已到点就动手"】
 * 翻 dsh-schedule 源码发现：一次性任务在投递成功那一刻就被 commit 成
 * `status: "ended"`（schedule-service.js:1443，`advanced()` 里
 * `status: occurrence.nextScheduledAt === void 0 ? "ended" : "active"`），
 * 而 commit 紧跟在 send 之后。因此"active 且 scheduledAt 已过"这个状态
 * **不是一个常态窗口，而是投递失败、尚未 commit 的短暂残留**。
 *
 * 结论：把"已到点"当成主要情形去引导她"现在就该动手办"是错的——
 * 绝大多数到点时，宿主已经把提醒消息（`[SCHEDULE REMINDER]`）投进会话了，
 * 她是从那条消息醒来的，不需要再被这里催一遍；反过来，残留状态意味着
 * 投递出了问题，这时候该让她知道"这条没送到"，而不是叫她干活。
 *
 * 所以三种措辞定为：
 * - 还没到点：报“还有多久”，她心里有数就行；
 * - active 但已过点（窄窗口，投递失败残留）：如实报"提醒没送达、还在待投"，
 *   别伪造"到点了快办"；
 * - 没有活跃闹钟 / 只剩过点太久的：整行不注入（返回空串），保持上下文干净。
 *   不注入不等于"明确告诉她没闹钟"——想让"没闹钟"也有话说就得每轮多挂一行，
 *   权衡下来选了安静的那边；她想知道确切清单时用 schedule_list 即可。
 * @param {string} sessionId - 当前会话 id。
 * @param {number} now - 当前毫秒。
 * @returns {string} 一行注入文本，没有可说的返回空串。
 */
function renderAlarms(sessionId, now) {
  const all = readOwnAlarms(sessionId)
  if (all.length === 0) return ''

  const due = all.filter((a) => a.at <= now && now - a.at <= ALARM_STALE_MS)
  const upcoming = all.filter((a) => a.at > now)
  const shown = [...due, ...upcoming].slice(0, MAX_ALARMS_IN_SNAPSHOT)
  // 只剩过点太久的陈迹时，别报"还挂着 N 个"却列不出来——那种空壳行会让她
  // 以为有闹钟要办，反而误导。整行不注入。
  if (shown.length === 0) return ''

  const items = shown.map((a) => {
    const when = renderAlarmTime(a.iso)
    const repeat = a.recurring ? '·会重复' : ''
    if (a.at <= now) {
      const late = humanDelta(now - a.at)
      // 投递失败残留：如实说"没送到"，别编"到点了快办"。
      return `${a.title}（${when} 已过点，${late}，提醒还没送达${repeat}）`
    }
    const inMs = a.at - now
    const inHuman =
      inMs < 3600000
        ? `${Math.max(1, Math.round(inMs / 60000))} 分钟后`
        : inMs < 86400000
          ? `${Math.floor(inMs / 3600000)} 小时后`
          : `${Math.floor(inMs / 86400000)} 天后`
    return `${a.title}（${when}，${inHuman}${repeat}）`
  })

  // 计数只算真正会列出来的（过点太久的陈迹不计，免得"3 个还挂着"只列 2 条）。
  const live = due.length + upcoming.length
  const head = `[闹钟] 你名下 ${live} 个还挂着：${items.join('；')}`

  // 摘一条 prompt 给她看。挑法有讲究：
  // - 不能从 `shown` 里挑——`shown` 被截到前 3 条，真正有内容的那条可能排在后面，
  //   结果拿一条占位 prompt 冒充"要做的事"；
  // - 也不能无脑海"最早那条"——同理。
  // 所以从**全部**可见任务里挑"有实质内容"的第一条（同条件下按时间最早）。
  const candidates = [...due, ...upcoming]
  const meaningful = candidates.filter((a) => (a.prompt ?? '').trim().length >= ALARM_PROMPT_CHARS)
  const lead = meaningful[0] ?? candidates.find((a) => (a.prompt ?? '').trim().length > 0)
  const digest = lead ? `「${lead.title}」到点要做：${clipText(lead.prompt, ALARM_PROMPT_CHARS)}` : ''

  if (due.length > 0) {
    // 已过点 = 宿主没把提醒投进来。这时候催她"动手办"没有意义，
    // 该提示的是"这条没响，检查一下目标会话/手动改期重投"。
    return [
      head,
      digest,
      '已过点的那条没送到你手上（正常到点是被宿主当成一条提醒消息直接投进会话的）；要它再响，用 schedule_edit 改期，或者确认目标会话还在不在。',
    ]
      .filter(Boolean)
      .join('\n')
  }
  return [
    head,
    digest,
    '这些到点会真的把你叫醒；到点了不用他提醒，你自己去办。',
  ]
    .filter(Boolean)
    .join('\n')
}

/* ------------------------------------------------------------------ *
 * [闹钟·异常] 定时器异常检查（1.5.6：新会话首轮、仅异常时注入）。
 *
 * 背景（2026-11-09 实锤案例）：每日日记闹钟 schedule-e79f9c46 到点正常触发
 * （lastDelivery 有回执），但投进了已归档旧会话 session-346b0fdb，当前会话
 * 毫无感知。翻宿主 dsh-schedule 源码（node_modules/@deepseek-ai/dsh-schedule
 * lib/index.js:1576）：投递绑定任务存储里的 target.sessionId —— `resolveAgent
 * (task.sessionId)` 解析失败只 warn 一句，消息不进任何会话；旧会话归档后
 * 提醒就静默丢失。而上面的 [闹钟] 巡检只认 "target.sessionId === 当前会话"，
 * 孤儿任务恰好被这条件藏住——两个会话谁都看不见它。这层"账目核查"专报
 * [闹钟] 看不见的异常。
 *
 * 静默原则：无异常 → 零输出（不与 [闹钟] 行重复、不每轮白涨上下文）。
 * 只读原则：只读 storages/schedule.json，绝不写；改投/改期仍由她用
 * schedule_edit 走宿主服务，本函数不碰存储。
 * ------------------------------------------------------------------ */

/** 解析整个 schedule store（全部任务，不限当前会话）。失败静默为空。 */
function readScheduleEntries() {
  try {
    if (!existsSync(SCHEDULE_FILE)) return []
    const parsed = JSON.parse(readFileSync(SCHEDULE_FILE, 'utf8'))
    const tasks = parsed?.tables?.tasks
    if (!tasks || typeof tasks !== 'object') return []
    return Object.values(tasks).filter((entry) => entry && typeof entry === 'object')
  } catch {
    return []
  }
}

/** 会话短 id：session-前 8 位。报告里点名用，不刷全串。 */
function shortSessionId(id) {
  if (typeof id !== 'string' || id.length === 0) return '无目标'
  const raw = id.startsWith('session-') ? id.slice('session-'.length) : id
  return `session-${raw.slice(0, 8)}`
}

/**
 * 拼 [闹钟·异常] 检查行。三种异常，措辞全用事实、不替她做决定：
 * a) 孤儿目标：active 任务但 target.sessionId ≠ 当前会话——到点会投进别处
 *    （很可能是已归档旧会话），本会话永远收不到；列 任务名→目标短id+下次触发。
 * b) 投递回执缺失：lastDelivery.scheduledAt 在而 deliveredAt 缺失——宿主
 *    回执是投递确认后才整体写入的（dsh-schedule lib/index.js:1598-1607，
 *    scheduledAt/deliveredAt/messageId 三个字段一起落），缺 deliveredAt 说明
 *    这份账目不完整，投递链路出过状况。
 * c) paused（inactive）任务计数：事实带过，不算故障。
 * 无异常返回空串（零输出）。
 * @param {string} sessionId - 当前会话 id。
 * @returns {string} 一行注入文本，没有异常返回空串。
 */
function renderAlarmAnomalies(sessionId) {
  if (!sessionId) return ''
  const entries = readScheduleEntries()
  if (entries.length === 0) return ''

  const orphans = []
  const brokenReceipts = []
  let paused = 0
  for (const entry of entries) {
    const record = entry.record ?? {}
    const target = entry.target ?? {}
    const title = typeof record.title === 'string' && record.title.length > 0 ? record.title : '未命名闹钟'
    // c) 暂停任务计数（inactive 不会触发，只报数；status 判据与 readOwnAlarms 一致）。
    if (entry.status === 'inactive') paused++
    // a) 孤儿目标：到点会被投到别处的活跃任务。
    if (entry.status === 'active' && target.sessionId !== sessionId) {
      orphans.push({ title, target: target.sessionId, iso: record.scheduledAt })
    }
    // b) 回执缺失：scheduledAt 记了、deliveredAt 没记（正常回执三字段一起落）。
    const receipt = entry.lastDelivery
    if (
      receipt &&
      typeof receipt === 'object' &&
      typeof receipt.scheduledAt === 'string' &&
      receipt.scheduledAt.length > 0 &&
      (receipt.deliveredAt === undefined || receipt.deliveredAt === null || receipt.deliveredAt === '')
    ) {
      brokenReceipts.push({ title, iso: receipt.scheduledAt })
    }
  }

  const parts = []
  if (orphans.length > 0) {
    // 最多列 3 条（同 [闹钟] 行的刷屏上限），多的报总数。
    const shown = orphans.slice(0, MAX_ALARMS_IN_SNAPSHOT)
    const items = shown.map((o) => `${o.title}→${shortSessionId(o.target)}，下次 ${renderAlarmTime(o.iso) || '时间未知'}`)
    const more = orphans.length > shown.length ? `（等 ${orphans.length} 个）` : ''
    parts.push(`孤儿目标 ${orphans.length} 个（active 但目标会话不是这里，到点投不进来）：${items.join('；')}${more}`)
  }
  if (brokenReceipts.length > 0) {
    const shown = brokenReceipts.slice(0, MAX_ALARMS_IN_SNAPSHOT)
    const items = shown.map((r) => `${r.title}（目标点 ${renderAlarmTime(r.iso) || '时间未知'}，deliveredAt 缺失）`)
    const more = brokenReceipts.length > shown.length ? `（等 ${brokenReceipts.length} 条）` : ''
    parts.push(`投递回执缺失 ${brokenReceipts.length} 条：${items.join('；')}${more}`)
  }
  if (paused > 0) parts.push(`另有 ${paused} 个暂停任务（inactive，不会触发）`)
  if (parts.length === 0) return ''
  const head = `[闹钟·异常] ${parts.join('；')}`
  // 孤儿目标附一句出路：改投动作只有她自己用 schedule_edit 能做（本插件只读）。
  return orphans.length > 0 ? `${head}。孤儿任务要留的话用 schedule_edit 改投本会话` : head
}

function readPresence() {
  try {
    if (!existsSync(presenceFile())) return { lastVisitAt: null, lastActiveAt: null }
    const parsed = JSON.parse(readFileSync(presenceFile(), 'utf8'))
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
    writeFileSync(presenceFile(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
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
    if (!existsSync(stateFile())) return ''
    const raw = readFileSync(stateFile(), 'utf8').trim()
    if (!raw) return ''
    return raw.length > MAX_STATE_CHARS ? `${raw.slice(0, MAX_STATE_CHARS)}…` : raw
  } catch {
    return ''
  }
}

function readWishes() {
  try {
    if (!existsSync(wishesFile())) return []
    const parsed = JSON.parse(readFileSync(wishesFile(), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((wish) => wish && typeof wish === 'object') : []
  } catch {
    return []
  }
}

function writeWishes(wishes) {
  try {
    writeFileSync(wishesFile(), `${JSON.stringify(wishes, null, 2)}\n`, 'utf8')
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
function createSnapshotMessage(text, sourceName = name) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze(TEXT_BLOCK(text)),
    source: Object.freeze({
      kind: sourceName,
      form: 'snapshot',
      sections: Object.freeze([Object.freeze({ name: sourceName, text })]),
    }),
  })
}

/**
 * 把包内置的 skills/<name>/ 同步进 DSH 技能根（$DSH_HOME 优先，回退 ~/.dsh，下同
 * dsh-home-paths 的 env 语义），让 dsh-aiyayi 自带技能（如 feishu-setup）随插件
 * 安装自动出现在技能目录——其他用户从 npm 装包后无需手工拷贝。
 * 判据：目标 SKILL.md 存在且内容一致就跳过；缺失或不一致才整目录覆盖（含 scripts/）。
 * 全程 try/catch 静默：技能同步失败绝不影响会话。
 */
function syncBundledSkills(ctx) {
  try {
    const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
    const bundledDir = join(pkgDir, 'skills')
    if (!existsSync(bundledDir)) return
    const dshHomeEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
    const skillsRoot = join(dshHomeEnv || join(homedir(), '.dsh'), 'skills')
    for (const name of readdirSync(bundledDir)) {
      const sourceSkill = join(bundledDir, name, 'SKILL.md')
      if (!existsSync(sourceSkill)) continue
      const targetDir = join(skillsRoot, name)
      const targetSkill = join(targetDir, 'SKILL.md')
      let unchanged = false
      try {
        unchanged = existsSync(targetSkill) && readFileSync(targetSkill, 'utf8') === readFileSync(sourceSkill, 'utf8')
      } catch {
        unchanged = false
      }
      if (unchanged) continue
      mkdirSync(skillsRoot, { recursive: true })
      copyTree(join(bundledDir, name), targetDir)
      try {
        ctx?.logger?.info?.(`aiyayi: 已同步内置技能 ${name} → ${targetDir}`)
      } catch {
        /* 打日志失败无所谓 */
      }
    }
  } catch {
    /* 技能同步失败不影响会话 */
  }
}

/**
 * 手写递归复制，替代 fs.cpSync({recursive:true})。
 * **坑（2026-11-10 实测，Node 22 / Windows）**：cpSync 递归复制**源目录路径含非
 * ASCII 字符**时进程原生崩溃（exit -1073740791 / 0xC0000409 fail-fast，无任何
 * JS 异常可捕——本包路径"阿依娅依"正好踩中）。而 readdirSync / copyFileSync /
 * 单文件 cpSync 对同样路径全部正常，所以用这几个原语手拼。原语各自 try/catch
 * 由上层 syncBundledSkills 的静默 catch 兜底。
 */
function copyTree(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source)) {
    const from = join(source, entry)
    const to = join(target, entry)
    let isDir = false
    try {
      isDir = statSync(from, { throwIfNoEntry: false })?.isDirectory() === true
    } catch {
      isDir = false
    }
    if (isDir) copyTree(from, to)
    else copyFileSync(from, to)
  }
}

/**
 * 注册重逢注入与两个"存在感"工具。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  ensureDir()
  syncBundledSkills(ctx)

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
            onSessionEvent(session, event, ctx)
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

              // 版本自述：让"我是什么版本"有答案（区分插件版与 DSH 桌面版），
              // 有新版时 updates 插件照旧单独提醒"本地 X → npm Y"。
              const ownVersion = readLocalVersion()
              const versionLine = ownVersion ? `你当前插件版本：dsh-aiyayi ${ownVersion}` : ''

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

              // 当前时间：她的钟。每轮都有，不受宿主 time-context 10 分钟节流影响。
              const clockLine = `[时间] 现在 ${renderNow(new Date(now))}`

              // 闹钟巡检：她自己名下还没办/刚到点的提醒。没有就不提。
              const alarmLine = renderAlarms(sessionId, now)

              // [闹钟·异常]：新会话首轮检查孤儿目标/回执缺失/暂停计数，有异常才注入
              // 并记"已给过"；空过不记号，后到的异常仍会报（与搬家待办同一条纪律：
              // 空串不许把该说的话吞掉）。零异常零输出，[闹钟] 行管不到的才归它说。
              const alarmAnomalyFirstOfSession =
                sessionId !== undefined && sessionId !== null && !alarmAnomalyShownSessions.has(sessionId)
              const alarmAnomalyLine = alarmAnomalyFirstOfSession ? renderAlarmAnomalies(sessionId) : ''
              if (alarmAnomalyFirstOfSession && alarmAnomalyLine !== '') markTrackedSession(alarmAnomalyShownSessions, sessionId)

              // 记忆位置：不可达=每轮警告；待办只在**本会话第一次开口**给一次。
              // 频率由代码定，不交给模型去"记住隔几天提一次"（它数不准，会时提时不提）。
              // 挂在同一个 agent/pre-step 上，不另开 ctx.on（避免两个注入器抢消息顺序）。
              const locationFirstOfSession = sessionId !== undefined && sessionId !== null && !locationTodoShownSessions.has(sessionId)
              const locationLine = renderMemoryLocationLine({ firstOfSession: locationFirstOfSession })
              // 只有**真的给出内容**时才记"已提示过"，否则空串会把待办吞掉。
              if (locationFirstOfSession && locationLine !== '') markLocationTodoShown(sessionId)

              const sections = [clockLine, locationLine, alarmLine, alarmAnomalyLine, reunion, versionLine, vitals.changed ? vitals.text : '', reminder, thinkingTip, childFails].filter(Boolean)
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
            const resolved = ensureDir()
            if (!resolved.reachable) throw new Error(`记忆目录不可达：${resolved.root}`)
            writeFileSync(stateFile(), `[${updatedAt}] 更新\n${content}\n`, 'utf8')
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

/**
 * 工厂：给"小伙伴"（aiyayi-worker）用的轻量存在感（需求书 2026-11-06 需求二）。
 * 与本体 aiyayi-presence 共享同一套模块级会话账本（agentsById/childSessions/
 * childFailures），但只做两件事：
 * 1. 检索员（孙代）挂掉时，把可读断因注进小伙伴的下一步——宿主对孙代失败只会
 *    回一句 "failed before it finished"，没有这层小伙伴就只能瞎猜该续派还是重派；
 * 2. 把小伙伴会话登记进 agentsById，让模型切换事件能走主折叠路径，
 *    顺着 childSessions 传到它名下的检索员（孙代模型跟随）。
 * 刻意不做：presence.json 读写、重逢注入、体检单、用量提醒、思考建议、
 * update_state/wish——那些是"阿依娅伊本体"的人格件，不该长在工具人身上。
 * @param workerName - 插件名（注入消息的 source.kind 用）。
 */
export function createWorkerApply(workerName) {
  return function workerApply(ctx) {
    syncBundledSkills(ctx)
    try {
      ctx.effect(
        () =>
          ctx.on('session/event', (session, event) => {
            try {
              onSessionEvent(session, event, ctx)
            } catch {
              /* 单条事件折叠失败不影响别的 */
            }
          }),
        `${workerName}.session-events()`,
      )
    } catch {
      /* 通道不可用就只靠 pre-step 注入 */
    }

    // 1.5.7：唤醒对齐模型。子代被冷唤醒（coldResume）时从 durable descriptor 读
    // 旧模型；趁 agent/inbox/inserted（早于 wakeDriver→preStep）把父会话当前模型
    // 写进子会话日志，wake 首步即用新模型，避免沿用旧模型报额度错/无法推进。
    try {
      ctx.effect(
        () =>
          ctx.on('agent/inbox/inserted', ({ agent }) => {
            try {
              syncModelWithParentOnWake(agent, ctx)
            } catch {
              /* 单次对齐失败不影响唤醒。 */
            }
          }),
        `${workerName}.wake-model-sync()`,
      )
    } catch {
      /* 通道不可用就只靠本体侧 propagateModelToChildren 尽力而为。 */
    }

    ctx.effect(
      () =>
        ctx.on(
          'agent/pre-step',
          async ({ agent, step, signal }, next) => {
            const decision = await next()
            if (!decision || decision.kind === 'reject' || signal?.aborted) return decision
            try {
              if (step === 1) {
                const sessionId = agent?.session?.id ?? agent?.id
                if (sessionId) {
                  // 登记进共享账本：本会话后续事件改走主折叠路径（模型跟随依赖它），
                  // 本体侧的 childSessions"本体→小伙伴"映射在登记前的首批事件里已记好。
                  agentsById.set(sessionId, agent)
                  const childFails = renderChildFailures(sessionId, { label: '检索员', noun: '检索员' })
                  if (childFails) {
                    return {
                      ...decision,
                      messages: [...decision.messages, createSnapshotMessage(childFails, workerName)],
                    }
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
      `${workerName}.pre-step()`,
    )
  }
}

/* 测试出口：只给单测用（正常路径由 pre-step 钩子调用）。 */
export const __testing = { renderAlarms, readOwnAlarms, renderAlarmTime, renderMemoryLocationLine, renderAlarmAnomalies, readScheduleEntries, shortSessionId, syncBundledSkills }
