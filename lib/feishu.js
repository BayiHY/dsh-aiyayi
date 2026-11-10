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
import { registerOwnTool } from './own-tools.js'
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
  'tools',
]

/** 本包根目录（feishu.js 在 lib/ 下，上一级就是包根）。 */
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 主入口：宿主级服务插件。
 * @param {object} ctx - Cordis 上下文。
 * @param {object} config - patch 里的 config（appId/appSecret 等）。
 */
export function apply(ctx, config) {
  const { root } = resolveRoot()
  ensureFeishuDir(root)
  const merged = mergeConfig(config, readConfigFile(root))

  // 先注册工具（即使没有凭证，aiyayi 也能用 feishu_status 自查绑定情况）。
  registerFeishuTools(ctx, root, merged)

  // 没有凭证就不启动长连接（日志提示，不报错）。
  if (!merged.appId || !merged.appSecret) {
    ctx.logger.warn(
      `aiyayi-feishu: 缺少 appId/appSecret，长连接未启动。请在记忆根 feishu/config.json 或 patch config 里配置。`,
    )
    return
  }

  const mappings = readMappings(root) // 进程内缓存 + 落盘

  const onMessage = async (mergedEvent) => {
    try {
      await onIncomingMessage(ctx, channel, mergedEvent, merged, root)
    } catch (error) {
      ctx.logger.warn(`aiyayi-feishu: 处理入站消息失败: ${String(error)}`)
    }
  }

  const channel = createLarkChannel({
    appId: merged.appId,
    appSecret: merged.appSecret,
    domain: merged.domain,
    transport: 'websocket',
    handlers: { message: onMessage },
  })
  // 坑 #58：@larksuiteoapi/node-sdk 1.76.0 的 createLarkChannel/LarkChannel 构造函数
  // 不读 opts.handlers（SDK lib/index.js:106879 只设 this.handlers={}，107359 原样 new
  // 后返回），传进去的 handlers 被整个丢弃——每条消息 ACK 后在 onMessage 处静默 no-op、
  // 零日志（飞书后台事件日志却显示 SUCCESS）。handlers.message 在派发时才读取，
  // 所以必须在返回的 channel 上显式补接线。
  channel.handlers.message = onMessage

  // 建立长连接（后台异步，握手成功后 channel.connect() 才 resolve）。
  ctx.effect(
    () => {
      channel.connect().catch((error) => {
        ctx.logger.warn(`aiyayi-feishu: 飞书长连接失败: ${String(error)}`)
      })
      return () => {
        // 防御：SDK disconnect() 在 WS 未初始化时返回 undefined（SDK 107014 行注释），
        // 直接 .catch 会 TypeError。包一层 Promise.resolve。
        Promise.resolve(channel.disconnect()).catch(() => {})
      }
    },
    'aiyayi-feishu.connect()',
  )

  // 回发：监听 host 级 session/event 总线，只处理属于已绑定会话的 assistant 消息。
  // 同一轮 turn 里 assistant/message 是渐进追加的（每个 step 一条，settle 替换），
  // 所以攒每会话最新文本，等 turn/end 才统一回发（坑 #63）；turn/start 时冲掉上一轮残留。
  const pendingReplies = new Map() // sessionId → 最新 assistant 文本
  const flushReply = (sessionId) => {
    const text = pendingReplies.get(sessionId)
    pendingReplies.delete(sessionId)
    if (!text) return
    // 每次发送前重读映射，避免 feishu_bind / 入站绑定新增后 relay 漏发。
    const chatId = reverseLookup(readMappings(root), sessionId)
    if (!chatId) return
    // 异步发送，失败只记日志。
    channel.sender.send(chatId, { text }).catch((error) => {
      ctx.logger.warn(`aiyayi-feishu: 回发 ${chatId} 失败: ${String(error)}`)
    })
  }
  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        try {
          const sessionId = session.id
          if (event.type === 'assistant/message') {
            // 坑 #62：宿主 assistant/message 事件的载荷在 event.data.message（宿主消费者
            // asar 59377/301690 行均读 event.data.message.content），event.message 不存在——
            // 之前的 role 检查恒为 false，回复永远发不出去。
            const message = event.data?.message
            if (!message) return
            const text = extractText(message)
            if (!text) return
            const chatId = reverseLookup(readMappings(root), sessionId)
            if (!chatId) return // 没绑定的会话不攒（避免内存堆积）
            pendingReplies.set(sessionId, text)
            return
          }
          if (event.type === 'turn/end') {
            flushReply(sessionId)
            return
          }
          if (event.type === 'turn/start') {
            // 上一轮若因异常没等到 turn/end，这里兜底冲掉残留。
            flushReply(sessionId)
          }
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
async function onIncomingMessage(ctx, channel, mergedEvent, merged, root) {
  const chatId = mergedEvent.chatId
  const messageId = mergedEvent.messageId
  const text = mergedEvent.content || ''
  if (!chatId) return

  const mappings = readMappings(root) // 每次重读，避免多 chat 并发写丢
  const decision = routeMessage(text, mappings, chatId)

  if (decision.action === 'route') {
    const delivered = await deliverToSession(ctx, decision.sessionId, messageId, text)
    if (delivered) return
    // 坑 #64：映射指向的会话可能已不在运行（插件 HMR/宿主重启回收、手动销毁），
    // 旧代码静默 return → 用户消息人间蒸发、零日志。这里自动新建并重新接入，
    // 把消息投进去，并告知用户。
    const newSessionId = await createAiyayiSession(ctx, merged, null, root)
    const refreshed = readMappings(root)
    refreshed[chatId] = newSessionId
    writeMappings(root, refreshed)
    await replyToChat(
      channel,
      chatId,
      messageId,
      `原会话 ${decision.sessionId} 已不在运行，已自动新建并接入 ${newSessionId}。`,
    )
    await deliverToSession(ctx, newSessionId, messageId, text)
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
  const sessionId = await createAiyayiSession(ctx, merged, decision.name, root)
  const refreshed = readMappings(root)
  refreshed[chatId] = sessionId
  writeMappings(root, refreshed)
  await replyToChat(channel, chatId, messageId, `已新建并接入 aiyayi 会话 ${sessionId}。`)
  await deliverToSession(ctx, sessionId, messageId, text)
}

/** 从 agents 注册表取 agent（null 表示不在运行）。 */
function getAgent(ctx, sessionId) {
  try {
    // 坑 #61：ctx.agents.get(id) 返回**裸 Agent**（宿主 asar 文档 375429 行：句柄 {agent}
    // 只暴露给创建它的消费方），之前 `?.agent` 恒 undefined → deliverToSession 静默丢消息。
    return ctx.get('agents').get(sessionId) ?? null
  } catch {
    return null
  }
}

/**
 * 把文本投进目标会话（跟 dsh-webhook 同一通道）。
 * @returns {Promise<boolean>} true=已投进在运行的会话。
 */
async function deliverToSession(ctx, sessionId, messageId, text) {
  const agent = getAgent(ctx, sessionId)
  if (!agent) {
    // 会话不在运行（坑 #64：可能被旧版插件 HMR abort、宿主重启回收等）。返回 false，
    // 由 route 分支自愈（自动新建并重新接入），绝不静默吞消息。
    return false
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
  return true
}

/**
 * 新建一个 aiyayi 会话（复用 dsh-webhook createWebhookSession 的建会话模板）：
 *   workspaceRegistry.create → agents.create(setup 里 mount aiyayi preset)
 *   → permissionPresets.set → sessionTitle.rename。
 * @returns {Promise<string>} sessionId。
 */
async function createAiyayiSession(ctx, merged, name, root) {
  const presetName = 'aiyayi'
  const preset = await ctx.agentPresets.resolve(presetName)
  // 坑 #60：permissionPresets.resolve(名字) 返回的是已解析对象，而 set() 要的是名字
  // 字符串（dsh-webhook 模板 set 传的就是请求里的原始名字，resolve 只作校验，返回值丢弃）。
  // 之前把 resolve 的返回对象直接传给 set → `permission: unknown preset "[object Object]"`。
  const permissionPresetName = merged.defaultPermissionPreset
  await ctx.permissionPresets.resolve(permissionPresetName)

  // workspace：用记忆根下的 feishu/workspaces/<chatId 归一化> 作为会话工作目录。
  // 坑 #59：workspaceRegistry.create 的契约是路径必须已存在（内部 realpath，不代建），
  // dsh-webhook 的 workspacePath 来自规则配置的既有目录；这里必须先建好叶子目录。
  const workspacesDir = join(root, 'feishu', 'workspaces')
  const { mkdirSync } = await import('node:fs')
  const workspacePath = join(workspacesDir, `feishu-${randomUUID()}`)
  mkdirSync(workspacePath, { recursive: true })
  const workspace = await ctx.workspaceRegistry.create(workspacePath)

  const sessionId = `feishu-${randomUUID()}`
  // 坑 #64：不再把插件生命周期 AbortController 传给 agents.create——旧做法在插件 HMR
  // 重载 dispose 时 controller.abort() 会把插件建的会话连带杀死（12:58:42 的
  // `agent "feishu-bfb53970": agent/disposed listener threw` 即死亡现场）。
  // 会话是宿主资产不是插件资产：给每会话一个从不 abort 的独立 signal。
  const sessionSignal = new AbortController().signal
  const handle = await ctx.agents.create({
    sessionId,
    signal: sessionSignal,
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
    ctx.permissionPresets.set(handle.agent.session, permissionPresetName)
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

/**
 * 注册 aiyayi 可主动调用的两个飞书工具：
 *   feishu_status —— 查当前会话/其它会话的飞书绑定情况；
 *   feishu_bind   —— 把当前会话绑定到指定飞书 chat。
 * 二者都读记忆根下 feishu/mappings.json，execute(args, exec) 里用
 * exec.agent.session.id 得知调用方会话。注册时登记进 own-tools 放行名单，
 * restrict.js 才会放行给 aiyayi。
 */
function registerFeishuTools(ctx, root, merged) {
  const tools = ctx.get('tools')
  if (!tools?.register) {
    ctx.logger.warn('aiyayi-feishu: tools 服务不可用，无法注册 feishu_status/feishu_bind。')
    return
  }

  registerOwnTool('feishu_status')
  registerOwnTool('feishu_bind')

  const configured = !!(merged.appId && merged.appSecret)

  tools.register({
    name: 'feishu_status',
    description:
      '查看当前会话以及其它 aiyayi 会话对接飞书（聊天机器人）的情况：本会话是否已绑定某个飞书 chat、有哪些其它会话已绑定、飞书长连接是否在运行。新建会话首次对话自查用。注意：没绑定时不要向用户索要 chat_id——接入主要从飞书侧自动发起（用户在飞书里给机器人发条消息即自动新建会话并接入，或发 `绑定会话 <会话名>` 接入指定会话）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(_args, exec) {
      const sessionId = exec?.agent?.session?.id ?? null
      const mappings = readMappings(root)
      // 反向：本会话绑到哪个 chat。
      let boundChat = null
      for (const [chatId, sid] of Object.entries(mappings)) {
        if (sid === sessionId) {
          boundChat = chatId
          break
        }
      }
      const otherBound = []
      for (const [chatId, sid] of Object.entries(mappings)) {
        if (sid !== sessionId) otherBound.push({ chatId, sessionId: sid })
      }
      return {
        configured,
        connected: configured, // 长连接随 apply 建立；未配置则为 false。
        sessionId,
        boundChat,
        otherBound,
        totalBound: Object.keys(mappings).length,
      }
    },
  })

  tools.register({
    name: 'feishu_bind',
    description:
      '把当前 aiyayi 会话绑定到指定飞书 chat，使该飞书对话的消息都路由到这个会话、回复也发回那个 chat。传 chatId（飞书会话的 oc_ 开头的 chat_id）。通常只在用户明确给了某个 chat_id、或飞书侧已接入你想反向指定时才用；大多数接入从飞书侧自动发起，用户无需提供 chat_id。',
    parameters: {
      type: 'object',
      properties: {
        chatId: {
          type: 'string',
          description: '要绑定的飞书 chat_id（oc_ 开头）。',
        },
      },
      required: ['chatId'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.session?.id ?? null
      const chatId = args.chatId
      if (!chatId) {
        return { ok: false, error: '缺少 chatId 参数。' }
      }
      const mappings = readMappings(root)
      mappings[chatId] = sessionId
      writeMappings(root, mappings)
      return { ok: true, chatId, sessionId, bound: true }
    },
  })
}

