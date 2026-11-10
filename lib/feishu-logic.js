/**
 * aiyayi-feishu 的纯逻辑层（无外部依赖，测试友好）。
 *
 * 与 dsh-aiyayi 其它 lib 文件约定一致：这里只用 node 内建模块，不 import
 * 任何 @deepseek-ai 或 @larksuiteoapi 包。飞书 SDK / dsh-llm 的连接与建会话
 * 都在 feishu.js（宿主插件壳）里做，这里只放可单测的纯函数。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
 *      chat 无映射   → { action: 'new', name: null }（默认新建并自动接入）
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
 * 检测「要接入飞书」类意图（GUI 会话内用户主动表达）。
 * 匹配：接入飞书 / 飞书接入 / 绑定飞书 / 飞书绑定 / 接飞书 / 连飞书 / 接上飞书 /
 * 开通飞书 / 加飞书 / 接入机器人 等（大小写不敏感）。不带「飞书」二字的
 * 「接入」不匹配，避免命中注入引导文本里的普通措辞。
 */
export function matchOnboardIntent(text) {
  return /(?:接入飞书|飞书接入|绑定飞书|飞书绑定|接飞书|连飞书|接上飞书|开通飞书|加飞书|添加飞书|接入机器人|绑定机器人)/i.test(
    text || '',
  )
}

/** 检测「不用/跳过」类意图（放弃接入）。 */
export function matchSkipIntent(text) {
  return /^(?:不用|不需要|不接|算了|跳过|暂时不用|先不用)/i.test((text || '').trim())
}

/** 去掉 UTF-8 BOM（\uFEFF 或 EF BB BF）。 */
function stripBom(text) {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1)
  return text
}
