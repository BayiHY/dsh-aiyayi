/**
 * 会话层：微信用户 → aiyayi 会话的建/投/查。
 *
 * 复用 feishu-logic 的 routeMessage/reverseLookup 思路，但 key 换成 from_user_id
 * （坑 8：个人号 session_id 实测是空串，不能当会话主键）。
 * 去重以**游标**为准（get_updates_buf 续传天然幂等），message_id 只作二级幂等键
 * （4.4.1：不要照抄飞书的 event_id 方案）。
 *
 * 建会话模板照抄 lib/feishu.js 的 createAiyayiSession（坑 #59/#60/#61/#64/#67 全部适用），
 * 但**不 import feishu.js**——通道之间不耦合，微信模块整体可以被 try/catch 摘掉。
 *
 * 坑 #68（宿主 session append 重入保护）同样适用：投递前让出宏任务，
 * 投递错误就地 catch，绝不让 rejection 逃逸成宿主 fatal。
 */

/** 延迟加载 dsh-llm：宿主提供该包，但加载失败只影响投递，不影响通道加载。 */
let createUserMessageRef = null
let createUserMessageError = null

async function loadCreateUserMessage() {
  if (createUserMessageRef) return createUserMessageRef
  if (createUserMessageError) throw createUserMessageError
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    if (typeof mod.createUserMessage !== 'function') {
      throw new Error('@deepseek-ai/dsh-llm 未导出 createUserMessage')
    }
    createUserMessageRef = mod.createUserMessage
    return createUserMessageRef
  } catch (error) {
    createUserMessageError = error
    throw error
  }
}

/** 坑 #68：投递前让出宿主当前 publish 窗口。 */
async function yieldHostPublication() {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 从 agents 注册表取 agent（坑 #61：返回裸 Agent，不是 {agent}）。 */
export function getAgent(ctx, sessionId) {
  try {
    return ctx.get('agents').get(sessionId) ?? null
  } catch {
    return null
  }
}

/**
 * 把文本投进目标会话（跟 feishu/webhook 同一通道）。
 * @returns {Promise<boolean>} true = 已投进在运行的会话
 */
export async function deliverToSession(ctx, sessionId, text) {
  const agent = getAgent(ctx, sessionId)
  if (!agent) return false
  const createUserMessage = await loadCreateUserMessage()
  await yieldHostPublication()
  await agent.followup(
    createUserMessage({
      content: [{ type: 'text', text }],
      // 坑 #65：source 里绝不能出现 undefined（宿主 snapshotJsonValue 会判非 JSON 可序列化）。
      source: { kind: 'user' },
    }),
  )
  return true
}

/** deliverToSession 的「失败不逃逸」包装（坑 #68）。 */
export async function safeDeliverToSession(ctx, sessionId, text) {
  try {
    return await deliverToSession(ctx, sessionId, text)
  } catch (error) {
    ctx.logger.warn(
      `aiyayi-weixin: 消息投递失败（宿主 append 可能仍在发布，已跳过）: ${String(error)}`,
    )
    return false
  }
}

/**
 * 新建一个 aiyayi 会话（模板对齐 dsh-webhook createWebhookSession / feishu 同名函数）：
 *   workspaceRegistry.create → agents.create(setup 里 mount aiyayi preset)
 *   → permissionPresets.set → sessionTitle.rename
 *
 * @param {object} ctx
 * @param {object} opts
 * @param {string} opts.root 记忆根（workspace 建在 <root>/weixin/workspaces/ 下）
 * @param {string|null} opts.name 会话标题
 * @param {string} opts.sessionPrefix 默认 'weixin-'
 * @param {string} opts.permissionPreset 默认 'workspace-write'
 * @returns {Promise<{sessionId: string, workspacePath: string}>}
 */
export async function createAiyayiSession(
  ctx,
  { root, name = null, sessionPrefix = 'weixin-', permissionPreset = 'workspace-write' } = {},
) {
  const { randomUUID } = await import('node:crypto')
  const { mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')

  const preset = await ctx.agentPresets.resolve('aiyayi')
  // 坑 #60：permissionPresets.resolve 只作校验，set 要的是**名字字符串**。
  await ctx.permissionPresets.resolve(permissionPreset)

  // 坑 #59：workspaceRegistry.create 的契约是路径必须已存在（内部 realpath，不代建）。
  const workspacesDir = join(root, 'weixin', 'workspaces')
  const workspacePath = join(workspacesDir, `${sessionPrefix}${randomUUID()}`)
  mkdirSync(workspacePath, { recursive: true })
  const workspace = await ctx.workspaceRegistry.create(workspacePath)

  const sessionId = `${sessionPrefix}${randomUUID()}`
  // 坑 #67：不显式指定 model 时取宿主默认选择，否则会话可能没有可用模型
  //（能建、能收提示、但永远产不出正式回答）。
  let agentOptions = {}
  try {
    const selection = ctx.agentDefaultModel?.currentSelection?.()
    if (selection && typeof selection === 'object') agentOptions = { ...selection }
  } catch (error) {
    ctx.logger.warn(`aiyayi-weixin: 取默认模型失败（用宿主默认）: ${String(error)}`)
  }
  // 坑 #64：会话是宿主资产，不用插件生命周期 signal（否则 HMR dispose 会把会话连坐杀死）。
  const sessionSignal = new AbortController().signal
  const handle = await ctx.agents.create({
    sessionId,
    signal: sessionSignal,
    meta: { cwd: workspace.path, agentPreset: preset.id },
    agentOptions,
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx, preset.id)
    },
  })

  try {
    await workspace.attachSession(sessionId)
    ctx.permissionPresets.set(handle.agent.session, permissionPreset)
    if (name) ctx.sessionTitle.rename(handle.agent.session, name)
  } catch (error) {
    // 回滚：尽力 detach + dispose，别留半个会话
    try {
      await workspace.detachSession?.(sessionId)
      await workspace.dispose?.()
    } catch {
      /* 回滚失败不掩盖原始错误 */
    }
    throw error
  }

  return { sessionId, workspacePath }
}
