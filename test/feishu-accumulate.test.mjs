// 坑（1.5.26）：回发攒批 Map 覆盖式 set —— 同一 turn 的多段文本只发出最后一段。
//
// 缺陷链路（修复前）：
//   feishu.js:527  pendingReplies.set(sessionId, text)   ← Map 同键覆写
//   宿主带 tool call 的回合按 step 渐进发多条 assistant/message（每 step 一条），
//   第二条 set 覆盖第一条，turn/end 的 flushReply 只取到最后一段——
//   用户在飞书侧丢失「派活前那段文本」（feishu.js:459-462 旧注释"settle 替换"
//   是误读，实际语义是渐进追加，1.5.14 防刷屏设计假设"每回合一条文本"不成立）。
//
// 修复：同 sessionId 顺序累积，多段以 \n\n 合并；防刷屏仍保留 turn/end 单条回发。
//
// 本测试走**真实 apply()**（tools-surface.test.mjs 的假 ctx 模式）：
//   - 真实 lib/feishu.js 的 session/event → pendingReplies → flushReply → 发送链路；
//   - 只 stub 两个顶层依赖：@larksuiteoapi/node-sdk（createLarkChannel，sender.send
//     捕获 payload）与 @deepseek-ai/dsh-llm（createUserMessage，本链路不触达，仅需
//     可解析导入）。stub 落在仓库 node_modules（.gitignore 已忽略），测试结束清理；
//   - 记忆根/指路文件全定向沙盘（AIYAYI_HOME + setOverride + setPointerPath），
//     绝不碰真机；归属缓存（chat-owners.json）预写命中，回发不走真网络探测。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const repoRoot = resolve(HERE, '..')
const libUrl = (file) => pathToFileURL(join(repoRoot, 'lib', file)).href

// 纯文本断言（默认 card 模式的卡片分片行为由 feishu-trim.test.mjs 覆盖）。
process.env.AIYAYI_FEISHU_MARKDOWN = 'text'

// ── stub 两个顶层依赖（落 repoRoot/node_modules，gitignored；已存在则不覆盖）──
globalThis.__larkStubSends = []
const stubDirs = [] // 收尾要删的桩目录（含空的父包域目录逐个往上收，只删空目录）
/** 只删空目录：非空（他人包/残留文件）一律不动，返回是否已不存在。 */
const removeDirIfEmpty = (dir) => {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir)
  } catch {}
  return !existsSync(dir)
}
const ensureStub = (dir, name, code) => {
  mkdirSync(dir, { recursive: true })
  stubDirs.push(dir)
  const pkg = join(dir, 'package.json')
  const idx = join(dir, 'index.js')
  if (!existsSync(pkg)) {
    writeFileSync(pkg, JSON.stringify({ name, version: '0.0.0-test', type: 'module', main: 'index.js' }), 'utf8')
  }
  if (!existsSync(idx)) writeFileSync(idx, code, 'utf8')
  return [pkg, idx]
}

const stubSdkDir = join(repoRoot, 'node_modules', '@larksuiteoapi', 'node-sdk')
const stubLlmDir = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh-llm')
const sdkStubFiles = ensureStub(
  stubSdkDir,
  '@larksuiteoapi/node-sdk',
  `// 测试 stub（test/feishu-accumulate.test.mjs 生成）：只提供 lib/feishu.js 用到的面。
export function createLarkChannel(_opts) {
  return {
    handlers: {},
    dispatcher: { register(_map) {} },
    opts: {},
    connect: async () => {},
    disconnect: async () => {},
    sender: {
      send: async (chatId, payload) => {
        globalThis.__larkStubSends.push({ chatId, payload })
        return { code: 0 }
      },
    },
  }
}
`,
)
const llmStubFiles = ensureStub(
  stubLlmDir,
  '@deepseek-ai/dsh-llm',
  `// 测试 stub：回发攒批链路不触达 createUserMessage，仅需可解析导入。
export const createUserMessage = (...args) => ({ role: 'user', stub: true, args })
`,
)

// ── 沙盘记忆根 + 指路文件隔离（不碰真机）──
const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-accumulate-'))
const root = join(sandbox, 'root')
mkdirSync(join(root, 'feishu'), { recursive: true })
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
process.env.AIYAYI_HOME = root

const { __testing: homeTesting } = await import(libUrl('home.js'))
homeTesting.setOverride(root) // 指路根 = 沙盘（优先级最高）
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json')) // 指路文件不落真机
homeTesting.pointerCacheReset()

// 预写配置/映射/归属缓存（归属命中 → 回发不走真网络探测）。
writeFileSync(
  join(root, 'feishu', 'config.json'),
  JSON.stringify({ apps: [{ appId: 'cli_test', appSecret: 'sec-test' }] }),
  'utf8',
)
writeFileSync(join(root, 'feishu', 'mappings.json'), JSON.stringify({ oc_x: 'sess_x', oc_y: 'sess_y' }), 'utf8')
writeFileSync(
  join(root, 'feishu', 'chat-owners.json'),
  JSON.stringify({ oc_x: 'cli_test', oc_y: 'cli_test' }),
  'utf8',
)

const { apply } = await import(libUrl('feishu.js'))

// ── 假 ctx：捕获 session/event 处理器；其余宿主服务缺席 → 插件安全降级 ──
const sessionEventHandlers = []
const fakeCtx = {
  logger: { info: () => {}, warn: () => {} },
  effect(fn) {
    fn()
    return () => {}
  },
  on(event, handler) {
    if (event === 'session/event') sessionEventHandlers.push(handler)
    return () => {}
  },
  get() {
    return undefined
  },
}
apply(fakeCtx, {})
assert.ok(sessionEventHandlers.length >= 1, 'apply 应至少注册一个 session/event 处理器（回发 relay）')

const emitSessionEvent = (session, event) => {
  for (const handler of sessionEventHandlers) handler(session, event)
}
const assistantMessage = (text) => ({
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text }] } },
})
/** flushReply 内部是 async 编排（归属解析→发送），轮询等新 payload 落地。 */
const waitNewSends = async (before) => {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (globalThis.__larkStubSends.length > before) return
    await new Promise((r) => setTimeout(r, 20))
  }
  assert.fail('等待发送超时：flushReply 未发出任何 payload')
}
const sendsSince = (mark) => globalThis.__larkStubSends.slice(mark)

try {
  // ═══════════════════════════════════════════════════════════════
  // (a) 多文本段：同 sessionId 两条 assistant/message → turn/end 单条回发，
  //     两段以 \n\n 合并、顺序保留（修复前：只有第二条，第一条丢失）
  // ═══════════════════════════════════════════════════════════════
  {
    const mark = globalThis.__larkStubSends.length
    emitSessionEvent({ id: 'sess_x' }, assistantMessage('派活前的那段说明'))
    emitSessionEvent({ id: 'sess_x' }, assistantMessage('活干完的结论'))
    emitSessionEvent({ id: 'sess_x' }, { type: 'turn/end' })
    await waitNewSends(mark)

    const sends = sendsSince(mark)
    assert.equal(sends.length, 1, 'a1：turn/end 仍应单条回发（防刷屏设计不变）')
    assert.equal(sends[0].chatId, 'oc_x', 'a2：应发到绑定的 chat')
    assert.equal(sends[0].payload.text, '派活前的那段说明\n\n活干完的结论', 'a3：两段应以 \\n\\n 合并且顺序保留')
  }

  // ═══════════════════════════════════════════════════════════════
  // (b) 单文本段对照：行为不变（无多余 \n\n，逐字节等于原文）
  // ═══════════════════════════════════════════════════════════════
  {
    const mark = globalThis.__larkStubSends.length
    emitSessionEvent({ id: 'sess_y' }, assistantMessage('单段文本'))
    emitSessionEvent({ id: 'sess_y' }, { type: 'turn/end' })
    await waitNewSends(mark)

    const sends = sendsSince(mark)
    assert.equal(sends.length, 1, 'b1：单段仍单条回发')
    assert.equal(sends[0].chatId, 'oc_y', 'b2：发到各自绑定的 chat')
    assert.equal(sends[0].payload.text, '单段文本', 'b3：单段行为不变，不得多出 \\n\\n')
  }

  // ═══════════════════════════════════════════════════════════════
  // (c) 跨回合不残留：flush 后 Map 必须清空，下一轮文本不得拼上上一轮残段
  // ═══════════════════════════════════════════════════════════════
  {
    const mark = globalThis.__larkStubSends.length
    emitSessionEvent({ id: 'sess_x' }, assistantMessage('第二轮新文本'))
    emitSessionEvent({ id: 'sess_x' }, { type: 'turn/end' })
    await waitNewSends(mark)

    const sends = sendsSince(mark)
    assert.equal(sends.length, 1, 'c1：新回合单条回发')
    assert.equal(sends[0].payload.text, '第二轮新文本', 'c2：不得残留上一轮两段文本')
  }

  // ═══════════════════════════════════════════════════════════════
  // (d) 未绑定会话：不攒不发（内存堆积防护，feishu.js:526）
  // ═══════════════════════════════════════════════════════════════
  {
    const mark = globalThis.__larkStubSends.length
    emitSessionEvent({ id: 'sess_stranger' }, assistantMessage('路人会话'))
    emitSessionEvent({ id: 'sess_stranger' }, { type: 'turn/end' })
    await new Promise((r) => setTimeout(r, 100)) // 给假发送留时间；若发了会立刻可见
    assert.equal(globalThis.__larkStubSends.length, mark, 'd1：未绑定会话不攒不发')
  }

  console.log('feishu-accumulate.test.mjs: ALL PASS')
} finally {
  // 沙盘与 stub 清理（stub 文件此刻已在进程模块缓存里加载完，删除不影响本次运行）。
  rmSync(sandbox, { recursive: true, force: true })
  for (const f of [...sdkStubFiles, ...llmStubFiles]) {
    try {
      if (existsSync(f)) rmSync(f, { force: true })
    } catch {}
  }
  // 坑（1.5.28）：只删桩文件会把造出来的空目录留在插件 node_modules 里
  // （@deepseek-ai/dsh-llm、@larksuiteoapi/node-sdk 及其父包域目录），
  // 遮蔽宿主供给的同名包 → 线上 feishu 入口 Cannot find package。
  // 这里连目录一起删：自桩目录逐级向上，只删**空**目录，遇到非空立刻停（不碰别人的包）。
  for (const dir of stubDirs) {
    let cur = dir
    while (cur.startsWith(join(repoRoot, 'node_modules')) && removeDirIfEmpty(cur)) {
      const parent = dirname(cur)
      if (parent === repoRoot) break // 不删插件自身的 node_modules 之上的任何东西
      cur = parent
    }
  }
  // 解除测试注入（进程即将退出，但保持整洁）。
  homeTesting.setOverride(undefined)
  homeTesting.setPointerPath(null)
}
