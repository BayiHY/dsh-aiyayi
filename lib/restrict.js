// aiyayi-restrict —— 阿依娅伊的工具收敛（v3，pre-step 运行时方案）。
//
// 背景：preset 组合是"叠加"不是"替换"，宿主根作用域与会话作用域的工具
// （acp_*、mnemon_*、compress/search_context、working_directory、modlens…）
// 会原样漏进她的会话。
//
// 三次实测踩出来的契约（asar @deepseek-ai/dsh-tools/lib/index.js + 启动日志）：
// 1. restrict() 只能在 scoped 上下文调用；allow/deny 都 undefined 报 no-op 错。
// 2. allow/deny 的名字必须落在调用时刻"继承面"（restrictableNames）上，
//    未知名直接抛错。**preset 加载发生在内核启动期**，此刻全局层只有
//    modlens_read_image 和 working_directory 两个工具（实测启动日志的报错
//    原文）；acp_*、mnemon_* 都是会话创建时才注册的
//    ——在 preset 行里点名 deny 它们 = 激活失败，preset 被登记处摘掉，
//    GUI 里"阿依娅伊"直接消失。
// 3. allow:[] 会把 preset 自己行注册的工具也藏掉（实测：请求里只剩
//    isolated realm 逃逸的 subagent），不能用。
// 4. 掩码对会话作用域注册的工具同样生效（allow:[] 实验把它们全藏没了），
//    且掩码在 dispose 前一直有效。
//
// 因此 v3 把 restrict 推迟到 agent/pre-step（每次请求组装之前触发，处理器
// 收到 { agent, turn, step, signal }，签名来自 dsh-time-context 源码）：
// - 启动期零 restrict 调用，激活不可能因名字炸掉；
// - 第一步之前，先用一个必然未知的探针名字调 restrict({allow:[probe]}，
//   从它抛出的 "known global tools: ..." 错误信息里解析出当刻继承面全集，
//   再 deny = 全集 - 她自己的工具。名字全部来自运行时全集，永不踩未知名；
// - 她自己的工具（记忆/状态/心愿 + 委派 + 闹钟）始终不在 deny 里；
// - 解析失败就什么都不做（退化为现状：漏宿主工具，但绝不弄坏会话）；
// - 每个 agent 只做一次（WeakSet 防重入）。
// 她的子智能体挂 standard preset，不在 aiyayi fiber 的事件链上，收不到这个
// 监听器，工具集不受影响。
//
// 2026-11-05（v3.1）：放行名单改为从 own-tools.js 读，不再手写常量。
// 手写常量漂移过一次——漏了 memory_organize（她想整理记忆时发现"只有记和翻
// 两个动作"），同时 DSH 升级把 schedule 工具改名，旧名单里的
// schedule_update/schedule_delete 已不存在，新名字 schedule_view/schedule_edit
// 没进名单，闹钟的"查看/改期"被挡。改成单一真源 + 前缀判定后，
// 新增自己的工具只改 own-tools.js 一处。
//
// 注意 deny 名单只能包含当刻继承面上真实存在的名字（restrict 对未知名直接
// 抛错）。所以白名单用"前缀/精确名判定"而不是硬名单——多写一个不存在的
// 名字会让整个 restrict 调用失败、收敛失效（退回漏宿主工具的旧状态）。

import { isOwnTool } from './own-tools.js'

/** 必然不在继承面上的名字，专为从校验器嘴里套出 known 列表。 */
const PROBE = "__aiyayi_probe_never_matches__";

/**
 * 从 restrict() 的报错信息里解析 "known global tools: a, b, c"。
 * 1.7.0 起导出：aiyayi-phone 用同一探针判"手上有无 mcp__phone__*"，
 * 解析逻辑单一真源在这里，别再抄一份。
 */
export function parseKnownGlobalTools(error) {
  const match = /known global tools: ([^\n]+)/.exec(String(error?.message ?? error));
  if (!match) return null;
  const names = match[1].split(",").map((part) => part.trim().replace(/^"|"$/g, "")).filter(Boolean);
  return names.length > 0 ? names : null;
}

export const name = "aiyayi-restrict";
export const inject = ["tools"];

export function apply(ctx) {
  const restricted = new WeakSet();
  ctx.effect(() => ctx.on("agent/pre-step", async ({ agent }, next) => {
    try {
      if (agent?.ctx?.tools && !restricted.has(agent)) {
        restricted.add(agent);
        let known = null;
        try {
          agent.ctx.tools.restrict({ allow: [PROBE] });
        } catch (probeError) {
          known = parseKnownGlobalTools(probeError);
        }
        if (known) {
          const deny = known.filter((tool) => !isOwnTool(tool));
          if (deny.length > 0) {
            try {
              agent.ctx.tools.restrict({ deny });
            } catch {
              /* 收敛失败只影响观感，不影响会话存活 */
            }
          }
        }
      }
    } catch {
      /* 任何意外都不允许弄坏她的会话 */
    }
    return await next();
  }), "aiyayi.restrict.pre-step()");
}
