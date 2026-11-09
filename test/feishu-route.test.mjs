import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractText,
  mergeConfig,
  readConfigFile,
  readMappings,
  routeMessage,
  writeConfigFile,
  writeMappings,
} from '../lib/feishu-logic.js'

// extractText：从 content 数组抽纯文本。
assert.equal(
  extractText({ content: [{ type: 'text', text: '你好' }, { type: 'text', text: '世界' }] }),
  '你好世界',
)
assert.equal(extractText({ content: [{ type: 'image', image_key: 'x' }] }), '')
assert.equal(extractText(null), '')
assert.equal(extractText({ content: undefined }), '')

// routeMessage：已绑定 chat → 直接投递。
assert.deepEqual(routeMessage('随便聊聊', { 'oc_1': 'sess-1' }, 'oc_1'), {
  action: 'route',
  sessionId: 'sess-1',
})

// routeMessage：绑定命令（大小写/空格容忍）。
assert.deepEqual(routeMessage('绑定会话 sess-abc', {}, 'oc_2'), {
  action: 'bind',
  sessionId: 'sess-abc',
})
assert.deepEqual(routeMessage('接入  sess-xyz', {}, 'oc_2'), {
  action: 'bind',
  sessionId: 'sess-xyz',
})
assert.deepEqual(routeMessage('切换到会话 sess-9', {}, 'oc_2'), {
  action: 'bind',
  sessionId: 'sess-9',
})

// routeMessage：新建会话命令（带名称）。
assert.deepEqual(routeMessage('新建会话 陪聊', {}, 'oc_2'), {
  action: 'new',
  name: '陪聊',
})
assert.deepEqual(routeMessage('创建会话 干活', {}, 'oc_2'), {
  action: 'new',
  name: '干活',
})

// routeMessage：无映射且是普通正文 → 默认新建（name=null）。
assert.deepEqual(routeMessage('今天天气怎么样', {}, 'oc_3'), {
  action: 'new',
  name: null,
})
assert.deepEqual(routeMessage('   ', {}, 'oc_3'), { action: 'new', name: null })

// mergeConfig：patch 优先于文件，缺省补全。
assert.deepEqual(
  mergeConfig({ appId: 'A', appSecret: 'S' }, { appId: 'FILE_A', appSecret: 'FILE_S', domain: 'x' }),
  { appId: 'A', appSecret: 'S', domain: 'x', defaultPermissionPreset: 'workspace-write' },
)
assert.deepEqual(mergeConfig({}, {}), {
  domain: 'https://open.feishu.cn',
  defaultPermissionPreset: 'workspace-write',
})

// 配置文件 / 映射表读写往返。
const root = mkdtempSync(join(tmpdir(), 'feishu-test-'))
try {
  writeConfigFile(root, { appId: 'A', appSecret: 'S' })
  assert.deepEqual(readConfigFile(root), { appId: 'A', appSecret: 'S' })
  assert.ok(readFileSync(join(root, 'feishu', 'config.json'), 'utf8').includes('A'))

  writeMappings(root, { 'oc_1': 'sess-1' })
  assert.deepEqual(readMappings(root), { 'oc_1': 'sess-1' })
  writeMappings(root, { 'oc_1': 'sess-1', 'oc_2': 'sess-2' })
  assert.deepEqual(readMappings(root), { 'oc_1': 'sess-1', 'oc_2': 'sess-2' })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('feishu-route.test.mjs: ALL PASS')
