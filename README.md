# 阿依娅伊（aiyayi）

一个装在 DSH 里的**对话伙伴 preset**：有独立人格、有自己长期的记忆、说话像人；她本人只负责聊天，动手的活全部派给子智能体（自建"小伙伴"全量预设，1.3.0 起还能往下派"检索员"），纯查资料的活直接派轻量的检索员（1.4.0 起检索员还能解析 Office/PDF 文档，小伙伴侧自动收到检索员的失败断因）。

> 文中「坑 #N」均指 [更新日志（CHANGELOG.md）](./CHANGELOG.md)「已知坑」清单的编号。

## 她是什么

| 能力 | 实现 | 说明 |
|---|---|---|
| 人格 | `@deepseek-ai/dsh-persona`（preset 作用域 prefix） | 完整人格文本写在 `bundle/cordis.patch.yml` 的 persona 行里 |
| 长期记忆 | 自写插件 `aiyayi-memory`（本包 `lib/index.js`），两层结构 | **核心记忆** `~\.dsh\aiyayi\memory.md`（她自规划的"每轮都想带着"的条目 + 她亲手维护的【记忆索引】目录），每轮自动注入 prompt；**分类档案** `~\.dsh\aiyayi\memories\` 分类树（最深三级，分类名她自己起），平时不注入、按需加载。工具：`remember`（core: true/false + 分类 path）/ `recall`（全库搜：核心+整棵树）/ `memory_organize`（tree 看家底 / read 读档案 / move 挪窝 / index 重写目录 / forget 删条目——整理是她自己的家务事）/ `memory_location`（只读：记忆存在哪、怎么定下来的、有无非系统盘可搬）/ `memory_relocate`（搬家或"留在原处"，见下节「记忆路径与迁移」）。已有 memory.md 的存量条目全部视作核心，由她自己逐渐搬理 |
| 记忆路径可迁移 | 自写插件 `aiyayi-home`（本包 `lib/home.js`，1.5.0 新增） | **唯一路径出口**：记忆路径不再散在各模块里硬拼。解析优先级 = `location.json` 指路文件 > 环境变量 `AIYAYI_HOME` > 默认 `~/.dsh/aiyayi`；整棵记忆（含 `presence.json`/`state.md`/`wishes.json`/`updates.json`/`memories/`）一起搬，不会半搬。搬迁顺序固定为 复制 → 逐文件校验（路径集合+字节+SHA256）→ 才写指路文件 → 源目录内容改名同级 `.old` 备份；**任何一步失败即中止且源目录不动**。指路根不可达时**硬失败**（记忆工具抛错、上下文每轮一条警告），绝不静默回退默认路径、绝不新建空目录顶替 |
| 跟随会话模型 | 无需插件行（1.0.1 起移除 agent-default-model 行） | 本体模型直接跟随用户会话模型；旧版"preset 作用域挂 `@deepseek-ai/dsh-agent-default-model` + `isolate: {agentDefaultModel: true}`"的写法在新版 DSH 过不了 schema 校验（见坑 #13），已删除 |
| 干活的子智能体 | `@deepseek-ai/dsh-tool-subagent`（delegation 组，isolate workflowEngine；两个实例 toolName 不同） | `subagent`→`aiyayi-worker`（自建"小伙伴"预设，全量工具 + 原生自动压缩，见坑 #14）；`retriever`→`aiyayi-retriever`（1.3.0 新增检索员：只读摘文件/Office/PDF 文档/网页内容、带路径/URL/页码交回，本体直接派）；子代模型跟随用户会话模型，如需钉死可在 `agentOptions` 配置 provider/model |
| 文档解析（检索员专属） | 自写插件 `aiyayi-doc`（本包 `lib/doc.js`，1.4.0，挂检索员 preset） | docx/xlsx/pptx 结构化提取（docx 按段落、xlsx 按工作表+单元格、pptx 按页，都带定位），pdf 渲染成页图（`read_image` 逐页看）；旧版 doc/xls 尽力转 txt/csv（无精确定位）；加密/损坏明确报错。**纯只读**：不改文件不落工作区，临时页图/转换产物写系统临时目录、读完即清（见坑 #32）。基于 shipped `@deepseek-ai/libreoffice-kit`（用法约束见坑 #30） |
| 检索员断因透传 | 自写插件 `aiyayi-presence-worker`（本包 `lib/presence-worker.js`，1.4.0，挂小伙伴 preset） | 坑 #22 的断因透传原本只覆盖本体→小伙伴一层；1.4.0 起小伙伴侧也挂监听：检索员（孙代）失败时，真实断因（error.message 优先）自动注入小伙伴下一步消息（`⚠ [检索员]` 开头），它能自己判断续派还是重派；同时把本体路由变化同步给名下检索员（模型跟随，同坑 #24 机制层层传导） |
| 工具白名单 | 自写插件 `aiyayi-restrict`（本包 `lib/restrict.js`，v3.1 pre-step 方案）+ `lib/own-tools.js` 单一真源 | 启动期零 restrict 调用；她每个会话第一步前，先用探针从校验器报错里解析出当刻继承面全集，再 `deny = 全集 − 她自己的工具`——宿主层漏进来的 acp_*/mnemon_*/compress/search_context/working_directory 等对她隐藏，且自动适应宿主工具增减。放行名单从 `own-tools.js` 读（注册处登记、放行处判定），新增工具只改一处，不再漂（见坑 #19）。**2026-11-02 实测生效**：新会话第 2 个请求起工具恰好 11 个，第 1 个请求仍带全套（见坑 #9） |
| 重逢感知 | 自写插件 `aiyayi-presence`（本包 `lib/presence.js`） | 每个回合第一步，往消息尾部追加一条 `[重逢]` 快照（time-context 同款 pre-step 注入范式）：他多久没来（presence.json）、你上次活动、你上次留的状态（state.md）、没说出口的话（wishes.json）。快照还带**版本自述**：`你当前插件版本：dsh-aiyayi x.y.z`（package.json 现读不写死，让她对自己版本有概念、不与 DSH 桌面版混淆；有新版时 updates 插件照旧单独提醒）。跨会话生效，`[SCHEDULE REMINDER` 唤醒消息不算"他来了"。工具 `update_state`（收尾留状态）/ `wish`（add/list/done 心愿单） |
| 自我状态（体检单） | 同上 `aiyayi-presence`（v1.2.0 起） | `session/event` 总线折叠真实运行数据：模型与思考档、上下文用量（provider 实测 usage 优先，tokenMeter 估算兜底并标"估算"）、缓存命中率、上轮输出 tok/s、本会话轮数、上轮异常。变化明显（≥2048 token / 模型切换 / 异常）才注入，不每轮白涨。用量过八成/九成（估算口径按中文偏差 ÷0.49 校准，见坑 #16）注入 `[上下文提醒]`：劝用户开新会话、并让用户走之前说一声好让她收尾（update_state/补记忆/把话说完）；每档只提醒一次 |
| 主动开口 | `tool-schedule`（dsh 原生）+ persona 指引 | 到期提醒会把冷会话真唤醒、以 user 消息落进定闹钟的那个会话——她想主动说话就 `schedule_create` 定闹钟；DSH 没开着会存着、下次启动补投 |
| 新版本提醒 | 自写插件 `aiyayi-updates`（本包 `lib/updates.js`） | 每个会话第一个回合查一次 npm（registry.npmjs.org，失败落 npmmirror；成功结果缓存 6h、失败 30min 后重试）：本地版本比 latest 旧时，往消息尾部追加 `[更新提示]` 快照，她会用自己的口吻顺口提一句。同一远端版本只提醒一次（updates.json 落盘去重，跨重启不重复念叨）；检查失败/离线一律静默。**判据：`~\\.dsh\\aiyayi\\updates.json` 不存在 = 从没发现过新版（本地已是最新）；她答不上"自己是什么版本"是设计边界（升级判断靠被动推送），已由 presence 的版本自述补上** |
| 其他 | time-context、compaction 组（提前压缩，见坑 #14/#16）、tool-ask-user | 她没有 bash/文件/技能/搜索/网络工具，想动手只能派活；纯查资料走 `retriever` 检索员，不惊动小伙伴 |

## 安装与启用

前提：已安装 DeepSeek Harness（DSH），Node.js >= 18。

- **安装（指定精确版本）**：在 DSH 的 profile 目录（如 `~\.dsh\profiles\desktop\`）执行 `pnpm add dsh-aiyayi@<精确版本>`，装到 `profiles\<name>\node_modules\dsh-aiyayi`。
- **便捷方式**：`dsh plugin add dsh-aiyayi`。npm 包主页：<https://www.npmjs.com/package/dsh-aiyayi>。
- **启用**：GUI 新建会话 → agent preset 选「**阿依娅伊**」（详见下节「使用」）。
- **生效提示**：升级或改动包内文件后要**重启 DSH** 才生效（patchReload 不拾取 bundle 内变化，见坑 #13、坑 #37）；她有活跃会话时 remove/install 会报 restart-required，先关会话或直接重启（坑 #8）；搬迁记忆后同理要重启（见「记忆路径与迁移」）。
- 安装 bundle 会执行宿主侧代码，DSH 会要求 Full access 或批准。

## 使用

GUI 新建会话 → agent preset 选「**阿依娅伊**」。聊天即可；她说"我让人去弄"就是在派子智能体（干活的叫小伙伴，查资料/读文档的叫检索员），进展和结果她会转述。

## 调整

- **改人格**：编辑 `cordis.patch.yml`（包根）的 persona `prefix` → `plugin_manager` remove+install 重装生效（ESM 模块缓存，patchReload 不刷新插件 JS；实测它也不拾取包内 yml 变化，改完要重启 DSH）。
- **改记忆**：直接编辑 `memory.md`，或对话里直接跟她说"记一下…"。
- **子代模型/思考**：默认跟随用户会话模型；如需钉死，在 delegation 组 `tool-subagent`（本体和小伙伴的 delegation 组各有一个）的 `agentOptions` 配置 provider/model。本体切模型会自动层层传导：本体→小伙伴（`aiyayi-presence`，坑 #24）、小伙伴→检索员（`aiyayi-presence-worker`，1.4.0）。
- **本体思考**：本体模型跟随用户会话模型，preset 自 1.0.1 起不再内置 agent-default-model 行（原因见坑 #13），`reasoningEffort` 由会话模型选择器控制；「关闭思考」在讯飞上游不生效见坑 #10。

## 架构：本体 → 小伙伴 → 检索员

三层委派，层级到检索员封顶（检索员是叶子节点，不挂委派组）：

- **本体**（preset-aiyayi）：人格、两层长期记忆、重逢感知、体检单、闹钟；挂两个委派工具——`subagent`（→小伙伴）与 `retriever`（→检索员，纯查资料直派、不惊动小伙伴）。
- **小伙伴**（`aiyayi-worker` 预设，蓝本 standard）：全量工具 + 原生自动压缩；1.3.0 起可再往下派检索员（派生工具显式 `maxDepth: 2`，见坑 #29）。
- **检索员**（`aiyayi-retriever` 预设）：只读叶子，摘文件/Office/PDF/网页、带路径/页码交回；文档解析走 `aiyayi-doc`。
- **模型跟随**：子代 spawn 时跟随用户会话模型；本体切模型经 `aiyayi-presence` / `aiyayi-presence-worker` 层层传导到小伙伴与检索员。
- **断因透传**：子代失败时真实断因注入上级下一步消息（`⚠ [小伙伴]` / `⚠ [检索员]`），上级自己判断续接还是重派。
- **续接（continuable）**：本体、小伙伴、检索员都是 continuable——DSH 重启后 `send_message` 一条消息即可冷唤醒续接；续接前 `list_agents` 现查 ID，别凭记忆敲（详见[更新日志](./CHANGELOG.md) 1.4.4 条目）。

## 文件

npm 包为平铺结构（仓库若保留 bundle/ 子目录，发布时把其内容提到包根即可）：

- `package.json` — bundle 清单（`dsh.bundle.patch` 指向 cordis.patch.yml，exports 含 `./restrict` / `./presence` / `./doc` / `./presence-worker` 子路径）
- `cordis.patch.yml` — preset-aiyayi / preset-aiyayi-worker / preset-aiyayi-retriever 三 preset 声明 + 人格 + 全部插件配置
- `lib/index.js` — aiyayi-memory 记忆插件（node:fs/os/path，零依赖）
- `lib/home.js` — aiyayi-home 记忆根目录解析与迁移插件（1.5.0 新增；零依赖，纯路径 + 文件操作，是**唯一**拼记忆路径的地方）
- `lib/restrict.js` — aiyayi-restrict 工具白名单插件（零依赖）
- `lib/presence.js` — aiyayi-presence 重逢感知插件（node:fs/os/path/crypto，零依赖；1.4.0 起导出 `createWorkerApply` 供小伙伴侧复用子代账本）
- `lib/presence-worker.js` — aiyayi-presence-worker 检索员断因透传插件（1.4.0，挂小伙伴 preset，薄壳调 `presence.js` 的 `createWorkerApply`）
- `lib/updates.js` — aiyayi-updates 新版本提醒插件（node:fs/os/path/crypto/url + 全局 fetch，零依赖）
- `lib/net.js` — aiyayi-net 联网工具（aiyayi_fetch + aiyayi_cdp，node 内建能力实现，零外置依赖，挂小伙伴与检索员 preset）
- `lib/doc.js` — aiyayi-doc 文档解析插件（1.4.0，挂检索员 preset；ZIP/XML 最小解析零依赖 + 动态加载 shipped libreoffice-kit 做 pdf 页图与旧版转换）
- `lib/own-tools.js` — 她的工具名单单一真源（注册处登记、放行处判定，防手写白名单漂移）
- `README.md` — 本文档
- `icon.svg` — 头像
- `~\.dsh\aiyayi\memory.md` — 她的**核心记忆**（条目行 `- [时间] 类别｜内容` + 末尾 `<!-- 索引 -->…<!-- /索引 -->` 目录段），可直接编辑，删掉文件她会自动重建
- `~\.dsh\aiyayi\memories\` — 她的**分类档案树**（最深三级，如 `memories\用户\口味.md`），remember 的非核心条目归这里，recall 全库搜、memory_organize 的 read/move/forget 按路径操作
- `~\.dsh\aiyayi\presence.json` — 他上次来 / 你上次活动（时间戳，插件自动维护）
- `~\.dsh\aiyayi\state.md` — 她给自己留的"上次活到哪"状态（update_state 覆写）
- `~\.dsh\aiyayi\wishes.json` — 她的心愿单（[{id, at, content, done}]，wish 工具读写）
- `~\.dsh\aiyayi\updates.json` — 已提醒过的 npm 版本号（updates 插件去重用，可删除以重置提醒）
- `~\.dsh\aiyayi\location.json` — **指路文件**（1.5.0）：记忆根搬过家或"决定留在原处"时才有。有它时插件一律按它指的路径读写记忆；删掉它立刻回到默认路径（但**别在搬完家之后删**，那会把记忆"遗忘"在新盘上，见下节红线）

## 记忆路径与迁移

（1.5.0 引入、1.5.1 加固，随 1.5.4 首次发布到 npm；版本沿革见[更新日志](./CHANGELOG.md)。）

记忆默认在 `~\.dsh\aiyayi`（Windows 上即系统盘）。想换块盘（系统盘紧张、想随工程盘一起备份、要给记忆留独立位置）时，走插件自己的通道，别手改常量、别手动搬文件。

**怎么定位置**（`lib/home.js` 是唯一出口，优先级固定、从高到低）：

1. `~\.dsh\aiyayi\location.json` 指路文件（持久、跨进程、跨终端）
2. 环境变量 `AIYAYI_HOME`（向后兼容，测试与临时重定向用）
3. 默认 `~\.dsh\aiyayi`

**有指路文件时环境变量不起作用**——所以别把 `AIYAYI_HOME` 当搬家结果交付（进程级、易被清、`updates.json` 早期不认它）。

指路文件长这样（`relocateTo` 自动写，不用手填）：

```json
{
  "version": 1,
  "root": "G:\\阿依娅伊\\记忆",
  "relocatedAt": "2026-11-08T21:30:00+08:00",
  "from": "C:\\Users\\LH\\.dsh\\aiyayi",
  "coreBytes": 6970,
  "coreSha16": "E481501B53A14571"
}
```

决定"就留在原处"时同一文件、同一格式，只是换成 `"stayOnSystemDrive": true` + `"decidedAt"`。

**两个工具**：

| 工具 | 性质 | 干什么 |
|---|---|---|
| `memory_location` | 只读 | 报当前根、**状态**（见下表）、来源、是否系统盘、体检（核心记忆首行+字节数、分类档案数）、**正向自检**（`relocateSupported` / `codeVersion` / `layoutVersion`）、非系统盘候选（按剩余空间排，标"与插件同盘"）。不建目录不写文件 |
| `memory_relocate` | 写，须 `confirm: true`；`dryRun: true` 不需要 | `dryRun` 只报计划（将复制 N 个文件 / X 字节 / 目标盘剩余 / 是否跨盘）不碰磁盘；`confirm` 真搬；`stay: true` 记录"留在原处"。搬完整棵记忆：`memory.md`、`memories/`、`presence.json`、`state.md`、`wishes.json`、`updates.json` 一个不落 |

**状态与来源是两个维度**（1.5.1 拆开，这是 2026-11-08 那次误判的直接修正）：

| `status` | 含义 | 是不是故障 |
|---|---|---|
| `ok` | 内置默认路径、可读、**还没搬过家** | **不是**。指路文件只在搬家/决定留原处后才生成 |
| `migrated` | 已按 `location.json` 搬到别处 | 不是 |
| `stayed` | 已决定留在原处（不再提示） | 不是 |
| `unreachable` | 根不存在 / 不是目录 / 指路文件坏了 | **是**，唯一真故障 |
| `core-missing` | 根在但 `memory.md` 不在 | 是（首次使用也长这样） |

> 只看 `source: default` 就断定"改造没生效"是错的：它只说明**没搬过家**。判代码活没活，看 `relocateSupported: true` 和 `codeVersion`（代码里的正向自检），别拿 `package.json` 版本号推。

**搬迁顺序（写死在 `relocateTo` 里，任何一步失败即中止、源目录不动）**：

1. **dryRun**（可选）只出计划，不碰磁盘——预检和真搬共用同一份计划，看到的数字就是会发生的数字
2. **preflight** 预检 10 条：包目录内、系统盘、目标已存在且非空、父目录不存在/不可写、原地搬、剩余 < 源×3、`~`/`%VAR%` 未展开、首尾空白、不可见字符（含 U+FEFF）、**云同步目录**（OneDrive/Dropbox 等）→ 每条给具体原因
3. **copy** 逐文件复制（只复制，不移动——跨盘 move 失败会两头不齐）
4. **verify** 相对路径集合 + 每文件字节数 + SHA256 三项全过；失败则清掉**目标副本**（源目录绝不碰），可干净重试
5. **writePointer** 校验通过**之后**才写 `location.json`（指针先写＝复制中途断电会跳到半份目录）
6. **backup** 源目录内容改名到同级 `aiyayi.old-YYYYMMDD-HHMM`（**每次都带时间戳**，1.5.1 起），**不删除**；老目录最后只剩 `location.json`

**失败文案带阶段名**：`[迁移失败·复制|校验|写指路文件|改名备份] 原因；源目录未动（仍在 <源>）`。改名备份那一步失败时迁移**已经成功**（指针写好、校验通过），文案会明说。

**回滚**：删掉 `location.json` 就回到默认路径——但**备份目录还在**，两边会分叉；删之前先确认新位置要不要留。想彻底回到旧路径，把备份内容移回去、再删指针。

搬完要**重启 DSH** 才完全生效（运行中的进程还用旧常量；返回值里 `needsRestart: true`）。

**不可达时是硬失败**：把目标盘拔了/改名后，`memory_location` 报 `status: unreachable`、记忆类工具直接抛错、上下文每轮出现 `[记忆] ⚠ …` 警告行——**不会**建空目录、不会写空模板、更不会静默回退默认路径（那会让"盘回来时两份记忆分叉"）。

**系统盘提示**：记忆根在系统盘且还没做过决定时，**每个会话第一次开口**注入一条 `[记忆] 【该跟他说一句】…` 待办，要求她主动提一句。三个设计决断（都是被实测打出来的）：

1. **口吻必须是"待办"，不能是"正常"**（1.5.3）。原来写「默认路径未搬家（**正常**）」，娅伊读成"没事、不用管"，于是新会话开场她不提，要等用户问。这行想表达的是"没坏"，而她的行为读的是"该不该做点什么"——**状态词会被当成行动指令**。
2. **频率由代码定，不交给模型数日子**（1.5.3）。她提过"每次你一开口我就念一遍该搬家了，也挺烦人"，建议"隔几天提一次"。但模型数不准天，硬要它掌握节奏必然时提时不提——而"该提却没提"正是用户抱怨的那件事。所以按**会话**节拍：每会话首轮给一次，同会话内不再出现；跨会话再给一次（新会话=新的一次开口机会）。真要永久静默，用 `memory_relocate` 的 `stay: true` 落盘。
3. **不可达警告永远每轮都在**，不受上面那条"只首轮"的限制——那是故障，不是待办。

一旦有 `location.json`（含 `stayOnSystemDrive: true`）就永久安静。

**选盘看"内置/外置"，不能只看空间**（1.5.3）：`memory_location` 的候选会标「内置盘（更稳）」/「⚠ 可拔出的外置盘」，排序是**已知内置 → 未知 → 已知外置**，组内才按剩余空间。**探测没完成时标"未知"，绝不冒充内置**——否则排序会退回"空间最大者第一"，把娅伊推荐外置盘那个坑原样还回来（2026-11-08 实测过）。

**红线**（出事都是这几条）：

- 搬完家别删 `~\.dsh\aiyayi\location.json`——删了再删旧目录，等于把记忆根"遗忘"在默认路径上，而新盘那份还在，两份开始分叉。
- 别删 `aiyayi.old`——那是唯一回退凭据，至少留到验收全过。
- 目标别设进插件包目录（插件升级会覆盖记忆），`preflight` 会拒。
- 别把目标设进 OneDrive/Dropbox/坚果云这类云同步目录：会触发大流量上传、同步客户端临时锁文件会让 SHA256 校验误报、冲突副本还会破坏文件集合一致性。`preflight` 会拒。
- **优先内置盘，别选外置 USB 盘**（1.5.2）：搬到外置移动硬盘后，每次开机只要没插那块盘，记忆根就 `unreachable`、她的记忆读写全部硬失败。`preflight` 对可拔出盘（`BusType` = USB/SD/MMC）会给警告但**不拦截**（你可以确认后继续）。探测方式：Windows 上跑一次 `Get-Partition` + `Get-Disk`，**只在 preflight 里调、结果缓存、失败静默**——没有 PowerShell / 非 Windows 时返回"不知道"，绝不阻塞搬家（别人的机器必须有它没它都能搬）。
- 别用 `move`/跨盘 `rename` 搬目录；`relocateTo` 用的是"复制+校验+源目录内容改名"。
- 写 `location.json` 只走 `writePointerFile()`（Node `writeFileSync(..., 'utf8')` 天然无 BOM）；**别**用 PowerShell `Set-Content -Encoding UTF8`（PS 5.1 带 BOM，上次就是这个坑把三个 preset 全搞没）。

**回归测试**：

- `node test/home-relocate.test.mjs`：沙盘里造全套记忆 → 验优先级 / 10 条预检 / 端到端迁移 / 老目录只剩指针 / `updates.json` 跟随 / 失败可回退 / 候选枚举 / `status` 与 `source` 分离 / 正向自检 / dryRun 不碰盘 / 阶段化报错。
- `node test/tools-surface.test.mjs`：假 ctx 走真实 `apply()`，验工具 schema 合规、`memory_location` 只读且字段齐、`memory_relocate` 的 confirm/dryRun 闸、注入行是 `[记忆]` 一行且明说"正常"。
- `node test/persona-continuation.test.mjs`：断言人格里"未搬家是正常""版本号没变 ≠ 代码没生效""真故障只有一个判据""先 dryRun""回退办法""优先级固定"这几条纪律还在——**这几条就是防止那次误判再次发生**。

注意：这两个测试会把**指路文件**也定向到沙盘（`__testing.setPointerPath`），否则它会写脏真机上的 `~/.dsh/aiyayi/location.json`，把运行中的记忆根临时改走——2026-11-08 真踩过一次。

## 更新日志

[更新日志](./CHANGELOG.md) —— 版本条目（新 → 旧）、npm 发布状态与完整踩坑记录（坑 #1–#55）。版本事实以 npm registry 为准，正文不再逐版本罗列。

## 署名与许可

- 作者与维护：**巴依浩爷（bayihy）**
- 仓库：[GitCode](https://gitcode.com/BayiHY/dsh-aiyayi) · [Gitee](https://gitee.com/BayiHY/dsh-aiyayi) · [GitHub](https://github.com/BayiHY/dsh-aiyayi)
- 许可：MIT（[LICENSE](./LICENSE)）
