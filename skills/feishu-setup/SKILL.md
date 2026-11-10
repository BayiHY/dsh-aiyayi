---
name: feishu-setup
description: '阿依娅伊飞书桥接（aiyayi-feishu 宿主插件）的安装、配置与排障：装 SDK、写 profile patch 声明（insert 包裹式声明）、写凭证 config.json、触发 HMR、以日志「已就绪」判定生效，及飞书开发者后台的长连接订阅设置。已知报错多种（not-found / ERR_PACKAGE_PATH_NOT_EXPORTED / BOM）各有对症修法；已实锤的坑还有 SDK createLarkChannel 丢弃 handlers（坑 #58）、建会话链路（#59 建目录 / #60 preset 按名 set）、投递与生命周期（#61 裸 Agent / #62 事件字段 / #63 防刷屏 / #64 插件 abort 连坐 / #65 source 禁 undefined / #66 自消息回环 / #67 默认模型）。2026-11-10 改造：新会话扫码接入（会话里说「接入飞书」→ 待接入目标 → 手机飞书扫码进 bot 单聊 → bot_p2p_chat_entered_v1 自动绑定；create-bot.js v5 扫码前置）。当用户要接飞书、桥接断线、或会话里 feishu_status 报 configured=false 时使用。'
whenToUse: 用户要求新配/重配/修复飞书对接；aiyayi-feishu 相关报错出现在日志；用户问"怎么把娅伊接到飞书"；或要从零创建一个新飞书机器人应用（CDP 自主创建已固化，见文末「已固化」节）。
---

# feishu-setup

把 aiyayi 会话接入飞书机器人。**三件套缺一不可**，生效判定只认日志里的「已就绪」：

1. **profile patch 声明**——宿主插件不随 bundle 自动启用，要在 DSH profile 根 `cordis.patch.yml` 里声明；
2. **SDK 依赖**——`@larksuiteoapi/node-sdk` 装在 profile（dsh-aiyayi 自身零依赖，不带它）；
3. **凭证**——App ID/Secret 写进记忆根 `feishu/config.json`（UTF-8 **无 BOM**）。

> ⚠️ 本技能当前只含**已实测**的安装/验证步骤（2026-11-10 本机验证通过）。
> 「CDP 自主创建飞书机器人拿凭证」**已固化**（2026-11-10 真实跑通）：见文末「已固化」节 +
> 请求清单 `docs/经验-飞书机器人创建全流程与请求清单.md` + 脚本 `scripts/create-bot.js`。

## 架构事实（先读再动手）

- aiyayi-feishu 是 dsh-aiyayi 包内的**宿主级服务插件**（`lib/feishu.js`），不塞进任何 agent preset；长连接收发、自然语言绑定/新建会话（`绑定会话 <会话名>` / 任意消息默认新建）。
- 纯逻辑（路由/映射/文本抽取）在 `lib/feishu-logic.js`；映射持久化在记忆根 `feishu/mappings.json`（chat_id→sessionId）。
- **新会话扫码接入（2026-11-10 改造）**：GUI 会话里说「接入飞书/接飞书」→ 插件写记忆根 `feishu/pending-bind.json`（待接入目标，30 分钟时效）→ 用户手机飞书扫码进入机器人单聊 → 插件订阅的 `im.chat.access_event.bot_p2p_chat_entered_v1` 事件（SDK 默认 5 类事件之外，`channel.dispatcher.register` 补注册）自动写 `mappings[chat_id]=目标 sessionId` 并回确认。新会话首轮回复后还会自动注入一条接入引导（宿主无回复前拦截 API，挂在 turn/end 用 followup 注入；`feishu/guided.json` 防重复提示；说「不用」跳过并清除 pending）。
- **坑 #56**：patch 里裸 `- id: aiyayi-feishu / name: dsh-aiyayi/feishu` 行 = 对既有条目的覆盖，目标不存在就 warn `patch: entry "aiyayi-feishu" not found` 后跳过（no-op）。**新增必须用 `- insert:` 包裹**。
- 判定插件在跑：日志 `host.kernel.aiyayi-feishu` 有 `已就绪，记忆根 …（已绑定 N 个 chat）`。`not found` warn 不等于没跑（良性共存），**没有「已就绪」才是没跑**。
- 只改 patch 文件的 mtime 不会触发 HMR；要**改内容**。注意（2026-11-10 实测）：仅 Append 注释行会让 host 处理 patch（日志见 `root patch: entry "…" not found`），但**不会重跑 aiyayi-feishu**（无新「已就绪」）；可靠做法是对 insert 条目做**结构性变更**，如 `config: {}` → `config: {reloadTag: "<标记>"}`，随后日志出现新的「已就绪」= 生效。

## 步骤

### 1. 凭证（没有就先自动创建，见文末「已固化」节）

向用户要 App ID（`cli_` 开头）与 App Secret。用户没有飞书应用时，**自动路径**（已实锤，2026-11-10）：

1. 起 Edge（`--remote-debugging-port=9222`，保留登录态）→ CDP 确认 open.feishu.cn 已登录；**未登录也没关系（v5）**：create-bot.js 自动检测到 session cookie 缺失 → 导航登录页 → 提示「📱 手机飞书扫码」→ 轮询等登录态就绪（默认 10 分钟，`--login-wait <秒>` 可调）→ 继续创建链路；
2. 运行 `scripts/create-bot.js create --name <英文名> --desc <用途>`（Node 零依赖，自动 CDP 取 csrf+cookie、自动生成上传图标，全链路请求清单见 `docs/经验-飞书机器人创建全流程与请求清单.md`）：上传图标→创建应用→开机器人→配权限→配长连接订阅→建版本→提交发布；再用 `create-bot.js verify --app-id <id>` 确认 appStatus=1 上线；
3. 发布免审核（本企业实锤），无人工点；若出现待审状态才需管理员去管理后台通过；
4. `scripts/save-secret.js --app-id <id>` 接口直读 appSecret，写本地凭证（勿进 git、不明文打印）。

手动路径（备选）：
1. open.feishu.cn → 开发者后台 → 创建**企业自建应用**（长连接只支持自建应用）；
2. 凭证与基础信息页拿 App ID / App Secret；
3. 应用能力 → 添加「机器人」；
4. 事件与回调 → 订阅方式选「使用长连接接收事件」→ 添加事件 `im.message.receive_v1`（按提示开通接收消息权限）；
5. 版本管理与发布 → 创建版本并发布（自建应用可能需管理员确认）。

### 2. 装 SDK（已装则跳过）

判据：profile `package.json` dependencies 里有该条且 node_modules 目录存在。
未装：在 profile 目录执行 `pnpm add @larksuiteoapi/node-sdk`。`[ERR_PNPM_IGNORED_BUILDS] protobufjs` 警告无害（有 JS 运行时回退）。

### 3. 写 profile 根 patch 声明

在 `~/.dsh/profiles/desktop/cordis.patch.yml`（以 `$DSH_HOME` 实际值为准）顶层加：

```yaml
- insert:
    - id: aiyayi-feishu
      name: dsh-aiyayi/feishu
      config: {}
```

加之前先检查是否已存在（可能在某个 insert: 块里）；已有就不重复加。**不要动 patch 里与飞书无关的行。**

### 4. 写凭证 config.json

`<记忆根>/feishu/config.json`，UTF-8 **无 BOM**（BOM 会让 JSON.parse 直接崩）：

```json
{
  "appId": "cli_xxx",
  "appSecret": "xxx"
}
```

可选字段：`domain`（默认 https://open.feishu.cn）、`defaultPermissionPreset`（默认 workspace-write）。凭证不进 patch、不进 git。

### 5. 触发 HMR 并验证

1. 对 profile 根 patch 里 aiyayi-feishu 的 insert 条目做**结构性变更**（如 `config: {}` → `config: {reloadTag: "<标记>"}`）触发重载——只追加注释行不保证重跑插件（2026-11-10 实测）；
2. 日志（`~/.dsh/logs/desktop-next-<日期>.*.jsonl`）grep `aiyayi-feishu`，看到「已就绪」＝成功；
3. 让用户在飞书里给机器人随便发一条消息 → 自动新建 aiyayi 会话并绑定（mappings.json 生成、回复回到该 chat）。
   - 若要路由到**指定 DSH 会话**（如 GUI 会话）：让用户**首条消息**发 `绑定会话 <sessionId>`（例：`绑定会话 session-b8785a4a-362a-4e43-8aa6-33410efca76c`）→ bind 分支写映射，之后该 chat 全部消息 route 进目标会话、回复回发。首条是普通正文则会自动新建会话，之后发绑定命令会被当正文（映射已存在走 route 分支）。

## 排障速查

| 日志报错 | 根因 | 修法 |
| --- | --- | --- |
| `patch: entry "aiyayi-feishu" not found` 且**始终没有「已就绪」** | 声明是裸 id 行（坑 #56）或没声明 | 改成 `- insert:` 包裹，触发 HMR |
| `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './feishu' is not defined by "exports"` | 安装版 `package.json` 被回退成发布版（没有 `./feishu` 导出），常伴 `lib/feishu.js` 被删 | 从 dsh-aiyayi 包源（gh_repo）重新部署 `lib/feishu.js`、`lib/feishu-logic.js`、`package.json`、`cordis.patch.yml` 到安装版，再触发 HMR |
| `SyntaxError: Unexpected token '锘?…`（JSON.parse） | config.json/mappings.json 带 UTF-8 BOM | 重写为无 BOM（Node `writeFileSync` 或 PowerShell `UTF8Encoding($false)`） |
| 有「已就绪」但飞书发消息没反应 | 四种候选：后台订阅未配 / **SDK handlers 断线（坑 #58）** / SafetyPipeline 静默丢弃 / 同凭证多个长连接客户端抢消息 | 先用「决定性判据」分诊（见下节），再对症修 |
| 控制台事件日志显示 SUCCESS 但本地零痕迹（无 mappings/回复/warn） | 事件已送达客户端且被 ACK，丢在 SDK→插件管线内：八成是坑 #58（handlers 未接线），少数是 SafetyPipeline 静默丢弃 | 补接线 `channel.handlers.message = fn`（见坑 #58 节）；再查 isStale/去重/策略（都是 debug 级日志，可临时开 debug 看） |
| `处理入站消息失败: ENOENT … realpath '…\feishu\workspaces\feishu-<uuid>'` | 建会话时叶子目录没建就传给 workspaceRegistry.create（坑 #59：它内部只 realpath，不代建） | 先 `mkdirSync(workspacePath,{recursive:true})` 再 create（1.5.14 已修） |
| `处理入站消息失败: permission: unknown preset "[object Object]"` | 把 permissionPresets.resolve() 的返回**对象**传给了 set()（坑 #60：set() 要**名字字符串**，resolve 仅校验） | set 传原始名字（1.5.14 已修） |
| 「已新建并接入」能收到，但**后续消息**没反应且**零日志** | 投递分支静默丢（坑 #61：`ctx.agents.get(id)` 返回**裸 Agent**，`?.agent` 恒 undefined）＋回发读错字段（坑 #62：载荷在 `event.data.message`，不是 `event.message`） | 1.5.14 已修（裸 Agent + event.data.message + turn/end 统一回发防刷屏 #63） |
| 插件 HMR/重载/宿主重启后，之前绑定好的 chat 再发消息**无回复且零日志**（route 分支照常走） | 插件 dispose 时 `controller.abort()` 把 `agents.create` 建的会话连带杀死（坑 #64：会话是宿主资产不是插件资产），getAgent 拿到 null 后旧代码静默 return | 不传插件级 signal（每会话独立从不 abort 的 signal）；deliverToSession 返回布尔，route 投递失败自动新建+重新映射+告知（自愈，1.5.14 已修） |
| `处理入站消息失败: session event "agent/inbox/spliced" carries non-JSON-serializable data` | 投递的消息 source 里有 `undefined` 字段（坑 #65）：宿主 `Session.append` 用 snapshotJsonValue 深拷贝，遇到 undefined 直接判不可序列化 | source 只用 `{ kind: 'user' }`（不含任何 undefined；1.5.14 已修） |
| 只收到「已新建并接入…」模板回复、**始终没有正文回答** | 建会话时 `agentOptions: {}` 没给模型（坑 #67）：宿主 webhook 模板在无 model 时会取 `ctx.agentDefaultModel.currentSelection()`，插件原来传空对象 → agent 没有模型不产回答 | inject 加 `agentDefaultModel`，建会话时照模板取默认选择（1.5.14 已修） |
| 机器人回复后疑似自问自答/刷屏 | 机器人自己发出的消息也会以 `im.message.receive_v1` 推回来（坑 #66），不过滤就会把回复当用户输入再生一轮 | 用 `channel.botIdentity.openId` 比对 `mergedEvent.senderId` 跳过（1.5.14 已修） |
| 控制台事件日志 FAIL（重试后仍失败）或压根无记录 | 当时无客户端在线 / 服务端未投递 | 确认插件「已就绪」且日志有 `ws client ready`；检查后台订阅配置（回读法见 docs/接口清单.md） |

## 决定性判据：消息到底丢在哪一段（2026-11-10 实锤升级）

三层分诊，先服务端后本地：

1. **控制台事件推送日志**（免浏览器可用接口，见 `docs/接口清单.md`「事件推送日志查询」；或控制台页 /app/<app_id>/logs?tab=event）：查 `im.message.receive_v1` 条目——
   - **SUCCESS** = 已送达某个 WS 客户端且被 ACK → 问题在客户端 SDK→插件管线（跳第 3 步）；
   - **FAIL（重试后仍失败）** = 当时无客户端在线或服务端未投递（跳第 2 步）。
2. **连接是否在线**：日志有 `ws client ready` 且无 `closed`；注意同凭证挂多个客户端（如独立测试进程 bot.mjs）时事件**随机分发**会抢消息——排障期间只保留一个客户端。
3. **本地痕迹**：插件收到消息且 handler 跑通必留痕（mappings.json 生成/更新、回复、或 `处理入站消息失败` warn）。**SUCCESS + 零痕迹 ≠ 帧没到，而是 handler 没被接线或被静默丢弃**——先查坑 #58（最常见），再查 SafetyPipeline 的 isStale/去重/策略（全是 debug 级日志）。

辅助：用 tenant_access_token 调 `GET /open-apis/im/v1/messages?container_id_type=chat&container_id=<chat_id>&start_time=<unix秒>&end_time=<unix秒>`（需 `im:message.p2p_msg:readonly`；**查询参数用秒**，条目 `create_time` 是毫秒）确认用户消息确实到达服务端、且发给的是该 bot 的正确 p2p 会话——排除用户侧操作问题。

## 坑 #58：SDK createLarkChannel 丢弃 handlers——消息 ACK 后静默蒸发（2026-11-10 实锤）

- **现象**：插件「已就绪」、WS 在线、后台配置全对、控制台事件日志每条 SUCCESS，但本地零痕迹（无 mappings.json/无回复/无 warn），totalBound 永远 0。**「之前工作正常过」往往是误传**（用经典接线 EventDispatcher.register 的独立测试脚本能收，插件收不到）。
- **机制**（@larksuiteoapi/node-sdk **1.76.0** 实测；SDK lib/index.js）：构造函数 `this.handlers = {}`（106879 行）**从不读 opts.handlers**；`createLarkChannel(opts)`（107359 行）只是 `new LarkChannel(opts)` 原样返回；消息派发处（106902-106912）`const handler = this.handlers.message; if (handler) yield handler(merged)` —— handlers.message 为 undefined 时**静默 no-op、零日志**；而帧泵（102959 行）只要 invoke 不抛错就无条件回 ACK 200 → 飞书后台显示 SUCCESS。
- **修法**：`createLarkChannel({...})` 返回后在 channel 上**显式补接线**：`channel.handlers.message = onMessage`（handlers.message 在派发时才读取，事后赋值有效）。dsh-aiyayi **1.5.14** 已修（gh_repo\lib\feishu.js，部署后 HMR 生效）。
- **教训**：升级 SDK 版本后要回归测试收消息；新 SDK 包装 API（createLarkChannel/LarkChannel）不能只看 TypeScript 类型，要核实运行时行为。

## 坑 #59/#60：建会话链路两连坑——对照宿主模板时别漏语义差异（2026-11-10 实锤）

坑 #58 修好后，事件能进 handler 了，但「new 分支」建会话又连环暴露两层，都出在 `lib/feishu.js createAiyayiSession`：

- **坑 #59（workspace 目录）**：`ctx.workspaceRegistry.create(path)` 的契约是**路径必须已存在**（内部 realpath，不代建；dsh-webhook 的 workspacePath 来自规则配置的既有目录）。插件只 mkdir 了 `feishu\workspaces` 父目录，叶子 `feishu-<uuid>` 没建 → `处理入站消息失败: ENOENT … realpath '…\feishu\workspaces\feishu-<uuid>'`。修法：先 `mkdirSync(workspacePath,{recursive:true})` 再 create。
- **坑 #60（permission preset）**：`permissionPresets.resolve(名字)` 返回**已解析对象**，而 `permissionPresets.set(session, x)` 要**名字字符串**（dsh-webhook 模板里 resolve 只作校验、返回值丢弃，set 传原始名字）。插件把 resolve 的返回对象传给 set → `permission: unknown preset "[object Object]" (known: read-only, workspace-write, danger-full-access)`。修法：set 传名字字符串。
- **教训**：照宿主模板（app.asar 内 dsh-webhook createWebhookSession）接线时，逐个调用点核对**参数语义**（名字 vs 解析对象、代建 vs 必须已存在），不能只看"同样调了这个方法"。修复路径上的每个 warn 都是下一层的路标——一条条钉到底。

## 坑 #61/#62/#63：确认回复之后的两条静默断点（2026-11-10 实锤）

收到「已新建并接入」只证明**新建分支**通了，投递分支和回发链路还在后面埋着两颗雷：

- **坑 #61（投递静默丢，零日志最阴险）**：`ctx.agents.get(id)` 返回**裸 Agent**（宿主文档：「句柄只暴露给创建它的消费方」），写成 `get(id)?.agent` 恒 undefined → deliverToSession 无声 return → 后续消息不进会话、无任何日志。
- **坑 #62（回复发不出）**：宿主 assistant/message 事件载荷在 **`event.data.message`**（宿主消费者 asar 59377/301690 行均读 `event.data.message.content`），读 `event.message` 恒 undefined → role 检查恒 false → 回复永远发不出。
- **坑 #63（防刷屏）**：一轮 turn 里 assistant/message 按 step 渐进追加（多条事件），逐条回发会把一条回复拆成 N 条 → 攒每会话最新文本，`turn/end` 统一回发一条（`turn/start` 兜底冲残留）。
- **教训**：端到端验证要**每种代码路径各来一条真实消息**（新建 / 投递 / 回发）；「收到模板确认回复」≠ 链路通。静默 return 路径零日志，只能对照宿主模板+文档逐调用点核对。

## 坑 #64：插件生命周期 abort 会杀死它建的会话——静默 return 的第三处（2026-11-10 实锤）

- **现象**：「已新建并接入」收到过、mappings 有映射，但插件某次 HMR 重载后该 chat 再发消息**无回复且零日志**（route 分支照常找到 sessionId，会话却已死）。
- **机制**：插件持有 `controller = new AbortController()` 并把 `controller.signal` 传给 `agents.create({signal})`，同时注册 `ctx.effect(() => () => controller.abort())`——**插件每次重载 dispose 都会 abort 这个信号**，宿主随即将插件建的会话一并 dispose（12:58:42 日志 `agent "feishu-bfb53970-…": agent/disposed listener threw: TypeError: Cannot read properties of undefined (reading 'catch')` 即死亡现场）。之后 route 分支 `getAgent` 拿到 null → 旧代码静默 return，消息蒸发。
- **修法**：①会话是宿主资产不是插件资产——每会话给一个从不 abort 的独立 signal（`new AbortController().signal`），不传插件级 controller；②`deliverToSession` 返回布尔，route 分支投递失败就自动新建会话、重新映射、告知用户并把消息投进去（自愈）；③防御 `Promise.resolve(channel.disconnect()).catch()`（SDK disconnect 在 WS 未初始化时返回 undefined，直接 `.catch` 会 TypeError）。1.5.14 已修。
- **教训**：宿主对象（会话/agent）的生命周期归宿主管，插件清理代码别越界连坐；投递失败走自愈（自动重建+告知）比静默或报错都更能兜住未知的会话回收路径。

## 坑 #65/#66/#67：投递内容、自消息过滤、默认模型（2026-11-10 实锤，前面几层修通后才暴露）

- **坑 #65（source 里有 undefined → 投递必失败）**：宿主 `Session.append` 用 `snapshotJsonValue`/`walkJsonValue` 深拷贝事件数据，**遇到 `undefined` 直接返回 undefined**，于是抛 `session event "agent/inbox/spliced" carries non-JSON-serializable data`（asar 1976372-1976373 的 append 校验 + walkJsonValue：非 null/boolean/string/number/object 一律判失败）。旧 source 写了 `senderId: undefined` → 每条消息投递都失败。修：source 只用 `{ kind: 'user' }`（`MessageSourceMap` 里最简单的合法取值，也是宿主自建用户消息同款），**绝不放 undefined 字段**。
- **坑 #66（自消息回环）**：机器人自己发出的消息也会以 `im.message.receive_v1` 推回来并进同一个 handler，不过滤就会把「已新建并接入…」「正式回答」当用户输入再喂一轮（自问自答）。修：`channel.botIdentity.openId`（connect 时 fetchBotIdentity 填充）与 `mergedEvent.senderId` 相同则跳过。参考：昨晚测试脚本 bot.mjs 就靠 `sender_type === 'app'` 过滤。
- **坑 #67（没模型 → 只有模板回复没有正文）**：宿主 webhook 模板在 `model === undefined` 时取 `ctx.agentDefaultModel.currentSelection()` 作为 `agentOptions`（asar 2187436-2187439）；插件原来传 `agentOptions: {}`，agent 可能没有可用模型 → 会话能建、模板回复能发，但永远产不出正式回答。修：`inject` 加 `agentDefaultModel`，建会话时 `ctx.agentDefaultModel.currentSelection()` 取默认选择。
- **本地可复现的验证手法**：不必等用户，用脚本复刻宿主的序列化判定（walkJsonValue 语义：undefined/function/symbol/bigint/NaN/-0/稀疏数组/非纯对象 → 失败），对比新旧 source 形状即可判定投递会不会失败；机器人身份与发送链路可用 `tenant_access_token` + `bot/v3/info`、`im/v1/messages` 直接自检。

## 已固化：CDP 自主创建飞书机器人（2026-11-10 实锤，请求清单见 docs）

一条命令重建飞书机器人的全链路已真实跑通**两次**：验证应用 aiyayi-test（cli_aa780cef4c79dc00）与脚本验证应用 **aiyayi-script-test（cli_aa7803a415789c16，v1.0.0 已上线 appStatus=1，2026-11-10 一口气创建成功，全程无人工）**。**完整请求清单与参数说明在工作区 `docs/经验-飞书机器人创建全流程与请求清单.md`**（含本次实跑更新的坑 9-13）。脚本已封装，直接跑：

```bash
# 一条命令全链路（自动 CDP bootstrap 取 csrf+cookie、自动生成并上传图标；
# v5 起未登录会自动引导手机飞书扫码，登录后继续）
node scripts/create-bot.js create --name "aiyayi-xxx" --desc "用途说明" [--icon <png>] [--member <open_id>] [--port 9222] [--login-wait <秒>]
# 状态汇总（appStatus=1 即上线）
node scripts/create-bot.js verify --app-id <app_id>
# 取 AppSecret（接口直读，不明文打印）
node scripts/save-secret.js --app-id <app_id> [--out <路径>]
```

速查版步骤序列（脚本已内置，此处为原理）：

1. **授权**：Edge 带 `--remote-debugging-port=9222 --profile-directory=Default` 起（保留登录态）。**CSRF（2026-11-10 更正）**：`x-csrf-token` 必须用**页面 HTML 内嵌的 `window.csrfToken`**（每页加载重签发；cookie `lark_oapi_csrf_token` 的值已作废）；Cookie 头必须含 **httpOnly `session`**（document.cookie 拿不到，用 CDP `Network.getAllCookies`）。不带 token → 9499「csrf token check fail」；缺 session → 99991641「session is invalid」。
2. **先传图标**：POST `/developers/v1/app/upload/image`（multipart：`file` + `uploadType=4` + `isIsv="false"`）→ `data.url`。**avatar 必填**，`app/create` 传空会在发布时被拦（坑 9）。
3. **创建应用**：POST `/developers/v1/app/create` body `{"appSceneType":0,"name":"<英文名>","desc":"...","avatar":"<上一步 url>","i18n":{"zh_cn":{...}},"primaryLang":"zh_cn"}` → `data.ClientID` = appId。
4. **开机器人**：POST `/developers/v1/robot/switch/{app_id}` `{"enable":true}`；POST `/developers/v1/developer_panel/menu_ability` `{"clientId":"{app_id}","ability":["bot"]}`。
5. **配权限**：POST `/developers/v1/scope/all/{app_id}` `{}` → **响应里 `scopes[]`（1332 个）带数字 id**（scope/search、scope/relation 都不给 id）；POST `/developers/v1/scope/update/{app_id}` body `{"appScopeIDs":["<数字id>"],"userScopeIDs":[],"scopeIds":[],"operation":"add","isDeveloperPanel":true}`。常用：im:message=20001、im:message:send_as_bot=1000、im:chat=21001、im:chat:read=1014181、im:message.p2p_msg:readonly=3000、im:message.group_at_msg:readonly=3001。
6. **事件订阅长连接**：先 POST `/developers/v1/event/switch/{app_id}` `{"eventMode":4}`（4=长连接），再 POST `/developers/v1/event/update/{app_id}` `{"operation":"add","events":[],"appEvents":["im.message.receive_v1","im.chat.access_event.bot_p2p_chat_entered_v1"],"userEvents":[],"eventMode":4}`（v5 起默认带 `bot_p2p_chat_entered_v1`：用户进入与 bot 的 P2P 单聊时触发、权限要求=无、事件体含 chat_id+operator_id，供新会话扫码接入自动绑定）。
7. **取凭证**：**POST `/developers/v1/secret/{app_id}`（body `{}`，需先 GET `/app/{app_id}/baseinfo` 从 HTML 提 window.csrfToken + getAllCookies 全量 cookie）→ `data.secret` 即明文**，用 `save-secret.js`。⚠️ 旧「CDP 点眼睛」路线已废弃：点击会把 open.feishu.cn 渲染进程卡死（坑 11）。
8. **发布**：POST `/developers/v1/app_version/create/{app_id}`（body 见 docs）→ `data.versionId`；POST `/developers/v1/publish/commit/{app_id}/{version_id}` `{}` → 提交发布。
9. **上线（免审核，2026-11-10 实锤）**：本企业发布免审核，commit 后异步生效，轮询 `/developers/v1/app/{app_id}` 直到 `appStatus=1` 即上线；管理后台审核页无待审项。若出现待审状态（历史情况）才需人工去 `{企业域名}.feishu.cn/admin/appCenter/audit`。删除草稿版本：POST `/developers/v1/app_version/delete/{app_id}/{version_id}`（有未发布草稿时"创建版本"按钮 disabled）。

脚本化注意：全程 HTTP 直调（含上传的 multipart，Node 零依赖手拼）＋ CDP 只用于取 cookie/csrf；React 受控组件赋值必须用原生 setter（详见 docs 坑 #2）；UI 文件选择自动化在 Edge 157 全灭（坑 10），接口真相从前端 bundle 挖。

> 注：SKILL.md 排障表里曾引用 `docs/接口清单.md`，该文件在本机未找到（可能丢失），事件日志查询的接口写法见 `docs/经验-飞书bot收不到消息三层分诊.md`。

## 新会话扫码接入飞书（2026-11-10 改造）

用户在 DSH GUI 开了个新会话、想在手机飞书上随时找它的完整链路（改造落点：`gh_repo/lib/feishu.js`、`gh_repo/lib/feishu-logic.js`、`scripts/create-bot.js` v5；机制细节与验证步骤见经验文档文末「新会话扫码接入飞书」节）：

1. **引导**：新会话首轮回复后（挂 `turn/end`），插件检测该会话未绑定飞书 chat 且未引导过（`feishu/guided.json`）→ followup 注入引导话术（建议接入/先下载飞书 app/扫码→点开机器人/「不用」跳过）。宿主**没有回复前拦截 API**，故实现为「首答后紧跟引导」而非回复前，agent 下一轮自然回复它。
2. **待接入目标**：会话里说「接入飞书/接飞书/绑定飞书…」（`matchOnboardIntent`）→ 写 `feishu/pending-bind.json`（sessionId+createdAt，**30 分钟时效**，超时自动作废防误绑）→ 注入确认+扫码步骤；说「不用/跳过」（`matchSkipIntent`）→ 清 pending + 标记已引导。
3. **自动绑定**：用户手机飞书扫码进入 bot 单聊 → `im.chat.access_event.bot_p2p_chat_entered_v1`（SDK 默认 5 类事件之外，`channel.dispatcher.register` 补注册，connect 前挂上即可）→ 有待接入目标则写 `mappings[chat_id]=目标 sessionId`、清 pending、回 chat 确认；无目标仅日志不绑定。
4. **防自触发的坑**：插件 followup 注入的消息同样触发 `agent/inbox/spliced` 事件，若检测逻辑认不出自己的注入文本会「注入→再检测→再注入」死循环——注入文本带零宽字符前缀 `\u2060`（GUI 几乎不可见），检测函数据此前缀跳过。`agent/inbox/spliced` 的 inserted 与真实用户消息形状相同（source 都是 `{kind:'user'}`），只能靠前缀区分。
5. **验证顺序**（发版重装后）→ 会话首问看日志「未绑定飞书，注入接入引导」→ 说「接入飞书」看「已记待接入目标」+ pending-bind.json → 飞书进 bot 单聊看「已自动接入会话」+ mappings.json 新增 → 回「不用」看 pending 清除。
