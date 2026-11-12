import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  INBOUND_ROUTING_LIMIT,
  appendInboundRouting,
  readInboundRouting,
} from '../lib/feishu-logic.js'

// 1.5.35：feishu_status 的「最近入站路由回看」持久化 —— append/read/环形上限。
const root = mkdtempSync(join(tmpdir(), 'dsh-feishu-routing-'))
try {
  // 空目录：read 返回 []。
  assert.deepEqual(readInboundRouting(root), [])

  // 追加：新→旧。
  appendInboundRouting(root, { at: 1, chatId: 'oc_a', appId: 'app-1', action: 'new', sessionId: 'sess-new' })
  appendInboundRouting(root, { at: 2, chatId: 'oc_b', appId: 'app-1', action: 'route', sessionId: 'sess-route' })
  let list = readInboundRouting(root)
  assert.equal(list.length, 2)
  assert.equal(list[0].chatId, 'oc_b') // 最新在前
  assert.equal(list[0].action, 'route')
  assert.equal(list[0].sessionId, 'sess-route')
  assert.equal(list[1].chatId, 'oc_a')
  assert.equal(list[1].action, 'new')

  // 环形上限：超 20 条丢最旧。
  for (let i = 0; i < INBOUND_ROUTING_LIMIT + 5; i++) {
    appendInboundRouting(root, { at: 100 + i, chatId: `oc_${i}`, appId: 'app-1', action: 'reuse', sessionId: 'sess-reuse' })
  }
  list = readInboundRouting(root)
  assert.equal(list.length, INBOUND_ROUTING_LIMIT)
  // 最新的是最后一次追加的 oc_24（100+24=124），最旧的 oc_a（最原始那条）已被丢。
  assert.equal(list[0].chatId, 'oc_24')
  assert.ok(!list.some((r) => r.chatId === 'oc_a'))
  // 新→旧有序。
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1].at >= list[i].at)
  }

  // 空 chatId 忽略（防脏数据），且不破坏已有记录。
  appendInboundRouting(root, { at: 999, chatId: '', action: 'route', sessionId: 'x' })
  assert.equal(readInboundRouting(root).length, INBOUND_ROUTING_LIMIT)

  // 损坏文件：read 返回 []，不抛。
  const dir = join(root, 'feishu')
  writeFileSync(join(dir, 'inbound-routing.json'), '{not-json', 'utf8')
  assert.deepEqual(readInboundRouting(root), [])
} finally {
  rmSync(root, { recursive: true, force: true })
}
