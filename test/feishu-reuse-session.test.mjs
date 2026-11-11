/**
 * 1.5.33：「对接默认落到当前会话」——未绑定 chat 的三档复用决策。
 *
 * 需求（李浩 2026-11-11）：「对接机器人都默认当前对话的会话吧，别新建会话了，
 * 除非用户主动要求」；澄清后语义 = **绑定的对象是「发起对接的那个会话」**。
 *
 * 三档（上层确认过）：
 *   恰好 1 个活跃真人会话 → 直接绑，不新建
 *   多个活跃             → 不绑不建，回编号列表让他选（**不猜"最近那个"**）
 *   0 个                 → 才新建，并明说"给你新建了"
 *
 * 本测试覆盖父级点名的五种情况：
 *   (1) 1 个会话 → reuse；(2) 多个 → choose；(3) 0 个 → new；
 *   (4) 已绑定 chat 行为完全不变（**含 oc_f327 线上绑定的回归**）；
 *   (5) reuseActiveSession=false 回退旧行为。
 * 另加：候选排除规则、列表渲染格式、选号回复解析、开关语义、接线核对。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_SESSION_CANDIDATES,
  PENDING_CHOICE_TTL_MS,
  UNNAMED_SESSION_LABEL,
  buildChooseSessionPrompt,
  buildNewSessionNotice,
  buildReusedSessionNotice,
  clearPendingChoice,
  decideUnboundChatRouting,
  normalizeSessionCandidates,
  parseChoiceReply,
  readPendingChoice,
  renderSessionCandidateList,
  routeMessage,
  shortSessionId,
  writePendingChoice,
} from '../lib/feishu-logic.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

// ═══════════════════════════════════════════════════════════════
// (4) 已绑定 chat：行为完全不变 —— 这是硬底线，先测。
//     oc_f327… 是线上正在工作的绑定，绝不能因为本次改动被重绑/新建。
// ═══════════════════════════════════════════════════════════════
const LIVE_CHAT = 'oc_f3270000000000000000000000000001'
const LIVE_SESSION = 'sess-live-a1b2c3'
const liveMappings = { [LIVE_CHAT]: LIVE_SESSION }

// 4a：已绑定 chat 的普通消息 → route 到原会话，且**不受候选列表影响**。
assert.deepEqual(
  routeMessage('在吗', liveMappings, LIVE_CHAT),
  { action: 'route', sessionId: LIVE_SESSION },
  '4a：oc_f327 已绑定 chat 必须继续 route 到原会话',
)
// 4b：即便有别的活跃会话，已绑定 chat 也不改投。
assert.deepEqual(
  routeMessage('今天吃什么', liveMappings, LIVE_CHAT),
  { action: 'route', sessionId: LIVE_SESSION },
  '4b：存在其它活跃会话时，已绑定 chat 仍 route 原会话（不因复用逻辑改投）',
)
// 4c：已绑定 chat 发「接入」类字眼也当正文，不重绑（既有语义保持不变）。
assert.deepEqual(
  routeMessage('接入飞书', liveMappings, LIVE_CHAT),
  { action: 'route', sessionId: LIVE_SESSION },
  '4c：已绑定 chat 说「接入飞书」仍按正文投递，不触发重绑',
)
// 4d：已绑定 chat 永远不会走到 decideUnboundChatRouting（决策点只在 action=new 且 name=null）。
//     用「route 优先于一切」这条不变量来锁：无论候选多少，路由第一步就被 route 拦下。
for (const count of [0, 1, 3]) {
  const fakeCandidates = Array.from({ length: count }, (_, i) => ({
    sessionId: `sess-x${i}`,
    title: `会话${i}`,
    label: `会话${i}（工作区：G:\\阿依娅伊）`,
  }))
  const decision = routeMessage('随便聊一句', liveMappings, LIVE_CHAT)
  assert.equal(decision.action, 'route', `4d：候选 ${count} 个时已绑定 chat 仍 route`)
  assert.equal(decision.sessionId, LIVE_SESSION, `4d：候选 ${count} 个时目标会话不变`)
  assert.ok(fakeCandidates.length === count)
}

// ═══════════════════════════════════════════════════════════════
// 候选归一化：排除规则（每条都对应一个真实串味风险）
// ═══════════════════════════════════════════════════════════════
const rawSessions = [
  { sessionId: 'sess-real-1', title: '陪聊', cwd: 'G:\\阿依娅伊', workspaceTitle: '阿依娅伊' },
  { sessionId: 'sess-unnamed', title: null, cwd: 'G:\\别的目录', workspaceTitle: '别的目录' },
  { sessionId: 'sess-sub', title: '子代理', origin: 'subagent' },
  { sessionId: 'sess-child', title: '孙代', parentSession: 'sess-real-1' },
  { sessionId: 'sess-flag', title: '标了标记', isSubagent: true },
  { sessionId: 'weixin-39b66ede', title: '微信会话' },
  { sessionId: 'feishu-deadbeef', title: '飞书自建会话' },
  { sessionId: 'sess-other-chat', title: '别的 chat 在用' },
  { sessionId: 'sess-mine', title: '本 chat 自己绑的' },
]
const normalized = normalizeSessionCandidates({
  sessions: rawSessions,
  mappings: { 'oc_other': 'sess-other-chat', [LIVE_CHAT]: 'sess-mine' },
  chatId: LIVE_CHAT,
})

const ids = normalized.map((item) => item.sessionId)
assert.deepEqual(
  ids,
  ['sess-real-1', 'sess-unnamed', 'sess-mine'],
  'n1：只保留真人会话；子代理/微信/飞书自建/被别的 chat 占住的一律排除；本 chat 自己的绑定保留',
)
assert.ok(!ids.includes('sess-other-chat'), 'n1：已被别的 chat 绑定的会话必须排除（否则两个 chat 抢同一会话）')
assert.ok(normalized.find((x) => x.sessionId === 'sess-mine'), 'n1：本 chat 自己绑的会话不算"被别人占"')

// n2：未命名会话 → 占位 + ID 前 8 位（不留空）。
const unnamed = normalized.find((item) => item.sessionId === 'sess-unnamed')
assert.ok(unnamed.title.startsWith(UNNAMED_SESSION_LABEL), 'n2：未命名会话要给占位名')
assert.ok(unnamed.title.includes(shortSessionId('sess-unnamed')), 'n2：占位名要带 ID 前 8 位，方便辨认')

// n3：列表行格式 `会话名（工作区：xxx）`。
assert.equal(normalized[0].label, '陪聊（工作区：阿依娅伊）', 'n3：有工作区名时按需求格式渲染')
assert.equal(
  unnamed.label,
  `${UNNAMED_SESSION_LABEL}（${shortSessionId('sess-unnamed')}）（工作区：别的目录）`,
  'n3：无会话名时占位名 + 工作区一并给出',
)

// n4：同一 sessionId 重复出现只算一个。
const dedup = normalizeSessionCandidates({
  sessions: [{ sessionId: 'sess-dup', title: 'A' }, { sessionId: 'sess-dup', title: 'B' }],
})
assert.equal(dedup.length, 1, 'n4：重复 sessionId 去重')

// n5：无工作区信息时 label 退化（不能出现空的「（工作区：）」）。
const noWs = normalizeSessionCandidates({ sessions: [{ sessionId: 'sess-nows', title: '裸会话' }] })
assert.equal(noWs[0].label, '裸会话', 'n5：没有工作区就不拼括号')
assert.equal(noWs[0].workspace, null)
// 无 workspaceTitle 时回落到 cwd。
const cwdOnly = normalizeSessionCandidates({
  sessions: [{ sessionId: 'sess-cwd', title: '只有 cwd', cwd: 'D:\\work' }],
})
assert.equal(cwdOnly[0].label, '只有 cwd（工作区：D:\\work）', 'n5：workspaceTitle 缺失时回落 cwd')

// ═══════════════════════════════════════════════════════════════
// (1) 恰好 1 个活跃 → reuse（不新建）
// ═══════════════════════════════════════════════════════════════
const one = normalizeSessionCandidates({ sessions: [{ sessionId: 'sess-only', title: '唯一会话' }] })
const r1 = decideUnboundChatRouting({ reuseActiveSession: true, candidates: one })
assert.equal(r1.action, 'reuse', '(1)：恰好 1 个活跃会话 → reuse（不新建）')
assert.equal(r1.sessionId, 'sess-only')
assert.equal(r1.reason, 'single-active-session')
// 缺省（不传开关）也当 true。
assert.equal(decideUnboundChatRouting({ candidates: one }).action, 'reuse', '(1)：开关缺省 = 开启复用')

// ═══════════════════════════════════════════════════════════════
// (2) 多个活跃 → choose（不绑不建，给列表）
// ═══════════════════════════════════════════════════════════════
const many = normalizeSessionCandidates({
  sessions: [
    { sessionId: 'sess-a', title: '会话甲', workspaceTitle: '阿依娅伊' },
    { sessionId: 'sess-b', title: '会话乙', workspaceTitle: '别的项目' },
    { sessionId: 'sess-c', title: null, workspaceTitle: '阿依娅伊' },
  ],
})
const r2 = decideUnboundChatRouting({ reuseActiveSession: true, candidates: many })
assert.equal(r2.action, 'choose', '(2)：多个活跃会话 → choose（不绑不建）')
assert.equal(r2.reason, 'multiple-active-sessions')
assert.equal(r2.total, 3, '(2)：total 报真实总数')
assert.equal(r2.candidates.length, 3)
assert.ok(!('sessionId' in r2), '(2)：choose 决策不得给出 sessionId（绝不替用户猜）')

// (2b) 列表渲染：`1. 会话名（工作区：xxx）`，序号从 1 起。
const rendered = renderSessionCandidateList(r2.candidates, r2.total)
const renderedLines = rendered.split('\n')
assert.equal(renderedLines[0], '1. 会话甲（工作区：阿依娅伊）', '(2b)：第 1 行格式')
assert.equal(renderedLines[1], '2. 会话乙（工作区：别的项目）', '(2b)：第 2 行格式')
assert.ok(renderedLines[2].startsWith('3. '), '(2b)：第 3 行带序号')
assert.ok(renderedLines[2].includes('（工作区：阿依娅伊）'), '(2b)：未命名会话也要带工作区')

// (2c) 超过上限时截断，并说明还有几个（不能让手机屏幕刷不完）。
const lots = normalizeSessionCandidates({
  sessions: Array.from({ length: MAX_SESSION_CANDIDATES + 4 }, (_, i) => ({
    sessionId: `sess-l${i}`,
    title: `会话${i}`,
  })),
})
const r2c = decideUnboundChatRouting({ candidates: lots })
assert.equal(r2c.action, 'choose')
assert.equal(r2c.candidates.length, MAX_SESSION_CANDIDATES, `(2c)：列表最多 ${MAX_SESSION_CANDIDATES} 个`)
assert.equal(r2c.total, MAX_SESSION_CANDIDATES + 4)
const truncated = renderSessionCandidateList(r2c.candidates, r2c.total)
assert.ok(/另有 4 个未列出/.test(truncated), '(2c)：截断后要说明还有几个')

// (2d) 提示文案要引导用「绑定会话 <编号>」，并明说"我不替你猜"。
const prompt = buildChooseSessionPrompt(r2.candidates, r2.total)
assert.ok(prompt.includes('3 个活跃会话'), '(2d)：文案报数量')
assert.ok(prompt.includes('不替你猜'), '(2d)：要明说不猜')
assert.ok(prompt.includes('绑定会话'), '(2d)：要给用户可执行的指令')

// ═══════════════════════════════════════════════════════════════
// (3) 0 个活跃 → new（唯一兜底，且照实说"新建了"）
// ═══════════════════════════════════════════════════════════════
const r3 = decideUnboundChatRouting({ reuseActiveSession: true, candidates: [] })
assert.equal(r3.action, 'new', '(3)：0 个活跃会话 → 才新建')
assert.equal(r3.reason, 'no-active-session')
const newNotice = buildNewSessionNotice('sess-brand-new')
assert.ok(newNotice.includes('新建'), '(3)：文案必须说明是新建的')
assert.ok(newNotice.includes('sess-brand-new'), '(3)：要带上新会话 id')
assert.ok(!/接到你当前/.test(newNotice), '(3)：兜底路径不许谎称接在原会话上')
const newNoticeNamed = buildNewSessionNotice('sess-brand-new2', '新会话名')
assert.ok(newNoticeNamed.includes('新会话名'), '(3)：有名字时带上名字')

// reuse 文案要把会话名报给用户。
const reuseNotice = buildReusedSessionNotice(one[0])
assert.ok(reuseNotice.includes('唯一会话'), '(1)：reuse 文案带上会话名')
assert.ok(reuseNotice.includes('之后这个飞书对话的消息都会投到这里'), '(1)：让用户明确知道后续消息去哪')

// ═══════════════════════════════════════════════════════════════
// (5) reuseActiveSession=false → 回退旧行为（无条件新建）
// ═══════════════════════════════════════════════════════════════
assert.equal(
  decideUnboundChatRouting({ reuseActiveSession: false, candidates: one }).action,
  'new',
  '(5)：开关 false 时即使只有 1 个会话也新建（回退 1.5.32 行为）',
)
assert.equal(
  decideUnboundChatRouting({ reuseActiveSession: false, candidates: many }).reason,
  'reuse-disabled',
  '(5)：reason 标明是开关关闭',
)
assert.equal(
  decideUnboundChatRouting({ reuseActiveSession: false, candidates: [] }).action,
  'new',
  '(5)：开关 false + 0 候选用例也 new',
)
// 只有严格 false 才关闭；字符串 "false" / 0 / null 都不算（防 YAML 误配悄悄关掉默认规则）。
for (const val of ['false', '0', 0, null, undefined, 1, 'true']) {
  assert.notEqual(
    decideUnboundChatRouting({ reuseActiveSession: val, candidates: one }).action,
    'new',
    `(5)：reuseActiveSession=${JSON.stringify(val)} 不应关闭复用（只有布尔 false 才算）`,
  )
}

// ═══════════════════════════════════════════════════════════════
// 选号回复解析 + 待选状态落盘
// ═══════════════════════════════════════════════════════════════
const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-choice-'))
mkdirSync(join(sandbox, 'feishu'), { recursive: true })
try {
  // c1：写盘 → 读回 → 解析选号。
  const pending = { candidates: r2.candidates, createdAt: Date.now() }
  writePendingChoice(sandbox, LIVE_CHAT, pending)
  const back = readPendingChoice(sandbox, LIVE_CHAT)
  assert.equal(back.candidates.length, 3, 'c1：待选列表能落盘读回')
  assert.equal(back.chatId, LIVE_CHAT, 'c1：条目里记着 chatId')

  const sel = parseChoiceReply('2', back)
  assert.equal(sel.kind, 'select', 'c1：「2」识别为选第 2 个')
  assert.equal(sel.index, 2)
  assert.equal(sel.sessionId, 'sess-b', 'c1：选中的是第 2 个候选')
  assert.ok(sel.label.includes('会话乙'))

  // c2：多种写法都认。
  for (const text of ['2', '选2', '第2个', '绑定会话 2', '接入 2', '  2  ']) {
    assert.equal(parseChoiceReply(text, back)?.kind, 'select', `c2：「${text}」应识别为选号`)
    assert.equal(parseChoiceReply(text, back)?.sessionId, 'sess-b', `c2：「${text}」选中第 2 个`)
  }

  // c3：真 session id 不抢（交给 routeMessage 的 bind 分支）。
  assert.equal(parseChoiceReply('绑定会话 sess-abc', back), null, 'c3：真 id 不被当序号消费')
  assert.equal(parseChoiceReply('在吗', back), null, 'c3：普通聊天不被当选号')
  assert.equal(parseChoiceReply('', back), null, 'c3：空文本不消费')

  // c4：越界。
  const oor = parseChoiceReply('9', back)
  assert.equal(oor.kind, 'out-of-range', 'c4：序号越界要报 out-of-range')
  assert.equal(oor.count, 3)

  // c5：过期不消费（否则一周后一句「2」会把闲聊投到不相干的会话）。
  const expired = parseChoiceReply('2', { ...back, createdAt: Date.now() - PENDING_CHOICE_TTL_MS - 1 })
  assert.equal(expired.kind, 'expired', 'c5：超过 TTL 的待选要判过期')
  assert.equal(parseChoiceReply('2', { ...back, createdAt: Date.now() - PENDING_CHOICE_TTL_MS + 5000 })?.kind, 'select', 'c5：TTL 内仍有效')

  // c6：没有待选状态时一律 null（不误吃数字消息）。
  assert.equal(parseChoiceReply('2', null), null, 'c6：无待选时不解析')
  assert.equal(parseChoiceReply('2', { candidates: [] }), null, 'c6：空候选不解析')

  // c7：**按 chatId 分键——多 chat 不串台**（这是审查时实测出来的真缺陷：
  //     全局单文件时，chat B 的「2」会消费掉 chat A 的候选并把 B 接到 A 选的会话）。
  const OTHER_CHAT = 'oc_other_chat_zzz'
  const otherCandidates = [
    { sessionId: 'sess-o1', title: '乙一', label: '乙一（工作区：W1）' },
    { sessionId: 'sess-o2', title: '乙二', label: '乙二（工作区：W2）' },
  ]
  writePendingChoice(sandbox, OTHER_CHAT, { candidates: otherCandidates, createdAt: Date.now() })
  // 两个 chat 的待选并存，各读各的。
  assert.equal(readPendingChoice(sandbox, LIVE_CHAT).candidates.length, 3, 'c7：写第二个 chat 不覆盖第一个')
  assert.equal(readPendingChoice(sandbox, OTHER_CHAT).candidates.length, 2, 'c7：第二个 chat 有自己的列表')
  assert.equal(
    parseChoiceReply('2', readPendingChoice(sandbox, OTHER_CHAT)).sessionId,
    'sess-o2',
    'c7：chat B 的「2」选的是 B 自己的第 2 个（不串到 chat A）',
  )
  assert.equal(
    parseChoiceReply('2', readPendingChoice(sandbox, LIVE_CHAT)).sessionId,
    'sess-b',
    'c7：chat A 的「2」仍选 A 自己的第 2 个',
  )
  // 不存在的 chat 一律无待选。
  assert.equal(readPendingChoice(sandbox, 'oc_never_seen'), null, 'c7：没发过列表的 chat 无待选')
  // 清一个不影响另一个。
  clearPendingChoice(sandbox, LIVE_CHAT)
  assert.equal(readPendingChoice(sandbox, LIVE_CHAT), null, 'c7：清除 chat A 的待选')
  assert.equal(readPendingChoice(sandbox, OTHER_CHAT).candidates.length, 2, 'c7：清 chat A 不动 chat B')

  // c8：坏 JSON 不抛（静默当无待选）。
  writeFileSync(join(sandbox, 'feishu', 'pending-choice.json'), '{坏掉的', 'utf8')
  assert.equal(readPendingChoice(sandbox, OTHER_CHAT), null, 'c8：坏 JSON 当无待选处理，不抛')
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

// ═══════════════════════════════════════════════════════════════
// 接线核对：纯函数必须真的被 feishu.js 用上
// ═══════════════════════════════════════════════════════════════
const feishuSrc = readFileSync(join(ROOT, 'lib', 'feishu.js'), 'utf8')
assert.ok(feishuSrc.includes('collectActiveSessionCandidates('), 'd1：feishu.js 要真的采集活跃会话')
assert.ok(feishuSrc.includes('decideUnboundChatRouting('), 'd2：feishu.js 要真的走三档决策')
assert.ok(feishuSrc.includes('buildChooseSessionPrompt('), 'd3：多活跃时要回列表')
assert.ok(feishuSrc.includes('buildReusedSessionNotice('), 'd4：复用时要告知用户')
assert.ok(feishuSrc.includes('buildNewSessionNotice('), 'd5：新建时要照实说新建了')
assert.ok(feishuSrc.includes('parseChoiceReply('), 'd6：要消费用户的选号回复')
assert.ok(feishuSrc.includes("'sessions'"), 'd7：inject 里要声明 sessions 服务')
// 待选状态必须按 chatId 读写（多 chat 不串台——审查时实测出来的真缺陷）。
assert.ok(
  feishuSrc.includes('readPendingChoice(root, chatId)'),
  'd6b：读待选必须带 chatId（否则 chat B 会消费 chat A 的候选）',
)
assert.ok(feishuSrc.includes('clearPendingChoice(root, chatId)'), 'd6c：清待选必须带 chatId')
assert.ok(/writePendingChoice\(root,\s*chatId/.test(feishuSrc), 'd6d：写待选必须带 chatId')
// 选号消费必须排在 routeMessage 之前，否则「2」会被当普通正文。
const choiceAt = feishuSrc.indexOf('parseChoiceReply(rawText')
const routeAt = feishuSrc.indexOf('routeMessage(rawText, mappings, chatId)')
assert.ok(choiceAt > 0 && routeAt > choiceAt, 'd8：选号消费必须排在 routeMessage 之前')
// 显式「新建会话 X」要跳过复用（用户主动要求才新建）。
assert.ok(
  feishuSrc.indexOf('if (decision.name)') < feishuSrc.indexOf('collectActiveSessionCandidates('),
  'd9：显式「新建会话 X」必须在复用决策之前分流',
)
// 旧的「无条件新建」提示语不应再出现在 new 分支（已被 buildNewSessionNotice 取代）。
assert.ok(
  !/action === 'new'：新建 aiyayi 会话并自动接入/.test(feishuSrc),
  'd10：旧的「无条件新建」注释/行为应已移除',
)

console.log(`候选 ${normalized.length} 个 / 三档 ${r1.action},${r2.action},${r3.action}`)
console.log('feishu-reuse-session.test.mjs: ALL PASS')
