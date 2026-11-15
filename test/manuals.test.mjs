/**
 * aiyayi-manuals 测试（1.8.0）：persona 渐进加载——飞书/微信手册按话题自动注入。
 *
 * 假 ctx 范式照 test/phone.test.mjs：effect 立即执行、on 收集处理器，
 * 手动喂 { agent, step, signal } + next() 返回假 decision。
 *
 * 覆盖：
 *  1. 关键词命中 → 注入对应手册（含 [手册·飞书] 首行与实际路径）。
 *  2. 引号内内容不触发（stripQuoted）。
 *  3. 防自触发：注入文本自己命中关键词不再触发。
 *  4. 每会话每本只注入一次（去重）。
 *  5. 两处真源都缺 → 静默不崩。
 *  6. 记忆根 docs/manuals/ 文件优先于包内回落。
 *  7. 微信触发词命中 → 注入 weixin 手册。
 *  8. 工具调用路：session/event 的 tool/call（name=feishu_status）→ 下一步注入。
 *  9. step!==1 与注入消息形状（source.kind=aiyayi-manuals, form=snapshot）。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-manuals-'))

const { apply, name, matchManualIntent, manualKeyForTool, isInjectedManualText, __testing } = await import(libUrl('manuals.js'))

let ok = true
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${String(extra)}`}`)
  if (!cond) ok = false
}

/* ── 纯函数：关键词匹配 ── */
check('插件名不变（Loader id 靠它）', name === 'aiyayi-manuals', name)
check('飞书族词命中', matchManualIntent('帮我看看飞书连接状态怎么样').join() === 'feishu', matchManualIntent('帮我看看飞书连接状态怎么样'))
check('lark/feishu 英文词命中', matchManualIntent('check the lark bridge').includes('feishu'))
check('微信族词命中', matchManualIntent('微信那条通道还没弄好吧').includes('weixin'))
check('clawbot/扫码登录命中微信', matchManualIntent('clawbot 的扫码登录怎么弄').includes('weixin'))
check('两族同时命中各归各', matchManualIntent('飞书和微信都聊聊').sort().join() === 'feishu,weixin')
check('无关文本不触发', matchManualIntent('今晚吃火锅怎么样').length === 0)
check('引号内不算意图', matchManualIntent('他消息里说「接入飞书绑定会话 2」是不是有问题').length === 0, matchManualIntent('他消息里说「接入飞书绑定会话 2」是不是有问题'))
check('防自触发：手册件文本不再命中', matchManualIntent('[手册·飞书] 以下为飞书对接手册全文（本会话仅注入一次）：/x/y').length === 0)
check('防自触发：引导件文本不再命中', matchManualIntent('〔系统提示·非用户发言〕本会话还没接入飞书聊天机器人，建议接入').length === 0)
check('isInjectedManualText 识别首行前缀', isInjectedManualText('[手册·微信] 以下为微信对接手册全文') === true)
check('tool→key 映射', manualKeyForTool('weixin_login') === 'weixin' && manualKeyForTool('feishu_bind') === 'feishu' && manualKeyForTool('remember') === null)

/* ── 假 ctx：收集 session/event 与 agent/pre-step 处理器 ── */
const eventHandlers = []
const preStepHandlers = []
const makeCtx = () => ({
  effect(fn) {
    fn()
    return () => {}
  },
  on(event, handler) {
    if (event === 'agent/pre-step') preStepHandlers.push(handler)
    else if (event === 'session/event') eventHandlers.push(handler)
    return () => {}
  },
})

const makeAgent = (sessionId) => ({ id: `agent-${sessionId}`, session: { id: sessionId } })

const userMsg = (text) => ({
  id: `u-${text.slice(0, 6)}-${Math.random().toString(36).slice(2, 6)}`,
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
})

const decision = (...msgs) => ({ kind: 'proceed', messages: msgs })

const run = async (agent, messages, step = 1) => {
  const d = decision(...messages)
  const result = await preStepHandlers[0]({ agent, step, signal: new AbortController().signal }, async () => d)
  const injected = result.messages.length > d.messages.length
  const last = result.messages.at(-1)
  return {
    injected,
    text: (last?.content ?? []).map((b) => b.text).join('\n'),
    last,
  }
}

apply(makeCtx())
check('注册了 pre-step 监听器', preStepHandlers.length === 1, preStepHandlers.length)
check('注册了 session/event 监听器', eventHandlers.length === 1, eventHandlers.length)

/* ── 端到端注入（真源指向：记忆根=沙盘、包内=仓库 manuals/） ── */
function sandboxRoot(feishuText = null, weixinText = null) {
  const root = mkdtempSync(join(sandbox, 'root-'))
  mkdirSync(join(root, 'docs', 'manuals'), { recursive: true })
  if (feishuText !== null) writeFileSync(join(root, 'docs', 'manuals', 'feishu.md'), feishuText, 'utf8')
  if (weixinText !== null) writeFileSync(join(root, 'docs', 'manuals', 'weixin.md'), weixinText, 'utf8')
  return root
}

// 1. 关键词命中 → 注入（走包内回落：记忆根为空目录）
{
  __testing.resetForTest()
  __testing.setMemoryRoot(sandboxRoot())
  const out = await run(makeAgent('s-kw-1'), [userMsg('帮我看下飞书长连接正常不')])
  check('关键词命中 → 注入', out.injected === true)
  check('注入首行 [手册·飞书]', out.text.startsWith('[手册·飞书]'), out.text.slice(0, 60))
  check('首行带实际读到的路径', /重读）：.*manuals[/.]+feishu\.md$/.test(out.text.split('\n')[0]), out.text.split('\n')[0])
  check('正文含手册内容（connected 语义）', out.text.includes('connected'))
  check('注入消息形状 source.kind=aiyayi-manuals', out.last?.source?.kind === 'aiyayi-manuals' && out.last?.source?.form === 'snapshot', JSON.stringify(out.last?.source))
  check('role=user', out.last?.role === 'user')

  // 4. 去重：同会话再命中不注第二次
  const again = await run(makeAgent('s-kw-1'), [userMsg('飞书又怎么了')])
  check('每会话每本只注入一次（去重）', again.injected === false)

  // step!==1 不注入
  __testing.resetForTest()
  __testing.setMemoryRoot(sandboxRoot())
  const later = await run(makeAgent('s-step-2'), [userMsg('飞书状态')], 2)
  check('step!==1 不注入', later.injected === false)
}

// 6. 记忆根文件优先于包内回落
{
  __testing.resetForTest()
  const root = sandboxRoot('# 我是记忆根版飞书手册\n\nconnected 字段记忆版独有。\n')
  __testing.setMemoryRoot(root)
  const out = await run(makeAgent('s-prio-1'), [userMsg('说说飞书 connected 和 healthy')])
  check('记忆根手册被读到', out.injected === true && out.text.includes('记忆根版飞书手册'), out.text.slice(0, 80))
  check('注入路径指向记忆根', out.text.split('\n')[0].includes(join(root, 'docs', 'manuals', 'feishu.md')), out.text.split('\n')[0])
}

// 7. 微信触发词 → 注入 weixin 手册
{
  __testing.resetForTest()
  __testing.setMemoryRoot(sandboxRoot())
  const out = await run(makeAgent('s-wx-1'), [userMsg('微信 clawbot 通道怎么开')])
  check('微信触发词命中 → 注入 weixin 手册', out.injected === true && out.text.startsWith('[手册·微信]'), out.text.slice(0, 40))
  check('weixin 手册正文含 121 秒', out.text.includes('121 秒'))
}

// 5. 两处真源都缺 → 静默不崩
{
  __testing.resetForTest()
  __testing.setMemoryRoot(sandboxRoot()) // 记忆根空
  __testing.setBundledDir(join(sandbox, 'no-such-pkg')) // 包内目录指向不存在
  let crashed = false
  let out
  try {
    out = await run(makeAgent('s-miss-1'), [userMsg('飞书呢')])
  } catch {
    crashed = true
  }
  check('双缺 → 不崩', crashed === false)
  check('双缺 → 静默不注入', crashed === false && out.injected === false)
  // 真源补齐后同一会话还能再触发（没记账成"已注入"）
  __testing.setBundledDir(null)
  const revived = await run(makeAgent('s-miss-1'), [userMsg('飞书呢')])
  check('双缺没误记账：补源后同会话仍能注入', revived.injected === true)
}

// 8. 工具调用路：tool/call 事件 → 下一步注入；非目标工具不触发
{
  __testing.resetForTest()
  __testing.setMemoryRoot(sandboxRoot())
  const agent = makeAgent('s-tool-1')
  const bus = eventHandlers[0]
  bus({ id: 's-tool-1' }, { type: 'tool/call', data: { name: 'feishu_status', arguments: {} } })
  bus({ id: 's-tool-1' }, { type: 'tool/call', data: { name: 'remember' } }) // 无关工具
  bus({ id: 's-tool-1' }, { type: 'tool/result', data: { name: 'feishu_bind' } }) // 不是 call，忽略
  const out = await run(agent, [userMsg('随便一句无关的话')])
  check('tool/call 触发注入（话题无关也注）', out.injected === true && out.text.startsWith('[手册·飞书]'), out.text.slice(0, 50))
  const again = await run(makeAgent('s-tool-1'), [userMsg('再来一句')])
  check('工具路也受每会话一次去重', again.injected === false)
}

/* ── 手册文件 ≤8KB（toolkit_read 默认上限） ── */
{
  __testing.resetForTest()
  __testing.setMemoryRoot(sandboxRoot())
  __testing.setBundledDir(null)
  const fs = await import('node:fs')
  for (const key of ['feishu', 'weixin']) {
    const p = __testing.bundledManualPath(key)
    const size = fs.statSync(p).size
    check(`包内手册 ${key}.md ≤8KB`, size <= 8 * 1024, `${p} = ${size}B`)
  }
}

console.log('')
if (!ok) {
  console.error('FAIL aiyayi-manuals 有断言未过')
  process.exit(1)
}
console.log('ALL PASS  aiyayi-manuals 注入器行为齐全')
