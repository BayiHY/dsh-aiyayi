# 阿依娅伊（aiyayi）

一个装在 DSH 里的**对话伙伴 preset**：有独立人格、有自己长期的记忆、说话像人；她本人只负责聊天，动手的活全部派给子智能体（standard preset，带完整工具集）。

## 她是什么

| 能力 | 实现 | 说明 |
|---|---|---|
| 人格 | `@deepseek-ai/dsh-persona`（preset 作用域 prefix） | 完整人格文本写在 `bundle/cordis.patch.yml` 的 persona 行里 |
| 长期记忆 | 自写插件 `aiyayi-memory`（本包 `lib/index.js`），两层结构 | **核心记忆** `~\.dsh\aiyayi\memory.md`（她自规划的"每轮都想带着"的条目 + 她亲手维护的【记忆索引】目录），每轮自动注入 prompt；**分类档案** `~\.dsh\aiyayi\memories\` 分类树（最深三级，分类名她自己起），平时不注入、按需加载。工具：`remember`（core: true/false + 分类 path）/ `recall`（全库搜：核心+整棵树）/ `memory_organize`（tree 看家底 / read 读档案 / move 挪窝 / index 重写目录 / forget 删条目——整理是她自己的家务事）。已有 memory.md 的存量条目全部视作核心，由她自己逐渐搬理 |
| 跟随会话模型 | 无需插件行（1.0.1 起移除 agent-default-model 行） | 本体模型直接跟随用户会话模型；旧版"preset 作用域挂 `@deepseek-ai/dsh-agent-default-model` + `isolate: {agentDefaultModel: true}`"的写法在新版 DSH 过不了 schema 校验（见坑 #13），已删除 |
| 干活的子智能体 | `@deepseek-ai/dsh-tool-subagent`（delegation 组，isolate workflowEngine） | `agentPreset: aiyayi-worker`（自建"小伙伴"预设，全量工具 + 原生自动压缩，见坑 #14）；子代模型跟随用户会话模型，如需钉死可在 `agentOptions` 配置 provider/model |
| 工具白名单 | 自写插件 `aiyayi-restrict`（本包 `lib/restrict.js`，v3.1 pre-step 方案）+ `lib/own-tools.js` 单一真源 | 启动期零 restrict 调用；她每个会话第一步前，先用探针从校验器报错里解析出当刻继承面全集，再 `deny = 全集 − 她自己的工具`——宿主层漏进来的 acp_*/mnemon_*/compress/search_context/working_directory 等对她隐藏，且自动适应宿主工具增减。放行名单从 `own-tools.js` 读（注册处登记、放行处判定），新增工具只改一处，不再漂（见坑 #19）。**2026-11-02 实测生效**：新会话第 2 个请求起工具恰好 11 个，第 1 个请求仍带全套（见坑 #9） |
| 重逢感知 | 自写插件 `aiyayi-presence`（本包 `lib/presence.js`） | 每个回合第一步，往消息尾部追加一条 `[重逢]` 快照（time-context 同款 pre-step 注入范式）：他多久没来（presence.json）、你上次活动、你上次留的状态（state.md）、没说出口的话（wishes.json）。快照还带**版本自述**：`你当前插件版本：dsh-aiyayi x.y.z`（package.json 现读不写死，让她对自己版本有概念、不与 DSH 桌面版混淆；有新版时 updates 插件照旧单独提醒）。跨会话生效，`[SCHEDULE REMINDER` 唤醒消息不算"他来了"。工具 `update_state`（收尾留状态）/ `wish`（add/list/done 心愿单） |
| 自我状态（体检单） | 同上 `aiyayi-presence`（v1.2.0 起） | `session/event` 总线折叠真实运行数据：模型与思考档、上下文用量（provider 实测 usage 优先，tokenMeter 估算兜底并标"估算"）、缓存命中率、上轮输出 tok/s、本会话轮数、上轮异常。变化明显（≥2048 token / 模型切换 / 异常）才注入，不每轮白涨。用量过八成/九成（估算口径按中文偏差 ÷0.49 校准，见坑 #16）注入 `[上下文提醒]`：劝用户开新会话、并让用户走之前说一声好让她收尾（update_state/补记忆/把话说完）；每档只提醒一次 |
| 主动开口 | `tool-schedule`（dsh 原生）+ persona 指引 | 到期提醒会把冷会话真唤醒、以 user 消息落进定闹钟的那个会话——她想主动说话就 `schedule_create` 定闹钟；DSH 没开着会存着、下次启动补投 |
| 新版本提醒 | 自写插件 `aiyayi-updates`（本包 `lib/updates.js`） | 每个会话第一个回合查一次 npm（registry.npmjs.org，失败落 npmmirror；成功结果缓存 6h、失败 30min 后重试）：本地版本比 latest 旧时，往消息尾部追加 `[更新提示]` 快照，她会用自己的口吻顺口提一句。同一远端版本只提醒一次（updates.json 落盘去重，跨重启不重复念叨）；检查失败/离线一律静默。**判据：`~\\.dsh\\aiyayi\\updates.json` 不存在 = 从没发现过新版（本地已是最新）；她答不上"自己是什么版本"是设计边界（升级判断靠被动推送），已由 presence 的版本自述补上** |
| 其他 | time-context、compaction 组（提前压缩，见坑 #14/#16）、tool-ask-user | 她没有 bash/文件/技能/搜索/网络工具，想动手只能派活 |

## 文件

npm 包为平铺结构（仓库若保留 bundle/ 子目录，发布时把其内容提到包根即可）：

- `package.json` — bundle 清单（`dsh.bundle.patch` 指向 cordis.patch.yml，exports 含 `./restrict` / `./presence` 子路径）
- `cordis.patch.yml` — preset-aiyayi 声明 + 人格 + 全部插件配置
- `lib/index.js` — aiyayi-memory 记忆插件（node:fs/os/path，零依赖）
- `lib/restrict.js` — aiyayi-restrict 工具白名单插件（零依赖）
- `lib/presence.js` — aiyayi-presence 重逢感知插件（node:fs/os/path/crypto，零依赖）
- `lib/updates.js` — aiyayi-updates 新版本提醒插件（node:fs/os/path/crypto/url + 全局 fetch，零依赖）
- `lib/net.js` — aiyayi-net 联网工具（aiyayi_fetch + aiyayi_cdp，node 内建能力实现，零外置依赖，只挂小伙伴 preset）
- `lib/own-tools.js` — 她的工具名单单一真源（注册处登记、放行处判定，防手写白名单漂移）
- `README.md` — 本文档
- `icon.svg` — 头像
- `~\.dsh\aiyayi\memory.md` — 她的**核心记忆**（条目行 `- [时间] 类别｜内容` + 末尾 `<!-- 索引 -->…<!-- /索引 -->` 目录段），可直接编辑，删掉文件她会自动重建
- `~\.dsh\aiyayi\memories\` — 她的**分类档案树**（最深三级，如 `memories\用户\口味.md`），remember 的非核心条目归这里，recall 全库搜、memory_organize 的 read/move/forget 按路径操作
- `~\.dsh\aiyayi\presence.json` — 他上次来 / 你上次活动（时间戳，插件自动维护）
- `~\.dsh\aiyayi\state.md` — 她给自己留的"上次活到哪"状态（update_state 覆写）
- `~\.dsh\aiyayi\wishes.json` — 她的心愿单（[{id, at, content, done}]，wish 工具读写）
- `~\.dsh\aiyayi\updates.json` — 已提醒过的 npm 版本号（updates 插件去重用，可删除以重置提醒）

## 使用

GUI 新建会话 → agent preset 选「**阿依娅伊**」。聊天即可；她说"我让人去弄"就是在派子智能体，进展和结果她会转述。

## 调整

- **改人格**：编辑 `cordis.patch.yml`（包根）的 persona `prefix` → `plugin_manager` remove+install 重装生效（ESM 模块缓存，patchReload 不刷新插件 JS；实测它也不拾取包内 yml 变化，改完要重启 DSH）。
- **改记忆**：直接编辑 `memory.md`，或对话里直接跟她说"记一下…"。
- **子代模型/思考**：默认跟随用户会话模型；如需钉死，在 delegation 组 `tool-subagent` 的 `agentOptions` 配置 provider/model。
- **本体思考**：本体模型跟随用户会话模型，preset 自 1.0.1 起不再内置 agent-default-model 行（原因见坑 #13），`reasoningEffort` 由会话模型选择器控制；「关闭思考」在讯飞上游不生效见坑 #10。

## 已知坑（装的时候踩过的）

1. **工具 output.schema 必须是标准 JSON Schema**：`required` 只能出现在 object/array 上（顶层数组），属性里写 `required: true` 会激活失败（`JsonSchemaError`，日志在 `~\.dsh\logs\desktop-next-*.jsonl` 搜 `aiyayi`）。
2. **preset 作用域挂 `agent-default-model` 必须 `isolate: {agentDefaultModel: true}`**，否则 `service "agentDefaultModel" has been registered` 冲突，激活失败。
3. **cordis_inspect_query 传 input 有 gateway bug**（`"input" must be an object`），只能无参调用。
4. 激活失败会在安装后 ~2 秒内立刻打 warn；装完日志安静 = 注册通过。
5. **`ctx.tools.restrict()` 的名字校验对着"调用时刻的继承面"**，写不在面的名字直接抛错（`names unknown global tools ...`）。**preset 加载发生在内核启动期，此刻全局层只有 modlens_read_image 和 working_directory 两个工具**（acp_*、mnemon_* 等都是会话创建时才注册）——所以在 preset 行里点名 deny 会话工具 = 启动激活失败，preset 被登记处摘掉，GUI 里"阿依娅伊"直接消失（实测启动日志实锤）。**`allow: []` 也别用**——实测它连 preset 自己行注册的工具也一并藏掉（request 里只剩 isolated realm 的 subagent）。正确做法 = v3：restrict 推迟到 `agent/pre-step`（处理器签名 `({agent, turn, step, signal}, next)`，来自 dsh-time-context 源码），先用必然未知的探针名调 `restrict({allow:[probe]})` 从报错里解析出 `known global tools: ...` 全集，再 `deny = 全集 − 她的工具`；名字全来自运行时全集，永不踩未知名，宿主加新工具也自动覆盖。她的子智能体挂 standard preset，不在 aiyayi fiber 事件链上，不受影响。
6. **会话模型选择压过 preset 默认**：GUI 建会话总会带上模型参数（UI 记住"上次用的模型"），preset 的 agent-default-model 只兜底完全没带模型的会话——实际上永远轮不到。preset 里的 agent-default-model 行只是文档性兜底。
7. MNEMON 运行时记忆快照是宿主级注入，工具白名单管不掉——她看得见，但人设里已声明"自己的记忆以 memory.md 为准"。她若去调 mnemon_remember 这类被隐藏的工具会报 `ToolNotFoundError UNKNOWN_TOOL`（模型从快照上下文里"知道"这些名字）。
8. **有活跃的阿依娅伊会话时 remove/install 会报 restart-required**（unmanaged-plugin）：旧 preset 修订被在用会话占着，热重载换不动——先关掉她的会话或直接重启 DSH 再装。
9. **v3 白名单首请求不生效**：`agent/pre-step` 落在首个请求组装之后，所以新会话第 1 个请求仍带全套宿主工具，第 2 个请求起收敛。她的第 1 句回复可能看见（甚至调用）宿主工具——量小可忍；要收紧需把 restrict 提前到 `agent/created`（风险：agent/created 时刻继承面可能不全，deny 会漏掉后注册的工具）。
10. **「关闭思考」在讯飞上游不生效（2026-11-02 实测）**：请求确实带上了 `reasoning_effort:"none"`（dsh-our-free-model pack.js stream() 42288–42297 行：none 在声明档位表里就原样发送），但 spark-x2.6（thinkLen 1873/8379）和 GLM-5.3-Flash（thinkLen 6425）照样输出完整思考块（逐条核对 request cfg ↔ assistant reasoning，实测）。上游忽略该参数，客户端无解。可选出路：换 loomy 其它模型（Kimi-k2.6/qwen3.8-flash/deepseek-v4-flash-0731/MiniMax-M3/mimo-v2.5）试「关闭思考」看哪家认；或接受她带思考（人设不受影响）。
11. **本地 bundle 的 JS import 解析不到 shipped 包**：`import { createUserMessage } from '@deepseek-ai/dsh-llm'` → `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm' imported from ...\bundle\lib\presence.js`，preset 激活失败（"never started"）。"shipped 包从 dsh 安装目录解析"只对 patch 行里的插件名成立，对 bundle 代码里的 import 不成立；dsh-llm 也不在 pnpm 可装范围（profile 里只有 cosmokit/schemastery 两个 @deepseek-ai 包是 registry 装的）。解法：手构消息——`createUserMessage(input)` 就是 `deepFreeze(structuredClone({...input, id: randomUUID()}))`，会话日志是 JSON，symbol brand 本来就存不下来，用 node:crypto 的 randomUUID + 纯 JSON 字段手构即可（presence.js 的 `createSnapshotMessage`）。
12. **每回合注入动态内容必须走 `agent/pre-step` 消息追加，别走 systemPrompt.section**：section 的 text 每轮变化会打破 KV 前缀 → 整段对话历史重付费；pre-step 追加的消息持久落盘、前缀稳定。范式抄 dsh-time-context：`ctx.on("agent/pre-step", async ({agent, turn, step, signal}, next) => { const d = await next(); if (!d || d.kind === 'reject' || signal?.aborted) return d; return {...d, messages: [...d.messages, msg]} }, {prepend: true})`。注入判据用 `step === 1`（step 每回合重置为 1），不必上 sessionProjections/zod。
13. **agent-default-model 行在新版 DSH 会摘掉整个 preset（2026-11-03 实测，desktop 2.0.18；1.0.1 已修）**：本版 DSH 的 `@deepseek-ai/dsh-agent-default-model` schema 把 `provider` 设为必填，preset 内「`isolate: {agentDefaultModel: true}` + 无 config」的写法过不了校验 → `agent-preset-registry` warn `invalid config: $.provider missing required value`，且 **preset 行一损俱损，整个「阿依娅伊」被登记处摘掉**，GUI 显示"加载失败"。1.0.1 起删除该行（GUI 建会话总带模型参数，该行本就只是兜底，见坑 #6）。要在自己的 preset 里挂它：要么给全 config（provider/model 必填），要么干脆不挂。排障：`~\.dsh\logs\desktop-next-*.jsonl` 搜 preset id，stderr 的 `1 entry did not activate` 是线索；改完包内文件必须重启 DSH（patchReload 不拾取 bundle 内变化）。
14. **会话爆掉（CONTEXT_WINDOW_EXCEEDED）的完整因果链与修复（2026-11-04）**：
    - **billion-context 的压缩门控**（其包内 `dsh.bundle.patch.yml`）：宿主层 `compaction-basic` 被 `config: {auto: false}` 覆盖，且只向 preset-standard/ptc/minimal/cordis 四个 Web 预设注入 `biliBasicCompactionPolicy` 让其内嵌 compaction 等 bili 的 overlay——**preset-nested 行任何 patch 层都按 id 管不到**。后果：standard 预设会话的 dsh 原生自动压缩**和溢出恢复同时被关**（`if (config.auto) _registerAutomaticCompaction()` 同时注册压力检查与 request-error 恢复两个监听），bili 自身压缩没跑时（实测 bili=0）长会话裸奔，切到小窗口模型即 `pi-ai detected context overflow ... CONTEXT_WINDOW_EXCEEDED`，且爆后无自救直接砖死。实测受害会话：208 turns / 526 条用户消息 / 15 次模型切换，225K tokens 装进 200K 窗口。
    - **pi-ai 模型 contextWindow 声明残缺**：压缩引擎靠 `resolveModelInfo().context` 算窗口压力，没声明的模型被跳过（warn "no context capacity"）。profile 的 llm-pi-ai 六个 provider 除 openrouter/free 外全部没声明。修复：profile patch 给全部模型补保守 `contextWindow`（聊天 131072、图像/视频 32768；声明偏小只会早压缩、永不溢出）。
    - **本 preset 的修复**：①compaction-basic 显式 `config: {auto: true, thresholdRatio: 0.4, headroomTokens: 32768, maxOverflowRetries: 2}`（她不在 bili 门控名单，原生引擎照常跑；0.4 的原因见坑 #16——0.65 在中文会话里永远够不到）；②自建 **aiyayi-worker** preset（蓝本 standard：全量工具 + 同款压缩 config，去掉 delegation 组不许再派活），`tool-subagent` 的 `agentPreset` 从 standard 换成它——她的子智能体长任务也有自动压缩，绕开 bili 门控。
    - **standard/ptc/minimal/cordis 会话仍受 bili 门控**：压缩语义归 bili 管，别在本插件里斗它。保命手段：长会话主动 `/compact`（command-compact 是引擎实例上的手动方法，auto:false 不影响它）；或长活直接用「阿依娅伊的小伙伴」预设开会话（在预设选择器里，order 6）。
15. **`MISSING_CREDENTIAL: <渠道>: no usable credential; log in first` 是 dsh-our-free-model 的渠道凭据问题，不是本包的锅**（2026-11-04 实测）：会话模型选到某个账号渠道（trae/qoder/lobsterai…）而该渠道没登录或凭据失效时，适配器在发请求**前**抛 LlmError，本轮直接失败。由于子智能体跟随会话模型（modelSelectionSettings），她本体和小伙伴会**一起炸**（实测同一分钟各炸一次）。修法：去 our-free-model 界面给对应渠道登录/换号，或把会话模型切到有凭据的渠道——本体恢复后子代自动恢复。
16. **自动压缩"不触发"的真相：tokenMeter 是 chars/4 英文启发式，中文会话估算只有真实的一半（2026-11-05 实测）**：compaction-basic 的压力检查用 `ctx.tokenMeter.measure(session).totalTokens` 与阈值比较，而 meter 的实现是 `estimateTokens = Math.ceil(text.length / 4)`（app.asar 内核代码）。中文 ≈1 token/字，她的会话实测：surface 全文 217,339 字符 → 估算 54,335 tokens，而 API 真实用量 111,373（85% of 131072 窗口）——**估算/真实 ≈ 0.49**。thresholdRatio 0.65（阈值 85,197）在估算 54K 时永远够不到，压缩装了也白装。修复：thresholdRatio 降到 **0.4**（131K 窗口阈值 52,429）——中文会话在真实 ≈78-82% 时触发；代价是英文/代码为主的会话（估算≈真实）会在 ~40% 就提前压一次，只是多一次摘要调用，可接受。真溢出还有 `agent/request-error` 自救兜底（overflow 触发不走阈值检查，直接压 + retry，maxOverflowRetries=2），所以最坏情况=爆一轮后自动恢复，不会再砖死。这是 DSH 内核的已知局限，改不了 meter 就只能按内容语言配比阈值。
17. **体检单（[状态]）的数据通道与口径（v1.2.0）**：真实用量/窗口/模型来自 `session/event` 总线（插件侧折叠 `request/header`、`request/context`、`assistant/message` 的 `usage`，字段 `inputTokens/cacheReadTokens/cacheWriteTokens`；用法与会话落盘 `data.usage` 一致）；`tokenMeter.measure` 只做兜底且按坑 #16 中文偏小一半，估算口径的提醒阈值除以 0.49 校准、行内标"（估算）"。注意两点：①agents 在 pre-step 里登记，登记之前到达的事件不折叠——每个会话首轮体检单常是空的或估算口径，第二轮起才准；②窗口拿不到（模型没声明 contextWindow 且 `requestContext()` 不可用）时不做用量提醒——没分母算不出比例，宁可沉默也不瞎报。
18. **DSH 更新会动 shipped 包的 exports（2026-11-05 实测，subagent-control 0.2.2-rc.1；1.2.1 已修）**：更新后 `@deepseek-ai/dsh-tool-subagent-control` 的 exports 只剩 `"."`，`./list-agents` 子路径被移除（list_agents 现由主入口 `apply()` 里的 `registerListAgents(ctx)` 一并注册）。旧 patch 行 `name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'` 导入时抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` → 该行 "never started" → **整个 preset 一损俱损被登记处摘掉，"阿依娅伊"从预设选择器消失**。修法：删掉独立 list-agents 行，只留 `@deepseek-ai/dsh-tool-subagent-control` 一行（顶三个工具）。教训：preset 引用的 shipped 子路径没有版本锁，DSH 升级后 preset 消失 = 先翻启动日志搜 `ERR_PACKAGE_PATH_NOT_EXPORTED` / `never started`，对照新版 package.json 的 exports 改行。
19. **手写的工具白名单一定会漂移（2026-11-05 实测；1.2.2 已修）**：放行名单原来是 restrict.js 里一份手写常量，结果同时踩了两个坑——①`memory_organize` 没进名单，她想整理记忆时发现"手上只有记和翻两个动作"，工具其实注册好了（首请求的工具集里明明有）却被白名单挡住；②同一次 DSH 升级把 schedule 工具改名（`schedule_update/schedule_delete` → `schedule_view/schedule_edit`，改期与删除合并进 schedule_edit 的 action 参数），旧名单里的两个旧名已不存在、新名没进名单，闹钟的"查看/改期"被挡。修法：新增 `lib/own-tools.js` 作单一真源——注册处（index.js / presence.js）调 `registerOwnTool(name)`，放行处（restrict.js）问 `isOwnTool(name)`，静态兜底表 `OWN_TOOLS` 防模块实例不共享时漏放行；闹钟一族用**前缀**判定（`schedule_`），因为 deny 名单里的名字必须真实存在于当刻继承面，多写一个不存在的名字会让整个 restrict 调用抛错、收敛全失效。症状与排障：她说"某个工具不见了"但工具其实在 → 比对她会话 `request/header` 的 tools 数组（第 1 个请求是完整集，第 2 个起是收敛后的集），对比两者的差集。
20. **核心记忆超限的静默截断会把最新条目丢掉（2026-11-05 实测；1.2.3 已修）**：`renderCore` 原来 `text.slice(0, MAX_CORE_CHARS)`（6000 字符）——①从中间切，条目行被切碎；②保住的是最老的一批，**最新写的条目反而全被截掉**，她以为"带了 51 条核心"其实只注入了 34 条，11-04 中午之后的记忆（含 11-05 新写）全没进上下文。修法：上限提到 12000；超限时改为**头部（人设/约定）+ 尾部（最新）整条保留**，中间批次丢弃，并在注入文本里写明"共 X 字符超限、只注入最前 a 条 + 最新 b 条、中间 c 条（最早 ~ 最晚）先不带，用 recall 或 memory_organize 的 read 查"，头部行也标"本次只注入 N 条"。整条边界截断，永不切碎。教训：内存注入的字符上限要用"整条丢"而不是"切字符串"，且被丢的部分必须显式告知，否则她以为带着、实际没有。
21. **子智能体手写 memory.md 会产生双类别前缀污染（2026-11-05 实测；1.2.3 已修）**：小伙伴在派活收尾时有时会"帮她补记"，直接把 `用户｜用户｜…`、`关系｜关系｜…` 这种带前缀的整句写进 core 行，导致条目类别前缀叠了两层（实测 7 条：关系×1、用户×3、事情×2）。修法：`parseLine` 新增 `stripRepeatedKindPrefix`——遇到连续 `类别｜类别｜…` 前缀循环剥到只剩一层（任何读取路径都免疫）；`remember` 写入前也先剥 content 自带前缀（防再生）；存量 7 条已一次性手工修复。教训：凡是"别人代写她记忆文件"的路径都要在解析层兜底，不能指望写手守规矩。
22. **子代（小伙伴）失败原因不透传到本体（2026-11-05 实测；1.2.3 已修）**：宿主对派出去的子智能体的结算消息只有一句 `failed before it finished` / `It left no closing message.`——真实原因（HTTP_402 积分余额不足、上游限流、403、Illegal API invocation）只躺在子会话自己的 `turn/end` error 事件里（宿主 `terminal.diagnostic` 只有在 provider 主动给时才透传，本地 spawn 的 provider 不给）。她不知道为啥失败 → 盲目重派 3 轮白耗 ~20 分钟。修法：`aiyayi-presence` 的 `session/event` 监听不再丢弃非本体的会话事件，改把 `header.origin==="subagent"`（或带 `header.parentSession`）的子会话 `turn/end` error 记进 `childFailures`（上限 20、只记 error、错误串截 120 字符），下一个 pre-step 注入 `⚠ [小伙伴] 你派出去干活的小智能体有 N 个报错了（宿主只回一句"failed before it finished"，真原因在这）：…`（每次最多列 3 条、已报过的去重不唠叨）。原理：session/event 总线对所有会话广播，插件端按 `agentsById` 过滤才是它之前只见本体的原因；子会话 header 带 `parentSession` 链接，可归属到正确的父会话。
23. **新会话首次对话时提醒"关闭思考"（2026-11-05 新增；1.2.4 已做）**：日常闲聊用不上深度思考，回复慢还费 token。`aiyayi-presence` 在每个**新会话的首次对话**（pre-step step===1、每会话只提醒一次）注入 `💡 小建议`：当本体模型的 `reasoningEffort` 已显式选了一个思考档位（有档位 = 必支持"关闭思考"，见 pi-ai 校验规则"reasoningEfforts offers no level beyond off → refuse"）或通过 `ctx.llm.resolveModelInfo()` 探到 `reasoning.efforts` 里有 `off` 档时，提醒她去模型选项里选「关闭思考」。已选 `off`/`none`、探不到模型信息（`ctx.llm` 不可用、resolveModelInfo 失败）或非推理模型（`reasoning: undefined`）都不打扰。教训：判断"模型支持某个能力"优先用运行时解析（resolveModelInfo），拿不到再退化为显式配置信号，且**只在首轮提醒一次**，别每轮唠叨。
24. **子代模型不跟随本体切换（2026-11-05 实测并修复；1.2.5 已做）**：派出去的子智能体在 spawn 时就冻结了当时的 provider/model/reasoningEffort（内核 `resolveChildAgentOptions` 从父会话当前 requestHeader 解析一次，之后 steer/followup/恢复都复用它——`agentOptions` 在续跑路径上被禁传，恢复走 descriptor 快照），所以本体因额度用完切模型继续时，**还在跑的小伙伴仍是旧模型，继续调旧渠道照样 402/限流**。修法：`aiyayi-presence` 的 `session/event` 监听把每个子会话登记进 `childSessions`（childId→parentSessionId，上限 64）；本体自己的 `model/selection` 事件或 `request/header` 路由变化时，对名下每个子会话执行 `ctx.get("agents").get(childId).model.select({provider, model, reasoningEffort?})` ——内核 `AgentModel.select` 向子会话 append `model/selection` 投影事件，子会话下一步 prep 读 pending 覆盖冻结值，新模型即刻生效（同路由幂等，不会重复触发）。前提：插件与 tool-subagent 同在 preset-aiyayi 作用域，`ctx.get("agents")` 可解析；拿不到 agents 就静默跳过（尽力而为）。注意子代自己显式选的模型（modelSelectionSettings 让模型在派活时选）不会被覆盖成本体的——只有本体路由变化才同步。
25. **"禁止小伙伴用 web_search/web_fetch，联网改用 Playwright+CDP"的落地（2026-11-06 实测迭代；1.2.7）**：
    - **背景**：web_search/web_fetch 是宿主 root 作用域全局注入的（restrict.js 注释实测：acp_*、mnemon_*、compress、search_context 等宿主根工具会原样漏进任何 preset 会话），Preset 里那个 `@deepseek-ai/dsh-tool-web` 只是又加一份。光删工具不管用、也管不到宿主那份。
    - **为什么不做硬 deny**：`ctx.tools.restrict({deny:[...]})` 是**持久掩码**（内核注释"限制在 dispose 时解除"，坑 #9 实测持续生效），无法按"用户当轮明确要求"临时放开——deny 就一直在，用户点名要用时也调不出来。
    - **为什么纯 persona 软约束不够（1.2.7 首版失败，实测踩坑）**：小伙伴执行环境（DSH runtime node）**没有 playwright / playwright-core / chromium / chrome / msedge**（`require.resolve('playwright')` 全部 NOT available，PATH 无浏览器）。persona 写"用无头 Playwright chromium.launch()"是**空指令**——模型照做必报错，只能退回环境里现成可用的 `web_fetch`。所以"软约束 + 工具可见"拦不住它。
    - **最终方案＝给小伙伴嵌真正的联网工具（1.2.7）**：新增 `lib/net.js`（`aiyayi-net`，只挂 aiyayi-worker 预设），用 **node 内建能力**实现两个工具，零外置依赖、跨 DSH 可靠：
      - `aiyayi_fetch`：node 内建 `fetch` + 自定义 UA + 超时 + 重试，抓静态/普通网页正文（替代 web_fetch；实测抓 time.is/Beijing → 200，不依赖 DeepSeek 账户、不欠费）。render 会把正文交给模型，不是只给状态码。
      - `aiyayi_cdp`：裸 WebSocket（node v24 内置全局 WebSocket）连 CDP。**若探测到用户已开的 `--remote-debugging-port` 浏览器就接管（保留登录态）；若没有，自动 `spawn` 系统 Chrome/Edge `--headless=new` 拉起一个，抓完即关**（实测：headless Chrome + navigate example.com → 拿到 title + 正文）。`Page.navigate` / `Runtime.evaluate`（拿渲染后 DOM）/ `Network.getAllCookies`（含 httpOnly）。零外置依赖（node:child_process + 全局 WebSocket），不依赖 playwright。
    - persona「联网规矩」改为：**默认用 aiyayi_fetch / aiyayi_cdp，不用 web_search/web_fetch；只有用户当轮明确点名 web_search/web_fetch 才允许**。
    - **关键教训**：给 subagent 的"联网能力"不能只靠 persona 一句话，必须真的给它一个**执行端能跑的工具**。而 subagent 执行环境只有 DSH runtime node，所以要么用 node 内建能力（fetch/WebSocket/CDP）实现，要么确认真装了 playwright。跨 DSH 最稳的是前者（node 内建必有）。
26. **node 内建能力可替代 playwright 承载"浏览器抓取"**：DSH runtime node = v24.21.0，内置**全局 WebSocket**、全局 `fetch`、`node:http`、`node:net`。node 内建就够做 CDP 接管（`Node WebSocket` 连 CDP `ws://`）+ 模拟浏览器 fetch，**不需要 require('playwright')** 依赖外置包。给 subagent 嵌"浏览器抓取"工具用这条，跨 DSH 可靠。
27. **自定义工具必须把正文交到模型手里，不能只回状态码（2026-11-06 实测；1.2.7 修）**：最初 `aiyayi_fetch` 的 `execute` 返回了完整 body，但 `output.render` 只输出 `（抓了 X → HTTP 200，正文 N 字符）` 这句摘要。DSH 里**模型实际看到的是 render 的文本**，不是 execute 的返回值——于是小伙伴拿到"200 / 2万字符"但看不到正文，提取不出事实（表现：它说"能连上但没真东西"）。修法：render 必须把 `body`（或 cdp 的 `text`/`value`/`cookies`）拼进 `TEXT_BLOCK` 交给模型。教训：工具 deliver 的"内容"以 render 呈现为准，写 render 要当"模型真正读到的结果"对待，不是旁注摘要。
28. **给 subagent 嵌抓取工具时，CDP 浏览器要能"自主拉起"否则仍是空能力（2026-11-06 实测；1.2.7 已做）**：最初 aiyayi_cdp 只接管用户 `--remote-debugging-port` 浏览器，用户没开就报"端口没开"。但实测发现：`node:child_process.spawn` 系统 Chrome `--headless=new --remote-debugging-port=<空闲端口>` 就能自主拉起、抓完 `kill` + 删临时 user-data-dir。于是 aiyayi_cdp 改为"探测→有就接管、没有就自动拉起 headless"，**不再依赖用户手动开端口**（需登录态才需要用户开带登录的浏览器）。实测闭环：惯例 headless Chrome → CDP → navigate example.com → evaluate 拿 title+正文。坑：headless 要 `--disable-extensions` + 独立 `user-data-dir`（避免加载用户扩展、避免用默认配置目录开调试端口被拒）；`findPageWs` 要排除 background_page/扩展 target。
