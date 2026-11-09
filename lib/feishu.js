/**
 * aiyayi-feishu — 阿依娅伊的飞书桥接（宿主级服务插件）。
 *
 * 把飞书对话双向接进 aiyayi 会话：
 *  收：飞书长连接（WebSocket）收到 `im.message.receive_v1`，按自然语言指令
 *      决定绑到哪个 aiyayi 会话（指定/新建），映射持久化（chat_id → sessionId），
 *      消息经 `agent.followup(createUserMessage(...))` 投进会话。
 *  发：监听 `session/event` 总线上属于已绑定会话的 `assistant/message`，
 *      取最终文本，用飞书 `im/v1/messages` 发回对应 chat。
 *
 * 这是跨会话的宿主级服务，不塞进任何 agent preset。配置文件与映射都落在
 * aiyayi 记忆根下 feishu/ 子目录（配置含 appId/appSecret，不入 git）。
 *
 * 依赖：@larksuiteoapi/node-sdk（长连接）+ @deepseek-ai/dsh-llm（createUserMessage），
 * 与 dsh-mnemon 同类，允许运行时解析 @deepseek-ai（宿主已提供该包）。
 * 纯逻辑（路由/映射/文本抽取）在 feishu-logic.js，本文件只做连接与建会话。
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createLarkChannel } from '@larksuiteoapi/node-sdk'
import { resolveRoot } from './home.js'
import {
  ensureFeishuDir,
  extractText,
  mergeConfig,
  readConfigFile,
  readMappings,
  reverseLookup,
  routeMessage,
  writeMappings,
} from './feishu-logic.js'

/** Loader 身份。 */
export const name = 'aiyayi-feishu'

/** 需要的宿主服务（与 dsh-webhook 的 WebhookRuntime 同一批）。 */
export const inject = [
  'agents',
  'agentPresets',
  'permissionPresets',
  'sessionTitle',
  'workspaceRegistry',
]

/** 本包根目录（feishu.js 在 lib/ 下，上一级就是包根）。 */
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 主入口：宿主级服务插件。
 * @param {object} ctx - Cordis 上下文。
 * @param {object} config - patch 里的 config（appId/appSecret 等）。
 */
export function apply(ctx, config) {
  const root = resolveRoot()
  ensureFeishuDir(root)
  const merged = mergeConfig(config, readConfigFile(root))

  // 没有凭证就不启动长连接（日志提示，不报错）。
  if (!merged.appId || !merged.appSecret) {
    ctx.logger.warn(
      `aiyayi-feishu: 缺少 appId/appSecret，长连接未启动。请在记忆根 feishu/config.json 或 patch config 里配置。`,
    )
    return
  }

  const mappings = readMappings(root) // 进程内缓存 + 落盘
  // 插件生命周期取消信号：建会话时传给 agents.create（同 dsh-webhook 的 controller.signal）。
  const controller = new AbortController()
  ctx.effect(
    () => () => {
      controller.abort()
    },
    'aiyayi-feishu.abort()',
  )

  const channel = createLarkChannel({
    appId: merged.appId,
    appSecret: merged.appSecret,
    domain: merged.domain,
    transport: 'websocket',
    handlers: {
      message: async (mergedEvent) => {
        try {
          await onIncomingMessage(ctx, channel, mergedEvent, merged, root, controller)
        } catch (error) {
          ctx.logger.warn(`aiyayi-feishu: 处理入站消息失败: ${String(error)}`)
        }
      },
    },
  })

  // 建立长连接（后台异步，握手成功后 channel.connect() 才 resolve）。
  ctx.effect(
    () => {
      channel.connect().catch((error) => {
        ctx.logger.warn(`aiyayi-feishu: 飞书长连接失败: ${String(error)}`)
      })
      return () => {
        channel.disconnect().catch(() => {})
      }
    },
    'aiyayi-feishu.connect()',
  )

  // 回发：监听 host 级 session/event 总线，只处理属于已绑定会话的 assistant 消息。
  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        try {
          if (event.type !== 'assistant/message') return
          const chatId = reverseLookup(mappings, session.id)
          if (!chatId) return
          if (event.message?.role !== 'assistant') return
          const text = extractText(event.message)
          if (!text) return
          // 异步发送，失败只记日志。
          channel.sender.send(chatId, { text }).catch((error) => {
            ctx.logger.warn(`aiyayi-feishu: 回发 ${chatId} 失败: ${String(error)}`)
          })
        } catch (error) {
          ctx.logger.warn(`aiyayi-feishu: session/event 处理失败: ${String(error)}`)
        }
      }),
    'aiyayi-feishu.reply-relay()',
  )

  ctx.logger.info(
    `aiyayi-feishu: 已就绪，记忆根 ${root}（已绑定 ${Object.keys(mappings).length} 个 chat）`,
  )
}

/**
 * 收一条入站消息：按自然语言指令决定绑定/新建/投递。
 */
async function onIncomingMessage(ctx, channel, mergedEvent, merged, root, controller) {
  const chatId = mergedEvent.chatId
  const messageId = mergedEvent.messageId
  const text = mergedEvent.content || ''
  if (!chatId) return

  const mappings = readMappings(root) // 每次重读，避免多 chat 并发写丢
  const decision = routeMessage(text, mappings, chatId)

  if (decision.action === 'route') {
    await deliverToSession(ctx, decision.sessionId, messageId, text)
    return
  }

  if (decision.action === 'bind') {
    const sessionId = decision.sessionId
    // 校验会话存在（agents 注册表里查得到才算数）。
    const agent = getAgent(ctx, sessionId)
    if (!agent) {
      await replyToChat(channel, chatId, messageId, `没有找到会话 ${sessionId}（可能未在运行）。`)
      return
    }
    mappings[chatId] = sessionId
    writeMappings(root, mappings)
    await replyToChat(channel, chatId, messageId, `已把本对话接入会话 ${sessionId}。`)
    return
  }

  // action === 'new'：新建 aiyayi 会话并自动接入，然后把本条消息投进去。
  const sessionId = await createAiyayiSession(ctx, merged, decision.name, root, controller)
  const refreshed = readMappings(root)
  refreshed[chatId] = sessionId
  writeMappings(root, refreshed)
  await replyToChat(channel, chatId, messageId, `已新建并接入 aiyayi 会话 ${sessionId}。`)
  await deliverToSession(ctx, sessionId, messageId, text)
}

/** 从 agents 注册表取 agent（null 表示不在运行）。 */
function getAgent(ctx, sessionId) {
  try {
    return ctx.get('agents').get(sessionId)?.agent ?? null
  } catch {
    return null
  }
}

/** 把文本投进目标会话（跟 dsh-webhook 同一通道）。 */
async function deliverToSession(ctx, sessionId, messageId, text) {
  const agent = getAgent(ctx, sessionId)
  if (!agent) {
    // 会话不在运行：静默（或可扩展为自动 resume；当前先不投）。
    return
  }
  await agent.followup(
    createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: 'feishu',
        provider: 'feishu',
        messageId,
        senderId: undefined,
      },
    }),
  )
}

/**
 * 新建一个 aiyayi 会话（复用 dsh-webhook createWebhookSession 的建会话模板）：
 *   workspaceRegistry.create → agents.create(setup 里 mount aiyayi preset)
 *   → permissionPresets.set → sessionTitle.rename。
 * @returns {Promise<string>} sessionId。
 */
async function createAiyayiSession(ctx, merged, name, root, controller) {
  const presetName = 'aiyayi'
  const preset = await ctx.agentPresets.resolve(presetName)
  const permissionPreset = await ctx.permissionPresets.resolve(
    merged.defaultPermissionPreset,
  )

  // workspace：用记忆根下的 feishu/workspaces/<chatId 归一化> 作为会话工作目录。
  const workspacesDir = join(root, 'feishu', 'workspaces')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(workspacesDir, { recursive: true })
  const workspacePath = join(workspacesDir, `feishu-${randomUUID()}`)
  const workspace = await ctx.workspaceRegistry.create(workspacePath)

  const sessionId = `feishu-${randomUUID()}`
  const handle = await ctx.agents.create({
    sessionId,
    signal: controller.signal,
    meta: {
      cwd: workspace.path,
      agentPreset: preset.id,
    },
    agentOptions: {},
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx, preset.id)
    },
  })

  try {
    await workspace.attachSession(sessionId)
    ctx.permissionPresets.set(handle.agent.session, permissionPreset)
    if (name) ctx.sessionTitle.rename(handle.agent.session, name)
  } catch (error) {
    // 回滚：尽力 detach + dispose。
    try {
      await workspace.detachSession?.(sessionId)
      await workspace.dispose?.()
    } catch {}
    throw error
  }

  return sessionId
}

/** 回一条普通文本到 chat。 */
async function replyToChat(channel, chatId, messageId, text) {
  const opts = {}
  if (messageId) opts.replyTo = messageId
  await channel.sender.send(chatId, { text }, opts)
}

/** 版本号：package.json 现读。 */
export function feishuVersion() {
  const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
  return pkg.version
}
