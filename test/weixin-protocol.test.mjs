/**
 * 微信协议层单测（4.8 验收清单「协议层」那一节逐项对应）。
 *
 * 重点钉死：
 *   - parseWeixinJson 的 19 位 message_id 无损（实测值 7526219523554115848）
 *   - header 三字段公式
 *   - 出站报文形状（message_type=2 / state=2 / from_user_id='' / 单 item）
 *   - 入站 session_id 空串不当 key、from_user_id 作主键
 *   - allowlist / 空白名单准入判定
 *   - 错误码分类（-3 永久 / -14 凭证 / ret=0 不重试）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BOT_AGENT,
  ILINK_APP_CLIENT_VERSION,
  INVALID_ARGS_ERRCODE,
  STALE_TOKEN_ERRCODE,
  baseInfo,
  buildClientVersion,
  buildTextSendBody,
  classifySendError,
  classifyUpdatesResponse,
  clip,
  commonHeaders,
  decideInbound,
  extractInboundText,
  fingerprint,
  maskId,
  maskSecret,
  parseWeixinJson,
  postHeaders,
  randomWechatUin,
  splitText,
} from '../lib/weixin/protocol.js'

test('buildClientVersion：官方注释例子 1.0.11 → 65547 可自校验', () => {
  assert.equal(buildClientVersion('1.0.11'), 65547)
  // 2.4.10 → (2<<16)|(4<<8)|10 = 132106
  assert.equal(buildClientVersion('2.4.10'), 132106)
  assert.equal(buildClientVersion('2.0.0'), 131072)
  assert.equal(buildClientVersion(''), 0)
  assert.equal(buildClientVersion('x.y.z'), 0)
  // 端口/非法位宽要被掩码，不能溢成负数
  assert.ok(buildClientVersion('300.400.500') >= 0)
})

test('CHANNEL_VERSION 的编译值落在 uint32 内且等于公式结果', () => {
  assert.equal(ILINK_APP_CLIENT_VERSION, 132106)
  assert.ok(ILINK_APP_CLIENT_VERSION <= 0xffffffff)
})

test('header 三字段：iLink-App-Id=bot、ClientVersion 按公式、X-WECHAT-UIN 每请求随机', () => {
  const common = commonHeaders()
  assert.equal(common['iLink-App-Id'], 'bot')
  assert.equal(common['iLink-App-ClientVersion'], '132106')

  const post = postHeaders({ token: 'abc' })
  assert.equal(post['Content-Type'], 'application/json')
  assert.equal(post.AuthorizationType, 'ilink_bot_token')
  assert.equal(post.Authorization, 'Bearer abc')
  assert.ok(post['X-WECHAT-UIN'].length > 0)

  // 固定随机源时 base64(十进制 uint32) 可复现
  const fixed = { randomBytes: () => Buffer.from([0x00, 0x00, 0x00, 0x2a]) }
  assert.equal(randomWechatUin(fixed.randomBytes), Buffer.from('42').toString('base64'))

  // 每请求新随机：两次不同随机源应给出不同值
  const a = randomWechatUin(() => Buffer.from([1, 2, 3, 4]))
  const b = randomWechatUin(() => Buffer.from([5, 6, 7, 8]))
  assert.notEqual(a, b)
})

test('parseWeixinJson：19 位 message_id 无损（实测值 7526219523554115848）', () => {
  const raw = '{"ret":0,"msgs":[{"message_id":7526219523554115848,"from_user_id":"u1"}],"get_updates_buf":"abc"}'
  const parsed = parseWeixinJson(raw)
  assert.equal(parsed.msgs[0].message_id, '7526219523554115848')
  // 反证：裸 JSON.parse 确实会改值（说明这层保护是必需的）
  assert.notEqual(String(JSON.parse(raw).msgs[0].message_id), '7526219523554115848')
})

test('parseWeixinJson：msg_id / svr_id 同样无损，嵌套与数组都覆盖', () => {
  const raw =
    '{"a":{"msg_id":18446744073709551615},"list":[{"svr_id":9007199254740993}],"ok":1}'
  const parsed = parseWeixinJson(raw)
  assert.equal(parsed.a.msg_id, '18446744073709551615')
  assert.equal(parsed.list[0].svr_id, '9007199254740993')
  assert.equal(parsed.ok, 1)
})

test('parseWeixinJson：字符串内部文本不被误改，其他数字保持数字', () => {
  const raw = '{"text":"message_id:12345678901234567890","n":42,"b":true,"z":null,"s":"a:b"}'
  const parsed = parseWeixinJson(raw)
  assert.equal(parsed.text, 'message_id:12345678901234567890')
  assert.equal(parsed.n, 42)
  assert.equal(parsed.b, true)
  assert.equal(parsed.z, null)
})

test('parseWeixinJson：负数 / 空对象 / 转义引号不出错', () => {
  assert.deepEqual(parseWeixinJson('{"message_id":-1}'), { message_id: '-1' })
  assert.deepEqual(parseWeixinJson('{}'), {})
  assert.deepEqual(parseWeixinJson('{"a":"\\"message_id\\":1"}'), { a: '"message_id":1' })
})

test('buildTextSendBody：出站报文形状与协议核对结果一致', () => {
  const body = buildTextSendBody({
    to: 'user@im.wechat',
    text: '你好',
    contextToken: 'ctx-token',
    clientId: 'cid-1',
  })
  assert.equal(body.msg.from_user_id, '')
  assert.equal(body.msg.to_user_id, 'user@im.wechat')
  assert.equal(body.msg.client_id, 'cid-1')
  assert.equal(body.msg.message_type, 2) // BOT
  assert.equal(body.msg.message_state, 2) // FINISH
  assert.equal(body.msg.item_list.length, 1) // 每请求只放一个 item
  assert.equal(body.msg.item_list[0].type, 1) // TEXT
  assert.equal(body.msg.item_list[0].text_item.text, '你好')
  assert.equal(body.msg.context_token, 'ctx-token')
  assert.deepEqual(body.base_info, { channel_version: '2.4.10', bot_agent: BOT_AGENT })
})

test('buildTextSendBody：缺 context_token 时字段彻底不出现（field-absent 路径）', () => {
  const body = buildTextSendBody({ to: 'u', text: 't' })
  assert.equal('context_token' in body.msg, false)
  assert.ok(body.msg.client_id.startsWith('dsh-aiyayi-weixin:'))
})

test('baseInfo：bot_agent 可覆盖（仅观测用，不参与鉴权）', () => {
  assert.equal(baseInfo('x/1').bot_agent, 'x/1')
  assert.equal(baseInfo().channel_version, '2.4.10')
})

test('extractInboundText：文本优先 → 语音转写 → 媒体占位 → 空', () => {
  assert.equal(extractInboundText({ item_list: [{ type: 1, text_item: { text: 'hi' } }] }), 'hi')
  assert.equal(extractInboundText({ item_list: [{ type: 3, voice_item: { text: '语音转写' } }] }), '语音转写')
  assert.equal(extractInboundText({ item_list: [{ type: 2 }] }), '[图片]')
  assert.equal(extractInboundText({ item_list: [{ type: 5 }] }), '[视频]')
  assert.equal(extractInboundText({ item_list: [] }), '')
  assert.equal(extractInboundText({}), '')
  // 文本项排在媒体后面也要取到文本
  assert.equal(
    extractInboundText({ item_list: [{ type: 2 }, { type: 1, text_item: { text: 'later' } }] }),
    'later',
  )
})

test('decideInbound：空白名单只放行已显式绑定的用户（安全硬要求）', () => {
  const msg = { from_user_id: 'stranger', message_type: 1 }
  // 空 allowlist + 无绑定 → 拒绝
  assert.deepEqual(decideInbound({ msg, allowlist: [], bindings: {} }), {
    allow: false,
    reason: 'unbound',
    fromUserId: 'stranger',
  })
  // 空 allowlist + 已绑定 → 放行
  assert.equal(
    decideInbound({ msg, allowlist: [], bindings: { stranger: 'weixin-1' } }).allow,
    true,
  )
  const bound = decideInbound({ msg, allowlist: [], bindings: { stranger: 'weixin-1' } })
  assert.equal(bound.reason, 'bound')
})

test('decideInbound：非空 allowlist 只放行名单内（与绑定无关）', () => {
  const allowlist = ['boss@im.wechat']
  assert.equal(
    decideInbound({
      msg: { from_user_id: 'boss@im.wechat', message_type: 1 },
      allowlist,
      bindings: {},
    }).reason,
    'allowlist',
  )
  const denied = decideInbound({
    msg: { from_user_id: 'other', message_type: 1 },
    allowlist,
    bindings: { other: 'weixin-1' }, // 绑了但不在 allowlist：allowlist 是更严的门
  })
  assert.equal(denied.allow, false)
  assert.equal(denied.reason, 'not-in-allowlist')
})

test('decideInbound：无 from_user_id / bot 自回灌一律拒绝', () => {
  assert.equal(decideInbound({ msg: {}, allowlist: ['x'] }).reason, 'no-from-user-id')
  assert.equal(decideInbound({ msg: { from_user_id: '  ' }, allowlist: [] }).reason, 'no-from-user-id')
  assert.equal(
    decideInbound({ msg: { from_user_id: 'a', message_type: 2 }, allowlist: ['a'] }).reason,
    'bot-echo',
  )
})

test('splitText：不产出空片、长文本按换行切、短文本原样', () => {
  assert.deepEqual(splitText('短', 100), ['短'])
  assert.deepEqual(splitText('', 100), [])
  const long = 'a'.repeat(250)
  const parts = splitText(long, 100)
  assert.equal(parts.join(''), long)
  assert.ok(parts.every((p) => p.length <= 100))

  // 换行切点：片尾不带半个词
  const text = `${'x'.repeat(50)}\n${'y'.repeat(50)}`
  const cut = splitText(text, 60)
  assert.equal(cut.length, 2)
  assert.equal(cut[0], 'x'.repeat(50))
  assert.equal(cut[1], 'y'.repeat(50))
  // 每片都不应是纯空白
  assert.ok(cut.every((p) => p.trim().length > 0))
})

test('splitText：分隔换行在片首时被吞掉，最后一片不丢内容', () => {
  const text = `${'a'.repeat(10)}\n\n\n${'b'.repeat(10)}`
  const parts = splitText(text, 11)
  assert.ok(parts.every((p) => !p.startsWith('\n')))
  assert.ok(parts.join('').includes('b'.repeat(10)))
})

test('classifyUpdatesResponse：ret/errcode 两个字段都比，-14 单独识别', () => {
  assert.equal(classifyUpdatesResponse({ ret: 0 }).isError, false)
  assert.equal(classifyUpdatesResponse({}).isError, false)
  assert.equal(classifyUpdatesResponse({ ret: -14 }).staleToken, true)
  assert.equal(classifyUpdatesResponse({ errcode: -14 }).staleToken, true)
  assert.equal(classifyUpdatesResponse({ ret: -1 }).isError, true)
  assert.equal(classifyUpdatesResponse({ ret: -1 }).staleToken, false)
  assert.equal(classifyUpdatesResponse({ errcode: -4 }).isError, true)
  assert.equal(classifyUpdatesResponse({ ret: 0, errcode: 0 }).isError, false)
})

test('classifySendError：-3 永久失败、-14 凭证失效、其余 transient', () => {
  assert.equal(
    classifySendError({ response: { ret: INVALID_ARGS_ERRCODE } }),
    'invalid-args',
  )
  assert.equal(classifySendError({ response: { ret: STALE_TOKEN_ERRCODE } }), 'stale-token')
  assert.equal(classifySendError({ response: { ret: -1 } }), 'transient')
  assert.equal(classifySendError(new Error('network down')), 'transient')
})

test('脱敏：maskSecret / fingerprint / maskId / clip 都不漏明文', () => {
  const token = 'd4fbd2387360@im.bot:06000092867fa241b96a964736cb6ea3ddd023'
  const masked = maskSecret(token)
  assert.ok(masked.includes('len='))
  assert.ok(!masked.includes('06000092867fa241'))
  assert.equal(maskSecret(''), '(empty)')
  assert.equal(maskSecret(null), '(none)')

  const fp = fingerprint(token)
  assert.equal(fp.length, 8)
  assert.ok(!token.includes(fp))
  assert.equal(fingerprint(''), '(none)')
  // 同值同指纹（跨轮次可比对）
  assert.equal(fp, fingerprint(token))

  assert.ok(!maskId('o9cq803ifYjGZC81vq6fwHyt6INE@im.wechat').includes('ifYjGZC81'))
  assert.equal(maskId(''), '(none)')

  assert.equal(clip('abc', 10), 'abc')
  assert.ok(clip('a'.repeat(100), 10).includes('+90'))
})
