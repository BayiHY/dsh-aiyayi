/**
 * memory_organize 的 schema 动作 + schema 标记解析豁免（1.25.0）回归测试。
 *
 * 验四件事：
 *  1. `<!-- schema: v2 -->` 这一行在健康度（keepRules 口径）里不计 nonEntry；
 *  2. 同一行不进 renderCore 的注入正文（默认口径）——不能只靠 STRUCTURAL_RULES 兜；
 *  3. 新 action:"schema" 幂等：已带标记的文件一字不动；没带的只插这一行、不改任何现有字节；
 *  4. 只认三文件（core/rules/index），不接任意路径写入。
 *
 * 全程在临时沙盘（AIYAYI_HOME + 指路文件隔离），绝不碰真实记忆根。
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-schema-action-'))
const root = join(sandbox, 'root')
mkdirSync(join(root, 'memories'), { recursive: true })
process.env.AIYAYI_HOME = root

const { apply, __testing } = await import(libUrl('index.js'))
const home = await import(libUrl('home.js'))
home.__testing.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
home.__testing.pointerCacheReset()
home.__testing.setOverride(undefined)

const { fileHealth, renderCore } = __testing

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

const MARK = '<!-- schema: v2 -->'
const corePath = () => join(root, 'memory.md')
const rulesPath = () => join(root, 'rules.md')
const indexPath = () => join(root, 'index.md')
const read = (p) => readFileSync(p, 'utf8')
const write = (p, s) => writeFileSync(p, s, 'utf8')

// 假 ctx：接住 memory_organize 工具定义
const tools = new Map()
let section = null
apply({
  effect(fn) { fn(); return () => {} },
  on() { return () => {} },
  tools: { register(def) { tools.set(def.name, def); return () => {} } },
  systemPrompt: { section(s) { section = s; return () => {} } },
})
const organize = tools.get('memory_organize')

/* ------------------------------------------------------------------ *
 * ① schema 标记在健康度里不计 nonEntry
 * ------------------------------------------------------------------ */
{
  const withMark = [
    '# 核心记忆',
    '',
    MARK,
    '- [2026-11-13 10:00] 事情｜先跑测试再发版',
    '- [2026-11-13 10:05] 用户｜他喜欢安静地聊',
    '',
  ].join('\n')
  const withoutMark = withMark.replace(`${MARK}\n`, '')
  const hWith = fileHealth(withMark, { isCore: true })
  const hWithout = fileHealth(withoutMark, { isCore: true })
  check('health：带 schema 行时 nonEntry=0', hWith.nonEntry === 0, JSON.stringify(hWith))
  check('health：带不带标记，entries/bytes 之外口径一致（nonEntry 都是 0）', hWithout.nonEntry === 0 && hWith.entries === hWithout.entries, `${JSON.stringify(hWith)} / ${JSON.stringify(hWithout)}`)
}

/* ------------------------------------------------------------------ *
 * ② schema 标记不进 renderCore 注入正文（默认口径）
 * ------------------------------------------------------------------ */
{
  // 标记放在 memory.md（核心条目正文走 isStructuralLine 默认口径），rules/index 不含标记，
  // 这样"注入全文不含标记"的断言只考察核心正文这一条路径。
  write(corePath(), ['# 核心记忆', '', MARK, '- [2026-11-13 10:00] 事情｜注入正文别带标记', ''].join('\n'))
  // rules/index 也带标记（对齐新用户模板状态），避免一次性升级提示文案提到标记串干扰断言。
  write(rulesPath(), ['# 规则', '', MARK, '<!-- 用法：规则是成段文字，move to:"rules" 升格 -->', '', '成段规则正文。', ''].join('\n'))
  write(indexPath(), [MARK, '<!-- 索引 -->', '- 用户/口味：爱吃辣｜何时翻：聊吃时', '<!-- /索引 -->', ''].join('\n'))
  const injected = section.text({ agent: { session: { id: 's-schema-exempt' } } })
  // 设计边界（1.21.0 起）：【我的规则】= rules.md 全文原样注入（模板注释也在），
  // 不走 isStructuralLine——新用户的 rules.md 模板本就带标记并被注入，这里不越界改它。
  // isStructuralLine 管辖的两条豁免路径分开验：
  //  a) 核心条目正文（默认口径）：条目在、标记不在——全文里标记只出现 rules 段那 1 次；
  //  b) 索引段（stripIndexComments 剥注释）：索引部分一个标记都没有。
  const markCount = injected.split(MARK).length - 1
  check('renderCore 核心正文不含 schema 标记（条目在、标记不在）', markCount === 1 && injected.includes('注入正文别带标记'), `标记出现 ${markCount} 次（应为 1，仅 rules 全文段）\n${injected.slice(-600)}`)
  const indexPart = injected.split('【记忆索引】')[1] ?? ''
  check('renderCore 索引段不含 schema 标记行', !indexPart.includes(MARK), indexPart)
  check('renderCore 仍注入真实条目/规则/索引', injected.includes('注入正文别带标记') && injected.includes('成段规则正文') && injected.includes('爱吃辣'))
}

/* ------------------------------------------------------------------ *
 * ③ schema 动作：只插标记、幂等、默认三文件 / path 限定
 * ------------------------------------------------------------------ */
{
  // 用临时复制的三文件（不含标记）做测试，别动真实记忆库
  const CORE = ['# 核心记忆', '', '- [2026-11-13 10:00] 事情｜老条目', ''].join('\n')
  const RULES = ['# 规则', '', '先验证再动手。', ''].join('\n')
  const INDEX = ['<!-- 索引 -->', '- 用户/口味：爱吃辣｜何时翻：聊吃时', '<!-- /索引 -->', ''].join('\n')
  write(corePath(), CORE)
  write(rulesPath(), RULES)
  write(indexPath(), INDEX)

  const result = await organize.execute({ action: 'schema' })
  check('schema 默认处理三文件：done=true', result.done === true, JSON.stringify(result))
  for (const [label, p] of [['memory.md', corePath()], ['rules.md', rulesPath()], ['index.md', indexPath()]]) {
    const after = read(p)
    check(`${label} 补上了 schema 标记`, after.includes(MARK), after)
    check(`${label} 标记在标题之后、第一行正文之前`, after.indexOf(MARK) < after.indexOf('- [2026-11-13') || label !== 'memory.md', after)
    // 去掉标记行后，必须与原文逐字节相同
    const stripped = after.split('\n').filter((line) => line.trim() !== MARK).join('\n')
    check(`${label} 除了标记行，其余字节不变`, stripped === ({ [corePath()]: CORE, [rulesPath()]: RULES, [indexPath()]: INDEX })[p], `${JSON.stringify(stripped)} vs ${JSON.stringify(({ [corePath()]: CORE, [rulesPath()]: RULES, [indexPath()]: INDEX })[p])}`)
  }

  // 幂等：再跑一次，三文件一字不动
  const snapshot = [corePath(), rulesPath(), indexPath()].map(read)
  const again = await organize.execute({ action: 'schema' })
  check('schema 幂等：第二次 done=true', again.done === true, JSON.stringify(again))
  check('schema 幂等：三文件一字不动', JSON.stringify(snapshot) === JSON.stringify([corePath(), rulesPath(), indexPath()].map(read)))

  // path 限定：只处理 core
  write(corePath(), CORE)
  write(rulesPath(), RULES)
  write(indexPath(), INDEX)
  const one = await organize.execute({ action: 'schema', path: 'core' })
  check('schema path="core"：done=true', one.done === true, JSON.stringify(one))
  check('schema path="core"：只动 memory.md', read(corePath()).includes(MARK) && !read(rulesPath()).includes(MARK) && !read(indexPath()).includes(MARK))

  // 拒绝任意路径写入
  let rejected = false
  try { await organize.execute({ action: 'schema', path: '../../etc/passwd' }) } catch { rejected = true }
  check('schema 拒绝任意路径写入（只认三文件）', rejected === true)
}

console.log(ok ? 'ALL OK' : 'SOME FAILED')
if (!ok) process.exitCode = 1
