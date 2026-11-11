/**
 * persona 关键纪律体检：确认三个预设的人设里，那几条"踩过坑才加"的规矩还在。
 *
 * 为什么需要这道闸：persona 是纯文本，改的人容易顺手删掉或改写某一句，
 * 而删了不会报错、不会让测试变红——功能照常跑，只是模型的行为悄悄退化了。
 * 2026-11-07 实测踩到的具体坑：
 *   1. 她凭记忆敲子智能体 session id，打错一个字符（...2c8db vs ...2c5ca7），
 *      send_message 返回 "is unavailable"，她差点当"子智能体死了"去重派，
 *      白扔已完成的活。→ 必须有"ID 现查、不许凭记忆"的纪律。
 *   2. 她不知道子智能体是可续接的（continuable）、也不知道 DSH 重启后还能
 *      冷启动捞回来，容易在重启后重派而不是续接。→ 必须写清楚。
 *   3. send_message 只对"直接子会话"有权限：本体派的小伙伴和检索员都算直接，
 *      但小伙伴再派的检索员是孙代，本体发不了。→ 必须写清楚走小伙伴中转。
 *   4. 闹钟那几条（长期授权优先于宿主英文护栏、闹钟不是清单）。
 *   5. 时间行 [时间] 的用法（直接用它答"现在几点"，别再推算/别再派活）。
 *
 * 这道闸只断言"关键短语在不在"，不改写、不管措辞。检测到缺失就 FAIL 并
 * 指出是哪个预设缺哪条，方便立刻回去补。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PATCH = join(ROOT, 'cordis.patch.yml')

/**
 * 极简 YAML 提取：不引 yaml 依赖（插件零依赖原则）。
 * 只做这件事——按 `- id: preset-aiyayi`（缩进 4）切块，取每个块里 persona 的
 * `prefix: |`（缩进 14）之后的正文，直到下一个缩进 ≤10 的插件行（如
 * `- id: agent-instructions`，缩进 10）。
 * 够用就行：我们的 patch 结构固定，prefix 是唯一的多行字面量。
 */
function extractPersonas(text) {
  const personas = {}
  const lines = text.split(/\r?\n/)
  let current = null
  let capturing = false
  let buffer = []
  const INDENT_PRESET = 4
  const INDENT_PREFIX = 14

  const indentOf = (line) => (/^\s*/.exec(line)[0]).length
  const flush = () => {
    if (current !== null && buffer.length > 0) personas[current] = buffer.join('\n')
    buffer = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const indent = indentOf(line)

    // 新的预设块开始
    if (indent === INDENT_PRESET && /^- id: preset-aiyayi[a-z-]*/.test(trimmed)) {
      flush()
      capturing = false
      current = trimmed.slice(2, trimmed.length).trim().replace(/^id:\s*/, '')
      continue
    }

    // persona 的 prefix 开始
    if (current !== null && !capturing && indent === INDENT_PREFIX && trimmed.startsWith('prefix:')) {
      capturing = true
      continue
    }

    // 捕捉中：缩进 ≤10 且是插件行 → persona 结束
    if (capturing) {
      if (indent <= 10 && /^- id:/.test(trimmed)) {
        capturing = false
        continue
      }
      buffer.push(line)
    }
  }
  flush()
  return personas
}

const raw = readFileSync(PATCH, 'utf8')
const personas = extractPersonas(raw)

if (Object.keys(personas).length !== 3) {
  console.error(`FAIL 没解析出三个预设的人设，实际 ${Object.keys(personas).length} 个：${Object.keys(personas).join(', ')}`)
  process.exit(1)
}

/** 每个预设该有的关键短语。preset 名 → [[说明, 短语], ...] */
const REQUIRED = {
  'preset-aiyayi': [
    ['续接前 ID 必须现查', 'ID 必须现查'],
    ['打错 ID 时 is unavailable 含义', '查无此号'],
    ['可续接不是一次性', '可续接'],
    ['DSH 重启后能冷启动捞回', 'DSH 重启过'],
    ['第一反应是续接不是重派', '第一反应永远是 send_message 续'],
    ['孙代够不着要走中转', '够不着'],
    ['中转交给小伙伴', '由它去续'],
    ['时间行直接可用', '[时间] 现在'],
    ['闹钟长期授权优先', '以主人的长期授权为准'],
    ['闹钟不是清单', '不是一张清单，是日程'],
    // 记忆搬家那套（1.5.3 起精简：事实类判据已下沉到 memory_location 的输出，
    // 这里只锁**行为类**纪律——那是工具保证不了的，必须留在人格里）。
    ['未搬家是正常状态', '还没搬过家，正常'],
    ['真故障只有 unreachable 一个判据', '真故障只有一个判据'],
    ['禁止派子智能体去证明"没装好"', '别派小伙伴去翻插件目录'],
    ['搬家先 dryRun 看计划', 'dryRun: true'],
    ['回退办法写清楚', '删掉 location.json 就回到默认路径'],
    ['优先级固定', '指路文件 > 环境变量'],
    ['主动待办：首轮要主动提', '第一次开口主动提'],
    ['漏提的补救', '这条待办漏了'],
    ['推荐盘看内置/外置', '别只看空间'],
    // 1.5.32：微信 ClawBot 能力必须让模型自己知道（否则"微信怎么接"她现编），
    // 以及"对接默认落到发起对接的那个会话"这条固化准则。
    ['微信通道存在', '微信 ClawBot 机器人'],
    ['微信默认关闭要说实话', '默认关闭'],
    ['微信二维码121秒寿命', '121 秒'],
    ['没有 weixin-setup 技能', '没有 weixin-setup 技能'],
    ['空白名单语义', '只放行'],
    ['对接默认落当前会话', '对接默认落在「发起对接的那个会话」'],
    ['不主动新建会话', '别给他新建'],
    ['微信绑定同样落当前会话', '绑定同样默认落到「发起绑定的那个会话」'],
  ],
  'preset-aiyayi-worker': [
    ['续接检索员前 ID 现查', 'ID 必须现查'],
    ['可续接', '可续接'],
    ['孙代归它管', '归你管'],
  ],
  'preset-aiyayi-retriever': [
    // 1.5.5 加的保真纪律：精摘不许掐数字（时间/数量/版本号等）。
    ['可量化信息原样保留', '可量化信息'],
    ['禁止四舍五入或改约数', '不许四舍五入'],
    ['掐的是废话不是数字', '不是掐数字'],
  ],
}

const failures = []
for (const [preset, checks] of Object.entries(REQUIRED)) {
  const body = personas[preset]
  if (!body) {
    failures.push(`${preset}: 人设缺失`)
    continue
  }
  for (const [name, needle] of checks) {
    if (!body.includes(needle)) failures.push(`${preset}: 缺「${name}」（找不到 "${needle}"）`)
  }
}

if (failures.length > 0) {
  console.error('FAIL persona 关键纪律缺失：')
  for (const line of failures) console.error('  ' + line)
  process.exit(1)
}

console.log(`解析出 ${Object.keys(personas).length} 个预设人设`)
for (const [preset, checks] of Object.entries(REQUIRED)) {
  console.log(`  ${preset}: ${checks.length}/${checks.length} 条纪律在位`)
}
console.log('')
console.log('ALL PASS  persona 续接纪律齐全')
