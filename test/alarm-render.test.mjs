/**
 * 真实渲染单测：[闹钟] 巡检注入的可见输出。
 * 造一份 schedule store → import presence.js → 调 __testing.renderAlarms，
 * 断言到点/未来/已结束/别人的/过旧 五种情形的措辞。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const tmp = join(tmpdir(), 'aiyayi-alarm-render')
mkdirSync(tmp, { recursive: true })
const store = join(tmp, 'schedule.json')

const mkTask = (title, iso, status, sessionId, involved = null) => ({
  record: { id: 'x-' + title, title, scheduledAt: iso, prompt: 'p' },
  status,
  target: { kind: 'session', sessionId },
  involvedSessionIds: involved ?? [sessionId],
})

const SESSION = 'session-test-001'
// 固定"现在"：2026-11-07 11:40Z = 19:40 +08
const NOW = Date.parse('2026-11-07T11:40:00.000Z')

writeFileSync(
  store,
  JSON.stringify({
    tables: {
      tasks: {
        due: mkTask('查 mh 单审核', '2026-11-07T11:00:00.000Z', 'active', SESSION),   // 40 分钟前到点
        up: mkTask('续跟审核', '2026-11-08T11:00:00.000Z', 'active', SESSION),          // 1 天后
        done: mkTask('已办结', '2026-11-07T10:00:00.000Z', 'ended', SESSION),           // 已结束
        other: mkTask('别人的闹钟', '2026-11-07T11:00:00.000Z', 'active', 'session-x'), // 别会话
        stale: mkTask('很久以前', '2026-11-07T06:00:00.000Z', 'active', SESSION),       // 5.6h 前
        // 宿主把"看过它"的会话也记进 involvedSessionIds —— 但 target 在别处，
        // 到点根本不会落到本会话，不该被当成"我的闹钟"。
        viewed: mkTask('别处的闹钟（我看过）', '2026-11-07T11:30:00.000Z', 'active', 'session-y', [SESSION]),
      },
    },
  }),
  'utf8',
)

process.env.DSH_SCHEDULE_STORE = store
process.env.AIYAYI_HOME = tmp

const mod = await import('../lib/presence.js')
const { renderAlarms, readOwnAlarms } = mod.__testing

let ok = true
const check = (label, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (cond ? '' : '   ' + extra))
  if (!cond) ok = false
}

// 1. 只认自己的、只认 active
const mine = readOwnAlarms(SESSION)
const titles = mine.map((a) => a.title)
check('只收本会话 active', titles.includes('查 mh 单审核') && titles.includes('续跟审核') && titles.includes('很久以前'), titles.join(','))
check('排除 ended', !titles.includes('已办结'), titles.join(','))
check('排除别的会话', !titles.includes('别人的闹钟'), titles.join(','))
check('排除"只在 involvedSessionIds 里出现"的闹钟', !titles.includes('别处的闹钟（我看过）'), titles.join(','))

// 2. 渲染文本
const text = renderAlarms(SESSION, NOW)
console.log('\n--- 渲染结果 ---\n' + text + '\n----------------\n')
check('有 [闹钟] 开头', text.startsWith('[闹钟]'))
check('报总数 2 个（陈迹不计）', text.includes('你名下 2 个'), text.slice(0, 60))
// 已过点的 active 任务 = 投递失败残留，文案须如实说"没送达"，不能伪造"到点了快办"
check('已过点项写"已过点"', text.includes('已过点'), text)
check('已过点项标明"提醒还没送达"', text.includes('提醒还没送达'), text)
check('不催"现在就该动手办"', !text.includes('现在就该动手办'), text)
check('不含过旧陈迹', !text.includes('很久以前'), text)

// 2b. 只有未来任务时，走"到点会叫醒"那句（有过点项时不会出现，所以单独验）
writeFileSync(store, JSON.stringify({
  tables: { tasks: { up: mkTask('续跟审核', '2026-11-08T11:00:00.000Z', 'active', SESSION) } },
}), 'utf8')
const futureOnly = renderAlarms(SESSION, NOW)
check('纯未来项点明到点会真叫醒', futureOnly.includes('叫醒'), futureOnly)
check('纯未来项不出现过点措辞', !futureOnly.includes('已过点'), futureOnly)

// 3. 陈迹单独：只剩过点 5 小时的任务 → 整行不注入（避免空壳"还挂着 N 个"）
const staleOnlyStore = JSON.stringify({
  tables: { tasks: { stale: mkTask('很久以前', '2026-11-07T06:00:00.000Z', 'active', SESSION) } },
})
writeFileSync(store, staleOnlyStore, 'utf8')
const t2 = renderAlarms(SESSION, NOW)
check('只有陈迹时整行不注入', t2 === '', t2)

// 4. 无任务 → 空串（不注入）
writeFileSync(store, JSON.stringify({ tables: { tasks: {} } }), 'utf8')
check('无任务返回空串', renderAlarms(SESSION, NOW) === '')

// 5. store 不存在 → 空串、不抛
writeFileSync(store, 'not json at all', 'utf8')
check('坏 store 静默为空', renderAlarms(SESSION, NOW) === '')

console.log(ok ? '\nALL PASS' : '\nSOME FAILED')
process.exit(ok ? 0 : 1)
