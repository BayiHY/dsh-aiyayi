# 阿依娅伊插件部署指南

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
