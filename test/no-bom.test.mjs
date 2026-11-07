/**
 * BOM 体检：包内任何文件带 UTF-8 BOM 都会让 DSH 读不出这个 bundle。
 *
 * 事故（2026-11-07）：某轮用 PowerShell `Set-Content -Encoding UTF8` 改
 * package.json 写版本号，Windows PowerShell 的 UTF8 默认带 BOM。结果：
 *   package.json 首字节 EF BB BF
 *   → JSON.parse 抛 "Unexpected token '﻿' ... is not valid JSON"
 *   → plugin_manager 里 dsh-aiyayi 变 availability:"missing"、rows:[]
 *   → 三个 preset-aiyayi* 全注册不上
 *   → 新建会话选阿依娅伊报 "Unknown agent preset: aiyayi"
 * 整个插件静默失效，而 lib/*.js 语法检查、单元测试全都还是绿的——
 * 因为没有一道闸看"文件字节"。
 *
 * 这道闸就是那个缺口：不测逻辑，只测字节头。
 * 覆盖 package.json、cordis.patch.yml、所有 lib/*.js、test/*.mjs、README、icon。
 *
 * 修复方式不是手改，是：
 *   const raw = [IO.File]::ReadAllBytes($f)
 *   [IO.File]::WriteAllBytes($f, $raw[3..($raw.Length-1)])
 * 别用 Get-Content/Set-Content 来回倒——会再引入 BOM 或改动换行。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** 参与体检的扩展名。.svg/.md 也查——bundle 的 icon 与说明同样会被读。 */
const CHECKED = ['.json', '.yml', '.yaml', '.js', '.mjs', '.md', '.svg']

/** 不查的目录：备份是历史快照，里面本就有旧版本。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'backup'])

/** 递归收集待检文件。 */
function collect(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collect(join(dir, entry.name), found)
      continue
    }
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (CHECKED.some((ext) => lower.endsWith(ext))) found.push(join(dir, entry.name))
  }
  return found
}

/** 判断文件是否以 UTF-8 BOM（EF BB BF）开头。 */
function hasBom(file) {
  const head = readFileSync(file).subarray(0, 3)
  return head.length === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf
}

const files = collect(ROOT)
if (files.length === 0) {
  console.error('FAIL 没扫到任何文件，体检脚本自己坏了')
  process.exit(1)
}

const bad = files.filter((file) => hasBom(file))

console.log(`扫了 ${files.length} 个文件（跳过 backup/、node_modules/）`)

if (bad.length > 0) {
  console.error('')
  console.error(`FAIL 发现 ${bad.length} 个文件带 UTF-8 BOM：`)
  for (const file of bad) console.error(`  ${relative(ROOT, file)}`)
  console.error('')
  console.error('带 BOM 的 package.json 会让整个 bundle 读不出来（availability:"missing"），')
  console.error('三个 preset-aiyayi* 全部注册失败。清 BOM 用：')
  console.error('  $raw = [IO.File]::ReadAllBytes($f); [IO.File]::WriteAllBytes($f, $raw[3..($raw.Length-1)])')
  process.exit(1)
}

// 顺带确认 package.json 真能 parse——BOM 之外，JSON 破损同样致命。
const pkgFile = join(ROOT, 'package.json')
try {
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  if (!pkg.name || !pkg.version) throw new Error('缺 name 或 version')
  if (pkg.dsh?.bundle?.patch === undefined) throw new Error('缺 dsh.bundle.patch（bundle 声明没了）')
  console.log(`package.json 可解析：${pkg.name}@${pkg.version}，patch=${pkg.dsh.bundle.patch}`)
} catch (error) {
  console.error(`FAIL package.json: ${error.message}`)
  process.exit(1)
}

// patch 声明与磁盘文件要对得上——patch 指向不存在的文件同样是静默失效。
const patchPath = join(ROOT, 'package.json')
const declared = JSON.parse(readFileSync(patchPath, 'utf8')).dsh.bundle.patch.replace(/^\.\//, '')
const declaredFile = join(ROOT, declared)
try {
  if (!statSync(declaredFile).isFile()) throw new Error('不是文件')
  console.log(`patch 文件存在：${declared}`)
} catch {
  console.error(`FAIL dsh.bundle.patch 指向的文件不存在：${declared}`)
  process.exit(1)
}

console.log('')
console.log('ALL PASS  无 BOM，package.json 与 patch 声明完好')
