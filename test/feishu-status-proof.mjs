// 1.5.35 独立取证脚本（文件名不带 .test.mjs，不进全量通配）：
// 用一个「假 WS 事件序列」驱动**真实的状态机 + 真实的 feishu_status 组装逻辑**，
// 复现 1.5.34 的失真现象并证明 1.5.35 修好了。
//
// 事件序列取自 SDK 1.76.0 的真实时序（lib/index.js）：
//   首次建连  : connect() resolve → onReady
//   抖动断连  : ws 'close'（102873）→ reConnect() → log '[ws] reconnect'（102759）
//              → safeInvoke('onReconnecting')（102761）      ✅ 有事件
//   重连成功  : loopReConnect → log 'reconnect success'（102788）
//              → safeInvoke('onReconnected')（102791）        ✅ 有事件
//   重试耗尽  : safeInvoke('onError', 'WebSocket reconnect exhausted...')（102814）
//                                                             ⚠ onError 未被 LarkChannel 转发
// 本脚本按上述四个时点打点，每次打点后打印 feishu_status 的可见字段。
import {
  CONNECT_HEALTH_MAX_RECONNECTS,
  createConnectState,
  describeConnectState,
  evaluateConnectHealth,
  noteConnectError,
  noteConnectEstablished,
  noteDisconnect,
  reconcileConnectState,
} from '../lib/feishu-logic.js'

// 假时钟：从固定时刻起，每次事件推进秒数，保证输出可复现。
let clock = Date.UTC(2026, 10, 12, 2, 0, 0)
const tick = (ms) => {
  clock += ms
  return clock
}
const state = createConnectState()
const log = []

const snapshot = (label) => {
  const view = describeConnectState(state, { now: clock })
  const health = evaluateConnectHealth(state, { now: clock })
  log.push({ label, connected: view.connected, healthy: view.healthy, reconnectCount: view.reconnectCount, window: health.reconnectsInWindow })
  return view
}

// ① 首次建连（connect().then）
noteConnectEstablished(state, { now: tick(0) })
snapshot('首次建连')

// ② 抖动断连（ws close → onReconnecting）。SDK 在 terminate 之后才发事件，
//    此刻 getConnectionStatus().state 已经是 'reconnecting'。
noteDisconnect(state, { now: tick(124_500), reason: 'ws-reconnecting' })
const afterDrop = snapshot('抖动断连')

// ③ 重连成功（onReconnected）
noteConnectEstablished(state, { now: tick(3_000), reconnected: true })
const afterReconnect = snapshot('重连成功')

// ④ 抖动风暴：4 轮快速抖动（每轮 20 秒内断+连）→ 5 分钟内重连超过阈值 3
for (let i = 0; i < 4; i++) {
  noteDisconnect(state, { now: tick(15_000), reason: 'ws-reconnecting' })
  noteConnectEstablished(state, { now: tick(5_000), reconnected: true })
}
const unstable = snapshot('抖动风暴（4 轮）')

// ⑤ 重试耗尽 → onError
noteConnectError(state, { now: tick(120_000), error: new Error('WebSocket reconnect exhausted after 5 attempts') })
const failed = snapshot('重试耗尽')

// ⑥ 手动恢复（连接重新建起来）+ 窗口滑过 5 分钟 → 恢复健康。
//    注意：healthy 的定义是「在线 且 窗口内重连不多」，所以断开态本来就该是 false——
//    这里必须先真的连上，再看窗口裁剪后的判定。
noteConnectEstablished(state, { now: tick(1_000) })
const sliding = describeConnectState(state, { now: clock + 5 * 60_000 + 1 })

// ⑦ 快照对账：事件漏记（state 记着 false，SDK 实际在线）
const reconcileTarget = createConnectState()
noteConnectEstablished(reconcileTarget, { now: clock })
noteDisconnect(reconcileTarget, { now: clock, reason: 'ws-reconnecting' })
const verdict = reconcileConnectState(reconcileTarget, { state: 'connected', lastConnectTime: clock }, { now: clock + 1 })

// ── 断言（错了就 exit 1，不静默）──
const failures = []
const expect = (cond, msg) => {
  if (!cond) failures.push(msg)
}
expect(afterDrop.connected === false, '断连后 connected 必须为 false（1.5.34 在此仍报 true）')
expect(typeof afterDrop.lastDisconnectAt === 'string', '断连后 lastDisconnectAt 必须有值')
expect(afterDrop.lastDisconnectReason === 'ws-reconnecting', '断开原因必须可追')
expect(afterReconnect.connected === true, '重连成功后 connected 必须为 true')
expect(afterReconnect.reconnectCount === 1, 'reconnectCount 必须递增到 1')
expect(afterReconnect.connectedAt !== afterDrop.connectedAt, 'connectedAt 必须更新')
expect(unstable.connected === true && unstable.healthy === false, `5 分钟内重连超过 ${CONNECT_HEALTH_MAX_RECONNECTS} 次必须 healthy=false`)
expect(typeof unstable.healthHint === 'string' && unstable.healthHint.includes('长连接不稳定'), '必须给「长连接不稳定」提示')
expect(unstable.healthHint.includes('最近 5 分钟内重连 5 次'), '提示必须带窗口与次数')
expect(failed.lastError.includes('reconnect exhausted'), '错误必须落到 lastError')
expect(failed.connected === false, '重试耗尽 → connected=false')
expect(sliding.healthy === true && sliding.reconnectsInLastWindow === 0, '窗口滑过后应恢复健康')
expect(verdict === 'connected' && reconcileTarget.connected === true, '快照对账必须能纠回在线')

console.log('假 WS 事件序列 → feishu_status 可见字段：')
for (const row of log) {
  console.log(
    `  ${row.label.padEnd(18, ' ')} connected=${String(row.connected).padEnd(5)} healthy=${String(row.healthy).padEnd(5)} reconnectCount=${row.reconnectCount} 5min=${row.window}`,
  )
}
console.log(`\n最终 lastError = ${failed.lastError}`)
console.log(`窗口滑过后 healthy = ${sliding.healthy}（5 分钟内重连 ${sliding.reconnectsInLastWindow} 次）`)
console.log(`快照对账 = ${verdict}`)

if (failures.length > 0) {
  console.error('\nFAILED:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nPROVEN：断连即时 false、重连回 true 且计数/时间更新、5 分钟内超 3 次判不健康并给出告警、错误可追、窗口滑动恢复、快照可纠偏。')
