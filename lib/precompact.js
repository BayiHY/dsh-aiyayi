/**
 * aiyayi-precompact — 压缩前沉淀检查层（"先保知识，再清流水"）。
 *
 * 设计目标（见 docs/设计方案-压缩前沉淀机制.md）：
 *   在 dsh-compaction-basic 真正动手压缩**之前**，检查当前会话有没有
 *   "值得沉淀但还没落盘"的内容（任务闭环 / 关键结论 / 可量化数据 / 新经验），
 *   先写成 经验文档（docs/）+ 记忆（memories/ 分类档案）+ 更新索引，
 *   让后面的压缩只负责清理流水。摘要变成"指向落盘位置的索引"，而非裸内容。
 *
 * 本模块**不重写 dsh-compaction-basic**：只补"压缩前"一环，不碰 DSH 压缩器核心。
 * 沉淀失败**绝不阻塞主流程**——与 feishu/weixin"加载失败只禁用不炸"同一思路：
 * 一切动作包 try/catch，出问题只记 warn 并跳过，压缩照常跑。
 *
 * 触发时机：
 *   时机 A（接近阈值）：agent/pre-step 钩子里量一次 token，当上下文估算量到达
 *     `ratio × thresholdTokens`（默认 0.7）时，对当前会话做一次沉淀检查（每会话
 *      一次）。thresholdTokens 复刻 dsh-compaction-basic 的公式：
 *       floor(min(contextWindow×thresholdRatio, (contextWindow−reservedCompletionTokens)−headroomTokens))
 *   时机 B（会话收尾）：显式工具入口 `precompact_run`，收尾流程 / 本体随时可调。
 *
 * 判断"值得沉淀"：落到阿依娅伊已有行为铁律的启发式（任务闭环 / 关键结论 /
 *   可量化数据 / 新经验），可配置 keyword 与开关。
 *
 * 沉淀动作（可注入路径，不硬编码）：
 *   1 写经验文档 → docsDir（默认 = 记忆根下 docs/，可配置）
 *   2 写记忆   → memories/<分类>/…（默认 事情/经验，可配置）
 *   3 更新索引 → 在 memory.md 的 <!-- 索引 --> 段追加一行"分类: 标题 → 文档路径"
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureRootDir, treeDir, coreFile } from './home.js'
import { registerOwnTool } from './own-tools.js'

/** Loader 身份。 */
export const name = 'aiyayi-precompact'

/** 需要的服务：注册工具要 tools；量测/取模型走 ctx.get 防御式拿，不放进 inject（缺了也不炸）。 */
export const inject = ['tools']

/** 记忆索引标记（与 lib/index.js 同口径）。 */
const INDEX_BEGIN = '<!-- 索引 -->'
const INDEX_END = '<!-- /索引 -->'

/** 默认配置。全部可被 cordis.patch.yml 的 config 覆盖。 */
const DEFAULT_CONFIG = {
  // 时机A提前量：上下文估算量 ≥ ratio×thresholdTokens 时触发沉淀检查（设计文档 0.7×阈值）。
  ratio: 0.7,
  // 复刻 preset-aiyayi 里 compaction 的阈值参数（见 cordis.patch.yml L335-356）。
  thresholdRatio: 0.4,
  headroomTokens: 32768,
  // 触发A每会话最多跑一次（防每步都做）。
  maxPerSession: 1,
  // 太小（估算 token 低于这个绝对下限）时直接跳过模型信息解析（省一次网络调用）。
  minTokensBeforeCheck: 20000,
  // 模型 contextWindow 信息的进程内缓存时长（resolveModelInfo 是网络调用，别每步都打）。
  modelInfoTTL: 5 * 60 * 1000,
  // 时机A自动抓取的"最近几条会话消息"作为候选材料。
  scanTailMessages: 12,
  // 沉淀动作路径：docsDir=null → 记忆根/docs（可注入）；memoryPath 默认归档分类。
  docsDir: null,
  memoryPath: '事情/经验',
  rememberKind: '事情',
  updateIndex: true,
  // 判断规则的开关与关键字（行为铁律的启发式落地）。
  rules: {
    minLength: 40,
    taskClosure: ['闭环', '完成', '搞定', '已实现', '达成', '结论', '验收', '解决', '实现了', '完成了', '落地', '收尾'],
    keyConclusion: ['结论', '决定', '判断', '取舍', '关键', '所以', '据此', '原因', '由此'],
    quantifiable: /\d+(\.\d+)?\s*(%|％|GB|MB|KB|TB|token|条|个|项|位|版|v\d+|ms|秒|分钟|小时|天|版本)/i,
    newExperience: ['踩坑', '踩过', '坑', '经验', '教训', '实测', '验证', '新方法', '注意', '记住', '备忘', '值得', '启发'],
  },
}

/**
 * 扁平化消息 content 块为文本（兼容 [{type:'text',text}] 数组）。
 */
function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block?.text === 'string' ? block.text : ''))
      .join('\n')
  }
  return ''
}

/** 时间戳：`YYYY-MM-DD HH:MM`。 */
function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 文件名时间戳：`YYYYMMDD-HHMM`。 */
function stampCompact() {
  return stamp().replace(/[-: ]/g, '').slice(0, 12)
}

/** 从标题/内容里派生一个文件名安全的 slug（保留中文/字母数字，去掉非法字符）。 */
export function slugify(text) {
  const s = String(text ?? '').trim()
  const safe = s
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || 'sediment'
}

/** 取文档标题：显式 title > 内容首行 > 内容前 N 字。 */
export function deriveTitle(content, explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  const text = String(content ?? '').trim()
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? ''
  if (firstLine) return firstLine.slice(0, 40)
  return text.slice(0, 40) || '沉淀记录'
}

/** 分类路径 → 安全文件路径（深度≤3，禁路径穿越，与 lib/index.js 同口径）。 */
function normalizePath(input) {
  const raw = String(input ?? '').trim()
  if (raw.length === 0) throw new Error('记忆分类 path 不能为空')
  const segments = raw.split(/[\\/]+/).filter((segment) => segment.length > 0)
  if (segments.length === 0 || segments.length > 3) {
    throw new Error(`分类深度最多 3 级，收到 "${raw}"`)
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || /[<>:"|?*\x00-\x1f]/.test(segment)) {
      throw new Error(`分类名不合法："${segment}"`)
    }
  }
  return `${segments.join('/')}.md`
}

/* ------------------------------------------------------------------ *
 * 判断"哪些值得沉淀"（行为铁律的启发式，可配置）
 * ------------------------------------------------------------------ */

/**
 * 对一段内容做"是否值得沉淀"的启发式判断。
 * @param {string} content 候选材料
 * @param {object} cfg 合并后的配置
 * @returns {{worth:boolean, score:number, reasons:string[]}}
 */
export function judgeSettle(content, cfg) {
  const rules = cfg?.rules ?? DEFAULT_CONFIG.rules
  const text = String(content ?? '').trim()
  const reasons = []
  let score = 0
  if (text.length >= (rules.minLength ?? 40)) {
    score += 1
    reasons.push('有实质内容')
  }
  const hasAny = (words) => (words ?? []).some((w) => text.includes(w))
  if (hasAny(rules.taskClosure)) {
    score += 1
    reasons.push('像有任务闭环')
  }
  if (hasAny(rules.keyConclusion)) {
    score += 1
    reasons.push('含关键结论/决定')
  }
  if (rules.quantifiable instanceof RegExp && rules.quantifiable.test(text)) {
    score += 1
    reasons.push('含可量化数据')
  }
  if (hasAny(rules.newExperience)) {
    score += 1
    reasons.push('含新经验/踩坑')
  }
  const worth = score >= 2
  return { worth, score, reasons }
}

/* ------------------------------------------------------------------ *
 * 真实对话 vs 系统注入的甄别（1.6.1 批B 修复）
 *
 * 背景（实测确诊的三层 bug 之一）：时机A抓"尾部 12 条 surface 节点"当候选材料，
 * 但系统注入节点（persona/核心记忆/MNEMON/presence 的 [时间]/[重逢]/[闹钟]/[状态]/
 * [记忆]、updates、time-context、skill-catalog…）每步都追加在 surface 尾部——
 * 抓到的永远是注入文本，judgeSettle 误判 worth 后就把系统提示沉淀成"经验文档"
 * （记忆库里 You-are-an-AI-agent-* 假文档的由来）。
 *
 * 两道防线（都过才算真实对话）：
 *   A. 消息元数据（主防线）：只收 assistant 输出与 source.kind==='user' 的直发
 *      用户文本。宿主判据（asar 59643-59645）：user-role 上下文注入的
 *      source.kind 是 'time-context'/'aiyayi-presence'/'compact-checkpoint' 等，
 *      绝不冒充 'user'——"User-role context injections do not establish a
 *      user-created conversation"。
 *   B. 注入特征表（兜底防线，范式参照 lib/feishu-logic.js KNOWN_GUIDE_MARKERS，
 *      专一性优先，宁短勿泛）：拦 A 拦不住的——飞书/微信引导注入走 followup
 *      （source.kind 也是 'user'）、压缩后零宽前缀丢失的引导件、以用户身份
 *      重现的 persona 文本。
 * ------------------------------------------------------------------ */

/** 首行以这些串开头 = 注入节点（presence 快照首行是 [时间]，toolkit/updates 快照同理）。 */
const INJECTED_NODE_LINE_PREFIXES = [
  'You are an AI agent', // persona/系统提示开头（垃圾假"经验文档"的直接元凶）
  '[时间]', // presence 每轮时钟行（快照首行，_sections.join 后居首）
  '[重逢]', // presence 重逢快照
  '[闹钟]', // presence 闹钟巡检
  '[闹钟·异常]', // presence 闹钟异常行（与 [闹钟] 分列，前缀比对不吞中间插字）
  '[状态]', // presence 体检单
  '[记忆]', // presence 记忆位置行
]

/** 正文包含这些串 = 注入节点。MNEMON 是宿主级运行时记忆快照的特征词；身份标签防引导件。 */
const INJECTED_NODE_KEYWORDS = ['MNEMON', '〔系统提示·非用户发言〕']

/** 文本首行（trim 后）。 */
function firstLineOf(text) {
  return String(text ?? '').split(/\r?\n/)[0]?.trim() ?? ''
}

/**
 * 兜底判定：这段文本是（或像）系统注入文本吗？
 * 首行命中特征前缀，或正文包含特征词，都算。空文本不算。
 */
export function isInjectedNodeText(text) {
  const t = String(text ?? '')
  if (!t.trim()) return false
  if (INJECTED_NODE_LINE_PREFIXES.some((prefix) => firstLineOf(t).startsWith(prefix))) return true
  return INJECTED_NODE_KEYWORDS.some((keyword) => t.includes(keyword))
}

/**
 * 判一条派生消息是不是"真实对话"（1.6.1 批B 主防线）：
 *   · role==='assistant'：真实模型输出，全收；
 *   · role==='user' 且 source.kind==='user'：真人/通道转发的直发文本——
 *     再过一遍特征表（引导注入的 source.kind 也是 'user'，靠 B 防线拦）；
 *   · 其余（system/developer/tool 消息、注入快照、压缩检查点）一律不是。
 * 消息缺 source 元数据时按"不是"处理：宁可漏收，不收垃圾。
 */
export function isRealConversationMessage(msg) {
  if (!msg || typeof msg !== 'object') return false
  if (msg.role === 'assistant') return true
  if (msg.role === 'user' && msg.source?.kind === 'user') {
    return !isInjectedNodeText(extractText(msg.content))
  }
  return false
}

/* ------------------------------------------------------------------ *
 * 收集候选材料（时机A：从会话尾部抓最近几条真实对话消息）
 * ------------------------------------------------------------------ */

/**
 * 从 session 对象抓最近 count 条真实对话消息（1.6.1 批B：注入节点一律过滤），
 * 拼成候选材料。过滤后没有候选 → 返回空串（调用方走 skipped 路径，
 * 宁可跳过不沉淀垃圾）。只读、全程兜底（读不了就返回空串），绝不抛。
 */
export function collectRecentContent(session, count) {
  try {
    const nodes = session?.surface?.nodes ?? []
    if (nodes.length === 0) return ''
    const window = nodes.slice(-Math.max(1, count ?? DEFAULT_CONFIG.scanTailMessages))
    const parts = []
    for (const seq of window) {
      try {
        const event = session.eventAt?.(seq)
        const msg = session.deriveEventMessage?.(event)
        if (!isRealConversationMessage(msg)) continue
        const text = extractText(msg?.content)
        if (text && text.trim()) parts.push(text.trim())
      } catch {
        /* 单条读不了跳过 */
      }
    }
    return parts.join('\n').trim()
  } catch {
    return ''
  }
}

/**
 * 会话里是否存在至少一条真实用户消息（1.6.1 批B 时机A前置门）：
 * 全量扫 surface（不只尾部），任何一条真实 user 直发文本即算。
 * 全程兜底：读不了就返回 false——宁可跳过，不做沉淀检查。
 */
export function hasRealUserMessage(session) {
  try {
    const nodes = session?.surface?.nodes ?? []
    for (const seq of nodes) {
      try {
        const event = session.eventAt?.(seq)
        const msg = session.deriveEventMessage?.(event)
        if (msg?.role === 'user' && msg.source?.kind === 'user' && !isInjectedNodeText(extractText(msg.content))) {
          return true
        }
      } catch {
        /* 单条读不了跳过 */
      }
    }
    return false
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 阈值 / 触发A
 * ------------------------------------------------------------------ */

/** 路由目标（provider/model），读 session 请求头；无则返回 null。 */
function routedTarget(session) {
  const config = session?.requestHeader?.()?.config
  if (config && typeof config.provider === 'string' && config.provider.length > 0 &&
      typeof config.model === 'string' && config.model.length > 0) {
    return { provider: config.provider, model: config.model }
  }
  return null
}

/** 进程内 model-info 缓存：provider/model → {info, at}。 */
const modelInfoCache = new Map()

/**
 * 拿模型 contextWindow（带 TTL 缓存，避免每步都打 resolveModelInfo 网络调用）。
 * 失败返回 null（触发A退化为"跳过"，不影响主流程）。
 */
async function getModelInfo(llm, target, cfg) {
  const key = `${target.provider}\u0000${target.model}`
  const hit = modelInfoCache.get(key)
  if (hit && Date.now() - hit.at < (cfg.modelInfoTTL ?? DEFAULT_CONFIG.modelInfoTTL)) return hit.info
  try {
    const info = await llm.resolveModelInfo(target.provider, target.model)
    if (info) modelInfoCache.set(key, { info, at: Date.now() })
    return info ?? null
  } catch {
    return null
  }
}

/**
 * 复刻 dsh-compaction-basic 的阈值公式：
 *   thresholdTokens = floor(min(contextWindow×thresholdRatio,
 *                              (contextWindow−reservedCompletionTokens)−headroomTokens))
 * @returns {number} 阈值 token；算不出时返回 0。
 */
export function computeThresholdTokens(cfg, info, session) {
  const contextWindow = info?.context?.contextWindow
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) return 0
  const thresholdRatio = cfg.thresholdRatio ?? DEFAULT_CONFIG.thresholdRatio
  const headroom = cfg.headroomTokens ?? DEFAULT_CONFIG.headroomTokens
  const reserved = session?.requestHeader?.()?.config?.maxTokens ?? info?.defaultMaxTokens ?? 0
  const messageBudget = contextWindow - reserved
  const pressureBudget = messageBudget - headroom
  if (pressureBudget <= 0) return 0
  return Math.floor(Math.min(contextWindow * thresholdRatio, pressureBudget))
}

/* ------------------------------------------------------------------ *
 * 沉淀动作：写经验文档 + 写记忆 + 更新索引
 * ------------------------------------------------------------------ */

/** 在 memory.md 的索引段追加一行（段不存在则新建段）。幂等。 */
function appendIndexLine(file, line) {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    raw = ''
  }
  const lines = raw.split(/\r?\n/)
  const endIdx = lines.findIndex((l) => l.trim() === INDEX_END)
  if (endIdx !== -1) {
    lines.splice(endIdx, 0, line)
  } else {
    // 索引段不存在：段尾追一个完整块。
    lines.push('', INDEX_BEGIN, line, INDEX_END, '')
  }
  writeFileSync(file, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8')
}

/**
 * 执行沉淀：写 docs 文档 + 记忆条目 + 更新索引。
 * 所有写操作都可能抛（由调用方 runPrecompact 兜住，保证不阻塞主流程）。
 * @returns {{docPath:string, memoryFile:string, memoryLocation:string, indexUpdated:boolean, title:string}}
 */
export function settle(ctx, cfg, payload) {
  const resolved = ensureRootDir()
  const root = resolved.root
  // docs 目录：可配置；默认 = 记忆根/docs。
  const docsDir = cfg.docsDir ? resolve(cfg.docsDir) : join(root, 'docs')
  mkdirSync(docsDir, { recursive: true })

  const content = String(payload.content ?? '').trim()
  if (!content) throw new Error('沉淀内容为空，跳过')
  const title = deriveTitle(content, payload.title)
  const slug = slugify(title)
  const now = stamp()
  const filename = `${stampCompact()}-${slug}.md`
  const docPath = join(docsDir, filename)

  const kind = payload.kind || cfg.rememberKind || '事情'
  const trigger = payload.trigger || 'manual'
  const reason = payload.reason || ''

  // 1) 写经验文档。
  const docBody = [
    `# ${title}`,
    '',
    `- 时间：${now}`,
    `- 触发：${trigger}`,
    `- 类型：${kind}`,
    reason ? `- 原因：${reason}` : '',
    '',
    '---',
    '',
    content,
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
  writeFileSync(docPath, `${docBody}\n`, 'utf8')

  // 2) 写记忆（memories/<分类>/…，一条"结论 + 指向文档"）。
  const memoryPath = payload.memoryPath || cfg.memoryPath || DEFAULT_CONFIG.memoryPath
  const memoryFile = join(treeDir(), normalizePath(memoryPath))
  mkdirSync(dirname(memoryFile), { recursive: true })
  const relDoc = `docs/${filename}`
  appendFileSync(memoryFile, `- [${now}] ${content}（详见 ${relDoc}）\n`, 'utf8')

  // 3) 更新索引（memory.md 的索引段）。
  let indexUpdated = false
  if (cfg.updateIndex !== false) {
    appendIndexLine(coreFile(), `${memoryPath}: ${title} → ${relDoc}`)
    indexUpdated = true
  }

  ctx?.logger?.info?.(`aiyayi-precompact: 已沉淀「${title}」→ ${docPath}；记忆 ${memoryPath}；索引已更新`)
  return { docPath, memoryFile, memoryLocation: memoryPath, indexUpdated, title, filename }
}

/* ------------------------------------------------------------------ *
 * 对外主入口：沉淀检查 + 执行（失败不抛，返回结果对象）
 * ------------------------------------------------------------------ */

/**
 * 压缩前沉淀检查主入口（时机A / 时机B / 显式都走这里）。
 * @param {object} ctx cordis 上下文（可能没有 logger，防御）
 * @param {object} cfg 合并后配置
 * @param {{trigger?:string, reason?:string, content?:string, title?:string, kind?:string,
 *          session?:object, sessionId?:string, force?:boolean, docPath?:string,
 *          memoryPath?:string}} payload
 *   - content 缺失时，若给了 session 就抓尾部消息当候选材料（时机A自动触发用）。
 *   - force=true 跳过启发式判断，直接沉淀（显式调用且本体已确认时）。
 * @returns {object} 永远正常返回：
 *   {settled:true, docPath, memoryLocation, indexUpdated, title, verdict, trigger}
 *   | {settled:false, skipped:true, verdict?, reason?}
 *   | {settled:false, skipped:true, error:string}
 */
export async function runPrecompact(ctx, cfg, payload) {
  const merged = mergeConfig(cfg)
  try {
    let content = String(payload?.content ?? '').trim()
    let session = payload?.session ?? null

    // 内容没给：尝试从会话尾部抓候选材料（时机A）。
    if (!content && session) {
      content = collectRecentContent(session, merged.scanTailMessages)
    }

    const verdict = content
      ? judgeSettle(content, merged)
      : { worth: false, score: 0, reasons: ['无候选材料'] }

    if (payload?.force !== true && !verdict.worth) {
      return { settled: false, skipped: true, verdict, trigger: payload?.trigger || 'manual' }
    }

    const result = settle(ctx, merged, {
      trigger: payload?.trigger || 'manual',
      reason: payload?.reason,
      content,
      title: payload?.title,
      kind: payload?.kind,
      memoryPath: payload?.memoryPath,
    })
    // skipped 在 schema.required 里，成功分支也必须显式给 false（否则宿主报
    // `missing required property "value.skipped"`）。改在这里而不是 settle()，
    // 是为免影响 settle() 的其他调用方。
    return { settled: true, ...result, skipped: false, verdict, trigger: payload?.trigger || 'manual' }
  } catch (error) {
    try {
      ctx?.logger?.warn?.(`aiyayi-precompact: 沉淀失败（已跳过，不影响主流程）: ${String(error?.message ?? error)}`)
    } catch {
      /* logger 都没有就算了 */
    }
    return { settled: false, skipped: true, error: String(error?.message ?? error), trigger: payload?.trigger || 'manual' }
  }
}

/* ------------------------------------------------------------------ *
 * 触发A的 pre-step 处理
 * ------------------------------------------------------------------ */

/** 本会话触发A是否已跑过（每会话最多一次）。 */
const settledThisSession = new WeakSet()

/**
 * pre-step 触发器：量 token，接近阈值（ratio×threshold）时对当前会话做一次沉淀检查。
 * 全程兜底：任何一步失败都只跳过，绝不阻塞或抛到钩子外。
 */
async function maybePrecompactOnStep(ctx, cfg, agent, _signal) {
  if (!agent?.session) return
  if (settledThisSession.has(agent.session)) return
  // 服务缺了（tokenMeter/llm 不可用）就跳过自动触发，工具仍可用。
  const meter = ctx.get?.('tokenMeter')
  const llm = ctx.get?.('llm')
  if (!meter || !llm) return

  // 1.6.1 批B 前置门：会话里还没有任何真实用户消息（surface 过滤后为零）时
  // 不做沉淀检查，直接 return——杜绝"新会话开场即触发"（开场的 surface 尾部
  // 全是注入节点，旧代码抓注入文本当候选材料，误判 worth 就把系统提示沉淀掉）。
  if (!hasRealUserMessage(agent.session)) return

  let measurement
  try {
    measurement = meter.measure(agent.session)
  } catch {
    return
  }
  const total = measurement?.totalTokens ?? 0
  // 低于绝对下限时先不解析模型信息（省网络调用）：这类会话必然远低于 0.7×52K。
  if (total < (cfg.minTokensBeforeCheck ?? DEFAULT_CONFIG.minTokensBeforeCheck)) return

  const target = routedTarget(agent.session)
  if (!target) return
  const info = await getModelInfo(llm, target, cfg)
  if (!info) return
  const threshold = computeThresholdTokens(cfg, info, agent.session)
  if (threshold <= 0) return

  if (total >= cfg.ratio * threshold) {
    // 1.6.1 批B：名额改为 verdict 判定后才占——旧代码先 add 再跑，一次误触发
    // （比如开场抓到注入文本、verdict 不 worth）就永久烧掉该会话的自动沉淀名额。
    // 现在 verdict 不 worth（或检查出错）都不消耗名额，下次接近阈值还有机会。
    let result = null
    try {
      result = await runPrecompact(ctx, cfg, {
        trigger: 'A',
        reason: `上下文已接近压缩阈值（估算 ${total} / 阈值 ${threshold} token，提前量 ${cfg.ratio}），自动沉淀后再压缩`,
        session: agent.session,
      })
    } catch {
      /* runPrecompact 内部已兜，这里再兜一层 */
    }
    if (result?.settled === true || result?.verdict?.worth === true) {
      settledThisSession.add(agent.session)
    }
  }
}

/* ------------------------------------------------------------------ *
 * 配置合并
 * ------------------------------------------------------------------ */

export function mergeConfig(config) {
  return { ...DEFAULT_CONFIG, ...(config ?? {}) }
}

/* ------------------------------------------------------------------ *
 * 工具注册
 * ------------------------------------------------------------------ */

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/**
 * 注册 precompact_run 工具 + 时机A的 pre-step 监听。
 * @param {object} ctx - preset 作用域内的 agent 上下文。
 * @param {object} [config] - cordis.patch.yml 里的 config。
 */
export function apply(ctx, config) {
  const cfg = mergeConfig(config)

  // 自己的工具进白名单（restrict 单一真源）。
  registerOwnTool('precompact_run')

  // 时机B / 显式：本体可随时调用的工具。
  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'precompact_run',
        description:
          '压缩前沉淀检查：把当前值得沉淀但还没落盘的知识（任务闭环 / 关键结论 / 可量化数据 / 新经验）先写成 docs/ 经验文档 + 记忆 + 更新索引，让后续压缩安心清流水。收尾（update_state 前后）、或上下文快到压缩阈值时用它。content 写你要沉淀的那段知识；标题给 title；拿不准该不该沉淀时可不传 content（会自动抓最近对话判断），或先看它返回的 skipped/verdict。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', description: '要沉淀的知识正文（结论/数据/经验）。留空则自动抓最近几条会话消息做判断。' },
            title: { type: 'string', description: '经验文档标题，缺省取 content 首行。' },
            kind: { type: 'string', enum: ['事情', '经验', '结论', '数据', '任务'], description: '沉淀类型，缺省"事情"。' },
            reason: { type: 'string', description: '这次沉淀的原因（可选，写进文档）。' },
            force: { type: 'boolean', description: 'true=跳过"值得沉淀"判断直接落盘（你已确认这段该留时用）。' },
            memoryPath: { type: 'string', description: '记忆归档分类（1~3 级），缺省"事情/经验"。' },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              settled: { type: 'boolean' },
              skipped: { type: 'boolean' },
              docPath: { type: 'string' },
              memoryLocation: { type: 'string' },
              indexUpdated: { type: 'boolean' },
              title: { type: 'string' },
              reason: { type: 'string' },
              error: { type: 'string' },
              // 下面四个是实际返回值里带、但旧 schema 漏声明的字段：
              // 宿主对 output 做 JSON Schema 校验（additionalProperties: false），
              // 漏声明 → 报 `"value.xxx" is not a declared property`（坑 #82）。
              trigger: { type: 'string' },
              memoryFile: { type: 'string' },
              filename: { type: 'string' },
              verdict: {
                type: 'object',
                properties: {
                  worth: { type: 'boolean' },
                  score: { type: 'number' },
                  reasons: { type: 'array', items: { type: 'string' } },
                },
                required: ['worth', 'score', 'reasons'],
                additionalProperties: false,
              },
            },
            required: ['settled', 'skipped'],
          },
          render: (_args, value) => {
            if (value.settled) {
              return TEXT_BLOCK(
                `已沉淀「${value.title ?? ''}」→ ${value.docPath ?? ''}；记忆 ${value.memoryLocation ?? ''}${value.indexUpdated ? '；索引已更新' : ''}`,
              )
            }
            if (value.error) return TEXT_BLOCK(`沉淀跳过（出错，不影响主流程）：${value.error}`)
            return TEXT_BLOCK('本次没有值得沉淀的内容，跳过（留给压缩清理流水）。')
          },
        },
        async execute(args) {
          return runPrecompact(ctx, cfg, {
            trigger: args?.reason ? 'B' : 'manual',
            content: args?.content,
            title: args?.title,
            kind: args?.kind,
            reason: args?.reason,
            force: args?.force === true,
            memoryPath: args?.memoryPath,
          })
        },
      }),
    'aiyayi-precompact.precompact_run()',
  )

  // 时机A：接近阈值时自动触发一次。
  ctx.effect(
    () =>
      ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        try {
          await maybePrecompactOnStep(ctx, cfg, agent, signal)
        } catch (error) {
          ctx.logger?.warn?.(`aiyayi-precompact: 时机A检查失败（已跳过）: ${String(error?.message ?? error)}`)
        }
        return next()
      }),
    'aiyayi-precompact.pre-step()',
  )
}

/* 测试出口：只给单测用。 */
export const __testing = {
  normalizePath,
  appendIndexLine,
  computeThresholdTokens,
  resetTriggerA() {
    // WeakSet 无法清空，测试直接新建模块实例即可。
  },
}
