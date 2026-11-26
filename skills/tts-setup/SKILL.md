---
name: tts-setup
description: '让 DSH 网页朗读用上「✦ 晓晓（微软在线）」：在一台新设备上架起 edge-tts 本地合成桥（127.0.0.1:52123，随包 scripts/edge_tts_server.py，单文件仅 stdlib+edge-tts）。Windows 口径：pip 装 edge-tts 前先确认 python 指向哪套环境、脚本拷到自有工具区再跑（技能目录会被升级覆盖同步）、pythonw.exe 无窗运行、WMI Win32_Process.Create 脱 DSH 作业树拉起（Start-Process 拉的会被 DSH 重启连带杀）、HKCU Run 键开机自启（免管理员无窗）、验活三连（/health、/tts 看 200+audio/mpeg+mp3 头 ff f3、/logs）。Android（DSH-Go proot）口径：nohup python3 拉起，127.0.0.1 与手机浏览器共享网络栈，桥与 App 同生死。含客户端引擎切换方法与已知坑清单（stream_sync 同步生成器/只收 audio 块/别调 finish/pythonw 无 stdout/微软在线接口属逆向调用会静默失效）。当用户要晓晓朗读、TTS 红闪或没声、新设备要架 TTS 桥、或问晓晓哪来的时使用。'
whenToUse: 用户要开「✦ 晓晓」朗读或桥没声/红闪；/health 不通或 /tts 502；在一台新设备（Windows/Android）上架 TTS 桥；用户问晓晓音色怎么来的。
---

# tts-setup

给 DSH 网页端朗读开关换上微软晓晓的嗓子。客户端默认走浏览器系统语音；切到「✦ 晓晓（微软在线）」后，页面把文本 GET 给本机的 edge-tts 合成桥（默认 `http://127.0.0.1:52123/tts`），拿流式 mp3 回来播。**桥没跑 = 朗读红闪 ⚠ + 自动重试一次后静默无声**——本技能就是在设备上把这座桥立起来。

> ⚠️ 动手前三条红线：
> 1. **别在技能目录里跑脚本**——包内 `skills/tts-setup/` 会被插件升级整目录覆盖同步，先把 `scripts/edge_tts_server.py` 拷到本设备自有工具区再运行（日志也落在脚本所在目录）；
> 2. 微软在线接口属**逆向调用**（edge-tts 生态调微软未公开接口），协议变更会全体静默失败——桥健康（/health=ok）但 /tts 失败时，先怀疑上游变了，别急着改脚本；
> 3. 本手册面向「我」（跑在各设备上的 agent）架桥用，也供其他 DSH 用户参考。

## 客户端侧事实（先读再动手）

- **引擎开关**：dsh web 页面右侧的 🔊/🔇 浮动开关，**右键**弹出引擎菜单，在「✦ 晓晓（微软在线，音色 zh-CN-XiaoxiaoNeural）」与「系统语音」之间互切；当前是晓晓时按钮带 ✦ 徽标。
- **localStorage 键**（DevTools 可直接设）：
  - `dsh-aiyayi-tts.engine` = `'edge'` → 切晓晓（1.19.0 引入引擎切换）；
  - `dsh-aiyayi-tts.endpoint` = 完整 `/tts` URL（如 `http://192.168.x.x:52123/tts`）→ 覆盖桥地址；设空或删除该键回默认 `http://127.0.0.1:52123/tts`（1.20.0 引入，可指向另一台机器的桥）。
- **失败信号**：红闪 ⚠ + 1.5 秒自动重试一次，仍失败静默回退无声——看见红闪就是桥的问题，不是客户端的。
- **播放方式**：`<audio src>` 直指桥 URL 流式播放，边合成边播（1.20.1），长句开口延迟约 1.5 秒（首字节时间）；「攒齐再返回」的旧式桥也兼容。
- 客户端请求固定带 `rate=+10%` 参数，脚本校验格式（`[+-]\d{1,3}%`）合法才透传上游。

## Windows 架桥（单位机/家里机实测口径）

### 1. python 环境装 edge-tts

1. **先确认 python 命令指向哪套环境**：`python -c "import sys; print(sys.executable)"`——PATH 里常有多套 Python/conda，装到 A 套、拉起用了 B 套的 pythonw 就是 ImportError；
2. `pip install edge-tts`（7.x），验证 `python -c "import edge_tts; print(edge_tts.__version__)"`；
3. 记下这套环境对应的 **pythonw.exe 路径**（第 3、4、5 步全用它）。

### 2. 拷脚本到自有工具区

从技能目录（装版在 `~/.dsh/profiles/desktop/node_modules/dsh-aiyayi/skills/tts-setup/scripts/edge_tts_server.py`）拷到本设备自有工具区（如 `D:\阿依娅伊\工具\`）。技能目录随包升级被整目录覆盖，跑在里面日志和本地改动都会丢。

### 3. pythonw.exe 无窗运行

`"<pythonw路径>" "<工具区>\edge_tts_server.py"`——pythonw 是无控制台版 python，**绝不弹黑窗**；测试期可故意用 python.exe 看报错，正式跑一律 pythonw。脚本自带单实例守卫（先探 127.0.0.1:52123，已有实例监听即退出），重复拉起无害。

### 4. 拉起：WMI 脱 DSH 作业树（别 Start-Process）

从 DSH 会话里 `Start-Process` 拉起的进程挂在 DSH 的父链/作业树之下，DSH 重启会被连带杀掉。用 WMI 拉起，父链挂到 WmiPrvSE，DSH 重启杀不到：

```powershell
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = '"C:\path\to\pythonw.exe" "D:\阿依娅伊\工具\edge_tts_server.py"'
}
```

脚本日志按自身所在目录落，无 cwd 依赖，不用指定工作目录。

### 5. 开机自启：HKCU Run 键（免管理员、登录无窗）

```powershell
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'EdgeTTSBridge' `
  -Value '"C:\path\to\pythonw.exe" "D:\阿依娅伊\工具\edge_tts_server.py"'
```

不用别的方案的原因：schtasks 注册任务要管理员（普通权限会拒）；启动文件夹放 bat/vbs 登录时会弹窗闪黑框。HKCU Run 免管理员、登录即拉、配 pythonw 全程无窗。

### 6. 验活三连

1. `curl http://127.0.0.1:52123/health` → `ok`；
2. `curl "http://127.0.0.1:52123/tts?text=你好" --max-time 20 -o test.mp3 -s -w "%{http_code} %{content_type}\n"` → `200 audio/mpeg`，且 mp3 文件头是 `ff f3`（`Format-Hex test.mp3 -Count 3` 看）——收到 HTML/JSON 说明上游接口变了；
3. `curl http://127.0.0.1:52123/logs` → 有刚才那条 TTS 记录（voice/text_len/bytes/耗时）。

/health 通但 /tts 502 = edge_tts 导入失败或上游异常，/logs 里看 `TTS init fail`。

### 7. 客户端切到晓晓

右键朗读开关 → 引擎菜单 → 「✦ 晓晓（微软在线）」，或 DevTools `localStorage.setItem('dsh-aiyayi-tts.engine','edge')`；桥不在本机默认地址就再设 `dsh-aiyayi-tts.endpoint`。让会话回一条消息听声验收。

## Android 架桥（DSH-Go proot）

- 脚本同款（纯 stdlib + edge-tts，无平台分支）：proot 里 `pip install edge-tts`，然后 `nohup python3 edge_tts_server.py >/dev/null 2>&1 &`——安卓没有 pythonw/WMI/注册表那套，nohup 即可。
- 监听 127.0.0.1:52123，**proot 与手机浏览器共享网络栈**：手机浏览器里的 DSH 页面直接连 `http://127.0.0.1:52123/tts` 就通，不用折腾局域网地址。
- **桥与 DSH-Go App 同生死**：App 被杀（划掉后台/系统回收）桥就没了，App 重启后要重新 nohup 拉起——安卓侧不设开机自启，把「App 重启后重拉桥」记进该设备的工具习惯。
- 验活三连同上（proot 里自带 curl）。

## 已知坑（多设备实测，别改回）

| 坑 | 机制 | 正确姿势 |
| --- | --- | --- |
| `async for` 报 `__aiter__` | edge-tts 7.x 的 `stream_sync()` 是**同步生成器**，不是异步迭代器 | 普通 `for chunk in gen` 迭代 |
| 音频流出杂音/坏流 | 流里混着 WordBoundary/SentenceBoundary 元数据块，不是音频 | 只收 `chunk.get('type')=='audio'` 的块（7.x 块键小写 `{"type","data"}`） |
| 收尾抛 ValueError | 手写 chunked 终止块后又调 `self.finish()`，http.server 内部 flush 已关闭的文件 | 终止块 `b'0\r\n\r\n'` 写完就完，**别调 finish()**，让 http.server 自然收尾 |
| pythonw 下日志炸 | pythonw 无 stdout/stderr，`sys.stderr` 为 None，`BaseHTTPRequestHandler.log_message` 默认写 stderr 会崩 | 覆写 `log_message` 为空；日志走文件+内存双通道（`/logs` 端点），文件超 1MB 自动截尾到 200KB 防膨胀 |
| cpSync 复制非 ASCII 源路径崩 | Node22/Windows 下 `cpSync` 遇中文路径会崩 | 包内 skills 同步机制已规避；人工拷贝单个文件不经 cpSync，没这问题 |
| 桥健康但 /tts 全失败 | 微软在线接口属逆向调用，协议/风控变更会**全体静默失败** | 先 `/logs` 看 502 与 `TTS init fail`，再查/升级 edge-tts 版本；客户端侧信号是红闪 ⚠ + 1.5s 重试一次后静默 |
| 重复拉起第二个实例 | 端口被占 | 脚本自带单实例守卫：启动先探 127.0.0.1:52123，已在监听就退出，无害 |

## 技能性质说明

- 这是给「我」（跑在各设备上的 agent）看的**架桥手册**：到一台新设备让晓晓开口，照 Windows / Android 两节走；也供其他 DSH 用户参考——桥是独立进程，与 DSH 生命周期解耦（Windows 用 WMI+Run 键彻底脱钩），装一次一直能用。
- 脚本正本随包分发：`skills/tts-setup/scripts/edge_tts_server.py`，单文件，仅 stdlib + `edge-tts`（7.x），无其他依赖；各设备自有工具区里跑的是它的拷贝，升级插件不会影响在役桥。
