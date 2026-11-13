/**
 * 1.5.45：引导误触发三连修 + 注入身份自标注。
 *
 * 背景（2026-11-13 实锤，李浩深夜报告）：
 *   - 00:13:46 用户在飞书发「不用你看着点，我们先回测，需要交易的时候你写脚本
 *     工具，之后就只管填参数，让脚本自…」——开头恰好是"不用"，被旧版
 *     matchSkipIntent 的开头锚定正则误判成「放弃接入」→ 注入一条无关的
 *     「好的，不接入也没关系…」（00:14:43 进会话）。
 *   - 注入走 agent.followup + source:{kind:'user'}（宿主 Agent.followup 只收
 *     UserMessage，role 恒为 'user'），于是这条 bot 口吻文案在会话里"以用户
 *     身份"出现——00:20 李浩再报「会莫名其妙冒出一条以我的身份推出的消息」。
 *   - 引导文案本身含「接入飞书」「不用」等关键词，若被再送进检测（用户粘贴、
 *     上下文压缩剥掉零宽 GUIDE_PREFIX），引导会自我维持地再触发。
 *
 * 本测试锁六件事：
 *   (a) matchSkipIntent 整句化：实锤样本不再触发；真正的放弃短句照常触发。
 *   (b) decideSkipIntent 上下文门：没有接入流程上下文（无 pending-bind、未
 *       引导过）时，就算文本是纯「不用」也不判放弃。
 *   (c) 插件已发文案的粘贴件/压缩件不再进意图匹配（isInjectedGuideText 特征
 *       串比对，不依赖零宽字符存活）。
 *   (d) 用户真实意图照常触发；引号内引用（「接入飞书」）不再触发。
 *   (e) 注入身份标注接线：feishu.js 四处注入 + toolkit-async 任务结果注入都
 *       带〔系统提示·非用户发言〕，且纯函数正名。
 *   (f) KNOWN_GUIDE_MARKERS 与实际注入文案一一对应（防改文案漏更新 marker）。
 *
 * 为什么不做端到端：导入 lib/feishu.js 需要 @larksuiteoapi/node-sdk 与
 * @deepseek-ai/dsh-llm 桩包（feishu-weixin-guide.test.mjs 头注释同款理由），
 * 这里用纯函数 + 静态接线核对。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildNewSessionGuideText,
  buildWeixinOnboardText,
  decideSkipIntent,
  GUIDE_IDENTITY_TAG,
  isInjectedGuideText,
  KNOWN_GUIDE_MARKERS,
  matchOnboardIntent,
  matchSkipIntent,
  matchWeixinIntent,
  normalizeForGuideMatch,
} from '../lib/feishu-logic.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const feishuSrc = readFileSync(join(ROOT, 'lib', 'feishu.js'), 'utf8')
const toolkitSrc = readFileSync(join(ROOT, 'lib', 'toolkit-async.js'), 'utf8')

// ═══════════════════════════════════════════════════════════════
// (a) matchSkipIntent 整句化——00:13:46 实锤样本回归
// ═══════════════════════════════════════════════════════════════
assert.equal(
  matchSkipIntent('不用你看着点，我们先回测，需要交易的时候你写脚本工具，之后就只管填参数，让脚本自'),
  false,
  'a1：实锤样本「不用你看着点，我们先回测…」不再误判成放弃接入',
)
assert.equal(matchSkipIntent('不用了，你们先聊'), false, 'a2：「不用」后面带内容的句子不是放弃接入')
assert.equal(matchSkipIntent('不用管我先干活'), false, 'a2：同理，带内容的句子不触发')
for (const text of ['不用', '不用了', '不用啦', '不用吧', '不需要', '不需要了', '不接', '算了', '跳过', '暂时不用', '先不用', '先不用了。', '不用！', '算了。']) {
  assert.equal(matchSkipIntent(text), true, `a3：「${text}」这类整句放弃仍然触发`)
}
assert.equal(matchSkipIntent(''), false, 'a4：空串不触发')
assert.equal(matchSkipIntent(null), false, 'a4：null 不触发')

// ═══════════════════════════════════════════════════════════════
// (b) decideSkipIntent 上下文门——没引导过就谈不上"放弃接入"
// ═══════════════════════════════════════════════════════════════
assert.deepEqual(decideSkipIntent('不用', { hasOnboardContext: true }), { skip: true, reason: 'matched' }, 'b1：接入流程中的「不用」判放弃')
assert.deepEqual(decideSkipIntent('不用', { hasOnboardContext: false }), { skip: false, reason: 'no-onboard-context' }, 'b2：无接入上下文时「不用」只是普通话，不判放弃')
assert.deepEqual(decideSkipIntent('不用你看着点，我们先回测', { hasOnboardContext: true }), { skip: false, reason: 'no-match' }, 'b3：实锤样本在上下文门之前就被整句化拦下')

// ═══════════════════════════════════════════════════════════════
// (c) 插件已发文案的粘贴件 / 压缩件不再触发任何意图
// ═══════════════════════════════════════════════════════════════
const skipConfirmText =
  '好的，不接入也没关系。需要时随时说「接入飞书」或「接入微信」，我会再给你扫码步骤。'
for (const paste of [skipConfirmText, `\u2060${skipConfirmText}`]) {
  assert.equal(matchSkipIntent(paste), false, `c1：skip 确认文案粘贴件不触发 skip（零宽前缀=${paste.startsWith('\u2060')}）`)
  assert.equal(matchOnboardIntent(paste), false, `c1：skip 确认文案粘贴件不触发 onboard`)
  assert.equal(matchWeixinIntent(paste), false, `c1：skip 确认文案粘贴件不触发 weixin`)
}
const guideText = buildNewSessionGuideText()
assert.equal(matchOnboardIntent(guideText), false, 'c2：首次引导文案全文不触发 onboard（含「接入飞书聊天机器人」字样）')
assert.equal(matchSkipIntent(guideText), false, 'c2：首次引导文案全文不触发 skip')
assert.equal(matchWeixinIntent(guideText), false, 'c2：首次引导文案全文不触发 weixin')
// 压缩剥掉零宽前缀 + 只剩正文（含「接入」字样）也不触发。
assert.equal(matchOnboardIntent(normalizeForGuideMatch(`\u2060${guideText}`)), false, 'c2：剥零宽后的首次引导正文也不触发')
const weixinGuideText = buildWeixinOnboardText()
assert.equal(matchWeixinIntent(weixinGuideText), false, 'c3：微信指引全文不触发 weixin（含「接微信」不会——正文说"要接微信 ClawBot"但被 marker 拦）')
assert.equal(matchOnboardIntent(weixinGuideText), false, 'c3：微信指引全文不触发 onboard')
const onboardConfirmText =
  '已记录接入目标。请立即调用 feishu_bind 工具（不传 chatId 参数）：插件会自动挑选最近活跃的飞书 chat 直接绑定。'
assert.equal(matchOnboardIntent(onboardConfirmText), false, 'c4：onboard 确认文案粘贴件不触发 onboard')
assert.equal(matchSkipIntent(onboardConfirmText), false, 'c4：onboard 确认文案粘贴件不触发 skip')

// isInjectedGuideText：marker 逐一命中；普通用户话不误伤。
for (const marker of KNOWN_GUIDE_MARKERS) {
  assert.equal(isInjectedGuideText(marker), true, `c5：特征串「${marker}」本身被识别为注入文案`)
}
assert.equal(isInjectedGuideText('帮我接入飞书，谢谢'), false, 'c5：普通用户话不误伤')
assert.equal(isInjectedGuideText(''), false, 'c5：空串不算')
assert.equal(isInjectedGuideText('\u2060不接入也没关系'), true, 'c5：带零宽前缀的注入件照样识别（归一化剥零宽）')

// ═══════════════════════════════════════════════════════════════
// (d) 用户真实意图照常触发；引号内引用不再触发
// ═══════════════════════════════════════════════════════════════
for (const text of ['接入飞书', '接飞书', '帮我接入飞书', '绑定飞书', '接入机器人']) {
  assert.equal(matchOnboardIntent(text), true, `d1：「${text}」真实接入意图仍然触发`)
}
for (const text of ['接入微信', '接微信', '帮我接微信']) {
  assert.equal(matchWeixinIntent(text), true, `d2：「${text}」真实微信意图仍然触发`)
}
assert.equal(matchOnboardIntent('随时说「接入飞书」或「接入微信」'), false, 'd3：引号内引用不是用户意图（防粘贴触发）')
assert.equal(matchOnboardIntent('我要“接入飞书”这个东西'), false, 'd3：双引号引用同理')
// 注：「接飞书的事不急，先干活」这类顺带提及在 1.5.44 同样触发（闸 2 词表边界），
// 属既有行为非本次引入，这里不锁定；若未来要收，扩 passesOnboardGate 词表另行走查。
assert.equal(matchOnboardIntent('接入飞书改造得怎样了'), false, 'd4：1.5.18 闸 2 回归（讨论不触发）')
assert.equal(matchOnboardIntent('接入飞书\n顺便再帮我看看报警'), false, 'd4：多行属简报，不触发')

// ═══════════════════════════════════════════════════════════════
// (e) 身份标注接线：四处引导注入 + 任务结果注入都带标签
// ═══════════════════════════════════════════════════════════════
assert.equal(GUIDE_IDENTITY_TAG, '〔系统提示·非用户发言〕', 'e1：身份标签文本锁定（GUI 可见、读者一眼分辨非用户发言）')
const identityHits = (feishuSrc.match(/GUIDE_IDENTITY_TAG/g) || []).length
assert.ok(identityHits >= 5, `e2：feishu.js 里 GUIDE_IDENTITY_TAG 出现 ${identityHits} 次（import + skip/onboard/weixin/首次引导四处注入，实际应 ≥5）`)
assert.ok(feishuSrc.includes('decideSkipIntent(text, { hasOnboardContext })'), 'e3：skip 分支必须走 decideSkipIntent（上下文门真的接上了）')
assert.ok(feishuSrc.includes('isInjectedGuideText(text)'), 'e4：maybeOnboardIntent 必须先做注入文案排除')
assert.ok((feishuSrc.match(/loadGuided\(root\)/g) || []).length >= 2, 'e5：maybeOnboardIntent 入口也要 loadGuided（HMR 后 skip 上下文门不失效）')
assert.ok(toolkitSrc.includes('TASK_RESULT_IDENTITY_TAG'), 'e6：toolkit-async 任务结果注入带身份标注常量')
assert.ok(toolkitSrc.includes('`${TASK_RESULT_IDENTITY_TAG}${String(text ?? \'\')}`'), 'e6：buildTaskMessagePayload 的 text 前拼身份标注')
assert.ok(!guideText.startsWith('（提示）'), 'e7：首次引导正文不再自带「（提示）」（身份由调用侧标签统一标注）')
assert.ok(guideText.startsWith('本会话还没接入飞书聊天机器人'), 'e7：正文以原飞书内容开头（a1 逐句在位由 feishu-weixin-guide.test.mjs 继续锁）')

// ═══════════════════════════════════════════════════════════════
// (f) KNOWN_GUIDE_MARKERS 与实际注入文案一一对应（改文案漏更新 marker 会在这里炸）
// ═══════════════════════════════════════════════════════════════
assert.ok(guideText.includes('本会话还没接入飞书聊天机器人'), 'f1：marker①来自首次引导正文')
assert.ok(feishuSrc.includes('不接入也没关系'), 'f2：marker②来自 skip 确认文案')
assert.ok(feishuSrc.includes('已记录接入目标'), 'f3：marker③来自 onboard 确认文案')
assert.ok(feishuSrc.includes('请立即调用 feishu_bind 工具'), 'f4：marker④来自 onboard 确认主路径句')
assert.ok(weixinGuideText.includes('用户要接微信 ClawBot 机器人'), 'f5：marker⑤来自微信指引正文')
// 1.6.1 批B：+2（buildSwitchPendingBindPrompt / buildPendingRebindNotice，
// 见 test/feishu-pending-switch.test.mjs (D) 段）。
assert.equal(KNOWN_GUIDE_MARKERS.length, 7, 'f6：marker 数量锁定——新增注入文案要同步补 marker')

console.log('feishu-guide-no-retrigger.test.mjs: ALL PASS')
