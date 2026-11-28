# apk/ — 二期规格占位：Android WebView 壳 APP

## 定位

Android WebView 壳，唯一入口界面 = launcher 面板（`127.0.0.1:3081`）。

## 功能按钮（全部）

- 启动 / 停止引擎
- 看日志
- 跳转打开 DSH 页面：`ACTION_VIEW` intent 交给系统浏览器，打开 `127.0.0.1:3080`

**不嵌 DSH 界面**——壳只管引擎启动与日志监控，DSH 页面一律走系统 Chrome。

## 权限

- `INTERNET`
- `FOREGROUND_SERVICE`（保活面板服务）

## 参考项目

DSH-Go 源码仓：App 侧 WebView 壳 + proot 拉起机制（考古进行中）。

## 编译环境

家里机 / 单位机安装 Android SDK 编译；**不在手机 proot 里编译**。
