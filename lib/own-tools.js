/**
 * 阿依娅伊自己的工具名单 —— 单一真源。
 *
 * 为什么要有这个文件：她的工具白名单（restrict.js）以前是手写常量，
 * 每加一个自己的工具就要记得同步两处。2026-11-05 就漏了 memory_organize——
 * 她想整理记忆时发现"手上只有记和翻两个动作"，工具其实注册好了，是被白名单
 * 挡住的；同一次 DSH 升级还把 schedule 工具改了名
 * （schedule_update/schedule_delete → schedule_edit/schedule_view），
 * 旧名单又少了两个，闹钟的"查看/改期"也被挡。
 *
 * 现在三处读同一份真相：
 * - index.js / presence.js 注册工具时调 registerOwnTool(name)；
 * - restrict.js 放行时问 isOwnTool(name)；
 * - 静态兜底表 OWN_TOOLS 防"模块实例不共享"时漏放行。
 * 新增自己的工具只改一处，不会再漂。
 */

/** 静态兜底：她自己的记忆与状态工具（正常路径下由 registerOwnTool 收集）。 */
export const OWN_TOOLS = [
  'remember',
  'recall',
  'memory_organize',
  'memory_location',
  'memory_relocate',
  'update_state',
  'wish',
  'feishu_status',
  'feishu_bind',
  // 微信通道（1.5.27 并入；静态兜底与 feishu 同格——运行时由 registerOwnTool 收集，
  // 这里防"模块实例不共享/初始化前"漏放行，尤其 weixin_bind/weixin_unbind 是李浩高频入口）
  'weixin_status',
  'weixin_login',
  'weixin_bind',
  'weixin_unbind',
]

/** 宿主提供的、她该留着的对话与委派工具。retriever 1.3.0 起加入（派检索员）。 */
export const HOST_OWN_TOOLS = [
  'subagent',
  'retriever',
  'send_message',
  'interrupt_agent',
  'list_agents',
  'ask_user_question',
]

/**
 * 闹钟一族用前缀判定，因为 DSH 会改名：
 * 旧版 schedule_create / schedule_list / schedule_update / schedule_delete，
 * 新版（0.2.2-rc.1 起）schedule_create / schedule_list / schedule_view /
 * schedule_edit（改期与删除合并进 schedule_edit 的 action 参数）。
 * deny 名单只能含当刻继承面上真实存在的名字（restrict 对未知名直接抛错），
 * 所以这里不能硬名单——写一个不存在的名字会让整个 restrict 调用失败、收敛失效。
 */
export const OWN_TOOL_PREFIXES = ['schedule_']

/** 运行期收集到的、自注册工具名。 */
const registered = new Set()

/** 插件注册自己的工具时调用，把自己登记进放行名单。 */
export function registerOwnTool(toolName) {
  registered.add(toolName)
  return toolName
}

/** 当前已登记的自注册工具名。 */
export function ownToolNames() {
  return [...registered]
}

/** 判断一个工具名是不是"她自己的"，该放行。 */
export function isOwnTool(name) {
  if (registered.has(name)) return true
  if (OWN_TOOLS.includes(name)) return true
  if (HOST_OWN_TOOLS.includes(name)) return true
  return OWN_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))
}
