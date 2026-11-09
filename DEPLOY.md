# 阿依娅伊插件部署指南

## 当前发布状态

| 渠道 | 版本 | 位置 |
|---|---|---|
| npm | **1.5.4** | https://www.npmjs.com/package/dsh-aiyayi |
| GitCode | **1.5.4**（b57eb38） | https://gitcode.com/BayiHY/dsh-aiyayi |
| Gitee | **1.5.4**（b57eb38） | https://gitee.com/BayiHY/dsh-aiyayi |
| GitHub | 1.4.4（未推） | 需先配 SSH 密钥，见下 |

最近发布：2026-11-09，1.5.4（记忆根目录可迁移：`location.json` 指路文件 + `lib/home.js` 唯一路径出口；新增 `memory_location` / `memory_relocate` 双工具；硬失败与防误判加固）。

**GitHub 推送口径（2026-11-09 更正：原"未推/无密钥"记载已过时）**：`~/.ssh/github_ed25519` 密钥已配好可用，github 走 SSH 推送正常（remote `github` = git@github.com:BayiHY/dsh-aiyayi.git）。HTTPS 才是被 SNI 阻断的死路，别试。注意 SSH 只能推已有仓库，**建新仓要走网页或可达网络下的 API**。

**GitCode 认证方式变更（2026-11-09 实测；同日更正 token 记载）**：密码式 git 认证已停用（`remote: The password-based authentication of Git has been removed. Please use your personal access token instead`）。必须用 personal access token，但凭证**不在**用户级环境变量 `GITCODE_TOKEN`——该环境变量实测已不存在（Process/User/Machine 三域及注册表均查无），实际由 **git credential manager** 保存，直接推即可：

```powershell
git push gitcode main   # 凭证由 git credential manager 提供，无需把 token 拼进 URL
```


## 发布流程（维护者用）

发新版按此顺序（2026-11-05 起）：

1. **bump 版本**：改 `gh_repo/package.json` 的 `version`（2026-11-08 起 npm 发布源就是 gh_repo/，publish.mjs 直接打包它；旧 `bundle/` 目录已归档为工作区 `dsh-aiyayi-bundle-1.4.0.zip`，不再维护）。
2. **发布 npm**：工作区根跑 `node publish.mjs`（实际执行 `npm publish --registry=https://registry.npmjs.org/`，凭据在用户级 `.npmrc` 的 `//registry.npmjs.org/:_authToken=`）。先 `node publish.mjs --dry` 干跑看打包内容。
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
