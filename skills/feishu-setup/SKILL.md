---
name: feishu-setup
description: '阿依娅伊飞书桥接（aiyayi-feishu 宿主插件）的安装、配置与排障：装 SDK、写 profile patch 声明（insert 包裹式声明）、写凭证 config.json、触发 HMR、以日志「已就绪」判定生效，及飞书开发者后台的长连接订阅设置。已知报错多种（not-found / ERR_PACKAGE_PATH_NOT_EXPORTED / BOM）各有对症修法；已实锤的坑还有 SDK createLarkChannel 丢弃 handlers（坑 #58，消息 ACK 后静默蒸发）。当用户要接飞书、桥接断线、或会话里 feishu_status 报 configured=false 时使用。'
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
- 只改 patch 文件的 mtime 不会触发 HMR；要**改内容**（如 Add-Content 追一行注释）。

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

1. 对 profile 根 patch 追加一行注释（如 `# feishu reload`）改内容触发重载；
2. 日志（`~/.dsh/logs/desktop-next-<日期>.*.jsonl`）grep `aiyayi-feishu`，看到「已就绪」＝成功；
3. 让用户在飞书里给机器人随便发一条消息 → 自动新建 aiyayi 会话并绑定（mappings.json 生成、回复回到该 chat）。

## 排障速查

| 日志报错 | 根因 | 修法 |
| --- | --- | --- |
| `patch: entry "aiyayi-feishu" not found` 且**始终没有「已就绪」** | 声明是裸 id 行（坑 #56）或没声明 | 改成 `- insert:` 包裹，触发 HMR |
| `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './feishu' is not defined by "exports"` | 安装版 `package.json` 被回退成发布版（没有 `./feishu` 导出），常伴 `lib/feishu.js` 被删 | 从 dsh-aiyayi 包源（gh_repo）重新部署 `lib/feishu.js`、`lib/feishu-logic.js`、`package.json`、`cordis.patch.yml` 到安装版，再触发 HMR |
| `SyntaxError: Unexpected token '锘?…`（JSON.parse） | config.json/mappings.json 带 UTF-8 BOM | 重写为无 BOM（Node `writeFileSync` 或 PowerShell `UTF8Encoding($false)`） |
| 有「已就绪」但飞书发消息没反应 | 四种候选：后台订阅未配 / **SDK handlers 断线（坑 #58）** / SafetyPipeline 静默丢弃 / 同凭证多个长连接客户端抢消息 | 先用「决定性判据」分诊（见下节），再对症修 |
| 控制台事件日志显示 SUCCESS 但本地零痕迹（无 mappings/回复/warn） | 事件已送达客户端且被 ACK，丢在 SDK→插件管线内：八成是坑 #58（handlers 未接线），少数是 SafetyPipeline 静默丢弃 | 补接线 `channel.handlers.message = fn`（见坑 #58 节）；再查 isStale/去重/策略（都是 debug 级日志，可临时开 debug 看） |
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

## 待固化（实测后回填）

- **CDP 自主创建飞书机器人**：用户浏览器带 `--remote-debugging-port` → `aiyayi_cdp` 接管 → 自动走「创建应用→读凭证→配长连接订阅→发布」，登录/验证码/管理员确认等敏感点由用户配合。等一次真实跑通后，把实际步骤、断点、授权配合点补进本节，并同步固化到 dsh-aiyayi 插件。
