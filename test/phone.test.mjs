/**
 * aiyayi-phone 测试（1.7.0）：DSH-Go 手机操控适配。
 *
 * 覆盖四件事：
 *  1. own-tools 前缀放行：mcp__phone__* 算"她自己的工具"（restrict 不会收掉），
 *     别的 mcp 前缀照旧不认。
 *  2. 探针解析：restrict.js 导出的 parseKnownGlobalTools 能吃真实宿主报错原文。
 *  3. pre-step 注入分档：
 *     - 探测到 mcp__phone__* → 首轮注入完整 [手机] 守则，同会话第二轮只给短行；
 *     - step !== 1 不注入（和 presence 的 [时间] 同一条纪律）；
 *     - 确认没有手机工具 + 不住在手机里 → 全程静默（桌面环境零注入）；
 *     - 确认没有手机工具 + 住在手机里（app 判据路径存在）→ 每会话一次"操控不可用"；
 *     - 探针解析失败（报错形状变了）→ 不注入、不炸、下一轮再探。
 *  4. 注入消息形状：role=user、source.kind=aiyayi-phone、form=snapshot
 *     （与 presence 的快照消息同构，宿主按"插件注入"识别而不是用户发言）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-phone-'))

const { isOwnTool, OWN_TOOL_PREFIXES } = await import(libUrl('own-tools.js'))
const { parseKnownGlobalTools } = await import(libUrl('restrict.js'))
const { apply, name, __testing } = await import(libUrl('phone.js'))

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ── 1. own-tools 前缀放行 ── */
check('OWN_TOOL_PREFIXES 含 mcp__phone__', OWN_TOOL_PREFIXES.includes('mcp__phone__'), OWN_TOOL_PREFIXES)
check('mcp__phone__screen 放行', isOwnTool('mcp__phone__screen') === true)
check('mcp__phone__handoff 放行', isOwnTool('mcp__phone__handoff') === true)
check('mcp__phone__android_shell 放行', isOwnTool('mcp__phone__android_shell') === true)
check('别的 mcp 前缀不放行', isOwnTool('mcp__other__x') === false)
check('schedule_ 前缀照旧放行（不回归）', isOwnTool('schedule_create') === true)

/* ── 2. 探针解析（真实宿主报错原文形状，见 dsh-tools lib/index.js L578） ── */
const realShape =
  'tools.restrict() names unknown global tool "__aiyayi_probe_never_matches__"; known global tools: acp_history_search, mcp__phone__screen, mcp__phone__tap, working_directory'
const parsed = parseKnownGlobalTools(new Error(realShape))
check('解析真实报错形状', Array.isArray(parsed) && parsed.length === 4, JSON.stringify(parsed))
check('解析结果含手机工具', parsed?.includes('mcp__phone__screen') === true, JSON.stringify(parsed))
check('别的报错解析为 null（不误判）', parseKnownGlobalTools(new Error('随便什么错')) === null)
check('解析器从 restrict.js 导出（单一真源）', typeof parseKnownGlobalTools === 'function')

/* ── 3. pre-step 注入分档 ── */
const preStepHandlers = []
const makeCtx = () => ({
  effect(fn) {
    fn()
    return () => {}
  },
  on(event, handler) {
    if (event === 'agent/pre-step') preStepHandlers.push(handler)
    return () => {}
  },
})

/** 假 agent：restrict 行为可配。 */
const makeAgent = (sessionId, known) => ({
  id: `agent-${sessionId}`,
  session: { id: sessionId },
  ctx: {
    tools: {
      restrict(filter) {
        const probe = filter?.allow?.[0] ?? ''
        throw new Error(
          `tools.restrict() names unknown global tool "${probe}"; known global tools: ${known.join(', ')}`,
        )
      },
    },
  },
})

const decision = () => ({
  kind: 'proceed',
  messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '帮我看看屏幕上是什么' }], source: { kind: 'user' } }],
})

const run = async (agent, step = 1) => {
  const d = decision()
  const result = await preStepHandlers[0]({ agent, step, signal: new AbortController().signal }, async () => d)
  const last = result.messages.at(-1)
  return {
    result,
    injected: result.messages.length > d.messages.length,
    text: (last?.content ?? []).map((b) => b.text).join('\n'),
    last,
  }
}

check('插件名不变（Loader id 靠它）', name === 'aiyayi-phone', name)
apply(makeCtx())
check('注册了 pre-step 监听器', preStepHandlers.length === 1, preStepHandlers.length)

__testing.resetForTest()
__testing.setAppMarkerPath(join(sandbox, 'no-such-app-marker'))

// 3a. 手机工具在线：首轮完整守则。
const phoneKnown = ['acp_history_search', 'mcp__phone__screen', 'mcp__phone__tap', 'working_directory']
const agentA = makeAgent('s-phone-1', phoneKnown)
const first = await run(agentA)
check('探测到手机工具 → 首轮注入', first.injected === true, first.text)
check('完整守则带 [手机] 头', first.text.startsWith('[手机] '), first.text)
check('守则讲清"住在手机里"', /Android 手机/.test(first.text), first.text)
check('守则含先读屏纪律', /screen/.test(first.text) && /编号只在本屏有效/.test(first.text), first.text)
check('守则含 intent 优先', /intent/.test(first.text), first.text)
check('守则含 handoff 分寸', /handoff/.test(first.text), first.text)
check('守则含敏感不碰清单', /银行/.test(first.text) && /验证码/.test(first.text), first.text)
check('守则含产出目录', /sdcard\/Download\/DSH-Go\//.test(first.text), first.text)
check('守则含不派小伙伴', /不派小伙伴/.test(first.text), first.text)

// 3b. 同会话第二轮：只给短行，不重复长守则。
const second = await run(agentA)
check('第二轮仍注入（短行）', second.injected === true, second.text)
check('第二轮是短行不是长守则', second.text === __testing.renderPhoneLine(), second.text)
check('短行不重复完整守则内容', !/sdcard\/Download/.test(second.text), second.text)

// 3c. step !== 1 不注入。
const step2 = await run(agentA, 2)
check('step 2 不注入', step2.injected === false, step2.text)

// 3d. 探针解析失败：不炸、不注入。
const agentBroken = makeAgent('s-broken', null)
agentBroken.ctx.tools.restrict = () => {
  throw new Error('宿主升级后报错形状变了')
}
const broken = await run(agentBroken)
check('解析失败不炸也不注入', broken.injected === false, broken.text)

// 3e. 桌面（app 判据不存在）+ 无手机工具 → 全程静默。
const agentDesktop = makeAgent('s-desktop', ['working_directory', 'acp_history_search'])
const desktop1 = await run(agentDesktop)
const desktop2 = await run(agentDesktop)
check('桌面无手机工具 → 不注入', desktop1.injected === false && desktop2.injected === false, desktop1.text)

// 3f. 住在手机里但操控不可用 → 每会话一次提示。
__testing.setAppMarkerPath(sandbox) // 沙盘目录真实存在 = "住在手机里"
const agentAbsent = makeAgent('s-absent', ['working_directory'])
const absent1 = await run(agentAbsent)
const absent2 = await run(agentAbsent)
check('手机上但操控不可用 → 首轮提示', absent1.injected === true && /操控不了/.test(absent1.text), absent1.text)
check('提示含去设置开手机操控', /设置/.test(absent1.text) && /手机操控开关/.test(absent1.text), absent1.text)
check('提示不编屏幕内容', /别凭空编/.test(absent1.text), absent1.text)
check('同会话第二次不再提', absent2.injected === false, absent2.text)

// 3g. 别的会话不受记账影响（新会话首轮照常给提示）。
const agentAbsent2 = makeAgent('s-absent-2', ['working_directory'])
const absentB1 = await run(agentAbsent2)
check('新会话照常提示（记账按会话隔离）', absentB1.injected === true, absentB1.text)

/* ── 4. 注入消息形状 ── */
check('注入消息 role=user', first.last?.role === 'user', JSON.stringify(first.last))
check('source.kind=aiyayi-phone（不是 user，不当他发言）', first.last?.source?.kind === 'aiyayi-phone', JSON.stringify(first.last?.source))
check('source.form=snapshot', first.last?.source?.form === 'snapshot', JSON.stringify(first.last?.source))
check('原有消息不被动', first.result.messages.length === decision().messages.length + 1, first.result.messages.length)

process.on('exit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 清理失败不该盖掉真正的测试结果 */
  }
})

console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)
