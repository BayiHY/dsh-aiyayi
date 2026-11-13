/**
 * aiyayi-toolkit — 工具包中间层（首批 3 工具：cmd / read / write）。
 *
 * 设计方案：docs/开发方案-工具包中间层.md（中间层三要素 = 工具目录 + 注册/反注册 + 调用转发）。
 *
 * 分工原则（方案 §1.2）：轻量查询（几秒出结果、输出短、不需提炼）由中间层直接处理，
 * 本体异步可调、不用派小伙伴；toolkit_write 受限写入与工具箱清单维护也算本体例外；
 * 大量结果型（要翻文件堆、抓网页、提炼归纳、长任务的）照旧派 subagent / retriever。
 * 工具本身坏了（报错、行为异常）再派人修。
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
import { randomUUID } from 'node:crypto'
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
import {
  TOOLBOX_LIST_SCHEMA,
  TOOLBOX_RELOAD_SCHEMA,
  TOOLBOX_REMOVE_SCHEMA,
  createManifestManager,
  shapeToolboxList,
  shapeToolboxReload,
  shapeToolboxRemove,
} from './toolkit-manifest.js'

/** Loader 身份。 */
export const name = 'aiyayi-toolkit'

/** 需要的服务：注册工具要 tools。 */
export const inject = ['tools']

/**
 * 本中间层自注册的工具名（own-tools 白名单 + 工具目录共用）。
 *
 * **1.5.43 / 1.5.44 破坏性变更**：`watch_read` / `mem_sync` / `pkg_stats` 三个工具**从工具面移除**，
 * 不再注册、不再进白名单。理由：它们是发版方自己的特殊能力（要手表脚本目录 / 会真提交记忆仓库 /
 * 要联网查下载量），不属于"发给所有人的通用工具箱"；而且无条件注册时三个工具每轮约占
 * 1334 token 里的 690，还拉长了工具面、抬高误调率（误调 `mem_sync` 的代价是一次不可逆 commit）。
 *
 * **1.5.44 起它们改由本机清单驱动**：通用安装包里只留三个简单通用的能力
 * （toolkit_cmd / toolkit_read / toolkit_write）外加三个清单管理工具
 * （toolbox_list / toolbox_reload / toolbox_remove——remove 为 1.6.1 新增，
 * 从清单文件移除条目并立即重载，同步、几毫秒返回）。
 * 其余工具一律走**本机清单** `<记忆根>/toolbox.json`（lib/toolkit-manifest.js）：
 * 脚本不进 npm 包，清单里引用本机绝对路径，每个清单工具都经 startDetachedTask 异步执行、
 * 立刻返回 taskId、跑完 followup 推回会话。
 *
 * **1.6.1：`lib/toolkit-extra.js` / `lib/pkg-stats.js` 实现文件已删除**（连同 package.json 的
 * files/exports 条目）。当初保留的理由是"1.5.41/1.5.42 的单测还在用"，但 test/ 不进 npm 包，
 * 这个理由不成立；watch_read / mem_sync / pkg_stats 现在是纯本机清单脚本（G:\阿依娅伊\工具\…），
 * 仓库里不再保留其实现。对应单测（pkg-stats.test.mjs / mem-sync-1543.test.mjs 及
 * toolkit-async.test.mjs 里依赖这两个模块的段落）一并移除。
 *
 * **own-tools 白名单仍是"超集"**：清单工具注册时会调 registerOwnTool(name) 动态放行，
 * 所以清单增减不会把工具挡在 restrict 之外。
 */
export const TOOL_NAMES = ['toolkit_cmd', 'toolkit_read', 'toolkit_write', 'toolbox_list', 'toolbox_reload', 'toolbox_remove']

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
  // watch_read（1.5.41，异步）：手表取数脚本目录。null（默认）= 按插件位置推导
  // gh_repo/../../skg_probe/ble_direct（**不写死盘符**）；目录搬家时在这里配绝对路径。
  watchDir: null,
  // watch_read：脚本入口名 / Python 解释器（默认 `python`，需要绝对路径时可配）。
  watchScript: 'watch_read.py',
  watchPython: 'python',
  // watch_read：默认与上限（轮数 / 监听秒数），以及**任务级总超时**（超时杀进程并投递明确错误）。
  watchDefaultRounds: 6,
  watchMaxRounds: 20,
  watchDefaultListenSec: 0,
  watchMaxListenSec: 120,
  watchTimeoutMs: 180000,
  // ── 以下配置项 1.5.44 起**不再被本文件读取**（对应工具已移出安装包，改由本机清单脚本
  //    自己从 argv / 环境变量读参数）。保留默认值只为两件事：
  //    ① 1.5.43 的既有单测断言这些键存在（发版方本机的 memPushRemotes / memBranch 迁移期）；
  //    ② 升级用户 cordis.patch.yml 里已写的同名项不会变成孤儿配置而被静默忽略。
  //    mem_sync / pkg_stats / watch_read 的默认值现在写在各自脚本里（G:\阿依娅伊\工具\…）。
  // mem_sync（1.5.41，同步；1.5.43 改默认值）：提交后推哪些远端、推哪个分支（顺序即汇报顺序）。
  //   ⚠ **1.5.43 破坏性变更**：`memPushRemotes` 默认由 `['gitee','gitcode']` 改为 **`[]`**。
  //      空/未配置 = **不推也不提交**（status:"noop"，零副作用）。
  //      要云端同步必须显式配置 —— gitee/gitcode 是发版方本机的镜像名，不是通用约定。
  //   ⚠ `memBranch` 默认由写死的 `'master'` 改为 **`''`**（跟随仓库当前分支）；
  //      main 分支的仓库以前 100% 推失败。detached HEAD 时明确报错，不猜分支。
  memPushRemotes: [],
  memBranch: '',
  // pkg_stats（1.5.42）：查 npm 下载量 + 代码仓热度。
  //   默认查询目标（本体一般不用传参）。
  pkgStatsDefaultPackage: 'dsh-aiyayi',
  pkgStatsDefaultRepo: 'BayiHY/dsh-aiyayi',
  pkgStatsTimeoutMs: 15000,
  pkgStatsRequestTimeoutMs: 8000,
  pkgStatsAllowGithubProxy: true,
  pkgStatsGithubDirectTimeoutMs: 4000,
  // ── 1.5.44 新增：本地工具清单（lib/toolkit-manifest.js）──
  // 清单路径：null（默认）= <记忆根>/toolbox.json；给字符串则整体接管（调试/多套清单用）。
  manifestPath: null,
  // 清单工具跑 .js 用的解释器（默认 process.execPath，即插件进程那个 node）。
  manifestNode: '',
  // 清单工具跑 .py 用的解释器（默认 'python'；需要绝对路径时在这里配）。
  manifestPython: '',
  // 清单工具跑 .ps1 用的解释器（默认 'powershell'；本机装了 7 可配成 'pwsh'）。
  manifestPowershell: '',
}

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/* ------------------------------------------------------------------ *
 * 输出形状归一（1.5.40 修，坑 #78）
 *
 * **为什么需要这一层**：宿主不只在注册端校验工具 schema，**在输出端也校验**——
 * 工具 execute 的返回值会用 `validateJsonSchemaValue(output.schema, value)` 逐字段验：
 * ①`required` 里的字段缺一个 → `missing required property "value.x"`；
 * ②字段存在但类型不符 → `"value.x" must be an integer/string/boolean`（`null` 不等于缺省，
 *   它会被当成"存在且类型错"）；
 * ③`additionalProperties: false` 时返回了 schema 没声明的键 → `"value.x" is not a declared property`。
 * 1.5.39 的三件套把 type 改成单类型后，实现层仍是"条件性返回"（exitCode 超时给 null、
 * backupPath 新建给 null、truncated 部分路径干脆不出现）→ 执行其实成功了，宿主却判输出非法、
 * 调用方只看到一句校验错误（底层写盘/命令都真跑了，UX 上像"失败"）。
 *
 * 修法：**每个工具的 execute 返回值只从这一个归一函数出**，把所有路径（成功/拒绝/超时/
 * 进程起不来/内部异常）都压成与 output.schema 完全一致的形状：字段一个不少、
 * 每个字段都是单类型、不出现 schema 之外的键。语义映射：
 *   - `exitCode`：拿不到真实退出码（拒绝/超时/拉不起进程）时填 **-1**（不是真实退出码）；
 *   - `backupPath`：未产生备份（新建文件/未走到备份）时填 **空字符串**；
 *   - `mtime`：探测不到时填 **空字符串**（read 同款问题，一并修）；
 *   - `truncated`：一律 boolean，不省缺。
 * 留痕（usage.jsonl）仍保留"null = 没有值"的旧语义，不影响统计口径。
 * ------------------------------------------------------------------ */

/** 非负整数归一：不是合法整数的退回缺省（防 NaN/浮点/字符串混进 integer 字段）。 */
function intOr(value, fallback) {
  return Number.isInteger(value) ? value : fallback
}

/** toolkit_cmd 输出归一：字段与 CMD_SCHEMA.output.schema 一一对应。 */
export function shapeCmdOutput(result = {}) {
  return {
    ok: result.ok === true,
    cmd: String(result.cmd ?? ''),
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    exitCode: intOr(result.exitCode, -1),
    durationMs: intOr(result.durationMs, 0),
    truncated: result.truncated === true,
    denied: result.denied === true,
    timedOut: result.timedOut === true,
    reason: String(result.reason ?? ''),
    whitelisted: String(result.whitelisted ?? ''),
    error: String(result.error ?? ''),
  }
}

/** toolkit_read 输出归一：字段与 READ_SCHEMA.output.schema 一一对应。 */
export function shapeReadOutput(result = {}) {
  return {
    ok: result.ok === true,
    exists: result.exists === true,
    path: String(result.path ?? ''),
    size: intOr(result.size, 0),
    mtime: String(result.mtime ?? ''), // 探测不到 = 空串（不是 null，宿主按 string 校验）
    content: String(result.content ?? ''),
    isFile: result.isFile === true,
    isDir: result.isDir === true,
    truncated: result.truncated === true,
    error: String(result.error ?? ''),
  }
}

/** toolkit_write 输出归一：字段与 WRITE_SCHEMA.output.schema 一一对应。 */
export function shapeWriteOutput(result = {}) {
  return {
    ok: result.ok === true,
    path: String(result.path ?? ''),
    bytes: intOr(result.bytes, 0),
    backupPath: String(result.backupPath ?? ''), // 未备份 = 空串（不是 null）
    denied: result.denied === true,
    reason: String(result.reason ?? ''),
    error: String(result.error ?? ''),
  }
}

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

  /** 统一出口：归一输出形状（坑 #78）→ 填留痕 → 返回。 */
  const finish = (raw, status) => {
    // 归一必须在这里做：宿主校验的是 execute 的返回值，任何一条路径漏字段/给 null 都会被拒。
    const result = shapeCmdOutput({ ...raw, durationMs: Date.now() - started })
    rec.status = status
    rec.durationMs = result.durationMs
    rec.outBytes = result.stdout.length + result.stderr.length
    rec.truncated = result.truncated
    rec.ok = result.ok
    // 留痕沿用旧语义（null = 没有真实退出码），输出端才用约定值 -1。
    rec.exitCode = result.exitCode < 0 ? null : result.exitCode
    rec.denyReason = result.denied === true ? result.reason : ''
    rec.error = result.error
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
  const finish = (raw, status) => {
    const result = shapeReadOutput(raw)
    rec.status = status
    rec.durationMs = Date.now() - started
    rec.outBytes = result.content.length
    rec.truncated = result.truncated
    rec.ok = result.ok
    rec.error = result.error
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
  const finish = (raw, status) => {
    const result = shapeWriteOutput(raw)
    rec.status = status
    rec.durationMs = Date.now() - started
    rec.outBytes = result.bytes
    rec.denyReason = result.denied === true ? result.reason : ''
    rec.ok = result.ok
    rec.error = result.error
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
        exitCode: {
          type: 'integer',
          description: '进程退出码。恒为整数：命令被拒绝、超时被杀、进程拉不起来等拿不到真实退出码的场景填 -1（约定值，不等于真实退出码，以 ok/denied/timedOut 判别）。',
        },
        durationMs: { type: 'integer' },
        truncated: { type: 'boolean', description: '输出是否被截断。恒为布尔值（不省缺）。' },
        denied: { type: 'boolean' },
        timedOut: { type: 'boolean' },
        reason: { type: 'string', description: '拒绝/失败时的说明；正常时为空字符串。' },
        whitelisted: { type: 'string', description: '命中的只读白名单前缀；被拒绝时为空字符串。' },
        error: { type: 'string', description: '底层错误信息；没有错误时为空字符串。' },
      },
      required: ['ok', 'cmd', 'stdout', 'stderr', 'exitCode', 'durationMs', 'truncated', 'denied', 'timedOut', 'reason', 'whitelisted', 'error'],
    },
    render: (_args, value) => {
      if (value.denied) return TEXT_BLOCK(`已拒绝（只读白名单外）：${value.reason}`)
      if (value.timedOut) return TEXT_BLOCK(`超时（已杀进程）：${value.cmd}\n${value.stdout ?? ''}`)
      const head = `退出码 ${value.exitCode}${value.exitCode < 0 ? '（无真实退出码：拒绝/超时/拉起失败）' : ''}，耗时 ${value.durationMs}ms${value.truncated ? '，输出已截断' : ''}`
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
        mtime: { type: 'string', description: '最后修改时间（ISO 字符串）。恒为字符串：目标不存在或探测失败时为空字符串（约定值，配合 exists 判别）。' },
        content: { type: 'string' },
        isFile: { type: 'boolean' },
        isDir: { type: 'boolean' },
        truncated: { type: 'boolean', description: '内容是否被 maxBytes 截断。恒为布尔值（不省缺）。' },
        error: { type: 'string', description: '探测/读取失败的原因；正常时为空字符串。' },
      },
      required: ['ok', 'exists', 'path', 'size', 'mtime', 'content', 'isFile', 'isDir', 'truncated', 'error'],
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
        backupPath: { type: 'string', description: '覆盖已有文件时自动备份的 .bak 路径。恒为字符串：仅覆盖已有文件时非空，新建文件/未走到备份时为空字符串。' },
        denied: { type: 'boolean' },
        reason: { type: 'string', description: '拒绝原因的说明；正常时为空字符串。' },
        error: { type: 'string', description: '底层错误信息；没有错误时为空字符串。' },
      },
      required: ['ok', 'path', 'bytes', 'backupPath', 'denied', 'reason', 'error'],
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
  const add = (toolName, def, impl, source = 'builtin') => {
    if (registry.has(toolName)) return registry.get(toolName).disposer
    const disposer = ctx.tools.register({ ...def, execute: impl })
    registry.set(toolName, { def, disposer, source })
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

  // 挂内置工具：转发壳把调用交给底层实现，并带配置与留痕（方案 §2.3 要素 3）。
  // 1.5.41 起签名统一为 `(args, exec)`；1.5.44 起清单工具用 exec 做异步结果回注。
  // 1.5.43：`watch_read` / `mem_sync` / `pkg_stats` **不再注册**（见 TOOL_NAMES 上方说明）。
  //   1.6.1 起其仓库内实现（toolkit-extra.js / pkg-stats.js）也已删除——它们现在是
  //   纯本机清单脚本；加载器只认 <记忆根>/toolbox.json，与仓库内实现不再有代码关系。
  const logUsage = createUsageLogger(cfg, warn)

  /**
   * 1.5.44：本地工具清单管理器。**必须在 builtins 之外单独建**——它要能在
   * toolbox_reload 里反复 add/remove；清单工具的 execute 要拿到 exec（followup 用）。
   *
   * 已知问题（1.5.44 的取舍，写在这里免得以后当成 bug 查）：
   * 清单加载在 apply() 期（preset 启动期）做一次，那时还没有任何会话、拿不到 exec；
   * 所以**校验问题（JSON 坏、脚本缺失）此时只能先存起来**，等第一个 agent/pre-step
   * 到来时注入会话。清单工具注册本身不需要 exec，注册不受影响。
   */
  const manifest = createManifestManager({
    addTool: (toolName, def, impl, source) => add(toolName, def, impl, source),
    removeTool: (toolName) => remove(toolName),
    registerOwnTool,
    cfg,
    warn,
  })

  const builtins = [
    [CMD_SCHEMA, (args) => runCmd(args, cfg, logUsage)],
    [READ_SCHEMA, (args) => doRead(args, cfg, logUsage)],
    [WRITE_SCHEMA, (args) => doWrite(args, cfg, logUsage)],
    // 1.5.44 管理工具（同步：只读清单 + 改工具目录，几毫秒；跑脚本一律走清单工具的异步壳）。
    // 1.6.1 新增 toolbox_remove：改清单文件（原子写）+ 重载，是三个管理工具里唯一动文件的。
    [TOOLBOX_LIST_SCHEMA, () => {
      const report = manifest.inspect()
      return shapeToolboxList({ ...report, error: report.fatal })
    }],
    [TOOLBOX_RELOAD_SCHEMA, () => {
      const report = manifest.reload()
      const registered = [...report.registered]
      const hint = report.exists
        ? `已重载清单：注册 ${registered.length} 个，跳过 ${report.skipped.length} 个${report.problems.length > 0 ? `，${report.problems.length} 条有问题` : ''}`
        : `清单不存在（${report.path || '记忆根未解析'}），本次只注销了旧清单工具：${report.removed.length} 个`
      return shapeToolboxReload({
        ok: report.problems.length === 0 && !report.fatal,
        exists: report.exists,
        path: report.path,
        removed: report.removed,
        registered,
        skipped: report.skipped,
        problems: report.fatal ? [report.fatal, ...report.problems] : report.problems,
        hint,
        error: report.fatal,
      })
    }],
    [TOOLBOX_REMOVE_SCHEMA, (args) => {
      const report = manifest.removeEntry(args?.name)
      return shapeToolboxRemove(report)
    }],
  ]
  for (const [def, impl] of builtins) {
    try {
      add(def.name, def, impl)
    } catch (error) {
      warn(`aiyayi-toolkit: 工具 ${def.name} 注册失败（该工具本次不可用，其余不受影响）: ${error?.message ?? error}`)
    }
  }

  // 1.5.44：读本机清单，按 enabled:true 注册（每个都走异步壳，见 toolkit-manifest.js）。
  // 全程 try/catch——清单坏了只影响清单工具，不阻塞插件激活与三个基础工具。
  try {
    const report = manifest.load()
    if (report.registered.length > 0) {
      warn(`aiyayi-toolkit: 本地清单注册了 ${report.registered.length} 个工具：${report.registered.join('、')}`)
    }
    if (report.fatal) warn(`aiyayi-toolkit: 本地清单不可用：${report.fatal}`)
  } catch (error) {
    warn(`aiyayi-toolkit: 本地清单加载失败（清单工具本次不可用）: ${error?.message ?? error}`)
  }

  // 1.5.44：清单校验问题**必须报回会话**（JSON 坏 / 某条校验失败 / 脚本缺失），不许静默。
  // 挂 pre-step：apply 期没有会话，拿不到 followup；等第一个 agent 的第一步再注入，
  // 一条快照消息说清"哪条清单工具没起来、为什么"。取过即清空，不重复刷屏。
  // 用 ctx.effect 包住（同 restrict.js），卸载时自动摘钩子；通道不可用也不影响工具本身。
  try {
    const reportedSessions = new WeakSet()
    ctx.effect(
      () =>
        ctx.on('agent/pre-step', async ({ agent }, next) => {
          const decision = await next()
          try {
            if (decision && decision.kind !== 'reject' && manifest.pendingCount() > 0 && !reportedSessions.has(agent)) {
              const issues = manifest.takePendingIssues()
              if (issues.length > 0) {
                reportedSessions.add(agent)
                const text = [
                  '[工具清单] 本机工具清单（<记忆根>/toolbox.json）有问题，以下条目没注册上（其余工具不受影响）：',
                  ...issues.map((item) => `  · ${item}`),
                  '改好清单或脚本后调 toolbox_reload 重载；清单格式见 README「本地工具清单」一节。',
                ].join('\n')
                return { ...decision, messages: [...(decision.messages ?? []), createSnapshotMessage(text)] }
              }
            }
          } catch {
            /* 注入失败不影响对话 */
          }
          return decision
        }),
      'aiyayi-toolkit.manifest-issues()',
    )
  } catch (error) {
    warn(`aiyayi-toolkit: 清单问题上报钩子注册失败（问题只留在日志里）: ${error?.message ?? error}`)
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

/**
 * 造一条"系统快照"消息（pre-step 注入用）。结构照抄 presence.js 的同名函数：
 * 纯 JSON 字段、`source` 里没有 undefined（坑 #65）。
 * 不直接 import presence.js 那份：它是插件内部的私有函数，跨插件引用会把两个 loader 耦死。
 */
function createSnapshotMessage(text, sourceName = 'aiyayi-toolkit') {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze(TEXT_BLOCK(text)),
    source: Object.freeze({
      kind: sourceName,
      form: 'snapshot',
      sections: Object.freeze([Object.freeze({ name: sourceName, text })]),
    }),
  })
}

/* 测试出口：只给单测用。 */
export const __testing = {
  makeRec,
  ringTrim,
}
