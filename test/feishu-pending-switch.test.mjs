/**
 * 1.6.1 批B 飞书待接入目标路由 —— 纯函数 + 静态接线单测。
 *
 * 覆盖两项改动（照 feishu-auto-bind.test.mjs 模式：不 import lib/feishu.js，
 * 避开 SDK 桩包的 node_modules 雷区，用纯函数行为 + feishu.js 源码接线核对）：
 *   (A) decidePendingBindUsable —— 未绑定 chat pending 优先档的判据
 *       （pending 存在 / 未过 TTL / 非子智能体 / 目标存活）；
 *   (B) decideSwitchAsk —— 已绑定 chat 切换提示的四类行为：
 *       pending 有效且 ≠ 当前目标 → 提示；TTL 过期 / 目标=当前会话 /
 *       子智能体 / 目标不存活 → 不提示；
 *   (C) 切换提示写下的候选列表真的能被既有 parseChoiceReply 消费
 *       （回「2」切到待接入会话、回「1」留在当前会话，零新路由状态）；
 *   (D) 新文案与 KNOWN_GUIDE_MARKERS 特征串（防压缩件/引用自我维持）；
 *   (E) feishu.js 接线核对：先投递后提示、提示后立即 clearPendingBind、
 *       未绑定分支 pending 优先档在 decideUnboundChatRouting 之前、
 *       三档兜底仍在、TTL 常量收编到 feishu-logic.js。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildPendingRebindNotice,
  buildSwitchPendingBindPrompt,
  decidePendingBindUsable,
  decideSwitchAsk,
  decideUnboundChatRouting,
  isInjectedGuideText,
  KNOWN_GUIDE_MARKERS,
  normalizeSessionCandidates,
  parseChoiceReply,
  PENDING_BIND_TTL_MS,
  readPendingChoice,
  writePendingChoice,
} from '../lib/feishu-logic.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/* ═══════════════════════════════════════════════════════════════
 * (A) decidePendingBindUsable：未绑定 chat pending 优先档的判据
 * ═══════════════════════════════════════════════════════════════ */
const NOW = 1_800_000_000
const fresh = () => ({ sessionId: 'sess-x', createdAt: NOW - 1000 })

// A1：无 pending → no-pending（不提示、不优先接入）。
assert.deepEqual(decidePendingBindUsable(null, { now: NOW }), { usable: false, reason: 'no-pending', sessionId: null }, 'A1：null → no-pending')
assert.equal(decidePendingBindUsable({}, { now: NOW }).reason, 'no-pending', 'A1：空对象 → no-pending')

// A2：pending 存在、未过 TTL、目标存活、非子智能体 → usable。
assert.deepEqual(decidePendingBindUsable(fresh(), { now: NOW }), { usable: true, reason: 'ok', sessionId: 'sess-x' }, 'A2：全部判据满足 → ok')

// A2b：TTL 边界——恰好等于 TTL 仍有效（对齐先例 Date.now()-createdAt > TTL 才算过期）。
assert.equal(
  decidePendingBindUsable({ sessionId: 'sess-x', createdAt: NOW - PENDING_BIND_TTL_MS }, { now: NOW }).usable,
  true,
  'A2b：恰好 ≤ TTL 仍有效',
)

// A3：TTL 过期 → expired。
assert.equal(
  decidePendingBindUsable({ sessionId: 'sess-x', createdAt: NOW - PENDING_BIND_TTL_MS - 1 }, { now: NOW }).reason,
  'expired',
  'A3：超过 TTL → expired',
)

// A4：目标是子智能体 → subagent（对齐 L416-424 先例：真人 chat 不绑给 worker）。
assert.equal(decidePendingBindUsable(fresh(), { now: NOW, isSubagent: () => true }).reason, 'subagent', 'A4：子智能体 → subagent')

// A5：目标会话不存活 → not-alive。
assert.equal(decidePendingBindUsable(fresh(), { now: NOW, alive: () => false }).reason, 'not-alive', 'A5：目标死了 → not-alive')

// A6：判据未提供时视为满足（alive 缺省=存活）。
assert.equal(decidePendingBindUsable(fresh(), { now: NOW }).usable, true, 'A6：alive 未提供 → 视为存活')

/* ═══════════════════════════════════════════════════════════════
 * (B) decideSwitchAsk：已绑定 chat 切换提示的四类行为
 * ═══════════════════════════════════════════════════════════════ */

// B1：pending 有效且 ≠ 当前 route 目标 → 提示（核心缺口场景）。
assert.deepEqual(
  decideSwitchAsk({ sessionId: 'sess-x', createdAt: NOW - 1000 }, 'sess-y', { now: NOW }),
  { ask: true, reason: 'ok', pendingSessionId: 'sess-x' },
  'B1：pending 有效且 ≠ 当前目标 → ask',
)

// B2：TTL 过期 → 不提示。
assert.equal(decideSwitchAsk({ sessionId: 'sess-x', createdAt: NOW - PENDING_BIND_TTL_MS - 1 }, 'sess-y', { now: NOW }).ask, false, 'B2：TTL 过期 → 不提示')
assert.equal(decideSwitchAsk({ sessionId: 'sess-x', createdAt: NOW - PENDING_BIND_TTL_MS - 1 }, 'sess-y', { now: NOW }).reason, 'expired', 'B2：reason=expired')

// B3：pending 目标 = 当前会话（chat 本来就接在 X 上）→ 不提示。
assert.deepEqual(
  decideSwitchAsk({ sessionId: 'sess-x', createdAt: NOW - 1000 }, 'sess-x', { now: NOW }),
  { ask: false, reason: 'same-target', pendingSessionId: 'sess-x' },
  'B3：目标=当前会话 → 不提示',
)

// B4：pending 目标是子智能体 → 不提示。
assert.equal(decideSwitchAsk({ sessionId: 'sess-x', createdAt: NOW - 1000 }, 'sess-y', { now: NOW, isSubagent: () => true }).ask, false, 'B4：子智能体 → 不提示')

// B5：pending 目标会话不存活 → 不提示（回「2」也接不上，别白问）。
assert.equal(decideSwitchAsk({ sessionId: 'sess-x', createdAt: NOW - 1000 }, 'sess-y', { now: NOW, alive: () => false }).ask, false, 'B5：目标死了 → 不提示')

// B6：无 pending → 不提示。
assert.equal(decideSwitchAsk(null, 'sess-y', { now: NOW }).ask, false, 'B6：无 pending → 不提示')

/* ═══════════════════════════════════════════════════════════════
 * (C) 切换提示的候选列表能被既有 parseChoiceReply 消费（零新路由状态）
 * ═══════════════════════════════════════════════════════════════ */
const sandbox = mkdtempSync(join(tmpdir(), 'feishu-pending-switch-'))
try {
  // 模拟 route 分支写下的候选：1=当前会话 Y，2=待接入会话 X。
  writePendingChoice(sandbox, 'oc_1', {
    candidates: [
      { sessionId: 'sess-y', label: '当前会话 sess-y' },
      { sessionId: 'sess-x', label: '待接入会话 sess-x' },
    ],
    createdAt: NOW,
  })
  const pending = readPendingChoice(sandbox, 'oc_1')
  assert.ok(pending, 'C1：候选列表已落盘且按 chatId 可读')

  const pick2 = parseChoiceReply('2', pending, { now: NOW })
  assert.equal(pick2?.kind, 'select', 'C2：回「2」被识别为 select')
  assert.equal(pick2?.sessionId, 'sess-x', 'C2：回「2」切到待接入会话 X')

  const pick1 = parseChoiceReply('1', pending, { now: NOW })
  assert.equal(pick1?.kind, 'select', 'C3：回「1」被识别为 select')
  assert.equal(pick1?.sessionId, 'sess-y', 'C3：回「1」留在当前会话 Y')

  assert.equal(parseChoiceReply('绑定会话 2', pending, { now: NOW })?.sessionId, 'sess-x', 'C4：既有「绑定会话 2」句式同样消费')
  assert.equal(parseChoiceReply('sess-x', pending, { now: NOW }), null, 'C5：真 id 不被抢（照旧走 bind 分支）')
  assert.equal(parseChoiceReply('随便聊聊', pending, { now: NOW }), null, 'C6：普通正文不误消费')
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

/* ═══════════════════════════════════════════════════════════════
 * (D) 新文案 + KNOWN_GUIDE_MARKERS 特征串（防压缩件/引用自我维持）
 * ═══════════════════════════════════════════════════════════════ */
const prompt = buildSwitchPendingBindPrompt('sess-abcdefgh1234', 'sess-xy9876543210')
// shortSessionId：前 8 位（含 'sess-' 前缀）→ 'sess-abcdefgh1234' → 'sess-abc'。
assert.ok(prompt.includes('这个对话现在接的是会话 sess-abc'), 'D1：提示文案带当前会话短 id')
assert.ok(prompt.includes('你之前在会话 sess-xy9 发起过接入'), 'D1：提示文案带待接入会话短 id')
assert.ok(prompt.includes('回「2」切到 sess-xy9'), 'D1：教用户回 2 切换')
assert.ok(prompt.includes('回「1」留在 sess-abc'), 'D1：教用户回 1 留下')
assert.ok(prompt.includes('本条消息已照常投给 sess-abc'), 'D1：说明本条消息已照常投递')

const notice = buildPendingRebindNotice('sess-abcdefgh1234')
assert.ok(notice.includes('已接到你之前发起接入的会话 sess-abc'), 'D2：pending 优先档文案带短 id')
assert.ok(notice.includes('这条消息已经投进去'), 'D2：说明消息已投递')

// D3：两条新文案都是 isInjectedGuideText 认得出的（KNOWN_GUIDE_MARKERS 追加生效）。
assert.ok(isInjectedGuideText(prompt), 'D3：切换提示文案被特征串识别')
assert.ok(isInjectedGuideText(notice), 'D3：pending 优先档文案被特征串识别')
assert.ok(KNOWN_GUIDE_MARKERS.includes('这个对话现在接的是会话'), 'D3：markers 含切换提示特征串')
assert.ok(KNOWN_GUIDE_MARKERS.includes('已接到你之前发起接入的会话'), 'D3：markers 含 pending 优先档特征串')

/* ═══════════════════════════════════════════════════════════════
 * (E) feishu.js 接线核对
 * ═══════════════════════════════════════════════════════════════ */
const feishuSrc = readFileSync(join(ROOT, 'lib', 'feishu.js'), 'utf8')
const logicSrc = readFileSync(join(ROOT, 'lib', 'feishu-logic.js'), 'utf8')

// E1：route 分支切片——先投递、后提示、提示后立即 clearPendingBind。
const routeStart = feishuSrc.indexOf("decision.action === 'route'")
const routeEnd = feishuSrc.indexOf("decision.action === 'bind'")
assert.ok(routeStart !== -1 && routeEnd > routeStart, 'E0：route 分支定位成功')
const routeBlock = feishuSrc.slice(routeStart, routeEnd)
const at = (needle) => routeBlock.indexOf(needle)
assert.ok(at('await deliverToSession(ctx, decision.sessionId') !== -1, 'E1：route 分支先投递')
assert.ok(at('if (delivered)') !== -1 && at('if (delivered)') > at('await deliverToSession(ctx, decision.sessionId'), 'E1：切换提示只在投递成功后考虑')
assert.ok(at('decideSwitchAsk(') !== -1, 'E1：route 分支走 decideSwitchAsk 判定')
assert.ok(at('writePendingChoice(root, chatId') !== -1, 'E1：写下候选列表（复用 parseChoiceReply 消费链）')
assert.ok(at('buildSwitchPendingBindPrompt(') !== -1, 'E1：发送切换提示文案')
assert.ok(at("recordRouting('switch-ask'") !== -1, 'E1：路由回看记录 switch-ask')
assert.ok(at('recordRouting(\'switch-ask\'') < at('clearPendingBind(root)'), 'E2：提示后立即 clearPendingBind（防每条消息重复刷屏）')
assert.ok(at("recordRouting('route'") > at('clearPendingBind(root)'), 'E2：route 记录在切换提示处理之后（本条消息照常投 Y）')

// E3：未绑定分支——pending 优先档在 decideUnboundChatRouting 之前。
const unboundStart = feishuSrc.indexOf('const candidates = collectActiveSessionCandidates(ctx, root, chatId)')
const unboundBlock = feishuSrc.slice(Math.max(0, unboundStart - 2200), unboundStart)
assert.ok(unboundBlock.includes("recordRouting('pending-rebind', pendingCall.sessionId)"), 'E3：未绑定分支有 pending 优先档（pending-rebind）')
assert.ok(unboundBlock.includes('decidePendingBindUsable('), 'E3：优先档判据走 decidePendingBindUsable')
assert.ok(unboundBlock.includes('buildPendingRebindNotice('), 'E3：优先档发送告知文案')
assert.ok(
  unboundBlock.indexOf('clearPendingBind(root)') < unboundBlock.indexOf("recordRouting('pending-rebind', pendingCall.sessionId)"),
  'E3：接入成功即清 pending（防留到之后误绑）',
)

// E4：三档兜底仍在（pending 无效时 1.5.33 行为照旧）。
assert.ok(feishuSrc.includes('decideUnboundChatRouting('), 'E4：三档决策仍被调用')
assert.ok(feishuSrc.includes("recordRouting('reuse'"), 'E4：reuse 档仍在')
assert.ok(feishuSrc.includes("recordRouting('choose'"), 'E4：choose 档仍在')
assert.ok(feishuSrc.includes("recordRouting('new-fallback'"), 'E4：new-fallback 兜底仍在')

// E5：TTL 常量收编——feishu.js 不再本地定义，从 feishu-logic.js 导入。
assert.ok(!feishuSrc.includes('const PENDING_BIND_TTL_MS'), 'E5：feishu.js 不再本地定义 PENDING_BIND_TTL_MS')
assert.ok(feishuSrc.includes('PENDING_BIND_TTL_MS,'), 'E5：feishu.js 从 feishu-logic 导入 PENDING_BIND_TTL_MS')
assert.ok(logicSrc.includes('export const PENDING_BIND_TTL_MS'), 'E5：PENDING_BIND_TTL_MS 收编到 feishu-logic.js')

// E6：p2p 自动绑定先例未被破坏（subagent/过期清除链仍在）。
const p2pStart = feishuSrc.indexOf("'im.chat.access_event.bot_p2p_chat_entered_v1'")
assert.ok(p2pStart !== -1, 'E6：p2p 事件接线仍在')
const p2pBlock = feishuSrc.slice(p2pStart, p2pStart + 2500)
assert.ok(p2pBlock.includes('subagentSessions.has(pending.sessionId)'), 'E6：p2p 先例——子智能体目标丢弃')
assert.ok(p2pBlock.includes('Date.now() - (pending.createdAt || 0) > PENDING_BIND_TTL_MS'), 'E6：p2p 先例——过期清除（改用收编后的常量）')

// E7：纯函数确实从 feishu-logic.js 导出。
assert.ok(logicSrc.includes('export function decideSwitchAsk'), 'E7：decideSwitchAsk 已导出')
assert.ok(logicSrc.includes('export function decidePendingBindUsable'), 'E7：decidePendingBindUsable 已导出')

// E8：decideUnboundChatRouting 纯函数本身未被本次改动破坏（reuse/choose/new 三档照旧）。
const one = normalizeSessionCandidates({ sessions: [{ sessionId: 'sess-only', title: '唯一会话' }] })
assert.equal(decideUnboundChatRouting({ reuseActiveSession: true, candidates: one }).action, 'reuse', 'E8：单候选照旧 reuse')
const many = normalizeSessionCandidates({
  sessions: [
    { sessionId: 'sess-a', title: '甲' },
    { sessionId: 'sess-b', title: '乙' },
  ],
})
assert.equal(decideUnboundChatRouting({ reuseActiveSession: true, candidates: many }).action, 'choose', 'E8：多候选照旧 choose')
assert.equal(decideUnboundChatRouting({ reuseActiveSession: true, candidates: [] }).action, 'new', 'E8：零候选照旧 new')

console.log('feishu-pending-switch.test.mjs: ALL PASS')
