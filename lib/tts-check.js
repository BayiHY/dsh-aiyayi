/**
 * aiyayi-tts-check — 新会话首轮静默探活晓晓 edge-tts 桥，挂了自动拉起（自愈）。
 *
 * 背景（2026-11-27）：手机 DSH-Go（proot）里晓晓桥每次 DSH 重启必挂，
 * setsid 也扛不住——三次断档全与重启同期。现成保底工具 tts_keepalive.js
 * 能探活+拉起+验证，但要人手动调。这层把它接到"新会话首轮"，静默自愈。
 *
 * 设计约束（逐条对齐需求）：
 * 1. **每次新会话都探、不缓存 TTL**：桥重启必挂，缓存只会误事；探活是只读
 *    curl /health，无害。按 sessionId 在内存里 gate（同一会话只探一次），
 *    新会话=新 id=必探。进程重启内存 Set 清空，正好对上"重启后要重探"。
 * 2. **只提一次/会话**：notifiedSessions（内存）+ tts.json 的 notifiedAt 落盘双记。
 *    磁盘记录是审计与跨进程"这次自愈已报过"的判据（healReportedAt）；
 *    真正的每会话闸门是内存 Set——不能拿磁盘 notifiedSession 跨重启压住探活，
 *    那恰好会在最该重探的重启后把自愈憋回去。
 * 3. **绝不拖住对话**：apply 期 warmTtsProbe 不 await 地预热/自愈；首轮
 *    await 有限预算（AWAIT_BUDGET_MS），预算内没结果这轮静默，结果由预热落盘。
 *    全程 try/catch + 失败只返回空串，绝不影响对话。
 * 4. **幂等**：/health=ok 只报状态、零输出，绝不拉起/杀进程；只有探不到才走
 *    拉起分支。拉起复用 tts_keepalive.js 默认幂等自愈（它内部再探活→setsid
 *    拉起→/health + /tts mp3 头验证），不重复造轮子。
 * 5. **平台分岔**：本轮只实现手机 proot（platform==='linux' 且 keepalive 脚本可达）。
 *    win32 留分岔入口 + TODO，不实现（那边桥有 WMI+HKCU Run 自启，本来就稳）。
 *
 * 范式来源：lib/pwsh-check.js（spawn/超时/单飞/状态落盘/系统提示注入）、
 * lib/presence.js 的 [闹钟·异常]（新会话首轮注入）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveRoot, ttsFile } from './home.js'

/** 桥地址与探活命令（与 tts_keepalive.js 保持同一口径：唯一权威 = /health 返回 ok）。 */
export const TTS_HEALTH_URL = 'http://127.0.0.1:52123/health'
export const HEALTH_ARGS = ['-sS', '-m', '3', TTS_HEALTH_URL]

/** 探活子进程超时：比 curl 的 -m 3 略宽，留点进程启动余量。 */
export const PROBE_TIMEOUT_MS = 4000
/** 拉起子进程（tts_keepalive.js 内含 1.5s sleep + /tts 5s 验证）超时。 */
export const HEAL_TIMEOUT_MS = 15000
/** 首轮为探活/自愈最多等多久（比拉起超时短得多；预热期已先行自愈）。 */
export const AWAIT_BUDGET_MS = 1800

/** 状态文件版本。 */
const STATE_VERSION = 1

/** 提示文案：让 agent 用自己口吻转述，不写成报错。 */
export const TTS_HEALED_TIP =
  '💡 顺口一提：晓晓的桥刚才在启动时掉了，我已经自己拉起来、验过能出声了。不用做什么，知道就行。'
export const TTS_FAILED_TIP =
  '⚠️ 晓晓的桥没起来：/health 探不到，自动拉起也失败了。他要听声音的话，可以手动跑一下 tts_keepalive，或者让我再试一次。'

/* ------------------------------------------------------------------ *
 * 状态落盘（tts.json，与 updates.json / pwsh.json 同目录同风格）
 * ------------------------------------------------------------------ */

function emptyState() {
  return {
    version: STATE_VERSION,
    checkedAt: null,
    lastResult: null, // alive | down | healed | failed | skip
    lastAction: null, // none | heal-launched | heal-failed
    detail: null,
    healReportedAt: null, // 这次自愈事件已报过一次（新一次自愈会清空）
    notifiedAt: null,
    notifiedSession: null,
  }
}

function toIso(now) {
  return new Date(now).toISOString()
}

/** 读状态。文件不在/坏了/旧格式 → 空状态。 */
export function readTtsState(opts = {}) {
  try {
    const file = typeof opts.stateFile === 'string' ? opts.stateFile : ttsFile()
    if (!file || !existsSync(file)) return emptyState()
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!Number.isFinite(parsed?.version) || Number(parsed.version) < STATE_VERSION) return emptyState()
    const s = (k) => (typeof parsed?.[k] === 'string' ? parsed[k] : null)
    return {
      version: STATE_VERSION,
      checkedAt: s('checkedAt'),
      lastResult: s('lastResult'),
      lastAction: s('lastAction'),
      detail: s('detail'),
      healReportedAt: s('healReportedAt'),
      notifiedAt: s('notifiedAt'),
      notifiedSession: s('notifiedSession'),
    }
  } catch {
    return emptyState()
  }
}

/** 写状态。目录缺就补建；写不进去只当没记，不影响对话。@returns {boolean} */
export function writeTtsState(state, opts = {}) {
  try {
    const file = typeof opts.stateFile === 'string' ? opts.stateFile : ttsFile()
    if (!file) return false
    const resolved = resolveRoot()
    if (!resolved.reachable && typeof opts.stateFile !== 'string') return false
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ ...state, version: STATE_VERSION }, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 子进程执行：一律走 spawnImpl（单测注入假 spawn），照 pwsh-check 的形态。
 * ------------------------------------------------------------------ */

function runCommand(spawnImpl, command, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    let child = null
    const finish = (r) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve(r)
    }
    try {
      // 与 pwsh-check 一致：不设 shell/cwd/env，stdio 三管，走 PATH。
      child = spawnImpl(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      finish({ status: 'spawn-threw', exitCode: null, stdout: '', stderr: '', detail: String(e?.code ?? e?.message ?? e) })
      return
    }
    const out = []
    const err = []
    timer = setTimeout(() => {
      try { child?.kill?.() } catch { /* 掐不掉就算了 */ }
      finish({
        status: 'timeout',
        exitCode: null,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(err).toString(),
        detail: `${timeoutMs}ms`,
      })
    }, timeoutMs)
    child?.on?.('error', (e) =>
      finish({
        status: 'error',
        exitCode: null,
        stdout: '',
        stderr: '',
        detail: String(e?.code ?? e?.message ?? e),
      }),
    )
    child?.stdout?.on?.('data', (c) => out.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))))
    child?.stderr?.on?.('data', (c) => err.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))))
    child?.on?.('close', (code) =>
      finish({
        status: 'closed',
        exitCode: code,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(err).toString(),
      }),
    )
  })
}

/**
 * 探活：唯一权威 = curl /health 返回 ok。只读，绝不杀/拉。
 */
export async function probeBridge(opts = {}) {
  const spawnImpl = typeof opts.spawnImpl === 'function' ? opts.spawnImpl : spawn
  const r = await runCommand(spawnImpl, 'curl', HEALTH_ARGS, opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS)
  const body = (r.stdout || '').trim()
  return {
    alive: r.status === 'closed' && r.exitCode === 0 && body === 'ok',
    body,
    raw: r,
  }
}

/**
 * 判断当前平台是否走本轮实现（手机 proot=linux 且 keepalive 脚本存在）。
 * win32 明确留给将来（见下方 TODO），其他平台跳过。
 */
export function ttsTargetPlatform(opts = {}) {
  const platform = opts.platform ?? process.platform
  // stateFile 形如 <root>/tts.json，其 dirname 就是 root；生产走 resolveRoot().root。
  const root = typeof opts.stateFile === 'string' ? dirname(opts.stateFile) : resolveRoot().root
  const keepalive = opts.keepalivePath ?? join(root, 'toolbox', 'tts_keepalive.js')
  if (platform !== 'linux') return { target: false, platform, reason: 'not-linux' }
  if (!existsSync(keepalive)) return { target: false, platform, reason: 'keepalive-missing' }
  return { target: true, platform, keepalive }
}

/**
 * 探活 + 挂了就自愈的引擎。桥活 → 零动作；桥挂 → spawn 调 tts_keepalive.js
 * 默认幂等自愈，拉起后再探一次 /health 确认。不抛错。
 *
 * @returns {Promise<{status:'skip'|'alive'|'healed'|'failed', detail?:string, keepalive?:string}>}
 */
export async function probeAndMaybeHeal(opts = {}) {
  const platform = opts.platform ?? process.platform
  const target = ttsTargetPlatform({ ...opts, platform })
  if (!target.target) {
    return { status: 'skip', detail: target.reason, platform }
  }
  const spawnImpl = typeof opts.spawnImpl === 'function' ? opts.spawnImpl : spawn

  const p = await probeBridge({ ...opts, spawnImpl })
  if (p.alive) return { status: 'alive', detail: '/health=ok' }

  // 只有这里——探活明确失败——才走拉起分支。绝不碰活着的桥。
  const heal = await runCommand(spawnImpl, 'node', [target.keepalive], opts.healTimeoutMs ?? HEAL_TIMEOUT_MS)
  const healOk = heal.status === 'closed' && heal.exitCode === 0
  const p2 = await probeBridge({ ...opts, spawnImpl })
  if (p2.alive && healOk) return { status: 'healed', detail: 'self-healed via tts_keepalive.js', keepalive: target.keepalive }
  if (p2.alive) return { status: 'healed', detail: 'up after heal attempt (heal exit non-zero)', keepalive: target.keepalive }
  return {
    status: 'failed',
    detail: `health before=${p.body || '(empty)'}; heal=${heal.status}/exit ${heal.exitCode}; health after=${p2.body || '(empty)'}`,
    keepalive: target.keepalive,
  }

  /* TODO(Windows 分支，未实现——将来在 win32 上照下面口径补，别照搬本函数)：
   * 1. 平台判据：process.platform === 'win32'。桥脚本 D:\阿依娅伊\工具\edge_tts_server.py，
   *    验活 curl /health=ok + /tts 200/audio/mpeg/mp3头 ff f3（见 tts-setup 技能）。
   * 2. ★别照搬 pwsh-check.js 的 spawn('pwsh', ...)：Windows 系统自带 powershell.exe=5.1，
   *    多数机器没装 pwsh(PowerShell 7)。必须先探测版本、兼容 5.1——直接复用
   *    pwsh-check.js 的 detectPwshVersion()（它已有 pwsh→绝对路径→powershell.exe 5.1
   *    的降级链），拿到可用的命令再拼 -NoProfile -Command，别假设 pwsh 一定在。
   * 3. 拉起走 tts-setup 技能口径：pythonw.exe 无窗；WMI Win32_Process.Create 脱 DSH
   *    作业树（Start-Process 会被 DSH 重启连带杀）；HKCU Run 键 EdgeTTSBridge 开机自启。
   * 4. 幂等不变：/health 活着只报状态，绝不拉起；脚本自带单实例守卫，重复拉起无害。
   */
}

/* ------------------------------------------------------------------ *
 * 编排：单飞 + 有限预算 + 每会话一次闸门
 * ------------------------------------------------------------------ */

let inflightWarm = null
/** 本进程里已探过/已提过的 sessionId（上限截断，防长跑无限增长）。 */
const MAX_TRACKED = 512
const checkedSessions = new Set()
const notifiedSessions = new Set()

function track(set, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return
  set.add(sessionId)
  if (set.size > MAX_TRACKED) {
    const oldest = set.values().next().value
    if (oldest !== undefined) set.delete(oldest)
  }
}

function sessionKey(sessionId) {
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : '__anon__'
}

/** 单飞：同一进程里并发调用共用一次探活/自愈。 */
function probeOnce(opts) {
  if (inflightWarm) return inflightWarm
  inflightWarm = probeAndMaybeHeal(opts).then(
    (r) => { inflightWarm = null; return r },
    () => { inflightWarm = null; return { status: 'failed', detail: 'probe-threw' } },
  )
  return inflightWarm
}

/**
 * apply 期预热：不 await、不抛错，先把探活/自愈放出去，结果落盘。
 * 桥在启动时掉的概率最高，预热期就自愈好，首轮来问时多半已修好。
 * @returns {Promise<void>}
 */
export function warmTtsProbe(opts = {}) {
  try {
    void probeOnce(opts)
      .then((result) => {
        if (result.status === 'skip') return
        const now = Date.now()
        const next = readTtsState(opts)
        next.checkedAt = toIso(now)
        next.lastResult = result.status
        next.lastAction = result.status === 'healed' ? 'heal-launched'
          : result.status === 'failed' ? 'heal-failed' : 'none'
        next.detail = result.detail ?? null
        // 新一次自愈事件：清掉"已报过"，让接下来第一个会话报一次。
        if (result.status === 'healed') next.healReportedAt = null
        writeTtsState(next, opts)
      })
      .catch(() => { /* 预热失败什么都不留 */ })
  } catch { /* 同上 */ }
  return Promise.resolve()
}

/** 在预算内等一个 promise；超时给 null（只表示"这轮先不说"）。 */
function withBudget(promise, budgetMs) {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null) } }, budgetMs)
    promise.then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v) } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(null) } },
    )
  })
}

/**
 * 新会话首轮检测入口。返回提示文案（空串 = 这轮什么都不说）。
 * 每次新会话都探；同一会话只探一次、只提一次。失败不影响对话。
 *
 * @param {object} [opts]
 * @param {string} [opts.sessionId] 当前会话 id（用内存 Set 做每会话闸门）
 * @param {string} [opts.platform] 默认 process.platform
 * @param {number} [opts.budgetMs] 这轮最多等多久
 * @returns {Promise<string>}
 */
export async function maybeTtsNotice(opts = {}) {
  try {
    const key = sessionKey(opts.sessionId)
    if (checkedSessions.has(key)) return ''
    track(checkedSessions, key)

    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : AWAIT_BUDGET_MS
    const detected = await withBudget(probeOnce(opts), budgetMs)
    if (detected === null) {
      // 预算内没探完：这轮闭嘴；让探针自己跑完并落盘（warm 已接好落盘）。
      void probeOnce(opts).catch(() => {})
      return ''
    }
    if (detected.status === 'skip' || detected.status === 'alive') {
      // 桥活着但预热期刚自愈过 → 报一次"已拉起"（每轮新自愈只报一次）。
      if (detected.status === 'alive' && opts.reportWarmHeal !== false) {
        const state = readTtsState(opts)
        if (state.lastResult === 'healed' && !state.healReportedAt) {
          const now = Date.now()
          writeTtsState({ ...state, healReportedAt: toIso(now), notifiedAt: toIso(now), notifiedSession: key }, opts)
          track(notifiedSessions, key)
          return TTS_HEALED_TIP
        }
      }
      return ''
    }

    const now = Date.now()
    const state = readTtsState(opts)
    const next = {
      ...state,
      checkedAt: toIso(now),
      lastResult: detected.status,
      lastAction: detected.status === 'healed' ? 'heal-launched' : 'heal-failed',
      detail: detected.detail ?? null,
    }
    let tip = ''
    if (detected.status === 'healed') {
      // 本次就是新会话里自愈成功的：报一次，并与预热自愈共用 healReportedAt 去重。
      if (!state.healReportedAt) {
        next.healReportedAt = toIso(now)
        tip = TTS_HEALED_TIP
      }
    } else {
      // 拉起失败：每会话提一次（notifiedSessions 闸门），别跨会话憋着。
      if (!notifiedSessions.has(key)) tip = TTS_FAILED_TIP
    }
    if (tip) {
      next.notifiedAt = toIso(now)
      next.notifiedSession = key
      track(notifiedSessions, key)
    }
    writeTtsState(next, opts)
    return tip
  } catch {
    return ''
  }
}

/* 测试出口：只给单测用。 */
export const __testing = {
  emptyState,
  toIso,
  resetProbe: () => { inflightWarm = null; checkedSessions.clear(); notifiedSessions.clear() },
  resetSessions: () => { checkedSessions.clear(); notifiedSessions.clear() },
}
