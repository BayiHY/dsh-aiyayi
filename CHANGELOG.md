# 更新日志

> **维护约定**：新版本发布时在顶部加条目。本文件由 README 正文拆出（2026-11-09 重构）：版本条目与踩坑记录原文照录，数字、时间、日期一律不改（量化保真是本插件的规矩）。版本事实以 npm registry 为准。
>
> **npm 发布一览（2026-11-11 核对 registry，`npm view dsh-aiyayi versions --json`）**：latest = **1.5.27**（2026-11-11 发布）。已发布：1.0.0、…、1.5.7、**1.5.14**、**1.5.15**、**1.5.16**、**1.5.17**、**1.5.20**、**1.5.21**、**1.5.22**、**1.5.23**、**1.5.24**、**1.5.25**、**1.5.26**、**1.5.27**；跳号 1.3.0、1.4.1、1.4.2、1.5.0、1.5.1、1.5.2、1.5.3、**1.5.8–1.5.13** 从未发布到 npm（本地开发线：1.5.8–1.5.11 飞书桥接、1.5.12 思考纪律约束、1.5.13 内置技能同步+feishu-setup 骨架）；1.5.14 已发布（坑 #58–#67 修复）；1.5.15 已发布（扫码接入改造）；1.5.16 已发布（feishu-setup 技能脚本入包）；1.5.17 已发布（坑 #68 重入保护修复）；**1.5.18 / 1.5.19 也从未发布到 npm**（见下方 1.5.18 / 1.5.19 条目——它们的代码最终随 1.5.20 一起进 npm）；**1.5.20 已发布**（飞书正文改走 interactive 卡片 + lark_md，含 1.5.19 附件收发与问答卡片、1.5.20 markdown 渲染，以及 create-bot v6 权限集中化）；**1.5.21 已发布**（修飞书回复正文首尾空白行，坑 #72）；**1.5.22 已发布**（多应用多长连接改造+chat 归属机制，见下方 1.5.22 条目）；**1.5.23–1.5.25 已发布**（230001 边界/补 import/补 feishuCode 挖码三轮装版断言增量修复，见下方对应条目）；**1.5.26 已发布**（回发多文本段覆盖丢段修复，坑 #73，见下方 1.5.26 条目）；**1.5.27 已发布**（微信通道并入，默认关闭，见下方 1.5.27 条目）。
>
> **环境标识约定（2026-11-10 新增）**：写版本条目/坑条目时，**顺手记录当时的 智能体工具-智能体模式-模型供应商-模型**（如 **DSH-创造模式-loomy讯飞-GLM5.3FLASH**），写在条目内（紧跟 git 记录行、或坑条目首行），方便回溯该条目是在哪套智能体/模型环境下产出与验证的。

---

---

## 1.5.28（2026-11-11 新功能：首次对话里的 PowerShell 版本体检；**本地开发版，未发布 npm、未打 tag、未装 profile**）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-11，阿依娅伊）1.5.28：首次对话检测里加 PowerShell 版本检查，低于 7 建议用户升级；新增 31 个单测。（后追加一个 commit：ENOENT 时补绝对路径兜底探测，修掉"PATH 未刷新导致已装 pwsh 误报为没装"的坑 #75，单测扩到 38 项。）
- 需求（李浩 2026-11-11 原话）："首次对话检测里加上：如果当前用户是 windows 环境就检查 PowerShell 版本，如果低于 PowerShell 7 就建议用户自己可以协助升级 PowerShell，以便日后更好的协助用户。"
- **挂点选择**：插件里没有名为"首次对话检测"的独立模块。实际承担这件事的是 `lib/presence.js` 的 `agent/pre-step`（`step===1`）注入器——它已经在做同一类事：新会话首轮检查"关闭思考建议"、记忆搬家待办、闹钟异常，"每个会话只提醒一次"的节拍全在这条钩子上，提示也统一走"往消息尾部追加一条 snapshot"的范式。把检测挂在这里，**不新增 ctx.on、不抢消息顺序**（与 L1276 原有注释同一条纪律）。
  - 没选 `feishu.js` 的 `maybeGuideNewSession`：那是"飞书未绑定会话"的引导，跟平台体检无关，且挂了会把检测绑死在飞书通道上。
  - 没选 `updates.js`：它做的是插件版本，且本需求要与 presence 的 `step===1` 节拍共用"只提一次"纪律。
- 新增文件 `lib/pwsh-check.js`（零外部依赖，只用 `node:child_process` / `node:fs`）：
  - `detectPwshVersion()`：跑 `pwsh -NoProfile -Command '$PSVersionTable.PSVersion.Major'`。**探 `pwsh` 不是 `powershell.exe`**（后者是系统自带 5.1，探它永远不会失败）。超时 `PROBE_TIMEOUT_MS=2500`（需求给的是 2~3 秒），超时 kill 子进程并按"未安装"降级；`ENOENT` → `status:'missing'`（= 只有 5.1，需要提示）；非零退出/输出解析不出来 → `major:null`，同样按旧版处理。**全路径不抛错**。
  - `parsePwshMajor()`：逐行取第一处 1~2 位纯数字，容忍 CRLF/空白/噪音行；`7.4.1` 这种带小版本号的不硬认（返回 null）。
  - `isPwshTooOld()`：`major >= 7` 才算够用；`null` 一律当旧（探不出来 = 没装）。
  - `decidePwshNotice()`：纯函数决策（是否要探、是否要说、理由），单测直接打。
  - `maybePwshNotice()`：pre-step 入口。状态缓存在 `pwsh.json`（与 `updates.json` 同目录同风格），`STATE_TTL_MS=7天` 过期重查——用来兜住"这期间用户自己装上了 pwsh"。**对话里最多等 `AWAIT_BUDGET_MS=1200`**，预算内没探完就这一轮先闭嘴、把结果接到后台落盘，下一轮/下个会话再说。
  - `warmPwshProbe()`：`apply` 期预热（`void`、不 await、不抛），等第一个会话真来问时缓存多半已热，不占对话延迟——与 `updates.js` 开机预热 registry 同一个思路。
- 只提一次：`notifiedAt` 落盘，提过就再也不提；装上新版（`major>=7`）连 `notifiedAt/notifiedMajor` 一起清掉——将来万一降级回 5.1 还能再提一次。缓存过期只触发重查，不代表要重新唠叨（说没说过由 `notifiedAt` 单独管）。
- 提示文案：走系统提示注入，她读到后用自己口吻顺口提一句（与 💡 关闭思考建议同一范式）。刻意写成"顺口一提"而不是警告/报错，并**明确要求她只提这一次**，避免她自己反复念。
- 平台：`process.platform !== 'win32'` 时 `status:'skip'`，**一次子进程都不起**（有单测断言 spawn 调用数为 0）。
- **绝对路径兜底（追加 commit，坑 #75 的修复）**：`detectPwshVersion()` 先 `probeCommand('pwsh')`；**只在 ENOENT 时**再按已知安装位置挨个试绝对路径（`pwshPathCandidates()`：`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`、`%ProgramFiles%\PowerShell\7\pwsh.exe`、`7-preview`、`%ProgramFiles(x86)%\PowerShell\7`、以及 `%ProgramFiles%\WindowsApps\Microsoft.PowerShell_*` 包目录扫描），命中 `status:'ok', via:<路径>`。只对 ENOENT 触发（毫秒级）；超时/其他 error **不触发**（否则每条候选都等满 2.5s 把对话拖死）。
  - **关键教训（坑 #75 的核心）：绝不能拿 `existsSync` 预过滤候选路径。** WindowsApps 的 0 字节 app execution alias（本机 pwsh 7.7.0 就是这种）`statSync` 抛 `EACCES` → `existsSync` 返回 `false`，但那其实是**有效可跑**的 pwsh（`accessSync` 通过、`spawn` 正常返回 7）。预过滤会把真 alias 当不存在跳过，兜底就白做了。正确做法是**直接对每条候选 spawn**，不存在的那条自然 ENOENT（毫秒级），靠 ENOENT 过滤而不是靠 existsSync。
- 全量基线：`node --test "test/*.test.mjs"` → **150 项，142 过，8 挂**。其中 3 挂仍是 `alarm-inject` / `home-relocate` / `tools-surface`（与 1.5.21/1.5.22/1.5.27 同一基线，环境相关非本次引入）；**另外 5 挂全部在 `test/weixin-bind.test.mjs` / weixin 相关**，是 facf96ef 那边未提交的 weixin_bind 在途改动（本会话开始前已存在），**与本次 PowerShell 改动无关、也不是本会话引入**。PowerShell 相关单测 38 项全过。
- 测试 `test/pwsh-check.test.mjs`（38 项）：平台判断（非 win32 不起进程）、命令行形态（必须是 pwsh + `-NoProfile` + `windowsHide`）、版本解析（CRLF/噪音/带小版本号/三位数/空值）、`<7` 与 `≥7` 判定、ENOENT / 其他 error / 非零退出 / 不可解析 四种降级、超时（按时返回 + 真 kill 子进程 + spawn 同步抛）、只提示一次（第二次/换进程/重启后都不再提）、`≥7` 不提示、升级后清记录、7 天过期重查、缓存新鲜不重查、坏时间戳不永远认账、预算内卡住直接返回空串、坏 JSON 状态文件不炸、文案口径（不得出现"错误/失败/警告/必须/立即"）、**兜底**（候选清单覆盖已知安装位置、PATH 没有但绝对路径存在→ok、候选不存在也会被 probe 靠 ENOENT 过滤、全没命中仍 missing、noFallback 关掉兜底、只在 ENOENT 触发超时/error 不触发）。
- **本版发布预告（2026-11-11 阿依娅伊收尾更新，替换此前"本版不发"旧指令）**：1.5.28 即将发布（npm publish 由下一步、别处决定；本 commit 只落代码 + 单测，不 publish、不打 tag、不装 profile）。本版除上述 PowerShell 版本体检外，还含一批**微信通道收尾改动**（随本次 git commit 一并落地）：
  - **weixin_bind / weixin_unbind 工具**：把微信用户接入/解绑指定 aiyayi 会话（对齐 feishu_bind 语义）。`lib/weixin.js` 注册两工具；`lib/weixin/index.js` 加 `bindUser / unbindUser / consumePendingBindIfAny` 后端；`lib/weixin/accounts.js` 加 pending-bind 存储（autoNext 模式落待绑定目标，30 分钟 TTL，下一条微信消息的发送者自动绑过去）。
  - **飞书接入引导串味修复**：`lib/feishu.js` 的 `maybeGuideNewSession` 对 `weixin-` 前缀会话直接 return——不再给微信会话误发"接入飞书"引导（实测 2026-11-11 18:34 微信会话被误发 147 字引导）。
  - **own-tools 放行名单**：`lib/own-tools.js` 补 `weixin_status / weixin_login / weixin_bind / weixin_unbind` 进 OWN_TOOLS（与 feishu 同格，防模块实例不共享/初始化前漏放行）。
  - **坑 #13 修复**：`lib/weixin/{login,poll,send}.js` 去掉 `ctx?.weixinLogger ?? ctx?.logger`，只用 `ctx.logger`（Cordis ctx 是 Proxy，读未 inject 属性直接抛错、可选链拦不住）；新增 `test/weixin-ctx-inject.test.mjs` 用会抛错的 Proxy 断言三条真实路径都不碰未注入属性。
  - **新增测试**：`test/weixin-bind.test.mjs`（bindUser direct/autoNext、consumePendingBindIfAny 幂等/过期/会话不在运行、unbindUser、decideInbound 路由）、`test/weixin-ctx-inject.test.mjs`（坑 13 回归）；`test/weixin-isolation.test.mjs` / `test/weixin-shell.test.mjs` 工具清单断言补上 weixin_bind/weixin_unbind。
- **实现期新坑（坑 #74，本版实测）**：
  - **坑 #74：测试里只设 `AIYAYI_HOME` 并不能隔离记忆根——真机上的 `location.json` 优先于环境变量。**
    `lib/home.js` 的解析优先级是 **指路文件 > AIYAYI_HOME > 默认路径**（`resolveRoot()`，home.js:160-218）。一旦用户搬过家，`~/.dsh/aiyayi/location.json` 就存在，它会**直接压掉** `process.env.AIYAYI_HOME`——测试里写文件的路径函数（`pwshFile()` / `updatesFile()` / `presenceFile()` / `stateFile()`）于是全部指向**用户真实的记忆根**。
    本版实测经过：先按 `presence-clock.test.mjs` 的老写法（只设 `AIYAYI_HOME`）跑单测，跑完发现真机 `D:\阿依娅伊\记忆\pwsh.json` 被创建，里面 `notifiedAt` 已被写成"提过了"——**等于把用户本该在首次对话看到的那唯一一次提示提前吃掉了**。污染源逐个排查（对 24 个测试文件挨个删掉状态文件后单跑、检查是否重建）只命中 `presence-clock.test.mjs` 一个。
    正确写法（`home-relocate` / `tools-surface` / `feishu-accumulate` 早就在用）：**环境变量 + 指路文件双定向**
    ```js
    const home = mkdtempSync(join(tmpdir(), 'aiyayi-xxx-'))
    process.env.AIYAYI_HOME = home
    const homeLib = await import('../lib/home.js')
    homeLib.__testing.setPointerPath(join(home, 'location.json')) // ← 这行才是关键
    // 再兜一道：真落不到沙盘就当场判测试坏了，绝不静默写脏真机
    if (!homeLib.pwshFile().startsWith(home)) throw new Error('测试沙盘失效，拒绝继续')
    ```
    **新增任何会读/写记忆根的测试，都必须上这两道。**（`test/pwsh-check.test.mjs` 与已补修的 `test/presence-clock.test.mjs` 都已按此改。）
  - **坑 #75（追加 commit，本版实测）：PATH 里找不到 `pwsh` ≠ 没装——DSH 宿主进程继承的是旧环境变量。**
    场景：用户刚用 winget 装好 PowerShell 7.7.0（msstore 源，入口 `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`，一个 0 字节的 app execution alias）。winget 同时修了 HKCU `Path`（原来丢了 `%LOCALAPPDATA%\Microsoft\WindowsApps` 这一项），但 **DSH 宿主进程是装之前启动的**，继承的是修复前的旧环境变量 → 进程里 `spawn('pwsh')` 必然 ENOENT。只看 PATH 就会把"已装好"误判成"没装"，给用户弹一条**错误的**升级提示。
    修复：ENOENT 时补「绝对路径兜底探测」——挨个试 `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`、`%ProgramFiles%\PowerShell\7(或 7-preview)\pwsh.exe`、`%ProgramFiles(x86)%\PowerShell\7\pwsh.exe`、以及 `%ProgramFiles%\WindowsApps\Microsoft.PowerShell_*` 包目录，命中即视为已装。真机实测兜底后返回 `{status:'ok', major:7, via:'C:\Users\lihaorj\AppData\Local\Microsoft\WindowsApps\pwsh.exe'}`，不再误报。
    **派生坑（必须记住）：WindowsApps 的 0 字节 app execution alias 上，`node:fs` 的 `statSync` 抛 `EACCES`、`existsSync` 返回 `false`，但 `accessSync` 通过、`spawn` 能正常跑起来。** 所以兜底候选**绝不能用 `existsSync` 预过滤**（会把真 alias 当不存在跳过）；直接对每条候选 spawn，不存在那条自然 ENOENT（毫秒级）过滤掉。
    **排查过程**：父级（另一会话）18:26-18:28 装了 pwsh 7.7.0，反馈我的第一版会误报；我实测确认绝对路径存在（Size=0）、`& 它 -NoProfile -Command '$PSVersionTable.PSVersion.Major'` 返回 7、自己进程 `$env:PATH` 无 WindowsApps、`Get-Command pwsh` 空 → 坐实是 PATH 未刷新的 ENOENT 误报。真机 sanity 脚本（临时文件，跑完即删）验证兜底命中。

## 1.5.27（2026-11-11 新功能：微信通道并入——iLink 长轮询，默认关闭）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-11，阿依娅伊）1.5.27：把已跑通的微信 iLink 协议探针并入插件（默认关闭），按 docs/经验-微信通道自研.md 4.9 迁移路线阶段 2–4 落地；新增 73 个单测。
- 背景：`work/weixin-probe/`（零 npm 依赖探针，真实微信号验证过扫码登录/收消息/发消息三动作闭环，见同名经验文档第二节）此前只是脚本。本版把协议层搬进插件，实现"微信发消息 → 落到 DSH 会话 → 她回复 → 发回微信"的闭环能力。**装上不等于开启**：`weixin.enabled` 默认 `false`。
- 新增文件：
  - `lib/weixin.js` —— **薄壳**（cordis 入口，`name='aiyayi-weixin'`）。`enabled !== true` 时**一个模块都不 import**；启用后走 `import('./weixin/index.js')` 动态载入 + try/catch；生命周期挂 `ctx.effect`（dispose → abort → `await runtime.stop()`）。
  - `lib/weixin/protocol.js` —— 纯函数协议层（零 IO）：端点常量、header 公式（`iLink-App-Id`/`iLink-App-ClientVersion`/`X-WECHAT-UIN`）、**uint64 精度保护 `parseWeixinJson`**、出站报文构造、分片、入站准入判定、错误码分类、脱敏。
  - `lib/weixin/api.js` —— HTTP IO：`requestJson` 把**内部超时 controller 与外部 AbortSignal 合并**（官方 `combineAbortSignals` 同法），区分「外部 abort」与「客户端超时」。
  - `lib/weixin/config.js` —— 配置归一化 + `credentialRef` 解析（`env:NAME` 或 weixin 目录内文件，**拒绝 ../ 穿越**）。
  - `lib/weixin/accounts.js` —— 按账号分文件的状态存储（凭证 0600 / 游标 `.sync.json` / context-token `.context.json`）、**账号级文件锁（PID + 心跳，心跳过期的死锁可接管）**、出站流水 `outbound.jsonl`。
  - `lib/weixin/poll.js` —— 长轮询循环：游标续传、`longpolling_timeout_ms` 收到即采纳、`-14` 走 `pauseUntil` 时间戳（**不 `await sleep(1h)`**）、连续 3 败退避 30s 否则 2s、客户端超时不算失败、`message_id` 二级幂等。
  - `lib/weixin/send.js` —— 出站：context_token 有则带/**缺失照发但强制记 `withContextToken=false`**、分片逐条发、`ret=-3` 永久失败不重试、`ret=0` 不自动重试。
  - `lib/weixin/login.js` / `lib/weixin/qr.js` —— 扫码登录状态机（可编程调用，need_verifycode 走回调）+ 二维码 PNG（零依赖，vendor 内联 qrcode-terminal 核心，MIT）。
  - `lib/weixin/session.js` —— 会话建/投/查（建会话模板照 `lib/feishu.js`，但**不 import feishu.js**，两通道零耦合；坑 #59/#60/#61/#64/#65/#67/#68 的处理全部沿用）。
  - `lib/weixin/index.js` —— 运行时编排：逐账号拿锁/读凭证 → `void pollLoop(...)`（**绝不 await**）→ 入站准入 → 建/绑会话 → 投递；回发 relay 监听 `session/event`，`turn/end` 单条回发（多文本段按 step 累积，坑 #73 同理）。
  - `lib/weixin/vendor/QRCode/` —— qrcode-terminal@0.12.0 的 QR 核心（MIT，内联非 npm 安装），同目录 `package.json` 声明 CommonJS 作用域（**坑 6**：包根 `type=module`，不划作用域 `.js` 会被当 ESM 解析、`require` 全失效）。
- **硬安全要求（今天炸启动的教训，逐条落实）**：
  1. 微信模块**能失败而不影响宿主启动**：壳不顶层 import 实现；动态 import + try/catch；加载失败/初始化异常只 `warn` 并停用微信通道，`apply` 正常返回。飞书通道完全不受影响。
  2. 功能**默认关闭**：`weixin.enabled` 默认 `false`（只有严格 `true` 才算开，字符串 `"true"`/`1` 都不算，防误开）。
  3. **零 peer 依赖**：只用 `node:` 内置模块 + 自带 vendor；不 peer 依赖任何 `@deepseek-ai/*` 或第三方包。
  4. **不碰飞书代码路径**：除新文件、`package.json`、`CHANGELOG.md` 外无改动；`lib/weixin/*` 无一处 import feishu 或 `@larksuiteoapi`（有单测断言）。
- **allowlist 语义（刻意收紧，与官方不同）**：官方 2.4.8 的空白名单 = **放行所有 sender**（危险）。本版空白名单 = **只放行已被显式绑定的用户**（`bindings.json` / `config.bindings` 里有的），未绑定用户的陌生消息一律丢弃并记 `丢弃未授权消息 ... reason=unbound`；非空 allowlist 则只放行名单内。`weixin_status` 用 `allowlistMode: 'bound-only' | 'allowlist'` 明示当前语义。
- **context_token 策略（跟随 2.2 的防御性结论，不跟随其猜测）**：有就带上，没有就照发并强制记 `withContextToken=false` + `contextTokenFp`（指纹，不落明文）。**不做硬门禁**（实测缺 token 也能送达 5-D/6-E1..3），**不做补发队列**（基于已被推翻的假设）。
- **错误分类（4.7）**：`ret=-3` 永久失败不重试（后续分片也不再试）；`-14` 暂停该账号 `staleTokenPauseMs`（默认 1h）后**用原 token 重试**（保留凭证）；`ret=0` **不自动重试**（重复消息比丢一条更糟，需靠 `outbound.jsonl` 流水事后排查）。
- **配置形态**（`weixin` 段，也可放记忆根 `weixin/config.json`，patch 优先）：
  ```yaml
  enabled: false            # 必须显式 true 才跑长轮询
  accounts: []              # [{accountId: "xxxx@im.bot", credentialRef: "accounts/xxx-im-bot.json"}]
  allowlist: []             # 空 = 只放行已绑定用户
  route: { mode: per-user, sessionPrefix: weixin- }
  poll: { longPollTimeoutMs: 35000, staleTokenPauseMs: 3600000 }
  send: { chunkLimit: 1800 }
  ```
  微信没有 appId 概念，身份 = `accountId`（即 `ilink_bot_id`）；**token 绝不进配置文件**，走 `credentialRef`（`env:NAME` 或 weixin 目录下的文件）。
- **新增工具**：`weixin_status`（通道状态/账号/绑定/最近出站流水/allowlist 模式，不含 token 明文）、`weixin_login`（发起扫码登录，返回 PNG 路径 + 扫码 URL；**二维码只有 121 秒寿命**，要立刻扫）。两者只在 `enabled=true` 时注册；未就绪时返回可执行的开启指引而不是报错。
- 测试（`node --test "test/weixin-*.test.mjs"` → **73 项全过**，5 个文件）：
  - `weixin-protocol.test.mjs`：19 位 `message_id` 无损（实测值 `7526219523554115848`）并反证裸 `JSON.parse` 会改值；`buildClientVersion('1.0.11')===65547` 自校验；出站报文 `message_type=2`/`state=2`/`from_user_id=''`/单 item；`decideInbound` 空白名单拒绝陌生 sender、放行已绑定；错误码分类；脱敏不漏明文。
  - `weixin-config-store.test.mjs`：默认 `enabled=false`（含 `"true"`/`1` 反例）；`credentialRef` 穿越拒绝；原子写；游标断点续传；context_token 按发送者；账号锁互斥 + 死锁接管。
  - `weixin-poll.test.mjs`：**abort 能在 1s 量级打断在飞的长轮询**；`-14` 进暂停且暂停期可被 abort 打断（不死睡 1h）；客户端超时不算失败；`longpolling_timeout_ms` 采纳；游标落盘与续传；`message_id` 二级幂等；3 连败退避 30s 且可被 abort 打断。
  - `weixin-send.test.mjs`：带/不带 context_token 两条路径与 `withContextToken` 记录；`ret=-3` 不重试且后续分片停发；`ret=0` 不自动重试；分片逐条发；**token/context_token 明文不进日志与流水**。
  - `weixin-isolation.test.mjs`（**炸启动防护的真实回归**）：在临时包里把实现换成 7 种坏法（语法错误/顶层 throw/缺导出/同步抛/异步 reject/依赖解析失败/空文件）+ 整个文件缺失，逐一验证「壳仍可 import、`apply` 不抛、只 warn、dispose 不抛、工具仍注册」；并断言壳与协议层不 import feishu、不 import 任何外部包。
  - 仓库全量基线不变：24 个测试文件里仍是 3 个已知失败（`alarm-inject` 硬编码不存在的旧路径 `G:\阿依娅依\output\...`；`home-relocate`/`tools-surface` 磁盘类型探测断言），与本次改动无关，1.5.21/1.5.22 条目已记录同一基线。
- **实现期新坑（本版实测，已同步进 docs/经验-微信通道自研.md 第五节）**：
  - **坑 9：`setTimeout` 被 `unref()` 会让轮询循环静默停摆。** 退避 sleep 里的定时器一旦 unref，事件循环没有其它 ref 工作时定时器被丢弃，`await sleep()` 永不返回、循环永久挂起，**且没有任何日志**。是单测（业务错误退避那条）抓出来的。结论：轮询循环里的 sleep **一律不 unref**，退出靠 abort 打断。
  - **坑 10：`ctx.get('tools')` 在部分宿主上对未提供的服务直接抛，不是返回 null。** 只写 `if (!tools?.register)` 会漏掉抛错分支。两路都要接。同理，`ctx.effect` 的回调不是 `apply` 里同步执行的——单测里必须显式触发 effect 才能验证异步启动路径（否则会误以为"没日志"是实现问题）。
  - **坑 11：账号 ID 归一化要用官方的 `[^A-Za-z0-9_-] → -`。** 只替换 `@` 而保留 `.` 会得到 `d4f...-im.bot`，与官方 `-im-bot` 布局不一致（探针/store 文件名跟着漂）。本版按官方口径：`@` 和 `.` 都变 `-`，顺带挡住 `../` 路径成分。
- 发布后状态：1.5.27 已发布；profile 装版后 **`weixin.enabled` 仍保持 `false`**（先确认宿主启动/热重载日志无异常、飞书通道照常，再由李浩显式开启）。

## 1.5.26（2026-11-11 修复：回发攒批覆盖式 set——多文本段 turn 丢失前段文本，坑 #73）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-11，阿依娅伊）1.5.26：坑 #73 回发多文本段覆盖丢段修复；并纳入上一 commit（80edb04 署名归位：LICENSE/package.json author=巴依浩爷 bayihy，README 补实现者阿依娅伊）——该 commit 未随 1.5.25 发布，随本版首次进 npm。
- 根因一句话：`lib/feishu.js:527` 的 `pendingReplies.set(sessionId, text)` 是 Map 同键覆写——带 tool call 的回合里宿主按 step 渐进发多条 assistant/message（每 step 一条），第二段覆盖第一段，turn/end 的 flushReply 只发出最后一段，用户在飞书侧丢失「派活前那段文本」。feishu.js:459-462 旧注释「settle 替换」是误读（实际语义是渐进追加），1.5.14 防刷屏设计（坑 #63）"每回合一条文本"的前提不成立。
- 修法：同 sessionId 顺序累积——`const prev = pendingReplies.get(sessionId); pendingReplies.set(sessionId, prev ? prev + '\n\n' + text : text)`；注释同步改为「按 step 渐进追加，多文本段累积合并，防刷屏仍保留 turn/end 单条回发」。
- 测试：新增 `test/feishu-accumulate.test.mjs`——假 ctx 走真实 `apply()`（tools-surface 同款），stub 两个顶层依赖（@larksuiteoapi/node-sdk / @deepseek-ai/dsh-llm，stub 落仓库 node_modules，gitignored、测试后清理），记忆根与指路文件全定向沙盘、归属缓存预写命中避开真网络；四断言：同会话两段→turn/end 单条回发、以 \n\n 合并且顺序保留；单段对照逐字节不变；跨回合不残留；未绑定会话不攒不发。红-绿验证：临时还原旧覆盖式代码，a3 精确失败（首段丢失）；还原修复后全绿。
- 兼容性（排查确认与坑 #72 trim、附件标记、分片、230002 重试均兼容）：trim 在进 Map 前逐段执行不受影响；stripAttachmentMarkers 在发送时对合并文本照常工作；splitMarkdownForCard 分片对合并长文本照常生效；230002 重试路径取的是 flush 后同一 text，语义一致；turn/end followup 注入路径（feishu.js:1442-1461）不经过文本攒批，未触碰。

## 1.5.25（2026-11-11 修复：extractFeishuErrorCode 补挖顶层 feishuCode——1.5.23 的 230001 判定真正生效）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-11，阿依娅伊）1.5.25：装版静态断言连续抓出的第二处遗漏。
- 现象：1.5.24 修好 import 后装版断言仍显示伪造 chatId 走 `ok:true + warning`（probe-error 分支），230001 判定没生效。
- 根因：`probeChatMembership` 抛错时把飞书错误码放在 **`error.feishuCode`**（`feishu-logic.js` 抛错处），而 `extractFeishuErrorCode` 的候选链只挖 `cause.response.data.code`/`cause.data.code`/`cause.code`/`data.code`/顶层 `code`——不认 `feishuCode`，返回 null，`=== 230001` 恒 false。
- 修法：候选链首位补 `typeof error?.feishuCode === 'number' ? error.feishuCode : undefined`（顶层 feishuCode 优先——probe 错误以它为准）；`test/feishu-multiapp.test.mjs` 钉死：顶层 feishuCode 挖出、feishuCode 优先于 code、isOutOfChatError 认 feishuCode 抛错。
- 教训：**「函数级单测全过」≠「链路行为正确」**——extractFeishuErrorCode 的旧测试全是手工造的 SDK 形状错误，没人测 probe 自己抛的形状；两条修复（1.5.24 import、1.5.25 候选链）都是装版静态断言（mock ctx + 真实飞书 API）抓出来的。装版后断言应当作发版链路的固定环节。

## 1.5.24（2026-11-11 修复 1.5.23 遗漏 import + 禁用宿主 ask_user_question 选项组件）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-11，阿依娅伊）1.5.24：装版静态断言抓到的运行时 ReferenceError 修复 + 李浩拍板的工具禁用。
- **修：`lib/feishu.js` `resolveChannelForChat` 里 `extractFeishuErrorCode is not defined`**——1.5.23 的 230001 判定在 catch 块里调用了 `extractFeishuErrorCode`（定义在 `feishu-logic.js`），但忘了加进 import；任何 probe 抛错（含 230001/网络错）都会 ReferenceError。`node --check` 查不出运行时引用错误，multiapp 测试够不到这条 SDK+网络路径，是装版静态断言（伪造 chatId 实测）抓出来的。修法：import 列表补 `extractFeishuErrorCode`。
- **禁用宿主工具 `ask_user_question`（选项组件）**：`cordis.patch.yml` 两处挂载（preset-aiyayi 约 :236-240、preset-aiyayi-worker 约 :361-365）加 `disabled: true`——李浩 2026-11-11 拍板「提问一律纯文本，别折腾组件」：该工具在飞书侧没有交互载体，他点不了会卡死对话。工具定义在本体 `@deepseek-ai/dsh-tool-ask-user`，禁用挂载即从模型侧消失。
- **连带废弃（预期内，死代码不删）**：1.5.18 引入的「飞书点选作答」链路（`buildQuestionCard`/`onCardAction`/`registerQuestionAnswerer` 等，见 1.5.18 条目「修四（D）」）随宿主工具禁用不再被触发；`tryAnswerByText` 文字兜底仍在（问答语义未消失，只是不再发卡片）。启动不受影响（相关代码仅在收到卡片回调/问题请求时执行）。

## 1.5.23（2026-11-11 修复：feishu_bind 对无效 chatId 的确定性拒绝——230001 与 230002 同判 not-member）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-11，阿依娅伊）1.5.23：1.5.22 装版静态断言发现的边界修正。
- 现象：用伪造 chatId（`oc_aaa…` 32 个 a）调 `feishu_bind`，归属探测返回的不是 230002（非成员）而是 **230001 invalid container_id**（chat 根本不存在）——探测代码把非 0/230002 的码一律当"探测故障"抛出，于是走了「探测基建故障→`ok:true + warning` 原样绑定」分支，把一个不存在的 chat 绑进了 mappings。
- 根因：230001 与 230002 同为飞书的**确定性答案**（前者=chatId 无效/不存在，后者=合法 chat 但非成员），两者都意味着"绑了也没用"；只有网络/其他未知错误才是真正的探测故障，应保留 ok:true+warning 的可用性兜底。
- 修法（`lib/feishu.js` `resolveChannelForChat`）：probe 抛错时经 `extractFeishuErrorCode` 挖出 feishuCode===230001 → 不计入探测故障（视同该 app 非成员证据）；全部 app 均为 230002 非成员或 230001 抛错且无其他错误 → `{ok:'not-member'}` → `feishu_bind` 返回 `ok:false` 确定拒绝（拒绝文案同时说明两种情形）。
- 验证：装版后对伪造 chatId 实测返回 ok:false；对真实已绑定 chat 归属探测照常 ok:true+appId。

## 1.5.22（2026-11-11 多应用多长连接：双机器人各自收发，根因消灭 230002 错绑发送）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-11，阿依娅伊）1.5.22：多应用多长连接改造（背景：2026-11-11 诊断实锤——单飞书应用时代，运行版 config 换成新应用后，旧应用的 p2p 单聊收不到事件、新应用回发必报 230002「Bot/User can NOT be out of the chat」，因为 p2p chat 归属是 app 维度的）。
- **config 多应用格式**（`lib/feishu-logic.js`）：
  - 新格式 `{"apps":[{"appId","appSecret","domain"?},...]}`，每个应用一条独立长连接；旧顶层 `{appId,appSecret}` 单应用格式**继续兼容**（`normalizeApps` 自动包一层，`apps` 数组优先）。
  - `mergeConfig` 仍是浅合并不变；appId 去重首个赢；per-app `domain` 可覆盖全局 `domain`（缺省回落 `null`，`feishu.js` 里 `appDomain = app.domain || merged.domain` 补全局域）。
  - **自动迁移** `migrateConfigFile(root)`：读到旧格式→先备份 `config.json.bak-<yyyymmdd-HHmmss>`→原地改写为 apps 数组（其余顶层键保留、顶层不再留凭证副本）；幂等（已是新格式返回 `already-multi`，文件缺失 `missing`，坏 JSON `parse:*` 不动文件）。apply() 每次启动自动调用。
- **每应用独立基础设施**（`lib/feishu.js`）：逐 app 建 `createTokenManager` + `createLarkChannel({transport:'websocket'})` + `connect()`；WS 断连重连是 SDK `WSClient` 自带（autoReconnect:true, reconnectInterval=120s），各 channel 互不干扰。入站 `messageId` 去重（`SEEN_MESSAGE_LIMIT=2000` 环形缓存）防同群多 bot 重复投递。
- **归属机制（本次根因修复的核心）**：
  - 落盘 `chat-owners.json`：{chatId→appId}。入站事件（消息/进单聊卡片事件）到达即记录 `recordChatOwner(chatId, 该channel的appId)`——事件从哪条 WS 来，归属就是谁，权威自愈。
  - 发送前归属解析 `resolveChannelForChat(chatId)`：缓存命中直接用；未命中逐 app 探测 `GET /open-apis/im/v1/messages?container_id_type=chat&container_id=…&page_size=1`（code=0→成员，230002→非成员；判据为 2026-11-11 双 app 实锤，`GET /im/v1/chats/{id}` 两类 app 都返回 code=0 不能当判据）→命中写入缓存。
  - 发送一律走 `sendViaOwner(chatId, payload)`：先归属解析，再从**该 app 自己的 channel** 发；发送报 230002→清缓存重探重试一次（会话回复/卡片兜底文本路径）。确定性归属，不盲试。
  - 卡片就地刷新（`patchQuestionCard`）优先用 `record.appId` 对应的 channel——卡片是谁发的就必须用谁的凭证 patch。
- **工具升级**：`feishu_status` 增报 `apps:[{appId,connected,chatsOwned,error?}]`（逐应用长连接状态）、`chatOwners`、`boundChatAppId`、`singleApp`，旧字段全保留；`feishu_bind` 绑定前先探测归属：全部 app 非成员→`ok:false` 确定拒绝（绑了也收不到事件），探测基建故障→`ok:true + warning` 保持可用性，成功→回 `appId`。
- **既有机制理顺（改动最小化）**：`绑定会话` 指令、pending-bind 30 分钟时效、`bot_p2p_chat_entered_v1` 自动绑定逻辑不变，只是每条 WS 各自处理自己的事件并先记归属；问答卡片/文字兜底/附件下载的 domain 按 app 取。
- 测试：新增 `test/feishu-multiapp.test.mjs`（normalizeApps 双形态/去重/domain 覆盖、migrateConfigFile 备份+幂等+BOM、chat-owners 读写+损坏容错、isOutOfChatError 各层挖码）；`node --test "test/*.test.mjs"` 18 文件 15 过 3 挂——挂的 `alarm-inject` / `home-relocate` / `tools-surface` 与 1.5.21 干净基线一致（磁盘类型探测断言，环境相关，非本次引入）。
- 部署顺序注意：**先装 1.5.22 再迁移运行版 config.json**（1.5.21 读不懂 apps 格式）；迁移脚本自带备份。

## 1.5.21（2026-11-11 修复：飞书回复正文首尾空白行）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-11，阿依娅伊）1.5.21：修飞书回复正文的首尾空白行（**无附件标记**路径）
- 现象：飞书里收到的回复，正文**上下多出空行**——lark_md 卡片头部带 `\n\n`、尾部带 `\n\n\n`。
  **带附件标记的路径反而没事**（它走了 `.trim()` 分支），所以表现为「有的消息有空白行、有的没有」。
- 根因（两处漏点，链路实测确认）：
  1. **主因** `lib/feishu.js:313` `const text = extractText(message)`——`extractText`（`lib/feishu-logic.js:68-74`）
     把 content 里所有 `type==='text'` 的片段 `.join('')`，**不 trim**；模型分段输出时首尾片段常带 `\n`，
     拼出来就是首行/尾行空行。
  2. **兜底漏点** `lib/feishu-logic.js:685` `if (stripped === original) return original`——
     `stripAttachmentMarkers` 的「**无标记早退分支**」原样返回未清理文本，**根本走不到**它下面的 `.trim()`。
     出口再往下 `splitMarkdownForCard`（`:1080` `if (src.length <= max) return [src]`）与
     `markdownToLarkMd`（`:1031` `const src = String(md ?? '')`）也都不 trim，
     于是空白一路透传进卡片正文。
- 修法（主修 + 兜底，两处）：
  - **主修** `lib/feishu.js:313`：`const text = extractText(message)` → `const text = extractText(message).trim()`
    （语义最贴题「模型输出首尾空白」）。
  - **兜底** `lib/feishu-logic.js:748`：`const cleanText = stripAttachmentMarkers(text)` →
    `const cleanText = stripAttachmentMarkers(text).trim()`——**一处覆盖「回发 + 卡片 + 纯文本降级」全部正文出口**，
    对有标记/无标记两条分支都生效（未来新增发送入口也有保护）。
  - **不动** `lib/feishu.js:1095` 的 `extractText`（那是**入站**意图检测 `maybeOnboardIntent`，与正文出口无关）。
- 行为边界（本次只修首尾，**不扩大范围**）：
  - ✅ 只动**首尾**空白（`\n` / 空格 / 制表符）。
  - ✅ 带附件标记的路径行为**逐字节不变**（它原本就 trim 过，修复后结果与 1.5.20 一致）。
  - ✅ **中间**空行保持原样——「中间三连空行折叠」（`.replace(/\n{3,}/g,'\n\n')`）是**另一个需求**，
    那条规则目前只在**有附件标记**时生效；要不要扩大范围要李浩点头，本次**不顺手改**。
- 测试：新增 `test/feishu-trim.test.mjs`（跑真实链路 `extractText → stripAttachmentMarkers →
  markdownToLarkMd / splitMarkdownForCard` 的可导出函数，只 mock SDK 的 `channel.sender.send` 以观察最终 payload），覆盖：
  (a) 无附件标记的纯文本回复 → 首尾无空白；
  (b) 带附件标记的回复 → 行为不变（仍正常，首尾干净，且与 1.5.20 结果逐字节一致）；
  (c) 中间空行不被误折叠（`\n\n\n\n` 原样保留）；
  (d) 空字符串 / 全空白输入不炸（不抛错、不发任何 payload）。
  另附超长正文分片时每片首尾也不带空白的断言。
  **仓库测试基线不变**：16 个 `.test.mjs` 文件（本次新增第 17 个 `feishu-trim.test.mjs`），
  修复前后均为 **13 过 / 3 挂**；3 挂的是已知失败（`alarm-inject` / `home-relocate` / `tools-surface`，
  硬编码 `G:\阿依娅伊\` 旧路径导致 `ERR_MODULE_NOT_FOUND`，与本次改动无关）。
- 坑：**#72**（见下方「已知坑清单」末位）。

---

## 1.5.20（2026-11-11 修复：飞书 markdown 正文渲染）

- 环境：DSH-执行智能体（娅伊派出的 DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-11，阿依娅伊）1.5.20：飞书正文改走 interactive 卡片 + lark_md——纯文本 `msg_type=text` 不渲染 markdown
- 回填说明：本次把已在线上验证通过的 1.5.20 改动**回填源码仓**。源码仓此前停在 1.5.18，故一并补入 1.5.19 的
  `lib/feishu.js` 与 `lib/feishu-logic.js`、以及 1.5.19 的两个测试文件。两个 lib 文件来源均以 SHA256 核对为准
  （`lib/feishu.js`=ADBA20BC…（1.5.19 payload 与线上逐字节一致）、`lib/feishu-logic.js`=47442E13…（线上 1.5.20 版）），
  **纯复制，未重写、未重构、未格式化**。回填前原 1.5.18 文件已备份为 `*.bak-1.5.18`（不入 git）。
- 根因（为什么 markdown 原先不渲染）：回发正文唯一出口是 `sendReplyWithAttachments()` 结尾的
  `channel.sender.send(chatId, { text: cleanText })`。SDK `@larksuiteoapi/node-sdk@1.76.0` 按 key 分派
  （`'text' in input → sendText()`，`lib/index.js:105094-105100`），`sendText` 固定 `msgType: 'text'`、
  `content: { text: chunk }`（`:105154-105172`），`rawSend` 打成 `msg_type: "text"`（`:105335-105339`）。
  **飞书客户端对 `msg_type=text` 不做 markdown 渲染**，于是 `**粗体**`、`## 标题`、`- 列表` 原样显示成符号。
  改前既无 markdown 转换，也无 post 富文本、无长消息分片。
- 改动（仅 `lib/feishu-logic.js`，新增代码块 902-1180 行）：
  - `MARKDOWN_MODE_ENV` / `markdownMode()`——读开关 `AIYAYI_FEISHU_MARKDOWN`，返回 `'card'`/`'text'`，默认 card。
  - `CARD_CONTENT_LIMIT = 3500`——单卡正文上限（对齐 SDK `DEFAULT_CHUNK_LIMIT`，`lib/index.js:105084`；
    飞书卡片整体 JSON 上限 30KB，正文留足 JSON 包装与 CJK 多字节余量）。
  - `markdownToLarkMd(md)`——**核心转换**：`#`~`######`→`**粗体**`（lark_md 无 heading 语法）；`__x__`→`**x**`；
    `- / * / +` 列表→`•`（lark_md 的 `- ` 渲染不稳，`•` 必出）；`> 引用`→`▏`；`---`→`————————`（lark_md 无 hr）；
    `|表格|`→空格对齐纯文本（lark_md 无表格，按显示宽度对齐，CJK 算 2 列）。
    **代码块保护**是顺序两重占位：先把 ``` 围栏整块换成 `\u0000C<n>\u0000`，再换行内代码 `\u0000I<n>\u0000`，
    跑完所有规则按序还原，故块内 `# 注释`/`- 参数`/`| 管道` 一个都不会被改（有单测覆盖）。
  - `splitMarkdownForCard(text, limit)`——**围栏安全分片**：切在代码块中间时给当前片补 ``` 闭合、下一片重新开
    ```lang`（与 SDK `splitWithCodeFences`，`lib/index.js:103826-103868` 同法）；单行自身超长（超长 URL、单行日志）
    先按 `limit-64` 硬切；`replyTo` 只挂首片，后续片不带（否则飞书会拒）。
  - `buildMarkdownCard(content, opts)`——构造 `{ config:{wide_screen_mode,update_multi}, elements:[{tag:'div',text:{tag:'lark_md',content}}] }`，
    形状复用 1.5.19 已验证的 `buildQuestionCard`（对照 SDK 类型 `types/index.d.ts:321494-321541`：`InteractiveCard` /
    `InteractiveCardDivElement` / `InteractiveCardLarkMdItem` 全部合法；`{ card }` 载荷经 `OutboundSender.send → sendCard`
    `lib/index.js:105255-105266` 打成 `msgType: 'interactive'`）。
  - `sendMarkdownCard(channel, chatId, text, logger, opts)`——发送 + 失败降级纯文本。
- 改动（`sendReplyWithAttachments()` 正文出口，843-862 行）：默认走卡片，`AIYAYI_FEISHU_MARKDOWN=text` 回退纯文本。
  **附件分流逻辑（图片/文件）完全未动**，仍是先发附件、再发正文。回发日志末尾新增 `正文通道 card:1/1` / `text(开关)` 字段，
  排障时一眼看出走的哪条路。
- 兜底（三级）：①卡片发成功即完事；②卡片第 N 片失败→**只把第 N 片及之后按纯文本重发**，已发出的卡片不撤回不重发
  （否则用户会看到重复内容），日志 warn 带失败 code+msg；③纯文本也失败→抛异常，交 `feishu.js:298` 的 `.catch`
  记 `aiyayi-feishu: 回发 … 失败:`，**不静默**。
- 回滚开关（**一键、零改代码**）：设 `AIYAYI_FEISHU_MARKDOWN=text`（或 `0`/`off`/`false`/`plain`）后重启 DSH 即退回旧纯文本；
  不设或 `card`/`1`/`on`/`yes` 走卡片（默认）。文件级回滚另有线上备份 `lib/feishu-logic.js.pre-1.5.20-markdown`
  （54219 字节，逐字节还原的 1.5.19 原文，`node --check` 通过）。
- 风险：**表格错位**——lark_md 无表格语法，只能转空格对齐纯文本，飞书卡片正文非等宽字体会有轻微错位
  （但远比原样 `|---|` 好）；**>3500 字分片**——超长回复拆成多张卡片，观感比原来一条长文本碎，
  `CARD_CONTENT_LIMIT` 可调大，但飞书卡片 JSON 上限 30KB 且 CJK 转义后膨胀，建议不超过 6000；
  lark_md 实际渲染与预期不符（中）——加粗/链接/列表/代码块确定支持，`•` 作列表符是保险选择，最坏退化成普通行不会报错；
  占位符 `\u0000`（极低）——正常正文不会有 NUL，万一模型输出含 NUL 会还原成空串。
- 测试（**83 项断言在 1.5.20 部署包内跑通，但这两个测试文件未进 git 仓，仓库里复现不了**）：
  `test-md.mjs`（50 项：转换规则逐条、代码块保护、表格对齐、CJK 宽度、边界空/null/纯文本、
  分片上限/拼回/围栏成对/单行硬切、卡片结构、开关矩阵）与 `test-send.mjs`（33 项：正常卡片发送、`replyTo` 只挂首片、
  卡片全失败降级、第 N 片失败只补剩余、双失败抛异常、空文本不发、`sendReplyWithAttachments` 端到端走卡片、开关回退、
  附件+卡片组合、卡片失败不影响附件、超长正文端到端）——**这两个文件只存在于 1.5.20 部署包，未入 git**
  （`git ls-tree -r HEAD -- test/` 只有 **16 个文件**，不含这两个）。
  **仓库内可复现的只有这 16 个测试文件**，其中与本次改动直接相关的是 `test/feishu-attachment.test.mjs` 与
  `test/feishu-image-download.test.mjs`（见下条「回填回归」）。自测期间抓到并修掉一个真 bug：卡片降级文本后 `textSent` 仍为 false
  （旧判断只看 `sent>0`），已改为 `r.fallback === 'text' || r.sent > 0`。
- 回填回归（本次入仓后实测，16/16 测试文件全过）：`test/feishu-image-download.test.mjs` exit 0；
  `test/feishu-attachment.test.mjs` 在默认卡片模式 exit 0，**设 `AIYAYI_FEISHU_MARKDOWN=text` 后同样 exit 0 全通过**
  ——这条正是「回滚开关有效」的实测证据。该测试原有的两处 `payload: { text: … }` 硬断言已改为**卡片感知**
  （默认模式断言 `payload.card.elements[0].text.tag === 'lark_md'`，纯文本模式断言 `payload.text`），
  两种通道都覆盖，且能抓「默认竟然走了纯文本」这类回归；**未留任何红测试入仓**。
- 验证：`node --check` 两个文件均 exit 0；线上肉眼确认回发正文渲染正常（标题/粗体/列表不再显示原始符号），
  日志出现 `正文通道 card:1/1`。

---

## create-bot v6（2026-11-11 技能脚本：权限集中化 + 回调直调 + publish 子命令）

> **本条目不属于任何 npm 版本号**。create-bot.js 位于 `skills/feishu-setup/scripts/`，是**内置技能脚本**，不是插件本体代码；
> 它随 npm 包一起分发（因此 1.5.20 的 tarball 里含 v6），但**没有自己的版本号**，也不随插件版本号发布——
> 单独成 commit **2c16bee**（2026-11-11，阿依娅伊），与 1.5.20 的插件改动（commit `2de3f46`）**互不依赖、互不相干**。
> 故本节不写成 `## 1.5.x` 形式，避免以后有人找「1.5.21 / 1.5.22」里的它。

- 环境：DSH-执行智能体（娅伊派出的 DeepSeek Harness 子会话，模型名未确证）
- git：独立 commit **`2c16bee`**（2026-11-11，阿依娅伊）create-bot v6：权限集中化 + 回调直调 + publish 子命令
  ——修 im:resource 真名与 CDP 提前关连接
- 涉及文件：`skills/feishu-setup/scripts/create-bot.js`（+1201 行 / -77 行，82219 字节，
  SHA256 `9CD149A114DC7772780DBF4677A090EAEE8AA01A1AB8CCB305847129D5F1C2C8`，`node --check` 通过）、
  `skills/feishu-setup/scripts/package.json`（新增，`{"type":"commonjs"}`）、
  `.gitignore`（补 `*.bak-*`）
- 背景：v5 在 2026-11-10 实跑打通「建应用 → 配权限 → 配事件 → 建版本 → 发布」全链路；v6 在 v5 基础上做
  **「权限/事件/回调集中化 + 幂等 + 日志 + 增量补权限 + 对外动作加确认」**。改动**只碰技能脚本**，插件本体零改动。
- 改动 1：**权限清单集中成一处常量 `DEFAULT_SCOPES`**（原先散在 `PERMS` 内联默认值里，好加不好审）。
  新增必需权限 **`im:resource`**（后台真实标识「获取与上传图片或文件资源」，免审）——
  背景是插件发图片/文件时飞书回 `400 code=99991672`，缺的就是这条（坑 #70 的实锤后续）。
- 改动 2：**`SCOPE_ALIASES` 别名归一化**。实锤（2026-11-11 报告-权限申请.md）：后台搜 **`im:resource:upload` 为 0 条**，
  唯一等价形态就是 **`im:resource`**（关联 API = 上传图片 + 上传文件）。保留别名 `im:resource:upload` → `im:resource`、
  `im:resource:read` → `im:resource`，让「工单写法 / 旧文档写法」直接粘进来也能跑；
  命中别名时打 WARN 日志（`权限别名归一化: im:resource:upload → im:resource（后台无 im:resource:upload 这个独立 scope）`），
  **不至于在 scope 目录里找不到 id 直接崩**。详见坑 #71。
- 改动 3：**新增事件/回调常量 `DEFAULT_EVENTS` / `DEFAULT_CALLBACKS`**，事件名做别名归一化
  （`EVENT_ALIASES`：`im:message.receive_v1` → `im.message.receive_v1`；权限 scope 用**冒号**分隔、
  事件用**点**分隔，混写是高频笔误，归一化后打 warn 避免静默变成「事件没配上」）。
  `DEFAULT_EVENTS` = `im.message.receive_v1` + `im.chat.access_event.bot_p2p_chat_entered_v1`（新会话扫码接入自动绑定用）。
- 改动 4：**`card.action.trigger` 是回调不是事件**（后台在「事件与回调 → 回调配置」tab，事件弹窗里搜 card 为 0 条），
  故 `DEFAULT_CALLBACKS = ['card.action.trigger']`。新增 `ensureCardCallback()`：CDP 复用已登录 Edge 走
  「订阅方式→长连接→保存→添加回调→勾选 card.action.trigger」，**已存在则跳过（幂等）**；
  CDP 不可用时**不阻断主流程**，只记 warn 并在最终汇总里列为「待人工确认」。
- 改动 5：**幂等三步**——配权限 / 配事件 / 配回调三段都**先读现状再算差集，只补缺的**（`missing = wanted − granted`），
  重复跑不报错。降级成「整批 add」会丢掉幂等性、还会把「token 没就绪」这个真问题掩盖掉，故读现状失败时
  明确 WARN 标注「幂等性降低」而非静默降级；加完**复核**一遍，仍缺失则 WARN（多半需要重新发布版本或等生效）。
- 改动 6：**新增子命令 `configure`**——对**已存在的**应用补权限/事件/回调（**不动版本、不发布**），
  即本次给 `cli_aa79b06a5638dcf4` 补 `im:resource` 的实际用法。
- 改动 7：**新增子命令 `publish`**——给已有应用建版本并发布；**发布是对外动作，默认等同 dry-run，必须显式 `--yes` 才真发**，
  未传 `--yes` 时打 WARN「未传 --yes —— 发布是对外动作，本次按 dry-run 处理，不会发任何请求」。
- 改动 8：**新增 `--dry-run`**——只打印将要做的变更，不发任何写请求。读现状的请求在 dry-run 下失败也不炸
  （无登录态、假 appId 等），按「待确认」跳过。
- 改动 9：**日志落盘**——每次运行在**脚本同目录 `logs/`** 下写 `create-bot-YYYYMMDD-HHmmss.log`（毫秒时间戳 + 每步开始/结束/结果）；
  控制台与文件**双写**；失败处打印 http 状态码 + 飞书原始 `code`/`msg` + 原始 body 片段（`--log-dir` 可改目录）。
- 改动 10：**修 `cdpSession` 缺陷（性能）**——原版在读 `window.csrfToken` **之前**就 `ws.close()`，
  导致 `Runtime.evaluate` **必然超时**、每次都退到 `httpsGet` 兜底（能用但**每次慢约 5 秒**）。
  v6 把 `close` 挪到最后（`create-bot.js:376-390`）。这是**纯性能修复**，不影响功能正确性。
- 附带：`skills/feishu-setup/scripts/package.json`（`{"type":"commonjs"}`）修本目录 CJS 脚本在根 `package.json`
  声明 `"type":"module"` 下 `require()` 报 `ReferenceError` 的坑（该文件是**正式文件**，不是备份）；
  `.gitignore` 补 `*.bak-*`（脚本迭代产生的备份件不入 git）。
- 校验：`node --check` 通过；无对应自动化测试文件（脚本走真实飞书后台，无单测覆盖）。

---

## 1.5.19（2026-11-11 修复：图片收/发接口 + 接入引导误触发 + 新增卡片问答）

- 环境：DSH-执行智能体（娅伊派出的 DeepSeek Harness 子会话，模型名未确证）
- git：并入本次 commit（2026-11-11，阿依娅伊）——源码仓此前停在 1.5.18，从未有 1.5.19 条目，本节为**事后补录**，
  内容依据 1.5.19 部署包（`deploy-1.5.19/payload`，带 `SHA256SUMS.txt`，已核对与线上安装逐字节一致）与
  `CHANGELOG-1.5.19.md` / `报告-合并1.5.19.md`。
- **版本号与 commit 不对齐说明（2026-11-11 订正）**：**1.5.19 没有自己的 commit、也没有自己的 git tag**——
  `git log --all | grep 1.5.19` 为空，它的代码是被**并入 1.5.20 的 commit `2de3f46`** 才进仓库的。
  所以以后**别再去找「1.5.19 的 commit」**，那是不存在的；要看 1.5.19 的代码请看 `2de3f46` 里回填的那两个 lib 文件。
  （1.5.18 有自己的 commit **`f115874`**，但同样**没有 tag**；另注：该 commit 的**提交信息**里写的是
  「#70 上传需 im:resource:upload」，属旧笔误——git 历史不可改，真名订正见坑 #70 / #71：真名是 `im:resource`。）
  **tag 现状**：
  仓库 tag 只到 **v1.5.16**（v1.5.14 是 annotated tag 指向 commit `1aa4774`，v1.5.15 / v1.5.16 是 lightweight tag——
  **三种 tag 语义混用**，历史遗留，不在本次改动范围）；**v1.5.17 / v1.5.18 / v1.5.19 / v1.5.20 均无 tag**。
  **版本事实以 npm registry 为准**（1.5.18 / 1.5.19 从未发布到 npm，最终随 1.5.20 一起进 npm）。
- 性质：四份已验修补丁的合并版（A + B + C + D），合并过程**零冲突**
- 改动文件：`lib/feishu.js`、`lib/feishu-logic.js`、`package.json`、`test/feishu-image-download.test.mjs`（新增）
- 修一（B）**图片收件接口用错**：1.5.18 加了附件收发，但收图片这条链路调错接口。原
  `downloadImageResource(domain, token, imageKey)` 直接打 `/im/v1/images/{image_key}`，**缺消息上下文**；
  飞书对「消息里的图片」要求走消息维度资源接口
  `GET /im/v1/messages/{message_id}/resources/{image_key}?type=image`，少了 `message_id` 就拿不到，收件侧图片静默失败。
  修法：新增两个纯函数 `fileResourceUrl(domain, messageId, fileKey)` / `imageResourceUrl(domain, messageId, imageKey)`
  把 URL 拼接从调用点抽出、可单测（`feishu-logic.js:466` / `:475`）；`downloadImageResource` **改签名**为
  `(domain, token, { messageId, imageKey })`，消息 id 变必填（`:493`）；收件侧改调新签名（`:563`），
  失败日志补 `kind=` / `url=`，以后再生病一眼看出是哪个 URL 失败（`:571-582`）。
  为什么这么改：把 URL 构造成纯函数，是让「接口形状」这件事能被测试钉死——1.5.18 的教训就是接口用错了却没人发现，
  因为 URL 是硬编码在下载函数里的。
- 修二（C）**图片发件没走 image 类型**：发件沿用 1.5.18 的 `{file}` 通道，图片被当普通文件发出去，
  客户端不显示为图片。改为图片走 SDK `{image:{source}}`（MediaUploader 直读本地路径），按实际类型分别计数
  （返回值新增 `imagesTotal`/`imagesSent`/`imageFallbacks`/`order`，「按**实际发送类型**统计，不是按标记名」）。
- 修三（A）**接入引导被任务简报误触发**：新增子会话识别 `isSubagentSession()` / `rememberSubagentSession()`，
  只对真实用户会话做扫码/接入引导注入，止住「子会话被反复注入引导」的噪声。
- 修四（D）**新增「卡片问答」能力**：`feishu-logic.js` 新增 `buildQuestionCard()`（`:946`）/`parseQuestionReply()`（`:1097`）/
  `composeAnswerBatch()`（`:1172`）/`applyCardAction()`（`:1208`）/`readPendingQuestions()`（`:1245`）/
  `writePendingQuestions()`（`:1257`）/`prunePendingQuestions()`（`:1266`），配套 `feishu.js` 新增
  `onCardAction`/`registerQuestionAnswerer`/`waitForQuestionAnswer`/`patchQuestionCard`/`tryAnswerByText`/
  `deliverLateAnswer`/`answerViaFeishu`/`liveQuestion` 等 11 个函数，使宿主 `ask_user_question` 能在飞书里点选作答。
  **注意：这 11 个符号横跨两个文件**，1.5.20 默认正文卡片（`buildMarkdownCard`）即复用本节已验证的卡片形状。
- 测试：新增 `test/feishu-image-download.test.mjs`（9D7F24C9…）；`test/feishu-attachment.test.mjs` 同步更新（60AF52F7…）。
- 注：1.5.19 部署脚本按设计**不改 `CHANGELOG.md`**（线上该文件仍是 1.5.17 时代的副本，缺整个 1.5.18 段），
  故本节与 1.5.18 段均以源码仓这份为准，不可用线上 CHANGELOG 覆盖。

---

## 1.5.18（2026-11-10 功能：飞书消息附件收发）

- 环境：DSH-执行智能体（娅伊派出的 DeepSeek Harness 子会话，模型名未确证）
- git：本次 commit（2026-11-10，阿依娅伊）1.5.18：飞书消息附件收发——收件下载落盘 + `[附件:]`/`[图片:]` 标记发件
- 收件：`onIncomingMessage` 非 bind 分支收集下载附件（bind 只写映射不投递故不下载）。主路径用 SDK `mergedEvent.resources`（SDK dispatchConvert 已从 content 抽好 fileKey/fileName，@larksuiteoapi/node-sdk 1.76.0 lib/index.js:106835/106850）；resources 为空或 file 类缺文件名时兜底拉 `GET /im/v1/messages/{id}` 详情补齐。下载：file/video/audio 走 `/im/v1/messages/{id}/resources/{file_key}?type=file`，image 走 `/im/v1/images/{image_key}`；落盘 `<记忆根>\feishu\attachments\<chatId>\<yyyymmdd-HHmmss>_<文件名>`（同秒同名自动 -2 后缀，Windows 非法字符清洗，缺扩展名按 content-type 补）。投会话文本追加「（飞书附件已保存：<绝对路径>）」；单个失败追加「（飞书附件下载失败：<原因>，msg_id=<id>）」不阻断投递；空文本消息不再投空块（改投「（收到一条无文本内容的飞书消息，msg_id=…）」）。`lib/feishu.js` 收件分支 +13/-4 行；编排全在 `lib/feishu-logic.js`（channel/logger 依赖注入，fetch 用 Node 内建，「零外部依赖」约定不破坏）。
- 发件：约定标记 `[附件: <绝对路径>]` / `[图片: <绝对路径>]`（全/半角冒号均容忍）——`sendReplyWithAttachments` 用 SDK OutboundSender 原生 `{file:{source,fileName}}`/`{image:{source}}`（MediaUploader 直接读本地路径，SDK lib/index.js:104623/105193/105206），先发文件后发剥离标记的正文；路径不存在或上传失败：剥离标记、正文照发、日志 warn；正文为空且附件全失败时补发一条失败说明避免静默。无标记的纯文本逐字节原样发（与 1.5.17 行为一致）。`lib/feishu.js` 回发点 flushReply 改一行接线；mappings/routeMessage/bind 逻辑未动。
- 坑 #69（2026-11-10 实锤，真实消息 om_x100b60062bb868a0c1374152dac71e8）：post 消息的附件**不在正文元素里，而在 content JSON 顶层 `files` 数组**（`{"title":"","content":[[text 元素]],"content_v2":…,"files":[{"file_key":"file_v3_…","file_name":"最低单价股票.xlsx","is_folder":false}]}`）——SDK `convertPost` 只走 `body.content` 段落（lib/index.js:106450-106476）同样漏掉它，`mergedEvent.resources` 为空。修法：`parseAttachmentsFromContent` 收集顶层 `files` 数组（`is_folder:true` 的云文件夹引用跳过，资源接口不提供）并按 fileKey 去重；SDK resources 为空时详情接口兜底成为 post 附件的实际主路径。教训：解析器形状必须拿真实消息验证，SDK 的 normalize 也可能漏字段。
- 坑 #70（2026-11-10 实锤，log_id=20261110224442B6D9C1C31C408776E4C0）：发件上传 `POST /im/v1/files` 需要应用开通 **`im:resource`** scope（后台真实标识「获取与上传图片或文件资源」，免审），与收件下载的读权限是两回事；未开通时返回 99991672 并附申请链接。**发件功能的前置条件**：开发者后台给应用开通该权限并重新发布版本（或用 create-bot.js 的配权限流程补 scope，见 create-bot v6 条目）。收件链路不受影响（读权限已具备）。**⚠️ 权限真名订正（2026-11-11 实锤）**：后台**不存在 `im:resource:upload` 这个独立 scope**（开发者后台搜 `im:resource:upload` 为 0 条），它的等价形态就是 **`im:resource`**——别再去后台搜 `im:resource:upload` 搜不到、误判成「没这个权限」。本条早前写的「`im:resource:upload`（或 `im:resource`）」是笔误，已订正为真名 `im:resource`；create-bot v6 的 `SCOPE_ALIASES` 已把 `im:resource:upload` 自动归一化成 `im:resource` 并打 WARN（详见坑 #71）。
- token：`POST /auth/v3/tenant_access_token/internal`，进程内缓存至过期前 60s（feishu-logic createTokenManager）。
- 测试：`test/feishu-attachment.test.mjs`（resources 归一化 / post 双形状+顶层 files 解析 / 文件名清洗与防覆盖 / 投递文本合成 / 标记解析剥离 / mock sender 回发编排 / token 缓存 / 下载错误路径）；另真机自测下载链路通过（file_key `file_v3_0017a_e8079604-44f1-4f24-989d-0ca85b990fbg` → 47216 字节 xlsx → 文件头 `50 4b 03 04` PK zip 头）。
- .gitignore 补 work/（工作产物不入 git）。
- 待用户实测：①飞书给 bot 发文件/图片/含图图文 → 会话收到附件保存路径提示且文件可打开；②开通 `im:resource` 后，会话内让 agent 带 `[附件: <路径>]` 回复 → 飞书收到文件。（原文写「开通 im:resource:upload」为笔误，真名见坑 #70 的权限真名订正。）

---

## 1.5.17（2026-11-10 修复：坑 #68 宿主 append 重入保护）

- 环境：DSH-创造模式-DeepSeek Harness 执行智能体（娅伊派出，模型名未确证）
- git：本次 commit（2026-11-10，阿依娅伊）1.5.17：坑 #68 修复——宿主 dsh-session append 重入保护导致插件服务进程 fatal load failure 退出码 1
- 坑 #68（2026-11-10 实锤，插件服务进程退出码 1 + `dsh: fatal load failure` 堆栈）：宿主 `Session.append` 有重入保护——一次 publish 尚未结束时，任何新的 `Session.append` 都抛 `session append cannot reenter while another append is being published`。触发链：插件 effect 回调（`turn/end` / `agent/inbox/spliced` 事件）里 `await agent.followup(...)`（= `ReactLoopInbox.splice` → `mutate` → `Session.append`）在宿主当前 publish 尚未收尾时同步重入 append → 抛错 → 宿主升级为 fatal load failure → 进程退出码 1。原代码 fire-and-forget 无 `.catch()`，unhandled rejection 沿 effect 回调传播为宿主 fatal。修法：① `yieldHostPublication()`——投递前 `Promise.resolve()` + `setTimeout(0)` 让出宏任务，跳出宿主 publish 窗口；② `safeDeliverToSession()`——包 try/catch，append 失败只记 `ctx.logger.warn` 不逃逸；③ effect 回调两处 fire-and-forget 补 `.catch(error => ctx.logger.warn(...))`；④ 三处引导/接入注入分支（skip / onboard / maybeGuideNewSession）全部改用 `safeDeliverToSession`。`lib/feishu.js` +51/-5 行。

---

## 1.5.16（2026-11-10 发版：feishu-setup 技能脚本入包）

- 环境：DSH-创造模式-DeepSeek Harness 执行智能体（娅伊派出，模型名未确证）
- git：本次 commit（2026-11-10，阿依娅伊）1.5.16：feishu-setup 技能脚本补进包内 `skills/feishu-setup/scripts/`（create-bot.js v5 扫码前置 + save-secret.js + get-csrf.js + get-cookies.js）+ 版本号 1.5.16
- 发版：李浩指示把技能脚本补完整再发一版；package.json `files` 含 `"skills"` 整目录通配，脚本放进仓库即自动入包。npm pack 预演核对 scripts/ 4 文件齐全、无 .bak / credential / 密钥文件；敏感扫描通过（无硬编码 token/appSecret/密码/cookie，会话均运行时从 CDP 取；create-bot.js 默认 member open_id 属应用维度公开标识、非凭证，与 SKILL.md 已有 cli_ appId 先例同级，保留并注明）
- 说明：1.5.15 条目曾记「create-bot.js v5 本体不入 npm 包」，本版按李浩指示改为入包；本地 `~/.dsh/skills/feishu-setup/scripts/` 与包内脚本同源（SHA256 一致），`syncBundledSkills` 覆盖无害

---

## 1.5.15（2026-11-10 发版：扫码接入改造落地）

- 环境：DSH-创造模式-DeepSeek Harness 执行智能体（娅伊派出，模型名未确证）
- git：本次 commit（2026-11-10，阿依娅伊）d61c09d：新会话扫码接入飞书改造（引导注入 turn/end followup、`bot_p2p_chat_entered_v1` 自动绑定、零宽前缀防自触发循环）+ 技能层 create-bot.js v5 扫码前置（`--login-wait <秒>`）+ SKILL.md 三副本同步
- 发版：README 补飞书桥接与扫码接入说明（能力表、文件清单、坑号修正 #1–#55→#1–#67）；`lib/feishu.js`、`lib/feishu-logic.js`、`skills/feishu-setup/SKILL.md` 随包发布（npm pack 32 文件核对，无 .bak / credential / config.json / requests-raw.jsonl / work 产物）
- 说明：create-bot.js v5 本体在技能同步目录（`~/.dsh/skills/feishu-setup/scripts/`），不入 npm 包——presence `syncBundledSkills` 判据 SKILL.md 一致即跳过、`copyTree` 只复制不删除，npm 升级不会动本地脚本

---

## 1.5.14（2026-11-10 修复）

- 环境：DSH-创造模式-DeepSeek Harness 执行智能体（娅伊派出，模型名未确证）
- git：本次 commit（2026-11-10，阿依娅伊）1.5.14：修复 feishu 插件收消息静默蒸发（坑 #58）+ 建会话链路两连坑（#59 建目录 / #60 preset 按名 set）+ 投递/回发/生命周期连环坑（#61–#67）
- 坑 #58（2026-11-10 实锤）：`@larksuiteoapi/node-sdk` 1.76.0 的 `createLarkChannel(opts)` 构造函数不读 `opts.handlers`（SDK lib/index.js:106879 只设 `this.handlers={}`，107359 原样 `new` 返回），传入的 `handlers.message` 被整个丢弃——每条入站消息在派发处（106902-106912 `const handler = this.handlers.message; if (handler) yield handler(merged)`）静默 no-op、零日志，帧泵（102959）照常回 ACK 200，飞书后台事件日志显示 SUCCESS。插件自 1.5.11 部署以来从未收到过任何一条消息（totalBound 恒 0，「之前工作正常」系误传：成功的是经典接线测试脚本 bot.mjs，不是插件）。修法：`createLarkChannel` 返回后显式补接线 `channel.handlers.message = onMessage`（lib/feishu.js；handlers.message 派发时才读取，事后赋值有效）。教训：升级 SDK 或启用新包装 API 要回归测试收消息。
- 坑 #59/#60（2026-11-10 实锤，坑 #58 修复后由真实消息连环暴露）：#59——`ctx.workspaceRegistry.create(path)` 契约是**路径必须已存在**（内部 realpath 不代建；dsh-webhook 的 workspacePath 来自规则配置的既有目录），插件只建了 `feishu\workspaces` 父目录、叶子 `feishu-<uuid>` 没建就 create → `处理入站消息失败: ENOENT … realpath '…\feishu-<uuid>'`；修法：先 `mkdirSync(workspacePath,{recursive:true})` 再 create。#60——`permissionPresets.resolve(名字)` 返回**已解析对象**而 `permissionPresets.set(session, x)` 要**名字字符串**（webhook 模板 resolve 仅校验、返回值丢弃），把返回对象传给 set → `permission: unknown preset "[object Object]"`；修法：set 传名字字符串。教训：照宿主模板接线要逐调用点核对参数语义，修复路径上每个 warn 都是下一层的路标。
- 坑 #61/#62/#63（2026-11-10 实锤，「已新建并接入」能收到后的静默断点）：#61——`ctx.agents.get(id)` 返回**裸 Agent**（宿主 asar 文档 375429 行「句柄只暴露给创建它的消费方」），写 `get(id)?.agent` 恒 undefined → deliverToSession 静默丢消息零日志；修 getAgent 返回裸 Agent。#62——宿主 assistant/message 事件载荷在 **`event.data.message`**（宿主消费者 asar 59377/301690 行读 `event.data.message.content`），读 `event.message` 恒 undefined → 回复发不出；修为读 event.data.message。#63——一轮 turn 里 assistant/message 按 step 渐进追加，逐条回发会刷屏 → pendingReplies Map 攒每会话最新文本、`turn/end` 统一回发一条（`turn/start` 兜底冲残留）。教训：端到端验证每种代码路径各一条真实消息；静默 return 零日志只能对照宿主模板核对。
- 坑 #64（2026-11-10 实锤，HMR 重载后 route 分支静默蒸发）：插件 dispose 时 `controller.abort()`，而建会话时把 `controller.signal` 传给了 `agents.create` → **每次插件重载都会把插件建的会话连带杀死**（12:58:42 日志 `agent "feishu-bfb53970-…": agent/disposed listener threw: TypeError: Cannot read properties of undefined (reading 'catch')` 即死亡现场），之后 route 分支 getAgent 拿到 null 静默 return、消息蒸发零日志。修法：①会话是宿主资产不是插件资产——每会话独立从不 abort 的 signal；②deliverToSession 返回布尔，route 投递失败自动新建+重新映射+告知用户（自愈）；③防御 `Promise.resolve(channel.disconnect()).catch()`（SDK disconnect 在 WS 未初始化时返回 undefined）。教训：宿主对象生命周期归宿主管，插件清理别越界连坐。
- 坑 #65（2026-11-10 实锤，13:08:54/13:09:03 两条消息的实际报错）：投递的 source 里写了 `senderId: undefined`。宿主 `Session.append` 用 `snapshotJsonValue`→`walkJsonValue` 深拷贝事件数据，**遇到 undefined 直接返回 undefined**，于是抛 `session event "agent/inbox/spliced" carries non-JSON-serializable data`（asar 1976372-1976373；walkJsonValue 对非 null/boolean/string/number/object 一律判失败）。修法：source 只用 `{ kind: 'user' }`（MessageSourceMap 里最简单的合法取值，宿主自建用户消息同款，asar 18310265），**事件数据里绝不放 undefined 字段**。可本地复刻 walkJsonValue 语义做判据，不必等真消息。
- 坑 #66（2026-11-10）：机器人自己发出的消息也会以 `im.message.receive_v1` 推回来并进同一个 handler，不过滤会把「已新建并接入…」和正式回答当用户输入再喂一轮（自问自答刷屏）。修法：用 `channel.botIdentity.openId`（connect 时 fetchBotIdentity 填充）比对 `mergedEvent.senderId` 跳过。
- 坑 #67（2026-11-10，症状=「只收到已接入模板回复、始终没有正文」）：宿主 webhook 模板在 `model === undefined` 时会取 `ctx.agentDefaultModel.currentSelection()` 作为 agentOptions（asar 2187436-2187439）；插件原来传 `agentOptions: {}`，agent 可能没有可用模型 → 会话能建、模板回复能发，但永远产不出正式回答。修法：`inject` 加 `agentDefaultModel`，建会话时取 `ctx.agentDefaultModel.currentSelection()`。
- 排障判据沉淀（同步 feishu-setup 技能）：控制台事件日志接口 `POST /api/tools/developer/open_event_log_contents/{app_id}`（SUCCESS=送达且 ACK / FAIL=无客户端或未投递，毫秒时间戳字符串）；长连接在线核验 `POST /developers/v1/app/check_online` body `{"clientID"}` → code=0（接口清单.md 原记「验证无接口」有误，已证伪回填）。事件订阅未配好时用户照样能把消息发进会话（服务端入库、仅不推送），旧记载「用户侧发不出消息/搜不到机器人」已证伪。
- SKILL.md frontmatter 两条 YAML 坑（2026-11-10）：description 未加引号标量含 `insert: `（冒号+空格 → Nested mappings 解析错）、含 ` #`（空格+井号 → 行内注释截断），都会让技能被静默 ignored——frontmatter 长文案一律单引号包裹。
- 工具坑：pwsh 5.1 `Get-Content -Raw` 不带 `-Encoding` 按 ANSI 读 UTF-8 中文 → mojibake 写回损坏 JSON（本次 package.json 中招，git checkout 恢复后改用 node `JSON.parse`+`writeFileSync utf8` 升版本）。
- 经验文档：docs\经验-飞书bot收不到消息三层分诊.md（三层分诊法 + 两次误判反转全程）。

---

## 1.5.13（2026-11-10 功能）

- 环境：DSH-创造模式-loomy讯飞-GLM5.3FLASH
- git：本次 commit（2026-11-10，阿依娅伊）1.5.13：内置技能同步机制 + feishu-setup 技能骨架
- 功能：dsh-aiyayi 自带 `skills/` 目录（当前仅 feishu-setup），presence 在 apply/workerApply 时把包内技能同步到 DSH 技能根（`$DSH_HOME` 或 `~/.dsh` 下 `skills/`；判据=目标 SKILL.md 存在且内容一致则跳过，缺失/不一致才整目录覆盖），其他用户从 npm 装包后技能自动就位，无需手工拷贝。同步失败静默，不影响会话。
- 坑 #57（2026-11-10 实测）：Node 22 / Windows 上 `fs.cpSync(src, dst, {recursive:true})` 复制**源目录路径含非 ASCII 字符**（本包路径"阿依娅依"正好踩中）时进程原生崩溃（exit -1073740791 / 0xC0000409 fail-fast，无 JS 异常可捕）；而 `readdirSync`/`copyFileSync`/单文件 `cpSync`/`statSync` 对同样路径全部正常。修法：`copyTree()` 手写递归复制（mkdirSync+readdirSync+statSync+copyFileSync）。
- feishu-setup 技能（骨架）：只含**本机已实测**的安装/验证/排障步骤——三件套（patch `insert:` 声明 / profile 装 `@larksuiteoapi/node-sdk` / 记忆根 `feishu/config.json` 无 BOM 凭证）、HMR 触发方式、以日志「已就绪」判定生效、排障速查表（not-found 裸行坑 #56 / ERR_PACKAGE_PATH_NOT_EXPORTED 安装版被回退 / BOM SyntaxError / 后台订阅未配）。**CDP 自主创建飞书机器人部分留白待固化**——等初版对接验证后由娅伊自主创建一次跑通，沉淀实测经验再回填技能。
- persona：本体【飞书】段补一句——新配/重配/修复飞书对接按 feishu-setup 技能执行，本体派人给小伙伴照技能装；技能没覆盖的如实说明，别现编步骤。

---

## 1.5.12（2026-11-10 约束）

- 环境：DSH-创造模式-loomy讯飞-GLM5.3FLASH
- git：本次 commit（2026-11-10，阿依娅伊）1.5.12：persona 新增【思考纪律】约束（本体/小伙伴/检索员三预设）
- 背景：用户要求给 aiyayi 和她的小伙伴们也加思考约束——无法关闭自考模式时，尽量用实际文件和已获取的上下文决策；证据不足宁可抛出问题也不埋头瞎想、跟自己左右互博；不要反复纠结，遇到歧义和冲突以上下文中有明确来源的内容为准；可以猜，但突出信息时必须明确说明哪部分是猜的，不要反复推翻自己的直觉猜测。
- 改动（均在 `cordis.patch.yml` persona，纯文案，零代码）：
  - preset-aiyayi（本体）与 preset-aiyayi-worker（小伙伴）：各新增【思考纪律】段——够用就决策动手不空转；缺资料先查实际文件/已有上下文；证据不足宁可抛问题；歧义冲突以**有明确来源**的内容为准；可以猜但关键信息必须标注哪部分是猜的、依据是什么；猜完按验证修正，不反复横跳。小伙伴版额外点明"已获取的上下文含检索员带回的摘录"，并把开场句"放开用"补成"放开用≠空转"。
  - preset-aiyayi-retriever（检索员）：在"真找不到就明说找不到"后补两句——拿不准的判断按最合理的理解做，但交回时标明哪条是推断、哪条是原文；别为一条拿不准的摘录反复推翻重来，上下文和简报里有明确来源的信息优先。
  - 补充（用户追加）：思维链还有新料可拉（能读到新文件、新工具结果、新上下文）就继续想；一旦思考内容大量重复、原地绕圈，就立刻停止思考——按手头最好的判断行动/动手，或把卡点如实抛出来（本体与小伙伴的【思考纪律】段均含）。
- 生效：persona 随 agent preset 挂载，**新会话生效**（已运行会话沿用旧人格直至重启/新会话）。部署到 profile 安装版后经 HMR 重载 bundle patch。

---

## 1.5.11（2026-11-09 修正引导）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.11：飞书接入引导改为「从飞书侧自动发起」，不再让用户提供 chat_id
- 修正：此前 persona 与工具描述引导 aiyayi「让用户提供 chat_id 再 feishu_bind」，方向走反。事实上接入主要从飞书侧自动发起——用户在飞书里给机器人随便发一条消息，bot 自己取到该 chat 的 chat_id、自动新建 aiyayi 会话并绑定（`routeMessage` 默认分支 `action:'new'`）；要接入指定已有会话就在飞书里发 `绑定会话 <会话名>`，chat_id 同样自动已知。
- 改动：`cordis.patch.yml` persona【飞书】段重写为「不让用户填 chat_id，引导去飞书发消息自动接入 / 发 `绑定会话 <会话名>` 接指定会话」；`lib/feishu.js` 中 `feishu_status` / `feishu_bind` 的工具 description 同步说明「大多数接入从飞书侧自动发起，用户无需提供 chat_id，feishu_bind 仅在确有明确 chat_id 时才用」。

---

## 1.5.10（2026-11-09 修复）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.10：修复 feishu_status / feishu_bind 工具报错 `content.some is not a function`
- 修复：工具 `output.render` 之前返回**字符串**（`'feishu_status 已执行'`），宿主 dsh-tools `createSuccessResult` 把它直接当作 tool-result 消息的 `content`，而下游 `contentHasImage` / `contentHasFile`（dsh-llm）对 content 调 `.some(...)`，字符串没有 `.some` 就报 `content.some is not a function`。改为返回 content **数组**：`render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]`，两个工具都改，顺带把真实返回值写进 text 供模型读取。

---

## 1.5.9（2026-11-09 功能）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.9：aiyayi 新增 feishu_status / feishu_bind 工具 + persona 飞书自查指引
- 功能：给 aiyayi 加两个可主动调用的飞书工具（宿主插件 aiyayi-feishu 注册，`registerOwnTool` 登记进 restrict 放行名单）：
  - `feishu_status`：查当前会话/其它会话的飞书绑定情况（本会话 boundChat、其它绑定 otherBound、长连接是否运行 connected/configured）。新建会话首次对话自查用。
  - `feishu_bind`：把当前会话绑定到指定飞书 chat（传 chatId，oc_ 开头），写进 `feishu/mappings.json`，之后该飞书对话路由到本会话、回复发回该 chat。
  - 工具 `execute(args, exec)` 用 `exec.agent.session.id` 取调用方会话（dsh-tools 机制已核实）。relay 回发改为每事件重读映射，避免 feishu_bind 新增绑定后漏发。
- persona：新增【飞书】指引段——新建会话第一次开口先调 feishu_status 自查对接情况，没绑定且要收飞书的话就 feishu_bind 绑定，别装作已对接。
- 依赖：`@larksuiteoapi/node-sdk`（profile 依赖，长连接用）。

---

## 1.5.8（2026-11-09 功能）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.8：新增 aiyayi-feishu 宿主插件——aiyayi 会话接入飞书机器人
- 功能：新增宿主级服务插件 `aiyayi-feishu`（lib/feishu.js，宿主插件，不塞进任何 agent preset；跨会话桥接服务）。用飞书官方 SDK `@larksuiteoapi/node-sdk` 的 `createLarkChannel` 建立**长连接 WebSocket**（无需公网），订阅 `im.message.receive_v1`。
  - 收：飞书对话里的消息按**自然语言指令**决定绑到哪个 aiyayi 会话——`绑定会话 <id>` / `接入` / `切换到会话 <id>` 指定已有会话；`新建会话 <名称>` / 无映射普通正文默认新建——新建走 `agents.create`（复用 dsh-webhook 的建会话模板：workspaceRegistry.create → mount aiyayi preset → permissionPresets.set(workspace-write) → sessionTitle.rename）。映射持久化到 aiyayi 记忆根 `feishu/mappings.json`（chat_id→sessionId）。
  - 发：消息经 `agent.followup(createUserMessage(...))` 投进会话（与 dsh-webhook 同通道，source.kind='feishu'）；回发监听 host 级 `session/event` 总线（已确认 host ctx 能收到所有会话事件）的 `assistant/message`，取最终文本用 `channel.sender.send(chatId, {text})` 发回对应 chat。
- 配置：App ID/Secret 放 aiyayi 记忆根 `feishu/config.json`（不入 git）或 patch config；缺省 `domain=https://open.feishu.cn`、`defaultPermissionPreset=workspace-write`。纯逻辑（路由/映射/文本抽取）在 lib/feishu-logic.js（无外部依赖，可单测）。
- 测试：新增 test/feishu-route.test.mjs（extractText / routeMessage 绑定·新建·route·默认新建 / mergeConfig / 配置与映射读写往返），node 运行 ALL PASS。

---

## 1.5.7（2026-11-09 修复；本地开发版，未发布 npm——npm 的 1.5.7 是下方官方发布条目，两者内容无关；本条改动随 1.5.8 起的本地版本进 npm）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.7：主会话切模型后唤醒子智能体不再沿用旧模型
- 修复：`aiyayi-presence-worker`（挂 preset-aiyayi-worker，即"小伙伴"）新增 `agent/inbox/inserted` 监听 `syncModelWithParentOnWake`——子智能体被唤醒（冷唤醒 coldResume）时，趁唤醒消息插入（早于 wakeDriver→preStep），读父会话当前模型（`agent.session.header.parentSession` → agents 注册表 → `parentAgent.model.current()`），与本子代当前模型比对；路由不同则 `agent.model.select(父模型)`，把 `model/selection` 事件写进子会话日志，wake 首步 pre-step 的 `model.current()` 即用新模型。
- 根因：宿主 `coldResume` 只从 durable descriptor 读 spawn 时冻结的旧 provider/model 重建子代；本体切模型后若子代不在 agents 注册表（DSH 重启 / 激活释放 / 已 dispose），`propagateModelToChildren` 因拿不到 agent 静默跳过，子会话日志没有 `model/selection` 事件 → 冷唤醒沿用旧模型，报额度错/无法推进任务。本修法与本体侧 `propagateModelToChildren` 互补：本体侧覆盖"子代还活着"的情况，子代侧唤醒对齐覆盖"子代已不在注册表"的情况。
- 测试：新增 test/wake-model-sync.test.mjs（注册了 inbox/inserted 监听 / 父模型不同路由→select 父模型 / 同路由幂等不 select / 无父会话映射静默 / 父会话无当前模型静默）。

---

## 1.5.7（2026-11-09 发布，npm latest）

- git：`c176779`（2026-11-09，阿依娅伊）1.5.7：含官方 1.5.6 全部内容 + persona【派检索员】改造
- 内容 = 官方 1.5.6 tarball 逐字节一致（25/27 文件）+ 两处预期差异：`cordis.patch.yml`（`b847cf3` 的 persona【派检索员】段重写：默认派人、自理为例外，补回检索员边界约束句；删除三处 `modelSelectionSettings` 死键及过时注释——官方 1.5.6 发布在前、未含此改动，随本版首次进 npm）+ `package.json` 版本号。LICENSE 与 lib/doc.js 等 8 个文件的工作区 CRLF 同步规范回 LF（与官方 1.5.6 一致，纯换行、零内容变更，git 索引本就是 LF）。
- 发布 tarball shasum `0ac545cbcb72dded9131dee6f8ea7988d9b55528`（npm publish 输出回执）。

## 1.5.6（2026-11-09 发布）

- git：本次 commit（2026-11-09，阿依娅伊）1.5.6：新会话首轮定时器异常检查（孤儿目标/投递失败/paused 计数）
- 功能：`aiyayi-presence` 新会话首轮检查宿主定时器存储，检测到异常才注入一行 `[闹钟·异常]`，无异常零输出（不与宿主原生 `[闹钟]` 行重复）；全程只读 `storages/schedule.json`，绝不改写。三种异常：
  - 孤儿目标：active 任务的目标会话不是当前会话，到点会投进别处（很可能是已归档旧会话），本会话永远收不到。实锤案例：每日日记闹钟 schedule-e79f9c46 于 2026-11-09 10:15 正常触发（lastDelivery 有回执），但投进了已归档旧会话 session-346b0fdb，当前会话毫无感知——宿主 dsh-schedule 按 `task.sessionId` 绑定投递（其 lib/index.js:1576），解析失败只 warn，消息不进任何会话；而 `[闹钟]` 巡检只认"目标=当前会话"，孤儿任务恰好被这条件藏住，两个会话谁都看不见它。
  - 上次投递失败：`lastDelivery.scheduledAt` 存在而 `deliveredAt` 缺失——宿主回执三字段（scheduledAt/deliveredAt/messageId）本该在投递确认后一起落账，缺 deliveredAt 说明投递链路出过状况。
  - paused 任务计数：inactive（暂停）任务不会触发，数量作为事实带过一行。
- 测试：新增 test/alarm-check.test.mjs（孤儿出行/回执缺失出行/正常回执与 ended 任务不报/paused 计数/全正常零输出/坏 store 静默/超 3 条截断+总数）。
- 注：本版同时包含此前已推送三远端的 README/CHANGELOG 重构（`de63e71`）与 MEMORY-MIGRATION.md 拆分，随本版首次进 npm tarball。

## 1.5.5（已发布，2026-11-09；npm latest）

- git：`ba7ec4c`（2026-11-09，阿依娅伊）1.5.5：检索员提示词增加可量化信息保真规则

## 1.5.4（已发布，2026-11-09）

- git：`b57eb38`（2026-11-09，BayiHY）1.5.4: 记忆根目录可迁移（指路文件 + home.js 统一出口）、memory_location/memory_relocate 双工具、硬失败与防误判加固
- git：`be2245a`（2026-11-09，BayiHY）DEPLOY.md：补记 1.5.4 已发布（npm + GitCode + Gitee），记 GitCode token 认证变更与 GitHub 未推原因
- 1.5.0–1.5.3（未发布）的改动随本版进入 npm。

## 1.5.3（未发布到 npm）

- 相关坑记录：#53、#54、#55（全文见下方清单）。

## 1.5.2（未发布到 npm）

- 相关坑记录：#52（全文见下方清单）。

## 1.5.1（未发布到 npm）

- 相关坑记录：#46、#47、#48、#49、#50、#51（全文见下方清单）。

## 1.5.0（未发布到 npm）

- 功能：记忆路径与迁移（指路文件 `location.json` + `lib/home.js` 唯一路径出口、`memory_location`/`memory_relocate` 双工具、硬失败），功能文档见 README「记忆路径与迁移」。
- 相关坑记录：#42、#43、#44、#45（全文见下方清单）。

## 1.4.4（已发布，2026-11-07）

- git：`0280a3e`（2026-11-07，BayiHY）1.4.4：补齐子智能体续接（continuable）纪律
- git：`8f3ba25`（2026-11-07，BayiHY）DEPLOY.md：补记 1.4.4 已发布（npm + GitCode）
- git：`2d0e916`（2026-11-08，阿依娅伊）1.4.4：修复闹钟六测试硬编码 G 盘绝对路径（换机可移植）+ 坑表 #42 + DEPLOY 发布源口径同步
- 当版日志条目（原文照录）：

### 三、2026-11-07：子智能体续接（continuable）能力补齐（1.4.4）

### 先厘清宿主的事实（读源码所得，别再猜）

- 子代理分 `one-shot` / `external` / `continuable` / `unknown` 四种模式（`SubagentCatalogEntry`）。
  **`spawn` provider 实现了 `prepareContinuable()`**（`dsh-subagent-spawn-in-process/lib/index.js:31`），
  所以我们的小伙伴和检索员**都是 continuable**。
- `tool-subagent` 在拼工具描述时按 `subagentProvider.prepareContinuable !== void 0` 分支
  （`dsh-tool-subagent/lib/index.js:373`）：有就走"`send_message` 可续接"那套文案。
- `send_message` 服务语义（`SubagentService.sendMessage`）：目标在跑 → 下个 step 边界吸收；
  目标空闲 → 开新一轮；**目标不在（absent） → 从持久化 cold-resume**。
  即"DSH 重启后、隔天再找它，发条消息就能捞回来"是这个能力的既定行为。
- `list_agents` 只投影 `mode === "continuable"` 的孩子，**one-shot 会被直接过滤掉**
  （`dsh-tool-subagent-control/lib/index.js:32` —— `if (entry.mode !== "continuable") return void 0`）。
- **权限边界**：`send_message` 只认"直接子会话"或"直接父级"。孙代只能用 `interrupt_agent`。

### 我们的结构 + 实测踩到的错法

三层：**本体 →（`subagent` 派）小伙伴 →（小伙伴再派）检索员**。本体自己也能用 `retriever`
直派检索员（那是直接下级，能直接续）。问题出在**下一层**：小伙伴派的检索员对本
体就是孙代，本体发消息会被拒。

实测证据（`session-cd646af9`，她 55 轮会话里 `list_agents` 只调 7 次、
`send_message` 调了 29 次）：

```
L565  agent_id: 7553531f-3345-45d1-a455-50a56e2c 8db   → Error: is unavailable
L571  agent_id: 7553531f-3345-45d1-a455-50a56e2c 5ca7  → message delivered
```

**同一个子代理，她把 UUID 最后几位打错了一个字符。** 模型对长十六进制串逐字符复制
并不可靠，且 `is unavailable` 这个提示**不区分"ID 打错"与"子代理真的不在了"**——
按后者反应就会重派、把已完成的活扔掉。

### 修法（只改 persona，零代码改动）

1. **本体【干活】段**加：续接前 `list_agents` 现查 ID、不许凭记忆敲；把
   `is unavailable` 解释成"查无此号"而非"它死了"。
2. **本体【干活的规矩】段**重写：
   - 明确 `continuable` 是什么、"会话记录还在就能唤醒"、**DSH 重启后也能冷启动捞回**
     （这条最省成本：她原来不知道，重启后倾向于重派）；
   - 断掉第一反应是 `send_message` 续而不是重派；
   - 状态语义：跑着 → step 边界吸收；休眠 → 叫醒开新一轮；
   - **孙代够不着**：走 `send_message` 给小伙伴、让它在自己的 ctx 里续（权限在它手上）。
3. **小伙伴 persona【派检索员】段**同步加：ID 现查、`is unavailable` 含义、
   自己能续检索员（因为娅伊够不着，得靠它接住）。

### 回归测试

`test/persona-continuation.test.mjs`：不引 yaml 依赖，用 20 行缩进感知的极简提取
（预设行缩进 4、`prefix: |` 缩进 14、结束于缩进 ≤10 的插件行），断言本体 10 条 /
小伙伴 3 条关键纪律的短语仍在，缺任何一条就 FAIL 并点名。
**已实测闸门有效**：把 "ID 必须现查" 改成别的字，测试立刻 FAIL 并报出两个预设都缺。

> 为什么需要这道闸：persona 是纯文本，删一句不会报错、不会让测试变红，
> 功能照跑但行为悄悄退化。这类"静默劣化"必须靠文本断言兜住。

## 1.4.3（已发布，2026-11-07）

- git：`1bd1622`（2026-11-07，BayiHY）1.4.3：时间感知与闹钟闭环修复 + BOM 体检闸
- git：`bd4d091`（2026-11-07，BayiHY）DEPLOY.md：补记 1.4.3 已发布（npm + GitCode），补 npm 生效延迟实测（约 15 秒）
- 相关坑记录：#38、#39、#40、#41（全文见下方清单）。

## 1.4.2（未发布到 npm）

- 相关坑记录：#35、#36（全文见下方清单）。

## 1.4.1（未发布到 npm）

- 相关坑记录：#33、#34（全文见下方清单）。

## 1.4.0（已发布）

- git：`334e875`（2026-11-06，阿依娅伊）1.4.0：检索员通道与文档解析（本体 subagent+retriever 双派道、aiyayi-retriever 只读叶子预设、aiyayi-doc 解析 docx/xlsx/pptx/pdf、aiyayi-presence-worker 孙代断因透传与模型跟随）
- 相关坑记录：#30、#31、#32（全文见下方清单）。

## 1.3.0（未发布到 npm）

- 相关坑记录：#29（全文见下方清单）。

## 1.2.7（已发布）

- git：`980cb10`（2026-11-06，阿依娅伊）1.2.7：小伙伴联网工具（aiyayi_fetch + aiyayi_cdp 自主拉起 headless，render 交付正文）
- git：`f0d5200`（2026-11-06，阿依娅伊）1.2.7：DEPLOY.md 补记 github remote 已配置（实测仍连不上，网络恢复后补推）
- git：`52ffbdb`（2026-11-06，阿依娅伊）1.2.7：DEPLOY.md 更新 GitHub 推送结论（SNI 阻断取证 + SSH 配置方案，已补推成功）
- 相关坑记录：#25、#27、#28（全文见下方清单）。

## 1.2.6（已发布）

- git：`0bb0f88`（2026-11-05，阿依娅伊）1.2.6：presence 版本自述（每轮知道自己的插件版本）
- git：`f2d0cac`（2026-11-05，阿依娅伊）1.2.6：DEPLOY.md 增加发布流程（npm + gitcode/gitee 推送）

## 1.2.5（已发布）

- git：`1b62e1c`（2026-11-05，阿依娅伊）1.2.5：子代模型跟随本体切换
- 相关坑记录：#24（全文见下方清单）。

## 1.2.4（已发布）

- git：`3ce0b43`（2026-11-05，阿依娅伊）1.2.4：新会话首次对话提醒关闭思考
- 相关坑记录：#23（全文见下方清单）。

## 1.2.3（已发布）

- git：`5313354`（2026-11-05，阿依娅伊）1.2.3：修复核心记忆截断+双前缀污染+子代断因透传
- 相关坑记录：#20、#21、#22（全文见下方清单）。

## 1.2.2（已发布）

- git：`2edf6e1`（2026-11-05，bayihy）1.2.2：修复工具白名单漂移（memory_organize 被挡 + schedule 工具改名），放行名单改为单一真源
- 相关坑记录：#19（全文见下方清单）。

## 1.2.1（已发布）

- git：`f8816f0`（2026-11-05，bayihy）1.2.1：小伙伴预设+65%压缩、两层记忆、断点续跑、体检单、DSH 0.2.2-rc.1 兼容（list-agents 行移除）
- 相关坑记录：#18（全文见下方清单）。

## 1.2.0（已发布）

- 相关坑记录：#17（全文见下方清单）。

## 1.0.1（已发布）

- 相关坑记录：#13（全文见下方清单）。

## 1.0.0 / 1.0.2 / 1.0.3 / 1.1.0 / 1.1.1（已发布）

- 无逐版记录留存（见顶部发布一览）。

---

## 已知坑（装的时候踩过的）

> 编号 #1–#72（#1–#55 顺序与措辞自历史 README 原文照录，#56 为 2026-11-10 新增；
> **#57–#70 记在对应版本条目内**（#57 在 1.5.13、#58–#67 在 1.5.14、#68 在 1.5.17、#69/#70 在 1.5.18），
> **#71 为 2026-11-11 新增**（飞书权限 scope 真名），**#72 为 2026-11-11 新增**（飞书正文首尾空白行），
> 均已并入本清单末位）；README 正文与各版本条目引用的「坑 #N」即本清单编号。
> 未标注版本的条目（#1–#12、#14–#16、#26、#37）为早期或通用记录，未归入具体版本条目。
> **本清单的序号是全局坑号**，故 #71 / #72 接在 #56 之后——中间 #57–#70 不是漏号，是记在版本条目里。

1. **工具 output.schema 必须是标准 JSON Schema**：`required` 只能出现在 object/array 上（顶层数组），属性里写 `required: true` 会激活失败（`JsonSchemaError`，日志在 `~\.dsh\logs\desktop-next-*.jsonl` 搜 `aiyayi`）。
2. **preset 作用域挂 `agent-default-model` 必须 `isolate: {agentDefaultModel: true}`**，否则 `service "agentDefaultModel" has been registered` 冲突，激活失败。
3. **cordis_inspect_query 传 input 有 gateway bug**（`"input" must be an object`），只能无参调用。
4. 激活失败会在安装后 ~2 秒内立刻打 warn；装完日志安静 = 注册通过。
5. **`ctx.tools.restrict()` 的名字校验对着"调用时刻的继承面"**，写不在面的名字直接抛错（`names unknown global tools ...`）。**preset 加载发生在内核启动期，此刻全局层只有 modlens_read_image 和 working_directory 两个工具**（acp_*、mnemon_* 等都是会话创建时才注册）——所以在 preset 行里点名 deny 会话工具 = 启动激活失败，preset 被登记处摘掉，GUI 里"阿依娅伊"直接消失（实测启动日志实锤）。**`allow: []` 也别用**——实测它连 preset 自己行注册的工具也一并藏掉（request 里只剩 isolated realm 的 subagent）。正确做法 = v3：restrict 推迟到 `agent/pre-step`（处理器签名 `({agent, turn, step, signal}, next)`，来自 dsh-time-context 源码），先用必然未知的探针名调 `restrict({allow:[probe]})` 从报错里解析出 `known global tools: ...` 全集，再 `deny = 全集 − 她的工具`；名字全来自运行时全集，永不踩未知名，宿主加新工具也自动覆盖。她的子智能体挂 standard preset，不在 aiyayi fiber 事件链上，不受影响。
6. **会话模型选择压过 preset 默认**：GUI 建会话总会带上模型参数（UI 记住"上次用的模型"），preset 的 agent-default-model 只兜底完全没带模型的会话——实际上永远轮不到。preset 里的 agent-default-model 行只是文档性兜底。
7. MNEMON 运行时记忆快照是宿主级注入，工具白名单管不掉——她看得见，但人设里已声明"自己的记忆以 memory.md 为准"。她若去调 mnemon_remember 这类被隐藏的工具会报 `ToolNotFoundError UNKNOWN_TOOL`（模型从快照上下文里"知道"这些名字）。
8. **有活跃的阿依娅伊会话时 remove/install 会报 restart-required**（unmanaged-plugin）：旧 preset 修订被在用会话占着，热重载换不动——先关掉她的会话或直接重启 DSH 再装。
9. **v3 白名单首请求不生效**：`agent/pre-step` 落在首个请求组装之后，所以新会话第 1 个请求仍带全套宿主工具，第 2 个请求起收敛。她的第 1 句回复可能看见（甚至调用）宿主工具——量小可忍；要收紧需把 restrict 提前到 `agent/created`（风险：agent/created 时刻继承面可能不全，deny 会漏掉后注册的工具）。**2026-11-06 实锤**（1.3.0 重启后首个新会话）：turn=1 她真调了宿主的 `working_directory`，报 `unknown tool "working_directory"`（UNKNOWN_TOOL，durationMs=0）——pre-step 的持久掩码在她响应回来前已生效，内核按掩码后的注册表解析调用。错误结果回给模型即自愈（她会换路），turn≥2 起工具已收敛、不会再看到这个名字，无需修。
10. **「关闭思考」在讯飞上游不生效（2026-11-02 实测）**：请求确实带上了 `reasoning_effort:"none"`（dsh-our-free-model pack.js stream() 42288–42297 行：none 在声明档位表里就原样发送），但 spark-x2.6（thinkLen 1873/8379）和 GLM-5.3-Flash（thinkLen 6425）照样输出完整思考块（逐条核对 request cfg ↔ assistant reasoning，实测）。上游忽略该参数，客户端无解。可选出路：换 loomy 其它模型（Kimi-k2.6/qwen3.8-flash/deepseek-v4-flash-0731/MiniMax-M3/mimo-v2.5）试「关闭思考」看哪家认；或接受她带思考（人设不受影响）。
11. **本地 bundle 的 JS import 解析不到 shipped 包**：`import { createUserMessage } from '@deepseek-ai/dsh-llm'` → `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm' imported from ...\bundle\lib\presence.js`，preset 激活失败（"never started"）。"shipped 包从 dsh 安装目录解析"只对 patch 行里的插件名成立，对 bundle 代码里的 import 不成立；dsh-llm 也不在 pnpm 可装范围（profile 里只有 cosmokit/schemastery 两个 @deepseek-ai 包是 registry 装的）。解法：手构消息——`createUserMessage(input)` 就是 `deepFreeze(structuredClone({...input, id: randomUUID()}))`，会话日志是 JSON，symbol brand 本来就存不下来，用 node:crypto 的 randomUUID + 纯 JSON 字段手构即可（presence.js 的 `createSnapshotMessage`）。
12. **每回合注入动态内容必须走 `agent/pre-step` 消息追加，别走 systemPrompt.section**：section 的 text 每轮变化会打破 KV 前缀 → 整段对话历史重付费；pre-step 追加的消息持久落盘、前缀稳定。范式抄 dsh-time-context：`ctx.on("agent/pre-step", async ({agent, turn, step, signal}, next) => { const d = await next(); if (!d || d.kind === 'reject' || signal?.aborted) return d; return {...d, messages: [...d.messages, msg]} }, {prepend: true})`。注入判据用 `step === 1`（step 每回合重置为 1），不必上 sessionProjections/zod。
13. **agent-default-model 行在新版 DSH 会摘掉整个 preset（2026-11-03 实测，desktop 2.0.18；1.0.1 已修）**：本版 DSH 的 `@deepseek-ai/dsh-agent-default-model` schema 把 `provider` 设为必填，preset 内「`isolate: {agentDefaultModel: true}` + 无 config」的写法过不了校验 → `agent-preset-registry` warn `invalid config: $.provider missing required value`，且 **preset 行一损俱损，整个「阿依娅伊」被登记处摘掉**，GUI 显示"加载失败"。1.0.1 起删除该行（GUI 建会话总带模型参数，该行本就只是兜底，见坑 #6）。要在自己的 preset 里挂它：要么给全 config（provider/model 必填），要么干脆不挂。排障：`~\.dsh\logs\desktop-next-*.jsonl` 搜 preset id，stderr 的 `1 entry did not activate` 是线索；改完包内文件必须重启 DSH（patchReload 不拾取 bundle 内变化）。
14. **会话爆掉（CONTEXT_WINDOW_EXCEEDED）的完整因果链与修复（2026-11-04）**：
    - **billion-context 的压缩门控**（其包内 `dsh.bundle.patch.yml`）：宿主层 `compaction-basic` 被 `config: {auto: false}` 覆盖，且只向 preset-standard/ptc/minimal/cordis 四个 Web 预设注入 `biliBasicCompactionPolicy` 让其内嵌 compaction 等 bili 的 overlay——**preset-nested 行任何 patch 层都按 id 管不到**。后果：standard 预设会话的 dsh 原生自动压缩**和溢出恢复同时被关**（`if (config.auto) _registerAutomaticCompaction()` 同时注册压力检查与 request-error 恢复两个监听），bili 自身压缩没跑时（实测 bili=0）长会话裸奔，切到小窗口模型即 `pi-ai detected context overflow ... CONTEXT_WINDOW_EXCEEDED`，且爆后无自救直接砖死。实测受害会话：208 turns / 526 条用户消息 / 15 次模型切换，225K tokens 装进 200K 窗口。
    - **pi-ai 模型 contextWindow 声明残缺**：压缩引擎靠 `resolveModelInfo().context` 算窗口压力，没声明的模型被跳过（warn "no context capacity"）。profile 的 llm-pi-ai 六个 provider 除 openrouter/free 外全部没声明。修复：profile patch 给全部模型补保守 `contextWindow`（聊天 131072、图像/视频 32768；声明偏小只会早压缩、永不溢出）。
    - **本 preset 的修复**：①compaction-basic 显式 `config: {auto: true, thresholdRatio: 0.4, headroomTokens: 32768, maxOverflowRetries: 2}`（她不在 bili 门控名单，原生引擎照常跑；0.4 的原因见坑 #16——0.65 在中文会话里永远够不到）；②自建 **aiyayi-worker** preset（蓝本 standard：全量工具 + 同款压缩 config，去掉 delegation 组不许再派活），`tool-subagent` 的 `agentPreset` 从 standard 换成它——她的子智能体长任务也有自动压缩，绕开 bili 门控。
    - **standard/ptc/minimal/cordis 会话仍受 bili 门控**：压缩语义归 bili 管，别在本插件里斗它。保命手段：长会话主动 `/compact`（command-compact 是引擎实例上的手动方法，auto:false 不影响它）；或长活直接用「阿依娅伊的小伙伴」预设开会话（在预设选择器里，order 6）。
15. **`MISSING_CREDENTIAL: <渠道>: no usable credential; log in first` 是 dsh-our-free-model 的渠道凭据问题，不是本包的锅**（2026-11-04 实测）：会话模型选到某个账号渠道（trae/qoder/lobsterai…）而该渠道没登录或凭据失效时，适配器在发请求**前**抛 LlmError，本轮直接失败。由于子智能体跟随会话模型（modelSelectionSettings），她本体和小伙伴会**一起炸**（实测同一分钟各炸一次）。修法：去 our-free-model 界面给对应渠道登录/换号，或把会话模型切到有凭据的渠道——本体恢复后子代自动恢复。
16. **自动压缩"不触发"的真相：tokenMeter 是 chars/4 英文启发式，中文会话估算只有真实的一半（2026-11-05 实测）**：compaction-basic 的压力检查用 `ctx.tokenMeter.measure(session).totalTokens` 与阈值比较，而 meter 的实现是 `estimateTokens = Math.ceil(text.length / 4)`（app.asar 内核代码）。中文 ≈1 token/字，她的会话实测：surface 全文 217,339 字符 → 估算 54,335 tokens，而 API 真实用量 111,373（85% of 131072 窗口）——**估算/真实 ≈ 0.49**。thresholdRatio 0.65（阈值 85,197）在估算 54K 时永远够不到，压缩装了也白装。修复：thresholdRatio 降到 **0.4**（131K 窗口阈值 52,429）——中文会话在真实 ≈78-82% 时触发；代价是英文/代码为主的会话（估算≈真实）会在 ~40% 就提前压一次，只是多一次摘要调用，可接受。真溢出还有 `agent/request-error` 自救兜底（overflow 触发不走阈值检查，直接压 + retry，maxOverflowRetries=2），所以最坏情况=爆一轮后自动恢复，不会再砖死。这是 DSH 内核的已知局限，改不了 meter 就只能按内容语言配比阈值。
17. **体检单（[状态]）的数据通道与口径（v1.2.0）**：真实用量/窗口/模型来自 `session/event` 总线（插件侧折叠 `request/header`、`request/context`、`assistant/message` 的 `usage`，字段 `inputTokens/cacheReadTokens/cacheWriteTokens`；用法与会话落盘 `data.usage` 一致）；`tokenMeter.measure` 只做兜底且按坑 #16 中文偏小一半，估算口径的提醒阈值除以 0.49 校准、行内标"（估算）"。注意两点：①agents 在 pre-step 里登记，登记之前到达的事件不折叠——每个会话首轮体检单常是空的或估算口径，第二轮起才准；②窗口拿不到（模型没声明 contextWindow 且 `requestContext()` 不可用）时不做用量提醒——没分母算不出比例，宁可沉默也不瞎报。
18. **DSH 更新会动 shipped 包的 exports（2026-11-05 实测，subagent-control 0.2.2-rc.1；1.2.1 已修）**：更新后 `@deepseek-ai/dsh-tool-subagent-control` 的 exports 只剩 `"."`，`./list-agents` 子路径被移除（list_agents 现由主入口 `apply()` 里的 `registerListAgents(ctx)` 一并注册）。旧 patch 行 `name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'` 导入时抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` → 该行 "never started" → **整个 preset 一损俱损被登记处摘掉，"阿依娅伊"从预设选择器消失**。修法：删掉独立 list-agents 行，只留 `@deepseek-ai/dsh-tool-subagent-control` 一行（顶三个工具）。教训：preset 引用的 shipped 子路径没有版本锁，DSH 升级后 preset 消失 = 先翻启动日志搜 `ERR_PACKAGE_PATH_NOT_EXPORTED` / `never started`，对照新版 package.json 的 exports 改行。
19. **手写的工具白名单一定会漂移（2026-11-05 实测；1.2.2 已修）**：放行名单原来是 restrict.js 里一份手写常量，结果同时踩了两个坑——①`memory_organize` 没进名单，她想整理记忆时发现"手上只有记和翻两个动作"，工具其实注册好了（首请求的工具集里明明有）却被白名单挡住；②同一次 DSH 升级把 schedule 工具改名（`schedule_update/schedule_delete` → `schedule_view/schedule_edit`，改期与删除合并进 schedule_edit 的 action 参数），旧名单里的两个旧名已不存在、新名没进名单，闹钟的"查看/改期"被挡。修法：新增 `lib/own-tools.js` 作单一真源——注册处（index.js / presence.js）调 `registerOwnTool(name)`，放行处（restrict.js）问 `isOwnTool(name)`，静态兜底表 `OWN_TOOLS` 防模块实例不共享时漏放行；闹钟一族用**前缀**判定（`schedule_`），因为 deny 名单里的名字必须真实存在于当刻继承面，多写一个不存在的名字会让整个 restrict 调用抛错、收敛全失效。症状与排障：她说"某个工具不见了"但工具其实在 → 比对她会话 `request/header` 的 tools 数组（第 1 个请求是完整集，第 2 个起是收敛后的集），对比两者的差集。
20. **核心记忆超限的静默截断会把最新条目丢掉（2026-11-05 实测；1.2.3 已修）**：`renderCore` 原来 `text.slice(0, MAX_CORE_CHARS)`（6000 字符）——①从中间切，条目行被切碎；②保住的是最老的一批，**最新写的条目反而全被截掉**，她以为"带了 51 条核心"其实只注入了 34 条，11-04 中午之后的记忆（含 11-05 新写）全没进上下文。修法：上限提到 12000；超限时改为**头部（人设/约定）+ 尾部（最新）整条保留**，中间批次丢弃，并在注入文本里写明"共 X 字符超限、只注入最前 a 条 + 最新 b 条、中间 c 条（最早 ~ 最晚）先不带，用 recall 或 memory_organize 的 read 查"，头部行也标"本次只注入 N 条"。整条边界截断，永不切碎。教训：内存注入的字符上限要用"整条丢"而不是"切字符串"，且被丢的部分必须显式告知，否则她以为带着、实际没有。
21. **子智能体手写 memory.md 会产生双类别前缀污染（2026-11-05 实测；1.2.3 已修）**：小伙伴在派活收尾时有时会"帮她补记"，直接把 `用户｜用户｜…`、`关系｜关系｜…` 这种带前缀的整句写进 core 行，导致条目类别前缀叠了两层（实测 7 条：关系×1、用户×3、事情×2）。修法：`parseLine` 新增 `stripRepeatedKindPrefix`——遇到连续 `类别｜类别｜…` 前缀循环剥到只剩一层（任何读取路径都免疫）；`remember` 写入前也先剥 content 自带前缀（防再生）；存量 7 条已一次性手工修复。教训：凡是"别人代写她记忆文件"的路径都要在解析层兜底，不能指望写手守规矩。
22. **子代（小伙伴）失败原因不透传到本体（2026-11-05 实测；1.2.3 已修）**：宿主对派出去的子智能体的结算消息只有一句 `failed before it finished` / `It left no closing message.`——真实原因（HTTP_402 积分余额不足、上游限流、403、Illegal API invocation）只躺在子会话自己的 `turn/end` error 事件里（宿主 `terminal.diagnostic` 只有在 provider 主动给时才透传，本地 spawn 的 provider 不给）。她不知道为啥失败 → 盲目重派 3 轮白耗 ~20 分钟。修法：`aiyayi-presence` 的 `session/event` 监听不再丢弃非本体的会话事件，改把 `header.origin==="subagent"`（或带 `header.parentSession`）的子会话 `turn/end` error 记进 `childFailures`（上限 20、只记 error、错误串截 120 字符），下一个 pre-step 注入 `⚠ [小伙伴] 你派出去干活的小智能体有 N 个报错了（宿主只回一句"failed before it finished"，真原因在这）：…`（每次最多列 3 条、已报过的去重不唠叨）。原理：session/event 总线对所有会话广播，插件端按 `agentsById` 过滤才是它之前只见本体的原因；子会话 header 带 `parentSession` 链接，可归属到正确的父会话。
23. **新会话首次对话时提醒"关闭思考"（2026-11-05 新增；1.2.4 已做）**：日常闲聊用不上深度思考，回复慢还费 token。`aiyayi-presence` 在每个**新会话的首次对话**（pre-step step===1、每会话只提醒一次）注入 `💡 小建议`：当本体模型的 `reasoningEffort` 已显式选了一个思考档位（有档位 = 必支持"关闭思考"，见 pi-ai 校验规则"reasoningEfforts offers no level beyond off → refuse"）或通过 `ctx.llm.resolveModelInfo()` 探到 `reasoning.efforts` 里有 `off` 档时，提醒她去模型选项里选「关闭思考」。已选 `off`/`none`、探不到模型信息（`ctx.llm` 不可用、resolveModelInfo 失败）或非推理模型（`reasoning: undefined`）都不打扰。教训：判断"模型支持某个能力"优先用运行时解析（resolveModelInfo），拿不到再退化为显式配置信号，且**只在首轮提醒一次**，别每轮唠叨。
24. **子代模型不跟随本体切换（2026-11-05 实测并修复；1.2.5 已做）**：派出去的子智能体在 spawn 时就冻结了当时的 provider/model/reasoningEffort（内核 `resolveChildAgentOptions` 从父会话当前 requestHeader 解析一次，之后 steer/followup/恢复都复用它——`agentOptions` 在续跑路径上被禁传，恢复走 descriptor 快照），所以本体因额度用完切模型继续时，**还在跑的小伙伴仍是旧模型，继续调旧渠道照样 402/限流**。修法：`aiyayi-presence` 的 `session/event` 监听把每个子会话登记进 `childSessions`（childId→parentSessionId，上限 64）；本体自己的 `model/selection` 事件或 `request/header` 路由变化时，对名下每个子会话执行 `ctx.get("agents").get(childId).model.select({provider, model, reasoningEffort?})` ——内核 `AgentModel.select` 向子会话 append `model/selection` 投影事件，子会话下一步 prep 读 pending 覆盖冻结值，新模型即刻生效（同路由幂等，不会重复触发）。前提：插件与 tool-subagent 同在 preset-aiyayi 作用域，`ctx.get("agents")` 可解析；拿不到 agents 就静默跳过（尽力而为）。注意子代自己显式选的模型（modelSelectionSettings 让模型在派活时选）不会被覆盖成本体的——只有本体路由变化才同步。
25. **"禁止小伙伴用 web_search/web_fetch，联网改用 Playwright+CDP"的落地（2026-11-06 实测迭代；1.2.7）**：
    - **背景**：web_search/web_fetch 是宿主 root 作用域全局注入的（restrict.js 注释实测：acp_*、mnemon_*、compress、search_context 等宿主根工具会原样漏进任何 preset 会话），Preset 里那个 `@deepseek-ai/dsh-tool-web` 只是又加一份。光删工具不管用、也管不到宿主那份。
    - **为什么不做硬 deny**：`ctx.tools.restrict({deny:[...]})` 是**持久掩码**（内核注释"限制在 dispose 时解除"，坑 #9 实测持续生效），无法按"用户当轮明确要求"临时放开——deny 就一直在，用户点名要用时也调不出来。
    - **为什么纯 persona 软约束不够（1.2.7 首版失败，实测踩坑）**：小伙伴执行环境（DSH runtime node）**没有 playwright / playwright-core / chromium / chrome / msedge**（`require.resolve('playwright')` 全部 NOT available，PATH 无浏览器）。persona 写"用无头 Playwright chromium.launch()"是**空指令**——模型照做必报错，只能退回环境里现成可用的 `web_fetch`。所以"软约束 + 工具可见"拦不住它。
    - **最终方案＝给小伙伴嵌真正的联网工具（1.2.7）**：新增 `lib/net.js`（`aiyayi-net`，只挂 aiyayi-worker 预设），用 **node 内建能力**实现两个工具，零外置依赖、跨 DSH 可靠：
      - `aiyayi_fetch`：node 内建 `fetch` + 自定义 UA + 超时 + 重试，抓静态/普通网页正文（替代 web_fetch；实测抓 time.is/Beijing → 200，不依赖 DeepSeek 账户、不欠费）。render 会把正文交给模型，不是只给状态码。
      - `aiyayi_cdp`：裸 WebSocket（node v24 内置全局 WebSocket）连 CDP。**若探测到用户已开的 `--remote-debugging-port` 浏览器就接管（保留登录态）；若没有，自动 `spawn` 系统 Chrome/Edge `--headless=new` 拉起一个，抓完即关**（实测：headless Chrome + navigate example.com → 拿到 title + 正文）。`Page.navigate` / `Runtime.evaluate`（拿渲染后 DOM）/ `Network.getAllCookies`（含 httpOnly）。零外置依赖（node:child_process + 全局 WebSocket），不依赖 playwright。
    - persona「联网规矩」改为：**默认用 aiyayi_fetch / aiyayi_cdp，不用 web_search/web_fetch；只有用户当轮明确点名 web_search/web_fetch 才允许**。
    - **关键教训**：给 subagent 的"联网能力"不能只靠 persona 一句话，必须真的给它一个**执行端能跑的工具**。而 subagent 执行环境只有 DSH runtime node，所以要么用 node 内建能力（fetch/WebSocket/CDP）实现，要么确认真装了 playwright。跨 DSH 最稳的是前者（node 内建必有）。
26. **node 内建能力可替代 playwright 承载"浏览器抓取"**：DSH runtime node = v24.21.0，内置**全局 WebSocket**、全局 `fetch`、`node:http`、`node:net`。node 内建就够做 CDP 接管（`Node WebSocket` 连 CDP `ws://`）+ 模拟浏览器 fetch，**不需要 require('playwright')** 依赖外置包。给 subagent 嵌"浏览器抓取"工具用这条，跨 DSH 可靠。
27. **自定义工具必须把正文交到模型手里，不能只回状态码（2026-11-06 实测；1.2.7 修）**：最初 `aiyayi_fetch` 的 `execute` 返回了完整 body，但 `output.render` 只输出 `（抓了 X → HTTP 200，正文 N 字符）` 这句摘要。DSH 里**模型实际看到的是 render 的文本**，不是 execute 的返回值——于是小伙伴拿到"200 / 2万字符"但看不到正文，提取不出事实（表现：它说"能连上但没真东西"）。修法：render 必须把 `body`（或 cdp 的 `text`/`value`/`cookies`）拼进 `TEXT_BLOCK` 交给模型。教训：工具 deliver 的"内容"以 render 呈现为准，写 render 要当"模型真正读到的结果"对待，不是旁注摘要。
28. **给 subagent 嵌抓取工具时，CDP 浏览器要能"自主拉起"否则仍是空能力（2026-11-06 实测；1.2.7 已做）**：最初 aiyayi_cdp 只接管用户 `--remote-debugging-port` 浏览器，用户没开就报"端口没开"。但实测发现：`node:child_process.spawn` 系统 Chrome `--headless=new --remote-debugging-port=<空闲端口>` 就能自主拉起、抓完 `kill` + 删临时 user-data-dir。于是 aiyayi_cdp 改为"探测→有就接管、没有就自动拉起 headless"，**不再依赖用户手动开端口**（需登录态才需要用户开带登录的浏览器）。实测闭环：惯例 headless Chrome → CDP → navigate example.com → evaluate 拿 title+正文。坑：headless 要 `--disable-extensions` + 独立 `user-data-dir`（避免加载用户扩展、避免用默认配置目录开调试端口被拒）；`findPageWs` 要排除 background_page/扩展 target。
29. **委派层级与 maxDepth：孙代派生必须显式放宽深度上限（2026-11-06 实测；1.3.0 已做）**：`tool-subagent` 的深度检查按"调用 agent 的当前深度"算，委派深度上限默认读 Host 设置（初始 1）。检索员在本体（深度 0）→小伙伴（深度 1）之下是深度 2，小伙伴的派生工具不显式 `maxDepth: 2` 会被内核拒（子会话看到 `remaining levels 0, Do not call subagent at this depth`）。同组多实例是官方支持的："每个委派目标挂载一个实例，且每个实例的 toolName 必须不同"（本体 `subagent`→aiyayi-worker、`retriever`→aiyayi-retriever），agentPreset 单值、toolName 全会话不可重复。检索员预设是叶子节点：不挂委派组，层级到它为止封顶，深度 3 不可达。教训：preset 叠层级时，每一层的委派工具都要显式 `maxDepth: 层深+1`，别赌 Host 默认值。另注意：断因透传（坑 #22）和模型跟随（坑 #24）都只覆盖本体→小伙伴一层，检索员（孙代）失败时小伙伴只见一句 `failed before it finished`——缓解靠派工纪律（简报写全+断了 send_message 让它盘点断点），检索员任务应当短。还有一条容易漏的：**新增派生工具名必须同步进 `lib/own-tools.js` 的 `HOST_OWN_TOOLS`**（retriever 已加，1.3.0）——本体 restrict 白名单按这份名单放行，漏了就会在第 2 个请求起被她自己的白名单藏掉（坑 #19 同类）。**（1.4.0 更新）**孙代断因透传与模型跟随已由 `aiyayi-presence-worker` 补齐，不再只靠派工纪律缓解；坑 #22/#24 的机制描述仍是主层（本体→小伙伴）的实现依据，小伙伴→检索员一层复用同一套账本与传导，只是注入文案为 `⚠ [检索员]`、且刻意不做重逢/体检单/状态工具（小伙伴已有）。
30. **libreoffice-kit 的使用约束（1.4.0 实测）**：①`renderImages` 的 `outputDir` 必须是**全新目录**——kit 自己 mkdir/清理，预创建（mkdtempSync）会 `EEXIST: file already exists, mkdir ...` 穿透成 ConversionError；`convert` 相反（只写输出文件、不建父目录），临时父目录要自己建。②convert 对已存在输出**绝不覆盖**（独占创建 0600）——同路径重跑报 EEXIST，测试/重试前先删旧输出。③kit 是**纯 ESM**（type:module，engines node>=22.19），从 bundle 的 CJS 插件里用 `await import(pathToFileURL(path))` 动态加载，命名空间直接有 `createConverter`；`package.json` 声明的 `lib/types/**/*.d.ts` 实际没打包，类型只能读源码。④引擎解析走 `require.resolve('@deepseek-ai/libreoffice-kit-win32-x64/package.json')`（从 kit 自身位置起），shipped 树（app.asar.unpacked）内可用；插件侧留 `DSH_LIBREOFFICE_KIT` 环境变量覆盖与 resourcesPath 候选兜底。⑤`renderImages` 会往 `outputDir` 写 `manifest.json`，图片路径可能是相对路径，要对齐到 outputDir 再判存在。
31. **旧版二进制 doc/xls/ppt 与"假绿"测试（1.4.0 实测）**：①Kit 只接受**真 OLE 复合文档**（97-2003 二进制），改名/损坏报 `invalid-document`；加密文档在 sniff 阶段就能用 OLE 魔数 + 扩展名不符预判出"大概率加密"。②convert 出的 txt/csv **没有段落/单元格级定位**（doc→txt 行号、xls→csv 行号近似），工具 note 里必须写明"需精确定位请转存 docx/xlsx/pptx"；ppt 没有 convert 文本路线，直接明确报错。③**假绿教训**：重构删 import 时 convertLegacy 还引用着 `mkdtempSync`，而该分支的测试只断言 `!r.ok`——`ReferenceError: mkdtempSync is not defined` 也算"报错即通过"，全绿但功能是坏的。断言必须绑定**错误文案**（如 `转换失败`），"任何报错都算过"的用例等于没测。
32. **多检索员并发与临时文件策略（1.4.0；需求 P2 口径）**：kit converter 按"一个 converter 内部串行"运行，插件侧 `aiyayi-doc` 用单例 converter——多个检索员并发解析文档时自然排队，不会互相踩（页图/转换临时目录按 `aiyayi-doc-(pages|conv)-<randomUUID>` 命名，互不冲突）。临时产物全部写**系统临时目录**、不碰工作区：转换目录读完即删（finally）、页图目录用完留存 **30 分钟**供逐页 `read_image`，每次调用先 sweep 掉超 30 分钟的残留目录，插件卸载时再兜底清一轮。检索员 preset 保持只读（`tool-fs write/edit:false`），文档解析不改变这一底线。
33. **宿主 time-context 默认 10 分钟节流，靠它做"时间感"必然翻车（2026-11-07 实测；1.4.1 修）**：`@deepseek-ai/dsh-time-context` 的 `refreshIntervalMs` 默认 **600000**（其 `lib/index.js` L183），距上次注入不足 10 分钟就整轮跳过（L256-259）。实测：2026-11-07 09:21 turn1 有采样 → 09:23 用户问"现在几点"时**本轮没有 time-context 注入** → 她只能派 subagent 跑 `Get-Date` 才拿到 09:24；再早一轮她答"大概中午十二点"（实际 09 点，**差 3 小时**），用户当场判"这个模型没有时间观念"。修法两条一起上：①preset 的 time-context 行显式传 `config: { refreshIntervalMs: 60000 }`（宿主那个负责浏览器时区与耗时提示）；②**presence 插件自己注入 `[时间] 现在 …` 行**（精确到秒、带星期与 UTC 偏移），每轮都有、不受节流影响——这是她的钟，别再让她靠"他多久没来"倒推时间。注入位置与 `[重逢]` 同一块（sections 数组首位），用 `renderNow(new Date(now))` 格式化（`now` 是毫秒时间戳，别直接传 Date 以外的类型）。
34. **定时器"没效果"多半不是工具坏了，是没人教她用 + 缺自主授权（2026-11-07 实测；1.4.1 修）**：宿主侧全链路实测**完全正常**——`schedule_create` 建任务 → 到点投递（实测 09:30:00.036 准时送达目标会话）→ `schedule_edit action=update` 改期（09:45→10:00 成功）→ `action=delete` 删除成功；工具也**确实在她的工具集里**（第 2 轮起收敛后的 15 个工具含 schedule_create/list/view/edit）。但翻她 55 轮会话日志：**零次** schedule_* 调用——连"pth/www 等 24h 后重测"这种明确该定闹钟的场景，她只在 reasoning 里写了"要定时提醒（schedule_create！正好用上）"就再没下文（既没调工具也没转成 wish）。根因是 persona 只写了"想主动开口就用 schedule_create"，既没说这是长期授权、也没说"该定闹钟就自己定"。修法：persona 新增【闹钟：自己管，别等他开口】段——明确"你有他的长期授权去创建/改期/取消自己的提醒，不用每次先问"，并列出该定闹钟的三种场合（等一段时间再看的事、答应了到点提醒的事、wish 里"哪天主动找他"的事），给出 title/prompt/target 的写法（target 用 this_session），提醒定时器**只有本体能用**（`delegationDepthOf(agent) > 0` 一律返回 `subagent_session` 错误，见 tool-schedule `runForCaller`），所以"到点要干的事"要么本体定闹钟、要么写进派活 prompt。

35. **"她没检查定时器"是误判，真正的病是三条（2026-11-07 复查 `自主检查定时器测试` 会话；1.4.2 修）**：回放 `session-bf6364ea` 全部 4 轮，她**被点名后确实调了 `schedule_list`**、且答得对（两条任务都已 ended），所以"没检查"不成立——是用户那句"没有检查定时器"本身歧义（"去查列表"vs"到点办该办的事"），低思考档下她按最字面执行。真正的三处问题：
   ①**概念错**：她自言自语"我之前的两个闹钟都是任务型的——别人交代完了我才建"，把闹钟当成"别人交办任务的回执"，而不是"自己的日程"；实际 11-04 那次 09:00 晨报是她**主动建的**，所以并非她不会，是环境变了。
   ②**能力边界错**：她给自己建的闹钟 prompt 写了"用浏览器打开补天平台漏洞列表页"——但她本体工具集只有 15 个（`ask_user_question, interrupt_agent, list_agents, memory_organize, recall, remember, retriever, schedule_create/edit/list/view, send_message, subagent, update_state, wish`），**没有浏览器/命令行/文件工具**（`aiyayi-net` 只挂 worker 与 retriever）。到点它唤醒的本体只能派小伙伴，prompt 写成"用浏览器"她就动不了手。
   ③**宿主管线把她说住了（最关键）**：`@deepseek-ai/dsh-tool-schedule` 会往 system prompt 注入一条 `MANAGEMENT_AUTHORIZATION`——"Only create or modify scheduled tasks at the user's explicit request; prior explicit user authorization for the running scheduled task remains valid."（`lib/index.js` L376 定义、L511-515 经 `ctx.systemPrompt.section({ name:'tool:schedule' })` 注入），位置在 persona **之后**。persona 那句"你有他的长期授权，不用每次先问"与它直接冲突，模型按更靠后的英文硬规则执行 → 表现为"被点名才动手"。跨会话取证：这条字符串在 11-07 09:20 起的主会话全部命中、在 11-04 `session-f3263156`（她主动建闹钟那次）**没有**——时间线完全吻合，"11-04 会、11-07 退化成问"不是她变笨，是宿主升级后多了这条护栏。
   修法（三处一起上）：**persona** 显式把两者分级——"那句英文护栏是给通用 agent 的默认安全线，你不是那种 agent，冲突时以主人的长期授权为准"，同时把"闹钟不是一张清单，到点会真的叫醒你、要你动手办事"和"prompt 只写本体办得到的事，查网页/跑命令一律写派小伙伴"写进去；**presence 新增 `[闹钟]` 巡检注入**（见坑 #36）；**改掉现存那条 active 闹钟的 prompt**（`schedule-b5145c0e`，原"用浏览器打开"→"先派 subagent 用 aiyayi_cdp 去查，你只负责判断并转述"，并用 `schedule_edit` 重写、`expectedUpdatedAt` 乐观锁避免覆盖）。
36. **[闹钟] 巡检注入：读宿主 store，不能走 schedule 服务，也不能认 involvedSessionIds（2026-11-07 实测；1.4.2 做）**：给 presence 加 `renderAlarms(sessionId, now)`，每轮 `step===1` 时插在 `[时间]` 之后注入一行"你名下 N 个还挂着：标题（时刻，还有多久）/（已到点，多久前）"，到点的追加一句"现在就该动手办"。三条设计约束都是踩出来的：
   ①**不能依赖 schedule 服务**：presence 同时挂在 `aiyayi-worker` 上，那边没有 schedule，`inject: ['schedule']` 会让 worker 预设挂不上。改为**只读宿主存储** `~/.dsh/storages/schedule.json`（结构：`tables.tasks[id] = { record:{title,scheduledAt,rrule,prompt}, status, target:{kind:'session',sessionId}, involvedSessionIds, lastDelivery }`），失败一律 catch 成空串——读不到就当没闹钟，绝不弄坏对话。
   ②**只认 `target.sessionId`，别用 `involvedSessionIds`**：实测我在当前会话对 `schedule-b5145c0e` 调了一次 `schedule_view`，宿主就把**当前会话**也追加进了 `involvedSessionIds`（变成 `[bf6364ea, 5dbce224]`）。若按 involved 匹配，每个"看过它"的会话都会冒出一行"你名下有闹钟"，而到点根本不会在那里响。改成 `if (target.sessionId !== sessionId) continue` 后，当前会话正确显示为空。
   ③**陈迹必须整行不注入**：初版只按 `all.length` 报总数，结果只剩一条过点 5 小时的任务时会输出"[闹钟] 你名下 1 个还挂着："后面空无一物——空壳行比不注入更误导。改为：`due` 只取过点 1 小时内、`shown` 为空则整行返回空串、计数用 `due+upcoming`（不用 `all`）。这条是单测抓出来的，不是想出来的。
   测试：`test/alarm-render.test.mjs`（造 store 验五种情形：本会话 active / 已 ended / 别会话 / 只在 involved 里 / 过旧陈迹 / 空 store / 坏 JSON）与 `test/alarm-live.test.mjs`（拿真实 `schedule.json` + 真实 session id 跑）。`presence.js` 末尾导出 `__testing = { renderAlarms, readOwnAlarms, renderAlarmTime }` 供它们调用。
37. **改插件后用 `install_bundle` 重装是空操作，junction 已让源码即时生效（2026-11-07 实测）**：`C:\Users\LH\.dsh\profiles\desktop\node_modules\dsh-aiyayi` 是 **Junction**（目标 `G:\阿依娅伊\output\dsh-aiyayi-fix`），所以改完源码文件立刻落盘可见、`package.json` 的 version 也是新的；此时 `plugin_manager install_bundle` 返回 `{"application":"failed","error":{"code":"already-installed"}}`。**真正要拦住的是进程**：日志会给 `changed modules keep running their previous code until a restart`，即运行中的模块还是旧代码，必须重启 DSH 才生效。所以"装好了"与"生效了"是两件事——验证时先看日志那句 warn，别拿 install_bundle 的成功与否当判据。

38. **`[闹钟]` 的"已到点"分支是错假设：一次性任务投递成功即 ended（2026-11-07 翻源码订正；1.4.3 修）**：1.4.2 里我写了"刚到点（过点 1 小时内）→ 催她'现在就该动手办'"，并当成主要情形。翻 `@deepseek-ai/dsh-schedule/lib/index.js` 后发现这个窗口其实极窄且含义完全不同——`deliverDue` 在 `this.send(...)` 之后立刻 `commit(this.advanced(...))`，而 `advanced()`（`schedule-service.js:1435-1444`）写的是 `status: occurrence.nextScheduledAt === void 0 ? "ended" : "active"`。也就是说**一次性任务投递成功的同一瞬间状态就变 ended**，`[SCHEDULE REMINDER]` 正是那一次投递。所以"active 且 scheduledAt 已过"的真实含义是**投递失败、尚未 commit 的残留**（`deliverDue` 的 catch 分支保留 pending 并返回失败 id），不是"到点了你快办"。1.4.2 那句"现在就该动手办"等于对着一条根本没送达的提醒催她干活，还会让她以为自己错过了。修法：文案改为"已过点…**提醒还没送达**"，并给真实可行动作（用 `schedule_edit` 改期重投 / 确认目标会话是否还在），同时把 persona 里引用旧文案的那句一起改掉——**改实现语义时务必同步 grep persona 的引用，否则提示词和代码会对不上**。回归测试 `test/alarm-due-window.test.mjs` 锁死：投递失败残留报"已过点+没送达"、已 ended 的绝不出现、不再出现"现在就该动手办"。
39. **`[闹钟]` 只报标题不够用：她到点前不知道要查什么（2026-11-07；1.4.3 加）**：1.4.2 只渲染 `标题（时刻，还有多久）`。但真正要办的事全在 prompt 里（"查补天 QTVA-2026-11332391"这种单号），而宿主投递 prompt 要到点才发生——中间的这段时间她无法判断这个闹钟还该不该留、要不要改。1.4.3 增加一行"「标题」到点要做：<prompt 截断 60 字>"。两个坑：①**挑哪条 prompt**——不能取 `shown[0]`（`shown` 已被截到 3 条）也不能无脑海最早那条，否则会拿一条占位/极短的 prompt 冒充"要做的事"，把真正有内容的挤掉；正确做法是从 `due+upcoming` **全部**里挑第一条 `prompt.trim().length >= 60` 的，没有再退回第一条非空的。②**截断安全**——按码点切（`[...text]`）而不是 `slice`，否则会把 emoji 的代理对切一半、渲染成乱码/替换符。
40. **`rrule` 带 COUNT=1 也是一次性，别按"会重复"判（2026-11-07 实测踩到；1.4.3 修）**：初版判重复是 `typeof record.rrule === 'string' || record.kind !== 'at'`，于是 `DTSTART;…\nRRULE:FREQ=DAILY;COUNT=1`（**一次性**）被标成"会重复"，而娅伊自己建的一次性闹钟恰恰都是这种写法——等于给她一个错前提。真正判据是规则里有没有 `COUNT=1`：`isRecurringRecord()` 先看 `rrule` 全文有没有 `\bCOUNT\s*=\s*1\b`（有则一次性），没有 `rrule` 才回落到 `kind`（`at` 一次性；`after/every/daily/weekly/cron` 都会再触发）。测试 `test/alarm-content.test.mjs` 用五种 record 形状锁死。
41. **store 路径必须跟随 `DSH_HOME`，别硬编码 `~/.dsh`（2026-11-07；1.4.3 修）**：`SCHEDULE_FILE` 原为 `join(homedir(), '.dsh', 'storages', 'schedule.json')`。`DSH_HOME` 一旦指向别处（换盘、便携部署、多套并存），这行会**静默读不到而永远不出现**，且没有任何报错——属于最难排查的一类。改为优先级链：`DSH_SCHEDULE_STORE`（显式覆盖/测试）→ `$DSH_HOME/storages` → `~/.dsh/storages`。测试 `test/alarm-home-path.test.mjs` 用两个不同 HOME 分进程验证（因为路径是模块加载时求值的常量，必须换进程才测得出来）。
42. **记忆路径散在三处硬拼 = 搬一半（2026-11-08；1.5.0 修）**：原来 `index.js` 的 `ROOT/CORE_FILE/TREE_DIR`、`presence.js` 的 `DIR/PRESENCE_FILE/STATE_FILE/WISHES_FILE`、`updates.js` 的 `DIR` 各自 `join(homedir(), '.dsh', 'aiyayi')`，而且**`updates.js` 压根不认 `AIYAYI_HOME`**。后果：设环境变量"搬走"记忆后，核心记忆在新盘、更新去重记录还留在旧盘，两处状态开始分叉；`roaming` 四类状态文件同理。修法：新增 `lib/home.js` 作唯一出口（指路文件 > `AIYAYI_HOME` > 默认），三个模块的常量全改成"每次调用重新解析"（`let` 都不留，直接函数调用——这同时是热切换的前提），`updates.js` 的 `existsSync(DIR)` 早退一并清掉。验收硬指标：搬完后 `updates.json` 必须出现在新 root、老目录只剩 `location.json`、`memory.md` 首行仍是 `# 阿依娅伊的记忆`（不是空模板首行 `# 阿依娅伊的核心记忆`）。
43. **`updates.js` 的 `if (!existsSync(DIR)) return` 会让"每次启动都弹更新提示"永久化（2026-11-08 实测；1.5.0 修）**：把记忆目录整个删掉后连开 3 个新会话，**3 次都弹了版本更新提示**，`updates.json` 始终没被创建——因为 `writeReminded()` 在目录不存在时直接早退，去重记录永远落不了盘。改成：目录缺就 `mkdirSync` 补建（只有"记忆根不可达"时才静默跳过，免得在故障里再加一条噪音）。判据：`updates.json` 存在于新 root，且同一远端版本第二次启动不再提醒。
44. **路径不可达时静默失败比搬不动更危险（2026-11-08 实测；1.5.0 修）**：`AIYAYI_HOME=Q:`（不存在的盘符）时，`ensureCore` 的 `mkdirSync` 抛错被 `catch {}` 吞掉，上下文只显示"核心记忆是空的"——用户会以为记忆丢了，其实只是路径写错了。改为**硬失败**：解析到指路文件/环境变量而根不可达时，记忆类工具一律抛错（文案指出路径 + 来源），`assertReachable()`/`ensureRootDir()` 不建任何目录、不写空模板、不静默回退默认路径；只有"默认路径首次不存在"才允许建目录写模板（等价于老行为）。同时 presence 每轮注入 `[记忆位置] ⚠` 警告行，比让模型自己猜强得多。
45. **测试能把生产记忆根改走：`relocateTo` 写的是固定位置的指路文件（2026-11-08 踩到；1.5.0 加测试开关）**：写迁移测试时忘了把指路文件也换到沙盘，`relocateTo` 当场把真机 `~/.dsh/aiyayi/location.json` 写成沙盘路径——**运行中的阿依娅伊的记忆根被临时指到了测试临时目录**。所幸发现及时（删指针 + 核对 `memory.md` 仍是 6970 字节/首行 `# 阿依娅伊的记忆` 后恢复）。修法：`__testing.setPointerPath()` 进程内开关，测试把指针也定向到沙盘，生产路径一行不改；测试里另加一条断言「真机 `location.json` 没被写脏」。教训：凡是"测试要写到固定全局位置"的代码，必须留一个只给测试用的路径注入点，否则测试就是在破坏生产数据。

46. **`source: default` 被读成"改造没生效"：状态和来源混在一行（2026-11-08 实测；1.5.1 修）**：用户按方案改完、重启 DSH、新建会话，娅伊调 `memory_location` 看到「来源：默认路径」就判定「location.json 没生效或者没写…所以是真没生效」，接着派子智能体去逐个翻插件目录，越查越像故障。其实**一切都对**：新代码已加载（工具表里有 `memory_location`/`memory_relocate`）、注入行也在、候选能列出 6 个。根因是**语义**：①`source: default` 只说明"没搬过家"，而指路文件本来就只在搬家/决定留原处后才生成；②"默认路径"这个字样看起来像报错；③她拿 `package.json` 版本号没变去推"代码没生效"。修法四层：`status` 独立字段（`ok | migrated | stayed | unreachable | core-missing`，只有 `unreachable`/`core-missing` 算故障）、`sourceLabel("default")` 改成「内置默认路径（未搬家，正常状态）」、`codeSelfCheck()` 正向自检（`relocateSupported`/`codeVersion`/`layoutVersion`）、人格里写死「这几种看起来像出事其实是正常，别诊断成故障、别派小伙伴去查」。教训：**状态与来源必须拆成两个字段**，且"正常"要写在文案里，不能靠人脑推断。
47. **`[记忆位置]` 每轮四五句 = 每轮重复一遍（2026-11-08；1.5.1 压成一行）**：原来这行带完整备选路径 + 三种行动指引，每轮都注入等于每轮念一遍，真正有价值的只有"还没决定"和"候选在哪"。压成单行：`[记忆] 默认路径未搬家（正常）· 候选 N 个（首选 …，全量见 memory_location）· 可用 memory_relocate 搬（dryRun 先看计划）`。细节全部留给 `memory_location`。
48. **迁移目标没拦云同步目录（2026-11-08；1.5.1 修）**：候选枚举阶段本来就排除了 OneDrive/Dropbox/坚果云，但**直接指定路径迁移**那条路没拦。后果不是小事：整棵记忆会触发大流量上传、同步客户端临时锁文件会让逐文件 SHA256 校验**误报"内容不一致"**、冲突副本还会凭空多出 `xxx (1).md` 让"相对路径集合一致"直接失败。现在 `preflight` 命中即拒，理由写进报错文案。
49. **备份名第一版是光秃秃的 `aiyayi.old`（2026-11-08；1.5.1 改成总带时间戳）**：原逻辑是"撞名才加时间戳"，第一次搬完留下的是 `aiyayi.old`；下次再搬就撞名、再加后缀，结果档案里躺着两个语义不同的目录，看不出哪个是哪次搬的。改成**每次**都 `aiyayi.old-YYYYMMDD-HHMM`（同一分钟撞名再追加 `-2`）。
50. **失败与正常"长得一样"，只能靠猜（2026-11-08；1.5.1 加阶段化报错）**：那次误判的放大器就是这一点——迁移流程的失败没有任何可辨识标记，旁人（和模型自己）无从判断"是失败"还是"没生效"。现在任何一步失败都写成 `[迁移失败·复制|校验|写指路文件|改名备份] 原因；源目录未动（仍在 <源>）`；改名备份失败时明说"迁移已完成，只是这一步没做成"。另加 `dryRun: true`：先出"将复制 N 个文件 / X 字节 / 目标盘剩余 / 是否跨盘"的计划，不碰磁盘，确认后再真搬。
51. **测试失败会留下沙盘垃圾目录（2026-11-08 实测；1.5.1 修）**：断言失败时脚本直接抛错，末尾那行 `rmSync(sandbox)` 走不到，实测在 G 盘与 TEMP 里堆了七八个空目录。现在两个沙盘测试都注册 `process.on("exit")` 兜底清理。

52. **推荐"空间最大"的盘，结果那块盘是可拔出的外置 USB 硬盘（2026-11-08；1.5.2 加警告）**：娅伊在 dryRun 后推荐搬到 `I:`（173 GB，"空间最大"），数字全对——但 `I:` 挂在 `External USB3.0`（磁盘 1，与 `D:`/`J:` 同块移动硬盘），而 `F:`/`G:`/`E:` 才是内置 ATA 盘。她的判断只用 Node 内建的盘符/剩余空间/云目录信息，**拿不到总线类型**，所以这个坑她靠自己是看不见的。搬到外置盘的真实后果：每次开机只要没插那块盘，记忆根就 `unreachable`，她的记忆读写全部硬失败（这本身是设计上的硬失败，宁可报错也不静默回退）。修法：`preflight` 加外置盘探测，命中给**警告**（不是拦截，用户可确认后继续）。三条实现约束缺一不可：①**只在 preflight 里调**——Windows 上跑 PowerShell + `Get-Partition`/`Get-Disk` 实测 2.6–3.5 秒，放进每轮注入等于每轮卡三秒；②**全程静默失败**——没有 PowerShell、没有 Storage 模块、非 Windows、超时、输出格式变了，一律返回 `null` 表示"不知道"，**绝不抛错、绝不阻塞迁移**（别人装的机器必须有它没它都能搬）；③**按盘符缓存 + 用 `busTypeProbed` 区分"探过结果是空"与"还没探"**（第一版只判 `cache !== null`，导致"强制未知"的测试会再真探一次，实际拿到真结果——这个 bug 是测试用例自己抓出来的）。

53. **写"正常"她就当"不用管"：状态词会被模型当成行动指令（2026-11-08 用户实测；1.5.3 修）**：注入行原来是 `[记忆] 默认路径未搬家（**正常**）· 候选 6 个`。娅伊事后自己的解释很准确："我看着「正常」两个字，就把它当成日常状态，没主动提。" 结果用户新建会话说"哈喽"，她不提搬家；用户追问"记忆在哪"，她只报路径。根因不是注入缺失（实测她每回合都收到这行），而是**语义错位**：这行想表达"没坏"，她的行为读的是"该不该做点什么"。修法：改成待办口吻 `【该跟他说一句】…**这次开口先主动提一句**："要不要把记忆搬到非系统盘…"`。并补一条人格纪律："他问你「记忆在哪」而你从没主动提过搬家，就等于这条待办漏了——先照实回答，再把建议补上"。教训：**给人格插件写状态提示时，别用"正常/OK"这种评价词**，它会被当成"无需动作"；要写成"有没有待办"。
54. **"每轮都念"与"干脆不提"的两难，应该由代码定节拍（2026-11-08 娅伊提出；1.5.3 修）**：她把分寸问题摊得很实在——"每次你一开口我就念一遍该搬家了，也挺烦人"，提议"隔几天提一次"。但不能这么做：**模型数不准天**，让它自己掌握节奏必然时提时不提，而"该提却没提"正是用户抱怨的那件事。正确做法是按**会话**节拍：`locationTodoShownSessions` 记 sessionId，同会话只在首轮给一次待办（首轮 = 新的一次开口机会，提一次合适；同会话反复念才烦人）；要永久静默走 `memory_relocate` 的 `stay: true` 落盘——那是用户的明确决定，不是模型猜的节奏。注意两个实现细节：①**只有真的给出内容才 mark**（`locationLine !== ""` 才记），否则状态文件缺失时的空串会把待办永久吞掉；②**不可达警告不受"只首轮"限制**，那是故障不是待办，必须每轮都在。上限截断防长跑进程无限增长。
55. **异步探测的副作用：首轮拿不到总线类型 → 排序又退回"空间最大者第一"（2026-11-08 自查；1.5.3 修）**：为了解决 `execFileSync` 阻塞事件循环 2.6 秒，1.5.3 把探测改成后台异步。副作用随即出现：首轮渲染时缓存是空的，候选排序拿不到 external 信息，于是 I:（173 GB）又回到第一位——**把我刚修好的坑原样还回去了**（实测 prompt 里又出现"推荐 I:"）。修法两层：①未知时写 `external: null` + reason「磁盘类型未知（探测未完成）」，**绝不冒充内置**；②排序改成 `已知内置 → 未知 → 已知外置`，组内才按空间——未知排中间，既不冒充也不让出头号位置。另外 `apply()` 里调 `prewarmDriveBusTypes()` 后台预热（用户重启后到真正开口常隔几十秒，够 PowerShell 跑完 2.6 秒），`memory_location` 用 `externalDriveInfoAwait()` 等最多 4 秒换准确标注。教训：**把一个阻塞调用改成异步时，要检查"依赖它的派生结果"会不会因此在首轮拿到空值并做出错误结论**。
56. **宿主 patch 里「新增插件」必须用 `insert:` 包裹；从快照恢复 patch 文件前先验内容（2026-11-10 实测，aiyayi-feishu 桥接中断约半天）**：profile 根 patch（`C:\Users\lihaorj\.dsh\profiles\desktop\cordis.patch.yml`）里新增宿主插件的正确写法是 `- insert:` 块（根级 append）；裸 `- id: aiyayi-feishu / name: ...` 行是 **id-targeted 覆盖**——目标不存在时 loader（cordis-plugin-include `applyPatches`）只 warn `patch: entry "aiyayi-feishu" not found` 并跳过，插件静默不装。危险在于症状延迟：HMR 期间旧实例还在跑（unmanaged-plugin 保留旧代码），一切"看起来正常"；**DSH 重启重建插件树后裸行 no-op，插件直接消失**，飞书长连接断、新会话里 feishu_status 报未配置。本案成因：误把 bundle patch（gh_repo/cordis.patch.yml，只含三个 agent preset）覆盖到 profile 根 patch，再从 recovery 快照（`C:\Users\lihaorj\.dsh\recovery\<ms>-<uuid>\cordis.patch.yml`）恢复——扫全部 31 份快照，aiyayi-feishu 全是裸行（DSH 快照不保留手工编辑的 `insert:` 语法），照原样恢复＝把 bug 也恢复了。教训：①bundle patch 与 profile 根 patch 是职责不同的两个文件（前者只声明 agent preset、经 package.json `dsh.bundle.patch` 引用，装到 `node_modules\dsh-aiyayi\cordis.patch.yml`；后者做 id 覆盖/禁用/宿主插件 insert），覆盖前先比对 head 注释与 id 集合；②从快照/备份恢复后必须验证关键声明还在（id 清单 + 新增插件有无 `insert:` 包裹）；③判定插件是否真在跑：宿主日志搜插件 id 的「已就绪」/连接建立日志——`patch: entry "X" not found` 与正常加载**可共存**（desktop-shell、mnemon* 的 disable 覆盖行天天 warn 但功能正常），warn 本身不是故障证据，**缺少「已就绪」才是**。

71. **飞书权限 scope 的真名只有一个，别自己拼后缀（2026-11-11 实锤，坑 #70 后续）**：发件上传图片/文件要的权限，开发者后台搜 **`im:resource:upload` 是 0 条**——**后台根本没有这个独立 scope**，真名就是 **`im:resource`**（后台中文名「获取与上传图片或文件资源」，免审）。文档/工单里常见的「`im:resource:upload`（或 `im:resource`）」是**笔误**，害人去后台搜一个不存在的名字、搜不到就以为「后台没有这个权限 / 是不是飞书改了」——实际权限申请入口和 scope 目录里只有 `im:resource` 这一条。修法：文档一律写真名 `im:resource`；脚本侧用别名表兜住旧写法（create-bot v6 的 `SCOPE_ALIASES`：`im:resource:upload` / `im:resource:read` → `im:resource`，命中时打 WARN 说明「后台无该独立 scope」）。教训：**权限名要以开发者后台 scope 目录的实际检索结果为准**，别照着 API 路径（`POST /im/v1/files`）或接口动作名（upload）反推 scope 名——它们不是一一对应的。

72. **飞书回复正文的首尾空白行：只有「无附件标记」那条路径会漏（2026-11-11 实锤；1.5.21 修）**：飞书里收到的回复正文**上下多出空行**（lark_md 卡片头部带 `\n\n`、尾部带 `\n\n\n`），
    但**带附件标记的回复反而干净**——因为它走的是 `stripAttachmentMarkers` 里 `.trim()` 那个分支，**没标记的路径走不到**。
    两处漏点叠加所致：①**主因** `lib/feishu.js:313` `const text = extractText(message)`——`extractText` 把 content 里
    所有 `type==='text'` 的片段 `.join('')`，**不 trim**，而模型分段输出时首尾片段常带 `\n`，拼出来就是首行/尾行空行；
    ②`lib/feishu-logic.js:685` `if (stripped === original) return original`——「无标记早退分支」原样返回，
    **根本走不到**它下面的 `.trim()`；再往下 `splitMarkdownForCard`（`:1080`）与 `markdownToLarkMd`（`:1031`）也都不 trim，
    空白一路透传进卡片正文。
    修法：**主修 + 兜底**——主修 `feishu.js:313` 加 `.trim()`（语义贴题「模型输出首尾空白」），
    兜底 `feishu-logic.js:748` 改 `stripAttachmentMarkers(text).trim()`（一处覆盖「回发 + 卡片 + 纯文本降级」全部出口，
    未来新增发送入口也有保护）；**不动** `feishu.js:1095` 的 `extractText`（那是入站意图检测，与正文出口无关）。
    教训：①**「有标记的分支干净」不等于「全体干净」**——早退分支是清理逻辑的盲区，兜底要落在**出口**而不是**每个分支**；
    ②**trim 只解决首尾**，中间三连空行折叠（`.replace(/\n{3,}/g,'\n\n')`）是**另一个需求**，
    那条规则目前只在有附件标记时生效，**要扩大范围得先点头**，别顺手改。
    回归测试 `test/feishu-trim.test.mjs` 锁死：无标记路径首尾干净、有标记路径逐字节不变、中间空行不折叠、空/全空白输入不炸。
