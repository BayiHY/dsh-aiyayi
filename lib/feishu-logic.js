/**
 * aiyayi-feishu 的纯逻辑层（无外部依赖，测试友好）。
 *
 * 与 dsh-aiyayi 其它 lib 文件约定一致：这里只用 node 内建模块，不 import
 * 任何 @deepseek-ai 或 @larksuiteoapi 包。飞书 SDK / dsh-llm 的连接与建会话
 * 都在 feishu.js（宿主插件壳）里做，这里只放可单测的纯函数。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/** 下载消息内文件资源（file/video/audio 通用）：GET /im/v1/messages/{id}/resources/{file_key}?type=file */
export function downloadFileResource(domain, token, { messageId, fileKey }) {
  return downloadBinary(
    `${domain}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=file`,
    token,
  )
}

/** 下载图片资源（image/sticker key）：GET /im/v1/images/{image_key} */
export function downloadImageResource(domain, token, imageKey) {
  return downloadBinary(
    `${domain}/open-apis/im/v1/images/${encodeURIComponent(imageKey)}`,
    token,
  )
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
          ? await downloadImageResource(domain, token, resource.fileKey)
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
      logger?.warn?.(
        `aiyayi-feishu: 附件下载失败 msg=${messageId} file=${label}: ${reason}`,
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

/** 抽出文本里全部附件/图片标记路径（不去重不校验存在性，发送时逐个处理）。 */
export function extractAttachmentMarkers(text) {
  const files = []
  const images = []
  for (const m of String(text || '').matchAll(ATTACH_FILE_MARKER)) files.push(m[1].trim())
  for (const m of String(text || '').matchAll(ATTACH_IMAGE_MARKER)) images.push(m[1].trim())
  return { files, images }
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

/**
 * 发件编排：先把 [附件:]/[图片:] 标记逐个上传发送（SDK sender 原生 {file}/{image}），
 * 再发剥离标记后的正文。单个附件失败：warn + 剥离标记 + 正文照发，绝不阻断。
 * @param {object} channel - SDK LarkChannel（只用到 channel.sender.send）。
 * @param {string} chatId - 目标 chat。
 * @param {string} text - 含标记的回复文本。
 * @param {object} [logger] - {info, warn}（可注入 ctx.logger）。
 * @returns {Promise<{filesTotal, filesSent, imagesTotal, imagesSent, textSent, problems: string[]}>}
 */
export async function sendReplyWithAttachments(channel, chatId, text, logger) {
  const { files, images } = extractAttachmentMarkers(text)
  const cleanText = stripAttachmentMarkers(text)
  const problems = []
  const sendOne = async (label, filePath, payload) => {
    try {
      if (!existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`)
      await channel.sender.send(chatId, payload)
      logger?.info?.(`aiyayi-feishu: ${label}已发送 ${filePath} → ${chatId}`)
      return true
    } catch (error) {
      const reason = errorMessage(error)
      problems.push(`${label} ${filePath}: ${reason}`)
      logger?.warn?.(
        `aiyayi-feishu: ${label}发送失败（已剥离标记，正文照发）${filePath}: ${reason}`,
      )
      return false
    }
  }
  let filesSent = 0
  for (const filePath of files) {
    const ok = await sendOne('附件', filePath, {
      file: { source: filePath, fileName: basename(filePath) },
    })
    if (ok) filesSent += 1
  }
  let imagesSent = 0
  for (const imagePath of images) {
    const ok = await sendOne('图片', imagePath, { image: { source: imagePath } })
    if (ok) imagesSent += 1
  }
  let textSent = false
  if (cleanText) {
    await channel.sender.send(chatId, { text: cleanText })
    textSent = true
  } else if (problems.length > 0) {
    // 正文为空且附件有失败：不静默（SKILL 排障教训——静默路径零日志最阴险），
    // 回一条失败说明，用户至少知道发生了什么。
    await channel.sender.send(chatId, { text: `（附件发送失败：${problems.join('；')}）` })
  }
  logger?.info?.(
    `aiyayi-feishu: 已回发 ${chatId}（正文 ${cleanText.length} 字，附件 ${filesSent}/${files.length}，图片 ${imagesSent}/${images.length}）`,
  )
  return {
    filesTotal: files.length,
    filesSent,
    imagesTotal: images.length,
    imagesSent,
    textSent,
    problems,
  }
}
