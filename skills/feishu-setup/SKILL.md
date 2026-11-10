---
name: feishu-setup
description: '阿依娅伊飞书桥接（aiyayi-feishu 宿主插件）的安装、配置与排障：装 SDK、写 profile patch 声明（insert 包裹式声明）、写凭证 config.json、触发 HMR、以日志「已就绪」判定生效，及飞书开发者后台的长连接订阅设置。已知报错多种（not-found / ERR_PACKAGE_PATH_NOT_EXPORTED / BOM）各有对症修法；已实锤的坑还有 SDK createLarkChannel 丢弃 handlers（坑 #58）、建会话链路（#59 建目录 / #60 preset 按名 set）、投递与生命周期（#61 裸 Agent / #62 事件字段 / #63 防刷屏 / #64 插件 abort 连坐 / #65 source 禁 undefined / #66 自消息回环 / #67 默认模型）。当用户要接飞书、桥接断线、或会话里 feishu_status 报 configured=false 时使用。'
whenToUse: 用户要求新配/重配/修复飞书对接；aiyayi-feishu 相关报错出现在日志；用户问"怎么把娅伊接到飞书"。
---

# feishu-setup

把 aiyayi 会话接入飞书机器人。**三件套缺一不可**，生效判定只认日志里的「已就绪」：

1. **profile patch 声明**——宿主插件不随 bundle 自动启用，要在 DSH profile 根 `cordis.patch.yml` 里声明；
2. **SDK 依赖**——`@larksuiteoapi/node-sdk` 装在 profile（dsh-aiyayi 自身零依赖，不带它）；
3. **凭证**——App ID/Secret 写进记忆根 `feishu/config.json`（UTF-8 **无 BOM**）。

> ⚠️ 本技能当前只含**已实测**的安装/验证步骤（2026-11-10 本机验证通过）。
> 「CDP 自主创建飞书机器人拿凭证」属待固化内容：等一次真实自主创建跑通后回填，
> 在那之前不臆造步骤，凭证获取一律引导用户手动完成。

## 架构事实（先读再动手）

- aiyayi-feishu 是 dsh-aiyayi 包内的**宿主级服务插件**（`lib/feishu.js`），不塞进任何 agent preset；长连接收发、自然语言绑定/新建会话（`绑定会话 <会话名>` / 任意消息默认新建）。
- 纯逻辑（路由/映射/文本抽取）在 `lib/feishu-logic.js`；映射持久化在记忆根 `feishu/mappings.json`（chat_id→sessionId）。
- **坑 #56**：patch 里裸 `- id: aiyayi-feishu / name: dsh-aiyayi/feishu` 行 = 对既有条目的覆盖，目标不存在就 warn `patch: entry "aiyayi-feishu" not found` 后跳过（no-op）。**新增必须用 `- insert:` 包裹**。
- 判定插件在跑：日志 `host.kernel.aiyayi-feishu` 有 `已就绪，记忆根 …（已绑定 N 个 chat）`。`not found` warn 不等于没跑（良性共存），**没有「已就绪」才是没跑**。
- 只改 patch 文件的 mtime 不会触发 HMR；要**改内容**。注意（2026-11-10 实测）：仅 Append 注释行会让 host 处理 patch（日志见 `root patch: entry "…" not found`），但**不会重跑 aiyayi-feishu**（无新「已就绪」）；可靠做法是对 insert 条目做**结构性变更**，如 `config: {}` → `config: {reloadTag: "<标记>"}`，随后日志出现新的「已就绪」= 生效。

## 步骤

### 1. 凭证（没有就先引导用户手动创建）

向用户要 App ID（`cli_` 开头）与 App Secret。用户没有飞书应用时，手动路径：

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

## 待固化（实测后回填）

- **CDP 自主创建飞书机器人**：用户浏览器带 `--remote-debugging-port` → `aiyayi_cdp` 接管 → 自动走「创建应用→读凭证→配长连接订阅→发布」，登录/验证码/管理员确认等敏感点由用户配合。等一次真实跑通后，把实际步骤、断点、授权配合点补进本节，并同步固化到 dsh-aiyayi 插件。
