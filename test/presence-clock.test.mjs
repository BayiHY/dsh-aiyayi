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

// 模拟一次 pre-step：next() 返回一个决策，插件应追加一条含 [时间] 的 user 消息。
const realUser = {
  id: 'u1',
  role: 'user',
  content: [{ type: 'text', text: '现在几点' }],
  source: { kind: 'user' },
}
const decision = { kind: 'proceed', messages: [realUser] }
const result = await handler({ agent: { id: 'a1', session: { id: 's1' } }, step: 1, signal: new AbortController().signal }, async () => decision)

const injected = result.messages[result.messages.length - 1]
const text = injected.content.map((b) => b.text).join('\n')

if (!text.includes('[时间] 现在')) {
  throw new Error(`注入块里没有 [时间] 行，实际内容:\n${text}`)
}

const m = /\[时间\] 现在 (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) 周([日一二三四五六]) \(UTC([+-])(\d{2}):(\d{2})\)/.exec(text)
if (!m) {
  throw new Error(`[时间] 行格式不对，实际:\n${text}`)
}

const now = new Date()
const sameDay =
  Number(m[1]) === now.getFullYear() &&
  Number(m[2]) === now.getMonth() + 1 &&
  Number(m[3]) === now.getDate()
if (!sameDay) throw new Error(`日期不对: 注入 ${m[1]}-${m[2]}-${m[3]}，实际 ${now.toLocaleDateString('sv-SE')}`)

console.log('OK presence 时钟注入')
console.log('   注入行:', text.split('\n').find((l) => l.includes('[时间]')))
console.log('   工具:', registered.join(', '))

rmSync(home, { recursive: true, force: true })

// 与其他测试统一到 ALL PASS 约定，便于整套跑完统一判定
console.log('\nALL PASS')
