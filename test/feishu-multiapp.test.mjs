import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isOutOfChatError,
  migrateConfigFile,
  normalizeApps,
  readChatOwners,
  readConfigFile,
  writeChatOwners,
  writeConfigFile,
} from '../lib/feishu-logic.js'

// ── normalizeApps：旧单应用格式自动包一层 ──
assert.deepEqual(
  normalizeApps({ appId: 'cli_legacy', appSecret: 'sec1', domain: 'https://open.feishu.cn' }),
  [{ appId: 'cli_legacy', appSecret: 'sec1', domain: 'https://open.feishu.cn' }],
)
// 顶层无凭证 → 空数组。
assert.deepEqual(normalizeApps({ domain: 'x' }), [])
assert.deepEqual(normalizeApps({}), [])
assert.deepEqual(normalizeApps(null), [])

// ── normalizeApps：apps 数组优先于旧顶层字段 ──
assert.deepEqual(
  normalizeApps({ appId: 'old', appSecret: 'old-sec', apps: [{ appId: 'cli_a', appSecret: 'sa' }] }),
  [{ appId: 'cli_a', appSecret: 'sa', domain: null }],
)
// 多应用 + per-app domain 覆盖（normalizeApps 不掺全局域，per-app 缺省回落 null，
// 全局域由调用方 feishu.js 的 appDomain = app.domain || merged.domain 补）。
assert.deepEqual(
  normalizeApps({
    domain: 'https://open.feishu.cn',
    apps: [
      { appId: 'cli_a', appSecret: 'sa' },
      { appId: 'cli_b', appSecret: 'sb', domain: 'https://open.larksuite.com' },
    ],
  }),
  [
    { appId: 'cli_a', appSecret: 'sa', domain: null },
    { appId: 'cli_b', appSecret: 'sb', domain: 'https://open.larksuite.com' },
  ],
)
// appId 去重：首个赢；缺 appId / 非 app 对象 / 非 array 的 apps 被忽略。
assert.deepEqual(
  normalizeApps({ apps: [{ appId: ' dup ', appSecret: '1' }, { appId: 'dup', appSecret: '2' }] }),
  [{ appId: 'dup', appSecret: '1', domain: null }],
)
assert.deepEqual(normalizeApps({ apps: ['nope', { appSecret: 'x' }, null] }), [])

// ── migrateConfigFile：旧格式 → 备份 + 原地迁移（其余顶层键保留）──
const root = mkdtempSync(join(tmpdir(), 'feishu-multiapp-test-'))
try {
  writeConfigFile(root, { appId: 'cli_old', appSecret: 'sec-old', defaultPermissionPreset: 'workspace-write' })
  const mig1 = migrateConfigFile(root)
  assert.equal(mig1.migrated, true)
  assert.equal(mig1.appId, 'cli_old')
  assert.ok(mig1.backup, 'backup path should be reported')
  const migratedFile = readConfigFile(root)
  assert.deepEqual(migratedFile.apps, [{ appId: 'cli_old', appSecret: 'sec-old' }])
  assert.equal(migratedFile.defaultPermissionPreset, 'workspace-write')
  assert.equal(migratedFile.appId, undefined, 'legacy top-level appId should be dropped after migration')
  // 备份文件存在且内容是旧格式（mig1.backup 是完整路径）。
  const backupPath = mig1.backup
  assert.ok(existsSync(backupPath), `backup missing: ${backupPath}`)
  const backupRaw = readFileSync(backupPath, 'utf8').replace(/^\uFEFF/, '')
  assert.ok(JSON.parse(backupRaw).appId === 'cli_old')

  // 幂等：已是新格式 → already-multi。
  const mig2 = migrateConfigFile(root)
  assert.deepEqual(mig2, { migrated: false, reason: 'already-multi' })

  // 文件不存在 → missing。
  const mig3 = migrateConfigFile(join(root, 'not-a-root'))
  assert.deepEqual(mig3, { migrated: false, reason: 'missing' })

  // 坏 JSON → parse:*，且不迁移。
  writeFileSync(join(root, 'feishu', 'config.json'), '{oops', 'utf8')
  const mig4 = migrateConfigFile(root)
  assert.equal(mig4.migrated, false)
  assert.ok(mig4.reason.startsWith('parse'), `reason=${mig4.reason}`)

  // BOM 容忍：带 BOM 的旧格式照样迁移。
  writeFileSync(
    join(root, 'feishu', 'config.json'),
    '\uFEFF' + JSON.stringify({ appId: 'cli_bom', appSecret: 'sec-bom' }),
    'utf8',
  )
  const mig5 = migrateConfigFile(root)
  assert.equal(mig5.migrated, true)
  assert.equal(mig5.appId, 'cli_bom')
  assert.deepEqual(readConfigFile(root).apps, [{ appId: 'cli_bom', appSecret: 'sec-bom' }])
} finally {
  rmSync(root, { recursive: true, force: true })
}

// ── chat-owners.json：读写往返 + 损坏容错 ──
const root2 = mkdtempSync(join(tmpdir(), 'feishu-owners-test-'))
try {
  assert.deepEqual(readChatOwners(root2), {}, 'missing file → empty owners')
  writeChatOwners(root2, { 'oc_ed556d47': 'cli_aa7bd555a3ba5c09', 'oc_0348f9a2': 'cli_aa7864baf0bbdbf8' })
  assert.deepEqual(readChatOwners(root2), {
    'oc_ed556d47': 'cli_aa7bd555a3ba5c09',
    'oc_0348f9a2': 'cli_aa7864baf0bbdbf8',
  })
  // 覆盖写（writeChatOwners 原样写盘，不做条目过滤；过滤是读侧/调用方职责）。
  writeChatOwners(root2, { 'oc_x': 'cli_a', keep: 'junk', 'oc_y': 42 })
  const owners = readChatOwners(root2)
  assert.deepEqual(owners, { 'oc_x': 'cli_a', keep: 'junk', 'oc_y': 42 })
  // 损坏 → 返回空表，不抛。
  writeFileSync(join(root2, 'feishu', 'chat-owners.json'), 'not-json', 'utf8')
  assert.deepEqual(readChatOwners(root2), {})
} finally {
  rmSync(root2, { recursive: true, force: true })
}

// ── isOutOfChatError：230002 判定（cause.response.data.code 各层挖）──
assert.equal(
  isOutOfChatError({ cause: { response: { data: { code: 230002, msg: 'Bot/User can NOT be out of the chat' } } } }),
  true,
)
assert.equal(isOutOfChatError({ cause: { data: { code: 230002 } } }), true)
assert.equal(isOutOfChatError({ code: 230002 }), true)
assert.equal(isOutOfChatError(new Error('plain boom')), false)
assert.equal(isOutOfChatError({ cause: { response: { data: { code: 99991663 } } } }), false)
assert.equal(isOutOfChatError(null), false)
assert.equal(isOutOfChatError('230002-string'), false, 'bare string is not an error code object')

// ── 与旧测试共存检查：迁移后的 config 能被 normalizeApps 直接消化 ──
const root3 = mkdtempSync(join(tmpdir(), 'feishu-roundtrip-test-'))
try {
  writeConfigFile(root3, {
    apps: [
      { appId: 'cli_aa7bd555a3ba5c09', appSecret: 's1' },
      { appId: 'cli_aa7864baf0bbdbf8', appSecret: 's2' },
    ],
  })
  const cfg = readConfigFile(root3)
  const apps = normalizeApps(cfg)
  assert.equal(apps.length, 2)
  assert.equal(apps[0].appId, 'cli_aa7bd555a3ba5c09')
  assert.equal(apps[1].appId, 'cli_aa7864baf0bbdbf8')
  assert.equal(apps.every((a) => typeof a.domain === 'string' || a.domain === null), true)
  // 迁移过的新格式文件再跑迁移 → already-multi（幂等闭环）。
  assert.deepEqual(migrateConfigFile(root3), { migrated: false, reason: 'already-multi' })
  // feishu 目录不应残留多余迁移文件（除 config.json 与备份外）。
  const dirFiles = readdirSync(join(root3, 'feishu'))
  assert.deepEqual(dirFiles, ['config.json'])
} finally {
  rmSync(root3, { recursive: true, force: true })
}

console.log('feishu-multiapp.test.mjs: ALL PASS')
