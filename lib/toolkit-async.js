/**
 * aiyayi-toolkit / 异步任务投递 helper（1.5.41 新增）
 *
 * **为什么要有这一层**（详见 docs/经验-工具真异步与宿主同步await.md，坑 #79）：
 * DSH 宿主的 agent loop 是**同步 await 一批工具**的（app.asar:
 * `@deepseek-ai/dsh-agent-loop` 的 `await this.loopCtx.tools.execute({calls,...})`，
 * `@deepseek-ai/dsh-tools` 的 `pipeline.js` 里 `const returned = await tool.execute(exec.arguments, exec)`）。
 * 工具 execute 不 resolve，这一轮的下一次模型请求就发不出去；宿主也没有内置的"工具超时兜底"
 * （只有协作式 `exec.signal`）。所以**长耗时工具必须自己立刻返回、把活甩到后台**。
 *
 * 宿主虽然自带 `ctx.jobs`（后台任务 + 完成回注），但那是 producer 侧能力，`preset-aiyayi`
 * 本体并没挂 `tool-jobs`（只挂了 worker），`ctx.jobs` 在本体拿不到。真正可用的轻量路子是
 * **followup 注入**：工具立刻返回 `{status:'started', taskId}`，后台跑完后用
 * `exec.agent.followup(createUserMessage({...}))` 把结果当成一条用户消息追加进会话，
 * 本体下一轮自然看到。
 *
 * 三处先例（本文件是把它们抽成一处，别再各抄一份）：
 *   · lib/feishu.js `deliverToSession()`（坑 #61 裸 Agent / 坑 #65 source 禁 undefined）
 *   · lib/weixin/session.js `deliverToSession()` + `yieldHostPublication()`（坑 #68 重入）
 *
 * 两个关键约束（写死在这里，不给调用方犯错的机会）：
 *   1. **source 里绝不能出现 undefined 字段**。宿主 `Session.append` 用 `snapshotJsonValue`
 *      深拷贝事件数据，遇到 undefined 直接判 `non-JSON-serializable` 抛错（坑 #65）。
 *      本文件统一用 `{ kind: 'user' }`（宿主自建用户消息同款，类型完全合法）。
 *   2. **投递前必须让出宏任务**。宿主可能还处在自己的 publish 宏任务窗口里，同步/重入式
 *      followup 会把 rejection 顺着 effect 回调链抛成宿主 fatal（坑 #68）。`yieldHostPublication()`
 *      做「微任务 + 一个短宏任务」两层让出。
 *
 * 另：投递失败**绝不静默**——记 warn + 在任务记录里留 `delivery` 状态（sent/failed/no-agent），
 * 失败与异常也一律投一条"失败了、原因是什么"，不许吞掉（任务书要求）。
 */

import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
// 1.23.0：B 案 pending 痕迹落盘需要记忆根。home.js 不反向依赖本文件，无环。
import { resolveRoot } from './home.js'

/** taskId 前缀（形如 `tk-1a2b3c4d`）。 */
export const TASK_PREFIX = 'tk-'

/** 进程内 task 表最多保留多少条（只记录，不阻塞；环形丢最旧）。 */
export const TASK_KEEP = 50

/** 进程内 task 表：taskId → 记录。仅供本进程查询（不落盘，重启即空）。 */
const tasks = new Map()

/** 任务记录（字段齐全，方便以后做成统计）。 */
function emptyRecord({ taskId, kind, label, sessionId }) {
  return {
    taskId,
    kind: String(kind ?? 'task'),
    label: String(label ?? ''),
    sessionId: String(sessionId ?? ''),
    status: 'running', // running | success | timeout | error
    delivery: 'pending', // pending | sent | failed | no-agent
    startedAt: Date.now(),
    finishedAt: 0,
    durationMs: 0,
    error: '',
    deliveryError: '',
    summary: '',
    done: null, // 内部用 Promise，绝不进工具输出
  }
}

/** 生成一个当前进程内不重复的 taskId。 */
export function newTaskId() {
  for (let i = 0; i < 32; i += 1) {
    const id = `${TASK_PREFIX}${randomBytes(4).toString('hex')}`
    if (!tasks.has(id)) return id
  }
  // 撞满 32 次的概率可以忽略，兜底也不再抛（宁可 id 长一点）。
  return `${TASK_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 取一条任务记录（没有就 null）。 */
export function getTask(taskId) {
  return tasks.get(String(taskId ?? '')) ?? null
}

/** 列最近的 n 条任务记录（新在前）。 */
export function listTasks(limit = TASK_KEEP) {
  const want = Number.isInteger(limit) && limit > 0 ? limit : TASK_KEEP
  return [...tasks.values()].slice(-want).reverse()
}

/** 环形清理：超过 TASK_KEEP 时丢最旧的（**不丢还 running 的**）。 */
function trimTasks() {
  if (tasks.size <= TASK_KEEP) return
  for (const [id, record] of tasks) {
    if (tasks.size <= TASK_KEEP) break
    if (record.status === 'running') continue
    tasks.delete(id)
  }
}

/** 只给单测的重置口（清空 task 表）。 */
export function clearTasks() {
  tasks.clear()
}

/**
 * 让出宿主当前 publish 窗口（坑 #68 的规避写法，照抄 weixin/session.js）：
 * 微任务 + 一个短宏任务，确保宿主那一轮 publish 宏任务链已经收尾。
 */
export async function yieldHostPublication() {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 1.5.45：异步任务结果的身份标注。宿主 Agent.followup 只收 UserMessage
 * （role 恒为 'user'，asar Agent 接口声明），任务结果又是插件注入的、不是
 * 用户说的——不标注就会"冒充用户发言"（2026-11-13 用户 00:20 实锤的身份
 * 错乱样本之一）。宿主没有系统身份注入 API，只能文本自标注。
 */
export const TASK_RESULT_IDENTITY_TAG = '〔系统提示·非用户发言〕'

/**
 * 1.6.1：投递正文的**自报家门头行**。现状是异步工具（如 watch_read）跑完后把脚本输出
 * 原样投进会话，开头没有任何任务标识，混在对话流里像用户发言（也不像工具结果）。
 * 投递文本统一变成：`〔工具结果〕<kind> · 后台任务 <taskId>` + 空行 + 归一后的输出。
 * kind 即工具名（清单工具的 kind = 条目 name），taskId 能对上 startDetachedTask 返回的句柄。
 */
export function buildTaskResultHeader(kind, taskId) {
  return `〔工具结果〕${String(kind ?? 'task')} · 后台任务 ${String(taskId ?? '')}`
}

/**
 * 造 followup 要用的消息载荷（**source 里只有 kind，无 undefined**，坑 #65）。
 * 抽成纯函数是为了可单测：直接断言这个对象能无损 JSON 往返、且没有 undefined 字段。
 * 1.5.45：text 开头带 TASK_RESULT_IDENTITY_TAG 身份标注。
 */
export function buildTaskMessagePayload(text) {
  return {
    content: [{ type: 'text', text: `${TASK_RESULT_IDENTITY_TAG}${String(text ?? '')}` }],
    source: { kind: 'user' },
  }
}

/**
 * 1.23.0（A 案）：投递目标选择。
 *   · running → steer()：插进 next-step，当前回合的下一个步骤边界就收割（11-26 §四实证：
 *     followup 恒落 next-turn，运行中回合不领，回执会被压到回合结束之后甚至丢失）。
 *   · idle    → followup()：正常唤醒新回合。
 * 老宿主（Agent 没有 steer / status）自动降级回 followup；AIYAYI_ASYNC_DELIVER=followup
 * 一键全局回退旧行为（急停开关，默认 auto）。
 */
function deliverKindOf(agent) {
  const mode = String(process.env.AIYAYI_ASYNC_DELIVER ?? 'auto').trim().toLowerCase()
  if (mode === 'followup') return 'followup' // 急停开关：整体回退旧行为
  if (mode === 'steer') return 'steer' // 反向强制（排查用）
  // auto：有 steer + 有 status 才走忙闲分流，否则降级 followup（老宿主兜底）。
  if (mode === 'auto' && agent && typeof agent.steer === 'function' && typeof agent.status === 'string') {
    return agent.status === 'running' ? 'steer' : 'followup'
  }
  return 'followup'
}

/**
 * 1.23.0（B 案）：投递失败痕迹**持久化到记忆根** `async-pending/`（进程重启也不丢）。
 * 每次失败写 `<时间戳>-<taskId>.json`（**时间在前**：文件名字典序=时间序，"取最旧"与
 * "清最旧"按名排序即按时间排序，不受随机 taskId 前缀干扰）。
 * 上限 100 个文件，超出删最旧；任何 IO 失败只返回 false，绝不影响主流程。
 */
function persistPendingReceipt({ taskId, kind, sessionId, text, error, deliverKind, retryCount }) {
  try {
    const base = String(resolveRoot()?.root ?? '')
    if (!base) return false
    const dir = join(base, 'async-pending')
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* 建不了目录就在下一步 write 时再报 */
    }
    // 时间在前（<stamp>-<taskId>.json），按名排序即按时间排序（取最旧/清最旧都靠它）。
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(dir, `${stamp}-${taskId}.json`)
    writeFileSync(file, JSON.stringify({
      taskId: String(taskId ?? ''),
      kind: String(kind ?? ''),
      sessionId: String(sessionId ?? ''),
      failedAt: new Date().toISOString(),
      deliverKind: String(deliverKind ?? ''),
      error: String(error ?? ''),
      retryCount: Number(retryCount ?? 0),
      text: String(text ?? ''),
    }, null, 2), 'utf8')
    // 环形清理：只看本目录的 .json，超出 100 个删最旧（按文件名排序即按时间排序）。
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
      if (files.length > 100) {
        for (const f of files.slice(0, files.length - 100)) {
          try {
            rmSync(join(dir, f))
          } catch {
            /* 删不掉就留到下一轮 */
          }
        }
      }
    } catch {
      /* 清理失败不影响主流程 */
    }
    return true
  } catch {
    return false
  }
}

/** 读一个 pending 痕迹文件（供 pre-step 重投读取；坏文件/旧格式返回 null）。 */
function readPendingFile(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.taskId !== 'string' || typeof parsed.text !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 1.23.0（B 案）：取盘上最旧的一条 pending 痕迹（给 toolkit.js 的 pre-step 重投钩子用）。
 * `AIYAYI_ASYNC_REDELIVER=0` 急停时恒返回 null（痕迹留盘可见但不自动投）。
 * @returns {{file: string, record: object}|null}
 */
export function takePendingReceipt() {
  if (String(process.env.AIYAYI_ASYNC_REDELIVER ?? '1').trim() === '0') return null
  try {
    const base = String(resolveRoot()?.root ?? '')
    if (!base) return null
    const dir = join(base, 'async-pending')
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    for (const f of files) {
      const file = join(dir, f)
      const record = readPendingFile(file)
      if (record) return { file, record }
    }
    return null
  } catch {
    return null
  }
}

/** 删一条已重投/已上报的 pending 痕迹（防重复；删失败留到下次）。 */
export function discardPendingReceipt(file) {
  try {
    rmSync(file)
    return true
  } catch {
    return false
  }
}

/** 盘上 pending 痕迹的条数（可见性：toolkit_list 输出可带）。 */
export function countPendingReceipts() {
  try {
    const base = String(resolveRoot()?.root ?? '')
    if (!base) return 0
    return readdirSync(join(base, 'async-pending')).filter((f) => f.endsWith('.json')).length
  } catch {
    return 0
  }
}

/** 默认的 createUserMessage 加载器（宿主提供 @deepseek-ai/dsh-llm，失败只影响投递）。 */
let createUserMessageLoader = defaultLoader
let cachedCreateUserMessage = null
let cachedLoaderError = null

async function defaultLoader() {
  const mod = await import('@deepseek-ai/dsh-llm')
  if (typeof mod.createUserMessage !== 'function') {
    throw new Error('@deepseek-ai/dsh-llm 未导出 createUserMessage')
  }
  return mod.createUserMessage
}

/** 拿 createUserMessage（成功缓存；失败也缓存，避免每个任务都重试一遍动态 import）。 */
export async function resolveCreateUserMessage() {
  if (cachedCreateUserMessage) return cachedCreateUserMessage
  if (cachedLoaderError) throw cachedLoaderError
  try {
    const fn = await createUserMessageLoader()
    if (typeof fn !== 'function') throw new Error('createUserMessage 不是函数')
    cachedCreateUserMessage = fn
    return fn
  } catch (error) {
    cachedLoaderError = error
    throw error
  }
}

/** 从 exec 里取能 followup 的裸 Agent（坑 #61：宿主给的就是裸 Agent，不是 { agent }）。 */
export function pickAgent(exec) {
  const agent = exec?.agent ?? null
  if (agent && typeof agent.followup === 'function') return agent
  // 少量宿主版本会把 agent 包一层（历史写法），但不主动猜更多形状。
  const nested = agent?.agent ?? null
  if (nested && typeof nested.followup === 'function') return nested
  return null
}

/** 会话 id（只用于留痕与排查；拿不到就空串，不塞 undefined）。 */
function sessionIdOf(exec) {
  try {
    const id = exec?.agent?.id ?? exec?.sessionId ?? ''
    return typeof id === 'string' ? id : ''
  } catch {
    return ''
  }
}

/**
 * 把一条文本投进会话。返回投递结果，**永远不抛**。
 *
 * 1.23.0（A 案，11-26 §四方案落地）：忙闲分流——agent.status==='running' 走 steer()
 * （next-step，当前回合下一步就看见），idle 走 followup()（next-turn 唤醒新回合）；
 * 老宿主无 steer/status 自动降级 followup；AIYAYI_ASYNC_DELIVER=followup 全局急停回旧行为。
 *
 * 1.23.0（B 案）：任何失败分支（no-agent / 构建消息失败 / 投递抛错）都把完整结果
 * 持久化到 `<记忆根>/async-pending/`（下个 pre-step 自动重投一条或至少可见），
 * **不再只留内存 warn**——14:34 mem_sync 回执丢失实例的整改。
 *
 * @returns {Promise<{ok: boolean, delivery: string, error: string, persisted: boolean}>}
 *   delivery: sent | failed | no-agent（枚举不变，下游兼容）；persisted=true 表示失败痕迹已落盘
 *   `<记忆根>/async-pending/`（下个 pre-step 自动重投一条或至少可见）。
 */
export async function deliverToSession({ exec, text, warn, taskId = '', kind = '' }) {
  const agent = pickAgent(exec)
  if (!agent) {
    const error = 'exec.agent 不可用（拿不到可 followup 的 Agent）'
    const persisted = persistPendingReceipt({
      taskId, kind, sessionId: sessionIdOf(exec), text, error, deliverKind: 'none', retryCount: 0,
    })
    try {
      warn?.(`aiyayi-toolkit: 异步任务投递失败——exec.agent 拿不到可 followup 的 Agent${persisted ? '（已留痕 <记忆根>/async-pending/，待下轮重投）' : '（任务结果只留在 task 表里，且留痕失败）'}`)
    } catch {
      /* logger 缺了就算了 */
    }
    return { ok: false, delivery: 'no-agent', error, persisted }
  }
  const deliverKind = deliverKindOf(agent)
  try {
    const createUserMessage = await resolveCreateUserMessage()
    // 坑 #68：投递前先让出宿主当前的 publish 宏任务窗口。
    await yieldHostPublication()
    const message = createUserMessage(buildTaskMessagePayload(text))
    if (deliverKind === 'steer') agent.steer(message)
    else agent.followup(message)
    return { ok: true, delivery: 'sent', error: '', persisted: false }
  } catch (error) {
    const message = String(error?.message ?? error)
    const persisted = persistPendingReceipt({
      taskId, kind, sessionId: sessionIdOf(exec), text, error: message, deliverKind, retryCount: 0,
    })
    try {
      warn?.(`aiyayi-toolkit: 异步任务投递失败（${deliverKind}）${persisted ? '，已留痕 <记忆根>/async-pending/ 待下轮重投' : '（结果只留在 task 表里，且留痕失败）'}: ${message}`)
    } catch {
      /* 同上 */
    }
    return { ok: false, delivery: 'failed', error: message, persisted }
  }
}

/**
 * 启动一个"后台任务"：**立刻返回句柄，不 await 到任务结束**。
 *
 * 执行顺序：①登记 task 表 → ②`setImmediate` 把 `run()` 甩到下一轮宏任务 → ③run 结束后
 * 按 success/timeout/error 归一 → ④投递一条会话消息（成功/失败都投）→ ⑤回调 onFinish（留痕）。
 *
 * @param {object} options
 * @param {object} options.exec 工具 execute 收到的第二个参数（用它拿 exec.agent）
 * @param {string} options.kind 任务种类（`watch_read` 这类，便于排查）
 * @param {string} [options.label] 人读标签（会进投递文本与留痕）
 * @param {(ctx: {taskId: string, record: object}) => Promise<{status?: string, text: string, error?: string}>} options.run
 *   真正的活。**必须自己兜住所有异常**（抛了也会被这里兜成失败投递，但错误信息以抛出的为准）。
 *   返回 `{status:'success'|'timeout'|'error', text:'投回会话的正文', error?:'给记录用的原因'}`。
 * @param {(msg: string) => void} [options.warn] 告警出口（apply 传 ctx.logger.warn）
 * @param {(info: {record: object}) => void} [options.onFinish] 任务结束回调（写留痕用）
 * @param {string} [options.header] 投递正文的标题前缀，如 `【watch_read 取数结果】`
 * @returns {{status: 'started', taskId: string, kind: string, hint: string}}
 */
export function startDetachedTask(options = {}) {
  const { exec, run, warn } = options
  const kind = String(options.kind ?? 'task')
  const taskId = newTaskId()
  const record = emptyRecord({ taskId, kind, label: options.label, sessionId: sessionIdOf(exec) })
  tasks.set(taskId, record)

  const execute = async () => {
    let outcome
    try {
      const value = await run({ taskId, record })
      outcome = {
        status: normalizeStatus(value?.status),
        text: String(value?.text ?? ''),
        error: String(value?.error ?? ''),
      }
    } catch (error) {
      const message = String(error?.message ?? error)
      outcome = {
        status: 'error',
        // 抛出也必须投一条：不许静默吞掉。
        text: `${options.header ?? `【${kind} 任务失败】`} ${message}`,
        error: message,
      }
    }
    record.status = outcome.status
    record.error = outcome.error
    record.finishedAt = Date.now()
    record.durationMs = record.finishedAt - record.startedAt
    record.summary = outcome.text.slice(0, 500)
    // 1.6.1：投递文本统一加自报家门头行（归一后的输出原样接在空行后，trim/上限逻辑不变——
    // record.summary 仍记 outcome.text 的前 500 字符，头行只加在投递正文上）。
    const deliveredText = `${buildTaskResultHeader(kind, taskId)}\n\n${outcome.text}`
    const delivery = await deliverToSession({ exec, text: deliveredText, warn, taskId, kind })
    record.delivery = delivery.delivery
    record.deliveryError = delivery.error
    record.deliveryPersisted = delivery.persisted === true
    try {
      options.onFinish?.({ record })
    } catch (error) {
      try {
        warn?.(`aiyayi-toolkit: 异步任务收尾回调失败（不影响投递）: ${String(error?.message ?? error)}`)
      } catch {
        /* 兜一层 */
      }
    }
    trimTasks()
    return record
  }

  // 关键：**不让调用方 await 到它**。run() 放到下一轮宏任务（setImmediate）里执行。
  record.done = new Promise((resolve) => {
    setImmediate(() => {
      execute().then(resolve, () => resolve(record))
    })
  })

  return {
    status: 'started',
    taskId,
    kind,
    hint: String(options.hint ?? '已在后台开始，跑完会把结果作为一条消息推回会话'),
  }
}

/** 状态归一：只认 success / timeout / error，其余按 success（调用方忘了给就说是成功，但 text 说了算）。 */
function normalizeStatus(status) {
  const text = String(status ?? '').trim().toLowerCase()
  if (text === 'timeout') return 'timeout'
  if (text === 'error' || text === 'failed' || text === 'denied') return 'error'
  return 'success'
}

/**
 * 等一个后台任务结束（**只给单测 / 排查用**，工具实现里绝不 await 它）。
 * @returns {Promise<object|null>} 任务记录；taskId 不存在返回 null。
 */
export async function waitForTask(taskId) {
  const record = getTask(taskId)
  if (!record) return null
  if (record.done) await record.done
  return record
}

/* 测试出口 */
export const __testing = {
  /** 换掉 createUserMessage 的加载器（单测里 gh_repo 没有 node_modules，必须注入）。 */
  setCreateUserMessageLoader(fn) {
    createUserMessageLoader = fn
    cachedCreateUserMessage = null
    cachedLoaderError = null
  },
  resetCreateUserMessageLoader() {
    createUserMessageLoader = defaultLoader
    cachedCreateUserMessage = null
    cachedLoaderError = null
  },
  clearTasks,
  tasks,
}
