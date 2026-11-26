/**
 * 记忆三文件用法升级（schema v2）自检。
 *
 * 验四件事：
 *  1. ensureCore 生成的三文件模板自带 `<!-- schema: v2 -->`（新用户开箱即新版）；
 *  2. 存量老文件（无标记、索引行没"｜何时翻"、规则无用法说明）注入时给 AI 一条
 *     具体的一次性提示，且**绝不改写用户文件**；
 *  3. 同一会话只提示一次，新会话获得新的一次提示机会；
 *  4. 已经补齐用法的文件不再提示。
 *
 * 全程在临时沙盘（AIYAYI_HOME + 指路文件隔离），绝不碰真实记忆根。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = mkdtempSync(join(tmpdir(), 'aiyayi-schema-v2-'))
mkdirSync(join(root, 'memories'), { recursive: true })
process.env.AIYAYI_HOME = root

const homeLib = await import(pathToFileURL(new URL('../lib/home.js', import.meta.url).pathname).href)
homeLib.__testing.setPointerPath(join(root, 'location.json'))
const { apply } = await import(pathToFileURL(new URL('../lib/index.js', import.meta.url).pathname).href)

let section = null
apply({
  effect(fn) { fn(); return () => {} },
  on() { return () => {} },
  tools: { register() { return () => {} } },
  systemPrompt: { section(s) { section = s; return () => {} } },
})
if (!section) throw new Error('没注册 aiyayi:memory 段')
const text = (sessionId) => section.text({ agent: { session: { id: sessionId } } })

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}
const read = (name) => readFileSync(join(root, name), 'utf8')
const write = (name, content) => writeFileSync(join(root, name), content, 'utf8')

// ① 全新用户：模板自带 v2 标记，不误报升级。
let out = text('s-new')
check('ensureCore 补建三文件', ['memory.md', 'rules.md', 'index.md'].every((f) => existsSync(join(root, f))))
check('三文件模板都带 schema: v2 标记', ['memory.md', 'rules.md', 'index.md'].every((f) => read(f).includes('<!-- schema: v2 -->')))
check('全新 v2 文件不提示升级', !out.includes('[记忆三文件升级]'))
check('三文件注入段仍在', out.includes('【我的规则】') && out.includes('【记忆索引】'))

// ② 存量老文件：具体差异 + 零改写。
write('memory.md', '# 老核心\n- [2026-01-01] 事情｜老条目\n')
write('rules.md', '# 老规则\n\n【老段】\n老规矩正文。\n')
write('index.md', '<!-- 索引 -->\n- 用户/口味：爱吃辣\n- 事情/项目：老项目\n<!-- /索引 -->\n')
const before = ['memory.md', 'rules.md', 'index.md'].map(read)
out = text('s-old')
check('老文件注入一次性升级提示', out.includes('[记忆三文件升级]'))
for (const needle of ['schema: v2', '｜何时翻', 'rules.md 还没有用法说明段', '跟他说清', '他可以拒绝', '他点头后也**不擅自改文件**', 'memory_organize']) {
  check(`提示文案含「${needle}」`, out.includes(needle), out.slice(-900))
}
check('检测不改写用户文件', JSON.stringify(before) === JSON.stringify(['memory.md', 'rules.md', 'index.md'].map(read)))

// ③ 频率：同会话一次，新会话再来。
out = text('s-old')
check('同会话不再提示', !out.includes('[记忆三文件升级]'))
out = text('s-old-2')
check('新会话重新获得一次提示机会', out.includes('[记忆三文件升级]'))

// ④ 已升级的三文件：安静。
write('memory.md', '<!-- schema: v2 -->\n- [2026-01-01] 事情｜老条目\n')
write('rules.md', '<!-- schema: v2 -->\n<!-- 用法：规则是成段文字，move to:"rules" 升格 -->\n\n【老段】\n老规矩。\n')
write('index.md', '<!-- schema: v2 -->\n<!-- 索引 -->\n- 用户/口味：爱吃辣｜何时翻：聊吃时\n<!-- /索引 -->\n')
check('已升级文件不再提示', !text('s-fixed').includes('[记忆三文件升级]'))

console.log(ok ? 'ALL OK' : 'SOME FAILED')
if (!ok) process.exitCode = 1
