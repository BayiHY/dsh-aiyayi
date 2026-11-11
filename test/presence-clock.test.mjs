/**
 * presence 时钟自检：验证 [时间] 行真的被注入，且格式可用。
 * 只测注入与格式，不碰她的记忆文件（用 AIYAYI_HOME 指到临时目录）。
 *
 * 2026-11-11 补：**光设 AIYAYI_HOME 不够**。home.js 的解析优先级是
 * 指路文件 > AIYAYI_HOME > 默认路径；真机装过插件、搬过家的话
 * ~/.dsh/aiyayi/location.json 存在，它直接压掉环境变量——本测试就会写到
 * 用户**真实的记忆根**里。当天实测：apply() 的 pwsh 体检预热在真机记忆根下
 * 写出了 pwsh.json，等于把用户"该看到的一次性提示"提前用掉了。
 * 所以必须像 home-relocate/tools-surface 那样，连指路文件一起定向到沙盘。
 *
 * 1.5.34 修（跨午夜偶发失败）：旧判据拿 `new Date()` 与注入时间比
 * 「年月日是否相同」（sameDay）。注入发生在 handler 内部（presence.js:1195
 * 的 `const now = Date.now()`），取样发生在 handler 返回之后——只要这两点
 * 正好跨过 00:00:00，注入是 23:59:59、取样是次日 00:00:00，sameDay 必挂，
 * 而插件行为完全正常。2026-11-11→12 午夜实测中招一次。
 *
 * 新判据：**注入时刻必须落在「调用前 → 调用后」这个夹逼窗口内**（epoch 毫秒
 * 比较，附加 2s 容差抗时钟微调）。跨午夜天然成立——23:59:59 与 00:00:01
 * 的 epoch 差就是 2 秒，不涉及"同一天"这种日历概念。
 * 本文件末尾用构造的午夜场景自证：同一对时间戳下旧判据失败、新判据通过，
 * 且真正错误的日期仍能被抓住（不是把断言改成永远成立）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'aiyayi-clock-'))
process.env.AIYAYI_HOME = home

const homeLib = await import('../lib/home.js')
homeLib.__testing.setPointerPath(join(home, 'location.json'))

// 兜底：真落不到沙盘就当场判测试坏了，绝不静默写脏真机记忆根。
if (!homeLib.pwshFile().startsWith(home)) {
  throw new Error(`测试沙盘失效：pwshFile()=${homeLib.pwshFile()} 不在 ${home} 内`)
}

const { apply, name } = await import('../lib/presence.js')

let handler = null
const registered = []

const ctx = {
  effect: (fn) => { fn(); return () => {} },
  on: (event, fn, opts) => { handler = fn; return () => {} },
  tools: {
    register: (def) => { registered.push(def.name); return () => {} },
  },
}

apply(ctx)

if (!handler) throw new Error('presence 没注册 agent/pre-step 监听器')
if (!registered.includes('update_state') || !registered.includes('wish')) {
  throw new Error(`工具注册不全: ${registered.join(',')}`)
}

// ═══════════════════════════════════════════════════════════════
// 判据工具（纯函数，本文件内定义；1.5.34 起不再用 sameDay）
// ═══════════════════════════════════════════════════════════════

/** 注入行的正则（渲染格式见 presence.js:renderNow L568-575）。 */
const CLOCK_RE =
  /\[时间\] 现在 (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) 周([日一二三四五六]) \(UTC([+-])(\d{2}):(\d{2})\)/

/** 从注入文本里解析出时钟字段；解析不出返回 null。 */
function parseClock(text) {
  const m = CLOCK_RE.exec(text)
  if (!m) return null
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6]),
    weekday: m[7],
    tzSign: m[8],
    tzHour: Number(m[9]),
    tzMinute: Number(m[10]),
    raw: m[0],
  }
}

/** 把解析出的本地时间还原成 epoch 毫秒（按运行环境的本地时区，与渲染口径一致）。 */
function clockToEpochMs(clock) {
  return new Date(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
    0,
  ).getTime()
}

/** 星期字符 → getDay() 的数字（周日=0）。 */
const WEEKDAY_INDEX = { 日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

/**
 * 新判据：注入时刻必须落在 [beforeMs - tol, afterMs + tol] 内。
 * 跨午夜不需要特判——比的是 epoch，不是日历日。
 * @returns {{ok: boolean, reason?: string, skewMs?: number}}
 */
function clockWithinWindow(clock, beforeMs, afterMs, tolMs = 2000) {
  const injected = clockToEpochMs(clock)
  if (!Number.isFinite(injected)) return { ok: false, reason: '注入时间无法解析成时间戳' }
  if (injected < beforeMs - tolMs) {
    return { ok: false, reason: `注入时间比调用前还早 ${beforeMs - injected}ms（时钟倒流或渲错年份）`, skewMs: injected - beforeMs }
  }
  if (injected > afterMs + tolMs) {
    return { ok: false, reason: `注入时间比调用后还晚 ${injected - afterMs}ms（时钟超前或渲错年份）`, skewMs: injected - afterMs }
  }
  return { ok: true, skewMs: injected - beforeMs }
}

/** 旧判据（仅为证明"同一对时间戳下它会挂"，不参与实际断言）。 */
function legacySameDay(clock, now) {
  return (
    clock.year === now.getFullYear() &&
    clock.month === now.getMonth() + 1 &&
    clock.day === now.getDate()
  )
}

// ═══════════════════════════════════════════════════════════════
// 跨午夜场景自证：同一对时间戳，旧判据挂、新判据过
// ═══════════════════════════════════════════════════════════════
{
  // 构造：注入发生在 2026-11-11 23:59:59，取样发生在次日 2026-11-12 00:00:01。
  const injectedAt = new Date(2026, 10, 11, 23, 59, 59, 0)
  const sampledAt = new Date(2026, 10, 12, 0, 0, 1, 0)
  const midnightClock = parseClock('[时间] 现在 2026-11-11 23:59:59 周三 (UTC+08:00)')
  if (!midnightClock) throw new Error('构造的午夜注入行没被 CLOCK_RE 解析出来')

  // 前提自检：注入行自身必须是自洽的（周三 = 2026-11-11 确实是周三）。
  if (WEEKDAY_INDEX[midnightClock.weekday] !== injectedAt.getDay()) {
    throw new Error(`构造场景的星期不自洽：注入写周${midnightClock.weekday}，实际 getDay()=${injectedAt.getDay()}`)
  }

  // (a) 旧判据在这对时间戳下必挂 —— 这正是 2026-11-11 夜里的真实故障。
  if (legacySameDay(midnightClock, sampledAt)) {
    throw new Error('自证失败：旧 sameDay 判据居然认为 23:59:59 与次日 00:00:01 是同一天')
  }
  // (b) 新判据在这对时间戳下必须通过。
  const crossResult = clockWithinWindow(midnightClock, injectedAt.getTime(), sampledAt.getTime())
  if (!crossResult.ok) {
    throw new Error(`自证失败：新判据在跨午夜场景下也不通过（${crossResult.reason}）`)
  }
  // (c) 两个时刻只差 2 秒 —— 说明新判据认的是"时间接近"，不是"同一天"。
  if (Math.abs(crossResult.skewMs) > 2000) {
    throw new Error(`自证失败：跨午夜 2s 场景的偏差被算成 ${crossResult.skewMs}ms`)
  }

  // (d) 反证：新判据不能被改成"永远成立"。同一个注入行，若窗口挪到两天后，必须报错。
  const farFuture = clockWithinWindow(
    midnightClock,
    injectedAt.getTime() + 2 * 24 * 3600 * 1000,
    injectedAt.getTime() + 2 * 24 * 3600 * 1000 + 1000,
  )
  if (farFuture.ok) throw new Error('反证失败：新判据对错开两天的注入行仍然通过（断言失去意义）')

  // (e) 反证：窗口不变但注入行年份写错（2025 而非 2026），必须报错。
  const wrongYear = parseClock('[时间] 现在 2025-11-11 23:59:59 周二 (UTC+08:00)')
  if (!wrongYear) throw new Error('构造的错年份注入行没被解析')
  const wrongYearResult = clockWithinWindow(wrongYear, injectedAt.getTime(), sampledAt.getTime())
  if (wrongYearResult.ok) throw new Error('反证失败：年份写错一年仍通过')

  console.log('OK 跨午夜场景自证：旧判据挂 / 新判据过 / 错日期仍被抓')
}

// ═══════════════════════════════════════════════════════════════
// 真实注入：跑一次 pre-step，验证 [时间] 行格式与时刻
// ═══════════════════════════════════════════════════════════════
const realUser = {
  id: 'u1',
  role: 'user',
  content: [{ type: 'text', text: '现在几点' }],
  source: { kind: 'user' },
}
const decision = { kind: 'proceed', messages: [realUser] }

// 夹逼窗口：注入发生在 handler 内部，取调用前后的墙钟把注入时刻夹在中间。
const beforeMs = Date.now()
const result = await handler(
  { agent: { id: 'a1', session: { id: 's1' } }, step: 1, signal: new AbortController().signal },
  async () => decision,
)
const afterMs = Date.now()

const injected = result.messages[result.messages.length - 1]
const text = injected.content.map((b) => b.text).join('\n')

if (!text.includes('[时间] 现在')) {
  throw new Error(`注入块里没有 [时间] 行，实际内容:\n${text}`)
}

const clock = parseClock(text)
if (!clock) {
  throw new Error(`[时间] 行格式不对，实际:\n${text}`)
}

// (1) 时刻落在夹逼窗口内（1.5.34 起的判据，跨午夜不再误报）。
const within = clockWithinWindow(clock, beforeMs, afterMs)
if (!within.ok) {
  throw new Error(`[时间] 行时刻不在调用窗口内：${within.reason}\n实际:\n${clock.raw}`)
}

// (2) 星期与日期自洽（不依赖"现在几点"，是纯格式正确性校验）。
const injectedDate = new Date(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second, 0)
if (WEEKDAY_INDEX[clock.weekday] !== injectedDate.getDay()) {
  throw new Error(
    `星期与日期不符：注入写周${clock.weekday}，${clock.year}-${clock.month}-${clock.day} 实际是 getDay()=${injectedDate.getDay()}`,
  )
}

// (3) 时区偏移与运行环境一致（允许分钟级差异，覆盖半小时时区如 +05:30）。
const envOffsetMin = -new Date().getTimezoneOffset()
const injectedOffsetMin =
  (clock.tzSign === '-' ? -1 : 1) * (clock.tzHour * 60 + clock.tzMinute)
if (injectedOffsetMin !== envOffsetMin) {
  throw new Error(`时区偏移不符：注入 UTC${clock.tzSign}${clock.tzHour}:${String(clock.tzMinute).padStart(2, '0')}，环境 ${envOffsetMin} 分钟`)
}

// (4) 顺带确认旧判据在当前时刻确实也能过（说明只有跨午夜才是它的盲区，
//     我们没有把它的通过场景一并废掉——今天不跨午夜，两条判据都该过）。
if (!legacySameDay(clock, new Date(afterMs))) {
  throw new Error(`意外：当前非跨午夜场景下旧 sameDay 判据竟然不通过（注入 ${clock.raw}）`)
}

console.log('OK presence 时钟注入')
console.log('   注入行:', clock.raw)
console.log('   窗口偏差:', `${within.skewMs}ms`)
console.log('   工具:', registered.join(', '))

rmSync(home, { recursive: true, force: true })

// 与其他测试统一到 ALL PASS 约定，便于整套跑完统一判定
console.log('\nALL PASS')
