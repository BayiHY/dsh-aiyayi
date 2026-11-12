/**
 * 1.5.39 feishu_bind 自动绑定 —— 纯函数 + 静态接线单测。
 *
 * 需求（李浩 2026-11-12 终版）：用户说「接飞书」就该一步到位——
 *   - feishu_bind 不传 chatId：自动从插件已有信息里挑「最近活跃的 chat」直接绑定，
 *     旧绑定直接覆盖不追问；绑定成功后 bot 主动往该 chat 发对接成功消息；
 *   - 降级（提示去飞书发消息）仅两种：一个可绑 chat 都找不到；或绑定尝试失败
 *     （chatId 无效/非成员）；
 *   - 无条件「装 app/去飞书」引导改为仅降级时出现。
 *
 * 本测试锁三件事（与 feishu-weixin-guide.test.mjs 同策略：不 import lib/feishu.js，
 * 避免碰 SDK 桩包的 node_modules 雷区，用纯函数 + 静态接线核对）：
 *   (a) pickAutoBindChat：数据源优先级与确定性（入站流量 > 已绑 chat > 成员 chat）；
 *   (b) decideNewSessionGuide：hasBindableChat=true 不再注入装 app 引导（降级门控）；
 *   (c) 接线核对：feishu.js 真的用了 pickAutoBindChat / sendViaOwner / clearPendingBind，
 *       且 feishu_bind 的 chatId 参数已改为可选（parameters.required 不含 chatId）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideNewSessionGuide, pickAutoBindChat } from '../lib/feishu-logic.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

// ═══════════════════════════════════════════════════════════════
// (a) pickAutoBindChat：挑最近活跃 chat
// ═══════════════════════════════════════════════════════════════

// a1：空输入 → null（真降级：一个可绑 chat 都没有）。
assert.equal(pickAutoBindChat({}), null, 'a1：空输入应返回 null')
assert.equal(pickAutoBindChat({ mappings: {}, inboundRouting: [], chatOwners: {} }), null, 'a1：全空快照应返回 null')

// a2：入站流量优先——routing 新→旧，第一条有效 chatId 即最优（多应用并存时
// 谁最近有流量就挑谁）。
const pickedInbound = pickAutoBindChat({
  mappings: { oc_old: 'sess-a' },
  inboundRouting: [
    { at: 200, chatId: 'oc_new', appId: 'app-2', action: 'route', sessionId: 'sess-b' },
    { at: 100, chatId: 'oc_mid', appId: 'app-1', action: 'bind', sessionId: 'sess-a' },
  ],
  chatOwners: { oc_new: 'app-2', oc_old: 'app-1' },
})
assert.ok(pickedInbound, 'a2：有入站流量必须给出结果')
assert.equal(pickedInbound.chatId, 'oc_new', 'a2：挑最近有入站流量的 chat')
assert.equal(pickedInbound.source, 'inbound', 'a2：source 标 inbound')
assert.equal(pickedInbound.appId, 'app-2', 'a2：appId 取路由记录里的（= 最近流量所属应用）')
assert.equal(pickedInbound.at, 200, 'a2：at 带出最近流量时间')

// a3：routing 里的坏条目（无 chatId）跳过，继续往后找。
const pickedSkipBad = pickAutoBindChat({
  inboundRouting: [{ at: 300, chatId: '', action: 'route' }, { at: 50, chatId: 'oc_good', appId: 'app-1' }],
  chatOwners: { oc_good: 'app-1' },
})
assert.equal(pickedSkipBad.chatId, 'oc_good', 'a3：坏条目跳过')

// a4：无入站流量 → 已绑 chat（mappings）兜底；字典序取首个（确定性）。
const pickedBound = pickAutoBindChat({
  mappings: { oc_b2: 'sess-2', oc_a1: 'sess-1' },
  chatOwners: { oc_a1: 'app-1' },
})
assert.equal(pickedBound.chatId, 'oc_a1', 'a4：无流量时取字典序首个已绑 chat')
assert.equal(pickedBound.source, 'bound', 'a4：source 标 bound')
assert.equal(pickedBound.appId, 'app-1', 'a4：appId 从 chatOwners 补')

// a5：无流量也无绑定 → chatOwners（应用成员 chat）兜底。
const pickedOwned = pickAutoBindChat({ chatOwners: { oc_z9: 'app-2', oc_m3: 'app-1' } })
assert.equal(pickedOwned.chatId, 'oc_m3', 'a5：最后兜底取字典序首个成员 chat')
assert.equal(pickedOwned.source, 'owned', 'a5：source 标 owned')

// a6：坏输入不抛（routing 非数组 / mappings 非对象都当空处理）。
assert.equal(pickAutoBindChat({ inboundRouting: 'oops', mappings: 42, chatOwners: null }), null, 'a6：坏输入安全降级 null')

// a7：路由记录缺 appId 时回落 chatOwners 的归属。
const pickedFallbackApp = pickAutoBindChat({
  inboundRouting: [{ at: 10, chatId: 'oc_x', action: 'route' }],
  chatOwners: { oc_x: 'app-9' },
})
assert.equal(pickedFallbackApp.appId, 'app-9', 'a7：appId 回落 chatOwners')

// ═══════════════════════════════════════════════════════════════
// (b) decideNewSessionGuide：降级门控（有可绑 chat 不再引导装 app）
// ═══════════════════════════════════════════════════════════════

// b1：hasBindableChat=true → 不注入（用户说「接飞书」即可自动绑定）。
const gated = decideNewSessionGuide({ sessionId: 'sess-1', hasBindableChat: true })
assert.equal(gated.guide, false, 'b1：有可绑 chat 就不注入装 app 引导')
assert.equal(gated.reason, 'has-bindable-chat', 'b1：reason 标 has-bindable-chat')

// b2：hasBindableChat 缺省/false（真降级）→ 照旧注入装 app 引导。
assert.deepEqual(
  decideNewSessionGuide({ sessionId: 'sess-1' }),
  { guide: true, reason: 'unbound' },
  'b2：真降级（没 chat 可绑）才注入装 app 引导',
)
assert.deepEqual(
  decideNewSessionGuide({ sessionId: 'sess-1', hasBindableChat: false }),
  { guide: true, reason: 'unbound' },
  'b2：显式 false 同样注入',
)

// b3：旧判定优先级不变（已绑定 > 已引导 > 子智能体 > 微信通道）。
assert.equal(decideNewSessionGuide({ sessionId: 'sess-1', chatId: 'oc_x', hasBindableChat: true }).reason, 'bound')
assert.equal(decideNewSessionGuide({ sessionId: 'sess-1', alreadyGuided: true, hasBindableChat: true }).reason, 'already-guided')
assert.equal(decideNewSessionGuide({ sessionId: 'sess-1', isSubagent: true, hasBindableChat: true }).reason, 'subagent')
assert.equal(decideNewSessionGuide({ sessionId: 'weixin-x', hasBindableChat: true }).reason, 'weixin-channel')

// ═══════════════════════════════════════════════════════════════
// (c) 接线核对：feishu.js 真的用上了这些新件
// ═══════════════════════════════════════════════════════════════
const feishuSrc = readFileSync(join(ROOT, 'lib', 'feishu.js'), 'utf8')

// bindBlock：feishu_bind 工具注册块（6000 字符窗口，覆盖整个 execute）。
const bindMarker = feishuSrc.indexOf("name: 'feishu_bind'")
const bindBlock = feishuSrc.slice(bindMarker, bindMarker + 6000)

assert.ok(feishuSrc.includes('pickAutoBindChat('), 'c1：feishu_bind / maybeGuideNewSession 必须走 pickAutoBindChat()')
assert.ok(feishuSrc.includes('sendInfra.sendViaOwner = sendViaOwner'), 'c2：sendViaOwner 必须回填进工具层句柄（绑定成功通知复用既有发送轮子）')
assert.ok(feishuSrc.includes("'对接成功通知'"), 'c3：绑定成功后必须有主动发消息动作（label=对接成功通知）')
assert.ok(/clearPendingBind\(root\)/.test(bindBlock), 'c4：feishu_bind 成功路径必须清 pending-bind（防 TTL 内 p2p 事件把 chat 绑回旧目标）')
assert.ok(feishuSrc.includes('noticeSent'), 'c5：通知发送结果要回传（noticeSent 字段）')

// c6：feishu_bind 的 chatId 参数已改可选（宿主校验也不接受参数层 type 数组）。
const logicSrc = readFileSync(join(ROOT, 'lib', 'feishu-logic.js'), 'utf8')
assert.ok(!/required:\s*\[\s*'chatId'\s*\]/.test(bindBlock), 'c6：feishu_bind 不得再把 chatId 列为必填（不传 chatId = 自动绑定）')
assert.ok(logicSrc.includes('export function pickAutoBindChat'), 'c6：pickAutoBindChat 必须从 feishu-logic.js 导出')

console.log('feishu-auto-bind.test.mjs: ALL PASS')
