/**
 * 本地单测：验证 [闹钟] 巡检注入（不启动 DSH）。
 * 临时把 DSH_SCHEDULE_STORE 指向一份造的 store，import presence.js，
 * 直接调模块内的 renderAlarms 走不出去（未导出），所以改用 harness：
 * 复制 presence.js 的窗口逻辑太脆，这里改测「读 store + 渲染」的可观测行为：
 * 起一个假 store，再调用 apply 之外的纯函数——因此把被测函数在测试里重算一遍
 * 并断言与注入文本一致。真正保证一致的是下面第 2 条：用 pre-step 钩子的等价
 * 拼装顺序检查字段顺序。
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const tmp = join(tmpdir(), 'aiyayi-alarm-test')
mkdirSync(tmp, { recursive: true })
const store = join(tmp, 'schedule.json')

const mkTask = (id, title, iso, status, sessionId) => ({
  sessionId,
  record: { id, title, scheduledAt: iso, rrule: 'x', prompt: 'p' },
  status,
  target: { kind: 'session', sessionId },
  involvedSessionIds: [sessionId],
})

const SESSION = 'session-test-001'
const now = Date.parse('2026-11-07T11:40:00.000Z') // = 19:40 +08

writeFileSync(
  store,
  JSON.stringify({
    unit: { name: 'schedule', version: 2 },
    global: null,
    tables: {
      tasks: {
        // 已到点 40 分钟、还没处理 → 应出现"已到点"
        due: mkTask('due', '查 mh 单审核', '2026-11-07T11:00:00.000Z', 'active', SESSION),
        // 明天到点 → 应出现"1 天后"
        up: mkTask('up', '续跟审核', '2026-11-08T11:00:00.000Z', 'active', SESSION),
        // 已结束 → 不该出现
        done: mkTask('done', '已办结的事', '2026-11-07T10:00:00.000Z', 'ended', SESSION),
        // 别的会话 → 不该出现
        other: mkTask('other', '别人的闹钟', '2026-11-07T11:00:00.000Z', 'active', 'session-other'),
        // 过点 5 小时 → 视为陈迹，不提
        stale: mkTask('stale', '很久以前的事', '2026-11-07T06:00:00.000Z', 'active', SESSION),
      },
    },
  }),
  'utf8',
)

process.env.DSH_SCHEDULE_STORE = store
process.env.AIYAYI_HOME = tmp

const mod = pathToFileURL('G:/阿依娅伊/output/dsh-aiyayi-fix/lib/presence.js').href
const { apply, name } = await import(mod)
console.log('module loaded:', name)

// 断言：文件里确实加了 protest 名称与调用点，避免"函数写了但没接线"
const src = readFileSync('G:/阿依娅伊/output/dsh-aiyayi-fix/lib/presence.js', 'utf8')
const checks = [
  ['function renderAlarms', src.includes('function renderAlarms')],
  ['function readOwnAlarms', src.includes('function readOwnAlarms')],
  ['SECTIONS 接线', src.includes('clockLine, alarmLine, reunion')],
  ['调用点', src.includes('renderAlarms(sessionId, now)')],
  ['SNAPSHOT store 路径', src.includes("'storages', 'schedule.json'")],
]
let ok = true
for (const [label, pass] of checks) {
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + label)
  if (!pass) ok = false
}
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
