// 坑 #72：飞书回复正文的首尾空白行（无附件标记路径）。
//
// 缺陷链路（修复前）：
//   feishu.js:313  extractText(message)          ← 无 trim，模型分段输出的 \n 原样拼出首尾空行
//   feishu-logic.js:685  stripAttachmentMarkers 无标记早退分支原样返回  ← 不 trim
//   feishu-logic.js:1080 splitMarkdownForCard 未超限原样返回           ← 不 trim
//   feishu-logic.js:1031 markdownToLarkMd 入口 src = String(md ?? '')  ← 不 trim
//
// 修复：主修 feishu.js:313（extractText(...).trim()）+ 兜底 feishu-logic.js:748
//      （stripAttachmentMarkers(text).trim()），覆盖卡片/纯文本降级全部出口。
//
// 本测试跑的是**真实链路**的可导出函数（node 直接 import 仓库源文件），
// 不 mock 任何被测逻辑；只 mock SDK 的 channel.sender.send 以观察最终 payload。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractText,
  markdownMode,
  markdownToLarkMd,
  sendReplyWithAttachments,
  splitMarkdownForCard,
  stripAttachmentMarkers,
} from '../lib/feishu-logic.js'

// ── 链路助手：从「宿主 assistant/message 载荷」走到「飞书卡片正文」──

/**
 * 复刻 feishu.js:311-316 的主修后取值逻辑：
 *   const message = event.data?.message
 *   const text = extractText(message).trim()   ← 坑 #72 主修
 */
function replyTextFromMessage(message) {
  return extractText(message).trim()
}

/**
 * 复刻 feishu-logic.js:748 的兜底 + 748→849→1163→1171→1031 的正文出口：
 *   stripAttachmentMarkers(text).trim() → splitMarkdownForCard → markdownToLarkMd
 */
function bodyChunksOf(text) {
  const cleanText = stripAttachmentMarkers(text).trim()
  if (!cleanText) return []
  return splitMarkdownForCard(cleanText).map((chunk) => markdownToLarkMd(chunk))
}

/** 断言一段文本首尾都没有空白（无 \n / \r / 空格 / 制表符）。 */
function assertNoEdgeWhitespace(s, label) {
  assert.equal(s, s.trim(), `${label}：首尾不应有空白，实际=${JSON.stringify(s)}`)
  assert.ok(!/^\s/.test(s), `${label}：不应以空白开头，实际=${JSON.stringify(s)}`)
  assert.ok(!/\s$/.test(s), `${label}：不应以空白结尾，实际=${JSON.stringify(s)}`)
}

/** 取出一条 payload 里的「正文」内容（卡片走 lark_md，纯文本走 text）。 */
function bodyOf(entry, label) {
  if (markdownMode() === 'card') {
    assert.ok(entry.payload.card, `${label}：默认应走卡片，实际=${JSON.stringify(entry.payload)}`)
    const el = entry.payload.card.elements[0]
    assert.equal(el.tag, 'div', `${label}：卡片首元素应为 div`)
    assert.equal(el.text.tag, 'lark_md', `${label}：正文应为 lark_md`)
    return el.text.content
  }
  assert.equal(entry.payload.card, undefined, `${label}：纯文本模式不该带 card`)
  return entry.payload.text
}

// ═══════════════════════════════════════════════════════════════════
// (a) 无附件标记的纯文本回复 → 首尾无空白
// ═══════════════════════════════════════════════════════════════════
{
  // 复刻实测载荷：模型分段输出，首尾片段各带 \n
  const message = {
    content: [
      { type: 'text', text: '\n\n' },
      { type: 'text', text: '正文第一行\n\n' },
      { type: 'text', text: '正文最后一行\n\n\n' },
    ],
  }

  // 提取点：修复前 extractText 原样返回带首尾空行的串
  const raw = extractText(message)
  assert.equal(raw, '\n\n正文第一行\n\n正文最后一行\n\n\n', '提取点：应复现未 trim 的原文')

  // 主修后：首尾干净
  const text = replyTextFromMessage(message)
  assert.equal(text, '正文第一行\n\n正文最后一行', '主修后首尾空白应被去掉')
  assertNoEdgeWhitespace(text, 'a1 无标记回复（主修点）')

  // 兜底后：stripAttachmentMarkers 无标记早退分支 + trim → 首尾干净
  const clean = stripAttachmentMarkers(text).trim()
  assert.equal(clean, '正文第一行\n\n正文最后一行', '兜底后首尾空白应被去掉')
  assertNoEdgeWhitespace(clean, 'a2 无标记回复（兜底点）')

  // 出口：卡片正文首尾无空白
  const chunks = bodyChunksOf(raw)
  assert.equal(chunks.length, 1, 'a3 未超限应只切一片')
  assertNoEdgeWhitespace(chunks[0], 'a3 无标记回复（卡片正文）')
  assert.equal(chunks[0], '正文第一行\n\n正文最后一行', 'a3 卡片正文内容应仅去掉首尾空白')
}

// ═══════════════════════════════════════════════════════════════════
// (b) 带附件标记的回复 → 行为不变（原本就 trim 过，首尾仍干净）
// ═══════════════════════════════════════════════════════════════════
{
  const dir = mkdtempSync(join(tmpdir(), 'aiyayi-trim-'))
  try {
    const filePath = join(dir, 'ok.txt')
    writeFileSync(filePath, 'hello')

    const raw = `\n\n说明 [附件: ${filePath}]\n\n尾部\n\n\n`
    const calls = []
    const channel = { sender: { send: async (chatId, payload) => calls.push({ chatId, payload }) } }
    const logger = { info: () => {}, warn: () => {} }

    const r = await sendReplyWithAttachments(channel, 'oc_1', raw, logger)

    // 附件一条 + 正文一条
    assert.equal(r.filesSent, 1, 'b1：附件应正常发出')
    assert.equal(r.textSent, true, 'b2：正文应发出')
    assert.equal(calls.length, 2, 'b3：应发 1 条附件 + 1 条正文')

    const body = bodyOf(calls[1], 'b4 带标记正文')
    assertNoEdgeWhitespace(body, 'b4 带标记回复')
    assert.equal(body, '说明\n\n尾部', 'b5 带标记路径行为不变（与 1.5.20 一致）')

    // 与修复前对比：修复前带标记路径就已经是 trim 过的结果，现在逐字节一致
    assert.equal(body, stripAttachmentMarkers(raw).trim(), 'b6 带标记路径与 1.5.20 结果逐字节一致')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ═══════════════════════════════════════════════════════════════════
// (c) 中间空行不被误折叠（trim 只管首尾）
// ═══════════════════════════════════════════════════════════════════
{
  // 三连空行（\n\n\n）在**中间**必须原样保留——那是另一个需求（要李浩点头才做），
  // 本次只修首尾空白，不能顺手扩大范围。
  const raw = '\n\n上段\n\n\n\n中段\n\n下段\n\n\n'
  const clean = stripAttachmentMarkers(raw).trim()
  assert.equal(clean, '上段\n\n\n\n中段\n\n下段', 'c1 中间三连空行应原样保留')
  assert.ok(clean.includes('\n\n\n\n'), 'c2 中间的四连换行必须保留')

  const chunks = bodyChunksOf(raw)
  assert.equal(chunks.length, 1, 'c3 未超限应只切一片')
  assert.equal(chunks[0], '上段\n\n\n\n中段\n\n下段', 'c4 卡片正文中间空行原样保留')
  assertNoEdgeWhitespace(chunks[0], 'c5 卡片正文')

  // 双空行（\n\n）当然也要保留
  const two = stripAttachmentMarkers('\n\na\n\nb\n\n').trim()
  assert.equal(two, 'a\n\nb', 'c6 中间双空行保留')

  // 无标记路径的中间空行同样保留（只 trim 首尾）
  const noMarker = replyTextFromMessage({
    content: [
      { type: 'text', text: '\n\n' },
      { type: 'text', text: 'a\n\n\n\nb' },
      { type: 'text', text: '\n\n' },
    ],
  })
  assert.equal(noMarker, 'a\n\n\n\nb', 'c7 无标记路径中间空行保留，首尾被 trim')
}

// ═══════════════════════════════════════════════════════════════════
// (d) 空字符串 / 全空白输入不炸
// ═══════════════════════════════════════════════════════════════════
{
  // extractText 的边界
  assert.equal(extractText(null), '')
  assert.equal(extractText(undefined), '')
  assert.equal(extractText({}), '')
  assert.equal(extractText({ content: 'not-array' }), '')
  assert.equal(extractText({ content: [] }), '')
  assert.equal(extractText({ content: [{ type: 'text', text: '   ' }] }), '   ')

  // 主修点对空/全空白：trim 后为空 → feishu.js:314 的 `if (!text) return` 会直接跳过
  assert.equal(replyTextFromMessage({ content: [{ type: 'text', text: '   \n\n  ' }] }), '')
  assert.equal(replyTextFromMessage({ content: [] }), '')

  // 兜底点：stripAttachmentMarkers + trim 对空/全空白不炸
  assert.equal(stripAttachmentMarkers('').trim(), '')
  assert.equal(stripAttachmentMarkers('   \n\t  ').trim(), '')
  assert.equal(stripAttachmentMarkers(null).trim(), '')
  assert.equal(stripAttachmentMarkers(undefined).trim(), '')

  // 出口：空正文 → 不分片、不发卡片（feishu-logic.js:845 `if (cleanText)` 为假）
  assert.deepEqual(bodyChunksOf(''), [], 'd1 空文本应无正文分片')
  assert.deepEqual(bodyChunksOf('   \n\n  '), [], 'd2 全空白应无正文分片')

  // sendReplyWithAttachments 对全空白：不炸、不发正文
  const calls = []
  const channel = { sender: { send: async (chatId, payload) => calls.push({ chatId, payload }) } }
  const logger = { info: () => {}, warn: () => {} }
  const r = await sendReplyWithAttachments(channel, 'oc_empty', '   \n\n  ', logger)
  assert.equal(r.textSent, false, 'd3 全空白正文不应算已发送')
  assert.equal(calls.length, 0, 'd4 全空白正文不应发出任何 payload')
  assert.deepEqual(r.problems, [], 'd5 全空白不应产生 problems')
}

// ═══════════════════════════════════════════════════════════════════
// 附加：超长文本分片时，每一片首尾也不应带空白
// ═══════════════════════════════════════════════════════════════════
{
  // 超过 CARD_CONTENT_LIMIT(3500) 才分片
  const long = `\n\n${'行'.repeat(4000)}\n\n`
  const chunks = bodyChunksOf(long)
  assert.ok(chunks.length >= 2, `附加：超长文本应分多片，实际 ${chunks.length} 片`)
  for (const [i, c] of chunks.entries()) {
    assertNoEdgeWhitespace(c, `附加 分片${i}`)
  }
}
