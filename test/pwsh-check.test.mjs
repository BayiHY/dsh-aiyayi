/**
 * PowerShell 版本体检单测（1.5.28）。
 *
 * 钉死需求里的每一条硬约束：
 *   - 只在 win32 检查（非 win32 一个子进程都不起）
 *   - 探 pwsh 不是 powershell.exe；ENOENT = 需要提示
 *   - 超时有保护，超时按"没装"降级，且绝不抛错
 *   - 解析主版本号，< 7 才提示
 *   - 只提示一次（落盘记住），装上新版（≥7）不再提、且清掉记录
 *   - 缓存过期会重查（兜住"这期间自己装上了"）
 *   - 任何失败都只返回空串，不影响对话
 *
 * 所有用例都不碰真机 pwsh：要么走纯函数，要么给 spawn 塞假进程，
 * 状态文件用 AIYAYI_HOME 指到临时目录。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const home = mkdtempSync(join(tmpdir(), 'aiyayi-pwsh-'))
process.env.AIYAYI_HOME = home

/**
 * 关键安全线：**光设 AIYAYI_HOME 是不够的**。
 *
 * home.js 的解析优先级是 指路文件 > AIYAYI_HOME > 默认路径。真机上装了插件、
 * 搬过家的话 `~/.dsh/aiyayi/location.json` 是存在的——它会直接压掉环境变量，
 * 于是 writePwshState 就写到用户**真实的记忆根**里去了。
 * 2026-11-11 实测踩到：第一次跑这个测试就在 D:\阿依娅伊\记忆\ 下写出了 pwsh.json。
 * 所以必须像 home-relocate.test.mjs 那样，连指路文件一起定向到沙盘。
 */
const homeLib = await import('../lib/home.js')
homeLib.__testing.setPointerPath(join(home, 'location.json'))

const {
  AWAIT_BUDGET_MS,
  MIN_MAJOR,
  PWSH_ARGS,
  PROBE_TIMEOUT_MS,
  PWSH_TIP,
  __testing,
  decidePwshNotice,
  detectPwshVersion,
  isPwshStateFresh,
  isPwshTooOld,
  maybePwshNotice,
  parsePwshMajor,
  readPwshState,
  warmPwshProbe,
  writePwshState,
} = await import('../lib/pwsh-check.js')
const { pwshFile } = homeLib

/** 再兜一道：状态文件必须落在沙盘里，否则直接判测试自身坏了（绝不写脏真机记忆）。 */
{
  const resolved = pwshFile()
  if (!resolved.startsWith(home)) {
    throw new Error(`测试沙盘失效：pwshFile()=${resolved} 不在 ${home} 内，拒绝继续（会写脏真机记忆根）`)
  }
}

/** 每个用例开始前清干净：状态文件 + 单飞探针。 */
function reset() {
  __testing.resetProbe()
  try {
    rmSync(pwshFile(), { force: true })
  } catch {
    /* 没有就算了 */
  }
}

/**
 * 假子进程：可控地吐 stdout / 报 error / 按指定 code 关闭。
 * @param {object} plan { stdout?, code?, errorCode?, never?:boolean }
 */
function fakeSpawn(plan = {}) {
  const calls = []
  const impl = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {
      child.killed = true
    }
    child.killed = false
    if (plan.never) return child
    // 异步触发，模拟真实子进程的时序。
    setImmediate(() => {
      if (plan.errorCode) {
        const error = new Error(`spawn ${plan.errorCode}`)
        error.code = plan.errorCode
        child.emit('error', error)
        return
      }
      if (plan.stdout !== undefined) child.stdout.emit('data', plan.stdout)
      child.emit('close', plan.code ?? 0)
    })
    return child
  }
  impl.calls = calls
  return impl
}

/* ------------------------------------------------------------------ *
 * 1. 平台判断
 * ------------------------------------------------------------------ */

test('平台：非 win32 直接 skip，一个子进程都不起', async (t) => {
  t.after(reset)
  reset()
  const spawnImpl = fakeSpawn({ stdout: '5' })
  for (const platform of ['linux', 'darwin', 'freebsd', 'aix']) {
    const result = await detectPwshVersion({ platform, spawnImpl })
    assert.equal(result.status, 'skip', `${platform} 应跳过`)
    assert.equal(result.major, null)
  }
  assert.equal(spawnImpl.calls.length, 0, '非 win32 不该 spawn 任何进程')
})

test('平台：非 win32 的提示判定也是安静（notice=false）', () => {
  for (const platform of ['linux', 'darwin']) {
    const decision = decidePwshNotice({ state: { checkedAt: null, major: null }, platform })
    assert.equal(decision.notice, false)
    assert.equal(decision.needProbe, false, '非 win32 连探都不该安排')
  }
})

test('平台：win32 才真去探，且探的是 pwsh 不是 powershell.exe', async (t) => {
  t.after(reset)
  reset()
  const spawnImpl = fakeSpawn({ stdout: '7\r\n' })
  const result = await detectPwshVersion({ platform: 'win32', spawnImpl })
  assert.equal(result.status, 'ok')
  assert.equal(result.major, 7)
  assert.equal(spawnImpl.calls.length, 1)
  assert.equal(spawnImpl.calls[0].command, 'pwsh', '必须是 pwsh（7），不是 powershell.exe（5.1）')
  assert.deepEqual(spawnImpl.calls[0].args, PWSH_ARGS)
  assert.ok(PWSH_ARGS.includes('-NoProfile'), '带 -NoProfile，别加载用户 profile 拖慢/带噪音')
  assert.equal(spawnImpl.calls[0].options.windowsHide, true, '别弹黑窗')
})

/* ------------------------------------------------------------------ *
 * 2. 版本解析
 * ------------------------------------------------------------------ */

test('解析：干净数字 / CRLF / 前后空白 / 噪音行都认', () => {
  assert.equal(parsePwshMajor('7'), 7)
  assert.equal(parsePwshMajor('7\r\n'), 7)
  assert.equal(parsePwshMajor('  5  \n'), 5)
  assert.equal(parsePwshMajor('WARNING: 某句噪音\r\n7\r\n'), 7, '噪音行之后仍能解析')
  assert.equal(parsePwshMajor('10\n'), 10)
  assert.equal(parsePwshMajor('6'), 6)
})

test('解析：解析不出来给 null（不瞎猜成 0 或 7）', () => {
  assert.equal(parsePwshMajor(''), null)
  assert.equal(parsePwshMajor(null), null)
  assert.equal(parsePwshMajor(undefined), null)
  assert.equal(parsePwshMajor('not a version'), null)
  assert.equal(parsePwshMajor('7.4.1'), null, '带小版本号不是 Major 那一行，不硬认')
  assert.equal(parsePwshMajor('123'), null, '三位数不是主版本')
})

test('判旧：< 7 是旧，≥ 7 够用，null 一律当旧', () => {
  assert.equal(isPwshTooOld(5), true, '5.1 环境要提示')
  assert.equal(isPwshTooOld(6), true)
  assert.equal(isPwshTooOld(7), false)
  assert.equal(isPwshTooOld(8), false)
  assert.equal(isPwshTooOld(null), true, '探不出来按"没装"处理，要提示')
  assert.equal(isPwshTooOld(undefined), true)
  assert.equal(MIN_MAJOR, 7)
})

/* ------------------------------------------------------------------ *
 * 3. 超时 / ENOENT / 其他失败的降级
 * ------------------------------------------------------------------ */

test('降级：ENOENT = 机器上只有 5.1 → status:missing，major:null，不抛', async (t) => {
  t.after(reset)
  reset()
  const result = await detectPwshVersion({ platform: 'win32', spawnImpl: fakeSpawn({ errorCode: 'ENOENT' }) })
  assert.equal(result.status, 'missing')
  assert.equal(result.major, null)
  assert.equal(result.detail, 'ENOENT')
})

test('降级：其他 error 也是 major:null，不抛', async (t) => {
  t.after(reset)
  reset()
  const result = await detectPwshVersion({ platform: 'win32', spawnImpl: fakeSpawn({ errorCode: 'EACCES' }) })
  assert.equal(result.status, 'error')
  assert.equal(result.major, null)
})

test('降级：非零退出 = major:null', async (t) => {
  t.after(reset)
  reset()
  const result = await detectPwshVersion({ platform: 'win32', spawnImpl: fakeSpawn({ stdout: '5', code: 1 }) })
  assert.equal(result.status, 'error')
  assert.equal(result.major, null)
})

test('降级：输出解析不出来 = major:null', async (t) => {
  t.after(reset)
  reset()
  const result = await detectPwshVersion({ platform: 'win32', spawnImpl: fakeSpawn({ stdout: '哈哈哈' }) })
  assert.equal(result.status, 'error')
  assert.equal(result.major, null)
})

test('超时：卡住的子进程按"未安装"降级，并 kill 掉，绝不挂住调用方', async (t) => {
  t.after(reset)
  reset()
  const spawnImpl = fakeSpawn({ never: true })
  const started = Date.now()
  const result = await detectPwshVersion({ platform: 'win32', spawnImpl, timeoutMs: 60 })
  const elapsed = Date.now() - started
  assert.equal(result.status, 'timeout')
  assert.equal(result.major, null, '超时按未安装处理')
  assert.ok(elapsed < 1500, `超时应该 ~60ms 就返回，实际 ${elapsed}ms`)
  const child = spawnImpl.calls.length === 1
  assert.equal(child, true)
})

test('超时：真的把子进程 kill 掉（不留孤儿）', async (t) => {
  t.after(reset)
  reset()
  let killed = false
  const spawnImpl = () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {
      killed = true
    }
    return child // 永不 close
  }
  const result = await detectPwshVersion({ platform: 'win32', spawnImpl, timeoutMs: 50 })
  assert.equal(result.status, 'timeout')
  assert.equal(killed, true, '超时必须 kill 子进程')
})

test('超时：spawn 同步抛错也不崩', async (t) => {
  t.after(reset)
  reset()
  const result = await detectPwshVersion({
    platform: 'win32',
    spawnImpl: () => {
      throw new Error('boom')
    },
  })
  assert.equal(result.status, 'missing')
  assert.equal(result.major, null)
})

test('超时参数：探针超时落在需求给的 2~3 秒区间', () => {
  assert.ok(PROBE_TIMEOUT_MS >= 2000 && PROBE_TIMEOUT_MS <= 3000, `实际 ${PROBE_TIMEOUT_MS}ms`)
  assert.ok(AWAIT_BUDGET_MS <= PROBE_TIMEOUT_MS, '对话里等的时间不该超过探针本身超时')
})

/* ------------------------------------------------------------------ *
 * 4. 只提示一次 / ≥7 不提示 / 缓存过期重查
 * ------------------------------------------------------------------ */

test('提示：没装 pwsh → 返回提示文案，并落盘记住', async (t) => {
  t.after(reset)
  reset()
  const text = await maybePwshNotice({ platform: 'win32', spawnImpl: fakeSpawn({ errorCode: 'ENOENT' }) })
  assert.equal(text, PWSH_TIP)
  const state = readPwshState()
  assert.ok(state.checkedAt, '应记下检查时间')
  assert.equal(state.major, null)
  assert.ok(state.notifiedAt, '应记下"提过了"')
})

test('只提示一次：第二次调用不再提（缓存命中也别提）', async (t) => {
  t.after(reset)
  reset()
  const spawnImpl = fakeSpawn({ stdout: '5' })
  const first = await maybePwshNotice({ platform: 'win32', spawnImpl })
  assert.equal(first, PWSH_TIP)
  const second = await maybePwshNotice({ platform: 'win32', spawnImpl })
  assert.equal(second, '', '同一台机器只提一次')
})

test('只提示一次：重开进程（状态从盘上读）也不再提', async (t) => {
  t.after(reset)
  reset()
  await maybePwshNotice({ platform: 'win32', spawnImpl: fakeSpawn({ errorCode: 'ENOENT' }) })
  // 换一个全新的探针（模拟新进程，只剩盘上的 pwsh.json）
  __testing.resetProbe()
  const second = await maybePwshNotice({ platform: 'win32', spawnImpl: fakeSpawn({ errorCode: 'ENOENT' }) })
  assert.equal(second, '', '重启后仍认账，不重复念')
})

test('只提示一次：写盘失败也不会每轮刷屏（进程内也不会重复说）', async (t) => {
  t.after(() => {
    process.env.AIYAYI_HOME = before
    reset()
  })
  reset()
  // 把记忆根指到一个"父级是文件"的路径：mkdirSync 必失败，写盘必失败。
  const before = process.env.AIYAYI_HOME
  const blocker = join(home, 'blocker-file')
  writeFileSync(blocker, 'i am a file, not a dir', 'utf8')
  process.env.AIYAYI_HOME = join(blocker, 'sub')
  __testing.resetProbe()
  // 写盘失败不该抛错、不该影响返回值。
  const text = await maybePwshNotice({ platform: 'win32', spawnImpl: fakeSpawn({ errorCode: 'ENOENT' }) })
  assert.equal(text, PWSH_TIP, '写不进去也照样把话说出来（只是下次可能再提一次）')
  assert.equal(writePwshState({ checkedAt: new Date().toISOString(), major: 5, notifiedAt: null, notifiedMajor: null }), false, '写盘应明确返回 false 而不是抛')
})

test('≥7 不提示：装的是 7 就一个字都不说', async (t) => {
  t.after(reset)
  reset()
  const text = await maybePwshNotice({ platform: 'win32', spawnImpl: fakeSpawn({ stdout: '7' }) })
  assert.equal(text, '')
  const state = readPwshState()
  assert.equal(state.major, 7)
  assert.equal(state.notifiedAt, null, '够用就不该记"提过"')
})

test('≥7 不提示：8 / 10 同样安静', async (t) => {
  t.after(reset)
  for (const major of ['8', '10']) {
    reset()
    const text = await maybePwshNotice({ platform: 'win32', spawnImpl: fakeSpawn({ stdout: major }) })
    assert.equal(text, '', `${major} 不该提示`)
  }
})

test('升级后不再提：上次提过 5.1，这次探到 7 → 不提示且清掉提过记录', async (t) => {
  t.after(reset)
  reset()
  // 先造一份"提过 5.1"的旧状态。
  writePwshState({
    checkedAt: new Date().toISOString(),
    major: 5,
    notifiedAt: new Date().toISOString(),
    notifiedMajor: 5,
  })
  __testing.resetProbe()
  // 缓存还新鲜，先确认按缓存判定 = 不提（已经说过了）。
  assert.equal(decidePwshNotice({ state: readPwshState(), platform: 'win32' }).notice, false)
  // 缓存过期后重查 → 探到 7 → 清记录。
  const text = await maybePwshNotice({
    platform: 'win32',
    spawnImpl: fakeSpawn({ stdout: '7' }),
    now: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 天后
  })
  assert.equal(text, '')
  const state = readPwshState()
  assert.equal(state.major, 7)
  assert.equal(state.notifiedAt, null, '装上新版后把提过记录清掉（将来降级还能再提）')
})

test('缓存过期：7 天前的记录会重查（兜住"这期间自己装上了 pwsh"）', async (t) => {
  t.after(reset)
  reset()
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  writePwshState({ checkedAt: old, major: null, notifiedAt: old, notifiedMajor: null })
  __testing.resetProbe()
  const decision = decidePwshNotice({ state: readPwshState(), platform: 'win32' })
  assert.equal(decision.needProbe, true, '过期要重查')
  assert.equal(decision.stale, true)

  const spawnImpl = fakeSpawn({ stdout: '7' })
  const text = await maybePwshNotice({ platform: 'win32', spawnImpl })
  assert.equal(text, '', '人家已经装上了就别再念')
  assert.equal(spawnImpl.calls.length, 1)
  assert.equal(readPwshState().major, 7)
})

test('缓存新鲜：不重查（省掉每次会话都起子进程）', async (t) => {
  t.after(reset)
  reset()
  writePwshState({ checkedAt: new Date().toISOString(), major: 5, notifiedAt: null, notifiedMajor: null })
  __testing.resetProbe()
  const spawnImpl = fakeSpawn({ stdout: '5' })
  const text = await maybePwshNotice({ platform: 'win32', spawnImpl })
  assert.equal(spawnImpl.calls.length, 0, '缓存新鲜就不该再探')
  assert.equal(text, PWSH_TIP, '从缓存直接给出提示')
})

test('缓存判定：坏时间戳当过期，不永远认账', () => {
  assert.equal(isPwshStateFresh({ checkedAt: 'not-a-date' }), false)
  assert.equal(isPwshStateFresh({ checkedAt: null }), false)
  assert.equal(isPwshStateFresh({}), false)
  assert.equal(isPwshStateFresh({ checkedAt: new Date().toISOString() }), true)
})

/* ------------------------------------------------------------------ *
 * 5. 整体：绝不阻塞、绝不抛错
 * ------------------------------------------------------------------ */

test('绝不阻塞：探针卡住时这一轮直接返回空串（预算内没结果就闭嘴）', async (t) => {
  t.after(reset)
  reset()
  const started = Date.now()
  const text = await maybePwshNotice({
    platform: 'win32',
    spawnImpl: fakeSpawn({ never: true }),
    budgetMs: 80,
    timeoutMs: 5000,
  })
  const elapsed = Date.now() - started
  assert.equal(text, '', '预算内没结果就不说，别拖住对话')
  assert.ok(elapsed < 1200, `应 ~80ms 返回，实际 ${elapsed}ms`)
})

test('绝不抛错：各种坏参数下都只返回字符串（不真起子进程）', async (t) => {
  t.after(reset)
  reset()
  const cases = [
    { platform: 'linux' },
    { platform: 'win32', spawnImpl: fakeSpawn({ errorCode: 'ENOENT' }) },
    { platform: 'win32', spawnImpl: fakeSpawn({ never: true }), budgetMs: 30, timeoutMs: 5000 },
    { platform: 'win32', spawnImpl: fakeSpawn({ stdout: '5' }), now: NaN },
    { platform: 'win32', spawnImpl: fakeSpawn({ stdout: '5' }), ttlMs: NaN, budgetMs: NaN },
    { platform: 'win32', spawnImpl: () => { throw new Error('boom') } },
  ]
  for (const opts of cases) {
    reset()
    const text = await maybePwshNotice(opts)
    assert.equal(typeof text, 'string', `opts=${JSON.stringify(opts)} 应返回字符串`)
  }
})

test('绝不抛错：状态文件是坏 JSON 也能继续', async (t) => {
  t.after(reset)
  reset()
  writeFileSync(pwshFile(), '{ 这不是 JSON', 'utf8')
  const state = readPwshState()
  assert.equal(state.checkedAt, null)
  assert.equal(state.major, null)
  const text = await maybePwshNotice({ platform: 'win32', spawnImpl: fakeSpawn({ errorCode: 'ENOENT' }) })
  assert.equal(text, PWSH_TIP)
})

test('预热：warmPwshProbe 不抛错、不 await 卡住，且把结果落盘', async (t) => {
  t.after(reset)
  reset()
  const spawnImpl = fakeSpawn({ stdout: '7' })
  await warmPwshProbe({ platform: 'win32', spawnImpl })
  // 预热是 fire-and-forget，等一拍让 then 里的落盘跑完。
  await new Promise((r) => setTimeout(r, 50))
  const state = readPwshState()
  assert.equal(state.major, 7, '预热结果应落盘，省得第一个会话再探')
  assert.ok(spawnImpl.calls.length >= 1)
})

test('预热：非 win32 什么都不做', async (t) => {
  t.after(reset)
  reset()
  const spawnImpl = fakeSpawn({ stdout: '5' })
  await warmPwshProbe({ platform: 'linux', spawnImpl })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(spawnImpl.calls.length, 0)
  assert.equal(readPwshState().checkedAt, null)
})

/* ------------------------------------------------------------------ *
 * 6. 文案口径
 * ------------------------------------------------------------------ */

test('文案：口语化、非命令式、说清可以帮他升，且注明只说一次', () => {
  assert.ok(PWSH_TIP.includes('PowerShell 7'), '要点明装 7')
  assert.ok(PWSH_TIP.includes('5.1'), '要点明当前是旧版')
  assert.ok(PWSH_TIP.includes('我可以帮你'), '要给出"能帮"的口子')
  assert.ok(PWSH_TIP.includes('只提这一次'), '要注明只说一次，避免她自己反复念')
  for (const bad of ['错误', '失败', '警告', '必须', '立即']) {
    assert.ok(!PWSH_TIP.includes(bad), `文案不该带"${bad}"这种警告/命令口吻`)
  }
})

test('状态文件：与 updates.json 同目录同风格（扁平 JSON + ISO 时间）', (t) => {
  t.after(reset)
  reset()
  writePwshState({ checkedAt: new Date().toISOString(), major: 5, notifiedAt: null, notifiedMajor: null })
  assert.ok(existsSync(pwshFile()))
  assert.equal(pwshFile(), join(home, 'pwsh.json'), '落在记忆根下，与 updates.json 同目录')
  const parsed = JSON.parse(readFileSync(pwshFile(), 'utf8'))
  assert.ok(parsed.checkedAt.includes('T'), '时间用 ISO')
  assert.equal(parsed.major, 5)
})

console.log('\nALL PASS')
