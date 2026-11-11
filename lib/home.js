/**
 * aiyayi-home — 阿依娅伊的记忆根目录「唯一出口」（1.5.0 新增）。
 *
 * 为什么要有这个文件：记忆路径原来散在三个模块里硬拼（index.js 的
 * ROOT/CORE_FILE/TREE_DIR、presence.js 的 DIR/三文件、updates.js 的 DIR），
 * 而且 updates.js 压根不认 AIYAYI_HOME。结果就是「搬了核心记忆，更新去重
 * 记录还留在老地方」，两处状态开始分叉。现在所有记忆路径都从这里出。
 *
 * 解析优先级（高 → 低）：
 *   1. 运行时切换 setRoot()（P2 热切换用，进程内有效）
 *   2. 指路文件 ~/.dsh/aiyayi/location.json（持久、跨进程、跨终端）
 *   3. 环境变量 AIYAYI_HOME（向后兼容：测试与临时重定向还要用）
 *   4. 默认 homedir()/.dsh/aiyayi
 *
 * 迁移顺序（relocateTo，任何一步失败即中止、源目录不动）：
 *   preflight → copy（只复制不移动）→ verify（路径集合 + 字节 + SHA256）
 *   → writePointer（校验通过后才写）→ 源目录内容搬到同级 aiyayi.old（改名，不删除）
 *
 * 硬失败原则：指路文件 / 环境变量指向的根不可达时，**抛错**，不建目录、
 * 不写空模板、不静默回退默认路径——静默回退会让「G 盘回来时两份记忆分叉」。
 *
 * 红线（见《dsh-aiyayi 记忆路径改造方案》§8）：
 *   - 本文件是 lib/ 内**唯一**拼记忆路径的地方；homedir() 只出现一次（HOME 常量）。
 *   - 不碰 presence.js 的闹钟存储（认 DSH_HOME / DSH_SCHEDULE_STORE，属宿主存储）。
 *   - 不用 move 语义；不删源目录；不把目标允许设进插件包目录。
 *   - 写 location.json 只走 writePointerFile()，且只被 relocateTo() 调用。
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  accessSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 家目录：本文件里唯一一次 homedir() 调用（红线：lib/ 内记忆路径只此一处）。 */
const HOME = homedir()

/** 老位置（默认记忆根）。搬家后这个目录里只留 location.json。 */
const DEFAULT_ROOT = join(HOME, '.dsh', 'aiyayi')

/** 指路文件：永远固定在老位置，与当前 root 无关。 */
const POINTER_PATH = join(DEFAULT_ROOT, 'location.json')

/**
 * 测试唯一入口：把指路文件换到沙盘里（生产永远是 POINTER_PATH）。
 *
 * 为什么必须能换：`relocateTo` 只会写「固定位置」的指路文件，如果测试真去写
 * 真机上的 `~/.dsh/aiyayi/location.json`，就会把**正在运行的那个阿依娅伊**的
 * 记忆根临时改到测试沙盘里——这不是测试，这是破坏生产数据（2026-11-08 实测
 * 踩过一次：临时指针把运行中的她指到了临时目录）。所以给测试一个进程内开关，
 * 生产路径一行不改。`null` = 用真位置。
 */
let pointerPathOverride = null

function pointerPath() {
  return pointerPathOverride ?? POINTER_PATH
}

/** 插件包根（preflight 用来拒绝「把记忆搬进插件目录」）。 */
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const POINTER_VERSION = 1

/**
 * 代码版本：写死在源码里，**不是**读 package.json。
 *
 * 为什么要有一份独立版本号（2026-11-08 事故教训）：那次她看到 package.json 里
 * 还是 1.5.0，就推断"创造模式改的东西没生效"——而 1.5.0 本来就是正确的目标版本。
 * 光靠版本号猜"代码有没有加载"不可靠；真正可靠的是**调用一个只存在于新版里的
 * 函数**（codeSelfCheck），能调通就说明新代码在跑。两份信息一正一反，
 * 才不会被单一线索带偏。
 */
const CODE_VERSION = '1.5.4'

const MAX_TREE_DEPTH = 3
const CANDIDATE_TTL_MS = 5 * 60 * 1000
const MIN_CANDIDATE_FREE_GB = 1
const FREE_SPACE_MULTIPLIER = 3

/** 运行时切换根（P2 热切换用，进程内有效；不落盘）。 */
let overrideRoot = null

/** 指路文件的轻量缓存：key 用 mtime+size，文件没变就不重复解析。 */
let pointerCache = { key: null, value: null }

/** 候选路径枚举缓存：memory_location 每轮都可能被调，别每轮扫盘。 */
let candidateCache = { at: 0, value: null }

/* ------------------------------------------------------------------ *
 * 路径解析
 * ------------------------------------------------------------------ */

function reachableDir(path) {
  if (typeof path !== 'string' || path.length === 0) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * 读指路文件（带 mtime+size 轻缓存）。
 * @returns {{ exists: boolean, data: object|null, error: string|null, root: string }}
 */
function readPointer() {
  const file = pointerPath()
  let key = 'missing'
  try {
    const st = statSync(file)
    key = `${st.mtimeMs}:${st.size}`
  } catch {
    key = 'missing'
  }
  if (pointerCache.key === key && pointerCache.value !== null) return pointerCache.value

  let value
  if (key === 'missing') {
    value = { exists: false, data: null, error: null, root: '' }
  } else {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('内容不是 JSON 对象')
      }
      if (typeof parsed.root !== 'string' || parsed.root.length === 0) {
        throw new Error('缺 root 字段')
      }
      if (!isAbsolute(parsed.root)) {
        throw new Error(`root 不是绝对路径：${parsed.root}`)
      }
      value = { exists: true, data: parsed, error: null, root: parsed.root }
    } catch (error) {
      value = { exists: true, data: null, error: String(error?.message ?? error), root: '' }
    }
  }
  pointerCache = { key, value }
  return value
}

/**
 * 解析当前记忆根。**每次调用都重新判断**（不做模块级常量缓存），这是热切换的前提；
 * 只有指路文件的解析结果按 mtime+size 轻量缓存。
 * @returns {{root: string, source: 'runtime'|'pointer'|'env'|'default', reachable: boolean,
 *            pointerPath: string, pointer: object|null, pointerError: string|null}}
 */
export function resolveRoot() {
  const pointer = readPointer()

  if (overrideRoot !== null) {
    return {
      root: overrideRoot,
      source: 'runtime',
      reachable: reachableDir(overrideRoot),
      pointerPath: pointerPath(),
      pointer: pointer.data,
      pointerError: pointer.error,
    }
  }

  if (pointer.exists) {
    // 指针坏了也不回退默认路径（那正是「两份记忆分叉」的起点），交给硬失败。
    if (pointer.error !== null) {
      return {
        root: pointer.root,
        source: 'pointer',
        reachable: false,
        pointerPath: pointerPath(),
        pointer: null,
        pointerError: pointer.error,
      }
    }
    return {
      root: pointer.data.root,
      source: 'pointer',
      reachable: reachableDir(pointer.data.root),
      pointerPath: pointerPath(),
      pointer: pointer.data,
      pointerError: null,
    }
  }

  // 向后兼容：AIYAYI_HOME 原样照旧（空串 falsy = 没设；空白串 truthy = 真的建带空格的目录，
  // 这是历史行为，preflight 在迁移路径上会拒绝空白，但老环境变量语义不擅自改）。
  const env = process.env.AIYAYI_HOME
  if (env) {
    return {
      root: env,
      source: 'env',
      reachable: reachableDir(env),
      pointerPath: pointerPath(),
      pointer: null,
      pointerError: null,
    }
  }

  return {
    root: DEFAULT_ROOT,
    source: 'default',
    reachable: reachableDir(DEFAULT_ROOT),
    pointerPath: pointerPath(),
    pointer: null,
    pointerError: null,
  }
}

/**
 * 来源的中文说明，硬失败文案要用。
 * 注意：这是"路径从哪来"，**不是**"迁移状态"。后者看 memoryStatus()。
 */
export function sourceLabel(source) {
  if (source === 'pointer') return '来自 location.json 指路文件'
  if (source === 'env') return '来自环境变量 AIYAYI_HOME'
  if (source === 'runtime') return '来自运行时切换 setRoot()'
  return '内置默认路径（未搬家，正常状态）'
}

/**
 * 迁移状态 —— 与"来源"是两个维度，必须分开看（2026-11-08 事故的直接教训）。
 *
 * 事故：`source: default` 被读成"改造没生效"。其实"来源：默认路径"只说明
 * **还没搬过家**，是完全正常的状态；指路文件 `location.json` 也只在搬家/决定
 * 留原处之后才存在。把两件事挤在一行，任何人看到"默认路径"都会以为出事。
 *
 * 取值：
 * - `ok`          记忆在默认路径、可读，还没做过搬迁决定（正常待办状态）
 * - `migrated`    已按 location.json 指路文件搬到别处（同样正常）
 * - `stayed`      用户/她明确决定"就留在原处"（同样正常，只是不再提示）
 * - `unreachable` 解析出的根不存在/不是目录/指路文件坏了 —— **这才算故障**
 * - `core-missing` 根在，但 memory.md 不在（可能是首次使用，也可能是数据丢了）
 *
 * @returns {'ok'|'migrated'|'stayed'|'unreachable'|'core-missing'}
 */
export function memoryStatus(resolved = resolveRoot()) {
  if (!resolved.reachable) return 'unreachable'
  const pointer = resolved.pointer
  if (pointer !== null) return pointer.stayOnSystemDrive === true ? 'stayed' : 'migrated'
  // 根可达但核心记忆文件不在：首次使用与数据丢失在磁盘上长得一样，单独标出来。
  const core = join(resolved.root, 'memory.md')
  if (!existsSync(core)) return 'core-missing'
  return 'ok'
}

/** 状态的中文一句话（供工具与注入行复用）。 */
export function statusLabel(status) {
  if (status === 'migrated') return '已搬家'
  if (status === 'stayed') return '已决定留在原处'
  if (status === 'unreachable') return '⚠ 不可达（故障）'
  if (status === 'core-missing') return '⚠ 核心记忆文件不在'
  return '未搬家 · 正常'
}

/**
 * 正向自检：不依赖"能扫出几个候选"去反推代码活没活。
 *
 * 2026-11-08 事故里，她只能用"memory_location 能列出 6 个候选"来推测新代码
 * 有没有加载，太间接、也太容易推错（她推成了"没生效"）。这里直接自报家门：
 * 工具是否可用、代码里的版本号、目录布局版本、以及这份代码认为自己是新版还是旧版。
 *
 * @returns {{relocateSupported:boolean, codeVersion:string, layoutVersion:number,
 *           selfReport:string}}
 */
export function codeSelfCheck() {
  return {
    // 这个函数本身只存在于 1.5.0+，能被调到就说明迁移能力在这份代码里。
    relocateSupported: true,
    codeVersion: CODE_VERSION,
    layoutVersion: POINTER_VERSION,
    selfReport: `这段代码支持记忆搬家（relocateSupported: true）｜代码版本 ${CODE_VERSION}｜指路文件布局 v${POINTER_VERSION}`,
  }
}

/** 不可达时的统一报错文案。 */
export function unreachableMessage(resolved) {
  const root = resolved?.root ? resolved.root : '（空路径）'
  const extra = resolved?.pointerError ? `；指路文件解析失败：${resolved.pointerError}` : ''
  return `记忆目录不可达：${root}（${sourceLabel(resolved?.source)}）${extra}`
}

/**
 * 记忆根必须是「可达的目录」。不可达就抛（硬失败）；不建目录、不写模板。
 * @returns {object} resolveRoot() 的结果（保证 reachable 为真）
 */
export function assertReachable() {
  const resolved = resolveRoot()
  if (resolved.reachable) return resolved
  throw new Error(unreachableMessage(resolved))
}

/**
 * 只在 normalize 时建目录：默认路径首次不存在时允许建（等价于老行为）；
 * 指路文件 / 环境变量指向不可达路径时**不建**，直接抛。
 * @returns {object} resolveRoot() 的结果（reachable 为真）
 */
export function ensureRootDir() {
  const resolved = resolveRoot()
  if (resolved.reachable) return resolved
  if (resolved.source !== 'default') throw new Error(unreachableMessage(resolved))
  try {
    mkdirSync(resolved.root, { recursive: true })
  } catch (error) {
    // 默认路径也建不出来（比如路径上有个文件挡路）→ 硬失败，别假装是空记忆。
    throw new Error(`记忆目录建不出来：${resolved.root}（${error?.code ?? error?.message ?? error}）`)
  }
  if (!reachableDir(resolved.root)) {
    throw new Error(`记忆目录建不出来：${resolved.root}（建完仍不是目录）`)
  }
  return { ...resolved, reachable: true }
}

/** 记忆根下的文件路径；root 解析不到时给空串（调用方必须先过 ensureRootDir/assertReachable）。 */
function inRoot(name) {
  const { root } = resolveRoot()
  return root ? join(root, name) : ''
}

export function coreFile() {
  return inRoot('memory.md')
}
export function treeDir() {
  return inRoot('memories')
}
export function presenceFile() {
  return inRoot('presence.json')
}
export function stateFile() {
  return inRoot('state.md')
}
export function wishesFile() {
  return inRoot('wishes.json')
}
export function updatesFile() {
  return inRoot('updates.json')
}
/** PowerShell 版本体检缓存（1.5.28；与 updates.json 同目录同风格）。 */
export function pwshFile() {
  return inRoot('pwsh.json')
}
/** 指路文件路径：永远是 ~/.dsh/aiyayi/location.json，与当前 root 无关。 */
export function pointerFile() {
  return pointerPath()
}

/** 运行时切换（P2 热切换；不落盘，进程重启后仍由指路文件决定）。 */
export function setRoot(root) {
  overrideRoot = typeof root === 'string' && root.length > 0 ? resolve(root) : null
  return resolveRoot()
}

/* ------------------------------------------------------------------ *
 * 盘符 / 系统盘 / 候选路径
 * ------------------------------------------------------------------ */

/** 路径里的盘符（`C:`，统一大写）；POSIX / UNC 返回 null。 */
export function driveOf(path) {
  const match = /^([A-Za-z]):(?=[\\/]|$)/.exec(String(path ?? '').trim())
  return match ? `${match[1].toUpperCase()}:` : null
}

/** 系统盘（Windows 上来自 SystemDrive；POSIX 返回 null，不参与「系统盘」判断）。 */
export function systemDrive() {
  if (process.platform !== 'win32') return null
  const env = process.env.SystemDrive
  return (typeof env === 'string' && /^[A-Za-z]:$/.test(env.trim()) ? env.trim() : 'C:').toUpperCase()
}

/** 是否在系统盘（POSIX / 非盘符路径一律 false）。 */
export function isSystemDrive(path) {
  const drive = driveOf(path)
  if (drive === null) return false
  return drive === systemDrive()
}

/** 两个绝对路径是否同一处（Windows 大小写不敏感）。 */
function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  if (left.length === 0 || right.length === 0) return false
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** child 是否在 parent 里（按规范化后的路径前缀比，不是字符串包含）。 */
function isInside(child, parent) {
  if (samePath(child, parent)) return true
  const a = resolve(child)
  const b = resolve(parent)
  const [left, right] = process.platform === 'win32' ? [a.toLowerCase(), b.toLowerCase()] : [a, b]
  const prefix = right.endsWith(sep) ? right : `${right}${sep}`
  return left.startsWith(prefix)
}

/** 网盘同步根（会锁文件、会产生冲突副本）。 */
function cloudSyncRoots() {
  const roots = []
  for (const [key, label] of [
    ['OneDrive', 'OneDrive 同步目录'],
    ['OneDriveCommercial', 'OneDrive 商业同步目录'],
    ['OneDriveConsumer', 'OneDrive 个人同步目录'],
  ]) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      roots.push({ root: resolve(value.trim()), label })
    }
  }
  return roots
}

/** 盘根可读 + 有空间才算「能用的固定盘」；光驱、空读卡器、断开的网络盘都会在这里被筛掉。 */
function probeDrive(letter) {
  const root = `${letter}\\`
  if (!existsSync(root)) return null
  let stats
  try {
    stats = statfsSync(root)
  } catch {
    return null
  }
  let names = []
  try {
    names = readdirSync(root)
  } catch {
    return null
  }
  if (names.length === 0) return null
  const bsize = Number(stats?.bsize) || 0
  const bavail = Number(stats?.bavail ?? stats?.bfree) || 0
  const freeBytes = bsize * bavail
  if (freeBytes <= 0) return null
  return { drive: letter, root, freeBytes }
}

function freeBytesOf(path) {
  let cursor = resolve(path)
  while (true) {
    try {
      if (existsSync(cursor)) break
    } catch {
      /* 继续往上找 */
    }
    const parent = dirname(cursor)
    if (parent === cursor) return null
    cursor = parent
  }
  try {
    const stats = statfsSync(cursor)
    const bsize = Number(stats?.bsize) || 0
    const bavail = Number(stats?.bavail ?? stats?.bfree) || 0
    return bsize * bavail > 0 ? bsize * bavail : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 外置盘探测（1.5.2）：只用于"迁移预检时给个提醒"，绝不进路径解析热路径。
 *
 * 为什么需要它：2026-11-08 娅伊推荐搬到 I:，而 I: 挂在**外置 USB 移动硬盘**上
 * （与 D:/J: 同一块可拔出的盘）。她看不到这一层——那个判断只用 Node 内建的
 * 盘符/剩余空间/云目录信息，拿不到总线类型。搬到外置盘的真实后果：每次开机
 * 只要没插上那块盘，记忆根就 `unreachable`，她的记忆读写全部硬失败。
 * 所以这里补一条"能看见就提醒"的探测。
 *
 * 三条硬约束（这条很容易把别人的机器弄坏，所以写清楚）：
 * 1. **只在 preflight 里调**，不进 resolveRoot / memory_location 之类的高频路径。
 *    Windows 上跑一次 PowerShell + Get-Partition/Get-Disk 实测 3.5 秒，
 *    放进每轮注入里等于每轮卡 3.5 秒。
 * 2. **全程静默失败**：没有 PowerShell、没有 Storage 模块、非 Windows、
 *    超时、输出格式变了 —— 一律当作"不知道"，返回 null，绝不抛错、
 *    绝不影响迁移主流程。别人机器上这段代码必须是"有它没它都能搬"。
 * 3. **结果缓存**（进程内、按盘符）：一次搬家最多问一次。
 *
 * 判断只依赖 `BusType` 一个字段：USB / SD / MMC 视为可拔出。
 */
const EXTERNAL_BUS_TYPES = new Set(['USB', 'SD', 'MMC'])
const BUS_PROBE_TIMEOUT_MS = 4000
/** drive: -> {external,busType,model} | null（null = 探测不可用） */
let busTypeCache = null
/** 是否已经探过一次（与"探到空"区分开：前者别重探，后者也别重探）。 */
let busTypeProbed = false

/** Windows 专用 PowerShell 脚本（只读、只查盘，不碰文件）。 */
const BUS_PROBE_SCRIPT = [
  "Get-Partition | Where-Object { $_.DriveLetter -and $_.DriveLetter -match '[A-Za-z]' } | ForEach-Object {",
  '  $letter = $_.DriveLetter',
  '  try {',
  '    $disk = Get-Disk -Number $_.DiskNumber -ErrorAction Stop',
  '    Write-Output ("{0}|{1}|{2}" -f $letter, $disk.BusType, $disk.FriendlyName)',
  '  } catch {',
  '    Write-Output ("{0}||" -f $letter)',
  '  }',
  '}',
].join('\n')

/**
 * 探测各盘的总线类型（Windows，尽力而为）。
 *
 * **为什么不在这条路径里同步跑 PowerShell**（1.5.3 关键修正）：
 * `execFileSync` 会**阻塞整个 Node 事件循环**，Windows 上跑一次
 * `Get-Partition`+`Get-Disk` 实测 2.6–3.5 秒。而 `[记忆]` 这行注入每轮都要生成、
 * `memory_location` 也可能被频繁调用——同步探测等于每次卡三秒、Web GUI 整屏假死。
 *
 * 所以策略是：**首次返回 null（= "目前还不知道"），同时后台异步探一次**；
 * 探完写进缓存，下一轮调用就有值。代价是第一轮拿不到总线类型——可接受，
 * 因为"外置盘警告"是建议性信息，晚一轮无危害；卡三秒是功能性故障。
 * @returns {Map<string,{external,busType,model}>|null} null = 还不知道/不可用
 */
function probeDriveBusTypes() {
  if (busTypeProbed) return busTypeCache
  busTypeProbed = true
  if (process.platform !== 'win32') {
    busTypeCache = null
    return null
  }
  startBusProbeInBackground()
  return busTypeCache
}

/** 测试用：冻结/解冻探测结果（防止后台探测在断言中途把缓存改掉）。 */
let busTypeFrozen = false

/** 后台探测是否在跑。 */
let busProbeInflight = null

/** 异步探测：不阻塞事件循环，成功/失败都写缓存且绝不抛。 */
function startBusProbeInBackground() {
  if (busTypeFrozen) return null
  if (busProbeInflight !== null) return busProbeInflight
  busProbeInflight = new Promise((resolveProbe) => {
    const finish = (map) => {
      // 冻结期间不接受后台结果：测试断言中途被 PowerShell 回来改掉缓存，
      // 会让"未知态"用例时对时错（这就是 §13 时红时绿的真因）。
      if (!busTypeFrozen) busTypeCache = map
      busProbeInflight = null
      resolveProbe(map)
    }
    let child
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', BUS_PROBE_SCRIPT],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      )
    } catch {
      finish(null)
      return
    }
    const chunks = []
    let done = false
    const settle = (map) => {
      if (done) return
      done = true
      clearTimeout(timer)
      finish(map)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 已退出就算了 */
      }
      settle(null)
    }, BUS_PROBE_TIMEOUT_MS)
    if (typeof timer.unref === 'function') timer.unref()
    if (child.stdout) child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.on('error', () => settle(null))
    child.on('close', () => {
      try {
        settle(parseBusOutput(Buffer.concat(chunks).toString('utf8')))
      } catch {
        settle(null)
      }
    })
  })
  return busProbeInflight
}

/** 解析 `A|USB|Model` 行。任何坏行都跳过，绝不抛。 */
function parseBusOutput(output) {
  const map = new Map()
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const parts = line.trim().split('|')
    if (parts.length < 2) continue
    const letter = parts[0].trim().toUpperCase()
    if (!/^[A-Z]$/.test(letter)) continue
    const busType = parts[1].trim().toUpperCase()
    const model = (parts[2] ?? '').trim()
    map.set(`${letter}:`, { external: EXTERNAL_BUS_TYPES.has(busType), busType, model })
  }
  return map.size > 0 ? map : null
}

/**
 * 这个路径是否落在可拔出的外置盘上（**非阻塞**：还探着就返回 null）。
 * @returns {{external:boolean, busType:string, model:string}|null} null = 还不知道
 */
export function externalDriveInfo(path) {
  const drive = driveOf(path)
  if (drive === null) return null
  const map = probeDriveBusTypes()
  if (map === null) return null
  return map.get(drive) ?? null
}

/**
 * 等探测完成（**只给 preflight / dryRun 用**：那是用户主动发起、本来就要等的一次性操作）。
 * 普通读取路径绝对不要调它。
 * @param {number} waitMs - 最多等多久（默认 4.5 秒，覆盖 PowerShell 启动开销）
 */
export async function externalDriveInfoAwait(path, waitMs = BUS_PROBE_TIMEOUT_MS + 500) {
  const drive = driveOf(path)
  if (drive === null) return null
  if (!busTypeProbed) {
    busTypeProbed = true
    if (process.platform === 'win32') startBusProbeInBackground()
  }
  if (busProbeInflight !== null) {
    const pending = busProbeInflight
    const timeout = new Promise((resolveTimeout) => {
      const timer = setTimeout(resolveTimeout, waitMs)
      if (typeof timer.unref === 'function') timer.unref()
    })
    await Promise.race([pending, timeout])
  }
  const map = busTypeCache
  if (map === null) return null
  return map.get(drive) ?? null
}


/**
 * 预热探测（1.5.3）：插件 apply() 时调一次，后台跑。
 *
 * 目的：让"首次渲染注入行/首次列候选"时缓存已经热了。
 * 用户重启后到真正开口常有几十秒，足够 PowerShell 跑完 2.6 秒。
 * 为什么不在这儿等：apply() 跑在内核启动期，阻塞会拖慢整个 DSH 启动。
 * @returns {Promise<Map|null>|null} 后台 promise（调用方可以不等）
 */
export function prewarmDriveBusTypes() {
  if (busTypeProbed) return null
  busTypeProbed = true
  if (process.platform !== 'win32') {
    busTypeCache = null
    return null
  }
  return startBusProbeInBackground()
}

/**
 * 列出候选路径。
 * @param {{waitForBus?:number}} opts
 *   `waitForBus` 给了毫秒数就同步等探测这么久（**只给 memory_location 这类
 *   用户主动发起的调用用**）。那个调用最多多等两三秒，换来一个准确的
 *   "内置/外置"标注；而每轮注入路径**绝不能**等。
 */
export function listCandidatePaths(opts = {}) {
  if (candidateCache.value !== null && Date.now() - candidateCache.at < CANDIDATE_TTL_MS) {
    const cached = candidateCache.value
    // 缓存里没有总线信息（探测当时还没完成）而现在已经有 → 重新算一次。
    if (cached.busKnown !== true && busTypeCache !== null) candidateCache = { at: 0, value: null }
    else return cached
  }

  const candidates = []
  const excluded = []
  const system = systemDrive()
  const cloud = cloudSyncRoots()
  const pluginDrive = driveOf(PKG_DIR)

  if (process.platform !== 'win32') {
    const value = { candidates: [], excluded: [] }
    candidateCache = { at: Date.now(), value }
    return value
  }

  for (let i = 0; i < 26; i++) {
    const letter = `${String.fromCharCode(65 + i)}:`
    if (system !== null && letter === system) {
      excluded.push({ drive: letter, reason: '系统盘（会被排除）' })
      continue
    }
    const probed = probeDrive(letter)
    if (probed === null) continue
    if (probed.freeBytes < MIN_CANDIDATE_FREE_GB * 1024 ** 3) {
      excluded.push({ drive: letter, reason: `剩余空间不足 ${MIN_CANDIDATE_FREE_GB} GB` })
      continue
    }
    let path = `${letter}\\阿依娅伊\\记忆`
    if (existsSync(path)) path = `${letter}\\dsh-aiyayi-memory`
    const hitCloud = cloud.find((item) => isInside(path, item.root))
    if (hitCloud) {
      excluded.push({ drive: letter, reason: `${hitCloud.label}里，会锁文件、会产生冲突副本` })
      continue
    }
    const sameAsPlugin = pluginDrive !== null && letter === pluginDrive
    // 候选阶段就把"是不是可拔出的外置盘"带上（1.5.3）。
    // 为什么必须在这里标：娅伊推荐盘时看的是这份候选清单，若这里只写"剩余 173 GB"，
    // 她就会把外置 USB 盘当首选（2026-11-08 实测她正是这么推荐的）。警告只在
    // dryRun 里出现太晚了——那时她已经在劝用户搬了。
    //
    // **不知道时绝不冒充**（关键）：探测没完成就写 `external: null` + reason 里
    // 明说"未探测"，而不是当成内置盘。否则排序会把外置盘按空间大小顶到第一，
    // 她照着推荐——那正是这个坑本身。宁可标"未知"，也不给错的结论。
    const bus = externalDriveInfo(`${letter}\\`)
    const notes = [sameAsPlugin ? '非系统盘，与插件同盘' : '非系统盘']
    let external = null
    if (bus === null) {
      notes.push('磁盘类型未知（探测未完成）——搬前用 dryRun 复核是否外置盘')
    } else {
      external = bus.external
      if (bus.external) notes.push(`⚠ 可拔出的外置盘（${bus.busType}）——没插时记忆会不可达`)
      else notes.push('内置盘（更稳）')
    }
    candidates.push({
      path,
      freeGb: Math.round((probed.freeBytes / 1024 ** 3) * 10) / 10,
      reason: notes.join('｜'),
      external,
      busType: bus === null ? '' : bus.busType,
    })
  }

  // 排序：**已知内置盘优先 → 未知 → 已知外置盘**，组内再按剩余空间降序（1.5.3）。
  // 原来纯按空间排，外置 USB 盘（空间最大）永远第一，正好把她引向最不稳的那个。
  // "未知"排在中间：既不冒充内置，也不把头号位置让给它。
  // 排序只改"推荐顺序"，不替用户决定；且**已知内置盘无条件下沉**——
  // 探测没完成时也有足够信息给出比"按空间排"更靠谱的顺序（至少不会把已知外置盘顶到第一）。
  const rank = (item) => (item.external === false ? 0 : item.external === true ? 2 : 1)
  candidates.sort((left, right) => {
    const a = rank(left)
    const b = rank(right)
    if (a !== b) return a - b
    return right.freeGb - left.freeGb
  })
  // busKnown 的判据：**每个候选都拿到了类型**，而不是"缓存非空"。
  // 为什么改（1.5.3 自查）：缓存里只探到一半盘（或只探到别的盘）时，
  // 用 `cache !== null` 会把"只知其一"当成"全知道"，注入行就会凭不完整的信息
  // 点名推荐。判据必须落到"这份清单本身完不完整"。
  const busKnown = candidates.length > 0 && candidates.every((item) => item.external !== null)
  const value = { candidates, excluded, busKnown }
  candidateCache = { at: Date.now(), value }
  return value
}

/* ------------------------------------------------------------------ *
 * 健康检查
 * ------------------------------------------------------------------ */

/** 分类档案口径：memories/ 下 *.md、递归、深度 ≤ 3 —— 与 memory_organize 的 tree 同口径。 */
function listTreeFilesCount(dir) {
  const found = []
  const walk = (current, prefix, depth) => {
    let names = []
    try {
      names = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of names) {
      if (item.isFile() && item.name.endsWith('.md')) {
        found.push(prefix + item.name.slice(0, -3))
      } else if (item.isDirectory() && depth < MAX_TREE_DEPTH) {
        walk(join(current, item.name), `${prefix}${item.name}/`, depth + 1)
      }
    }
  }
  walk(dir, '', 1)
  return found.length
}

/**
 * 轻量体检：根可达吗、核心记忆首行是什么、多少字节、分类档案几个文件。
 * 只读；不建目录、不写模板。
 * @returns {{ok:boolean, reason:string, coreFirstLine:string, coreBytes:number, treeFiles:number}}
 */
export function healthCheck() {
  const resolved = resolveRoot()
  if (!resolved.reachable) {
    return {
      ok: false,
      reason: unreachableMessage(resolved),
      coreFirstLine: '',
      coreBytes: 0,
      treeFiles: 0,
    }
  }
  const core = join(resolved.root, 'memory.md')
  const tree = join(resolved.root, 'memories')
  const treeFiles = listTreeFilesCount(tree)
  if (!existsSync(core)) {
    return {
      ok: false,
      reason: '核心记忆文件不存在（memory.md）',
      coreFirstLine: '',
      coreBytes: 0,
      treeFiles,
    }
  }
  let raw = ''
  let coreBytes = 0
  try {
    coreBytes = statSync(core).size
    raw = readFileSync(core, 'utf8')
  } catch (error) {
    return {
      ok: false,
      reason: `核心记忆读不出来：${error?.code ?? error?.message ?? error}`,
      coreFirstLine: '',
      coreBytes,
      treeFiles,
    }
  }
  const firstLine = raw.split(/\r?\n/)[0] ?? ''
  return {
    ok: true,
    reason: '',
    coreFirstLine: firstLine.trimEnd(),
    coreBytes,
    treeFiles,
  }
}

/* ------------------------------------------------------------------ *
 * 迁移：preflight / copy / verify / writePointer / 源目录改名
 * ------------------------------------------------------------------ */

function reject(reason, extra = {}) {
  return { ok: false, reason, ...extra }
}

function stampCompact() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

function nowIsoWithOffset() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const offsetMin = -now.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function hash16(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase().slice(0, 16)
}

/** 递归列出源目录里的文件（相对路径用正斜杠归一化，避免 `\` 与 `/` 的假差异）。 */
function walkAll(dir) {
  const items = []
  const visit = (current) => {
    let entries = []
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      throw new Error(`读不了源目录：${current}`)
    }
    for (const entry of entries) {
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        visit(abs)
        continue
      }
      if (!entry.isFile()) continue
      let size = 0
      try {
        size = statSync(abs).size
      } catch {
        size = 0
      }
      items.push({ abs, rel: relPosix(dir, abs), size })
    }
  }
  visit(dir)
  return items
}

function relPosix(base, target) {
  const rel = resolve(target).slice(resolve(base).length)
  return rel.replace(/^[\\/]+/, '').split(/[\\/]+/).filter(Boolean).join('/')
}

/**
 * 迁移前预检。9 条拒绝规则（顺序按「最该先说的先说」排：空白/不可见字符/未展开路径
 * → 原地搬 → 插件目录 → 系统盘 → 目标非空 → 父目录 → 余量）。
 * @param {string} target - 目标目录（用户输入原值）
 * @param {{freeBytes?:number, sourceBytes?:number}} opts - 测试用覆盖（生产不传）
 * @returns {{ok:boolean, reason:string, target?:string, parent?:string, plan?:Array, sourceBytes?:number}}
 */
export function preflight(target, opts = {}) {
  const text = typeof target === 'string' ? target : String(target ?? '')
  if (text.trim().length === 0) return reject('目标路径为空')

  // 不可见字符先查：`trim()` 会吃掉部分不可见字符（U+FEFF 就被当时空白），
  // 先判空白会把「尾部粘 BOM」误报成「首尾有空格」，把真正的病因藏起来。
  if (/[\u0000-\u001f\u007f\u200b-\u200f\uFEFF]/.test(text)) {
    const hasBom = text.includes('\uFEFF')
    return reject(`目标路径含不可见字符（${hasBom ? '含 U+FEFF BOM 字符' : '含控制字符或零宽字符'}），已拒绝`)
  }
  if (text !== text.trim()) {
    return reject(`目标路径首尾有空白字符，已拒绝（避免建出「${text}」这种名字带空格的目录）`)
  }
  if (/^~(?=$|[\\/])/.test(text) || /%[^%\\/]+%/.test(text)) {
    return reject(`路径未展开（含 ~ 或 %VAR%），会被当字面量建目录：${text}`)
  }

  const absolute = resolve(text)
  const current = resolveRoot()

  if (current.root && samePath(absolute, current.root)) {
    return reject(`目标就是当前记忆根，无需迁移：${absolute}`)
  }
  if (isInside(absolute, PKG_DIR)) {
    return reject(`目标在插件包目录内，插件升级会覆盖你的记忆：${absolute}`, { target: absolute })
  }
  if (isSystemDrive(absolute)) {
    return reject(`目标仍在系统盘 ${driveOf(absolute) ?? ''}：${absolute}`, { target: absolute })
  }
  // 云同步目录必须拦住（1.5.1 补，2026-11-08 娅伊提出）：
  // 候选枚举阶段本来就排除了网盘，但**直接指定路径迁移**这条路原先没拦。
  // 后果不是小事：整棵记忆会触发一次大流量同步；同步客户端常会临时锁文件/改文件，
  // 让逐文件 SHA256 校验误报"内容不一致"；冲突副本还会凭空多出 `xxx (1).md`，
  // 让"相对路径集合一致"这条校验直接失败。
  const cloud = cloudSyncRoots().find((item) => isInside(absolute, item.root))
  if (cloud) {
    return reject(
      `目标在${cloud.label}里（${cloud.root}），已拒绝：云同步会触发大流量上传、临时锁文件会让 SHA256 校验误报、冲突副本还会破坏文件集合一致性：${absolute}`,
      { target: absolute },
    )
  }
  if (existsSync(absolute)) {
    let isDir = false
    try {
      isDir = statSync(absolute).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) return reject(`目标已存在且不是目录：${absolute}`, { target: absolute })
    let entries = []
    try {
      entries = readdirSync(absolute)
    } catch (error) {
      return reject(`目标目录读不了：${absolute}（${error?.code ?? error?.message ?? error}）`, { target: absolute })
    }
    if (entries.length > 0) {
      return reject(`目标已存在且非空（${entries.length} 个条目）：${absolute}`, { target: absolute })
    }
  }

  const parent = dirname(absolute)
  // 父目录可以不存在（copy 阶段逐级建），但「最近的已存在祖先」必须能落脚且可写。
  let cursor = parent
  while (true) {
    if (existsSync(cursor)) break
    const up = dirname(cursor)
    if (up === cursor) {
      return reject(`目标父目录不存在：${parent}（盘符或根目录不存在）`, { target: absolute })
    }
    cursor = up
  }
  try {
    if (!statSync(cursor).isDirectory()) return reject(`目标父目录不可用（不是目录）：${cursor}`, { target: absolute })
    accessSync(cursor, fsConstants.W_OK)
  } catch (error) {
    return reject(`目标父目录不可写：${cursor}（${error?.code ?? error?.message ?? error}）`, { target: absolute })
  }

  if (!current.reachable) return reject(unreachableMessage(current), { target: absolute })

  let plan
  try {
    plan = walkAll(current.root)
  } catch (error) {
    return reject(`源记忆目录读不了，无法迁移：${error?.message ?? error}`, { target: absolute })
  }
  const sourceBytes = Number.isFinite(opts.sourceBytes)
    ? opts.sourceBytes
    : plan.reduce((sum, item) => sum + item.size, 0)

  const freeBytes = Number.isFinite(opts.freeBytes) ? opts.freeBytes : freeBytesOf(parent)
  if (freeBytes !== null && freeBytes !== undefined && sourceBytes * FREE_SPACE_MULTIPLIER > freeBytes) {
    const needGb = ((sourceBytes * FREE_SPACE_MULTIPLIER) / 1024 ** 3).toFixed(2)
    const freeGb = (freeBytes / 1024 ** 3).toFixed(2)
    return reject(
      `目标盘剩余 ${freeGb} GB，小于源大小（${(sourceBytes / 1024 ** 2).toFixed(2)} MB）×${FREE_SPACE_MULTIPLIER}（需要 ${needGb} GB）`,
      { target: absolute },
    )
  }

  // 外置盘只**警告**不拦截（1.5.2，2026-11-08 娅伊建议 + 用户选择"加警告"）。
  // 探测失败（别人的机器没 PowerShell / 非 Windows）时 external 为 null，
  // 就当"不知道"，既不警告也不拦截——不能因为探测不了就不让人搬家。
  const external = externalDriveInfo(absolute)
  const warnings = []
  if (external !== null && external.external) {
    warnings.push(
      `⚠ 目标在**可拔出的外置盘**上（${external.busType}${external.model ? `，${external.model}` : ''}）：每次开机/拔线后如果这块盘不在，记忆根就会变成"不可达"，她的记忆读写会全部失败。确认你会一直插着再继续；内置盘更稳。`,
    )
  }

  return {
    ok: true,
    reason: '',
    target: absolute,
    parent,
    plan,
    sourceBytes,
    // dry-run 与普通预检共用同一份计划，保证"看到的计划"就是"要执行的计划"。
    crossDrive: sameDrive(current.root, absolute) === false,
    fromDrive: driveOf(current.root),
    toDrive: driveOf(absolute),
    freeBytes: freeBytes === null || freeBytes === undefined ? null : freeBytes,
    external: external === null ? null : external.external,
    externalBusType: external === null ? '' : external.busType,
    warnings,
  }
}

/** 两个路径是否同盘（非盘符路径一律算不同盘，宁可多提示跨盘）。 */
function sameDrive(left, right) {
  const a = driveOf(left)
  const b = driveOf(right)
  if (a === null || b === null) return a === b
  return a === b
}

function copyAll(src, dst, plan) {
  for (const item of plan) {
    const to = join(dst, ...item.rel.split('/'))
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(item.abs, to)
  }
}

/** 逐文件校验：相对路径集合一致 + 每文件字节数一致 + SHA256 一致。 */
function verify(src, dst, plan) {
  const copied = walkAll(dst)
  const expected = new Set(plan.map((item) => item.rel))
  const actual = new Set(copied.map((item) => item.rel))
  for (const rel of expected) {
    if (!actual.has(rel)) throw new Error(`目标缺文件：${rel}`)
  }
  for (const rel of actual) {
    if (!expected.has(rel)) throw new Error(`目标多了文件：${rel}`)
  }
  const byRel = new Map(copied.map((item) => [item.rel, item]))
  for (const item of plan) {
    const mirror = byRel.get(item.rel)
    if (mirror.size !== item.size) {
      throw new Error(`字节数不一致：${item.rel}（源 ${item.size} / 目标 ${mirror.size}）`)
    }
    if (hash16(item.abs) !== hash16(mirror.abs)) throw new Error(`内容 hash 不一致：${item.rel}`)
  }
}

/** 写指路文件：本包唯一允许写 location.json 的地方（Node 原生 utf8，天然无 BOM）。 */
function writePointerFile(data) {
  mkdirSync(dirname(pointerPath()), { recursive: true })
  writeFileSync(pointerPath(), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  pointerCache = { key: null, value: null }
}

/**
 * 把源目录内容改名到同级备份。
 *
 * 命名一律带时间戳：`<源>.old-20261108-2359`（1.5.1 改，2026-11-08 娅伊提出）。
 * 第一版是"撞名才加时间戳"，第一次搬完留下的是光秃秃的 `aiyayi.old`；
 * 下次再搬就撞名、再加后缀，结果档案里躺着两个语义不同的 `aiyayi.old` 与
 * `aiyayi.old-日期`，看不出哪个是哪次搬的。现在**每次**都带时间戳，
 * 一眼就能对上是哪一次搬的备份。
 * 不删除任何内容；指路文件本身留在原处（验收判据 3：老目录只剩 location.json）。
 * @returns {string} 实际备份目录
 */
function backupSource(src) {
  let backup = `${src}.old-${stampCompact()}`
  let suffix = 2
  while (existsSync(backup)) {
    backup = `${src}.old-${stampCompact()}-${suffix}`
    suffix += 1
  }
  mkdirSync(backup, { recursive: true })
  let moved = 0
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const abs = join(src, entry.name)
    if (samePath(abs, pointerPath())) continue
    renameSync(abs, join(backup, entry.name))
    moved += 1
  }
  if (moved === 0) {
    rmSync(backup, { recursive: true, force: true })
    return ''
  }
  return backup
}

/**
 * 阶段化报错：失败文案必须带**阶段名 + 源目录未动**。
 *
 * 2026-11-08 事故的直接成因：迁移流程失败与正常状态"长得一样"，她只能靠猜。
 * 现在任何一步失败都写成 `[迁移失败·<阶段>] 原因；源目录未动（仍在 <src>）`，
 * 让旁人和她自己一眼看出"是失败"而不是"没生效"。
 */
function stageError(stage, src, cause, extra = '') {
  const reason = cause?.message ?? String(cause ?? '未知错误')
  return new Error(`[迁移失败·${stage}] ${reason}${extra ? `；${extra}` : ''}；源目录未动（仍在 ${src}）`)
}

/**
 * 迁移记忆根：复制 → 逐文件校验 → 写指路文件 → 源目录改名备份。
 * `opts.stay === true` 时不做迁移，只把「就留在当前路径」这个决定落进指路文件
 * （同一文件、同一格式，加 stayOnSystemDrive: true），之后不再每轮提示迁移。
 * @param {string} target - 目标绝对路径（stay 时可省略）
 * @param {{keepSourceAsBackup?:boolean, stay?:boolean}} opts
 */
export async function relocateTo(target, opts = {}) {
  if (opts.stay === true) {
    const resolved = resolveRoot()
    if (resolved.source === 'env') {
      throw new Error('当前记忆根来自环境变量 AIYAYI_HOME，请先去掉这个变量再记录「留在原处」的决定')
    }
    if (!resolved.reachable) throw new Error(unreachableMessage(resolved))
    writePointerFile({
      version: POINTER_VERSION,
      root: resolved.root,
      stayOnSystemDrive: true,
      decidedAt: nowIsoWithOffset(),
    })
    return {
      ok: true,
      stayed: true,
      copies: 0,
      bytes: 0,
      hashMatched: true,
      pointer: pointerPath(),
      effectiveFrom: resolved.root,
      needsRestart: false,
      sourceBackup: '',
      note: '已记录：记忆就留在当前路径，不再提示迁移',
    }
  }

  const pre = preflight(target, opts)
  if (!pre.ok) throw new Error(pre.reason)

  const resolved = assertReachable()
  const src = resolved.root
  const dst = pre.target
  const plan = pre.plan
  const totalBytes = plan.reduce((sum, item) => sum + item.size, 0)

  // 0) dry-run：只报计划，不碰磁盘（1.5.1 加，2026-11-08 娅伊提出）。
  // 好处是"确认前先看一眼"：复制多少文件、多少字节、目标盘够不够、是否跨盘。
  // 与正式执行共用同一份 preflight 计划，所以看到的数字就是真会发生的数字。
  if (opts.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      copies: plan.length,
      bytes: totalBytes,
      from: src,
      to: dst,
      crossDrive: pre.crossDrive,
      fromDrive: pre.fromDrive,
      toDrive: pre.toDrive,
      freeBytes: pre.freeBytes,
      external: pre.external,
      externalBusType: pre.externalBusType,
      warnings: pre.warnings,
      hashMatched: false, // 还没搬，不能谎报校验通过
      pointer: pointerPath(),
      effectiveFrom: src, // 还没搬，位置不变
      needsRestart: false,
      sourceBackup: '',
      note: `预演：将复制 ${plan.length} 个文件 / ${totalBytes} 字节到 ${dst}，逐文件校验（相对路径集合+字节+SHA256）后再写指路文件${opts.keepSourceAsBackup !== false ? '，最后把源目录内容改名成同级备份' : ''}。这只是预演，磁盘上什么都没改；确认无误后再传 dryRun: false（或不传）真正执行。`,
    }
  }

  // 1) copy：只复制，不移动（跨盘 move 失败会两头不齐）。
  try {
    copyAll(src, dst, plan)
  } catch (error) {
    rmSync(dst, { recursive: true, force: true })
    throw stageError('复制', src, error, '目标副本已清理，可干净重试')
  }

  // 2) verify：失败清理**目标副本**，绝不碰源目录，重试是干净的。
  try {
    verify(src, dst, plan)
  } catch (error) {
    rmSync(dst, { recursive: true, force: true })
    throw stageError('校验', src, error, '目标副本已清理，可干净重试')
  }

  // 3) 记录核心记忆指纹（用于事后快速判断「新路径是不是同一份」）。
  const core = join(src, 'memory.md')
  const coreStats = existsSync(core)
    ? { coreBytes: statSync(core).size, coreSha16: hash16(core) }
    : { coreBytes: 0, coreSha16: '' }

  // 4) 指针最后写：在校验通过之后。指针先写 = 复制中途断电后插件跳到半份目录。
  try {
    writePointerFile({
      version: POINTER_VERSION,
      root: dst,
      relocatedAt: nowIsoWithOffset(),
      from: src,
      ...coreStats,
    })
  } catch (error) {
    // 指针写失败时，目标副本已经完整校验通过，但**不能**留着——否则下次
    // 重试会因为"目标非空"被预检拦住，人就以为搬家坏了。
    rmSync(dst, { recursive: true, force: true })
    throw stageError('写指路文件', src, error, '目标副本已清理，可干净重试')
  }

  // 5) 源目录改名（不删除）；失败不影响迁移结果，但要在返回值里说清楚。
  let sourceBackup = ''
  let note = ''
  if (opts.keepSourceAsBackup !== false) {
    try {
      sourceBackup = backupSource(src)
    } catch (error) {
      note = `[迁移已完成·改名备份这一步没做成] ${error?.code ?? error?.message ?? error}。注意：指路文件已写好、目标副本已通过校验，所以**迁移本身是成功的**；只是原目录内容还留在 ${src}，没有改名成备份。`
    }
  } else {
    note = '按 keepSourceAsBackup=false 跳过了源目录备份；原目录内容还在，注意别手滑删掉 location.json（那会回到旧路径、两份分叉）'
  }

  return {
    ok: true,
    stayed: false,
    dryRun: false,
    copies: plan.length,
    bytes: totalBytes,
    hashMatched: true,
    crossDrive: pre.crossDrive,
    pointer: pointerPath(),
    effectiveFrom: dst,
    needsRestart: true,
    sourceBackup,
    from: src,
    external: pre.external,
    externalBusType: pre.externalBusType,
    warnings: pre.warnings,
    note,
  }
}

/* 测试出口：只给单测用。 */
export const __testing = {
  preflight,
  walkAll,
  verify,
  hash16,
  stageError,
  memoryStatus,
  /** 供测试断言"默认路径的 sourceLabel 不会像报错"。 */
  sourceLabel,
  codeSelfCheck,
  pointerCacheReset() {
    pointerCache = { key: null, value: null }
  },
  candidateCacheReset() {
    candidateCache = { at: 0, value: null }
  },
  /** 测试用：注入探测结果（避免真去跑 PowerShell）。
   *  传 Map = 假装"探测成功且结果是这份"；传 null = 假装"探测不可用"；
   *  传 undefined = 复位（下次调用会真探一次）。 */
  setBusTypeCache(value) {
    if (value === undefined) {
      busTypeCache = null
      busTypeProbed = false
      return
    }
    busTypeCache = value
    busTypeProbed = true
  },
  /**
   * 测试用：冻结探测结果。冻结期间后台探测的结果一律丢弃。
   * 为什么需要：异步探测会让"设了未知态、断言还没跑完、PowerShell 就回来了"
   * 变成竞态，§13 的用例因此时红时绿（2026-11-08 实测）。
   */
  freezeBusTypes(frozen) {
    busTypeFrozen = frozen === true
  },
  externalDriveInfo,
  setOverride(value) {
    overrideRoot = value === undefined ? null : value
  },
  /** 测试专用：指路文件搬进沙盘，生产永远不调（传 null 复位到真位置）。 */
  setPointerPath(value) {
    pointerPathOverride = value === null || value === undefined ? null : value
    pointerCache = { key: null, value: null }
  },
  /** 真机上的指路文件路径（测试用来断言"没被写脏"）。 */
  realPointerPath() {
    return POINTER_PATH
  },
}
