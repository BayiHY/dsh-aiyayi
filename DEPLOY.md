# 阿依娅伊插件部署指南

## 当前发布状态

| 渠道 | 版本 | 位置 |
|---|---|---|
| npm | **1.5.21** | https://www.npmjs.com/package/dsh-aiyayi |
| GitCode | **1.5.21**（c2cc1be） | https://gitcode.com/BayiHY/dsh-aiyayi |
| Gitee | **1.5.21**（c2cc1be） | https://gitee.com/BayiHY/dsh-aiyayi |
| GitHub | **1.5.21**（c2cc1be，SSH 路） | https://github.com/BayiHY/dsh-aiyayi |

最近发布：2026-11-11，**1.5.21**（修飞书回复正文首尾空白行——**无附件标记**路径；主修 `lib/feishu.js` `extractText(message).trim()`、兜底 `lib/feishu-logic.js` `stripAttachmentMarkers(text).trim()`；坑 #72。npm 发布 2026-11-11T02:41:49Z，tarball sha1 `1a228c30f01776f13b1d13710cb82cf9546ae4bf`，**40 个文件**（比 1.5.20 的 39 个多 1 个 `test/feishu-trim.test.mjs`）；lib/feishu.js SHA256=`124DC5947869542C5E626AA6397D1386AF40F0C85584A0A844B48784B64E92F6`、lib/feishu-logic.js=`C08FA889FD54D27C138377A7F8A26324CEB82E644A57F960EBFF6E668EBDAE57`）。
（上一版：1.5.20，飞书正文改走 interactive 卡片 + lark_md——纯文本 `msg_type=text` 不渲染 markdown；含 1.5.19 附件收发与交互卡片、1.5.20 markdown 渲染，及 create-bot v6 权限集中化。npm 发布 2026-11-11T01:26:23Z，tarball sha1 `6f1df9fb81341d6e449ff0d303aa6c07e7f87c39`，39 个文件；lib/feishu-logic.js SHA256=47442E13…、lib/feishu.js=ADBA20BC…。）

**1.5.21 的 commit 口径（2026-11-11 补）**：1.5.21 的原始 commit 是 `d470d3e`（提交信息「1.5.21：修飞书回复正文首尾空白行（无附件标记路径）…坑 #72」），
曾被一次 `git reset --hard 6808132` 丢弃，后由 `git reflog`（`HEAD@{1}: commit: 1.5.21：…`）找回，
以 `git cherry-pick d470d3e` **干净恢复**为仓库 commit **`c2cc1be`**（父提交 `6808132`，无冲突，作者/提交信息/时间戳原样保留）。
四渠道（npm/gitcode/gitee/github）推的都是 `c2cc1be`。仓库 tag 仍只到 v1.5.16，**1.5.21 无 tag**。

**create-bot v6 的版本口径（2026-11-11 补）**：create-bot v6（`skills/feishu-setup/scripts/create-bot.js`，+1201 行）**不属于任何 npm 版本号**——
它是**内置技能脚本**，不是插件本体代码；随 npm 包一起分发（所以 1.5.20 的 tarball 里含 v6），但**没有自己的版本号**。
它在源码仓**单独成 commit `2c16bee`**，与 1.5.20 的插件改动（commit `2de3f46`）互不依赖。
故上表「1.5.20（2c16bee）」表示的是**四渠道推的都是仓库 HEAD `2c16bee`**，不是「create-bot v6 是 1.5.20 的一部分」。

**npm 发布一览（2026-11-11 核对 registry，`npm view dsh-aiyayi versions --json`）**：latest = **1.5.21**（2026-11-11 发布）。
已发布：1.0.0、…、1.5.7、**1.5.14**、**1.5.15**、**1.5.16**、**1.5.17**、**1.5.20**、**1.5.21**；
跳号 1.3.0、1.4.1、1.4.2、1.5.0、1.5.1、1.5.2、1.5.3、**1.5.8–1.5.13** 从未发布到 npm；
**1.5.18 / 1.5.19 也从未发布到 npm**——它们的代码最终随 1.5.20 一起进 npm。
**版本事实以 npm registry 为准**，本表与 CHANGELOG 顶部「npm 发布一览」保持同一口径。

**git tag 现状（2026-11-11 核对）**：仓库 tag 只到 **v1.5.16**——`v1.5.14` 是 **annotated tag**（指向 commit `1aa4774`），
`v1.5.15` / `v1.5.16` 是 **lightweight tag**（三种语义混用，历史遗留）；**v1.5.17 / v1.5.18 / v1.5.19 / v1.5.20 / v1.5.21 均无 tag**。
另外 **1.5.19 没有独立 commit**（`git log --all | grep 1.5.19` 为空）——它的代码被**并入 1.5.20 的 commit `2de3f46`** 才进仓库，
**别再去找「1.5.19 的 commit」**，那是不存在的。（1.5.18 有自己的 commit `f115874`，但同样**没有 tag**；
另注：该 commit 的**提交信息**里写的是「#70 上传需 im:resource:upload」，属旧笔误——git 历史不可改，
真名订正见 CHANGELOG 坑 #70 / #71：真名是 `im:resource`。）

**版本对齐说明（2026-11-11）**：npm 1.5.21 与源码仓 `c2cc1be` 逐字节一致（2026-11-11 实测：`npm pack dsh-aiyayi@1.5.21` 解包后与源码仓逐文件 SHA256 对照——`lib/feishu.js`、`lib/feishu-logic.js`、`package.json`、`CHANGELOG.md`、`README.md`、`test/feishu-trim.test.mjs` 六个文件全部 MATCH；装进 desktop profile 后 40/40 个文件与官方 tarball 完全相同）。此前 npm 1.5.20 与源码仓 `2c16bee` 亦逐字节一致（`lib/feishu-logic.js`/`lib/feishu.js` SHA256 与源码仓、线上运行副本三方相同）。线上运行目录此前停在 1.5.20，已按下方「本地生效」重装为 1.5.21 对齐版本号。

**GitHub 推送口径（2026-11-09 更正：原"未推/无密钥"记载已过时）**：`~/.ssh/github_ed25519` 密钥已配好可用，github 走 SSH 推送正常（remote `github` = git@github.com:BayiHY/dsh-aiyayi.git）。HTTPS 才是被 SNI 阻断的死路，别试。注意 SSH 只能推已有仓库，**建新仓要走网页或可达网络下的 API**。

**GitCode 认证方式变更（2026-11-09 实测；同日更正 token 记载）**：密码式 git 认证已停用（`remote: The password-based authentication of Git has been removed. Please use your personal access token instead`）。必须用 personal access token，但凭证**不在**用户级环境变量 `GITCODE_TOKEN`——该环境变量实测已不存在（Process/User/Machine 三域及注册表均查无），实际由 **git credential manager** 保存，直接推即可：

```powershell
git push gitcode main   # 凭证由 git credential manager 提供，无需把 token 拼进 URL
```


## 发布流程（维护者用）

发新版按此顺序（2026-11-05 起）：

1. **bump 版本**：改本仓库 `package.json` 的 `version`（**2026-11-09 更正：原记载的 `gh_repo/` 目录与 `publish.mjs` 已不存在**——npm 发布源就是本 git 仓库，1.5.7 即从它手动打包发布；旧 `bundle/` 目录已归档为工作区 `dsh-aiyayi-bundle-1.4.0.zip`，不再维护）。
2. **发布 npm**：在本仓库 `npm pack`（先核对产物文件清单），再 `npm publish dsh-aiyayi-<版本>.tgz --registry=https://registry.npmjs.org/`（凭据在用户级 `.npmrc` 的 `//registry.npmjs.org/:_authToken=`；**2026-11-09 更正：原 `node publish.mjs` 脚本已不存在，改手动两步**）。发布前逐文件 SHA256 对照上一版官方 tarball 确认零漂移，发布后 `npm view dsh-aiyayi version` 验证（registry 处理有几分钟延迟，轮询即可）。
3. **验证 npm**：`https://registry.npmjs.org/dsh-aiyayi/latest` 的 `version` 字段。注意发布输出会提示"being processed, may take a few minutes"，刚发布完可能仍显示旧版本，等几分钟再查（2026-11-07 实测：第一次查仍是旧版、约 15 秒后即返回新版，`npm view dsh-aiyayi version` 轮询最省事）。
4. **提交 git**：gh_repo 里 `git add package.json README.md lib/* DEPLOY.md` → commit（消息格式 `1.2.x：<改动摘要>`）。
5. **推送到 gitcode + gitee + github**：
   ```
   git push gitcode main
   git push gitee main
   git push github main   # 走 SSH（git@github.com:...），HTTPS 被 SNI 阻断推不了
   ```
   remote：`gitcode` = https://gitcode.com/BayiHY/dsh-aiyayi.git，`gitee` = https://gitee.com/BayiHY/dsh-aiyayi.git，`github` = git@github.com:BayiHY/dsh-aiyayi.git（**SSH 形式**）。
   - **GitHub 推送必须走 SSH，HTTPS 不可用**（2026-11-06 实测取证：命令行 TLS ClientHello 带 `github.com` SNI 即被 RST；DNS 干净（官方 IP 140.82.x.x）、TCP 443 全通、裸 IP 握手正常——纯 SNI 阻断，**改 hosts 无效**；api.github.com 同被阻断，REST API 建仓/查仓/推 token 均不通）。首次推送记录：1.2.7 的 980cb10+f0d5200 于 2026-11-06 经 SSH 补推成功。
   - **SSH 配置**（换机器照做）：① `ssh-keygen -t ed25519 -f ~/.ssh/github_ed25519 -N ""`；② 浏览器（需代理）把公钥加到 GitHub → Settings → SSH and GPG keys；③ `~/.ssh/config` 写 `Host github.com` → `User git` + `IdentityFile ~/.ssh/github_ed25519` + `IdentitiesOnly yes`；④ remote 用 SSH 形式。注意 OpenSSH 对 `~/.ssh/config` 强校验 Windows ACL（权限过宽直接拒用）：`icacls <config> "/inheritance:r" "/grant:r" "<用户>:F"` 修复。SSH 22 直连已验证可达（SSH 协议无 SNI，不受阻断影响）。
   - **备路** `ssh.github.com:443`：其 DNS 被污染（解析到假 IP），管理员 hosts 写 `140.82.112.36 ssh.github.com` + `ipconfig /flushdns` 后可用；`~/.ssh/config` 已备 `github-443` 别名，仅当 22 端口被封时启用。
6. **本地生效**：在目标 profile 目录 `pnpm add dsh-aiyayi@<精确版本>`（装到 `profiles\<name>\node_modules\dsh-aiyayi`）。2026-11-08 起旧 bundle junction 已随 `bundle/` 归档废弃；升级后 JS 改动要重启 DSH 才生效（README 坑 #13：patchReload 不拾取）。
   - **安装方式（2026-11-11 实测，装 1.5.20 时踩到）**：desktop profile 是 **pnpm hoisted workspace**（`pnpm-lock.yaml` lockfileVersion 9.0，`pnpm-workspace.yaml` 写 `nodeLinker: hoisted`），**不要用 `npm i` 装**，会破坏 pnpm 的链接结构。
   - 若系统 `pnpm` / `dsh` 命令本身报 MODULE_NOT_FOUND（当时 DSH 的 shim 指向不存在的 `app.asar\node_modules\pnpm\bin\pnpm.mjs` 与 `lib\desktop-cli.js`），改用 DSH 界面里的插件管理升级；命令行兜底可用 `npx --yes pnpm@10 install`（先在该 profile 的 `package.json` 里把 `dependencies.dsh-aiyayi` 改成精确版本，再在 profile 目录执行），装完确认 `pnpm-lock.yaml` 的 lockfileVersion 仍是 9.0。
   - 校验口径：升级后 `node_modules\dsh-aiyayi\lib\` 的 SHA256 应与官方 tarball 完全一致；若线上代码本就等于目标版，重装只改 `package.json` 的版本号，lib 字节不变。

## 快速部署（推荐）

### 前提条件
- 已安装 DeepSeek Harness（DSH）
- Node.js >= 18
- npm 可用

### 安装
在终端执行：
```
dsh plugin add dsh-aiyayi
```

npm 包主页：https://www.npmjs.com/package/dsh-aiyayi

### 使用
1. 打开 DSH，新建会话
2. Agent 预设选择“阿依娅伊”
3. 开始对话

## 方式二：从 GitHub 安装（备选）
注：GitHub 推送已恢复（SSH 路，见发布流程第 5 步）；但国内命令行直连 github.com 常被 SNI 阻断，安装仍推荐 npm 方式。
```
dsh plugin add github:<owner>/dsh-aiyayi#<branch>
```

## 方式三：本地目录安装
将插件源码（含 package.json、cordis.patch.yml、lib\、README.md 等）放到本地目录后：
```
dsh plugin add <本地目录路径>
```

## 安装后使用说明
- 预设名：阿依娅伊（preset-aiyayi）
- 人设：陪伴型 AI 伙伴，女，黑发，说话直接、记得住事
- 记忆：插件首次运行会自动生成记忆文件（从空白开始，不带任何个人数据）
- 定时任务：插件本身不自带闹钟；如需提醒功能，可自行用定时任务创建
- 模型：跟随当前会话所用模型，无需额外配置

## 注意事项
- 安装 bundle 会执行宿主侧代码，DSH 会要求 Full access 或批准
- 若会话激活失败，查看 DSH 启动日志（约 2 秒内会打 warn）
- 插件零依赖（仅用 Node.js 内建模块）
- GitHub 方式需要网络能访问 github.com
