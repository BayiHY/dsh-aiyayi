/**
 * aiyayi-weixin — 微信通道（iLink / ClawBot 协议）的宿主级服务插件壳。
 *
 * 这个文件是**薄壳**，刻意做到三件事：
 *   1. `enabled !== true` 时**一个模块都不 import**（默认关闭，装上不等于跑）；
 *   2. 真正实现在 `lib/weixin/index.js`，用**动态 import + try/catch** 载入——
 *      模块加载失败、初始化异常只记 warn 并停用微信通道，**绝不让插件激活失败**
 *      （2026-11-11 炸启动的教训：跨代 peers / 顶层 import 炸了整个 DSH）；
 *   3. 生命周期挂 `ctx.effect`：dispose 时 abort → await runtime.stop()（内部
 *      allSettled 等循环真退出）→ 释放账号锁。
 *
 * 通道定位：与 aiyayi-feishu 同级、互不影响。微信是 HTTP 长轮询，飞书是 WS 长连接，
 * 传输模型不同，因此各自独立实现，不做「统一通道抽象」（4.4 的理由：协议还有
 * 静默失败这类反直觉行为，抽象早了必然返工）。
 *
 * 协议层自包含、零 npm 依赖：只用 node: 内置模块 + lib/weixin/vendor/ 内联的 QR 编码器。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveRoot } from './home.js'
import { registerOwnTool } from './own-tools.js'

/** Loader 身份。 */
export const name = 'aiyayi-weixin'

/**
 * 需要的宿主服务（与 aiyayi-feishu 同一批——建会话/投递用的是同一套）。
 * 注意：**不注入** feishu 的任何东西，两条通道互不依赖。
 */
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

/** 本包根目录（壳在 lib/ 下，上一级就是包根）。 */
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 主入口。**同步返回**，长轮询一律挂后台（4.5 红线：activate 里绝不 await 循环）。
 * @param {object} ctx Cordis 上下文
 * @param {object} config patch 里的 config
 */
export function apply(ctx, config) {
  const enabled = config && typeof config === 'object' ? config.enabled : undefined
  if (enabled !== true) {
    // 默认关闭：只留一行 info，便于确认"装上了但没开"。
    ctx.logger.info(
      'aiyayi-weixin: 微信通道未启用（weixin.enabled !== true），未加载任何微信模块，长轮询不启动。',
    )
    return
  }

  // 运行期句柄（tools 的 execute 通过它取状态；初始化完成前为 null）
  const holder = { runtime: null, starting: null, failed: null }

  ctx.effect(
    () => {
      const controller = new AbortController()
      const starting = bootstrap(ctx, config, controller.signal, holder)
      holder.starting = starting
      starting.catch(() => {
        /* bootstrap 内部已记日志，这里只防止 unhandled rejection */
      })
      return async () => {
        controller.abort()
        // 等 bootstrap 落定，避免「还在建循环时就开始卸」
        await starting.catch(() => {})
        try {
          await holder.runtime?.stop?.('dispose')
        } catch (error) {
          ctx.logger.warn(`aiyayi-weixin: 停止时出错（已忽略，不影响宿主）: ${String(error)}`)
        } finally {
          holder.runtime = null
        }
      }
    },
    'aiyayi-weixin.lifecycle()',
  )

  registerWeixinTools(ctx, holder)
}

/**
 * 动态载入实现并启动。**所有异常都吞掉并记 warn**——这是硬安全要求的落点。
 */
async function bootstrap(ctx, config, signal, holder) {
  try {
    // 动态 import：模块不存在/语法错误/依赖解析失败都只会走 catch，
    // 不会像顶层 import 那样把整个插件激活打断。
    const mod = await import('./weixin/index.js')
    if (typeof mod.startWeixin !== 'function') {
      throw new Error('./weixin/index.js 未导出 startWeixin')
    }
    let root = null
    try {
      root = resolveRoot().root
    } catch (error) {
      ctx.logger.warn(`aiyayi-weixin: 解析记忆根失败: ${String(error)}`)
    }
    const permissionPreset =
      (config && typeof config.defaultPermissionPreset === 'string' && config.defaultPermissionPreset) ||
      'workspace-write'
    const runtime = await mod.startWeixin(ctx, config, { root, permissionPreset })
    holder.runtime = runtime
    if (!runtime?.ok) {
      ctx.logger.warn(
        `aiyayi-weixin: 微信通道未启动（${runtime?.reason ?? 'unknown'}），宿主与飞书通道不受影响。`,
      )
    }
    return runtime
  } catch (error) {
    holder.failed = error
    ctx.logger.warn(
      `aiyayi-weixin: 微信通道初始化失败，已停用（不影响宿主与飞书通道）: ${String(error)}`,
    )
    // 给用户一条可执行的提示，但不再抛
    ctx.logger.warn(
      'aiyayi-weixin: 排查方向——① accounts/<id>.json 凭证是否存在；② credentialRef 是否正确；' +
        '③ lib/weixin/ 是否完整安装；④ 记忆根是否可达。',
    )
    return null
  } finally {
    if (signal?.aborted) {
      // 卸载与启动赛跑：立刻收尾
      try {
        await holder.runtime?.stop?.('aborted-during-start')
      } catch {
        /* 忽略 */
      }
    }
  }
}

/**
 * 注册两个自查工具（与 feishu_status 同风格）：
 *   weixin_status —— 通道状态、账号、绑定、最近出站流水（不含任何 token 明文）
 *   weixin_login  —— 发起扫码登录（返回二维码 PNG 路径 + 扫码 URL）
 * 注意：它们只在 enabled=true 时注册；注册失败不影响通道本身。
 */
function registerWeixinTools(ctx, holder) {
  let tools = null
  try {
    tools = ctx.get('tools')
  } catch (error) {
    // ctx.get 在某些宿主上对未提供的服务直接抛（不是返回 null）——两种都归到「不可用」。
    ctx.logger.warn(
      `aiyayi-weixin: tools 服务不可用（${String(error)}），未注册 weixin_status/weixin_login（通道本身不受影响）。`,
    )
    return
  }
  if (!tools?.register) {
    ctx.logger.warn(
      'aiyayi-weixin: tools 服务不可用，未注册 weixin_status/weixin_login（通道本身不受影响）。',
    )
    return
  }
  try {
    registerOwnTool('weixin_status')
    registerOwnTool('weixin_login')
    registerOwnTool('weixin_bind')
    registerOwnTool('weixin_unbind')

    tools.register({
      name: 'weixin_status',
      description:
        '查看微信通道（aiyayi-weixin 插件，iLink 长轮询）的运行状态：是否启用、哪些账号在轮询、已绑定哪些微信用户及其会话、allowlist 模式、最近出站流水（用于排查"发出了但对方没收到"）。不返回任何 token 明文。没启用时返回 enabled=false 与开启方法。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute() {
        const runtime = holder.runtime
        if (!runtime?.status) {
          return {
            ok: false,
            enabled: false,
            reason: holder.failed ? String(holder.failed) : holder.starting ? '启动中' : '未启动',
            howToEnable:
              '在 profile 的 cordis.patch.yml 里给 aiyayi-weixin 插入项加 config.enabled: true，' +
              '并在 weixin.accounts 里写 [{accountId, credentialRef}]；凭证先扫码登录。',
          }
        }
        return runtime.status()
      },
    })

    tools.register({
      name: 'weixin_login',
      description:
        '为微信通道发起扫码登录（iLink get_bot_qrcode）。返回二维码 PNG 路径与扫码 URL——二维码只有 121 秒寿命，要立刻用手机微信扫。可选 accountId（缺省用配置里的第一个）。登录成功后凭证写到记忆根 weixin/accounts/<id>.json；长轮询会在下次插件激活时使用它。',
      parameters: {
        type: 'object',
        properties: {
          accountId: {
            type: 'string',
            description: '要登录的账号 ID（= ilink_bot_id，形如 xxxx@im.bot）；缺省用配置第一个。',
          },
          maxMs: {
            type: 'number',
            description: '等待扫码的最长毫秒数，默认 600000（10 分钟）。',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args = {}) {
        const runtime = holder.runtime
        if (!runtime?.login) {
          return { ok: false, error: '微信通道未启用或未就绪，无法登录。' }
        }
        return runtime.login({ accountId: args.accountId, maxMs: args.maxMs })
      },
    })

    tools.register({
      name: 'weixin_bind',
      description:
        '把微信接入指定会话：绑定后该微信用户的消息都路由到这个会话（不再新建会话），她在这个会话里的回复也发回微信。' +
        '默认模式 autoNext：先记下目标会话，用户随后发一条微信消息，就把「那条消息的发送者」绑到该会话——' +
        '这是最省事的用法，不需要知道自己的 user_id（他的 user_id 形如 o9cq…@im.wechat，一般没人记得住）。' +
        '已知 user_id 时可传 userId 立即绑定。sessionId 缺省 = 当前调用方会话。' +
        '已有绑定的用户会被覆盖（重新绑定即改绑），解绑用 weixin_unbind。',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description:
              '要绑定的微信 user_id（形如 o9cq…@im.wechat）。**通常不用填**——留空则走 autoNext：' +
              '记下目标会话，等人发一条微信消息即自动把发送者绑过来。',
          },
          sessionId: {
            type: 'string',
            description: '要绑到哪个 aiyayi 会话；缺省 = 当前调用这个工具的会话。',
          },
          autoNext: {
            type: 'boolean',
            description:
              '不传 userId 时是否等待下一条微信消息自动绑定，默认 true（不填就是 true，无需显式传）。',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args = {}, exec) {
        const runtime = holder.runtime
        if (!runtime?.bind) {
          return { ok: false, error: '微信通道未启用或未就绪，无法绑定。' }
        }
        const sessionId =
          typeof args.sessionId === 'string' && args.sessionId.trim()
            ? args.sessionId.trim()
            : (exec?.agent?.session?.id ?? null)
        if (!sessionId) {
          return { ok: false, error: '没有 sessionId，也取不到当前会话 id。' }
        }
        return runtime.bind({ userId: args.userId, sessionId })
      },
    })

    tools.register({
      name: 'weixin_unbind',
      description:
        '解除微信与 aiyayi 会话的绑定：之后该用户再发消息会按「未绑定」处理（allowlist 里没他就丢弃，在 allowlist 里则新建会话）。' +
        '可按 userId 解单个人，或按 sessionId 解掉所有绑到该会话的用户（会话 id 缺省 = 当前会话）。',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: '要解绑的微信 user_id（形如 o9cq…@im.wechat）。',
          },
          sessionId: {
            type: 'string',
            description: '解掉所有绑到这个会话的用户；缺省 = 当前会话。与 userId 二选一。',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args = {}, exec) {
        const runtime = holder.runtime
        if (!runtime?.unbind) {
          return { ok: false, error: '微信通道未启用或未就绪，无法解绑。' }
        }
        // 传了 userId 就只解这个人；否则按会话解（缺省当前会话）——与工具描述一致
        if (typeof args.userId === 'string' && args.userId.trim()) {
          return runtime.unbind({ userId: args.userId.trim() })
        }
        const sessionId =
          typeof args.sessionId === 'string' && args.sessionId.trim()
            ? args.sessionId.trim()
            : (exec?.agent?.session?.id ?? null)
        if (!sessionId) {
          return { ok: false, error: '既没有 userId，也取不到当前会话 id。' }
        }
        return runtime.unbind({ sessionId })
      },
    })
  } catch (error) {
    ctx.logger.warn(`aiyayi-weixin: 注册工具失败（通道本身不受影响）: ${String(error)}`)
  }
}

/** 版本号（与包 version 一致，自查用）。 */
export function weixinVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
    return pkg.version
  } catch {
    return null
  }
}
