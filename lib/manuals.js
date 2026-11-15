/**
 * aiyayi-manuals —— persona 渐进加载：飞书/微信操作手册按话题自动注入（1.8.0）。
 *
 * 背景：persona 里【飞书】【微信】两节原本把"字段含义 + 开启步骤 + 三档规则"
 * 全量塞在 prefix 里（约 6.5KB），每一轮都跟着走，但绝大多数会话根本用不上。
 * 现在把这些**操作手册类**内容搬出 persona，落两份 md（manuals/feishu.md、
 * manuals/weixin.md），由本插件在话题命中时注入一次——不靠模型自觉去读文件。
 *
 * 真源优先级：<记忆根>/docs/manuals/<key>.md（可被她自己改）→ 回落**包内**
 * manuals/<key>.md。包内那份是兜底真源：记忆仓 .gitignore 是 `/*`+`!memory.md`
 * +`!memories/`，docs/ 不进 git，记忆根那份丢了（换盘/搬家/误删）包内还在。
 * 两处都没有 → 该手册静默不注入。包内定位走 import.meta.url 的**文件路径**
 * （坑 #11 那类教训：别用包名解析，本地 bundle / 线上安装两种布局下都稳）。
 *
 * 触发双路：
 *  ① 关键词：本轮 source.kind==='user' 的消息文本匹配手册族词。范式照
 *     feishu-logic.matchOnboardIntent（normalize 去零宽 + stripQuotedSegments
 *     剥引号内引用 + isInjectedGuideText 防已注入引导件再触发）；与那个场景
 *     不同的一点：手册触发词是**话题词**不是"短祈使句"，长句里出现照样触发
 *     （用户就是在长句里聊飞书的），所以不加 passesOnboardGate 的 30 字闸门。
 *  ② 工具调用：本会话调过 feishu_status/feishu_bind → 飞书手册；
 *     weixin_status/weixin_bind/weixin_unbind/weixin_login → 微信手册。
 *     数据来自宿主 session/event 总线的 `tool/call` 事件（dsh-tools pipeline
 *     BatchSettlement.start 落地，data 带 name+arguments；实测 payload 形状
 *     {turn, step, callId, name, arguments}，本插件只读 name，arguments 不碰）。
 *
 * 去重：Map<sessionId, Set<manualKey>>，每会话每本只注入一次（话题行是常驻
 * 提示，不是每轮都有的信息；压缩吃掉后 persona 里的指针句教她 toolkit_read 重读）。
 *
 * 注入消息形状照 lib/phone.js 的 createSnapshotMessage（source.kind='aiyayi-manuals'，
 * form='snapshot'）；首行 `[手册·飞书]` / `[手册·微信]`——该前缀已登记进
 * precompact.js 的 INJECTED_NODE_LINE_PREFIXES，防注入内容沉淀成假经验文档。
 * 全程 try/catch：读文件失败、事件形状不认识、任何异常 → 退化为不注入，
 * 绝不弄坏她的会话。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { resolveRoot } from './home.js'
import { isInjectedGuideText, normalizeForGuideMatch } from './feishu-logic.js'

/** Loader 身份。 */
export const name = 'aiyayi-manuals'

/** 只读记忆根与事件总线，无服务依赖；与 phone 同格声明 tools 以便宿主统一装配。 */
export const inject = ['tools']

/** 手册族谱：key → 触发词正则（话题词，大小写不敏感）+ 命中的工具名集合。 */
const MANUALS = {
  feishu: {
    label: '飞书',
    regex: /(?:飞书|feishu|lark|绑定会话|长连接)/i,
    tools: new Set(['feishu_status', 'feishu_bind']),
  },
  weixin: {
    label: '微信',
    regex: /(?:微信|weixin|clawbot|扫码登录|公众号机器人)/i,
    tools: new Set(['weixin_status', 'weixin_bind', 'weixin_unbind', 'weixin_login']),
  },
}

/* ------------------------------------------------------------------ *
 * 纯函数区（单测直接打）
 * ------------------------------------------------------------------ */

/** 剥掉成对引号包裹的段（与 feishu-logic.stripQuotedSegments 同款正则同拷贝理由：
 *  那边未导出，且本插件刻意不 import feishu.js，见其头注释）。 */
function stripQuotedSegments(t) {
  return t.replace(/[「『“'"][^「」『』”'"]*[」』”'"]/g, ' ').trim()
}

/** 防自触发：手册注入文本的特征串（首行前缀 + 开头说明行；命中即不再当用户话题）。 */
const MANUAL_TEXT_MARKERS = [
  '[手册·飞书]',
  '[手册·微信]',
  '这是 persona 渐进加载的操作手册',
]

/** true = 这段文本是本插件自己发出的手册件，不得再进关键词匹配。 */
export function isInjectedManualText(text) {
  const t = normalizeForGuideMatch(text)
  if (!t) return false
  return MANUAL_TEXT_MARKERS.some((marker) => t.includes(marker))
}

/**
 * 关键词触发判定（纯函数）：返回本轮命中的手册 key 数组（可能同时命中两族）。
 * @param {string} text 本轮真实用户消息文本。
 * @returns {string[]} 命中的 key（'feishu' / 'weixin'）。
 */
export function matchManualIntent(text) {
  const t = stripQuotedSegments(normalizeForGuideMatch(text))
  if (!t) return []
  // 防自触发：已注入的引导件（feishu-logic 防线）和本插件的手册件都不再触发。
  if (isInjectedGuideText(t) || isInjectedManualText(t)) return []
  const hits = []
  for (const [key, spec] of Object.entries(MANUALS)) {
    if (spec.regex.test(t)) hits.push(key)
  }
  return hits
}

/** 工具名 → 手册 key（session/event 的 tool/call 事件用）。未知名返回 null。 */
export function manualKeyForTool(toolName) {
  const key = String(toolName ?? '')
  for (const [k, spec] of Object.entries(MANUALS)) {
    if (spec.tools.has(key)) return k
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 真源解析与读取
 * ------------------------------------------------------------------ */

/** 包根（import.meta.url 定位，文件路径读，不走包名解析）。测试可用 setBundledDir 换。 */
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let bundledDirOverride = null

/** 记忆根手册路径（<root>/docs/manuals/<key>.md）。root 由调用方传入（测试钩子可换）。 */
export function memoryManualPath(root, key) {
  return join(root, 'docs', 'manuals', `${key}.md`)
}

/** 包内手册路径（<pkgRoot>/manuals/<key>.md）。测试可用 setBundledDir 换。 */
export function bundledManualPath(key) {
  return join(bundledDirOverride ?? PKG_ROOT, 'manuals', `${key}.md`)
}

/**
 * 按优先级解析手册真源并读取：记忆根 → 包内。
 * @returns {{path: string, text: string}|null} 两处都没有返回 null（静默）。
 */
function readManual(key, root) {
  const candidates = []
  try {
    if (root) candidates.push(memoryManualPath(root, key))
  } catch {
    /* root 解析失败只剩包内 */
  }
  candidates.push(bundledManualPath(key))
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const raw = readFileSync(path, 'utf8').replace(/^﻿/, '')
      if (raw.trim()) return { path, text: raw }
    } catch {
      /* 单条读不了继续下一个候选 */
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 注入消息（形状照 phone.js createSnapshotMessage，同款原因：本地 bundle
 * 解析不了 shipped 包，不 import presence）。
 * ------------------------------------------------------------------ */

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

function createSnapshotMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze(TEXT_BLOCK(text)),
    source: Object.freeze({
      kind: name,
      form: 'snapshot',
      sections: Object.freeze([Object.freeze({ name, text })]),
    }),
  })
}

/** 拼装注入正文：首行 `[手册·X] …<实际读到的路径>`，随后手册全文。 */
function renderManualInjection(label, manual) {
  return (
    `[手册·${label}] 以下为${label}对接手册全文（本会话仅注入一次；被压缩丢失时按此路径重读）：${manual.path}\n` +
    manual.text
  )
}

/** 本轮真实用户消息文本（source.kind==='user'；注入件 kind 不是 'user'，天然排除）。 */
function userTextOf(message) {
  try {
    if (!message || message.role !== 'user' || message.source?.kind !== 'user') return ''
    const content = message.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((block) => block?.type === 'text')
        .map((block) => block?.text ?? '')
        .join('\n')
    }
    return ''
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ *
 * 记账：每会话每本一次 + tool/call 待注入集
 * ------------------------------------------------------------------ */

/** Map<sessionId, Set<key>>：本会话已注入过的手册。 */
const injectedBySession = new Map()
/** Map<sessionId, Set<key>>：tool/call 触发待注入（pre-step 消费后并入已注入账）。 */
const pendingBySession = new Map()
/** 测试钩子用：置 true 后 resolveMemoryRoot 返回 mockRoot。 */
let mockRoot = null

function markInjected(sessionId, key) {
  let set = injectedBySession.get(sessionId)
  if (!set) {
    set = new Set()
    injectedBySession.set(sessionId, set)
  }
  set.add(key)
}

function hasInjected(sessionId, key) {
  return injectedBySession.get(sessionId)?.has(key) === true
}

function addPending(sessionId, key) {
  let set = pendingBySession.get(sessionId)
  if (!set) {
    set = new Set()
    pendingBySession.set(sessionId, set)
  }
  set.add(key)
}

/** 记忆根解析（每次现查，热切换前提同 home.js；失败返回 null=只走包内）。 */
function resolveMemoryRoot() {
  try {
    if (mockRoot !== null) return mockRoot
    const info = resolveRoot()
    if (info && info.root && info.reachable !== false) return info.root
    // 根不可达时仍尝试按路径读（existsSync 自然失败 → 回落包内），不硬抛。
    return info?.root ?? null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 挂载
 * ------------------------------------------------------------------ */

/**
 * 注册手册注入。只挂本体 preset（preset-aiyayi）。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  // 路② 数据源：session/event 总线上的 tool/call 事件（{turn,step,callId,name,arguments}）。
  // 通道不可用/形状不认识就静默——只损失工具触发这一路，关键词路照常。
  try {
    ctx.effect(
      () =>
        ctx.on('session/event', (session, event) => {
          try {
            if (event?.type !== 'tool/call') return
            const key = manualKeyForTool(event?.data?.name)
            if (!key) return
            const sessionId = session?.id ?? session?.header?.id
            if (sessionId === undefined || sessionId === null) return
            addPending(sessionId, key)
          } catch {
            /* 单条事件失败不影响别的 */
          }
        }),
      'aiyayi-manuals.session-events()',
    )
  } catch {
    /* 总线不可用：只剩关键词触发 */
  }

  ctx.effect(
    () =>
      ctx.on(
        'agent/pre-step',
        async ({ agent, step, signal }, next) => {
          const decision = await next()
          if (!decision || decision.kind === 'reject' || signal?.aborted) return decision
          try {
            if (step !== 1) return decision
            const sessionId = agent?.session?.id ?? agent?.id
            if (sessionId === undefined || sessionId === null) return decision

            // 收集本轮候选 key：路① 关键词 + 路② 待注入集（工具调过就消费掉，
            // 不论最终注没注入——没注入说明本会话已注过，再攒着也没用）。
            const candidates = new Set()
            for (const message of decision.messages ?? []) {
              const text = userTextOf(message)
              if (!text) continue
              for (const key of matchManualIntent(text)) candidates.add(key)
            }
            const pending = pendingBySession.get(sessionId)
            if (pending) {
              for (const key of pending) candidates.add(key)
              pendingBySession.delete(sessionId)
            }
            // 排除本会话已注入过的。
            for (const key of [...candidates]) {
              if (hasInjected(sessionId, key)) candidates.delete(key)
            }
            if (candidates.size === 0) return decision

            const root = resolveMemoryRoot()
            const parts = []
            for (const key of candidates) {
              const spec = MANUALS[key]
              if (!spec) continue
              const manual = readManual(key, root)
              if (!manual) continue // 两处真源都没有：静默，不记账（下次命中还能再试）
              markInjected(sessionId, key)
              parts.push(renderManualInjection(spec.label, manual))
            }
            if (parts.length === 0) return decision
            return {
              ...decision,
              messages: [...(decision.messages ?? []), createSnapshotMessage(parts.join('\n'))],
            }
          } catch {
            /* 适配失败不该弄坏她的会话 */
          }
          return decision
        },
        { prepend: true },
      ),
    'aiyayi-manuals.pre-step()',
  )
}

/** 测试钩子：清记账 / 换记忆根 / 拿纯函数。 */
export const __testing = {
  resetForTest() {
    injectedBySession.clear()
    pendingBySession.clear()
    mockRoot = null
    bundledDirOverride = null
  },
  /** 换记忆根（传 null/'' 恢复真实解析）。 */
  setMemoryRoot(root) {
    mockRoot = typeof root === 'string' && root.length > 0 ? root : null
  },
  /** 换"包内手册目录"根（传 null/'' 恢复真实包根）——测回落与双缺静默用。 */
  setBundledDir(dir) {
    bundledDirOverride = typeof dir === 'string' && dir.length > 0 ? dir : null
  },
  matchManualIntent,
  manualKeyForTool,
  isInjectedManualText,
  memoryManualPath,
  bundledManualPath,
  readManual,
  renderManualInjection,
}
