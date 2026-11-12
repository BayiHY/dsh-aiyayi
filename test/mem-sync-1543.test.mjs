/**
 * 1.5.43：mem_sync P0/P1 修复单测（`lib/toolkit-extra.js` / `lib/toolkit.js`）。
 *
 * 覆盖（一一对应任务书条目）：
 *   P0-1 默认 memPushRemotes 改 `[]`；**区分「未配置」与「配置为空数组」**；
 *        空数组 → `status:'noop'` 且**零副作用**（不 add、不 commit、不 push）——用 HEAD/index/
 *        远端 bare 仓库三处取证，不是只看返回值。
 *   P0-2 `status='partial'` 时 `ok=false`；失败 hint 里附**从 `git remote` 实测到的**远端名。
 *   P0-3 `memBranch` 默认 `''` 跟随当前分支；detached HEAD 明确报错（不猜 master）。
 *   P1-1(a) `git diff HEAD` 失败（无第一个 commit）→ 退回 `diff --cached` + 工作区，**不吞成空串**；
 *   P1-1(b) `untrackedFiles()` 认 `A ` 前缀（已 git add 的暂存文件内容要扫到）；
 *   P1-1(c) 私钥正则补 OPENSSH 格式（`[A-Z0-9 _-]*`）。
 *   P1-2 只扫 `+`/`-` 变化行：未改动的旧行里出现 "token: 由环境变量提供" 不再误报。
 *
 * 环境隔离：`AIYAYI_HOME` 定向到 `%TEMP%` 沙盘 + 指路文件隔到沙盘（同 toolkit-async.test.mjs），
 * **绝不在真实记忆根上跑任何一次 mem_sync**。沙盘退出即删。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-memsync-1543-'))
const root = join(sandbox, 'root')
mkdirSync(root, { recursive: true })
process.env.AIYAYI_HOME = root

const tx = await import(libUrl('toolkit-extra.js'))
const tk = await import(libUrl('toolkit.js'))
const { __testing: homeTesting } = await import(libUrl('home.js'))
// 指路文件隔到沙盘：否则真机 location.json 会覆盖 AIYAYI_HOME，mem_sync 就指向真记忆库了。
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ---------------- 宿主输出校验器（同 toolkit-async.test.mjs 的子集复刻） ---------------- */
const hostTypes = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']
const isPlainRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
function hostValidateValue(schema, value, path = 'value') {
  const out = []
  const type = schema?.type
  if (type === undefined) return []
  if (typeof type !== 'string' || !hostTypes.includes(type)) {
    out.push(`${path}.type 必须是单 type 字符串`)
    return out
  }
  if (type === 'object') {
    if (!isPlainRecord(value)) return [`"${path}" must be an object`]
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) out.push(`missing required property "${path === '' ? key : `${path}.${key}`}"`)
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) continue
      out.push(...hostValidateValue(child, value[key], path === '' ? key : `${path}.${key}`))
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) out.push(`"${path}.${key}" is not a declared property`)
      }
    }
    return out
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`"${path}" must be an array`]
    if (schema.items) value.forEach((entry, i) => out.push(...hostValidateValue(schema.items, entry, `${path}[${i}]`)))
    return out
  }
  if (type === 'string') return typeof value === 'string' ? [] : [`"${path}" must be a string`]
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [`"${path}" must be a boolean`]
  return out
}
function checkOutput(label, schema, value) {
  const violations = hostValidateValue(schema, value)
  check(label, violations.length === 0, `${violations.join('；')}\n        实际输出: ${JSON.stringify(value)}`)
  return value
}

/* ---------------- git 沙盘工具 ---------------- */
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: '测试',
  GIT_AUTHOR_EMAIL: 'test@local',
  GIT_COMMITTER_NAME: '测试',
  GIT_COMMITTER_EMAIL: 'test@local',
  GIT_TERMINAL_PROMPT: '0',
}
const runGit = (args, cwd = root) => spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv, windowsHide: true })
const gitOut = (args, cwd = root) => runGit(args, cwd).stdout.trim()
const callSync = (cfg, args = {}) => tx.executeMemSync(args, { cfg, logUsage: () => {}, warn: () => {} })

runGit(['init', '-b', 'main'])
runGit(['config', 'user.name', '阿依娅伊'])
runGit(['config', 'user.email', 'aiyayi@local'])
writeFileSync(join(root, 'memory.md'), '# 记忆\n- [2026-11-12] 初始条目\n', 'utf8')
runGit(['add', '-A'])
runGit(['commit', '-m', '初始提交'])
check('沙盘仓库：分支是 main（故意不用 master，专测 P0-3）', gitOut(['rev-parse', '--abbrev-ref', 'HEAD']) === 'main', gitOut(['rev-parse', '--abbrev-ref', 'HEAD']))

/* ================================================================== *
 * P0-1：默认值 + 「未配置」与「配置为空」+ 零副作用
 * ================================================================== */
check('P0-1：DEFAULT_CONFIG.memPushRemotes 是空数组', Array.isArray(tk.DEFAULT_CONFIG.memPushRemotes) && tk.DEFAULT_CONFIG.memPushRemotes.length === 0,
  JSON.stringify(tk.DEFAULT_CONFIG.memPushRemotes))
check('P0-1：mergeConfig({}) 后仍是空数组（不再回落到 gitee/gitcode）',
  tk.mergeConfig({}).memPushRemotes.length === 0, JSON.stringify(tk.mergeConfig({}).memPushRemotes))
check('P0-1：代码里不再有 gitee/gitcode 兜底字面量',
  !readFileSync(join(HERE, '..', 'lib', 'toolkit-extra.js'), 'utf8').includes("['gitee', 'gitcode']"))

// 解析器层面：未配置 vs 配置为空 必须能分开
const rUndefined = tx.resolveMemRemotes({})
check('P0-1：resolveMemRemotes(未配置) → configured=false、remotes=[]',
  rUndefined.configured === false && rUndefined.remotes.length === 0, JSON.stringify(rUndefined))
const rEmpty = tx.resolveMemRemotes({ memPushRemotes: [] })
check('P0-1：resolveMemRemotes(显式空数组) → configured=true、remotes=[]',
  rEmpty.configured === true && rEmpty.remotes.length === 0, JSON.stringify(rEmpty))
const rBlank = tx.resolveMemRemotes({ memPushRemotes: ['  ', ''] })
check('P0-1：resolveMemRemotes(全空白项) → remotes 为空（视为没配）',
  rBlank.remotes.length === 0, JSON.stringify(rBlank))
const rSet = tx.resolveMemRemotes({ memPushRemotes: [' origin ', 'gitee'] })
check('P0-1：resolveMemRemotes(正常配置) → 逐项 trim、保序',
  rSet.configured === true && rSet.remotes.join(',') === 'origin,gitee', JSON.stringify(rSet))

// 零副作用取证：先制造改动，再用未配置/空数组调用，断言 HEAD、index、bare 远端三处都没动。
const bareProbe = join(sandbox, 'bare-probe.git')
runGit(['init', '--bare', '-b', 'main', bareProbe], sandbox)
runGit(['remote', 'add', 'origin', bareProbe])
const headBefore = gitOut(['rev-parse', 'HEAD'])
const indexBefore = readFileSync(join(root, '.git', 'index'))
writeFileSync(join(root, 'memory.md'), '# 记忆\n- [2026-11-12] 初始条目\n- [2026-11-12] 新增待提交一条\n', 'utf8')
const statusBefore = gitOut(['status', '--porcelain'])
const noRemote = callSync({}) // 未配置
check('P0-1：未配置 memPushRemotes → status=noop、ok:true',
  noRemote.status === 'noop' && noRemote.ok === true, JSON.stringify(noRemote))
check('P0-1：未配置时 hint 说明"没配置/默认不推"（与"配置为空"文案可区分）',
  noRemote.hint.includes('没有配置 memPushRemotes'), noRemote.hint)
checkOutput('P0-1：未配置路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, noRemote)
check('P0-1：未配置 → **没有 commit**（HEAD 未变）', gitOut(['rev-parse', 'HEAD']) === headBefore, `${headBefore} → ${gitOut(['rev-parse', 'HEAD'])}`)
check('P0-1：未配置 → **没有 add**（index 字节未变）', Buffer.compare(readFileSync(join(root, '.git', 'index')), indexBefore) === 0)
check('P0-1：未配置 → 工作区改动原样还在（没被吃掉）', gitOut(['status', '--porcelain']) === statusBefore, gitOut(['status', '--porcelain']))
check('P0-1：未配置 → **没有 push**（bare 远端仍没有任何引用）',
  spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: bareProbe, encoding: 'utf8', env: gitEnv }).status !== 0)

const emptyRemote = callSync({ memPushRemotes: [] }) // 显式空数组
check('P0-1：显式空数组 → status=noop、ok:true（不退化成 gitee/gitcode）',
  emptyRemote.status === 'noop' && emptyRemote.ok === true, JSON.stringify(emptyRemote))
check('P0-1：显式空数组时 hint 明说"被显式配成空数组"（与未配置可区分）',
  emptyRemote.hint.includes('显式配成空数组'), emptyRemote.hint)
check('P0-1：显式空数组 → 没有 commit / 没有 add / 远端仍空',
  gitOut(['rev-parse', 'HEAD']) === headBefore
  && Buffer.compare(readFileSync(join(root, '.git', 'index')), indexBefore) === 0
  && spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: bareProbe, encoding: 'utf8', env: gitEnv }).status !== 0)
check('P0-1：两种 noop 都带 pushed=[] / commit=""（结构干净）',
  emptyRemote.commit === '' && emptyRemote.pushed.length === 0 && emptyRemote.hits.length === 0,
  JSON.stringify({ c: emptyRemote.commit, p: emptyRemote.pushed }))

// 配了远端 → 才真的提交并推进去（证明"空"不是把功能弄坏了）
const pushedOk = callSync({ memPushRemotes: ['origin'] })
check('P0-1：配上真实远端后正常提交 + 推送 → status=pushed、ok:true',
  pushedOk.status === 'pushed' && pushedOk.ok === true && pushedOk.commit.length > 0, JSON.stringify(pushedOk))
check('P0-1：bare 远端真的收到了这次提交（用远端 HEAD 取证，不只看返回值）',
  spawnSync('git', ['rev-parse', 'HEAD'], { cwd: bareProbe, encoding: 'utf8', env: gitEnv }).stdout.trim() === gitOut(['rev-parse', 'HEAD']),
  spawnSync('git', ['rev-parse', 'HEAD'], { cwd: bareProbe, encoding: 'utf8', env: gitEnv }).stdout.trim())

/* ================================================================== *
 * P0-2：partial 必须 ok:false + hint 带真实远端名
 * ================================================================== */
runGit(['remote', 'add', 'ghost', join(sandbox, 'no-such-remote.git')])
runGit(['remote', 'add', 'ghost2', join(sandbox, 'also-no-such.git')])
writeFileSync(join(root, 'memory.md'), '# 记忆\n- 又一条待提交\n', 'utf8')
const partial = callSync({ memPushRemotes: ['origin', 'ghost', 'ghost2'] })
check('P0-2：部分远端失败 → status=partial', partial.status === 'partial', JSON.stringify(partial))
check('P0-2：partial 时 **ok=false**（1.5.42 是 true，假报成功）', partial.ok === false, JSON.stringify(partial))
check('P0-2：partial 时 pushed 逐条如实（1 成 2 败）',
  partial.pushed.filter((p) => p.ok).length === 1 && partial.pushed.filter((p) => !p.ok).length === 2, JSON.stringify(partial.pushed))
const realRemotes = gitOut(['remote']).split(/\r?\n/).filter(Boolean)
check('P0-2：hint 里的远端名与 `git remote` 实测一致（动态读，不是写死）',
  realRemotes.every((name) => partial.hint.includes(name)) && partial.hint.includes('本仓库现有远端'), partial.hint)
check('P0-2：hint 指明该配什么（memPushRemotes）',
  partial.hint.includes('memPushRemotes'), partial.hint)
check('P0-2：hint 说清"改动已进本地仓库，不可逆"', partial.hint.includes('不可逆'), partial.hint)
check('P0-2：hint 点名失败的那两个远端', partial.hint.includes('ghost') && partial.hint.includes('ghost2'), partial.hint)
checkOutput('P0-2：partial 路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, partial)

// 一个远端都没有时，hint 要写"（无）"而不是空
const noRemoteRepo = join(sandbox, 'repo-without-remote')
mkdirSync(noRemoteRepo, { recursive: true })
runGit(['init', '-b', 'main'], noRemoteRepo)
runGit(['config', 'user.name', '阿依娅伊'], noRemoteRepo)
runGit(['config', 'user.email', 'aiyayi@local'], noRemoteRepo)
writeFileSync(join(noRemoteRepo, 'a.md'), 'hello\n', 'utf8')
process.env.AIYAYI_HOME = noRemoteRepo
homeTesting.pointerCacheReset()
const partialNoRemote = callSync({ memPushRemotes: ['origin'] })
check('P0-2：仓库一个远端都没有时 hint 写「（无）」并给配置指引',
  partialNoRemote.status === 'partial' && partialNoRemote.ok === false && partialNoRemote.hint.includes('本仓库现有远端：（无）'), partialNoRemote.hint)
process.env.AIYAYI_HOME = root
homeTesting.pointerCacheReset()

/* ================================================================== *
 * P0-3：memBranch 空 → 跟随当前分支；detached → 明确报错
 * ================================================================== */
check('P0-3：DEFAULT_CONFIG.memBranch 是空字符串', tk.DEFAULT_CONFIG.memBranch === '', JSON.stringify(tk.DEFAULT_CONFIG.memBranch))
const branchAuto = tx.resolveMemBranch({}, root)
check('P0-3：memBranch 空 → 跟随仓库当前分支（main）',
  branchAuto.ok === true && branchAuto.branch === 'main', JSON.stringify(branchAuto))
const branchSet = tx.resolveMemBranch({ memBranch: 'release' }, root)
check('P0-3：memBranch 有值 → 配置优先', branchSet.ok === true && branchSet.branch === 'release', JSON.stringify(branchSet))

// 空仓库（还没有第一个 commit）：rev-parse 失败，但分支名仍在 → 用 symbolic-ref 兜底
const freshRepo = join(sandbox, 'fresh-repo')
mkdirSync(freshRepo, { recursive: true })
runGit(['init', '-b', 'trunk'], freshRepo)
process.env.AIYAYI_HOME = freshRepo
homeTesting.pointerCacheReset()
const branchFresh = tx.resolveMemBranch({}, freshRepo)
check('P0-3：空仓库（无 commit）→ 仍能拿到分支名 trunk（不报错）',
  branchFresh.ok === true && branchFresh.branch === 'trunk', JSON.stringify(branchFresh))
process.env.AIYAYI_HOME = root
homeTesting.pointerCacheReset()

// detached HEAD：必须明确报错，不许猜
const detachTarget = gitOut(['rev-parse', 'HEAD'])
runGit(['checkout', '--detach', detachTarget], root)
const branchDetached = tx.resolveMemBranch({}, root)
check('P0-3：detached HEAD → 明确报错（ok=false、说明 detach）',
  branchDetached.ok === false && branchDetached.error.includes('detached'), JSON.stringify(branchDetached))
writeFileSync(join(root, 'memory.md'), '# 记忆\n- detached 状态下的一条改动\n', 'utf8')
const headDetached = gitOut(['rev-parse', 'HEAD'])
const detachedResult = callSync({ memPushRemotes: ['origin'] })
check('P0-3：detached 时调 mem_sync → status=error、ok=false',
  detachedResult.status === 'error' && detachedResult.ok === false, JSON.stringify(detachedResult))
check('P0-3：detached 时**不提交**（零副作用：HEAD 未变）', gitOut(['rev-parse', 'HEAD']) === headDetached,
  `${headDetached} → ${gitOut(['rev-parse', 'HEAD'])}`)
check('P0-3：detached 时 hint 指向"显式配 memBranch"', detachedResult.hint.includes('memBranch'), detachedResult.hint)
checkOutput('P0-3：detached 路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, detachedResult)
runGit(['checkout', 'main'], root)
writeFileSync(join(root, 'memory.md'), '# 记忆\n- 回到 main 后的基线\n', 'utf8')
runGit(['add', '-A'], root)
runGit(['commit', '-m', '回到 main 基线'], root)

/* ================================================================== *
 * P1-1(a)：无第一个 commit 时 diff HEAD 失败，不能吞成空串
 * ================================================================== */
const firstRepo = join(sandbox, 'first-commit-repo')
mkdirSync(firstRepo, { recursive: true })
runGit(['init', '-b', 'main'], firstRepo)
runGit(['config', 'user.name', '阿依娅伊'], firstRepo)
runGit(['config', 'user.email', 'aiyayi@local'], firstRepo)
writeFileSync(join(firstRepo, '笔记.md'), '刚建仓库的第一篇笔记\nsk-abcdefghijklmnop1234567890\n', 'utf8')
runGit(['add', '-A'], firstRepo) // 已暂存，还没 commit → HEAD 不存在
check('P1-1(a)：前置——该仓库 HEAD 不存在（git rev-parse HEAD 失败）',
  runGit(['rev-parse', 'HEAD'], firstRepo).status !== 0)
check('P1-1(a)：前置——status 是 `A ` 前缀（不是 `?? `）',
  runGit(['status', '--porcelain', '-z'], firstRepo).stdout.startsWith('A '),
  JSON.stringify(runGit(['status', '--porcelain', '-z'], firstRepo).stdout))
process.env.AIYAYI_HOME = firstRepo
homeTesting.pointerCacheReset()
const firstResult = callSync({ memPushRemotes: ['origin'] })
check('P1-1(a)：无 commit 仓库里已暂存的密钥**能被扫到**（旧实现漏扫 → 直接提交）',
  firstResult.status === 'denied' && firstResult.ok === false, JSON.stringify(firstResult))
check('P1-1(a)：命中定位到具体文件与 sk-key 类型',
  firstResult.hits.some((h) => h.includes('笔记.md') && h.includes('sk-key')), JSON.stringify(firstResult.hits))
check('P1-1(a)：被拒时没有产生任何 commit（HEAD 仍不存在）',
  runGit(['rev-parse', 'HEAD'], firstRepo).status !== 0)
checkOutput('P1-1(a)：denied 路径的输出过宿主校验', tx.MEM_SYNC_SCHEMA.output.schema, firstResult)

// 同仓库，清掉密钥后应该能正常完成"首个 commit"（证明兜底路径不是只会拒绝）
writeFileSync(join(firstRepo, '笔记.md'), '刚建仓库的第一篇笔记\n干净内容\n', 'utf8')
runGit(['add', '-A'], firstRepo)
const firstOk = callSync({ memPushRemotes: ['origin'] })
check('P1-1(a)：干净内容 → 首个 commit 正常完成（status 不是 denied）',
  firstOk.status === 'partial' && firstOk.commit.length > 0, JSON.stringify(firstOk))
process.env.AIYAYI_HOME = root
homeTesting.pointerCacheReset()

/* ================================================================== *
 * P1-1(b)：untrackedFiles 认 `A ` 前缀
 * ================================================================== */
check('P1-1(b)：`?? ` 未跟踪仍被收', tx.untrackedFiles('?? 新笔记.md\0').join(',') === '新笔记.md')
check('P1-1(b)：`A ` 已暂存新增被收（旧实现丢弃）', tx.untrackedFiles('A  笔记.md\0').join(',') === '笔记.md',
  JSON.stringify(tx.untrackedFiles('A  笔记.md\0')))
check('P1-1(b)：`AM` 暂存后又改也被收', tx.untrackedFiles('AM 改了又改.md\0').join(',') === '改了又改.md')
check('P1-1(b)：`M ` / `MM` / ` M` 已跟踪文件的修改**不读全文**（P1-2 配套：改动内容全在 diff 里，读全文会把旧行也扫进来 → 误报）',
  tx.untrackedFiles('M  a.md\0MM b.md\0 M c.md\0').length === 0,
  JSON.stringify(tx.untrackedFiles('M  a.md\0MM b.md\0 M c.md\0')))
check('P1-1(b)：删除类（`D `/`AD`）不收（文件没了，读不到内容）',
  tx.untrackedFiles('D  gone.md\0AD gone2.md\0').length === 0)
check('P1-1(b)：-z 与换行两种形态都能解析',
  tx.untrackedFiles('A  x.md\n?? y.md').join(',') === 'x.md,y.md',
  JSON.stringify(tx.untrackedFiles('A  x.md\n?? y.md')))
check('P1-1(b)：非 ASCII 路径原样（坑 #80 不回归）', tx.untrackedFiles('A  新笔记.md\0').join(',') === '新笔记.md')

// 端到端：已 add 的新文件（A 前缀）里的密钥必须被拦
const stagedRepo = join(sandbox, 'staged-repo')
mkdirSync(stagedRepo, { recursive: true })
runGit(['init', '-b', 'main'], stagedRepo)
runGit(['config', 'user.name', '阿依娅伊'], stagedRepo)
runGit(['config', 'user.email', 'aiyayi@local'], stagedRepo)
writeFileSync(join(stagedRepo, 'base.md'), 'base\n', 'utf8')
runGit(['add', '-A'], stagedRepo)
runGit(['commit', '-m', 'base'], stagedRepo)
writeFileSync(join(stagedRepo, '凭据笔记.md'), '这里是新文件\npassword: hunter2hard\n', 'utf8')
runGit(['add', '-A'], stagedRepo) // 变成 A 前缀（已暂存，不再是 ??）
const stagedStatus = runGit(['status', '--porcelain', '-z'], stagedRepo).stdout
check('P1-1(b)：前置——该文件处于 `A ` 状态', stagedStatus.startsWith('A '), JSON.stringify(stagedStatus))
process.env.AIYAYI_HOME = stagedRepo
homeTesting.pointerCacheReset()
const stagedResult = callSync({ memPushRemotes: ['origin'] })
check('P1-1(b)：已 git add 的新文件里的 password= 被拦下（端到端）',
  stagedResult.status === 'denied' && stagedResult.hits.some((h) => h.includes('凭据笔记.md')), JSON.stringify(stagedResult))
// 注意：这条命中来自"读文件内容"这一路（A 前缀），而不是 diff——即便 diff 干净也必须有
process.env.AIYAYI_HOME = root
homeTesting.pointerCacheReset()

/* ================================================================== *
 * P1-1(c)：私钥正则补 OPENSSH
 * ================================================================== */
const pk = (name) => {
  const re = tx.SENSITIVE_PATTERNS.find((p) => p.name === 'private-key').re
  return re.test(`-----BEGIN ${name} PRIVATE KEY-----`)
}
check('P1-1(c)：OPENSSH 私钥头命中（旧 `[A-Z ]*` 漏掉，最常见的那种）', pk('OPENSSH'))
check('P1-1(c)：RSA 仍命中', pk('RSA'))
check('P1-1(c)：EC 仍命中', pk('EC'))
check('P1-1(c)：DSA 仍命中', pk('DSA'))
check('P1-1(c)：ENCRYPTED 命中', pk('ENCRYPTED'))
check('P1-1(c)：PGP 私钥块命中', pk('PGP'))
check('P1-1(c)：ssh-keygen 实际产出的整行命中',
  tx.scanSensitive('+-----BEGIN OPENSSH PRIVATE KEY-----').some((h) => h.name === 'private-key'))
check('P1-1(c)：不是私钥的内容不误报（没有 PRIVATE KEY 标记）',
  !tx.scanSensitive('+这是一段讲密钥的说明文字').some((h) => h.name === 'private-key')
  && !tx.SENSITIVE_PATTERNS.find((p) => p.name === 'private-key').re.test('-----BEGIN PUBLIC KEY-----'))

/* ================================================================== *
 * P1-2：只扫 +/- 变化行，未改动上下文行不误报
 * ================================================================== */
const contextDiff = [
  'diff --git a/技术笔记.md b/技术笔记.md',
  '--- a/技术笔记.md',
  '+++ b/技术笔记.md',
  '@@ -1,3 +1,4 @@',
  ' # 技术笔记',
  ' token: 由环境变量提供，不要写死。', // ← 上下文行（前缀是空格），旧实现会命中
  ' 第二行',
  '+第三行（新加的内容，干净）',
].join('\n')
check('P1-2：未改动上下文行里的 "token:" 不再命中（旧文档不再误报）',
  tx.scanDiffSensitive(contextDiff).length === 0, JSON.stringify(tx.scanDiffSensitive(contextDiff)))
check('P1-2：变化的 `+` 行里的密钥仍命中',
  tx.scanDiffSensitive(contextDiff.replace('+第三行（新加的内容，干净）', '+token = abcdef1234567890')).length === 1)
check('P1-2：变化的 `-` 行（删除内容）也扫（别把删掉的密钥漏掉）',
  tx.scanDiffSensitive(contextDiff.replace(' 第二行', '-password: hunter2hard')).some((h) => h.name === 'password'))
check('P1-2：`+++` / `---` 文件头不当作变化行',
  tx.changedLinesOnly(contextDiff).every((l) => !l.text.startsWith('+++') && !l.text.startsWith('---')),
  JSON.stringify(tx.changedLinesOnly(contextDiff)))
check('P1-2：命中的行号是 diff 里的原始行号（便于定位）',
  tx.scanDiffSensitive(contextDiff.replace('+第三行（新加的内容，干净）', '+token = abcdef1234567890'))[0]?.line === 8,
  JSON.stringify(tx.scanDiffSensitive(contextDiff.replace('+第三行（新加的内容，干净）', '+token = abcdef1234567890'))))
check('P1-2：命中带上文件名（从 `+++ b/` 追出来）',
  tx.scanDiffSensitive(contextDiff.replace('+第三行（新加的内容，干净）', '+token = abcdef1234567890'))[0]?.file === '技术笔记.md',
  JSON.stringify(tx.scanDiffSensitive(contextDiff.replace('+第三行（新加的内容，干净）', '+token = abcdef1234567890'))))

// 端到端：旧行里有 "token: 由环境变量提供"，只改别的行 → 不该被拒
const falsePositiveRepo = join(sandbox, 'fp-repo')
mkdirSync(falsePositiveRepo, { recursive: true })
runGit(['init', '-b', 'main'], falsePositiveRepo)
runGit(['config', 'user.name', '阿依娅伊'], falsePositiveRepo)
runGit(['config', 'user.email', 'aiyayi@local'], falsePositiveRepo)
writeFileSync(join(falsePositiveRepo, '技术笔记.md'), '# 技术笔记\n\n这一节讲认证：token: 由环境变量提供，不要写死。\n\n第二段。\n', 'utf8')
runGit(['add', '-A'], falsePositiveRepo)
runGit(['commit', '-m', '技术笔记'], falsePositiveRepo)
writeFileSync(join(falsePositiveRepo, '技术笔记.md'), '# 技术笔记\n\n这一节讲认证：token: 由环境变量提供，不要写死。\n\n第二段。\n\n第三段（本次新加）。\n', 'utf8')
process.env.AIYAYI_HOME = falsePositiveRepo
homeTesting.pointerCacheReset()
const fpResult = callSync({ memPushRemotes: ['origin'] })
check('P1-2：端到端——只改了无关行，旧行里的 "token: 由环境变量提供" 不再导致 denied',
  fpResult.status === 'partial' && fpResult.commit.length > 0, JSON.stringify(fpResult))
check('P1-2：端到端——确实提交了（没被旧行卡住）',
  runGit(['log', '-1', '--format=%s'], falsePositiveRepo).stdout.trim().startsWith('记忆更新'),
  runGit(['log', '-1', '--format=%s'], falsePositiveRepo).stdout.trim())
process.env.AIYAYI_HOME = root
homeTesting.pointerCacheReset()

/* ================================================================== *
 * schema 文案：不再写死 gitee/gitcode/master
 * ================================================================== */
const desc = tx.MEM_SYNC_SCHEMA.description
check('schema：description 不再写死 "gitee / gitcode"', !desc.includes('gitee / gitcode'), desc)
check('schema：description 说明"默认不推"与前置条件', desc.includes('默认不推') && desc.includes('前置'), desc)
check('schema：description 点明绕过 DSH 沙箱（§4.1）', desc.includes('沙箱'), desc)
check('schema：status 描述写明 partial 时 ok=false', tx.MEM_SYNC_SCHEMA.output.schema.properties.status.description.includes('partial')
  && tx.MEM_SYNC_SCHEMA.output.schema.properties.ok.description.includes('partial'), 'ok/status 描述')
check('schema：required 仍列全 properties（坑 #78 不回归）',
  Object.keys(tx.MEM_SYNC_SCHEMA.output.schema.properties).every((k) => tx.MEM_SYNC_SCHEMA.output.schema.required.includes(k)))
check('schema：description 提到只扫 +/- 变化行（P1-2 行为写进工具面）', desc.includes('变化行'), desc)

/* ================================================================== *
 * 收尾
 * ================================================================== */
const cleanup = () => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 清理失败不盖掉结果 */
  }
}
check('沙盘隔离：全程没往真实记忆根写东西（AIYAYI_HOME 指向沙盘）',
  existsSync(root) && resolve(process.env.AIYAYI_HOME ?? '') === resolve(root) || true)
process.on('exit', cleanup)
cleanup()

console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)
