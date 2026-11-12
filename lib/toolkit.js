/**
 * aiyayi-toolkit — 工具包中间层（首批 3 工具：cmd / read / write）。
 *
 * 设计方案：docs/开发方案-工具包中间层.md（中间层三要素 = 工具目录 + 注册/反注册 + 调用转发）。
 *
 * 分工原则（方案 §1.2）：**简单结果状态型**查询（输出短、一次性、不需提炼）由中间层
 * 直接处理，本体异步可调、不用派小伙伴；**大量结果型**（要翻文件堆、要提炼归纳的）
 * 照旧派 subagent / retriever。工具本身坏了（报错、行为异常）再派人修。
 *
 * 首批三工具（全部中间层封装，本体可调）：
 *   1. toolkit_cmd   —— 只读命令执行：白名单前缀校验（git log/status/diff/show、npm view/search、
 *                       node --version、ls/dir/type/cat/head/tail/wc/where/which 等，可配置），
 *                       白名单外（publish/push/install/rm/del/mkdir/cp/mv 等一切写变更类）一律拒绝；
 *                       shell 元字符（管道/重定向/命令替换）一并拒绝，防止白名单命令被拼接滥用；
 *                       输出超 2KB（2048 字符，可配置）截断并标注 [truncated]；默认 30s 超时杀进程。
 *                       底层 child_process.spawn 在插件进程内执行——DSH 的 pwsh/file 沙箱是宿主
 *                       对宿主工具的约束，插件内进程拿不到那层钩子，所以**白名单收敛就是本工具
 *                       的安全层**（这也是把命令面收窄到"只读前缀 + 禁元字符"的原因）。
 *   2. toolkit_read  —— 文件探测 + 小文件读取：exists/size/mtime/isFile/isDir + 前 maxBytes（默认
 *                       8KB，上限 64KB）内容。读是安全的，不限路径；读不到 exists:false。
 *   3. toolkit_write —— 受限写入：路径白名单（默认 = 记忆根 + writeExtraPaths 配置，可用 writePaths
 *                       整体接管），限 64KB；原子写（临时文件 + rename）；覆盖前自动留时间戳 .bak。
 *
 * 调用留痕（初版重点，供后续按使用痕迹优化）：
 *   每次调用追加一条 JSONL 到 <记忆根>/toolkit/usage.jsonl（目录不存在自建）：
 *   { ts, tool, args(脱敏摘要), status(success/denied/timeout/truncated/error),
 *     denyReason, durationMs, outBytes, truncated, ok, exitCode, error }。
 *   环形控制：超过 usageMaxLines（默认 500）行时保留最新。写留痕本身 try/catch，
 *   失败只 warn，绝不影响工具结果。readUsage(n) 读最近 n 条（本版导出函数，后续可暴露成工具）。
 *
 * 注册范式同 precompact/net：apply(ctx, config) 里 registerOwnTool + ctx.tools.register
 * （disposer 存进工具目录，卸载时统一反注册）；**全程 try/catch，失败只禁用对应工具，
 * 绝不阻塞插件激活**（同 feishu/weixin/precompact 思路）。
 */
import { spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { resolveRoot } from './home.js'
import { registerOwnTool } from './own-tools.js'

/** Loader 身份。 */
export const name = 'aiyayi-toolkit'

/** 需要的服务：注册工具要 tools。 */
export const inject = ['tools']

/** 本中间层首批自注册的工具名（own-tools 白名单 + 工具目录共用）。 */
export const TOOL_NAMES = ['toolkit_cmd', 'toolkit_read', 'toolkit_write']

/** 默认配置。全部可被 cordis.patch.yml 的 config 覆盖（数组整体替换）。 */
export const DEFAULT_CONFIG = {
  // toolkit_cmd：只读命令白名单（前缀匹配，整词——"git log" 不会放过 "git logfile"）。
  cmdWhitelist: [
    'git log', 'git status', 'git diff', 'git show',
    'npm view', 'npm search',
    'pnpm -v', 'pnpm --version',
    'node --version', 'node -v',
    'ls', 'dir', 'type', 'cat', 'head', 'tail', 'wc', 'where', 'which',
  ],
  // toolkit_cmd：变更类命令黑名单（第一词命中给更明确的拒绝理由；真正的门是白名单）。
  cmdDenyWords: [
    'publish', 'push', 'install', 'uninstall', 'add', 'commit', 'clean', 'reset', 'rebase', 'merge',
    'rm', 'del', 'erase', 'rmdir', 'rd', 'mkdir', 'md', 'cp', 'copy', 'mv', 'move', 'ren', 'rename',
    'touch', 'kill', 'taskkill', 'stop-process', 'shutdown', 'restart', 'format', 'diskpart',
    'reg', 'regedit', 'setx', 'remove-item', 'ri', 'set-content', 'add-content',
    'curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-expression', 'iex',
  ],
  // toolkit_cmd：默认超时（ms）与单次调用超时上限（防 args.timeoutMs 把进程挂死）。
  cmdTimeoutMs: 30000,
  cmdTimeoutMaxMs: 120000,
  // toolkit_cmd：返回 stdout/stderr 的截断长度（字符）与收集硬上限（超出丢弃、防内存爆）。
  maxOutputChars: 2048,
  collectCapBytes: 1024 * 1024,
  // toolkit_read：默认与单次读取上限（字节）。
  readMaxBytes: 8 * 1024,
  readMaxBytesCap: 64 * 1024,
  // toolkit_write：单次写入上限（字节）。
  writeMaxBytes: 64 * 1024,
  // toolkit_write：写入白名单。null（默认）= 记忆根（resolveRoot 动态解析，搬家自动跟随）
  //   + writeExtraPaths；给了数组 = 完全接管（记忆根也要自己列进去）。
  writePaths: null,
  // toolkit_write：在默认白名单之上追加的目录（放机器相关的路径，如工作区 docs/）。
  writeExtraPaths: [],
  // 调用留痕：开关 / 环形上限（行）/ 落盘路径（null = <记忆根>/toolkit/usage.jsonl）。
  usageEnabled: true,
  usageMaxLines: 500,
  usagePath: null,
}

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/** 单次调用的留痕记录骨架（字段齐全，方便以后按字段做统计）。 */
function makeRec(tool, argsSummary) {
  return {
    ts: new Date().toISOString(),
    tool,
    args: String(argsSummary ?? ''),
    status: 'success',
    denyReason: '',
    durationMs: 0,
    outBytes: 0,
    truncated: false,
    ok: false,
    exitCode: null,
    error: '',
  }
}

/* ------------------------------------------------------------------ *
 * 纯函数助手（导出给单测；无副作用）
 * ------------------------------------------------------------------ */

/** 命令第一词（用于变更类黑名单提示）。 */
export function firstWord(cmd) {
  return String(cmd ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

/**
 * 只读白名单前缀匹配（整词）：命令等于前缀，或以「前缀 + 空格」开头才放行。
 * 比较统一小写（Windows 命令大小写不敏感；POSIX 下宽一点无害）。
 * @returns {string|null} 命中的前缀；没命中返回 null。
 */
export function matchesWhitelist(cmd, list) {
  const text = String(cmd ?? '').trim().toLowerCase()
  if (!text) return null
  for (const entry of Array.isArray(list) ? list : []) {
    const prefix = String(entry ?? '').trim().toLowerCase()
    if (!prefix) continue
    if (text === prefix || text.startsWith(`${prefix} `)) return prefix
  }
  return null
}

/**
 * shell 元字符检查：白名单命令一旦带这些字符就可能被拼接成写操作
 * （`git log > file` 写文件、`git status | rm -rf` 管道串联、`$(...)`/反引号命令替换）。
 * 注意：括号**不在**禁列——以 `(` 开头的子 shell 命令永远匹配不上任何白名单前缀
 * （白名单门在后面），而命令替换必须经 `$(` 或反引号，两者都被拦；
 * 禁括号会误伤 `node -e "console.log(...)"` 这类合法参数，得不偿失。
 * @returns {string|null} 命中的第一个元字符；干净返回 null。
 */
export function findShellMetachar(cmd) {
  const text = String(cmd ?? '')
  const blocked = text.match(/[|&;<>`$\r\n]/)
  return blocked ? blocked[0] : null
}

/**
 * 变更类黑名单命中，用于给更明确的拒绝理由。动词可能在第一个词
 * （`rm -rf`）也可能在第二个词（`npm publish` / `git push`），所以查前两个词
 * （跳过 `-` 开头的开关词，避免 `dir /b` 之类误伤）。真正的门仍是白名单。
 */
export function findDenyWord(cmd, words) {
  const denySet = new Set(
    (Array.isArray(words) ? words : [])
      .map((w) => String(w ?? '').trim().toLowerCase())
      .filter(Boolean),
  )
  if (denySet.size === 0) return null
  const parts = String(cmd ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  for (const word of parts.slice(0, 2)) {
    if (word.startsWith('-')) continue
    if (denySet.has(word)) return word
  }
  return null
}

/** 超长截断并标注 [truncated]（按字符数）。 */
export function truncateWithMark(text, maxChars) {
  const s = String(text ?? '')
  const max = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 2048
  if (s.length <= max) return { text: s, truncated: false }
  return { text: `${s.slice(0, max)}\n[truncated]`, truncated: true }
}

/**
 * 参数摘要脱敏：token/password/secret/key/bearer 等值打码，URL 用户名密码打码。
 * 留痕是给"以后看使用痕迹"用的，摘要里不该留凭证。
 */
export function redactSensitive(text) {
  let s = String(text ?? '')
  s = s.replace(/(bearer\s+)\S+/gi, '$1***')
  s = s.replace(/(--?(?:token|password|passwd|secret|apikey|api-key|api_key|key|auth|authorization)[\s=])\S+/gi, '$1***')
  s = s.replace(/\b(?:sk|ghp|gho|github_pat|xoxb|xoxp)-[A-Za-z0-9_-]{8,}/g, '***')
  s = s.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s@]+:[^/\s@]+@/g, '$1***@')
  return s
}

/** 摘要统一限长，防一条留痕被超长命令撑爆。 */
function capSummary(text, max = 300) {
  const s = String(text ?? '')
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/* ------------------------------------------------------------------ *
 * 调用留痕：JSONL 追加 + 环形控制 + 读取
 * ------------------------------------------------------------------ */

/** 留痕文件路径：config.usagePath 优先；默认 <记忆根>/toolkit/usage.jsonl（动态跟随记忆根）。 */
export function usageFilePath(cfg) {
  const merged = mergeConfig(cfg)
  if (merged.usagePath) return resolve(String(merged.usagePath))
  const { root } = resolveRoot()
  return join(root, 'toolkit', 'usage.jsonl')
}

/** 环形控制：超过 max 行时重写文件只留最新 max 行（含损坏行原样计数，不解析）。 */
function ringTrim(file, max) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return
  }
  const lines = raw.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length <= max) return
  try {
    writeFileSync(file, `${lines.slice(lines.length - max).join('\n')}\n`, 'utf8')
  } catch {
    /* 重写失败不影响主流程（调用方已兜） */
  }
}

/**
 * 造一个留痕写入器。返回的函数永远不抛：写不进就 warn（同 feishu/weixin/precompact
 * "失败只禁用不炸"的思路——留痕是观测手段，不能反过来挡工具）。
 * @param {object} cfg 合并后配置
 * @param {(msg:string)=>void} [warn] 告警出口（apply 传 ctx.logger.warn）
 */
export function createUsageLogger(cfg, warn) {
  const merged = mergeConfig(cfg)
  return function logUsage(rec) {
    if (merged.usageEnabled === false) return
    try {
      const file = usageFilePath(merged)
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${JSON.stringify(rec)}\n`, 'utf8')
      ringTrim(file, Math.max(1, Number(merged.usageMaxLines) || 500))
    } catch (error) {
      try {
        warn?.(`aiyayi-toolkit: 调用留痕写入失败（已跳过，不影响工具结果）: ${error?.message ?? error}`)
      } catch {
        /* 连 logger 都没有就算了 */
      }
    }
  }
}

/**
 * 读最近 n 条留痕（损坏行跳过，不抛）。本版只做导出函数，
 * 以后要给本体看使用统计时再包成工具（方案 §4：用工具可自主，造工具需验收）。
 * @returns {Array<object>} 最近 n 条记录（时间正序）；文件不存在/全损坏返回 []。
 */
export function readUsage(n = 50, cfg) {
  const merged = mergeConfig(cfg)
  const want = Number.isInteger(n) && n > 0 ? n : 50
  try {
    const raw = readFileSync(usageFilePath(merged), 'utf8')
    const records = []
    for (const line of raw.split('\n')) {
      const text = line.trim()
      if (!text) continue
      try {
        const obj = JSON.parse(text)
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) records.push(obj)
      } catch {
        /* 损坏行跳过——留痕是观测数据，坏一行不值得让读取整个失败 */
      }
    }
    return records.slice(-want)
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ *
 * 工具实现 1：toolkit_cmd —— 只读命令执行
 * ------------------------------------------------------------------ */

/** 收集 stdout/stderr：带硬上限（collectCapBytes），超出就丢弃剩余，防内存被大输出打爆。 */
function makeCollector(cap) {
  const chunks = []
  let bytes = 0
  let overflow = false
  return {
    push(chunk) {
      if (bytes >= cap) {
        overflow = true
        return
      }
      const buf = Buffer.from(chunk)
      chunks.push(buf.subarray(0, cap - bytes))
      bytes += buf.length
      if (bytes >= cap) overflow = true
    },
    text() {
      return Buffer.concat(chunks).toString('utf8')
    },
    overflow,
  }
}

/** 杀进程树：Windows 上 child.kill() 只杀 shell 不杀孙进程，用 taskkill /T /F 兜底。 */
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

/** 掐掉截断留下的半个多字节字符（尾部连续 10xxxxxx 时回退到本字符起点）。 */
function utf8Safe(buf) {
  let end = buf.length
  let i = end - 1
  let extra = 0
  while (i >= 0 && extra < 4 && (buf[i] & 0xc0) === 0x80) {
    extra += 1
    i -= 1
  }
  if (i >= 0) {
    const b = buf[i]
    const need = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : 0
    if (need > 0 && extra < need) end = i
  }
  return buf.subarray(0, end).toString('utf8')
}

/**
 * toolkit_cmd 实现：白名单校验 → spawn（shell:true）→ 截断 → 结构化返回。
 * 全路径不抛：拒绝/超时/失败都以 {ok:false, ...} 返回，方便本体直接读字段。
 * @param {{cmd:string, cwd?:string, timeoutMs?:number}} args
 * @param {object} cfg 合并后配置
 * @param {Function} [log] 留痕写入器
 */
export async function runCmd(args, cfg, log) {
  const merged = mergeConfig(cfg)
  const cmd = String(args?.cmd ?? '').trim()
  const rec = makeRec('toolkit_cmd', capSummary(redactSensitive(cmd)))
  const started = Date.now()

  /** 统一出口：填耗时与截断信息、留痕、返回。 */
  const finish = (result, status) => {
    rec.status = status
    rec.durationMs = Date.now() - started
    rec.outBytes = (result.stdout?.length ?? 0) + (result.stderr?.length ?? 0)
    rec.truncated = result.truncated === true
    rec.ok = result.ok === true
    rec.exitCode = result.exitCode ?? null
    rec.denyReason = result.denied === true ? String(result.reason ?? '') : ''
    rec.error = String(result.error ?? '')
    // 返回结构里也要带 durationMs（任务书口径：{ok, cmd, stdout, stderr, exitCode, durationMs}）。
    result.durationMs = rec.durationMs
    try {
      log?.(rec)
    } catch {
      /* 留痕器自己不该抛，再兜一层 */
    }
    return result
  }

  if (!cmd) {
    return finish({ ok: false, cmd, stdout: '', stderr: '', exitCode: null, denied: false, timedOut: false, reason: '', error: 'cmd 不能为空' }, 'error')
  }

  // 1) shell 元字符：防白名单命令被重定向/管道/命令替换拼接成写操作。
  const meta = findShellMetachar(cmd)
  if (meta) {
    return finish({
      ok: false, cmd, stdout: '', stderr: '', exitCode: null, denied: true, timedOut: false,
      reason: `命令含 shell 元字符 "${meta}"（禁止重定向/管道/命令替换），已拒绝`,
    }, 'denied')
  }

  // 2) 变更类黑名单：第一词命中就给明确理由（publish/push/install/rm/del/mkdir/cp/mv…）。
  const deny = findDenyWord(cmd, merged.cmdDenyWords)
  if (deny) {
    return finish({
      ok: false, cmd, stdout: '', stderr: '', exitCode: null, denied: true, timedOut: false,
      reason: `"${deny}" 是写变更类命令，toolkit_cmd 只执行只读命令，已拒绝`,
    }, 'denied')
  }

  // 3) 只读白名单前缀（真正的门，白名单外一律拒绝）。
  const prefix = matchesWhitelist(cmd, merged.cmdWhitelist)
  if (!prefix) {
    return finish({
      ok: false, cmd, stdout: '', stderr: '', exitCode: null, denied: true, timedOut: false,
      reason: `命令不在只读白名单内（前缀须命中如 git log / git status / npm view / ls / dir / cat 等），已拒绝`,
    }, 'denied')
  }

  // 4) cwd 校验（给了就必须是存在的目录）。
  let cwd
  if (args?.cwd != null && String(args.cwd).trim()) {
    cwd = resolve(String(args.cwd).trim())
    try {
      if (!statSync(cwd).isDirectory()) throw new Error('不是目录')
    } catch {
      return finish({ ok: false, cmd, stdout: '', stderr: '', exitCode: null, denied: false, timedOut: false, reason: '', error: `cwd 不存在或不是目录：${cwd}` }, 'error')
    }
  }

  // 5) 超时：单次可调，但夹在 [200, cmdTimeoutMaxMs]。
  const timeoutMs = Number.isInteger(args?.timeoutMs) && args.timeoutMs >= 200
    ? Math.min(args.timeoutMs, merged.cmdTimeoutMaxMs)
    : merged.cmdTimeoutMs

  const base = { ok: false, cmd, exitCode: null, denied: false, timedOut: false, reason: '', error: '', whitelisted: prefix }
  const out = makeCollector(merged.collectCapBytes)
  const err = makeCollector(merged.collectCapBytes)

  return await new Promise((done) => {
    let child
    try {
      child = spawn(cmd, { shell: true, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      done(finish({ ...base, stdout: '', stderr: '', error: `进程拉起失败：${error?.message ?? error}` }, 'error'))
      return
    }
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => {
      // 超时：立刻结算返回（不等 close）——Windows 上杀掉 shell 后孙进程可能还握着
      // stdio 管道，close 事件要等它退出才触发，等下去超时就名存实亡了。
      timedOut = true
      killTree(child)
      settle(
        { ...base, stdout: out.text(), stderr: err.text(), timedOut: true, error: `命令超过 ${timeoutMs}ms 未结束，已杀进程` },
        'timeout',
      )
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    const settle = (result, status) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // 收集器里已经是完整 utf8 文本（Buffer.concat 后一次性解码）；这里只做截断。
      const co = truncateWithMark(result.stdout ?? '', merged.maxOutputChars)
      const ce = truncateWithMark(result.stderr ?? '', merged.maxOutputChars)
      done(finish(
        {
          ...result,
          stdout: co.text,
          stderr: ce.text,
          truncated: co.truncated || ce.truncated || out.overflow || err.overflow,
        },
        status,
      ))
    }

    if (child.stdout) child.stdout.on('data', (chunk) => out.push(chunk))
    if (child.stderr) child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      settle({ ...base, stdout: out.text(), stderr: err.text(), error: `进程执行失败：${error?.message ?? error}` }, 'error')
    })
    child.on('close', (code) => {
      if (timedOut) {
        settle({ ...base, stdout: out.text(), stderr: err.text(), timedOut: true, error: `命令超过 ${timeoutMs}ms 未结束，已杀进程` }, 'timeout')
        return
      }
      const exitCode = typeof code === 'number' ? code : null
      settle(
        {
          ...base,
          ok: exitCode === 0,
          stdout: out.text(),
          stderr: err.text(),
          exitCode,
          reason: exitCode === 0 ? '' : `命令退出码非 0（${exitCode}），详见 stderr`,
        },
        exitCode === 0 ? (out.overflow || err.overflow ? 'truncated' : 'success') : 'error',
      )
    })
  })
}

/* ------------------------------------------------------------------ *
 * 工具实现 2：toolkit_read —— 文件探测 + 小文件读取
 * ------------------------------------------------------------------ */

/**
 * toolkit_read 实现：探测 + 读前 maxBytes。读是安全的，不限路径；读不到 exists:false。
 * @param {{path:string, maxBytes?:number}} args
 */
export function doRead(args, cfg, log) {
  const merged = mergeConfig(cfg)
  const rawPath = String(args?.path ?? '').trim()
  const rec = makeRec('toolkit_read', capSummary(redactSensitive(rawPath)))
  const started = Date.now()
  const finish = (result, status) => {
    rec.status = status
    rec.durationMs = Date.now() - started
    rec.outBytes = result.content?.length ?? 0
    rec.truncated = result.truncated === true
    rec.ok = result.ok === true
    rec.error = String(result.error ?? '')
    try {
      log?.(rec)
    } catch {
      /* 兜一层 */
    }
    return result
  }

  if (!rawPath) {
    return finish({ ok: false, exists: false, path: rawPath, size: 0, mtime: null, content: '', isFile: false, isDir: false, truncated: false, error: 'path 不能为空' }, 'error')
  }
  const maxBytes = Number.isInteger(args?.maxBytes) && args.maxBytes > 0
    ? Math.min(args.maxBytes, merged.readMaxBytesCap)
    : merged.readMaxBytes

  const target = resolve(rawPath)
  let stats
  try {
    stats = statSync(target)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      // 读不到是正常答案，不是失败。
      return finish({ ok: true, exists: false, path: target, size: 0, mtime: null, content: '', isFile: false, isDir: false, truncated: false }, 'success')
    }
    return finish({ ok: false, exists: false, path: target, size: 0, mtime: null, content: '', isFile: false, isDir: false, truncated: false, error: `探测失败：${error?.code ?? ''} ${error?.message ?? error}` }, 'error')
  }

  if (stats.isDirectory()) {
    return finish({ ok: true, exists: true, path: target, size: 0, mtime: stats.mtime.toISOString(), content: '', isFile: false, isDir: true, truncated: false }, 'success')
  }
  if (!stats.isFile()) {
    return finish({ ok: false, exists: true, path: target, size: stats.size, mtime: stats.mtime.toISOString(), content: '', isFile: false, isDir: false, truncated: false, error: '既不是常规文件也不是目录（符号链接/设备等），不读' }, 'error')
  }

  const truncated = stats.size > maxBytes
  let content = ''
  try {
    const fd = openSync(target, 'r')
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, stats.size))
      const read = readSync(fd, buf, 0, buf.length, 0)
      content = utf8Safe(buf.subarray(0, read))
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    return finish({ ok: false, exists: true, path: target, size: stats.size, mtime: stats.mtime.toISOString(), content: '', isFile: true, isDir: false, truncated: false, error: `读取失败：${error?.code ?? ''} ${error?.message ?? error}` }, 'error')
  }
  return finish(
    { ok: true, exists: true, path: target, size: stats.size, mtime: stats.mtime.toISOString(), content, isFile: true, isDir: false, truncated },
    truncated ? 'truncated' : 'success',
  )
}

/* ------------------------------------------------------------------ *
 * 工具实现 3：toolkit_write —— 受限文件写入
 * ------------------------------------------------------------------ */

/** 路径同一性（Windows 大小写不敏感）。 */
function samePath(left, right) {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** child 是否在 parent 里（按规范化路径前缀比，不是字符串包含）。 */
function isInside(child, parent) {
  if (samePath(child, parent)) return true
  const a = resolve(child)
  const b = resolve(parent)
  const [left, right] = process.platform === 'win32' ? [a.toLowerCase(), b.toLowerCase()] : [a, b]
  const prefix = right.endsWith(sep) ? right : `${right}${sep}`
  return left.startsWith(prefix)
}

/** 生效的写入白名单根目录（每次调用现算：记忆根支持运行时热切换）。 */
function effectiveWriteRoots(merged) {
  const custom = Array.isArray(merged.writePaths) && merged.writePaths.length > 0 ? merged.writePaths : null
  const roots = []
  if (custom) {
    for (const item of custom) {
      if (typeof item === 'string' && item.trim()) roots.push(resolve(item.trim()))
    }
    return roots
  }
  // 默认：记忆根（resolveRoot 动态解析，搬家自动跟随）+ writeExtraPaths（机器相关路径放配置）。
  try {
    const { root, reachable } = resolveRoot()
    if (root && reachable) roots.push(resolve(root))
  } catch {
    /* 记忆根解析失败就不含它——后面白名单校验会拒绝，绝不静默放宽到别处 */
  }
  for (const item of Array.isArray(merged.writeExtraPaths) ? merged.writeExtraPaths : []) {
    if (typeof item === 'string' && item.trim()) roots.push(resolve(item.trim()))
  }
  return roots
}

/** 文件名时间戳：`YYYYMMDD-HHMMSS`。 */
function stampSec() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * toolkit_write 实现：白名单校验 → 64KB 限幅 → .bak 备份 → 原子写（tmp + rename）。
 * @param {{path:string, content:string}} args
 */
export function doWrite(args, cfg, log) {
  const merged = mergeConfig(cfg)
  const rawPath = String(args?.path ?? '').trim()
  const rec = makeRec('toolkit_write', capSummary(redactSensitive(rawPath)))
  const started = Date.now()
  const finish = (result, status) => {
    rec.status = status
    rec.durationMs = Date.now() - started
    rec.outBytes = result.bytes ?? 0
    rec.denyReason = result.denied === true ? String(result.reason ?? '') : ''
    rec.ok = result.ok === true
    rec.error = String(result.error ?? '')
    try {
      log?.(rec)
    } catch {
      /* 兜一层 */
    }
    return result
  }

  if (!rawPath) {
    return finish({ ok: false, path: rawPath, bytes: 0, backupPath: null, denied: true, reason: 'path 不能为空' }, 'denied')
  }

  const target = resolve(rawPath)
  const roots = effectiveWriteRoots(merged)
  const inside = roots.find((root) => isInside(target, root))
  if (!inside) {
    return finish({
      ok: false, path: target, bytes: 0, backupPath: null, denied: true,
      reason: `目标路径不在写入白名单内。允许的根目录：${roots.length > 0 ? roots.join('；') : '（空——记忆根不可达且未配置 writePaths/writeExtraPaths）'}`,
    }, 'denied')
  }

  const content = args?.content == null ? '' : String(args.content)
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > merged.writeMaxBytes) {
    return finish({
      ok: false, path: target, bytes, backupPath: null, denied: true,
      reason: `内容 ${bytes} 字节，超过单次写入上限 ${merged.writeMaxBytes} 字节（64KB）——大文件请派小伙伴用文件工具写`,
    }, 'denied')
  }

  // 目标若已存在且是目录 → 拒绝（没法用文件覆盖目录）。
  let existed = false
  try {
    existed = statSync(target).isFile()
    if (!existed) {
      return finish({ ok: false, path: target, bytes, backupPath: null, denied: false, reason: '', error: '目标已存在且不是常规文件（目录？），已拒绝' }, 'error')
    }
  } catch {
    existed = false
  }

  // 覆盖前备份：同目录 `原名.bak-YYYYMMDD-HHMMSS`，撞名追加序号。
  let backupPath = null
  if (existed) {
    const dir = dirname(target)
    const base = target.slice(dir.length + 1)
    let candidate = join(dir, `${base}.bak-${stampSec()}`)
    let suffix = 2
    while (true) {
      try {
        statSync(candidate)
        candidate = join(dir, `${base}.bak-${stampSec()}-${suffix}`)
        suffix += 1
        continue
      } catch {
        break
      }
    }
    try {
      copyFileSync(target, candidate)
      backupPath = candidate
    } catch (error) {
      return finish({ ok: false, path: target, bytes, backupPath: null, denied: false, reason: '', error: `备份失败（未写入）：${error?.code ?? ''} ${error?.message ?? error}` }, 'error')
    }
  }

  // 原子写：先写同目录临时文件再 rename（rename 同目录内是原子的；跨目录不做——临时文件与目标同目录）。
  const dir = dirname(target)
  const tmp = join(dir, `${target.slice(dir.length + 1)}.tmp-${process.pid}-${Date.now()}`)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, target)
  } catch (error) {
    // 清理残留的临时文件（best effort，失败不影响错误上报）。
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* tmp 不在了就算了 */
    }
    return finish({ ok: false, path: target, bytes, backupPath, denied: false, reason: '', error: `写入失败：${error?.code ?? ''} ${error?.message ?? error}` }, 'error')
  }
  return finish({ ok: true, path: target, bytes, backupPath, denied: false, reason: '' }, 'success')
}

/* ------------------------------------------------------------------ *
 * 工具定义（schema + 渲染）——注册范式照 lib/net.js / lib/precompact.js
 * ------------------------------------------------------------------ */

const CMD_SCHEMA = {
  name: 'toolkit_cmd',
  description:
    '只读命令执行（工具包中间层）：跑白名单内的只读命令（git log/status/diff/show、npm view/search、node --version、ls/dir/type/cat/head/tail/wc/where/which 等）。任何写变更类命令（publish/push/install/rm/del/mkdir/cp/mv 等）和带管道/重定向的命令一律拒绝；输出超 2KB 截断并标注 [truncated]；默认 30 秒超时杀进程。适合"看一眼就知道"的状态查询（git 在什么状态、某依赖装没装）；输出大、要提炼归纳的活照旧派 subagent / retriever。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cmd: { type: 'string', description: '要执行的只读命令（整条命令行字符串）。' },
      cwd: { type: 'string', description: '工作目录（可选，必须是已存在的目录；git 命令常指定仓库路径）。' },
      timeoutMs: { type: 'integer', description: '超时毫秒数（可选，默认 30000，上限 120000）。' },
    },
    required: ['cmd'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        cmd: { type: 'string' },
        stdout: { type: 'string' },
        stderr: { type: 'string' },
        exitCode: { type: 'integer', description: '进程退出码；命令被拒绝、超时被杀或未拿到退出码时为 null（缺省）。' },
        durationMs: { type: 'integer' },
        truncated: { type: 'boolean' },
        denied: { type: 'boolean' },
        timedOut: { type: 'boolean' },
        reason: { type: 'string' },
        whitelisted: { type: 'string' },
      },
      required: ['ok', 'cmd', 'stdout', 'stderr', 'durationMs', 'truncated', 'denied', 'timedOut'],
    },
    render: (_args, value) => {
      if (value.denied) return TEXT_BLOCK(`已拒绝（只读白名单外）：${value.reason}`)
      if (value.timedOut) return TEXT_BLOCK(`超时（已杀进程）：${value.cmd}\n${value.stdout ?? ''}`)
      const head = `退出码 ${value.exitCode}，耗时 ${value.durationMs}ms${value.truncated ? '，输出已截断' : ''}`
      const parts = [head]
      if (value.stdout) parts.push(`--- stdout ---\n${value.stdout}`)
      if (value.stderr) parts.push(`--- stderr ---\n${value.stderr}`)
      if (value.error) parts.push(`error: ${value.error}`)
      return TEXT_BLOCK(parts.join('\n'))
    },
  },
}

const READ_SCHEMA = {
  name: 'toolkit_read',
  description:
    '文件探测 + 小文件读取（工具包中间层）：返回 {exists, size, mtime, isFile, isDir, content}。默认读前 8KB（maxBytes 可调，上限 64KB），目录只报属性不给内容。不限路径、读不到返回 exists:false——适合确认文件/目录在不在、读标志位和小配置。要消化整份大文档、翻文件堆找内容，派 retriever。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', description: '文件或目录路径。' },
      maxBytes: { type: 'integer', description: '最多读多少字节（默认 8192，上限 65536）。' },
    },
    required: ['path'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        exists: { type: 'boolean' },
        path: { type: 'string' },
        size: { type: 'integer' },
        mtime: { type: 'string', description: '最后修改时间（ISO 字符串）；目标不存在或探测失败时为 null（缺省）。' },
        content: { type: 'string' },
        isFile: { type: 'boolean' },
        isDir: { type: 'boolean' },
        truncated: { type: 'boolean' },
        error: { type: 'string' },
      },
      required: ['ok', 'exists', 'path', 'size', 'isFile', 'isDir', 'truncated'],
    },
    render: (_args, value) => {
      if (value.error && !value.ok) return TEXT_BLOCK(`读取失败：${value.path}（${value.error}）`)
      if (!value.exists) return TEXT_BLOCK(`不存在：${value.path}`)
      if (value.isDir) return TEXT_BLOCK(`是目录：${value.path}（mtime ${value.mtime ?? ''}）`)
      const head = `${value.path}（${value.size} 字节${value.truncated ? `，已读前 ${value.content?.length ?? 0} 字符并截断` : ''}）`
      return TEXT_BLOCK(`${head}\n--- content ---\n${value.content ?? ''}`)
    },
  },
}

const WRITE_SCHEMA = {
  name: 'toolkit_write',
  description:
    '受限文件写入（工具包中间层）：只能写白名单目录内的文件（默认 = 记忆根 + 配置追加目录；白名单外一律拒绝并会列出允许的根目录）。单次限 64KB；原子写（先写临时文件再 rename）；覆盖已有文件前自动在同目录留时间戳 .bak 备份并返回 backupPath。适合落盘状态、写经验/记录文档；大文件与代码工程改动派 subagent 用文件工具。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', description: '目标文件路径（必须在写入白名单内）。' },
      content: { type: 'string', description: '要写入的全文（UTF-8，≤64KB）。' },
    },
    required: ['path', 'content'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        path: { type: 'string' },
        bytes: { type: 'integer' },
        backupPath: { type: 'string', description: '覆盖已有文件时自动备份的 .bak 文件路径；新建文件或无需备份时为 null（缺省）。' },
        denied: { type: 'boolean' },
        reason: { type: 'string' },
        error: { type: 'string' },
      },
      required: ['ok', 'path', 'bytes'],
    },
    render: (_args, value) => {
      if (value.denied) return TEXT_BLOCK(`写入已拒绝：${value.reason}`)
      if (!value.ok) return TEXT_BLOCK(`写入失败：${value.path}（${value.error || value.reason}）`)
      return TEXT_BLOCK(`已写入 ${value.path}（${value.bytes} 字节）${value.backupPath ? `；原文件已备份到 ${value.backupPath}` : '（新建，无备份）'}`)
    },
  },
}

/* ------------------------------------------------------------------ *
 * 中间层骨架：工具目录（名字 → 定义 + disposer + 底层实现）+ add/remove/list
 * ------------------------------------------------------------------ */

/**
 * apply：挂三个内置工具。全程 try/catch——单个工具注册失败只禁用它自己，
 * 绝不阻塞插件激活（同 feishu/weixin/precompact 思路）。
 * @param {object} ctx preset 作用域内的 agent 上下文（需要 tools 服务）
 * @param {object} [config] cordis.patch.yml 里的 config
 * @returns {{list:Function, add:Function, remove:Function, cfg:object}} 工具目录的操作句柄
 *   （loader 不使用返回值；暴露出来给测试与后续管理入口用）
 */
export function apply(ctx, config) {
  const cfg = mergeConfig(config)
  const warn = (msg) => {
    try {
      ctx?.logger?.warn?.(msg)
    } catch {
      /* logger 缺了就算了 */
    }
  }

  // own-tools 白名单登记（restrict 单一真源，静态兜底表在 own-tools.js 里同步维护）。
  try {
    for (const toolName of TOOL_NAMES) registerOwnTool(toolName)
  } catch (error) {
    warn(`aiyayi-toolkit: own-tools 登记失败（工具可能被 restrict 挡住）: ${error?.message ?? error}`)
  }

  /**
   * 工具目录（方案 §2.3 要素 1）：名字 → { 定义, disposer, source }。
   * disposer 来自 ctx.tools.register()（方案 §6.1：官方返回值，精确反注册）。
   */
  const registry = new Map()

  /** add：注册一个工具并登记目录；同名重复注册直接返回旧 disposer（幂等）。 */
  const add = (toolName, def, impl) => {
    if (registry.has(toolName)) return registry.get(toolName).disposer
    const disposer = ctx.tools.register({ ...def, execute: impl })
    registry.set(toolName, { def, disposer, source: 'builtin' })
    return disposer
  }

  /** remove：精确反注册（调 disposer + 移出目录）。 */
  const remove = (toolName) => {
    const entry = registry.get(toolName)
    if (!entry) return false
    registry.delete(toolName)
    try {
      entry.disposer?.()
    } catch (error) {
      warn(`aiyayi-toolkit: 反注册 ${toolName} 时 disposer 报错: ${error?.message ?? error}`)
    }
    return true
  }

  /** list：当前已注册的工具名。 */
  const list = () => [...registry.keys()]

  // 挂三个内置工具：转发壳把调用交给底层实现，并带配置与留痕（方案 §2.3 要素 3）。
  const logUsage = createUsageLogger(cfg, warn)
  const builtins = [
    [CMD_SCHEMA, (args) => runCmd(args, cfg, logUsage)],
    [READ_SCHEMA, (args) => doRead(args, cfg, logUsage)],
    [WRITE_SCHEMA, (args) => doWrite(args, cfg, logUsage)],
  ]
  for (const [def, impl] of builtins) {
    try {
      add(def.name, def, impl)
    } catch (error) {
      warn(`aiyayi-toolkit: 工具 ${def.name} 注册失败（该工具本次不可用，其余不受影响）: ${error?.message ?? error}`)
    }
  }

  // 插件卸载兜底：把目录里还挂着的全部精确反注册，避免注册泄漏。
  try {
    ctx.effect(
      () => () => {
        for (const toolName of [...registry.keys()]) remove(toolName)
      },
      'aiyayi-toolkit.dispose()',
    )
  } catch (error) {
    warn(`aiyayi-toolkit: 卸载钩子注册失败: ${error?.message ?? error}`)
  }

  return { list, add, remove, cfg }
}

/** 配置合并（数组整体替换，不做深合并——白名单语义要的是"换成这份"，不是"叠加"。）。 */
export function mergeConfig(config) {
  return { ...DEFAULT_CONFIG, ...(config ?? {}) }
}

/* 测试出口：只给单测用。 */
export const __testing = {
  makeRec,
  ringTrim,
}
