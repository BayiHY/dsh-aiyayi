# aiyayi-launcher

极轻量 DSH 引擎启动器。运行在 Android proot 环境内，面板地址 `127.0.0.1:3081`；受管实例（launcher 自己管理的 DSH 实例）端口 `3082`。

## 功能边界

只做四件事：

- 引擎启动 / 停止 / 状态查询
- 日志监控

明确**不做**：

- 不嵌入、不反代、不缓存 DSH 界面
- 只保留一个跳转按钮，调系统 Chrome 访问 `127.0.0.1:3080`（DSH 官方页面）

## 两步形态

| 阶段 | 形态 | 目录 |
| --- | --- | --- |
| 一期 | PWA（Python stdlib 单文件面板） | `pwa/` |
| 二期 | 正经 Android APK（WebView 壳） | `apk/` |

一期代码暂驻运行位 `/root/workspace/aiyayi-launcher/`（proot 内直接运行），MVP 验收通过后同步进本仓 `pwa/`。

## ★ 红线（不可违反）

1. **3080 官方引擎进程绝不允许被 launcher 杀掉或重启**——launcher 只管自己拉起的 3082 受管实例。
2. `/api/exec` 默认 `exec_enabled: false` 锁死，除非显式开启，任何路径不得绕过。
