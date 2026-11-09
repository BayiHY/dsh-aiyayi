/**
 * [闹钟·异常] 定时器异常检查单测（1.5.6）。
 * 造一份 schedule store → import presence.js → 调 __testing.renderAlarmAnomalies，
 * 断言三种异常（孤儿目标/投递回执缺失/paused 计数）与"无异常零输出"的静默原则。
 * 静默原则是本功能的主设计：无异常必须返回空串，一个字都不多。
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tmp = join(tmpdir(), 'aiyayi-alarm-check')
mkdirSync(tmp, { recursive: true })
const store = join(tmp, 'schedule.json')

const mkTask = (title, iso, status, sessionId, lastDelivery = null) => ({
  record: { id: 'x-' + title, title, scheduledAt: iso, prompt: 'p' },
  status,
  target: { kind: 'session', sessionId },
  ...(lastDelivery ? { lastDelivery } : {}),
})

const SESSION = 'session-a1b2c3d4-0000-0000-0000-000000000001' // 当前会话
const OTHER = 'session-e5f6a7b8-1111-2222-3333-444444444444'   // 别处（比如已归档旧会话）

process.env.DSH_SCHEDULE_STORE = store
process.env.AIYAYI_HOME = tmp

const mod = await import('../lib/presence.js')
const { renderAlarmAnomalies, shortSessionId } = mod.__testing

let ok = true
const check = (label, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (cond ? '' : '   ' + extra))
  if (!cond) ok = false
}

// ---------- 1. 孤儿目标 → 出警报行 ----------
writeFileSync(
  store,
  JSON.stringify({
    tables: {
      tasks: {
        // 真实案例的同款：active 任务目标在已归档旧会话，本会话永远收不到。
        orphan: mkTask('每日日记整理', '2026-11-10T02:15:00.000Z', 'active', OTHER),
        // 本会话自己的正常闹钟：[闹钟] 行管它，异常行不许重复。
        own: mkTask('本会话的正常闹钟', '2026-11-08T11:00:00.000Z', 'active', SESSION),
        // 已结束任务不算孤儿（不再触发，没有"投不进来"的问题）。
        done: mkTask('已办结', '2026-11-07T10:00:00.000Z', 'ended', SESSION),
      },
    },
  }),
  'utf8',
)
let text = renderAlarmAnomalies(SESSION)
console.log('\n--- 孤儿目标渲染 ---\n' + text + '\n-------------------\n')
check('孤儿目标出行', text.startsWith('[闹钟·异常]'), text.slice(0, 60))
check('点名孤儿任务标题', text.includes('每日日记整理'), text)
check('目标会话用短 id', text.includes('session-e5f6a7b8'), text)
check('带下次触发时刻', text.includes('下次'), text)
check('写明"目标会话不是这里"', text.includes('目标会话不是这里'), text)
check('附 schedule_edit 改投出路', text.includes('schedule_edit 改投本会话'), text)
check('本会话闹钟不进异常行（不与 [闹钟] 重复）', !text.includes('本会话的正常闹钟'), text)
check('已结束任务不报', !text.includes('已办结'), text)

// ---------- 2. 上次投递失败（回执缺失）→ 出警报行 ----------
writeFileSync(
  store,
  JSON.stringify({
    tables: {
      tasks: {
        // 回执三字段本该一起落（宿主投递确认后才写），缺 deliveredAt = 账目不完整。
        broken: mkTask('回执残缺的任务', '2026-11-09T02:15:00.000Z', 'active', SESSION, {
          scheduledAt: '2026-11-09T02:15:00.000Z',
          deliveredAt: null,
        }),
        // 对照组：回执三字段齐全 = 投递链路正常，不许报警。
        healthy: mkTask('回执齐全的任务', '2026-11-08T06:00:00.000Z', 'active', SESSION, {
          scheduledAt: '2026-11-08T06:00:00.000Z',
          deliveredAt: '2026-11-08T06:00:01.000Z',
          messageId: 'm-1',
        }),
      },
    },
  }),
  'utf8',
)
text = renderAlarmAnomalies(SESSION)
check('回执缺失出行', text.includes('投递回执缺失 1 条'), text)
check('点名回执残缺任务', text.includes('回执残缺的任务'), text)
check('写明 deliveredAt 缺失', text.includes('deliveredAt 缺失'), text)
check('正常回执（有 deliveredAt）不报警', !text.includes('回执齐全的任务'), text)

// ---------- 3. paused（inactive）计数，事实带过 ----------
writeFileSync(
  store,
  JSON.stringify({
    tables: {
      tasks: {
        p1: mkTask('暂停的旧闹钟', '2026-11-05T09:00:00.000Z', 'inactive', SESSION),
        p2: mkTask('暂停的另一个', '2026-11-06T09:00:00.000Z', 'inactive', SESSION),
      },
    },
  }),
  'utf8',
)
text = renderAlarmAnomalies(SESSION)
check('暂停任务计数出行', text === '[闹钟·异常] 另有 2 个暂停任务（inactive，不会触发）', text)

// ---------- 4. 全部正常 → 零输出（静默原则） ----------
writeFileSync(
  store,
  JSON.stringify({
    tables: {
      tasks: {
        own: mkTask('本会话的正常闹钟', '2026-11-08T11:00:00.000Z', 'active', SESSION),
        done: mkTask('已办结', '2026-11-07T10:00:00.000Z', 'ended', SESSION),
      },
    },
  }),
  'utf8',
)
check('全部正常返回空串', renderAlarmAnomalies(SESSION) === '', renderAlarmAnomalies(SESSION))

// ---------- 5. 空任务表 / 无文件 / 坏 JSON → 零输出 ----------
writeFileSync(store, JSON.stringify({ tables: { tasks: {} } }), 'utf8')
check('空任务表返回空串', renderAlarmAnomalies(SESSION) === '')
rmSync(store, { force: true })
check('store 不存在返回空串且不抛', renderAlarmAnomalies(SESSION) === '')
writeFileSync(store, 'not json at all', 'utf8')
check('坏 store 静默为空', renderAlarmAnomalies(SESSION) === '')

// ---------- 6. 孤儿超过 3 个：只列 3 条 + 报总数 ----------
const many = {}
many.noTarget = { record: { id: 'x-nt', title: '目标丢了的任务', scheduledAt: '2026-11-10T06:00:00.000Z' }, status: 'active' }
for (let i = 1; i <= 5; i++) {
  many['o' + i] = mkTask('孤儿' + i, '2026-11-10T0' + i + ':00:00.000Z', 'active', 'session-f1f2f3f' + i)
}
writeFileSync(store, JSON.stringify({ tables: { tasks: many } }), 'utf8')
text = renderAlarmAnomalies(SESSION)
check('只列前 3 条', ['目标丢了的任务', '孤儿1', '孤儿2'].every((t) => text.includes(t)) && !text.includes('孤儿3'), text)
check('超出部分报总数', text.includes('（等 6 个）'), text)
check('无目标任务标"无目标"', text.includes('目标丢了的任务→无目标'), text)

// ---------- 7. shortSessionId：短 id 口径 ----------
check('session- 前缀截前 8 位', shortSessionId('session-56d3c2f0-dcc0-49d1-bc57-a6970d0513ba') === 'session-56d3c2f0', shortSessionId('session-56d3c2f0-dcc0-49d1-bc57-a6970d0513ba'))
check('无前缀 id 也截前 8 位', shortSessionId('plain-id-123456789') === 'session-plain-id', shortSessionId('plain-id-123456789'))
check('空 id 报"无目标"', shortSessionId('') === '无目标' && shortSessionId(undefined) === '无目标', String(shortSessionId('')))

// ---------- 8. 会话 id 缺失 → 零输出（防御） ----------
check('sessionId 为空返回空串', renderAlarmAnomalies('') === '' && renderAlarmAnomalies(undefined) === '')

console.log(ok ? '\nALL PASS' : '\nSOME FAILED')
process.exit(ok ? 0 : 1)
