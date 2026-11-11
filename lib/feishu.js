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
 * 1.5.19：发件按扩展名分流——图片（jpg/jpeg/png/gif/bmp/webp/heic/ico/tif/tiff，
 * 大小写不敏感）走 SDK `{ image }`（先 POST /im/v1/images 拿 image_key，再发
 * msg_type=image，客户端直接显示成图）；其余一律 `{ file }`；图片上传/发送失败
 * 自动降级成文件发，不丢附件。混合附件按正文标记的原始顺序逐条发。
 * 1.5.18：飞书消息附件收发——收件按 SDK mergedEvent.resources 分支下载落盘
 * （详情接口兜底），投递文本并入保存/失败提示；发件支持 `[附件: 路径]`/
 * `[图片: 路径]` 标记（SDK OutboundSender 原生 {file}/{image}）。纯逻辑
 * （resources 归一化/下载编排/标记解析/回发编排）都在 feishu-logic.js。
 *
 * 这是跨会话的宿主级服务，不塞进任何 agent preset。配置文件与映射都落在
 * aiyayi 记忆根下 feishu/ 子目录（配置含 appId/appSecret，不入 git）。
 *
 * 依赖：@larksuiteoapi/node-sdk（长连接）+ @deepseek-ai/dsh-llm（createUserMessage），
 * 与 dsh-mnemon 同类，允许运行时解析 @deepseek-ai（宿主已提供该包）。
 * 纯逻辑（路由/映射/文本抽取/附件收发编排）在 feishu-logic.js，本文件只做连接与建会话。
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
  applyCardAction,
  buildQuestionCard,
  buildQuestionText,
  clearPendingBind,
  collectIncomingAttachments,
  composeAnswerBatch,
  composeDeliveryText,
  createTokenManager,
  ensureFeishuDir,
  extractText,
  formatAnswerSummary,
  markGuided,
  matchOnboardIntent,
  matchSkipIntent,
  mergeConfig,
  parseQuestionReply,
  prunePendingQuestions,
  readConfigFile,
  readGuided,
  readMappings,
  readPendingBind,
  readPendingQuestions,
  reverseLookup,
  routeMessage,
  sendReplyWithAttachments,
  writeMappings,
  writePendingBind,
  writePendingQuestions,
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
 * 坑 #68（2026-11-10 致命崩溃）：宿主 dsh-session 的 append 有重入保护——
 * 一次 publish 尚未结束时，任何新的 Session.append 都会抛
 * `session append cannot reenter while another append is being published`，
 * 宿主把这个错误升级为 fatal load failure、进程直接退出码 1。
 *
 * 触发链：turn/end 事件就发在宿主「本回合 append 发布完成」的收尾处；插件 effect 回调里
 * 同步/重入式地 `await agent.followup(...)`（= ReactLoopInbox.splice → mutate → 又一次
 * Session.append）→ 宿主 publish 尚未收尾时重入 append → 抛错。同理 agent/inbox/spliced
 * 也走 append，onboard 意图注入（maybeOnboardIntent）有相同风险。
 *
 * 两个修法结合（缺一不可）：
 *  1) `await yieldHostPublication()`——投递前让出宏任务，跳出宿主当前 publish 窗口；
 *  2) `safeDeliverToSession()` 包一层 catch——即使 append 再次失败（比如宿主又进了
 *     新一轮 publish），rejection 也不能逃逸成宿主 fatal（原代码 fire-and-forget 没 catch，
 *     unhandled rejection 沿 effect 回调链传播 → 宿主 fatal load failure）。
 * 注入是纯提示类文本，失败只记日志，不影响主流程。
 */
async function yieldHostPublication() {
  // 微任务 + 一个短宏任务，确保宿主的 publish 宏任务链已经收尾。
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** deliverToSession 的「失败不逃逸」包装：任何 append 错误就地 catch，只记日志。 */
async function safeDeliverToSession(ctx, root, sessionId, messageId, text) {
  try {
    await yieldHostPublication()
    await deliverToSession(ctx, sessionId, messageId, text)
  } catch (error) {
    ctx.logger.warn(
      `aiyayi-feishu: 消息投递失败（宿主 append 可能仍在发布，已跳过）: ${String(error)}`,
    )
  }
}

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
          rememberSubagentSession(session) // 1.5.18-fix：子会话登记，供 pending 读侧校验。
          if (event.type === 'agent/inbox/spliced') {
            // 坑 #68：async 函数结果必须 .catch 掉（原 fire-and-forget 无 catch，
            // 内部 await 抛错 → unhandled rejection 沿 effect 回调传播 → 宿主 fatal）。
            maybeOnboardIntent(ctx, root, session, event).catch((error) => {
              ctx.logger.warn(`aiyayi-feishu: 接入意图处理失败: ${String(error)}`)
            })
            return
          }
          if (event.type === 'turn/end') {
            // 坑 #68：同上，且内部已包 yieldHostPublication + safeDeliverToSession。
            maybeGuideNewSession(ctx, root, session).catch((error) => {
              ctx.logger.warn(`aiyayi-feishu: 接入引导处理失败: ${String(error)}`)
            })
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

  // 1.5.18 附件收发：tenant_access_token 管理器（收件下载/详情兜底共用，进程内缓存
  // 到过期前 60s；fetch 用 Node 内建，凭证不落日志）。
  const getTenantAccessToken = createTokenManager(merged)

  const onMessage = async (mergedEvent) => {
    try {
      await onIncomingMessage(ctx, channel, mergedEvent, merged, root, getTenantAccessToken)
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
  // 卡片按钮点击：SDK 的长连接默认已注册 `card.action.trigger`（SDK lib/index.js:107291），
  // 但派发只在 `handlers.cardAction` 存在时才真正调业务（107297-107299），
  // 且构造参数里的 handlers 会被丢弃（见上一条坑 #58 同源，106879）。所以显式挂。
  channel.handlers.cardAction = async (event) => {
    try {
      await onCardAction(ctx, channel, event, root)
    } catch (error) {
      ctx.logger.warn(`aiyayi-feishu: 卡片点击处理失败: ${String(error)}`)
    }
  }

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
        // 1.5.18-fix：待接入目标若指向子智能体，丢弃并清标记。
        // 否则真人 chat 会被绑到一个跑完即休眠的 worker，之后每条飞书消息都投进死会话。
        if (subagentSessions.has(pending.sessionId)) {
          clearPendingBind(root)
          ctx.logger.warn(
            `aiyayi-feishu: 待接入目标 ${pending.sessionId} 是子智能体，已丢弃，不绑定 chat=${chatId}`,
          )
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

  // 1.5.19 卡片问答：把自己挂到宿主的 user-questions waterfall 上。
  // 宿主的契约（asar dsh-user-questions/lib/index.js:709-712）：
  //   ctx.waterfall(scopeTarget(agent, agent), 'user-questions/request', request, noAnswerer)
  // 监听者拿到 (request, next)，返回答案即「认领」，调 next() 表示交给下游
  // （桌面 GUI 的 answerer 在 dsh-client-ui-user-questions ：asar .../lib/client.js:2277）。
  // 所以这里必须排在 GUI 前面才能抢到——用 prepend。
  registerQuestionAnswerer(ctx, channel, root)

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
    // 1.5.18/1.5.19：回发支持 [附件: <路径>] / [图片: <路径>] 标记——逐条按扩展名
    // 分流（图片→msg_type=image，其他→file，失败降级），再发剥离标记后的正文
    // （编排见 feishu-logic.sendReplyWithAttachments）。
    // 异步发送，失败只记日志（编排内逐项 info/warn，排障能直接确认回发闭环）。
    sendReplyWithAttachments(channel, chatId, text, ctx.logger).catch((error) => {
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
            // 坑 #72：模型分段输出时首尾片段常带 \n，extractText 原样拼出首行/尾行空行，
            // 飞书卡片里就看到正文上下多出空行（无附件标记的路径最明显）。
            // 这里 trim 掉首尾空白（只动首尾，中间空行原样保留）。
            const text = extractText(message).trim()
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
 * 1.5.18-fix：已知的子会话 id（检索员 / 执行体）。session/event 里被动收集——
 * 会话一旦发过任何事件就登记进来，供 pending-bind 读侧校验使用。
 * 上限 256 条，超出丢最旧（Map 保持插入序），防长期运行无界增长。
 */
const MAX_SUBAGENT_IDS = 256
const subagentSessions = new Map()
function rememberSubagentSession(session) {
  const header = session?.header ?? {}
  const isChild = header.origin === 'subagent' || typeof header.parentSession === 'string'
  const id = session?.id ?? header.id
  if (!isChild || !id) return
  if (subagentSessions.has(id)) subagentSessions.delete(id) // 重新插入 → 变最新
  subagentSessions.set(id, true)
  if (subagentSessions.size > MAX_SUBAGENT_IDS) {
    const oldest = subagentSessions.keys().next().value
    if (oldest !== undefined) subagentSessions.delete(oldest)
  }
}

/**
 * 子智能体不是「对话对象」：它没有真人体感，给它注入接入引导只会污染它的上下文，
 * 把它的 pending-bind 绑到真人 chat 更会把整个聊天投进一个跑完即休眠的 worker。
 * 判据与 lib/presence.js:133 / :292 保持一致。
 * @param {object} session - session/event 广播的会话对象（带 header）。
 * @returns {boolean}
 */
function isSubagentSession(session) {
  const header = session?.header ?? {}
  return header.origin === 'subagent' || typeof header.parentSession === 'string'
}

/**
 * 收一条入站消息：按自然语言指令决定绑定/新建/投递。
 * 1.5.18：非 bind 分支先做附件收集下载（bind 只写映射不投递，无需下载），
 * 保存/失败提示并进投递文本；下载失败不阻断消息投递。
 */
async function onIncomingMessage(ctx, channel, mergedEvent, merged, root, getTenantAccessToken) {
  const chatId = mergedEvent.chatId
  const messageId = mergedEvent.messageId
  const rawText = mergedEvent.content || ''
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
    `aiyayi-feishu: 收到消息 chat=${chatId} msg=${messageId} type=${mergedEvent.rawContentType ?? '?'} text=${JSON.stringify((rawText || '').slice(0, 40))}`,
  )

  // 1.5.19 卡片问答：有待答提问时，先尝试把这条消息当成「文字答案」消费。
  // 必须排在路由之前——否则用户回的「2」会被当普通消息投给会话，提问永远等不到答案。
  // 解析不出答案（普通聊天正文）时返回 false，照常走路由，行为与 1.5.18 一致。
  try {
    const consumed = await tryAnswerByText(ctx, channel, root, chatId, messageId, rawText)
    if (consumed) return
  } catch (error) {
    ctx.logger.warn(`aiyayi-feishu: 文字回答处理失败（继续按普通消息投递）: ${String(error)}`)
  }

  const mappings = readMappings(root) // 每次重读，避免多 chat 并发写丢
  const decision = routeMessage(rawText, mappings, chatId)

  // 1.5.18 附件收件：非 bind 分支收集下载附件，把结果并进投递文本。
  // 单文件失败只追加失败括注不阻断（collectIncomingAttachments 内部消化）；
  // 这里再兜一层整体异常，保证附件链路的任何意外都不影响纯文本投递。
  let attach = null
  if (decision.action !== 'bind') {
    try {
      attach = await collectIncomingAttachments({
        logger: ctx.logger,
        mergedEvent,
        root,
        domain: merged.domain,
        getTenantAccessToken,
      })
    } catch (error) {
      ctx.logger.warn(`aiyayi-feishu: 附件处理异常（已降级为纯文本投递）: ${String(error)}`)
    }
  }
  // 空文本消息不再投空块：composeDeliveryText 在全空时给有意义的占位提示。
  const deliveryText = composeDeliveryText(rawText, attach, messageId)

  if (decision.action === 'route') {
    const delivered = await deliverToSession(ctx, decision.sessionId, messageId, deliveryText)
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
    await deliverToSession(ctx, newSessionId, messageId, deliveryText)
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
  await deliverToSession(ctx, sessionId, messageId, deliveryText)
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
  // 重载 dispose 时 controller.abort() 会把插件建的会话连带杀死（12:58:42 日志
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

// ═══════════════════════════════════════════════════════════════════
// 1.5.19 ask_user_question → 飞书交互卡片
//
// 宿主契约（全部实证，见 asar）：
//  · 工具定义：@deepseek-ai/dsh-tool-ask-user/lib/index.js:66-201（timed 模式）
//    与 223-321（legacy 阻塞模式）；两条路径最终都进 ctx.userQuestions.ask(...)。
//  · 服务：@deepseek-ai/dsh-user-questions/lib/index.js
//      ask()        :676-719   → ctx.waterfall(scopeTarget(agent, agent), 'user-questions/request', …)
//      askTimed()   :621-659   → 同上，多一个 wait {callId, timed:true} 与前台倒计时
//      answer()     :560-596   → 迟到回答的官方入口，只接受 continued 状态的 callId
//      continued()  :544-546
//  · 请求形状：{questions:[{id,question,detail?,header?,options?:[{label,description?}],multiSelect?}],
//               agent?, signal, wait?:{callId, timed?} }
//  · 答案形状：{answers:[{id, selected:string[], custom?:string}]}，必须每题恰好一次（:567-568）。
//  · 转发到桌面端：@deepseek-ai/dsh-api-remotes/lib/index.js:144-146 把
//    'user-questions/request' 以 waterfall 模式转发给 Client；桌面端在那条链上
//    用 dsh-client-ui-user-questions/lib/client.js:2277 挂 GUI 卡片。
//    因此本插件必须在同一条 waterfall 上抢在前面认领（ctx.on + prepend）。
// ═══════════════════════════════════════════════════════════════════

/** 卡片问答总开关的环境变量名（默认开；置 '0' 关）。 */
const CARD_SWITCH_ENV = 'AIYAYI_FEISHU_CARDS'
/** 阻塞式提问的本地等待上限（秒）；环境变量 AIYAYI_FEISHU_CARD_TIMEOUT 覆盖，默认 600。 */
const CARD_TIMEOUT_ENV = 'AIYAYI_FEISHU_CARD_TIMEOUT'

/** 读阻塞式提问的本地等待上限（毫秒）；0 = 不限。 */
function blockingTimeoutMs() {
  const raw = process.env[CARD_TIMEOUT_ENV]
  const seconds = raw === undefined || raw === '' ? 600 : Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) return 600 * 1000
  return Math.round(seconds * 1000)
}

/**
 * 把本插件挂进 user-questions waterfall。
 * @param {object} ctx - Cordis 上下文（插件 fiber）。
 * @param {object} channel - SDK LarkChannel。
 * @param {string} root - 记忆根。
 */
function registerQuestionAnswerer(ctx, channel, root) {
  if (process.env[CARD_SWITCH_ENV] === '0') {
    ctx.logger.info(`aiyayi-feishu: ${CARD_SWITCH_ENV}=0，卡片问答已关闭（走桌面 GUI 原生卡片）`)
    return
  }
  // 宿主的 userQuestions 服务必须可用，否则这个 waterfall 不会有人触发。
  const userQuestions = ctx.get('userQuestions')
  if (!userQuestions) {
    ctx.logger.warn('aiyayi-feishu: userQuestions 服务不可用，卡片问答未挂载')
    return
  }
  ctx.effect(
    () =>
      ctx.on(
        'user-questions/request',
        async (request, next) => {
          try {
            const claimed = await answerViaFeishu(ctx, channel, root, request)
            if (claimed !== undefined) return claimed
          } catch (error) {
            // 认领失败必须回落 next()，否则提问会以插件异常的形式炸掉整轮对话。
            ctx.logger.warn(`aiyayi-feishu: 飞书卡片问答失败，交回下游 answerer: ${String(error)}`)
          }
          return next()
        },
        // prepend：抢在桌面端 GUI answerer 之前认领；不抢的话 GUI 会先接走。
        { prepend: true },
      ),
    'aiyayi-feishu.question-answerer()',
  )
  ctx.logger.info('aiyayi-feishu: 卡片问答已挂载（user-questions/request，prepend）')
}

/**
 * 一次提问的飞书侧处理：发卡片（或文字兜底）→ 等用户点/回 → 返回答案。
 * @returns {Promise<{answers:Array}|undefined>} undefined = 不认领，交回 next()。
 */
async function answerViaFeishu(ctx, channel, root, request) {
  const agent = request?.agent
  const sessionId = agent?.session?.id
  if (!sessionId) return undefined
  // 只接管「已绑定飞书 chat 的会话」：没绑定就让 GUI 原生卡片照常工作。
  const chatId = reverseLookup(readMappings(root), sessionId)
  if (!chatId) return undefined
  const questions = Array.isArray(request.questions) ? request.questions : []
  if (questions.length === 0) return undefined

  const record = {
    qid: `q-${randomUUID()}`,
    chatId,
    sessionId,
    callId: request.wait?.callId ?? null,
    timed: request.wait?.timed === true,
    createdAt: Date.now(),
    status: 'open',
    // rev 每次改动自增：SDK 卡片点击去重键含按钮 value（lib/index.js:107296/107406），
    // 同一个按钮点第二次（取消选中）若 value 不变会被当重复事件丢掉。
    rev: 0,
    questions: questions.map((question) => ({
      id: String(question.id),
      question: String(question.question),
      ...(question.header === undefined ? {} : { header: question.header }),
      ...(question.options === undefined
        ? {}
        : {
            options: question.options.map((option) => ({
              label: String(option.label),
              ...(option.description === undefined ? {} : { description: option.description }),
            })),
          }),
      ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
    })),
    selections: questions.map(() => []),
    customs: questions.map(() => ''),
  }

  const table = prunePendingQuestions(readPendingQuestions(root))
  table[record.qid] = record
  writePendingQuestions(root, table)

  // 1) 先试卡片；失败就退文字编号列表（权限/事件订阅没配好时卡片点不动）。
  let cardSent = false
  try {
    const sent = await channel.sender.send(chatId, { card: buildQuestionCard(record) })
    record.messageId = sent?.messageId ?? null
    cardSent = true
    ctx.logger.info(`aiyayi-feishu: 已发问答卡片 ${record.qid} → ${chatId} msg=${record.messageId}`)
  } catch (error) {
    ctx.logger.warn(
      `aiyayi-feishu: 问答卡片发送失败（降级为文字编号列表）: ${String(error)}`,
    )
  }
  if (!cardSent) {
    try {
      await replyToChat(channel, chatId, null, buildQuestionText(record))
    } catch (error) {
      // 连文字都发不出去：不认领，交回 GUI。提问不能因为飞书侧故障而丢掉。
      ctx.logger.warn(`aiyayi-feishu: 问答文字兜底也失败，交回下游: ${String(error)}`)
      delete table[record.qid]
      writePendingQuestions(root, table)
      return undefined
    }
  }
  const persisted = readPendingQuestions(root)
  persisted[record.qid] = record
  writePendingQuestions(root, persisted)

  // 2) 等用户点/回（或宿主取消）。
  const answer = await waitForQuestionAnswer(ctx, root, channel, record, request.signal, {
    timeoutMs: blockingTimeoutMs(),
  })
  if (answer === undefined) {
    // 取消/超时后才轮到下游：此时宿主自己会按 ASK_ABORTED/ASK_TIMED_OUT 处理。
    return undefined
  }
  return answer
}

/** 挂起等待：卡片点击处理器与文字处理器都通过 finishQuestion 兑现。 */
const questionWaiters = new Map() // qid → {resolve, cleanup}

/**
 * 等一条提问被回答。
 * @returns {Promise<{answers:Array}|undefined>} undefined = 宿主取消/超时，交回下游。
 */
function waitForQuestionAnswer(ctx, root, channel, record, signal, opts = {}) {
  return new Promise((resolve) => {
    let done = false
    let timer = null
    const finish = (answer) => {
      if (done) return
      done = true
      if (timer !== null) clearTimeout(timer)
      const waiter = questionWaiters.get(record.qid)
      questionWaiters.delete(record.qid)
      waiter?.cleanup?.()
      resolve(answer)
    }
    const onAbort = () => {
      ctx.logger.info(`aiyayi-feishu: 提问 ${record.qid} 被宿主取消（超时/中断）`)
      const table = readPendingQuestions(root)
      if (table[record.qid]) {
        table[record.qid].status = 'expired'
        // timed 模式（tool-ask-user mode: timed）：宿主返回 pending，提问仍 answerable，
        // 迟到回答能走 userQuestions.answer（aser dsh-user-questions/lib/index.js:560-596）。
        // legacy 阻塞模式：request.wait 为空，answer() 只认 continued 的 callId，答不进去，
        // 不能对用户许诺「还能答」。
        table[record.qid].statusText = record.timed === true
          ? '已超时（仍可在飞书点选或回数字，迟到回答会作为新消息送入）'
          : '已结束（本轮已中断，本次提问不能补答；需要的话让助手重新提问）'
        writePendingQuestions(root, table)
        // 卡片就地改成结束态，避免用户对着还能点但没人收的卡片发呆。
        if (record.messageId && channel) {
          channel.updateCard(record.messageId, buildQuestionCard(table[record.qid])).catch(() => {})
        }
      }
      finish(undefined)
    }
    if (signal?.aborted === true) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    // 阻塞式提问（@deepseek-ai/dsh-tool-ask-user 的 legacy 模式，默认值，
    // 见 asar .../dsh-tool-ask-user/lib/index.js:212-223）没有宿主侧超时：
    // 用户在飞书一直不答，这轮 turn 会永久挂着。这里补一个插件侧兜底，
    // 到点按「全部跳过」放行（宿主语义 = 用户主动跳过），并把卡片标成已结束。
    // 注意不要谎称「还能迟到回答」：legacy 模式 request.wait 为空，
    // userQuestions.answer() 只认 continued 的 callId，答不进去。
    if (opts.timeoutMs > 0 && record.timed !== true) {
      timer = setTimeout(() => {
        timer = null
        if (done) return
        const table = readPendingQuestions(root)
        if (table[record.qid]) {
          table[record.qid].status = 'expired'
          table[record.qid].statusText = '已超时，本次按「跳过」继续；需要的话让助手重新提问'
          writePendingQuestions(root, table)
          if (record.messageId && channel) {
            channel.updateCard(record.messageId, buildQuestionCard(table[record.qid])).catch(() => {})
          }
        }
        ctx.logger.warn(
          `aiyayi-feishu: 提问 ${record.qid} 本地超时（${opts.timeoutMs}ms），按全部跳过放行`,
        )
        void replyToChat(
          channel,
          record.chatId,
          null,
          `提问 ${record.qid} 等待超时（${Math.round(opts.timeoutMs / 1000)} 秒），本次按「跳过」继续。`,
        ).catch(() => {})
        finish({ answers: record.questions.map((q) => ({ id: String(q.id), selected: [] })) })
      }, opts.timeoutMs)
    }

    questionWaiters.set(record.qid, {
      resolve: finish,
      cleanup: () => signal?.removeEventListener('abort', onAbort),
    })
  })
}

/** 从落盘表里按 qid 取一条仍可回答的记录。 */
function liveQuestion(root, qid) {
  if (!qid) return null
  const table = readPendingQuestions(root)
  const record = table[qid]
  if (!record) return null
  if (record.status !== 'open' && record.status !== 'expired') return null
  return record
}

/**
 * 处理一次卡片点击（SDK 已 normalize，见 lib/index.js:106709-106732）。
 * 事件形状：{messageId, chatId, operator:{openId}, action:{value, tag, name, option}}。
 */
async function onCardAction(ctx, channel, event, root) {
  const value = event?.action?.value
  if (!value || typeof value !== 'object') return
  const record = liveQuestion(root, value.q)
  if (!record) {
    ctx.logger.info(`aiyayi-feishu: 卡片点击对应提问已结算/过期 qid=${value.q}`)
    return
  }
  const applied = applyCardAction(record, value)
  const table = readPendingQuestions(root)
  table[record.qid] = record

  if (applied.submit || applied.skip) {
    if (applied.skip) {
      // 「全部跳过」：整批空答案（宿主语义 = 用户主动跳过，不算未答）。
      record.selections = record.questions.map(() => [])
      record.customs = record.questions.map(() => '')
    }
    record.status = 'answered'
    record.statusText = `已提交：\n${formatAnswerSummary(record)}`
    writePendingQuestions(root, table)
    await patchQuestionCard(ctx, channel, record)
    const waiter = questionWaiters.get(record.qid)
    if (waiter) {
      waiter.resolve(composeAnswerBatch(record))
    } else {
      // 迟到回答：走宿主官方入口 userQuestions.answer（只对 continued 的 callId 有效）。
      await deliverLateAnswer(ctx, record)
    }
    return
  }

  if (applied.changed) {
    writePendingQuestions(root, table)
    await patchQuestionCard(ctx, channel, record)
    // 中途状态也要回 ACK：卡片回调 3 秒内必须响应（SDK README.zh.md:629），
    // patch 是异步的，这里不 await 具体结果，失败只记日志。
  }
}

/**
 * 就地刷新卡片。patch 失败（消息太老/无权限）只记日志：卡片状态落后不影响文字兜底。
 */
async function patchQuestionCard(ctx, channel, record) {
  if (!record.messageId) return
  try {
    await channel.updateCard(record.messageId, buildQuestionCard(record))
  } catch (error) {
    ctx.logger.warn(`aiyayi-feishu: 卡片刷新失败 ${record.qid}: ${String(error)}`)
  }
}

/**
 * 迟到回答：提问已经不在前台等待（宿主超时返回 pending），但用户仍点了卡片。
 * 走 ctx.userQuestions.answer(agent, callId, batch)（asar dsh-user-questions/lib/index.js:560）。
 */
async function deliverLateAnswer(ctx, record) {
  if (!record.callId) {
    ctx.logger.info(`aiyayi-feishu: 提问 ${record.qid} 无 callId（阻塞式），迟到回答无法回送`)
    return
  }
  try {
    const agents = ctx.get('agents')
    const agent = agents?.get?.(record.sessionId) ?? null
    if (!agent) throw new Error(`会话 ${record.sessionId} 不在运行`)
    const userQuestions = ctx.get('userQuestions')
    const accepted = userQuestions.answer(agent, record.callId, composeAnswerBatch(record))
    ctx.logger.info(`aiyayi-feishu: 迟到回答已送入 ${record.qid}（accepted=${String(accepted)}）`)
  } catch (error) {
    ctx.logger.warn(`aiyayi-feishu: 迟到回答回送失败 ${record.qid}: ${String(error)}`)
  }
}

/**
 * 文字回答：入站消息里最近一条仍可回答的提问，尝试把这条文本解析成答案。
 * @returns {Promise<boolean>} true = 已消费（不要再投给会话）。
 */
async function tryAnswerByText(ctx, channel, root, chatId, messageId, rawText) {
  const text = String(rawText || '').trim()
  if (!text) return false
  const table = prunePendingQuestions(readPendingQuestions(root))
  const candidates = Object.values(table)
    .filter((r) => r.chatId === chatId && (r.status === 'open' || r.status === 'expired'))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  for (const record of candidates) {
    const parsed = parseQuestionReply(text, record)
    if (!parsed) continue
    record.selections = parsed.selections
    record.customs = parsed.customs
    record.status = parsed.kind === 'skip' ? 'skipped' : 'answered'
    record.statusText = parsed.kind === 'skip'
      ? '已按「跳过」处理'
      : `已提交：\n${formatAnswerSummary(record)}`
    table[record.qid] = record
    writePendingQuestions(root, table)
    await patchQuestionCard(ctx, channel, record)
    const waiter = questionWaiters.get(record.qid)
    if (waiter) {
      waiter.resolve(parsed.kind === 'skip'
        ? { answers: record.questions.map((q) => ({ id: String(q.id), selected: [] })) }
        : composeAnswerBatch(record))
    } else {
      await deliverLateAnswer(ctx, record)
    }
    await replyToChat(
      channel,
      chatId,
      messageId,
      parsed.kind === 'skip'
        ? `已按跳过处理（提问 ${record.qid}）。`
        : `已收到你的选择：\n${formatAnswerSummary(record)}`,
    )
    return true
  }
  return false
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
  // 1.5.18-fix：子智能体（检索员 / 执行体）不是对话对象，跳过接入意图检测。
  if (isSubagentSession(session)) return
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
      // 1.5.18-fix：markGuided 只写盘不碰进程内缓存，不同步的话本会话下一次
      // turn/end 会被 maybeGuideNewSession 再注入一条引导（实测 b1e8d25b 中招）。
      guidedSet.add(sessionId)
      await safeDeliverToSession(
        ctx,
        root,
        sessionId,
        null,
        `${GUIDE_PREFIX}好的，不接入也没关系。需要时随时说「接入飞书」，我会再给你扫码步骤。`,
      )
      return
    }
    if (matchOnboardIntent(text)) {
      writePendingBind(root, { sessionId, createdAt: Date.now() })
      markGuided(root, sessionId)
      guidedSet.add(sessionId) // 1.5.18-fix：同放弃分支，避免下一轮重复注入。
      ctx.logger.info(`aiyayi-feishu: 会话 ${sessionId} 请求接入飞书，已记待接入目标`)
      await safeDeliverToSession(
        ctx,
        root,
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
  // 1.5.18-fix：子智能体不引导接入。
  // 实测 2026-11-11：guided.json 14 条里 12 条是 subagent，注入 0 次命中真人体感会话。
  if (isSubagentSession(session)) return
  const sessionId = session.id
  loadGuided(root)
  if (guidedSet.has(sessionId)) return
  const chatId = reverseLookup(readMappings(root), sessionId)
  if (chatId) return // 已绑定，跳过
  markGuided(root, sessionId)
  guidedSet.add(sessionId)
  ctx.logger.info(`aiyayi-feishu: 会话 ${sessionId} 未绑定飞书，注入接入引导`)
  await safeDeliverToSession(
    ctx,
    root,
    sessionId,
    null,
    `${GUIDE_PREFIX}（提示）本会话还没接入飞书聊天机器人。建议接入，这样在手机上也能随时找我：先在手机安装飞书 app（各大应用商店可下载），然后在 open.feishu.cn 扫码找到机器人，或直接在飞书里搜索机器人名称发起单聊——进入与机器人的单聊即自动接入本会话。如果不需要，回复「不用」即可跳过，我不会再提示。`,
  )
}
