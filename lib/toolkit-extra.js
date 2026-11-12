/**
 * aiyayi-toolkit / 两个具体工具（1.5.41 新增）：
 *   · `watch_read` —— **异步**：手表取数。立刻返回 taskId，后台跑 skg_probe 的 watch_read.py，
 *     跑完/超时/失败都经 followup 投一条消息回会话（helper 见 lib/toolkit-async.js）。
 *   · `mem_sync`   —— **同步**：记忆仓库提交 + 推双远端。几秒内完成，直接返回结果。
 *
 * 为什么一个异步一个同步，见 docs/经验-工具真异步与宿主同步await.md：
 * 宿主 agent loop 同步 await 一批工具（坑 #79），**耗时几十秒到几分钟的活必须异步**，
 * 否则这一轮的下一次模型请求发不出去；而 git status/diff/commit/push 这类几秒的活，
 * 同步返回反而更省事（不用多一轮 followup，也不用惦记 task 表）。
 *
 * 两个工具的输出形状一律从 shapeXxxOutput 单一出口归一（坑 #78 的教训）：
 *   · type 只能单字符串；properties 全列进 required；additionalProperties:false 时不许返回未声明字段；
 *   · 可空语义用**约定值**（空串 / -1 / []）承担，绝不用 null 或"字段缺失"。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRoot } from './home.js'
import { startDetachedTask } from './toolkit-async.js'

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/** 插件自身的 lib 目录（用于推导仓库布局下的 skg_probe 位置，不写死盘符）。 */
const LIB_DIR = dirname(fileURLToPath(import.meta.url))

/* ================================================================== *
 * 一、watch_read：异步手表取数
 * ================================================================== */

/** 手表脚本目录的候选（配置优先；其次按插件位置推导仓库布局，绝不写死盘符路径）。 */
export function resolveWatchDir(cfg = {}) {
  const configured = String(cfg.watchDir ?? '').trim()
  if (configured) {
    const dir = resolve(configured)
    return { dir, source: 'config', exists: safeIsDir(dir) }
  }
  const candidates = [
    join(LIB_DIR, '..', '..', 'skg_probe', 'ble_direct'), // gh_repo/lib → ../../skg_probe
    join(LIB_DIR, '..', '..', '..', 'skg_probe', 'ble_direct'),
  ]
  for (const dir of candidates) {
    const abs = resolve(dir)
    if (safeIsDir(abs)) return { dir: abs, source: 'auto', exists: true }
  }
  return { dir: resolve(candidates[0]), source: 'auto', exists: false }
}

function safeIsDir(dir) {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** 手表脚本入口文件名（固定，但允许配置换名）。 */
export function watchScriptPath(dir, cfg = {}) {
  return join(dir, String(cfg.watchScript ?? 'watch_read.py'))
}

/** 参数夹取：轮数 / 监听秒数（防本体传个 9999 把任务挂死）。 */
export function normalizeWatchArgs(args, cfg = {}) {
  const rounds = Number.isInteger(args?.rounds) && args.rounds > 0
    ? Math.min(args.rounds, Number(cfg.watchMaxRounds) || 20)
    : (Number(cfg.watchDefaultRounds) || 6)
  const listenRaw = Number.isInteger(args?.listenSec) && args.listenSec >= 0 ? args.listenSec : null
  const listenSec = listenRaw === null
    ? (Number(cfg.watchDefaultListenSec) || 0)
    : Math.min(listenRaw, Number(cfg.watchMaxListenSec) || 120)
  return { rounds, listenSec }
}

/** 拼命令行参数（数组形式，绝不拼 shell 字符串）。 */
export function buildWatchArgv(scriptPath, { rounds, listenSec }) {
  return [
    scriptPath,
    '--scan-rounds', String(rounds),
    '--scan-sec', '10',
    '--listen', String(listenSec),
  ]
}

/** 关键指标行抽取（脚本自己会打「读取汇总」段，这里只挑能读懂的几行，不做复杂解析）。 */
const WATCH_KEY_PATTERNS = [
  /^连接[:：]/,
  /^电量[:：]/,
  /^设备名[:：]/,
  /^固件[:：]/,
  /^版本[:：]/,
  /^今日运动[:：]/,
  /^今日汇总/,
  /^昨日汇总/,
  /^目标步数[:：]/,
  /^今日分时步数/,
  /^昨日分时步数/,
  /^睡眠[:：]/,
  /^血氧历史[:：]/,
  /^历史心率[:：]/,
  /^实时心率流/,
  /^通知帧/,
]

export function extractWatchKeyLines(stdout, maxLines = 24) {
  const lines = String(stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const keys = []
  for (const line of lines) {
    if (WATCH_KEY_PATTERNS.some((re) => re.test(line))) keys.push(line)
    if (keys.length >= maxLines) break
  }
  return keys
}

/** 修掉 Windows 控制台常见的编码噪声（`\ufffd`）：只删字符，不改语义。 */
function scrub(text) {
  return String(text ?? '').replace(/\uFFFD/g, '').trim()
}

/**
 * 组装投回会话的正文。约定：
 *   · 有汇总行 → 先列关键指标，再附「脚本输出末尾」一段（够本体读懂，不做复杂解析）；
 *   · 没有汇总行（脚本崩了/根本没连上）→ 原样给末尾输出 + 退出码。
 */
export function composeWatchReport({ exitCode, timedOut, stdout, stderr, keyLines, timeoutMs, rounds, listenSec }) {
  const head = timedOut
    ? `【watch_read 超时】超过 ${Math.round((timeoutMs ?? 0) / 1000)} 秒没跑完，已杀进程。手表可能没戴、没在广播，或者手机 App 还占着蓝牙连接。`
    : exitCode === 0
      ? `【watch_read 取数结果】${rounds} 轮扫描 / 监听 ${listenSec} 秒，脚本正常结束。`
      : `【watch_read 失败】脚本退出码 ${exitCode}，多半是没扫描到手表（手表没戴 / 没在广播 / 手机 App 占着连接）。`
  const parts = [head]
  if (keyLines && keyLines.length > 0) {
    parts.push('--- 关键指标 ---')
    parts.push(keyLines.join('\n'))
  }
  const tail = scrub(stdout).split(/\r?\n/).slice(-24).join('\n')
  if (tail) {
    parts.push('--- 脚本输出末尾 ---')
    parts.push(tail)
  }
  const errTail = scrub(stderr).split(/\r?\n/).slice(-8).join('\n')
  if (errTail) {
    parts.push('--- stderr ---')
    parts.push(errTail)
  }
  return parts.join('\n')
}

/** 杀进程树（Windows 上 child.kill 只杀 shell，不杀孙进程）。 */
function killTree(child) {
  try {
    if (process.platform === 'win32' && child?.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      child?.kill?.('SIGKILL')
    }
  } catch {
    /* 已经退了就算了 */
  }
  try {
    child?.kill?.()
  } catch {
    /* 同上 */
  }
}

/**
 * 跑一次手表脚本（异步，带任务级总超时）。
 * @returns {Promise<{exitCode:number, timedOut:boolean, stdout:string, stderr:string, spawnError:string}>}
 */
export function runWatchScript({ python, argv, cwd, timeoutMs }) {
  return new Promise((done) => {
    let child
    try {
      child = spawn(python, argv, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      })
    } catch (error) {
      done({ exitCode: -1, timedOut: false, stdout: '', stderr: '', spawnError: `Python 进程拉起失败：${error?.message ?? error}` })
      return
    }
    let out = ''
    let err = ''
    let settled = false
    let timedOut = false
    const cap = 256 * 1024
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      settle({ exitCode: -1, timedOut: true, spawnError: '' })
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    const settle = (patch) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done({ exitCode: -1, timedOut: false, stdout: out, stderr: err, spawnError: '', ...patch })
    }

    child.stdout?.on('data', (chunk) => {
      if (out.length < cap) out += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      if (err.length < cap) err += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      settle({ exitCode: -1, spawnError: `Python 进程启动失败（${python}）：${error?.message ?? error}` })
    })
    child.on('close', (code) => {
      settle({ exitCode: typeof code === 'number' ? code : -1 })
    })
  })
}

/**
 * watch_read 的后台执行体（供 startDetachedTask 调用；也单独导出便于单测）。
 * 返回 {status, text, error} —— 任何路径都必须给出可投递的 text。
 */
export async function runWatchRead({ cfg, args, python, warn }) {
  const resolved = resolveWatchDir(cfg)
  if (!resolved.exists) {
    return {
      status: 'error',
      text: `【watch_read 失败】手表脚本目录不存在：${resolved.dir}\n请在 aiyayi-toolkit 的 config 里配 watchDir（指向 skg_probe/ble_direct）。`,
      error: `watchDir 不存在：${resolved.dir}`,
    }
  }
  const script = watchScriptPath(resolved.dir, cfg)
  if (!existsSync(script)) {
    return {
      status: 'error',
      text: `【watch_read 失败】找不到脚本 ${script}\n请在 config 里配 watchScript，或确认 skg_probe/ble_direct 完整。`,
      error: `脚本不存在：${script}`,
    }
  }
  const normalized = normalizeWatchArgs(args, cfg)
  const argv = buildWatchArgv(script, normalized)
  const timeoutMs = Number(cfg.watchTimeoutMs) || 180000
  try {
    warn?.(`aiyayi-toolkit: watch_read 后台开跑 ${python} ${argv.join(' ')}（cwd=${resolved.dir}，超时 ${timeoutMs}ms）`)
  } catch {
    /* logger 缺了就算了 */
  }
  const result = await runWatchScript({ python, argv, cwd: resolved.dir, timeoutMs })
  if (result.spawnError) {
    return {
      status: 'error',
      text: `【watch_read 失败】${result.spawnError}\n（Python 必须是能 import bleak 的那个；本机实测 python 可用，必要时在 config 里配 watchPython 指向绝对路径。）`,
      error: result.spawnError,
    }
  }
  const keyLines = extractWatchKeyLines(result.stdout)
  const text = composeWatchReport({
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    keyLines,
    timeoutMs,
    rounds: normalized.rounds,
    listenSec: normalized.listenSec,
  })
  if (result.timedOut) return { status: 'timeout', text, error: `总超时 ${timeoutMs}ms 已杀进程` }
  if (result.exitCode !== 0) return { status: 'error', text, error: `退出码 ${result.exitCode}` }
  return { status: 'success', text, error: '' }
}

/**
 * watch_read 工具 execute：**同步立刻返回**（不做任何 await 到后台的等待）。
 * 预检（脚本目录/入口）做在最前面，配置坏了就直接同步报错，不白起一个后台任务。
 */
export function executeWatchRead(args, { cfg, logUsage, warn, exec } = {}) {
  const rec = {
    ts: new Date().toISOString(),
    tool: 'watch_read',
    args: `rounds=${args?.rounds ?? '-'} listenSec=${args?.listenSec ?? '-'}`,
    status: 'started',
    denyReason: '',
    durationMs: 0,
    outBytes: 0,
    truncated: false,
    ok: true,
    exitCode: null,
    error: '',
  }
  const started = Date.now()
  const finish = (raw, status) => {
    const result = shapeWatchOutput(raw)
    rec.status = status
    rec.durationMs = Date.now() - started
    rec.ok = result.ok
    rec.error = result.error
    if (result.taskId) rec.args = `${rec.args} task=${result.taskId}`
    try {
      logUsage?.(rec)
    } catch {
      /* 留痕器自己不该抛，再兜一层 */
    }
    return result
  }

  const resolved = resolveWatchDir(cfg)
  if (!resolved.exists) {
    return finish({
      ok: false,
      status: 'error',
      taskId: '',
      kind: 'watch_read',
      hint: '',
      error: `手表脚本目录不存在：${resolved.dir}（请在 aiyayi-toolkit 的 config 里配 watchDir 指向 skg_probe/ble_direct）`,
    }, 'error')
  }
  const script = watchScriptPath(resolved.dir, cfg)
  if (!existsSync(script)) {
    return finish({
      ok: false,
      status: 'error',
      taskId: '',
      kind: 'watch_read',
      hint: '',
      error: `找不到手表取数脚本：${script}`,
    }, 'error')
  }

  const python = String(cfg?.watchPython ?? '').trim() || 'python'
  const task = startDetachedTask({
    exec,
    kind: 'watch_read',
    label: '手表取数',
    warn,
    hint: '已开始取数，约 25-100 秒，结果会作为消息推回会话',
    header: '【watch_read 失败】',
    run: ({ taskId }) => runWatchRead({ cfg, args, python, warn: (msg) => warn?.(`${msg}（${taskId}）`) }),
    onFinish: ({ record }) => {
      // 异步任务完成也要写留痕，跟同步三工具同一份 usage.jsonl。
      try {
        logUsage?.({
          ts: new Date(record.finishedAt || Date.now()).toISOString(),
          tool: 'watch_read',
          args: `task=${record.taskId} ${record.label}`,
          status: record.status === 'success' ? 'success' : record.status,
          denyReason: '',
          durationMs: record.durationMs,
          outBytes: (record.summary ?? '').length,
          truncated: false,
          ok: record.status === 'success',
          exitCode: null,
          error: record.error || record.deliveryError || '',
        })
      } catch {
        /* 留痕失败不影响任务 */
      }
    },
  })

  return finish({
    ok: true,
    status: 'started',
    taskId: task.taskId,
    kind: 'watch_read',
    hint: task.hint,
    error: '',
  }, 'started')
}

/** watch_read 输出归一：字段与 WATCH_SCHEMA.output.schema 一一对应。 */
export function shapeWatchOutput(result = {}) {
  return {
    ok: result.ok === true,
    status: String(result.status ?? 'error'),
    taskId: String(result.taskId ?? ''),
    kind: String(result.kind ?? 'watch_read'),
    hint: String(result.hint ?? ''),
    error: String(result.error ?? ''),
  }
}

export const WATCH_SCHEMA = {
  name: 'watch_read',
  description:
    '异步：从 SKG 手表取一次数（电量、步数/距离/卡路里、目标步数、分时步数、睡眠、血氧、心率历史 + 实时心率流），写完自动入 SQLite 归档。**这个工具立刻返回** {status:"started", taskId}，真正的取数在后台跑，约 25-100 秒；跑完（或超时/失败）会把结果作为一条消息推回会话，你不用等、也不用重试。前提：手表戴在手上、蓝牙开着、手机 SKG App 已退出（手机占着连接就扫不到）。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      rounds: { type: 'integer', description: 'BLE 扫描轮数（默认 6，每轮 10 秒；扫不到手表就多给几轮，上限 20）。' },
      listenSec: { type: 'integer', description: '连上后监听心率流/迟到应答的秒数（默认 0 = 不监听；想看实时心率给 12，上限 120）。' },
    },
    required: [],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', description: '工具调用本身是否成功受理（true=后台已开始，不代表取数成功；取数结果走消息推回）。' },
        status: { type: 'string', description: 'started=后台已开跑；error=预检失败（脚本目录/入口不存在等，详见 error）。' },
        taskId: { type: 'string', description: '后台任务 id（形如 tk-1a2b3c4d）。恒为字符串：预检失败时为空字符串。' },
        kind: { type: 'string', description: '任务种类，恒为 "watch_read"。' },
        hint: { type: 'string', description: '给调用方看的一句话提示；预检失败时为空字符串。' },
        error: { type: 'string', description: '预检失败原因；正常受理时为空字符串。' },
      },
      required: ['ok', 'status', 'taskId', 'kind', 'hint', 'error'],
    },
    render: (_args, value) => {
      if (!value.ok) return TEXT_BLOCK(`watch_read 未启动：${value.error}`)
      return TEXT_BLOCK(`${value.hint}（taskId ${value.taskId}）`)
    },
  },
}

/* ================================================================== *
 * 二、mem_sync：记忆仓库提交 + 推双远端（同步）
 * ================================================================== */

/**
 * 敏感内容正则（命中即拒绝提交）。命中只报**位置 + 脱敏片段**，绝不回显原文。
 * 覆盖：OpenAI 风格 sk-、npm token、GitHub token、私钥块、password/token 赋值。
 */
export const SENSITIVE_PATTERNS = [
  { name: 'sk-key', re: /\bsk-[A-Za-z0-9]{16,}/ },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{20,}/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'password', re: /password\s*[:=]\s*\S/i },
  { name: 'token', re: /token\s*[:=]\s*\S/i },
]

/** 一句话脱敏：只留类型与长度，方便定位又不泄露。 */
export function maskHit(name, matched) {
  const text = String(matched ?? '')
  return `${name}（${text.length} 字符，已隐去：${text.slice(0, 4)}…）`
}

/**
 * 扫一段文本，返回命中列表 `[{ line, name, masked }]`（行号从 1 起）。
 * 纯函数，可单测（直接喂假 diff）。
 */
export function scanSensitive(text, patterns = SENSITIVE_PATTERNS) {
  const hits = []
  const lines = String(text ?? '').split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const { name, re } of patterns) {
      const matched = line.match(re)
      if (matched) hits.push({ line: index + 1, name, masked: maskHit(name, matched[0]) })
    }
  })
  return hits
}

/** 路径是否在根目录内（按规范化路径前缀比，不是字符串包含；Windows 大小写不敏感）。 */
export function isInsidePath(child, parent) {
  const a = resolve(String(child ?? ''))
  const b = resolve(String(parent ?? ''))
  if (process.platform === 'win32') {
    const left = a.toLowerCase()
    const right = b.toLowerCase()
    return left === right || left.startsWith(right.endsWith(sep) ? right : `${right}${sep}`)
  }
  return a === b || a.startsWith(b.endsWith(sep) ? b : `${b}${sep}`)
}

/**
 * 越界守卫：`target` 必须在 `root` 里，否则抛（工具层捕获后转成 denied）。
 * 记忆同步**只允许在记忆根内操作**——越界一律拒绝，不做"就近找个仓库"的猜测。
 */
export function assertInsideRoot(target, root) {
  const absTarget = resolve(String(target ?? ''))
  const absRoot = resolve(String(root ?? ''))
  if (!isInsidePath(absTarget, absRoot)) {
    throw new Error(`路径越界：${absTarget} 不在记忆根 ${absRoot} 内，已拒绝`)
  }
  return absTarget
}

/** 统一的 git 调用：数组参数直接 spawnSync（**不拼 shell 字符串**，防注入）。
 *  `core.quotepath=false` 让非 ASCII 路径原样输出（不加 C 风格转义），配合 `-z` 才敢拿路径当文件用。 */
export function git(args, { cwd, timeoutMs = 60000 } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return {
    ok: result.status === 0,
    code: typeof result.status === 'number' ? result.status : -1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: result.error ? String(result.error.message ?? result.error) : '',
  }
}

/** 默认 commit message：`记忆更新 2026-11-12 15:00`。 */
export function defaultCommitMessage(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `记忆更新 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * 未跟踪文件（`?? ` 行）——`git diff` 看不到它们，但 `git add -A` 会把它们提交，必须一并扫。
 *
 * **坑 #80（1.5.41 单测抓出来的）**：`git status --porcelain` 对非 ASCII 路径默认做 C 风格转义
 * （`core.quotepath=true` → `?? "\346\226\260\347\254\224\350\256\260.md"`），拿这种字符串去
 * join 目录 100% 拼不出真文件 → 读不到 → **静默跳过 → 带密钥的文件被 add -A 提交了**。
 * 修法两层：① git 调用改 `status --porcelain -z`（NUL 分隔、路径原样不转义）；
 * ② 这个解析器同时容忍 -z 与普通换行两种形态，绝不把"解析不出"当成"没有未跟踪文件"。
 */
export function untrackedFiles(porcelain) {
  const text = String(porcelain ?? '')
  const entries = text.includes('\0') ? text.split('\0') : text.split(/\r?\n/)
  return entries
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3)) // -z 形态下前缀后就是原样路径；换行形态可能带引号
    .map((path) => path.replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

/**
 * mem_sync 主流程（同步）。
 * @param {{message?: string}} args
 * @param {object} deps `{ cfg, logUsage, warn }`
 * @returns {{status:string, ok:boolean, commit:string, pushed:Array, hint:string, error:string, hits:Array<string>}}
 */
export function executeMemSync(args, { cfg, logUsage, warn } = {}) {
  const rec = {
    ts: new Date().toISOString(),
    tool: 'mem_sync',
    args: capSummary(String(args?.message ?? '')),
    status: 'success',
    denyReason: '',
    durationMs: 0,
    outBytes: 0,
    truncated: false,
    ok: false,
    exitCode: null,
    error: '',
  }
  const started = Date.now()
  const finish = (raw, status) => {
    const result = shapeMemSyncOutput(raw)
    rec.status = status
    rec.durationMs = Date.now() - started
    rec.ok = result.ok
    rec.denyReason = result.status === 'denied' ? result.hint : ''
    rec.error = result.error
    rec.outBytes = result.hint.length
    try {
      logUsage?.(rec)
    } catch {
      /* 兜一层 */
    }
    return result
  }

  // 1) 记忆根：走 resolveRoot（指路文件 > AIYAYI_HOME > 默认），搬家自动跟随。
  let root = ''
  let reachable = false
  try {
    const resolved = resolveRoot()
    root = String(resolved.root ?? '')
    reachable = resolved.reachable === true
  } catch (error) {
    return finish({
      status: 'error', ok: false, commit: '', pushed: [], hits: [],
      hint: '', error: `记忆根解析失败：${error?.message ?? error}`,
    }, 'error')
  }
  if (!root || !reachable) {
    return finish({
      status: 'error', ok: false, commit: '', pushed: [], hits: [],
      hint: `记忆根不可达（${root || '未解析'}），先插回那块盘或修 location.json 再同步`,
      error: '记忆根不可达',
    }, 'error')
  }

  // 2) 仓库守卫：必须真的是一个 git 仓库，且**仓库顶就在记忆根**（防在记忆根的子目录里
  //    提交、结果落进别的仓库）。任何越界一律拒绝。
  const top = git(['rev-parse', '--show-toplevel'], { cwd: root, timeoutMs: 15000 })
  if (!top.ok) {
    return finish({
      status: 'error', ok: false, commit: '', pushed: [], hits: [],
      hint: `${root} 不是 git 仓库（${scrub(top.stderr || top.error).slice(0, 200)}）——记忆仓库没初始化过，先 git init + 配远端`,
      error: '不是 git 仓库',
    }, 'error')
  }
  const topLevel = top.stdout.trim()
  if (!isInsidePath(topLevel, root) || !isInsidePath(root, topLevel)) {
    return finish({
      status: 'denied', ok: false, commit: '', pushed: [], hits: [],
      hint: `拒绝：记忆根 ${root} 与仓库顶 ${topLevel} 不一致（记忆根可能是别的仓库的子目录），不在交集外动手`,
      error: '仓库顶与记忆根不一致',
    }, 'denied')
  }
  // 再确认所有后续 git 调用的 cwd 都在根内（越界即拒绝）。
  try {
    assertInsideRoot(topLevel, root)
  } catch (error) {
    return finish({
      status: 'denied', ok: false, commit: '', pushed: [], hits: [],
      hint: `拒绝：${error?.message ?? error}`,
      error: '路径越界',
    }, 'denied')
  }

  // 3) 有改动吗？用 `-z`（NUL 分隔）取：非 ASCII 路径不会被转义，后面能直接当文件名用。
  const status = git(['status', '--porcelain', '-z'], { cwd: root, timeoutMs: 15000 })
  if (!status.ok) {
    return finish({
      status: 'error', ok: false, commit: '', pushed: [], hits: [],
      hint: `git status 失败：${scrub(status.stderr || status.error).slice(0, 300)}`,
      error: 'git status 失败',
    }, 'error')
  }
  if (!status.stdout.trim()) {
    return finish({
      status: 'noop', ok: true, commit: '', pushed: [], hits: [],
      hint: '没有待提交的改动',
      error: '',
    }, 'noop')
  }

  // 4) 敏感内容扫描：git diff HEAD（含已暂存 + 未暂存）全文 + 未跟踪文件内容。
  const diff = git(['diff', 'HEAD'], { cwd: root, timeoutMs: 30000 })
  const diffText = diff.ok ? diff.stdout : ''
  const hits = scanSensitive(diffText).map((hit) => `diff 第 ${hit.line} 行：${hit.masked}`)
  for (const file of untrackedFiles(status.stdout)) {
    let target
    try {
      target = assertInsideRoot(join(root, file), root)
    } catch {
      continue // 越界的未跟踪路径不读（比如软链跳出根）
    }
    let content = ''
    try {
      if (statSync(target).isFile()) content = readFileSync(target, 'utf8').slice(0, 512 * 1024)
    } catch {
      continue
    }
    for (const hit of scanSensitive(content)) {
      hits.push(`${file} 第 ${hit.line} 行：${hit.masked}`)
    }
  }
  if (hits.length > 0) {
    return finish({
      status: 'denied', ok: false, commit: '', pushed: [], hits: hits.slice(0, 20),
      hint: `拒绝提交：改动里疑似有凭证/密钥（共 ${hits.length} 处，只列前 ${Math.min(hits.length, 20)} 处，已脱敏）。把这行改成占位符（如 <token>）或写进 .gitignore 后再同步。`,
      error: '命中敏感内容',
    }, 'denied')
  }

  // 5) git add -A → commit（作者固定 阿依娅伊 <aiyayi@local>，与仓库既有配置一致）。
  const add = git(['add', '-A'], { cwd: root, timeoutMs: 30000 })
  if (!add.ok) {
    return finish({
      status: 'error', ok: false, commit: '', pushed: [], hits: [],
      hint: `git add 失败：${scrub(add.stderr || add.error).slice(0, 300)}`,
      error: 'git add 失败',
    }, 'error')
  }
  const message = String(args?.message ?? '').trim() || defaultCommitMessage()
  const commit = git([
    '-c', 'user.name=阿依娅伊',
    '-c', 'user.email=aiyayi@local',
    'commit', '-m', message,
  ], { cwd: root, timeoutMs: 60000 })
  if (!commit.ok) {
    return finish({
      status: 'error', ok: false, commit: '', pushed: [], hits: [],
      hint: `git commit 失败：${scrub(commit.stderr || commit.error).slice(0, 300)}`,
      error: 'git commit 失败',
    }, 'error')
  }
  const head = git(['rev-parse', '--short', 'HEAD'], { cwd: root, timeoutMs: 15000 })
  const commitId = head.ok ? head.stdout.trim() : ''

  // 6) 逐个远端 push（一个失败不影响另一个，如实报告）。
  const branch = String(cfg?.memBranch ?? '').trim() || 'master'
  const remotes = Array.isArray(cfg?.memPushRemotes) && cfg.memPushRemotes.length > 0
    ? cfg.memPushRemotes.map((r) => String(r ?? '').trim()).filter(Boolean)
    : ['gitee', 'gitcode']
  const pushed = []
  for (const remote of remotes) {
    const result = git(['push', remote, branch], { cwd: root, timeoutMs: 120000 })
    pushed.push({
      remote,
      ok: result.ok,
      error: result.ok ? '' : scrub(result.stderr || result.error).split(/\r?\n/).slice(-3).join(' ').slice(0, 300),
    })
  }
  const okCount = pushed.filter((item) => item.ok).length
  const hint = okCount === pushed.length
    ? `已提交 ${commitId} 并推到 ${pushed.map((item) => item.remote).join(' / ')}（${branch}）`
    : `已提交 ${commitId}；推送 ${okCount}/${pushed.length} 成功，失败：${pushed.filter((item) => !item.ok).map((item) => item.remote).join(' / ')}（失败原因见 pushed[].error）`
  try {
    warn?.(`aiyayi-toolkit: mem_sync ${hint}`)
  } catch {
    /* logger 缺了就算了 */
  }
  return finish({
    status: okCount === pushed.length ? 'pushed' : 'partial',
    ok: true,
    commit: commitId,
    pushed,
    hint,
    error: '',
    hits: [],
  }, okCount === pushed.length ? 'success' : 'truncated')
}

/** 摘要限长（留痕用）。 */
function capSummary(text, max = 300) {
  const s = String(text ?? '')
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/** mem_sync 输出归一：字段与 MEM_SYNC_SCHEMA.output.schema 一一对应。 */
export function shapeMemSyncOutput(result = {}) {
  const pushed = Array.isArray(result.pushed) ? result.pushed : []
  const hits = Array.isArray(result.hits) ? result.hits : []
  return {
    status: String(result.status ?? 'error'),
    ok: result.ok === true,
    commit: String(result.commit ?? ''),
    pushed: pushed.map((item) => ({
      remote: String(item?.remote ?? ''),
      ok: item?.ok === true,
      error: String(item?.error ?? ''),
    })),
    hits: hits.map((hit) => String(hit ?? '')),
    hint: String(result.hint ?? ''),
    error: String(result.error ?? ''),
  }
}

export const MEM_SYNC_SCHEMA = {
  name: 'mem_sync',
  description:
    '同步：把记忆仓库的改动提交并推到 gitee / gitcode 两个远端（master）。只动记忆根内的仓库，越界一律拒绝；提交前会扫敏感内容（sk-*、npm_*、ghp_*、私钥块、password=/token= 赋值），命中就拒绝并把脱敏后的行号位置报给你。没有改动时返回 status:"noop"。几秒内同步完成；某个远端推失败不影响另一个，结果里逐个报。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message: { type: 'string', description: 'commit message（可选；缺省自动生成「记忆更新 2026-11-12 15:00」）。' },
    },
    required: [],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', description: 'noop=没有改动；pushed=提交并全部远端推送成功；partial=提交成功但部分远端推送失败；denied=拒绝（路径越界/命中敏感内容）；error=失败。' },
        ok: { type: 'boolean', description: '这次操作是否达成目标（noop 也算达成；denied/error 为 false）。' },
        commit: { type: 'string', description: '新提交的短 hash。恒为字符串：没提交（noop/denied/error）时为空字符串。' },
        pushed: {
          type: 'array',
          description: '逐远端推送结果（顺序同配置）。non-empty 仅在真正走到 push 时；其余情况为空数组。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              remote: { type: 'string' },
              ok: { type: 'boolean' },
              error: { type: 'string', description: '失败原因（已截取最后几行）；成功时为空字符串。' },
            },
            required: ['remote', 'ok', 'error'],
          },
        },
        hits: {
          type: 'array',
          description: '命中敏感内容的位置（行号 + 脱敏片段，最多 20 条）。只在 status=denied 且因敏感内容拒绝时非空。',
          items: { type: 'string' },
        },
        hint: { type: 'string', description: '给调用方看的一句话结论。' },
        error: { type: 'string', description: '失败/拒绝的机器可读原因；正常时为空字符串。' },
      },
      required: ['status', 'ok', 'commit', 'pushed', 'hits', 'hint', 'error'],
    },
    render: (_args, value) => {
      const lines = [value.hint]
      if (value.hits.length > 0) lines.push(...value.hits.map((hit) => `  · ${hit}`))
      if (value.pushed.length > 0) {
        lines.push(...value.pushed.map((item) => `  ${item.ok ? '✓' : '✗'} ${item.remote}${item.ok ? '' : `：${item.error}`}`))
      }
      return TEXT_BLOCK(lines.join('\n'))
    },
  },
}

/** 给单测的出口（只在测试里用；生产路径都走上面的导出函数）。 */
export const __testing = {
  scrub,
  LIB_DIR,
  isAbsoluteOk: (p) => (typeof p === 'string' ? isAbsolute(p) : false),
}
