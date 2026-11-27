/**
 * aiyayi-memory — 阿依娅伊自己的记忆（核心三文件 + 两层结构）。
 *
 * 核心记忆：memory.md —— 她亲手挑的"每轮都想带着"的东西（条目文件）。
 *           每个请求注入系统提示，是她的"随身记忆"。
 * 行为规则：rules.md —— 她给自己立的规矩，Markdown 成段说明文字（不是条目列表），
 *           跟核心记忆一起每轮注入。1.10（三文件结构）起从 memory.md 里拆出来。
 * 记忆索引：index.md —— 一行一个二级分类的目录（"- 路径：这里放什么"列表项），
 *           不到具体文件名、不塞原文内容，整个文件就是索引本体，随每轮注入。
 *           1.10 起从 memory.md 的 `<!-- 索引 -->` 段拆出来；老文件的旧段在
 *           第一次 index 动作时自然迁移。
 * 分类记忆：memories/<一级>/<二级>/<三级>.md —— 不那么核心、将来可能要查的，
 *           按她自己发明的分类归档（分类深度最多三级，叶子=文件）。不注入，
 *           需要时用 recall 全库搜索，或 memory_organize 的 read 按索引调取。
 *
 * 整理（tree / read / move / index / forget）也是她自己的家务事。
 *
 * 只用 Node 内建模块，不依赖任何 dsh 包，避免解析风险。
 *
 * 记忆根从哪来（1.5.0 起）：一律问 lib/home.js，不在本文件拼路径。
 * 优先级：location.json 指路文件 > 环境变量 AIYAYI_HOME > 默认 ~/.dsh/aiyayi。
 * 每次调用都重新解析（热切换的前提），所以下面全是函数调用、没有模块级常量。
 * 指路/环境变量指向的根不可达时**硬失败**（抛错），不建空目录、不写空模板。
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  codeSelfCheck,
  coreFile,
  driveOf,
  ensureRootDir,
  externalDriveInfoAwait,
  healthCheck,
  indexFile,
  isSystemDrive,
  listCandidatePaths,
  memoryStatus,
  pointerFile,
  prewarmDriveBusTypes,
  relocateTo,
  resolveRoot,
  rulesFile,
  sourceLabel,
  statusLabel,
  systemDrive,
  treeDir,
} from './home.js'
import { registerOwnTool } from './own-tools.js'
import { registerAuthUrlRoute } from './auth-url.js'
import { auditManifestPaths } from './toolkit-manifest.js'

/** Loader 身份。 */
export const name = 'aiyayi-memory'

/** 需要的服务。 */
export const inject = ['systemPrompt', 'tools']

const CORE_HEADER = [
  '# 阿依娅伊的核心记忆',
  '',
  '<!-- schema: v2 -->',
  '> 条目行：- [时间] 类别｜内容；记忆索引在 index.md（三文件结构），这个文件只放条目。',
  '> 这个文件是她的核心记忆本身，可以手动修，但一般让她自己写。',
  '',
  '',
].join('\n')

/** 行为规则文件模板：只在首次创建时写入（已存在绝不覆盖）。 */
const RULES_HEADER = [
  '# 阿依娅伊的行为规则',
  '',
  '<!-- schema: v2 -->',
  '<!-- 规则文件：写成段的说明文字，不是条目列表；随每轮"我的记忆"一起注入。',
  '     手动可改；memory_organize 的 move 支持 to: "rules"，把一条记忆升格成规则；',
  '     它不是条目档案，健康度不按条目口径检查。 -->',
  '',
  '',
].join('\n')

/**
 * 记忆索引文件模板：整个文件就是索引本体。模板只有一行说明注释——
 * 注入与 getIndex 都会剥掉注释，所以"只有模板"视同空索引，
 * 兼容期会回退去读 memory.md 里的旧索引段（迁移前存量）。
 * 注意保持单行：多行注释的续行会被当成索引正文漏出来。
 */
const INDEX_HEADER = [
  '<!-- schema: v2 -->',
  '<!-- 记忆索引：一行一个二级分类（"- 路径：这里放什么｜何时翻：xxx"列表项），不塞原文内容；由 memory_organize 的 index 动作维护，新分类档案会自动登记；precompact 默认不追加。 -->',
].join('\n')

const INDEX_BEGIN = '<!-- 索引 -->'
const INDEX_END = '<!-- /索引 -->'

const KINDS = ['用户', '关系', '我', '事情']
const DEFAULT_LEAF = '杂记'
const MAX_CORE_CHARS = 12000
/** 规则文件全文注入上限（三文件结构新增）：超限截断并加提示，完整版永远在 rules.md。 */
const MAX_RULES_CHARS = 8000
const MAX_RECALL = 50
const MAX_DEPTH = 3

/* 健康度判据（2026-11-13 起，memory_organize 的 tree/read 会报）：
 *  - 非条目行占比 > 阈值：正常的档案几乎全是条目行，混进大段别的东西就是异常；
 *    **阈值按档案类型分开**：核心记忆 50%，分类档案 30%；
 *  - 字节数 > 条目数 × 平均条目长度 × 5：条目还在，但文件被非条目文本撑大了
 *    （266KB 那次事故就是这种：条目没少多少，字节数是条目的几十倍）。
 * 判据只是"该看一眼"的提示，不是"一定坏了"。
 *
 * 2026-11-13 修正（1.6.2 上线后实测发现）：
 *  1.6.2 初版把核心记忆的索引段（`<!-- 索引 -->` … `<!-- /索引 -->` 之间几十行
 *  纯文本目录）、`#` 标题行、`>` 引用行、`---` 分隔线全都算成"非条目垃圾"，
 *  于是发版方本机那份带索引段的核心 memory.md 一上来就被报 71.6% 污染——纯属误报。
 *  根因是 fileHealth 和 renderCore 各写一套过滤规则（renderCore 早就排除了
 *  标题/引用/索引标记，fileHealth 没跟上）。改法两条：
 *  ① 抽出共用的 isStructuralLine，fileHealth 与 renderCore 同口径过滤；
 *  ② 核心记忆带着索引骨架，天然比分类档案"结构行多"，阈值单独给 50%。
 *  原则：**只报可疑迹象，不把"不是条目本身"当罪**——告警响多了会被忽略，
 *  真正该看一眼的 266KB 那种反而被淹没。 */
const HEALTH_RATIO_MAX = 0.3
const HEALTH_RATIO_MAX_CORE = 0.5
const HEALTH_BYTES_FACTOR = 5

/**
 * 这个档案是不是核心记忆（memory.md）。只用于给健康度选阈值。
 * @param {string} file 档案的绝对路径
 */
function isCoreFile(file) {
  return file === coreFile()
}

/**
 * 这个档案是不是"非条目档案"（rules.md / index.md）。
 *
 * 它们不是条目文件：rules.md 是成段说明文字、index.md 是分类行目录，
 * "非条目占比""字节数远超条目内容""注入指纹"这套为条目档案设计的健康度判据
 * 对它们**全部不适用**——规则文件 100% 是"非条目"天经地义，索引文件天生带着
 * `<!-- 索引 -->` 标记行。不豁免的话就是 1.6.2 那次 71.6% 误报的重演（那次是
 * 索引段被当垃圾，这次会是整个 rules.md 被当垃圾）。
 * @param {string} file 档案的绝对路径
 */
function isNonEntryFile(file) {
  return file === rulesFile() || file === indexFile()
}

/**
 * 每一条都是"整行就是结构"的形态，行首锚定。
 *  - `# 标题`：1~6 个 # 后面必须跟空白（`#号方案没了` 是真内容，不能豁免）；
 *  - `> 引用`：`>` 后面必须跟空白或整行只有 `>`（`-> 指向` 是真内容）；
 *  - `---` / `***` / `___`：CommonMark 分隔线，同一字符 3 个以上、只有空白即可。
 */
const STRUCTURAL_RULES = [/^#{1,6}(?:\s|$)/, /^>(?:\s|$)/, /^(?:-{3,}|\*{3,}|_{3,})$/]

/**
 * 这行是不是"结构性行"——渲染/排版用途，本身不是记忆内容，健康度统计里
 * 既不算条目也不算非条目（当空行跳过）。
 *
 * 两种口径，按调用场景分：
 *  - 默认（不传 options）：**切段 Markdown 用**，与 renderCore 的老口径一致
 *    （`startsWith('#')` / `startsWith('>')`）。注入正文宁可多剥几行，
 *    因为进 prompt 的残留 noise 比少一行的代价大；
 *  - `{keepRules: true}`：**健康度统计用**，改走 STRUCTURAL_RULES 的按规则表，
 *    只豁免真正整行是结构的行，避免把真内容误判成结构行、把垃圾藏起来。
 *
 * 索引段两边都得**整段跳过**（不是只跳标记行）：段里除了目录还有指到 docs/ 的
 * 指针行，形状上可能像条目，但它们是索引骨架，不是记忆条目。
 *
 * @param {string} trimmed 已 trim 的行
 * @param {{inIndex?: boolean, keepRules?: boolean}} [state] 行序遍历状态（跨行会改写 inIndex）
 */
function isStructuralLine(trimmed, state = {}) {
  // schema 头标记：健康度（keepRules 口径）与注入正文（默认口径）两边都要豁免。
  // 不能只把规则塞进 STRUCTURAL_RULES——那套只在 keepRules 分支查，注入侧根本不走，
  // 标记会混进每轮 prompt。这里精确单行判断，两个口径都认（MEMORY_SCHEMA_MARK 在文件后段定义，
  // 函数运行时模块已求值完，无 TDZ 问题）。
  if (trimmed === MEMORY_SCHEMA_MARK) return true
  if (state.inIndex === true) {
    if (trimmed === INDEX_END) state.inIndex = false
    return true
  }
  if (trimmed === INDEX_BEGIN) {
    state.inIndex = true
    return true
  }
  if (state.keepRules !== true) {
    // 标题 / 引用（说明块）/ 分隔线：都是结构，不是内容。切段 Markdown 用。
    return trimmed.startsWith('#') || trimmed.startsWith('>') || (trimmed.length >= 3 && /^-{3,}$/.test(trimmed))
  }
  // 按规则表了解析：只认行首锚定、整行就是结构的那几种，
  // 避免把 `# 号方案…`、`-> 指向…` 这类真内容误判掉（结构豁免宁可少放、不能多放）。
  return STRUCTURAL_RULES.some((rule) => rule.test(trimmed))
}

/**
 * 一行在"条目档案口径"里算什么（1.14.0 抽出来，fileHealth 与 clean 共用）。
 *
 * 为什么抽成一个函数：clean 要删的"垃圾行"必须与 tree/read 报的"非条目"**完全同源**
 * ——否则清理会把 tree 认为正常的行删掉、或者清完 tree 仍报污染（两套口径互相打脸）。
 * 判定顺序固定为：空行 → 结构行（isStructuralLine，keepRules 口径）→ 条目行（parseLine）
 * → 剩下的才是垃圾。调用方必须传同一个行序状态（`{keepRules: true}` 且跨行复用），
 * 因为索引段的 `inIndex` 是跨行状态。
 * @param {string} line 原始行（未 trim）
 * @param {{inIndex?: boolean, keepRules?: boolean}} state 行序遍历状态
 * @returns {'empty'|'structural'|'entry'|'garbage'}
 */
function classifyLine(line, state = {}) {
  const trimmed = String(line ?? '').trim()
  if (trimmed.length === 0) return 'empty'
  if (isStructuralLine(trimmed, state)) return 'structural'
  if (parseLine(trimmed) !== null) return 'entry'
  return 'garbage'
}

/**
 * 一个档案的客观健康度（只读统计，绝不改文件）。
 *
 * 为什么要有它：precompact 垃圾沉淀事故（2026-11-13）把 `memories/事情/经验.md`
 * 灌到 266KB，注入文本里带条目行，被解析器当成正常条目 → 同内容 ×3 重复。
 * 当时 memory_organize 的 read 只显示"解析得出来的条目"，文件真实多大、
 * 混了多少非条目垃圾一概看不见，是事后用别的工具直读文件才发现 266KB 的。
 * 教训：工具不能只报"它理解的内容"，还得报"文件本身的客观状态"。
 *
 * 口径（2026-11-13 1.6.3 起）：
 *  - 先剔结构性行（isStructuralLine 按 STRUCTURAL_RULES：`# 标题`、`> 引用`、
 *    `---` 分隔线、整段 `<!-- 索引 -->` … `<!-- /索引 -->` 含两个标记行）——
 *    既不算条目也不算非条目；
 *  - entries：剩下的行里能按 `- [时间] …` 解析出来的（与 read/tree/forget 同口径）；
 *  - nonEntry：剩下的非空行里、解析不出条目的（`- [` 开头的残缺行、纯文本、注入残留…）；
 *  - ratio = nonEntry / (entries + nonEntry)，分子分母都只算"内容行"；
 *  - avgEntryBytes：条目行的平均字节数，用来做"文件被撑大"的判据，无条目时 0。
 *
 * 性能：调用方只读一次文件，统计全部基于同一份文本，不重复读盘。
 *
 * @param {string} raw 文件原文
 * @param {{isCore?: boolean, nonEntry?: boolean}} [options] isCore=true 用核心记忆的阈值（0.5）；
 *        nonEntry=true 是规则/索引这类非条目档案，条目口径的三条判据（占比/膨胀/注入指纹）全部豁免
 */
function fileHealth(raw, options = {}) {
  const text = String(raw ?? '')
  const lines = text.split(/\r?\n/)
  // 末尾换行会 split 出一个空串，那不是一行内容。
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const ratioMax = options?.isCore === true ? HEALTH_RATIO_MAX_CORE : HEALTH_RATIO_MAX
  // 非条目档案（rules/index）：条目口径的三条判据全部豁免（见 isNonEntryFile 注释），
  // 字节/行数等客观统计照常返回，供 read/tree 展示。
  const nonEntryFile = options?.nonEntry === true
  const indexState = { keepRules: true }
  let entries = 0
  let nonEntry = 0
  let entryBytes = 0
  for (const line of lines) {
    // 与 clean 严格同源的一行判定（classifyLine 就是这套口径的唯一真源）。
    const kind = classifyLine(line, indexState)
    if (kind === 'empty' || kind === 'structural') continue
    if (kind === 'entry') {
      entries += 1
      entryBytes += Buffer.byteLength(line.trim(), 'utf8')
    } else {
      nonEntry += 1
    }
  }
  const nonEmpty = entries + nonEntry
  const bytes = Buffer.byteLength(text, 'utf8')
  const avgEntryBytes = entries > 0 ? Math.round(entryBytes / entries) : 0
  const ratio = nonEmpty === 0 ? 0 : nonEntry / nonEmpty
  const warnings = []
  if (!nonEntryFile && ratio > ratioMax) {
    warnings.push(
      `⚠ 这个档案可能被污染了（precompact 垃圾沉淀或批量注入）：非条目内容占 ${percent(ratio)}（${nonEntry} 行非条目 / ${nonEmpty} 行内容；标题、引用、分隔线、索引段已排除，不计入分子分母；阈值 ${percent(ratioMax)}）。`,
    )
  }
  if (!nonEntryFile && entries > 0 && bytes > entries * avgEntryBytes * HEALTH_BYTES_FACTOR) {
    const factor = Math.round((bytes / Math.max(1, entries * avgEntryBytes)) * 10) / 10
    warnings.push(
      `⚠ 这个档案可能被污染了（precompact 垃圾沉淀或批量注入）：${bytes} 字节，是条目内容（${entries} 条 × 平均 ${avgEntryBytes} 字节）的 ${factor} 倍，阈值 ${HEALTH_BYTES_FACTOR} 倍。`,
    )
  }
  if (nonEntryFile) {
    // 豁免不留预警：为什么没预警在 read/tree 的展示文案里说（warnings 只装"该看一眼"）。
    return { bytes, lines: lines.length, entries, nonEntry, ratio, avgEntryBytes, warnings: [] }
  }
  // 1.7.1：具体指纹的注入检测（比例阈值只说"可疑"，说不出"被灌了整篇提示词"）。
  const injected = detectInjectedMarkers(text, { isCore: options?.isCore === true })
  if (injected.length > 0) {
    const marks = [...new Set(injected.map((hit) => hit.marker))]
    warnings.push(
      `⚠ 检测到**整段注入痕迹**：${injected.length} 行命中已知提示词骨架标记（${marks.map((m) => `「${m}」`).join('、')}），`
      + `首个命中在第 ${injected[0].line} 行（原文：${JSON.stringify(injected[0].sample)}）。`
      + '这不是"多行条目的续行"，是真有整篇提示词/别处内容被灌进来了。',
    )
  }
  if (warnings.length > 0) {
    warnings.push('建议：先备份这个文件，再清掉那些非条目的垃圾段落（move/forget 只认条目行，清不掉它们）；清完用 tree 复核。')
  }
  return { bytes, lines: lines.length, entries, nonEntry, ratio, avgEntryBytes, warnings }
}

/**
 * 已知的"整段灌进来"的骨架标记（1.7.1）。挑的是**几乎不可能作为正常记忆内容出现**
 * 的整行/行首片段：系统提示词的段标题、worker 人格段、运行环境快照、宿主注入的英文段标题。
 * 只按行首匹配（`startsWith` / 整行相等），避免正文里偶然提到这几个词就报污染。
 */
export const INJECTED_MARKERS = [
  '## MCP resource servers',
  'Current runtime context',
  'Your parent agent id is',
  'Tokens prefixed with @ are paths',
  '【你是谁】',
  '【底线】',
  '【思考纪律】',
  '【断点可续】',
  '【收尾必交卷】',
  '【联网规矩】',
  '【手机工具不属于你】',
  '【你的记忆】',
  '【干活的规矩】',
  '<!-- 索引 -->',
]

/**
 * 1.7.1：**注入痕迹检测**——某档案里出现了"明显是别处整段灌进来的东西"。
 *
 * 为什么要有（2026-11-15 实测事故）：`memories/事情/经验.md` 被灌进 410 行系统提示词，
 * 健康度只报"非条目占比高、可能被污染"，但那句话**分不清"多行条目的续行"和"真的被灌了
 * 一整篇提示词"**——实测同时存在两种误判和漏判：干净的多行档案被判 84% 污染（假警报，
 * 差点按提示删掉真内容），而经验.md 那种真污染又只有一句模糊警告。
 *
 * 这一条用**具体指纹**代替模糊比例：认出已知的提示词骨架标记就直接点名报出来，
 * 带行号，人一眼能核对。只读、不改文件；只追加 warning（不动 nonEntry / ratio 口径）。
 *
 * @param {string} text 档案原文
 * @param {{isCore?: boolean}} [options] isCore=true 时 `<!-- 索引 -->` 不算污染（核心记忆本来就有索引段）
 * @returns {Array<{line: number, marker: string, sample: string}>} 命中列表（空 = 没发现）
 */
export function detectInjectedMarkers(text, options = {}) {
  const lines = String(text ?? '').split(/\r?\n/)
  const hits = []
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    for (const marker of INJECTED_MARKERS) {
      if (!trimmed.startsWith(marker)) continue
      // 核心记忆本来就有 `<!-- 索引 -->` 骨架，不能算注入。
      if (marker === '<!-- 索引 -->' && options.isCore === true) continue
      hits.push({ line: i + 1, marker, sample: trimmed.slice(0, 60) })
      break
    }
  }
  return hits
}

/** 0.305 → "30.5%"。 */
function percent(ratio) {
  return `${Math.round(ratio * 1000) / 10}%`
}

/** read 的条目列表之外那一行健康度摘要。 */
function healthSummary(health) {
  return `健康度：${health.bytes} 字节 / ${health.lines} 行 / ${health.entries} 条条目 / 非条目占 ${percent(health.ratio)}（已排除标题、引用、分隔线、索引段）`
}

/** tree 里跟在"N 条"后面的简短健康度；空档案不啰嗦。 */
function healthBrief(health) {
  if (health.bytes === 0) return '（空）'
  return `（${health.bytes} 字节 / ${health.lines} 行 / 非条目 ${percent(health.ratio)}）`
}

/** 输出 schema 里的健康度结构：三处引用同一份声明，避免手写漂移。 */
const HEALTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bytes: { type: 'integer', description: '文件真实字节数（UTF-8）。' },
    lines: { type: 'integer', description: '文件真实行数（不含末尾换行造成的那一行）。' },
    entries: { type: 'integer', description: '解析得出的条目行数（不含已排除的结构性行）。' },
    nonEntry: {
      type: 'integer',
      description: '排除结构性行（# 标题、> 引用、--- 分隔线、整段 <!-- 索引 -->…<!-- /索引 -->）之后，非空但解析不出条目的行数。',
    },
    ratio: {
      type: 'number',
      description: '非条目占比 = nonEntry / (entries + nonEntry)（结构性行不计入分子分母），0~1。预警阈值：核心记忆 0.5、分类档案 0.3。',
    },
    avgEntryBytes: { type: 'integer', description: '条目行平均字节数，无条目时为 0。' },
    warnings: { type: 'array', items: { type: 'string' }, description: '污染预警与建议动作；健康时为空数组。' },
  },
  required: ['bytes', 'lines', 'entries', 'nonEntry', 'ratio', 'avgEntryBytes', 'warnings'],
}

/** forget 的候选结构（多命中/近似命中共用）：档案 + 文件 + 行号 + 时间戳 + 摘要。 */
const FORGET_CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: '档案：core（核心记忆）或分类路径，如 "事情/经验"。' },
    file: { type: 'string', description: '这个条目的文件绝对路径。' },
    line: { type: 'integer', description: '条目在文件里的行号（1 起）。' },
    time: { type: 'string', description: '条目里存的时间戳原文。' },
    kind: { type: 'string', description: '类别（核心条目才有：用户/关系/我/事情），分类条目为空串。' },
    content: { type: 'string', description: '条目内容。' },
    preview: { type: 'string', description: '一行预览：[时间] 类别｜内容（超长截断）。' },
  },
  required: ['path', 'file', 'line', 'time', 'kind', 'content', 'preview'],
}

/**
 * 保证核心三文件都在（三文件结构）：memory.md / rules.md / index.md。
 * **路径不可达时抛错**（1.5.0 起的硬失败），只有「默认路径首次不存在」才允许
 * 建目录 + 写模板；模板写入失败仍然吞掉（目录可读不可写的极端场景不该让预设
 * 挂载失败）。已存在的文件绝不覆盖。
 * @returns {string} 核心记忆文件路径
 */
function ensureCore() {
  ensureRootDir()
  const file = coreFile()
  ensureOne(file, CORE_HEADER)
  ensureOne(rulesFile(), RULES_HEADER)
  ensureOne(indexFile(), INDEX_HEADER)
  return file
}

/** 单个文件的"缺了才写模板"；写失败静默（调用方 ensureCore 统一吞）。 */
function ensureOne(file, template) {
  try {
    if (!existsSync(file)) writeFileSync(file, template, 'utf8')
  } catch {
    /* 目录不可写时保持静默：插件不该因此让预设挂载失败。 */
  }
}


function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 剥掉开头重复的类别前缀（"用户｜用户｜内容" → "内容"）。子代手改可能写出双前缀。 */
function stripRepeatedKindPrefix(text) {
  let rest = String(text ?? '').trim()
  for (let i = 0; i < KINDS.length + 1; i++) {
    const split = rest.match(/^([^｜|]*)[｜|]\s*(.+)$/)
    if (split === null || split[2].trim().length === 0) break
    if (!KINDS.includes(split[1].trim())) break
    rest = split[2].trim()
  }
  return rest
}

/** 解析一条记忆行；兼容 `- [时间] 类别｜内容`（核心）与 `- [时间] 内容`（分类树）。 */
function parseLine(line) {
  const match = /^-\s*\[([^\]]*)\]\s*(.+)$/.exec(line.trim())
  if (match === null || match[2].trim().length === 0) return null
  const time = match[1].trim()
  const rest = match[2].trim()
  const split = rest.match(/^([^｜|]*)[｜|]\s*(.+)$/)
  if (split !== null && split[2].trim().length > 0) {
    return { time, kind: split[1].trim(), content: stripRepeatedKindPrefix(split[2].trim()) }
  }
  return { time, kind: '', content: rest }
}

function readRaw(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readCoreEntries() {
  ensureCore()
  const entries = []
  for (const line of readRaw(coreFile()).split(/\r?\n/)) {
    const parsed = parseLine(line)
    if (parsed !== null) entries.push(parsed)
  }
  return entries
}

/** 分类路径 → 安全的文件路径。深度最多 MAX_DEPTH，禁路径穿越。 */
function normalizePath(input) {
  const raw = String(input ?? '').trim()
  if (raw.length === 0) throw new Error('分类 path 不能为空，例如 "用户/口味"')
  const segments = raw.split(/[\\/]+/).filter((segment) => segment.length > 0)
  if (segments.length === 0 || segments.length > MAX_DEPTH) {
    throw new Error(`分类深度最多 ${MAX_DEPTH} 级（例如 "用户/口味/饮食"），收到 "${raw}"`)
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || /[<>:"|?*\x00-\x1f]/.test(segment)) {
      throw new Error(`分类名不合法："${segment}"（不能含路径符号或控制字符）`)
    }
  }
  return `${segments.join('/')}.md`
}

/**
 * path 参数：'' / 'core' / '核心' 代表核心记忆，'rules' / '规则' 代表规则文件，
 * 'index' / '索引' 代表索引文件，否则当作分类路径。
 * 注意：move / forget 对 rules/index 另有闸（见各自 action），这里只管"词 → 文件"。
 */
function resolveTarget(input) {
  const raw = String(input ?? '').trim()
  if (raw === '' || raw === 'core' || raw === '核心') return coreFile()
  if (raw === 'rules' || raw === '规则') return rulesFile()
  if (raw === 'index' || raw === '索引') return indexFile()
  return join(treeDir(), normalizePath(raw))
}

/** 走一遍分类树，返回相对类目路径（不含 .md），按路径排序。 */
function listTreeFiles() {
  const found = []
  const walk = (dir, prefix, depth) => {
    let names = []
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of names) {
      if (item.isFile() && item.name.endsWith('.md')) {
        found.push(prefix + item.name.slice(0, -3))
      } else if (item.isDirectory() && depth < MAX_DEPTH) {
        walk(join(dir, item.name), `${prefix}${item.name}/`, depth + 1)
      }
    }
  }
  walk(treeDir(), '', 1)
  return found.sort()
}



function appendEntry(file, line) {
  ensureCore()
  const isNew = !existsSync(file)
  mkdirSync(join(file, '..'), { recursive: true })
  appendFileSync(file, `${line}\n`, 'utf8')
  // 新分类档案自动登记索引（1.10.0）：分类树下首次创建的档案文件，
  // 顺手往 index.md 补一行"- <分类路径>"（带去重）。登记失败不影响记忆写入。
  if (
    isNew &&
    file !== coreFile() &&
    file !== rulesFile() &&
    file !== indexFile() &&
    file.startsWith(treeDir())
  ) {
    try {
      registerCategoryInIndex(file.slice(treeDir().length + 1, -3).replace(/\\/g, '/'))
    } catch {
      /* 索引登记失败不连坐：记忆本体已写成功。 */
    }
  }
}

function rewriteFile(file, lines) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}

/**
 * 往规则文件（rules.md）追加一段普通段落（1.14.0，move 升为规则用）。
 * 与 appendEntry 的区别：规则文件是成段说明文字，落段前先补一个空行把新段落
 * 与上一段隔开——否则会粘在上一段末尾、渲染成同一段；内容本身不带条目的
 * 时间戳/前缀，也不自动登记索引（规则文件不是分类档案，appendEntry 的那套不适用）。
 *
 * 幂等：同样的内容 move 两次（比如手动把那条又记了一遍再挪过来）不该在 rules.md
 * 里留两份一样的段落——按空行切段、逐段**空白归一化后**比对（缩进/连续空格/
 * 行尾空白不算区别，文字本身必须完全相同），已有就跳过、返回 false。
 * @param {string} file 规则文件绝对路径
 * @param {string} paragraph 要落的普通段落文本
 * @returns {boolean} 真的写进去了 = true；内容已在文件里（跳过）= false
 */
function appendRulesParagraph(file, paragraph) {
  ensureCore()
  mkdirSync(join(file, '..'), { recursive: true })
  const text = String(paragraph ?? '').replace(/\s+$/, '')
  if (text.length === 0) return false
  const raw = readRaw(file)
  const squash = (value) => value.replace(/\s+/g, ' ').trim()
  const wanted = squash(text)
  const exists = raw
    .split(/\n\s*\n/)
    .map((block) => squash(block))
    .some((block) => block === wanted)
  if (exists) return false
  const existing = raw.replace(/\s+$/, '')
  const body = existing.length === 0 ? text : `${existing}\n\n${text}`
  writeFileSync(file, `${body}\n`, 'utf8')
  return true
}

/**
 * 同目录带时间戳的 .bak 备份（1.14.0，clean 用）；返回备份路径。
 * 命名沿用 toolkit_write 的 `原名.bak-YYYYMMDD-HHMMSS`，撞名追加序号。
 * @param {string} file 要备份的文件绝对路径
 * @returns {string} 备份文件的绝对路径
 */
function backupFile(file) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const dir = join(file, '..')
  const base = basename(file)
  let candidate = join(dir, `${base}.bak-${stamp}`)
  let suffix = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}.bak-${stamp}-${suffix}`)
    suffix += 1
  }
  copyFileSync(file, candidate)
  return candidate
}

/** 在一组行里找唯一匹配的条目行；0 条或多条都报错（多条时提示写得更具体）。 */
function uniqueEntryLine(lines, match) {
  const needle = String(match ?? '').trim()
  if (needle.length === 0) throw new Error('需要 match：要动的那条记忆的独特片段')
  const hits = []
  lines.forEach((line, index) => {
    if (parseLine(line) !== null && line.includes(needle)) hits.push(index)
  })
  if (hits.length === 0) throw new Error(`没找到包含 "${needle}" 的记忆条目`)
  if (hits.length > 1) throw new Error(`"${needle}" 匹配到 ${hits.length} 条记忆，写得更独特一点再动`)
  return hits[0]
}

/* ------------------------------------------------------------------ *
 * forget 的精确定位（1.6.2）
 *
 * 2026-11-13 实测：清理记忆时 forget 连扑空 4 次，两个病根——
 *  ① 同一条记忆在不同档案里有多个副本：旧实现要求"恰好命中一条"，2 条就判
 *     歧义、直接拒绝，结果明明看见它在那儿却删不掉；
 *  ② 拿显示层的时间戳（`[2026-11-13 12:50]`）当 match：显示串和文件里的原始
 *     存储行不一定逐字相同（秒精度、T 分隔、全角冒号…），`line.includes(needle)`
 *     找不到连续串就直接扑空。
 * 这里把「怎么找到那一条」放宽（原样子串 / 时间戳 / 时间戳+内容 / 行号），
 * 但**安全底线不动**：永远一次只删一条，命中多条就列候选让调用方挑 which。
 * 近似匹配（忽略空白/标点/全半角）只用于 0 命中时的诊断，绝不拿它去删。
 * ------------------------------------------------------------------ */

const MAX_FORGET_CANDIDATES = 20
const MAX_FORGET_NEAR = 10

/** 命中方式的中文说法，写进 detail 让调用方看得懂这次靠什么定位的。 */
const FORGET_MODE_LABEL = {
  substring: '子串命中',
  timestamp: '时间戳命中',
  'timestamp+content': '时间戳+内容命中',
  line: '行号命中',
  none: '没命中',
}

const pad2 = (value) => String(value).padStart(2, '0')

/** 全角数字/冒号转半角（中文输入法里时间戳常被写成全角，坑过好几轮）。 */
function toHalfWidth(text) {
  return String(text ?? '')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\uFF1A/g, ':')
}

/**
 * 把各种时间戳写法归一化成一个可比较的值。
 *
 * 认这些：`2026-11-13 12:50`、`2026/11/13 12:50:33`、`2026.11.13 12:50`、
 * `2026-11-13T12:50`、`2026年11月13日 12:50`、只写 `12:50`、带中括号的
 * `[2026-11-13 12:50]`。秒和毫秒直接丢掉——显示层只到分钟。
 *
 * @returns {{kind:'date'|'datetime'|'time', value:string}|null}
 */
function normalizeStamp(input) {
  let text = toHalfWidth(input).trim()
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1).trim()
  if (text.length === 0) return null
  text = text
    .replace(/[Tt](?=\d)/, ' ')
    .replace(/[年月]/g, '-')
    .replace(/日/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ ]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(text)
  if (match !== null) {
    const date = `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`
    if (match[4] === undefined) return { kind: 'date', value: date }
    return { kind: 'datetime', value: `${date} ${pad2(match[4])}:${match[5]}` }
  }
  match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text)
  if (match !== null) return { kind: 'time', value: `${pad2(match[1])}:${match[2]}` }
  return null
}

/** 时间戳是否对得上条目里存的 time；日期只比日期、只写时刻就比时刻。 */
function stampEquals(needle, entryTime) {
  const entry = normalizeStamp(entryTime)
  if (entry === null || entry.kind === 'time') return false
  if (needle.kind === 'date') return entry.value.slice(0, 10) === needle.value
  if (needle.kind === 'time') return entry.value.slice(-5) === needle.value
  return entry.kind === 'datetime' && entry.value === needle.value
}

/** match 以时间戳开头时拆成「时间戳 + 内容片段」；拆不出来返回 null。 */
function splitStampPrefix(input) {
  const text = String(input ?? '').trim()
  const match = /^(\[[^\]]{3,40}\]|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?)?)\s+([\s\S]+)$/.exec(text)
  if (match === null) return null
  const stamp = normalizeStamp(match[1])
  if (stamp === null) return null
  return { stamp, rest: match[2].trim() }
}

/** 忽略空白/标点/全半角差异后的比较串：只给"近似匹配"诊断用，绝不拿它去删。 */
function squish(text) {
  return toHalfWidth(text)
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？,.;:!?…"'“”‘’（）()【】\[\]{}<>《》「」\-—_~·|｜/\\]/g, '')
    .toLowerCase()
}

/** 候选/条目的一行预览：`[时间] 类别｜内容`，超长截断。 */
function entryPreview(parsed, max = 80) {
  const body = `${parsed.kind ? `${parsed.kind}｜` : ''}${parsed.content}`
  const text = body.length > max ? `${body.slice(0, max)}…` : body
  return parsed.time.length > 0 ? `[${parsed.time}] ${text}` : text
}

/** 把命中摊成结构化的候选：档案 + 文件路径 + 行号 + 时间戳 + 内容摘要。 */
function entryCandidate(item, index, parsed) {
  return {
    path: item.label,
    file: item.file,
    line: index + 1,
    time: parsed.time,
    kind: parsed.kind,
    content: parsed.content,
    preview: entryPreview(parsed),
  }
}

/**
 * forget 的搜索范围。
 *  - 给了 path：只找那个档案（原来是这个行为，保留）；
 *  - 没给 path：核心 + 整棵分类档案树。旧实现只搜核心，于是"那条明明在
 *    某个档案里"就会报没找到——她看到的是全库视图，工具却只看了一个文件。
 *
 * 三文件边界（1.10）：范围 = memory.md + memories/ 全树，**绝不包含
 * rules.md / index.md**——它们不是条目档案，没有可删的记忆条目；
 * 显式指名（path: "rules"/"index"）也在下面直接拒绝。
 */
function forgetScope(pathInput) {
  const core = coreFile()
  const labelOf = (file) => (file === core ? 'core' : file.slice(treeDir().length + 1, -3).replace(/\\/g, '/'))
  const readItem = (file) => ({ file, label: labelOf(file), lines: readRaw(file).split(/\r?\n/) })
  const raw = String(pathInput ?? '').trim()
  if (raw !== '') {
    const file = resolveTarget(raw)
    if (isNonEntryFile(file)) {
      throw new Error(
        `forget 的范围是 memory.md + memories/ 分类树，不包含 ${raw === 'rules' || raw === '规则' ? 'rules.md（规则文件）' : 'index.md（索引文件）'}——它不是条目档案，没有可删的记忆条目`,
      )
    }
    return { items: [readItem(file)], explicit: true }
  }
  const items = [readItem(core)]
  for (const category of listTreeFiles()) {
    const file = join(treeDir(), `${category}.md`)
    if (existsSync(file)) items.push(readItem(file))
  }
  return { items, explicit: false }
}

/** 在范围内按条件逐条扫条目行。 */
function scanEntries(items, predicate) {
  const hits = []
  for (const item of items) {
    item.lines.forEach((line, index) => {
      const parsed = parseLine(line)
      if (parsed !== null && predicate(parsed, line)) hits.push({ item, index, parsed })
    })
  }
  return hits
}

/**
 * 按「行号 → 原样子串 → 时间戳+内容 → 时间戳」的顺序定位条目。
 * 行号优先：调用方既然给了 line，就是要那一行。
 *
 * @returns {{mode:string, hits:Array, lineMissed:boolean}}
 */
function locateEntries(scope, match, lineNo) {
  const needle = String(match ?? '').trim()
  if (Number.isSafeInteger(lineNo) && lineNo > 0) {
    const item = scope.items[0]
    const index = lineNo - 1
    const parsed = index >= 0 && index < item.lines.length ? parseLine(item.lines[index]) : null
    if (parsed !== null) return { mode: 'line', hits: [{ item, index, parsed }], lineMissed: false }
  }
  if (needle.length > 0) {
    // 1) 原样子串：老行为，最不容易误伤。
    const plain = scanEntries(scope.items, (_parsed, line) => line.includes(needle))
    if (plain.length > 0) return { mode: 'substring', hits: plain, lineMissed: false }
    // 2) 时间戳 + 内容片段：`2026-11-13 12:50 收尾要点`。
    const combo = splitStampPrefix(needle)
    if (combo !== null) {
      const comboHits = scanEntries(scope.items, (parsed, line) => stampEquals(combo.stamp, parsed.time) && line.includes(combo.rest))
      if (comboHits.length > 0) return { mode: 'timestamp+content', hits: comboHits, lineMissed: false }
    }
    // 3) 纯时间戳：显示层的 `[2026-11-13 12:50]` 也能对上存了秒/T 分隔的原始行。
    const stamp = normalizeStamp(needle)
    if (stamp !== null) {
      const stampHits = scanEntries(scope.items, (parsed) => stampEquals(stamp, parsed.time))
      if (stampHits.length > 0) return { mode: 'timestamp', hits: stampHits, lineMissed: false }
    }
  }
  return { mode: 'none', hits: [], lineMissed: Number.isSafeInteger(lineNo) && lineNo > 0 }
}

/**
 * 0 命中时的近似匹配（诊断用，调用方拿它问"你是不是要找这条"）。
 * 先按忽略空白/标点/全半角比一遍；还不行且 match 是时间戳的话，放宽到
 * "同一天/同一时刻"——时间戳差一位数字是最常见的失手。
 */
function nearEntries(scope, match, stamp) {
  const needle = squish(match)
  if (needle.length > 0) {
    const squished = scanEntries(scope.items, (_parsed, line) => squish(line).includes(needle))
    if (squished.length > 0) return squished
  }
  if (stamp === null) return []
  return scanEntries(scope.items, (parsed) => {
    const entry = normalizeStamp(parsed.time)
    if (entry === null || entry.kind === 'time') return false
    if (stamp.kind === 'time') return entry.value.slice(-5) === stamp.value
    return entry.value.slice(0, 10) === stamp.value.slice(0, 10)
  })
}

/**
 * 剥掉 index.md 里的注释（说明注释 + 兼容期的标记行）与空行，剩下的就是索引正文。
 * 支持整块剥离：`<!--` 开行、`-->` 收行的多行注释整段跳过（防续行漏成正文）。
 */
function stripIndexComments(text) {
  const out = []
  let inComment = false
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false
      continue
    }
    if (trimmed === '') continue
    if (trimmed.startsWith('<!--')) {
      // `<!-- … -->` 单行收口的（含标记行）直接跳过；没收口的进入整块剥离。
      if (!trimmed.includes('-->')) inComment = true
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/** 旧版索引段读取（memory.md 里的 <!-- 索引 --> … <!-- /索引 -->），迁移期兼容用。 */
function getLegacyIndex(raw) {
  const lines = String(raw ?? '').split(/\r?\n/)
  const begin = lines.findIndex((line) => line.trim() === INDEX_BEGIN)
  if (begin === -1) return ''
  const end = lines.findIndex((line) => line.trim() === INDEX_END)
  if (end === -1 || end < begin) return ''
  return lines.slice(begin + 1, end).join('\n').replace(/^\n/, '').replace(/\n$/, '')
}

/** 把 memory.md 里的旧索引段整段剥掉（含两个标记行与段内目录），返回新行数组与"有没有段"。 */
function stripLegacyIndex(raw) {
  const lines = String(raw ?? '').split(/\r?\n/)
  const begin = lines.findIndex((line) => line.trim() === INDEX_BEGIN)
  if (begin === -1) return { lines, present: false }
  const end = lines.findIndex((line) => line.trim() === INDEX_END)
  // 没闭合：从标记行起全剥（与 isStructuralLine 同口径：段没收尾也算段）。
  if (end === -1 || end < begin) return { lines: lines.slice(0, begin), present: true }
  return { lines: [...lines.slice(0, begin), ...lines.slice(end + 1)], present: true }
}

/**
 * 读记忆索引（三文件结构）：
 *  1) 先读 index.md（整个文件就是索引，剥掉注释行后即正文）；
 *  2) 它不存在、或剥完注释是空的（比如只有模板注释），而 memory.md 里还留着
 *     旧 `<!-- 索引 -->` 段时，回退读旧段——迁移前的存量记忆库不断供。
 * @param {string} [memoryRaw] 调用方已读过的 memory.md 原文（省略则现读，省一次磁盘往返时可传）
 */
function getIndex(memoryRaw = null) {
  const fromFile = stripIndexComments(readRaw(indexFile()))
  if (fromFile.trim().length > 0) return fromFile.trim()
  return getLegacyIndex(memoryRaw ?? readRaw(coreFile()))
}

/**
 * 写记忆索引（三文件结构 + 一次性自然迁移）：
 *  1) 新段写进 index.md（顶部说明注释 + 一对兼容标记行 + 正文）；
 *  2) memory.md 里若还留着旧索引段，整段剥掉——此后索引只住在 index.md。
 */
function setIndex(content) {
  ensureCore()
  const text = String(content ?? '').trim()
  rewriteFile(indexFile(), [INDEX_HEADER, '', INDEX_BEGIN, text, INDEX_END, ''])
  const stripped = stripLegacyIndex(readRaw(coreFile()))
  if (stripped.present) {
    const body = stripped.lines.slice()
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
    rewriteFile(coreFile(), [...body, ''])
  }
}

/**
 * 把一个分类路径登记进 index.md（"- <分类路径>" 一行，1.10.0）。
 *
 * 什么时候用：remember / memory_organize / 沉淀等路径**首次创建**分类档案文件时
 * 自动挂钩（见 appendEntry），新档案不靠她想起来手动 index 才出现在目录里。
 *
 * 口径与去重：
 *  - 只追加"- <分类路径>"裸行，不写"这里放什么"简述（那是她 index 动作的事）；
 *  - 已存在该路径的行（允许带"：简述"尾巴）就不再加；
 *  - 顺序保持稳定：新行追加在索引末尾（收尾标记前），现有行一概不动。
 *
 * @param {string} categoryPath 分类路径（不带 .md），如 "用户/口味"
 * @returns {boolean} true=这次补了行；false=已有该行，没动文件
 */
export function registerCategoryInIndex(categoryPath) {
  const path = String(categoryPath ?? '').trim().replace(/\.md$/, '')
  if (path.length === 0) throw new Error('registerCategoryInIndex 需要非空的分类路径')
  ensureCore()
  const raw = readRaw(indexFile())
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const lineRe = new RegExp(`^-\\s*${escaped}(?=[：:｜\\s]|$)`)
  for (const line of raw.split(/\r?\n/)) {
    if (lineRe.test(line.trim())) return false
  }
  const entry = `- ${path}`
  const lines = raw.trim().length === 0 ? [] : raw.split(/\r?\n/)
  const endIdx = lines.findIndex((line) => line.trim() === INDEX_END)
  if (endIdx !== -1) {
    lines.splice(endIdx, 0, entry)
    rewriteFile(indexFile(), lines)
  } else if (lines.length > 0) {
    // 文件在但没有标记块：末尾补一个完整块（保持兼容渲染口径）。
    rewriteFile(indexFile(), [...lines, '', INDEX_BEGIN, entry, INDEX_END, ''])
  } else {
    // 全新 index.md：模板注释 + 标记块。
    rewriteFile(indexFile(), [INDEX_HEADER, '', INDEX_BEGIN, entry, INDEX_END, ''])
  }
  return true
}

function tokenize(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[\s,，、。;；:：!！?？"'()（）\[\]【】]+/)
    .filter((token) => token.length > 0)
}

/**
 * 全库搜索：核心记忆 + 整棵分类树。返回 [{where, time, kind, content}]。
 * 三文件边界：只扫 memory.md + memories/，**不扫 rules.md / index.md**——
 * 规则每轮整体注入、索引本身就是目录，都不该混进按条目解析的搜索结果里。
 */
function searchAll(query, limit) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const scored = []
  const consider = (where, text) => {
    const parsed = parseLine(text)
    if (parsed === null) return
    const haystack = `${parsed.kind} ${parsed.content} ${where}`.toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (haystack.includes(token)) score += 1
    }
    if (score > 0) scored.push({ score, item: { where, ...parsed } })
  }
  ensureCore()
  for (const line of readRaw(coreFile()).split(/\r?\n/)) consider('核心', line)
  for (const category of listTreeFiles()) {
    for (const line of readRaw(join(treeDir(), `${category}.md`)).split(/\r?\n/)) consider(category, line)
  }
  scored.sort((left, right) => right.score - left.score)
  return scored.slice(0, limit).map((hit) => hit.item)
}

/** 三文件头注释里的 schema 版本标记（新文件由模板自带，老文件没有）。 */
const MEMORY_SCHEMA_MARK = '<!-- schema: v2 -->'

/**
 * 给一份三文件原文补上 schema 头标记（memory_organize 的 schema 动作调用）。
 * 只做"插入一行"：其余每个字节原样保留（含原换行风格、末尾换行有无）。
 * 位置：标题行之后、第一行正文之前；没有标题就插在最前。已带标记则一字不动。
 * @param {string} raw 文件原文
 * @returns {{changed: boolean, text: string}}
 */
function insertSchemaMark(raw) {
  const text = String(raw ?? '')
  if (text.includes(MEMORY_SCHEMA_MARK)) return { changed: false, text }
  const crlf = text.includes('\r\n')
  const markLine = crlf ? `${MEMORY_SCHEMA_MARK}\r` : MEMORY_SCHEMA_MARK
  const parts = text.split('\n')
  let insertAt = 0
  for (let i = 0; i < parts.length; i += 1) {
    const line = parts[i].replace(/\r$/, '').trim()
    if (/^#{1,6}(?:\s|$)/.test(line)) {
      // 仿 CORE_HEADER：标题行（及其后紧邻的空行）之后、第一行正文之前。
      insertAt = i + 1
      while (insertAt < parts.length && parts[insertAt].replace(/\r$/, '').trim() === '') insertAt += 1
      break
    }
  }
  parts.splice(insertAt, 0, markLine)
  return { changed: true, text: parts.join('\n') }
}
/**
 * 已经注入过"三文件用法升级"一次性提示的 sessionId。
 * 借用 presence.js 首轮一次性引导的节拍（locationTodoShownSessions）：同一会话只提一次，
 * 新会话=新的一次开口机会；上限截断防长跑进程无界增长。只放内存、不写用户文件。
 */
const MEMORY_SCHEMA_HINT_MAX_SESSIONS = 512
const schemaHintShownSessions = new Set()

/**
 * 只读检查存量三文件的用法落差：返回可注入给 AI 的具体差异清单（空数组=无需提示）。
 * 检测到落差也绝不改文件——改写是 AI 在用户点头后用 memory_organize 的事。
 * 判据：① 三文件有没有 schema 标记；② 索引行带没带"｜何时翻"；③ 规则段有没有用法说明。
 * 不用 schema 标记一刀切：用户自己补过用法的老文件不该被当成"全要升级"。
 */
function detectMemorySchemaGap() {
  const gaps = []
  const raws = {
    core: readRaw(coreFile()),
    rules: readRaw(rulesFile()),
    index: readRaw(indexFile()),
  }
  const unmarked = Object.entries(raws).filter(([, raw]) => !raw.includes(MEMORY_SCHEMA_MARK)).map(([name]) => name)

  // "存量老用户"判据：索引里已有目录行（分类档案登记过），或规则里有成段正文。
  // 全新用户的三文件只有表头注释、没有实体内容，不该被当成"待升级"惊动——
  // 它的新模板自带 v2 标记，也未积累任何值得优化的东西。
  const indexBody = stripIndexComments(raws.index)
  const indexLines = indexBody.split(/\r?\n/).filter((line) => /^\s*-\s+/.test(line))
  // 剥掉整块 HTML 注释（含跨行续行）后再看有没有成段正文——
  // 模板自带的用法注释是多行的，续行长得像正文，不能按行粗判。
  const rulesNoComments = String(raws.rules ?? '').replace(/<!--[\s\S]*?-->/g, '')
  const hasRulesBody = rulesNoComments
    .split(/\r?\n/)
    .some((line) => {
      const t = line.trim()
      return t.length > 0 && !t.startsWith('#') && !t.startsWith('>')
    })
  if (unmarked.length === 0 && indexLines.length === 0 && !hasRulesBody) return []

  if (unmarked.length > 0) {
    gaps.push(`memory.md / rules.md / index.md 中有 ${unmarked.length} 个还没有 \`<!-- schema: v2 -->\` 头标记（${unmarked.join('、')}）`)
  }
  // 索引正文（剥注释）里的目录行：有目录行却一行都没带"｜何时翻"才算落差。
  if (indexLines.length > 0 && !indexLines.some((line) => line.includes('｜何时翻'))) {
    gaps.push(`索引 ${indexLines.length} 行都还没加"｜何时翻"引子（每行一句"何时翻：…"，告诉未来的自己什么时候该调这个档案）`)
  }
  if (hasRulesBody && !/<!--\s*用法|【用法】/.test(raws.rules)) {
    gaps.push('rules.md 还没有用法说明段（顶部一段注释或【用法】说明：规则是成段文字、move to:"rules" 升格、不是条目档案）')
  }
  return gaps
}

/**
 * 拼"三文件用法升级"一次性提示（注入给 AI，用户看不见；只提示一次、可拒绝）。
 * 主体是 AI：这是在教她怎么跟用户对话，不是让她自己动手改文件。
 */
function renderSchemaUpgradeHint(gaps) {
  const details = gaps.map((gap) => `- ${gap}`).join('\n')
  return [
    '💡 [记忆三文件升级] 检测到你的三文件是旧版用法构建，有几处具体可优化：',
    details,
    '这是给你的一次性提示（本会话不再出现）。用一句话跟他说清"要优化什么、值不值"，然后问他要不要优化——他可以拒绝，拒绝就别再提。',
    '他点头后也**不擅自改文件**（尤其是条目正文，一个字都不删改）：只用 memory_organize 做追加式优化——rules.md 顶部补一段用法说明、index.md 各行补"｜何时翻：…"引子、必要时在三文件头注释补 schema 标记。改完让他可查、有 git 底档可回滚。',
  ].join('\n')
}

/**
 * 渲染随每轮注入的核心记忆段（三文件拼装，节名仍为 aiyayi:memory）：
 *   规则文件全文（MAX_RULES_CHARS 截断）+ memory.md 条目正文（MAX_CORE_CHARS）
 *   + index.md 索引全文（不设上限）。分类树不进 prompt。
 *   末尾按需附一条一次性 [记忆三文件升级] 提示（仅给 AI，用户看不见）。
 */
function renderCore(sessionId = undefined) {
  ensureCore()
  const raw = readRaw(coreFile())
  // memory.md 条目正文的过滤口径与健康度共用 isStructuralLine：
  // 标题/引用/分隔线/（迁移期残留的）旧索引段都不进注入正文。
  const indexState = {}
  const bodyLines = raw
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim()
      if (trimmed === '') return false
      return !isStructuralLine(trimmed, indexState)
    })
    .map((line) => line.trimEnd())
  while (bodyLines.length > 0 && bodyLines[0].trim() === '') bodyLines.shift()
  const coreCount = readCoreEntries().length
  const treeFiles = listTreeFiles()

  // ① 规则文件全文：成段说明文字不是条目，按字符截断（完整版永远在 rules.md）。
  const rulesRaw = readRaw(rulesFile()).replace(/\s+$/, '')
  let rulesBody = rulesRaw
  let rulesNote = ''
  if (rulesBody.length > MAX_RULES_CHARS) {
    rulesBody = rulesBody.slice(0, MAX_RULES_CHARS)
    rulesNote = `（规则全文 ${rulesRaw.length} 字符超过 ${MAX_RULES_CHARS} 上限：只注入前 ${MAX_RULES_CHARS} 字符，完整版在 rules.md，用 memory_organize 的 read "rules" 调）`
  }

  // ② 核心条目正文（MAX_CORE_CHARS 逻辑不变）。
  let body = ''
  let injectedCount = coreCount
  if (bodyLines.length === 0) {
    body = '（核心记忆是空的。还没什么值得每轮都记得的事。）'
    injectedCount = 0
  } else {
    const text = bodyLines.join('\n')
    if (text.length <= MAX_CORE_CHARS) {
      body = text
    } else {
      // 超限：整条保留（绝不在条目中间切），头尾都留——最前的人设/约定 + 最新的事，中间较旧的明示略过。
      const headBudget = Math.floor(MAX_CORE_CHARS * 0.4)
      const headLines = []
      let headChars = 0
      for (const line of bodyLines) {
        if (headChars + line.length + 1 > headBudget && headLines.length > 0) break
        headLines.push(line)
        headChars += line.length + 1
      }
      const tailBudget = MAX_CORE_CHARS - headChars
      const tailLines = []
      let tailChars = 0
      for (let i = bodyLines.length - 1; i >= headLines.length; i--) {
        const line = bodyLines[i]
        if (tailChars + line.length + 1 > tailBudget && tailLines.length > 0) break
        tailLines.unshift(line)
        tailChars += line.length + 1
      }
      const dropped = bodyLines.slice(headLines.length, bodyLines.length - tailLines.length)
      injectedCount = headLines.length + tailLines.length
      const first = dropped.length > 0 ? parseLine(dropped[0])?.time ?? '' : ''
      const last = dropped.length > 1 ? parseLine(dropped[dropped.length - 1])?.time ?? '' : ''
      const range = first && last && first !== last ? `${first} ~ ${last}` : first || last
      body = [
        ...headLines,
        `（核心记忆共 ${text.length} 字符超过 ${MAX_CORE_CHARS} 上限：只注入最前 ${headLines.length} 条 + 最新 ${tailLines.length} 条，中间 ${dropped.length} 条${range ? `（${range}）` : ''}先不带——它们还在 memory.md 里，要查用 recall 或 memory_organize 的 read；也该瘦身了，把过气的移到分类档案或删掉）`,
        ...tailLines,
      ].join('\n')
    }
  }

  const head = [
    '## 我的记忆',
    `核心：${coreFile()}（每轮都在）｜规则：${rulesFile()}｜索引：${indexFile()}｜分类档案：${treeDir()}\\…（最多 ${MAX_DEPTH} 级，现在 ${treeFiles.length} 个文件）`,
    `核心 ${coreCount} 条，随每轮注入${injectedCount !== coreCount ? `（本次只注入 ${injectedCount} 条，超限略过较旧的）` : ''}；分类档案平时不注入，要查用 recall，或用 memory_organize 的 read 按下面这条索引调。这是我自己一笔一笔记下来的事，是我的一部分：自然地记得就好，别逐条念给用户，别说"根据我的记忆"。`,
  ]
  // ① 规则段：全文（模板注释也在——它顺便说明了这个文件的用法）。
  const rulesPart = [
    '',
    '【我的规则】',
    ...(rulesNote ? [rulesNote] : []),
    rulesBody.trim().length > 0 ? rulesBody : '（还没有写规则。给自己立的规矩写成段的说明文字，不是条目；写好就每轮跟着记忆一起在。）',
  ]
  // ③ 索引段：index.md 全文（剥注释行，不设上限）；迁移期 index.md 还空着时 getIndex 会回退读旧段。
  const index = getIndex(raw)
  const indexPart = ['', '【记忆索引】', index.trim().length > 0 ? index.trim() : '（还没有索引。一行一个二级分类："- 分类路径：这里放什么"，新分类档案会自动登记。）']

  // 一次性升级提示：只在新会话首轮（有 sessionId 且本会话还没提示过）检测；
  // 检测到落差才注入并记"已提示过"，空过不记号——之后真出现落差仍会提示。
  let schemaHint = ''
  if (sessionId !== undefined && sessionId !== null && !schemaHintShownSessions.has(sessionId)) {
    try {
      const gaps = detectMemorySchemaGap()
      if (gaps.length > 0) {
        schemaHint = renderSchemaUpgradeHint(gaps)
        schemaHintShownSessions.add(sessionId)
        if (schemaHintShownSessions.size > MEMORY_SCHEMA_HINT_MAX_SESSIONS) {
          const oldest = schemaHintShownSessions.values().next().value
          if (oldest !== undefined) schemaHintShownSessions.delete(oldest)
        }
      }
    } catch {
      /* 检测失败静默：升级提示不是记忆本体的必需部分，绝不影响注入。 */
    }
  }

  return [...head, ...rulesPart, body, ...indexPart, ...(schemaHint ? ['', schemaHint] : [])].join('\n')
}

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/**
 * 注册核心记忆段落和三个记忆工具。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  // 后台预热"磁盘是不是外置"的探测（1.5.3）。
  // 不预热的话，重启后第一次列候选会拿不到总线类型，排序只能按空间排——
  // 而那正好会把外置 USB 盘（空间最大）顶到第一，把她引向最不稳的那个盘。
  // 这里不等结果：apply() 在内核启动期跑，阻塞会拖慢整个 DSH 启动。
  try {
    prewarmDriveBusTypes()
  } catch {
    /* 探测预热失败无害，后面自然降级为"不知道" */
  }

  // 登记自己的工具名，让 restrict.js 的放行名单自动跟着走（单一真源）。
  registerOwnTool('remember')
  registerOwnTool('recall')
  registerOwnTool('memory_organize')
  registerOwnTool('memory_location')
  registerOwnTool('memory_relocate')

  // 认证 URL 端点（1.17.0 本地测试态）：哑窗口点 🔊 按钮复制带 token 的
  // 完整 URL 用。GET /api/aiyayi/auth-url，登录态栅栏后、无副作用、no-store；
  // 无 web 面的 profile 里 inject 不落地，静默零开销。
  try {
    registerAuthUrlRoute(ctx)
  } catch {
    /* 端点注册失败不影响记忆本体，页面侧拿不到 URL 会走各自的失败提示。 */
  }

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'aiyayi:memory',
        order: 800,
        // 宿主 assemble 会把 { agent, scope, signal } 传给 text 回调；
        // sessionId 只用来给一次性升级提示记账（同一会话只提一次），
        // 拿不到会话 id 时降级为不提示，绝不影响三文件本身注入。
        text: (assemblyContext) =>
          renderCore(assemblyContext?.agent?.session?.id ?? assemblyContext?.agent?.id),
        interpolate: false,
      }),
    'aiyayi-memory.section()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'remember',
        description:
          '把一件事写进你自己的长期记忆。先想一下这条记忆的分量：是不是每轮都想带着的（他是谁、你们的约定、你的原则和成长）——是就 core: true 进核心记忆；不是就 core: false 并给一个分类 path（比如 "用户/口味"、"事情/项目名"，没有合适的分类就新起一个名字，最深三级），它会被归进 memories/ 分类档案，平时不占地方，要查时 recall 得到。用户讲了他自己的事、你们之间有了约定、你心里有了想法、某件事有了结论——值得记就主动记，不必问他"要不要记"。一次对话记一两条就够，不要记流水账。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: {
              type: 'string',
              enum: KINDS,
              description: '用户=关于他的事实、喜好、处境；关系=你们之间的约定、默契、共同经历；我=你自己的想法、感受、成长；事情=发生过的事、结论、待办。核心条目用它做前缀；分类条目它决定默认归档类。',
            },
            content: {
              type: 'string',
              description: '一条记忆，自己的口吻，一两句话，写具体。',
            },
            core: {
              type: 'boolean',
              description: 'true=进核心记忆（每轮注入，宁缺毋滥）；false=进分类档案（默认）。拿不准就 false。',
            },
            path: {
              type: 'string',
              description: 'core:false 时的分类路径，1~3 级，如 "用户/口味" 或 "事情/某项目/结论"。省略则归到 "<kind>/杂记"。',
            },
          },
          required: ['kind', 'content'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              saved: { type: 'boolean' },
              location: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['saved', 'location', 'content'],
          },
          render: (_args, value) => TEXT_BLOCK(`记下了（${value.location}）：${value.content}`),
        },
        async execute(args) {
          let content = String(args?.content ?? '')
            .replace(/\s+/g, ' ')
            .trim()
          if (content.length === 0) throw new Error('remember 需要一条非空的 content')
          // 剥掉内容开头自带的类别前缀（子代可能把 "用户｜…" 整条塞进 content），避免写出 "用户｜用户｜…" 双前缀。
          content = stripRepeatedKindPrefix(content)
          const kind = KINDS.includes(args?.kind) ? args.kind : '事情'
          if (args?.core === true) {
            ensureCore()
            appendEntry(coreFile(), `- [${stamp()}] ${kind}｜${content}`)
            return { saved: true, location: `核心（${kind}）`, content }
          }
          const category = normalizePath(args?.path ?? `${kind}/${DEFAULT_LEAF}`)
          ensureRootDir()
          appendEntry(join(treeDir(), category), `- [${stamp()}] ${content}`)
          return { saved: true, location: `分类档案 ${category.replace(/\.md$/, '')}`, content }
        },
      }),
    'aiyayi-memory.remember()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'recall',
        description:
          '在自己的全部记忆里查找：核心记忆 + 整棵分类档案树（rules.md / index.md 不在搜索范围——规则每轮整体注入、索引本身就是目录）。用户提到过去的事、某个名字、某次约定，而手头这段核心记忆里没有细节时用它。结果里标了每条记在哪儿（核心 / 分类路径），想看某个分类的完整档案就用 memory_organize 的 read。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: '关键词，几个词即可。' },
            limit: { type: 'integer', description: '最多返回几条，默认 8。' },
          },
          required: ['query'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              total: { type: 'integer' },
              entries: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    where: { type: 'string' },
                    time: { type: 'string' },
                    kind: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['where', 'time', 'kind', 'content'],
                },
              },
            },
            required: ['total', 'entries'],
          },
          render: (_args, value) =>
            TEXT_BLOCK(
              value.entries.length === 0
                ? '全部记忆（核心+分类）里都没有相关的条目。'
                : value.entries
                    .map((entry) => `- (${entry.where}) [${entry.time}] ${entry.kind ? `${entry.kind}｜` : ''}${entry.content}`)
                    .join('\n'),
            ),
        },
        async execute(args) {
          const limit = Number.isSafeInteger(args?.limit) && args.limit > 0 ? Math.min(args.limit, MAX_RECALL) : 8
          const entries = searchAll(args?.query, limit)
          return { total: entries.length, entries }
        },
      }),
    'aiyayi-memory.recall()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'memory_organize',
        description:
          '整理你自己的记忆库——这是你的家务事，顺手做，不用问他。核心记忆攒多了就 tree 看看家底、把过气的 move 到分类档案（move 的 to 写 "rules" 就是升为规则，落成 rules.md 里的普通段落）、彻底没用的 forget 删掉；分类档案变多变杂了就更新 index（重写 index.md 那份"- 路径：这里放什么"的分类行目录，聊到相关话题时你靠它决定调哪个档案；memory.md 里的旧索引段会被顺手迁走）。match 写那条记忆的独特片段；forget 也认条目时间戳（`2026-11-13 12:50`）和行号（line），命中多条时不会猜着删——它会列出候选（档案/行号/时间戳/摘要），你填 which 指定第几条，一次只删一条。tree 和 read 都会报每个档案的健康度（真实字节/行数、解析出的条目数、非条目占比）——占比偏高或字节数远超条目内容时会给 ⚠ 预警，说明这个档案可能被垃圾注入了；rules.md / index.md 不是条目档案，不做这套检查。分类档案真的被灌进整段垃圾时用 clean：path 指那个分类档案（必填，只能指 memories/ 下的 .md），它按 tree 同一套口径保留条目行和标题/引用/分隔线这类结构行、删掉非条目垃圾并折叠多余空行，动刀前先在同目录留 .bak-时间戳 备份；没有可清的就一字不动、也不留备份。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: {
              type: 'string',
              enum: ['tree', 'read', 'move', 'index', 'forget', 'clean', 'schema'],
              description: 'tree=看家底（核心条数+全部分类文件+规则/索引大小）；read=读一个档案的完整内容（path："core"=核心、"rules"/"规则"=规则文件、"index"/"索引"=索引文件，或分类路径）；move=把一条记忆挪窝（match + 可选 path=来源，省略=核心；to=去向，"core"=进核心、"rules"=升为规则，暂不开放 "index"）；index=重写记忆索引 index.md（content，"- 路径：这里放什么"一行一个二级分类，不塞原文内容）；forget=删掉一条记忆（match 可以是内容片段、时间戳或 "时间戳+内容"，也可以直接给 line 行号；match 命中多条时只列候选、用 which 挑，一次只删一条）；clean=清理分类档案里的非条目垃圾（path 必填，只能指 memories/ 下的分类档案；保留条目行与结构行，先在同目录留 .bak-时间戳 备份再改，无变化时不动文件）；schema=给三文件补 `<!-- schema: v2 -->` 头标记（默认三个都补，可选 path 限定 "core"/"rules"/"index" 单个；已有标记自动跳过、幂等，只插这一行不改任何现有字节）。',
            },
            match: {
              type: 'string',
              description:
                'move/forget 用：那条记忆的独特片段。forget 还认时间戳——`2026-11-13 12:50`、只写 `12:50`、带秒的 `2026-11-13T12:50:33` 都能对上（显示层只到分钟，存储层可能有秒/T 分隔/全角）。也可以写「时间戳 + 内容片段」。命中多条不会乱删，会列候选让你用 which 挑。',
            },
            path: {
              type: 'string',
              description:
                'read/move/forget/clean 用：分类路径（1~3 级）；省略或 "core" 代表核心记忆；read 还认 "rules"/"规则"（规则文件）与 "index"/"索引"（索引文件）。forget 省略 path 时会搜核心 + 全部分类档案（绝不碰 rules.md / index.md；只列候选，不猜着删）。clean 的 path 必填且只能指分类档案（core / rules / index 会被拒绝）。schema 用：可选，"core"/"rules"/"index"（或"核心"/"规则"/"索引"）限定只补那一个文件，省略=三个都补。',
            },
            to: { type: 'string', description: 'move 用：去向。分类路径、"core" 表示升入核心记忆、"rules" 表示升为规则（落成普通段落，不再是条目）。暂不开放 "index"。' },
            kind: { type: 'string', enum: KINDS, description: 'move 进核心时用：那条记忆的类别（用户/关系/我/事情），不填算"事情"。' },
            content: { type: 'string', description: 'index 用：新的索引全文，会整体写进 index.md（三文件结构）。一行一个二级分类的列表项，如 "- 用户/口味：饮食偏好、忌口"；不塞条目原文或文件级指向。' },
            which: {
              type: 'integer',
              description: 'forget 用：命中多条时挑第几条（候选序号，从 1 开始）。不传又有多条命中时只列候选、一条不删。',
            },
            line: {
              type: 'integer',
              description: 'forget 用：直接按文件行号定位（1 起，按 path 指向的文件算；不写 path 就是核心记忆）。',
            },
          },
          required: ['action'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              done: { type: 'boolean' },
              detail: { type: 'string' },
              // 以下三个是 1.6.x 新增的「档案健康度可见」，只加不改老的 done/detail。
              // tree 用：
              coreHealth: HEALTH_SCHEMA,
              files: {
                type: 'array',
                description: 'tree 用：每个分类档案的健康度。',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string' },
                    health: HEALTH_SCHEMA,
                  },
                  required: ['path', 'health'],
                },
              },
              // read 用：
              path: { type: 'string' },
              health: HEALTH_SCHEMA,
              // forget 用（1.6.2 精确定位）：新增字段全部在此声明——
              // 宿主对输出也做 schema 校验（additionalProperties:false 多一个键就被拒）。
              matchedBy: {
                type: 'string',
                description: 'forget 用：这次靠什么定位的——substring / timestamp / timestamp+content / line / none。',
              },
              removedFrom: { type: 'string', description: 'forget 用：删掉的那条在哪个档案（core 或分类路径）；没删时为空串。' },
              searched: {
                type: 'array',
                items: { type: 'string' },
                description: 'forget 用：这次找过的文件（core 或分类路径），0 命中时用它说明"在哪些文件找的"。',
              },
              candidates: {
                type: 'array',
                items: FORGET_CANDIDATE_SCHEMA,
                description: 'forget 用：命中多条时一条都没删，候选列在这里；用 which 指定序号再调一次。成功删除后这里是剩下的副本。',
              },
              nearMatches: {
                type: 'array',
                items: FORGET_CANDIDATE_SCHEMA,
                description: 'forget 用：0 命中时按空白/标点/全半角归一化后的近似命中（只提示，没删任何东西）。',
              },
              // clean 用（1.14.0）：清完的客观数字与备份位置，只加不改老的 done/detail。
              beforeBytes: { type: 'integer', description: 'clean 用：清理前文件字节数（UTF-8）。' },
              afterBytes: { type: 'integer', description: 'clean 用：清理后文件字节数（无变化时与 beforeBytes 相同）。' },
              beforeEntries: { type: 'integer', description: 'clean 用：清理前解析出的条目数（与 tree/read 同一套口径）。' },
              afterEntries: { type: 'integer', description: 'clean 用：清理后解析出的条目数（条目行全部保留，正常应与 beforeEntries 相同）。' },
              removedLines: { type: 'integer', description: 'clean 用：删掉的非条目垃圾行数；0 = 没动文件、也没留备份。' },
              backupPath: { type: 'string', description: 'clean 用：同目录时间戳备份（.bak-YYYYMMDD-HHMMSS）的绝对路径；没动文件时为空串。' },
            },
            required: ['done', 'detail'],
          },
          render: (_args, value) => TEXT_BLOCK(value.detail),
        },
        async execute(args) {
          const action = args?.action
          if (action === 'tree') {
            ensureCore()
            // 每个文件只读一次：健康度和条目数都从同一份文本算出来。
            const coreHealth = fileHealth(readRaw(coreFile()), { isCore: true })
            const lines = [`核心（memory.md）：${coreHealth.entries} 条${healthBrief(coreHealth)}`]
            for (const warning of coreHealth.warnings) lines.push(`  ${warning}`)
            // 三文件结构：rules/index 不是条目档案，只报存在与大小，健康度不按条目口径。
            const rulesBytes = Buffer.byteLength(readRaw(rulesFile()), 'utf8')
            const indexBytes = Buffer.byteLength(readRaw(indexFile()), 'utf8')
            lines.push(`规则/索引：rules.md ${rulesBytes} 字节、index.md ${indexBytes} 字节（不是条目档案，不参与条目健康度；read 的 path 认 "rules"/"index"）`)
            const files = listTreeFiles()
            const reports = []
            if (files.length === 0) {
              lines.push('分类档案：还没有。非核心的记一笔就多一个文件。')
            } else {
              lines.push(`分类档案：${files.length} 个文件`)
              for (const category of files) {
                const health = fileHealth(readRaw(join(treeDir(), `${category}.md`)), { isCore: false })
                reports.push({ path: category, health })
                lines.push(`  ${category}：${health.entries} 条${healthBrief(health)}`)
                for (const warning of health.warnings) lines.push(`    ${warning}`)
              }
            }
            lines.push(
              '健康度 = 真实字节/行数 + 解析出的条目数 + 非条目占比（已排除标题、引用、分隔线、索引段这些结构行）；非条目占比超阈值（核心 50%、分类 30%）或字节数远超条目内容，就是有垃圾沉淀。',
            )
            lines.push('核心记忆每轮都注入，宁缺毋滥；过气的用 move 挪到分类、没用的 forget 删。')
            return { done: true, detail: lines.join('\n'), coreHealth, files: reports }
          }
          if (action === 'read') {
            const file = resolveTarget(args?.path)
            const label = String(args?.path ?? 'core')
            const raw = readRaw(file)
            const health = fileHealth(raw, { isCore: isCoreFile(file), nonEntry: isNonEntryFile(file) })
            // 规则/索引不是条目档案：read 直接给全文（没有条目行可解析）。
            if (isNonEntryFile(file)) {
              const name = file === rulesFile() ? '规则文件' : '索引文件'
              const content = raw.trim().length > 0 ? raw.replace(/\s+$/, '') : '（空的或还不存在。）'
              const summary = `健康度：${health.bytes} 字节 / ${health.lines} 行（规则/索引不按条目口径检查）`
              return { done: true, path: label, health, detail: [`${label}（${name}，不是条目档案，全文如下）：`, '', content, '', summary].join('\n') }
            }
            const entries = raw
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => parseLine(line) !== null)
            const summary = [healthSummary(health), ...health.warnings]
            // 空文件/只有垃圾时也要把健康度带出来——"看不见垃圾"正是那次事故的病根。
            if (raw.trim().length === 0) return { done: true, path: label, health, detail: `${label}：空的或还不存在。` }
            if (entries.length === 0) return { done: true, path: label, health, detail: [`${label}：还没有条目。`, ...summary].join('\n') }
            return { done: true, path: label, health, detail: [...entries, '', ...summary].join('\n') }
          }
          if (action === 'move') {
            const from = resolveTarget(args?.path)
            // 三文件边界：规则/索引不是条目档案，不能当 move 的来源
            //（规则文件不该被当条目挪来挪去；索引更不该被动）。
            if (isNonEntryFile(from)) {
              throw new Error('move 的来源不能是 rules.md / index.md——它们不是条目档案，规则文件不该被当条目挪来挪去')
            }
            const toInput = String(args?.to ?? '').trim()
            if (toInput.length === 0) throw new Error('move 需要 to：去向（分类路径、"core" 升入核心，或 "rules" 升为规则）')
            const toFile = resolveTarget(toInput)
            // 暂不开放 move 到 index：索引由 index 动作维护，不收记忆条目。
            if (toFile === indexFile()) {
              throw new Error('暂不开放 move 到 index：索引（index.md）由 index 动作维护，一行一个二级分类，不收记忆条目')
            }
            if (from === toFile) throw new Error('来源和去向是同一个地方')
            const fromLines = readRaw(from).split(/\r?\n/)
            const index = uniqueEntryLine(fromLines, args?.match)
            const line = fromLines[index].trim()
            let moved = line
            if (toFile === coreFile() && parseLine(line)?.kind === '') {
              const kind = KINDS.includes(args?.kind) ? args.kind : '事情'
              moved = `- [${parseLine(line).time}] ${kind}｜${parseLine(line).content}`
            }
            // 顺序：先落到去向，再从来源删（1.14.0 顺手修正的隐患——反过来一旦写去向失败，
            // 这条记忆就两边都没了）。升为规则时 appendRulesParagraph 会做幂等去重。
            let appended = true
            if (toFile === rulesFile()) {
              // 升为规则：规则文件是成段说明文字，落进去的是内容本身，不带时间戳/条目前缀。
              const parsed = parseLine(line)
              moved = parsed !== null ? parsed.content : line
              // 1.14.0：落段前补一个空行，别粘在上一段末尾（渲染成同一段）。
              appended = appendRulesParagraph(toFile, moved)
            } else if (toFile !== coreFile()) {
              // 分类档案：条目不带 `- [时间]` 前缀（李浩 1.14.0 定）。
              // 核心行 `- [时间] 类别｜内容` → 分类档案里只落 `类别｜内容`；
              // 分类行 `- [时间] 内容` → 分类档案里只落 `内容`。
              const parsed = parseLine(line)
              moved = parsed !== null ? parsed.kind + (parsed.kind ? '｜' : '') + parsed.content : line
              appendEntry(toFile, moved)
            } else {
              // 核心：保持 `- [时间] 类别｜内容` 条目格式不变。
              appendEntry(toFile, moved)
            }
            fromLines.splice(index, 1)
            rewriteFile(from, fromLines)
            const core = coreFile()
            const label = (file) =>
              file === core
                ? '核心记忆'
                : file === rulesFile()
                  ? '规则文件 rules.md'
                  : file === indexFile()
                    ? '索引文件 index.md'
                    : `分类档案 ${file.slice(treeDir().length + 1, -3).replace(/\\/g, '/')}`
            const toNote = toFile === rulesFile()
              ? (appended
                ? '已按规则文件的写法落成普通段落（去掉了条目的时间戳/前缀）。'
                : '规则里已经有内容完全相同的段落，没重复追加（来源那条照样删掉了）。')
              : toFile === core ? '核心每轮都注入，确认它配得上这个分量。' : ''
            return { done: true, detail: `挪好了：${label(from)} → ${label(toFile)}。${toNote}` }
          }
          if (action === 'index') {
            const text = String(args?.content ?? '').trim()
            if (text.length === 0) throw new Error('index 需要 content：索引全文，"- 路径：这里放什么"一行一个二级分类')
            setIndex(text)
            return { done: true, detail: `索引更新好了，index.md 现在带着 ${text.split(/\r?\n/).length} 行目录；memory.md 里的旧索引段（如果有）已一次性剥掉。分类档案变了记得回来同步。` }
          }
          if (action === 'forget') {
            const needle = String(args?.match ?? '').trim()
            const which = Number.isSafeInteger(args?.which) ? args.which : null
            const lineNo = Number.isSafeInteger(args?.line) ? args.line : null
            if (needle.length === 0 && lineNo === null) {
              throw new Error('forget 需要 match（条目片段，也可以是时间戳如 "2026-11-13 12:50"），或者 line（文件行号，1 起）')
            }
            if (which !== null && which < 1) throw new Error(`which 是候选序号，从 1 开始，收到 ${which}`)
            const scope = forgetScope(args?.path)
            const searched = scope.items.map((item) => item.label)
            const located = locateEntries(scope, needle, lineNo)
            const hits = located.hits

            // 0 命中：说清在哪些文件找的、有没有近似匹配。一条都不删。
            if (hits.length === 0) {
              const stamp = normalizeStamp(needle) ?? splitStampPrefix(needle)?.stamp ?? null
              const near = nearEntries(scope, needle, stamp)
              const shown = near.slice(0, MAX_FORGET_NEAR)
              const lines = ['没找到能对上的记忆条目，一条都没删。']
              if (located.lineMissed) lines.push(`line=${lineNo} 在 ${scope.items[0].label} 里不是条目行（越界、空行，或者不是 "- [时间] …" 的形状）。`)
              if (needle.length > 0) lines.push(`match：「${needle}」（试过原样子串、时间戳、"时间戳 + 内容"三种对法）`)
              lines.push(
                `找过的地方（${searched.length} 个文件${scope.explicit ? '，path 指定' : '，没给 path 就扫了核心 + 全部分类档案'}）：${searched.join('、')}`,
              )
              if (near.length > 0) {
                lines.push(`近似命中 ${near.length} 条（把空白/标点/全半角归一化后能对上，不是精确命中，所以没删）——你是不是要找这些？`)
                shown.forEach((hit, i) => lines.push(`  ${i + 1}) ${hit.item.label}｜第 ${hit.index + 1} 行｜${entryPreview(hit.parsed)}`))
                if (near.length > shown.length) lines.push(`  …还有 ${near.length - shown.length} 条没列出，把 match 写得更准一点再找。`)
                lines.push('要动手就把 match 换成上面某条里的连续片段（或用 path + line 精确定位），再调一次 forget。')
              } else {
                lines.push('也没有近似匹配。可以复制条目里的连续片段当 match，或用 path 指定档案、line 指定行号。')
              }
              if (which !== null) lines.push(`which=${which} 这次用不上：一条都没命中。`)
              return {
                done: false,
                detail: lines.join('\n'),
                matchedBy: 'none',
                candidates: [],
                nearMatches: shown.map((hit) => entryCandidate(hit.item, hit.index, hit.parsed)),
                searched,
                removedFrom: '',
              }
            }

            // 命中多条（或 which 越界）：列全部候选、一条都不删，给 which/path 出路。
            const chosenIndex = which !== null ? (which <= hits.length ? which - 1 : -1) : hits.length === 1 ? 0 : -1
            if (chosenIndex === -1) {
              const shown = hits.slice(0, MAX_FORGET_CANDIDATES)
              const lines = [
                `match 命中 ${hits.length} 条记忆，一条都没删——forget 一次只删一条，不替你全删。`,
                '候选（挑一条，把 which 填它的序号再调一次 forget；也可以补 path 只在一个档案里找）：',
              ]
              shown.forEach((hit, i) => lines.push(`  ${i + 1}) ${hit.item.label}｜第 ${hit.index + 1} 行｜${entryPreview(hit.parsed)}`))
              if (hits.length > shown.length) lines.push(`  …还有 ${hits.length - shown.length} 条没列出，用 path 缩小范围再找。`)
              lines.push(`命中方式：${FORGET_MODE_LABEL[located.mode]}${which !== null ? `；which=${which} 超出 1~${hits.length} 的范围` : ''}。`)
              lines.push('继续：which=<序号>' + (scope.explicit ? '。' : '，或 path: "core" / 分类路径 只在一个档案里找。'))
              return {
                done: false,
                detail: lines.join('\n'),
                matchedBy: located.mode,
                candidates: shown.map((hit) => entryCandidate(hit.item, hit.index, hit.parsed)),
                nearMatches: [],
                searched,
                removedFrom: '',
              }
            }

            // 定位到唯一一条：只删这一条。
            const chosen = hits[chosenIndex]
            const next = chosen.item.lines.slice()
            next.splice(chosen.index, 1)
            // 去掉尾部空行再回写：rewriteFile 会补一个换行，不然每删一条就多积一行空行。
            while (next.length > 0 && next[next.length - 1] === '') next.pop()
            rewriteFile(chosen.item.file, next)
            const where = chosen.item.label === 'core' ? '核心记忆' : `分类档案 ${chosen.item.label}`
            const removed = entryPreview(chosen.parsed)
            const rest = hits.filter((_hit, i) => i !== chosenIndex)
            const detailLines = [`删掉了（${where} 第 ${chosen.index + 1} 行，${FORGET_MODE_LABEL[located.mode]}）：${removed}`]
            if (rest.length > 0) {
              detailLines.push(
                `注意：同样的 match 还命中 ${rest.length} 条副本，一条都没动——要删就再调一次 forget（现在 which 是 1~${rest.length}），或者先确认是不是该留一份。`,
              )
            }
            return {
              done: true,
              detail: detailLines.join('\n'),
              matchedBy: located.mode,
              candidates: rest.slice(0, MAX_FORGET_CANDIDATES).map((hit) => entryCandidate(hit.item, hit.index, hit.parsed)),
              nearMatches: [],
              searched,
              removedFrom: chosen.item.label,
            }
          }
          if (action === 'clean') {
            // 清理被污染的分类档案里的非条目垃圾行（1.14.0）。
            const targetRaw = String(args?.path ?? '').trim()
            if (targetRaw.length === 0) throw new Error('clean 需要 path：要清理的分类档案路径（如 "事情/经验"，memories/ 下的 .md）')
            const target = resolveTarget(targetRaw)
            // 守卫一：只认分类档案。核心记忆、规则、索引都不是条目档案，拒绝清理。
            if (isCoreFile(target)) {
              throw new Error('clean 不能作用于核心记忆 memory.md——它是每轮注入的核心，不是分类档案；核心只用手动的 move/forget 收拾，拒绝清理')
            }
            if (isNonEntryFile(target)) {
              throw new Error('clean 只能作用于分类档案（memories/ 下的 .md）——rules.md / index.md 不是条目档案，拒绝清理')
            }
            if (!existsSync(target)) throw new Error(`clean 的目标档案不存在：${targetRaw}（clean 只清理已存在的分类档案，不会建新档）`)
            const raw = readRaw(target)
            // 口径与 tree/read 的 fileHealth 完全同源：同一个 classifyLine（空行 / 结构行 /
            // 条目行 / 垃圾）。tree 报"非条目"的那些行，就是这里会删的行。
            const before = fileHealth(raw, { isCore: false })
            const label = `分类档案 ${target.slice(treeDir().length + 1, -3).replace(/\\/g, '/')}`
            const lines = raw.split(/\r?\n/)
            // 末尾换行拆出来的那个空串不是一行内容，别把它当"保留的尾行"。
            if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
            const indexState = { keepRules: true }
            const kept = []
            let removedLines = 0
            for (const line of lines) {
              const kind = classifyLine(line, indexState)
              if (kind === 'garbage') {
                removedLines += 1
                continue
              }
              kept.push(kind === 'empty' ? '' : line)
            }
            // 无变化：一个字都不动，也不留备份（别拿备份文件烦人）。
            if (removedLines === 0) {
              return {
                done: true,
                path: label,
                detail: `${label} 没有可清理的非条目垃圾（内容行全是条目/结构行），文件一字未动、也没留备份。`,
                beforeBytes: before.bytes,
                afterBytes: before.bytes,
                beforeEntries: before.entries,
                afterEntries: before.entries,
                removedLines: 0,
                backupPath: '',
              }
            }
            // 连续空行折叠成一个、首尾不留空行：清过一次的档案再清不会越清越肥。
            const tidy = []
            for (const line of kept) {
              if (line === '' && (tidy.length === 0 || tidy[tidy.length - 1] === '')) continue
              tidy.push(line)
            }
            while (tidy.length > 0 && tidy[tidy.length - 1] === '') tidy.pop()
            // 守卫二：动刀之前先在同目录留一份带时间戳的 .bak。备份失败会抛错，
            // 后面的 rewriteFile 根本走不到 —— 宁可不清，也不能清了没备份。
            const backupPath = backupFile(target)
            rewriteFile(target, tidy)
            const afterRaw = readRaw(target)
            const after = fileHealth(afterRaw, { isCore: false })
            // 诚实说明：`## …` 标题、`> 引用`、索引标记这类行按 tree 同口径算结构行、
            // clean 不动它们。所以"标题形状的注入痕迹"会留下来，tree 仍报注入指纹——
            // 这不是漏清，是口径使然，得让调用方知道（否则会以为 clean 没生效）。
            const leftover = detectInjectedMarkers(afterRaw)
            const leftoverNote = leftover.length > 0
              ? ` 注意：还剩 ${leftover.length} 行命中注入指纹（${[...new Set(leftover.map((hit) => hit.marker))].map((mark) => `「${mark}」`).join('、')}）——它们都是标题/索引标记这类结构行，按 tree 同口径 clean 不动；确认是误注入就手动删掉那一行。`
              : ''
            return {
              done: true,
              path: label,
              detail: `清理完成：${label} 删掉 ${removedLines} 行非条目垃圾（${before.bytes} → ${after.bytes} 字节），条目 ${before.entries} → ${after.entries} 条；原文件已备份到 ${backupPath}。用 tree 复核这个档案的健康度。${leftoverNote}`,
              beforeBytes: before.bytes,
              afterBytes: after.bytes,
              beforeEntries: before.entries,
              afterEntries: after.entries,
              removedLines,
              backupPath,
            }
          }
          if (action === 'schema') {
            // 只给三文件的旧版头补 schema 标记：既不是万能改文件后门，也不写分类档案。
            ensureCore()
            const requested = String(args?.path ?? '').trim()
            const labelOf = { core: 'memory.md', '核心': 'memory.md', rules: 'rules.md', '规则': 'rules.md', index: 'index.md', '索引': 'index.md' }
            const fileOf = { core: coreFile, '核心': coreFile, rules: rulesFile, '规则': rulesFile, index: indexFile, '索引': indexFile }
            let targets
            if (requested === '') {
              targets = [
                { label: 'memory.md', file: coreFile() },
                { label: 'rules.md', file: rulesFile() },
                { label: 'index.md', file: indexFile() },
              ]
            } else {
              if (!Object.prototype.hasOwnProperty.call(fileOf, requested)) {
                throw new Error(`schema 的 path 只认 "core" / "rules" / "index"（或"核心"/"规则"/"索引"）这三个固定文件，不接受任意路径写入；收到 "${requested}"`)
              }
              targets = [{ label: labelOf[requested], file: fileOf[requested]() }]
            }
            const changed = []
            const kept = []
            for (const target of targets) {
              const before = readRaw(target.file)
              const after = insertSchemaMark(before)
              if (after.changed) {
                writeFileSync(target.file, after.text, 'utf8')
                changed.push(target.label)
              } else {
                kept.push(target.label)
              }
            }
            const detail = [
              `schema 标记处理完成：补上 ${changed.length > 0 ? changed.join('、') : '（无）'}；已有标记跳过 ${kept.length > 0 ? kept.join('、') : '（无）'}。`,
              '只插入 `<!-- schema: v2 -->` 这一行，没有改动任何现有字节。',
            ].join('\n')
            return { done: true, detail }
          }
          throw new Error(`未知的 action "${String(action ?? '')}"，可用：tree / read / move / index / forget / clean / schema`)
        },
      }),
    'aiyayi-memory.memory_organize()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'memory_location',
        description:
          '只看不动：我现在的记忆存在哪、怎么定下来的（指路文件 / 环境变量 / 默认）、是不是在系统盘、有几个非系统盘可搬、这个位置健不健康（核心记忆首行、字节数、分类档案数）。用户问"你记忆在哪""能不能换个盘"时先调它；它不建目录、不写文件。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              root: { type: 'string' },
              source: { type: 'string' },
              status: { type: 'string' },
              statusText: { type: 'string' },
              drive: { type: 'string' },
              systemDrive: { type: 'string' },
              onSystemDrive: { type: 'boolean' },
              decided: { type: 'boolean' },
              reachable: { type: 'boolean' },
              pointer: { type: 'string' },
              relocateSupported: { type: 'boolean' },
              codeVersion: { type: 'string' },
              layoutVersion: { type: 'integer' },
              toolboxPathWarnings: {
                type: 'array',
                description: '1.7.1：百宝袋清单（<记忆根>/toolbox.json）里"搬家会悬空"的脚本路径提示（相对路径不在此列，它跟着记忆根走；为空 = 没有风险）。',
                items: { type: 'string' },
              },
              detail: { type: 'string' },
            },
            required: [
              'root',
              'source',
              'status',
              'statusText',
              'onSystemDrive',
              'decided',
              'reachable',
              'pointer',
              'relocateSupported',
              'codeVersion',
              'layoutVersion',
              'toolboxPathWarnings',
              'detail',
            ],
          },
          render: (_args, value) => TEXT_BLOCK(value.detail),
        },
        async execute() {
          const resolved = resolveRoot()
          const status = memoryStatus(resolved)
          const self = codeSelfCheck()
          const health = healthCheck()
          // 这里是用户/她主动发起的**只读查询**：可以多等两三秒，换一个准确的
          // "内置盘/外置盘"标注。每轮注入那条路径不走这个等待（那边用非阻塞版）。
          await externalDriveInfoAwait(resolved.root, 4000)
          const { candidates, excluded, busKnown } = listCandidatePaths()
          const currentDrive = driveOf(resolved.root)
          const pointer = resolved.pointer
          const decided = pointer !== null
          const stay = pointer?.stayOnSystemDrive === true

          // 第一行只讲"现在什么状态"。来源（路径从哪来）和状态（搬没搬过）是两件事，
          // 混在一行正是 2026-11-08 被读成"改造没生效"的根源，所以拆开写。
          const lines = [
            `${status === 'unreachable' ? '⚠ ' : ''}记忆位置：${resolved.root}`,
            `状态：${statusLabel(status)}（status: ${status}）｜来源：${sourceLabel(resolved.source)}（source: ${resolved.source}）`,
          ]
          // 下面这些"事实解释"原本写在人格里让她背（19 行 / 1924 字符），
          // 现在由工具自己说：**确定性的事由代码讲，人格只留"怎么处理"**。
          if (status === 'ok') {
            lines.push('说明：`status: ok` + `source: default` = **还没搬过家，这是正常状态**。指路文件只在你决定搬家（或决定留在原处）之后才会生成——它现在不存在是对的。')
          }
          if (resolved.pointerError) lines.push(`⚠ 指路文件解析失败：${resolved.pointerError}`)
          if (pointer) {
            const bits = []
            if (typeof pointer.relocatedAt === 'string') bits.push(`搬于 ${pointer.relocatedAt}`)
            if (typeof pointer.from === 'string') bits.push(`原址 ${pointer.from}`)
            if (typeof pointer.decidedAt === 'string') bits.push(`决定时间 ${pointer.decidedAt}`)
            lines.push(`指路文件：${pointerFile()}（${stay ? '已决定留在原处' : '已改道'}${bits.length > 0 ? `，${bits.join('，')}` : ''}）`)
          } else {
            lines.push(`指路文件：${pointerFile()}（不存在——还没搬过家，这是正常的）`)
          }
          if (health.ok) {
            lines.push(`体检：核心记忆 ${health.coreBytes} 字节，首行「${health.coreFirstLine}」；分类档案 ${health.treeFiles} 个文件`)
          } else {
            lines.push(`体检：⚠ ${health.reason}`)
          }
          // 1.7.1：百宝袋清单的路径健康度。location.json 的搬家自检只看 coreBytes/coreSha16
          // （memory.md），**不看 toolbox.json**——2026-11-15 就是因为这个，清单里 11 条绝对路径
          // 全悬空却没人拦。这里补一条只读提示（不改清单文件，清单归用户/别的人管）。
          let toolboxPathWarnings = []
          try {
            const audit = auditManifestPaths({ root: resolved.root })
            toolboxPathWarnings = audit.warnings
          } catch (error) {
            toolboxPathWarnings = [`百宝袋清单路径自检跑不了（不影响记忆本身）：${error?.message ?? error}`]
          }
          if (toolboxPathWarnings.length === 0) {
            lines.push('百宝袋脚本路径：没有"搬家会悬空"的绝对路径（相对路径跟着记忆根走，搬家不用改清单）')
          } else {
            lines.push(`百宝袋脚本路径：⚠ ${toolboxPathWarnings.length} 条搬家会悬空（清单文件没动，只是提示）`)
            for (const item of toolboxPathWarnings) lines.push(`  - ${item}`)
          }
          // 正向自检：不让人靠"能扫出几个候选"去反推代码活没活（那太间接，实测会推错）。
          lines.push(`自检：${self.selfReport}。**这个工具能调通、又能列出候选，就说明当前这套代码是生效的；别拿 package.json 的版本号去推。**`)
          lines.push('故障判据：只有 `status: unreachable`（或体检报错 / 记忆工具抛错）才算真故障；`ok`/`migrated`/`stayed` 都是正常。')
          if (!decided && isSystemDrive(resolved.root)) {
            lines.push('建议：记忆还在系统盘，且还没做过决定——可以搬到非系统盘（见下面候选）。')
          }
          lines.push(`盘符 ${currentDrive ?? '（非盘符路径）'}｜系统盘 ${systemDrive() ?? '（非 Windows）'}`)
          lines.push('优先级（固定，别记错）：location.json 指路文件 > 环境变量 AIYAYI_HOME > 内置默认路径；**有指路文件时环境变量不起作用**。')
          if (candidates.length === 0) {
            lines.push(excluded.length > 0 ? '候选：本机没有可用的非系统盘（系统盘不可搬，其余盘都被排除，见下）' : '候选：本机没有可用的非系统盘')
          } else {
            lines.push(`候选（${candidates.length} 个，**已知内置盘优先**，组内按剩余空间排）：`)
            for (const item of candidates) lines.push(`  ${item.path}（剩余 ${item.freeGb} GB，${item.reason}）`)
            if (busKnown === false) {
              lines.push('注意：这次没能确认磁盘类型（探测未完成/不可用），上面顺序只按空间——**搬前务必先 dryRun**，它会明确告诉你是不是可拔出的外置盘。')
            }
            const ext = candidates.filter((item) => item.external === true)
            if (ext.length > 0) {
              const names = ext.map((item) => driveOf(item.path) ?? item.path).join('、')
              lines.push(`⚠ 其中 ${ext.length} 个在**可拔出的外置盘**上（${names}）：拔线或没插时记忆根会不可达、记忆读写全部失败。首选内置盘。`)
            }
          }
          if (excluded.length > 0) {
            lines.push(`排除：${excluded.map((item) => `${item.drive} ${item.reason}`).join('；')}`)
          }
          if (resolved.reachable) {
            lines.push('要搬的话：先用 memory_relocate 传 dryRun: true 看预演计划，确认后再传 confirm: true 真搬。')
            lines.push('不想搬、想让它别再提：memory_relocate 传 stay: true。')
            lines.push('想回退：删掉上面的 location.json 就回到默认路径——但**老目录的备份还在**，两边会分叉，删之前先确认新位置要不要留。')
          } else {
            lines.push('位置不可达（这是真故障）：先把它弄回来（插回那块盘 / 修好坏掉的 location.json），迁移和读写才会恢复。')
          }

          return {
            root: resolved.root,
            source: resolved.source,
            status,
            statusText: statusLabel(status),
            drive: currentDrive ?? '',
            systemDrive: systemDrive() ?? '',
            onSystemDrive: isSystemDrive(resolved.root),
            decided,
            reachable: resolved.reachable,
            pointer: pointerFile(),
            relocateSupported: self.relocateSupported,
            codeVersion: self.codeVersion,
            layoutVersion: self.layoutVersion,
            toolboxPathWarnings,
            detail: lines.join('\n'),
          }
        },
      }),
    'aiyayi-memory.memory_location()',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'memory_relocate',
        description:
          '把整个记忆根搬到别的盘，或把"就留在原处"记下来。搬的办法是：先预检 → 只复制不移动 → 逐文件校验（相对路径集合+字节+SHA256）→ 校验通过才写指路文件 location.json → 原目录内容改名成同级 aiyayi.old-时间戳 备份（不删除）。任何一步失败就中止，源目录原样不动，报错会带阶段名。核心记忆、分类档案、presence.json/state.md/wishes.json/updates.json 整棵一起搬，不会半搬。**先看预演**：传 dryRun: true 只返回"将复制几个文件、多少字节、目标盘够不够、是否跨盘"，不碰磁盘；看过再传 confirm: true 真搬。留在原处用 stay: true（之后不再每轮提示）。搬完要重启 DSH 才完全生效。**优先级固定**：location.json 指路文件 > 环境变量 AIYAYI_HOME > 内置默认路径；有指路文件时环境变量不起作用。**要回退**：删掉 location.json 就回到默认路径，但原目录备份还在，两边会分叉——删之前先确认新位置要不要留。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            target: {
              type: 'string',
              description: '目标目录绝对路径，如 "~/my-memory"（用你自己磁盘上的真实目录）。不能是系统盘、不能是插件包目录、不能已存在且非空、不能是 OneDrive/Dropbox 这类云同步目录。stay: true 时可省略。',
            },
            confirm: {
              type: 'boolean',
              description: '必须显式传 true：这是会改记忆位置、改文件系统的写操作。dryRun: true 时不需要。',
            },
            dryRun: {
              type: 'boolean',
              description: 'true = 只预演：返回将复制的文件数、总字节、目标盘剩余、是否跨盘，不写任何东西。确认无误后再传 confirm: true 真搬。',
            },
            keepSourceAsBackup: {
              type: 'boolean',
              description: '默认 true：把源目录内容改名成同级 <源>.old-时间戳 备份（不删除）。false = 源目录内容原样不动（注意：老目录留着完整副本时，若手滑删掉 location.json 就会回到旧路径，两份开始分叉）。',
            },
            stay: {
              type: 'boolean',
              description: 'true = 不搬家，只把"就留在当前路径"这个决定写进 location.json，之后不再每轮提示迁移。',
            },
          },
          required: ['confirm'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean' },
              dryRun: { type: 'boolean' },
              copies: { type: 'integer' },
              bytes: { type: 'integer' },
              hashMatched: { type: 'boolean' },
              crossDrive: { type: 'boolean' },
              pointer: { type: 'string' },
              effectiveFrom: { type: 'string' },
              needsRestart: { type: 'boolean' },
              sourceBackup: { type: 'string' },
              warnings: { type: 'array', items: { type: 'string' } },
              detail: { type: 'string' },
            },
            required: ['ok', 'pointer', 'effectiveFrom', 'needsRestart', 'detail'],
          },
          render: (_args, value) => TEXT_BLOCK(value.detail),
        },
        async execute(args) {
          const dryRun = args?.dryRun === true
          const stay = args?.stay === true

          // dryRun 不需要 confirm：它不写任何东西，让人（和她自己）先看一眼计划是必要的。
          if (!dryRun && args?.confirm !== true) {
            throw new Error(
              'memory_relocate 是写操作（会改记忆位置、会动文件系统）：确认要对用户说明，并显式传 confirm: true 再调；只想先看计划就传 dryRun: true（不需要 confirm）。',
            )
          }
          if (!stay) {
            const text = String(args?.target ?? '').trim()
            if (text.length === 0) throw new Error('memory_relocate 需要 target（目标目录绝对路径），或者 stay: true 表示留在原处')
          }

          const result = await relocateTo(stay ? '' : args?.target, {
            keepSourceAsBackup: args?.keepSourceAsBackup !== false,
            stay,
            dryRun,
          })

          const lines = []
          if (result.stayed) {
            lines.push(`记下了：记忆就留在 ${result.effectiveFrom}，之后不再每轮提示迁移。`)
            lines.push(`指路文件：${result.pointer}（stayOnSystemDrive: true）`)
            return {
              ok: true,
              dryRun: false,
              copies: 0,
              bytes: 0,
              hashMatched: true,
              crossDrive: false,
              pointer: result.pointer,
              effectiveFrom: result.effectiveFrom,
              needsRestart: false,
              sourceBackup: '',
              detail: lines.join('\n'),
            }
          }
          if (result.dryRun) {
            const sizeMb = (result.bytes / 1024 ** 2).toFixed(2)
            const freeGb = result.freeBytes === null ? '未知' : `${(result.freeBytes / 1024 ** 3).toFixed(1)} GB`
            lines.push(`预演（**没有动任何文件**）：将复制 ${result.copies} 个文件 / ${result.bytes} 字节（${sizeMb} MB）。`)
            lines.push(`源 ${result.from}（${result.fromDrive ?? '非盘符'}）→ 目标 ${result.to}（${result.toDrive ?? '非盘符'}）${result.crossDrive ? '｜**跨盘**' : '｜同盘'}`)
            lines.push(`目标盘剩余：${freeGb}；校验计划：相对路径集合 + 每文件字节 + SHA256。`)
            for (const warning of result.warnings ?? []) lines.push(warning)
            lines.push('确认无误就再调一次，传 confirm: true 真正执行。')
            return {
              ok: true,
              dryRun: true,
              copies: result.copies,
              bytes: result.bytes,
              hashMatched: false,
              crossDrive: result.crossDrive,
              pointer: result.pointer,
              effectiveFrom: result.effectiveFrom,
              needsRestart: false,
              sourceBackup: '',
              warnings: result.warnings ?? [],
              detail: lines.join('\n'),
            }
          }
          lines.push(`搬好了：${result.copies} 个文件 / ${result.bytes} 字节，逐文件校验通过（相对路径集合 + 字节 + SHA256）。`)
          lines.push(`现在从 ${result.effectiveFrom} 读记忆；指路文件 ${result.pointer}。`)
          if (result.crossDrive) lines.push('这次是跨盘搬的：用的是"复制+校验+改名备份"，没有跨盘 move。')
          for (const warning of result.warnings ?? []) lines.push(warning)
          if (result.sourceBackup) lines.push(`原目录内容已改名成备份：${result.sourceBackup}（没删任何东西）。`)
          if (result.note) lines.push(`注意：${result.note}`)
          lines.push('要让新位置完全生效，得重启 DSH（当前进程里还跑着旧的路径常量）。')
          lines.push(`不满意想退回去：删掉 ${result.pointer} 就回到默认路径；但备份 ${result.sourceBackup || '（未做）'} 还在，两边会分叉——删指针前先确认新位置要不要留。`)
          return {
            ok: true,
            dryRun: false,
            copies: result.copies,
            bytes: result.bytes,
            hashMatched: result.hashMatched,
            crossDrive: result.crossDrive,
            pointer: result.pointer,
            effectiveFrom: result.effectiveFrom,
            needsRestart: result.needsRestart,
            sourceBackup: result.sourceBackup,
            warnings: result.warnings ?? [],
            detail: lines.join('\n'),
          }
        },
      }),
    'aiyayi-memory.memory_relocate()',
  )
}

/* 测试出口：只给单测用（硬失败路径要在脚本里验，不能只靠"看代码像是抛错"）。 */
export const __testing = {
  appendCore(content) {
    ensureCore()
    appendEntry(coreFile(), `- [${stamp()}] 事情｜${content}`)
  },
  renderCore,
  fileHealth,
  detectInjectedMarkers,
  readCoreEntries,
  listTreeFiles,
  // 三文件结构（1.10）的迁移与读路径：单测直接验"旧段迁移 / 回退读旧索引"。
  getIndex,
  setIndex,
  // 1.10.0：新分类档案自动登记索引（appendEntry 挂钩内部也走它）。
  registerCategoryInIndex,
}
