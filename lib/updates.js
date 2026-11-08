/**
 * aiyayi-updates — 插件自身的新版本提醒。
 *
 * 每个新会话的第一个回合（agent/pre-step 且 step===1）检查一次：
 * 读自己的 package.json 拿本地版本，去 npm registry 查 latest，
 * 若远端更新且这个远端版本还没提醒过（updates.json 落盘去重，跨重启只提醒一次），
 * 就往消息尾部追加一条 [更新提示] 快照——她看到后会用自己的口吻顺口提一句。
 *
 * 走 agent/pre-step 消息注入（与 aiyayi-presence 同一范式）：持久落盘、前缀稳定。
 * 只在 aiyayi 预设作用域挂载；她的小伙伴（aiyayi-worker）不挂本模块，不掺和子会话。
 * 网络失败/解析失败一律静默跳过：更新提醒不该弄坏对话，更不该拖死预设激活。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRoot, updatesFile } from './home.js'

/** Loader 身份。 */
export const name = 'aiyayi-updates'

/** 需要的服务。 */
export const inject = ['tools']

const PKG_NAME = 'dsh-aiyayi'
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 一次成功检查管 6 小时；失败 30 分钟后才重试，别每轮都敲 registry。 */
const TTL_OK_MS = 6 * 60 * 60 * 1000
const TTL_FAIL_MS = 30 * 60 * 1000
const FETCH_TIMEOUT_MS = 3500
const REGISTRY_URLS = [
  `https://registry.npmjs.org/${PKG_NAME}/latest`,
  `https://registry.npmmirror.com/${PKG_NAME}/latest`,
]

/** 远端缓存：{ at, latest(string|null), ok }；inflight 用于并发去重。 */
let remoteCache = { at: 0, latest: null, ok: false }
let inflight = null
let cachedLocalVersion = null

/** 这个 agent 提醒过了没有（进程内一层；跨进程由 updates.json 兜住）。 */
const reminded = new WeakSet()

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

function readLocalVersion() {
  if (cachedLocalVersion !== null) return cachedLocalVersion
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
    cachedLocalVersion = typeof pkg?.version === 'string' ? pkg.version.trim() : ''
  } catch {
    cachedLocalVersion = ''
  }
  return cachedLocalVersion
}

function parseVersion(value) {
  return String(value ?? '')
    .trim()
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

/** remote 是否比 local 新（纯数字段比较；本包不用预发布号，够用）。 */
function isNewer(remote, local) {
  const a = parseVersion(remote)
  const b = parseVersion(local)
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

async function fetchLatest() {
  for (const url of REGISTRY_URLS) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) continue
      const data = await response.json()
      const version = typeof data?.version === 'string' ? data.version.trim() : ''
      if (version) return version
    } catch {
      /* 换下一个源；全失败就当没有新版。 */
    }
  }
  return null
}

/** 带缓存的远端检查：6 小时内直接用缓存，失败 30 分钟内不重试。 */
function ensureFresh() {
  if (inflight) return inflight
  const ttl = remoteCache.ok ? TTL_OK_MS : TTL_FAIL_MS
  if (Date.now() - remoteCache.at < ttl) return Promise.resolve(remoteCache)
  inflight = (async () => {
    const latest = await fetchLatest()
    remoteCache = { at: Date.now(), latest, ok: latest !== null }
    inflight = null
    return remoteCache
  })()
  inflight.catch(() => {
    inflight = null
  })
  return inflight
}

function readReminded() {
  try {
    const file = updatesFile()
    if (!file || !existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return typeof parsed?.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * 落盘"这个版本提醒过了"。
 *
 * 1.5.0 修掉两个老毛病（见《记忆路径改造方案》§1.4）：
 * ① 路径原来硬编码 `~/.dsh/aiyayi`，不跟 AIYAYI_HOME、也不跟新的 location.json 指路文件走
 *    → 角色记忆搬走了，更新去重记录还留在旧地方，两处状态分叉；
 * ② 原来有一句 `if (!existsSync(DIR)) return` 的早退：目录不在就**永远不落盘**，
 *    实测把目录删掉后连开 3 个新会话，3 次都弹更新提示（永久卡在"每次都提醒"）。
 * 现在改成：目录缺就补建（指路/环境变量不可达时静默跳过，不让更新提醒搅局），
 * 目录存在就必须能写。
 */
function writeReminded(version) {
  try {
    const file = updatesFile()
    if (!file) return
    const rootState = resolveRoot()
    // 记忆根不可达时静默跳过（更新提醒不该在"记忆读不到"的故障里再加一条噪音）；
    // 除此之外**目录缺就补建**，绝不再像 1.4.4 那样「目录不在就永远不落盘」。
    if (!rootState.reachable) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ version, at: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  } catch {
    /* 写不进去大不了重启后再提一次，无伤大雅。 */
  }
}

/**
 * 手构 user 消息，形状对齐 @deepseek-ai/dsh-llm 的 createUserMessage
 * （同 aiyayi-presence：纯 JSON + deepFreeze，不 import shipped 包）。
 */
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

function renderNotice(local, latest) {
  return [
    `[更新提示] （系统提示，不是他发的消息）插件 ${PKG_NAME} 有新版了：本地 ${local} → npm ${latest}。`,
    '找个合适的时机用自己的口吻提一句，让他更新（npm 装/覆盖后要重启 DSH 才生效）。',
    '这个版本你只提醒这一次，说过了就别再念叨。',
  ].join('')
}

/**
 * 注册新版本提醒。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  // 开机预热：apply 在内核启动期就会跑，先把 registry 拉一遍，
  // 等第一个会话真正来查时多半已经命中缓存，不占对话延迟。
  void ensureFresh().catch(() => {})

  ctx.effect(
    () =>
      ctx.on(
        'agent/pre-step',
        async ({ agent, step, signal }, next) => {
          const decision = await next()
          if (!decision || decision.kind === 'reject' || signal?.aborted) return decision
          if (step !== 1 || reminded.has(agent)) return decision
          try {
            const local = readLocalVersion()
            if (!local) return decision
            const { latest } = await ensureFresh()
            if (!latest || !isNewer(latest, local)) return decision
            if (readReminded() === latest) return decision
            reminded.add(agent)
            writeReminded(latest)
            return {
              ...decision,
              messages: [...decision.messages, createSnapshotMessage(renderNotice(local, latest))],
            }
          } catch {
            /* 更新检查失败不该弄坏对话。 */
          }
          return decision
        },
        { prepend: true },
      ),
    'aiyayi-updates.pre-step()',
  )
}
