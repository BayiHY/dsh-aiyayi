import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ATTACHMENT_MSG_TYPES,
  attachmentDir,
  attachmentTimestampPrefix,
  collectIncomingAttachments,
  composeAttachmentName,
  composeDeliveryText,
  createTokenManager,
  downloadFileResource,
  downloadImageResource,
  extFromContentType,
  extractAttachmentMarkers,
  fetchMessageDetail,
  markdownMode,
  normalizeSdkResources,
  parseAttachmentsFromContent,
  sanitizeFileName,
  saveAttachmentBuffer,
  sendReplyWithAttachments,
  stripAttachmentMarkers,
} from '../lib/feishu-logic.js'

// ── normalizeSdkResources：SDK resources → 统一形状 ──
assert.deepEqual(
  normalizeSdkResources([
    { type: 'file', fileKey: 'fk1', fileName: '报表.xlsx' },
    { type: 'video', fileKey: 'fk2', fileName: 'v.mp4', coverImageKey: 'ik1' },
    { type: 'audio', fileKey: 'fk3', durationMs: 1200 },
    { type: 'image', fileKey: 'ik2' },
    { type: 'sticker', fileKey: 'sk1' }, // 装饰性资源忽略
    { type: 'file' }, // 无 fileKey 忽略
    null,
  ]),
  [
    { kind: 'file', fileKey: 'fk1', fileName: '报表.xlsx' },
    { kind: 'file', fileKey: 'fk2', fileName: 'v.mp4' },
    { kind: 'file', fileKey: 'fk3', fileName: undefined },
    { kind: 'image', fileKey: 'ik2', fileName: undefined },
  ],
)
assert.deepEqual(normalizeSdkResources(undefined), [])
assert.deepEqual(normalizeSdkResources('x'), [])

// ── parseAttachmentsFromContent：详情接口 content 各形状 ──
// post：detail API 归一化形状 {title, content:[[…]]}
assert.deepEqual(
  parseAttachmentsFromContent(
    'post',
    JSON.stringify({
      title: '报表',
      content: [
        [{ tag: 'text', text: '看下这个' }],
        [{ tag: 'file', file_key: 'fk1', file_name: 'a.xlsx' }],
      ],
    }),
  ),
  [{ kind: 'file', fileKey: 'fk1', fileName: 'a.xlsx' }],
)
// post：事件旧形状 {post:{<lang>:{content}}}；img 与 media（media 无名）
assert.deepEqual(
  parseAttachmentsFromContent(
    'post',
    JSON.stringify({
      post: {
        zh_cn: {
          title: '',
          content: [
            [
              { tag: 'img', image_key: 'ik1' },
              { tag: 'media', file_key: 'fk2', image_key: 'ik2' },
            ],
          ],
        },
      },
    }),
  ),
  [
    { kind: 'image', fileKey: 'ik1' },
    { kind: 'file', fileKey: 'fk2', fileName: undefined },
  ],
)
// 整体型消息
assert.deepEqual(
  parseAttachmentsFromContent('file', JSON.stringify({ file_key: 'fk3', file_name: 'b.pdf' })),
  [{ kind: 'file', fileKey: 'fk3', fileName: 'b.pdf' }],
)
assert.deepEqual(
  parseAttachmentsFromContent('media', JSON.stringify({ file_key: 'fk4', image_key: 'ik3', file_name: 'c.mp4' })),
  [{ kind: 'file', fileKey: 'fk4', fileName: 'c.mp4' }],
)
assert.deepEqual(parseAttachmentsFromContent('image', JSON.stringify({ image_key: 'ik4' })), [
  { kind: 'image', fileKey: 'ik4' },
])
assert.deepEqual(parseAttachmentsFromContent('audio', JSON.stringify({ file_key: 'fk5', duration: 3000 })), [
  { kind: 'file', fileKey: 'fk5', fileName: undefined },
])
// post：真实消息形状（om_x100b60062bb868a0c1374152dac71e8 实测）——附件在顶层 files 数组，
// 不在正文元素里；SDK convertPost 同样会漏，此处是收件兜底解析的主路径。
assert.deepEqual(
  parseAttachmentsFromContent(
    'post',
    JSON.stringify({
      title: '',
      content: [[{ tag: 'text', text: '你可以研究一下这里面的股票的买点卖点', style: [] }]],
      content_v2: [[{ tag: 'text', text: '你可以研究一下这里面的股票的买点卖点', style: [] }]],
      files: [
        {
          file_key: 'file_v3_0017_a_e8079604-44f1-4f24-989d-0ca85b990fbg',
          file_name: '最低单价股票.xlsx',
          is_folder: false,
        },
      ],
    }),
  ),
  [
    {
      kind: 'file',
      fileKey: 'file_v3_0017_a_e8079604-44f1-4f24-989d-0ca85b990fbg',
      fileName: '最低单价股票.xlsx',
    },
  ],
)
// post：正文元素与顶层 files 重复出现同一附件 → 去重
assert.deepEqual(
  parseAttachmentsFromContent(
    'post',
    JSON.stringify({
      content: [[{ tag: 'file', file_key: 'fk_dup', file_name: 'x.bin' }]],
      files: [{ file_key: 'fk_dup', file_name: 'x.bin', is_folder: false }],
    }),
  ),
  [{ kind: 'file', fileKey: 'fk_dup', fileName: 'x.bin' }],
)
// post：is_folder=true 的云文件夹引用跳过
assert.deepEqual(
  parseAttachmentsFromContent(
    'post',
    JSON.stringify({ files: [{ file_key: 'fld_1', file_name: '文件夹', is_folder: true }] }),
  ),
  [],
)
// 纯文本 post 无附件 / 坏 JSON / 未知类型
assert.deepEqual(parseAttachmentsFromContent('post', JSON.stringify({ content: [[{ tag: 'text', text: 'hi' }]] })), [])
assert.deepEqual(parseAttachmentsFromContent('post', 'not-json'), [])
assert.deepEqual(parseAttachmentsFromContent('text', JSON.stringify({ text: 'hi' })), [])

// ── sanitizeFileName：Windows 非法字符/长度/首尾点 ──
assert.equal(sanitizeFileName('报表<>:"/\\|?*.xlsx'), '报表' + '_'.repeat(9) + '.xlsx')
assert.equal(sanitizeFileName('  前后空白与点...  '), '前后空白与点')
assert.equal(sanitizeFileName('a\x00b\x1fc'), 'a_b_c')
assert.equal(sanitizeFileName('x'.repeat(200)), 'x'.repeat(120))
assert.equal(sanitizeFileName('***'), '___')
assert.equal(sanitizeFileName('...', 'fallback'), 'fallback')
assert.equal(sanitizeFileName(''), 'attachment')

// ── attachmentTimestampPrefix：本地时间 yyyymmdd-HHmmss ──
assert.equal(attachmentTimestampPrefix(new Date(2026, 10, 10, 14, 30, 0)), '20261110-143000')
assert.equal(attachmentTimestampPrefix(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405')

// ── 附件落盘：目录自建 + 同秒同名防覆盖 ──
{
  const root = mkdtempSync(join(tmpdir(), 'aiyayi-att-'))
  try {
    const p1 = saveAttachmentBuffer(root, 'oc_test', '表.xlsx', Buffer.from('A'))
    const p2 = saveAttachmentBuffer(root, 'oc_test', '表.xlsx', Buffer.from('BB'))
    assert.ok(p1.includes(join('feishu', 'attachments', 'oc_test')), `目录形状不对: ${p1}`)
    assert.ok(/_表\.xlsx$/.test(p1))
    assert.ok(/_表-2\.xlsx$/.test(p2))
    assert.deepEqual([...readFileSync(p1)], [0x41])
    assert.equal(readFileSync(p2, 'utf8'), 'BB')
    assert.equal(attachmentDir(root, 'oc_x'), join(root, 'feishu', 'attachments', 'oc_x'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ── extFromContentType / composeAttachmentName ──
assert.equal(extFromContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), '.xlsx')
assert.equal(extFromContentType('image/png; charset=binary'), '.png')
assert.equal(extFromContentType('image/svg+xml'), '.svg+xml')
assert.equal(extFromContentType('application/octet-stream', '.bin'), '.bin')
assert.equal(extFromContentType('', '.opus'), '.opus')
assert.equal(composeAttachmentName({ kind: 'file', fileKey: 'v3_abcdefgh', fileName: '报表' }, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), '报表.xlsx')
assert.equal(composeAttachmentName({ kind: 'file', fileKey: 'v3_abcdefgh', fileName: '已有.扩展名.xlsx' }, 'x'), '已有.扩展名.xlsx')
assert.equal(composeAttachmentName({ kind: 'file', fileKey: 'v3_abcdefgh' }, 'application/octet-stream'), 'attachment_abcdefgh.bin')
assert.equal(composeAttachmentName({ kind: 'image', fileKey: 'img_12345678' }, 'image/jpeg'), 'image_12345678.jpg')

// ── composeDeliveryText：保存/失败/空文本 ──
assert.equal(
  composeDeliveryText('看文件', { saved: ['F:\\a.xlsx'], failed: [] }, 'om_1'),
  '看文件\n（飞书附件已保存：F:\\a.xlsx）',
)
assert.equal(
  composeDeliveryText('看文件', { saved: ['F:\\a.xlsx'], failed: [{ name: 'b', reason: '超时' }] }, 'om_1'),
  '看文件\n（飞书附件已保存：F:\\a.xlsx）\n（飞书附件下载失败：超时，msg_id=om_1）',
)
// 空文本 + 有保存：只投括注，不投空块
assert.equal(composeDeliveryText('', { saved: ['F:\\a.xlsx'], failed: [] }, 'om_2'), '（飞书附件已保存：F:\\a.xlsx）')
// 全空：占位提示
assert.equal(composeDeliveryText('  ', null, 'om_3'), '（收到一条无文本内容的飞书消息，msg_id=om_3）')
assert.equal(composeDeliveryText('正文', null, 'om_4'), '正文')

// ── 标记解析与剥离（全/半角冒号、多标记、无效标记忽略）──
// 1.5.19：extractAttachmentMarkers 额外返回 items（带 index/tag），files/images 语义不变。
// 断言改为「只比 files/images 两个旧字段」，items 另测。
const legacyMarkers = (text) => {
  const { files, images } = extractAttachmentMarkers(text)
  return { files, images }
}
assert.deepEqual(
  legacyMarkers('开头 [附件: F:\\a b.xlsx] 中 [附件： D:\\图.png] 尾'),
  { files: ['F:\\a b.xlsx', 'D:\\图.png'], images: [] },
)
assert.deepEqual(
  legacyMarkers('图 [图片: F:\\pic.jpg] 和 [附件没闭合: F:\\x] 和 []'),
  { files: [], images: ['F:\\pic.jpg'] },
)
assert.deepEqual(legacyMarkers('没有标记'), { files: [], images: [] })
// items：按正文出现位置返回，tag 区分标记种类
assert.deepEqual(
  extractAttachmentMarkers('A [附件: F:\\a.xlsx] B [图片: F:\\p.jpg]').items,
  [
    { index: 2, path: 'F:\\a.xlsx', tag: 'file' },
    { index: 20, path: 'F:\\p.jpg', tag: 'image' },
  ],
)
assert.equal(
  stripAttachmentMarkers('看 [附件: F:\\a.xlsx]\n\n\n这个'),
  '看\n\n这个',
)
assert.equal(stripAttachmentMarkers('[图片:F:\\p.jpg] 纯图'), '纯图')
assert.equal(stripAttachmentMarkers(''), '')
// 无标记：逐字节原样返回（与 1.5.17 纯文本回发行为一致，不折叠空白）
{
  const raw = '保持  双空格\n\n\n和  尾部  '
  assert.equal(stripAttachmentMarkers(raw), raw)
}

// ── 正文出口断言助手（1.5.20：默认卡片，AIYAYI_FEISHU_MARKDOWN=text 回退纯文本）──
/**
 * 断言「正文」这条 payload 的通道形态。
 * - 卡片模式（默认）：payload 有 card，正文在 elements[0].text.content，且 tag=lark_md
 * - 纯文本模式：payload 只有 text
 * 这样断言不再写死 { text }，两种通道都能覆盖，且能抓住"默认竟然走了纯文本"这种回归。
 */
function assertBodyPayload(entry, expectedContent, label) {
  if (markdownMode() === 'card') {
    assert.ok(entry.payload.card, `${label}：默认应走卡片，实际 payload=${JSON.stringify(entry.payload)}`)
    assert.equal(entry.payload.text, undefined, `${label}：卡片模式不该同时带 text`)
    const el = entry.payload.card.elements[0]
    assert.equal(el.tag, 'div', `${label}：卡片首元素应为 div`)
    assert.equal(el.text.tag, 'lark_md', `${label}：正文应为 lark_md`)
    assert.equal(el.text.content, expectedContent, `${label}：卡片正文内容不符`)
  } else {
    assert.equal(entry.payload.text, expectedContent, `${label}：纯文本模式正文不符`)
    assert.equal(entry.payload.card, undefined, `${label}：纯文本模式不该带 card`)
  }
}

// ── sendReplyWithAttachments：mock sender 全链路编排 ──
{
  const dir = mkdtempSync(join(tmpdir(), 'aiyayi-send-'))
  try {
    const filePath = join(dir, 'ok.txt')
    writeFileSync(filePath, 'hello')
    const calls = []
    const channel = { sender: { send: async (chatId, payload) => calls.push({ chatId, payload }) } }
    const logs = { info: [], warn: [] }
    const logger = { info: (m) => logs.info.push(m), warn: (m) => logs.warn.push(m) }

    const r1 = await sendReplyWithAttachments(
      channel,
      'oc_1',
      `说明 [附件: ${filePath}] 和 [图片: ${join(dir, '不存在.png')}]`,
      logger,
    )
    // 顺序：先文件后正文；不存在的图剥离不阻断
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0], { chatId: 'oc_1', payload: { file: { source: filePath, fileName: 'ok.txt' } } })
    assertBodyPayload(calls[1], '说明 和', 'r1 正文')
    assert.deepEqual(
      { filesTotal: r1.filesTotal, filesSent: r1.filesSent, imagesTotal: r1.imagesTotal, imagesSent: r1.imagesSent, textSent: r1.textSent },
      { filesTotal: 1, filesSent: 1, imagesTotal: 1, imagesSent: 0, textSent: true },
    )
    assert.equal(r1.problems.length, 1)
    assert.ok(logs.warn.some((m) => m.includes('不存在.png')))

    // 纯文本路径：1.5.20 起默认走卡片，通道随 AIYAYI_FEISHU_MARKDOWN 开关变化
    calls.length = 0
    const r2 = await sendReplyWithAttachments(channel, 'oc_2', '普通回复', logger)
    assert.equal(calls.length, 1, 'r2：单条正文应只发一次（未分片）')
    assert.equal(calls[0].chatId, 'oc_2')
    assertBodyPayload(calls[0], '普通回复', 'r2 正文')
    // 1.5.19：返回值新增 imageFallbacks / order（字段只增不减），旧字段语义不变。
    assert.deepEqual(
      {
        filesTotal: r2.filesTotal,
        filesSent: r2.filesSent,
        imagesTotal: r2.imagesTotal,
        imagesSent: r2.imagesSent,
        textSent: r2.textSent,
        problems: r2.problems,
      },
      { filesTotal: 0, filesSent: 0, imagesTotal: 0, imagesSent: 0, textSent: true, problems: [] },
    )
    assert.equal(r2.imageFallbacks, 0)
    assert.deepEqual(r2.order, [])

    // 附件全失败 + 正文为空：补一条失败说明，不静默
    calls.length = 0
    const r3 = await sendReplyWithAttachments(channel, 'oc_3', '[附件: 不存在的文件.bin]', logger)
    assert.equal(r3.textSent, false)
    assert.equal(calls.length, 1)
    assert.ok(calls[0].payload.text.startsWith('（附件发送失败：'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── createTokenManager：获取/缓存/错误 ──
{
  const originalFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = async () => {
    fetchCount += 1
    return {
      json: async () => ({ code: 0, tenant_access_token: 't-xyz', expire: 7200 }),
    }
  }
  try {
    const getToken = createTokenManager({ domain: 'https://open.feishu.cn', appId: 'a', appSecret: 'b' })
    assert.equal(await getToken(), 't-xyz')
    assert.equal(await getToken(), 't-xyz')
    assert.equal(fetchCount, 1, 'token 应缓存，不应二次请求')
    // 错误码 → 抛错且带 msg
    globalThis.fetch = async () => ({ json: async () => ({ code: 10003, msg: 'invalid app_id' }) })
    const bad = createTokenManager({ domain: 'https://open.feishu.cn', appId: 'a', appSecret: 'b' })
    await assert.rejects(() => bad(), /10003/)
  } finally {
    globalThis.fetch = originalFetch
  }
}

// ── 网络函数：错误路径用 stub fetch 验证（真网络验证在 work 自测脚本）──
{
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      headers: { get: () => 'application/json' },
      json: async () => ({ code: 99991672, msg: 'no permission' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    await assert.rejects(
      () => downloadFileResource('https://open.feishu.cn', 'tk', { messageId: 'om_1', fileKey: 'fk' }),
      /403.*99991672|no permission/s,
    )
    // 1.5.19：图片走 messages/{id}/resources?type=image，签名带 messageId
    await assert.rejects(
      () => downloadImageResource('https://open.feishu.cn', 'tk', { messageId: 'om_1', imageKey: 'ik' }),
      /no permission/,
    )
    // 200 + JSON 错误体（飞书偶发形态）也要当失败
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => { throw new Error('not json body') },
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ code: 230001, msg: 'contain invalid characters' })).buffer,
    })
    await assert.rejects(
      () => downloadFileResource('https://open.feishu.cn', 'tk', { messageId: 'om_1', fileKey: 'fk' }),
      /230001/,
    )
    // fetchMessageDetail code!==0 → 抛错
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => ({ code: 99991663, msg: 'no msg permission' }),
    })
    await assert.rejects(() => fetchMessageDetail('https://open.feishu.cn', 'tk', 'om_1'), /99991663/)
    // 正常 items（om_empty 返回空 items → null）
    globalThis.fetch = async (url) => ({
      status: 200,
      json: async () =>
        String(url).includes('om_empty')
          ? { code: 0, data: { items: [] } }
          : { code: 0, data: { items: [{ msg_type: 'file', body: { content: '{}' } }] } },
    })
    const detail = await fetchMessageDetail('https://open.feishu.cn', 'tk', 'om_1')
    assert.equal(detail.msg_type, 'file')
    assert.equal(await fetchMessageDetail('https://open.feishu.cn', 'tk', 'om_empty'), null)
  } finally {
    globalThis.fetch = originalFetch
  }
}

// ── collectIncomingAttachments：编排分支（stub fetch + tmp root）──
{
  const originalFetch = globalThis.fetch
  const root = mkdtempSync(join(tmpdir(), 'aiyayi-coll-'))
  try {
    const logs = { info: [], warn: [] }
    const logger = { info: (m) => logs.info.push(m), warn: (m) => logs.warn.push(m) }
    const getToken = async () => 'tk'
    // 纯文本消息 → null
    assert.equal(
      await collectIncomingAttachments({
        logger, root, domain: 'https://open.feishu.cn', getTenantAccessToken: getToken,
        mergedEvent: { rawContentType: 'text', chatId: 'oc_1', messageId: 'om_1', resources: [] },
      }),
      null,
    )
    // post 无附件 → null（常态静默）
    assert.equal(
      await collectIncomingAttachments({
        logger, root, domain: 'https://open.feishu.cn', getTenantAccessToken: getToken,
        mergedEvent: { rawContentType: 'post', chatId: 'oc_1', messageId: 'om_1', resources: [] },
      }),
      null,
    )
    // file 消息：SDK resources 有 key 无名 → 详情补名 → 下载落盘
    const fileBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]) // PK..头
    globalThis.fetch = async (url) => {
      const u = String(url)
      // 注意顺序：下载 URL 也包含 /im/v1/messages/{id}，必须先匹配 /resources/
      if (u.includes('/resources/fk_a')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
          json: async () => { throw new Error('binary') },
          arrayBuffer: async () => fileBytes.buffer,
        }
      }
      if (u.includes('/im/v1/messages/om_file')) {
        return {
          status: 200,
          json: async () => ({
            code: 0,
            data: { items: [{ msg_type: 'file', body: { content: JSON.stringify({ file_key: 'fk_a', file_name: '真名.xlsx' }) } }] },
          }),
        }
      }
      throw new Error(`unexpected url ${u}`)
    }
    const r1 = await collectIncomingAttachments({
      logger, root, domain: 'https://open.feishu.cn', getTenantAccessToken: getToken,
      mergedEvent: { rawContentType: 'file', chatId: 'oc_1', messageId: 'om_file', resources: [{ type: 'file', fileKey: 'fk_a' }] },
    })
    assert.equal(r1.saved.length, 1)
    assert.ok(r1.saved[0].endsWith('_真名.xlsx'), `应使用详情补的文件名: ${r1.saved[0]}`)
    assert.deepEqual([...readFileSync(r1.saved[0])], [...fileBytes])
    assert.equal(r1.failed.length, 0)
    assert.ok(logs.info.some((m) => m.includes('附件已保存')))

    // image 消息：resources 空 → 详情解析出 image_key → 图片接口下载
    // 1.5.19：图片下载改走 messages/{id}/resources/{key}?type=image
    // （旧 /im/v1/images/{key} 对消息内 img_v3_* 必 400，见 报告-图片下载400根因.md）。
    // 注意顺序：资源下载 URL 也含 /im/v1/messages/om_img，必须先匹配 /resources/。
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('/resources/ik_zz')) {
        assert.ok(u.includes('type=image'), `图片下载必须带 type=image: ${u}`)
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'image/png' },
          json: async () => { throw new Error('binary') },
          arrayBuffer: async () => new Uint8Array([0x89, 0x50]).buffer,
        }
      }
      if (u.includes('/im/v1/messages/om_img')) {
        return {
          status: 200,
          json: async () => ({
            code: 0,
            data: { items: [{ msg_type: 'image', body: { content: JSON.stringify({ image_key: 'ik_zz' }) } }] },
          }),
        }
      }
      throw new Error(`unexpected url ${u}`)
    }
    const r2 = await collectIncomingAttachments({
      logger, root, domain: 'https://open.feishu.cn', getTenantAccessToken: getToken,
      mergedEvent: { rawContentType: 'image', chatId: 'oc_1', messageId: 'om_img', resources: [] },
    })
    assert.equal(r2.saved.length, 1)
    assert.ok(/_image_[^.]+\.png$/.test(r2.saved[0]), `图片名: ${r2.saved[0]}`)

    // 下载失败 → failed 不抛、不阻断
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => ({ code: 0, data: { items: [{ msg_type: 'file', body: { content: '{}' } }] } }),
    })
    const r3 = await collectIncomingAttachments({
      logger, root, domain: 'https://open.feishu.cn', getTenantAccessToken: getToken,
      mergedEvent: { rawContentType: 'file', chatId: 'oc_1', messageId: 'om_f', resources: [{ type: 'file', fileKey: 'fk_dead' }] },
    })
    assert.equal(r3.saved.length, 0)
    assert.equal(r3.failed.length, 1)
    assert.ok(logs.warn.some((m) => m.includes('附件下载失败')))
  } finally {
    globalThis.fetch = originalFetch
    rmSync(root, { recursive: true, force: true })
  }
}

// ── ATTACHMENT_MSG_TYPES ──
for (const t of ['post', 'file', 'media', 'image', 'audio', 'video']) {
  assert.ok(ATTACHMENT_MSG_TYPES.has(t), `缺少类型 ${t}`)
}
assert.ok(!ATTACHMENT_MSG_TYPES.has('text'))

console.log('feishu-attachment.test.mjs：全部断言通过')
