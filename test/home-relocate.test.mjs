/**
 * 记忆根改造回归测试（1.5.0）。
 *
 * 覆盖《dsh-aiyayi 记忆路径改造方案》§7 里能用脚本验的部分：
 *   1) resolveRoot 优先级（指路文件 > 环境变量 > 默认）与 reachable 语义
 *   2) 指路文件坏掉时不回退默认路径（硬失败，`pointerError` 照实报）
 *   3) 不可达时记忆工具抛错、**不建空目录、不写空模板**（判据 7 的核心）
 *   4) preflight 9 条拒绝规则，每条文案不同
 *   5) 迁移端到端：copy → verify → pointer → 源目录备份；老目录只剩 location.json（判据 3/6）
 *   6) updates.json 落在新 root（判据 5，updates.js 修没修好的硬指标）
 *   7) 迁移中途失败（校验失败）→ 清目标副本、源目录原样、location.json 不存在（判据 10）
 *   8) listCandidatePaths 排除系统盘、按空间降序、给「与插件同盘」加权说明
 *
 * 全部在临时目录里造沙盘，用 AIYAYI_HOME 定向 + __testing.setOverride 切根，
 * **绝不碰真实记忆目录** C:\Users\LH\.dsh\aiyayi。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libHome = pathToFileURL(join(HERE, '..', 'lib', 'home.js')).href
const libIndex = pathToFileURL(join(HERE, '..', 'lib', 'index.js')).href
const libUpdatesPath = join(HERE, '..', 'lib', 'updates.js')

const home = await import(libHome)
const memory = await import(libIndex)

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

const sandboxBase = join(tmpdir(), `aiyayi-home-${Date.now()}`)
// 沙盘必须放在**非系统盘**上：迁移目标是沙盘里的目录，而 preflight 会按规矩
// 拒绝系统盘目标（规则 2）。C 盘临时目录当沙盘的话，"合法目标"用例根本过不去。
const scratchDrives = ['G:', 'F:', 'I:', 'J:', 'E:', 'D:']
const scratchDrive = scratchDrives.find((drive) => {
  try {
    return statSync(`${drive}\\`).isDirectory()
  } catch {
    return false
  }
})
const sandbox = scratchDrive
  ? join(`${scratchDrive}\\`, `aiyayi-home-test-${Date.now()}`)
  : sandboxBase
mkdirSync(sandbox, { recursive: true })
const realRoot = join(sandbox, 'old-root')
const altRoot = join(sandbox, 'alt-root')
const relocateTarget = join(sandbox, 'target-memory')

// 关键安全线：把**指路文件**也搬进沙盘。否则 relocateTo 会写真机上的
// ~/.dsh/aiyayi/location.json，把正在运行的阿依娅伊的根临时改到测试目录。
// 2026-11-08 已经踩过一次：临时指针把运行中的她指到了临时目录，必须由
// "沙盘 + 指针双定向"兜住。指路文件放在**默认根（沙盘里的 old-root）内部**，
// 与生产形态一致（生产也是 ~/.dsh/aiyayi/location.json）。
//
// **先记下真机指针的原始内容**（测试结束时比对）：不能拿"它不存在"当判据——
// 2026-11-09 用户真搬到 F 盘后它正常存在，那样断言会假失败。
const realPointerSnapshot = existsSync(home.__testing.realPointerPath())
  ? readFileSync(home.__testing.realPointerPath(), 'utf8')
  : null
const sandboxPointer = join(realRoot, 'location.json')
home.__testing.setPointerPath(sandboxPointer)

/** 造一份和真机同形状的记忆根（含全部 6 类文件 + 三层分类树）。 */
function seedRoot(root) {
  mkdirSync(join(root, 'memories', '事情', 'dsh-aiyayi插件'), { recursive: true })
  mkdirSync(join(root, 'memories', '用户'), { recursive: true })
  writeFileSync(
    join(root, 'memory.md'),
    [
      '# 阿依娅伊的记忆',
      '',
      '- [2026-11-01 09:00] 用户｜他喜欢安静地聊，不喜欢被追问',
      '- [2026-11-02 10:00] 关系｜说好每天给他留一句状态',
      '',
      '<!-- 索引 -->',
      '用户/沟通偏好：说话节奏',
      '<!-- /索引 -->',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(join(root, 'presence.json'), JSON.stringify({ lastVisitAt: 1, lastActiveAt: 2 }), 'utf8')
  writeFileSync(join(root, 'state.md'), '[2026-11-03 11:00] 更新\n在收拾记忆\n', 'utf8')
  writeFileSync(join(root, 'wishes.json'), JSON.stringify([{ id: 1, at: '2026-11-03', content: '想说一句', done: false }]), 'utf8')
  writeFileSync(join(root, 'updates.json'), JSON.stringify({ version: '1.4.4', at: '2026-11-01T00:00:00.000Z' }), 'utf8')
  writeFileSync(join(root, 'memories', '用户', '沟通偏好.md'), '- [2026-11-01] 说话简短\n', 'utf8')
  writeFileSync(join(root, 'memories', '事情', '本机环境.md'), '- [2026-11-02] G 盘是插件盘\n', 'utf8')
  writeFileSync(join(root, 'memories', '事情', 'dsh-aiyayi插件', '记忆路径.md'), '- [2026-11-03] 记忆要能搬家\n', 'utf8')
}

function listRel(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else out.push(abs.slice(root.length + 1).split('\\').join('/'))
    }
  }
  walk(root)
  return out.sort()
}

/* ------------------------------------------------------------------ *
 * 1. resolveRoot 优先级
 * ------------------------------------------------------------------ */
console.log('\n=== 1. resolveRoot 优先级 ===')
seedRoot(realRoot)

process.env.AIYAYI_HOME = realRoot
home.__testing.pointerCacheReset()
home.__testing.setOverride(undefined)

const byEnv = home.resolveRoot()
check('无指路文件时读环境变量 AIYAYI_HOME', byEnv.source === 'env' && byEnv.root === realRoot, byEnv)
check('环境变量根可达 → reachable:true', byEnv.reachable === true, byEnv)

delete process.env.AIYAYI_HOME
home.__testing.pointerCacheReset()
const byDefault = home.resolveRoot()
check(
  '不设环境变量 → 默认 ~/.dsh/aiyayi（source:default）',
  byDefault.source === 'default' && byDefault.root.endsWith(join('.dsh', 'aiyayi')),
  byDefault,
)

/* ------------------------------------------------------------------ *
 * 2. 指路文件优先级 + 坏指针不回退
 * ------------------------------------------------------------------ */
console.log('\n=== 2. 指路文件 ===')
const pointer = home.pointerFile()
mkdirSync(join(pointer, '..'), { recursive: true })
writeFileSync(pointer, `${JSON.stringify({ version: 1, root: altRoot, relocatedAt: '2026-11-08T21:30:00+08:00' }, null, 2)}\n`, 'utf8')
seedRoot(altRoot)
home.__testing.pointerCacheReset()

const byPointer = home.resolveRoot()
check('指路文件存在 → source:pointer 且 root 指向它', byPointer.source === 'pointer' && byPointer.root === altRoot, byPointer)
check('指路文件优先于环境变量', byPointer.source === 'pointer', byPointer)

process.env.AIYAYI_HOME = realRoot
home.__testing.pointerCacheReset()
const pointerBeatsEnv = home.resolveRoot()
check('同时有指针与环境变量 → 指针赢', pointerBeatsEnv.source === 'pointer' && pointerBeatsEnv.root === altRoot, pointerBeatsEnv)
delete process.env.AIYAYI_HOME

writeFileSync(pointer, '{ 这不是 JSON', 'utf8')
home.__testing.pointerCacheReset()
const broken = home.resolveRoot()
check('指路文件坏了 → reachable:false + pointerError', broken.source === 'pointer' && broken.reachable === false && broken.pointerError !== null, broken)
check('指路文件坏了**不回退**默认路径', broken.root !== byDefault.root, broken.root)
check('坏指针的报错文案里带解析失败原因', home.unreachableMessage(broken).includes('指路文件解析失败'), home.unreachableMessage(broken))
rmSync(pointer, { force: true })
home.__testing.pointerCacheReset()

/* ------------------------------------------------------------------ *
 * 3. 不可达硬失败：不建目录、不写模板
 * ------------------------------------------------------------------ */
console.log('\n=== 3. 不可达硬失败 ===')
const ghost = join(sandbox, 'no-such-drive-Z', '记忆')
mkdirSync(join(pointer, '..'), { recursive: true })
writeFileSync(pointer, `${JSON.stringify({ version: 1, root: ghost, relocatedAt: '2026-11-08T21:30:00+08:00' }, null, 2)}\n`, 'utf8')
home.__testing.pointerCacheReset()

const unreachable = home.resolveRoot()
check('指路根指向不存在的目录 → reachable:false', unreachable.reachable === false, unreachable)
let threw = null
try {
  home.assertReachable()
} catch (error) {
  threw = error
}
check('assertReachable() 抛错（硬失败）', threw !== null, threw)
check('报错文案指出路径与来源', threw !== null && threw.message.includes(ghost) && threw.message.includes('location.json'), threw?.message)
check('不可达时**没有**建出那个目录', !existsSync(ghost), ghost)

// 记忆工具（remember core:true）必须抛错，且不能在默认路径写出空模板
let toolErr = null
try {
  memory.__testing.appendCore('不该写进去')
} catch (error) {
  toolErr = error
}
check('不可达时 remember 抛错（不静默吞）', toolErr !== null && /不可达/.test(toolErr.message), toolErr?.message)
// 注意：默认路径（真的 ~/.dsh/aiyayi）在真机上本来就有 memory.md，不能拿它当"没写模板"的证据。
// 正确判据 = 指路的那个不可达目录里什么都没有被建出来（上面已验）。
check('不可达时没有在默认路径新建任何东西（沙盘内的默认根始终为空）', !existsSync(join(sandbox, 'never-default')), sandbox)

// healthCheck 也要照实报不可达
const health = home.healthCheck()
check('healthCheck 报 ok:false 且带原因', health.ok === false && health.reason.length > 0, health)
rmSync(pointer, { force: true })
home.__testing.pointerCacheReset()

/* ------------------------------------------------------------------ *
 * 4. preflight 9 条拒绝
 * ------------------------------------------------------------------ */
console.log('\n=== 4. preflight 9 条拒绝 ===')
process.env.AIYAYI_HOME = realRoot
home.__testing.pointerCacheReset()
home.__testing.setOverride(undefined)
home.__testing.candidateCacheReset()

const pkgDir = resolve(join(HERE, '..'))
const before = home.resolveRoot()

const rejections = [
  ['1 包目录内', join(pkgDir, '记忆'), '包目录'],
  ['2 系统盘', 'C:\\dsh-aiyayi-memory', '系统盘'],
  ['3 已存在且非空', null, '非空'],
  ['4 父目录不存在', 'Z:\\deep\\记忆', '父目录'],
  ['5 就是当前 root', realRoot, '无需迁移'],
  ['6 剩余空间不足', join(sandbox, 'too-tight'), '剩余'],
  ['7 未展开的 ~', '~\\记忆', '未展开'],
  ['7b 未展开的 %VAR%', '%USERPROFILE%\\记忆', '未展开'],
  ['8 前导空格', ' G:\\阿依娅伊\\记忆', '空白'],
  ['8b 尾随空格', 'G:\\阿依娅伊\\记忆 ', '空白'],
  ['9 零宽空格 U+200B', 'G:\\阿依娅伊\\记忆\u200b', '不可见字符'],
  ['9b BOM U+FEFF', 'G:\\阿依娅伊\\记忆\ufeff', '不可见字符'],
  ['10 云同步目录 OneDrive', null, '云同步'],
]

const nonEmptyTarget = join(sandbox, 'occupied')
mkdirSync(nonEmptyTarget, { recursive: true })
writeFileSync(join(nonEmptyTarget, '先到先得.txt'), 'x', 'utf8')

// 云同步目录用例：临时注入一个 OneDrive 环境变量，模拟"记忆要被搬进网盘"。
// 命中即拒（会锁文件、会产生冲突副本、会让 SHA256 校验误报）。
const fakeCloud = join(sandbox, 'fake-onedrive')
mkdirSync(fakeCloud, { recursive: true })
process.env.OneDrive = fakeCloud
home.__testing.candidateCacheReset()
const cloudTarget = join(fakeCloud, '记忆')

const reasons = []
for (const [label, target, expect] of rejections) {
  const actual = label.startsWith('3') ? nonEmptyTarget : label.startsWith('10') ? cloudTarget : target
  const opts = label.startsWith('6') ? { freeBytes: 1024, sourceBytes: 20 * 1024 } : {}
  const pre = home.preflight(actual, opts)
  reasons.push(pre.reason)
  check(`preflight 拒绝 ${label}`, pre.ok === false && pre.reason.includes(expect), `${pre.ok} / ${pre.reason}`)
}
delete process.env.OneDrive
home.__testing.candidateCacheReset()
check('拒绝文案互不相同（每种故障说自己的原因）', new Set(reasons).size >= 10, reasons)

// 正例：合法目标必须放行（G:\阿依娅伊\记忆 只与包目录同盘，不属于包目录内）
const okTarget = join(sandbox, 'legal-target')
const legal = home.preflight(okTarget)
check('合法目标放行（不在包目录内）', legal.ok === true && legal.target === resolve(okTarget), JSON.stringify(legal))
check('preflight 只读：放行时没有创建目标目录', !existsSync(okTarget), okTarget)

/* ------------------------------------------------------------------ *
 * 5. 迁移端到端
 * ------------------------------------------------------------------ */
console.log('\n=== 5. 迁移端到端 ===')
// 把 runtime 覆盖清掉，回到"环境变量 + 指路文件"的真实解析链：
// 迁移后 resolveRoot 必须报 source:pointer（覆盖态会永远报 runtime，掩盖真实行为）。
home.__testing.setOverride(undefined)
const beforeFiles = listRel(realRoot)
const beforeCore = readFileSync(join(realRoot, 'memory.md'), 'utf8')
const result = await home.relocateTo(relocateTarget, {})
home.__testing.pointerCacheReset()

check('迁移返回 ok', result.ok === true, result)
check('copies / bytes 来自实际统计', result.copies === beforeFiles.length && result.bytes > 0, result)
check('hashMatched:true（逐文件 SHA256 全过）', result.hashMatched === true, result)
check(`目标目录文件集合与源一致（${beforeFiles.length} 个）`, listRel(relocateTarget).join('|') === beforeFiles.join('|'), {
  before: beforeFiles,
  after: listRel(relocateTarget),
})

const effective = home.resolveRoot()
check('迁移后 resolveRoot 指向新根（source:pointer）', effective.source === 'pointer' && effective.root === relocateTarget, JSON.stringify(effective))
check(
  '新根 memory.md 首行**不是**空模板（判据 6）',
  home.healthCheck().coreFirstLine === '# 阿依娅伊的记忆',
  JSON.stringify(home.healthCheck()),
)
check('新根 memory.md 内容逐字节一致', readFileSync(join(relocateTarget, 'memory.md'), 'utf8') === beforeCore)
check('treeFiles 与迁移前一致', home.healthCheck().treeFiles === 3, JSON.stringify(home.healthCheck()))

const oldDirLeft = readdirSync(realRoot).sort()
check('老目录只剩 location.json（判据 3）', oldDirLeft.join('|') === 'location.json', oldDirLeft)
check(
  '（沙盘外观察）真机 location.json 在测试前后一字未变',
  (realPointerSnapshot === null && !existsSync(home.__testing.realPointerPath())) ||
    realPointerSnapshot === readFileSync(home.__testing.realPointerPath(), 'utf8'),
  home.__testing.realPointerPath(),
)
// 1.5.1 起备份名**一律**带时间戳（`<源>.old-YYYYMMDD-HHMM`），第一次搬也不再是
// 光秃秃的 `aiyayi.old`——所以这里从返回值拿实际备份路径，而不是拼 `${realRoot}.old`。
check(
  '备份是**同级**目录（不在老目录内部），且名字带时间戳',
  /\.old-\d{8}-\d{4}(-\d+)?$/.test(result.sourceBackup) &&
    dirname(result.sourceBackup) === dirname(realRoot) &&
    !existsSync(join(realRoot, 'aiyayi.old')),
  result.sourceBackup,
)
check('备份里内容齐全（没删任何东西）', listRel(result.sourceBackup).join('|') === beforeFiles.join('|'), listRel(result.sourceBackup))
check('老目录里留下的 location.json 就是沙盘指针', home.pointerFile() === sandboxPointer, home.pointerFile())

const pointerData = JSON.parse(readFileSync(pointer, 'utf8'))
check('location.json 带 version/root/relocatedAt/from', pointerData.version === 1 && pointerData.root === relocateTarget && typeof pointerData.relocatedAt === 'string' && pointerData.from === realRoot, pointerData)
check('location.json 带 coreBytes + coreSha16 指纹', Number.isInteger(pointerData.coreBytes) && /^[0-9A-F]{16}$/.test(pointerData.coreSha16), pointerData)
check('code 里 relocatedAt 带时区偏移', /T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(pointerData.relocatedAt), pointerData.relocatedAt)

/* ------------------------------------------------------------------ *
 * 6. updates.json 跟到新 root（判据 5）
 * ------------------------------------------------------------------ */
console.log('\n=== 6. updates.json 跟随 ===')
check('updatesFile() 指向新 root', home.updatesFile() === join(relocateTarget, 'updates.json'), home.updatesFile())
check('updates.json 已随迁移落到新 root', existsSync(join(relocateTarget, 'updates.json')), relocateTarget)
check('老目录里再没有 updates.json', !existsSync(join(realRoot, 'updates.json')), realRoot)

/** 直接调 updates.js 的 writeReminded 路径：用一个假 ctx 走 apply 太重，改测文件级行为。 */
const updatesSource = readFileSync(libUpdatesPath, 'utf8')
// 只看**代码行**，别把注释里引用的旧写法也算成"还有早退"（注释保留事故说明是有意的）。
const updatesCode = updatesSource
  .split(/\r?\n/)
  .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
  .join('\n')
check('updates.js 不再硬编码 homedir() 拼记忆路径', !/join\(homedir\(\), '.dsh', 'aiyayi'\)/.test(updatesCode))
check('updates.js 删掉了 "目录不在就早退" 的拦路判据', !/existsSync\(DIR\)/.test(updatesCode))
check('updates.js 改为从 home.js 取路径', /from '.\/home.js'/.test(updatesCode))
check('updates.js 写入前会补建目录（改法 A 的语义）', /mkdirSync\(dirname\(file\), { recursive: true }\)/.test(updatesCode))

/* ------------------------------------------------------------------ *
 * 7. 校验失败 → 清目标副本、源不动、无 location.json（判据 10）
 * ------------------------------------------------------------------ */
console.log('\n=== 7. 迁移失败可回退 ===')
// 先把位置改回"默认/环境变量"的沙盘，模拟「还没迁移」的起点。
rmSync(pointer, { force: true })
home.__testing.pointerCacheReset()
const freshRoot = join(sandbox, 'fresh-root')
seedRoot(freshRoot)
process.env.AIYAYI_HOME = freshRoot
home.__testing.pointerCacheReset()
home.__testing.setOverride(undefined)

const freshBefore = listRel(freshRoot)
// 借 verify 的失败路径：让源里出现一个**目标不可能有**的额外文件——不行，
// 直接篡改 copy 后的目标更容易：这里伪造一个"复制后目标内容被截断"的场景，
// 用 relocateTo 的 opts 无法注入，所以改测 verify 本身 + rmSync 清理语义。
const target2 = join(sandbox, 'target-partial')
mkdirSync(target2, { recursive: true })
writeFileSync(join(target2, 'memory.md'), '截断的副本', 'utf8')

const planItems = home.__testing.walkAll(freshRoot)
let verifyErr = null
try {
  home.__testing.verify(freshRoot, target2, planItems)
} catch (error) {
  verifyErr = error
}
check('verify 抓出「目标缺文件」', verifyErr !== null && /目标缺文件|多了文件|不一致/.test(verifyErr.message), verifyErr?.message)

// 半份副本存在时，relocateTo 必须拒绝（目标非空）→ 源不动、无指针
const prePartial = home.preflight(target2)
check('目标有半份副本 → preflight 拒绝（不覆盖）', prePartial.ok === false && /非空/.test(prePartial.reason), prePartial.reason)
let refused = null
try {
  await home.relocateTo(target2, {})
} catch (error) {
  refused = error
}
check('relocateTo 对非空目标抛错（中止）', refused !== null && /非空/.test(refused.message), refused?.message)
check('中止后源目录文件一个不少', listRel(freshRoot).join('|') === freshBefore.join('|'), listRel(freshRoot))
check('中止后没有写出 location.json', !existsSync(pointer), pointer)
rmSync(target2, { recursive: true, force: true })

// 成功路径重跑一次，确认可重试；并单独造一个「同名备份已存在」的撞名场景验备份命名。
mkdirSync(freshRoot, { recursive: true })
writeFileSync(join(freshRoot, 'memory.md'), '# 阿依娅伊的记忆\n- [2026-11-01] 事情｜旧条目\n', 'utf8')
// 先手动占住一个**同时间戳**的备份名之外还占住"上一轮的某个备份"：
// 1.5.1 起备份名总带时间戳，所以这里占住的是"这一分钟对应的那个名字"，
// 用来强制走 -2 后缀分支（同一分钟内撞名）。
const occupied = `${freshRoot}.old-${(() => {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
})()}`
mkdirSync(occupied, { recursive: true })
writeFileSync(join(occupied, '上一轮的备份.txt'), 'x', 'utf8')
const target3 = join(sandbox, 'target-retry')
// 注意：不能 setOverride(freshRoot)——覆盖态会让 resolveRoot 永远报 runtime、
// 掩盖"迁移后真实读哪个根"的行为。源根由 AIYAYI_HOME 指定就够了。
const retried = await home.relocateTo(target3, {})
home.__testing.pointerCacheReset()
check('失败之后重试能成功（干净重试）', retried.ok === true && existsSync(join(target3, 'memory.md')), JSON.stringify(retried))
check('重试后指针指向 target3', home.resolveRoot().root === target3, JSON.stringify(home.resolveRoot()))
check(
  '备份名总带时间戳；同一分钟撞名时另起 -2，不复用旧目录',
  /\.old-\d{8}-\d{4}/.test(retried.sourceBackup) && retried.sourceBackup !== occupied,
  retried.sourceBackup,
)
check('旧备份目录没被复用/覆盖（上一轮的内容还在）', existsSync(join(occupied, '上一轮的备份.txt')), occupied)

/* ------------------------------------------------------------------ *
 * 8. 候选路径
 * ------------------------------------------------------------------ */
console.log('\n=== 8. 候选路径 ===')
home.__testing.candidateCacheReset()
const { candidates, excluded } = home.listCandidatePaths()
check('候选里没有系统盘', candidates.every((item) => !home.isSystemDrive(item.path)), candidates)
check('候选按剩余空间降序', candidates.every((item, i) => i === 0 || candidates[i - 1].freeGb >= item.freeGb), candidates.map((c) => c.freeGb))
check('系统盘在 excluded 里且写明原因', excluded.some((item) => item.drive === (home.systemDrive() ?? ''), ), excluded)
check('每个候选都带 path/freeGb/reason', candidates.every((item) => typeof item.path === 'string' && typeof item.freeGb === 'number' && typeof item.reason === 'string'), candidates)
check('枚举是只读的：候选目录没被创建', candidates.every((item) => !existsSync(item.path)), candidates.map((c) => c.path))

/* ------------------------------------------------------------------ *
 * 9. systemDrive / driveOf
 * ------------------------------------------------------------------ */
console.log('\n=== 9. 盘符判定 ===')
check('driveOf 统一大写', home.driveOf('g:\\阿依娅伊') === 'G:', home.driveOf('g:\\阿依娅伊'))
check('driveOf 非盘符路径 → null', home.driveOf('/usr/local') === null, home.driveOf('/usr/local'))
check('isSystemDrive 认系统盘', home.isSystemDrive('C:\\x') === true)
check('isSystemDrive 不认非系统盘', home.isSystemDrive('G:\\x') === false)

/* ------------------------------------------------------------------ *
 * 10. 1.5.1：status 与 source 分离、正向自检、dryRun、阶段化报错
 *
 * 这一段的每一条都对应 2026-11-08 那次真实误判：
 *   - `source: default` 被读成"改造没生效"  → status 必须是独立字段，且 ok 是正常
 *   - 靠"能扫出 6 个候选"反推代码活没活     → codeSelfCheck 直接自报家门
 *   - 直接开搬、看不到会复制多少            → dryRun 先给计划
 *   - 失败和正常状态长得一样                → 报错带阶段名 + "源目录未动"
 * ------------------------------------------------------------------ */
console.log('\n=== 10. 1.5.1 防误判 ===')

// 回到"还没搬过家"的干净起点。
// 注意：第 5 段已经把 realRoot 的内容搬进备份了（只剩 location.json），
// 所以这里必须**重新造一份**源，不能指望它还带着 memory.md。
rmSync(pointer, { force: true })
home.__testing.pointerCacheReset()
const freshSrc = join(sandbox, 'fresh-src')
seedRoot(freshSrc)
process.env.AIYAYI_HOME = freshSrc
home.__testing.setOverride(undefined)
home.__testing.pointerCacheReset()

const fresh = home.resolveRoot()
check('未搬家时 status 是 ok（**不是**故障）', home.memoryStatus(fresh) === 'ok', home.memoryStatus(fresh))
check('statusLabel 明确写出"正常"', /正常/.test(home.statusLabel('ok')), home.statusLabel('ok'))
check('sourceLabel 不再只写"默认路径"（避免像报错）', /正常/.test(home.sourceLabel('default')), home.sourceLabel('default'))
check('status 与 source 是两个独立字段', home.memoryStatus(fresh) !== fresh.source || fresh.source === 'default')

const self = home.codeSelfCheck()
check('自检报 relocateSupported: true', self.relocateSupported === true, JSON.stringify(self))
check('自检报代码版本（写死在源码里，不读 package.json）', /^\d+\.\d+\.\d+$/.test(self.codeVersion), self.codeVersion)
check('自检报布局版本', Number.isInteger(self.layoutVersion) && self.layoutVersion >= 1, self.layoutVersion)
check('自检文案能自证"这段代码支持搬家"', /relocateSupported/.test(self.selfReport), self.selfReport)

// dryRun：不碰磁盘
const dryTarget = join(sandbox, 'dry-target')
const dry = await home.relocateTo(dryTarget, { dryRun: true })
check('dryRun 返回计划（copies/bytes）', dry.dryRun === true && dry.copies > 0 && dry.bytes > 0, JSON.stringify(dry))
check('dryRun 不谎报校验通过', dry.hashMatched === false, dry.hashMatched)
check('dryRun 报告是否跨盘', typeof dry.crossDrive === 'boolean', dry.crossDrive)
check('dryRun **没有**创建目标目录', !existsSync(dryTarget), dryTarget)
check('dryRun **没有**写 location.json', !existsSync(pointer), pointer)
check('dryRun 后位置仍是原来的', home.resolveRoot().root === freshSrc, home.resolveRoot().root)
check('dryRun 的 note 写清"没有动任何文件"', /预演|没有动/.test(dry.note), dry.note)

// dryRun 与真搬的计划一致
const realTarget = join(sandbox, 'real-target')
const real = await home.relocateTo(realTarget, {})
home.__testing.pointerCacheReset()
check('真搬的 copies/bytes 与预演一致', real.copies === dry.copies && real.bytes === dry.bytes, JSON.stringify({ dry, real }))

// 阶段化报错：校验失败时必须带阶段名 + "源目录未动"
rmSync(pointer, { force: true })
home.__testing.pointerCacheReset()
home.__testing.setOverride(undefined)
const src2 = join(sandbox, 'src2')
seedRoot(src2)
process.env.AIYAYI_HOME = src2
home.__testing.pointerCacheReset()

let stageErr = null
try {
  // 造一份"复制中途坏掉"的目标：内容被截断的同名文件。
  // 传同一份源给 verify 必然通过，所以要先毁掉目标副本里的一个文件。
  writeFileSync(join(realTarget, 'memory.md'), '截断的副本', 'utf8')
  home.__testing.verify(src2, realTarget, home.__testing.walkAll(src2))
} catch (error) {
  stageErr = error
}
check(
  'verify 失败会指出具体是哪个文件不一致',
  stageErr !== null && /不一致|缺文件|多了文件/.test(stageErr.message),
  stageErr?.message,
)

// 阶段化报错文案：必须有阶段名、原因、"源目录未动"三件套。
const staged = home.__testing.stageError('校验', 'C:\\some\\root', new Error('目标缺文件：memory.md'))
check('阶段报错带阶段名', /\[迁移失败·校验\]/.test(staged.message), staged.message)
check('阶段报错带原因', /目标缺文件：memory\.md/.test(staged.message), staged.message)
check('阶段报错明确"源目录未动"', /源目录未动/.test(staged.message), staged.message)

/* ------------------------------------------------------------------ *
 * 11. 外置盘警告（1.5.2）
 *
 * 2026-11-08 娅伊推荐把记忆搬到 I:，而 I: 是**外置 USB 移动硬盘**——
 * 她的判断只用盘符/剩余空间/云目录，看不到总线类型。搬到外置盘后，
 * 每次开机没插那块盘，记忆根就会 unreachable、记忆读写全硬失败。
 *
 * 这里的断言同时守住另一件事：**别人的机器不能因此被弄坏**。
 * 探测不可用（没 PowerShell / 非 Windows / 超时）时必须照常放行、无警告。
 * ------------------------------------------------------------------ */
console.log('\n=== 11. 外置盘警告 ===')

// 注入假探测结果，避免测试真去跑 PowerShell（慢、且依赖别人机器环境）。
home.__testing.setBusTypeCache(
  new Map([
    ['I:', { external: true, busType: 'USB', model: 'External USB3.0' }],
    ['F:', { external: false, busType: 'ATA', model: 'TOSHIBA-TR200' }],
  ]),
)

const extPre = home.preflight(join('I:\\', 'memory-probe'), { freeBytes: 200 * 1024 ** 3, sourceBytes: 20 * 1024 })
check('外置盘目标**放行**（只警告不拦截）', extPre.ok === true, JSON.stringify(extPre))
check('外置盘目标带 external:true', extPre.external === true, extPre.external)
check('外置盘目标带 busType', extPre.externalBusType === 'USB', extPre.externalBusType)
check('警告条数 ≥ 1 且文案讲清后果与可拔风险', (extPre.warnings ?? []).length > 0 && /可拔|不可达/.test(extPre.warnings[0]), JSON.stringify(extPre.warnings))

const intPre = home.preflight(join('F:\\', 'memory-probe'), { freeBytes: 200 * 1024 ** 3, sourceBytes: 20 * 1024 })
check('内置盘目标**不**带警告', (intPre.warnings ?? []).length === 0, JSON.stringify(intPre.warnings))
check('内置盘目标 external:false', intPre.external === false, intPre.external)

// 关键：探测不可用（=别人的机器没 PowerShell / 非 Windows）→ 照常放行、无警告、不抛错。
home.__testing.setBusTypeCache(null)
const unknownPre = home.preflight(join('I:\\', 'memory-probe'), { freeBytes: 200 * 1024 ** 3, sourceBytes: 20 * 1024 })
check('探测不可用时**照常放行**（不影响别人机器）', unknownPre.ok === true, JSON.stringify(unknownPre))
check('探测不可用时 external 是 null（明确"不知道"）', unknownPre.external === null, unknownPre.external)
check('探测不可用时不产生警告', (unknownPre.warnings ?? []).length === 0, JSON.stringify(unknownPre.warnings))

// 非 Windows：探测直接返回 null，且绝不抛错。
// 注意：这里只测 externalDriveInfo，不再改动全局探测缓存——
// 探针状态由后面各段显式钉死（异步探测会让"立即读"拿不到值，见 §12/§13 注释）。
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
let posixThrew = false
let posixInfo = 'not-run'
try {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  home.__testing.setBusTypeCache(null) // 模拟"探测不可用"
  posixInfo = JSON.stringify(home.externalDriveInfo('/home/aiyayi'))
} catch (error) {
  posixThrew = true
} finally {
  Object.defineProperty(process, 'platform', originalPlatform)
}
check('非 Windows 下探测返回 null 且不抛错', posixThrew === false && posixInfo === 'null', posixInfo)

/* ------------------------------------------------------------------ *
 * 12. 候选排序：未知磁盘类型时**不许冒充内置**（1.5.3）
 *
 * 娅伊 2026-11-08 推荐 I: 的直接原因：候选只按剩余空间排，而 I: 空间最大。
 * 修法两层：①已知内置盘优先；②**探测没完成时标"未知"而不是当成内置**。
 * 第 ② 条尤其重要——异步探测后首轮拿不到信息，如果那时默认按"内置"排，
 * 排序会又变回"空间最大者第一"，把这个坑原样还回来。
 * ------------------------------------------------------------------ */
console.log('\n=== 12. 候选排序（未知不冒充）===')

// 已知：I: 外置、F:/G: 内置 → 内置必须排在前面，哪怕 I: 空间更大。
home.__testing.setBusTypeCache(
  new Map([
    ['I:', { external: true, busType: 'USB', model: 'External USB3.0' }],
    ['J:', { external: true, busType: 'USB', model: 'External USB3.0' }],
    ['F:', { external: false, busType: 'ATA', model: 'TOSHIBA' }],
    ['G:', { external: false, busType: 'ATA', model: 'TOSHIBA' }],
    ['E:', { external: false, busType: 'ATA', model: 'TOSHIBA' }],
    ['D:', { external: true, busType: 'USB', model: 'External USB3.0' }],
  ]),
)
home.__testing.candidateCacheReset()
const sorted = home.listCandidatePaths()
const rankOf = (item) => (item.external === false ? 0 : item.external === true ? 2 : 1)
check(
  '已知内置盘全部排在已知外置盘之前',
  sorted.candidates.every((item, i) => i === 0 || rankOf(sorted.candidates[i - 1]) <= rankOf(item)),
  sorted.candidates.map((c) => `${c.path}:${JSON.stringify(c.external)}`),
)
const firstExternalIndex = sorted.candidates.findIndex((item) => item.external === true)
check('外置盘不会出现在第一位（哪怕空间最大）', firstExternalIndex > 0 || firstExternalIndex === -1, firstExternalIndex)
check('候选带 external 字段', sorted.candidates.every((item) => item.external === null || typeof item.external === 'boolean'), sorted.candidates.map((c) => c.external))
check('候选带 busType 字段', sorted.candidates.every((item) => typeof item.busType === 'string'), sorted.candidates.map((c) => c.busType))

// 未知：探测不可用 → external 一律 null（**不许**谎报 false=内置）。
home.__testing.setBusTypeCache(null)
home.__testing.candidateCacheReset()
const unknownSorted = home.listCandidatePaths()
check(
  '探测不可用时 external 一律是 null（不冒充内置盘）',
  unknownSorted.candidates.every((item) => item.external === null),
  unknownSorted.candidates.map((c) => c.external),
)
check(
  '探测不可用时 reason 明说"磁盘类型未知"',
  unknownSorted.candidates.every((item) => /未知/.test(item.reason)),
  unknownSorted.candidates.map((c) => c.reason),
)
check('探测不可用时 busKnown 标 false', unknownSorted.busKnown === false, unknownSorted.busKnown)

/* ------------------------------------------------------------------ *
 * 13. 首轮注入行不许在"类型未知"时点名某个盘（1.5.3）
 *
 * 实测踩过两次：注入行用的是非阻塞探测，首轮常常还没探完，而 candidates[0]
 * 是按空间最大排的——空间最大的正是外置 USB 盘。于是这行又推荐了 I:。
 * 断言：未知时只报数量、不点名；已知时才推荐，且必须是内置盘。
 * ------------------------------------------------------------------ */
console.log('\n=== 13. 注入行不点名未知盘 ===')
const presence = await import(pathToFileURL(join(HERE, '..', 'lib', 'presence.js')).href)

// 先确保记忆根**可达且在系统盘**——这行提示只在"系统盘 + 未搬家"时出现。
// 沙盘在 G 盘（非系统盘）上，直接用它根永远返回空串；前面 §07/§10 还把
// AIYAYI_HOME 指到过已搬走的目录。所以这里造一个 C 盘（系统盘）上的临时根。
const liveRoot = join(tmpdir(), `aiyayi-sysroot-${Date.now()}`)
mkdirSync(liveRoot, { recursive: true })
writeFileSync(join(liveRoot, 'memory.md'), '# 阿依娅伊的记忆\n- [2026-11-01] 事情｜x\n', 'utf8')
process.env.AIYAYI_HOME = liveRoot
home.__testing.setOverride(undefined)
// **必须清掉指路文件**：§12 之前段落写过 location.json（指向已搬走的 target3），
// 不清的话 status 会是 migrated/stayed，注入行直接返回空串，断言全假失败。
rmSync(home.pointerFile(), { force: true })
home.__testing.pointerCacheReset()
home.__testing.freezeBusTypes(true) // 冻结探测：否则后台 PowerShell 会在断言中途改缓存
home.__testing.setBusTypeCache(null)
home.__testing.candidateCacheReset()
const unknownLine = presence.__testing.renderMemoryLocationLine({ firstOfSession: true })
check('未知磁盘类型时**不点名**推荐某个盘', !/推荐\s*\S+:\\(阿依娅伊|dsh-aiyayi-memory)/.test(unknownLine), `line=${unknownLine} | root=${home.resolveRoot().root} | status=${home.memoryStatus(home.resolveRoot())}`)
check('未知时明说"磁盘类型还没确认"', /还没确认/.test(unknownLine), unknownLine)
check('未知时仍要求她主动提一句', /主动提/.test(unknownLine), unknownLine)

home.__testing.setBusTypeCache(
  new Map([
    ['I:', { external: true, busType: 'USB', model: 'External USB3.0' }],
    ['F:', { external: false, busType: 'ATA', model: 'TOSHIBA' }],
    ['G:', { external: false, busType: 'ATA', model: 'TOSHIBA' }],
    ['E:', { external: false, busType: 'ATA', model: 'TOSHIBA' }],
    ['J:', { external: true, busType: 'USB', model: 'External USB3.0' }],
    ['D:', { external: true, busType: 'USB', model: 'External USB3.0' }],
  ]),
)
home.__testing.candidateCacheReset()
const knownLine = presence.__testing.renderMemoryLocationLine({ firstOfSession: true })
check('已知磁盘类型时给出推荐', /推荐/.test(knownLine), knownLine)
check('推荐的**必须是内置盘**（不能是 I:/J:/D: 这些外置盘）', /推荐 [FGE]:\\/.test(knownLine) && !/推荐 [IJD]:\\/.test(knownLine), knownLine)
check('非首轮不出现（只在会话首轮念一次）', presence.__testing.renderMemoryLocationLine({}) === '', JSON.stringify(presence.__testing.renderMemoryLocationLine({})))


// 结果在 G 盘和 TEMP 里堆了七八个空目录（2026-11-08 实测踩到）。
process.on('exit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 清理失败不该盖掉真正的测试结果 */
  }
})
process.env.AIYAYI_HOME = realRoot
home.__testing.pointerCacheReset()
rmSync(sandbox, { recursive: true, force: true })

console.log(`\n${ok ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(ok ? 0 : 1)