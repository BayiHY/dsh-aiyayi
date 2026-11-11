/**
 * 1.5.34 端到端取证：把系统时钟拨到「跨午夜」那一秒，跑**真实的 presence 注入**。
 *
 * 为什么单独立一个文件（而不是塞进 presence-clock.test.mjs）：
 *   - 它要篡改 globalThis.Date，改了就影响同进程里所有模块；放在主测试里会让
 *     其它断言也跑在假时钟下，风险大于收益。这里做成独立脚本，单独进程跑。
 *   - 它不进 `test/*.test.mjs` 的通配（文件名不带 .test.mjs），不参与全量单测，
 *     只在需要取证时手动跑：`node test/presence-midnight-proof.mjs`
 *
 * 取证逻辑：
 *   1. 打桩 Date，让「真实墙钟」停在 23:59:59.600；
 *   2. 跑一次真实 pre-step → 注入行写的是 23:59:59；
 *   3. 立刻把桩时钟推到次日 00:00:00.400（模拟 handler 返回后的取样跨了午夜）；
 *   4. 用**旧判据**（sameDay，拿"现在"和注入日期比日历日）判 → 必须失败，
 *      复现 2026-11-11 夜里那次偶发；
 *   5. 用**新判据**（注入时刻落在 [before, after] 夹逼窗口内）判 → 必须通过。
 *
 * 这样证明的不是"新判据在纸上说得通"，而是"真实注入路径 + 真实跨午夜时刻，
 * 旧判据确实会挂、新判据确实不挂"。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'aiyayi-midnight-'))
process.env.AIYAYI_HOME = home

const RealDate = Date
/** 假时钟相对真实时钟的偏移（毫秒）。 */
let offsetMs = 0
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offsetMs)
    else super(...args)
  }
  static now() {
    return RealDate.now() + offsetMs
  }
}
globalThis.Date = FakeDate

const homeLib = await import('../lib/home.js')
homeLib.__testing.setPointerPath(join(home, 'location.json'))
if (!homeLib.pwshFile().startsWith(home)) {
  throw new Error('沙盘失效，拒绝继续')
}

const { apply } = await import('../lib/presence.js')

let handler = null
apply({
  effect: (fn) => { fn(); return () => {} },
  on: (_event, fn) => { handler = fn; return () => {} },
  tools: { register: () => () => {} },
})
if (!handler) throw new Error('没拿到 pre-step 处理器')

// 目标：注入发生时是 23:59:59.600（本地时区），取样时是次日 00:00:00.400。
// 用「当天/次日的午夜」推偏移，避免写死具体日期（任何一天都能跑）。
const realNow = new RealDate()
const dayStart = new RealDate(realNow.getFullYear(), realNow.getMonth(), realNow.getDate(), 0, 0, 0, 0)
// 注入时刻 = 今天 23:59:59.600
const injectTarget = new RealDate(dayStart.getTime() + 24 * 3600 * 1000 - 400) // 23:59:59.600
offsetMs = injectTarget.getTime() - RealDate.now()
globalThis.Date = FakeDate

const beforeMs = Date.now()
const result = await handler(
  { agent: { id: 'a1', session: { id: 's1' } }, step: 1, signal: new AbortController().signal },
  async () => ({ kind: 'proceed', messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '几点了' }], source: { kind: 'user' } }] }),
)
const text = result.messages[result.messages.length - 1].content.map((b) => b.text).join('\n')
const injectedRaw = [text.split('\n').find((l) => l.includes('[时间]'))][0]

// 注入完成后，把时钟推过午夜：+800ms（23:59:59.600 → 次日 00:00:00.400）
offsetMs += 800
globalThis.Date = FakeDate
const afterMs = Date.now()

const CLOCK_RE =
  /\[时间\] 现在 (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) 周([日一二三四五六]) \(UTC([+-])(\d{2}):(\d{2})\)/
const m = CLOCK_RE.exec(text)
if (!m) throw new Error(`注入行格式不对: ${injectedRaw}`)
const clock = {
  year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
  hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6]),
  raw: m[0],
}

const injectedMs = new RealDate(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second, 0).getTime()

// ── 旧判据（1.5.33 及以前的 sameDay）──
const sampledNow = new Date(afterMs)
const legacyOk =
  clock.year === sampledNow.getFullYear() &&
  clock.month === sampledNow.getMonth() + 1 &&
  clock.day === sampledNow.getDate()

// ── 新判据（1.5.34：注入时刻落在夹逼窗口内）──
const TOL = 2000
const newOk = injectedMs >= beforeMs - TOL && injectedMs <= afterMs + TOL

console.log('注入行：', clock.raw)
console.log('注入时刻 epoch：', injectedMs, `(${new RealDate(injectedMs).toISOString()} 本地)` )
console.log('取样时刻 epoch：', afterMs, `(${new RealDate(afterMs).toISOString()} 本地)` )
console.log('调用窗口：[', beforeMs, ',', afterMs, ']')
console.log('')
console.log(`旧判据 sameDay  → ${legacyOk ? '通过' : '失败'}  （期望：失败，复现偶发）`)
console.log(`新判据 夹逼窗口  → ${newOk ? '通过' : '失败'}  （期望：通过）`)

let exitCode = 0
if (legacyOk) {
  console.error('\n取证失败：旧判据在这个场景居然通过了，说明没构造出跨午夜')
  exitCode = 1
}
if (!newOk) {
  console.error('\n取证失败：新判据在跨午夜场景下没通过')
  exitCode = 1
}
if (clock.hour === 0 && clock.minute === 0 && clock.second === 0) {
  console.error('\n取证失败：注入没有落在午夜前的最后一秒，场景没构造对')
  exitCode = 1
}
if (exitCode === 0) {
  console.log('\nPROVEN：真实注入在 23:59:59，取样跨到次日 00:00:00 —— 旧判据挂、新判据过')
}

globalThis.Date = RealDate
rmSync(home, { recursive: true, force: true })
process.exit(exitCode)
