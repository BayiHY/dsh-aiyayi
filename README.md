# 阿依娅伊（aiyayi）

一个装在 DSH 里的**对话伙伴 preset**：有独立人格、有自己长期的记忆、说话像人；她本人只负责聊天，动手的活全部派给子智能体（自建"小伙伴"全量预设，1.3.0 起还能往下派"检索员"），纯查资料的活直接派轻量的检索员（1.4.0 起检索员还能解析 Office/PDF 文档，小伙伴侧自动收到检索员的失败断因）。

> 文中「坑 #N」均指 [更新日志（CHANGELOG.md）](./CHANGELOG.md)「已知坑」清单的编号。

## 她是什么

| 能力 | 实现 | 说明 |
|---|---|---|
| 人格 | `@deepseek-ai/dsh-persona`（preset 作用域 prefix） | 完整人格文本写在 `bundle/cordis.patch.yml` 的 persona 行里 |
| 长期记忆 | 自写插件 `aiyayi-memory`（本包 `lib/index.js`），两层结构 | **核心记忆** `~\.dsh\aiyayi\memory.md`（她自规划的"每轮都想带着"的条目 + 她亲手维护的【记忆索引】目录），每轮自动注入 prompt；**分类档案** `~\.dsh\aiyayi\memories\` 分类树（最深三级，分类名她自己起），平时不注入、按需加载。工具：`remember`（core: true/false + 分类 path）/ `recall`（全库搜：核心+整棵树）/ `memory_organize`（tree 看家底 / read 读档案 / move 挪窝 / index 重写目录 / forget 删条目——整理是她自己的家务事）/ `memory_location`（只读：记忆存在哪、怎么定下来的、有无非系统盘可搬）/ `memory_relocate`（搬家或"留在原处"，见下节「记忆路径与迁移」）。已有 memory.md 的存量条目全部视作核心，由她自己逐渐搬理 |
| 记忆路径可迁移 | 自写插件 `aiyayi-home`（本包 `lib/home.js`，1.5.0 新增） | **唯一路径出口**：记忆路径不再散在各模块里硬拼。解析优先级 = `location.json` 指路文件 > 环境变量 `AIYAYI_HOME` > 默认 `~/.dsh/aiyayi`；整棵记忆（含 `presence.json`/`state.md`/`wishes.json`/`updates.json`/`memories/`）一起搬，不会半搬。搬迁顺序固定为 复制 → 逐文件校验（路径集合+字节+SHA256）→ 才写指路文件 → 源目录内容改名同级 `.old` 备份；**任何一步失败即中止且源目录不动**。指路根不可达时**硬失败**（记忆工具抛错、上下文每轮一条警告），绝不静默回退默认路径、绝不新建空目录顶替 |
| 跟随会话模型 | 无需插件行（1.0.1 起移除 agent-default-model 行） | 本体模型直接跟随用户会话模型；旧版"preset 作用域挂 `@deepseek-ai/dsh-agent-default-model` + `isolate: {agentDefaultModel: true}`"的写法在新版 DSH 过不了 schema 校验（见坑 #13），已删除 |
| 干活的子智能体 | `@deepseek-ai/dsh-tool-subagent`（delegation 组，isolate workflowEngine；两个实例 toolName 不同） | `subagent`→`aiyayi-worker`（自建"小伙伴"预设，全量工具 + 原生自动压缩，见坑 #14）；`retriever`→`aiyayi-retriever`（1.3.0 新增检索员：只读摘文件/Office/PDF 文档/网页内容、带路径/URL/页码交回，本体直接派）；子代模型跟随用户会话模型，如需钉死可在 `agentOptions` 配置 provider/model |
| 文档解析（检索员专属） | 自写插件 `aiyayi-doc`（本包 `lib/doc.js`，1.4.0，挂检索员 preset） | docx/xlsx/pptx 结构化提取（docx 按段落、xlsx 按工作表+单元格、pptx 按页，都带定位），pdf 渲染成页图（`read_image` 逐页看）；旧版 doc/xls 尽力转 txt/csv（无精确定位）；加密/损坏明确报错。**纯只读**：不改文件不落工作区，临时页图/转换产物写系统临时目录、读完即清（见坑 #32）。基于 shipped `@deepseek-ai/libreoffice-kit`（用法约束见坑 #30） |
| 检索员断因透传 | 自写插件 `aiyayi-presence-worker`（本包 `lib/presence-worker.js`，1.4.0，挂小伙伴 preset） | 坑 #22 的断因透传原本只覆盖本体→小伙伴一层；1.4.0 起小伙伴侧也挂监听：检索员（孙代）失败时，真实断因（error.message 优先）自动注入小伙伴下一步消息（`⚠ [检索员]` 开头），它能自己判断续派还是重派；同时把本体路由变化同步给名下检索员（模型跟随，同坑 #24 机制层层传导） |
| 工具白名单 | 自写插件 `aiyayi-restrict`（本包 `lib/restrict.js`，v3.1 pre-step 方案）+ `lib/own-tools.js` 单一真源 | 启动期零 restrict 调用；她每个会话第一步前，先用探针从校验器报错里解析出当刻继承面全集，再 `deny = 全集 − 她自己的工具`——宿主层漏进来的 acp_*/mnemon_*/compress/search_context/working_directory 等对她隐藏，且自动适应宿主工具增减。放行名单从 `own-tools.js` 读（注册处登记、放行处判定），新增工具只改一处，不再漂（见坑 #19）。**2026-11-02 实测生效**：新会话第 2 个请求起工具恰好 11 个，第 1 个请求仍带全套（见坑 #9） |
| 重逢感知 | 自写插件 `aiyayi-presence`（本包 `lib/presence.js`） | 每个回合第一步，往消息尾部追加一条 `[重逢]` 快照（time-context 同款 pre-step 注入范式）：他多久没来（presence.json）、你上次活动、你上次留的状态（state.md）、没说出口的话（wishes.json）。快照还带**版本自述**：`你当前插件版本：dsh-aiyayi x.y.z`（package.json 现读不写死，让她对自己版本有概念、不与 DSH 桌面版混淆；有新版时 updates 插件照旧单独提醒）。跨会话生效，`[SCHEDULE REMINDER` 唤醒消息不算"他来了"。工具 `update_state`（收尾留状态）/ `wish`（add/list/done 心愿单） |
| 自我状态（体检单） | 同上 `aiyayi-presence`（v1.2.0 起） | `session/event` 总线折叠真实运行数据：模型与思考档、上下文用量（provider 实测 usage 优先，tokenMeter 估算兜底并标"估算"）、缓存命中率、上轮输出 tok/s、本会话轮数、上轮异常。变化明显（≥2048 token / 模型切换 / 异常）才注入，不每轮白涨。用量过八成/九成（估算口径按中文偏差 ÷0.49 校准，见坑 #16）注入 `[上下文提醒]`：劝用户开新会话、并让用户走之前说一声好让她收尾（update_state/补记忆/把话说完）；每档只提醒一次 |
| 主动开口 | `tool-schedule`（dsh 原生）+ persona 指引 | 到期提醒会把冷会话真唤醒、以 user 消息落进定闹钟的那个会话——她想主动说话就 `schedule_create` 定闹钟；DSH 没开着会存着、下次启动补投 |
| 新版本提醒 | 自写插件 `aiyayi-updates`（本包 `lib/updates.js`） | 每个会话第一个回合查一次 npm（registry.npmjs.org，失败落 npmmirror；成功结果缓存 6h、失败 30min 后重试）：本地版本比 latest 旧时，往消息尾部追加 `[更新提示]` 快照，她会用自己的口吻顺口提一句。同一远端版本只提醒一次（updates.json 落盘去重，跨重启不重复念叨）；检查失败/离线一律静默。**判据：`~\\.dsh\\aiyayi\\updates.json` 不存在 = 从没发现过新版（本地已是最新）；她答不上"自己是什么版本"是设计边界（升级判断靠被动推送），已由 presence 的版本自述补上** |
| 飞书桥接 | 自写插件 `aiyayi-feishu`（本包 `lib/feishu.js`，1.5.8 起）+ 纯逻辑 `lib/feishu-logic.js` | 长连接 WebSocket 接入飞书机器人（SDK `@larksuiteoapi/node-sdk`，无需公网）。**2026-11-10 扫码改造**：新会话说「接入飞书」→ 引导出待接入目标 → 手机飞书扫码进 bot 单聊 → `bot_p2p_chat_entered_v1` 事件自动绑定（30 分钟时效）；凭证 `feishu/config.json` 存记忆根（**不入 npm 包**）。**发附件需权限 `im:resource`**（后台真实标识「获取与上传图片或文件资源」，免审）——开发者后台搜 **`im:resource:upload` 为 0 条，后台不存在这个独立 scope**，真名就是 `im:resource`（详见坑 #70 / #71） |
| 微信桥接 | 自写插件 `aiyayi-weixin`（本包 `lib/weixin.js` + `lib/weixin/`，1.5.27 起） | 微信 **ClawBot 机器人**通道（腾讯官方 iLink 协议，长轮询，无需公网）。**默认关闭**：profile patch 里 `weixin.enabled` 必须显式 `true` 才加载，`weixin.accounts` 写 `[{accountId, credentialRef}]`，凭证先 `weixin_login` 扫码拿（二维码 121 秒寿命）。工具 `weixin_status` / `weixin_login` / `weixin_bind` / `weixin_unbind`。`allowlist` 留空 = **只放行已显式绑定的用户**（与官方相反，陌生消息丢弃）。**没有 weixin-setup 技能** |
| **对接落到哪个会话（默认规则，1.5.32 固化 + 1.5.33 三档落地）** | `lib/feishu.js` 的 `pending-bind` + `lib/feishu-logic.js` 的 `decideUnboundChatRouting()` + `lib/weixin/accounts.js` 的 pending-bind | **对机器人默认落到「发起对接的那个会话」，能复用就复用、不新建**：会话 A 里说「接入飞书/微信」→ 待接入目标记的就是 A → 扫码/绑定成功后该 chat 绑回 A，聊天接着聊。只有用户明确说「新建会话」才新建；chat 从没走过对接、也没有待接入目标时程序会新建一个会话接住（**兜底，非首选**）。**1.5.33 起**一个从没绑过的 chat 发来第一条消息时按三档自动处理：① 恰好 1 个活跃真人会话 → 直接接过去并告知；② 多个活跃 → 不绑不建，回编号列表（`1. 会话名（工作区：xxx）`）让用户选，**不替他挑"最近那个"**（会话各带上下文，投错比多问一句糟糕）；③ 0 个 → 才新建并明说。开关 `feishu.reuseActiveSession` 默认 `true`，设 `false` 回退 1.5.32 旧行为（一律新建）。这条同时写进 persona【飞书】【微信】两段，属行为约定而非可选配置 |
| 其他 | time-context、compaction 组（提前压缩，见坑 #14/#16）、tool-ask-user | 她没有 bash/文件/技能/搜索/网络工具，想动手只能派活；纯查资料走 `retriever` 检索员，不惊动小伙伴 |

## 安装与启用

前提：已安装 DeepSeek Harness（DSH），Node.js >= 18。

- **安装（指定精确版本）**：在 DSH 的 profile 目录（如 `~\.dsh\profiles\desktop\`）执行 `pnpm add dsh-aiyayi@<精确版本>`，装到 `profiles\<name>\node_modules\dsh-aiyayi`。
- **便捷方式**：`dsh plugin add dsh-aiyayi`。npm 包主页：<https://www.npmjs.com/package/dsh-aiyayi>。
- **启用**：GUI 新建会话 → agent preset 选「**阿依娅伊**」（详见下节「使用」）。
- **生效提示**：升级或改动包内文件后要**重启 DSH** 才生效（patchReload 不拾取 bundle 内变化，见坑 #13、坑 #37）；她有活跃会话时 remove/install 会报 restart-required，先关会话或直接重启（坑 #8）；搬迁记忆后同理要重启（见「记忆路径与迁移」）。
- 安装 bundle 会执行宿主侧代码，DSH 会要求 Full access 或批准。

## 使用

GUI 新建会话 → agent preset 选「**阿依娅伊**」。聊天即可；她说"我让人去弄"就是在派子智能体（干活的叫小伙伴，查资料/读文档的叫检索员），进展和结果她会转述。

## 调整

- **改人格**：编辑 `cordis.patch.yml`（包根）的 persona `prefix` → `plugin_manager` remove+install 重装生效（ESM 模块缓存，patchReload 不刷新插件 JS；实测它也不拾取包内 yml 变化，改完要重启 DSH）。
- **改记忆**：直接编辑 `memory.md`，或对话里直接跟她说"记一下…"。
- **子代模型/思考**：默认跟随用户会话模型；如需钉死，在 delegation 组 `tool-subagent`（本体和小伙伴的 delegation 组各有一个）的 `agentOptions` 配置 provider/model。本体切模型会自动层层传导：本体→小伙伴（`aiyayi-presence`，坑 #24）、小伙伴→检索员（`aiyayi-presence-worker`，1.4.0）。
- **本体思考**：本体模型跟随用户会话模型，preset 自 1.0.1 起不再内置 agent-default-model 行（原因见坑 #13），`reasoningEffort` 由会话模型选择器控制；「关闭思考」在讯飞上游不生效见坑 #10。

## 架构：本体 → 小伙伴 → 检索员

三层委派，层级到检索员封顶（检索员是叶子节点，不挂委派组）：

- **本体**（preset-aiyayi）：人格、两层长期记忆、重逢感知、体检单、闹钟；挂两个委派工具——`subagent`（→小伙伴）与 `retriever`（→检索员，纯查资料直派、不惊动小伙伴）。
- **小伙伴**（`aiyayi-worker` 预设，蓝本 standard）：全量工具 + 原生自动压缩；1.3.0 起可再往下派检索员（派生工具显式 `maxDepth: 2`，见坑 #29）。
- **检索员**（`aiyayi-retriever` 预设）：只读叶子，摘文件/Office/PDF/网页、带路径/页码交回；文档解析走 `aiyayi-doc`。
- **模型跟随**：子代 spawn 时跟随用户会话模型；本体切模型经 `aiyayi-presence` / `aiyayi-presence-worker` 层层传导到小伙伴与检索员。
- **断因透传**：子代失败时真实断因注入上级下一步消息（`⚠ [小伙伴]` / `⚠ [检索员]`），上级自己判断续接还是重派。
- **续接（continuable）**：本体、小伙伴、检索员都是 continuable——DSH 重启后 `send_message` 一条消息即可冷唤醒续接；续接前 `list_agents` 现查 ID，别凭记忆敲（详见[更新日志](./CHANGELOG.md) 1.4.4 条目）。

## 文件

npm 包为平铺结构（仓库若保留 bundle/ 子目录，发布时把其内容提到包根即可）：

- `package.json` — bundle 清单（`dsh.bundle.patch` 指向 cordis.patch.yml，exports 含 `./restrict` / `./presence` / `./doc` / `./presence-worker` 子路径）
- `cordis.patch.yml` — preset-aiyayi / preset-aiyayi-worker / preset-aiyayi-retriever 三 preset 声明 + 人格 + 全部插件配置
- `lib/index.js` — aiyayi-memory 记忆插件（node:fs/os/path，零依赖）
- `lib/home.js` — aiyayi-home 记忆根目录解析与迁移插件（1.5.0 新增；零依赖，纯路径 + 文件操作，是**唯一**拼记忆路径的地方）
- `lib/restrict.js` — aiyayi-restrict 工具白名单插件（零依赖）
- `lib/presence.js` — aiyayi-presence 重逢感知插件（node:fs/os/path/crypto，零依赖；1.4.0 起导出 `createWorkerApply` 供小伙伴侧复用子代账本）
- `lib/presence-worker.js` — aiyayi-presence-worker 检索员断因透传插件（1.4.0，挂小伙伴 preset，薄壳调 `presence.js` 的 `createWorkerApply`）
- `lib/updates.js` — aiyayi-updates 新版本提醒插件（node:fs/os/path/crypto/url + 全局 fetch，零依赖）
- `lib/net.js` — aiyayi-net 联网工具（aiyayi_fetch + aiyayi_cdp，node 内建能力实现，零外置依赖，挂小伙伴与检索员 preset）
- `lib/doc.js` — aiyayi-doc 文档解析插件（1.4.0，挂检索员 preset；ZIP/XML 最小解析零依赖 + 动态加载 shipped libreoffice-kit 做 pdf 页图与旧版转换）
- `lib/own-tools.js` — 她的工具名单单一真源（注册处登记、放行处判定，防手写白名单漂移）
- `lib/feishu.js` — aiyayi-feishu 飞书桥接宿主插件（1.5.8 起；跨会话服务，长连接收消息、按指令路由到 aiyayi 会话、回发；凭读取记忆根 `feishu/config.json`）
- `lib/feishu-logic.js` — 飞书纯逻辑（路由/映射/文本抽取/三档复用决策，无外部依赖，可单测；test/feishu-route.test.mjs、test/feishu-reuse-session.test.mjs 覆盖）
- `skills/feishu-setup/` — 内置技能（1.5.13 起随包自动同步到 DSH 技能根）：飞书机器人安装/验证/排障全流程（含 2026-11-10 扫码接入改造说明；脚本 `scripts/create-bot.js` v5 等由技能同步维护）
- `README.md` — 本文档
- `icon.svg` — 头像
- `~\.dsh\aiyayi\memory.md` — 她的**核心记忆**（条目行 `- [时间] 类别｜内容` + 末尾 `<!-- 索引 -->…<!-- /索引 -->` 目录段），可直接编辑，删掉文件她会自动重建
- `~\.dsh\aiyayi\memories\` — 她的**分类档案树**（最深三级，如 `memories\用户\口味.md`），remember 的非核心条目归这里，recall 全库搜、memory_organize 的 read/move/forget 按路径操作
- `~\.dsh\aiyayi\presence.json` — 他上次来 / 你上次活动（时间戳，插件自动维护）
- `~\.dsh\aiyayi\state.md` — 她给自己留的"上次活到哪"状态（update_state 覆写）
- `~\.dsh\aiyayi\wishes.json` — 她的心愿单（[{id, at, content, done}]，wish 工具读写）
- `~\.dsh\aiyayi\updates.json` — 已提醒过的 npm 版本号（updates 插件去重用，可删除以重置提醒）
- `~\.dsh\aiyayi\location.json` — **指路文件**（1.5.0）：记忆根搬过家或"决定留在原处"时才有。有它时插件一律按它指的路径读写记忆；删掉它立刻回到默认路径（但**别在搬完家之后删**，那会把记忆"遗忘"在新盘上，红线见 [记忆迁移完整说明](./MEMORY-MIGRATION.md)）

## 记忆路径与迁移

记忆根的决定优先级：`location.json` 指路文件 > 环境变量 `AIYAYI_HOME` > 内置默认 `~\.dsh\aiyayi`。

- `memory_location`：只读，查记忆当前位置与来源；`memory_relocate`：搬家或决定"留在原处"。
- 搬家两步走：先 `dryRun` 预演（不碰磁盘），再 `confirm: true` 真搬。
- 回退：删掉 `location.json` 即回到默认路径；每次重启 DSH 后，确认记忆仍在新路径。

完整说明（搬迁顺序、回滚、红线、回归测试）：[记忆迁移完整说明](./MEMORY-MIGRATION.md)。

## 已知限制与飞书权限

- **发附件/图片需要 `im:resource` scope**：飞书开发者后台给应用开通 **`im:resource`**（后台真实标识「获取与上传图片或文件资源」，免审），
  然后**重新发布版本**才生效；未开通时上传接口回 `400 code=99991672`（坑 #70）。
  **权限真名只有一个，就是 `im:resource`**——后台**不存在 `im:resource:upload` 这个独立 scope**（后台搜索 0 条），
  别照着 API 路径 `POST /im/v1/files` 或动作名 "upload" 去拼 scope 名（坑 #71）。
  收件（下载）用的读权限与发件的上传权限是两回事，收件链路不受这条影响。
- **配置权限用内置技能脚本**：`skills/feishu-setup/scripts/create-bot.js` v6 提供 `configure` 子命令
  （给已有应用补权限/事件/回调，不动版本、不发布）、`publish` 子命令（对外动作，必须显式 `--yes`）和 `--dry-run`（只演练不发写请求）。
  脚本用 `SCOPE_ALIASES` 把旧写法 `im:resource:upload` 自动归一化成 `im:resource` 并打 WARN；
  每次运行日志落在脚本同目录 `logs/create-bot-YYYYMMDD-HHmmss.log`。
- **回发正文默认走飞书卡片**：正文用 `interactive` 卡片 + `lark_md` 渲染（1.5.20 起），
  设环境变量 `AIYAYI_FEISHU_MARKDOWN=text` 可一键回退纯文本。
- **正文首尾空白行已修**：飞书回复正文上下多出空行（无附件标记路径）的缺陷**已在 1.5.21 修**（坑 #72）——
  主修 `extractText(message).trim()` + 兜底 `stripAttachmentMarkers(text).trim()`。
  **只修首尾**；正文中**中间**的多余空行保持原样（那是另一个需求，尚未做）。
- **CHANGELOG 里 1.5.18 / 1.5.19 从未发布到 npm**：它们的代码最终随 **1.5.20** 一起进 npm（npm latest = 1.5.20）。

## 更新日志

[更新日志](./CHANGELOG.md) —— 版本条目（新 → 旧）、npm 发布状态与完整踩坑记录（坑 #1–#72）。版本事实以 npm registry 为准，正文不再逐版本罗列。

## 署名与许可

- 作者与维护：**巴依浩爷（bayihy）**
- 实现：阿依娅伊（aiyayi，DSH 智能体）
- 仓库：[GitCode](https://gitcode.com/BayiHY/dsh-aiyayi) · [Gitee](https://gitee.com/BayiHY/dsh-aiyayi) · [GitHub](https://github.com/BayiHY/dsh-aiyayi)
- 许可：MIT（[LICENSE](./LICENSE)）
