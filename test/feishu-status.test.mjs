// 1.5.35：修「飞书连接状态失真」——feishu_status 报 connected:true 但长连接
// 断开/重连期间仍是 true，从不回写。
//
// 缺陷（1.5.34 及以前，lib/feishu.js:441-448 旧行号）：
//   channel.connect().then(() => { state.connected = true; ... })
//   只在 connect() 成功的 .then 里置 true，之后没有任何回写；`onReconnecting|
//   onReconnected|onError` 全仓 0 处命中。SDK 的自动重连（120s + 0~30s 抖动）
//   期间 feishu_status 一直报 connected:true，用户被误导。
//
// 修复分两层：
//   ① 纯状态机 lib/feishu-logic.js：createConnectState / noteConnectEstablished /
//      noteDisconnect / noteConnectError / evaluateConnectHealth / describeConnectState
//      / reconcileConnectState —— 本文件主体覆盖这层；
//   ② 接线 lib/feishu.js：真事件源接 SDK（channel.handlers.reconnecting/reconnected、
//      channel.rawWsClient.onError、channel.getConnectionStatus() 对账）——
//      用「假 WS 事件序列」走真实 apply() 覆盖（见文末 E 段）。
//
// 为什么事件源是这两个名字（实测 SDK 1.76.0 lib/index.js，见 feishu.js 注释与
// CHANGELOG 1.5.35 的取证段）：
//   - createLarkChannel 建 WSClient 时把构造参数 onReconnecting/onReconnected
//     转成 handlers.reconnecting/reconnected（106988-106989）→ channel.on(...)；
//   - WSClient.onError **没有**被转发（106981-106986 只用于首次握手 reject），
//     只能包 rawWsClient.onError 实例字段；
//   - getConnectionStatus()（106017-106020 → WSClient 102982）给快照兜底。
//
// 本文件 E 段走真实 apply()，stub 方式与 test/feishu-accumulate.test.mjs 一致
// （stub @larksuiteoapi/node-sdk + @deepseek-ai/dsh-llm，落 repoRoot/node_modules，
// .gitignore 已忽略，测试结束清理；记忆根/指路文件全定向沙盘）。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CONNECT_HEALTH_MAX_RECONNECTS,
  CONNECT_HEALTH_WINDOW_MS,
  createConnectState,
  describeConnectState,
  evaluateConnectHealth,
  noteConnectError,
  noteConnectEstablished,
  noteDisconnect,
  reconcileConnectState,
  reconnectsWithinWindow,
} from '../lib/feishu-logic.js'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const repoRoot = resolve(HERE, '..')
const libUrl = (file) => pathToFileURL(join(repoRoot, 'lib', file)).href

const NOW = Date.UTC(2026, 10, 12, 2, 0, 0) // 固定基准时间，避免时钟抖动

// ─── A. 初始状态：未连接 ───
{
  const state = createConnectState()
  const view = describeConnectState(state, { now: NOW })
  assert.equal(view.connected, false, 'A1：新建状态必须是未连接')
  assert.equal(view.connectedAt, null, 'A2：未连接过就没有 connectedAt')
  assert.equal(view.lastDisconnectAt, null, 'A3：从未连接 → 没有断开时间')
  assert.equal(view.reconnectCount, 0, 'A4：重连计数初始 0')
  assert.equal(view.lastError, null, 'A5：无错误')
  assert.equal(view.healthy, false, 'A6：没连上就不健康')
  assert.equal(view.healthHint, null, 'A7：没连上不给「频繁重连」提示')
}

// ─── B. connect 成功 → connected=true ───
{
  const state = createConnectState()
  noteConnectEstablished(state, { now: NOW })
  const view = describeConnectState(state, { now: NOW })
  assert.equal(view.connected, true, 'B1：建连成功 → connected=true')
  assert.equal(view.connectedAt, new Date(NOW).toISOString(), 'B2：connectedAt 记录建连时刻')
  assert.equal(view.reconnectCount, 0, 'B3：首次建连不算重连')
  assert.equal(view.healthy, true, 'B4：刚连上且无重连 → 健康')
  assert.equal(state.error, null, 'B5：旧字段 error 清空')
}

// ─── C. 断连 → connected=false + lastDisconnectAt 有值 ───
{
  const state = createConnectState()
  noteConnectEstablished(state, { now: NOW })
  const disconnectedAt = NOW + 60_000
  noteDisconnect(state, { now: disconnectedAt, reason: 'ws-reconnecting' })
  const view = describeConnectState(state, { now: disconnectedAt })
  assert.equal(view.connected, false, 'C1：断连后 connected 必须立刻变 false（1.5.34 的 bug 就是这个）')
  assert.equal(view.lastDisconnectAt, new Date(disconnectedAt).toISOString(), 'C2：lastDisconnectAt 有值')
  assert.equal(view.lastDisconnectReason, 'ws-reconnecting', 'C3：断开原因可追')
  assert.equal(view.connectedAt, new Date(NOW).toISOString(), 'C4：connectedAt 保留上一次成功建连时刻')
  assert.equal(view.healthy, false, 'C5：断开即不健康')
}

// ─── D. 重连成功 → connected=true + reconnectCount 递增 + connectedAt 更新 ───
{
  const state = createConnectState()
  noteConnectEstablished(state, { now: NOW })
  noteDisconnect(state, { now: NOW + 120_000 })
  const reconnectAt = NOW + 130_000
  noteConnectEstablished(state, { now: reconnectAt, reconnected: true })
  const view = describeConnectState(state, { now: reconnectAt })
  assert.equal(view.connected, true, 'D1：重连成功 → connected=true')
  assert.equal(view.reconnectCount, 1, 'D2：reconnectCount 递增')
  assert.equal(view.connectedAt, new Date(reconnectAt).toISOString(), 'D3：connectedAt 更新为最近一次建连时刻')
  assert.notEqual(view.connectedAt, new Date(NOW).toISOString(), 'D4：connectedAt 不能停在首次建连')
  assert.equal(view.healthy, true, 'D5：1 次重连（未超阈值）仍算健康')
  // 再断再连一次 → 2
  noteDisconnect(state, { now: reconnectAt + 1_000 })
  noteConnectEstablished(state, { now: reconnectAt + 2_000, reconnected: true })
  assert.equal(state.reconnectCount, 2, 'D6：多次重连累计')
}

// ─── E. 5 分钟内重连超 3 次 → healthy=false + 提示文案 ───
{
  const state = createConnectState()
  noteConnectEstablished(state, { now: NOW })
  // 阈值边界：正好 CONNECT_HEALTH_MAX_RECONNECTS 次仍健康（"超过"才算不健康）。
  let t = NOW + 1_000
  for (let i = 0; i < CONNECT_HEALTH_MAX_RECONNECTS; i++) {
    noteDisconnect(state, { now: t })
    noteConnectEstablished(state, { now: t + 500, reconnected: true })
    t += 1_000
  }
  const atThreshold = evaluateConnectHealth(state, { now: t })
  assert.equal(atThreshold.reconnectsInWindow, CONNECT_HEALTH_MAX_RECONNECTS, 'E1：窗口内计数正确')
  assert.equal(atThreshold.healthy, true, 'E2：正好等于阈值仍算健康（判据是"超过"）')
  assert.equal(atThreshold.hint, null, 'E3：健康时不给提示')

  // 越过阈值 → 不健康 + 提示。
  noteDisconnect(state, { now: t })
  noteConnectEstablished(state, { now: t + 500, reconnected: true })
  t += 1_000
  const over = evaluateConnectHealth(state, { now: t })
  assert.equal(over.reconnectsInWindow, CONNECT_HEALTH_MAX_RECONNECTS + 1, 'E4：+1 次后计数超阈值')
  assert.equal(over.healthy, false, 'E5：超过阈值 → healthy=false')
  assert.match(over.hint, /长连接不稳定/, 'E6：提示文案含「长连接不稳定」')
  assert.match(over.hint, /最近 5 分钟内重连 4 次/, 'E7：提示给出窗口与次数')
  const view = describeConnectState(state, { now: t })
  assert.equal(view.connected, true, 'E8：此时仍在线（connected 与 healthy 是两件事）')
  assert.equal(view.healthy, false, 'E9：但在线也不健康')
  assert.equal(view.healthHint, over.hint, 'E10：逐应用视图带同一条提示')

  // 窗口滑过：5 分钟后再看，旧重连不再计入 → 恢复健康。
  const later = t + CONNECT_HEALTH_WINDOW_MS + 1
  const recovered = evaluateConnectHealth(state, { now: later })
  assert.equal(recovered.reconnectsInWindow, 0, 'E11：窗口外的重连被裁掉')
  assert.equal(recovered.healthy, true, 'E12：窗口滑过 → 恢复健康')
  assert.equal(reconnectsWithinWindow(state, { now: later }), 0, 'E13：reconnectsWithinWindow 一致')
  // 注意：reconnectTimestamps 只在写入时裁剪，读时再裁一次（不污染计数）。
  assert.equal(state.reconnectTimestamps.length > 0, true, 'E14：原始时间戳保留（读时才裁）')
  assert.equal(state.reconnectCount, CONNECT_HEALTH_MAX_RECONNECTS + 1, 'E15：累计重连数不因窗口滑动而回退')
}

// ─── F. 错误 → lastError 有值 ───
{
  const state = createConnectState()
  noteConnectError(state, { now: NOW, error: new Error('WebSocket reconnect exhausted after 3 attempts') })
  const view = describeConnectState(state, { now: NOW })
  assert.equal(view.lastError, 'WebSocket reconnect exhausted after 3 attempts', 'F1：lastError 记录错误文本')
  assert.equal(view.lastErrorAt, new Date(NOW).toISOString(), 'F2：lastErrorAt 记录错误时刻')
  assert.equal(view.connected, false, 'F3：出错即视为未连接')
  assert.equal(state.error, 'WebSocket reconnect exhausted after 3 attempts', 'F4：兼容旧字段 error 同步')

  // 建连成功清空「当前错误」，但 lastError 保留供追查（两个字段语义不同）。
  noteConnectEstablished(state, { now: NOW + 10_000 })
  assert.equal(state.error, null, 'F5：连上后 error 清空')
  assert.equal(state.lastError, 'WebSocket reconnect exhausted after 3 attempts', 'F6：lastError 保留（这是"最近一次错误"）')
  const afterView = describeConnectState(state, { now: NOW + 10_000 })
  assert.equal(afterView.lastError, 'WebSocket reconnect exhausted after 3 attempts', 'F7：视图仍报 lastError')

  // 字符串/异常对象都能吃，不抛。
  const s2 = createConnectState()
  noteConnectError(s2, { now: NOW, error: 'plain string error' })
  assert.equal(s2.lastError, 'plain string error', 'F8：字符串错误可用')
  noteConnectError(s2, { now: NOW, error: { code: 'not_connected', message: 'handshake failed' } })
  assert.equal(s2.lastError, 'handshake failed', 'F9：LarkChannelError 形态取 message')
  assert.equal(noteConnectError(null, { now: NOW, error: 'x' }), null, 'F10：null 状态安全忽略')
}

// ─── G. SDK 快照对账（reconcileConnectState）───
{
  // 事件漏记（例：插件热重启后 status 仍是旧的 true，实际 SDK 在重连）→ 快照纠偏。
  const state = createConnectState()
  noteConnectEstablished(state, { now: NOW })
  const verdict = reconcileConnectState(
    state,
    { state: 'reconnecting', lastConnectTime: NOW, reconnectAttempts: 2 },
    { now: NOW + 5_000 },
  )
  assert.equal(verdict, 'disconnected', 'G1：快照 reconnecting → 纠偏为断开')
  assert.equal(state.connected, false, 'G2：布尔字段被纠正')
  assert.equal(state.lastDisconnectAt, NOW + 5_000, 'G3：补记断开时间')
  assert.equal(state.lastDisconnectReason, 'sdk-state:reconnecting', 'G4：断开原因来自快照')

  // 反向：状态记着断，SDK 实际连上了 → 纠回 true，且不改 reconnectCount。
  const state2 = createConnectState()
  const before = state2.reconnectCount
  const verdict2 = reconcileConnectState(
    state2,
    { state: 'connected', lastConnectTime: NOW - 1_000 },
    { now: NOW },
  )
  assert.equal(verdict2, 'connected', 'G5：快照 connected → 纠偏为在线')
  assert.equal(state2.connected, true, 'G6：布尔字段被纠正')
  assert.equal(state2.reconnectCount, before, 'G7：对账不制造重连计数（避免与事件重复计数）')
  assert.equal(state2.connectedAt, NOW - 1_000, 'G8：用快照 lastConnectTime 补建连时刻')

  // 无变化 / 无快照 → 不扰动。
  assert.equal(reconcileConnectState(state2, { state: 'connected' }, { now: NOW }), null, 'G9：已是在线 → 无动作')
  assert.equal(reconcileConnectState(state2, null, { now: NOW }), null, 'G10：无快照 → 无动作')
  assert.equal(reconcileConnectState(null, { state: 'connected' }, { now: NOW }), null, 'G11：null 状态安全')
  assert.equal(reconcileConnectState(state2, { state: 'weird-state' }, { now: NOW }), null, 'G12：未知快照状态不猜')
}

// ─── H. 接线核对：lib/feishu.js 真的挂了 SDK 事件（防「只写纯函数没人调」）───
{
  const src = readFileSync(join(repoRoot, 'lib', 'feishu.js'), 'utf8')
  // 1.5.34 的缺陷形态：只在 connect 的 .then 里写死 true、从不回写。
  assert.equal(
    /\.then\(\(\) => \{\s*state\.connected = true/.test(src),
    false,
    'H0：不能再出现「只在 .then 里置 true」的旧写法',
  )
  assert.ok(src.includes('channel.handlers.reconnecting'), 'H1：必须挂 SDK 的 reconnecting 事件')
  assert.ok(src.includes('channel.handlers.reconnected'), 'H2：必须挂 SDK 的 reconnected 事件')
  assert.ok(src.includes('rawWsClient'), 'H3：错误必须从 rawWsClient.onError 拿（SDK 未转发 onError）')
  assert.ok(src.includes('noteDisconnect('), 'H4：断连要真的回写状态机')
  assert.ok(src.includes('noteConnectEstablished('), 'H5：建连/重连要真的回写状态机')
  assert.ok(src.includes('noteConnectError('), 'H6：错误要真的回写状态机')
  assert.ok(src.includes('reconcileConnectState('), 'H7：status 读时要与 SDK 快照对账')
  assert.ok(src.includes('getConnectionStatus('), 'H8：对账数据源是 SDK 的 getConnectionStatus')
  assert.ok(src.includes('healthy'), 'H9：feishu_status 要返回 healthy')
  assert.ok(src.includes('长连接不稳定'), 'H10：不稳定时要给可读告警')
}

// ─── I. 假 WS 事件序列：走真实 apply()，验证整条接线 ───
//
// 两个顶层依赖用**进程内 loader 钩子**替换（`module.registerHooks`，node ≥22.15）——
// 不落任何文件到 node_modules，因此不会与 test/feishu-accumulate.test.mjs 的
// 桩目录互相污染（那套是「落盘、已存在则不覆盖」，两条测试并发时会互抢）。

/** 复刻 SDK 1.76.0 的连接面（关键行为与行号见文件头注释）。 */
const LARK_SDK_STUB = `
// rawWsClient 在 connect() 时才建（对应 SDK lib/index.js:106961），
// 且 onError 在 connect() 里挂上（106981）——所以插件在 connect().then() 里
// 包 rawWsClient.onError 是能包到的。
export function createLarkChannel(_opts) {
  const channel = {
    handlers: {},
    dispatcher: { register(_map) {} },
    opts: {},
    connected: false,
    sdkState: 'idle',
    rawWsClient: null,
    getConnectionStatus: () => ({ state: channel.sdkState, lastConnectTime: channel.lastConnectTime }),
    on(name, handler) { channel.handlers[name] = handler; return () => {} },
    connect: async () => {
      channel.connected = true;
      channel.sdkState = 'connected';
      channel.lastConnectTime = Date.now();
      channel.rawWsClient = { onError: () => {}, getConnectionStatus: () => channel.getConnectionStatus() };
    },
    disconnect: async () => { channel.connected = false; channel.sdkState = 'idle'; },
    sender: { send: async () => ({ code: 0 }) },
  };
  globalThis.__larkStubChannels.push(channel);
  return channel;
}
`
const LLM_STUB = `
export const createUserMessage = (...args) => ({ role: 'user', stub: true, args });
`

const STUB_FILES = {
  '@larksuiteoapi/node-sdk': LARK_SDK_STUB,
  '@deepseek-ai/dsh-llm': LLM_STUB,
}

// 只拦截这两条裸包名（不带子路径），其他解析一律交回默认。
const hookHandle = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUB_FILES, specifier)) {
      return { url: `stub:${specifier}`, shortCircuit: true, format: 'module' }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:')) {
      return { format: 'module', source: STUB_FILES[url.slice('stub:'.length)], shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
globalThis.__larkStubChannels = []

// ── 沙盘记忆根 + 指路文件隔离（不碰真机）──
const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-feishu-status-'))
const root = join(sandbox, 'root')
mkdirSync(join(root, 'feishu'), { recursive: true })
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
process.env.AIYAYI_HOME = root

const { __testing: homeTesting } = await import(libUrl('home.js'))
homeTesting.setOverride(root)
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
homeTesting.pointerCacheReset()

writeFileSync(
  join(root, 'feishu', 'config.json'),
  JSON.stringify({ apps: [{ appId: 'cli_test', appSecret: 'sec-test' }] }),
  'utf8',
)
writeFileSync(join(root, 'feishu', 'mappings.json'), JSON.stringify({ oc_x: 'sess_x' }), 'utf8')
writeFileSync(join(root, 'feishu', 'chat-owners.json'), JSON.stringify({ oc_x: 'cli_test' }), 'utf8')

try {
  const { apply } = await import(libUrl('feishu.js'))

  // 假 ctx：捕获工具注册（真实 feishu_status）与 effect（连接生命周期）。
  const registered = new Map()
  const effects = []
  const fakeCtx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    effect(fn, label) {
      effects.push({ fn, label })
      return () => {}
    },
    on() {
      return () => {}
    },
    get(name) {
      if (name === 'tools') {
        return {
          register(tool) {
            registered.set(tool.name, tool)
          },
        }
      }
      return undefined
    },
  }
  apply(fakeCtx, {})

  const statusTool = registered.get('feishu_status')
  assert.ok(statusTool, 'I0：apply 必须注册 feishu_status（无凭证也要能自查）')
  const runStatus = () => statusTool.execute({}, { agent: { session: { id: 'sess_x' } } })

  // ① 连接建立前：connected=false（1.5.34 在这里也是 false，但之后再也不变）。
  const beforeConnect = await runStatus()
  assert.equal(beforeConnect.connected, false, 'I1：connect() 之前 connected=false')
  assert.equal(beforeConnect.healthy, false, 'I2：connect() 之前 healthy=false')
  assert.equal(beforeConnect.configured, true, 'I3：configured 仍按旧语义（有凭证即 true）')

  // 触发连接生命周期 effect（apply 里 ctx.effect(..., 'aiyayi-feishu.connect()')）。
  // effects 里还有别的 effect（接入引导等），按 label 精确定位，避免误跑副作用。
  const connectEntry = effects.find((e) => String(e.label ?? '').includes('connect()'))
  assert.ok(connectEntry, 'I4：必须注册 connect() 生命周期 effect')
  let connectDisposer = connectEntry.fn()
  const channel = globalThis.__larkStubChannels[0] ?? null
  assert.ok(channel, 'I4b：apply 必须建一条长连接')
  assert.equal(typeof connectDisposer, 'function', 'I4c：connect effect 必须返回清理函数')
  // connect() 是 async，等它 settle 并跑完 .then 里的接线。
  await new Promise((r) => setTimeout(r, 20))

  // ② connect 成功 → connected=true。
  const afterConnect = await runStatus()
  assert.equal(afterConnect.connected, true, 'I5：connect 成功 → connected=true')
  assert.equal(afterConnect.healthy, true, 'I6：刚连上 → healthy=true')
  assert.equal(typeof afterConnect.connectedAt, 'string', 'I7：connectedAt 是 ISO 字符串')
  assert.equal(afterConnect.apps[0].connected, true, 'I8：apps[].connected 同步')

  // ③ 假 WS 断连事件（SDK onReconnecting → handlers.reconnecting）。
  //
  // 忠实复刻 SDK 的事件顺序：WSClient.reConnect() 先 terminate 旧 socket、把
  // wsConfig 实例置空（102763-102766），再 safeInvoke('onReconnecting')（102761）——
  // 所以 onReconnecting 触发时 getConnectionStatus().state 已经是 'reconnecting'
  // （computeState：isConnecting && hasEverConnected，102990-103000）。
  // 两边都驱动，才能验证「事件回写」与「快照对账」不会互相打架。
  const dropSocket = () => {
    channel.sdkState = 'reconnecting'
    channel.handlers.reconnecting()
  }
  const reconnectSocket = () => {
    channel.sdkState = 'connected'
    channel.handlers.reconnected()
  }
  assert.equal(typeof channel.handlers.reconnecting, 'function', 'I9：必须挂上 reconnecting 回调')
  dropSocket()
  const afterDisconnect = await runStatus()
  assert.equal(
    afterDisconnect.connected,
    false,
    'I10（核心修复）：断连后 feishu_status 必须报 false，而不是 1.5.34 的粘性 true',
  )
  assert.equal(typeof afterDisconnect.lastDisconnectAt, 'string', 'I11：lastDisconnectAt 有值')
  assert.equal(afterDisconnect.apps[0].lastDisconnectReason, 'ws-reconnecting', 'I12：断开原因可追')
  assert.equal(afterDisconnect.healthy, false, 'I13：断开 → 不健康')

  // ④ 假 WS 重连成功（SDK onReconnected → handlers.reconnected）。
  assert.equal(typeof channel.handlers.reconnected, 'function', 'I14：必须挂上 reconnected 回调')
  reconnectSocket()
  const afterReconnect = await runStatus()
  assert.equal(afterReconnect.connected, true, 'I15：重连成功 → connected=true')
  assert.equal(afterReconnect.reconnectCount, 1, 'I16：reconnectCount 递增')
  assert.equal(afterReconnect.healthy, true, 'I17：1 次重连仍健康')
  assert.notEqual(afterReconnect.connectedAt, afterConnect.connectedAt, 'I18：connectedAt 被更新')

  // ⑤ 5 分钟内重连超阈值 → healthy=false + 顶层 warning。
  dropSocket()
  reconnectSocket() // 2
  dropSocket()
  reconnectSocket() // 3
  dropSocket()
  reconnectSocket() // 4 > 3
  const unstable = await runStatus()
  assert.equal(unstable.connected, true, 'I19：此刻仍在线')
  assert.equal(unstable.healthy, false, 'I20：重连过频 → healthy=false')
  assert.equal(unstable.reconnectsInLast5m, 4, 'I21：顶层给出 5 分钟内重连次数')
  assert.equal(typeof unstable.warning, 'string', 'I22：不稳定要给顶层 warning')
  assert.match(unstable.warning, /长连接不稳定/, 'I23：warning 文案含「长连接不稳定」')
  assert.match(unstable.warning, /最近 5 分钟内重连 4 次/, 'I24：warning 给出次数')
  assert.deepEqual(unstable.unhealthyApps, ['cli_test'], 'I25：不健康的应用可定位')

  // ⑥ 错误事件（rawWsClient.onError，SDK 未转发 → 插件包了一层）。
  assert.equal(typeof channel.rawWsClient.onError, 'function', 'I26：rawWsClient.onError 存在')
  channel.rawWsClient.onError(new Error('WebSocket reconnect exhausted after 3 attempts'))
  channel.sdkState = 'failed' // SDK: terminalError=true → computeState 'failed'（102992-102997）
  const withError = await runStatus()
  assert.equal(withError.lastError, 'WebSocket reconnect exhausted after 3 attempts', 'I27：lastError 有值')
  assert.equal(withError.apps[0].lastError, 'WebSocket reconnect exhausted after 3 attempts', 'I28：逐应用 lastError 同步')
  assert.equal(withError.connected, false, 'I29：出错 → connected=false')

  // ⑦ 旧字段兼容：1.5.34 的返回字段一个不少。
  for (const key of ['configured', 'connected', 'sessionId', 'boundChat', 'boundChatAppId', 'otherBound', 'totalBound', 'apps', 'chatOwners', 'singleApp']) {
    assert.ok(key in withError, `I30：旧字段 ${key} 必须保留`)
  }
  assert.equal(withError.boundChat, 'oc_x', 'I31：绑定关系照旧')
  assert.deepEqual(withError.chatOwners, { oc_x: 'cli_test' }, 'I32：归属表照旧')
  assert.equal(withError.singleApp, true, 'I33：singleApp 照旧')

  // ⑧ 插件卸载 effect：状态落成断开（热重启窗口不再报假在线）。
  assert.equal(typeof connectDisposer, 'function', 'I34：connect effect 必须返回清理函数')
  // 先连回来，确认卸载前是 true，避免「本来就 false 所以看起来对」的假通过。
  reconnectSocket()
  const beforeDispose = await runStatus()
  assert.equal(beforeDispose.connected, true, 'I35：卸载前确实在线')
  connectDisposer()
  const afterDispose = await runStatus()
  assert.equal(afterDispose.connected, false, 'I36：卸载后不再报在线')
} finally {
  rmSync(sandbox, { recursive: true, force: true })
  hookHandle.deregister()
}

console.log('feishu-status.test.mjs: ALL PASS')
