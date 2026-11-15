/**
 * 1.7.1：百宝袋（toolbox）脚本路径跟着记忆根走 —— 单测。
 *
 * 修的是什么 bug（2026-11-15 实锤）：`toolbox.json` 的 `script` 存的是**绝对路径**，
 * 记忆根一搬家（`/root/.dsh/aiyayi` → `/sdcard/1/dsh/aiyayi-memory`）、旧目录一改名，
 * 11 条工具的脚本全部悬空、全部注册失败（problems 11 条）。加载器当时只展开 `~` 与
 * `%VAR%`，压根没利用 `location.json` 给出的记忆根。
 *
 * 覆盖（对应任务书测试要求 ①②③④）：
 *   ① 相对路径（`tools/x.js` / `./tools/x.js`）在 root 下能解析；
 *   ② 老清单里的绝对路径仍可用（向后兼容，升级不让现有清单失效）；
 *   ③ 绝对路径失效但 `<root>/tools/<basename>` 存在时能自动重定位（并给 warning，不判失败）；
 *   ④ 两者都不存在时 problems 有正确报错（且**分情况**：变量没定义 / 没有记忆根 / 确实不存在）。
 * 另覆盖：`${AIYAYI_TOOLBOX_ROOT}` 在解析阶段就预置、cwd 同一条解析链、
 * toolbox_list 的 scriptSource 标位、加载器（loadManifest + createManifestManager）端到端。
 *
 * 全程在临时沙盘里造记忆根，**绝不碰真实记忆目录**（AIYAYI_HOME 定向 + 指路文件隔离）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-toolbox-root-'))
const root = join(sandbox, 'memory-root')
mkdirSync(join(root, 'tools'), { recursive: true })
process.env.AIYAYI_HOME = root

const mf = await import(libUrl('toolkit-manifest.js'))
const { __testing: homeTesting } = await import(libUrl('home.js'))
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ------------------------------------------------------------------ *
 * 0. 夹具：<root>/tools/ 下的脚本 + 一个"搬家前的旧根"
 * ------------------------------------------------------------------ */
const okScript = (file) => writeFileSync(file, "process.stdout.write(JSON.stringify({ ok: true, hint: '跑完了' }))\n", 'utf8')

const toolScript = join(root, 'tools', 'vision_ask.js')
okScript(toolScript)
const subScript = join(root, 'tools', 'deep', 'scan.js')
mkdirSync(join(root, 'tools', 'deep'), { recursive: true })
okScript(subScript)
// "搬家前的旧记忆根"：已改名，旧路径下的脚本一律不存在
const oldRoot = join(sandbox, 'old-root-renamed')
const staleScript = join(oldRoot, 'tools', 'vision_ask.js')

const asSlash = (p) => p.replace(/\\/g, '/')
/** 把清单写到 <root>/toolbox.json（加载器默认就在这里找）。 */
const writeManifest = (obj) => writeFileSync(join(root, 'toolbox.json'), JSON.stringify(obj, null, 2), 'utf8')

/* ------------------------------------------------------------------ *
 * 1. 纯函数 resolveManifestPath：四种解析结果
 * ------------------------------------------------------------------ */
check('resolveManifestPath：空值是 empty',
  mf.resolveManifestPath('', { root }).kind === 'empty')
check('resolveManifestPath：绝对路径原样（absolute，不改写）',
  mf.resolveManifestPath(asSlash(toolScript), { root }).path === asSlash(toolScript)
  && mf.resolveManifestPath(asSlash(toolScript), { root }).kind === 'absolute')
check('resolveManifestPath：tools/x.js 相对记忆根（relative）',
  mf.resolveManifestPath('tools/vision_ask.js', { root }).path === resolve(toolScript)
  && mf.resolveManifestPath('tools/vision_ask.js', { root }).kind === 'relative',
  mf.resolveManifestPath('tools/vision_ask.js', { root }).path)
check('resolveManifestPath：./tools/x.js 同样相对记忆根',
  mf.resolveManifestPath('./tools/vision_ask.js', { root }).path === resolve(toolScript),
  mf.resolveManifestPath('./tools/vision_ask.js', { root }).path)
check('resolveManifestPath：没有 root 时相对路径不瞎拼（no-root，path 保留相对值）',
  mf.resolveManifestPath('tools/vision_ask.js', { root: '' }).kind === 'no-root'
  && mf.resolveManifestPath('tools/vision_ask.js', { root: '' }).path === 'tools/vision_ask.js')
check('resolveManifestPath：${AIYAYI_TOOLBOX_ROOT} 解析阶段就预置成当前记忆根',
  mf.resolveManifestPath('${AIYAYI_TOOLBOX_ROOT}/tools/vision_ask.js', { root, env: {} }).path === join(root, 'tools', 'vision_ask.js').replace(/\\/g, '/')
  || mf.resolveManifestPath('${AIYAYI_TOOLBOX_ROOT}/tools/vision_ask.js', { root, env: {} }).path === `${root}/tools/vision_ask.js`,
  mf.resolveManifestPath('${AIYAYI_TOOLBOX_ROOT}/tools/vision_ask.js', { root, env: {} }).path)
check('resolveManifestPath：未定义变量识别成 undefined-var 并带变量名',
  mf.resolveManifestPath('%NO_SUCH_DIR%/x.js', { root, env: {} }).kind === 'undefined-var'
  && mf.resolveManifestPath('%NO_SUCH_DIR%/x.js', { root, env: {} }).variable === 'NO_SUCH_DIR')

/* ------------------------------------------------------------------ *
 * 2. ① 相对路径在 root 下能解析（单条校验 + 经 parseManifestText）
 * ------------------------------------------------------------------ */
const base = { name: 'demo_tool', enabled: true, description: '演示工具', timeoutMs: 5000 }

const relEntry = mf.validateEntry({ ...base, script: 'tools/vision_ask.js' }, { index: 0, root })
check('①相对路径：校验通过、无 problems', relEntry.problems.length === 0, JSON.stringify(relEntry.problems))
check('①相对路径：script 解析成 <root>/tools/… 的绝对路径', relEntry.script === resolve(toolScript), relEntry.script)
check('①相对路径：scriptExists=true', relEntry.scriptExists === true)
check('①相对路径：scriptSource 标成 relative', relEntry.scriptSource === 'relative', relEntry.scriptSource)

const relDotEntry = mf.validateEntry({ ...base, script: './tools/vision_ask.js' }, { index: 0, root })
check('①相对路径：./tools/x.js 写法同样通过', relDotEntry.problems.length === 0 && relDotEntry.scriptExists === true, JSON.stringify(relDotEntry.problems))

const relSubEntry = mf.validateEntry({ ...base, script: 'tools/deep/scan.js' }, { index: 0, root })
check('①相对路径：子目录（tools/deep/scan.js）也按记忆根拼', relSubEntry.problems.length === 0 && relSubEntry.scriptExists === true, JSON.stringify(relSubEntry.problems))

const templateEntry = mf.validateEntry({ ...base, script: '${AIYAYI_TOOLBOX_ROOT}/tools/vision_ask.js' }, { index: 0, root, env: {} })
check('①变量写法：${AIYAYI_TOOLBOX_ROOT} 能通过绝对路径校验（不再撞"必须是绝对路径"）',
  templateEntry.problems.length === 0 && templateEntry.scriptExists === true, JSON.stringify(templateEntry.problems))

// 相对路径经整份清单解析（parseManifestText 带 root）
const relParsed = mf.parseManifestText(JSON.stringify({ version: 1, tools: [{ ...base, script: 'tools/vision_ask.js' }] }), { root })
check('①相对路径：parseManifestText 传 root 后 0 problems', relParsed.problems.length === 0, JSON.stringify(relParsed.problems))
check('①相对路径：parseManifestText 把 root 原样带回', relParsed.root === root, relParsed.root)

/* ------------------------------------------------------------------ *
 * 3. ② 老清单里的绝对路径仍可用（向后兼容）
 * ------------------------------------------------------------------ */
const absEntry = mf.validateEntry({ ...base, script: asSlash(toolScript) }, { index: 0, root })
check('②老绝对路径：照旧通过、0 problems', absEntry.problems.length === 0, JSON.stringify(absEntry.problems))
check('②老绝对路径：script 仍是那条绝对路径（没被改写成别的）', absEntry.script === asSlash(toolScript), absEntry.script)
check('②老绝对路径：scriptSource 标成 absolute', absEntry.scriptSource === 'absolute', absEntry.scriptSource)
check('②老绝对路径：不传 root 也能用（纯绝对路径不依赖记忆根）',
  mf.validateEntry({ ...base, script: asSlash(toolScript) }, { index: 0 }).problems.length === 0)

writeManifest({ version: 1, tools: [{ ...base, name: 'abs_only', script: asSlash(toolScript) }] })
const absNoRootLoad = mf.loadManifest({ root })
check('②老绝对路径：经完整加载器（loadManifest + root）仍注册得上、0 problems',
  absNoRootLoad.problems.length === 0 && absNoRootLoad.entries[0].scriptExists === true, JSON.stringify(absNoRootLoad.problems))

/* ------------------------------------------------------------------ *
 * 4. ③ 绝对路径失效 + <root>/tools/<basename> 存在 → 自动重定位
 * ------------------------------------------------------------------ */
const relocated = mf.validateEntry({ ...base, script: asSlash(staleScript) }, { index: 0, root })
check('③重定位：旧绝对路径失效但 <root>/tools/ 有同名脚本 → 不判失败',
  relocated.problems.length === 0, JSON.stringify(relocated.problems))
check('③重定位：script 指向 <root>/tools/vision_ask.js', relocated.script === resolve(toolScript), relocated.script)
check('③重定位：scriptExists=true', relocated.scriptExists === true)
check('③重定位：scriptSource 标成 relocated', relocated.scriptSource === 'relocated', relocated.scriptSource)
check('③重定位：给了一条 warning（提示清单里写的是旧路径、已按记忆根重定位）',
  relocated.warnings.length === 1 && relocated.warnings[0].includes('已按记忆根重定位') && relocated.warnings[0].includes('相对路径'),
  JSON.stringify(relocated.warnings))

// warning 要经 parseManifestText 汇进清单级 warnings（由 manager 报回会话，不能只在条目里闷着）
const relocatedParsed = mf.parseManifestText(
  JSON.stringify({ version: 1, tools: [{ ...base, script: asSlash(staleScript) }] }),
  { root },
)
check('③重定位：清单级 warnings 里能看到这条重定位提示',
  relocatedParsed.warnings.length === 1 && relocatedParsed.warnings[0].includes('已按记忆根重定位'),
  JSON.stringify(relocatedParsed.warnings))

/* ------------------------------------------------------------------ *
 * 5. ④ 两者都不存在 → problems 报错（且分情况，文案不误导）
 * ------------------------------------------------------------------ */
const bothMissing = mf.validateEntry({ ...base, script: asSlash(join(oldRoot, 'tools', 'ghost.js')) }, { index: 0, root })
check('④都不存在：problems 非空且说"脚本不存在"',
  bothMissing.problems.length === 1 && bothMissing.problems[0].includes('脚本不存在'), JSON.stringify(bothMissing.problems))
check('④都不存在：报错里带上"也按 basename 找过 <root>/tools/…"（说明兜底试过了）',
  bothMissing.problems[0].includes('同样不存在'), JSON.stringify(bothMissing.problems))
check('④都不存在：scriptExists=false、不标 relocated', bothMissing.scriptExists === false && bothMissing.scriptSource !== 'relocated')

const relMissing = mf.validateEntry({ ...base, script: 'tools/ghost.js' }, { index: 0, root })
check('④相对路径不存在：报错讲清"相对路径已按记忆根解析"',
  relMissing.problems.length === 1 && relMissing.problems[0].includes('脚本不存在') && relMissing.problems[0].includes('相对路径'),
  JSON.stringify(relMissing.problems))

const noRootEntry = mf.validateEntry({ ...base, script: 'tools/vision_ask.js' }, { index: 0 })
check('④没有记忆根：报"没有可用的记忆根来拼"（不是误导性的"必须是绝对路径"）',
  noRootEntry.problems.length === 1 && noRootEntry.problems[0].includes('没有可用的记忆根'),
  JSON.stringify(noRootEntry.problems))

const undefinedVar = mf.validateEntry({ ...base, script: '%NO_SUCH_DIR%/x.js' }, { index: 0, root, env: {} })
check('④变量没定义：报"变量 NO_SUCH_DIR 没有定义"（与"相对路径"/"不存在"明确分开）',
  undefinedVar.problems.length === 1 && undefinedVar.problems[0].includes('NO_SUCH_DIR') && undefinedVar.problems[0].includes('没有定义'),
  JSON.stringify(undefinedVar.problems))
check('④旧文案"必须是绝对路径"不再用来描述相对路径（不再掩盖真实原因）',
  !relMissing.problems[0].includes('必须是绝对路径') && !noRootEntry.problems[0].includes('必须是绝对路径'))

const notFile = join(root, 'tools', 'a-dir.js')
mkdirSync(notFile, { recursive: true })
const dirEntry = mf.validateEntry({ ...base, script: 'tools/a-dir.js' }, { index: 0, root })
check('④路径存在但是目录 → 报"不是普通文件"',
  dirEntry.problems.length === 1 && dirEntry.problems[0].includes('不是普通文件'), JSON.stringify(dirEntry.problems))

/* ------------------------------------------------------------------ *
 * 6. cwd 与 script 同一条解析链（搬家后 cwd 也不该悬空）
 * ------------------------------------------------------------------ */
const relCwd = mf.validateEntry({ ...base, script: 'tools/vision_ask.js', cwd: 'tools' }, { index: 0, root })
check('cwd：相对路径按记忆根解析、0 problems', relCwd.problems.length === 0 && relCwd.cwd === resolve(join(root, 'tools')), JSON.stringify([relCwd.problems, relCwd.cwd]))
check('cwd：相对路径不存在时报"cwd 不存在"',
  mf.validateEntry({ ...base, script: 'tools/vision_ask.js', cwd: 'no-such-dir' }, { index: 0, root }).problems.some((p) => p.includes('cwd 不存在')))

/* ------------------------------------------------------------------ *
 * 7. 端到端：加载器（loadManifest + createManifestManager）
 * ------------------------------------------------------------------ */
writeManifest({
  version: 1,
  tools: [
    { ...base, name: 'rel_tool', script: 'tools/vision_ask.js' },
    { ...base, name: 'abs_tool', script: asSlash(toolScript) },
    { ...base, name: 'relocated_tool', script: asSlash(staleScript) },
    { ...base, name: 'gone_tool', script: 'tools/ghost.js' },
  ],
})
const loaded = mf.loadManifest({ root })
check('端到端：三条好条目 0 problems，只有真不存在的进 problems',
  loaded.problems.length === 1 && loaded.problems[0].name === 'gone_tool', JSON.stringify(loaded.problems))
check('端到端：重定位那条进的是 warnings（不判失败）',
  loaded.warnings.some((w) => w.includes('已按记忆根重定位')), JSON.stringify(loaded.warnings))

const registered = new Map()
const manager = mf.createManifestManager({
  addTool: (n, def, impl) => registered.set(n, { def, impl }),
  removeTool: (n) => registered.delete(n),
  registerOwnTool: () => {},
  cfg: {},
  env: { ...process.env },
})
const report = manager.load()
check('端到端：相对 / 绝对 / 重定位 三条都注册上了',
  report.registered.filter((n) => ['rel_tool', 'abs_tool', 'relocated_tool'].includes(n)).length === 3,
  JSON.stringify(report.registered))
check('端到端：真不存在的那条被跳过并列进 problems',
  !report.registered.includes('gone_tool') && report.problems.some((p) => p.includes('gone_tool')), JSON.stringify(report.problems))
check('端到端：重定位的 warning 进了待报回会话的 issue 队列',
  manager.takePendingIssues().some((line) => line.includes('已按记忆根重定位')), JSON.stringify(manager.takePendingIssues()))

// toolbox_list 巡检：scriptSource 让"靠重定位活着的条目"显形
const inspected = manager.inspect().tools
check('端到端：toolbox_list 里 relative / absolute / relocated 三种来源都标出来了',
  inspected.find((t) => t.name === 'rel_tool')?.scriptSource === 'relative'
  && inspected.find((t) => t.name === 'abs_tool')?.scriptSource === 'absolute'
  && inspected.find((t) => t.name === 'relocated_tool')?.scriptSource === 'relocated',
  JSON.stringify(inspected.map((t) => [t.name, t.scriptSource])))
check('端到端：toolbox_list 的 script 都是绝对路径（相对路径已拼好）',
  inspected.filter((t) => t.scriptSource !== 'absolute' || true).every((t) => t.script.startsWith('/') || /^[A-Za-z]:/.test(t.script)),
  JSON.stringify(inspected.map((t) => t.script)))

// 搬家演练：root 换到新目录（旧目录改名），清单一个字不改，仍能全注册
const movedRoot = join(sandbox, 'moved-memory')
mkdirSync(join(movedRoot, 'tools'), { recursive: true })
okScript(join(movedRoot, 'tools', 'vision_ask.js'))
writeFileSync(join(movedRoot, 'toolbox.json'), JSON.stringify({
  version: 1,
  tools: [
    { ...base, name: 'rel_tool', script: 'tools/vision_ask.js' },
    { ...base, name: 'relocated_tool', script: asSlash(staleScript) },
  ],
}, null, 2), 'utf8')
const movedLoad = mf.loadManifest({ root: movedRoot })
check('搬家演练：清单不改一个字，root 换到新目录后两条都能解析',
  movedLoad.problems.length === 0 && movedLoad.entries.every((e) => e.scriptExists === true),
  JSON.stringify(movedLoad.problems))

/* ------------------------------------------------------------------ *
 * 8. 搬家自检（auditManifestPaths）：location.json 的自检只看 memory.md，不看清单；
 *    这里补上"清单里哪些路径一搬家就悬空"的只读提示。
 * ------------------------------------------------------------------ */
const freshRoot = join(sandbox, 'audit-root')
mkdirSync(join(freshRoot, 'tools'), { recursive: true })
okScript(join(freshRoot, 'tools', 'vision_ask.js'))
writeFileSync(join(freshRoot, 'toolbox.json'), JSON.stringify({
  version: 1,
  tools: [
    { ...base, name: 'good_rel', script: 'tools/vision_ask.js' },
    { ...base, name: 'risky_abs', script: asSlash(join(freshRoot, 'tools', 'vision_ask.js')) },
    { ...base, name: 'outside_abs', script: asSlash(join(sandbox, 'elsewhere', 'other.js')) },
  ],
}, null, 2), 'utf8')
// outside_abs 指向根外且不存在 → 会进 problems，但不影响路径审计（审计只看"会不会悬空"）。
const audit = mf.auditManifestPaths({ root: freshRoot, newRoot: join(sandbox, 'future-root') })
check('自检：相对路径不算风险（relative 计数 1）', audit.relative === 1, JSON.stringify(audit.relative))
check('自检：记忆根内的绝对路径被点名为风险', audit.absoluteInside === 1 && audit.ok === false, JSON.stringify([audit.absoluteInside, audit.ok]))
check('自检：风险提示里带目标根与改法',
  audit.warnings.length === 1 && audit.warnings[0].includes('future-root') && audit.warnings[0].includes('相对路径'),
  JSON.stringify(audit.warnings))
check('自检：根外的绝对路径不误报（与本根无关，不催人改）',
  !audit.warnings.some((w) => w.includes('outside_abs')), JSON.stringify(audit.warnings))

const allRelRoot = join(sandbox, 'all-relative-root')
mkdirSync(join(allRelRoot, 'tools'), { recursive: true })
okScript(join(allRelRoot, 'tools', 'vision_ask.js'))
writeFileSync(join(allRelRoot, 'toolbox.json'), JSON.stringify({
  version: 1, tools: [{ ...base, name: 'only_rel', script: 'tools/vision_ask.js' }],
}, null, 2), 'utf8')
const cleanAudit = mf.auditManifestPaths({ root: allRelRoot })
check('自检：全相对路径的清单 → 0 警告、ok=true（搬家不用改清单）',
  cleanAudit.ok === true && cleanAudit.warnings.length === 0, JSON.stringify(cleanAudit))

const noManifestAudit = mf.auditManifestPaths({ root: join(sandbox, 'no-manifest-root') })
check('自检：清单不存在 → exists=false、0 警告、不抛', noManifestAudit.exists === false && noManifestAudit.ok === true, JSON.stringify(noManifestAudit))

/* ------------------------------------------------------------------ *
 * 收尾
 * ------------------------------------------------------------------ */
try {
  rmSync(sandbox, { recursive: true, force: true })
} catch {
  /* 清理失败不盖掉测试结果 */
}
console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)
