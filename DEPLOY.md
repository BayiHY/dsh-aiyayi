# 阿依娅伊插件部署指南

## 发布流程（维护者用）

发新版按此顺序（2026-11-05 起）：

1. **bump 版本**：同时改 `bundle/package.json` 与 `gh_repo/package.json` 的 `version`（两处必须一致，bundle 是 npm 发布源、gh_repo 是 git 仓库）。
2. **发布 npm**：工作区根跑 `node publish.mjs`（实际执行 `npm publish --registry=https://registry.npmjs.org/`，凭据在用户级 `.npmrc` 的 `//registry.npmjs.org/:_authToken=`）。先 `node publish.mjs --dry` 干跑看打包内容。
3. **验证 npm**：`https://registry.npmjs.org/dsh-aiyayi/latest` 的 `version` 字段。注意发布输出会提示"being processed, may take a few minutes"，刚发布完可能仍显示旧版本，等几分钟再查。
4. **提交 git**：gh_repo 里 `git add package.json README.md lib/* DEPLOY.md` → commit（消息格式 `1.2.x：<改动摘要>`）。
5. **推送到 gitcode + gitee**（GitHub 公开仓库连不上——2026-11-06 发布 1.2.7 时换网络环境实测仍 `Connection was reset`，维持不推）：
   ```
   git push gitcode main
   git push gitee main
   ```
   remote 已配置：`gitcode` = https://gitcode.com/BayiHY/dsh-aiyayi.git，`gitee` = https://gitee.com/BayiHY/dsh-aiyayi.git，`github` = https://github.com/BayiHY/dsh-aiyayi.git（remote 已加，网络恢复后 `git push github main` 即可补推；推送凭据在 `~/.git-credentials`，账号 BayiHY）。
6. **本地生效**：本地 profile 里 `dsh-aiyayi` 是 junction 指向 `bundle/`（`link:` 依赖），bundle 改了本地即生效，无需重装 npm 包；**但 bundle 内 JS 改动要重启 DSH 才生效**（README 坑 #13：patchReload 不拾取）。

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
注：GitHub 公开仓库暂不可用（网络原因），当前推荐使用 npm 方式安装。
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
