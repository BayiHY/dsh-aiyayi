# pwa/ — 一期：Python 面板（PWA）

Python stdlib 单文件面板，代码目前暂驻运行位 `/root/workspace/aiyayi-launcher/`（proot 内运行），MVP 验收后同步入仓到本目录。

## MVP 功能清单

- `GET /` — 面板页
- `GET /api/status` — 引擎状态
- `POST /api/start` — 启动受管引擎（3082）
- `POST /api/stop` — 停止受管引擎
- `GET /api/logs` — 日志监控
- `GET /api/config` — 配置读取
- `POST /api/exec` — 命令执行，**默认 `exec_enabled: false` 锁死**
- PWA `manifest` + `service worker`（sw）

> 红线见上级 [README.md](../README.md)：3080 官方引擎进程绝不允许被 launcher 杀/重启。
