#!/usr/bin/env node
/**
 * mem_sync —— 同步记忆仓库：git add + commit + push 到配置的远端（**独立命令行脚本**）。
 *
 * 来历：这个工具原来在 dsh-aiyayi 插件里（lib/toolkit-extra.js，1.5.41 加、1.5.43 修 P0/P1）。
 * 1.5.44 起它**移出 npm 包**，改由本机工具清单 `<记忆根>/toolbox.json` 驱动：清单里引用
 * 本脚本的绝对路径，插件侧只负责异步跑它、把 stdout 的 JSON 结果推回会话。
 *
 * 用法（插件会按这个约定喂参数，手工用也照此）：
 *   node mem_sync.js [--message "提交说明"] [--remotes gitee,gitcode] [--branch master] [--root D:\path]
 * 环境变量（插件自动注入，手工跑时可省）：
 *   AIYAYI_TOOLBOX_ARGS  —— {"tool":"mem_sync","args":{"message":"…"}}（工具调用参数）
 *   AIYAYI_TOOLBOX_ROOT  —— 记忆根（清单加载器给的实际记忆根）
 *   AIYAYI_MEM_PUSH_REMOTES / AIYAYI_MEM_BRANCH / AIYAYI_MEM_MESSAGE —— 清单里的 env 配置
 *
 * 行为约定：
 *   · **stdout 只输出一个 JSON 对象**（人读友好、程序也好读），其余一律走 stderr；
 *   · 没有改动 → status:"noop"；没配远端 → 什么都不做（零副作用：不 add / 不 commit / 不 push）；
 *   · 越界或命中敏感内容 → status:"denied" 并给脱敏后的行号位置；
 *   · 推送部分失败 → status:"partial" 且 **ok:false**（推送没全成 = 目标没达成）。
 *
 * 安全守卫（一条都没删，全部来自插件原实现）：
 *   1. 记忆根解析：AIYAYI_TOOLBOX_ROOT > AIYAYI_HOME > ~/.dsh/aiyayi/location.json > 默认路径；
 *   2. 仓库守卫：`rev-parse --show-toplevel` 必须成功，且仓库顶与记忆根**完全一致**
 *      （只允许把仓库顶当成根；不允许用子目录、也不允许根是别人仓库的子目录）；
 *   3. 敏感扫描：只扫 `+`/`-` **变化行**（旧实现扫全文，几百行外一行旧笔记就能把同步永久卡死），
 *      未跟踪/新增文件读全文扫；命中只报**行号 + 脱敏片段**，不回显原文；
 *   4. 远端/分支不做隐含默认：没配远端 = 不推；分支默认跟随仓库当前分支，detached HEAD 明确报错；
 *   5. 全部 git 调用走数组参数（不拼 shell 字符串）、GIT_TERMINAL_PROMPT=0（绝不弹凭据提示）、
 *      每步都带超时。
 *
 * 1.5.43 修的三条 P0/P1 都在这里（私有键正则含 OPENSSH、只扫变化行、暂存区 A 也算新文件、
 * diff HEAD 失败不吞成空串、partial 时 ok=false 并附真实远端名）。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'

/* ------------------------------------------------------------------ *
 * 一、参数与环境
 * ------------------------------------------------------------------ */

/** 解析命令行参数（只认 --key value 形式）。 */
function parseArgv(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? '')
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || String(next).startsWith('--')) out[key] = 'true'
    else {
      out[key] = String(next)
      i += 1
    }
  }
  return out
}

/** 插件注入的工具调用参数（拿不到就空对象）。 */
function readToolboxArgs() {
  const raw = process.env.AIYAYI_TOOLBOX_ARGS
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && parsed.args && typeof parsed.args === 'object' ? parsed.args : {}
  } catch {
    return {}
  }
}

const argv = parseArgv(process.argv.slice(2))
const callArgs = readToolboxArgs()

/** 记忆根：清单加载器给的 > AIYAYI_HOME > 指路文件 > 默认位置（与插件 lib/home.js 同优先级）。 */
function resolveRoot() {
  const explicit = String(argv.root ?? process.env.AIYAYI_TOOLBOX_ROOT ?? '').trim()
  if (explicit) return { root: explicit, source: 'toolbox', reachable: isDir(explicit) }
  const pointer = join(homedir(), '.dsh', 'aiyayi', 'location.json')
  const env = process.env.AIYAYI_HOME
  // 优先级：指路文件 > 环境变量（与插件一致：有指路文件时环境变量不起作用）。
  if (existsSync(pointer)) {
    try {
      const parsed = JSON.parse(readFileSync(pointer, 'utf8'))
      if (parsed && typeof parsed.root === 'string' && isAbsolute(parsed.root)) {
        return { root: parsed.root, source: 'pointer', reachable: isDir(parsed.root) }
      }
    } catch {
      /* 指路文件坏了：不回退默认路径（那正是"两份记忆分叉"的起点）——报错让人来修 */
      return { root: '', source: 'pointer-broken', reachable: false }
    }
  }
  if (env) return { root: env, source: 'env', reachable: isDir(env) }
  const fallback = join(homedir(), '.dsh', 'aiyayi')
  return { root: fallback, source: 'default', reachable: isDir(fallback) }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 二、git 与路径守卫
 * ------------------------------------------------------------------ */

function git(args, { cwd, timeoutMs = 60000 } = {}) {
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

function isInsidePath(child, parent) {
  const a = resolve(String(child ?? ''))
  const b = resolve(String(parent ?? ''))
  if (process.platform === 'win32') {
    const left = a.toLowerCase()
    const right = b.toLowerCase()
    return left === right || left.startsWith(right.endsWith(sep) ? right : `${right}${sep}`)
  }
  return a === b || a.startsWith(b.endsWith(sep) ? b : `${b}${sep}`)
}

function assertInsideRoot(target, root) {
  const absTarget = resolve(String(target ?? ''))
  const absRoot = resolve(String(root ?? ''))
  if (!isInsidePath(absTarget, absRoot)) {
    throw new Error(`路径越界：${absTarget} 不在记忆根 ${absRoot} 内，已拒绝`)
  }
  return absTarget
}

/* ------------------------------------------------------------------ *
 * 三、敏感内容扫描
 * ------------------------------------------------------------------ */

/**
 * 敏感内容正则（命中即拒绝提交）。只报位置 + 脱敏片段，绝不回显原文。
 * 私钥块用 `[A-Z0-9 _-]*`：旧写法 `[A-Z ]*` 匹配不到 `OPENSSH PRIVATE KEY`（下划线不在类里），
 * 而 ssh-keygen 默认生成的就是它 —— 1.5.43 的 P1 修复，这里照搬。
 */
const SENSITIVE_PATTERNS = [
  { name: 'sk-key', re: /\bsk-[A-Za-z0-9]{16,}/ },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{20,}/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'private-key', re: /-----BEGIN [A-Z0-9 _-]*PRIVATE KEY-----/ },
  { name: 'password', re: /password\s*[:=]\s*\S/i },
  { name: 'token', re: /token\s*[:=]\s*\S/i },
]

function maskHit(name, matched) {
  const text = String(matched ?? '')
  return `${name}（${text.length} 字符，已隐去：${text.slice(0, 4)}…）`
}

function scanSensitive(text, patterns = SENSITIVE_PATTERNS) {
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

/**
 * 只挑 diff 里**真正变化的内容行**（`+`/`-`，排除 `+++`/`---` 文件头），带原始 diff 行号 + 文件名。
 * 为什么只扫变化行：`git diff HEAD` 会带回大量没改动的上下文行，技术笔记里迟早出现
 * 「token: 由环境变量提供」这种解释性文字，扫全文会让同步被一行旧笔记永久卡死。
 */
function changedLinesOnly(diffText) {
  const picked = []
  let file = ''
  String(diffText ?? '').split(/\r?\n/).forEach((line, index) => {
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).trim()
      file = name === '/dev/null' ? file : name.replace(/^b\//, '')
      return
    }
    if (line.startsWith('--- ')) return
    if (!line.startsWith('+') && !line.startsWith('-')) return
    picked.push({ line: index + 1, text: line, file })
  })
  return picked
}

function scanDiffSensitive(diffText, patterns = SENSITIVE_PATTERNS) {
  const hits = []
  for (const { line, text, file } of changedLinesOnly(diffText)) {
    for (const { name, re } of patterns) {
      const matched = text.match(re)
      if (matched) hits.push({ line, name, masked: maskHit(name, matched[0]), file })
    }
  }
  return hits
}

/**
 * `git status --porcelain -z` 里哪些路径要读全文扫：未跟踪（`??`）与新增（`A `/`AM`）。
 * 已跟踪文件的修改内容全在 diff 的 `+`/`-` 行里，读全文只会把没改的旧行也扫一遍（误报源）。
 */
function untrackedFiles(porcelain) {
  const text = String(porcelain ?? '')
  const entries = text.includes('\0') ? text.split('\0') : text.split(/\r?\n/)
  return entries
    .filter((line) => /^(\?\?|A[M ])/.test(line))
    .map((line) => line.slice(3))
    .map((path) => path.replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

/* ------------------------------------------------------------------ *
 * 四、远端 / 分支解析（无隐含默认值）
 * ------------------------------------------------------------------ */

/** 要推到哪些远端：只认配置。未配置 → []；显式空 → []（都零副作用，区别只在文案）。 */
function resolveRemotes() {
  const raw = argv.remotes ?? process.env.AIYAYI_MEM_PUSH_REMOTES
  const configured = raw !== undefined && raw !== null
  const remotes = String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return { configured, remotes }
}

/** 推哪个分支：配置优先；空配置 → 跟随仓库当前分支；detached HEAD 明确报错（不猜）。 */
function resolveBranch(root) {
  const configured = String(argv.branch ?? process.env.AIYAYI_MEM_BRANCH ?? '').trim()
  if (configured) return { ok: true, branch: configured, error: '' }
  const revParse = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeoutMs: 15000 })
  const name = revParse.ok ? revParse.stdout.trim() : ''
  if (name && name !== 'HEAD') return { ok: true, branch: name, error: '' }
  // 空仓库（还没有第一个 commit）时 rev-parse 失败但分支名还在 → symbolic-ref 兜底；
  // detached 状态下两路都拿不到 → 报错。
  const symbolic = git(['symbolic-ref', '--short', 'HEAD'], { cwd: root, timeoutMs: 15000 })
  const branch = symbolic.ok ? symbolic.stdout.trim() : ''
  if (branch) return { ok: true, branch, error: '' }
  return {
    ok: false,
    branch: '',
    error: '拿不到当前分支（detached HEAD？仓库没有任何提交？）——请在清单里给这个工具配 env.AIYAYI_MEM_BRANCH',
  }
}

function listRemotes(root) {
  const result = git(['remote'], { cwd: root, timeoutMs: 5000 })
  if (!result.ok) return []
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/* ------------------------------------------------------------------ *
 * 五、主流程
 * ------------------------------------------------------------------ */

function scrub(text, max = 300) {
  const s = String(text ?? '')
  if (!s) return ''
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

function defaultCommitMessage(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `记忆更新 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function emit(result) {
  const shaped = {
    status: String(result.status ?? 'error'),
    ok: result.ok === true,
    commit: String(result.commit ?? ''),
    pushed: Array.isArray(result.pushed) ? result.pushed : [],
    hits: Array.isArray(result.hits) ? result.hits : [],
    hint: String(result.hint ?? ''),
    error: String(result.error ?? ''),
  }
  process.stdout.write(`${JSON.stringify(shaped, null, 2)}\n`)
  // 退出码：0=达成（含 noop）/ 1=失败（partial、error）/ 2=拒绝（denied）。
  // 插件侧以 stdout 的 ok 字段为准，退出码只是给手工跑的人看的。
  if (shaped.status === 'denied') process.exitCode = 2
  else if (!shaped.ok) process.exitCode = 1
  return shaped
}

function main() {
  // 1) 记忆根
  const resolved = resolveRoot()
  const root = String(resolved.root ?? '')
  if (!root || !resolved.reachable) {
    return emit({
      status: 'error', ok: false,
      hint: `记忆根不可达（${root || '未解析'}，来源 ${resolved.source}），先插回那块盘或修 location.json 再同步`,
      error: '记忆根不可达',
    })
  }

  // 2) 仓库守卫：必须是 git 仓库，且**仓库顶就是记忆根**
  const top = git(['rev-parse', '--show-toplevel'], { cwd: root, timeoutMs: 15000 })
  if (!top.ok) {
    return emit({
      status: 'error', ok: false,
      hint: `${root} 不是 git 仓库（${scrub(top.stderr || top.error)}）——记忆仓库没初始化过，先 git init + 配远端`,
      error: '不是 git 仓库',
    })
  }
  const topLevel = top.stdout.trim()
  if (!isInsidePath(topLevel, root) || !isInsidePath(root, topLevel)) {
    return emit({
      status: 'denied', ok: false,
      hint: `拒绝：记忆根 ${root} 与仓库顶 ${topLevel} 不一致（记忆根可能是别的仓库的子目录），不在交集外动手`,
      error: '仓库顶与记忆根不一致',
    })
  }
  try {
    assertInsideRoot(topLevel, root)
  } catch (error) {
    return emit({ status: 'denied', ok: false, hint: `拒绝：${error.message}`, error: '路径越界' })
  }

  // 3) 有改动吗（-z：非 ASCII 路径不被转义，后面能直接当文件名用）
  const status = git(['status', '--porcelain', '-z'], { cwd: root, timeoutMs: 15000 })
  if (!status.ok) {
    return emit({
      status: 'error', ok: false,
      hint: `git status 失败：${scrub(status.stderr || status.error)}`,
      error: 'git status 失败',
    })
  }

  // 3b) 远端配置守卫：**没配远端 = 什么都不做**，必须在 add 之前返回（零副作用）。
  const { configured: remotesConfigured, remotes } = resolveRemotes()
  if (remotes.length === 0) {
    const hasChanges = Boolean(status.stdout.trim())
    const why = remotesConfigured
      ? 'AIYAYI_MEM_PUSH_REMOTES 被显式配成空（本次未提交、未推送）'
      : '没有配置远端（默认不推，本次未提交、未推送）'
    const lead = hasChanges ? `检测到未提交的改动，但${why}` : `没有待提交的改动，且${why}`
    return emit({
      status: 'noop', ok: true,
      hint: `${lead}。要启用云端同步，在清单里给这个工具配 env.AIYAYI_MEM_PUSH_REMOTES（逗号分隔的真实远端名，如 origin）；只想本地留档就直接手工 git commit。`,
      error: '',
    })
  }
  if (!status.stdout.trim()) {
    return emit({ status: 'noop', ok: true, hint: '没有待提交的改动', error: '' })
  }

  // 3c) 分支守卫（同样放在 add 之前：拿不到分支就不该提交）
  const branchInfo = resolveBranch(root)
  if (!branchInfo.ok) {
    return emit({ status: 'error', ok: false, hint: branchInfo.error, error: '拿不到当前分支' })
  }
  const branch = branchInfo.branch

  // 4) 敏感扫描：diff 失败不吞成空串（空仓库 HEAD 不存在时 diff HEAD 直接 fatal）
  const diff = git(['diff', 'HEAD'], { cwd: root, timeoutMs: 30000 })
  let diffText = ''
  if (diff.ok) {
    diffText = diff.stdout
  } else {
    const staged = git(['diff', '--cached'], { cwd: root, timeoutMs: 30000 })
    const worktree = git(['diff'], { cwd: root, timeoutMs: 30000 })
    diffText = `${staged.ok ? staged.stdout : ''}\n${worktree.ok ? worktree.stdout : ''}`
  }
  const hits = scanDiffSensitive(diffText).map(
    (hit) => `diff 第 ${hit.line} 行${hit.file ? `（${hit.file}）` : ''}：${hit.masked}`,
  )
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
    for (const hit of scanSensitive(content)) hits.push(`${file} 第 ${hit.line} 行：${hit.masked}`)
  }
  if (hits.length > 0) {
    return emit({
      status: 'denied', ok: false, hits: hits.slice(0, 20),
      hint: `拒绝提交：改动里疑似有凭证/密钥（共 ${hits.length} 处，只列前 ${Math.min(hits.length, 20)} 处，已脱敏）。把这行改成占位符（如 <token>）或写进 .gitignore 后再同步。`,
      error: '命中敏感内容',
    })
  }

  // 5) add -A → commit（作者固定 阿依娅伊 <aiyayi@local>）
  const add = git(['add', '-A'], { cwd: root, timeoutMs: 30000 })
  if (!add.ok) {
    return emit({ status: 'error', ok: false, hint: `git add 失败：${scrub(add.stderr || add.error)}`, error: 'git add 失败' })
  }
  const message = String(argv.message ?? callArgs.message ?? process.env.AIYAYI_MEM_MESSAGE ?? '').trim()
    || defaultCommitMessage()
  const commit = git(
    ['-c', 'user.name=阿依娅伊', '-c', 'user.email=aiyayi@local', 'commit', '-m', message],
    { cwd: root, timeoutMs: 60000 },
  )
  if (!commit.ok) {
    return emit({
      status: 'error', ok: false,
      hint: `git commit 失败：${scrub(commit.stderr || commit.error)}`,
      error: 'git commit 失败',
    })
  }
  const head = git(['rev-parse', '--short', 'HEAD'], { cwd: root, timeoutMs: 15000 })
  const commitId = head.ok ? head.stdout.trim() : ''

  // 6) 逐个远端 push（一个失败不影响另一个，如实报告）
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
  const allOk = okCount === pushed.length
  let hint = `已提交 ${commitId} 并推到 ${pushed.map((item) => item.remote).join(' / ')}（${branch}）`
  if (!allOk) {
    const have = listRemotes(root)
    const failed = pushed.filter((item) => !item.ok).map((item) => item.remote)
    hint = `已提交 ${commitId}（改动已进本地仓库，不可逆）。推送 ${okCount}/${pushed.length} 成功：`
      + `${failed.join(' / ')} 失败（远端不存在或推送出错，原因见 pushed[].error）。`
      + `本仓库现有远端：${have.length > 0 ? have.join(' / ') : '（无）'}。`
      + '请把清单里这个工具的 env.AIYAYI_MEM_PUSH_REMOTES 改成上列真实存在的远端名（或先 git remote add 一个）。'
  }
  return emit({
    status: allOk ? 'pushed' : 'partial',
    ok: allOk,
    commit: commitId,
    pushed,
    hint,
    error: allOk ? '' : '推送未全部成功',
  })
}

try {
  main()
} catch (error) {
  // 任何意外都必须给出结构化输出（插件只能靠 stdout 的 JSON 汇报结果）。
  emit({
    status: 'error', ok: false,
    hint: `mem_sync 内部异常：${error?.message ?? error}`,
    error: String(error?.message ?? error),
  })
  process.exitCode = 1
}
