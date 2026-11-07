/**
 * 回归测试：抓 [闹钟] 巡检的"已到点"分支到底能不能走到。
 *
 * 背景（2026-11-07 翻 dsh-schedule 源码核实）：
 *   一次性任务（at / rrule COUNT=1）在 deliverDue 里 commit 那一刻，
 *   `advanced()` 就把 status 写成 "ended"（schedule-service.js:1443：
 *   `status: occurrence.nextScheduledAt === void 0 ? "ended" : "active"`）。
 *   而 commit 与 send 在同一个 try 里、commit 紧跟在投递之后，几乎同时发生。
 *
 * 于是"已到点"这个窗口极窄：只有投递失败（send 抛错、未 commit）时，
 * 任务才会短期停在 active + scheduledAt 已过。我原来把"过点 1 小时内"当
 * 主要情形写进了文案和注释，那是不成立的假设。
 *
 * 这个测试固定三件事：
 *   1. 真实成功路径（active + scheduledAt 已过）能渲染出"已到点"——保住窄窗口的能力；
 *   2. ended 的任务即便 scheduledAt 已过也**不出现**（它已经投递过了）；
 *   3. 文案不得声称"到点了会把你叫醒"给一个其实已经投递完毕的任务。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const tmp = join(tmpdir(), 'aiyayi-alarm-regression')
mkdirSync(tmp, { recursive: true })
const store = join(tmp, 'schedule.json')

const mkTask = (title, iso, status, sessionId) => ({
  record: { id: 'x-' + title, title, scheduledAt: iso, prompt: 'p', kind: 'at' },
  status,
  target: { kind: 'session', sessionId },
  involvedSessionIds: [sessionId],
})

const SESSION = 'session-reg-001'
const NOW = Date.parse('2026-11-07T06:40:00.000Z') // 本地 14:40

writeFileSync(
  store,
  JSON.stringify({
    tables: {
      tasks: {
        // 投递失败、尚未 commit：active 且已过点 40 分钟 —— 唯一该报"已到点"的情形
        failedDelivery: mkTask('投递失败待重试', '2026-11-07T06:00:00.000Z', 'active', SESSION),
        // 已成功投递：宿主立刻把它写成 ended，即便 scheduledAt 已过也不该再提
        delivered: mkTask('已成功投递的', '2026-11-07T06:30:00.000Z', 'ended', SESSION),
      },
    },
  }),
  'utf8',
)

process.env.DSH_SCHEDULE_STORE = store
process.env.AIYAYI_HOME = tmp

const mod = await import(pathToFileURL('G:/阿依娅伊/output/dsh-aiyayi-fix/lib/presence.js').href)
const { renderAlarms, readOwnAlarms } = mod.__testing

let ok = true
const check = (label, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (cond ? '' : '\n        ' + extra))
  if (!cond) ok = false
}

const mine = readOwnAlarms(SESSION)
const titles = mine.map((a) => a.title)
check('只收 active（ended 的投递成功任务不进来）', !titles.includes('已成功投递的'), titles.join(','))

const text = renderAlarms(SESSION, NOW)
console.log('\n--- 渲染 ---\n' + text + '\n------------\n')

check('失败未 commit 的任务报"已过点"', text.includes('已过点'), text)
check('如实说"提醒还没送达"，不催她动手', text.includes('提醒还没送达'), text)
check('不再催"现在就该动手办"（那是错假设）', !text.includes('现在就该动手办'), text)
check('给出改期/查会话的可行动作', text.includes('schedule_edit') || text.includes('目标会话'), text)
check('已投递成功的任务不被提及', !text.includes('已成功投递的'), text)
check('计数只算 active 的 1 个', text.includes('你名下 1 个'), text)

// 关键：ended 任务永远不进 [闹钟] —— 它是"已经响过"的，再提示等于叫她重复干活
check('ended 单独存在时不注入', (() => {
  writeFileSync(store, JSON.stringify({
    tables: { tasks: { d: mkTask('已投递', '2026-11-07T06:30:00.000Z', 'ended', SESSION) } },
  }), 'utf8')
  return renderAlarms(SESSION, NOW) === ''
})(), 'ended 任务不该产生任何注入')

console.log(ok ? '\nALL PASS' : '\nSOME FAILED')
process.exit(ok ? 0 : 1)
