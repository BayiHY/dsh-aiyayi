# 阿依娅伊（aiyayi）

一个装在 DSH 里的**对话伙伴 preset**：有独立人格、有自己长期的记忆、说话像人；她本人只负责聊天，动手的活全部派给子智能体（standard preset，带完整工具集）。

## 她是什么

| 能力 | 实现 | 说明 |
|---|---|---|
| 人格 | `@deepseek-ai/dsh-persona`（preset 作用域 prefix） | 完整人格文本写在 `bundle/cordis.patch.yml` 的 persona 行里 |
| 长期记忆 | 自写插件 `aiyayi-memory`（本包 `lib/index.js`） | 记忆落盘 `~\.dsh\aiyayi\memory.md`，每轮自动注入 prompt；工具 `remember` / `recall` |
| 跟随会话模型 | preset 作用域挂 `@deepseek-ai/dsh-agent-default-model`（`isolate: {agentDefaultModel: true}`） | 本体模型跟随用户会话模型，不再钉死 provider/model/reasoningEffort；如需指定本体默认模型，在 cordis.patch.yml 该行恢复 config 并配 provider/model |
| 干活的子智能体 | `@deepseek-ai/dsh-tool-subagent`（delegation 组，isolate workflowEngine） | `agentPreset: standard`；子代模型跟随用户会话模型，如需钉死可在 `agentOptions` 配置 provider/model |
| 工具白名单 | 自写插件 `aiyayi-restrict`（本包 `lib/restrict.js`，v3 pre-step 方案） | 启动期零 restrict 调用；她每个会话第一步前，先用探针从校验器报错里解析出当刻继承面全集，再 `deny = 全集 − 她自己的工具`——宿主层漏进来的 acp_*/mnemon_*/compress/search_context/working_directory 等对她隐藏，且自动适应宿主工具增减。**2026-11-02 实测生效**：新会话第 2 个请求起工具恰好 11 个（remember/recall/subagent/send_message/interrupt_agent/list_agents/ask_user_question/schedule_*），首请求仍带全套（见坑 #9） |
| 重逢感知 | 自写插件 `aiyayi-presence`（本包 `lib/presence.js`） | 每个回合第一步，往消息尾部追加一条 `[重逢]` 快照（time-context 同款 pre-step 注入范式）：他多久没来（presence.json）、你上次活动、你上次留的状态（state.md）、没说出口的话（wishes.json）。跨会话生效，`[SCHEDULE REMINDER` 唤醒消息不算"他来了"。工具 `update_state`（收尾留状态）/ `wish`（add/list/done 心愿单） |
| 主动开口 | `tool-schedule`（dsh 原生）+ persona 指引 | 到期提醒会把冷会话真唤醒、以 user 消息落进定闹钟的那个会话——她想主动说话就 `schedule_create` 定闹钟；DSH 没开着会存着、下次启动补投 |
| 其他 | time-context、compaction 组、tool-ask-user | 她没有 bash/文件/技能/搜索/网络工具，想动手只能派活 |

## 文件

- `bundle/package.json` — bundle 清单（`dsh.bundle.patch` 指向 cordis.patch.yml，exports 含 `./restrict` 子路径）
- `bundle/cordis.patch.yml` — preset-aiyayi 声明 + 人格 + 全部插件配置
- `bundle/lib/index.js` — aiyayi-memory 记忆插件（node:fs/os/path，零依赖）
- `bundle/lib/restrict.js` — aiyayi-restrict 工具白名单插件（零依赖）
- `bundle/lib/presence.js` — aiyayi-presence 重逢感知插件（node:fs/os/path/crypto，零依赖）
- `bundle/README.md` — 本文档
- `bundle/icon.svg` — 头像
- `~\.dsh\aiyayi\memory.md` — 她的记忆库（一行一条：`- [时间] 类别｜内容`），可直接编辑，删掉文件她会自动重建
- `~\.dsh\aiyayi\presence.json` — 他上次来 / 你上次活动（时间戳，插件自动维护）
- `~\.dsh\aiyayi\state.md` — 她给自己留的"上次活到哪"状态（update_state 覆写）
- `~\.dsh\aiyayi\wishes.json` — 她的心愿单（[{id, at, content, done}]，wish 工具读写）

## 使用

GUI 新建会话 → agent preset 选「**阿依娅伊**」。聊天即可；她说"我让人去弄"就是在派子智能体，进展和结果她会转述。

## 调整

- **改人格**：编辑 `bundle/cordis.patch.yml` 的 persona `prefix` → `plugin_manager` remove+install 重装生效（ESM 模块缓存，patchReload 不刷新插件 JS）。
- **改记忆**：直接编辑 `memory.md`，或对话里直接跟她说"记一下…"。
- **子代模型/思考**：默认跟随用户会话模型；如需钉死，在 delegation 组 `tool-subagent` 的 `agentOptions` 配置 provider/model。
- **本体思考**：本体模型跟随用户会话模型，preset 不再钉 `reasoningEffort`。若重新钉死要注意：`reasoningEffort: 'none'` 是 loomy 适配器的词表（none/low/medium/high/xhigh，**没有 "off"**）；若远端目录下发的 efforts 不含 none，她第一轮会报 `UNSUPPORTED_REASONING_EFFORT` —— 回退：删掉 agent-default-model 行的 `reasoningEffort`（默认 high），在会话模型选择器里手动选「关闭思考」。

## 已知坑（装的时候踩过的）

1. **工具 output.schema 必须是标准 JSON Schema**：`required` 只能出现在 object/array 上（顶层数组），属性里写 `required: true` 会激活失败（`JsonSchemaError`，日志在 `~\.dsh\logs\desktop-next-*.jsonl` 搜 `aiyayi`）。
2. **preset 作用域挂 `agent-default-model` 必须 `isolate: {agentDefaultModel: true}`**，否则 `service "agentDefaultModel" has been registered` 冲突，激活失败。
3. **cordis_inspect_query 传 input 有 gateway bug**（`"input" must be an object`），只能无参调用。
4. 激活失败会在安装后 ~2 秒内立刻打 warn；装完日志安静 = 注册通过。
5. **`ctx.tools.restrict()` 的名字校验对着"调用时刻的继承面"**，写不在面的名字直接抛错（`names unknown global tools ...`）。**preset 加载发生在内核启动期，此刻全局层只有 modlens_read_image 和 working_directory 两个工具**（acp_*、mnemon_* 等都是会话创建时才注册）——所以在 preset 行里点名 deny 会话工具 = 启动激活失败，preset 被登记处摘掉，GUI 里"阿依娅伊"直接消失（实测启动日志实锤）。**`allow: []` 也别用**——实测它连 preset 自己行注册的工具也一并藏掉（request 里只剩 isolated realm 的 subagent）。正确做法 = v3：restrict 推迟到 `agent/pre-step`（处理器签名 `({agent, turn, step, signal}, next)`，来自 dsh-time-context 源码），先用必然未知的探针名调 `restrict({allow:[probe]})` 从报错里解析出 `known global tools: ...` 全集，再 `deny = 全集 − 她的工具`；名字全来自运行时全集，永不踩未知名，宿主加新工具也自动覆盖。她的子智能体挂 standard preset，不在 aiyayi fiber 事件链上，不受影响。
6. **会话模型选择压过 preset 默认**：GUI 建会话总会带上模型参数（UI 记住"上次用的模型"），preset 的 agent-default-model 只兜底完全没带模型的会话——实际上永远轮不到。preset 里的 agent-default-model 行只是文档性兜底。
7. MNEMON 运行时记忆快照是宿主级注入，工具白名单管不掉——她看得见，但人设里已声明"自己的记忆以 memory.md 为准"。她若去调 mnemon_remember 这类被隐藏的工具会报 `ToolNotFoundError UNKNOWN_TOOL`（模型从快照上下文里"知道"这些名字）。
8. **有活跃的阿依娅伊会话时 remove/install 会报 restart-required**（unmanaged-plugin）：旧 preset 修订被在用会话占着，热重载换不动——先关掉她的会话或直接重启 DSH 再装。
9. **v3 白名单首请求不生效**：`agent/pre-step` 落在首个请求组装之后，所以新会话第 1 个请求仍带全套 37 个宿主工具，第 2 个请求起收敛到 11 个。她的第 1 句回复可能看见（甚至调用）宿主工具——量小可忍；要收紧需把 restrict 提前到 `agent/created`（风险：agent/created 时刻继承面可能不全，deny 会漏掉后注册的工具）。
10. **「关闭思考」在讯飞上游不生效（2026-11-02 实测）**：请求确实带上了 `reasoning_effort:"none"`（dsh-our-free-model pack.js stream() 42288–42297 行：none 在声明档位表里就原样发送），但 spark-x2.6（thinkLen 1873/8379）和 GLM-5.3-Flash（thinkLen 6425）照样输出完整思考块（逐条核对 request cfg ↔ assistant reasoning，实测）。上游忽略该参数，客户端无解。可选出路：换 loomy 其它模型（Kimi-k2.6/qwen3.8-flash/deepseek-v4-flash-0731/MiniMax-M3/mimo-v2.5）试「关闭思考」看哪家认；或接受她带思考（人设不受影响）。
11. **本地 bundle 的 JS import 解析不到 shipped 包**：`import { createUserMessage } from '@deepseek-ai/dsh-llm'` → `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm' imported from ...\bundle\lib\presence.js`，preset 激活失败（"never started"）。"shipped 包从 dsh 安装目录解析"只对 patch 行里的插件名成立，对 bundle 代码里的 import 不成立；dsh-llm 也不在 pnpm 可装范围（profile 里只有 cosmokit/schemastery 两个 @deepseek-ai 包是 registry 装的）。解法：手构消息——`createUserMessage(input)` 就是 `deepFreeze(structuredClone({...input, id: randomUUID()}))`，会话日志是 JSON，symbol brand 本来就存不下来，用 node:crypto 的 randomUUID + 纯 JSON 字段手构即可（presence.js 的 `createSnapshotMessage`）。
12. **每回合注入动态内容必须走 `agent/pre-step` 消息追加，别走 systemPrompt.section**：section 的 text 每轮变化会打破 KV 前缀 → 整段对话历史重付费；pre-step 追加的消息持久落盘、前缀稳定。范式抄 dsh-time-context：`ctx.on("agent/pre-step", async ({agent, turn, step, signal}, next) => { const d = await next(); if (!d || d.kind === 'reject' || signal?.aborted) return d; return {...d, messages: [...d.messages, msg]} }, {prepend: true})`。注入判据用 `step === 1`（step 每回合重置为 1），不必上 sessionProjections/zod。
