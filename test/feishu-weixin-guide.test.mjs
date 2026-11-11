/**
 * 1.5.32：首次会话提示里同时告知「微信 ClawBot 机器人对接能力」。
 *
 * 需求（李浩 2026-11-11 原话）：「首次会话提醒飞书对接的同时，也提醒一下我们有
 * 微信 clawbot 机器人对接能力，如果用户需要我们可以指导用户对接微信机器人」。
 *
 * 本测试锁四件事：
 *   (a) 首次提示文案：飞书内容一字不丢 + 含微信能力一句（微信/ClawBot/iLink/
 *       "默认没开启"）+ 结尾「不用」跳过照旧 + **总长 ≤ 220 字**（太长用户懒得读）。
 *   (b) 注入判定 decideNewSessionGuide：未绑定 → 注入（含微信字样）；已绑定 chat /
 *       已引导过 / 子智能体 / weixin- 通道会话 → 一律不注入。
 *   (c) 意图匹配：明确说「接入微信」触发微信引导；「微信怎么接」属讨论性提问、
 *       **不**触发（由模型照 persona 口头答）；飞书那条行为不变。
 *   (d) 接线核对：feishu.js 真的用了上面这些纯函数（防"改了纯函数没人调"）。
 *
 * 为什么不断言 deliverToSession 端到端：导入 lib/feishu.js 需要 @larksuiteoapi/node-sdk
 * 与 @deepseek-ai/dsh-llm 两个桩包，而 feishu-accumulate.test.mjs 会在 repo 的
 * node_modules 里建/删同一批桩目录——node --test 多文件并发跑，两边会互相删到
 * 对方正在用的桩（坑 #76 的同一片雷区）。这里改用「纯函数 + 静态接线核对」，
 * 不碰 node_modules、不与并发测试抢文件。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildNewSessionGuideText,
  buildWeixinOnboardText,
  decideNewSessionGuide,
  matchOnboardIntent,
  matchWeixinIntent,
} from '../lib/feishu-logic.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** 文案长度上限（需求：原 147 字，加完 ≤ 220 字）。 */
const GUIDE_MAX_LEN = 220

// ═══════════════════════════════════════════════════════════════
// (a) 首次提示文案
// ═══════════════════════════════════════════════════════════════
const guide = buildNewSessionGuideText()

// a1：飞书那段原有内容必须逐句在位（改写/删句都是回归）。
for (const needle of [
  '本会话还没接入飞书聊天机器人',
  '先在手机安装飞书 app（各大应用商店可下载）',
  'open.feishu.cn 扫码找到机器人',
  '进入与机器人的单聊即自动接入本会话',
]) {
  assert.ok(guide.includes(needle), `a1：飞书原有内容丢了「${needle}」`)
}

// a2：微信 ClawBot 能力说明在位（四个关键片段）。
for (const needle of ['微信', 'ClawBot', 'iLink', '腾讯官方']) {
  assert.ok(guide.includes(needle), `a2：微信能力说明缺「${needle}」`)
}

// a3：必须讲清"默认没开启"，别让用户以为已经接好了。
assert.ok(/默认(?:没|未)开启/.test(guide), 'a3：必须写明微信通道默认没开启，不能让用户误以为已接好')

// a4：尾部「不用」跳过那句照旧保留。
assert.ok(guide.endsWith('如果不需要，回复「不用」即可跳过，我不会再提示。'), 'a4：结尾「不用」跳过句必须保留在最后')
assert.ok(!guide.includes('\u2060'), 'a4：正文不应含零宽 GUIDE_PREFIX（前缀由调用方拼）')

// a5：长度上限（需求 220 字以内）。
assert.ok(
  guide.length <= GUIDE_MAX_LEN,
  `a5：首次提示 ${guide.length} 字，超过上限 ${GUIDE_MAX_LEN} 字（太长用户懒得读）`,
)
// 也不该短到把微信那句吃掉（原飞书版 150 字）。
assert.ok(guide.length > 150, `a5：文案 ${guide.length} 字，看起来微信那句没加上`)

// a6：微信那句要能指向"我帮你开"，而不是给用户一份自助说明书。
assert.ok(/带你|指导|帮你/.test(guide), 'a6：微信那句要说明"需要的话我带你接"，别写成自助文档')

// a7：微信接入指引（用户说「接入微信」时注入）也要有关键事实，防模型现编。
const weixinGuide = buildWeixinOnboardText()
for (const needle of ['enabled', 'weixin_login', '121 秒', 'weixin-setup']) {
  assert.ok(weixinGuide.includes(needle), `a7：微信接入指引缺「${needle}」`)
}
assert.ok(/没有 weixin-setup 技能/.test(weixinGuide), 'a7：必须写明没有 weixin-setup 技能')

// ═══════════════════════════════════════════════════════════════
// (b) 注入判定
// ═══════════════════════════════════════════════════════════════
assert.deepEqual(decideNewSessionGuide({ sessionId: 'sess-1' }), { guide: true, reason: 'unbound' })
assert.equal(decideNewSessionGuide({ sessionId: 'sess-1', chatId: 'oc_x' }).guide, false, 'b1：已绑定 chat 不注入')
assert.equal(decideNewSessionGuide({ sessionId: 'sess-1', chatId: 'oc_x' }).reason, 'bound')
assert.equal(decideNewSessionGuide({ sessionId: 'sess-1', alreadyGuided: true }).guide, false, 'b2：引导过不再注入')
assert.equal(decideNewSessionGuide({ sessionId: 'sess-1', isSubagent: true }).guide, false, 'b3：子智能体不注入')
assert.equal(
  decideNewSessionGuide({ sessionId: 'weixin-39b66ede-abc' }).guide,
  false,
  'b4：微信通道会话不注入「接入飞书」引导（1.5.28 串味回归）',
)
assert.equal(decideNewSessionGuide({ sessionId: 'weixin-39b66ede-abc' }).reason, 'weixin-channel')
// 前缀只认开头：会话名中间带 weixin- 不算微信通道。
assert.equal(decideNewSessionGuide({ sessionId: 'dev-weixin-x' }).guide, true, 'b5：只有 ^weixin- 前缀才算通道会话')

// ═══════════════════════════════════════════════════════════════
// (c) 意图匹配
// ═══════════════════════════════════════════════════════════════
// c1：微信明确请求 → 触发。
for (const text of ['接入微信', '帮我接入微信', '微信接入一下', '绑定微信', '接微信', '接上微信', '开通微信', '添加微信']) {
  assert.equal(matchWeixinIntent(text), true, `c1：「${text}」应判为微信接入请求`)
}
// c2：讨论性提问 → 不触发（含闸 2 的「怎么」）。这是需求方的判断：由模型口头答。
for (const text of ['微信怎么接', '微信怎么接啊？', '微信接入怎么改的', '微信插件的实现']){
  assert.equal(matchWeixinIntent(text), false, `c2：「${text}」是讨论性提问，不该触发引导流程`)
}
// c3：长文本 / 多行 / 空 → 不触发（子智能体任务简报伪意图防护）。
assert.equal(matchWeixinIntent(''), false)
assert.equal(matchWeixinIntent('   '), false)
assert.equal(matchWeixinIntent('接入微信\n再帮我看看飞书那边'), false, 'c3：多行属简报，不触发')
assert.equal(
  matchWeixinIntent('把首次提示里加上微信 ClawBot 机器人对接能力，并在用户需要时指导他一步步接入这套东西'),
  false,
  'c3：长句属任务简报，不触发',
)
// c4：飞书意图不被微信词污染，行为不变。
assert.equal(matchOnboardIntent('接入飞书'), true, 'c4：飞书接入仍然触发')
assert.equal(matchOnboardIntent('接入微信'), false, 'c4：微信请求不写飞书的 pending-bind')
assert.equal(matchOnboardIntent('微信怎么接'), false, 'c4：讨论不触发')
assert.equal(matchOnboardIntent('接入微信机器人'), false, 'c4：「接入微信机器人」不该被通用词「接入机器人」误判成飞书')
assert.equal(matchOnboardIntent('飞书接入改造得怎样了'), false, 'c4：1.5.18 的闸 2 回归（讨论不触发）')
assert.equal(matchOnboardIntent('接入机器人'), true, 'c4：历史语义「接入机器人」= 飞书，保留')

// ═══════════════════════════════════════════════════════════════
// (d) 接线核对：纯函数必须真的被用上
// ═══════════════════════════════════════════════════════════════
const feishuSrc = readFileSync(join(ROOT, 'lib', 'feishu.js'), 'utf8')
assert.ok(feishuSrc.includes('buildNewSessionGuideText()'), 'd1：首次引导必须走 buildNewSessionGuideText()')
assert.ok(feishuSrc.includes('decideNewSessionGuide('), 'd2：注入判定必须走 decideNewSessionGuide()')
assert.ok(feishuSrc.includes('matchWeixinIntent('), 'd3：微信意图分支必须接上 matchWeixinIntent()')
assert.ok(feishuSrc.includes('buildWeixinOnboardText()'), 'd4：微信接入指引必须接上 buildWeixinOnboardText()')
// 微信分支必须在飞书分支之前（否则「接入微信」会先撞上飞书判定链）。
const weixinAt = feishuSrc.indexOf('if (matchWeixinIntent(text))')
const feishuAt = feishuSrc.indexOf('if (matchOnboardIntent(text))')
assert.ok(weixinAt > 0 && feishuAt > weixinAt, 'd5：微信意图分支必须排在飞书分支之前')

console.log(`首次提示文本 ${guide.length} 字（上限 ${GUIDE_MAX_LEN}）`)
console.log(`微信接入指引 ${weixinGuide.length} 字`)
console.log('feishu-weixin-guide.test.mjs: ALL PASS')
