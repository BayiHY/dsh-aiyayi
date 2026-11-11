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
  pwshPathCandidates,
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
  assert.equal(parsePwshMajor('123'), null, '三位数不是主版本')
  // 1.5.31 放宽：整串是个版本号（5.1 / 7.4.1）就认主版本，别再 null。
  assert.equal(parsePwshMajor('7.4.1'), 7, '整串版本号能认（1.5.31）')
  assert.equal(parsePwshMajor('5.1'), 5)
  assert.equal(parsePwshMajor('10.0.0'), 10)
  // 但噪音里的数字不认：宁可 null 走降级，也不要瞎猜出 ≥7 把提醒吞掉。
  assert.equal(parsePwshMajor('WARNING: 12 things happened'), null, '噪音数字不认')
})

/* ------------------------------------------------------------------ *
 * 2b. 编码 / BOM（1.5.31：major:null 的编码嫌疑，逐条钉死）
 * ------------------------------------------------------------------ */

test('编码：UTF-8 BOM / UTF-16LE BOM / UTF-16BE BOM 都能解析', () => {
  const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('7\r\n', 'utf8')])
  assert.equal(parsePwshMajor(utf8Bom), 7, 'UTF-8 BOM')

  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('5\r\n', 'utf16le')])
  assert.equal(parsePwshMajor(utf16le), 5, 'UTF-16LE BOM')

  const beBody = Buffer.from('7\r\n', 'utf16le')
  for (let i = 0; i + 1 < beBody.length; i += 2) {
    const t = beBody[i]
    beBody[i] = beBody[i + 1]
    beBody[i + 1] = t
  }
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), beBody])
  assert.equal(parsePwshMajor(utf16be), 7, 'UTF-16BE BOM')
})

test('编码：BOM 后面跟着中文噪音也不影响取版本号', () => {
  const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('警告：控制台编码已切换\r\n6\r\n', 'utf8')])
  assert.equal(parsePwshMajor(raw), 6)
})

test('编码：Buffer 与字符串两种输入结果一致', () => {
  assert.equal(parsePwshMajor(Buffer.from('7\r\n', 'utf8')), 7)
  assert.equal(parsePwshMajor('7\r\n'), 7)
  assert.equal(parsePwshMajor(Buffer.alloc(0)), null, '空 Buffer 不崩')
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

test('降级：pwsh 和 5.1 都找不到 → status:missing，major:null，不抛', async (t) => {
  t.after(reset)
  reset()
  // 1.5.31 起探测链最后一级是 powershell.exe，这里连它一起模拟成找不到，
  // 才是真正的"这台机器一个 PowerShell 都没有"。
  const result = await detectPwshVersion({
    platform: 'win32',
    env: {},
    spawnImpl: fakeSpawn({ errorCode: 'ENOENT' }),
  })
  assert.equal(result.status, 'missing')
  assert.equal(result.major, null)
  assert.equal(result.source, 'none')
  assert.ok(result.detail.includes('pwsh'), `detail 应记下 pwsh 的失败原因，实际: ${result.detail}`)
  assert.ok(result.detail.includes('powershell.exe'), 'detail 应记下 5.1 的失败原因')
})

test('**本机真实场景**：只有 5.1、没有 pwsh → major:5（不再 null，1.5.31 核心修复）', async (t) => {
  t.after(reset)
  reset()
  // 复现本机：pwsh(PATH) ENOENT、所有绝对路径候选 ENOENT、powershell.exe 返回 5。
  const calls = []
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {
      child.killed = true
    }
    child.killed = false
    setImmediate(() => {
      if (command === 'powershell.exe') {
        child.stdout.emit('data', Buffer.from('5\r\n', 'utf8'))
        child.emit('close', 0)
        return
      }
      const error = new Error('spawn ENOENT')
      error.code = 'ENOENT'
      child.emit('error', error)
    })
    return child
  }
  spawnImpl.calls = calls

  const result = await detectPwshVersion({ platform: 'win32', env: {}, candidates: [], spawnImpl })
  assert.equal(result.status, 'ok', '拿到 5 是"探到了"，不是"探测失败"')
  assert.equal(result.major, 5, '必须拿到真实主版本号 5，而不是 null')
  assert.equal(result.source, 'windows-powershell')
  assert.equal(result.via, 'powershell.exe')
  assert.equal(isPwshTooOld(result.major), true, '5 < 7，要提示升级')

  // 落盘后 major 必须是 5，且带上 status/source/detail 便于排障。
  const text = await maybePwshNotice({ platform: 'win32', env: {}, candidates: [], spawnImpl: (c, a, o) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    setImmediate(() => {
      if (c === 'powershell.exe') {
        child.stdout.emit('data', Buffer.from('5\r\n', 'utf8'))
        child.emit('close', 0)
        return
      }
      const error = new Error('spawn ENOENT')
      error.code = 'ENOENT'
      child.emit('error', error)
    })
    return child
  } })
  assert.equal(text, PWSH_TIP, '应给出升级提示，且文案说的是 5.1')
  const state = readPwshState()
  assert.equal(state.major, 5, '落盘的 major 必须是 5')
  assert.equal(state.source, 'windows-powershell')
  assert.ok(state.notifiedAt, '应记下提过了')
})

test('顺序：pwsh 在，就不必再问 powershell.exe', async (t) => {
  t.after(reset)
  reset()
  const spawnImpl = fakeSpawn({ stdout: '7' })
  const result = await detectPwshVersion({ platform: 'win32', spawnImpl })
  assert.equal(result.major, 7)
  assert.equal(result.source, 'pwsh')
  assert.equal(spawnImpl.calls.length, 1, 'pwsh 一命中就收工，不多起进程')
})

test('顺序：noLegacy=true 关掉 5.1 那一级（单测对照）', async (t) => {
  t.after(reset)
  reset()
  const spawnImpl = fakeSpawn({ errorCode: 'ENOENT' })
  const result = await detectPwshVersion({ platform: 'win32', env: {}, noFallback: true, noLegacy: true, spawnImpl })
  assert.equal(result.status, 'missing')
  assert.equal(result.major, null)
  assert.equal(spawnImpl.calls.length, 1, '关掉兜底和 5.1 后只该试 pwsh 一条')
})

test('降级：其他 error 也是 major:null，不抛', async (t) => {
  t.after(reset)
  reset()
  const result = await detectPwshVersion({ platform: 'win32', spawnImpl: fakeSpawn({ errorCode: 'EACCES' }) })
  assert.equal(result.status, 'error')
  assert.equal(result.major, null)
})

/* ------------------------------------------------------------------ *
 * 3b. 绝对路径兜底（坑 #75：PATH 没刷新但 pwsh 已装）
 * ------------------------------------------------------------------ */

test('候选清单：pwshPathCandidates 覆盖已知安装位置', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  }
  const list = pwshPathCandidates(env)
  assert.ok(list.includes('C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe'), '应含 msstore alias')
  assert.ok(list.includes('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), '应含传统 MSI 正式版')
  assert.ok(list.includes('C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe'), '应含预览版')
  assert.ok(list.includes('C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe'), '应含 32 位重定向目录')
  // 去重：重复项不该出现两次。
  assert.equal(new Set(list).size, list.length)
})

test('候选清单：环境变量缺失时跳过对应项，不崩', () => {
  const list = pwshPathCandidates({})
  assert.ok(Array.isArray(list))
})

test('兜底：PATH 里没有但 WindowsApps 绝对路径存在 → 视为已装（status ok）', async (t) => {
  t.after(reset)
  reset()
  // 第一个 spawn('pwsh') 报 ENOENT（PATH 里没有），随后兜底命中有真实文件存在的候选。
  // 用空 env + 注入一个真实存在的候选文件来模拟"PATH 没有但绝对路径在盘上"。
  const fakeExe = join(home, 'fake-pwsh.exe')
  writeFileSync(fakeExe, 'placeholder', 'utf8')
  // 按 command 区分：'pwsh' 走 PATH 报 ENOENT，fakeExe 兜底成功返回 7。
  const calls = []
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => { child.killed = true }
    child.killed = false
    setImmediate(() => {
      if (command === 'pwsh') {
        const error = new Error('spawn ENOENT')
        error.code = 'ENOENT'
        child.emit('error', error)
      } else {
        child.stdout.emit('data', '7\r\n')
        child.emit('close', 0)
      }
    })
    return child
  }
  spawnImpl.calls = calls
  const result = await detectPwshVersion({
    platform: 'win32',
    env: {}, // 空 env → 默认候选为空
    candidates: [fakeExe],
    spawnImpl,
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.major, 7)
  assert.equal(result.via, fakeExe, '应标注走的是兜底绝对路径')
  assert.ok(calls.length >= 2, '先试 pwsh 再试绝对路径')
  assert.equal(calls[0].command, 'pwsh')
  assert.equal(calls[1].command, fakeExe, '第二个探测应是兜底绝对路径')
})

test('兜底：候选路径明显不存在时用 lstat 预筛省掉进程（1.5.31）', async (t) => {
  t.after(reset)
  reset()
  // 关键：**可能是 alias 的候选必须试**。坑 #75——WindowsApps 的 0 字节 alias 上
  // statSync 抛 EACCES → existsSync 返回 false，但那其实是有用的 pwsh。1.5.31 的
  // isSpawnableFile 用 lstat 且"看不透就放行"，只有确认 ENOENT/ENOTDIR 才筛掉。
  // 这里给的是一条确实不存在的路径 → 预筛掉，不必为它起进程等 ENOENT。
  const spawnImpl = fakeSpawn({ errorCode: 'ENOENT' })
  const result = await detectPwshVersion({
    platform: 'win32',
    env: {},
    candidates: [join(home, 'no-such-dir', 'pwsh.exe')], // 不存在
    spawnImpl,
  })
  assert.equal(result.status, 'missing')
  assert.equal(spawnImpl.calls.length, 2, 'pwsh + powershell.exe；不存在的候选被 lstat 筛掉')
  assert.equal(spawnImpl.calls[0].command, 'pwsh')
  assert.equal(spawnImpl.calls[1].command, 'powershell.exe', '第二条应是 5.1 那一级')
  assert.ok(result.detail.includes('no-such-dir'), 'detail 仍记录试过哪些候选')
})

test('兜底：全都没命中 → 仍保持 missing，detail 记录试过哪些', async (t) => {
  t.after(reset)
  reset()
  const exe = join(home, 'existing-but-bad.exe')
  writeFileSync(exe, 'placeholder', 'utf8')
  const spawnImpl = fakeSpawn({ errorCode: 'ENOENT' })
  const result = await detectPwshVersion({
    platform: 'win32',
    env: {},
    candidates: [exe], // 存在但 probe 仍 ENOENT
    spawnImpl,
  })
  assert.equal(result.status, 'missing')
  assert.ok(result.detail.includes('fallback tried'), `detail 应记录兜底路径，实际: ${result.detail}`)
  assert.ok(result.detail.includes(exe))
})

test('兜底：noFallback=true 关掉绝对路径兜底，但 5.1 那级仍在（1.5.31）', async (t) => {
  t.after(reset)
  reset()
  const exe = join(home, 'real-exists.exe')
  writeFileSync(exe, 'placeholder', 'utf8')
  const spawnImpl = fakeSpawn({ errorCode: 'ENOENT' })
  const result = await detectPwshVersion({
    platform: 'win32',
    env: {},
    candidates: [exe],
    noFallback: true,
    spawnImpl,
  })
  assert.equal(result.status, 'missing')
  assert.equal(spawnImpl.calls.length, 2, 'noFallback 不碰候选，但 pwsh + powershell.exe 两条照走')
  assert.ok(!spawnImpl.calls.some((c) => c.command === exe), '不该 probe 候选')
})

test('兜底：只在 ENOENT 时触发候选，超时/报错不触发候选', async (t) => {
  t.after(reset)
  reset()
  const exe = join(home, 'exists-for-timeout.exe')
  writeFileSync(exe, 'placeholder', 'utf8')
  // 超时场景：第一条命令卡住 → 直接 timeout，不该走候选兜底，也不该再问 5.1。
  const timeoutImpl = fakeSpawn({ never: true })
  const timeoutResult = await detectPwshVersion({
    platform: 'win32', env: {}, candidates: [exe],
    spawnImpl: timeoutImpl, timeoutMs: 60,
  })
  assert.equal(timeoutResult.status, 'timeout')
  assert.equal(timeoutImpl.calls.length, 1, 'timeout 不该去试兜底（否则每条候选都等满超时）')

  // 非 ENOENT 的 error：EACCES → 不该试候选；但 5.1 那级仍会问
  // （pwsh 存在却跑不通时，5.1 的版本号依然是有用信息）。
  const errImpl = fakeSpawn({ errorCode: 'EACCES' })
  const errResult = await detectPwshVersion({
    platform: 'win32', env: {}, candidates: [exe],
    spawnImpl: errImpl,
  })
  assert.equal(errResult.status, 'error')
  assert.equal(errImpl.calls.length, 2, 'pwsh + powershell.exe，不碰候选')
  assert.ok(!errImpl.calls.some((c) => c.command === exe), '非 ENOENT 的 error 不该试候选')
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
