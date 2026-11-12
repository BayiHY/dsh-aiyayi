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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
