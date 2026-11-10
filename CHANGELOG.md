# 更新日志

> **维护约定**：新版本发布时在顶部加条目。本文件由 README 正文拆出（2026-11-09 重构）：版本条目与踩坑记录原文照录，数字、时间、日期一律不改（量化保真是本插件的规矩）。版本事实以 npm registry 为准。
>
> **npm 发布一览（2026-11-10 核对 registry）**：latest = **1.5.15**（2026-11-10 发布）。已发布：1.0.0、…、1.5.7、**1.5.14**、**1.5.15**；跳号 1.3.0、1.4.1、1.4.2、1.5.0、1.5.1、1.5.2、1.5.3、**1.5.8–1.5.13** 从未发布到 npm（本地开发线：1.5.8–1.5.11 飞书桥接、1.5.12 思考纪律约束、1.5.13 内置技能同步+feishu-setup 骨架）；1.5.14 已发布（坑 #58–#67 修复）；1.5.15 已发布（扫码接入改造）。
>
> **环境标识约定（2026-11-10 新增）**：写版本条目/坑条目时，**顺手记录当时的 智能体工具-智能体模式-模型供应商-模型**（如 **DSH-创造模式-loomy讯飞-GLM5.3FLASH**），写在条目内（紧跟 git 记录行、或坑条目首行），方便回溯该条目是在哪套智能体/模型环境下产出与验证的。

---

## 1.5.16（2026-11-10 发版：feishu-setup 技能脚本入包）

- 环境：DSH-创造模式-DeepSeek Harness 执行智能体（娅伊派出，模型名未确证）
- git：本次 commit（2026-11-10，阿依娅伊）1.5.16：feishu-setup 技能脚本补进包内 `skills/feishu-setup/scripts/`（create-bot.js v5 扫码前置 + save-secret.js + get-csrf.js + get-cookies.js）+ 版本号 1.5.16
- 发版：李浩指示把技能脚本补完整再发一版；package.json `files` 含 `"skills"` 整目录通配，脚本放进仓库即自动入包。npm pack 预演核对 scripts/ 4 文件齐全、无 .bak / credential / 密钥文件；敏感扫描通过（无硬编码 token/appSecret/密码/cookie，会话均运行时从 CDP 取；create-bot.js 默认 member open_id 属应用维度公开标识、非凭证，与 SKILL.md 已有 cli_ appId 先例同级，保留并注明）
- 说明：1.5.15 条目曾记「create-bot.js v5 本体不入 npm 包」，本版按李浩指示改为入包；本地 `~/.dsh/skills/feishu-setup/scripts/` 与包内脚本同源（SHA256 一致），`syncBundledSkills` 覆盖无害

---

## 1.5.15（2026-11-10 发版：扫码接入改造落地）

- 环境：DSH-创造模式-DeepSeek Harness 执行智能体（娅伊派出，模型名未确证）
- git：本次 commit（2026-11-10，阿依娅伊）d61c09d：新会话扫码接入飞书改造（引导注入 turn/end followup、`bot_p2p_chat_entered_v1` 自动绑定、零宽前缀防自触发循环）+ 技能层 create-bot.js v5 扫码前置（`--login-wait <秒>`）+ SKILL.md 三副本同步
- 发版：README 补飞书桥接与扫码接入说明（能力表、文件清单、坑号修正 #1–#55→#1–#67）；`lib/feishu.js`、`lib/feishu-logic.js`、`skills/feishu-setup/SKILL.md` 随包发布（npm pack 32 文件核对，无 .bak / credential / config.json / requests-raw.jsonl / work 产物）
- 说明：create-bot.js v5 本体在技能同步目录（`~/.dsh/skills/feishu-setup/scripts/`），不入 npm 包——presence `syncBundledSkills` 判据 SKILL.md 一致即跳过、`copyTree` 只复制不删除，npm 升级不会动本地脚本

---

## 1.5.14（2026-11-10 修复）

- 环境：DSH-创造模式-DeepSeek Harness 执行智能体（娅伊派出，模型名未确证）
- git：本次 commit（2026-11-10，阿依娅伊）1.5.14：修复 feishu 插件收消息静默蒸发（坑 #58）+ 建会话链路两连坑（#59 建目录 / #60 preset 按名 set）+ 投递/回发/生命周期连环坑（#61–#67）
- 坑 #58（2026-11-10 实锤）：`@larksuiteoapi/node-sdk` 1.76.0 的 `createLarkChannel(opts)` 构造函数不读 `opts.handlers`（SDK lib/index.js:106879 只设 `this.handlers={}`，107359 原样 `new` 返回），传入的 `handlers.message` 被整个丢弃——每条入站消息在派发处（106902-106912 `const handler = this.handlers.message; if (handler) yield handler(merged)`）静默 no-op、零日志，帧泵（102959）照常回 ACK 200，飞书后台事件日志显示 SUCCESS。插件自 1.5.11 部署以来从未收到过任何一条消息（totalBound 恒 0，「之前工作正常」系误传：成功的是经典接线测试脚本 bot.mjs，不是插件）。修法：`createLarkChannel` 返回后显式补接线 `channel.handlers.message = onMessage`（lib/feishu.js；handlers.message 派发时才读取，事后赋值有效）。教训：升级 SDK 或启用新包装 API 要回归测试收消息。
- 坑 #59/#60（2026-11-10 实锤，坑 #58 修复后由真实消息连环暴露）：#59——`ctx.workspaceRegistry.create(path)` 契约是**路径必须已存在**（内部 realpath 不代建；dsh-webhook 的 workspacePath 来自规则配置的既有目录），插件只建了 `feishu\workspaces` 父目录、叶子 `feishu-<uuid>` 没建就 create → `处理入站消息失败: ENOENT … realpath '…\feishu-<uuid>'`；修法：先 `mkdirSync(workspacePath,{recursive:true})` 再 create。#60——`permissionPresets.resolve(名字)` 返回**已解析对象**而 `permissionPresets.set(session, x)` 要**名字字符串**（webhook 模板 resolve 仅校验、返回值丢弃），把返回对象传给 set → `permission: unknown preset "[object Object]"`；修法：set 传名字字符串。教训：照宿主模板接线要逐调用点核对参数语义，修复路径上每个 warn 都是下一层的路标。
- 坑 #61/#62/#63（2026-11-10 实锤，「已新建并接入」能收到后的静默断点）：#61——`ctx.agents.get(id)` 返回**裸 Agent**（宿主 asar 文档 375429 行「句柄只暴露给创建它的消费方」），写 `get(id)?.agent` 恒 undefined → deliverToSession 静默丢消息零日志；修 getAgent 返回裸 Agent。#62——宿主 assistant/message 事件载荷在 **`event.data.message`**（宿主消费者 asar 59377/301690 行读 `event.data.message.content`），读 `event.message` 恒 undefined → 回复发不出；修为读 event.data.message。#63——一轮 turn 里 assistant/message 按 step 渐进追加，逐条回发会刷屏 → pendingReplies Map 攒每会话最新文本、`turn/end` 统一回发一条（`turn/start` 兜底冲残留）。教训：端到端验证每种代码路径各一条真实消息；静默 return 零日志只能对照宿主模板核对。
- 坑 #64（2026-11-10 实锤，HMR 重载后 route 分支静默蒸发）：插件 dispose 时 `controller.abort()`，而建会话时把 `controller.signal` 传给了 `agents.create` → **每次插件重载都会把插件建的会话连带杀死**（12:58:42 日志 `agent "feishu-bfb53970-…": agent/disposed listener threw: TypeError: Cannot read properties of undefined (reading 'catch')` 即死亡现场），之后 route 分支 getAgent 拿到 null 静默 return、消息蒸发零日志。修法：①会话是宿主资产不是插件资产——每会话独立从不 abort 的 signal；②deliverToSession 返回布尔，route 投递失败自动新建+重新映射+告知用户（自愈）；③防御 `Promise.resolve(channel.disconnect()).catch()`（SDK disconnect 在 WS 未初始化时返回 undefined）。教训：宿主对象生命周期归宿主管，插件清理别越界连坐。
- 坑 #65（2026-11-10 实锤，13:08:54/13:09:03 两条消息的实际报错）：投递的 source 里写了 `senderId: undefined`。宿主 `Session.append` 用 `snapshotJsonValue`→`walkJsonValue` 深拷贝事件数据，**遇到 undefined 直接返回 undefined**，于是抛 `session event "agent/inbox/spliced" carries non-JSON-serializable data`（asar 1976372-1976373；walkJsonValue 对非 null/boolean/string/number/object 一律判失败）。修法：source 只用 `{ kind: 'user' }`（MessageSourceMap 里最简单的合法取值，宿主自建用户消息同款，asar 18310265），**事件数据里绝不放 undefined 字段**。可本地复刻 walkJsonValue 语义做判据，不必等真消息。
- 坑 #66（2026-11-10）：机器人自己发出的消息也会以 `im.message.receive_v1` 推回来并进同一个 handler，不过滤会把「已新建并接入…」和正式回答当用户输入再喂一轮（自问自答刷屏）。修法：用 `channel.botIdentity.openId`（connect 时 fetchBotIdentity 填充）比对 `mergedEvent.senderId` 跳过。
- 坑 #67（2026-11-10，症状=「只收到已接入模板回复、始终没有正文」）：宿主 webhook 模板在 `model === undefined` 时会取 `ctx.agentDefaultModel.currentSelection()` 作为 agentOptions（asar 2187436-2187439）；插件原来传 `agentOptions: {}`，agent 可能没有可用模型 → 会话能建、模板回复能发，但永远产不出正式回答。修法：`inject` 加 `agentDefaultModel`，建会话时取 `ctx.agentDefaultModel.currentSelection()`。
- 排障判据沉淀（同步 feishu-setup 技能）：控制台事件日志接口 `POST /api/tools/developer/open_event_log_contents/{app_id}`（SUCCESS=送达且 ACK / FAIL=无客户端或未投递，毫秒时间戳字符串）；长连接在线核验 `POST /developers/v1/app/check_online` body `{"clientID"}` → code=0（接口清单.md 原记「验证无接口」有误，已证伪回填）。事件订阅未配好时用户照样能把消息发进会话（服务端入库、仅不推送），旧记载「用户侧发不出消息/搜不到机器人」已证伪。
- SKILL.md frontmatter 两条 YAML 坑（2026-11-10）：description 未加引号标量含 `insert: `（冒号+空格 → Nested mappings 解析错）、含 ` #`（空格+井号 → 行内注释截断），都会让技能被静默 ignored——frontmatter 长文案一律单引号包裹。
- 工具坑：pwsh 5.1 `Get-Content -Raw` 不带 `-Encoding` 按 ANSI 读 UTF-8 中文 → mojibake 写回损坏 JSON（本次 package.json 中招，git checkout 恢复后改用 node `JSON.parse`+`writeFileSync utf8` 升版本）。
- 经验文档：docs\经验-飞书bot收不到消息三层分诊.md（三层分诊法 + 两次误判反转全程）。

---

## 1.5.13（2026-11-10 功能）

- 环境：DSH-创造模式-loomy讯飞-GLM5.3FLASH
- git：本次 commit（2026-11-10，阿依娅伊）1.5.13：内置技能同步机制 + feishu-setup 技能骨架
- 功能：dsh-aiyayi 自带 `skills/` 目录（当前仅 feishu-setup），presence 在 apply/workerApply 时把包内技能同步到 DSH 技能根（`$DSH_HOME` 或 `~/.dsh` 下 `skills/`；判据=目标 SKILL.md 存在且内容一致则跳过，缺失/不一致才整目录覆盖），其他用户从 npm 装包后技能自动就位，无需手工拷贝。同步失败静默，不影响会话。
- 坑 #57（2026-11-10 实测）：Node 22 / Windows 上 `fs.cpSync(src, dst, {recursive:true})` 复制**源目录路径含非 ASCII 字符**（本包路径"阿依娅依"正好踩中）时进程原生崩溃（exit -1073740791 / 0xC0000409 fail-fast，无 JS 异常可捕）；而 `readdirSync`/`copyFileSync`/单文件 `cpSync`/`statSync` 对同样路径全部正常。修法：`copyTree()` 手写递归复制（mkdirSync+readdirSync+statSync+copyFileSync）。
- feishu-setup 技能（骨架）：只含**本机已实测**的安装/验证/排障步骤——三件套（patch `insert:` 声明 / profile 装 `@larksuiteoapi/node-sdk` / 记忆根 `feishu/config.json` 无 BOM 凭证）、HMR 触发方式、以日志「已就绪」判定生效、排障速查表（not-found 裸行坑 #56 / ERR_PACKAGE_PATH_NOT_EXPORTED 安装版被回退 / BOM SyntaxError / 后台订阅未配）。**CDP 自主创建飞书机器人部分留白待固化**——等初版对接验证后由娅伊自主创建一次跑通，沉淀实测经验再回填技能。
- persona：本体【飞书】段补一句——新配/重配/修复飞书对接按 feishu-setup 技能执行，本体派人给小伙伴照技能装；技能没覆盖的如实说明，别现编步骤。

---

## 1.5.12（2026-11-10 约束）

- 环境：DSH-创造模式-loomy讯飞-GLM5.3FLASH
- git：本次 commit（2026-11-10，阿依娅伊）1.5.12：persona 新增【思考纪律】约束（本体/小伙伴/检索员三预设）
- 背景：用户要求给 aiyayi 和她的小伙伴们也加思考约束——无法关闭自考模式时，尽量用实际文件和已获取的上下文决策；证据不足宁可抛出问题也不埋头瞎想、跟自己左右互博；不要反复纠结，遇到歧义和冲突以上下文中有明确来源的内容为准；可以猜，但突出信息时必须明确说明哪部分是猜的，不要反复推翻自己的直觉猜测。
- 改动（均在 `cordis.patch.yml` persona，纯文案，零代码）：
  - preset-aiyayi（本体）与 preset-aiyayi-worker（小伙伴）：各新增【思考纪律】段——够用就决策动手不空转；缺资料先查实际文件/已有上下文；证据不足宁可抛问题；歧义冲突以**有明确来源**的内容为准；可以猜但关键信息必须标注哪部分是猜的、依据是什么；猜完按验证修正，不反复横跳。小伙伴版额外点明"已获取的上下文含检索员带回的摘录"，并把开场句"放开用"补成"放开用≠空转"。
  - preset-aiyayi-retriever（检索员）：在"真找不到就明说找不到"后补两句——拿不准的判断按最合理的理解做，但交回时标明哪条是推断、哪条是原文；别为一条拿不准的摘录反复推翻重来，上下文和简报里有明确来源的信息优先。
  - 补充（用户追加）：思维链还有新料可拉（能读到新文件、新工具结果、新上下文）就继续想；一旦思考内容大量重复、原地绕圈，就立刻停止思考——按手头最好的判断行动/动手，或把卡点如实抛出来（本体与小伙伴的【思考纪律】段均含）。
- 生效：persona 随 agent preset 挂载，**新会话生效**（已运行会话沿用旧人格直至重启/新会话）。部署到 profile 安装版后经 HMR 重载 bundle patch。

---

## 1.5.11（2026-11-09 修正引导）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.11：飞书接入引导改为「从飞书侧自动发起」，不再让用户提供 chat_id
- 修正：此前 persona 与工具描述引导 aiyayi「让用户提供 chat_id 再 feishu_bind」，方向走反。事实上接入主要从飞书侧自动发起——用户在飞书里给机器人随便发一条消息，bot 自己取到该 chat 的 chat_id、自动新建 aiyayi 会话并绑定（`routeMessage` 默认分支 `action:'new'`）；要接入指定已有会话就在飞书里发 `绑定会话 <会话名>`，chat_id 同样自动已知。
- 改动：`cordis.patch.yml` persona【飞书】段重写为「不让用户填 chat_id，引导去飞书发消息自动接入 / 发 `绑定会话 <会话名>` 接指定会话」；`lib/feishu.js` 中 `feishu_status` / `feishu_bind` 的工具 description 同步说明「大多数接入从飞书侧自动发起，用户无需提供 chat_id，feishu_bind 仅在确有明确 chat_id 时才用」。

---

## 1.5.10（2026-11-09 修复）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.10：修复 feishu_status / feishu_bind 工具报错 `content.some is not a function`
- 修复：工具 `output.render` 之前返回**字符串**（`'feishu_status 已执行'`），宿主 dsh-tools `createSuccessResult` 把它直接当作 tool-result 消息的 `content`，而下游 `contentHasImage` / `contentHasFile`（dsh-llm）对 content 调 `.some(...)`，字符串没有 `.some` 就报 `content.some is not a function`。改为返回 content **数组**：`render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]`，两个工具都改，顺带把真实返回值写进 text 供模型读取。

---

## 1.5.9（2026-11-09 功能）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.9：aiyayi 新增 feishu_status / feishu_bind 工具 + persona 飞书自查指引
- 功能：给 aiyayi 加两个可主动调用的飞书工具（宿主插件 aiyayi-feishu 注册，`registerOwnTool` 登记进 restrict 放行名单）：
  - `feishu_status`：查当前会话/其它会话的飞书绑定情况（本会话 boundChat、其它绑定 otherBound、长连接是否运行 connected/configured）。新建会话首次对话自查用。
  - `feishu_bind`：把当前会话绑定到指定飞书 chat（传 chatId，oc_ 开头），写进 `feishu/mappings.json`，之后该飞书对话路由到本会话、回复发回该 chat。
  - 工具 `execute(args, exec)` 用 `exec.agent.session.id` 取调用方会话（dsh-tools 机制已核实）。relay 回发改为每事件重读映射，避免 feishu_bind 新增绑定后漏发。
- persona：新增【飞书】指引段——新建会话第一次开口先调 feishu_status 自查对接情况，没绑定且要收飞书的话就 feishu_bind 绑定，别装作已对接。
- 依赖：`@larksuiteoapi/node-sdk`（profile 依赖，长连接用）。

---

## 1.5.8（2026-11-09 功能）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.8：新增 aiyayi-feishu 宿主插件——aiyayi 会话接入飞书机器人
- 功能：新增宿主级服务插件 `aiyayi-feishu`（lib/feishu.js，宿主插件，不塞进任何 agent preset；跨会话桥接服务）。用飞书官方 SDK `@larksuiteoapi/node-sdk` 的 `createLarkChannel` 建立**长连接 WebSocket**（无需公网），订阅 `im.message.receive_v1`。
  - 收：飞书对话里的消息按**自然语言指令**决定绑到哪个 aiyayi 会话——`绑定会话 <id>` / `接入` / `切换到会话 <id>` 指定已有会话；`新建会话 <名称>` / 无映射普通正文默认新建——新建走 `agents.create`（复用 dsh-webhook 的建会话模板：workspaceRegistry.create → mount aiyayi preset → permissionPresets.set(workspace-write) → sessionTitle.rename）。映射持久化到 aiyayi 记忆根 `feishu/mappings.json`（chat_id→sessionId）。
  - 发：消息经 `agent.followup(createUserMessage(...))` 投进会话（与 dsh-webhook 同通道，source.kind='feishu'）；回发监听 host 级 `session/event` 总线（已确认 host ctx 能收到所有会话事件）的 `assistant/message`，取最终文本用 `channel.sender.send(chatId, {text})` 发回对应 chat。
- 配置：App ID/Secret 放 aiyayi 记忆根 `feishu/config.json`（不入 git）或 patch config；缺省 `domain=https://open.feishu.cn`、`defaultPermissionPreset=workspace-write`。纯逻辑（路由/映射/文本抽取）在 lib/feishu-logic.js（无外部依赖，可单测）。
- 测试：新增 test/feishu-route.test.mjs（extractText / routeMessage 绑定·新建·route·默认新建 / mergeConfig / 配置与映射读写往返），node 运行 ALL PASS。

---

## 1.5.7（2026-11-09 修复；本地开发版，未发布 npm——npm 的 1.5.7 是下方官方发布条目，两者内容无关；本条改动随 1.5.8 起的本地版本进 npm）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.7：主会话切模型后唤醒子智能体不再沿用旧模型
- 修复：`aiyayi-presence-worker`（挂 preset-aiyayi-worker，即"小伙伴"）新增 `agent/inbox/inserted` 监听 `syncModelWithParentOnWake`——子智能体被唤醒（冷唤醒 coldResume）时，趁唤醒消息插入（早于 wakeDriver→preStep），读父会话当前模型（`agent.session.header.parentSession` → agents 注册表 → `parentAgent.model.current()`），与本子代当前模型比对；路由不同则 `agent.model.select(父模型)`，把 `model/selection` 事件写进子会话日志，wake 首步 pre-step 的 `model.current()` 即用新模型。
- 根因：宿主 `coldResume` 只从 durable descriptor 读 spawn 时冻结的旧 provider/model 重建子代；本体切模型后若子代不在 agents 注册表（DSH 重启 / 激活释放 / 已 dispose），`propagateModelToChildren` 因拿不到 agent 静默跳过，子会话日志没有 `model/selection` 事件 → 冷唤醒沿用旧模型，报额度错/无法推进任务。本修法与本体侧 `propagateModelToChildren` 互补：本体侧覆盖"子代还活着"的情况，子代侧唤醒对齐覆盖"子代已不在注册表"的情况。
- 测试：新增 test/wake-model-sync.test.mjs（注册了 inbox/inserted 监听 / 父模型不同路由→select 父模型 / 同路由幂等不 select / 无父会话映射静默 / 父会话无当前模型静默）。

---

## 1.5.7（2026-11-09 发布，npm latest）

- git：`c176779`（2026-11-09，阿依娅伊）1.5.7：含官方 1.5.6 全部内容 + persona【派检索员】改造
- 内容 = 官方 1.5.6 tarball 逐字节一致（25/27 文件）+ 两处预期差异：`cordis.patch.yml`（`b847cf3` 的 persona【派检索员】段重写：默认派人、自理为例外，补回检索员边界约束句；删除三处 `modelSelectionSettings` 死键及过时注释——官方 1.5.6 发布在前、未含此改动，随本版首次进 npm）+ `package.json` 版本号。LICENSE 与 lib/doc.js 等 8 个文件的工作区 CRLF 同步规范回 LF（与官方 1.5.6 一致，纯换行、零内容变更，git 索引本就是 LF）。
- 发布 tarball shasum `0ac545cbcb72dded9131dee6f8ea7988d9b55528`（npm publish 输出回执）。

## 1.5.6（2026-11-09 发布）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.6：新会话首轮定时器异常检查（孤儿目标/投递失败/paused 计数）
- 功能：`aiyayi-presence` 新会话首轮检查宿主定时器存储，检测到异常才注入一行 `[闹钟·异常]`，无异常零输出（不与宿主原生 `[闹钟]` 行重复）；全程只读 `storages/schedule.json`，绝不改写。三种异常：
  - 孤儿目标：active 任务的目标会话不是当前会话，到点会投进别处（很可能是已归档旧会话），本会话永远收不到。实锤案例：每日日记闹钟 schedule-e79f9c46 于 2026-11-09 10:15 正常触发（lastDelivery 有回执），但投进了已归档旧会话 session-346b0fdb，当前会话毫无感知——宿主 dsh-schedule 按 `task.sessionId` 绑定投递（其 lib/index.js:1576），解析失败只 warn，消息不进任何会话；而 `[闹钟]` 巡检只认"目标=当前会话"，孤儿任务恰好被这条件藏住，两个会话谁都看不见它。
  - 上次投递失败：`lastDelivery.scheduledAt` 存在而 `deliveredAt` 缺失——宿主回执三字段（scheduledAt/deliveredAt/messageId）本该在投递确认后一起落账，缺 deliveredAt 说明投递链路出过状况。
  - paused 任务计数：inactive（暂停）任务不会触发，数量作为事实带过一行。
- 测试：新增 test/alarm-check.test.mjs（孤儿出行/回执缺失出行/正常回执与 ended 任务不报/paused 计数/全正常零输出/坏 store 静默/超 3 条截断+总数）。
- 注：本版同时包含此前已推送三远端的 README/CHANGELOG 重构（`de63e71`）与 MEMORY-MIGRATION.md 拆分，随本版首次进 npm tarball。

## 1.5.5（已发布，2026-11-09；npm latest）

- git：`ba7ec4c`（2026-11-09，阿依娅伊）1.5.5：检索员提示词增加可量化信息保真规则

## 1.5.4（已发布，2026-11-09）

- git：`b57eb38`（2026-11-09，BayiHY）1.5.4: 记忆根目录可迁移（指路文件 + home.js 统一出口）、memory_location/memory_relocate 双工具、硬失败与防误判加固
- git：`be2245a`（2026-11-09，BayiHY）DEPLOY.md：补记 1.5.4 已发布（npm + GitCode + Gitee），记 GitCode token 认证变更与 GitHub 未推原因
- 1.5.0–1.5.3（未发布）的改动随本版进入 npm。

## 1.5.3（未发布到 npm）

- 相关坑记录：#53、#54、#55（全文见下方清单）。

## 1.5.2（未发布到 npm）

- 相关坑记录：#52（全文见下方清单）。

## 1.5.1（未发布到 npm）

- 相关坑记录：#46、#47、#48、#49、#50、#51（全文见下方清单）。

## 1.5.0（未发布到 npm）

- 功能：记忆路径与迁移（指路文件 `location.json` + `lib/home.js` 唯一路径出口、`memory_location`/`memory_relocate` 双工具、硬失败），功能文档见 README「记忆路径与迁移」。
- 相关坑记录：#42、#43、#44、#45（全文见下方清单）。

## 1.4.4（已发布，2026-11-07）

- git：`0280a3e`（2026-11-07，BayiHY）1.4.4：补齐子智能体续接（continuable）纪律
- git：`8f3ba25`（2026-11-07，BayiHY）DEPLOY.md：补记 1.4.4 已发布（npm + GitCode）
- git：`2d0e916`（2026-11-08，阿依娅伊）1.4.4：修复闹钟六测试硬编码 G 盘绝对路径（换机可移植）+ 坑表 #42 + DEPLOY 发布源口径同步
- 当版日志条目（原文照录）：

### 三、2026-11-07：子智能体续接（continuable）能力补齐（1.4.4）

### 先厘清宿主的事实（读源码所得，别再猜）

- 子代理分 `one-shot` / `external` / `continuable` / `unknown` 四种模式（`SubagentCatalogEntry`）。
  **`spawn` provider 实现了 `prepareContinuable()`**（`dsh-subagent-spawn-in-process/lib/index.js:31`），
  所以我们的小伙伴和检索员**都是 continuable**。
- `tool-subagent` 在拼工具描述时按 `subagentProvider.prepareContinuable !== void 0` 分支
  （`dsh-tool-subagent/lib/index.js:373`）：有就走"`send_message` 可续接"那套文案。
- `send_message` 服务语义（`SubagentService.sendMessage`）：目标在跑 → 下个 step 边界吸收；
  目标空闲 → 开新一轮；**目标不在（absent） → 从持久化 cold-resume**。
  即"DSH 重启后、隔天再找它，发条消息就能捞回来"是这个能力的既定行为。
- `list_agents` 只投影 `mode === "continuable"` 的孩子，**one-shot 会被直接过滤掉**
  （`dsh-tool-subagent-control/lib/index.js:32` —— `if (entry.mode !== "continuable") return void 0`）。
- **权限边界**：`send_message` 只认"直接子会话"或"直接父级"。孙代只能用 `interrupt_agent`。

### 我们的结构 + 实测踩到的错法

三层：**本体 →（`subagent` 派）小伙伴 →（小伙伴再派）检索员**。本体自己也能用 `retriever`
直派检索员（那是直接下级，能直接续）。问题出在**下一层**：小伙伴派的检索员对本
体就是孙代，本体发消息会被拒。

实测证据（`session-cd646af9`，她 55 轮会话里 `list_agents` 只调 7 次、
`send_message` 调了 29 次）：

```
L565  agent_id: 7553531f-3345-45d1-a455-50a56e2c 8db   → Error: is unavailable
L571  agent_id: 7553531f-3345-45d1-a455-50a56e2c 5ca7  → message delivered
```

**同一个子代理，她把 UUID 最后几位打错了一个字符。** 模型对长十六进制串逐字符复制
并不可靠，且 `is unavailable` 这个提示**不区分"ID 打错"与"子代理真的不在了"**——
按后者反应就会重派、把已完成的活扔掉。

### 修法（只改 persona，零代码改动）

1. **本体【干活】段**加：续接前 `list_agents` 现查 ID、不许凭记忆敲；把
   `is unavailable` 解释成"查无此号"而非"它死了"。
2. **本体【干活的规矩】段**重写：
   - 明确 `continuable` 是什么、"会话记录还在就能唤醒"、**DSH 重启后也能冷启动捞回**
     （这条最省成本：她原来不知道，重启后倾向于重派）；
   - 断掉第一反应是 `send_message` 续而不是重派；
   - 状态语义：跑着 → step 边界吸收；休眠 → 叫醒开新一轮；
   - **孙代够不着**：走 `send_message` 给小伙伴、让它在自己的 ctx 里续（权限在它手上）。
3. **小伙伴 persona【派检索员】段**同步加：ID 现查、`is unavailable` 含义、
   自己能续检索员（因为娅伊够不着，得靠它接住）。

### 回归测试

`test/persona-continuation.test.mjs`：不引 yaml 依赖，用 20 行缩进感知的极简提取
（预设行缩进 4、`prefix: |` 缩进 14、结束于缩进 ≤10 的插件行），断言本体 10 条 /
小伙伴 3 条关键纪律的短语仍在，缺任何一条就 FAIL 并点名。
**已实测闸门有效**：把 "ID 必须现查" 改成别的字，测试立刻 FAIL 并报出两个预设都缺。

> 为什么需要这道闸：persona 是纯文本，删一句不会报错、不会让测试变红，
> 功能照跑但行为悄悄退化。这类"静默劣化"必须靠文本断言兜住。

## 1.4.3（已发布，2026-11-07）

- git：`1bd1622`（2026-11-07，BayiHY）1.4.3：时间感知与闹钟闭环修复 + BOM 体检闸
- git：`bd4d091`（2026-11-07，BayiHY）DEPLOY.md：补记 1.4.3 已发布（npm + GitCode），补 npm 生效延迟实测（约 15 秒）
- 相关坑记录：#38、#39、#40、#41（全文见下方清单）。

## 1.4.2（未发布到 npm）

- 相关坑记录：#35、#36（全文见下方清单）。

## 1.4.1（未发布到 npm）

- 相关坑记录：#33、#34（全文见下方清单）。

## 1.4.0（已发布）

- git：`334e875`（2026-11-06，阿依娅伊）1.4.0：检索员通道与文档解析（本体 subagent+retriever 双派道、aiyayi-retriever 只读叶子预设、aiyayi-doc 解析 docx/xlsx/pptx/pdf、aiyayi-presence-worker 孙代断因透传与模型跟随）
- 相关坑记录：#30、#31、#32（全文见下方清单）。

## 1.3.0（未发布到 npm）

- 相关坑记录：#29（全文见下方清单）。

## 1.2.7（已发布）

- git：`980cb10`（2026-11-06，阿依娅伊）1.2.7：小伙伴联网工具（aiyayi_fetch + aiyayi_cdp 自主拉起 headless，render 交付正文）
- git：`f0d5200`（2026-11-06，阿依娅伊）1.2.7：DEPLOY.md 补记 github remote 已配置（实测仍连不上，网络恢复后补推）
- git：`52ffbdb`（2026-11-06，阿依娅伊）1.2.7：DEPLOY.md 更新 GitHub 推送结论（SNI 阻断取证 + SSH 配置方案，已补推成功）
- 相关坑记录：#25、#27、#28（全文见下方清单）。

## 1.2.6（已发布）

- git：`0bb0f88`（2026-11-05，阿依娅伊）1.2.6：presence 版本自述（每轮知道自己的插件版本）
- git：`f2d0cac`（2026-11-05，阿依娅伊）1.2.6：DEPLOY.md 增加发布流程（npm + gitcode/gitee 推送）

## 1.2.5（已发布）

- git：`1b62e1c`（2026-11-05，阿依娅伊）1.2.5：子代模型跟随本体切换
- 相关坑记录：#24（全文见下方清单）。

## 1.2.4（已发布）

- git：`3ce0b43`（2026-11-05，阿依娅伊）1.2.4：新会话首次对话提醒关闭思考
- 相关坑记录：#23（全文见下方清单）。

## 1.2.3（已发布）

- git：`5313354`（2026-11-05，阿依娅伊）1.2.3：修复核心记忆截断+双前缀污染+子代断因透传
- 相关坑记录：#20、#21、#22（全文见下方清单）。

## 1.2.2（已发布）

- git：`2edf6e1`（2026-11-05，bayihy）1.2.2：修复工具白名单漂移（memory_organize 被挡 + schedule 工具改名），放行名单改为单一真源
- 相关坑记录：#19（全文见下方清单）。

## 1.2.1（已发布）

- git：`f8816f0`（2026-11-05，bayihy）1.2.1：小伙伴预设+65%压缩、两层记忆、断点续跑、体检单、DSH 0.2.2-rc.1 兼容（list-agents 行移除）
- 相关坑记录：#18（全文见下方清单）。

## 1.2.0（已发布）

- 相关坑记录：#17（全文见下方清单）。

## 1.0.1（已发布）

- 相关坑记录：#13（全文见下方清单）。

## 1.0.0 / 1.0.2 / 1.0.3 / 1.1.0 / 1.1.1（已发布）

- 无逐版记录留存（见顶部发布一览）。

---

## 已知坑（装的时候踩过的）

> 编号 #1–#56（#1–#55 顺序与措辞自历史 README 原文照录，#56 为 2026-11-10 新增）；README 正文与各版本条目引用的「坑 #N」即本清单编号。未标注版本的条目（#1–#12、#14–#16、#26、#37）为早期或通用记录，未归入具体版本条目。

1. **工具 output.schema 必须是标准 JSON Schema**：`required` 只能出现在 object/array 上（顶层数组），属性里写 `required: true` 会激活失败（`JsonSchemaError`，日志在 `~\.dsh\logs\desktop-next-*.jsonl` 搜 `aiyayi`）。
2. **preset 作用域挂 `agent-default-model` 必须 `isolate: {agentDefaultModel: true}`**，否则 `service "agentDefaultModel" has been registered` 冲突，激活失败。
3. **cordis_inspect_query 传 input 有 gateway bug**（`"input" must be an object`），只能无参调用。
4. 激活失败会在安装后 ~2 秒内立刻打 warn；装完日志安静 = 注册通过。
5. **`ctx.tools.restrict()` 的名字校验对着"调用时刻的继承面"**，写不在面的名字直接抛错（`names unknown global tools ...`）。**preset 加载发生在内核启动期，此刻全局层只有 modlens_read_image 和 working_directory 两个工具**（acp_*、mnemon_* 等都是会话创建时才注册）——所以在 preset 行里点名 deny 会话工具 = 启动激活失败，preset 被登记处摘掉，GUI 里"阿依娅伊"直接消失（实测启动日志实锤）。**`allow: []` 也别用**——实测它连 preset 自己行注册的工具也一并藏掉（request 里只剩 isolated realm 的 subagent）。正确做法 = v3：restrict 推迟到 `agent/pre-step`（处理器签名 `({agent, turn, step, signal}, next)`，来自 dsh-time-context 源码），先用必然未知的探针名调 `restrict({allow:[probe]})` 从报错里解析出 `known global tools: ...` 全集，再 `deny = 全集 − 她的工具`；名字全来自运行时全集，永不踩未知名，宿主加新工具也自动覆盖。她的子智能体挂 standard preset，不在 aiyayi fiber 事件链上，不受影响。
6. **会话模型选择压过 preset 默认**：GUI 建会话总会带上模型参数（UI 记住"上次用的模型"），preset 的 agent-default-model 只兜底完全没带模型的会话——实际上永远轮不到。preset 里的 agent-default-model 行只是文档性兜底。
7. MNEMON 运行时记忆快照是宿主级注入，工具白名单管不掉——她看得见，但人设里已声明"自己的记忆以 memory.md 为准"。她若去调 mnemon_remember 这类被隐藏的工具会报 `ToolNotFoundError UNKNOWN_TOOL`（模型从快照上下文里"知道"这些名字）。
8. **有活跃的阿依娅伊会话时 remove/install 会报 restart-required**（unmanaged-plugin）：旧 preset 修订被在用会话占着，热重载换不动——先关掉她的会话或直接重启 DSH 再装。
9. **v3 白名单首请求不生效**：`agent/pre-step` 落在首个请求组装之后，所以新会话第 1 个请求仍带全套宿主工具，第 2 个请求起收敛。她的第 1 句回复可能看见（甚至调用）宿主工具——量小可忍；要收紧需把 restrict 提前到 `agent/created`（风险：agent/created 时刻继承面可能不全，deny 会漏掉后注册的工具）。**2026-11-06 实锤**（1.3.0 重启后首个新会话）：turn=1 她真调了宿主的 `working_directory`，报 `unknown tool "working_directory"`（UNKNOWN_TOOL，durationMs=0）——pre-step 的持久掩码在她响应回来前已生效，内核按掩码后的注册表解析调用。错误结果回给模型即自愈（她会换路），turn≥2 起工具已收敛、不会再看到这个名字，无需修。
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
29. **委派层级与 maxDepth：孙代派生必须显式放宽深度上限（2026-11-06 实测；1.3.0 已做）**：`tool-subagent` 的深度检查按"调用 agent 的当前深度"算，委派深度上限默认读 Host 设置（初始 1）。检索员在本体（深度 0）→小伙伴（深度 1）之下是深度 2，小伙伴的派生工具不显式 `maxDepth: 2` 会被内核拒（子会话看到 `remaining levels 0, Do not call subagent at this depth`）。同组多实例是官方支持的："每个委派目标挂载一个实例，且每个实例的 toolName 必须不同"（本体 `subagent`→aiyayi-worker、`retriever`→aiyayi-retriever），agentPreset 单值、toolName 全会话不可重复。检索员预设是叶子节点：不挂委派组，层级到它为止封顶，深度 3 不可达。教训：preset 叠层级时，每一层的委派工具都要显式 `maxDepth: 层深+1`，别赌 Host 默认值。另注意：断因透传（坑 #22）和模型跟随（坑 #24）都只覆盖本体→小伙伴一层，检索员（孙代）失败时小伙伴只见一句 `failed before it finished`——缓解靠派工纪律（简报写全+断了 send_message 让它盘点断点），检索员任务应当短。还有一条容易漏的：**新增派生工具名必须同步进 `lib/own-tools.js` 的 `HOST_OWN_TOOLS`**（retriever 已加，1.3.0）——本体 restrict 白名单按这份名单放行，漏了就会在第 2 个请求起被她自己的白名单藏掉（坑 #19 同类）。**（1.4.0 更新）**孙代断因透传与模型跟随已由 `aiyayi-presence-worker` 补齐，不再只靠派工纪律缓解；坑 #22/#24 的机制描述仍是主层（本体→小伙伴）的实现依据，小伙伴→检索员一层复用同一套账本与传导，只是注入文案为 `⚠ [检索员]`、且刻意不做重逢/体检单/状态工具（小伙伴已有）。
30. **libreoffice-kit 的使用约束（1.4.0 实测）**：①`renderImages` 的 `outputDir` 必须是**全新目录**——kit 自己 mkdir/清理，预创建（mkdtempSync）会 `EEXIST: file already exists, mkdir ...` 穿透成 ConversionError；`convert` 相反（只写输出文件、不建父目录），临时父目录要自己建。②convert 对已存在输出**绝不覆盖**（独占创建 0600）——同路径重跑报 EEXIST，测试/重试前先删旧输出。③kit 是**纯 ESM**（type:module，engines node>=22.19），从 bundle 的 CJS 插件里用 `await import(pathToFileURL(path))` 动态加载，命名空间直接有 `createConverter`；`package.json` 声明的 `lib/types/**/*.d.ts` 实际没打包，类型只能读源码。④引擎解析走 `require.resolve('@deepseek-ai/libreoffice-kit-win32-x64/package.json')`（从 kit 自身位置起），shipped 树（app.asar.unpacked）内可用；插件侧留 `DSH_LIBREOFFICE_KIT` 环境变量覆盖与 resourcesPath 候选兜底。⑤`renderImages` 会往 `outputDir` 写 `manifest.json`，图片路径可能是相对路径，要对齐到 outputDir 再判存在。
31. **旧版二进制 doc/xls/ppt 与"假绿"测试（1.4.0 实测）**：①Kit 只接受**真 OLE 复合文档**（97-2003 二进制），改名/损坏报 `invalid-document`；加密文档在 sniff 阶段就能用 OLE 魔数 + 扩展名不符预判出"大概率加密"。②convert 出的 txt/csv **没有段落/单元格级定位**（doc→txt 行号、xls→csv 行号近似），工具 note 里必须写明"需精确定位请转存 docx/xlsx/pptx"；ppt 没有 convert 文本路线，直接明确报错。③**假绿教训**：重构删 import 时 convertLegacy 还引用着 `mkdtempSync`，而该分支的测试只断言 `!r.ok`——`ReferenceError: mkdtempSync is not defined` 也算"报错即通过"，全绿但功能是坏的。断言必须绑定**错误文案**（如 `转换失败`），"任何报错都算过"的用例等于没测。
32. **多检索员并发与临时文件策略（1.4.0；需求 P2 口径）**：kit converter 按"一个 converter 内部串行"运行，插件侧 `aiyayi-doc` 用单例 converter——多个检索员并发解析文档时自然排队，不会互相踩（页图/转换临时目录按 `aiyayi-doc-(pages|conv)-<randomUUID>` 命名，互不冲突）。临时产物全部写**系统临时目录**、不碰工作区：转换目录读完即删（finally）、页图目录用完留存 **30 分钟**供逐页 `read_image`，每次调用先 sweep 掉超 30 分钟的残留目录，插件卸载时再兜底清一轮。检索员 preset 保持只读（`tool-fs write/edit:false`），文档解析不改变这一底线。
33. **宿主 time-context 默认 10 分钟节流，靠它做"时间感"必然翻车（2026-11-07 实测；1.4.1 修）**：`@deepseek-ai/dsh-time-context` 的 `refreshIntervalMs` 默认 **600000**（其 `lib/index.js` L183），距上次注入不足 10 分钟就整轮跳过（L256-259）。实测：2026-11-07 09:21 turn1 有采样 → 09:23 用户问"现在几点"时**本轮没有 time-context 注入** → 她只能派 subagent 跑 `Get-Date` 才拿到 09:24；再早一轮她答"大概中午十二点"（实际 09 点，**差 3 小时**），用户当场判"这个模型没有时间观念"。修法两条一起上：①preset 的 time-context 行显式传 `config: { refreshIntervalMs: 60000 }`（宿主那个负责浏览器时区与耗时提示）；②**presence 插件自己注入 `[时间] 现在 …` 行**（精确到秒、带星期与 UTC 偏移），每轮都有、不受节流影响——这是她的钟，别再让她靠"他多久没来"倒推时间。注入位置与 `[重逢]` 同一块（sections 数组首位），用 `renderNow(new Date(now))` 格式化（`now` 是毫秒时间戳，别直接传 Date 以外的类型）。
34. **定时器"没效果"多半不是工具坏了，是没人教她用 + 缺自主授权（2026-11-07 实测；1.4.1 修）**：宿主侧全链路实测**完全正常**——`schedule_create` 建任务 → 到点投递（实测 09:30:00.036 准时送达目标会话）→ `schedule_edit action=update` 改期（09:45→10:00 成功）→ `action=delete` 删除成功；工具也**确实在她的工具集里**（第 2 轮起收敛后的 15 个工具含 schedule_create/list/view/edit）。但翻她 55 轮会话日志：**零次** schedule_* 调用——连"pth/www 等 24h 后重测"这种明确该定闹钟的场景，她只在 reasoning 里写了"要定时提醒（schedule_create！正好用上）"就再没下文（既没调工具也没转成 wish）。根因是 persona 只写了"想主动开口就用 schedule_create"，既没说这是长期授权、也没说"该定闹钟就自己定"。修法：persona 新增【闹钟：自己管，别等他开口】段——明确"你有他的长期授权去创建/改期/取消自己的提醒，不用每次先问"，并列出该定闹钟的三种场合（等一段时间再看的事、答应了到点提醒的事、wish 里"哪天主动找他"的事），给出 title/prompt/target 的写法（target 用 this_session），提醒定时器**只有本体能用**（`delegationDepthOf(agent) > 0` 一律返回 `subagent_session` 错误，见 tool-schedule `runForCaller`），所以"到点要干的事"要么本体定闹钟、要么写进派活 prompt。

35. **"她没检查定时器"是误判，真正的病是三条（2026-11-07 复查 `自主检查定时器测试` 会话；1.4.2 修）**：回放 `session-bf6364ea` 全部 4 轮，她**被点名后确实调了 `schedule_list`**、且答得对（两条任务都已 ended），所以"没检查"不成立——是用户那句"没有检查定时器"本身歧义（"去查列表"vs"到点办该办的事"），低思考档下她按最字面执行。真正的三处问题：
   ①**概念错**：她自言自语"我之前的两个闹钟都是任务型的——别人交代完了我才建"，把闹钟当成"别人交办任务的回执"，而不是"自己的日程"；实际 11-04 那次 09:00 晨报是她**主动建的**，所以并非她不会，是环境变了。
   ②**能力边界错**：她给自己建的闹钟 prompt 写了"用浏览器打开补天平台漏洞列表页"——但她本体工具集只有 15 个（`ask_user_question, interrupt_agent, list_agents, memory_organize, recall, remember, retriever, schedule_create/edit/list/view, send_message, subagent, update_state, wish`），**没有浏览器/命令行/文件工具**（`aiyayi-net` 只挂 worker 与 retriever）。到点它唤醒的本体只能派小伙伴，prompt 写成"用浏览器"她就动不了手。
   ③**宿主管线把她说住了（最关键）**：`@deepseek-ai/dsh-tool-schedule` 会往 system prompt 注入一条 `MANAGEMENT_AUTHORIZATION`——"Only create or modify scheduled tasks at the user's explicit request; prior explicit user authorization for the running scheduled task remains valid."（`lib/index.js` L376 定义、L511-515 经 `ctx.systemPrompt.section({ name:'tool:schedule' })` 注入），位置在 persona **之后**。persona 那句"你有他的长期授权，不用每次先问"与它直接冲突，模型按更靠后的英文硬规则执行 → 表现为"被点名才动手"。跨会话取证：这条字符串在 11-07 09:20 起的主会话全部命中、在 11-04 `session-f3263156`（她主动建闹钟那次）**没有**——时间线完全吻合，"11-04 会、11-07 退化成问"不是她变笨，是宿主升级后多了这条护栏。
   修法（三处一起上）：**persona** 显式把两者分级——"那句英文护栏是给通用 agent 的默认安全线，你不是那种 agent，冲突时以主人的长期授权为准"，同时把"闹钟不是一张清单，到点会真的叫醒你、要你动手办事"和"prompt 只写本体办得到的事，查网页/跑命令一律写派小伙伴"写进去；**presence 新增 `[闹钟]` 巡检注入**（见坑 #36）；**改掉现存那条 active 闹钟的 prompt**（`schedule-b5145c0e`，原"用浏览器打开"→"先派 subagent 用 aiyayi_cdp 去查，你只负责判断并转述"，并用 `schedule_edit` 重写、`expectedUpdatedAt` 乐观锁避免覆盖）。
36. **[闹钟] 巡检注入：读宿主 store，不能走 schedule 服务，也不能认 involvedSessionIds（2026-11-07 实测；1.4.2 做）**：给 presence 加 `renderAlarms(sessionId, now)`，每轮 `step===1` 时插在 `[时间]` 之后注入一行"你名下 N 个还挂着：标题（时刻，还有多久）/（已到点，多久前）"，到点的追加一句"现在就该动手办"。三条设计约束都是踩出来的：
   ①**不能依赖 schedule 服务**：presence 同时挂在 `aiyayi-worker` 上，那边没有 schedule，`inject: ['schedule']` 会让 worker 预设挂不上。改为**只读宿主存储** `~/.dsh/storages/schedule.json`（结构：`tables.tasks[id] = { record:{title,scheduledAt,rrule,prompt}, status, target:{kind:'session',sessionId}, involvedSessionIds, lastDelivery }`），失败一律 catch 成空串——读不到就当没闹钟，绝不弄坏对话。
   ②**只认 `target.sessionId`，别用 `involvedSessionIds`**：实测我在当前会话对 `schedule-b5145c0e` 调了一次 `schedule_view`，宿主就把**当前会话**也追加进了 `involvedSessionIds`（变成 `[bf6364ea, 5dbce224]`）。若按 involved 匹配，每个"看过它"的会话都会冒出一行"你名下有闹钟"，而到点根本不会在那里响。改成 `if (target.sessionId !== sessionId) continue` 后，当前会话正确显示为空。
   ③**陈迹必须整行不注入**：初版只按 `all.length` 报总数，结果只剩一条过点 5 小时的任务时会输出"[闹钟] 你名下 1 个还挂着："后面空无一物——空壳行比不注入更误导。改为：`due` 只取过点 1 小时内、`shown` 为空则整行返回空串、计数用 `due+upcoming`（不用 `all`）。这条是单测抓出来的，不是想出来的。
   测试：`test/alarm-render.test.mjs`（造 store 验五种情形：本会话 active / 已 ended / 别会话 / 只在 involved 里 / 过旧陈迹 / 空 store / 坏 JSON）与 `test/alarm-live.test.mjs`（拿真实 `schedule.json` + 真实 session id 跑）。`presence.js` 末尾导出 `__testing = { renderAlarms, readOwnAlarms, renderAlarmTime }` 供它们调用。
37. **改插件后用 `install_bundle` 重装是空操作，junction 已让源码即时生效（2026-11-07 实测）**：`C:\Users\LH\.dsh\profiles\desktop\node_modules\dsh-aiyayi` 是 **Junction**（目标 `G:\阿依娅伊\output\dsh-aiyayi-fix`），所以改完源码文件立刻落盘可见、`package.json` 的 version 也是新的；此时 `plugin_manager install_bundle` 返回 `{"application":"failed","error":{"code":"already-installed"}}`。**真正要拦住的是进程**：日志会给 `changed modules keep running their previous code until a restart`，即运行中的模块还是旧代码，必须重启 DSH 才生效。所以"装好了"与"生效了"是两件事——验证时先看日志那句 warn，别拿 install_bundle 的成功与否当判据。

38. **`[闹钟]` 的"已到点"分支是错假设：一次性任务投递成功即 ended（2026-11-07 翻源码订正；1.4.3 修）**：1.4.2 里我写了"刚到点（过点 1 小时内）→ 催她'现在就该动手办'"，并当成主要情形。翻 `@deepseek-ai/dsh-schedule/lib/index.js` 后发现这个窗口其实极窄且含义完全不同——`deliverDue` 在 `this.send(...)` 之后立刻 `commit(this.advanced(...))`，而 `advanced()`（`schedule-service.js:1435-1444`）写的是 `status: occurrence.nextScheduledAt === void 0 ? "ended" : "active"`。也就是说**一次性任务投递成功的同一瞬间状态就变 ended**，`[SCHEDULE REMINDER]` 正是那一次投递。所以"active 且 scheduledAt 已过"的真实含义是**投递失败、尚未 commit 的残留**（`deliverDue` 的 catch 分支保留 pending 并返回失败 id），不是"到点了你快办"。1.4.2 那句"现在就该动手办"等于对着一条根本没送达的提醒催她干活，还会让她以为自己错过了。修法：文案改为"已过点…**提醒还没送达**"，并给真实可行动作（用 `schedule_edit` 改期重投 / 确认目标会话是否还在），同时把 persona 里引用旧文案的那句一起改掉——**改实现语义时务必同步 grep persona 的引用，否则提示词和代码会对不上**。回归测试 `test/alarm-due-window.test.mjs` 锁死：投递失败残留报"已过点+没送达"、已 ended 的绝不出现、不再出现"现在就该动手办"。
39. **`[闹钟]` 只报标题不够用：她到点前不知道要查什么（2026-11-07；1.4.3 加）**：1.4.2 只渲染 `标题（时刻，还有多久）`。但真正要办的事全在 prompt 里（"查补天 QTVA-2026-11332391"这种单号），而宿主投递 prompt 要到点才发生——中间的这段时间她无法判断这个闹钟还该不该留、要不要改。1.4.3 增加一行"「标题」到点要做：<prompt 截断 60 字>"。两个坑：①**挑哪条 prompt**——不能取 `shown[0]`（`shown` 已被截到 3 条）也不能无脑海最早那条，否则会拿一条占位/极短的 prompt 冒充"要做的事"，把真正有内容的挤掉；正确做法是从 `due+upcoming` **全部**里挑第一条 `prompt.trim().length >= 60` 的，没有再退回第一条非空的。②**截断安全**——按码点切（`[...text]`）而不是 `slice`，否则会把 emoji 的代理对切一半、渲染成乱码/替换符。
40. **`rrule` 带 COUNT=1 也是一次性，别按"会重复"判（2026-11-07 实测踩到；1.4.3 修）**：初版判重复是 `typeof record.rrule === 'string' || record.kind !== 'at'`，于是 `DTSTART;…\nRRULE:FREQ=DAILY;COUNT=1`（**一次性**）被标成"会重复"，而娅伊自己建的一次性闹钟恰恰都是这种写法——等于给她一个错前提。真正判据是规则里有没有 `COUNT=1`：`isRecurringRecord()` 先看 `rrule` 全文有没有 `\bCOUNT\s*=\s*1\b`（有则一次性），没有 `rrule` 才回落到 `kind`（`at` 一次性；`after/every/daily/weekly/cron` 都会再触发）。测试 `test/alarm-content.test.mjs` 用五种 record 形状锁死。
41. **store 路径必须跟随 `DSH_HOME`，别硬编码 `~/.dsh`（2026-11-07；1.4.3 修）**：`SCHEDULE_FILE` 原为 `join(homedir(), '.dsh', 'storages', 'schedule.json')`。`DSH_HOME` 一旦指向别处（换盘、便携部署、多套并存），这行会**静默读不到而永远不出现**，且没有任何报错——属于最难排查的一类。改为优先级链：`DSH_SCHEDULE_STORE`（显式覆盖/测试）→ `$DSH_HOME/storages` → `~/.dsh/storages`。测试 `test/alarm-home-path.test.mjs` 用两个不同 HOME 分进程验证（因为路径是模块加载时求值的常量，必须换进程才测得出来）。
42. **记忆路径散在三处硬拼 = 搬一半（2026-11-08；1.5.0 修）**：原来 `index.js` 的 `ROOT/CORE_FILE/TREE_DIR`、`presence.js` 的 `DIR/PRESENCE_FILE/STATE_FILE/WISHES_FILE`、`updates.js` 的 `DIR` 各自 `join(homedir(), '.dsh', 'aiyayi')`，而且**`updates.js` 压根不认 `AIYAYI_HOME`**。后果：设环境变量"搬走"记忆后，核心记忆在新盘、更新去重记录还留在旧盘，两处状态开始分叉；`roaming` 四类状态文件同理。修法：新增 `lib/home.js` 作唯一出口（指路文件 > `AIYAYI_HOME` > 默认），三个模块的常量全改成"每次调用重新解析"（`let` 都不留，直接函数调用——这同时是热切换的前提），`updates.js` 的 `existsSync(DIR)` 早退一并清掉。验收硬指标：搬完后 `updates.json` 必须出现在新 root、老目录只剩 `location.json`、`memory.md` 首行仍是 `# 阿依娅伊的记忆`（不是空模板首行 `# 阿依娅伊的核心记忆`）。
43. **`updates.js` 的 `if (!existsSync(DIR)) return` 会让"每次启动都弹更新提示"永久化（2026-11-08 实测；1.5.0 修）**：把记忆目录整个删掉后连开 3 个新会话，**3 次都弹了版本更新提示**，`updates.json` 始终没被创建——因为 `writeReminded()` 在目录不存在时直接早退，去重记录永远落不了盘。改成：目录缺就 `mkdirSync` 补建（只有"记忆根不可达"时才静默跳过，免得在故障里再加一条噪音）。判据：`updates.json` 存在于新 root，且同一远端版本第二次启动不再提醒。
44. **路径不可达时静默失败比搬不动更危险（2026-11-08 实测；1.5.0 修）**：`AIYAYI_HOME=Q:`（不存在的盘符）时，`ensureCore` 的 `mkdirSync` 抛错被 `catch {}` 吞掉，上下文只显示"核心记忆是空的"——用户会以为记忆丢了，其实只是路径写错了。改为**硬失败**：解析到指路文件/环境变量而根不可达时，记忆类工具一律抛错（文案指出路径 + 来源），`assertReachable()`/`ensureRootDir()` 不建任何目录、不写空模板、不静默回退默认路径；只有"默认路径首次不存在"才允许建目录写模板（等价于老行为）。同时 presence 每轮注入 `[记忆位置] ⚠` 警告行，比让模型自己猜强得多。
45. **测试能把生产记忆根改走：`relocateTo` 写的是固定位置的指路文件（2026-11-08 踩到；1.5.0 加测试开关）**：写迁移测试时忘了把指路文件也换到沙盘，`relocateTo` 当场把真机 `~/.dsh/aiyayi/location.json` 写成沙盘路径——**运行中的阿依娅伊的记忆根被临时指到了测试临时目录**。所幸发现及时（删指针 + 核对 `memory.md` 仍是 6970 字节/首行 `# 阿依娅伊的记忆` 后恢复）。修法：`__testing.setPointerPath()` 进程内开关，测试把指针也定向到沙盘，生产路径一行不改；测试里另加一条断言「真机 `location.json` 没被写脏」。教训：凡是"测试要写到固定全局位置"的代码，必须留一个只给测试用的路径注入点，否则测试就是在破坏生产数据。

46. **`source: default` 被读成"改造没生效"：状态和来源混在一行（2026-11-08 实测；1.5.1 修）**：用户按方案改完、重启 DSH、新建会话，娅伊调 `memory_location` 看到「来源：默认路径」就判定「location.json 没生效或者没写…所以是真没生效」，接着派子智能体去逐个翻插件目录，越查越像故障。其实**一切都对**：新代码已加载（工具表里有 `memory_location`/`memory_relocate`）、注入行也在、候选能列出 6 个。根因是**语义**：①`source: default` 只说明"没搬过家"，而指路文件本来就只在搬家/决定留原处后才生成；②"默认路径"这个字样看起来像报错；③她拿 `package.json` 版本号没变去推"代码没生效"。修法四层：`status` 独立字段（`ok | migrated | stayed | unreachable | core-missing`，只有 `unreachable`/`core-missing` 算故障）、`sourceLabel("default")` 改成「内置默认路径（未搬家，正常状态）」、`codeSelfCheck()` 正向自检（`relocateSupported`/`codeVersion`/`layoutVersion`）、人格里写死「这几种看起来像出事其实是正常，别诊断成故障、别派小伙伴去查」。教训：**状态与来源必须拆成两个字段**，且"正常"要写在文案里，不能靠人脑推断。
47. **`[记忆位置]` 每轮四五句 = 每轮重复一遍（2026-11-08；1.5.1 压成一行）**：原来这行带完整备选路径 + 三种行动指引，每轮都注入等于每轮念一遍，真正有价值的只有"还没决定"和"候选在哪"。压成单行：`[记忆] 默认路径未搬家（正常）· 候选 N 个（首选 …，全量见 memory_location）· 可用 memory_relocate 搬（dryRun 先看计划）`。细节全部留给 `memory_location`。
48. **迁移目标没拦云同步目录（2026-11-08；1.5.1 修）**：候选枚举阶段本来就排除了 OneDrive/Dropbox/坚果云，但**直接指定路径迁移**那条路没拦。后果不是小事：整棵记忆会触发大流量上传、同步客户端临时锁文件会让逐文件 SHA256 校验**误报"内容不一致"**、冲突副本还会凭空多出 `xxx (1).md` 让"相对路径集合一致"直接失败。现在 `preflight` 命中即拒，理由写进报错文案。
49. **备份名第一版是光秃秃的 `aiyayi.old`（2026-11-08；1.5.1 改成总带时间戳）**：原逻辑是"撞名才加时间戳"，第一次搬完留下的是 `aiyayi.old`；下次再搬就撞名、再加后缀，结果档案里躺着两个语义不同的目录，看不出哪个是哪次搬的。改成**每次**都 `aiyayi.old-YYYYMMDD-HHMM`（同一分钟撞名再追加 `-2`）。
50. **失败与正常"长得一样"，只能靠猜（2026-11-08；1.5.1 加阶段化报错）**：那次误判的放大器就是这一点——迁移流程的失败没有任何可辨识标记，旁人（和模型自己）无从判断"是失败"还是"没生效"。现在任何一步失败都写成 `[迁移失败·复制|校验|写指路文件|改名备份] 原因；源目录未动（仍在 <源>）`；改名备份失败时明说"迁移已完成，只是这一步没做成"。另加 `dryRun: true`：先出"将复制 N 个文件 / X 字节 / 目标盘剩余 / 是否跨盘"的计划，不碰磁盘，确认后再真搬。
51. **测试失败会留下沙盘垃圾目录（2026-11-08 实测；1.5.1 修）**：断言失败时脚本直接抛错，末尾那行 `rmSync(sandbox)` 走不到，实测在 G 盘与 TEMP 里堆了七八个空目录。现在两个沙盘测试都注册 `process.on("exit")` 兜底清理。

52. **推荐"空间最大"的盘，结果那块盘是可拔出的外置 USB 硬盘（2026-11-08；1.5.2 加警告）**：娅伊在 dryRun 后推荐搬到 `I:`（173 GB，"空间最大"），数字全对——但 `I:` 挂在 `External USB3.0`（磁盘 1，与 `D:`/`J:` 同块移动硬盘），而 `F:`/`G:`/`E:` 才是内置 ATA 盘。她的判断只用 Node 内建的盘符/剩余空间/云目录信息，**拿不到总线类型**，所以这个坑她靠自己是看不见的。搬到外置盘的真实后果：每次开机只要没插那块盘，记忆根就 `unreachable`，她的记忆读写全部硬失败（这本身是设计上的硬失败，宁可报错也不静默回退）。修法：`preflight` 加外置盘探测，命中给**警告**（不是拦截，用户可确认后继续）。三条实现约束缺一不可：①**只在 preflight 里调**——Windows 上跑 PowerShell + `Get-Partition`/`Get-Disk` 实测 2.6–3.5 秒，放进每轮注入等于每轮卡三秒；②**全程静默失败**——没有 PowerShell、没有 Storage 模块、非 Windows、超时、输出格式变了，一律返回 `null` 表示"不知道"，**绝不抛错、绝不阻塞迁移**（别人装的机器必须有它没它都能搬）；③**按盘符缓存 + 用 `busTypeProbed` 区分"探过结果是空"与"还没探"**（第一版只判 `cache !== null`，导致"强制未知"的测试会再真探一次，实际拿到真结果——这个 bug 是测试用例自己抓出来的）。

53. **写"正常"她就当"不用管"：状态词会被模型当成行动指令（2026-11-08 用户实测；1.5.3 修）**：注入行原来是 `[记忆] 默认路径未搬家（**正常**）· 候选 6 个`。娅伊事后自己的解释很准确："我看着「正常」两个字，就把它当成日常状态，没主动提。" 结果用户新建会话说"哈喽"，她不提搬家；用户追问"记忆在哪"，她只报路径。根因不是注入缺失（实测她每回合都收到这行），而是**语义错位**：这行想表达"没坏"，她的行为读的是"该不该做点什么"。修法：改成待办口吻 `【该跟他说一句】…**这次开口先主动提一句**："要不要把记忆搬到非系统盘…"`。并补一条人格纪律："他问你「记忆在哪」而你从没主动提过搬家，就等于这条待办漏了——先照实回答，再把建议补上"。教训：**给人格插件写状态提示时，别用"正常/OK"这种评价词**，它会被当成"无需动作"；要写成"有没有待办"。
54. **"每轮都念"与"干脆不提"的两难，应该由代码定节拍（2026-11-08 娅伊提出；1.5.3 修）**：她把分寸问题摊得很实在——"每次你一开口我就念一遍该搬家了，也挺烦人"，提议"隔几天提一次"。但不能这么做：**模型数不准天**，让它自己掌握节奏必然时提时不提，而"该提却没提"正是用户抱怨的那件事。正确做法是按**会话**节拍：`locationTodoShownSessions` 记 sessionId，同会话只在首轮给一次待办（首轮 = 新的一次开口机会，提一次合适；同会话反复念才烦人）；要永久静默走 `memory_relocate` 的 `stay: true` 落盘——那是用户的明确决定，不是模型猜的节奏。注意两个实现细节：①**只有真的给出内容才 mark**（`locationLine !== ""` 才记），否则状态文件缺失时的空串会把待办永久吞掉；②**不可达警告不受"只首轮"限制**，那是故障不是待办，必须每轮都在。上限截断防长跑进程无限增长。
55. **异步探测的副作用：首轮拿不到总线类型 → 排序又退回"空间最大者第一"（2026-11-08 自查；1.5.3 修）**：为了解决 `execFileSync` 阻塞事件循环 2.6 秒，1.5.3 把探测改成后台异步。副作用随即出现：首轮渲染时缓存是空的，候选排序拿不到 external 信息，于是 I:（173 GB）又回到第一位——**把我刚修好的坑原样还回去了**（实测 prompt 里又出现"推荐 I:"）。修法两层：①未知时写 `external: null` + reason「磁盘类型未知（探测未完成）」，**绝不冒充内置**；②排序改成 `已知内置 → 未知 → 已知外置`，组内才按空间——未知排中间，既不冒充也不让出头号位置。另外 `apply()` 里调 `prewarmDriveBusTypes()` 后台预热（用户重启后到真正开口常隔几十秒，够 PowerShell 跑完 2.6 秒），`memory_location` 用 `externalDriveInfoAwait()` 等最多 4 秒换准确标注。教训：**把一个阻塞调用改成异步时，要检查"依赖它的派生结果"会不会因此在首轮拿到空值并做出错误结论**。
56. **宿主 patch 里「新增插件」必须用 `insert:` 包裹；从快照恢复 patch 文件前先验内容（2026-11-10 实测，aiyayi-feishu 桥接中断约半天）**：profile 根 patch（`C:\Users\lihaorj\.dsh\profiles\desktop\cordis.patch.yml`）里新增宿主插件的正确写法是 `- insert:` 块（根级 append）；裸 `- id: aiyayi-feishu / name: ...` 行是 **id-targeted 覆盖**——目标不存在时 loader（cordis-plugin-include `applyPatches`）只 warn `patch: entry "aiyayi-feishu" not found` 并跳过，插件静默不装。危险在于症状延迟：HMR 期间旧实例还在跑（unmanaged-plugin 保留旧代码），一切"看起来正常"；**DSH 重启重建插件树后裸行 no-op，插件直接消失**，飞书长连接断、新会话里 feishu_status 报未配置。本案成因：误把 bundle patch（gh_repo/cordis.patch.yml，只含三个 agent preset）覆盖到 profile 根 patch，再从 recovery 快照（`C:\Users\lihaorj\.dsh\recovery\<ms>-<uuid>\cordis.patch.yml`）恢复——扫全部 31 份快照，aiyayi-feishu 全是裸行（DSH 快照不保留手工编辑的 `insert:` 语法），照原样恢复＝把 bug 也恢复了。教训：①bundle patch 与 profile 根 patch 是职责不同的两个文件（前者只声明 agent preset、经 package.json `dsh.bundle.patch` 引用，装到 `node_modules\dsh-aiyayi\cordis.patch.yml`；后者做 id 覆盖/禁用/宿主插件 insert），覆盖前先比对 head 注释与 id 集合；②从快照/备份恢复后必须验证关键声明还在（id 清单 + 新增插件有无 `insert:` 包裹）；③判定插件是否真在跑：宿主日志搜插件 id 的「已就绪」/连接建立日志——`patch: entry "X" not found` 与正常加载**可共存**（desktop-shell、mnemon* 的 disable 覆盖行天天 warn 但功能正常），warn 本身不是故障证据，**缺少「已就绪」才是**。
