/**
 * aiyayi-feishu 的纯逻辑层（无外部依赖，测试友好）。
 *
 * 与 dsh-aiyayi 其它 lib 文件约定一致：这里只用 node 内建模块，不 import
 * 任何 @deepseek-ai 或 @larksuiteoapi 包。飞书 SDK / dsh-llm 的连接与建会话
 * 都在 feishu.js（宿主插件壳）里做，这里只放可单测的纯函数。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, join } from 'node:path'

/** 配置文件名（含 appId/appSecret，不入 git）。 */
const CONFIG_FILE = 'config.json'
/** 会话映射文件名（chat_id → sessionId，JSON）。 */
const MAPPING_FILE = 'mappings.json'

/** 记忆根下 feishu 子目录（配置+映射都放这里）。 */
export function feishuDir(root) {
  return join(root, 'feishu')
}

/** 确保 feishu 目录存在。 */
export function ensureFeishuDir(root) {
  const dir = feishuDir(root)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 读配置文件；不存在返回 null。容忍 UTF-8 BOM。 */
export function readConfigFile(root) {
  const file = join(feishuDir(root), CONFIG_FILE)
  if (!existsSync(file)) return null
  return JSON.parse(stripBom(readFileSync(file, 'utf8')))
}

/** 写配置文件。 */
export function writeConfigFile(root, config) {
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2), 'utf8')
}

/** 读会话映射表 { chat_id → sessionId }；不存在返回空对象。 */
export function readMappings(root) {
  const file = join(feishuDir(root), MAPPING_FILE)
  if (!existsSync(file)) return {}
  return JSON.parse(stripBom(readFileSync(file, 'utf8')))
}

/** 写会话映射表。 */
export function writeMappings(root, mappings) {
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, MAPPING_FILE), JSON.stringify(mappings, null, 2), 'utf8')
}

/**
 * 合并配置：patch config > 配置文件中同名键 > 缺省。
 * @param {object} patchConfig - apply(ctx, config) 传进来的 config。
 * @param {object} fileConfig - 从配置文件读出的配置。
 * @returns {object} 合并后的配置 {appId,appSecret,domain?,defaultPermissionPreset?}
 */
export function mergeConfig(patchConfig = {}, fileConfig = null) {
  const merged = { ...(fileConfig || {}), ...patchConfig }
  if (!merged.domain) merged.domain = 'https://open.feishu.cn'
  if (!merged.defaultPermissionPreset) merged.defaultPermissionPreset = 'workspace-write'
  return merged
}

// ─── 1.5.22 多应用（multi-app）配置与 chat→app 归属 ─────────────────────────
// 背景：一台 DSH 可能同时接多个飞书自建应用（每个应用一条独立长连接）。
// 飞书 p2p chat 的成员归属是「应用」维度的：非成员应用对该 chat 的一切收发
// 都报 230002「Bot/User can NOT be out of the chat」。所以 config 支持多应用，
// 且发消息前必须确定目标 chat 属于哪个应用（chat-owners.json）。

/** chat → 应用归属表文件名（该 chat 的事件从哪条长连接来/用哪套凭证发）。 */
const CHAT_OWNERS_FILE = 'chat-owners.json'

/** 读 chat → appId 归属表；不存在或损坏返回空对象（归属只是加速缓存，可重建）。 */
export function readChatOwners(root) {
  const file = join(feishuDir(root), CHAT_OWNERS_FILE)
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(stripBom(readFileSync(file, 'utf8')))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** 写 chat → appId 归属表。 */
export function writeChatOwners(root, owners) {
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, CHAT_OWNERS_FILE), JSON.stringify(owners, null, 2), 'utf8')
}

// ─── 1.5.35 最近入站路由回看 ──────────────────────────────────────────────
// feishu_status 的「最近入站路由」：记录最近 N 条来自飞书的消息各自路由进了
// 哪个 aiyayi 会话/工作区（或走了绑定/复用/新建/待选），持久化到 feishu 子目录
// （inbound-routing.json），重启不丢。供本体排障「我在飞书发了消息但没接到
// 当前会话」时直接对上号：chatId → sessionId（或新建/待选动作）。

/** 最近入站路由记录文件名（数组，新→旧）。 */
const INBOUND_ROUTING_FILE = 'inbound-routing.json'
/** 环形缓冲上限：只保留最近 N 条路由记录。 */
export const INBOUND_ROUTING_LIMIT = 20

/** 读最近入站路由记录（新→旧）；不存在/损坏返回 []。 */
export function readInboundRouting(root) {
  const file = join(feishuDir(root), INBOUND_ROUTING_FILE)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(stripBom(readFileSync(file, 'utf8')))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 追加一条入站路由记录（新→旧，超上限丢最旧）。
 * @param {string} root 记忆根
 * @param {object} record { at:number, chatId:string, appId:string|null,
 *   action:string, sessionId:string|null }
 *   action ∈ route|bind|new|auto-new|reuse|select|choose|new-fallback。
 *   空 chatId 忽略（防脏数据）。
 */
export function appendInboundRouting(root, record) {
  if (!record || !record.chatId) return
  const list = readInboundRouting(root)
  list.unshift({ at: record.at ?? Date.now(), ...record })
  const trimmed = list.slice(0, INBOUND_ROUTING_LIMIT)
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, INBOUND_ROUTING_FILE), JSON.stringify(trimmed, null, 2), 'utf8')
}

/**
 * 归一化多应用配置。接受两种形态：
 *   新（1.5.22+）：{ apps: [{ appId, appSecret, domain? }, ...] }
 *   旧（≤1.5.21）：{ appId, appSecret, ... }（单应用，自动包一层）
 * 规则：apps 数组优先于旧顶层字段；appId/appSecret 必须都非空才算有效应用；
 * appId 去重（首个赢，重复项丢弃）；per-app domain 缺省回落 null（调用方补全局域）。
 * @returns {Array<{appId:string, appSecret:string, domain:(string|null)}>}
 */
export function normalizeApps(config) {
  const rawList = Array.isArray(config?.apps)
    ? config.apps
    : config?.appId && config?.appSecret
      ? [{ appId: config.appId, appSecret: config.appSecret, domain: config.domain }]
      : []
  const seen = new Set()
  const apps = []
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const appId = typeof item.appId === 'string' ? item.appId.trim() : ''
    const appSecret = typeof item.appSecret === 'string' ? item.appSecret.trim() : ''
    if (!appId || !appSecret || seen.has(appId)) continue
    seen.add(appId)
    apps.push({
      appId,
      appSecret,
      domain: typeof item.domain === 'string' && item.domain ? item.domain : null,
    })
  }
  return apps
}

/** 配置是否还是旧的单 app 顶层格式（appId/appSecret 在顶层且无 apps 数组）。 */
export function isLegacySingleAppConfig(config) {
  return Boolean(
    config &&
      typeof config === 'object' &&
      !Array.isArray(config.apps) &&
      typeof config.appId === 'string' &&
      typeof config.appSecret === 'string',
  )
}

function configBackupStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/**
 * 把旧单 app 配置文件原地迁移为 apps 数组格式（1.5.22 起在 apply() 自动调用）。
 * 迁移前先备份 config.json → config.json.bak-<yyyymmdd-HHmmss>；
 * appId/appSecret 移入 apps[0]，其余顶层键原样保留，顶层不再留凭证副本。
 * 已是新格式 / 文件不存在 / 解析失败时不动文件，返回 { migrated: false }。
 */
export function migrateConfigFile(root) {
  const file = join(feishuDir(root), CONFIG_FILE)
  if (!existsSync(file)) return { migrated: false, reason: 'missing' }
  let config
  try {
    config = JSON.parse(stripBom(readFileSync(file, 'utf8')))
  } catch (error) {
    return { migrated: false, reason: `parse: ${errorMessage(error)}` }
  }
  if (!isLegacySingleAppConfig(config)) return { migrated: false, reason: 'already-multi' }
  const { appId, appSecret, ...rest } = config
  const stamp = configBackupStamp()
  const backup = `${file}.bak-${stamp}`
  copyFileSync(file, backup)
  writeFileSync(file, JSON.stringify({ ...rest, apps: [{ appId, appSecret }] }, null, 2), 'utf8')
  return { migrated: true, backup, appId }
}

/**
 * 成员探测（发送前确定 chat 归属用）：对单个 app 调
 * GET /open-apis/im/v1/messages?container_id_type=chat&container_id=…&page_size=1。
 * 判据（2026-11-11 双 app 实锤）：code=0 → 该 app 是 chat 成员（能收能发）；
 * code=230002 → 非成员（发了必 400）；其余 code / 网络错 → 抛出（归属未知）。
 * 注意 GET /im/v1/chats/{chat_id} 两类 app 都返回 code=0，不能当判据。
 */
export async function probeChatMembership({ domain, appId, appSecret, chatId }) {
  const getTenantAccessToken = createTokenManager({ domain, appId, appSecret })
  const token = await getTenantAccessToken()
  const url =
    `${domain}/open-apis/im/v1/messages?container_id_type=chat` +
    `&container_id=${encodeURIComponent(chatId)}&page_size=1`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  const code = data?.code
  if (code === 0) return { member: true, code: 0 }
  if (code === 230002) return { member: false, code: 230002 }
  const error = new Error(
    `成员探测失败: HTTP ${res.status} code=${code} msg=${data?.msg || ''} appId=${appId}`,
  )
  error.feishuCode = code
  error.httpStatus = res.status
  throw error
}

/** 从 SDK 抛出的错误里挖出飞书错误码（LarkChannelError 带 code + cause 链）。 */
export function extractFeishuErrorCode(error) {
  const candidates = [
    // probeChatMembership 抛的错把码放顶层 feishuCode（1.5.25：候选链补上它——
    // 1.5.24 装版断言实测发现漏挖，230001 判定失效走回 probe-error）。
    typeof error?.feishuCode === 'number' ? error.feishuCode : undefined,
    error?.cause?.response?.data?.code,
    error?.cause?.data?.code,
    typeof error?.cause?.code === 'number' ? error.cause.code : undefined,
    error?.data?.code,
    typeof error?.code === 'number' ? error.code : undefined,
  ]
  for (const code of candidates) {
    if (typeof code === 'number') return code
  }
  return null
}

/** 是否「非 chat 成员」错误（230002）——发送侧归属失效的自愈信号。 */
export function isOutOfChatError(error) {
  return extractFeishuErrorCode(error) === 230002
}

/** 把一条消息的文本内容抽出来（content 是 {type:'text',text} 数组）。 */
export function extractText(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

/**
 * 自然语言路由：决定一条消息是绑定已有会话、新建会话、还是投给已绑定会话。
 * 约定（大小写不敏感、容忍空格）：
 *   `绑定会话 <sessionId>` / `接入会话 <sessionId>` / `切换到会话 <sessionId>`
 *      → { action: 'bind', sessionId }
 *   `新建会话 <名称>` / `创建会话 <名称>` / `新开会话 <名称>`
 *      → { action: 'new', name }
 *   其余（聊天正文）：
 *      chat 已有映射 → { action: 'route' }
 *      chat 无映射   → { action: 'new', name: null }
 *        （1.5.33 起**不再无条件新建**：调用方拿到 action:'new' 且 name 为 null 时，
 *          先走 decideUnboundChatRouting() 三档复用；只有 0 个可复用会话才真新建。
 *          用户明确说「新建会话 X」时 name 非空，调用方直接新建、跳过复用。）
 * @param {string} text - 用户消息纯文本。
 * @param {object} mappings - 会话映射表。
 * @param {string} chatId - 当前 chat。
 * @returns {object} 路由决策。
 */
export function routeMessage(text, mappings, chatId) {
  const trimmed = (text || '').trim()
  // 已绑定：直接投递（即便带命令关键词也当正文，避免误重绑）。
  if (mappings[chatId]) return { action: 'route', sessionId: mappings[chatId] }

  const bind = trimmed.match(
    /^(?:绑定会话|绑定|接入会话|接入|切换到会话|切换)\s+(.+)$/i,
  )
  if (bind) {
    const sessionId = bind[1].trim()
    if (sessionId) return { action: 'bind', sessionId }
  }

  const fresh = trimmed.match(/^(?:新建会话|创建会话|新开会话|新建)\s+(.+)$/i)
  if (fresh) {
    const name = fresh[1].trim()
    return { action: 'new', name: name || null }
  }

  return { action: 'new', name: null }
}

/** chat_id → sessionId 反向查（进程内映射表）。 */
export function reverseLookup(mappings, sessionId) {
  for (const [chatId, sid] of Object.entries(mappings)) {
    if (sid === sessionId) return chatId
  }
  return null
}

/** 待接入目标会话文件名（等待 bot_p2p_chat_entered_v1 自动绑定）。 */
const PENDING_BIND_FILE = 'pending-bind.json'
/** 已引导过接入的新会话文件名（防重复提示）。 */
const GUIDED_FILE = 'guided.json'

/** 读待接入目标 {sessionId, createdAt}；不存在或为 null 返回 null。 */
export function readPendingBind(root) {
  const file = join(feishuDir(root), PENDING_BIND_FILE)
  if (!existsSync(file)) return null
  const parsed = JSON.parse(stripBom(readFileSync(file, 'utf8')))
  return parsed && typeof parsed === 'object' ? parsed : null
}

/** 写待接入目标。 */
export function writePendingBind(root, pending) {
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, PENDING_BIND_FILE), JSON.stringify(pending, null, 2), 'utf8')
}

/** 清除待接入目标（写入 null）。 */
export function clearPendingBind(root) {
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, PENDING_BIND_FILE), JSON.stringify(null, null, 2), 'utf8')
}

/** 读已引导过接入的新会话 id 数组（防重复提示）；不存在返回 []。 */
export function readGuided(root) {
  const file = join(feishuDir(root), GUIDED_FILE)
  if (!existsSync(file)) return []
  const parsed = JSON.parse(stripBom(readFileSync(file, 'utf8')))
  return Array.isArray(parsed) ? parsed : []
}

/** 标记某会话已引导过接入（幂等）。 */
export function markGuided(root, sessionId) {
  const guided = readGuided(root)
  if (guided.includes(sessionId)) return
  guided.push(sessionId)
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, GUIDED_FILE), JSON.stringify(guided, null, 2), 'utf8')
}

/**
 * 接入意图的两道共享闸门（飞书 / 微信各一套正则，闸门同一份）。
 * @returns {boolean} true=像一个「要求接入」的短祈使句。
 */
function passesOnboardGate(t) {
  // 闸 1：接入请求是短的祈使句；长文本 / 多行是任务简报、聊天记录、文档粘贴。
  // 实测 2026-11-11：子智能体收到的任务简报里含「注入飞书接入引导」字样 → 被当成
  // 用户想接入 → 写下 pending-bind 指向一个 aiyayi-worker 子会话（伪意图）。
  if (!t || t.length > 30 || t.includes('\n')) return false
  // 闸 2：出现讨论性词汇的句子是在聊这件事，不是在要求接入。
  // 实测 2026-11-11：旧版对「飞书接入改造得怎样了」返回 true（判为接入请求）。
  // 1.5.32：微信同样适用——「微信怎么接」含「怎么」→ 判讨论性提问、不触发引导，
  // 由模型照 persona 口头答（用户明确说「接入微信」才走引导）。
  if (/(?:改造|逻辑|怎样|怎么|如何|在哪|哪里|代码|插件|实现|设计|盘点|检查|修复|进度|问题|bug)/i.test(t)) {
    return false
  }
  return true
}

/**
 * 检测「要接入飞书」类意图（GUI 会话内用户主动表达）。
 * 匹配：接入飞书 / 飞书接入 / 绑定飞书 / 飞书绑定 / 接飞书 / 连飞书 / 接上飞书 /
 * 开通飞书 / 加飞书 / 接入机器人 等（大小写不敏感）。不带「飞书」二字的
 * 「接入」不匹配，避免命中注入引导文本里的普通措辞。
 *
 * 1.5.32：微信意图由 matchWeixinIntent() 单独判定、在调用侧优先检查（微信请求
 * 不该写飞书的 pending-bind、也不该收到飞书扫码步骤）；这里**不**并入微信词，
 * 免得「接入微信机器人」同时命中两条。`接入机器人|绑定机器人` 保留——历史语义
 * 就是飞书（当年只有飞书一条通道），且「接入微信机器人」中间夹了「微信」，
 * 不会命中「接入机器人」四个连续字。
 */
export function matchOnboardIntent(text) {
  const t = String(text || '').trim()
  if (!passesOnboardGate(t)) return false
  return /(?:接入飞书|飞书接入|绑定飞书|飞书绑定|接飞书|连飞书|接上飞书|开通飞书|加飞书|添加飞书|接入机器人|绑定机器人)/i.test(
    t,
  )
}

/**
 * 检测「要接入微信 ClawBot 机器人」类意图（1.5.32 新增）。
 * 匹配：接入微信 / 微信接入 / 绑定微信 / 微信绑定 / 接微信 / 连微信 / 接上微信 /
 * 开通微信 / 加微信 / 添加微信，以及「接入微信机器人」这类夹字说法。
 * 同一套闸门（短祈使句、非讨论性提问）——「微信怎么接」不触发，让模型口头答。
 */
export function matchWeixinIntent(text) {
  const t = String(text || '').trim()
  if (!passesOnboardGate(t)) return false
  return /(?:接入微信|微信接入|绑定微信|微信绑定|接微信|连微信|接上微信|开通微信|加微信|添加微信)/i.test(t)
}

/** 微信通道能力那一句（首次接入引导里追加，1.5.32）。 */
export const WEIXIN_CAPABILITY_NOTE =
  '另外我还能接微信 ClawBot 机器人（腾讯官方 iLink 协议），这条默认没开启；需要的话跟我说，我带你一步步接。'

/** 首次接入引导正文（不含零宽 GUIDE_PREFIX；147→含微信一句，上限 220 字）。 */
export function buildNewSessionGuideText() {
  return (
    '（提示）本会话还没接入飞书聊天机器人。建议接入，这样在手机上也能随时找我：先在手机安装飞书 app（各大应用商店可下载），然后在 open.feishu.cn 扫码找到机器人，或直接在飞书里搜索机器人名称发起单聊——进入与机器人的单聊即自动接入本会话。' +
    WEIXIN_CAPABILITY_NOTE +
    '如果不需要，回复「不用」即可跳过，我不会再提示。'
  )
}

/** 用户说「接入微信」时的注入正文（模型照它指导用户，别现编）。 */
export function buildWeixinOnboardText() {
  return (
    '（提示）用户要接微信 ClawBot 机器人（iLink 协议，默认未开启）。接入顺序：先给 aiyayi-weixin 打开 config.enabled: true 并配 weixin.accounts（改 profile 的 cordis.patch.yml，要派人去改），再用 weixin_login 出二维码、手机微信扫（二维码只有 121 秒寿命），凭证落盘后长轮询才会起。请按这个指导他，别现编步骤；没有 weixin-setup 技能。'
  )
}

/**
 * 首次接入引导的注入判定（纯函数，便于单测）。
 * @param {{sessionId?: string, isSubagent?: boolean, alreadyGuided?: boolean, chatId?: string|null}} input
 * @returns {{guide: boolean, reason: string}}
 */
export function decideNewSessionGuide(input = {}) {
  const sessionId = String(input.sessionId || '')
  // 1.5.18-fix：子智能体不引导接入（guided.json 14 条里 12 条是 subagent）。
  if (input.isSubagent) return { guide: false, reason: 'subagent' }
  // 1.5.28-fix：微信通道会话已自带手机可达性，不再注入「接入飞书」。
  if (/^weixin-/.test(sessionId)) return { guide: false, reason: 'weixin-channel' }
  if (input.alreadyGuided) return { guide: false, reason: 'already-guided' }
  if (input.chatId) return { guide: false, reason: 'bound' }
  return { guide: true, reason: 'unbound' }
}

/** 检测「不用/跳过」类意图（放弃接入）。 */
export function matchSkipIntent(text) {
  return /^(?:不用|不需要|不接|算了|跳过|暂时不用|先不用)/i.test((text || '').trim())
}

// ═══════════════════════════════════════════════════════════════════
// 1.5.33「对接默认落到当前会话」——未绑定 chat 的三档复用决策
//
// 背景：1.5.32 及以前，未绑定 chat 发一条普通消息 → routeMessage 返回
// action:'new' → 无条件新建会话。用户明确要求改成「默认复用，别新建」：
//   恰好 1 个活跃真人会话 → 直接绑过去（不新建）
//   多个活跃 → 不绑不建，回编号列表让用户选（**不猜"最近那个"**：
//              会话之间带上下文，投错比多问一句糟糕得多）
//   0 个 → 才新建（唯一可行兜底），并明说"给你新建了"
// 已绑定 chat 的路径完全不经过这里——那条是 route 分支，不受任何影响。
// 开关 feishu.reuseActiveSession 默认 true；设 false 回退 1.5.32 旧行为。
// ═══════════════════════════════════════════════════════════════════

/** 会话名缺失时的占位文案。 */
export const UNNAMED_SESSION_LABEL = '未命名会话'

/** 列表里最多展示多少个候选会话（再多就翻不动手机屏幕了）。 */
export const MAX_SESSION_CANDIDATES = 8

/** 会话 ID 短形态（前 8 位），用于列表里辨认同名会话。 */
export function shortSessionId(sessionId) {
  const id = String(sessionId || '')
  return id.length > 8 ? id.slice(0, 8) : id
}

/**
 * 归一化「活跃真人会话」候选列表——把宿主侧的原始数据压成纯数据结构，
 * 让决策函数可单测（不依赖 ctx / agents / workspaceRegistry）。
 *
 * 排除规则（每一条都有血债，别随手放宽）：
 *   - 子智能体（header.origin==='subagent' 或带 header.parentSession）：不是对话对象；
 *   - 微信通道会话（`weixin-` 前缀）：它已自带手机可达性，再绑飞书 chat 是串味；
 *   - 飞书自己建的会话（`feishu-` 前缀）：那是给别的 chat 用的，拿来复用＝两个 chat
 *     抢同一个会话，消息互相串；
 *   - 已经绑到**别的** chat 的会话：同上；
 *   - 空白/未命名且没有活动痕迹的：无从判断，不猜（由调用方决定是否纳入，默认纳入，
 *     因为"未命名会话"也可能是刚开就说话的那个）。
 *
 * @param {object} input
 * @param {Array<{sessionId: string, title?: string|null, cwd?: string|null,
 *                workspaceTitle?: string|null, origin?: string|null,
 *                parentSession?: string|null, isSubagent?: boolean}>} input.sessions
 * @param {Record<string,string>} [input.mappings] chat_id → sessionId（已绑定表）
 * @param {string} [input.chatId] 当前 chat（自己的绑定不算"被别人占"）
 * @returns {Array<{sessionId: string, title: string, workspace: string|null, cwd: string|null,
 *                  label: string}>}
 */
export function normalizeSessionCandidates(input = {}) {
  const sessions = Array.isArray(input.sessions) ? input.sessions : []
  const mappings = input.mappings && typeof input.mappings === 'object' ? input.mappings : {}
  const selfChatId = String(input.chatId || '')
  // 被别人占住的会话 id 集合（排除当前 chat 自己的绑定）。
  const takenByOthers = new Set()
  for (const [chatId, sid] of Object.entries(mappings)) {
    if (chatId === selfChatId) continue
    if (typeof sid === 'string' && sid) takenByOthers.add(sid)
  }
  const out = []
  const seen = new Set()
  for (const item of sessions) {
    const sessionId = String(item?.sessionId || item?.id || '')
    if (!sessionId || seen.has(sessionId)) continue
    if (item?.isSubagent) continue
    const origin = item?.origin ?? null
    const parentSession = item?.parentSession ?? null
    if (origin === 'subagent' || typeof parentSession === 'string') continue
    if (/^weixin-/.test(sessionId)) continue
    if (/^feishu-/.test(sessionId)) continue
    if (takenByOthers.has(sessionId)) continue
    seen.add(sessionId)
    const rawTitle = typeof item?.title === 'string' ? item.title.trim() : ''
    // 会话名缺失/为空 → 占位 + ID 前 8 位（别在列表里留空，用户没法选）。
    const title = rawTitle || `${UNNAMED_SESSION_LABEL}（${shortSessionId(sessionId)}）`
    const workspace =
      (typeof item?.workspaceTitle === 'string' && item.workspaceTitle.trim()) ||
      (typeof item?.cwd === 'string' && item.cwd.trim()) ||
      null
    out.push({
      sessionId,
      title,
      workspace,
      cwd: typeof item?.cwd === 'string' ? item.cwd : null,
      // 列表行：`1. 会话名（工作区：xxx）` 的正文部分（不含序号）。
      label: workspace ? `${title}（工作区：${workspace}）` : title,
    })
  }
  return out
}

/**
 * 三档决策（纯函数）：一个未绑定 chat 的普通消息该投到哪。
 *
 * @param {object} input
 * @param {boolean} [input.reuseActiveSession] 开关（feishu.reuseActiveSession，缺省 true）。
 * @param {Array} [input.candidates] normalizeSessionCandidates() 的输出。
 * @returns {{action: 'reuse'|'choose'|'new', sessionId?: string, candidates?: Array,
 *            reason: string}}
 *   reuse  — 恰好 1 个候选：直接绑过去（sessionId 就是它）；
 *   choose — 多个候选：不绑不建，回编号列表让用户选；
 *   new    — 0 个候选（或开关关闭）：才新建会话。
 */
export function decideUnboundChatRouting(input = {}) {
  // 开关：只有显式 false 才回退旧行为（字符串 "false"/0 都当 true——防误配把
  // 默认规则悄悄关掉；要关就写 YAML 布尔 false）。
  const reuse = input.reuseActiveSession !== false
  const candidates = Array.isArray(input.candidates) ? input.candidates : []
  if (!reuse) return { action: 'new', reason: 'reuse-disabled' }
  if (candidates.length === 0) return { action: 'new', reason: 'no-active-session' }
  if (candidates.length === 1) {
    return { action: 'reuse', sessionId: candidates[0].sessionId, candidates, reason: 'single-active-session' }
  }
  // 多个：截断展示，但候选全集保证至少列出 MAX 个 + 一句"还有 N 个"。
  const shown = candidates.slice(0, MAX_SESSION_CANDIDATES)
  return { action: 'choose', candidates: shown, total: candidates.length, reason: 'multiple-active-sessions' }
}

/** 渲染编号列表正文（`1. 会话名（工作区：xxx）`，一行一个）。 */
export function renderSessionCandidateList(candidates, total = null) {
  const list = Array.isArray(candidates) ? candidates : []
  const lines = list.map((item, index) => `${index + 1}. ${item.label ?? item.title ?? item.sessionId}`)
  const count = typeof total === 'number' ? total : list.length
  if (count > list.length) {
    lines.push(`……另有 ${count - list.length} 个未列出。`)
  }
  return lines.join('\n')
}

/** 「已接到当前会话」告知文案。 */
export function buildReusedSessionNotice(candidate) {
  const name = candidate?.label || candidate?.title || candidate?.sessionId || ''
  return `已接到你当前的会话：${name}。之后这个飞书对话的消息都会投到这里。`
}

/** 「多个活跃会话，请选一个」文案（引导用户用已有的 `绑定会话 <id>` 指令）。 */
export function buildChooseSessionPrompt(candidates, total = null) {
  const count = typeof total === 'number' ? total : (Array.isArray(candidates) ? candidates.length : 0)
  const head = `现在有 ${count} 个活跃会话，我不替你猜该投哪个。回一句「绑定会话 <编号>」我就接过去（也可以说「新建会话 <名字>」另开一个）：`
  return `${head}\n${renderSessionCandidateList(candidates, count)}`
}

/** 「给你新建了会话」告知文案（兜底路径必须照实说，别谎称接在原会话上）。 */
export function buildNewSessionNotice(sessionId, title = null) {
  const name = title ? `${title}（${sessionId}）` : sessionId
  return `没有可复用的活跃会话，已给你新建并接入 ${name}。`
}

// ─── 多活跃时「等用户选一个」的待选状态 ────────────────────────────────────
// 多个候选时不能替用户猜，于是把候选列表落盘，等他回「绑定会话 2」或直接回「2」。
// 有时效（跟 pending-bind 同量级），过期就不再消费——否则一周后一句「2」
// 会被当成选会话，把闲聊投到不相干的会话里。
//
// **按 chatId 分键**（不是全局单条）：宿主可能同时挂着多个飞书 chat，
// 若只存"最新一份"，chat B 的「2」会把 chat A 的候选消费掉、把 B 接到 A 选的会话上。

/** 待选目标文件名。 */
const PENDING_CHOICE_FILE = 'pending-choice.json'
/** 待选有效期：10 分钟（够他看完列表回一句，又不至于久到误伤后面的数字消息）。 */
export const PENDING_CHOICE_TTL_MS = 10 * 60 * 1000

/** 读整张表 { chatId: { candidates, createdAt } }；不存在或损坏返回 {}。 */
function readPendingChoiceTable(root) {
  const file = join(feishuDir(root), PENDING_CHOICE_FILE)
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(stripBom(readFileSync(file, 'utf8')))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 读某个 chat 的待选目标；没有返回 null。
 * @param {string} root 记忆根
 * @param {string} chatId 飞书 chat_id（必须匹配，否则视为无待选）
 */
export function readPendingChoice(root, chatId) {
  if (!chatId) return null
  const entry = readPendingChoiceTable(root)[String(chatId)]
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.candidates)) return null
  return entry
}

/** 写某个 chat 的待选目标（保留其它 chat 的待选）。 */
export function writePendingChoice(root, chatId, pending) {
  const id = String(chatId || '')
  if (!id) throw new Error('writePendingChoice: chatId 必填')
  const table = readPendingChoiceTable(root)
  table[id] = { ...pending, chatId: id }
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, PENDING_CHOICE_FILE), JSON.stringify(table, null, 2), 'utf8')
}

/** 只清某个 chat 的待选目标（不碰别的 chat）。 */
export function clearPendingChoice(root, chatId) {
  const id = String(chatId || '')
  if (!id) return
  const table = readPendingChoiceTable(root)
  if (!(id in table)) return
  delete table[id]
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, PENDING_CHOICE_FILE), JSON.stringify(table, null, 2), 'utf8')
}

/**
 * 解析「选第几个」的回复。
 * 认：`2`、`选2`、`第2个`、`绑定会话 2`、`接入 2`（**只认纯序号**；
 * `绑定会话 sess-abc` 这种真 id 交给 routeMessage 的 bind 分支，这里不抢）。
 * @param {string} text 用户消息正文。
 * @param {object|null} pending readPendingChoice(root, chatId) 的结果（已按 chat 过滤）。
 * @param {{now?: number, ttlMs?: number}} [opts]
 * @returns {{kind: 'select', sessionId: string, label: string, index: number}
 *          | {kind: 'expired', count: number}
 *          | {kind: 'out-of-range', count: number}
 *          | null}  null = 不是选会话的回复（照常走路由）。
 */
export function parseChoiceReply(text, pending, opts = {}) {
  if (!pending || !Array.isArray(pending.candidates) || pending.candidates.length === 0) return null
  const t = String(text || '').trim()
  if (!t) return null
  // 纯序号 / 选N / 第N个 / 绑定会话 N / 接入 N
  const m = /^(?:选|第)?\s*(\d{1,2})\s*(?:个|号)?$/.exec(t) ||
    /^(?:绑定会话|绑定|接入会话|接入|切换到会话|切换)\s*(\d{1,2})$/.exec(t)
  if (!m) return null
  const index = Number(m[1])
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const ttl = typeof opts.ttlMs === 'number' ? opts.ttlMs : PENDING_CHOICE_TTL_MS
  const createdAt = Number(pending.createdAt ?? 0)
  if (!createdAt || now - createdAt > ttl) {
    return { kind: 'expired', count: pending.candidates.length }
  }
  if (!Number.isInteger(index) || index < 1 || index > pending.candidates.length) {
    return { kind: 'out-of-range', count: pending.candidates.length }
  }
  const chosen = pending.candidates[index - 1]
  return {
    kind: 'select',
    sessionId: String(chosen.sessionId || ''),
    label: chosen.label || chosen.title || String(chosen.sessionId || ''),
    index,
  }
}

/** 去掉 UTF-8 BOM（\uFEFF 或 EF BB BF）。 */
function stripBom(text) {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1)
  return text
}

// ═══════════════════════════════════════════════════════════════════
// 1.5.18 飞书消息附件收发
//
// 收件：SDK mergedEvent.resources 已带 fileKey/fileName（SDK dispatchConvert
// 从 content JSON 抽好，lib/index.js:106835/106850；file→106197、image→106221、
// post img/media→106498/106505、video→106626、audio→106149），这里做归一化 +
// 消息详情接口兜底 + 下载落盘编排。发件：`[附件: 路径]`/`[图片: 路径]` 标记
// 解析剥离 + 经 channel.sender（SDK OutboundSender 原生支持 {file}/{image}，
// MediaUploader 直接吃本地路径，lib/index.js:104623/105193/105206）发送编排。
// 网络函数用 Node 内建 fetch——「只用 node 内建模块」的约定不破坏。
// channel / logger 一律依赖注入，保持本文件可脱离宿主单测。
// ═══════════════════════════════════════════════════════════════════

/** 会让用户把附件发进来的消息类型（mergedEvent.rawContentType / msg_type）。 */
export const ATTACHMENT_MSG_TYPES = new Set(['post', 'file', 'media', 'image', 'audio', 'video'])

/** 把错误对象转成一行人话（fetch/SDK 抛的东西五花八门）。 */
function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error || 'unknown error')
}

/**
 * 把 SDK mergedEvent.resources 归一化成统一形状：
 *   [{ kind: 'file' | 'image', fileKey, fileName? }]
 * type 'file'/'video'/'audio' 走消息资源接口下载；'image' 走图片接口；
 * 'sticker' 等装饰性资源不在收件范围，忽略。
 */
export function normalizeSdkResources(resources) {
  if (!Array.isArray(resources)) return []
  const out = []
  for (const r of resources) {
    if (!r || typeof r.fileKey !== 'string' || !r.fileKey) continue
    if (r.type === 'image') {
      out.push({ kind: 'image', fileKey: r.fileKey, fileName: r.fileName || undefined })
    } else if (r.type === 'file' || r.type === 'video' || r.type === 'audio') {
      out.push({ kind: 'file', fileKey: r.fileKey, fileName: r.fileName || undefined })
    }
  }
  return out
}

/**
 * 从消息详情接口 body.content（JSON 字符串）解析附件清单——SDK resources
 * 缺失时的兜底。递归走整棵 JSON，凡带已知 tag 的元素都收集（天然兼容
 * detail API 的 {title, content:[[…]]} 与事件旧的 {post:{<lang>:{content}}} 两种形状）：
 *   tag file / media → file 资源（file_key，file_name 可选）
 *   tag img / image  → image 资源（image_key）
 * file/media/image/audio 这类整体型消息直接按顶层字段取。
 */
export function parseAttachmentsFromContent(msgType, contentJson) {
  let parsed
  try {
    parsed = JSON.parse(contentJson || '')
  } catch {
    return []
  }
  const out = []
  const pushFile = (fileKey, fileName) => {
    if (typeof fileKey === 'string' && fileKey) {
      out.push({ kind: 'file', fileKey, fileName: fileName || undefined })
    }
  }
  const pushImage = (imageKey) => {
    if (typeof imageKey === 'string' && imageKey) {
      out.push({ kind: 'image', fileKey: imageKey })
    }
  }
  if (msgType === 'file' || msgType === 'media' || msgType === 'video' || msgType === 'audio') {
    pushFile(parsed?.file_key, parsed?.file_name)
    return dedupe(out)
  }
  if (msgType === 'image') {
    pushImage(parsed?.image_key)
    return dedupe(out)
  }
  if (msgType !== 'post') return dedupe(out)
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!node || typeof node !== 'object') return
    if (typeof node.tag === 'string') {
      if (node.tag === 'file' || node.tag === 'media') pushFile(node.file_key, node.file_name)
      else if (node.tag === 'img' || node.tag === 'image') pushImage(node.image_key)
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(parsed)
  // 实测（2026-11-10，om_x100b60062bb868a0c1374152dac71e8）：post 附件不在正文元素里，
  // 而是顶层 files 数组 [{"file_key","file_name","is_folder"}]——SDK convertPost 只走
  // content 段落同样漏掉它。is_folder=true 是云文件夹引用，资源下载接口不提供，跳过。
  if (Array.isArray(parsed?.files)) {
    for (const f of parsed.files) {
      if (f && typeof f.file_key === 'string' && f.file_key && f.is_folder !== true) {
        pushFile(f.file_key, f.file_name)
      }
    }
  }
  return dedupe(out)

  /** 按 fileKey 去重（同一附件可能同时出现在正文元素与顶层 files）。 */
  function dedupe(list) {
    const seen = new Set()
    return list.filter((r) => (seen.has(r.fileKey) ? false : (seen.add(r.fileKey), true)))
  }
}

/** 清洗文件名：Windows 非法字符/控制字符 → _，折叠空白，去掉首尾空白与点，限 120 字符。 */
export function sanitizeFileName(name, fallback = 'attachment') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
  return cleaned || fallback
}

/** 附件落盘时间前缀：本地时间 yyyymmdd-HHmmss。 */
export function attachmentTimestampPrefix(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/** 附件目录：<记忆根>\feishu\attachments\<chatId>（记忆根由调用方传入，不硬编码盘符）。 */
export function attachmentDir(root, chatId) {
  const safeChat = sanitizeFileName(chatId, 'unknown-chat')
  return join(feishuDir(root), 'attachments', safeChat)
}

/**
 * 附件落盘：<目录>\<yyyymmdd-HHmmss>_<文件名>；目录不存在先建；
 * 同秒同名自动加 -2、-3 后缀防覆盖。返回落盘绝对路径。
 */
export function saveAttachmentBuffer(root, chatId, fileName, buffer) {
  const dir = attachmentDir(root, chatId)
  mkdirSync(dir, { recursive: true })
  const base = sanitizeFileName(fileName)
  const ext = extname(base)
  const stem = ext ? base.slice(0, base.length - ext.length) : base
  const ts = attachmentTimestampPrefix()
  let target = join(dir, `${ts}_${base}`)
  let n = 1
  while (existsSync(target)) {
    n += 1
    target = join(dir, `${ts}_${stem}-${n}${ext}`)
  }
  writeFileSync(target, buffer)
  return target
}

/** content-type → 扩展名（常见类型白名单 + image/* 通配），未识别返回 fallback。 */
export function extFromContentType(contentType, fallback = '') {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (!ct) return fallback
  const known = {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.ms-excel': '.xls',
    'application/msword': '.doc',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'audio/opus': '.opus',
    'audio/ogg': '.ogg',
    'text/plain': '.txt',
  }
  if (known[ct]) return known[ct]
  if (ct.startsWith('image/')) return `.${ct.slice('image/'.length)}`
  return fallback
}

/** 无 kind 兜底扩展名（image→.png，audio→.opus，其余 .bin）。 */
const KIND_FALLBACK_EXT = { image: '.png', audio: '.opus' }

/**
 * 决定落盘文件名：优先原始文件名（缺扩展名时按 content-type 补）；
 * 无名时 attachment_<fileKey 尾 8 位><ext> / image_<imageKey 尾 8 位><ext>。
 */
export function composeAttachmentName(resource, contentType) {
  const fallbackExt = KIND_FALLBACK_EXT[resource.kind] || '.bin'
  const ext = extFromContentType(contentType, fallbackExt)
  if (resource.fileName) {
    const safe = sanitizeFileName(resource.fileName)
    return extname(safe) ? safe : safe + ext
  }
  const shortKey = String(resource.fileKey || '').slice(-8) || 'unknown'
  const prefix = resource.kind === 'image' ? 'image' : 'attachment'
  return `${prefix}_${shortKey}${ext}`
}

/**
 * tenant_access_token 管理器：POST /auth/v3/tenant_access_token/internal，
 * 进程内缓存到过期前 60 秒。返回 async getToken()。
 */
export function createTokenManager({ domain, appId, appSecret }) {
  let cached = null
  return async function getTenantAccessToken() {
    const now = Date.now()
    if (cached && now < cached.expireAt - 60_000) return cached.token
    const res = await fetch(`${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json()
    if (data?.code !== 0 || !data.tenant_access_token) {
      throw new Error(`tenant_access_token 获取失败: code=${data?.code} msg=${data?.msg}`)
    }
    cached = {
      token: data.tenant_access_token,
      expireAt: now + (Number(data.expire) || 7200) * 1000,
    }
    return cached.token
  }
}

/** 拉单条消息详情（GET /im/v1/messages/{message_id}）；返回 items[0] 或 null。 */
export async function fetchMessageDetail(domain, token, messageId) {
  const res = await fetch(
    `${domain}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  )
  const data = await res.json()
  if (data?.code !== 0) {
    throw new Error(`消息详情获取失败: HTTP ${res.status} code=${data?.code} msg=${data?.msg}`)
  }
  const items = data?.data?.items
  return Array.isArray(items) && items.length > 0 ? items[0] : null
}

/** 二进制下载公共体：非 2xx 或「200 + JSON 错误体」都转成异常；返回 {buffer, contentType}。 */
async function downloadBinary(url, token) {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = ` code=${j?.code} msg=${j?.msg}`
    } catch {}
    throw new Error(`HTTP ${res.status}${detail}`)
  }
  const contentType = res.headers.get('content-type') || ''
  const buffer = Buffer.from(await res.arrayBuffer())
  if (/application\/json/i.test(contentType)) {
    let j = null
    try {
      j = JSON.parse(buffer.toString('utf8'))
    } catch {}
    if (j && typeof j === 'object' && j.code !== undefined && j.code !== 0) {
      throw new Error(`接口返回错误: code=${j.code} msg=${j.msg}`)
    }
  }
  return { buffer, contentType }
}

/** 消息内文件资源下载 URL（导出便于单测与日志取证）。 */
export function fileResourceUrl(domain, messageId, fileKey) {
  return `${domain}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=file`
}

/**
 * 消息内图片资源下载 URL（导出便于单测与日志取证）。
 * 图片同样走 messages/{id}/resources，靠 `?type=image` 区分；key 直接放路径段，
 * img_v3_* 里的 `-`/`_` 都是 URL 安全字符，encodeURIComponent 后不发生任何变形。
 */
export function imageResourceUrl(domain, messageId, imageKey) {
  return `${domain}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(imageKey)}?type=image`
}

/** 下载消息内文件资源（file/video/audio 通用）：GET /im/v1/messages/{id}/resources/{file_key}?type=file */
export function downloadFileResource(domain, token, { messageId, fileKey }) {
  return downloadBinary(fileResourceUrl(domain, messageId, fileKey), token)
}

/**
 * 下载消息内的图片资源（image/sticker key）：
 *   GET /im/v1/messages/{message_id}/resources/{image_key}?type=image
 *
 * 1.5.18 的坑（已实测，见 报告-图片下载400根因.md）：原实现走
 * `GET /im/v1/images/{image_key}`，那个接口只认「本应用上传图片后拿到的 image_key」，
 * 把消息里的 img_v3_* 塞进去一律 `400 code=234001 Invalid request param.`。
 * 消息里的图片属于消息资源，必须走 messages/{id}/resources 并用 type=image 声明类型。
 */
export function downloadImageResource(domain, token, { messageId, imageKey }) {
  if (!messageId) throw new Error('图片下载缺少 message_id（消息资源接口必须带消息 ID）')
  if (!imageKey) throw new Error('图片下载缺少 image_key')
  return downloadBinary(imageResourceUrl(domain, messageId, imageKey), token)
}

/**
 * 收件编排：从一条 mergedEvent 收集并下载全部附件。
 * 主路径用 SDK resources；兜底/补名用消息详情接口；单个文件失败不影响其余。
 * @returns {Promise<null | {saved: string[], failed: {name, reason}[]}>} null=没有需要处理的附件
 */
export async function collectIncomingAttachments({
  logger,
  mergedEvent,
  root,
  domain,
  getTenantAccessToken,
}) {
  const type = mergedEvent?.rawContentType || ''
  let resources = normalizeSdkResources(mergedEvent?.resources)
  if (!ATTACHMENT_MSG_TYPES.has(type) && resources.length === 0) return null

  const chatId = String(mergedEvent.chatId || '')
  const messageId = String(mergedEvent.messageId || '')

  // 兜底：resources 空（旧版 SDK/解析失败）→ 拉详情解析；file 类缺 fileName
  // （post 的 media 元素 SDK 不带名）→ 详情补名。详情失败不致命，只影响文件名。
  if (resources.length === 0 || resources.some((r) => r.kind === 'file' && !r.fileName)) {
    try {
      const token = await getTenantAccessToken()
      const detail = await fetchMessageDetail(domain, token, messageId)
      if (detail) {
        const parsed = parseAttachmentsFromContent(
          detail.msg_type || type,
          detail?.body?.content || '',
        )
        if (resources.length === 0) {
          resources = parsed
        } else {
          const nameByKey = new Map(
            parsed.filter((r) => r.kind === 'file' && r.fileName).map((r) => [r.fileKey, r.fileName]),
          )
          resources = resources.map((r) =>
            r.kind === 'file' && !r.fileName && nameByKey.get(r.fileKey)
              ? { ...r, fileName: nameByKey.get(r.fileKey) }
              : r,
          )
        }
      }
    } catch (error) {
      logger?.warn?.(`aiyayi-feishu: 消息详情兜底失败（不阻断下载）: ${errorMessage(error)}`)
    }
  }
  if (resources.length === 0) {
    // post 无附件是常态，静默；其余类型没有 key 就无从下载，如实报失败。
    if (type === 'post') return null
    return {
      saved: [],
      failed: [{ name: '附件', reason: '无法取得 file_key（SDK resources 为空且消息详情不可用）' }],
    }
  }

  const saved = []
  const failed = []
  for (const resource of resources) {
    const label = resource.fileName || resource.fileKey
    try {
      const token = await getTenantAccessToken()
      const result =
        resource.kind === 'image'
          ? await downloadImageResource(domain, token, { messageId, imageKey: resource.fileKey })
          : await downloadFileResource(domain, token, { messageId, fileKey: resource.fileKey })
      const name = composeAttachmentName(resource, result.contentType)
      const absPath = saveAttachmentBuffer(root, chatId, name, result.buffer)
      saved.push(absPath)
      logger?.info?.(
        `aiyayi-feishu: 附件已保存 ${absPath}（msg=${messageId} file_key=${resource.fileKey} ${result.buffer.length} 字节）`,
      )
    } catch (error) {
      const reason = errorMessage(error)
      failed.push({ name: label, reason })
      // 1.5.19：失败日志带上真实请求 URL——1.5.18 只打 code/msg，排 400 时无从判断
      // 是哪个接口、哪个 type、哪个 key，只能反推（见 报告-图片下载400根因.md）。
      const attemptedUrl =
        resource.kind === 'image'
          ? imageResourceUrl(domain, messageId, resource.fileKey)
          : fileResourceUrl(domain, messageId, resource.fileKey)
      logger?.warn?.(
        `aiyayi-feishu: 附件下载失败 msg=${messageId} file=${label} kind=${resource.kind} url=${attemptedUrl}: ${reason}`,
      )
    }
  }
  return { saved, failed }
}

/**
 * 把附件处理结果并进投递文本：保存/失败各追加一行括注；
 * 全空时给有意义的占位提示，绝不投空块。
 */
export function composeDeliveryText(text, attach, messageId) {
  const parts = [String(text || '').trim()]
  if (attach?.saved?.length) {
    parts.push(attach.saved.map((p) => `（飞书附件已保存：${p}）`).join('\n'))
  }
  if (attach?.failed?.length) {
    parts.push(
      attach.failed
        .map((f) => `（飞书附件下载失败：${f.reason}，msg_id=${messageId || '?'}）`)
        .join('\n'),
    )
  }
  const merged = parts.filter(Boolean).join('\n')
  return merged || `（收到一条无文本内容的飞书消息，msg_id=${messageId || '?'}）`
}

/** B 侧约定标记（全/半角冒号均容忍）：[附件: <绝对路径>] 与 [图片: <绝对路径>]。 */
const ATTACH_FILE_MARKER = /\[附件[：:][ \t]*([^\]\n]+?)[ \t]*\]/g
const ATTACH_IMAGE_MARKER = /\[图片[：:][ \t]*([^\]\n]+?)[ \t]*\]/g
/** 合并版：一次扫出标记 + 出现位置（发件要按正文里的原始顺序逐条发）。 */
const ATTACH_MARKER_ANY = /\[(附件|图片)[：:][ \t]*([^\]\n]+?)[ \t]*\]/g

/**
 * 飞书「上传图片」接口（POST /open-apis/im/v1/images）支持的格式白名单，取自官方文档
 * https://open.feishu.cn/document/server-docs/im-v1/image/create ：
 *   JPG、JPEG、PNG、WEBP、GIF、BMP、ICO、TIFF、HEIC
 * （TIFF/HEIC 上传后会被平台转成 JPG；单张上限 10MB，GIF 分辨率 ≤2000x2000、
 *  其他 ≤12000x12000）。白名单外的扩展名一律按文件发，绝不硬塞进图片接口。
 */
export const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.heic',
  '.ico',
  '.tif',
  '.tiff',
])

/** 路径是否为飞书图片接口支持的图片格式（大小写不敏感）。 */
export function isImagePath(filePath) {
  const ext = extname(String(filePath || '').trim()).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

/**
 * 抽出文本里全部附件/图片标记路径（不去重不校验存在性，发送时逐个处理）。
 * 1.5.19 额外返回 items（带正文出现位置 index 与标记种类 tag），供按序分流发送。
 */
export function extractAttachmentMarkers(text) {
  const files = []
  const images = []
  const items = []
  for (const m of String(text || '').matchAll(ATTACH_MARKER_ANY)) {
    const path = m[2].trim()
    const tag = m[1] === '图片' ? 'image' : 'file'
    items.push({ index: m.index, path, tag })
    if (tag === 'image') images.push(path)
    else files.push(path)
  }
  return { files, images, items }
}

/**
 * 发件计划：按标记在正文里出现的**原始顺序**逐条决策类型（图片消息分流）。
 * 判据只有扩展名——`[附件: a.png]` 也会按图片发（这正是用户反馈「图变文件」的根因：
 * 模型习惯写 `[附件:]`，旧代码只看标记名不看扩展名）；`[图片: a.pdf]` 降级按文件发，
 * 绝不让不支持的格式进 /im/v1/images 白撞一个 234011 错误。
 * @returns {Array<{path: string, kind: 'image'|'file', tag: 'image'|'file', index: number}>}
 */
export function planAttachmentSends(text) {
  const { items } = extractAttachmentMarkers(text)
  return items.map((item) => ({
    path: item.path,
    kind: isImagePath(item.path) ? 'image' : 'file',
    tag: item.tag,
    index: item.index,
  }))
}

/**
 * 剥掉全部附件/图片标记并清理多余空行（发正文前用）。
 * 无标记的文本原样返回（与 1.5.17 纯文本回发行为逐字节一致，不折叠任何空白）；
 * 有标记时才清理标记留下的多余空格/空行。
 */
export function stripAttachmentMarkers(text) {
  const original = String(text || '')
  const stripped = original
    .replace(ATTACH_FILE_MARKER, '')
    .replace(ATTACH_IMAGE_MARKER, '')
  if (stripped === original) return original
  return stripped
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 图片消息上传接口上限（官方文档：单张 ≤10MB、不可为 0）。 */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024

/**
 * 每类附件发送实际会打到的两个接口（写进日志，排障时直接看到请求 URL；
 * 线上 1.5.18 只记「发送失败+文案」，查 bug 时根本不知道打到哪、哪一步挂的）。
 * 依据 SDK 1.76.0 实现：sender.send({image}) → MediaUploader.uploadImage
 * （lib/index.js:104738-104761，POST /open-apis/im/v1/images）→
 * sendOneWithFallback/rawSend（:105309/:105332，POST /open-apis/im/v1/messages）；
 * sender.send({file}) → uploadFile（:104762-104790，POST /open-apis/im/v1/files）
 * → 同一 rawSend。
 */
export const SEND_ENDPOINTS = {
  image: 'POST /open-apis/im/v1/images(image_type=message) -> POST /open-apis/im/v1/messages(msg_type=image)',
  file: 'POST /open-apis/im/v1/files(file_type=stream) -> POST /open-apis/im/v1/messages(msg_type=file)',
}

/** 从 SDK 抛出的错误里尽量挖出飞书错误码/文案（LarkChannelError 带 code + cause）。 */
function describeSendError(error) {
  const cause = error?.cause
  const feishuCode =
    cause?.response?.data?.code ??
    cause?.data?.code ??
    (typeof cause?.code === 'number' ? cause.code : undefined)
  const feishuMsg = cause?.response?.data?.msg ?? cause?.data?.msg ?? cause?.message
  const code =
    error?.code && error.code !== feishuCode ? `${error.code}/${feishuCode ?? '-'}` : feishuCode
  const detail = [code != null ? `code=${code}` : null, feishuMsg ? `msg=${feishuMsg}` : null]
    .filter(Boolean)
    .join(' ')
  const base = errorMessage(error)
  return detail ? `${base} [${detail}]` : base
}

/**
 * 发件编排（图片消息分流）：把 [附件:]/[图片:] 标记**按正文原始顺序**逐条发出，
 * 每条按自己的扩展名决定发「图片消息」还是「文件消息」，再发剥离标记后的正文。
 *
 * 分流规则：
 *   - 扩展名 ∈ IMAGE_EXTENSIONS（大小写不敏感）→ { image: { source } }：
 *     SDK 会先 POST /im/v1/images 拿 image_key，再发 msg_type=image，
 *     客户端直接显示成可点的图，不再是文件卡片；
 *   - 其他 → { file: { source, fileName } }（与 1.5.18 行为完全一致）。
 *   - 图片上传/发送失败（格式不被接受、超 10MB、分辨率超限、权限掉）→
 *     **降级成文件发**，绝不丢附件；降级日志带 url/kind/文件名。
 * 单个附件彻底失败：warn + 剥离标记 + 正文照发，绝不阻断。
 *
 * @param {object} channel - SDK LarkChannel（只用到 channel.sender.send / channel.opts）。
 * @param {string} chatId - 目标 chat。
 * @param {string} text - 含标记的回复文本。
 * @param {object} [logger] - {info, warn}（可注入 ctx.logger）。
 * @returns {Promise<{filesTotal, filesSent, imagesTotal, imagesSent, imageFallbacks, textSent, problems: string[], order: string[]}>}
 */
export async function sendReplyWithAttachments(channel, chatId, text, logger) {
  const { filesTotal, imagesTotal, plan } = planSummary(text)
  // 坑 #72 兜底：stripAttachmentMarkers 的「无标记早退分支」会原样返回未清理文本，
  // 首尾空白会一路透传到卡片/纯文本出口。这里统一补一道 trim 兜底，
  // 覆盖卡片、纯文本降级等**全部**正文出口（只动首尾，中间空行保持原样）。
  const cleanText = stripAttachmentMarkers(text).trim()
  const problems = []
  const order = []
  let filesSent = 0
  let imagesSent = 0
  let imageFallbacks = 0

  const domain = channel?.opts?.domain || 'https://open.feishu.cn'

  const logImageEndpoints = SEND_ENDPOINTS.image
  const logFileEndpoints = SEND_ENDPOINTS.file

  /** 发一条 file 消息（图片降级也走这里）。 */
  const sendAsFile = async (filePath, label) => {
    await channel.sender.send(chatId, {
      file: { source: filePath, fileName: basename(filePath) },
    })
    logger?.info?.(
      `aiyayi-feishu: ${label}已按文件发送 chat=${chatId} kind=file file=${basename(filePath)} size=${safeSize(filePath)} url=${domain} ${logFileEndpoints}`,
    )
  }

  for (const item of plan) {
    const label = item.kind === 'image' ? '图片' : '附件'
    const fileName = basename(item.path)
    // 文件不存在：记一条问题，继续下一项（正文照发）。
    if (!existsSync(item.path)) {
      const reason = `文件不存在: ${item.path}`
      problems.push(`${label} ${item.path}: ${reason}`)
      logger?.warn?.(
        `aiyayi-feishu: ${label}发送失败 chat=${chatId} kind=${item.kind} file=${fileName} url=- reason=${reason}`,
      )
      continue
    }
    if (item.kind === 'image') {
      const size = safeSize(item.path, -1)
      // 预检：0 字节/超 10MB 的图上传必挂（官方限制），直接降级成文件，省一次失败请求。
      if (size === 0 || size > IMAGE_MAX_BYTES) {
        const why = size === 0 ? '图片为 0 字节（接口禁止）' : `图片 ${size} 字节超过 10MB 上限`
        logger?.warn?.(
          `aiyayi-feishu: 图片不满足 /im/v1/images 限制，直接按文件发送 chat=${chatId} kind=image file=${fileName} url=${domain} ${logImageEndpoints} reason=${why}`,
        )
        try {
          await sendAsFile(item.path, `图片（降级：${why}）`)
          imageFallbacks += 1
          order.push(`image->file:${fileName}`)
        } catch (error) {
          const reason = describeSendError(error)
          problems.push(`${label} ${item.path}: ${reason}`)
          logger?.warn?.(
            `aiyayi-feishu: 图片降级为文件也失败 chat=${chatId} kind=file file=${fileName} url=${domain} ${logFileEndpoints} reason=${reason}`,
          )
        }
        continue
      }
      try {
        await channel.sender.send(chatId, { image: { source: item.path } })
        imagesSent += 1
        order.push(`image:${fileName}`)
        logger?.info?.(
          `aiyayi-feishu: 图片已按图片消息发送 chat=${chatId} kind=image msg_type=image file=${fileName} size=${size} url=${domain} ${logImageEndpoints}`,
        )
      } catch (error) {
        // 关键兜底：图片发不出去就降级成文件发，不能让用户什么都收不到。
        const reason = describeSendError(error)
        logger?.warn?.(
          `aiyayi-feishu: 图片消息发送失败，降级为文件重试 chat=${chatId} kind=image file=${fileName} url=${domain} ${logImageEndpoints} reason=${reason}`,
        )
        try {
          await sendAsFile(item.path, '图片（降级为文件）')
          imageFallbacks += 1
          order.push(`image->file:${fileName}`)
        } catch (fallbackError) {
          const fallbackReason = describeSendError(fallbackError)
          problems.push(`${label} ${item.path}: ${reason}；降级文件也失败: ${fallbackReason}`)
          logger?.warn?.(
            `aiyayi-feishu: 图片降级为文件也失败 chat=${chatId} kind=file file=${fileName} url=${domain} ${logFileEndpoints} reason=${fallbackReason}`,
          )
        }
      }
      continue
    }
    try {
      await sendAsFile(item.path, label)
      filesSent += 1
      order.push(`file:${fileName}`)
    } catch (error) {
      const reason = describeSendError(error)
      problems.push(`${label} ${item.path}: ${reason}`)
      logger?.warn?.(
        `aiyayi-feishu: ${label}发送失败（已剥离标记，正文照发）chat=${chatId} kind=file file=${fileName} url=${domain} ${logFileEndpoints} reason=${reason}`,
      )
    }
  }

  let textSent = false
  let mdInfo = '-'
  if (cleanText) {
    // 1.5.20：默认走 interactive 卡片 + lark_md（飞书纯文本不渲染 markdown）；
    // AIYAYI_FEISHU_MARKDOWN=text 可一键退回旧的 { text } 纯文本发送。
    if (markdownMode() === 'card') {
      const r = await sendMarkdownCard(channel, chatId, cleanText, logger)
      // 只要卡片发了或降级文本发了，正文就算送达（旧逻辑只看 cards 会把降级判成没发）。
      textSent = r.fallback === 'text' || r.sent > 0 || r.total === 0
      mdInfo = `card:${r.sent}/${r.total}${r.fallback ? `（降级${r.fallback}）` : ''}`
    } else {
      await channel.sender.send(chatId, { text: cleanText })
      textSent = true
      mdInfo = 'text(开关)'
    }
  } else if (problems.length > 0) {
    // 正文为空且附件有失败：不静默（SKILL 排障教训——静默路径零日志最阴险），
    // 回一条失败说明，用户至少知道发生了什么。
    await channel.sender.send(chatId, { text: `（附件发送失败：${problems.join('；')}）` })
    mdInfo = 'text(附件失败说明)'
  }
  logger?.info?.(
    `aiyayi-feishu: 已回发 ${chatId}（正文 ${cleanText.length} 字，附件 ${filesSent}/${filesTotal}，图片消息 ${imagesSent}/${imagesTotal}，图片降级 ${imageFallbacks}，正文通道 ${mdInfo}）order=${order.join(',') || '-'}`,
  )
  return {
    filesTotal,
    filesSent,
    imagesTotal,
    imagesSent,
    imageFallbacks,
    textSent,
    problems,
    order,
  }
}

/**
 * 发送计划 + 计数（按**实际发送类型**统计，不是按标记名）：
 * filesTotal = 将按文件发的条数，imagesTotal = 将按图片消息发的条数。
 */
function planSummary(text) {
  const plan = planAttachmentSends(text)
  return {
    filesTotal: plan.filter((p) => p.kind === 'file').length,
    imagesTotal: plan.filter((p) => p.kind === 'image').length,
    plan,
  }
}

/** 文件大小（字节）；取不到返回 fallback（不抛出，纯日志/预检用）。 */
function safeSize(filePath, fallback = '?') {
  try {
    return statSync(filePath).size
  } catch {
    return fallback
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1.5.20 markdown → 飞书富文本（interactive 卡片 + lark_md）
//
// 病根：1.5.19 及以前，回发正文一律 channel.sender.send(chatId, { text })，
// SDK（1.76.0 OutboundSender.sendText，lib/index.js:105154-105172）打成
// msg_type=text 的**纯文本**消息（content = {"text": "..."}）。飞书客户端对
// 纯文本消息不做 markdown 渲染，于是 `**粗体**`、`## 标题`、`- 列表` 原样
// 显示成符号。
//
// 方案：改发 interactive 卡片，正文放进 div.text.tag='lark_md'，由飞书客户端
// 按富文本渲染。卡片结构完全复用 1.5.19 问答卡片那套线上已验证的形状
// （见下方 buildQuestionCard 的 { config, elements:[{tag:'div',text:{tag:'lark_md'}}] }）。
//
// 开关：AIYAYI_FEISHU_MARKDOWN=text（或 0/off）退回旧的纯文本发送，默认 card。
// 兜底：卡片发不出去（权限/格式/内容超限）自动降级，把**剩余分片**按纯文本重发，
// 绝不因为换渲染而让消息发不出去。
// ═══════════════════════════════════════════════════════════════════

/** markdown 渲染开关的环境变量名（默认 card；置 text/0/off 退回纯文本）。 */
export const MARKDOWN_MODE_ENV = 'AIYAYI_FEISHU_MARKDOWN'

/**
 * 单张卡片正文上限（字符）。飞书卡片整体 JSON 上限 30KB，这里按正文字符
 * 保守取 3500（与 SDK 自己的 DEFAULT_CHUNK_LIMIT 一致，lib/index.js:105084），
 * 留足 JSON 包装与 CJK 多字节的余量。
 */
export const CARD_CONTENT_LIMIT = 3500

/** 当前渲染模式：'card'（默认，富文本）| 'text'（旧行为）。 */
export function markdownMode() {
  const raw = process.env[MARKDOWN_MODE_ENV]
  if (raw === undefined || raw === null || raw === '') return 'card'
  const v = String(raw).trim().toLowerCase()
  if (v === '0' || v === 'off' || v === 'false' || v === 'text' || v === 'plain') return 'text'
  return 'card'
}

/** 字符显示宽度（CJK/全角算 2，用于表格对齐）。 */
function displayWidth(s) {
  let w = 0
  for (const ch of String(s ?? '')) {
    const cp = ch.codePointAt(0) ?? 0
    w +=
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
        ? 2
        : 1
  }
  return w
}

/** 右补空格到指定显示宽度。 */
function padDisplay(s, width) {
  const cur = displayWidth(s)
  return cur >= width ? String(s ?? '') : String(s ?? '') + ' '.repeat(width - cur)
}

/** 把 `a | b | c` 拆成单元格（去掉首尾竖线）。 */
function splitTableRow(line) {
  let s = String(line).trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

/**
 * markdown 表格 → 空格对齐的纯文本（lark_md 不支持 `|` 表格语法）。
 * 只认「表头行 + 分隔行(`|---|:--:|`) + 若干数据行」的块，其余行原样保留。
 */
function convertMarkdownTables(src) {
  const lines = String(src).split('\n')
  const out = []
  let i = 0
  const isTableLine = (l) => typeof l === 'string' && l.includes('|') && l.trim() !== ''
  const isDivider = (l) => /^[\s|:\-]+$/.test(l) && l.includes('-')
  while (i < lines.length) {
    if (isTableLine(lines[i]) && i + 1 < lines.length && isTableLine(lines[i + 1]) && isDivider(lines[i + 1])) {
      const block = []
      let j = i
      while (j < lines.length && isTableLine(lines[j])) {
        block.push(lines[j])
        j += 1
      }
      // block[0] = 表头，block[1] = 分隔行，其余 = 数据行
      const rows = [splitTableRow(block[0]), ...block.slice(2).map(splitTableRow)]
      const cols = Math.max(...rows.map((r) => r.length))
      const widths = []
      for (let c = 0; c < cols; c += 1) {
        widths.push(Math.max(...rows.map((r) => displayWidth(r[c] ?? ''))))
      }
      rows.forEach((r, ri) => {
        const line = widths.map((w, c) => padDisplay(r[c] ?? '', w)).join(' │ ').trimEnd()
        out.push(line)
        // 表头下面补一条分隔，保留「这是表头」的视觉线索
        if (ri === 0) out.push(widths.map((w) => '─'.repeat(w)).join('─┼─'))
      })
      i = j
      continue
    }
    out.push(lines[i])
    i += 1
  }
  return out.join('\n')
}

/**
 * markdown → lark_md（飞书卡片富文本子集）。
 *
 * 转换规则（lark_md 的能力边界决定的）：
 *   `# H1`~`###### H6`      → `**标题**`      （lark_md 无 heading 语法）
 *   `**粗体**` / `__粗体__`  → 保留 / 归一成 `**粗体**`（支持）
 *   `*斜体*` / `~~删除线~~`  → 原样保留        （支持）
 *   `[文字](url)`           → 原样保留        （支持）
 *   `- 项` / `* 项` / `+ 项` → `• 项`          （`- ` 在 lark_md 里不稳，• 必定渲染）
 *   `1. 项`                 → 原样保留        （有序列表本来就是文字）
 *   `> 引用`                → `▏ 引用`        （lark_md 无 blockquote）
 *   `---` / `***` / `___`   → `————————`      （lark_md 无 hr；卡片 hr 只能整行元素，
 *                                              正文中间插不了，退化成横线字符）
 *   `| 表格 |`              → 空格对齐纯文本  （lark_md 无表格）
 *   ``` 围栏代码 ``` / `` `行内` `` → **原样保护**（先占位后还原，不被上面规则改坏）
 *
 * @param {string} md - 原始 markdown 文本
 * @returns {string} lark_md 文本
 */
export function markdownToLarkMd(md) {
  const src = String(md ?? '')
  if (!src) return ''

  // 1) 先把代码整块/行内保护起来：占位符里带 \u0000，正常正文不可能出现。
  const fences = []
  let text = src.replace(/```[\s\S]*?```/g, (m) => `\u0000C${fences.push(m) - 1}\u0000`)
  const inlines = []
  text = text.replace(/`[^`\n]+`/g, (m) => `\u0000I${inlines.push(m) - 1}\u0000`)

  // 2) 表格 → 对齐纯文本
  text = convertMarkdownTables(text)

  // 3) 标题 → 加粗（先做，避免 `#` 被后面的行首规则误伤）
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (m, title) => `**${title.trim()}**`)

  // 4) 分割线 → 横线字符
  text = text.replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '————————')

  // 5) 引用 → 竖线前缀
  text = text.replace(/^[ \t]{0,3}>[ \t]?(.*)$/gm, (m, body) => (body.trim() ? `▏ ${body}` : '▏'))

  // 6) 无序列表 → •（放在分割线规则之后，否则 `---` 会被当成列表项）
  text = text.replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ')

  // 7) __粗体__ → **粗体**
  text = text.replace(/__([^_\n]+)__/g, '**$1**')

  // 8) 还原代码块 / 行内代码
  text = text.replace(/\u0000I(\d+)\u0000/g, (m, i) => inlines[Number(i)] ?? '')
  text = text.replace(/\u0000C(\d+)\u0000/g, (m, i) => fences[Number(i)] ?? '')
  return text
}

/**
 * 按卡片正文上限切片。
 *
 * 关键约束：**不能把 ``` 围栏代码块从中间切开**，否则用户会看到半截代码块
 * （开围栏没闭合 → 后面整段被当代码）。做法与 SDK 自己的 splitWithCodeFences
 * （@larksuiteoapi/node-sdk lib/index.js:103826-103868）一致：
 * 在围栏内被迫断片时，给当前片补一个闭合 ```、给下一片重新开一个 ```lang。
 *
 * @param {string} text
 * @param {number} [limit] - 单卡正文字符上限
 * @returns {string[]} 非空分片数组（空文本返回 []）
 */
export function splitMarkdownForCard(text, limit = CARD_CONTENT_LIMIT) {
  const src = String(text ?? '')
  if (!src) return []
  const max = Math.max(200, Number(limit) || CARD_CONTENT_LIMIT)
  if (src.length <= max) return [src]

  // 单行自己就超长：先硬切成小块（预留围栏开合的开销），否则永远放不进一张卡。
  const HARD = Math.max(80, max - 64)
  const lines = []
  for (const raw of src.split('\n')) {
    if (raw.length <= HARD) {
      lines.push(raw)
      continue
    }
    for (let i = 0; i < raw.length; i += HARD) lines.push(raw.slice(i, i + HARD))
  }

  const FENCE_OPEN = /^\s{0,3}```\s*([\w+#.-]*)\s*$/
  const CLOSE = '```'
  const out = []
  let buf = []
  let bufLen = 0
  let fenceLang = null // null = 不在围栏内；'' = 围栏无语言标注

  const flush = () => {
    if (buf.length === 0) return
    let chunk = buf.join('\n')
    if (fenceLang !== null) chunk += `\n${CLOSE}`
    out.push(chunk)
    buf = []
    bufLen = 0
    if (fenceLang !== null) {
      // 下一片重新开围栏，保证代码块的视觉连续性
      buf.push(`${CLOSE}${fenceLang}`)
      bufLen = buf[0].length
    }
  }

  for (const line of lines) {
    const prospective = buf.length === 0 ? line.length : bufLen + 1 + line.length
    const closeCost = fenceLang !== null ? CLOSE.length + 1 : 0
    if (buf.length > 0 && prospective + closeCost > max) flush()
    buf.push(line)
    bufLen = buf.length === 1 ? line.length : bufLen + 1 + line.length
    const m = line.match(FENCE_OPEN)
    // 成对切换：遇到开围栏进入，遇到裸 ``` 闭合
    if (m) fenceLang = fenceLang === null ? m[1] || '' : null
  }
  flush()
  return out.filter((s) => s.length > 0)
}

/**
 * 构造一张 markdown 卡片（飞书 interactive 卡片 v1；div + lark_md）。
 * 形状与 buildQuestionCard 一致（线上已验证可发）。
 *
 * @param {string} content - 已转换好的 lark_md 正文（单卡片，勿超 CARD_CONTENT_LIMIT）
 * @param {object} [opts] - { title?, footer? }
 * @returns {object} 卡片 JSON（作为 channel.sender.send 的 { card } 载荷）
 */
export function buildMarkdownCard(content, opts = {}) {
  const elements = [{ tag: 'div', text: { tag: 'lark_md', content: String(content ?? '') } }]
  if (opts.footer) {
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: String(opts.footer) }] })
  }
  const card = { config: { wide_screen_mode: true, update_multi: true }, elements }
  if (opts.title) {
    card.header = { template: 'blue', title: { tag: 'plain_text', content: String(opts.title) } }
  }
  return card
}

/**
 * 发一条（或多条，超长自动分片）markdown 卡片；失败自动降级纯文本。
 *
 * 降级策略：卡片逐片发，第 N 片失败时只把**第 N 片及之后**按纯文本重发，
 * 已发出去的卡片不撤回、不重发（否则用户会看到重复内容）。
 *
 * @param {object} channel - SDK LarkChannel（只用到 channel.sender.send）
 * @param {string} chatId
 * @param {string} text - 原始 markdown
 * @param {object} [logger] - {info, warn}
 * @param {object} [opts] - { replyTo?, title?, footer?, limit? }
 * @returns {Promise<{sent:number,total:number,fallback:('text'|null),reason?:string}>}
 *          两者都失败时抛出（交给上层 flushReply 的 catch 记日志）。
 */
export async function sendMarkdownCard(channel, chatId, text, logger, opts = {}) {
  const chunks = splitMarkdownForCard(text, opts.limit ?? CARD_CONTENT_LIMIT)
  if (chunks.length === 0) return { sent: 0, total: 0, fallback: null }
  let sent = 0
  try {
    for (const chunk of chunks) {
      const sendOpts = opts.replyTo && sent === 0 ? { replyTo: opts.replyTo } : {}
      await channel.sender.send(
        chatId,
        { card: buildMarkdownCard(markdownToLarkMd(chunk), { title: opts.title, footer: opts.footer }) },
        sendOpts,
      )
      sent += 1
    }
    logger?.info?.(
      `aiyayi-feishu: 已按卡片发送 chat=${chatId} msg_type=interactive 分片=${sent}/${chunks.length}`,
    )
    return { sent, total: chunks.length, fallback: null }
  } catch (error) {
    const reason = describeSendError(error)
    logger?.warn?.(
      `aiyayi-feishu: 卡片发送失败，降级纯文本重发剩余分片 chat=${chatId} 已发=${sent}/${chunks.length} reason=${reason}`,
    )
    try {
      for (let i = sent; i < chunks.length; i += 1) {
        await channel.sender.send(chatId, { text: chunks[i] })
      }
      return { sent, total: chunks.length, fallback: 'text', reason }
    } catch (fallbackError) {
      const fallbackReason = describeSendError(fallbackError)
      throw new Error(`卡片发送失败(${reason})；纯文本兜底也失败(${fallbackReason})`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1.5.19 交互卡片问答（ask_user_question → 飞书卡片/文字兜底）
//
// 纯逻辑层：卡片 JSON 构造、文字编号列表构造、卡片点击/文字回复解析、
// 答案批次组装。不 import 任何 SDK / 宿主包（本文件约定），
// channel/logger 由 feishu.js 注入。
//
// 数据形状（一条待答问题 = 一个 record，宿主的 user-questions/request
// 里 questions 已由 @deepseek-ai/dsh-tool-ask-user 归一化为
// {id, question, header?, options?: [{label, description?}], multiSelect?}，
// 见 asar dsh-tool-ask-user/lib/index.js:34-46 → 服务侧 questionSchema
// 见 dsh-user-questions/lib/index.js:34-48）：
//   {
//     qid, chatId, sessionId, callId?, messageId?, rev,
//     createdAt, expiresAt,
//     status: 'open' | 'answered' | 'expired' | 'failed',
//     timed: boolean,
//     questions: [...],
//     selections: [[optionIndex...], ...],
//     customs: ['', ...],
//   }
// ═══════════════════════════════════════════════════════════════════

/** 卡片按钮/文字的选项序号前缀（① ② … 十以上用 10、11）。 */
const OPTION_GLYPHS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

/** 第 n 个（0 起）选项对用户的编号文本。 */
export function optionGlyph(index) {
  return OPTION_GLYPHS[index] ?? String(index + 1)
}

/** 问题标题行：header（有则用）+ 题面。 */
export function questionHeading(question, index) {
  const head = typeof question?.header === 'string' && question.header.trim()
    ? `【${question.header.trim()}】`
    : ''
  const idx = Number.isInteger(index) ? `${index + 1}. ` : ''
  return `${idx}${head}${String(question?.question ?? '').trim()}`
}

/**
 * 构造一张问题卡片（飞书 interactive 卡片 v1 JSON；字段形状对照
 * @larksuiteoapi/node-sdk types/index.d.ts:321473-321591 的 InteractiveCard /
 * InteractiveCardDivElement / InterfaceCardActionElement / InteractiveCardButtonActionItem /
 * InteractiveCardNoteElement）。
 *
 * 设计取舍（多选）：不用 form/checkbox（v1 卡片类型里没有 checkbox/form 元素，
 * SDK types 的 InteractiveCardElement 联合仅 div/markdown/hr/img/note/action，
 * types/index.d.ts:321490；且 form 提交走 card.action.trigger 的 form 分支，
 * 需要额外处理 active_form_value），而是「按钮 toggle + 提交」：
 * 点一下切换选中态，卡片就地 patch 出 ✅ 前缀，最后点「提交」一次性回传整批。
 * 这与宿主 answerer 的「整批一次答完」契约（dsh-user-questions/lib/index.js:568
 * 要求每个问题恰好被 answer 一次）天然对齐，且单选/多选共用一套渲染。
 *
 * @param {object} record - 上面描述的 record。
 * @returns {object} 飞书卡片 JSON（直接作为 channel.send 的 {card} 载荷）。
 */
export function buildQuestionCard(record) {
  const elements = []
  const questions = Array.isArray(record?.questions) ? record.questions : []
  questions.forEach((question, qi) => {
    const selected = new Set(record?.selections?.[qi] ?? [])
    const lines = [`**${questionHeading(question, qi)}**`]
    if (question?.multiSelect === true) lines.push('_可多选，选完点「提交」_')
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: lines.join('\n') },
    })
    const options = Array.isArray(question?.options) ? question.options : []
    if (options.length === 0) {
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: '_本题为自由填写：直接回复文字即可_ ' },
      })
      return
    }
    elements.push({
      tag: 'action',
      layout: 'flow',
      actions: options.map((option, oi) => {
        const on = selected.has(oi)
        const mark = on ? '✅ ' : ''
        const desc = option?.description ? `（${option.description}）` : ''
        return {
          tag: 'button',
          // 选中态用 primary 高亮；未选中 default。
          type: on ? 'primary' : 'default',
          text: { tag: 'plain_text', content: `${mark}${optionGlyph(oi)} ${option?.label ?? ''}${desc}` },
          // rev 逐次自增：SDK SafetyPipeline.pushAction 的去重键含 value 序列化
          // （lib/index.js:107296 + cardActionId 107406-107411，TTL 12h），
          // value 不变时「同一按钮点第二次（取消选中）」会被当重复事件丢掉。
          value: { q: record.qid, i: qi, o: oi, r: record.rev ?? 0 },
        }
      }),
    })
  })
  if (record?.status === 'open') {
    elements.push({ tag: 'hr' })
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          type: 'primary',
          text: { tag: 'plain_text', content: '提交' },
          value: { q: record.qid, i: -1, o: -1, r: record.rev ?? 0, act: 'submit' },
        },
        {
          tag: 'button',
          type: 'default',
          text: { tag: 'plain_text', content: '全部跳过' },
          value: { q: record.qid, i: -1, o: -1, r: record.rev ?? 0, act: 'skip' },
        },
      ],
    })
    elements.push({
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          // 文字兜底提示必须常驻：卡片回调链路（权限/订阅方式）没配好时，
          // 用户仍能按这个提示用纯文本答完，不必回电脑前。
          content: `也可以直接回复数字（例：${questions.length > 1 ? '1,2' : '1'}）；回复「取消」跳过本次提问。`,
        },
      ],
    })
  } else {
    elements.push({
      tag: 'note',
      elements: [
        { tag: 'plain_text', content: record?.statusText || '本次提问已结束' },
      ],
    })
  }
  const header = questions.length === 1
    ? (questions[0]?.header || '有一个问题需要你选')
    : `有 ${questions.length} 个问题需要你选`
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      template: record?.status === 'open' ? 'blue' : 'grey',
      title: { tag: 'plain_text', content: header },
    },
    elements,
  }
}

/**
 * 文字兜底：编号列表（卡片发不出去时用）。
 * @param {object} record
 * @returns {string}
 */
export function buildQuestionText(record) {
  const questions = Array.isArray(record?.questions) ? record.questions : []
  const out = ['（问题已转成文字，直接回复数字即可）']
  questions.forEach((question, qi) => {
    out.push('', questionHeading(question, qi))
    const options = Array.isArray(question?.options) ? question.options : []
    if (options.length === 0) {
      out.push('  ↳ 请直接回复文字答案')
      return
    }
    options.forEach((option, oi) => {
      const desc = option?.description ? ` —— ${option.description}` : ''
      out.push(`  ${oi + 1}) ${option?.label ?? ''}${desc}`)
    })
    if (question?.multiSelect === true) out.push('  （可多选，用逗号分隔，如 1,3）')
  })
  if (questions.length > 1) {
    out.push('', '多个问题时，按题序逐题回，例如：1,3 | 2（用 | 分隔每题；只回一个数字表示只答第一题）')
  }
  out.push('', '回复「取消」跳过本次提问。')
  return out.join('\n')
}

/** 把用户文本里的数字/标签解析成某题的选项下标集合。 */
function parseOptionTokens(rawToken, question) {
  const token = String(rawToken || '').trim()
  if (!token) return null
  const options = Array.isArray(question?.options) ? question.options : []
  // 1) 纯数字（可带 、,，空格 / 的并列表述）
  const parts = token.split(/[、,，\s/]+/).filter(Boolean)
  if (parts.length > 0 && parts.every((p) => /^\d+$/.test(p))) {
    const picked = []
    for (const p of parts) {
      const n = Number(p)
      if (!Number.isInteger(n) || n < 1 || n > options.length) return null
      if (!picked.includes(n - 1)) picked.push(n - 1)
    }
    return picked
  }
  // 2) 标签精确/前缀匹配（用户懒得回数字时）
  const hits = []
  options.forEach((option, oi) => {
    const label = String(option?.label ?? '').trim()
    if (!label) return
    if (token === label || token === `${optionGlyph(oi)}${label}` || label.startsWith(token)) hits.push(oi)
  })
  return hits.length > 0 ? hits : null
}

/**
 * 解析一条文字回复对某条待答问题的答案。
 * @param {string} text - 用户回复的纯文本。
 * @param {object} record
 * @returns {{kind:'answer'|'skip', selections:number[][], customs:string[]}|null}
 *   null = 不是这条提问的答案（照常投给会话）。
 */
export function parseQuestionReply(text, record) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const questions = Array.isArray(record?.questions) ? record.questions : []
  if (questions.length === 0) return null
  if (/^(?:取消|跳过|算了|不答了|cancel|skip)$/i.test(raw)) {
    return { kind: 'skip', selections: questions.map(() => []), customs: questions.map(() => '') }
  }

  const selections = questions.map(() => [])
  const customs = questions.map(() => '')
  // 「|」分题；单题时整条就是该题答案。
  const segments = raw.split(/[|｜]/).map((s) => s.trim())
  const optionQuestions = questions
    .map((q, qi) => ({ q, qi }))
    .filter(({ q }) => Array.isArray(q?.options) && q.options.length > 0)
  const freeQuestions = questions
    .map((q, qi) => ({ q, qi }))
    .filter(({ q }) => !Array.isArray(q?.options) || q.options.length === 0)

  let matchedAny = false
  if (segments.length > 1) {
    // 多段：先按「能解析成某题选项」的段配对（顺序配对 optionQuestions），
    // 剩下没配到选项题的段按顺序落到自由填写题。
    let cursor = 0
    const leftovers = []
    for (const seg of segments) {
      const target = optionQuestions[cursor]
      const picked = target ? parseOptionTokens(seg, target.q) : null
      if (target && picked) {
        selections[target.qi] = target.q?.multiSelect === true ? picked : picked.slice(0, 1)
        cursor += 1
        matchedAny = true
      } else {
        leftovers.push(seg)
      }
    }
    if (cursor < optionQuestions.length) return null
    if (leftovers.length > freeQuestions.length) return null
    leftovers.forEach((seg, i) => { customs[freeQuestions[i].qi] = seg })
    return matchedAny ? { kind: 'answer', selections, customs } : null
  }

  // 单选式回复
  for (const { q, qi } of optionQuestions) {
    const picked = parseOptionTokens(raw, q)
    if (!picked) continue
    const multi = q?.multiSelect === true
    selections[qi] = multi ? picked : picked.slice(0, 1)
    matchedAny = true
    break
  }
  if (!matchedAny && freeQuestions.length === 1 && optionQuestions.length === 0) {
    // 纯自由填写题：整条文本即自定义答案。
    customs[freeQuestions[0].qi] = raw
    return { kind: 'answer', selections, customs }
  }
  if (!matchedAny && freeQuestions.length > 0 && optionQuestions.length === 0) {
    // 多道自由题：按 | 段序配对
    if (segments.length === freeQuestions.length) {
      segments.forEach((seg, i) => { customs[freeQuestions[i].qi] = seg })
      return { kind: 'answer', selections, customs }
    }
    return null
  }
  return matchedAny ? { kind: 'answer', selections, customs } : null
}

/**
 * 把当前选择组装成宿主 answerer 要求的整批答案。
 * 契约（dsh-user-questions/lib/index.js:567-568）：answers 必须逐题、且每题恰好一次。
 * 未选/未填的题按宿主语义视为「已跳过」（selected 空数组、无 custom）。
 * @param {object} record
 * @returns {{answers: Array<{id:string, selected:string[], custom?:string}>}}
 */
export function composeAnswerBatch(record) {
  const questions = Array.isArray(record?.questions) ? record.questions : []
  const answers = questions.map((question, qi) => {
    const options = Array.isArray(question?.options) ? question.options : []
    const picked = (record?.selections?.[qi] ?? []).filter(
      (oi) => Number.isInteger(oi) && oi >= 0 && oi < options.length,
    )
    const selected = picked.map((oi) => String(options[oi]?.label ?? '')).filter(Boolean)
    const custom = String(record?.customs?.[qi] ?? '').trim()
    const item = { id: String(question?.id ?? ''), selected }
    if (!selected.length && custom) item.custom = custom
    return item
  })
  return { answers }
}

/** 人类可读的答案摘要（写回卡片 / 回执文本用）。 */
export function formatAnswerSummary(record) {
  const { answers } = composeAnswerBatch(record)
  return answers
    .map((answer, qi) => {
      const heading = questionHeading(record?.questions?.[qi], qi)
      const value = answer.selected.length
        ? answer.selected.join('、')
        : (answer.custom ? `${answer.custom}（自定义）` : '（跳过）')
      return `${heading} → ${value}`
    })
    .join('\n')
}

/**
 * 应用一次卡片点击：返回切换后的选择状态。
 * @param {object} record - 就地修改 selections。
 * @param {{i:number,o:number,act?:string}} value - 按钮 value。
 * @returns {{changed:boolean, submit:boolean, skip:boolean}}
 */
export function applyCardAction(record, value) {
  const qi = Number(value?.i)
  const oi = Number(value?.o)
  const act = typeof value?.act === 'string' ? value.act : ''
  if (act === 'submit') return { changed: false, submit: true, skip: false }
  if (act === 'skip') return { changed: false, submit: false, skip: true }
  const questions = Array.isArray(record?.questions) ? record.questions : []
  if (!Number.isInteger(qi) || qi < 0 || qi >= questions.length) {
    return { changed: false, submit: false, skip: false }
  }
  const options = Array.isArray(questions[qi]?.options) ? questions[qi].options : []
  if (!Number.isInteger(oi) || oi < 0 || oi >= options.length) {
    return { changed: false, submit: false, skip: false }
  }
  if (!Array.isArray(record.selections)) record.selections = questions.map(() => [])
  if (!Array.isArray(record.selections[qi])) record.selections[qi] = []
  const current = record.selections[qi]
  if (questions[qi]?.multiSelect === true) {
    const at = current.indexOf(oi)
    if (at >= 0) current.splice(at, 1)
    else current.push(oi)
  } else {
    // 单选：再点同一个 = 取消选择（回空），点别的 = 换选。
    record.selections[qi] = current.length === 1 && current[0] === oi ? [] : [oi]
  }
  record.rev = (record.rev ?? 0) + 1
  return { changed: true, submit: false, skip: false }
}

// ─── 待答问题持久化（卡片问答改造） ────────────────────────────────
//
// 落盘而不是只放内存：插件 HMR / 宿主重启后，飞书上那张还没点的卡片
// 仍然要能被点（迟到回答走 userQuestions.answer，见 feishu.js）。
// 文件：<root>/feishu/pending-questions.json，形如 { [qid]: record }。
const PENDING_QUESTIONS_FILE = 'pending-questions.json'

/** 读待答问题表；不存在返回 {}。 */
export function readPendingQuestions(root) {
  const file = join(feishuDir(root), PENDING_QUESTIONS_FILE)
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(stripBom(readFileSync(file, 'utf8')))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** 写待答问题表。 */
export function writePendingQuestions(root, table) {
  const dir = ensureFeishuDir(root)
  writeFileSync(join(dir, PENDING_QUESTIONS_FILE), JSON.stringify(table, null, 2), 'utf8')
}

/** 待答记录的有效期（毫秒）：超时后仍保留一段时间供迟到回答，之后清理。 */
export const PENDING_QUESTION_TTL_MS = 24 * 60 * 60 * 1000

/** 清理过期记录（就地返回新表）。 */
export function prunePendingQuestions(table, now = Date.now()) {
  const out = {}
  for (const [qid, record] of Object.entries(table || {})) {
    if (!record || typeof record !== 'object') continue
    if (record.status !== 'open' && record.status !== 'expired') continue
    if (typeof record.createdAt === 'number' && now - record.createdAt > PENDING_QUESTION_TTL_MS) continue
    out[qid] = record
  }
  return out
}
