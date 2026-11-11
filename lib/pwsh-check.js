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
 * 2. **优先探 `pwsh`，探不到再退回 `powershell.exe`**（1.5.31 修）：只探 pwsh 的话，
 *    机器上只有系统自带 5.1 时结果就是 `major:null`——数字空着，"没装 pwsh"和
 *    "装了但解析失败"分不出来，用户看到的提醒底层判断是空的。退回 5.1 拿真实
 *    的 5，"低于 7"才是拿数据说话。（1.5.28 的注释写的"探它永远不会失败"是错的。）
 * 3. **绝不拖住启动或对话**：子进程 2.5s 超时；调用方还叠了一道更短的 await 预算
 *    （见 maybePwshNotice 的 budgetMs），预算内没结果就这一轮先不说，下一轮/下个
 *    会话再说。探针在 apply 期就预热（warmPwshProbe），等真有人开口时多半早已有值。
 * 4. **只提一次**：结果落 `pwsh.json`（与 updates.json 同目录同风格），提过就记
 *    notifiedAt，之后不再提；装上新版（≥7）连记录一起清掉，降级了才会重新提。
 * 5. **失败不静默**：超时、非零退出、输出解析不出来，一律按 5.1 处理（这就是
 *    "需要提示"），但状态里必须留下 `status` / `source` / `detail`——「为什么没拿到
 *    数字」要能查，不能再是一个谁也不认识的 `major:null`（1.5.31 修）。
 *
 * 判定口径：`major >= 7` 才算够用；`major === null`（没装/超时/解析失败）按旧版算。
 *
 * 绝对路径候选的 lstat 预筛思路（isSpawnableFile）派生自 dsh-ops
 * （MIT, Copyright (c) 2026 T-Auto and the dsh-ops contributors）。
 */
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pwshFile, resolveRoot } from './home.js'

/**
 * 探针命令：只问主版本号，输出一个数字，别把 $PSVersionTable 整份吐回来。
 *
 * 前置 `[Console]::OutputEncoding`：powershell.exe 5.1 默认按控制台代码页（本机是
 * ANSI/GBK）往管道里写，中文环境下一遇到非 ASCII 就是乱码；显式设成 UTF-8 后
 * 输出稳定是单字节 ASCII，解析不再看运气。设不上（极少数无控制台场景）就 try 吞掉，
 * 后面还有 BOM/UTF-16 解码兜底。
 */
export const PWSH_COMMAND = 'try{[Console]::OutputEncoding=[Text.Encoding]::UTF8}catch{};$PSVersionTable.PSVersion.Major'
export const PWSH_ARGS = ['-NoProfile', '-Command', PWSH_COMMAND]

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
 * 按探测到的真实主版本号给提示文案（1.5.31）。
 * 5.x / null 沿用原文案；其他旧版本（6.x 之类）把括号里的版本号换掉，别报错版本。
 * @param {number|null} major
 * @returns {string}
 */
export function pwshTipFor(major) {
  if (!Number.isFinite(major) || major === 5) return PWSH_TIP
  return PWSH_TIP.replace('（5.1）', `（${major}.x）`)
}

/**
 * 把子进程吐出来的原始字节解成文本。**不抛错**。
 *
 * 为什么要自己解而不是 `String(chunk)`：`String(Buffer)` 走的是 UTF-8 解码，
 * 遇到 UTF-16LE 输出（某些被策略改过控制台的机器）会得到一堆夹 NUL 的乱码；
 * powershell.exe 5.1 在中文控制台下还可能吐 UTF-8 BOM。这里按 BOM 判编码，
 * 没有 BOM 就当 UTF-8、失败再退 GBK（Windows 中文环境的 ANSI 代码页）。
 *
 * @param {Buffer|string} raw
 * @returns {string}
 */
export function decodeOutput(raw) {
  if (typeof raw === 'string') return raw.replace(/^\uFEFF/, '')
  if (!raw || typeof raw.length !== 'number') return ''
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
  if (buf.length === 0) return ''
  // UTF-16LE BOM：FF FE
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le')
  }
  // UTF-16BE BOM：FE FF（Node 不原生支持 utf16be，手工翻字节）
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2))
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i]
      swapped[i] = swapped[i + 1]
      swapped[i + 1] = t
    }
    return swapped.toString('utf16le')
  }
  // UTF-8 BOM：EF BB BF
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8')
  }
  const utf8 = buf.toString('utf8')
  // 解出替换字符 = 不是合法 UTF-8，退回 GBK 再试（中文 Windows 的 ANSI 页）。
  if (utf8.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk', { fatal: false }).decode(buf)
      if (gbk && !gbk.includes('\uFFFD')) return gbk
    } catch {
      /* 该 Node 不带 gbk 解码器（full-icu 缺失）就用 UTF-8 的结果 */
    }
  }
  return utf8
}

/**
 * 解析 `$PSVersionTable.PSVersion.Major` 的输出。
 * 容忍 BOM、UTF-16、CRLF、以及启动噪音（取第一处独立的 1~2 位数字）。
 * @param {unknown} raw 子进程 stdout（Buffer 或字符串都行）
 * @returns {number|null} 主版本号；解析不出来给 null（= 按旧版处理）
 */
export function parsePwshMajor(raw) {
  let text = decodeOutput(raw)
  if (text.length === 0) return null
  // 先把 BOM/零宽字符清干净，免得数字被不可见字符包住匹配不上。
  text = text.replace(/[\uFEFF\u200B]/g, '')
  // 逐行找第一处 1~2 位纯数字；7.x 的 Major 是 7，5.1 是 5。
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d{1,2})\s*$/.exec(line)
    if (match) {
      const major = Number.parseInt(match[1], 10)
      if (Number.isFinite(major)) return major
    }
  }
  // 整行匹配不上再兜一次（1.5.31）：只认"看起来就是个版本号"的整串，比如
  // `7.4.1`——封顶防误判，纯噪音里的数字（"WARNING: 12 things"）不算数，
  // 宁可 return null 让它走降级，也不要瞎猜出一个 ≥7 把提醒吞掉。
  const loose = /^\s*(\d{1,2})(?:\.\d+)+/.exec(text)
  if (loose) {
    const major = Number.parseInt(loose[1], 10)
    if (Number.isFinite(major)) return major
  }
  return null
}

/** 这个版本号够不够用（null 一律不够用）。 */
export function isPwshTooOld(major) {
  return !(Number.isFinite(major) && major >= MIN_MAJOR)
}

/**
 * 这是不是一个"能 spawn 的条目"（1.5.31，思路派生自 dsh-ops 的 isSpawnableFile）。
 *
 * 为什么不用 existsSync/statSync：Windows Store 版 pwsh 的入口是一个 0 字节的
 * app execution alias（符号链接形态），statSync 在普通用户上下文里可能直接抛
 * EACCES → existsSync 吞异常返回 false，把"已装好"误判成"没装"。lstat 认符号链接本身。
 *
 * 注意：这里**只做快速筛除明显不存在的候选**（省掉 N 次子进程超时），命中与否
 * 都不代表一定能跑起来——真正作数的仍是 spawn 的结果。lstat 也失败时（alias 场景）
 * 一律返回 true，宁可多起一个进程，也不要把真 alias 筛出去。
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isSpawnableFile(path) {
  if (typeof path !== 'string' || path.length === 0) return false
  try {
    const stat = lstatSync(path)
    return stat.isFile() || stat.isSymbolicLink()
  } catch (error) {
    const code = String(error?.code ?? '')
    // ENOENT/ENOTDIR = 这条路径确实不存在，可以筛掉；
    // EACCES/EPERM 等 = 看不到不等于没有（WindowsApps 的 alias），放行让 spawn 去判。
    return code !== 'ENOENT' && code !== 'ENOTDIR'
  }
}

/**
 * pwsh 已知安装位置（**绝对路径兜底**，坑 #75）。
 *
 * 为什么需要：PATH 里找不到 `pwsh` **不等于没装**。实测（2026-11-11 本机）：
 * 用户刚用 winget 装好 PowerShell 7.7.0（msstore 源，入口是
 * `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`，一个 0 字节的 app execution
 * alias），但 DSH 宿主进程是**装之前**启动的，继承的旧环境变量里没有
 * `%LOCALAPPDATA%\Microsoft\WindowsApps` 这一项 → `spawn('pwsh')` 必然 ENOENT。
 * 只看 PATH 就会把"已装好"误判成"没装"，对用户弹一条**错误的**提示。
 *
 * 所以 ENOENT 之后再按下面这些已知位置挨个试绝对路径；命中就视为已装。
 * 顺序按"传统 MSI 装法"→"预览版"→"msstore alias"→"scoop / chocolatey"（1.5.31
 * 补了后两种包管理器的落点，它们的 shim 也经常不在宿主进程的 PATH 里）。
 *
 * @param {object} [env] 默认 process.env（单测可注入）
 * @returns {string[]} 绝对路径候选（已去重、去掉解析不出盘符的）
 */
export function pwshPathCandidates(env = process.env) {
  const candidates = []
  const push = (base, ...rest) => {
    if (typeof base !== 'string' || base.length === 0) return
    const full = join(base, ...rest)
    if (!candidates.includes(full)) candidates.push(full)
  }

  // ① 传统 MSI 安装位置（PowerShell 7 正式版）。
  push(env?.ProgramFiles, 'PowerShell', '7', 'pwsh.exe')
  // ② 预览版。
  push(env?.ProgramFiles, 'PowerShell', '7-preview', 'pwsh.exe')
  // ③ 32 位宿主可能看到的重定向目录，顺手覆盖。
  push(env?.['ProgramFiles(x86)'], 'PowerShell', '7', 'pwsh.exe')
  // ④ msstore / winget 的 app execution alias（本机实测踩过这条，坑 #75）。
  push(env?.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pwsh.exe')
  // ⑤ scoop：shim 目录 + 常见持久安装位置（1.5.31）。
  push(env?.USERPROFILE, 'scoop', 'shims', 'pwsh.exe')
  push(env?.USERPROFILE, 'scoop', 'apps', 'powershell', 'current', 'pwsh.exe')
  // ⑥ chocolatey（1.5.31）。bin 下是 shim，lib 下是真实安装目录。
  push(env?.ProgramData, 'chocolatey', 'bin', 'pwsh.exe')

  // ⑦ msstore 包目录（父级点名要试的 `%ProgramFiles%\WindowsApps\Microsoft.PowerShell_*`）。
  //   这是 winget/商店装的 PowerShell 落盘位置，目录名形如 Microsoft.PowerShell_8wekyb3d8bbwe_x_x_x_<hash>。
  //   注意：Program Files\WindowsApps 通常只有 TrustedInstaller 能读，普通用户大概率
  //   readdir 直接 EACCES——静默跳过（当不存在处理），绝不因为这个把探测拖垮。
  const winApps = env?.ProgramFiles
  if (typeof winApps === 'string' && winApps.length > 0) {
    try {
      const entries = readdirSync(join(winApps, 'WindowsApps'), { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || !String(entry.name).startsWith('Microsoft.PowerShell')) continue
        push(join(winApps, 'WindowsApps', entry.name), 'pwsh.exe')
      }
    } catch {
      /* 读不到（EACCES/不存在/权限）就当没有这层 */
    }
  }

  return candidates
}

/**
 * 单次探测：跑一条命令拿主版本号。**不抛错**。
 * @param {string} command 命令名或绝对路径
 * @param {number} timeoutMs
 * @param {Function} spawnImpl
 * @returns {Promise<{status:'ok'|'missing'|'timeout'|'error', major:number|null, detail?:string}>}
 */
function probeCommand(command, timeoutMs, spawnImpl) {
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
      child = spawnImpl(command, PWSH_ARGS, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      // spawn 同步抛（极少数环境）也按"这条命令没有"处理，让调用方去试下一条。
      finish({ status: 'missing', major: null, detail: String(error?.code ?? error?.message ?? error) })
      return
    }

    let stdout = ''
    let rawChunks = []

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
      // ENOENT = 这条命令找不到（PATH 没它 / 这个绝对路径不存在）。
      const code = String(error?.code ?? '')
      finish({
        status: code === 'ENOENT' ? 'missing' : 'error',
        major: null,
        detail: code || String(error?.message ?? error),
      })
    })

    child?.stdout?.on?.('data', (chunk) => {
      // 先留原始字节（1.5.31）：编码判定（BOM / UTF-16 / GBK）必须在字节上做，
      // 提前 String(chunk) 就等于先按 UTF-8 猜一遍，猜错的信息就没了。
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      rawChunks.push(buf)
      // 输出够短，提前收工也无所谓；这里只是别让它无限涨。
      const total = rawChunks.reduce((sum, b) => sum + b.length, 0)
      if (total > 8192) {
        rawChunks = [Buffer.concat(rawChunks).subarray(0, 8192)]
      }
      stdout = ''
    })

    child?.on?.('close', (code) => {
      if (code !== 0) {
        finish({ status: 'error', major: null, detail: `exit ${code}` })
        return
      }
      const raw = Buffer.concat(rawChunks)
      const major = parsePwshMajor(raw)
      if (major === null) {
        // 1.5.31：解析不出来必须留下**原文**（截断、转义），不再只给一个 'unparsable'。
        const preview = decodeOutput(raw).replace(/\s+/g, ' ').trim().slice(0, 120)
        finish({ status: 'error', major: null, detail: `unparsable: ${preview || '<empty>'}` })
        return
      }
      finish({ status: 'ok', major })
    })
  })
}

/**
 * 跑一次探针。**不抛错**：所有失败都折叠成 status，并带上 source 说明从哪来的。
 *
 * 顺序（1.5.31）：`pwsh`（走 PATH）→ 已知绝对路径候选 → `powershell.exe`（系统自带 5.1）。
 * 前三步全落空才是真的没探到东西。最后这一级是修 `major:null` 的关键：机器上只有
 * 5.1 时也能拿到**真实数字 5**，"低于 7"才是有依据的判断，而不是 null 碰巧当旧版。
 *
 * 绝对路径兜底只在 ENOENT 上触发——ENOENT 是毫秒级返回；如果 pwsh 存在但卡住，那是
 * `timeout`，不触发兜底（否则每条候选都要等满 2.5s，把对话拖死）。
 *
 * @param {object} [opts]
 * @param {string} [opts.platform] 默认 process.platform（单测可注入）
 * @param {number} [opts.timeoutMs] 默认 PROBE_TIMEOUT_MS
 * @param {Function} [opts.spawnImpl] 默认 node:child_process.spawn（单测注入假进程）
 * @param {object} [opts.env] 默认 process.env（单测注入）
 * @param {boolean} [opts.noFallback] 关掉绝对路径兜底（单测对照用）
 * @param {boolean} [opts.noLegacy] 关掉 powershell.exe 那一级（单测对照用）
 * @param {string} [opts.legacyCommand] 覆盖 5.1 的命令名（单测注入）
 * @param {string[]} [opts.candidates] 覆盖绝对路径候选（单测注入）
 * @returns {Promise<{status:'skip'|'ok'|'missing'|'timeout'|'error', major:number|null, detail?:string, via?:string, source?:string}>}
 */
export function detectPwshVersion(opts = {}) {
  const platform = opts.platform ?? process.platform
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : PROBE_TIMEOUT_MS
  const spawnImpl = typeof opts.spawnImpl === 'function' ? opts.spawnImpl : spawn
  const legacyCommand = typeof opts.legacyCommand === 'string' && opts.legacyCommand.length > 0
    ? opts.legacyCommand
    : 'powershell.exe'

  // 硬要求 1：非 Windows 直接跳过，不起子进程。
  if (platform !== 'win32') {
    return Promise.resolve({ status: 'skip', major: null, detail: 'non-win32', source: 'skip' })
  }

  return (async () => {
    const first = await probeCommand('pwsh', timeoutMs, spawnImpl)
    if (first.status === 'ok') return { ...first, via: 'path', source: 'pwsh' }
    if (first.status === 'timeout') return { ...first, source: 'pwsh' }

    const tried = []
    if (first.status === 'missing' && opts.noFallback !== true) {
      const candidates = Array.isArray(opts.candidates) ? opts.candidates : pwshPathCandidates(opts.env ?? process.env)
      for (const candidate of candidates) {
        if (typeof candidate !== 'string' || candidate.length === 0) continue
        tried.push(candidate)
        // 预筛只是省时间：明显不存在的路径（ENOENT/ENOTDIR）直接跳过，不必起进程等它
        // 报错。**但 lstat 也看不透的（EACCES 等）一律放行**，让 spawn 自己去判——
        // WindowsApps 的 0 字节 app execution alias 就是这种（坑 #75），筛掉它就等于
        // 把"已装好"判成"没装"。真正作数的永远是 spawn 的结果，不是预筛。
        if (!isSpawnableFile(candidate)) continue
        const result = await probeCommand(candidate, timeoutMs, spawnImpl)
        if (result.status === 'ok') return { ...result, via: candidate, source: 'pwsh-path' }
        // 候选存在但跑不通（超时/非零退出）：别再耗下去了，交给下一级。
        if (result.status === 'timeout') break
      }
    }

    // 二级兜底（1.5.31）：系统自带 Windows PowerShell 5.1。它几乎必然存在，
    // 问到就是真实主版本号 5 —— 比 null 有用得多。
    if (opts.noLegacy !== true) {
      const legacy = await probeCommand(legacyCommand, timeoutMs, spawnImpl)
      if (legacy.status === 'ok') return { ...legacy, via: legacyCommand, source: 'windows-powershell' }
      // 5.1 也探不出来：把两个失败原因都带上，别丢信息。
      return {
        status: legacy.status === 'missing' ? 'missing' : legacy.status,
        major: null,
        detail: `pwsh: ${first.detail ?? first.status}; fallback tried: ${tried.length > 0 ? tried.join(' | ') : '(none)'}; ${legacyCommand}: ${legacy.detail ?? legacy.status}`,
        source: 'none',
      }
    }

    // 兜底也没命中：保持原来的 missing，并把试过哪些绝对路径记进 detail，便于排障。
    return {
      ...first,
      detail: tried.length > 0 ? `ENOENT (fallback tried: ${tried.join(' | ')})` : 'ENOENT',
      source: 'none',
    }
  })()
}

/* ------------------------------------------------------------------ *
 * 状态落盘（pwsh.json，与 updates.json 同目录同风格）
 * ------------------------------------------------------------------ */

/**
 * 状态文件形状（version 2，1.5.31）：
 * `{ version:2, checkedAt, major, status, source, detail, notifiedAt, notifiedMajor }`
 *
 * version 2 新增 `status` / `source` / `detail`：老版本只存 `major:null`，"为什么是 null"
 * 一点线索都不留。现在至少能看出是「没装 pwsh 但 5.1 探到了(5)」还是「压根没探到」。
 */
const STATE_VERSION = 2

function emptyState() {
  return {
    version: STATE_VERSION,
    checkedAt: null,
    major: null,
    status: null,
    source: null,
    detail: null,
    notifiedAt: null,
    notifiedMajor: null,
  }
}

function toIso(now) {
  return new Date(now).toISOString()
}

/**
 * 读状态。文件不在/坏了/根不可达/是旧格式 → 空状态（等于"还没查过"，会重测）。
 *
 * **向后兼容**：1.5.30 及以前写的 `pwsh.json` 没有 `version` 字段，那是 `major:null`
 * 的旧账（正是本版要修的 bug 留下的）。读到就当作"没查过"重测一遍，不崩、也不
 * 拿一份不可信的旧结果继续判断。
 *
 * @returns {{version:number, checkedAt:string|null, major:number|null, status:string|null, source:string|null, detail:string|null, notifiedAt:string|null, notifiedMajor:number|null}}
 */
export function readPwshState() {
  try {
    const file = pwshFile()
    if (!file || !existsSync(file)) return emptyState()
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    // 旧格式（无 version）：值不可信，当没查过。
    if (!Number.isFinite(parsed?.version) || Number(parsed.version) < STATE_VERSION) {
      // 「提过没」这条要保住：旧账里 notifiedAt 是准的，别因为升级了就再唠叨一遍。
      const kept = emptyState()
      kept.notifiedAt = typeof parsed?.notifiedAt === 'string' ? parsed.notifiedAt : null
      kept.notifiedMajor = Number.isFinite(parsed?.notifiedMajor) ? Number(parsed.notifiedMajor) : null
      return kept
    }
    const major = Number.isFinite(parsed?.major) ? Number(parsed.major) : null
    return {
      version: STATE_VERSION,
      checkedAt: typeof parsed?.checkedAt === 'string' ? parsed.checkedAt : null,
      major,
      status: typeof parsed?.status === 'string' ? parsed.status : null,
      source: typeof parsed?.source === 'string' ? parsed.source : null,
      detail: typeof parsed?.detail === 'string' ? parsed.detail : null,
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
    // 版本戳由这里统一盖（1.5.31）：调用方不必每次记得写 version，
    // 免得写出一个"看起来像旧格式"的文件、下次又被判成没查过。
    writeFileSync(file, `${JSON.stringify({ ...state, version: STATE_VERSION }, null, 2)}\n`, 'utf8')
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
          version: STATE_VERSION,
          checkedAt: toIso(Date.now()),
          major: probeMajor,
          status: result.status ?? null,
          source: result.source ?? null,
          detail: result.detail ?? null,
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
  const major = detection?.status === 'ok' ? detection.major : null
  const next = {
    ...state,
    version: STATE_VERSION,
    checkedAt: toIso(now),
    major,
    // 1.5.31：把"为什么是这个数"一并记下，下次排障不用再猜。
    status: detection?.status ?? null,
    source: detection?.source ?? detection?.via ?? null,
    detail: detection?.detail ?? null,
  }
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
    // 1.5.31：文案按真实主版本号给。探到 5 就说 5.1（原样），探到 6 说 6.x，
    // 探不到（null）仍按旧版处理，用默认文案。
    return pwshTipFor(state.major)
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
