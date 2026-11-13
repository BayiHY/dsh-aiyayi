/**
 * aiyayi-toolkit / 本地工具清单（1.5.44 新增）：`<记忆根>/toolbox.json` 驱动的动态工具注册。
 *
 * **为什么要有这一层**（李浩 2026-11-12 定调）：
 *   1. 工具箱存在的目的是让本体能**异步执行命令和工具**、不阻断对话：**每个清单工具都必须
 *      立刻返回 taskId，后台跑完用 followup 推回会话**（骨架在 lib/toolkit-async.js）。
 *      同步工具一旦卡住整轮就堵死，那还不如不用——所以本加载器**只接受 `mode: "async"`**，
 *      写 `sync` 直接判该条校验失败并报回会话（不是"悄悄降级成异步"）。
 *   2. npm 安装包里只留简单通用的能力（toolkit_cmd / toolkit_read / toolkit_write）。
 *      其他工具（mem_sync / pkg_stats / watch_read…）走**本地清单**：清单和脚本都在本机，
 *      清单里引用本机脚本绝对路径，**脚本不进 npm 包**。这样普通用户装插件不会看到一堆
 *      用不上的工具（实测 6 个工具约 1334 token/轮）。
 *
 * 清单格式（最终版，见 CHANGELOG 1.5.44）：
 * {
 *   "version": 1,
 *   "tools": [
 *     {
 *       "name": "mem_sync",            // 必填，^[a-z][a-z0-9_]{1,40}$
 *       "enabled": true,               // 默认 false，显式 true 才注册
 *       "script": "G:/阿依娅伊/工具/mem_sync/mem_sync.js",  // 必填，支持 ~ 与 %变量%
 *       "description": "…",            // 必填，给模型的工具描述
 *       "timeoutMs": 60000,            // 默认 60000，上限 300000
 *       "mode": "async",               // 只支持 async（sync 一律拒绝）
 *       "args": [],                    // 固定参数（附加在脚本路径之后）
 *       "params": { "message": { "type": "string", "description": "…" } }, // 可选，调用参数
 *       "env": { "KEY": "VALUE" },     // 可选，给脚本的环境变量（本机配置走这里）
 *       "cwd": "G:/阿依娅伊/工具/mem_sync", // 可选，默认脚本所在目录
 *       "capabilities": {              // 1.6.1 可选，能力声明（不声明 = 全量能力，兼容现状）
 *         "paths": {                   //   路径白名单（绝对路径，支持 ~ 与 %变量% 展开）
 *           "read": ["G:/阿依娅伊/记忆"],
 *           "write": ["G:/阿依娅伊/记忆/notes"]
 *         },
 *         "process": true,             //   是否允许 spawn 子进程（默认 true）
 *         "env": "full"                //   传给脚本的环境变量："full"（默认）或白名单键数组
 *       }
 *     }
 *   ]
 * }
 *
 * **capabilities 的 enforce 实况（1.6.1，如实写，不许夸大）**：
 *   · 执行壳是 `spawn` 外部脚本，脚本内部的文件读写在子进程里发生，**壳层硬拦做不到**；
 *   · `paths` 因此是**"声明 + 透传"级**：声明值经 `AIYAYI_TOOLBOX_CAPABILITIES` 环境变量
 *     透传给脚本（供脚本自觉与事后审计），壳层另外做到的是**调用前校验**——把条目自己
 *     声明的 `cwd` 与 `env` 里的绝对路径对白名单核一遍，越界就不起进程（fail-close）；
 *   · `process: false`：现壳唯一执行路径就是 spawn 外部脚本，没有"不起进程跑脚本"的模式，
 *     所以这条的 enforce 落点 = **调用即拒绝**（executeManifestTool 同步报错，fail-close）；
 *   · `env: 数组`：spawn 时父进程环境只透传白名单键 + 系统最低需求（PATH / SYSTEMROOT 等，
 *     见 MIN_SPAWN_ENV_KEYS）+ AIYAYI_TOOLBOX_* 组，其余不传。这条是壳层**真硬拦**。
 *   · 校验（validateEntry）：capabilities 结构非法（未知子键 / 类型错）→ 拒注册该条目；
 *     条目的**未知顶层字段**不再静默忽略，改为收集 warning（报回会话，防拼写错误埋雷）。
 *
 * **失败必须显式报回会话**（任务书要求，不许静默）：
 *   · 清单文件不存在 → 记日志，不报错（用户没配，正常情况）；
 *   · 清单 JSON 语法错误 → 收集成一条 issue，由 apply 时的 pre-step 注入会话（也 warn）；
 *   · 某条校验失败 → 收集 issue（含工具名 + 原因），**其他工具照常加载**；
 *   · 脚本文件不存在 → 该条不注册，并收集 issue；
 *   · 脚本运行失败/超时 → followup 报回会话，带退出码与 stderr 摘要。
 *
 * 能力声明校验放在**加载器**里（不是脚本自己说了算）：脚本路径必须存在且是普通文件；
 * 1.6.1 起条目可以带 capabilities 做能力声明（见上），paths 白名单的 enforce 级别如实写在上面——
 * 壳层做不到硬拦的部分不假装能做到。
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { startDetachedTask } from './toolkit-async.js'
import { resolveRoot } from './home.js'

/** 清单文件名（放记忆根下）。 */
export const MANIFEST_NAME = 'toolbox.json'

/** 默认 / 上限超时（ms）。 */
export const DEFAULT_TIMEOUT_MS = 60000
export const MAX_TIMEOUT_MS = 300000
export const MIN_TIMEOUT_MS = 1000

/** 工具名规则（任务书钦定）。 */
export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,40}$/

/** 参数名规则（宽松一点：允许下划线开头，即 `_` 开头的也不会撞宿主）。 */
export const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/

/** 支持简化 schema 的三种参数类型。 */
export const PARAM_TYPES = ['string', 'number', 'boolean']

/** 清单条目的已知顶层字段（1.6.1：不在表里的字段不再静默忽略，改为收集 warning）。 */
export const KNOWN_ENTRY_KEYS = ['name', 'enabled', 'mode', 'script', 'description', 'timeoutMs', 'args', 'params', 'env', 'cwd', 'capabilities']

/** capabilities 的合法子键（1.6.1；其余子键 fail-close 拒注册）。 */
export const CAPABILITY_KEYS = ['paths', 'process', 'env']

/** capabilities.paths 的合法子键。 */
export const CAPABILITY_PATH_KEYS = ['read', 'write']

/**
 * env 白名单模式下必带的系统最低需求（1.6.1）：没有这些键，node / python 在 Windows 上
 * 可能连启动都起不来（SYSTEMROOT 缺失时 node 的 crypto 直接炸是实测过的老坑）。
 * win32 上按键名大小写不敏感匹配；非 win32 平台这些键不存在于 process.env 时自然跳过。
 */
export const MIN_SPAWN_ENV_KEYS = ['PATH', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']

/** stdout/stderr 收集硬上限（超出丢弃，防内存被大输出打爆）。 */
const COLLECT_CAP = 256 * 1024

/** 投回会话时 stdout 的展示上限（字符）。 */
const SHOW_CAP = 6000

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/* ------------------------------------------------------------------ *
 * 一、纯函数：路径展开 / 脚本类型 / 参数 schema
 * ------------------------------------------------------------------ */

/**
 * 展开清单里写的路径：支持 `~`（家目录）与 `%变量%`（Windows 风格）、`${变量}`（POSIX 风格）。
 * 未定义的变量**原样保留**——那样后面的存在性检查会直接报"脚本不存在"，比静默改成空串好查得多。
 */
export function expandPath(raw, env = process.env) {
  let text = String(raw ?? '').trim()
  if (!text) return ''
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) text = join(homedir(), text.slice(2))
  text = text.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, key) => {
    const value = env?.[key]
    return value === undefined || value === null ? whole : String(value)
  })
  text = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, key) => {
    const value = env?.[key]
    return value === undefined || value === null ? whole : String(value)
  })
  return text
}

/** 脚本存在且是普通文件（不是目录）。返回 {exists, isFile}。 */
export function inspectScript(scriptPath) {
  if (!scriptPath) return { exists: false, isFile: false }
  try {
    const st = statSync(scriptPath)
    return { exists: true, isFile: st.isFile() }
  } catch {
    return { exists: false, isFile: false }
  }
}

/**
 * 按扩展名决定怎么跑（任务书：node / python / 可执行文件）。
 * @returns {{cmd: string, prefix: string[], kind: string}}
 *   `prefix` 是插在脚本路径**之前**的参数；最终 argv = [...prefix, script, ...固定args]。
 */
export function interpreterFor(scriptPath, cfg = {}) {
  const ext = extname(String(scriptPath ?? '')).toLowerCase()
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
    return { cmd: String(cfg.manifestNode ?? '').trim() || process.execPath, prefix: [], kind: 'node' }
  }
  if (ext === '.py' || ext === '.pyw') {
    return { cmd: String(cfg.manifestPython ?? '').trim() || 'python', prefix: [], kind: 'python' }
  }
  if (ext === '.ps1') {
    return {
      cmd: String(cfg.manifestPowershell ?? '').trim() || 'powershell',
      prefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
      kind: 'powershell',
    }
  }
  if (ext === '.cmd' || ext === '.bat') {
    return { cmd: process.env.ComSpec || 'cmd.exe', prefix: ['/c'], kind: 'cmd' }
  }
  // 其余按"本身可执行"处理（.exe / 无扩展名的二进制）。
  return { cmd: String(scriptPath), prefix: [], kind: 'exe' }
}

/**
 * 把清单里的简化 `params` 翻译成宿主认的 JSON Schema 片段。
 * 只支持 string / number / boolean 三种类型（任务书）；其余类型判该条校验失败。
 * @returns {{ok: boolean, problems: string[], properties: object, required: string[]}}
 */
export function buildParamsSchema(params) {
  const out = { ok: true, problems: [], properties: {}, required: [] }
  if (params === undefined || params === null) return out
  if (typeof params !== 'object' || Array.isArray(params)) {
    out.ok = false
    out.problems.push('params 必须是对象（参数名 → schema）')
    return out
  }
  for (const [key, spec] of Object.entries(params)) {
    if (!PARAM_NAME_RE.test(key)) {
      out.ok = false
      out.problems.push(`参数名不合规：${JSON.stringify(key)}（须匹配 ${PARAM_NAME_RE}）`)
      continue
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      out.ok = false
      out.problems.push(`参数 ${key} 的 schema 必须是对象`)
      continue
    }
    const type = String(spec.type ?? '').trim()
    if (!PARAM_TYPES.includes(type)) {
      out.ok = false
      out.problems.push(`参数 ${key} 的 type 只支持 ${PARAM_TYPES.join(' / ')}，收到 ${JSON.stringify(spec.type)}`)
      continue
    }
    const property = { type }
    if (spec.description !== undefined) property.description = String(spec.description)
    out.properties[key] = property
    if (spec.required === true) out.required.push(key)
  }
  return out
}

/**
 * 归一并校验一条目的 capabilities 声明（1.6.1，**纯函数**）。
 *
 * 规则（fail-close：结构非法整条拒注册，不做"能修就修"的静默改写）：
 *   · capabilities 不是对象（含数组）→ 非法；
 *   · 未知子键（不在 CAPABILITY_KEYS 里）→ 非法——写错能力名比少个能力更危险，宁可拒；
 *   · paths：对象（子键只认 read / write），值是非空字符串数组，逐项 expandPath（支持 ~ 与
 *     %变量%）后必须是绝对路径；白名单条目不要求此刻存在（可以指向将来才建的目录）；
 *   · process：布尔；
 *   · env：`"full"` 或非空字符串数组（键名原样使用、不 trim，防止静默改写）；
 *   · 未声明（undefined）→ ok，caps = null（沿用全量能力，兼容现状）。
 *
 * @returns {{ok: boolean, problems: string[], caps: object|null}}
 *   caps 是归一后的声明：{ paths: {read?, write?}, process: boolean, env: 'full'|string[] }。
 */
export function buildCapabilities(raw, { label = 'entry', env = process.env } = {}) {
  if (raw === undefined) return { ok: true, problems: [], caps: null }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      problems: [`${label} 的 capabilities 必须是对象（收到 ${Array.isArray(raw) ? '数组' : typeof raw}）`],
      caps: null,
    }
  }
  const problems = []
  const caps = { paths: {}, process: true, env: 'full' }
  for (const key of Object.keys(raw)) {
    if (!CAPABILITY_KEYS.includes(key)) {
      problems.push(`${label} 的 capabilities 有未知子键 ${JSON.stringify(key)}（只认 ${CAPABILITY_KEYS.join(' / ')}；fail-close 拒注册）`)
    }
  }
  if (raw.paths !== undefined) {
    if (!raw.paths || typeof raw.paths !== 'object' || Array.isArray(raw.paths)) {
      problems.push(`${label} 的 capabilities.paths 必须是对象（子键 read / write，值是绝对路径数组）`)
    } else {
      for (const key of Object.keys(raw.paths)) {
        if (!CAPABILITY_PATH_KEYS.includes(key)) {
          problems.push(`${label} 的 capabilities.paths 有未知子键 ${JSON.stringify(key)}（只认 ${CAPABILITY_PATH_KEYS.join(' / ')}）`)
          continue
        }
        const list = raw.paths[key]
        if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || item.trim() === '')) {
          problems.push(`${label} 的 capabilities.paths.${key} 必须是非空字符串数组`)
          continue
        }
        const expanded = []
        for (const item of list) {
          const value = expandPath(item, env)
          if (!isAbsolute(value)) {
            problems.push(`${label} 的 capabilities.paths.${key} 里的路径必须是绝对路径（支持 ~ 展开），收到 ${JSON.stringify(item)}`)
            continue
          }
          expanded.push(value)
        }
        if (expanded.length > 0) caps.paths[key] = expanded
      }
    }
  }
  if (raw.process !== undefined) {
    if (typeof raw.process !== 'boolean') {
      problems.push(`${label} 的 capabilities.process 必须是布尔值，收到 ${JSON.stringify(raw.process)}`)
    } else {
      caps.process = raw.process
    }
  }
  if (raw.env !== undefined) {
    if (raw.env === 'full') {
      caps.env = 'full'
    } else if (Array.isArray(raw.env) && raw.env.every((item) => typeof item === 'string' && item !== '')) {
      caps.env = [...raw.env]
    } else {
      problems.push(`${label} 的 capabilities.env 只接受 "full" 或非空字符串数组，收到 ${JSON.stringify(raw.env)}`)
    }
  }
  if (problems.length > 0) return { ok: false, problems, caps: null }
  return { ok: true, problems: [], caps }
}

/** 路径同一性（Windows 大小写不敏感；与 lib/toolkit.js 的 samePath 同款逻辑）。 */
export function sameManifestPath(left, right) {
  const a = resolve(String(left ?? ''))
  const b = resolve(String(right ?? ''))
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** child 是否在 parent 里（按规范化路径前缀比；与 lib/toolkit.js 的 isInside 同款逻辑）。 */
export function isInsideManifestPath(child, parent) {
  if (sameManifestPath(child, parent)) return true
  const a = resolve(String(child ?? ''))
  const b = resolve(String(parent ?? ''))
  const [left, right] = process.platform === 'win32' ? [a.toLowerCase(), b.toLowerCase()] : [a, b]
  const prefix = right.endsWith(sep) ? right : `${right}${sep}`
  return left.startsWith(prefix)
}

/**
 * 判一个绝对路径是否被白名单覆盖。roots 为空（没有声明任何 read/write）= 不限制，一律放行。
 */
export function pathAllowedByWhitelist(target, roots) {
  const list = (Array.isArray(roots) ? roots : []).filter((item) => typeof item === 'string' && item.trim() !== '')
  if (list.length === 0) return true
  return list.some((root) => isInsideManifestPath(target, root))
}

/**
 * 1.6.1 enforce ②（paths）的调用前校验：把条目**自己声明**的 cwd 与 env 里的绝对路径
 * 对 capabilities.paths 白名单（read ∪ write）核一遍，越界返回拒绝理由，通过返回空串。
 *
 * 如实说明（不许夸大）：这只拦"清单里自己写明的路径"，拦不住脚本运行时自己决定读写哪儿——
 * 那部分只能靠 AIYAYI_TOOLBOX_CAPABILITIES 透传后的脚本自觉与事后审计（见模块头注释）。
 * 白名单声明了任何一个维度时，cwd 与 env 绝对路径都必须落在 read ∪ write 内
 * （cwd 既可能读也可能写，从严处理）。
 */
export function checkDeclaredPaths(tool) {
  const caps = tool?.capabilities
  const roots = [
    ...(Array.isArray(caps?.paths?.read) ? caps.paths.read : []),
    ...(Array.isArray(caps?.paths?.write) ? caps.paths.write : []),
  ]
  if (roots.length === 0) return ''
  const label = String(tool?.name ?? 'tool')
  if (tool.cwd) {
    if (!pathAllowedByWhitelist(tool.cwd, roots)) {
      return `${label} 的 capabilities.paths 白名单未覆盖其 cwd：${tool.cwd}（已拒绝启动；cwd 必须落在声明的 read/write 白名单内）`
    }
  }
  for (const [key, value] of Object.entries(tool.env ?? {})) {
    const expanded = expandPath(value)
    if (isAbsolute(expanded) && !pathAllowedByWhitelist(expanded, roots)) {
      return `${label} 的 env.${key} 指向白名单外路径：${expanded}（已拒绝启动；paths 白名单须覆盖清单 env 里声明的绝对路径）`
    }
  }
  return ''
}

/**
 * 1.6.1 enforce ③（env 白名单）的实现：capabilities.env 是数组时，父进程环境只透传
 * 白名单键 + MIN_SPAWN_ENV_KEYS（系统最低需求）。这是壳层唯一真正"硬拦"的维度。
 * win32 按键名大小写不敏感匹配（Windows 环境变量本就不分大小写）；白名单里
 * 父进程没有的键自然缺席，不报错（声明多于实有是合法的）。
 */
export function pickWhitelistedEnv(sourceEnv, whitelist) {
  const source = sourceEnv && typeof sourceEnv === 'object' ? sourceEnv : {}
  const insensitive = process.platform === 'win32'
  const index = new Map()
  for (const [key, value] of Object.entries(source)) index.set(insensitive ? key.toLowerCase() : key, [key, value])
  const wanted = []
  for (const item of Array.isArray(whitelist) ? whitelist : []) {
    if (typeof item === 'string' && item !== '') wanted.push(item)
  }
  for (const name of MIN_SPAWN_ENV_KEYS) wanted.push(name)
  const out = {}
  for (const name of wanted) {
    const hit = index.get(insensitive ? name.toLowerCase() : name)
    if (hit !== undefined) out[hit[0]] = hit[1]
  }
  return out
}

/**
 * 组装传给清单脚本的环境变量（1.6.1 起受 capabilities 约束，runToolScript 用）。
 *   · env: "full"（默认，含未声明）→ 全量 process.env（兼容现状）；
 *   · env: 数组 → pickWhitelistedEnv 的白名单结果；
 *   · 叠加：清单条目自带的 env（本机配置，用户显式声明，恒透传）→ AIYAYI_TOOLBOX_* 组
 *     （新增 AIYAYI_TOOLBOX_CAPABILITIES：能力声明的 JSON，未声明时为 null）→ 编码项。
 */
export function buildSpawnEnv(tool, { root = '', manifestPath = '', callArgs = {} } = {}) {
  const caps = tool?.capabilities ?? null
  const base = caps && Array.isArray(caps.env) ? pickWhitelistedEnv(process.env, caps.env) : { ...process.env }
  return {
    ...base,
    ...(tool.env ?? {}),
    AIYAYI_TOOLBOX_TOOL: tool.name,
    AIYAYI_TOOLBOX_ROOT: root,
    AIYAYI_TOOLBOX_MANIFEST: manifestPath,
    AIYAYI_TOOLBOX_ARGS: JSON.stringify({ tool: tool.name, args: callArgs ?? {}, fixedArgs: tool.args ?? [] }),
    AIYAYI_TOOLBOX_CAPABILITIES: JSON.stringify(caps ?? null),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
}

/**
 * 校验一条清单条目（**纯函数**，不注册、不碰文件系统以外的东西）。
 * @returns {{name: string, enabled: boolean, mode: string, script: string, scriptExists: boolean,
 *            description: string, timeoutMs: number, args: string[], params: object,
 *            env: object, cwd: string, capabilities: object|null, capabilitiesDeclared: boolean,
 *            warnings: string[], index: number, problems: string[]}}
 *   `problems` 非空 = 这条不注册（但**其他条目照常加载**）。
 *   `capabilities` 是归一后的声明（null = 未声明，沿用全量能力）；
 *   `warnings` 是不判失败但要报回会话的提示（1.6.1：未知顶层字段从这里出）。
 */
export function validateEntry(raw, { index = 0, env = process.env } = {}) {
  const entry = {
    name: '',
    enabled: false,
    mode: 'async',
    script: '',
    scriptExists: false,
    description: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    args: [],
    params: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    env: {},
    cwd: '',
    capabilities: null,
    capabilitiesDeclared: false,
    warnings: [],
    index,
    problems: [],
  }
  const label = `tools[${index}]`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    entry.problems.push(`${label} 必须是对象`)
    return entry
  }

  // name（必填）
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    entry.problems.push(`${label} 缺必填字段 name`)
  } else {
    entry.name = raw.name.trim()
    if (!TOOL_NAME_RE.test(entry.name)) {
      entry.problems.push(`${label} 的 name 不合规：${JSON.stringify(entry.name)}（须匹配 ${TOOL_NAME_RE}）`)
    }
  }

  // enabled（默认 false，显式 true 才注册）
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') {
      entry.problems.push(`${entry.name || label} 的 enabled 必须是布尔值，收到 ${JSON.stringify(raw.enabled)}`)
    } else {
      entry.enabled = raw.enabled
    }
  }

  // mode：只支持 async（sync 会堵死整轮对话，必须拒绝而不是降级）
  if (raw.mode !== undefined) {
    const mode = String(raw.mode ?? '').trim().toLowerCase()
    if (mode !== 'async') {
      entry.mode = mode
      entry.problems.push(
        `${entry.name || label} 的 mode=${JSON.stringify(raw.mode)} 不被支持：清单工具**只允许 async**`
        + '（同步工具会堵死整轮对话，这正是要避开的；请把脚本改成 CLI 形式，由加载器异步跑）',
      )
    }
  }

  // script（必填，允许 ~ 与 %变量%）
  if (typeof raw.script !== 'string' || raw.script.trim() === '') {
    entry.problems.push(`${entry.name || label} 缺必填字段 script`)
  } else {
    entry.script = expandPath(raw.script, env)
    if (!isAbsolute(entry.script)) {
      entry.problems.push(`${entry.name || label} 的 script 必须是绝对路径，收到 ${JSON.stringify(raw.script)}`)
    } else {
      const info = inspectScript(entry.script)
      entry.scriptExists = info.exists && info.isFile
      if (!info.exists) entry.problems.push(`${entry.name || label} 的脚本不存在：${entry.script}`)
      else if (!info.isFile) entry.problems.push(`${entry.name || label} 的脚本不是普通文件（是目录？）：${entry.script}`)
    }
  }

  // description（必填）
  if (typeof raw.description !== 'string' || raw.description.trim() === '') {
    entry.problems.push(`${entry.name || label} 缺必填字段 description`)
  } else {
    entry.description = raw.description.trim()
  }

  // timeoutMs（默认 60000，上限 300000；超上限按上限夹取并记一笔警告，不判失败）
  if (raw.timeoutMs !== undefined) {
    const value = Number(raw.timeoutMs)
    if (!Number.isFinite(value) || value <= 0) {
      entry.problems.push(`${entry.name || label} 的 timeoutMs 必须是正数，收到 ${JSON.stringify(raw.timeoutMs)}`)
    } else if (value < MIN_TIMEOUT_MS) {
      entry.timeoutMs = MIN_TIMEOUT_MS
    } else {
      entry.timeoutMs = Math.min(Math.floor(value), MAX_TIMEOUT_MS)
    }
  }

  // args（固定参数；非字符串按字符串化处理，对象/数组判失败）
  if (raw.args !== undefined) {
    if (!Array.isArray(raw.args)) {
      entry.problems.push(`${entry.name || label} 的 args 必须是数组`)
    } else {
      for (const item of raw.args) {
        if (typeof item === 'object' && item !== null) {
          entry.problems.push(`${entry.name || label} 的 args 只接受标量，收到 ${JSON.stringify(item)}`)
          continue
        }
        entry.args.push(String(item))
      }
    }
  }

  // params（简化 JSON Schema）
  const params = buildParamsSchema(raw.params)
  if (!params.ok) {
    for (const problem of params.problems) entry.problems.push(`${entry.name || label}：${problem}`)
  } else {
    entry.params = { type: 'object', additionalProperties: false, properties: params.properties, required: params.required }
  }

  // env（本机配置：脚本从环境变量读，清单不必塞参数）
  if (raw.env !== undefined) {
    if (!raw.env || typeof raw.env !== 'object' || Array.isArray(raw.env)) {
      entry.problems.push(`${entry.name || label} 的 env 必须是对象（键值都是字符串）`)
    } else {
      for (const [key, value] of Object.entries(raw.env)) {
        if (typeof value === 'object' && value !== null) {
          entry.problems.push(`${entry.name || label} 的 env.${key} 只接受标量`)
          continue
        }
        entry.env[key] = String(value)
      }
    }
  }

  // cwd（可选；默认脚本所在目录）
  if (raw.cwd !== undefined) {
    if (typeof raw.cwd !== 'string' || raw.cwd.trim() === '') {
      entry.problems.push(`${entry.name || label} 的 cwd 必须是非空字符串`)
    } else {
      entry.cwd = expandPath(raw.cwd, env)
      if (!isAbsolute(entry.cwd)) {
        entry.problems.push(`${entry.name || label} 的 cwd 必须是绝对路径`)
      } else if (!existsSync(entry.cwd)) {
        entry.problems.push(`${entry.name || label} 的 cwd 不存在：${entry.cwd}`)
      }
    }
  }

  // capabilities（1.6.1，可选）：声明即收窄；结构非法（未知子键 / 类型错 / 路径非绝对）
  // 一律 fail-close 拒注册该条目，issue 里写明原因——不静默降级成"未声明"。
  if (raw.capabilities !== undefined) {
    const caps = buildCapabilities(raw.capabilities, { label: entry.name || label, env })
    if (!caps.ok) {
      for (const problem of caps.problems) entry.problems.push(problem)
    } else {
      entry.capabilities = caps.caps
      entry.capabilitiesDeclared = true
    }
  }

  // 未知顶层字段（1.6.1 起不再静默忽略）：收集 warning（不判失败——可能是未来的新字段），
  // 报回会话让人核对拼写（写错 "scirpt" 会同时有一条"缺必填字段 script"的 problem，两头都能发现）。
  for (const key of Object.keys(raw)) {
    if (!KNOWN_ENTRY_KEYS.includes(key)) {
      entry.warnings.push(`${entry.name || label} 有未知顶层字段 ${JSON.stringify(key)}（已忽略；请核对是否拼写错误）`)
    }
  }

  return entry
}

/** JSON.parse 的报错定位（"at position N" → 第 X 行第 Y 列），方便用户自己改清单。 */
function describeJsonError(error, text) {
  const message = String(error?.message ?? error)
  const match = /at position (\d+)/.exec(message)
  if (!match) return message
  const position = Number(match[1])
  const before = String(text ?? '').slice(0, position)
  const line = before.split('\n').length
  const column = position - before.lastIndexOf('\n')
  return `${message}（第 ${line} 行第 ${column} 列附近）`
}

/**
 * 解析一份清单文本（不注册、不读文件）。**顶层坏掉 = fatal，条目坏掉 = problems（其余照常）。**
 * @returns {{ok: boolean, fatal: string, entries: Array<object>, problems: Array<{name: string, reason: string}>,
 *            warnings: string[], version: number}}
 */
export function parseManifestText(text, { env = process.env, path = '' } = {}) {
  const out = { ok: false, fatal: '', entries: [], problems: [], warnings: [], version: 0 }
  const body = String(text ?? '').replace(/^\uFEFF/, '')
  if (body.trim() === '') {
    out.fatal = `清单是空文件：${path || MANIFEST_NAME}`
    return out
  }
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    out.fatal = `清单 JSON 语法错误：${describeJsonError(error, body)}（文件：${path || MANIFEST_NAME}）`
    return out
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    out.fatal = `清单顶层必须是 JSON 对象（文件：${path || MANIFEST_NAME}）`
    return out
  }
  if (parsed.version !== undefined) {
    if (parsed.version !== 1) {
      out.fatal = `不支持的清单 version=${JSON.stringify(parsed.version)}：本版只认 version: 1`
      return out
    }
    out.version = 1
  }
  if (!Array.isArray(parsed.tools)) {
    out.fatal = '清单缺 tools 数组（结构：{"version":1,"tools":[…]})'
    return out
  }

  const seen = new Map()
  parsed.tools.forEach((raw, index) => {
    const entry = validateEntry(raw, { index, env })
    if (entry.name) {
      const first = seen.get(entry.name)
      if (first !== undefined) {
        entry.problems.push(`${entry.name} 与 tools[${first}] 重名（同名工具只能注册一个）`)
      } else {
        seen.set(entry.name, index)
      }
    }
    if (entry.timeoutMs >= MAX_TIMEOUT_MS && Number(raw?.timeoutMs) > MAX_TIMEOUT_MS) {
      out.warnings.push(`${entry.name || `tools[${index}]`} 的 timeoutMs 超过上限，已按 ${MAX_TIMEOUT_MS}ms 夹取`)
    }
    out.entries.push(entry)
    // 条目级 warning（1.6.1：未知顶层字段等）并入清单级 warnings，由 manager 报回会话。
    for (const warning of entry.warnings ?? []) out.warnings.push(warning)
    if (entry.problems.length > 0) {
      out.problems.push({ name: entry.name || `tools[${index}]`, reason: entry.problems.join('；') })
    }
  })
  // 清单本身能读、能解析 → ok；条目问题走 problems（不影响别的条目）。
  out.ok = true
  return out
}

/** 读记忆根下的清单（不存在算正常：返回 exists:false）。`path` 给了就整体接管（调试/多套清单用）。 */
export function loadManifest({ root, path: pathOverride, env = process.env } = {}) {
  let base = ''
  if (pathOverride) {
    const explicit = expandPath(pathOverride, env)
    return readManifestFile(explicit, { env, root: dirname(explicit) })
  }
  if (root !== undefined) {
    base = String(root ?? '')
  } else {
    try {
      base = String(resolveRoot()?.root ?? '')
    } catch (error) {
      return {
        ok: false, exists: false, path: '', fatal: `记忆根解析失败：${error?.message ?? error}`,
        entries: [], problems: [], warnings: [], version: 0,
      }
    }
  }
  if (!base) {
    return {
      ok: false, exists: false, path: '', fatal: '记忆根未解析（location.json / AIYAYI_HOME / 默认路径都拿不到）',
      entries: [], problems: [], warnings: [], version: 0,
    }
  }
  const path = join(base, MANIFEST_NAME)
  return readManifestFile(path, { env, root: base })
}

/** 读一个具体的清单文件并解析（loadManifest 的内部实现）。 */
function readManifestFile(path, { env = process.env, root = '' } = {}) {
  if (!existsSync(path)) {
    // 正常情况：用户没配清单。**不报错、不进会话**，只留日志。
    return { ok: true, exists: false, path, fatal: '', entries: [], problems: [], warnings: [], version: 0, root }
  }
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return {
      ok: false, exists: true, path, fatal: `清单读取失败：${error?.message ?? error}`,
      entries: [], problems: [], warnings: [], version: 0, root,
    }
  }
  return { ...parseManifestText(text, { env, path }), exists: true, path, root }
}

/* ------------------------------------------------------------------ *
 * 二、脚本执行（后台线程里的活）
 * ------------------------------------------------------------------ */

/** 杀进程树（Windows 上 child.kill() 只杀外壳不杀孙进程，taskkill /T /F 兜底）。 */
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

/** 掐掉多字节字符被截断留下的半个字节（简单按 utf8 解码，Node 解码器自己会处理边界）。 */
function decode(buf) {
  return buf.toString('utf8')
}

/**
 * 跑一次清单脚本（**异步**，带任务级总超时）。
 * @param {object} options
 * @param {object} options.tool validateEntry() 出来的条目
 * @param {object} [options.callArgs] 工具调用参数（JSON 化后经 AIYAYI_TOOLBOX_ARGS 传）
 * @param {string} [options.root] 记忆根（透传给脚本）
 * @param {string} [options.manifestPath] 清单路径（透传给脚本）
 * @param {object} [options.cfg] 插件配置（manifestNode / manifestPython / manifestPowershell）
 * @returns {Promise<{exitCode:number, timedOut:boolean, stdout:string, stderr:string, spawnError:string, durationMs:number}>}
 */
export function runToolScript({ tool, callArgs = {}, root = '', manifestPath = '', cfg = {} } = {}) {
  return new Promise((done) => {
    const started = Date.now()
    const spec = interpreterFor(tool.script, cfg)
    const argv = [...spec.prefix, tool.script, ...(Array.isArray(tool.args) ? tool.args : [])]
    const cwd = tool.cwd || dirname(tool.script)
    // 1.6.1：环境变量组装受 capabilities.env 约束（full / 白名单），见 buildSpawnEnv。
    const env = buildSpawnEnv(tool, { root, manifestPath, callArgs })
    let child
    try {
      child = spawn(spec.cmd, argv, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
    } catch (error) {
      done({
        exitCode: -1, timedOut: false, stdout: '', stderr: '', durationMs: Date.now() - started,
        spawnError: `进程拉起失败（${spec.cmd}）：${error?.message ?? error}`,
      })
      return
    }
    const out = []
    const err = []
    let outBytes = 0
    let errBytes = 0
    let settled = false
    let timedOut = false
    const timeoutMs = Number(tool.timeoutMs) > 0 ? Number(tool.timeoutMs) : DEFAULT_TIMEOUT_MS
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
      done({
        exitCode: -1, timedOut: false, spawnError: '',
        stdout: decode(Buffer.concat(out)), stderr: decode(Buffer.concat(err)),
        durationMs: Date.now() - started,
        ...patch,
      })
    }

    child.stdout?.on('data', (chunk) => {
      if (outBytes >= COLLECT_CAP) return
      const buf = Buffer.from(chunk)
      out.push(buf.subarray(0, COLLECT_CAP - outBytes))
      outBytes += buf.length
    })
    child.stderr?.on('data', (chunk) => {
      if (errBytes >= COLLECT_CAP) return
      const buf = Buffer.from(chunk)
      err.push(buf.subarray(0, COLLECT_CAP - errBytes))
      errBytes += buf.length
    })
    child.on('error', (error) => {
      settle({ exitCode: -1, spawnError: `进程启动失败（${spec.cmd}）：${error?.message ?? error}` })
    })
    child.on('close', (code) => {
      settle({ exitCode: typeof code === 'number' ? code : -1 })
    })
  })
}

/** 尾部保留的文本（报错摘要用，前面不重要）。 */
function tailText(text, max = 800) {
  const s = String(text ?? '').trim()
  if (s.length <= max) return s
  return `…${s.slice(-max)}`
}

/** 头部保留的文本（结果正文用）。 */
function headText(text, max = SHOW_CAP) {
  const s = String(text ?? '').trim()
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n…（已截断，原长 ${s.length} 字符）`
}

/**
 * 把一次脚本执行结果做成**投回会话的正文**（成功/失败/超时都要说清，不许静默）。
 * @returns {{status: 'success'|'timeout'|'error', text: string, error: string}}
 */
export function composeReport({ tool, result }) {
  const seconds = (Number(result.durationMs) || 0) / 1000
  const stderr = String(result.stderr ?? '').trim()
  const stdout = String(result.stdout ?? '').trim()
  const lines = []

  // 脚本按约定向 stdout 输出 JSON（便于人读也便于程序读）；不是 JSON 就原样展示。
  let parsed = null
  if (stdout) {
    try {
      const value = JSON.parse(stdout)
      if (value && typeof value === 'object') parsed = value
    } catch {
      parsed = null
    }
  }

  let status = 'success'
  if (result.timedOut) status = 'timeout'
  else if (result.spawnError) status = 'error'
  else if (result.exitCode !== 0) status = 'error'
  else if (parsed && parsed.ok === false) status = 'error'

  const head = status === 'success'
    ? `【${tool.name} 结果】退出码 ${result.exitCode}，用时 ${seconds.toFixed(1)} 秒`
    : status === 'timeout'
      ? `【${tool.name} 失败】超时（上限 ${tool.timeoutMs}ms 已杀进程树），用时 ${seconds.toFixed(1)} 秒`
      : `【${tool.name} 失败】退出码 ${result.exitCode}，用时 ${seconds.toFixed(1)} 秒`
  lines.push(head)

  if (result.spawnError) lines.push(`启动失败：${result.spawnError}`)
  if (parsed && typeof parsed.hint === 'string' && parsed.hint.trim()) lines.push(parsed.hint.trim())
  if (parsed) {
    // 结构化结果：hint 已经说过结论，正文给完整 JSON（脚本自己保证是给人看的）。
    lines.push(headText(JSON.stringify(parsed, null, 2)))
  } else if (stdout) {
    lines.push(headText(stdout))
  } else {
    lines.push('（脚本没有输出 stdout）')
  }
  if (stderr) lines.push(`stderr 摘要：${tailText(stderr)}`)
  if (status === 'error' && !stderr && !result.spawnError) {
    lines.push('（脚本以非 0 退出码结束，但没有 stderr 输出）')
  }

  const error = status === 'success'
    ? ''
    : result.spawnError || (status === 'timeout' ? `超时 ${tool.timeoutMs}ms` : `退出码 ${result.exitCode}`)
  return { status, text: lines.join('\n'), error }
}

/* ------------------------------------------------------------------ *
 * 三、注册 / 重载 / 巡检（工具面用）
 * ------------------------------------------------------------------ */

/**
 * 给一条清单工具造宿主认的工具定义（parameters / output.schema / render）。
 * 输出形状固定五个字段（坑 #78：type 只能单字符串、required 列全、不许越界字段）。
 */
export function buildToolDef(tool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { ...tool.params.properties },
      required: [...tool.params.required],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', description: '是否成功受理（true=后台已开始，不代表脚本执行成功；结果走消息推回）。' },
          status: { type: 'string', description: 'started=后台已开跑；error=预检失败（脚本不存在等，详见 error）。' },
          taskId: { type: 'string', description: '后台任务 id（形如 tk-1a2b3c4d）；预检失败时为空字符串。' },
          tool: { type: 'string', description: '工具名，恒等于清单里的 name。' },
          hint: { type: 'string', description: '给调用方看的一句话提示；预检失败时为空字符串。' },
          error: { type: 'string', description: '预检失败原因；正常受理时为空字符串。' },
        },
        required: ['ok', 'status', 'taskId', 'tool', 'hint', 'error'],
      },
      render: (_args, value) => {
        if (!value.ok) return TEXT_BLOCK(`${value.tool || '清单工具'} 未启动：${value.error}`)
        return TEXT_BLOCK(`${value.hint}（taskId ${value.taskId}）`)
      },
    },
  }
}

/** 清单工具的输出归一（与 buildToolDef 的 output.schema 一一对应）。 */
export function shapeManifestOutput(result = {}, name = '') {
  return {
    ok: result.ok === true,
    status: String(result.status ?? 'error'),
    taskId: String(result.taskId ?? ''),
    tool: String(result.tool ?? name),
    hint: String(result.hint ?? ''),
    error: String(result.error ?? ''),
  }
}

/**
 * 清单工具的执行壳：**立刻返回 taskId**，脚本在后台跑，跑完 followup 推回会话。
 * 预检（脚本还在不在）放最前面，坏了就同步报错，不白起一个后台任务。
 *
 * 1.6.1 起预检追加 capabilities 的两个 enforce 落点（实况见模块头注释，这里只摘要）：
 *   · process:false → 同步拒绝（现壳唯一执行路径就是 spawn，没有不起进程的执行模式）；
 *   · paths 声明 → 把条目自带的 cwd / env 绝对路径对白名单核一遍，越界同步拒绝；
 *     脚本运行期的读写壳层拦不住，声明值经 AIYAYI_TOOLBOX_CAPABILITIES 透传（声明+透传级）。
 */
export function executeManifestTool(tool, args, { exec, cfg, warn } = {}) {
  const info = inspectScript(tool.script)
  if (!info.exists || !info.isFile) {
    return shapeManifestOutput({
      ok: false,
      status: 'error',
      tool: tool.name,
      error: `脚本不存在或不是普通文件：${tool.script}（改好脚本后调 toolbox_reload 重载清单）`,
    }, tool.name)
  }
  // 1.6.1 enforce ①：process:false → fail-close。现壳跑脚本必经 spawn，没有别的执行模式，
  // 所以这条声明在本架构下的唯一诚实做法就是"调用即拒绝"，而不是装作能跑。
  if (tool.capabilities?.process === false) {
    return shapeManifestOutput({
      ok: false,
      status: 'error',
      tool: tool.name,
      error: `capabilities.process=false：执行壳只能以 spawn 子进程的方式运行清单脚本，当前架构下该工具不可执行（fail-close 拒绝；确需运行请声明 process:true）`,
    }, tool.name)
  }
  // 1.6.1 enforce ②：paths 声明 → 调用前核条目自带的 cwd / env 绝对路径（越界不起进程）。
  const pathsIssue = checkDeclaredPaths(tool)
  if (pathsIssue) {
    return shapeManifestOutput({
      ok: false,
      status: 'error',
      tool: tool.name,
      error: pathsIssue,
    }, tool.name)
  }
  const callArgs = args && typeof args === 'object' ? args : {}
  const manifestPath = String(cfg?.__manifestPath ?? '')
  const root = String(cfg?.__root ?? '')
  let handle
  try {
    handle = startDetachedTask({
      exec,
      kind: tool.name,
      label: tool.name,
      warn,
      hint: `已开始执行 ${tool.name}，结果会作为消息推回会话`,
      header: `【${tool.name} 失败】`,
      run: async () => {
        const result = await runToolScript({ tool, callArgs, root, manifestPath, cfg })
        return composeReport({ tool, result })
      },
    })
  } catch (error) {
    // startDetachedTask 自己不该抛；真抛了也如实说，不能装成"已启动"。
    return shapeManifestOutput({
      ok: false,
      status: 'error',
      tool: tool.name,
      error: `后台任务启动失败：${error?.message ?? error}`,
    }, tool.name)
  }
  return shapeManifestOutput({
    ok: true,
    status: 'started',
    taskId: handle.taskId,
    tool: tool.name,
    hint: handle.hint,
    error: '',
  }, tool.name)
}

/**
 * 造一个清单管理器：负责"读清单 → 校验 → 注册/反注册"，并收集要报回会话的问题。
 *
 * @param {object} options
 * @param {(name: string, def: object, impl: Function, source?: string) => any} options.addTool
 * @param {(name: string) => boolean} options.removeTool
 * @param {(name: string) => any} [options.registerOwnTool] 登记到 restrict 白名单（超集）
 * @param {object} [options.cfg] 插件配置
 * @param {(msg: string) => void} [options.warn]
 * @param {object} [options.env]
 */
export function createManifestManager({ addTool, removeTool, registerOwnTool, cfg = {}, warn, env = process.env } = {}) {
  /** name → { entry }（只记清单注册出来的，重载时按它反注册）。 */
  const registered = new Map()
  /** 待报回会话的问题（pre-step 注入后清空）。 */
  let pending = []
  /** 上一次加载的报告（toolbox_list 用）。 */
  let lastReport = null

  const pushIssue = (text) => {
    const line = String(text ?? '').trim()
    if (!line) return
    pending.push(line)
    try {
      warn?.(`aiyayi-toolkit: 工具清单：${line}`)
    } catch {
      /* logger 缺了就算了 */
    }
  }

  const unregisterAll = () => {
    const removed = []
    for (const name of [...registered.keys()]) {
      try {
        if (removeTool?.(name)) removed.push(name)
      } catch (error) {
        pushIssue(`反注册 ${name} 失败：${error?.message ?? error}`)
      }
      registered.delete(name)
    }
    return removed
  }

  /**
   * 读清单 → 注册 enabled 的条目。返回报告：
   * `{ ok, exists, path, root, registered: string[], skipped: string[], problems: string[], fatal }`
   */
  const load = () => {
    const manifest = loadManifest({ env, path: cfg?.manifestPath ?? null })
    const report = {
      ok: manifest.ok === true && !manifest.fatal,
      exists: manifest.exists === true,
      path: String(manifest.path ?? ''),
      root: String(manifest.root ?? ''),
      registered: [],
      skipped: [],
      problems: [],
      fatal: String(manifest.fatal ?? ''),
    }
    // 清单文件不存在 = 正常情况（用户没配），只记日志。
    if (!manifest.exists) {
      if (manifest.fatal) pushIssue(manifest.fatal)
      lastReport = report
      return report
    }
    if (manifest.fatal) {
      // JSON 语法错误 / 顶层结构错：**必须报回会话**，不能静默。
      pushIssue(manifest.fatal)
      report.problems.push(manifest.fatal)
      lastReport = report
      return report
    }
    for (const warning of manifest.warnings ?? []) pushIssue(warning)
    for (const problem of manifest.problems ?? []) {
      pushIssue(`跳过 ${problem.name}：${problem.reason}`)
      report.problems.push(`${problem.name}：${problem.reason}`)
    }
    for (const entry of manifest.entries ?? []) {
      if (entry.problems.length > 0) {
        report.skipped.push(entry.name || `tools[${entry.index}]`)
        continue
      }
      if (!entry.enabled) {
        report.skipped.push(`${entry.name}（enabled:false）`)
        continue
      }
      try {
        const def = buildToolDef(entry)
        // 记忆根与清单路径透传给脚本（脚本自己决定用不用；mem_sync 用它定位记忆仓库）。
        const runCfg = { ...cfg, __root: String(manifest.root ?? ''), __manifestPath: String(manifest.path ?? '') }
        addTool(entry.name, def, (args, exec) => executeManifestTool(entry, args, { exec, cfg: runCfg, warn }), 'manifest')
        registered.set(entry.name, { entry })
        try {
          registerOwnTool?.(entry.name)
        } catch {
          /* 白名单登记失败只影响 restrict，不影响工具本身 */
        }
        report.registered.push(entry.name)
      } catch (error) {
        const reason = `注册 ${entry.name} 失败：${error?.message ?? error}`
        pushIssue(reason)
        report.problems.push(reason)
      }
    }
    lastReport = report
    return report
  }

  /** 重读清单：先注销全部旧清单工具，再重新注册。 */
  const reload = () => {
    const removed = unregisterAll()
    const report = load()
    return { ...report, removed }
  }

  /**
   * 1.6.1：从清单文件里移除一条条目并立即触发 reload（toolbox_remove 的实现，行为对齐 reload）。
   * 流程：定位清单文件 → 解析校验 → 找 name 匹配的条目 → 原子改写文件 → reload。
   * 任何一步失败都**不改文件、不 reload**（半死状态比拒绝更糟）；只删清单条目，不删脚本文件。
   * @param {string} rawName 要移除的条目 name（工具名）
   * @returns {{ok, exists, path, entry, removed, registered, skipped, problems, hint, error}}
   */
  const removeEntry = (rawName) => {
    const target = String(rawName ?? '').trim()
    const base = { entry: target, removed: [], registered: [], skipped: [], problems: [], hint: '', error: '' }
    if (!target) {
      return { ...base, ok: false, exists: false, path: '', error: '缺 name 参数：要移除哪个清单条目？（先 toolbox_list 看现有条目）' }
    }
    const manifest = loadManifest({ env, path: cfg?.manifestPath ?? null })
    if (!manifest.exists) {
      return {
        ...base, ok: false, exists: false, path: String(manifest.path ?? ''),
        error: `清单不存在：${manifest.path || '（记忆根未解析）'}（没有可移除的条目）`,
      }
    }
    const path = String(manifest.path ?? '')
    if (manifest.fatal) {
      return { ...base, ok: false, exists: true, path, error: manifest.fatal, problems: [manifest.fatal] }
    }
    // loadManifest 已验过一轮，这里再读原文自己 parse：改文件要拿着**原始对象**改（保住其它顶层键）。
    let parsed
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    } catch (error) {
      const reason = `清单读取/解析失败（未改文件）：${error?.message ?? error}`
      return { ...base, ok: false, exists: true, path, error: reason, problems: [reason] }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.tools)) {
      const reason = '清单顶层结构不合法（需要 {"version":1,"tools":[…]}），未改文件；用 toolbox_list 看详情'
      return { ...base, ok: false, exists: true, path, error: reason, problems: [reason] }
    }
    const names = parsed.tools.map((item) => String(item?.name ?? '').trim()).filter(Boolean)
    const index = parsed.tools.findIndex(
      (item) => item && typeof item === 'object' && !Array.isArray(item) && String(item?.name ?? '').trim() === target,
    )
    if (index < 0) {
      const reason = `清单里没有名为 ${JSON.stringify(target)} 的条目${names.length > 0 ? `（现有：${names.join('、')}）` : '（tools 为空）'}`
      return { ...base, ok: false, exists: true, path, error: reason, problems: [reason] }
    }
    parsed.tools.splice(index, 1)
    // 原子写（同 toolkit_write 的做法：临时文件 + 同目录 rename），写坏清单的代价太高。
    const tmp = join(dirname(path), `${MANIFEST_NAME}.tmp-${process.pid}-${Date.now()}`)
    try {
      writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
      renameSync(tmp, path)
    } catch (error) {
      try {
        rmSync(tmp, { force: true })
      } catch {
        /* tmp 清不掉就算了，错误照报 */
      }
      const reason = `清单写回失败（未生效）：${error?.message ?? error}`
      return { ...base, ok: false, exists: true, path, error: reason, problems: [reason] }
    }
    // 文件已改，重载生效（与 toolbox_reload 同一条路径：注销旧 → 按当前文件重新注册）。
    const report = reload()
    return {
      ok: !report.fatal && report.problems.length === 0,
      exists: true,
      path: String(report.path ?? path),
      entry: target,
      removed: report.removed,
      registered: report.registered,
      skipped: report.skipped,
      problems: report.problems,
      hint: `已从清单移除 ${target}（剩 ${parsed.tools.length} 条），并已重载：注册 ${report.registered.length} 个、注销 ${report.removed.length} 个${report.problems.length > 0 ? `，${report.problems.length} 条有问题` : ''}`,
      error: String(report.fatal ?? ''),
    }
  }

  /** 巡检：清单里每条工具的状态（不注册、不改状态；toolbox_list 用）。 */
  const inspect = () => {
    const manifest = loadManifest({ env, path: cfg?.manifestPath ?? null })
    const rows = (manifest.entries ?? []).map((entry) => ({
      name: entry.name || `tools[${entry.index}]`,
      enabled: entry.enabled === true,
      mode: entry.mode,
      script: entry.script,
      scriptExists: entry.scriptExists === true,
      registered: registered.has(entry.name),
      timeoutMs: entry.timeoutMs,
      // 1.6.1：capabilities 标位——false = 未声明（沿用全量能力），让未声明的工具显形。
      capabilities: entry.capabilitiesDeclared === true,
      reason: entry.problems.join('；'),
    }))
    return {
      ok: manifest.ok === true && !manifest.fatal,
      exists: manifest.exists === true,
      path: String(manifest.path ?? ''),
      root: String(manifest.root ?? ''),
      fatal: String(manifest.fatal ?? ''),
      tools: rows,
      problems: (manifest.problems ?? []).map((item) => `${item.name}：${item.reason}`),
    }
  }

  return {
    load,
    reload,
    removeEntry,
    inspect,
    unregisterAll,
    registeredNames: () => [...registered.keys()],
    /** 取走待报回会话的问题（pre-step 注入用；取过就清空，不重复刷屏）。 */
    takePendingIssues: () => {
      const items = pending
      pending = []
      return items
    },
    pendingCount: () => pending.length,
    lastReport: () => lastReport,
  }
}

/* ------------------------------------------------------------------ *
 * 四、管理工具（同步，只读清单/内存 + toolbox_remove 改清单文件，都很快）
 * ------------------------------------------------------------------ */

/** toolbox_list 输出归一（与 TOOLBOX_LIST_SCHEMA.output.schema 一一对应）。 */
export function shapeToolboxList(result = {}) {
  const tools = Array.isArray(result.tools) ? result.tools : []
  return {
    ok: result.ok === true,
    exists: result.exists === true,
    path: String(result.path ?? ''),
    root: String(result.root ?? ''),
    error: String(result.error ?? ''),
    tools: tools.map((row) => ({
      name: String(row?.name ?? ''),
      enabled: row?.enabled === true,
      mode: String(row?.mode ?? ''),
      script: String(row?.script ?? ''),
      scriptExists: row?.scriptExists === true,
      registered: row?.registered === true,
      timeoutMs: Number.isInteger(row?.timeoutMs) ? row.timeoutMs : 0,
      capabilities: row?.capabilities === true,
      reason: String(row?.reason ?? ''),
    })),
    problems: (Array.isArray(result.problems) ? result.problems : []).map((item) => String(item ?? '')),
  }
}

export const TOOLBOX_LIST_SCHEMA = {
  name: 'toolbox_list',
  description:
    '列出本机工具清单（<记忆根>/toolbox.json）里的每个工具：name / enabled / mode / script / 脚本是否存在 / 是否已注册 / timeoutMs / 不注册的原因。'
    + '同步只读，几毫秒返回。清单本身不存在时 exists:false（正常，说明这台机器没配额外工具）；清单 JSON 写坏时 error 里有行列位置。'
    + '改了清单文件后用 toolbox_reload 让它生效（本工具只做巡检，不改状态）。',
  parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', description: '清单本身是否能读能解析（条目个别有问题时仍为 true，明细看 problems）。' },
        exists: { type: 'boolean', description: '清单文件是否存在。' },
        path: { type: 'string', description: '清单绝对路径；记忆根未解析时为空字符串。' },
        root: { type: 'string', description: '当前记忆根（清单所在目录）。' },
        error: { type: 'string', description: '清单级错误（JSON 语法错误 / 顶层结构错）原文；正常时为空字符串。' },
        tools: {
          type: 'array',
          description: '清单里的每条工具（含 enabled:false 的）。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              enabled: { type: 'boolean' },
              mode: { type: 'string', description: '恒为 async（清单只支持异步）。' },
              script: { type: 'string', description: '展开后的脚本绝对路径。' },
              scriptExists: { type: 'boolean', description: '脚本此刻是否存在于磁盘。' },
              registered: { type: 'boolean', description: '是否已在本进程注册成工具。' },
              timeoutMs: { type: 'integer', description: '任务级超时（ms）。' },
              capabilities: { type: 'boolean', description: '是否声明了 capabilities（false=未声明，沿用全量能力；1.6.1 起让未声明的工具显形）。' },
              reason: { type: 'string', description: '这条不注册的原因（校验失败时非空）。' },
            },
            required: ['name', 'enabled', 'mode', 'script', 'scriptExists', 'registered', 'timeoutMs', 'capabilities', 'reason'],
          },
        },
        problems: { type: 'array', description: '清单级问题清单（name：原因）。', items: { type: 'string' } },
      },
      required: ['ok', 'exists', 'path', 'root', 'error', 'tools', 'problems'],
    },
    render: (_args, value) => {
      const lines = [`清单：${value.path || '（记忆根未解析）'}${value.exists ? '' : '（不存在，未配置额外工具）'}`]
      if (value.error) lines.push(`✗ ${value.error}`)
      for (const row of value.tools) {
        const mark = row.registered ? '✓ 已注册' : row.enabled ? '· 未注册' : '· 关闭'
        const capsMark = row.capabilities ? '' : '（未声明 capabilities=全量能力）'
        lines.push(`  ${mark}  ${row.name}  [${row.mode}]  脚本${row.scriptExists ? '存在' : '缺失'}：${row.script}${capsMark}`)
        if (row.reason) lines.push(`      原因：${row.reason}`)
      }
      if (value.problems.length > 0) lines.push(...value.problems.map((item) => `  ! ${item}`))
      return TEXT_BLOCK(lines.join('\n'))
    },
  },
}

/** toolbox_reload 输出归一（与 TOOLBOX_RELOAD_SCHEMA.output.schema 一一对应）。 */
export function shapeToolboxReload(result = {}) {
  const strList = (value) => (Array.isArray(value) ? value : []).map((item) => String(item ?? ''))
  return {
    ok: result.ok === true,
    exists: result.exists === true,
    path: String(result.path ?? ''),
    removed: strList(result.removed),
    registered: strList(result.registered),
    skipped: strList(result.skipped),
    problems: strList(result.problems),
    hint: String(result.hint ?? ''),
    error: String(result.error ?? ''),
  }
}

export const TOOLBOX_RELOAD_SCHEMA = {
  name: 'toolbox_reload',
  description:
    '重读本机工具清单（<记忆根>/toolbox.json）：注销全部旧的清单工具、按当前文件重新注册 enabled:true 的条目。'
    + '同步，几毫秒返回（只读文件 + 改工具目录，不跑任何脚本）。改了清单或脚本后调它生效；'
    + '返回 removed / registered / skipped 明细，校验失败与脚本缺失会明确列在 problems 里（不会静默跳过）。',
  parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', description: '清单是否成功加载（条目级失败时为 false 但其余条目照常注册，看 problems）。' },
        exists: { type: 'boolean', description: '清单文件是否存在。' },
        path: { type: 'string', description: '清单绝对路径。' },
        removed: { type: 'array', description: '本次被反注册的旧清单工具名。', items: { type: 'string' } },
        registered: { type: 'array', description: '本次新注册成功的工具名。', items: { type: 'string' } },
        skipped: { type: 'array', description: '未注册的条目（enabled:false 或校验失败）。', items: { type: 'string' } },
        problems: { type: 'array', description: '校验失败/注册失败明细（工具名：原因）。', items: { type: 'string' } },
        hint: { type: 'string', description: '一句话结论。' },
        error: { type: 'string', description: '清单级错误（JSON 语法错误等）；正常时为空字符串。' },
      },
      required: ['ok', 'exists', 'path', 'removed', 'registered', 'skipped', 'problems', 'hint', 'error'],
    },
    render: (_args, value) => {
      const lines = [value.hint || `清单：${value.path}`]
      if (value.removed.length > 0) lines.push(`  注销：${value.removed.join('、')}`)
      if (value.registered.length > 0) lines.push(`  注册：${value.registered.join('、')}`)
      if (value.skipped.length > 0) lines.push(`  跳过：${value.skipped.join('、')}`)
      if (value.problems.length > 0) lines.push(...value.problems.map((item) => `  ! ${item}`))
      return TEXT_BLOCK(lines.join('\n'))
    },
  },
}

/** toolbox_remove 输出归一（与 TOOLBOX_REMOVE_SCHEMA.output.schema 一一对应）。 */
export function shapeToolboxRemove(result = {}) {
  const strList = (value) => (Array.isArray(value) ? value : []).map((item) => String(item ?? ''))
  return {
    ok: result.ok === true,
    exists: result.exists === true,
    path: String(result.path ?? ''),
    entry: String(result.entry ?? ''),
    removed: strList(result.removed),
    registered: strList(result.registered),
    skipped: strList(result.skipped),
    problems: strList(result.problems),
    hint: String(result.hint ?? ''),
    error: String(result.error ?? ''),
  }
}

export const TOOLBOX_REMOVE_SCHEMA = {
  name: 'toolbox_remove',
  description:
    '从本机工具清单（<记忆根>/toolbox.json）里移除指定 name 的条目，并立即重载生效（改文件后走与 toolbox_reload 相同的重载：注销旧清单工具、按当前文件重新注册 enabled:true 的条目）。'
    + '同步，几毫秒返回（不跑任何脚本）。清单不存在 / JSON 坏掉 / 条目名对不上时**一律不改文件**并明确报错；'
    + '成功返回 entry（被移除的名字）与 removed / registered / skipped / problems 明细。'
    + '注意：只删清单条目，不删脚本文件本身；只想临时停用可改 enabled:false 再 toolbox_reload。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: '要移除的清单条目 name（工具名，形如 mem_sync；不确定就先 toolbox_list）。' },
    },
    required: ['name'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', description: '移除并重载是否全部成功（条目级失败时为 false，明细看 problems；失败时文件未被改动）。' },
        exists: { type: 'boolean', description: '清单文件是否存在。' },
        path: { type: 'string', description: '清单绝对路径；记忆根未解析时为空字符串。' },
        entry: { type: 'string', description: '本次要移除的条目名（原样带回参数；失败时也带回以便排查）。' },
        removed: { type: 'array', description: '重载时被反注册的旧清单工具名。', items: { type: 'string' } },
        registered: { type: 'array', description: '重载后注册成功的工具名。', items: { type: 'string' } },
        skipped: { type: 'array', description: '重载时未注册的条目（enabled:false 或校验失败）。', items: { type: 'string' } },
        problems: { type: 'array', description: '移除失败/校验失败明细。', items: { type: 'string' } },
        hint: { type: 'string', description: '一句话结论。' },
        error: { type: 'string', description: '失败原因（清单不存在 / JSON 坏 / 名字对不上 / 写回失败）；成功时为空字符串。' },
      },
      required: ['ok', 'exists', 'path', 'entry', 'removed', 'registered', 'skipped', 'problems', 'hint', 'error'],
    },
    render: (_args, value) => {
      if (!value.ok) return TEXT_BLOCK(`toolbox_remove 未移除 ${value.entry || '（缺 name）'}：${value.error}`)
      const lines = [value.hint || `已从清单移除 ${value.entry}：${value.path}`]
      if (value.removed.length > 0) lines.push(`  注销：${value.removed.join('、')}`)
      if (value.registered.length > 0) lines.push(`  注册：${value.registered.join('、')}`)
      if (value.skipped.length > 0) lines.push(`  跳过：${value.skipped.join('、')}`)
      if (value.problems.length > 0) lines.push(...value.problems.map((item) => `  ! ${item}`))
      return TEXT_BLOCK(lines.join('\n'))
    },
  },
}

/* 测试出口：只给单测用。 */
export const __testing = {
  tailText,
  headText,
  describeJsonError,
}
