---
name: feishu-setup
description: 阿依娅伊飞书桥接（aiyayi-feishu 宿主插件）的安装、配置与排障：装 SDK、写 profile patch 声明（insert: 包裹）、写凭证 config.json、触发 HMR、以日志「已就绪」判定生效，及飞书开发者后台的长连接订阅设置。已知报错三种（not-found / ERR_PACKAGE_PATH_NOT_EXPORTED / BOM）各有对症修法。当用户要接飞书、桥接断线、或会话里 feishu_status 报 configured=false 时使用。
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
| 有「已就绪」但飞书发消息没反应 | 飞书后台侧没配好 | 后台确认：订阅方式=长连接、已添加 `im.message.receive_v1`、版本已发布；机器人已在对话里 |

## 待固化（实测后回填）

- **CDP 自主创建飞书机器人**：用户浏览器带 `--remote-debugging-port` → `aiyayi_cdp` 接管 → 自动走「创建应用→读凭证→配长连接订阅→发布」，登录/验证码/管理员确认等敏感点由用户配合。等一次真实跑通后，把实际步骤、断点、授权配合点补进本节，并同步固化到 dsh-aiyayi 插件。
