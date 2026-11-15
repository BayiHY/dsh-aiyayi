/**
 * 线上真实数据验证：直接读宿主的 storages/schedule.json，
 * 用真实 session id 跑 renderAlarms，确认能在真环境中渲染出 [闹钟] 行。
 *
 * 本测试需要真实 DSH 环境，设置 DSH_TEST_SESSION_ID 后运行；
 * 未设置即跳过（打一行 SKIP 后 exit 0），免得在别人的机器上
 * 因为硬编码的 session id 不存在而误报失败。
 *   DSH_TEST_SESSION_ID          要验的会话，多个用英文逗号分隔（必填）
 *   DSH_TEST_ARCHIVED_SESSION_ID 已归档会话，用于"无残留 active 闹钟"检查（可选）
 *
 * 断言策略：真实数据会变（任务被建/删/归档），所以只断言"不变量"——
 * 有 active 闹钟的会话必须渲染出主要内容，没有的必须安静。
 * 当前没有 active 闹钟指向任何测试会话时，跳过断言并如实说明（不算失败）。
 */
import { pathToFileURL } from 'node:url'

const SESSION_IDS = (process.env.DSH_TEST_SESSION_ID || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
const ARCHIVED_ID = (process.env.DSH_TEST_ARCHIVED_SESSION_ID || '').trim()

if (SESSION_IDS.length === 0) {
  console.log('SKIP  未设置 DSH_TEST_SESSION_ID —— 本测试需要真实 DSH 环境，设置后运行')
  process.exit(0)
}

const mod = await import('../lib/presence.js')
const { renderAlarms, readOwnAlarms } = mod.__testing

const SESSIONS = SESSION_IDS.map((sid, i) => [`env 会话 ${i + 1}`, sid])

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

// 已归档会话若仍挂着 active 闹钟，说明宿主没清——那是异常，值得报出来。
// 归档会话 id 也走环境变量，没给就只说明、不臆造。
if (ARCHIVED_ID) {
  const archived = readOwnAlarms(ARCHIVED_ID)
  check('已归档会话名下没有残留 active 闹钟', archived.length === 0, archived.map((a) => a.title).join(','))
} else {
  console.log('\n(未设置 DSH_TEST_ARCHIVED_SESSION_ID，跳过「已归档会话无残留闹钟」检查)')
}

if (asserted === 0) console.log('\n(无可用 active 真实闹钟，仅做观测)')
console.log(ok ? '\nALL PASS' : '\nSOME FAILED')
process.exit(ok ? 0 : 1)
