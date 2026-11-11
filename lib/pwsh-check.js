/**
 * aiyayi-pwsh-check — 首次对话里的一次性 PowerShell 版本体检（1.5.28）。
 *
 * 需求（李浩 2026-11-11 原话）：首次对话检测里加上——当前用户是 windows 环境就检查
 * PowerShell 版本，低于 PowerShell 7 就建议他自己升级，以便日后更好地协助他。
 *
 * 为什么值得这么一条：本插件在 Windows 上干活全靠 `pwsh`（PowerShell 7）。机器上
 * 只有系统自带 Windows PowerShell 5.1 时，`pwsh` 根本不存在，她的 pwsh 工具直接
 * ENOENT，子智能体跑命令全部失败——用户看到的只是"她又卡住了"，看不到根因。
 * 提前一句话说清，比事后反复排障便宜得多。
 *
 * 设计约束（照需求逐条落实）：
 * 1. **只在 win32 检查**：其他平台 `status:'skip'`，一次子进程都不起。
 * 2. **探的是 `pwsh` 不是 `powershell.exe`**：后者是 5.1，探它永远不会失败。
 * 3. **绝不拖住启动或对话**：子进程 2.5s 超时；调用方还叠了一道更短的 await 预算
 *    （见 maybePwshNotice 的 budgetMs），预算内没结果就这一轮先不说，下一轮/下个
 *    会话再说。探针在 apply 期就预热（warmPwshProbe），等真有人开口时多半早已有值。
 * 4. **只提一次**：结果落 `pwsh.json`（与 updates.json 同目录同风格），提过就记
 *    notifiedAt，之后不再提；装上新版（≥7）连记录一起清掉，降级了才会重新提。
 * 5. **失败只当"没装"**：超时、非零退出、输出解析不出来，一律按 5.1 处理（这就是
 *    "需要提示"），但只影响要不要说那句话，绝不影响对话本身。
 *
 * 判定口径：`major >= 7` 才算够用；`major === null`（没装/超时/解析失败）按旧版算。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pwshFile, resolveRoot } from './home.js'

/** 探针命令：只问主版本号，输出一个数字，别把 $PSVersionTable 整份吐回来。 */
export const PWSH_ARGS = ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']

/** 够用的最低主版本。5.1 是系统自带那个，不是这个。 */
export const MIN_MAJOR = 7

/** 子进程超时：超了就当"没装"处理（需求给的口径是 2~3 秒）。 */
export const PROBE_TIMEOUT_MS = 2500

/** 结果缓存 7 天：过期重查，用来兜住"这期间用户自己装上了 pwsh"这件事。 */
export const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 对话里等她的时候最多等多久（比探针超时更短）。
 * 探针在 apply 期预热过，正常早就完事；这里只是"万一还没完"时别把这一轮拖住。
 */
export const AWAIT_BUDGET_MS = 1200

/**
 * 提示文案。走"系统提示注入"，她读到后用自己口吻顺口提一句——
 * 与 presence 里 💡 关闭思考建议、updates 的新版提醒同一范式。
 * 刻意不写成警告/报错：这不是故障，是件可以顺手改善的小事。
 */
export const PWSH_TIP = [
  '💡 顺口一提：他这台机器上的 PowerShell 还是旧版（5.1），我平时干活靠的是 PowerShell 7。',
  '不用专门宣告，聊到装东西、跑命令、环境这类话题时自然说一句就行：',
  '"装个 PowerShell 7 我干活会更顺，要升级的话我可以帮你弄，说一声就行。"',
  '这条只提这一次，说过了就别再念叨。',
].join('')

/**
 * 解析 `$PSVersionTable.PSVersion.Major` 的输出。
 * 容忍空白、CRLF、以及 pwsh 偶尔混进来的提示噪音（取第一个纯数字行）。
 * @param {unknown} raw 子进程 stdout
 * @returns {number|null} 主版本号；解析不出来给 null（= 按旧版处理）
 */
export function parsePwshMajor(raw) {
  const text = String(raw ?? '')
  // 逐行找第一处 1~2 位纯数字；7.x 的 Major 是 7，5.1 是 5。
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d{1,2})\s*$/.exec(line)
    if (match) {
      const major = Number.parseInt(match[1], 10)
      if (Number.isFinite(major)) return major
    }
  }
  return null
}

/** 这个版本号够不够用（null 一律不够用）。 */
export function isPwshTooOld(major) {
  return !(Number.isFinite(major) && major >= MIN_MAJOR)
}

/**
 * 跑一次探针。**不抛错**：所有失败都折叠成 status。
 * @param {object} [opts]
 * @param {string} [opts.platform] 默认 process.platform（单测可注入）
 * @param {number} [opts.timeoutMs] 默认 PROBE_TIMEOUT_MS
 * @param {Function} [opts.spawnImpl] 默认 node:child_process.spawn（单测注入假进程）
 * @returns {Promise<{status:'skip'|'ok'|'missing'|'timeout'|'error', major:number|null, detail?:string}>}
 */
export function detectPwshVersion(opts = {}) {
  const platform = opts.platform ?? process.platform
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : PROBE_TIMEOUT_MS
  const spawnImpl = typeof opts.spawnImpl === 'function' ? opts.spawnImpl : spawn

  // 硬要求 1：非 Windows 直接跳过，不起子进程。
  if (platform !== 'win32') {
    return Promise.resolve({ status: 'skip', major: null, detail: 'non-win32' })
  }

  return new Promise((resolve) => {
    let settled = false
    let timer = null
    let child = null

    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      resolve(result)
    }

    try {
      child = spawnImpl('pwsh', PWSH_ARGS, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      // spawn 同步抛（极少数环境）也按"没装"处理。
      finish({ status: 'missing', major: null, detail: String(error?.code ?? error?.message ?? error) })
      return
    }

    let stdout = ''

    timer = setTimeout(() => {
      // 超时：先把子进程掐掉再结算，别留个孤儿进程在后台。
      try {
        child?.kill?.()
      } catch {
        /* 掐不掉就算了，反正结果已经定了 */
      }
      finish({ status: 'timeout', major: null, detail: `${timeoutMs}ms` })
    }, timeoutMs)
    // 故意不 unref：这一轮正 await 它，unref 会让定时器在无事可做时被丢弃
    // （坑 #9 的教训：await 的定时器不 unref）。

    child?.on?.('error', (error) => {
      // ENOENT = 机器上只有 Windows PowerShell 5.1，没有 pwsh。
      const code = String(error?.code ?? '')
      finish({
        status: code === 'ENOENT' ? 'missing' : 'error',
        major: null,
        detail: code || String(error?.message ?? error),
      })
    })

    child?.stdout?.on?.('data', (chunk) => {
      stdout += String(chunk)
      // 输出够短，提前收工也无所谓；这里只是别让它无限涨。
      if (stdout.length > 4096) stdout = stdout.slice(0, 4096)
    })

    child?.on?.('close', (code) => {
      if (code !== 0) {
        finish({ status: 'error', major: null, detail: `exit ${code}` })
        return
      }
      const major = parsePwshMajor(stdout)
      if (major === null) {
        finish({ status: 'error', major: null, detail: 'unparsable' })
        return
      }
      finish({ status: 'ok', major })
    })
  })
}

/* ------------------------------------------------------------------ *
 * 状态落盘（pwsh.json，与 updates.json 同目录同风格）
 * ------------------------------------------------------------------ */

/** 状态文件形状：{ checkedAt: ISO|null, major: number|null, notifiedAt: ISO|null, notifiedMajor: number|null } */
function emptyState() {
  return { checkedAt: null, major: null, notifiedAt: null, notifiedMajor: null }
}

function toIso(now) {
  return new Date(now).toISOString()
}

/**
 * 读状态。文件不在/坏了/根不可达 → 空状态（等于"还没查过"）。
 * @returns {{checkedAt:string|null, major:number|null, notifiedAt:string|null, notifiedMajor:number|null}}
 */
export function readPwshState() {
  try {
    const file = pwshFile()
    if (!file || !existsSync(file)) return emptyState()
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const major = Number.isFinite(parsed?.major) ? Number(parsed.major) : null
    return {
      checkedAt: typeof parsed?.checkedAt === 'string' ? parsed.checkedAt : null,
      major,
      notifiedAt: typeof parsed?.notifiedAt === 'string' ? parsed.notifiedAt : null,
      notifiedMajor: Number.isFinite(parsed?.notifiedMajor) ? Number(parsed.notifiedMajor) : null,
    }
  } catch {
    return emptyState()
  }
}

/**
 * 写状态。目录缺就补建（1.5.0 的教训：目录不在就永远不落盘 → 每次会话都重提）。
 * 写不进去只当没记，下次再提一次，无伤大雅。
 * @returns {boolean} 是否落盘成功
 */
export function writePwshState(state) {
  try {
    const file = pwshFile()
    if (!file) return false
    const rootState = resolveRoot()
    if (!rootState.reachable) return false
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 决策：纯函数，单测直接打
 * ------------------------------------------------------------------ */

/** 缓存是否还新鲜（checkedAt 解析不出来就当过期）。 */
export function isPwshStateFresh(state, now = Date.now(), ttlMs = STATE_TTL_MS) {
  const at = Date.parse(String(state?.checkedAt ?? ''))
  if (!Number.isFinite(at)) return false
  return now - at < ttlMs
}

/**
 * 决定这一轮要不要探、要不要说。纯函数，不碰盘。
 *
 * @param {object} input
 * @param {object} input.state 当前状态（readPwshState 的形状）
 * @param {string} input.platform process.platform
 * @param {number} [input.now] 毫秒时间戳
 * @param {number} [input.ttlMs] 缓存有效期
 * @returns {{needProbe:boolean, notice:boolean, stale:boolean, reason:string}}
 */
export function decidePwshNotice({ state, platform, now = Date.now(), ttlMs = STATE_TTL_MS }) {
  // 硬要求 1：非 Windows 一律安静。
  if (platform !== 'win32') {
    return { needProbe: false, notice: false, stale: false, reason: 'non-win32' }
  }
  const fresh = isPwshStateFresh(state, now, ttlMs)
  if (!fresh) {
    // 没查过 / 过期：先探。缓存过期只为了捞"这期间装上了 pwsh"，
    // 不代表要重新唠叨一遍——说没说过由 notifiedAt 单独管。
    return { needProbe: true, notice: false, stale: true, reason: state?.checkedAt ? 'stale' : 'never' }
  }
  if (!isPwshTooOld(state?.major)) {
    return { needProbe: false, notice: false, stale: false, reason: 'ok' }
  }
  if (state?.notifiedAt) {
    return { needProbe: false, notice: false, stale: false, reason: 'already-notified' }
  }
  return { needProbe: false, notice: true, stale: false, reason: 'too-old' }
}

/* ------------------------------------------------------------------ *
 * 编排：单飞探针 + 有限预算的 await
 * ------------------------------------------------------------------ */

/** 单飞：同一进程里并发调用共用一次探针。 */
let inflightProbe = null

/** 直接用 inflight 的探针（没有就起一个）。 */
function probeOnce(opts) {
  if (inflightProbe) return inflightProbe
  inflightProbe = detectPwshVersion(opts).then(
    (result) => {
      inflightProbe = null
      return result
    },
    () => {
      inflightProbe = null
      return { status: 'error', major: null, detail: 'probe-threw' }
    },
  )
  return inflightProbe
}

/**
 * apply 期预热：**不 await**、不抛错，纯粹让第一个会话来的时候缓存已经热了。
 * 与 updates.js 开机预热 registry 同一个思路。
 * @param {object} [opts] 透传给 detectPwshVersion（单测用）
 * @returns {Promise<void>}
 */
export function warmPwshProbe(opts = {}) {
  try {
    if ((opts.platform ?? process.platform) !== 'win32') return Promise.resolve()
    void probeOnce(opts)
      .then((result) => {
        // 预热结果也落盘：省得第一个会话再多跑一次。
        // 只在"还没有新鲜缓存"时写，别拿预热覆盖掉别人刚写的结果。
        if (result.status === 'skip') return
        const current = readPwshState()
        if (isPwshStateFresh(current)) return
        const probeMajor = result.status === 'ok' ? result.major : null
        const next = {
          ...current,
          checkedAt: toIso(Date.now()),
          major: probeMajor,
        }
        if (!isPwshTooOld(probeMajor)) {
          // 够用了：把"提过"的记录清掉，将来万一降级还能再提一次。
          next.notifiedAt = null
          next.notifiedMajor = null
        }
        writePwshState(next)
      })
      .catch(() => {
        /* 预热失败什么都不做——检测失败不该留下任何痕迹。 */
      })
  } catch {
    /* 同上 */
  }
  return Promise.resolve()
}

/** 把探针结果并进状态。 */
function mergeProbe(state, detection, now) {
  const major = detection.status === 'ok' ? detection.major : null
  const next = { ...state, checkedAt: toIso(now), major }
  if (!isPwshTooOld(major)) {
    next.notifiedAt = null
    next.notifiedMajor = null
  }
  return next
}

/** 在预算内等一个 promise；超时给 null（不等于失败，只是"这轮先不说"）。 */
function withBudget(promise, budgetMs) {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      resolve(null)
    }, budgetMs)
    promise.then(
      (value) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

/**
 * 首次对话检测的入口。返回提示文案（空串 = 这轮什么都不说）。
 *
 * 全程 try/catch + 有限预算：**任何失败都只是"不说这句话"**，绝不影响对话。
 *
 * @param {object} [opts]
 * @param {string} [opts.platform] 默认 process.platform
 * @param {number} [opts.now] 毫秒时间戳
 * @param {number} [opts.ttlMs] 缓存有效期
 * @param {number} [opts.budgetMs] 这轮最多为探针等多久
 * @param {number} [opts.timeoutMs] 子进程超时
 * @param {Function} [opts.spawnImpl] 单测注入
 * @returns {Promise<string>} 提示文案或空串
 */
export async function maybePwshNotice(opts = {}) {
  try {
    const platform = opts.platform ?? process.platform
    const now = Number.isFinite(opts.now) ? opts.now : Date.now()
    const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : STATE_TTL_MS
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : AWAIT_BUDGET_MS

    let state = readPwshState()
    let decision = decidePwshNotice({ state, platform, now, ttlMs })

    if (decision.needProbe) {
      const detected = await withBudget(probeOnce(opts), budgetMs)
      if (detected === null) {
        // 预算内没探完：这一轮闭嘴，探针自己会跑完并在下次写入。
        // 顺手把结果接到落盘上，别让它白跑。
        void probeOnce(opts)
          .then((result) => {
            if (result?.status === 'skip') return
            const latest = readPwshState()
            if (isPwshStateFresh(latest)) return
            writePwshState(mergeProbe(latest, result, Date.now()))
          })
          .catch(() => {})
        return ''
      }
      state = mergeProbe(state, detected, now)
      writePwshState(state)
      decision = decidePwshNotice({ state, platform, now, ttlMs })
    }

    if (!decision.notice) return ''

    // 记"说过了"——这一步失败也只影响下次会不会重复提，不影响这轮说话。
    writePwshState({ ...state, notifiedAt: toIso(now), notifiedMajor: state.major ?? null })
    return PWSH_TIP
  } catch {
    return ''
  }
}

/* 测试出口：只给单测用。 */
export const __testing = {
  emptyState,
  mergeProbe,
  withBudget,
  probeOnce,
  toIso,
  /** 清掉单飞状态（单测里上一个 hang 住的探针会挡住下一个，必须能重置）。 */
  resetProbe: () => {
    inflightProbe = null
  },
}
