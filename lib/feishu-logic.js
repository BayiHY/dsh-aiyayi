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

/** 读配置文件；不存在返回 null。 */
export function readConfigFile(root) {
  const file = join(feishuDir(root), CONFIG_FILE)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
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
  return JSON.parse(readFileSync(file, 'utf8'))
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
