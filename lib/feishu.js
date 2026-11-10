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
  clearPendingBind,
  ensureFeishuDir,
  extractText,
  markGuided,
  matchOnboardIntent,
  matchSkipIntent,
  mergeConfig,
  readConfigFile,
  readGuided,
  readMappings,
  readPendingBind,
  reverseLookup,
  routeMessage,
  writeMappings,
  writePendingBind,
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
  // 坑 #67：建会话要照 webhook 模板取默认模型选择，缺了建出的会话可能没有模型。
  'agentDefaultModel',
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

  // 改造 2+3：会话侧接入引导（与长连接无关——无凭证也注册：用户仍可表达「要接入」，
  // pending 落盘，等凭证配好后由 bot_p2p_chat_entered_v1 完成绑定）。
  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        try {
          if (event.type === 'agent/inbox/spliced') {
            maybeOnboardIntent(ctx, root, session, event)
            return
          }
          if (event.type === 'turn/end') {
            maybeGuideNewSession(ctx, root, session)
          }
        } catch (error) {
          ctx.logger.warn(`aiyayi-feishu: 接入引导处理失败: ${String(error)}`)
        }
      }),
    'aiyayi-feishu.onboard-guide()',
  )

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

  // 改造 1：用户进入与 bot 的 P2P 单聊事件（im.chat.access_event.bot_p2p_chat_entered_v1，
  // 权限要求=无，事件体含 chat_id + operator_id open_id）。SDK 长连接默认只订阅
  // im.message.receive_v1 / card.action.trigger / reaction / bot.added / drive.notice，
  // 不在默认列表里——直接向 channel.dispatcher 补注册（SDK EventDispatcher.register
  // 幂等；connect() 时 registerDispatcherHandlers 只注册固定类型，不会覆盖我们的 key）。
  // 有待接入目标会话（pending-bind.json）→ 自动写 mappings[chat_id]=目标 sessionId
  // 并清除待接入标记、回复确认；无待接入目标 → 仅记录不绑定。
  channel.dispatcher.register({
    'im.chat.access_event.bot_p2p_chat_entered_v1': async (raw) => {
      try {
        const chatId = raw?.event?.chat_id
        if (!chatId) return
        const pending = readPendingBind(root)
        if (!pending?.sessionId) {
          ctx.logger.info(`aiyayi-feishu: 用户进入单聊 chat=${chatId}（无待接入目标，仅记录）`)
          return
        }
        // 时效：待接入目标超过 PENDING_BIND_TTL_MS 视为过期，清除后不自动绑定。
        if (Date.now() - (pending.createdAt || 0) > PENDING_BIND_TTL_MS) {
          clearPendingBind(root)
          ctx.logger.info(
            `aiyayi-feishu: 待接入目标已过期（会话 ${pending.sessionId}），清除，不自动绑定 chat=${chatId}`,
          )
          return
        }
        const refreshed = readMappings(root)
        refreshed[chatId] = pending.sessionId
        writeMappings(root, refreshed)
        clearPendingBind(root)
        ctx.logger.info(
          `aiyayi-feishu: 用户进入单聊 chat=${chatId}，已自动接入会话 ${pending.sessionId}`,
        )
        await replyToChat(
          channel,
          chatId,
          null,
          `已自动接入 aiyayi 会话 ${pending.sessionId}，现在可以直接在手机飞书上找我啦。`,
        )
      } catch (error) {
        ctx.logger.warn(`aiyayi-feishu: bot_p2p_chat_entered_v1 处理失败: ${String(error)}`)
      }
    },
  })

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
    // 异步发送，失败只记日志。成功也记一条（排障时能直接确认回发闭环）。
    channel.sender
      .send(chatId, { text })
      .then(() => {
        ctx.logger.info(
          `aiyayi-feishu: 已回发 ${chatId}（${text.length} 字）`,
        )
      })
      .catch((error) => {
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

  // 坑 #66：机器人自己发出的消息也会以 im.message.receive_v1 推回来（同样进 handler），
  // 若不跳过就会把「已新建并接入…」「正式回答」当成用户输入再喂给会话 → 自问自答死循环。
  // 判据：normalize 出的 senderId 与机器人自身 open_id 相同（LarkChannel.botIdentity 在
  // connect() 时由 fetchBotIdentity 填充；SDK 未公开 getter，直接读实例字段）。
  const botOpenId = channel.botIdentity?.openId ?? null
  if (botOpenId && mergedEvent.senderId === botOpenId) {
    ctx.logger.info(`aiyayi-feishu: 跳过机器人自身消息 ${messageId}`)
    return
  }
  // 入站痕迹：排障时能直接确认「帧到达 + 路由决策」。
  ctx.logger.info(
    `aiyayi-feishu: 收到消息 chat=${chatId} msg=${messageId} type=${mergedEvent.rawContentType ?? '?'} text=${JSON.stringify((text || '').slice(0, 40))}`,
  )

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
      // 坑 #65：宿主 Session.append 用 snapshotJsonValue 深拷贝事件数据，遇到
      // undefined 直接判「non-JSON-serializable」抛错（asar 1976372-1976373：
      // walkJsonValue 对非 null/boolean/string/number/object 一律 return undefined）。
      // 旧代码写了 `senderId: undefined` → 每条消息投递都失败于
      // `session event "agent/inbox/spliced" carries non-JSON-serializable data`，
      // 这正是 13:08:54 / 13:09:03 两条测试消息的具体报错。
      // 修法：source 里不得出现 undefined 字段；并采用 MessageSourceMap 里最简单、
      // 类型完全合法的取值 `{ kind: 'user' }`（宿主自建用户消息同款，asar 18310265）。
      // 不用 webhook 形状：它要求 source 是 branded WebhookSourceId，普通字符串可能不合规。
      source: { kind: 'user' },
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
  // 坑 #67：宿主 webhook 模板在未显式指定 model 时会取 ctx.agentDefaultModel
  // .currentSelection() 作为 agentOptions（asar 2187436-2187439）；插件原来传空
  // agentOptions:{}，agent 可能没有可用模型 → 会话能建、模板回复能发，但永远产不出
  // 正式回答（正是"只收到已接入提示、没有正文"的症状）。这里照模板取默认选择。
  let agentOptions = {}
  try {
    const selection = ctx.agentDefaultModel?.currentSelection?.()
    if (selection && typeof selection === 'object') agentOptions = { ...selection }
  } catch (error) {
    ctx.logger.warn(`aiyayi-feishu: 取默认模型失败（用宿主默认）: ${String(error)}`)
  }
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
    agentOptions,
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

/**
 * 注入引导文本的隐藏前缀（零宽字符，GUI 里几乎不可见）。用来区分「插件注入的
 * 消息」与真实用户消息：注入文本走 agent.followup 追加，同样会触发
 * agent/inbox/spliced 事件，检测函数据此跳过，避免「注入→再检测→再注入」自触发。
 */
const GUIDE_PREFIX = '\u2060'
/** 待接入目标有效时长（毫秒）：超时后用户进入单聊不再自动绑定。 */
const PENDING_BIND_TTL_MS = 30 * 60 * 1000

/** 已引导会话的进程内缓存（避免每次 turn/end 读盘；HMR 重建后惰性重载）。 */
let guidedLoaded = false
const guidedSet = new Set()
function loadGuided(root) {
  if (guidedLoaded) return
  for (const id of readGuided(root)) guidedSet.add(id)
  guidedLoaded = true
}

/**
 * 改造 3：检测 GUI 会话内「要接入/接飞书」「不用/跳过」话术。
 * 挂点：agent/inbox/spliced 事件（用户消息追加进 inbox 时同步发出，claim 之前）。
 *  - 匹配接入意图 → 写 pending-bind.json（sessionId+createdAt）→ 注入确认与扫码步骤
 *    （markGuided，之后不再自动引导）。
 *  - 匹配「不用/跳过」→ 清除待接入目标 + markGuided → 注入一句确认。
 * 插件自己注入的引导文本（GUIDE_PREFIX 开头）跳过，防自触发循环。
 */
async function maybeOnboardIntent(ctx, root, session, event) {
  const inserted = event.data?.inserted
  if (!Array.isArray(inserted) || inserted.length === 0) return
  const sessionId = session.id
  for (const message of inserted) {
    if (!message || message.source?.kind !== 'user') continue
    const text = extractText(message)
    if (!text || text.startsWith(GUIDE_PREFIX)) continue
    if (matchSkipIntent(text)) {
      if (readPendingBind(root)) {
        clearPendingBind(root)
        ctx.logger.info(`aiyayi-feishu: 会话 ${sessionId} 放弃接入，已清除待接入目标`)
      }
      markGuided(root, sessionId)
      await deliverToSession(
        ctx,
        sessionId,
        null,
        `${GUIDE_PREFIX}好的，不接入也没关系。需要时随时说「接入飞书」，我会再给你扫码步骤。`,
      )
      return
    }
    if (matchOnboardIntent(text)) {
      writePendingBind(root, { sessionId, createdAt: Date.now() })
      markGuided(root, sessionId)
      ctx.logger.info(`aiyayi-feishu: 会话 ${sessionId} 请求接入飞书，已记待接入目标`)
      await deliverToSession(
        ctx,
        sessionId,
        null,
        `${GUIDE_PREFIX}已记录接入目标，现在只差最后一步。请在手机上安装飞书 app（各大应用商店可下载），然后：1) 在 open.feishu.cn 扫码登录后打开机器人页面；2) 或在飞书 app 内直接搜索机器人名称发起单聊；3) 进入与机器人的单聊即自动接入本会话，之后随时可在手机飞书找我。如不想接入，回复「不用」跳过。`,
      )
      return
    }
  }
}

/**
 * 改造 2：未绑定飞书 chat 的新会话，首轮回复结束后紧跟一条接入引导。
 * 宿主没有「回复前拦截/改写」API，插件对会话唯一的注入通道是 deliverToSession
 * （agent.followup 追加一条用户消息，agent 下一轮自然回复）——所以挂 turn/end，
 * 效果是首条回复后紧跟引导，而不是回复前。
 * 只提示一次（guided 落盘 + 进程内缓存），已绑定 chat / 已引导过的会话跳过。
 */
async function maybeGuideNewSession(ctx, root, session) {
  const sessionId = session.id
  loadGuided(root)
  if (guidedSet.has(sessionId)) return
  const chatId = reverseLookup(readMappings(root), sessionId)
  if (chatId) return // 已绑定，跳过
  markGuided(root, sessionId)
  guidedSet.add(sessionId)
  ctx.logger.info(`aiyayi-feishu: 会话 ${sessionId} 未绑定飞书，注入接入引导`)
  await deliverToSession(
    ctx,
    sessionId,
    null,
    `${GUIDE_PREFIX}（提示）本会话还没接入飞书聊天机器人。建议接入，这样在手机上也能随时找我：先在手机安装飞书 app（各大应用商店可下载），然后在 open.feishu.cn 扫码找到机器人，或直接在飞书里搜索机器人名称发起单聊——进入与机器人的单聊即自动接入本会话。如果不需要，回复「不用」即可跳过，我不会再提示。`,
  )
}

