/**
 * 内容覆盖率测试：闹钟摘要与"是否重复"判定。
 *
 * 动机（2026-11-07 实测踩到）：初版 `recurring = typeof record.rrule === 'string'
 * || record.kind !== 'at'` 把 `RRULE:FREQ=DAILY;COUNT=1`（一次性！）判成"会重复"，
 * 而娅伊建的一次性闹钟恰恰就是这种写法——等于给她一个错的前提。
 * 真正的判据是规则里有没有 COUNT=1。
 *
 * 另外验证 prompt 摘要真的带出来（她得知道"查哪个单号"），
 * 并且截断不切坏代理对。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const tmp = join(tmpdir(), 'aiyayi-alarm-content')
mkdirSync(tmp, { recursive: true })
const store = join(tmp, 'schedule.json')

const SESSION = 'session-content-001'
const NOW = Date.parse('2026-11-07T06:40:00.000Z')

const mk = (id, title, iso, record) => ({
  record: { id, title, scheduledAt: iso, prompt: 'p', ...record },
  status: 'active',
  target: { kind: 'session', sessionId: SESSION },
  involvedSessionIds: [SESSION],
})

writeFileSync(store, JSON.stringify({
  tables: {
    tasks: {
      oneShotRrule: mk('a', '一次性(RRULE COUNT=1)', '2026-11-08T01:30:00.000Z', {
        kind: 'rrule', rrule: 'DTSTART;TZID=Asia/Shanghai:20261108T093000\nRRULE:FREQ=DAILY;COUNT=1',
      }),
      repeatRrule: mk('b', '每天重复(RRULE 无COUNT)', '2026-11-08T03:30:00.000Z', {
        kind: 'rrule', rrule: 'DTSTART;TZID=Asia/Shanghai:20261108T113000\nRRULE:FREQ=DAILY',
      }),
      atKind: mk('c', 'at 类型一次性', '2026-11-08T05:30:00.000Z', { kind: 'at' }),
      cronKind: mk('d', 'cron 周期', '2026-11-08T07:30:00.000Z', { kind: 'cron', expression: '*/30 1-8 * * *' }),
      withPrompt: mk('e', '带详细 prompt', '2026-11-08T09:30:00.000Z', {
        kind: 'at',
        prompt: '到点了，该查补天平台的 mh 单了：QTVA-2026-11332391（乐山师范学院 mh.lsnu.edu.cn 未提供 HTTPS）。做法：派一个 subagent 用 aiyayi_cdp 去查。',
      }),
    },
  },
}), 'utf8')

process.env.DSH_SCHEDULE_STORE = store
process.env.AIYAYI_HOME = tmp

const mod = await import(pathToFileURL('G:/阿依娅伊/output/dsh-aiyayi-fix/lib/presence.js').href)
const { readOwnAlarms, renderAlarms } = mod.__testing

let ok = true
const check = (l, c, e = '') => {
  console.log((c ? 'PASS' : 'FAIL') + '  ' + l + (c ? '' : '\n        ' + String(e)))
  if (!c) ok = false
}

const alarms = readOwnAlarms(SESSION)
const byTitle = Object.fromEntries(alarms.map((a) => [a.title, a]))

check('RULE COUNT=1 判为一次性', byTitle['一次性(RRULE COUNT=1)'].recurring === false, byTitle['一次性(RRULE COUNT=1)']?.recurring)
check('RULE 无 COUNT 判为重复', byTitle['每天重复(RRULE 无COUNT)'].recurring === true, byTitle['每天重复(RRULE 无COUNT)']?.recurring)
check('kind=at 判为一次性', byTitle['at 类型一次性'].recurring === false, byTitle['at 类型一次性']?.recurring)
check('kind=cron 判为重复', byTitle['cron 周期'].recurring === true, byTitle['cron 周期']?.recurring)

const text = renderAlarms(SESSION, NOW)
console.log('\n--- 渲染（只列前 3 个，含摘要） ---\n' + text + '\n--------------------------\n')
// 关键：带单号那条 prompt 排在 shown 之外（第 5 个），摘要必须仍能挑到它
check('摘要从全部任务里挑有内容的（未被 shown 截断挤掉）', text.includes('QTVA-2026-11332391'), text)
check('摘要按长度截断并加省略号', /…$|\…/m.test(text) || text.length < 240, `len=${text.length}`)

// 代理对安全：标题含 emoji 且 prompt 超长，截断后不应出现孤立代理
writeFileSync(store, JSON.stringify({
  tables: { tasks: { e: mk('e', '🔔 emoji 闹钟', '2026-11-08T09:30:00.000Z', {
    kind: 'at', prompt: '🔔'.repeat(80) + '尾巴',
  }) } },
}), 'utf8')
const t2 = renderAlarms(SESSION, NOW)
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t2)
check('截断不切坏 emoji（无孤立代理对）', !loneSurrogate, t2.slice(0, 80))

console.log(ok ? '\nALL PASS' : '\nSOME FAILED')
process.exit(ok ? 0 : 1)
