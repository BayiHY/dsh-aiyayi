/**
 * 线上真实数据验证：直接读宿主的 storages/schedule.json，
 * 用真实 session id 跑 renderAlarms，确认能在真环境中渲染出 [闹钟] 行。
 *
 * 断言策略：真实数据会变（任务被建/删/归档），所以只断言"不变量"——
 * 有 active 闹钟的会话必须渲染出主要内容，没有的必须安静。
 * 当前没有 active 闹钟指向任何测试会话时，跳过断言并如实说明（不算失败）。
 */
import { pathToFileURL } from 'node:url'

const mod = await import('../lib/presence.js')
const { renderAlarms, readOwnAlarms } = mod.__testing

const SESSIONS = [
  ['娅伊当前会话（曾挂 active 闹钟）', 'session-02c60dd4-55c3-43ab-b9bf-c7c7160e5369'],
  ['旧闹钟所属（已归档）', 'session-bf6364ea-4c1e-4c3e-a5ee-46b0e4d8ab7b'],
  ['主会话（无闹钟）', 'session-5dbce224-f8bd-4904-b24a-052e877dd261'],
]

let ok = true
let asserted = 0
const check = (l, c, e = '') => {
  console.log((c ? 'PASS' : 'FAIL') + '  ' + l + (c ? '' : '  ' + String(e)))
  if (!c) ok = false
}

for (const [label, sid] of SESSIONS) {
  const mine = readOwnAlarms(sid)
  const text = renderAlarms(sid, Date.now())
  console.log(`\n=== ${label} (${sid.slice(0, 20)}…) ===`)
  console.log('读出任务:', mine.length, mine.map((a) => `${a.title}@${a.iso}`).join(' | '))
  console.log('注入文本:', text ? '\n' + text : '(空，不注入)')

  if (mine.length > 0) {
    asserted++
    check(`${label}：有 active 闹钟时必须渲染出 [闹钟] 行`, text.startsWith('[闹钟]'), text.slice(0, 40))
    check(`${label}：标题必须出现`, mine.every((a) => text.includes(a.title)), text)
  } else {
    asserted++
    check(`${label}：无 active 闹钟时必须保持安静`, text === '', text)
  }
}

// 已归档会话若仍挂着 active 闹钟，说明宿主没清——那是异常，值得报出来
const archived = readOwnAlarms('session-bf6364ea-4c1e-4c3e-a5ee-46b0e4d8ab7b')
check('已归档会话名下没有残留 active 闹钟', archived.length === 0, archived.map((a) => a.title).join(','))

if (asserted === 0) console.log('\n(无可用 active 真实闹钟，仅做观测)')
console.log(ok ? '\nALL PASS' : '\nSOME FAILED')
process.exit(ok ? 0 : 1)
