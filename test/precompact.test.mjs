/**
 * 压缩前沉淀（lib/precompact.js）本地单测（1.5.37）。
 *
 * 覆盖设计方案的验收要点：
 *   1) 判断"值得沉淀"的启发式（任务闭环/关键结论/可量化数据/新经验）——该留的留、该丢的丢；
 *   2) 沉淀动作三件套：写 docs 经验文档 + 写 memories 记忆条目 + 更新 memory.md 索引；
 *   3) 工具注册：apply 走假 ctx 能注册出 precompact_run，schema 合规，名字进 own-tools 白名单；
 *   4) runPrecompact 主入口：显式 content 落盘、弱内容跳过、失败不抛（沉淀失败不阻塞主流程）；
 *   5) 触发A的阈值公式（computeThresholdTokens）复刻 dsh-compaction-basic。
 *
 * 全部在临时沙盘里造记忆根（AIYAYI_HOME 定向 + 指路文件隔离），绝不碰真实记忆目录。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-precompact-'))
const root = join(sandbox, 'root')
mkdirSync(join(root, 'memories'), { recursive: true })
writeFileSync(join(root, 'memory.md'), '# 阿依娅伊的记忆\n\n<!-- 索引 -->\n用户/口味：饮食偏好\n<!-- /索引 -->\n', 'utf8')
process.env.AIYAYI_HOME = root

const pc = await import(libUrl('precompact.js'))
const { __testing: homeTesting } = await import(libUrl('home.js'))
// 指路文件隔离到沙盘，避免真机 location.json 覆盖 AIYAYI_HOME。
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ------------------------------------------------------------------ *
 * 1. 判断"值得沉淀"的启发式
 * ------------------------------------------------------------------ */
const cfg = pc.mergeConfig({})
check('任务闭环+量化数据 → 值得沉淀', pc.judgeSettle('今天把记忆迁移做完了，结论：G盘是外置盘。实测迁移耗时 3.5 秒，校验 12 个文件全过。', cfg).worth === true)
check('关键结论+新经验 → 值得沉淀', pc.judgeSettle('结论：外置USB盘没插时记忆会不可达，坑！经验：探测要后台异步做，别同步卡三秒。', cfg).worth === true)
check('纯寒暄 → 不值得沉淀', pc.judgeSettle('你好呀，今天天气不错，吃了吗？', cfg).worth === false)
check('空串 → 不值得沉淀', pc.judgeSettle('', cfg).worth === false)
check('判断返回 reasons 数组', Array.isArray(pc.judgeSettle('完成了一个任务，用了 2 个 token。', cfg).reasons))

/* ------------------------------------------------------------------ *
 * 2. 阈值公式复刻（dsh-compaction-basic）
 * ------------------------------------------------------------------ */
// 公式：floor(min(contextWindow×thresholdRatio, (contextWindow−reserved)−headroom))
const info = { context: { contextWindow: 131072 }, defaultMaxTokens: 0 }
const fakeSession = { requestHeader: () => ({ config: { maxTokens: 0 } }) }
const th = pc.__testing.computeThresholdTokens({ thresholdRatio: 0.4, headroomTokens: 32768 }, info, fakeSession)
// min(131072×0.4=52428, 131072−32768=98304) = 52428
check('thresholdTokens = min(窗口×ratio, 窗口−headroom)', th === 52428, th)
check('ratio 是提前量，不是阈值本身（0.7×threshold 才是触发线）', Math.floor(0.7 * 52428) === 36699, Math.floor(0.7 * 52428))

/* ------------------------------------------------------------------ *
 * 3. 沉淀动作三件套
 * ------------------------------------------------------------------ */
const settled = pc.settle({ logger: { info: () => {} } }, cfg, {
  trigger: 'B',
  kind: '经验',
  title: '记忆迁移注意外置盘',
  content: '结论：迁移目标要选内置盘。量化：PowerShell 探测实测 3.5 秒。',
})
check('settle 返回 docPath（落 docs/）', typeof settled.docPath === 'string' && settled.docPath.includes('docs'), settled.docPath)
check('经验文档真实存在', existsSync(settled.docPath), settled.docPath)
check('文档内容带标题', readFileSync(settled.docPath, 'utf8').includes('# 记忆迁移注意外置盘'), readFileSync(settled.docPath, 'utf8').split('\n')[0])
check('记忆条目写进 memories/事情/经验.md', settled.memoryFile.endsWith(join('memories', '事情', '经验.md')), settled.memoryFile)
check('记忆条目真实存在且带文档指针', existsSync(settled.memoryFile) && readFileSync(settled.memoryFile, 'utf8').includes('docs/'), readFileSync(settled.memoryFile, 'utf8'))
check('索引已更新', settled.indexUpdated === true)
const core = readFileSync(join(root, 'memory.md'), 'utf8')
check('索引段里加了沉淀指针行', core.includes('→ docs/') && core.includes('记忆迁移注意外置盘'), core)
check('索引段原有行仍在（追加不覆盖）', core.includes('用户/口味：饮食偏好'), core)

/* ------------------------------------------------------------------ *
 * 4. 工具注册 + schema
 * ------------------------------------------------------------------ */
const toolDefs = []
let preStepHandler = null
const makeCtx = () => ({
  effect(fn) {
    fn()
    return () => {}
  },
  on(event, handler) {
    if (event === 'agent/pre-step') preStepHandler = handler
    return () => {}
  },
  tools: {
    register(def) {
      toolDefs.push(def)
      return () => {}
    },
  },
  get: () => undefined,
  logger: { info: () => {}, warn: () => {} },
})
pc.apply(makeCtx(), cfg)
const precompactTool = toolDefs.find((def) => def.name === 'precompact_run')
check('precompact_run 工具已注册', precompactTool !== undefined, toolDefs.map((d) => d.name))
check('precompact_run 注册了 pre-step 监听（时机A）', preStepHandler !== null, preStepHandler)
check('parameters 是 object 且有 properties', precompactTool.parameters?.type === 'object' && !!precompactTool.parameters?.properties, precompactTool.parameters)
check('output.schema 顶层是 object 且 required 都在 properties 里', precompactTool.output?.schema?.type === 'object',
  JSON.stringify(precompactTool.output?.schema))
const { isOwnTool } = await import(libUrl('own-tools.js'))
check('工具名进了 own-tools 白名单', isOwnTool('precompact_run') === true, isOwnTool('precompact_run'))
const requiredOk = (precompactTool.output?.schema?.required ?? []).every((k) => (precompactTool.output?.schema?.properties ?? {})[k] !== undefined)
check('output.schema required 都在 properties', requiredOk, JSON.stringify(precompactTool.output?.schema))

/* ------------------------------------------------------------------ *
 * 5. runPrecompact 主入口：显式落盘 / 弱内容跳过 / 失败不抛
 * ------------------------------------------------------------------ */
const explicit = await pc.runPrecompact({ logger: { info: () => {}, warn: () => {} } }, cfg, {
  trigger: 'B',
  content: '完成了飞书接入。关键结论：chat 归属要按应用解析，否则报 230002。数据：3 个应用 3 条长连接。',
})
check('runPrecompact 显式 content → settled:true', explicit.settled === true, JSON.stringify(explicit))
check('runPrecompact 返回 docPath', typeof explicit.docPath === 'string' && explicit.docPath.length > 0, explicit.docPath)

const weak = await pc.runPrecompact({ logger: { info: () => {}, warn: () => {} } }, cfg, {
  trigger: 'B',
  content: '今天聊了会儿天，没什么特别的事。',
})
check('弱内容 → skipped:true（不值得沉淀）', weak.settled === false && weak.skipped === true, JSON.stringify(weak))

// 失败隔离：非法分类名让 normalizePath 抛错 → runPrecompact 必须 catch 住、返回 error、不抛。
let threw = null
let failed = null
try {
  failed = await pc.runPrecompact({ logger: { info: () => {}, warn: () => {} } }, cfg, {
    trigger: 'B',
    force: true,
    content: '这段一定要落盘',
    memoryPath: '坏/名/字:冒号',
  })
} catch (error) {
  threw = error
}
check('沉淀失败不抛（catch 住）', threw === null, threw)
check('沉淀失败返回 {settled:false, skipped:true, error}', failed !== null && failed.settled === false && failed.skipped === true && typeof failed.error === 'string', JSON.stringify(failed))

/* ------------------------------------------------------------------ *
 * 6. 触发A的 pre-step 处理器：token 接近阈值时不抛、弱会话不触发
 * ------------------------------------------------------------------ */
// 直接调 pre-step 处理器验证：服务缺了（ctx.get 返回 undefined）→ 不抛、正常 next。
const fakeAgent = { session: { id: 's-test', requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
const stepped = await preStepHandler(
  { agent: fakeAgent, signal: new AbortController().signal },
  async () => ({ kind: 'proceed', messages: [{ id: 'm1', role: 'user', content: 'x' }] }),
)
check('缺 tokenMeter 服务时 pre-step 不抛、照常放行 next', stepped?.kind === 'proceed', stepped)

/* ------------------------------------------------------------------ *
 * 7. 1.6.1 批B：collectRecentContent 过滤注入节点（真实对话 vs 系统注入）
 *
 * 确诊 bug：系统注入节点（persona/[时间]/[重逢]/[闹钟]/[状态]/MNEMON…）每步
 * 追加在 surface 尾部，旧代码抓尾部 12 条抓到的全是注入文本，误判 worth 后
 * 把系统提示沉淀成"经验文档"（记忆库里 You-are-an-AI-agent-* 假文档的由来）。
 * ------------------------------------------------------------------ */
// 假 session：entries[i] = { role, text, sourceKind }；deriveEventMessage 返回
// 带 role/content/source 的消息（形状对齐宿主 @deepseek-ai/dsh-session）。
function fakeEntry(role, text, sourceKind = 'user') {
  return { role, text, sourceKind }
}
function makeFakeSession(entries) {
  const events = entries.map((entry, i) => ({ entry, seq: i + 1 }))
  return {
    surface: { nodes: events.map((event) => event.seq) },
    eventAt: (seq) => events[seq - 1] ?? null,
    deriveEventMessage: (event) =>
      event
        ? {
            id: `m-${event.seq}`,
            role: event.entry.role,
            content: [{ type: 'text', text: event.entry.text }],
            source: { kind: event.entry.sourceKind ?? 'user' },
          }
        : null,
  }
}

const injectedOnly = makeFakeSession([
  fakeEntry('user', 'You are an AI agent powered by DeepSeek Harness. 你的任务是陪他说话。结论：3 个应用 3 条长连接。', 'aiyayi-presence'),
  fakeEntry('user', '[时间] 现在 2026-11-13 12:00 · [重逢] 我们又见面了 · [闹钟] 你名下 0 个还挂着', 'aiyayi-presence'),
  fakeEntry('user', 'MNEMON 运行时记忆快照：……（宿主级注入）', 'mnemon'),
])
check('7.1 全是注入节点 → collectRecentContent 返回空串（走 skipped 路径）', pc.collectRecentContent(injectedOnly, 12) === '', pc.collectRecentContent(injectedOnly, 12))

const mixed = makeFakeSession([
  fakeEntry('user', 'You are an AI agent powered by DeepSeek Harness.（persona 注入）', 'aiyayi-presence'),
  fakeEntry('user', '帮我把 26 个文件搬完，结论：G 盘是外置盘。', 'user'),
  fakeEntry('assistant', '搬完了：26 个文件全过校验，实测 3.5 秒。', 'assistant'),
  fakeEntry('user', '[时间] 现在 2026-11-13 12:01', 'aiyayi-presence'),
])
const mixedText = pc.collectRecentContent(mixed, 12)
check('7.2 真实用户文本被保留', mixedText.includes('帮我把 26 个文件搬完'), mixedText)
check('7.2 assistant 输出被保留', mixedText.includes('搬完了：26 个文件全过校验'), mixedText)
check('7.2 persona 注入被过滤', !mixedText.includes('You are an AI agent'), mixedText)
check('7.2 presence [时间] 注入被过滤', !mixedText.includes('[时间]'), mixedText)

// 飞书/微信引导注入走 followup，source.kind 也是 'user'——元数据拦不住的靠特征表拦。
const guideInjected = makeFakeSession([
  fakeEntry('user', '\u2060〔系统提示·非用户发言〕本会话还没接入飞书聊天机器人……回复「不用」即可跳过。', 'user'),
  fakeEntry('user', '今天天气不错。', 'user'),
])
const guideText = pc.collectRecentContent(guideInjected, 12)
check('7.3 引导注入（source.kind=user）被特征表过滤', !guideText.includes('还没接入飞书'), guideText)
check('7.3 真实用户话保留', guideText.includes('今天天气不错'), guideText)

check('7.4 isInjectedNodeText：persona 首行命中', pc.isInjectedNodeText('You are an AI agent powered by DeepSeek Harness.'))
check('7.4 isInjectedNodeText：[状态]/[闹钟·异常] 首行命中', pc.isInjectedNodeText('[状态] 上下文 40% · 窗口 52K') && pc.isInjectedNodeText('[闹钟·异常] 有 1 个孤儿目标'))
check('7.4 isInjectedNodeText：MNEMON 关键词命中', pc.isInjectedNodeText('这是 MNEMON 快照的内容'))
check('7.4 isInjectedNodeText：真实对话不误伤', !pc.isInjectedNodeText('帮我把 26 个文件搬完，结论：G 盘是外置盘。'))

check('7.5 isRealConversationMessage：assistant 全收', pc.isRealConversationMessage({ role: 'assistant', content: [{ type: 'text', text: 'x' }] }))
check('7.5 isRealConversationMessage：直发用户消息（kind=user）收', pc.isRealConversationMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] }))
check('7.5 isRealConversationMessage：注入快照（kind=aiyayi-presence）不收', !pc.isRealConversationMessage({ role: 'user', source: { kind: 'aiyayi-presence', form: 'snapshot' }, content: [{ type: 'text', text: 'x' }] }))
check('7.5 isRealConversationMessage：压缩检查点（kind=compact-checkpoint）不收', !pc.isRealConversationMessage({ role: 'user', source: { kind: 'compact-checkpoint' }, content: [{ type: 'text', text: 'x' }] }))
check('7.5 isRealConversationMessage：system/tool 消息不收', !pc.isRealConversationMessage({ role: 'system', content: [{ type: 'text', text: 'x' }] }) && !pc.isRealConversationMessage({ role: 'tool', content: [{ type: 'text', text: 'x' }] }))
check('7.5 isRealConversationMessage：缺 source 元数据不收（宁漏勿垃圾）', !pc.isRealConversationMessage({ role: 'user', content: [{ type: 'text', text: 'x' }] }))

// 窗口语义：count 只看尾部 N 条，窗口外/窗口内照旧、注入照滤。
const windowed = makeFakeSession([
  fakeEntry('user', '最早的真实消息：搬 44 个文件，结论：内置盘优先。', 'user'),
  fakeEntry('user', '[时间] 现在 2026-11-13 12:02', 'aiyayi-presence'),
])
check('7.6 count=1 尾部只有注入 → 空串', pc.collectRecentContent(windowed, 1) === '', pc.collectRecentContent(windowed, 1))
check('7.6 count=2 放宽窗口 → 真实消息回到候选', pc.collectRecentContent(windowed, 2).includes('搬 44 个文件'), pc.collectRecentContent(windowed, 2))

/* ------------------------------------------------------------------ *
 * 8. 1.6.1 批B：时机A前置门——会话里没有真实用户消息就不做沉淀检查
 * ------------------------------------------------------------------ */
const docsDir = join(root, 'docs')
const docsCount = () => {
  try {
    return readdirSync(docsDir).filter((f) => f.endsWith('.md')).length
  } catch {
    return 0
  }
}

// 带 tokenMeter/llm 的 rich ctx：让时机A检查真正走到阈值判定。
let preStepHandlerA = null
const richCtx = {
  effect(fn) {
    fn()
    return () => {}
  },
  on(event, handler) {
    if (event === 'agent/pre-step') preStepHandlerA = handler
    return () => {}
  },
  tools: {
    register() {
      return () => {}
    },
  },
  get(name) {
    if (name === 'tokenMeter') return { measure: (session) => ({ totalTokens: session.__tokens ?? 40000 }) }
    if (name === 'llm') return { resolveModelInfo: async () => ({ context: { contextWindow: 131072 }, defaultMaxTokens: 0 }) }
    return undefined
  },
  logger: { info: () => {}, warn: () => {} },
}
pc.apply(richCtx, cfg)
check('8.0 rich ctx 注册出时机A pre-step 处理器', preStepHandlerA !== null)

const stepSession = (entries, tokens = 40000) => {
  const session = makeFakeSession(entries)
  session.requestHeader = () => ({ config: { provider: 'p', model: 'm', maxTokens: 0 } })
  session.__tokens = tokens
  return session
}
const next = async () => ({ kind: 'proceed', messages: [] })
const runStep = async (session) => preStepHandlerA({ agent: { session }, signal: new AbortController().signal }, next)

check('8.1 hasRealUserMessage：只有注入 → false', pc.hasRealUserMessage(injectedOnly) === false)
check('8.1 hasRealUserMessage：有真实用户消息 → true', pc.hasRealUserMessage(mixed) === true)
check('8.1 hasRealUserMessage：只有 assistant（无用户消息）→ false', pc.hasRealUserMessage(makeFakeSession([fakeEntry('assistant', '完成了 11 个文件。', 'assistant')])) === false)

// 8.2：开场会话（surface 只有注入节点）→ 前置门直接 return，绝不沉淀。
// persona 注入文本本身能骗过 judgeSettle（含"结论"+量化数据），没有门就会写垃圾文档。
const docsBefore8 = docsCount()
await runStep(stepSession([fakeEntry('user', 'You are an AI agent powered by DeepSeek Harness. 结论：12 个盘全部体检完毕。', 'aiyayi-presence')]))
check('8.2 开场（无真实用户消息）不触发沉淀（无新文档）', docsCount() === docsBefore8, `${docsBefore8} → ${docsCount()}`)

// 8.3：只有 assistant 消息、无真实用户消息——collect 抓得到 assistant 文本、
// judgeSettle 也会判 worth，但前置门（认"用户消息"）必须拦住。
await runStep(stepSession([fakeEntry('assistant', '任务闭环：完成了 11 个文件的迁移，结论：内置盘优先，实测 2.2 秒。', 'assistant')]))
check('8.3 只有 assistant、无真实用户消息 → 不触发沉淀', docsCount() === docsBefore8, `${docsBefore8} → ${docsCount()}`)

/* ------------------------------------------------------------------ *
 * 9. 1.6.1 批B：名额机制——verdict 不 worth 不消耗名额；worth 正常沉淀
 * ------------------------------------------------------------------ */
// 9.1：同一会话（同一对象进 WeakSet 判据）三步走。
const quotaEntries = [fakeEntry('user', '今天聊了会儿天，没什么特别的事。', 'user')]
const quotaSession = stepSession(quotaEntries)
const docsBefore9 = docsCount()
await runStep(quotaSession) // 第一步：verdict 不 worth → skipped，且不占名额。
check('9.1a 弱内容第一步不沉淀', docsCount() === docsBefore9, `${docsBefore9} → ${docsCount()}`)
// 第二步：同一会话换成 worth 内容——旧代码这里已被第一步烧掉名额（先 add 后跑），
// 修完必须还能正常沉淀。
quotaEntries[0].text = '任务闭环：迁移完成，结论：内置盘优先，实测 3.5 秒，26 个文件全过。'
await runStep(quotaSession)
check('9.1b 名额没被第一步打水漂：同会话第二次跑沉淀成功', docsCount() === docsBefore9 + 1, `${docsBefore9} → ${docsCount()}`)
// 第三步：名额已被第二步（沉淀成功）占用，再跑不重复写。
quotaEntries[0].text = '任务闭环：又一批 66 个文件完成迁移，实测 8.8 秒，结论：无损坏。'
await runStep(quotaSession)
check('9.1c 名额已占：第三步不再重复沉淀', docsCount() === docsBefore9 + 1, `${docsBefore9} → ${docsCount()}`)

// 9.2：有真实对话且 worth → 正常沉淀（docs 文档 + memories 条目都落盘）。
const freshEntries = [
  fakeEntry('user', '帮我把 88 个文件搬完，结论：C 盘是内置盘。', 'user'),
  fakeEntry('assistant', '搬完了：88 个文件全过校验，实测 5.5 秒。', 'assistant'),
]
await runStep(stepSession(freshEntries))
check('9.2 有真实对话且 worth → 正常沉淀出文档', docsCount() === docsBefore9 + 2, `${docsBefore9} → ${docsCount()}`)
const memoryFile9 = join(root, 'memories', '事情', '经验.md')
check('9.2 记忆条目同步落盘（带 88 个文件的指针行）', existsSync(memoryFile9) && readFileSync(memoryFile9, 'utf8').includes('88 个文件'), memoryFile9)

/* ------------------------------------------------------------------ *
 * 10. 坑 #82：precompact_run 的 output.schema 必须与三路实际返回值一致
 *
 * 宿主在两处把关（源码位置：app.asar → @deepseek-ai/dsh-tools）：
 *   a) 注册期 `ToolsService.register` 调 `assertSupportedJsonSchema(output.schema)`
 *      → type 只收单个字符串（坑 #77：type 数组被拒）；required 的每个名字必须在
 *        properties 里；items 只能挂在 array 上。
 *   b) 执行期 `createSuccessResult` 调
 *      `validateJsonSchemaValue(output.schema, snapshotToolValue(结果), "value")`
 *      → required 里每个键必须存在（Object.hasOwn）且不为 undefined，否则
 *        `missing required property "value.xxx"`；additionalProperties:false 时
 *        返回对象多出任何未声明键 → `"value.xxx" is not a declared property`。
 *      注意：**声明了但没返回** 的键不参与校验（只有 required 缺了才报错），
 *      所以 schema 里 `reason` 声明了、三路都不返回是合法的。
 *
 * 修复前的真实形态：
 *   分支A 多 verdict/trigger；分支B 多 verdict/trigger/memoryFile/filename 且缺
 *   required 的 skipped；分支C 多 trigger —— 三路都会被宿主拒掉。
 * ------------------------------------------------------------------ */
const HOST_SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
const isPlainRecord10 = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * 复刻宿主 validateJsonSchemaValue（覆盖本包 output.schema 用到的子集：
 * type 单字符串 / properties / required / additionalProperties / items / enum / const）。
 * 规则逐条对齐 asar 里的 checkValue / checkScalarValue。
 */
function hostValidateValue(schema, value, path = 'value') {
  const out = []
  const type = schema?.type
  if (type === undefined) return out
  if (typeof type !== 'string' || !HOST_SCHEMA_TYPES.includes(type)) {
    out.push(Array.isArray(type)
      ? `${path}.type must be a single type string (type arrays are not supported)`
      : `${path}.type must be one of ${HOST_SCHEMA_TYPES.join('/')}`)
    return out
  }
  if (type === 'object') {
    if (!isPlainRecord10(value)) return [`"${path}" must be an object`]
    for (const key of schema.required ?? []) {
      // 宿主判据：Object.hasOwn 且 !== undefined，两者缺一都算 missing。
      if (!Object.hasOwn(value, key) || value[key] === undefined) {
        out.push(`missing required property "${path === '' ? key : `${path}.${key}`}"`)
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      // 声明了但没返回 → 跳过（不报错、也不校验类型）。
      if (!Object.hasOwn(value, key) || value[key] === undefined) continue
      out.push(...hostValidateValue(child, value[key], path === '' ? key : `${path}.${key}`))
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) {
          out.push(`"${path === '' ? key : `${path}.${key}`}" is not a declared property (additionalProperties: false)`)
        }
      }
    }
    return out
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`"${path}" must be an array`]
    if (schema.items) value.forEach((entry, i) => out.push(...hostValidateValue(schema.items, entry, `${path}[${i}]`)))
    return out
  }
  if (type === 'string') return typeof value === 'string' ? [] : [`"${path}" must be a string`]
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [`"${path}" must be a boolean`]
  if (type === 'integer') {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) ? [] : [`"${path}" must be an integer`]
  }
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? [] : [`"${path}" must be a finite JSON number`]
  if (type === 'null') return value === null ? [] : [`"${path}" must be null`]
  return out
}

/** 复刻宿主注册期 assertSupportedJsonSchema：关键字子集 + type 单字符串 + required 在 properties。 */
const HOST_CONSTRAINT_KEYS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const'])
const HOST_ANNOTATION_KEYS = new Set(['description', 'title', 'default', 'examples'])
function hostAssertSupportedSchema(schema, path = 'schema', out = []) {
  if (!isPlainRecord10(schema)) {
    out.push(`${path} must be a schema object`)
    return out
  }
  for (const key of Object.keys(schema)) {
    if (!HOST_CONSTRAINT_KEYS.has(key) && !HOST_ANNOTATION_KEYS.has(key)) {
      out.push(`${path}.${key} is not a supported keyword`)
    }
  }
  if (Object.hasOwn(schema, 'oneOf')) {
    for (const key of ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']) {
      if (Object.hasOwn(schema, key)) out.push(`${path}.${key} is not supported beside oneOf`)
    }
    const branches = schema.oneOf
    if (!Array.isArray(branches) || branches.length < 2) out.push(`${path}.oneOf must be an array of at least two schemas`)
    else branches.forEach((branch, i) => hostAssertSupportedSchema(branch, `${path}.oneOf[${i}]`, out))
    return out
  }
  if (!Object.hasOwn(schema, 'type')) {
    for (const key of ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const']) {
      if (Object.hasOwn(schema, key)) out.push(`${path}.${key} requires type or oneOf`)
    }
    return out
  }
  const type = schema.type
  if (typeof type !== 'string' || !HOST_SCHEMA_TYPES.includes(type)) {
    out.push(Array.isArray(type)
      ? `${path}.type must be a single type string (type arrays are not supported)`
      : `${path}.type must be one of ${HOST_SCHEMA_TYPES.join('/')}`)
    return out
  }
  // 关键字只能挂在对应类型上。
  const allowedOn = { properties: ['object'], required: ['object'], additionalProperties: ['object'], items: ['array'], enum: ['string', 'number', 'integer', 'boolean', 'null'], const: ['string', 'number', 'integer', 'boolean', 'null'] }
  for (const [key, types] of Object.entries(allowedOn)) {
    if (Object.hasOwn(schema, key) && !types.includes(type)) out.push(`${path}.${key} is not supported on type "${type}"`)
  }
  if (type === 'object') {
    const properties = Object.hasOwn(schema, 'properties') ? schema.properties : undefined
    if (Object.hasOwn(schema, 'properties')) {
      if (!isPlainRecord10(properties)) out.push(`${path}.properties must be an object of schemas`)
      else for (const [key, child] of Object.entries(properties)) hostAssertSupportedSchema(child, `${path}.properties.${key}`, out)
    }
    if (Object.hasOwn(schema, 'required')) {
      const required = schema.required
      if (!Array.isArray(required) || required.some((k) => typeof k !== 'string')) out.push(`${path}.required must be an array of strings`)
      else {
        const declared = isPlainRecord10(properties) ? properties : {}
        for (const key of required) if (!Object.hasOwn(declared, key)) out.push(`${path}.required names "${key}" which is not in properties`)
      }
    }
    if (Object.hasOwn(schema, 'additionalProperties') && typeof schema.additionalProperties !== 'boolean') {
      out.push(`${path}.additionalProperties must be a boolean`)
    }
  }
  if (type === 'array' && Object.hasOwn(schema, 'items')) hostAssertSupportedSchema(schema.items, `${path}.items`, out)
  return out
}

const outSchema = precompactTool.output?.schema

// 10.1 守门员自检：必须先能抓出今天这三种真实失败形态（防校验器失明）。
const beforeFixA = { settled: false, skipped: true, verdict: { worth: false, score: 0, reasons: [] }, trigger: 'manual' }
check('10.1a 守门员能抓出「多出未声明键」（旧分支A 的 verdict/trigger）',
  hostValidateValue({ type: 'object', additionalProperties: false, properties: { settled: { type: 'boolean' }, skipped: { type: 'boolean' } }, required: ['settled', 'skipped'] }, beforeFixA)
    .some((v) => v.includes('"value.trigger" is not a declared property (additionalProperties: false)')),
  JSON.stringify(hostValidateValue({ type: 'object', additionalProperties: false, properties: { settled: { type: 'boolean' }, skipped: { type: 'boolean' } }, required: ['settled', 'skipped'] }, beforeFixA)))
const beforeFixB = { settled: true, docPath: 'x', memoryFile: 'm', memoryLocation: 'l', indexUpdated: true, title: 't', filename: 'f', verdict: { worth: true, score: 3, reasons: ['r'] }, trigger: 'B' }
check('10.1b 守门员能抓出「缺 required」（旧分支B 缺 skipped）',
  hostValidateValue({ type: 'object', additionalProperties: false, properties: { settled: { type: 'boolean' }, skipped: { type: 'boolean' } }, required: ['settled', 'skipped'] }, beforeFixB)
    .some((v) => v === 'missing required property "value.skipped"'),
  JSON.stringify(hostValidateValue({ type: 'object', additionalProperties: false, properties: { settled: { type: 'boolean' }, skipped: { type: 'boolean' } }, required: ['settled', 'skipped'] }, beforeFixB)))
check('10.1c 守门员能抓出 type 数组（坑 #77：宿主只收单字符串）',
  hostAssertSupportedSchema({ type: ['string', 'null'] }).some((v) => v.includes('type arrays are not supported')),
  JSON.stringify(hostAssertSupportedSchema({ type: ['string', 'null'] })))

// 10.2 schema 本身要在注册期合法（宿主 assertSupportedJsonSchema 的判据）。
const regViolations = hostAssertSupportedSchema(outSchema)
check('10.2 output.schema 过宿主注册期校验（关键字子集/单 type/required⊆properties）', regViolations.length === 0, regViolations.join('；'))

// 10.3 schema 必须覆盖三分支实际返回的全部键（否则 additionalProperties:false 必炸）。
const declaredKeys = Object.keys(outSchema?.properties ?? {})
const branchKeys = {
  // 分支A（L469）：{ settled, skipped, verdict, trigger }
  A: ['settled', 'skipped', 'verdict', 'trigger'],
  // 分支B（L480）：settle() 的 6 个 + settled/skipped/verdict/trigger
  B: ['settled', 'skipped', 'docPath', 'memoryFile', 'memoryLocation', 'indexUpdated', 'title', 'filename', 'verdict', 'trigger'],
  // 分支C（L487）：{ settled, skipped, error, trigger }
  C: ['settled', 'skipped', 'error', 'trigger'],
}
for (const [branch, keys] of Object.entries(branchKeys)) {
  const missing = keys.filter((k) => !declaredKeys.includes(k))
  check(`10.3 分支${branch} 的返回键全部在 schema.properties 里`, missing.length === 0, missing)
}
check('10.3 verdict 子 schema 覆盖 worth/score/reasons', ['worth', 'score', 'reasons'].every((k) => Object.hasOwn(outSchema?.properties?.verdict?.properties ?? {}, k)),
  Object.keys(outSchema?.properties?.verdict?.properties ?? {}))
check('10.3 required 仍是 settled/skipped（三路都返回这两键）', JSON.stringify(outSchema?.required) === JSON.stringify(['settled', 'skipped']), outSchema?.required)

// 10.4 真实调用注册出来的 execute，三路返回值逐字段过宿主校验。
const checkHostOutput = (label, value) => {
  const violations = hostValidateValue(outSchema, value)
  check(label, violations.length === 0, `${violations.join('；')}\n        实际输出: ${JSON.stringify(value)}`)
  return value
}
const execCtxLogger = { info: () => {}, warn: () => {} }

// 分支A：弱内容 → skipped:true，带 verdict + trigger。
const outA = await precompactTool.execute({ content: '今天聊了会儿天，没什么特别的事。' })
check('10.4 分支A 形态：settled:false + skipped:true + verdict + trigger',
  outA.settled === false && outA.skipped === true && typeof outA.trigger === 'string' && isPlainRecord10(outA.verdict),
  JSON.stringify(outA))
checkHostOutput('10.4 分支A 返回值过宿主 output 校验', outA)

// 分支B：值得沉淀 → settled:true，且必须显式带 skipped:false（required）。
const outB = await precompactTool.execute({
  content: '完成了 precompact schema 修复。关键结论：schema 必须与返回值一一对应。数据：3 个分支 4 个字段。',
})
check('10.4 分支B 形态：settled:true + skipped:false（required 补齐）',
  outB.settled === true && outB.skipped === false && outB.docPath && outB.memoryFile && outB.filename, JSON.stringify(outB))
checkHostOutput('10.4 分支B 返回值过宿主 output 校验（含 memoryFile/filename/verdict/trigger）', outB)

// 分支C：沉淀中途抛错 → error 兜底，带 trigger。
const outC = await precompactTool.execute({
  force: true,
  content: '这段一定要落盘',
  memoryPath: '坏/名/字:冒号',
})
check('10.4 分支C 形态：settled:false + skipped:true + error + trigger',
  outC.settled === false && outC.skipped === true && typeof outC.error === 'string' && typeof outC.trigger === 'string',
  JSON.stringify(outC))
checkHostOutput('10.4 分支C 返回值过宿主 output 校验', outC)

// 10.5 verdict 子对象逐字段校验（worth:boolean / score:number / reasons:string[]）。
const verdictSub = outSchema?.properties?.verdict
check('10.5 verdict 子对象 required = worth/score/reasons',
  JSON.stringify(verdictSub?.required) === JSON.stringify(['worth', 'score', 'reasons']), verdictSub?.required)
check('10.5 合法 verdict 过校验',
  hostValidateValue(verdictSub, { worth: true, score: 3, reasons: ['有实质内容', '像有任务闭环'] }, 'value.verdict').length === 0,
  JSON.stringify(hostValidateValue(verdictSub, { worth: true, score: 3, reasons: ['x'] }, 'value.verdict')))
check('10.5 score 非数字被拒',
  hostValidateValue(verdictSub, { worth: true, score: '3', reasons: [] }, 'value.verdict')
    .some((v) => v === '"value.verdict.score" must be a finite JSON number'),
  JSON.stringify(hostValidateValue(verdictSub, { worth: true, score: '3', reasons: [] }, 'value.verdict')))
check('10.5 reasons 非数组被拒',
  hostValidateValue(verdictSub, { worth: true, score: 1, reasons: 'x' }, 'value.verdict')
    .some((v) => v === '"value.verdict.reasons" must be an array'),
  JSON.stringify(hostValidateValue(verdictSub, { worth: true, score: 1, reasons: 'x' }, 'value.verdict')))
check('10.5 verdict 多出未声明键被拒',
  hostValidateValue(verdictSub, { worth: true, score: 1, reasons: [], extra: 1 }, 'value.verdict')
    .some((v) => v.includes('"value.verdict.extra" is not a declared property')),
  JSON.stringify(hostValidateValue(verdictSub, { worth: true, score: 1, reasons: [], extra: 1 }, 'value.verdict')))

// 10.6 reason 字段结论：声明了但三路都不返回 —— 宿主只校验 required 与未声明键，
// "声明了但没返回"不违例，故保持现状（不往返回值里硬塞 reason）。
check('10.6 reason 声明在 properties 里但不在 required（宿主允许不返回）',
  Object.hasOwn(outSchema?.properties ?? {}, 'reason') && !(outSchema?.required ?? []).includes('reason'),
  { declared: Object.hasOwn(outSchema?.properties ?? {}, 'reason'), required: outSchema?.required })
check('10.6 缺 reason 的返回值不产生 missing required 报错',
  hostValidateValue(outSchema, { settled: false, skipped: true, verdict: { worth: false, score: 0, reasons: ['无候选材料'] }, trigger: 'manual' }).length === 0,
  JSON.stringify(hostValidateValue(outSchema, { settled: false, skipped: true, verdict: { worth: false, score: 0, reasons: ['无候选材料'] }, trigger: 'manual' }).filter((v) => v.includes('reason'))))

// 收尾清理
process.on('exit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 清理失败不该盖掉真正的测试结果 */
  }
})
rmSync(sandbox, { recursive: true, force: true })

console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)
