/**
 * 路径可移植性测试：SCHEDULE_FILE 必须跟随 DSH_HOME，不能硬编码 ~/.dsh。
 *
 * 动机：读不到 store 的表现是"这一行静默消失"，没有任何报错——
 * 如果把路径写死成 ~/.dsh，而 DSH_HOME 指向别处，就会安静地永远不生效。
 * 这个测试用两个不同的 HOME 来锁死这一点。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), 'aiyayi-home-path')
mkdirSync(root, { recursive: true })

const SESSION = 'session-path-001'
const mkStore = (title) => JSON.stringify({
  tables: {
    tasks: {
      t: {
        record: { id: 'x', title, scheduledAt: '2026-11-08T01:30:00.000Z', prompt: 'p' },
        status: 'active',
        target: { kind: 'session', sessionId: SESSION },
        involvedSessionIds: [SESSION],
      },
    },
  },
})

// A 家在 <root>/homeA/storages，B 家在 <root>/homeB/storages，内容不同
const homeA = join(root, 'homeA')
const homeB = join(root, 'homeB')
for (const [home, title] of [[homeA, 'A 家的闹钟'], [homeB, 'B 家的闹钟']]) {
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'schedule.json'), mkStore(title), 'utf8')
}

let ok = true
const check = (label, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (cond ? '' : '\n        ' + String(extra)))
  if (!cond) ok = false
}

// 关键：模块在 import 时就求值 SCHEDULE_FILE，所以必须用两个独立进程来测。
// 这里用子进程分别以不同 DSH_HOME 跑同一段逻辑。
const modUrl = new URL('../lib/presence.js', import.meta.url).href
const { execFileSync } = await import('node:child_process')

function probe(home) {
  const script = `
    import('${modUrl}').then((m) => {
      const r = m.__testing.readOwnAlarms('${SESSION}')
      console.log(JSON.stringify(r.map((a) => a.title)))
    }).catch((e) => { console.error(String(e)); process.exit(1) })
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, DSH_HOME: home, DSH_SCHEDULE_STORE: '' },
    encoding: 'utf8',
  })
  return JSON.parse(out.trim().split('\n').pop())
}

const a = probe(homeA)
const b = probe(homeB)
check('DSH_HOME=A 时读到 A 家的闹钟', a.includes('A 家的闹钟'), a)
check('DSH_HOME=B 时读到 B 家的闹钟', b.includes('B 家的闹钟'), b)
check('A 读不到 B 的（证明不是硬编码同一路径）', !a.includes('B 家的闹钟'), a)

// 显式 DSH_SCHEDULE_STORE 优先级最高（测试与排障要用）
const explicit = join(root, 'explicit.json')
writeFileSync(explicit, mkStore('显式覆盖的闹钟'), 'utf8')
const script2 = `
  import('${modUrl}').then((m) => {
    const r = m.__testing.readOwnAlarms('${SESSION}')
    console.log(JSON.stringify(r.map((a) => a.title)))
  })
`
const out2 = execFileSync(process.execPath, ['--input-type=module', '-e', script2], {
  env: { ...process.env, DSH_HOME: homeA, DSH_SCHEDULE_STORE: explicit },
  encoding: 'utf8',
})
check('DSH_SCHEDULE_STORE 覆盖 DSH_HOME', JSON.parse(out2.trim().split('\n').pop()).includes('显式覆盖的闹钟'), out2)

console.log(ok ? '\nALL PASS' : '\nSOME FAILED')
process.exit(ok ? 0 : 1)
