import assert from 'node:assert/strict'
import { fileResourceUrl, imageResourceUrl, downloadImageResource } from '../lib/feishu-logic.js'

// ═══════════════════════════════════════════════════════════════════
// 回归：飞书「图片附件下载 400 code=234001」。
//
// 现场（2026-11-11 00:42，msg om_x100b6000d9fbdca4df6d89ca658d4cb）：
//   1.5.18 的 downloadImageResource 打的是 /open-apis/im/v1/images/{image_key}，
//   那是「本应用上传图片拿到的 image_key」用的接口；消息里的 img_v3_* 塞进去
//   一律 400 code=234001 Invalid request param.
//   同一 token 下改打 /im/v1/messages/{id}/resources/{key}?type=image → 200 image/jpeg。
// 详见 报告-图片下载400根因.md。
// ═══════════════════════════════════════════════════════════════════

const DOMAIN = 'https://open.feishu.cn'
const MSG = 'om_x100b6000d9fbdca4df6d89ca658d4cb'
const KEY = 'img_v3_0217b_ada57496-d161-419b-b923-5ecb2b8a964g'

// 图片 URL 必须走 messages/{id}/resources 且 type=image——不能再是 /im/v1/images/。
assert.equal(
  imageResourceUrl(DOMAIN, MSG, KEY),
  `${DOMAIN}/open-apis/im/v1/messages/${MSG}/resources/${KEY}?type=image`,
)
assert.ok(
  !imageResourceUrl(DOMAIN, MSG, KEY).includes('/im/v1/images/'),
  '图片下载不得再打 /im/v1/images/{key}（该接口对消息内 img_v3_* 必 400）',
)

// 文件 URL 保持 type=file 不变（这条路径线上实测是通的，不许回归）。
assert.equal(
  fileResourceUrl(DOMAIN, MSG, KEY),
  `${DOMAIN}/open-apis/im/v1/messages/${MSG}/resources/${KEY}?type=file`,
)

// img_v3_* 里的 - 和 _ 都是 URL 安全字符：encodeURIComponent 后必须原样，不产生转义。
assert.ok(imageResourceUrl(DOMAIN, MSG, KEY).includes(KEY), 'image_key 不应被转义变形')

// message_id 必须进 URL（消息资源接口的必需路径段），缺了就没法定位资源。
assert.ok(imageResourceUrl(DOMAIN, MSG, KEY).includes(`/messages/${MSG}/`))

// 缺 messageId / imageKey 要在发请求前就报错，而不是打出去一个必 400 的 URL。
assert.throws(() => downloadImageResource(DOMAIN, 't', { imageKey: KEY }), /message_id/)
assert.throws(() => downloadImageResource(DOMAIN, 't', { messageId: MSG }), /image_key/)
assert.throws(() => downloadImageResource(DOMAIN, 't', { messageId: MSG, imageKey: '' }), /image_key/)

// 旧签名 downloadImageResource(domain, token, imageKey) 必须失效——传字符串进来时
// 拿不到 messageId，应当抛错而不是静默退回旧的 /im/v1/images/ 老路。
assert.throws(() => downloadImageResource(DOMAIN, 't', KEY), /message_id/)

console.log('feishu-image-download.test.mjs: all assertions passed')
