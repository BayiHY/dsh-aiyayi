# 更新日志

> **维护约定**：新版本发布时在顶部加条目。本文件由 README 正文拆出（2026-11-09 重构）：版本条目与踩坑记录原文照录，数字、时间、日期一律不改（量化保真是本插件的规矩）。版本事实以 npm registry 为准。
>
> **npm 发布一览（2026-11-13 18:25 回填：1.6.3 已发布，registry `dist-tags` 实测 latest = 1.6.3）**：latest = **1.6.3**（2026-11-13T10:20:48Z publish，registry 记录 `time["1.6.3"]` = `2026-11-13T10:23:03.057Z`，客户端双值可见 18:23:33，同步约 2.8 分钟，shasum `7fad51bc…`，53 个文件，`gitHead` = `d95901b`；见本文件 1.6.3 条目、DEPLOY 1.6.3 台账）。**1.6.3 是 1.6.2 上线后实测暴露的误报修复**（档案健康度——结构行不再当垃圾 + 阈值按档案类型分开）。上一版 **1.6.2**（2026-11-13T08:59:45.517Z 已发布，shasum `d6e09000…`）。下列长串是 1.5.39 时代的旧记录，原文保留、以 registry 为准。已发布：1.0.0、…、1.5.7、**1.5.14**、**1.5.15**、**1.5.16**、**1.5.17**、**1.5.20**、**1.5.21**、**1.5.22**、**1.5.23**、**1.5.24**、**1.5.25**、**1.5.26**、**1.5.27**、**1.5.28**、**1.5.29**、**1.5.30**、**1.5.31**、**1.5.32**、**1.5.33**、**1.5.34**、**1.5.35**、**1.5.36**、**1.5.37**；跳号 1.3.0、1.4.1、1.4.2、1.5.0、1.5.1、1.5.2、1.5.3、**1.5.8–1.5.13** 从未发布到 npm（本地开发线：1.5.8–1.5.11 飞书桥接、1.5.12 思考纪律约束、1.5.13 内置技能同步+feishu-setup 骨架）；1.5.14 已发布（坑 #58–#67 修复）；1.5.15 已发布（扫码接入改造）；1.5.16 已发布（feishu-setup 技能脚本入包）；1.5.17 已发布（坑 #68 重入保护修复）；**1.5.18 / 1.5.19 也从未发布到 npm**（见下方 1.5.18 / 1.5.19 条目——它们的代码最终随 1.5.20 一起进 npm）；**1.5.20 已发布**（飞书正文改走 interactive 卡片 + lark_md，含 1.5.19 附件收发与问答卡片、1.5.20 markdown 渲染，以及 create-bot v6 权限集中化）；**1.5.21 已发布**（修飞书回复正文首尾空白行，坑 #72）；**1.5.22 已发布**（多应用多长连接改造+chat 归属机制，见下方 1.5.22 条目）；**1.5.23–1.5.25 已发布**（230001 边界/补 import/补 feishuCode 挖码三轮装版断言增量修复，见下方对应条目）；**1.5.26 已发布**（回发多文本段覆盖丢段修复，坑 #73，见下方 1.5.26 条目）；**1.5.27 已发布**（微信通道并入，默认关闭，见下方 1.5.27 条目）；**1.5.28 已发布**（PowerShell 版本体检 + 微信通道收尾，见下方 1.5.28 条目）；**1.5.29 已发布**（发布包排除 `test/` + 测试残留空目录清理，见下方 1.5.29 条目）；**1.5.30 已发布**（create-bot 注释改用 `<记忆根>` 占位，见下方 1.5.30 条目）；**1.5.31 已发布**（PowerShell 体检 `major:null` 根因修复：探测链补上 powershell.exe 一级，见下方 1.5.31 条目）；**1.5.32 已发布**（行为变更：首次提示同时告知微信 ClawBot 能力 + 「对接默认落到发起对接的会话」固化为 persona 准则/文档；不含路由代码改动，见下方 1.5.32 条目）；**1.5.33 已发布**（同一准则落成代码：未绑定 chat 三档复用，不再无条件新建会话，见下方 1.5.33 条目）；**1.5.34 已发布**（纯测试修复：`presence-clock` 跨午夜偶发失败，`lib/` 零改动，见下方 1.5.34 条目）；**1.5.35 已发布**（`feishu_status` 新增最近入站路由回看 `inboundRouting` 字段，见下方 1.5.35 条目）；**1.5.36 已发布**（飞书连接状态失真修复，见下方 1.5.36 条目）；**1.5.37 已发布**（压缩前沉淀机制 precompact，见下方 1.5.37 条目）；**1.5.38 已发布**（工具包中间层首批 toolkit_cmd / toolkit_read / toolkit_write，见下方 1.5.38 条目）；**1.5.39 已发布**（toolkit 三件套注册失败修复 + feishu_bind 自动绑定，见下方 1.5.39 条目；publish 留待下一步，以 registry 为准）；**1.5.40 为当前开发版**（toolkit 执行输出对齐 output.schema——宿主对输出也做 schema 校验，见下方 1.5.40 条目与坑 #78；仅本地提交，不 push 不 publish）；**1.5.41 已发布**（Toolbox 真异步能力 + watch_read 异步工具 + mem_sync 同步工具，见下方 1.5.41 条目与坑 #79/#80；2026-11-12T07:17:11Z 已发布到 npm，latest）；**1.5.42 已发布版**（新增 `pkg_stats` 同步工具——npm 下载量 + GitHub/Gitee/GitCode 仓库热度，见下方 1.5.42 条目；2026-11-12T07:46:35Z 已发布到 npm，latest）。**1.5.43 已发布**（`mem_sync` 的 P0/P1 缺陷修复 + **破坏性变更：`watch_read`/`mem_sync`/`pkg_stats` 三个私有工具移出工具面**，实现文件保留待 1.5.44 本地清单复用，见下方 1.5.43 条目；2026-11-12T13:13:36Z 已发布到 npm，latest）。**1.5.44 已发布（latest）**（本地工具清单机制：`<记忆根>/toolbox.json` + `toolbox_list` / `toolbox_reload`，包内只留 3+2 工具、私有工具走本机清单，见下方 1.5.44 条目；2026-11-12T14:30:16Z 已发布到 npm，shasum `02a5f99e…`）。**1.5.45 已发布**（飞书引导误触发三连修 + 插件注入身份自标注，见下方 1.5.45 条目；publish 与 registry 回查见 DEPLOY 台账）。**1.6.0 已发布**（工具箱自主成长开放给所有用户，2026-11-13T01:05:35.003Z 发布，shasum `c2b25e57…`，55 个文件）；**1.6.1 已发布**（能力声明最小闭环 + `toolbox_remove` + precompact 沉淀过滤修复（坑 #81）+ 飞书 pending 切换提示 + persona 三条 + README 瘦身，见下方 1.6.1 条目）。
>
> **环境标识约定（2026-11-10 新增）**：写版本条目/坑条目时，**顺手记录当时的 智能体工具-智能体模式-模型供应商-模型**（如 **DSH-创造模式-loomy讯飞-GLM5.3FLASH**），写在条目内（紧跟 git 记录行、或坑条目首行），方便回溯该条目是在哪套智能体/模型环境下产出与验证的。

---

---

## 1.6.4（2026-11-13：worker persona 增补交卷纪律——上下文见顶先交卷 + 收尾必交卷）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **本版定位**：纯 persona 文本补丁，只动 `cordis.patch.yml` 的 `preset-aiyayi-worker` 条目，代码零改动；装完要重启 DSH 生效。
- **起因**：2026-11-13 实测 worker 两次**无声中断**——上下文读重后直接断掉，既没落盘也没留汇报，娅伊只能重新追问一遍。根因是交卷纪律缺失：原 persona 的【断点可续】只管"续得上"，没管"断之前先交卷"。
- **改了什么（`cordis.patch.yml` L459-L465）**：
  1. 【断点可续】段末尾追加一条：上下文变重了就先交卷——读进大量材料、快撑不住时，立刻把已确认结论落盘，先发精简阶段汇报，别硬撑到中断（中断不会自动替你留话）。
  2. 新增独立小段【收尾必交卷】（位于【断点可续】与【联网规矩】之间）：无论成功、失败还是只完成一半，结束前必须留书面汇报（已确认结论 / 做到哪步 / 还缺什么），禁止无声结束。
- **验证**：YAML 可解析；文件头无 `EF BB BF`（BOM）；新文本确认落在 worker persona 内、未误入本体段。

## 1.6.3（2026-11-13：档案健康度误报修复——结构行不再当垃圾 + 阈值按档案类型分开）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **本版定位**：1.6.2 上线后实测暴露的**误报修复**，按 1.6.0 立下的版本号规则涨 PATCH。只动 `lib/index.js` 的健康度统计口径 + `test/memory-health.test.mjs`，`package.json` 版本号与 `lib/precompact.js` 均未改；装完要重启 DSH 才生效。

- **改了什么（`lib/index.js` 的 `fileHealth` / 新增 `isStructuralLine` / 新增 `STRUCTURAL_RULES` / 新增 `isCoreFile` / `renderCore` / `HEALTH_SCHEMA` / `tree` 与 `read` 两个调用点；`test/memory-health.test.mjs`）**：

  **一、`fileHealth` 不再把"不是条目本身"当罪（根本原因）**
  1.6.2 的 `fileHealth` 把**所有解析不出 `- [时间] …` 的行**都算成"非条目垃圾"，于是核心记忆 `memory.md` 的索引段（`<!-- 索引 -->` … `<!-- /索引 -->` 之间 72 行纯文本目录）、`#` 标题行、`>` 引用行、`---` 分隔线全被计入分母，一上来就报出很高的污染占比——纯属误报。根因是**同一个文件里有两套过滤规则**：`renderCore()`（决定每轮注入什么）早就排除了标题/引用/索引标记，`fileHealth()` 没复用，各写各的。
  - 抽出共用的 `isStructuralLine(trimmed, state)`：`#` 标题、`>` 引用、`---`/`***`/`___` 分隔线、**整段索引**（两个标记行**及其之间的所有行**，不是只跳标记行）都不进统计——既不算条目也不算非条目。
  - 索引段用行序状态机整段跳过：段里除了目录还有指到 `docs/` 的指针行，形状上可能像条目，但它们同样是索引骨架。
  - `renderCore()` 改为复用同一个 `isStructuralLine`，两套规则合并成一套，将来不会再分叉。

  **二、阈值按档案类型分开**
  - 分类档案保持 **30%**（`HEALTH_RATIO_MAX = 0.3`）：分类档案本来就该几乎全是条目，这个值在 2026-11-13 清库后对 91 个文件实测全部归零，证明它没问题；
  - 核心记忆给 **50%**（新增 `HEALTH_RATIO_MAX_CORE = 0.5`）：核心记忆带着索引骨架与分节标题，天然比分类档案"结构行多"，稍宽容一档；
  - `fileHealth(raw, { isCore })` 加了一个可选项，`tree` 里核心传 `{ isCore: true }`、每个分类档案传 `{ isCore: false }`，`read` 用 `isCoreFile(file)` 按实际路径判断。**判据严格大于才报**（`ratio > ratioMax`），边界值不响。

  **三、字节判据不动**
  `bytes > entries × avgEntryBytes × 5` 原样保留（`HEALTH_BYTES_FACTOR = 5`）。它是对的——2026-11-13 上午 266KB 那次事故就是靠它该报的；本版只动"分子分母怎么数"，不动"多大算被撑大"。

  **四、文案与说明同步改准**
  - 预警文案：`非条目内容占 X%（N 行非条目 / M 行内容；标题、引用、分隔线、索引段已排除，不计入分子分母；阈值 T%）`；"行非空"改称"行内容"，因为分母现在是剔除结构行后的内容行数。
  - `HEALTH_SCHEMA` 的 `entries` / `nonEntry` / `ratio` 三条 `description` 同步写清新口径与分档阈值。
  - `tree` 底部那行说明改为"…非条目占比（已排除标题、引用、分隔线、索引段这些结构行）；非条目占比超阈值（核心 50%、分类 30%）或字节数远超条目内容…"。
  - `read` 的健康度摘要行尾补"（已排除标题、引用、分隔线、索引段）"。
  - `lib/index.js:66` 的设计意图注释补上本次修正的原因、日期与原则：**只报可疑迹象，不把"不是条目本身"当罪**——告警响多了会被忽略，真正该看一眼的 266KB 那种反而被淹没。

  **五、发布前扫包顺带清掉的本机绝对路径残留（与本版主修复无关，但同属本版）**
  - `skills/feishu-setup/scripts/save-secret.js`：`--out` 缺省值原本写死成发版方本机的 `D:\AI\TRAE_PRO\阿依娅依\work\feishu-app-create\credential-<appId>.json`——**别人跑这条脚本会把凭证往不存在的目录写、直接 ENOENT**。改成 `path.join(process.cwd(), 'work', 'feishu-app-create', ...)`，与本目录 `create-bot.js` 的既有约定一致（它早就用 `process.cwd()`，本文件第 7 行的注释写的也是相对 cwd 的路径）。这个缺陷从 **1.5.16** 起就在已发布的包里（1.6.2 的 tarball 实测同样带这行）。
  - `cordis.patch.yml`：`writeExtraPaths` 原本写死发版方工作区的 docs 绝对路径，对其他用户是噪音（路径不存在时不生效、也不报错）。改成 `writeExtraPaths: []` + 注释说明怎么放开自己的目录；`skg_probe` / 工具脚本两处注释里的本机路径改占位写法。
  - `lib/toolkit-manifest.js` / `lib/toolkit.js` / `skills/feishu-setup/scripts/package.json`：注释与示例里的 `G:` / `D:` 盘本机路径改为 `~/tools/…` 这类通用写法（纯文档，**无行为变化**）。
  - 刻意**没改**：`CHANGELOG.md` 里 12 处历史本机路径——那是已发布条目的原文，本仓规矩是"数字、时间、日期一律不改"的原文照录。

### ⚠ 行为变化

- `health.entries` / `nonEntry` / `ratio` 三个数字的口径变了：结构行被剔除后，占比普遍低于 1.6.2。**拿 1.6.2 的占比当基线对比会看到"数字变小"，那是口径修正，不是档案变干净了。**
- 核心记忆的告警阈值从 30% 放宽到 50%；分类档案不变。
- `renderCore()` 的注入正文**多剥掉了 `---` 分隔线**（原先只剥 `#` / `>` / 索引标记行）。核心记忆模板正文开头本就有两行空行，所以注入正文开头的长相不变；但手写在正文里的 `---` 不再进 prompt。
- 输出 schema 的字段**集合没变**（仍是 7 个键），只是 `description` 改了口径说明，不影响宿主校验。

- **测试**：`test/memory-health.test.mjs` **11 条 → 21 条**（新增 10 条）。既有 11 条中仅 1 条（B）因文案从"6 行非空"改成"6 行内容"而更新断言——数值（nonEntry=3 / ratio=0.5 / 预警内容）一个字没放宽，只是跟着文案改。新增覆盖：核心记忆含索引+标题+引用+分隔线时占比 0 且不告警、索引段内的"条目形状"假行不计条目（整段跳过而非只跳标记行）、缺 `/索引` 标记时后续行仍按索引段处理、45% 时核心不报而分类报、30% 边界严格大于才报、核心超 50% 照样报、真垃圾（200 行正文）两条判据都能触发、`---`/`***`/`___` 不计非条目、结构豁免不能放太宽（`#号方案…` / `-> 指向…` 仍算非条目）、`renderCore` 与健康度同口径。全量 `node --test test/*.test.mjs` **tests 189 / pass 186 / fail 3**，挂的三条是既有环境基线（`alarm-inject` 硬编码旧路径 `G:\…\presence.js`、`home-relocate` 缺 I: 盘、`tools-surface` 的 %TEMP% 在系统盘），**零新增失败**（2026-11-13 18:0x 实跑；改前基线 179/176/3 同三条）。注意 `node --test test/` 在 Node 22 会把目录当文件跑、直接 MODULE_NOT_FOUND，必须写 glob。

- **实测（本机真实记忆库干净数据，2026-11-13 18:1x；脚本在 %TEMP%、只读不写盘）**：核心 `memory.md` **16830 字节 / 109 行 / 31 条条目**（记忆库的手动清理早先已完成：早期重复索引已清，只剩末尾一份带 `<!-- 索引 -->` / `<!-- /索引 -->` 标记的索引段，第 36–108 行共 73 行）→ 旧口径非条目 74 行 / 105 行 = **70.5%**，新口径非条目 **0 行 / 31 行 = 0.0%**、**0 条告警**（`avgEntryBytes` 386）。逐行分类核对：索引段 73 行 + `# 阿依娅伊的记忆` 标题 1 行被排除，剩余 31 行全是合法条目，**没有一行落进"垃圾"桶**——0% 是干净数据实打实算出来的，不是把垃圾藏起来。分类档案（`isCore:false`，阈值 30%）：`事情/dsh-aiyayi` 6209 字节 / 10 条 → 新旧均 **0%**、无告警；`用户/身份` 761 字节 / 3 条 → 新旧均 **0%**；`我/基线` 2769 字节 / 1 条 → 新旧均 **0%**。特殊文件 `事情/经验` 8929 字节 / 73 行 / 5 条条目：旧口径 45/50 = **90.0%** → 新口径 31/36 = **86.1%**，**仍告警**（这是该报的真情况：它是 docs/ 经验文档索引清单、不是条目档案，"成功/失败用例"那种分节标题被结构行豁免后剩下的仍是成片的非条目文字；属"该看一眼"，本版不改这个文件）。
- **本版不修历史数据、只修误差**：`70.5%`（旧口径 vs 同一份干净数据）与 `0.0%`（新口径）之间那 74 行，全部是索引骨架 + 标题，一行真垃圾都没有。1.6.2 上线时曾报 71.6% / 69.9%，那是**清理前**的数据（当时索引还有重复段、且有一段裸在正文里没被标记包住）；记忆库清干净后用旧口径算仍是 70.5%，说明**告警的真正来源是口径、不是数据**——这正是本版要修的东西。口径修正后旧基线数字不可直接对比，看趋势请统一用 1.6.3 口径。

## 1.6.2（2026-11-13：precompact_run 输出修复 + memory_organize 档案健康度与 forget 精确定位）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **本版定位**：两处实锤修 bug + 一处可观测性增强，按 1.6.0 立下的版本号规则涨 PATCH。`lib/precompact.js` / `lib/index.js` 有实质改动，装完要重启 DSH 才生效。

- **改了什么（`lib/precompact.js` / `lib/index.js` / `package.json`；新增 `test/memory-health.test.mjs`、`test/memory-forget.test.mjs`，扩充 `test/precompact.test.mjs`）**：

  修复 `precompact_run` 调用即报 `returned invalid output`（三条返回分支全部过不了宿主 output 校验）：`output.schema` 补齐 `trigger`/`memoryFile`/`filename`/`verdict` 四个漏声明字段，成功分支补 `skipped: false`（schema `required` 里声明了但实际没返回）。

  `memory_organize` 的 `tree` / `read` 新增档案健康度：报出每个档案的真实字节数、行数、条目数、非条目内容占比，并给两条独立预警（非条目占比 > 30%、字节数 > 条目数 × 平均条目长度 × 5）。起因是 2026-11-13 上午 precompact 垃圾沉淀把 `memories/事情/经验.md` 灌到 266KB，而旧版 `read` 只显示解析得出的条目、完全看不见文件真实体量。

  `memory_organize` 的 `forget` 改为精确定位：不给 `path` 时扫核心 + 全部分类档案（原先只搜核心）；时间戳归一化匹配（支持显示层 `[2026-11-13 12:50]`、ISO、`T` 分隔、全角）；命中多条时列出候选并支持 `which` 序号消歧，**一次只删一条、不批量删**；命中 0 条时给近似匹配诊断但绝不据此删除。

### ⚠ 行为变化

- `forget` 不给 `path` 时的搜索范围由「只搜核心」扩大为「核心 + 全部分类档案」。原先找不到会直接报错，现在会搜全库。
- `forget` 命中多条时不再抛错，改为返回 `done: false` + `candidates` 候选列表。**判断失败要看 `done` 字段，不能再靠抛错。**删除语义未放宽：仍然一次只删一条。

- **测试**：新增 `test/memory-health.test.mjs`（11 条）与 `test/memory-forget.test.mjs`（70 条），`test/precompact.test.mjs` 补 238 行；全量 tests 179 / pass 176 / fail 3，3 挂为既有环境基线（`alarm-inject` 缺 G: 盘、`home-relocate` 缺 I: 盘、`tools-surface` 的 %TEMP% 不在系统盘），零新增失败。

---

## 1.6.1（2026-11-13：能力声明最小闭环 + `toolbox_remove` + 沉淀过滤修复（坑 #81）+ 飞书 pending 切换提示 + persona 三条 + README 瘦身）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **本版定位**：纯功能增量 + 一处实锤修 bug（坑 #81），按 1.6.0 立下的版本号规则涨 PATCH。四批改造 + 文档瘦身合成一个版本；`lib/` 四个文件有实质改动，装完**要重启 DSH 才生效**（宿主对 `lib/` 模块的既有提示「changed modules keep running their previous code until a restart」这次是真的，不再是 1.6.0 那种"零 lib 改动"的误读）。

- **改了什么（`lib/toolkit-manifest.js` / `lib/toolkit.js` / `lib/own-tools.js` / `lib/toolkit-async.js` / `lib/precompact.js` / `lib/feishu.js` / `lib/feishu-logic.js` / `cordis.patch.yml` / `README.md` / `package.json`；新增 `docs/` 三件、`test/feishu-pending-switch.test.mjs`；删除 `lib/toolkit-extra.js`、`lib/pkg-stats.js` 及两个测试）**：

  **一、工具箱 capabilities 能力声明最小闭环（批 A）**
  - 清单条目可选声明 `capabilities: { paths: {read, write}, process, env }`；**不声明 = 全量能力**，与现状完全兼容。结构非法（未知子键 / 类型错 / `capabilities` 写成数组）→ **fail-close 拒注册该条目**，原因随条目报回会话（写错能力名比少个能力更危险，所以宁可拒）。
  - **分级 enforce 如实写明，不夸大**：① `env: 数组` → spawn 时父进程环境只透传白名单键 + 系统最低需求（PATH / SYSTEMROOT 等）+ `AIYAYI_TOOLBOX_*` 组，其余不传，**这是壳层真硬拦**；② `paths` → 执行壳是 `spawn` 外部脚本、文件读写在子进程里发生，壳层硬拦做不到，因此是**"声明 + 透传"级**（声明值经 `AIYAYI_TOOLBOX_CAPABILITIES` 透传给脚本供自觉与事后审计），壳层另做到**调用前校验**——条目自己声明的 `cwd` 与 `env` 里的绝对路径对白名单核一遍，越界**不起进程**（fail-close）；③ `process: false` → 现壳唯一执行路径就是 spawn，没有"不起进程跑脚本"的模式，故落点 = **调用即同步拒绝**（fail-close）。
  - `toolbox_list` 每条新增 **`capabilities` 标位**（恒布尔：声明了 true、没声明 false）——不声明的条目从"看不出来"变成"显形"，方便发现漏声明。
  - 清单条目的**未知顶层字段从静默忽略改为显式 warning**（拼写错误不再埋雷）；已知字段表集中在 `KNOWN_ENTRY_KEYS`。

  **二、新增管理工具 `toolbox_remove<name>`（批 A）**
  - 从 `<记忆根>/toolbox.json` 剔除指定条目 + **原子写回** + 自动 `reload`。**失败不动文件**：清单坏（带行列定位）、名字不存在、缺 `name`、清单不存在一律 `ok:false` 并原样保留文件；成功才重载，重载注销该条目对应的已注册工具。
  - 三个管理工具的分工：`toolbox_list`（只巡检不注册）、`toolbox_reload`（只读清单重注册）、`toolbox_remove`（唯一动文件的那个）。`own-tools.js` 静态兜底表同步加 `toolbox_remove`。

  **三、异步工具结果投递统一加头行（批 A）**
  - `lib/toolkit-async.js` 新增 `buildTaskResultHeader(kind, taskId)`，投递正文统一变成 **`〔工具结果〕<工具名> · 后台任务 <taskId>`** + 空行 + 归一后的输出。此前脚本输出原样投进会话，开头零标识，混在对话流里既不像工具结果也不像用户发言。1.5.45 的身份标签 `〔系统提示·非用户发言〕` 与头行并存（一个是"谁发的"，一个是"哪件任务的结果"）。
  - `record.summary` 仍记原始输出前 500 字符，头行只加在投递正文上——留痕与摘要口径不变。

  **四、npm 包移除死代码（批 A）**
  - 删除 `lib/toolkit-extra.js`（**985 行**）、`lib/pkg-stats.js`（**714 行**）及对应测试（`test/pkg-stats.test.mjs` 623 行、`test/mem-sync-1543.test.mjs` 423 行，外加 `test/toolkit-async.test.mjs` 里依赖这两个模块的整段），`package.json` 的 `exports` / `files` 同步删两条。当初保留的理由是"1.5.41/1.5.42 的单测还在用它们"，但 **`test/` 本就不进 npm 包，这个理由不成立**；`watch_read` / `mem_sync` / `pkg_stats` 自 1.5.44 起已是纯本机清单脚本（`G:\阿依娅伊\工具\…`），仓库里不再保留其实现。删除后全量测试**零新增失败**（这三个工具的清单加载路径另有 `toolkit-manifest.test.mjs` 覆盖）。

  **五、修坑 #81：precompact 压缩前沉淀把系统注入写成"经验文档"**
  - **现象**：记忆库里每会话多一份 60–71KB 的"经验文档"，内容是 persona / 核心记忆快照整批被当成对话材料沉淀——文件名形如 `You-are-an-AI-agent-*`。
  - **根因三层**：① 时机A抓"尾部 12 条 surface 节点"当候选材料，而系统注入节点（persona / 核心记忆 / MNEMON / presence 的 `[时间]`/`[重逢]`/`[闹钟]`/`[状态]`/`[记忆]`）**每步都追加在尾部**，抓到的永远是注入文本；② 没有任何"会话里真有用户说过话"的前置门，**新会话开场即可能触发**；③ 沉淀名额**先占后判**——一次误触发（verdict 不 worth）就永久烧掉该会话的自动沉淀名额。
  - **修法三道**：① **元数据判据（主防线，抄宿主判据）**——新增 `isRealConversationMessage`，只收 `role==='assistant'` 输出与 `source.kind==='user'` 的直发用户文本。宿主事实（asar 59643-59645）：user-role 的上下文注入其 `source.kind` 是 `'time-context'` / `'aiyayi-presence'` / `'compact-checkpoint'` 等，**绝不冒充 `'user'`**（"User-role context injections do not establish a user-created conversation"）；消息缺 `source` 元数据时按"不是"处理——宁可漏收，不收垃圾。② **特征表兜底**——新增 `isInjectedNodeText`，拦主防线拦不住的（飞书/微信引导注入走 followup、`source.kind` 也是 `'user'`；压缩后零宽前缀丢失的引导件）：首行前缀 `You are an AI agent` / `[时间]` / `[重逢]` / `[闹钟]` / `[闹钟·异常]` / `[状态]` / `[记忆]`，正文特征词 `MNEMON` / `〔系统提示·非用户发言〕`。③ **前置门 + 名额后置**——新增 `hasRealUserMessage`（全量扫 surface，不只尾部），会话里一条真实用户消息都没有就不做沉淀检查；`settledThisSession` 改为 **verdict 判定为 worth / settled 为 true 之后才 add**，不 worth 或检查出错都不消耗名额。
  - 另修一条：`DEFAULT_CONFIG` 注释里的 `cordis.patch.yml` 行号引用（L217-231 → L335-356，patch 长胖后早过时了）。

  **六、飞书 pending-bind 两处路由补齐（批 C）**
  - **已绑定 chat 的切换提示**：用户在会话 X 说「接飞书」后（`pending-bind={sessionId:X}`），在已绑定到会话 Y 的 chat 里直接发消息——旧代码**静默投给 Y**、X 不知情。现在投递成功后拦截一次：pending 有效且 ≠ 当前目标时，把 `[Y, X]` 写成待选列表（复用 `parseChoiceReply` 消费链，**零新路由状态**），回提示「回「2」切到 X，回「1」留在 Y（本条消息已照常投给 Y）」，然后立即 `clearPendingBind` 防每条消息刷屏。**时序是先投递后提示**（提示文案里"已照常投给 Y"必须是真的）；投递失败（Y 已死）就不提示，让 auto-new 自愈分支接管，不制造"回 1 留 Y"却 Y 已死的悬空选项。已有活跃待选列表时不覆盖，别把用户已有的编号弄乱。
  - **未绑定 chat 在 pending 有效时直接接回发起接入的会话**：不再走 1.5.33 三档列表（用户已经明确表达过要接哪个会话，别再让他选一遍），投递后回一句「已接到你之前发起接入的会话 X，这条消息已经投进去」。**修订 1.5.33 三档行为**：三档保留为 **pending 无效时**的兜底；过期的、指向子智能体的待接入目标就地清除（对齐 `bot_p2p_chat_entered_v1` L416-432 先例）。
  - 两个判据抽成纯函数 `decidePendingBindUsable` / `decideSwitchAsk`（`PENDING_BIND_TTL_MS` 同时收编到 `feishu-logic.js`，与 `feishu.js` 共用同一常量），两处引导文案（`buildSwitchPendingBindPrompt` / `buildPendingRebindNotice`）的识别串补进 `KNOWN_GUIDE_MARKERS`——防"提示文案再被当用户意图"的 1.5.45 那类自我维持触发。

  **七、persona 三条 + 口径改句（批 D）**
  - **分工口径加例外判据**：原文"动手的活一件都不亲手做"太绝对，实际她连 `feishu_status` 都不该派人查。加例外：插件自带的**轻量查询工具**（`feishu_status` / `toolbox_list` / `recall` / `toolkit_cmd` 白名单内的只读命令 / `toolkit_read` 这类几秒出结果、输出短的）本体直接调，**这不算动手**；`toolkit_write` 受限写入（白名单目录 + 64KB 上限 + 自动备份）和自己工具箱的**清单维护**也算例外；**要翻文件堆、抓网页、提炼归纳、长任务，照旧派人**。
  - **新增自主决策准则**：李浩只提线索和要点；先验证拿证据，**证据充分、方案合理就自主决策执行，别拿请示当挡箭牌**；缺证据就去查或如实说。**有代价的决定——删有价值的数据、花钱、对外发布——仍然先问**。
  - **思考纪律补证据纪律句**：遇到不确定、有冲突、有歧义的内容，**第一动作在实际环境找证据**（读实际文件、查实际状态、直接问他本人），不在已有歧义的上下文里继续推演。
  - 代码侧口径同步：`lib/toolkit.js` 头注释、`lib/own-tools.js` 的 `toolkit_*` 注释、`cordis.patch.yml` 的 toolkit 段注释都改成同款表述（"简单状态型"→"轻量查询"），避免 persona 与代码注释两套口径。

  **八、README 瘦身 + docs 三件（批 D）**
  - `README.md` **31,736 B → 17,495 B（-45%）**：细节挪到新文件 `docs/机制与实现详解.md`、`docs/工具箱与本地清单.md`、`docs/飞书接入与排障.md`，README 只留"是什么/怎么装/去哪看细节"。
  - 顺带修**坏链与过时信息**：坑条目上限改为 **#80**（原指向未来区间）、`create-bot` 版本标 **v6**；三份新文档都从 README 链进去（链不通就是坏链，逐条点过）。

- **测试**：全量 `node --test` **tests 169 / pass 166 / fail 3**，**挂的三条是已知环境失败**（`alarm-inject` / `home-relocate` / `tools-surface`，均为本机环境相关的既有基线，与本版改动无关），**零新增失败**（2026-11-13 12:32 实跑）。`node --test test/*.test.mjs` 39 个 `.test.mjs` 文件。新增 `test/feishu-pending-switch.test.mjs`（pending 优先接入 + 切换提示判据）；`test/toolkit-manifest.test.mjs` 扩 capabilities / 未知字段 warning / `toolbox_remove` 三组；`test/precompact.test.mjs` 扩注入过滤六组（7.x / 8.x / 9.x）。
- **删除统计**：`lib/toolkit-extra.js` 985 行、`lib/pkg-stats.js` 714 行、`test/pkg-stats.test.mjs` 623 行、`test/mem-sync-1543.test.mjs` 423 行，合计 **-2745 行**。

---

## 1.6.0（2026-11-13：工具箱自主成长开放给所有用户）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **版本号说明**：本版原按修订号定为 1.5.46（源码 commit `031ab55` 的提交信息与 README 标记即写作 1.5.46），发布前娅伊自主决策改为 **1.6.0**——功能性发版（新能力开放 + examples 分发）按 semver 涨次版本，同时也兑现从 1.5.43 起欠下的规矩（那次破坏性变更本就该跳版本）。李浩授权模式：证据 + 合理方案 → 自决。源码内容不变，README 标记随本条目统一为 1.6.0。
- **版本号规则（自 1.6.0 起）**：向下兼容的新功能涨次版本（MINOR）；纯修 bug 涨修订号（PATCH）；破坏性变更涨主版本（MAJOR）并在条目首行写 ⚠ 迁移说明。
- **动机（为什么发这版）**：工具箱的"攒工具"能力 1.5.44 就在了（`<记忆根>/toolbox.json` 清单 + `toolbox_list` / `toolbox_reload`），但**怎么攒只写在 README 里，persona 引导段一字未提**。实证：新装用户的娅伊根本不知道自己有一份可以自己长的工具清单——persona 对此**零命中**（她不会主动提这回事，公开用户会话里从没出现过"让小伙伴写个脚本注册进清单"这种路子），1.5.44 发版时"装完不会自动出现它们，要自己写清单"的说明只落在台账和 README，等于能力没真正开放。本版把"工具箱可攒工具"写进 persona 本体引导，并把示例脚本随包分发，让所有用户（不只是发版方本机）从第一次对话就知道、也真能用上。
- **改了什么（`cordis.patch.yml` / `package.json` / 新增 `examples/` 两文件 / `README.md`；源码 commit `031ab55` 先行，版本号另提交）**：
  1. **persona 引导段（preset-aiyayi）**：在【干活的规矩】与【重逢与心意】之间新增【你的工具箱】一段（3 句话）：清单在 `<记忆根>/toolbox.json`、想盘家底调 `toolbox_list`、改完清单调 `toolbox_reload` 生效；缺什么趁手的工具让小伙伴写个 Node.js 脚本、注册进清单——攒下来的都是自己的家伙什；清单不存在属正常（想用就从零建），工具怎么用看它自己的描述，包里 `examples/` 有现成的示例脚本。**只增不改删**（diff 复核：cordis.patch.yml 5 行纯插入、0 删改）：既有句子一条没动，尤其【你的记忆】里"要是发现该有的工具不见了……直接告诉他让他来修"那句保守上报**原样保留**——它管故障场景，新段管主动建设，两者不矛盾。
  2. **examples/ 随包分发（`package.json` files 白名单加 `examples`）**：
     - `examples/mem_sync.js` —— `mem_sync` 的通用示例脚本，从发版方本机 `G:\阿依娅伊\工具\mem_sync\mem_sync.js` 原样复制（发布前通读全文 472 行核实：**参数化设计、无本机硬编码**——记忆根走 `AIYAYI_TOOLBOX_ROOT`/`AIYAYI_HOME`/指路文件/默认位置，远端与分支只认清单配置，没配远端 = 零副作用 noop；发版方本机路径一个都没写进脚本，20201 字节与源文件逐字节一致、无 BOM）。复制到本机后在清单里把 `script` 指过去即可。
     - `examples/toolbox.example.json` —— 清单示例（一条 `mem_sync` 完整写法）；`script` 用**通用建议路径** `~/tools/mem_sync.js`（`~` 展开是加载器既有能力，实测展开为家目录下 tools/mem_sync.js），照抄后要改成自己机器上的实际路径。发布前用加载器 `validateEntry` 实测：脚本存在时 **0 校验问题**；脚本未复制到位时该条只报"脚本不存在"不注册（显式报回、不静默吞）。
  3. **README 通用化**：工具箱章节示例 `script` 从发版方本机路径（`G:/阿依娅伊/工具/…`）改为通用建议路径 `~/tools/mem_sync.js`，并加一句"examples/ 目录有现成的 mem_sync.js 可直接复制到本机使用"；「文件」章节补 `examples/mem_sync.js` 与 `examples/toolbox.example.json` 两条说明。
- **测试**：全量 `node --test test/*.test.mjs` **39 文件 / tests 168、pass 168、fail 0**（1.5.45 基线同数，改动前后各实跑一遍，2026-11-13 08:5x）；另裸 `node --test`（多发现 2 个 proof 文件）170/170 全过。persona 与 examples 均为纯新增，`lib/` 零改动。

---

## 1.5.45（2026-11-13：飞书引导误触发三连修 + 插件注入身份自标注）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **实锤现象（2026-11-13 深夜，李浩报告）**：
  - **00:13:46** 用户在飞书发「不用你看着点，我们先回测，需要交易的时候你写脚本工具，之后就只管填参数，让脚本自…」——开头恰好是"不用"，被旧版 `matchSkipIntent` 的**开头锚定正则**（`^(?:不用|不需要|不接|算了|跳过|暂时不用|先不用)`，`lib/feishu-logic.js`）误判成「放弃接入」→ **00:14:43** 会话里出现一条无关的 bot 口吻确认「好的，不接入也没关系。需要时随时说「接入飞书」或「接入微信」，我会再给你扫码步骤。」（日志 `desktop-next-2026-11-12.0.jsonl` UTC 16:13:46.723 收到消息 → UTC 16:14:4x 注入，链路完整）。
  - 该注入走 `agent.followup` + `source:{kind:'user'}`——宿主 `Agent.followup(message: UserMessage)` 的三个注入通道（followup/steer/inject）**只收 `UserMessage`**（role 恒为 `'user'`，asar Agent 接口声明），插件**没有**系统身份注入 API——于是 bot 口吻文案在会话里"以用户身份"出现。**00:20** 李浩再报：「理论上提醒应该是你（bot）的消息，但实际会莫名其妙冒出一条以我的身份推出的消息，但不是我发的」。
  - 引导文案本身含「接入飞书」「不用」等关键词，一旦被再送进检测（用户粘贴引用、上下文压缩剥掉零宽 `GUIDE_PREFIX`），引导会自我维持地再触发——"引导误触发已知问题"的新变体。
- **改了什么（`lib/feishu-logic.js` / `lib/feishu.js` / `lib/toolkit-async.js`；新增 `test/feishu-guide-no-retrigger.test.mjs`；`test/toolkit-async.test.mjs` 两处断言同步）**：
  1. **`matchSkipIntent` 整句化**：只认整句放弃（「不用/不用了/算了/跳过/暂时不用/先不用/先不接了」等，允许尾随语气词"了/啦/吧"与标点），不再认开头前缀。实锤样本「不用你看着点，我们先回测…」不再触发；真正的放弃短句照常触发（首次引导结尾教的正是"回复「不用」即可跳过"）。
  2. **skip 上下文门 `decideSkipIntent`（新纯函数）**：文本命中之外还要求会话真处于接入流程——有待接入目标（`readPendingBind`）或本会话收到过引导（`guidedSet`）——从没被引导过的会话谈不上"放弃接入"。`maybeOnboardIntent` 入口补 `loadGuided(root)`（HMR 重建后 `guidedSet` 是空的，惰性重载，上下文门不失效）。
  3. **引导文案自识别 `isInjectedGuideText`（新纯函数）**：`KNOWN_GUIDE_MARKERS` 五条特征串（首次引导 / skip 确认 / onboard 确认两处 / 微信指引）经 `normalizeForGuideMatch` 归一化比对（剥零宽 `\u200b-\u200f\u2060-\u2064\ufeff` + 首尾空白，**不依赖零宽前缀存活**），`matchOnboardIntent` / `matchWeixinIntent` 入口排除 + `maybeOnboardIntent` 调用侧再排一层——插件发过的引导文案（用户粘贴件、上下文压缩剥零宽件）不再进意图匹配、不再自我维持地再触发。
  4. **引号剥离 `stripQuotedSegments`**：「…」『…』“…”‘’成对引号段先剥再匹配——用户引用文案里的「接入飞书」不再是接入意图。
  5. **注入身份自标注**：新增 `GUIDE_IDENTITY_TAG = '〔系统提示·非用户发言〕'`，`lib/feishu.js` 四处注入（skip 确认 / onboard 确认 / 微信指引 / 首次引导）与 `lib/toolkit-async.js` 任务结果注入（`TASK_RESULT_IDENTITY_TAG`，异步工具跑完 followup 推回的结果同样不再冒充用户发言）都在文本开头拼身份标签。这是宿主 API 限制下能做到的最接近"身份一致"的方案——真·身份字段要宿主给插件开系统身份注入 API 才行（宿主 `UserMessage.role` 恒 `'user'`，本插件改不了宿主）。
  6. `buildNewSessionGuideText` / `buildWeixinOnboardText` 去掉开头「（提示）」（身份由调用侧标签统一承担；正文逐句内容不变，`feishu-weixin-guide.test.mjs` 的 a1–a7 断言原样通过）。
- **为什么不动 botIdentity 过滤（坑 #66）**：SDK 自消息回环早有 `channel.botIdentity.openId` 过滤，本次 00:14 事件**不是**入站回环——是插件**主动注入**以 `kind:'user'` 进会话。修复因此落在"防误触发 + 文本身份自标注"，不碰入站过滤。
- **测试**：新增 `test/feishu-guide-no-retrigger.test.mjs`（a–f 六组 36 断言：实锤样本回归 / 上下文门 / 粘贴件与压缩件排除 / 引号引用 / 真实意图触发 / 身份标注静态接线 / marker 与实际文案一一对应）。全量 `node --test test/*.test.mjs` **39 个测试文件 / tests 168、pass 168、fail 0**（2026-11-13 00:37 实跑）。
- **已知边界（本次不扩）**：`passesOnboardGate` 闸 2 词表之外的顺带提及（如「接飞书的事不急，先干活」）在 1.5.44 同样触发，属既有行为非本次引入，测试里注明不锁定；未来要收就扩闸 2 词表另行走查。

---

## 1.5.44（2026-11-12：本地工具清单驱动——安装包只留 3+2 工具，其余走本机脚本）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **⚠ 升级路径提示（必须先读这一条）**：**如果你从 1.5.42 或更早升级，请连读 1.5.43 与 1.5.44 两条。** 1.5.43 是**破坏性变更**：`watch_read` / `mem_sync` / `pkg_stats` 三个工具从工具面移除（不再注册、不再进白名单），`memPushRemotes` 默认改空数组、`memBranch` 默认改空串（不配置=不推也不提交）；1.5.44 把这三个私有能力接回来，但**改由本机清单 `<记忆根>/toolbox.json` 按需注册**——装完 1.5.44 不会自动出现它们，要自己写清单（清单里指向本机脚本，脚本不进包）。1.5.43 条目里那两条破坏性变更的完整说明仍然有效，此处不重复。
- **改了什么（新增 `lib/toolkit-manifest.js` + `test/toolkit-manifest.test.mjs`；改 `lib/toolkit.js` / `lib/own-tools.js` / `package.json` / `README.md` / `cordis.patch.yml` 注释 / 三个既有测试的注册面断言；本机新增三个脚本与 `toolbox.json`）**：

  **一、设计依据（李浩 2026-11-12 定调）**
  - 工具箱存在的目的是让本体**异步执行命令和工具**、不阻断对话：**每个工具都必须立刻返回 taskId，后台跑完用 followup 推回会话**。同步工具一旦卡住整轮就堵死，那还不如不用。
  - **npm 安装包里只留简单通用的能力**（toolkit_cmd / toolkit_read / toolkit_write）。其他工具走**本地清单**：清单与脚本都在本机，清单引用本机脚本绝对路径，**脚本不进 npm 包**。这样普通用户装插件不会看到一堆用不上的工具（1.5.42 时 6 个工具实测约 1334 token/轮）。

  **二、清单文件 `<记忆根>/toolbox.json`（最终格式）**
  ```json
  {
    "version": 1,
    "tools": [
      {
        "name": "mem_sync",
        "enabled": true,
        "script": "G:/阿依娅伊/工具/mem_sync/mem_sync.js",
        "description": "同步记忆仓库：git add + commit + push 到配置的远端",
        "timeoutMs": 180000,
        "mode": "async",
        "args": [],
        "env": { "AIYAYI_MEM_PUSH_REMOTES": "origin" },
        "params": { "message": { "type": "string", "description": "commit message（可选）" } }
      }
    ]
  }
  ```
  字段：`name`（必填，`^[a-z][a-z0-9_]{1,40}$`）/ `enabled`（**默认 false**，显式 true 才注册）/ `script`（必填，绝对路径，允许 `~` 与 `%变量%`、`${变量}` 展开）/ `description`（必填）/ `timeoutMs`（默认 60000，上限 300000，超上限夹取并告警）/ `mode`（**只支持 `"async"`**，写 `"sync"` 直接判该条校验失败——同步会堵对话，这正是要避开的）/ `args`（固定参数数组）/ `params`（简化 JSON Schema，只支持 string/number/boolean；`required: true` 标必填）/ `env`（给脚本的环境变量）/ `cwd`（默认脚本所在目录）。

  **三、加载器 `lib/toolkit-manifest.js`**
  - 读清单 → 逐条校验 → 为 `enabled:true` 的注册工具；**每个工具都走 `startDetachedTask`**：调用立刻返回 `{status:'started', taskId, tool, hint, error}`，后台按扩展名 spawn（`.js`→node / `.py`→python / `.ps1`→powershell / `.cmd|.bat`→cmd / 其余当可执行文件），跑完 followup 推回会话。
  - **失败一律显式，不静默**：清单不存在→只记日志（正常，用户没配）；JSON 语法错误→报回会话（带行列位置）；某条校验失败→报回（带工具名+原因），**其他条目照常加载**；脚本不存在→该条不注册并报回；运行失败/超时→followup 带退出码与 stderr 尾部摘要。
  - **能力声明校验在加载器里做**（不是脚本自己说了算）：脚本必须存在且是普通文件；路径白名单（禁指向记忆根外）这一版只做"存在性 + 越界提示"，留到以后。
  - 脚本约定：stdout 只输出一个 JSON 对象（加载器 parse 后把 `hint` 放正文首行；非 JSON 原样展示）；退出码非 0 或 `ok:false` 判失败。环境变量注入 `AIYAYI_TOOLBOX_TOOL/ROOT/MANIFEST/ARGS` + 清单 `env`。

  **四、两个管理工具（同步，只读清单，几毫秒）**
  - `toolbox_list`：列出清单每条（name / enabled / mode / script / scriptExists / registered / timeoutMs / reason）+ 清单级 problems + 行列级的 JSON 错误。
  - `toolbox_reload`：注销全部旧清单工具、按当前文件重新注册；返回 removed / registered / skipped / problems。
  - 两者都进 `TOOL_NAMES` 与 `own-tools.js` 静态表。**清单里的工具不在静态表里**——注册时由 `registerOwnTool(name)` 动态放行，保证白名单始终是超集（清单增减不会把工具挡在 restrict 之外）。

  **五、移出包内的三个工具**
  - `TOOL_NAMES` 删掉 `watch_read` / `mem_sync` / `pkg_stats`，`own-tools.js` 静态表同步删掉（并写明别再写回来：会留下"已放行但没注册"的幽灵条目）。
  - `lib/toolkit-extra.js` / `lib/pkg-stats.js` **文件保留**（实现层与 1.5.41/1.5.42 的单测继续用它们），只是不再 import 进工具面。
  - `lib/toolkit-async.js` **原样保留**（异步骨架是基础设施，清单工具全走它）。
  - `DEFAULT_CONFIG` 里的 `watch*` / `mem*` / `pkgStats*` 项**保留但不读**：只为升级用户已写的 cordis.patch.yml 项不变孤儿（默认值现在写在各自脚本里）。

  **六、三个本机脚本（`G:\阿依娅伊\工具\`，不进包）**
  - `mem_sync/mem_sync.js`：从 `toolkit-extra.js` 抽出，独立 CLI，**保留全部安全守卫**——记忆根解析（`AIYAYI_TOOLBOX_ROOT` > `AIYAYI_HOME` > `location.json` > 默认）、`rev-parse --show-toplevel` 仓库守卫（仓库顶必须与记忆根一致）、路径越界拒绝、敏感扫描（私钥正则含 `OPENSSH`：`[A-Z0-9 _-]*`）、**只扫 `+`/`-` 变化行**（P1-2）、暂存区 `A ` 也算新增文件（P1-1b）、`diff HEAD` 失败不吞成空串、远端与分支无隐含默认（没配远端=零副作用 noop；空仓库/detached 用 `symbolic-ref` 兜底、拿不到就报错）、`partial` 时 `ok:false` 并附真实远端名（P0-1/P0-2/P0-3）。
  - `pkg_stats/pkg_stats.js`：同理抽出，保留域名白名单（精确主机名 + 只许 https + 不许带凭据）、参数逐段校验与编码、15 秒总预算、各平台失败隔离、`unavailable` 写明原因。
  - `watch_read/watch_read.js`：**占位**。本机没有手表取数脚本（`skg_probe/ble_direct` 是单位机路径），清单里 `enabled: false`。脚本检测到真脚本（`AIYAYI_WATCH_SCRIPT` 或约定路径）就透传，否则如实回 `status:"not-configured"` 并给接线步骤，**不做任何蓝牙动作、不假装取过数**。
  - `G:\阿依娅伊\工具\README.md`：脚本约定 + 现有脚本表 + 怎么加新工具 + mem_sync 远端配置。

  **七、本机清单 `F:\阿依娅伊\记忆\toolbox.json`（已写）**
  `mem_sync`（enabled:true，env `AIYAYI_MEM_PUSH_REMOTES=origin`）/ `pkg_stats`（enabled:true）/ `watch_read`（enabled:false，脚本占位）。

- **为什么**：工具面的 token 成本是每轮固定开销，而"发版方私有能力"对普通用户全是噪音；同时私有能力一旦同步执行就容易堵住整轮（坑 #79）。把"装什么"从代码里挪到本机文件里，既省 token，又让每台机器按需装配，还强制了"所有工具异步"这条纪律。
- **踩坑记录（当场实测）**：
  1. **`apply()` 期没有会话，拿不到 followup**。清单在 preset 启动期加载，那时 `exec.agent` 还不存在，所以"清单坏了要报回会话"不能在 load 时直接投递。做法：load 时把问题攒进 pending，挂 `agent/pre-step`（同 restrict.js 范式，`ctx.effect` 包住），第一个 agent 的第一步注入一条 `[工具清单]` 快照消息，注入后清空（同一 agent 用 WeakSet 防重刷）。
  2. **测试必须在沙盘**。`pkg-stats.test.mjs` 原来不隔离记忆根——1.5.44 起 `apply()` 会读真机清单，等于**在真实记忆根上测**（红线）。已补 AIYAYI_HOME + 指路文件隔离，沙盘里不放 toolbox.json 等价于"用户没配清单"。
  3. **`toolbox_list` 只巡检、不注册**。写完清单不 reload 的话 `registered` 全 false，这是设计而不是 bug（巡检本就该反映"此刻注册面"而不是"清单里想要什么"），单测把这条语义写死了。
  4. **有两个既有测试的断言必须跟着改**（`toolkit.test.mjs` / `toolkit-async.test.mjs` / `pkg-stats.test.mjs` 里"6 个工具"、"TOOL_NAMES 含 xxx"、经注册壳调 watch_read）：它们测的是 1.5.41/1.5.42 的工具面。改法是**保留实现层断言、改注册面断言**（watch_read/mem_sync 改成直接调 `executeWatchRead`/`executeMemSync`，pkg_stats 改成直接调 `executePkgStats`），不删测试。
- **测试**：新增 `test/toolkit-manifest.test.mjs`（约 110 条断言，**全程 %TEMP% 沙盘**）。覆盖：清单解析（合法/非法 JSON 带行列/空文件/缺 name·script·description/name 不合规/mode:sync 被拒/version≠1/重名/timeoutMs 超上限夹取/相对路径/脚本不存在/params 非三类型/~ 与 %变量% 展开）；加载（清单不存在只记日志、enabled:false 不注册、enabled:true 注册、坏条目不影响其他条目、坏清单与条目问题都注入会话且不重复刷屏）；异步（**立刻返回 <300ms**、慢脚本 1.5 秒也不阻塞、followup 真被调到、超时被杀并投递、退出码 7 + stderr 摘要、非 JSON 输出原样展示、脚本被删后预检同步报错且不起任务、`AIYAYI_TOOLBOX_ARGS`/固定 args/清单 env/记忆根四个透传）；管理工具（list 字段与语义、reload 注销旧工具 + 注册新工具 + 坏清单时也清干净）；工具面（TOOL_NAMES=5、own-tools 超集与动态放行、包内不再注册那三个）。
- **回归**：`node --test test/*.test.mjs` 全量 **39 个测试文件全通过**（`tests 167 / pass 167 / fail 0`，2026-11-12 合并后实跑）。
- **真机实测（只读，不改真实记忆）**：用真 `F:\阿依娅伊\记忆\toolbox.json` 起一次 `apply()`，注册面 = `toolkit_cmd,toolkit_read,toolkit_write,toolbox_list,toolbox_reload,mem_sync,pkg_stats`；`toolbox_list` 显示三条清单工具（watch_read enabled:false、存在问题为空）；真调一次 `pkg_stats` 工具 —— **execute 4ms 返回 taskId**，后台 6.6 秒跑完并把结果推进 task 表（那次 followup 因手工脚本没有真实 host Agent 而记 `delivery: failed`，属预期）。
- **⚠ `.gitignore`（记忆库白名单式，只放行 `memory.md` + `memories/`）的判断：这一版不动，建议"不放行"**。
  理由：清单里写的是**设备相关的脚本绝对路径**（`G:/阿依娅伊/工具/...`）与设备相关的 env，跟着记忆库推到云端/别的机器上会用不上甚至指错文件；`toolbox.json` 更像"本机配置"而不是"记忆内容"。要是以后想让它跟着走，更合适的做法是"清单里引入设备无关的相对位置 + 每台设备一份 `toolbox.local.json` 覆盖"，而不是直接把这份设备路径提交进库。这条留给 1.5.44 合并时最终定（记忆库那边一行都没改）。
- **合并建议（给主干）**：分支 `feat/toolbox-manifest` 已 **rebase 到 1.5.43（1039dc8）之上**，冲突已按"1.5.43 的实现 + 1.5.44 的工具面"逐处解完并跑绿：
  - `TOOL_NAMES` = 本分支的 5 项（3 基础 + 2 清单管理）；`builtins` = 本分支（只剩 3+2，清单加载）；
  - `DEFAULT_CONFIG` = 1.5.43 的新默认值（`memPushRemotes: []` / `memBranch: ''`）+ 本分支的 `manifest*` 三项；
  - `own-tools.js` = 本分支（删三个私有工具 + 加两个管理工具；并保留 1.5.43 那句"别写死回来"的说明）；
  - `toolkit-extra.js` / `pkg-stats.js` = **原样取 1.5.43**（本分支没动它们；P0/P1 修复与 `mem-sync-1543.test.mjs` 全绿）；
  - 三个既有测试的注册面断言改成 5 项、实现层断言改成直调导出物（不删测试）。
  `git merge feat/toolbox-manifest` 现在应当**零冲突**。合并后：① 跑 `node test/*.test.mjs`（本分支实测 **39 个文件全通过**）；② 把本机 `F:\阿依娅伊\记忆\toolbox.json` 里的 mem_sync 指向 `G:\阿依娅伊\工具\mem_sync\mem_sync.js`（已写好，含 1.5.43 全部守卫）；③ `toolbox_reload` + `toolbox_list` 验证；④ 最后再决定 `.gitignore` 要不要放行 `toolbox.json`（本分支没改）。**不 push、不 publish**。
- **实际执行结果（2026-11-12 22:20-22:31，主干合并 + 发版，取代上面那条"不 push、不 publish"的旧约束）**：
  - 合并：`git merge feat/toolbox-manifest` = **fast-forward `1039dc8..52d38e5`**（merge-tree 先验零冲突）；合并后 `node --test test/*.test.mjs` **39 个测试文件 / tests 167、pass 167、fail 0**。
  - 发版 commit **`0a141c7`**（文案+台账提交），三远端 main 均 = `0a141c7f071087d8877c76f0c079048886ecc961`；npm 发布 **2026-11-12T14:30:16Z**，shasum `02a5f99ea9318b1fa92faf6115f6b35a3d7a252f`、integrity `sha512-VTNJru/VRY4MP+EA8xU4h6J1zbZA56qoL5gTFZsfb8/PclkfdgZyKHg9h0xt3aKf+aCsamYzetHSqaTCb0/4ow==`、**53 个文件**（多出的正是 `lib/toolkit-manifest.js`；`test/` 排除），与 1.5.43 一样是本地 tgz 直发故**无 `gitHead`**。
  - **registry 同步延迟实测：约 5.2 分钟**（前 13 次轮询 latest 仍是 1.5.43 且 shasum 查询为空，第 14 次双值同时到位）——**比 1.5.41/1.5.42 的 ~2.5 分钟慢一倍，以后发布后回查至少等 6 分钟，期间绝不重发**（重发必撞「版本已存在」）。判据始终是 `dist-tags.latest` + `dist.shasum` **两个值同时对**。
  - profile 装版：`pnpm add dsh-aiyayi@1.5.44 --save-exact --registry=https://registry.npmjs.org/`，`package.json` 锁 `1.5.44`；**53 个文件 SHA256 tar/prof/源码三路 0 差异**。`reloadTag` 已改 `1.5.44`（备份 `cordis.patch.yml.bak-20261112-1.5.44`），**未重启 DSH**。
## 1.5.43（2026-11-12 修 `mem_sync` 的 P0/P1 缺陷 + **破坏性变更**：三个私有工具移出工具面）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **⚠ 破坏性变更（两条，都必须看）**：
  1. **三个工具从工具面移除**：`watch_read` / `mem_sync` / `pkg_stats` **不再注册**（`TOOL_NAMES` 从 6 项变 3 项，`own-tools.js` 静态兜底表同步删除）。通用安装包只留 `toolkit_cmd` / `toolkit_read` / `toolkit_write` 三个简单通用的能力。**为什么**：三个工具是发版方的私有能力（`watch_read` 依赖 99% 用户没有的 `skg_probe/ble_direct` 手表脚本目录；`mem_sync` 会在用户记忆仓库里产生**不可逆 commit**；`pkg_stats` 要联网），无条件注册时还占掉每轮约 690 token（工具包 6 件合计约 1334 token）、拉长工具面、抬高误调率——**误调 `mem_sync` 的代价是一次真实提交**。**实现文件全部保留**（`lib/toolkit-extra.js` / `lib/toolkit-async.js` / `lib/pkg-stats.js` 一行没删），1.5.44 由本地清单（`<记忆根>/toolbox.json`）按需注册，直接复用。**迁移**：① 想继续同步记忆的，配 `memPushRemotes` 后手工 `git add/commit/push`（清单机制 1.5.44 就绪后可自动）；② 相关配置项（`watchDir` / `memPushRemotes` / `pkgStats*`）**当前不再有任何效果**，`cordis.patch.yml` 里已加注说明，先别照着启用。
  2. **`mem_sync` 的默认行为变了**（即使 1.5.44 把工具挂回来也成立）：`memPushRemotes` 默认从 `['gitee','gitcode']` 改为 **`[]`**、`memBranch` 默认从 `'master'` 改为 **`''`**。**没配远端 = 不推也不提交**（`status:"noop"`，零副作用）。以前依赖默认值推 gitee/gitcode 的用户（其实只有发版方自己）会突然"不推了"——这是故意的：默认值不该是发版方的私有镜像名。
- **P0-1（🔴 修）默认 `memPushRemotes` 改空数组，且区分「未配置」与「配置为空」**：
  - `lib/toolkit.js:122` 默认值 `['gitee','gitcode']` → `[]`。
  - `lib/toolkit-extra.js` 新增 `resolveMemRemotes(cfg)`：返回 `{configured, remotes}`。**未配置（`undefined`）→ `configured:false`、`remotes:[]`；显式空数组 → `configured:true`、`remotes:[]`**。两者行为相同（都 noop）但 hint 文案不同（"没有配置" vs "被显式配成空数组"），用户能分清自己是漏配还是主动关。
  - 旧实现的兜底 `cfg.memPushRemotes?.length > 0 ? ... : ['gitee','gitcode']` 让**显式配空数组也会退回 gitee/gitcode**——"不配置就不推"这条路被代码堵死了，这是本条的核心。
  - **空数组 → `status:"noop"` 且零副作用**：守卫放在 `git add` **之前**，返回前不 add（不改 index）、不 commit（不产生不可逆提交）、不 push；连敏感扫描都不白跑。单测用 **HEAD 未变 + `.git/index` 字节未变 + bare 远端 `rev-parse --verify HEAD` 失败**三处取证，不只看返回值。
- **P0-2（🔴 修）`partial` 不再报 `ok:true` + hint 附真实远端名**：
  - `status='partial'` 时 `ok` 从 `true` 改 **`false`**（推送没全成 = 目标没达成），日志状态也从 `truncated` 改 `error`，`error` 字段给机器可读的 `'推送未全部成功'`（原来空串）。
  - 失败 hint 改成：`已提交 <hash>（改动已进本地仓库，不可逆）。推送 1/2 成功：gitcode 失败（…原因见 pushed[].error）。本仓库现有远端：origin / gitee。请在 aiyayi-toolkit 的 config 里把 memPushRemotes 改成上列真实存在的远端名（或先 git remote add 一个）。`——**远端名是 `git remote` 实际读的**（新增 `listRemotes()`），一个远端都没有时写「（无）」。
  - 为什么重要：旧版普通用户调一次 `mem_sync` 的真实结局是"改动已 commit 进本地仓库（不可逆）→ 两个远端都找不到 → `status:partial` 但 `ok:true`"，hint 里"已提交"三个字极易被概括成"同步完成"。
- **P0-3（修）`memBranch` 空则跟随当前分支**：
  - 默认 `'master'` → **`''`**；空时用 `git rev-parse --abbrev-ref HEAD` 动态取当前分支（新增 `resolveMemBranch()`）。
  - **空仓库（还没有第一个 commit）**：`rev-parse` exit 128、stdout 是字面量 `HEAD` → 再用 `git symbolic-ref --short HEAD` 兜底拿分支名（实测能拿到 `main`/`trunk`，只是还没有提交）。
  - **detached HEAD 明确报错**（`rev-parse` 返字面量 `HEAD`、`symbolic-ref` exit 128，两路都拿不到）→ `status:"error"`、`ok:false`、hint 指向"请显式配 memBranch"，**且不提交**（守卫同样在 `add` 之前）。旧版写死 master 时，`main` 分支的仓库是 100% 推失败（实测 `error: src refspec master does not match any`）。
- **P1-1（🔴 安全，三处）敏感扫描漏洞**：
  - **(a) `git diff HEAD` 失败不再吞成空串**：仓库**没有第一个 commit** 时 `diff HEAD` 直接 `fatal: ambiguous argument 'HEAD'`（exit 128），旧写法 `diff.ok ? diff.stdout : ''` 静默变空串 → **已 `git add` 的暂存内容一个字都不扫**，而 `add -A` 照样提交。现在 HEAD 不可用时退回 **`git diff --cached`（暂存）+ `git diff`（工作区）两路**，绝不当空。这条对新用户首次建记忆仓库最致命——恰恰是旧 hint 里"先 git init + 配远端"引导用户去的路径。
  - **(b) `untrackedFiles()` 认 `A ` 前缀**：旧实现只认 `?? `，已 `git add` 的新文件（`A ` 前缀）内容完全不扫。现在认 `?? `/`A `/`AM`。**故意不收 `M `/`MM`/` M`**：已跟踪文件的修改内容全在 diff 的 `+`/`-` 行里，读全文等于把没改动的旧行也扫一遍——正是下面 P1-2 那条误报的根源。
  - **(c) 私钥正则补 OPENSSH**：`/-----BEGIN [A-Z ]*PRIVATE KEY-----/` 漏掉 `-----BEGIN OPENSSH PRIVATE KEY-----`（下划线 `_` 不在 `[A-Z ]` 里），而 `ssh-keygen` 默认生成的就是这个格式——**恰好漏掉最常见的 SSH 私钥**。改为 `[A-Z0-9 _-]*`，一并覆盖 RSA / EC / DSA / ENCRYPTED / PGP / OPENSSH。
- **P1-2（🟡 修）只扫 `+`/`-` 变化行，不再扫未改动的上下文行**：
  - 旧实现扫 `git diff HEAD` **全文**，包含大量上下文行（前缀是空格）。记忆库是技术笔记仓库，里面迟早会出现「`token: 由环境变量提供，不要写死`」这种**解释性文字**，几百行外的一行旧笔记就能把整次同步**永久卡成 denied**，而 hint 只说"把这行改成占位符"——用户完全不知道问题出在没改动的旧行上。实测复现：只追加一行无关内容，`git diff HEAD` 里那行以空格前缀出现，仍被 `token` 正则命中 → 整次拒绝。
  - 新增 `changedLinesOnly(diffText)` / `scanDiffSensitive(diffText)`：只认 `+`/`-` 开头且排除 `+++`/`---` 文件头；命中带 **diff 原始行号 + 文件名**（从最近的 `+++ b/<路径>` 追出来），定位比旧版"diff 第 N 行"准。`-` 行也扫（别把删掉的密钥漏掉）。
- **改动的文件**：`lib/toolkit.js`（TOOL_NAMES 6→3、builtins 去掉三工具、DEFAULT_CONFIG 两个默认值、注释写明破坏性变更）、`lib/toolkit-extra.js`（`resolveMemRemotes` / `resolveMemBranch` / `listRemotes` / `changedLinesOnly` / `scanDiffSensitive` 新增，`untrackedFiles` 前缀扩到 `A `，私钥正则修，扫描改只扫变化行，空远端与分支守卫前置，partial 改 `ok:false` + 真实远端名 hint，schema description 重写并点明绕过 DSH 沙箱）、`lib/own-tools.js`（静态兜底表删三个工具名）、`package.json`（1.5.43）、`cordis.patch.yml`（注释说明三工具已移出、两个默认值已改）、`README.md`（工具箱表格标注移出）。
- **测试**：新增 `test/mem-sync-1543.test.mjs`（**78 条断言，全在 `%TEMP%` 沙盘仓库里跑，绝不碰真实记忆根**）。覆盖：默认值三查（空数组 / mergeConfig 后仍空 / 源码里不再有 gitee-gitcode 兜底字面量）；`resolveMemRemotes` 四种输入（未配置 / 显式空 / 全空白项 / 正常配置 trim 保序）；**零副作用三重取证**（HEAD 未变 + `.git/index` 字节未变 + bare 远端无引用）与两种 noop 文案可区分；配上真实远端后正常 pushed 且 bare 远端 HEAD 真有；partial 的 `ok:false` + hint 含 `git remote` 实测名 + 点名失败远端 + 说清"不可逆" + 无远端时写「（无）」；`memBranch` 空跟随 `main`、配置优先、空仓库靠 `symbolic-ref` 拿 `trunk`、detached 明确报错且不提交；无 commit 仓库里已暂存的 `sk-` **被扫到**（旧实现直接提交）且清干净后首个 commit 能成；`untrackedFiles` 各前缀（`?? `/`A `/`AM` 收，`M ` 不收，`D ` 不收，`-z` 与换行两形态，非 ASCII 原样）+ 端到端"已 add 的新文件里 `password:` 被拦"；私钥正则 OPENSSH/RSA/EC/DSA/ENCRYPTED/PGP 全命中且 `PUBLIC KEY` 不误报；只扫变化行（上下文行 token 零命中、`+`/`-` 命中、`+++`/`---` 不算变化行、行号与文件名准）+ **端到端"旧行写着 `token: 由环境变量提供`、只改无关行 → 不再 denied 且真的提交了"**；schema 文案（不再写死 gitee/gitcode、写明默认不推与前置、点明绕过沙箱、只扫变化行）。另同步更新 `test/toolkit.test.mjs` / `test/toolkit-async.test.mjs` / `test/pkg-stats.test.mjs` 里"注册 6 个工具"的断言为 3 个，并把三工具的 schema/execute 断言改为**直调导出物**（实现保留、1.5.44 复用）。全量 **765 项 765 过 0 挂**（1.5.42 基线为 698 项全过）。

---

## 1.5.42（2026-11-12 新增：`pkg_stats` 工具——查 npm 下载量与代码仓热度，同步）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **改了什么（新增 `lib/pkg-stats.js` + 测试；改 `lib/toolkit.js` / `own-tools.js` / `package.json` / `README.md` / `cordis.patch.yml` 注释；既有 5 工具行为不变）**：
  - `lib/pkg-stats.js`（新增）：同步工具 `pkg_stats`。参数全可省——`package`（默认 `dsh-aiyayi`，支持 `@scope/name`）、`repo`（默认 `BayiHY/dsh-aiyayi`）。
    - **npm 下载量**：`api.npmjs.org/downloads/point/{last-day,last-week,last-month}/<pkg>` 三个窗口**并发**取，每个窗口原样带回 `downloads/start/end`。
    - **npm 版本**：`registry.npmjs.org/<pkg>` 直接 HTTP GET（**不 shell 调 npm**——本机 `.npmrc` 默认指 npmmirror 镜像），取 `dist-tags.latest` 与 `time[latest]`。
    - **GitHub**：直连 `api.github.com/repos/{owner}/{repo}` 优先；失败走 `gh-proxy.com` 代理兜底。`github.source` 标 `direct` / `gh-proxy` / 空串，调用方能看见数据到底从哪来。
    - **Gitee**：`gitee.com/api/v5/repos/{owner}/{repo}`。
    - **GitCode**：`gitcode.com/api/v5/repos/{owner}/{repo}`（**白名单只有六条，不含 `api.gitcode.com`**，故走主站路径）。
    - 返回：`{ok, package, version, repo, npm:{lastDay,lastWeek,lastMonth,versionPublishedAt,unavailable}, github:{stars,forks,watchers,openIssues,unavailable,source}, gitee:{...}, gitcode:{stars,forks,unavailable}, fetchedAt, error}`。
    - **失败隔离**：每个平台自己吞错，只把原因写进**自己那段**的 `unavailable`，其余照常返回；**全失败也返回合法结构**（`ok:false`），绝不抛未捕获异常。
  - **安全（四层）**：①**域名白名单**精确主机名匹配（`api.npmjs.org` / `registry.npmjs.org` / `api.github.com` / `gh-proxy.com` / `gitee.com` / `gitcode.com`），非白名单主机**请求根本不发**（`assertAllowedUrl` 直接抛）；只允许 https、URL 不许带凭据。②`repo` 两段只允许 `A-Za-z0-9._-`（拒 `.` / `..` / 空白 / `?` `#` `%` `\`），`package` 按 `[@scope/]name` 校验，拼接前**逐段 `encodeURIComponent`**。③`gh-proxy.com` 是**第三方代理**（把 GitHub 路径原样交给它转发，等于把 owner/repo 暴露给它、会进其访问日志），只在直连失败时用，`pkgStatsAllowGithubProxy:false` 可关（单测断言关掉后**一次都不打**）。④15 秒总预算（`pkgStatsTimeoutMs`）+ 单请求 8 秒（`pkgStatsRequestTimeoutMs`）+ GitHub 直连 4 秒快速失败（`pkgStatsGithubDirectTimeoutMs`）。
  - `lib/toolkit.js`：导入 `PKG_STATS_SCHEMA / executePkgStats / shapePkgStatsOutput`，`TOOL_NAMES` 扩到 **6**，`DEFAULT_CONFIG` 加 5 个 `pkgStats*` 配置项，`builtins` 数组挂 `[PKG_STATS_SCHEMA, (args) => executePkgStats(args, { cfg, logUsage, warn })]`，`__testing` 导出 `shapePkgStatsOutput`。
  - `lib/own-tools.js`：`OWN_TOOLS` 加 `pkg_stats`。
  - `package.json`：version 1.5.42；exports/files 白名单加 `./pkg-stats` / `lib/pkg-stats.js`。
  - `cordis.patch.yml`：toolkit 段按前例补 1.5.42 注释（**只加注释，默认行为不变**，`pkgStats*` 项以注释形式给出默认值）。
  - `README.md`：工具箱表格加 `pkg_stats` 一行 + 三个实测注意点（end 滞后 / GitHub 需代理 / GitCode 无匿名 API + Gitee watchers 语义）；文件清单加 `lib/pkg-stats.js`。
- **为什么**：本体想知道"这包有多少人在用、仓库热不热"，以前得派检索员翻网页——GitHub 直连还不通。收成一个同步工具：几个 GET、2-4 秒出结果，比派子代省一整轮；且把三个实测坑（end 滞后、直连不通、无匿名 API）**写进返回结构**，以后不会误读。
- **踩坑记录（都是当场实测的，不是推测）**：
  1. **npm 统计 API 的 `end` 日期滞后约 2 天，"last-day" 不是今天**。2026-11-12 15:3x 实测：`last-day` 返 `{downloads:744,start:"2026-11-10",end:"2026-11-10"}`（不是 11-12）；`last-week` 4549（11-04→11-10）；`last-month` 4851（10-12→11-10）。→ 所以三个窗口**必须原样带回 start/end**，否则以后必然误读成"今天的下载量"。
  2. **GitHub API 直连在本机不通**。`api.github.com/repos/BayiHY/dsh-aiyayi`：PowerShell 报"基础连接已经关闭"、node fetch 报 `fetch failed`（cause ECONNRESET，curl 报 `(35) Recv failure: Connection was reset`）。兜底 `https://gh-proxy.com/https://api.github.com/repos/...` 可用（实测 200，`x-ratelimit-remaining=143/5000`，会限流；403 时把 `message` 原样带回）。
  3. **GitCode 无匿名 API**。`gitcode.com/api/v5/repos/BayiHY/dsh-aiyayi` → **400** `{"error_code":400,"error_message":"Orchestration error: Invalid header parameter: private-token, required"}`；`api.gitcode.com/api/v5/...` → **401** `401 Unauthorized,Please check whether the current request carries an invalid token...`。两个主机都要 token，**且 `api.gitcode.com` 不在六条白名单里**（精确主机名匹配），所以工具走 `gitcode.com` 主站路径、把服务端 `error_message` 原话带进 `unavailable`。页面上的 star/fork 是异步渲染的 **UI 数字**（实测第一次 0、第二次 125 的"下载使用量"），**不作接口确证、不抓页面**。
  4. **Gitee 的 `watchers_count` 是"关注数"**，语义与 GitHub 的 watchers 不同——同一仓库 GitHub watchers=0、Gitee watchers=1。日报里两个数字不可混着比。
  5. **npm registry 必须显式走 `registry.npmjs.org`**：本机 `.npmrc` 默认指 npmmirror 镜像，所以工具里直接 `https://registry.npmjs.org/<pkg>` HTTP GET，**不 shell 调 npm**。
  6. **scoped 包名编码**：实测 `registry.npmjs.org/@types/node` 与 `%40types/node` 都返 200（等价），本工具产出的是 `%40scope/pkg`（逐段编码，`/` 保留）。npm downloads API 同理。
  7. **单测当场抓出两个真 bug，已修**：① `assertSafeSegment` 原来会 `trim()`，导致 `repo="owner/ name"` 被**静默改写成 `owner/name`** 发出去——参数静默改写比报错更难查，现改为不 trim、带内部空白直接拒；② `withBudget` 的兜底定时器原来 `unref()`，当 mock fetch 永不 resolve 时它是唯一撑着事件循环的东西，unref 后 Node 直接退出，单测报 `Detected unsettled top-level await` + 退出码 0——有界计时器不 unref 不会漏活进程，现去掉 unref 并写明原因。
- **测试**：新增 `test/pkg-stats.test.mjs`（**135 条断言，全 mock fetch、不打真网**）。覆盖：schema 结构（单 type 字符串 / required 列全顶层与三层子对象 / additionalProperties:false / 全篇无 type 数组 / description 写明三个坑）；各平台正常返回（含 **start/end 原样带回**的断言）；只敲白名单域名且全是 GET、GitHub 直连成功时**不打代理**；scoped 包名逐段编码；**GitHub 三路**（直连成功 source=direct / 直连抛错走代理 source=gh-proxy / 直连+代理双挂时 403 `rate limit` 原话进 unavailable 且不抛 / 配置关掉代理后一次都不打代理 / 404 带原话）；GitCode 400 带 `error_message` 与 UI 数字不作确证；**全平台失败**（500 / 网络层抛错两条路）结构仍合法且 `ok:false`；**超时**（mock fetch 永不 resolve → 300ms 预算内收口、五个平台 unavailable 都说超时、不抛）；**白名单与注入**（5 条应拒 URL + 6 个白名单主机应放行 + 10 条坏 repo + 8 条坏 package + 合法形态放行 + 参数非法时返回合法结构而非抛）；归一函数对脏输入（null/字符串/NaN/Infinity/负数/小数）；注册面（TOOL_NAMES=6、DEFAULT_CONFIG 五项、own-tools 放行、经 `apply()` 注册、经 execute 壳真调一次）；`render` 四条分支都能出文本不抛；源码静态核对（白名单冻结、注释写明第三方代理、无 `child_process` 痕迹、`fetchImpl` 只在 `fetchJson` 里调用一次）。
  - `test/toolkit.test.mjs` / `test/toolkit-async.test.mjs` 因工具数 5→6 同步更新了注册断言（"五个工具已注册"→"六个"、"list 变 6"→"list 变 7" 等）。
  - 全量 `node --test`（显式传 **37** 个 `test/*.test.mjs` 文件）：**165 项，162 过 3 挂**（挂 = alarm-inject / home-relocate / tools-surface 环境基线，与 1.5.35/1.5.39/1.5.40/1.5.41 条目同基线），**零新增失败**。基线 36 个文件 / 164 项 / 161 过 3 挂，本版 +1 个文件（165 项 / 162 过 / 3 挂），零新增失败。
- **实网实测（不是 mock，2026-11-12 15:33 本机）**：`executePkgStats({})` 耗时 **2434ms**，`ok=true`，`version=1.5.41`，`lastDay=744`（11-10）/`lastWeek=4549`/`lastMonth=4851`，`versionPublishedAt=2026-11-12T07:17:11.900Z`，`github.source="gh-proxy"`（直连确实不通），`gitee.watchers=1`，`gitcode.unavailable` 带 400 与 `private-token` 原话；输出过 schema 校验（无缺字段、无多余键）。
- 打包与 npm publish **已完成（2026-11-12 第二段发版）**。三远端 push 到 `98ee5f8`（gitcode/gitee/github，ls-remote 三路核对一致）；npm publish 到 `https://registry.npmjs.org/`（显式 `--registry`，`.npmrc` 默认指 npmmirror），tarball sha1 `9c6dbf5980e233c34f33cb2b0ecbc04c4b1f63d2`、integrity `sha512-fuLDKcHaqCBNo0c013QNkZs9G2GW1/LhjyZoHfsyqX3lzZImtSCF8APeXAMn45p89nnSaEPmCjKL0qiLAwt5Hw==`、**52 个文件**（比 1.5.41 的 51 个多 1 个 = `lib/pkg-stats.js`），发布时刻 **2026-11-12T07:46:35Z**，registry `gitHead=98ee5f8e0c3ed88b8525781655d6264f4852a823`；desktop profile 已 `pnpm add --save-exact dsh-aiyayi@1.5.42`，52 个包内文件与 tarball 比对 **51/52 MATCH**，唯一差异是 `cordis.patch.yml`——pnpm 重装把 `watchDir` 那行覆盖回注释态，**已手工恢复成生效态**。**未重启 DSH**（李浩自己重启后实机验货）。

## 1.5.41（2026-11-12 新增：Toolbox 真异步能力 + `watch_read` 异步工具、`mem_sync` 同步工具）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **改了什么（新增 `lib/toolkit-async.js` / `lib/toolkit-extra.js`；改 `lib/toolkit.js` / `own-tools.js` / `package.json`；三件套行为不变）**：
  - **A. 基础设施：真异步任务投递 helper（`lib/toolkit-async.js`）**。为什么要有它（坑 #79，已核到宿主源码级）：宿主 agent loop 对工具是**同步 await**——`@deepseek-ai/dsh-agent-loop` 的 `await this.loopCtx.tools.execute({calls, signal, agent, ...})`，落到 `@deepseek-ai/dsh-tools/pipeline.js` 是 `const returned = await tool.execute(exec.arguments, exec)`；一批工具不 resolve，这一轮的下一次模型请求就发不出去，而宿主**没有内置的工具超时兜底**（只有协作式 `exec.signal`）。
    - `startDetachedTask({exec, kind, label, run, hint, header, warn, onFinish})`：立刻生成 `taskId`（`tk-<8位hex>`）→ `newTaskId()` 去重 → 登记进程内 task 表 → **`setImmediate`** 把 `run()` 甩到下一轮宏任务 → 返回 `{status:'started', taskId, kind, hint}`。**调用方绝不 await 到 run()**（单测断言返回耗时 < 50ms 且此刻 followup 还没被调）。
    - 投递：跑完按 `success|timeout|error` 归一 → `exec.agent.followup(createUserMessage({content:[{type:'text',text}], source:{kind:'user'}}))`。`createUserMessage` 走 `await import('@deepseek-ai/dsh-llm')`（结果缓存，失败也缓存，不让每个任务重试动态 import）；`source` 只有 `kind:'user'` 一个键，**没有任何 undefined 字段**（坑 #65：宿主 `Session.append` 的 `snapshotJsonValue` 遇 undefined 判 `non-JSON-serializable` 抛错）。投递前 `await yieldHostPublication()`（微任务 + `setTimeout(0)` 两层让出，坑 #68：跳出宿主当前 publish 宏任务窗口，避免同步/重入式 followup 把 rejection 抛成宿主 fatal）。
    - **失败绝不静默**：`run()` 抛异常 → 兜成 `error` 并投一条带原因的消息；主动返回 `timeout`/`error` 同样投；`exec.agent` 拿不到 → 不抛，记 `delivery='no-agent'` + warn；`followup` 自己抛 → 就地 catch，记 `delivery='failed'` + warn（+ 单测断言 rejection 不逃逸）。
    - task 表：进程内 `Map`，`{taskId, kind, label, sessionId, status, delivery, startedAt, finishedAt, durationMs, error, deliveryError, summary}`；`getTask()` / `listTasks(n)` / 环形上限 50 条（**只丢已结束的**，running 的不丢）；`waitForTask()` 只给单测/排查用，工具实现里绝不 await 它。**不落盘**（重启即空，够本轮排查用；要持久化得另做，见"未实机验证"清单）。
    - 留痕：与既有 `logUsage` 同一份 `<记忆根>/toolkit/usage.jsonl`——异步工具记两条（`started` + 完成），完成那条带 `task=` 与最终 status，失败原因的优先级是任务错误 > 投递错误。
  - **B. `watch_read`（异步，手表取数）**：参数 `rounds`（扫描轮数，默认 6，上限 20）、`listenSec`（心率监听秒数，默认 **0** = 不监听，上限 120）——默认值给足，本体不用每次算。行为：预检脚本目录/入口（坏了**同步**报错，不白起后台任务）→ `startDetachedTask` 立刻返回 `{ok:true, status:'started', taskId, kind:'watch_read', hint:'已开始取数，约 25-100 秒，结果会作为消息推回会话', error:''}`。后台 `node:child_process.spawn('python', argv)` 起 `skg_probe/ble_direct/watch_read.py`（**argv 数组，不拼 shell 字符串**），**任务级总超时 180 秒**（`watchTimeoutMs`），超时 `taskkill /T /F` 杀进程树并投「超时了，手表可能没戴或没在广播」这类明确错误。
    - 路径不写死：`watchDir` 配置优先；默认按**插件自身位置**推导 `<pkg>/../../skg_probe/ble_direct`（配置坏了会在返回里明确说"请在 config 里配 watchDir"）。`watchPython` 默认 `python`，`PYTHONIOENCODING/PYTHONUTF8=utf-8` 防 Windows 控制台乱码。
    - 结果整理（够本体读懂即止，不做复杂解析）：`extractWatchKeyLines()` 从脚本 stdout 挑连接/电量/设备名/固件/今日运动/今日汇总/昨日汇总/目标步数/分时步数/睡眠/血氧/心率/实时心率流这些行（上限 24 行）→ `composeWatchReport()` 拼「关键指标 + 脚本输出末尾 + stderr 末尾」，超时/非 0 退出各有专门开头一句。
  - **C. `mem_sync`（同步，记忆仓库提交推双远端）**：参数 `message`（可选，缺省 `记忆更新 2026-11-12 15:00`）。流程：①记忆根走 `resolveRoot()`（指路文件 > `AIYAYI_HOME` > 默认，搬家自动跟随），**不可达直接 error 且不建目录**；②`git rev-parse --show-toplevel` 守卫——不是仓库就 error，**仓库顶 ≠ 记忆根就 denied**（防在别人的仓库子目录里提交）；③`git status --porcelain -z` 无改动 → `{status:'noop', hint:'没有待提交的改动'}`；④敏感内容扫描：`git diff HEAD` 全文 + **未跟踪文件内容**（`git diff` 看不到它们，但 `add -A` 会提交），正则 `sk-[A-Za-z0-9]{16,}` / `npm_[A-Za-z0-9]{20,}` / `gh[pousr]_[A-Za-z0-9]{20,}` / `-----BEGIN [A-Z ]*PRIVATE KEY-----` / `password\s*[:=]\s*\S` / `token\s*[:=]\s*\S`，命中即 **denied**，只回**行号 + 脱敏片段**（`sk-key（24 字符，已隐去：sk-a…）`），绝不回显原文；⑤`git add -A` → `git -c user.name=阿依娅伊 -c user.email=aiyayi@local commit -m <message>` → 依次 `git push gitee master`、`git push gitcode master`（可配 `memPushRemotes`/`memBranch`），**一个失败不影响另一个**，逐条如实报。
    - 返回结构：`{status, ok, commit, pushed:[{remote, ok, error}], hits:[string], hint, error}`；`status` ∈ `noop|pushed|partial|denied|error`。所有路径都过 `shapeMemSyncOutput()` 归一（单 type、required 列全、additionalProperties:false 不多键）。
    - 安全：git 一律 `spawnSync('git', [...])` **数组参数**（不拼 shell 字符串，防注入）；`GIT_TERMINAL_PROMPT=0` 防卡在凭据提示。
  - **D. 注册与 schema**：两工具按现有 `add(def, impl)` 挂上（`TOOL_NAMES` 同步扩到 5 个，`own-tools.js` 静态兜底表同步）；工具 execute 签名统一为 **`(args, exec)`**（`watch_read` 要 `exec.agent` 做回注，前三个工具暂不用但同签名便于以后一起用）。两个 `output.schema` **严格**：`type` 单字符串、`required` 列全 `properties`、`additionalProperties:false`；`watch_read` 的 `taskId` 预检失败给**空串**、`mem_sync` 的 `commit` 未提交给**空串**、`pushed`/`hits` 恒数组——**没有 null、没有缺字段**（坑 #77/#78 的教训）。
- **为什么**：①工具箱原先三件套全是"同步短活"，碰到手表取数（25-100 秒）这种必然把整轮堵死；宿主没给"后台工具"能力，只能工具自己实现"先返回句柄、完成后回注"。②`ctx.jobs` 虽好但 `preset-aiyayi` 本体没挂 `tool-jobs`（只挂了 worker），拿不到。③记忆仓库之前靠手工 `git add/commit/push`，容易漏扫密钥、也容易只推一个远端——收成一个同步工具，几秒完成、有守卫、有脱敏报告。
- **测试**：新增 `test/toolkit-async.test.mjs`（128 条断言，独立临时沙盘 + 指路文件隔离，**绝不碰真实记忆库**；gh_repo 无 node_modules，`createUserMessage` 加载器用 `__testing` 注入）。覆盖：异步 helper 立刻返回/后台投递/消息结构/source 无 undefined/JSON 无损往返/run 抛异常也投递/timeout 投递/no-agent 不抛/followup 抛错不逃逸/onFinish/`pickAgent` 三形态；watch_read 默认值与夹取、argv 无 shell 拼接、关键指标抽取、正常/超时/失败三种正文、缺目录同步报错、立刻返回结构与耗时、留痕两条；mem_sync 六条敏感正则、行号准确、脱敏不含原文、越界守卫（含同级前缀 `root-evil` 不算包含）、非仓库 error、临时仓库 noop/denied（已跟踪 + **未跟踪**两条路）/正常提交/作者断言/`git add -A` 后工作区干净/一远端成一远端败（用本地 bare 仓库当远端，并回读 bare 里真有提交）/仓库顶不一致 denied/记忆根不可达 error；两工具 schema 与归一函数对脏输入的兜底。
  - **单测当场抓出一个真 bug，已修（坑 #80）**：`git status --porcelain` 默认 `core.quotepath=true`，非 ASCII 路径输出成 C 风格转义（`?? "\346\226\260\347\254\224\350\256\260.md"`），拿它 join 目录拼不出真文件 → 读不到 → **静默跳过 → 带 `token=` 的文件被 `add -A` 提交了**。修法两层：git 调用统一加 `-c core.quotepath=false`，status 改 `--porcelain -z`（NUL 分隔、路径原样），`untrackedFiles()` 同时容忍 `-z` 与换行两种形态。修前该断言（"未跟踪文件里的 token= 也拒绝"）实测 FAIL，修后 PASS。
  - 全量 `node --test`（显式传 36 个 `test/*.test.mjs` 文件）：**164 项，161 过 3 挂**（挂 = alarm-inject / home-relocate / tools-surface 环境基线，与 1.5.35/1.5.39/1.5.40 条目同基线），**零新增失败**。`test/toolkit.test.mjs` 因工具数 3→5 同步更新了注册断言（原"三个工具已注册"/"list 变 4"按新数量改写，并加一行显式盯住五件套）。
- 文档：`docs/经验-工具真异步与宿主同步await.md`（新建，四条：宿主同步 await 的事实与源码位置 / 两条异步路子与为何选 followup / 坑 #65+#68 的具体规避写法 / 本 helper 的使用范式 + 坑 #80）。
- 打包与 npm publish：**2026-11-12 李浩拍板后已完成发版第二段**。三远端 push 到 `6d5448a`（gitcode/gitee/github，ls-remote 三路核对一致）；npm publish 到 `https://registry.npmjs.org/`（显式 `--registry`，`.npmrc` 默认指 npmmirror），tarball sha1 `d8c96ead92d69568cac564dcea4cb2e10feea4d4`、integrity `sha512-7ih7JTMf2CXN63VTCZwUKh6RukDBuK3x1nrhJQarVRWaiG623l6911Lzz6S4URdf/JnSRAWMIJ3vrr786S8rLg==`、**51 个文件**（比 1.5.40 的 49 个多 2 个 = 两个新文件），发布时刻 **2026-11-12T07:17:11Z**，registry `gitHead=6d5448a`；desktop profile 已 `pnpm add --save-exact dsh-aiyayi@1.5.41`，51 个包内文件与 tarball **逐个 SHA256 全部一致（0 diff）**。**未重启 DSH**（李浩自己重启后实机验货）。

## 1.5.40（2026-11-12 修复：toolkit_cmd / toolkit_write 执行输出不符 output.schema——宿主对工具输出也做 schema 校验，条件性返回字段必须与 schema 对齐，坑 #78）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **改了什么（只动 `lib/toolkit.js` + 测试；三工具的行为语义仅"约定值"变化，无对外参数变更）**：
  - **根因（实锤，详见坑 #78）**：`lib/toolkit.js` 三个工具的 `execute` 返回值是**条件性返回**——`toolkit_cmd` 的 `truncated` 只在部分路径出现、`exitCode` 超时/被拒时给 `null`；`toolkit_write` 的 `backupPath` 仅覆盖已有文件时才有，其余给 `null`；`toolkit_read` 的 `mtime` 探测不到时给 `null`。而 **DSH 宿主不只校验注册端 schema，也校验执行输出**：`validateJsonSchemaValue(output.schema, value)` 会把 `null` 当成"字段存在但类型不符"（**不等于缺省**）、`required` 缺一即报 `missing required property`。1.5.39 把 type 改成单类型后实现层没跟上，于是注册通过、一执行就被拒——实测 `toolkit_cmd` 报 `missing required property 'value.truncated'; 'value.exitCode' must be an integer`，`toolkit_write` 报 `'value.backupPath' must be a string`，`toolkit_read` 因不返回 null 字段而幸免。
  - **修法（单一出口归一，不靠"记得每个分支都填"）**：新增 `shapeCmdOutput` / `shapeReadOutput` / `shapeWriteOutput` 三个导出函数，三个工具的 `finish()` 一律先过它再返回——所有路径（成功/拒绝/超时/进程拉不起来/内部异常）压成与 `output.schema` 完全一致的形状：字段一个不少、每个字段单类型、不出现 schema 之外的键。可空语义用**约定值**承担并在 description 写明：`exitCode` 拿不到真实退出码时填 **-1**（配合 `ok`/`denied`/`timedOut` 判别）、`backupPath` 未备份填 **空字符串**、`mtime` 探测不到填 **空字符串**、`truncated` 一律 boolean。
  - **schema 随之收紧**：三处 `required` 从"只列部分字段"改为**列全 properties**（因为现在每个字段都恒有值）；`toolkit_cmd` 的 `reason` / `whitelisted` / `error`、`toolkit_read` 的 `mtime` / `error`、`toolkit_write` 的 `backupPath` / `reason` / `error` 全部进 required；`toolkit_write` 的 `denied` / `reason` / `error` 一并补进（原 schema 有 properties 但 required 只列三个，属同类隐患）。`toolkit_cmd` 的 render 对 `exitCode < 0` 增注"无真实退出码"。
  - **留痕口径不变**：`usage.jsonl` 的 `exitCode` 仍是 `null`（= 没有真实退出码），约定值只在输出端用，不污染统计。
- **为什么**：①调用方（本体/模型）会把校验失败当"操作失败"，而**底层其实已经执行**——write 的目标文件真实写入了完整内容，cmd 的命令也跑了只是结果被吞，属"bug 兼 UX 问题"；②"条件性返回"这种写法天生与 required 冲突，只要 schema 声明了字段就永远无法安全省略。
- **测试**：`test/toolkit.test.mjs` 新增 6c 节（**真实调用注册出来的 execute**，不是只测纯函数）：复刻宿主 `validateJsonSchemaValue` 为守门员（单类型/required/additionalProperties:false/items/oneOf），先自检能抓出今天三种真实失败形态（缺 `truncated`、`exitCode:null`、`backupPath:null`），再逐路断言——`cmd` 成功（exitCode=0）/失败（exitCode=3 透传）/超时（-1 + timedOut）/拒绝（-1 + denied）四路、`write` 新建（backupPath 空串）/覆盖（非空且 .bak 真实存在）/拒绝（空串）三路、`read` 不存在路径（mtime 空串）；另加归一函数对脏输入（全 null / 空对象）的兜底断言。**同时把 1.5.39 遗留的「exitCode/mtime/backupPath 不在 required」三条断言反向改写**——那是 1.5.39 用"缺省"表达可空的旧口径，与本版新口径直接冲突，留着就是错的。全量 `node --test`（显式传 35 个 `test/*.test.mjs` 文件——`test/` 下另有 `feishu-status-proof.mjs` / `presence-midnight-proof.mjs` 两个非 `*.test.mjs` 的取证脚本，不参与 `node --test`）：**163 项，160 过 3 挂**（挂 = alarm-inject / home-relocate / tools-surface 环境基线，非本次引入，与 1.5.35/1.5.21/1.5.22/1.5.39 条目同基线），零新增失败。
- 打包与 npm publish **不在本次范围**：本版只做版本号对齐 + 本地提交（不 push、不 publish、不动 profile），发版节奏等李浩定。

## 1.5.39（2026-11-12 修复 + 改造：toolkit 三件套注册失败修复；feishu_bind 自动绑定一步接入）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **改了什么（一修复一改造）**：
  - **修复：`toolkit_cmd` / `toolkit_read` / `toolkit_write` 三件套注册全部失败（1.5.38 引入），本版修复。**
    根因（实锤，详见坑 #77）：`lib/toolkit.js` 三处 output.schema 用了 type 数组写法（`toolkit_cmd` 的 `exitCode: ['integer','null']` 约 755 行、`toolkit_read` 的 `mtime: ['string','null']` 约 800 行、`toolkit_write` 的 `backupPath: ['string','null']` 约 840 行），而 **DSH 宿主 tools.register() 的 JSON Schema 校验只接受单一 type 字符串**（报错 "must be a single type string (type arrays are not supported)"，错误类 UNSUPPORTED_SCHEMA）→ 注册抛错 → 被 `apply()` 的逐工具 try/catch 吞成 warn，**表面看不出**。修法：三处改单类型（`type: 'integer'` / `type: 'string'`），可空语义改用「不进 required 数组」表达并在 description 里注明缺省情形（`exitCode` 同时移出 required——超时杀进程等场景本就返回 null）；全库 grep `type:\s*\[` 复查零命中。
  - **改造：`feishu_bind` 自动绑定——说「接飞书」一步到位（2026-11-12 需求终版）。**
    - `lib/feishu-logic.js` 新增纯函数 `pickAutoBindChat({mappings, inboundRouting, chatOwners})`：从插件已有信息挑「最近活跃的 chat」。数据源优先级：① `inboundRouting` 最近入站流量（新→旧取第一条有效 chatId，**多应用并存时谁最近有流量就挑谁**，appId 随流量归属）；② 已绑 chat（readMappings，含绑在其他会话的，字典序取首个保确定性）；③ 各应用成员 chat（chatOwners，同样字典序）。返回 `{chatId, appId, at, source}`，null = 一个可绑 chat 都没有。
    - `lib/feishu.js` `feishu_bind`：chatId 参数改为**可选**——不传时调 pickAutoBindChat 自动挑 chat 直接绑定，**旧绑定直接覆盖、不追问**；绑定成功后 bot 主动往该 chat 发对接成功消息（「已接入 aiyayi 会话 X，以后在这里发消息就能找到我。」，复用 `sendViaOwner`（sendInfra 新回填该句柄）的 230002 归属自愈重试，发送失败只附 warning 不影响绑定本身，回传 `noticeSent` 字段）；成功即清 pending-bind（扫码兜底网完成使命，防 TTL 内用户再进单聊时 p2p 事件把同一 chat 绑回旧目标）。**降级仅两种**（此时才提示去飞书发消息）：一个可绑 chat 都找不到（ok:false + 装 app/发消息指引）；chatId 无效/非成员（230001/230002 全否，同样给指引）。
    - 接入引导改为**仅降级时出现**：①「接飞书」意图（maybeOnboardIntent）的注入文案改为「先调 feishu_bind（不传 chatId）自动绑定，仅工具返回 ok:false 才转告装 app/扫码步骤」；② 新会话未绑定时的首次引导（maybeGuideNewSession）加 `hasBindableChat` 门控（decideNewSessionGuide 新参数，命中时 reason='has-bindable-chat'）——本机存在可自动绑定的 chat 就不再引导装 app；`buildNewSessionGuideText()` 文案本身未动（它现在只会在真降级场景出现，原逐句内容不变）。
- **为什么**：① 1.5.38 的 toolkit 三件套实际一个都没注册上（被 try/catch 吞成 warn，表面看不出），不修则中间层整版白做；② feishu_bind 原先基本要求传 chatId、接入引导无条件让用户装 app/去飞书发消息——用户要的体验是说「接飞书」就该绑好。
- **测试**：`test/toolkit.test.mjs` 新增回归节 6b（复刻宿主校验规则当守门员：apply() 注册出的每个 schema 逐层扫、type 必须单字符串 + 三个修复点字段专项断言 + 守门员自检「type 数组必被拒」）；新增 `test/feishu-auto-bind.test.mjs`（pickAutoBindChat 优先级/确定性/坏输入安全降级 + decideNewSessionGuide 降级门控 + feishu.js 静态接线核对，与 feishu-weixin-guide 同策略不碰 SDK 桩包雷区）。全量 `node --test`：**163 项，160 过 3 挂**（挂 = alarm-inject / home-relocate / tools-surface 环境基线，非本次引入，与 1.5.35/1.5.21/1.5.22 条目同基线）。
- 打包与 npm publish **不在本次范围**：本版只做版本号对齐 + 本地提交（不 push 远端），打包与 npm 发布留作下一步单独执行。

## 1.5.38（2026-11-12 新增：工具包中间层首批——`toolkit_cmd` / `toolkit_read` / `toolkit_write`）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **改了什么（新增 `lib/toolkit.js` + 测试，挂载与白名单接线；无既有工具行为变更）**：
  - `lib/toolkit.js`（新增，`aiyayi-toolkit`）：工具包中间层首批 3 工具（设计方案 docs/开发方案-工具包中间层.md）。分工原则：**简单结果状态型**查询（输出短、一次性、不需提炼）本体直接调、不用派小伙伴；**大量结果型**（翻文件堆、要提炼归纳的）照旧派 subagent / retriever。工具本身坏了（报错、行为异常）再派人修。
    1. `toolkit_cmd` —— 只读命令执行：白名单前缀**整词**校验（git log/status/diff/show、npm view/search、node --version、ls/dir/type/cat/head/tail/wc/where/which 等，可配置；大小写不敏感），白名单外（publish/push/install/rm/del/mkdir/cp/mv 等一切写变更类）一律拒绝；shell 元字符（重定向 `>` `>>`、管道 `|`、命令替换 `$(`、反引号、串接 `;`）一并拒绝，防白名单命令被拼接滥用；命令动词黑名单（publish/push/rm 等）双保险不误伤白名单命令；调用参数脱敏（token/bearer/URL 凭据打码）；输出超 2048 字符（可配置）截断并标注 `[truncated]`；默认 30s 超时杀进程。底层 `child_process.spawn` 在插件进程内执行——DSH 的 pwsh/file 沙箱是宿主对宿主工具的约束，插件内进程拿不到那层钩子，所以**白名单收敛就是本工具的安全层**（这也是把命令面收窄到"只读前缀 + 禁元字符"的原因）。
    2. `toolkit_read` —— 文件探测 + 小文件读取：exists/size/mtime/isFile/isDir + 前 maxBytes（默认 8KB，上限 64KB）内容。读是安全的，不限路径；读不到返回 `exists:false`（是正常答案不是错误）。
    3. `toolkit_write` —— 受限写入：路径白名单（默认 = 记忆根（动态解析，搬家自动跟随）+ `writeExtraPaths` 配置，可 `writePaths` 整体接管），限 64KB；原子写（临时文件 + rename）；覆盖前自动留时间戳 `.bak`。
  - **调用留痕（初版重点，供后续按使用痕迹优化）**：每次调用追加一条 JSONL 到 `<记忆根>/toolkit/usage.jsonl`（目录不存在自建；环形 500 行，超限保留最新）：`{ ts, tool, args(脱敏摘要), status(success/denied/timeout/truncated/error), denyReason, durationMs, outBytes, truncated, ok, exitCode, error }`。写留痕本身 try/catch，失败只 warn，绝不影响工具结果。
  - `lib/own-tools.js`：`OWN_TOOLS` 加 `toolkit_cmd` / `toolkit_read` / `toolkit_write`（运行时由 registerOwnTool 收集，这里防漏放行）。
  - `cordis.patch.yml` preset-aiyayi 挂载 `aiyayi-toolkit`（config：cmdWhitelist 19 条只读前缀 / cmdTimeoutMs 30000 / maxOutputChars 2048 / readMaxBytes 8192 / writeMaxBytes 65536 / writeExtraPaths 本机 docs 目录 / usageEnabled true / usageMaxLines 500）。
  - `package.json`：exports 与 files 白名单加 `./toolkit` / `lib/toolkit.js`。
- **为什么**：本体每次想看个 git status / 查个 npm view / 量个文件大小，都要派小伙伴或检索员走一整轮 subagent 开销；中间层把"简单结果状态型"查询收进本体直调的 3 个受限工具，省轮次；留痕（usage.jsonl）让后续能按真实使用痕迹继续优化工具面。
- **测试**：新增 `test/toolkit.test.mjs`（独立断言脚本风格，check() + `ALL PASS` / exit code，103 项断言；临时沙盘 + 指路文件隔离，绝不碰真实记忆根）。覆盖：白名单整词匹配（`git logfile` 这类前缀粘连不放行）、大小写不敏感、写变更类命令（npm publish / git push / rm -rf / mkdir / node --eval）全拒、shell 元字符（重定向/追加/管道/命令替换/反引号/串接）拒绝、动词黑名单不误伤白名单命令、参数脱敏三形态、输出截断与长度、真实执行 ok/stdout/exitCode/durationMs、超时（kill + exitCode null）、read 探测/小读/maxBytes clamp/空路径不抛、write 目录自建/落盘一致/覆盖留 .bak/usage.jsonl 留痕与环形裁剪。
- 版本号对齐：`package.json` version 与本条目均为 `1.5.38`（cordis.patch.yml 已无 reloadTag 字段，无需对齐）。
- 打包与 npm publish **不在本次范围**：本版只做版本号对齐 + 推 git（gitcode / gitee / github 三远端），打包与 npm 发布留作下一步单独执行。

## 1.5.37（2026-11-12 新增：压缩前沉淀机制 precompact——先保知识，再清流水）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **改了什么（只动 `lib/` + `cordis.patch.yml` 挂载 + 新增测试，无对外行为变更）**：
  - `lib/precompact.js`（新增，`aiyayi-precompact`）：压缩前沉淀检查层。在 `dsh-compaction-basic` 真正动手压缩**之前**，把当前会话「值得沉淀但还没落盘」的内容（任务闭环 / 关键结论 / 可量化数据 / 新经验）先写成 经验文档（docs/）+ 记忆（memories/ 分类档案）+ 更新 memory.md 索引，让压缩只负责清流水，摘要变成「指向落盘位置的索引」而非裸内容。**不重写 DSH 压缩器核心**；一切动作包 try/catch，沉淀失败**绝不阻塞主流程**（出问题只 warn 跳过、压缩照常跑——与 feishu/weixin「加载失败只禁用不炸」同一思路）。
  - 触发时机：**时机A（接近阈值）**——agent/pre-step 钩子里量一次 token，上下文估算量 ≥ `ratio × thresholdTokens`（默认 0.7，每会话最多一次）时对当前会话做一次沉淀检查，thresholdTokens 复刻 dsh-compaction-basic 公式；**时机B（收尾/显式）**——工具入口 `precompact_run`（`lib/own-tools.js` 白名单已加，本体收尾/update_state 前后随时可调）。
  - 判断「值得沉淀」：落到阿依娅伊已有行为铁律的启发式（任务闭环 / 关键结论 / 可量化数据 / 新经验），keyword 与开关可配置。
  - 沉淀动作三件套（路径可注入、不硬编码）：① 写经验文档 `docsDir`（默认记忆根下 docs/）② 写记忆 `memories/<分类>/…`（默认 `事情/经验`）③ 更新 `memory.md` 的 `<!-- 索引 -->` 段（追加「分类: 标题 → 文档路径」）。
  - `cordis.patch.yml` preset-aiyayi 挂载 `aiyayi-precompact`（config：ratio 0.7 / thresholdRatio 0.4 / headroomTokens 32768 / memoryPath 事情/经验 / updateIndex true；docsDir 不设 = 默认记忆根 docs/）。
  - `package.json`：exports 与 files 白名单加 `./precompact` / `lib/precompact.js`。
- **为什么**：上下文逼近压缩阈值时，dsh-compaction-basic 直接压缩会把「值得沉淀的任务闭环/结论/新经验」从上下文里冲掉；先落盘再压缩，知识不随流水一起丢。
- **测试**：新增 `test/precompact.test.mjs`（临时沙盘造记忆根、指路文件隔离，绝不碰真实记忆目录）。覆盖：值得沉淀启发式（该留的留、该丢的丢）、沉淀动作三件套落盘、工具注册 schema 合规且名字进 own-tools 白名单、`runPrecompact` 主入口（显式 content 落盘 / 弱内容跳过 / 失败不抛 = 沉淀失败不阻塞）、触发A阈值公式复刻 dsh-compaction-basic。
- **发版前置核验（并发撞号教训，本次实做）**：发版前先 `npm view dsh-aiyayi dist-tags`（latest=1.5.36，已被并发会话占用）+ `git fetch`（三远端在 b1704c0）；1.5.36 已占用，故本版升为 **1.5.37**。
- 打包与 npm publish **不在本次范围**：本版只做版本号对齐 + 推 git（gitcode / gitee / github 三远端），打包与 npm 发布留作下一步单独执行。

## 1.5.35（2026-11-12 新增：`feishu_status` 最近入站路由回看 `inboundRouting` 字段）——**已发布（npm 2026-11-12T02:27:31Z）**

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：`a6df9e7`（代码）+ `d023c1a`（DEPLOY 文档）；npm publish 由并发会话于 2026-11-12T02:27:31Z 完成，registry `gitHead=d023c1a`、shasum `45fc11369c0a5aa5c4ca2aa5290d1560cc59069a`。

- **改了什么（只动 `lib/` 与新增测试，无对外行为变更）**：
  - `lib/feishu-logic.js`：新增 `INBOUND_ROUTING_FILE='inbound-routing.json'`、`INBOUND_ROUTING_LIMIT=20`、`readInboundRouting(root)`、`appendInboundRouting(root,{at,chatId,appId,action,sessionId})`（空 chatId 忽略；环形缓冲 新→旧 超 20 丢最旧；写入 feishu 子目录）。
  - `lib/feishu.js`：`onIncomingMessage()` 各路由分支（select/route/auto-new/bind/new/reuse/choose/new-fallback）调用 `recordRouting(action,sessionId)`；`feishu_status` 返回新增 `inboundRouting` 字段（读 `readInboundRouting(root)`）。
- **为什么**：`feishu_status` 此前只报当前绑定/应用状态，看不到最近入站消息被路由到哪个会话、怎么路由的，排查"消息去哪了"要翻日志；回看字段让最近的入站路由一目了然（新→旧，上限 20 条）。
- **测试**：新增 `test/feishu-inbound-routing.test.mjs`（本文件单跑全过）；全量 159 项 3 挂 = 既有环境基线（`alarm-inject`/`home-relocate`/`tools-surface` 磁盘探测，非本次引入，与 1.5.21/1.5.22/1.5.27 条目同基线）。
- 发布：npm publish 由并发会话完成（2026-11-12T02:27:31Z），打包 47 files / packed 349.2 kB。
- **本版不含连接状态修复**：同一时间另一条工作线在做 `connected` 实时化（见 1.5.36）。两笔改动在 git 上合并后，1.5.35 的 npm 包**先于合并**被发布，故不含后者——这也是 1.5.36 单独发版的原因。

## 1.5.36（2026-11-12 修复：飞书连接状态失真——`connected` 在断开/重连期间从不回写）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- **为什么单独发一版**：本修复原计划随 1.5.35 发布，但 1.5.35 已被一个并发会话抢先 `npm publish`（2026-11-12T02:27:31Z，内容只有 `inboundRouting`）。npm 不允许同版本重发，而线上包仍在报假 `connected: true`（用户被误导"飞书一切正常"），所以按"修复必须真到达用户"的原则升为 **1.5.36** 单独发布。代码层面两笔改动早已合并（git 上同一棵树），差异只在版本号与发布时机。

- 症状：`feishu_status` 的 `connected` 自首次建连成功后恒为 `true`，即使长连接早已断开、SDK 正在重连也照报在线。2026-11-11 日志里 `[ws] reconnect` 出现 **326 次**（平均 124.5 秒一次，与 SDK 的 120s + 0~30s 抖动重连定时器吻合），期间 `feishu_status` 一直报 `connected: true`，用户被误导成"飞书一切正常"。
- **根因（源码定位，不是推测）**：`lib/feishu.js` 旧 441-448 行只在 `channel.connect().then()` 里写 `state.connected = true`，**之后没有任何回写**。全仓 grep `onReconnecting|onReconnected|onError` → **0 处命中**。而 `feishu_status`（旧 1447/1453 行）读的就是这个粘性值：`connected: state ? state.connected === true : false`。SDK 的自动重连是在 WS 内部循环里完成的，插件从未被告知。
- **SDK 取证（@larksuiteoapi/node-sdk 1.76.0，`lib/index.js` 实读行号）**：
  - `WSClient` 构造参数收 `onReady / onError / onReconnecting / onReconnected`（102422），存成实例字段（102446-102449）。
  - `reConnect()`：打 `[ws] reconnect` 日志后 `if (this.hasEverConnected) safeInvoke('onReconnecting', ...)`（102759-102762）；重连循环成功 → `safeInvoke('onReconnected', ...)`（102787-102792）；重试耗尽/不可恢复错误 → `safeInvoke('onError', ...)`（102735-102741、102800-102815）。
  - `createLarkChannel` 建 WSClient 时把 `onReconnecting/onReconnected` 转成 `handlers.reconnecting/reconnected`（106988-106989），即公开 API `channel.on('reconnecting'|'reconnected', fn)`（107021-107032）。
  - **`onError` 没有转发**（106981-106986）——它只在首次握手前用于 reject `connect()`，之后重连耗尽的 `onError` 无处可去。所以错误改从 `channel.rawWsClient.onError`（实例字段，106961 建）上再包一层拿。
  - 兜底：`channel.getConnectionStatus()`（107017-107020 → WSClient 102982）返回 `{state: 'connected'|'reconnecting'|'connecting'|'idle'|'failed', lastConnectTime, nextConnectTime, reconnectAttempts}`。
  - 注意：SDK 的 `safeInvoke` 会吞回调异常（102543-102552），所以插件侧回调必须自己 try/catch + 日志，否则出错无声。
- 修法（分两层，纯逻辑与接线分离）：
  1. **新增纯状态机**（`lib/feishu-logic.js`，零外部依赖、可单测）：`createConnectState()` / `noteConnectEstablished()` / `noteDisconnect()` / `noteConnectError()` / `reconnectsWithinWindow()` / `evaluateConnectHealth()` / `describeConnectState()` / `reconcileConnectState()`。状态字段：`connected / connectedAt / lastDisconnectAt / lastDisconnectReason / reconnectCount / reconnectTimestamps / error / lastError / lastErrorAt / everConnected`。
  2. **接线**（`lib/feishu.js`）：`wireConnectEvents()` 在 `connect()` 成功后挂 `channel.handlers.reconnecting`（断连 → `connected=false` + `lastDisconnectAt` + 原因 `ws-reconnecting`）、`channel.handlers.reconnected`（重连成功 → `connected=true`、更新 `connectedAt`、`reconnectCount++` + 窗口计数，并打一行"累计 N 次 / 5 分钟内 M 次"），并包 `channel.rawWsClient.onError`（错误 → `lastError` + 日志，同时仍调用 SDK 原 `onError` 不破坏其行为）。插件卸载时把状态落成 `connected=false / plugin-dispose`，热重启窗口里不再报假在线。
- `feishu_status` 返回扩展（**旧字段一个不少，只新增**）：
  - 顶层新增 `healthy`、`connectedAt`、`lastDisconnectAt`、`reconnectCount`、`lastError`、`reconnectsInLast5m`、`unhealthyApps`，以及不健康时的可读 `warning`（"长连接不稳定，最近 5 分钟内重连 X 次——飞书消息可能延迟或漏收。"）；未配置凭证时 `warning` 给"长连接未启动"。
  - `apps[]` 每条新增 `connectedAt / lastDisconnectAt / lastDisconnectReason / reconnectCount / reconnectsInLastWindow / lastError / lastErrorAt / healthy / healthHint`；旧 `appId / connected / chatsOwned / error` 原样保留。
  - **`connected` 语义改为实时**（事件驱动 + 读时用 `getConnectionStatus()` 快照对账纠偏；对账只纠布尔字段，不动 `reconnectCount`，避免与事件重复计数）。全仓 grep `connected` 确认无其它模块依赖"粘性 true"这一行为——只有 `feishu.js` 自己写、自己读，另加文档与测试描述，故改语义不破坏调用方。
- 健康判据：`healthy = connected && 最近 5 分钟内重连次数 ≤ 3`。**阈值取"超过 3 次"**（正好 3 次仍健康）。窗口靠时间戳数组滚动裁剪，读时裁（不污染累计 `reconnectCount`）。
- persona 同步（`cordis.patch.yml` 的【飞书】段）：写明 `connected` 是**实时状态**、`healthy` 是**综合健康度**、`warning` 是插件告警；明确要求 `connected:false` 就说"长连接现在是断的"，`connected:true` 但 `healthy:false` 要补一句"在线但不太稳"，**别只看 `connected:true` 就宣布一切正常**。
- 测试：新增 `test/feishu-status.test.mjs`（单文件 9 组断言段、A–I），覆盖任务要求的六项并加码：
  - A 初始未连接（`connected=false`、`connectedAt=null`、`healthy=false`）；B 建连成功 → `connected=true`；C 断连 → `connected=false` + `lastDisconnectAt`/原因有值；D 重连成功 → `connected=true` + `reconnectCount` 递增 + `connectedAt` 更新（并断言不停留在首次建连）；E 5 分钟内重连超 3 次 → `healthy=false` + 提示文案，且阈值边界（正好 3 次）仍健康、窗口滑过后恢复健康、累计计数不因窗口滑动回退；F 错误 → `lastError` 有值（Error / 字符串 / LarkChannelError 形态均可），且"连上清 `error` 但保留 `lastError`"；G 快照对账正反向纠偏 + 未知快照不猜；H 接线静态核对（**反向断言**：`.then(() => { state.connected = true` 的旧写法必须已消失）。
  - **I 段走真实 `apply()` + 假 WS 事件序列**：`channel.handlers.reconnecting()` → `feishu_status` 必须立刻报 `connected:false`（即本 bug 的核心回归断言），`handlers.reconnected()` → 回 true 且计数递增，4 次抖动 → `healthy:false` + 顶层 `warning`、`unhealthyApps`，`rawWsClient.onError` → `lastError`，卸载 → 不再报在线；另断言 1.5.34 的 10 个旧字段一个不少。
  - **测试隔离方式（重要，避免重踩坑 #76）**：本测试用 `node:module` 的 `registerHooks()` **进程内 loader 钩子**替换 `@larksuiteoapi/node-sdk` / `@deepseek-ai/dsh-llm`，**不落任何文件到 `node_modules`**。`test/feishu-accumulate.test.mjs` 用的是"落盘桩、已存在不覆盖"，两文件并发跑会互抢同一批桩目录（本次开发中实锤触发过：accumulate 挂 `Cannot read properties of undefined (reading 'push')`）。进程内钩子从根上避开这一类并发污染。
  - 全量单测 `node --test "test/*.test.mjs"`：**159 项全通过 / 0 失败**（1.5.34 基线 158，本版新增 `test/feishu-status.test.mjs` 一项）。连跑 3 遍均 159/0，且跑完 `node_modules` 目录不存在（无桩残留）。
  - 另有独立取证脚本 `test/feishu-status-proof.mjs`（文件名不带 `.test.mjs`，**不进全量通配**）：按 SDK 真实时序喂一串假 WS 事件（首次建连 → 抖动断连 → 重连成功 → 4 轮抖动风暴 → 重试耗尽 → 恢复），逐步打印 feishu_status 可见字段并断言。实跑输出 `exit 0`：`connected=true/healthy=true → false/false（断连）→ true/true 且 reconnectCount=1 → true/false 且 5min=5 → false/false + lastError → 窗口滑过后 healthy=true`，`PROVEN`。
  - 取证脚本开发中自身纠正一次：最初「5 分钟窗口」把断连也推进了 120s，导致 4 轮抖动摊到 10 分钟外、`healthHint` 为 null——说明窗口裁剪逻辑正常工作，抖动必须真的密集才判不健康（把每轮压到 20s 内后如期触发）。
- 新文件均无 BOM。
- 未包含：SDK 事件里拿不到 close code / reason（`wsInstance.on('close', ...)` 在 SDK 内部只打 debug 日志、不回传参数，102873-102877），所以 `lastDisconnectReason` 记的是插件侧归因（`ws-reconnecting` / `sdk-state:<state>` / `plugin-dispose`），不是飞书的原始关闭码。

- **教训（并发发版会撞车，写在这供后来人省事）**：本版差点与另一条会话同时发同一个版本号——那边 10:21 推代码、10:27 直接 `npm publish 1.5.35`，而本会话 10:29 才 push，回查 registry 才发现版本号已被占。**以后发版前必须先查两处再动手：`npm view dsh-aiyayi dist-tags`（看 latest 有没有被抢）与 `git fetch <remote> && git log HEAD..<remote>/main`（看远端有没有新提交）**，不要闷头改完就直接 `git push` + `npm publish`。npm 的版本号是**全局不可逆**的，一旦被别人占了，只能改号重发，白折腾一轮。并发会话之间尤其要约定：改版本号属于"抢占式操作"，先查后占。
- 版本号三处对齐：`package.json` version、本条目、profile `cordis.patch.yml` 里 `aiyayi-feishu` 的 `config.reloadTag` 均为 `1.5.36`（profile 已先备份为 `cordis.patch.yml.bak-1.5.36-20261112-104808`）。
- **与 1.5.35 的共存验证**（合并冲突解决后专门做的，不只看测试绿）：用真实形状的 `inbound-routing.json`（3 条记录）跑 `feishu_status`，断言 ① 记录原样读出、顺序新→旧、`sessionId: null` 保留；② `healthy` 从 true→false→断连三次翻转时，`inboundRouting` **逐字节不变**（`JSON.stringify` 比对相同）。`healthy` 只读连接状态机、不读入站数据，两条数据通路互不干扰。23 项断言全过。

## 1.5.34（2026-11-12 修复：`presence-clock.test.mjs` 跨午夜偶发失败——**只改测试，无运行时行为变化**）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- 症状：`node --test "test/*.test.mjs"` 偶尔报 `test/presence-clock.test.mjs` 失败，重跑即过。2026-11-11→12 午夜实跑中招一次（1.5.33 发版前那次全量跑）。
- **根因（实测确认）**：旧判据拿「取样的 `new Date()`」与「注入的时间」比**年月日是否相同**（`sameDay`）。而注入发生在 `presence.js:1195` 的 `const now = Date.now()`（handler 内部），取样在 handler 返回之后——只要这两个点跨过 `00:00:00`，注入写 `23:59:59`、取样已是次日 `00:00:00`，`sameDay` 必挂，**而插件行为完全正常**。这是测试自身的日历日判据缺陷，跨午夜必挂、别的时刻永远不会暴露。
- 修法（**只动 `test/`，`lib/` 一行未改**）：判据换成**夹逼窗口**——注入时刻必须落在「调用前 `beforeMs` → 调用后 `afterMs`」之间（epoch 毫秒比较，附加 2s 容差抗时钟微调）。跨午夜天然成立：`23:59:59` 与 `00:00:01` 的 epoch 差就是 2 秒，不涉及"同一天"这种日历概念。
- 同时把**断言做强**了（不只换判据，还补了三条纯格式正确性校验，都不依赖"现在几点"）：① 星期字符必须与注入日期自洽（`getDay()` 对得上）；② 时区偏移必须与运行环境一致（支持 `+05:30` 这类半小时时区）；③ 注入时刻必须落在夹逼窗口内（偏差实测 −67ms）。
- **取证（不是只跑一次通过）**：新增独立脚本 `test/presence-midnight-proof.mjs`（文件名不带 `.test.mjs`，**不进全量通配**，不参与 158 项）：把 `globalThis.Date` 打桩，让真实注入发生在 `23:59:59.600`，再把桩时钟推过午夜到 `00:00:00.400`，跑真实 pre-step 注入，然后用两套判据同时判：
  - 旧判据 `sameDay` → **失败**（复现那次偶发）；
  - 新判据 夹逼窗口 → **通过**。
  - 实跑输出：注入行 `[时间] 现在 2026-11-12 23:59:59 周四 (UTC+08:00)`，调用窗口 `[1794499199600, 1794499200799]`，`PROVEN：真实注入在 23:59:59，取样跨到次日 00:00:00 —— 旧判据挂、新判据过`，exit 0。
  - 主测试内另加 5 条**自证 + 反证**（不依赖桩时钟，任何时刻都跑）：(a) 构造 23:59:59 / 次日 00:00:01 一对时间戳，旧判据说"同一天"必须为假；(b) 新判据必须为真；(c) 两者偏差 ≤2s；(d) 把窗口挪到两天后，新判据必须报错；(e) 注入年份写错一年，新判据必须报错——**证明新断言不是"改成永远成立"**。
- 为什么不把打桩那套塞进主测试：`globalThis.Date` 一改就影响同进程所有模块，会让其它断言也跑在假时钟下。所以做成独立脚本单独进程跑，只在取证时手动执行。
- 验证（2026-11-12 本机实跑）：
  - 全量单测 `node --test "test/*.test.mjs"`：**158 项全通过 / 0 失败**（与 1.5.33 基线同为 158，本版不新增 test 通配条目）。
  - `node test/presence-midnight-proof.mjs` → `PROVEN`，exit 0。
  - 新文件均无 BOM。
- 版本号三处对齐：`package.json` version、本条目、profile `cordis.patch.yml` 里 `aiyayi-feishu` 的 `config.reloadTag` 均为 `1.5.34`（profile 已先备份为 `cordis.patch.yml.bak-1.5.33-20261112-002902`）。
- **运行时零改动**：`lib/` 下所有文件与 1.5.33 逐字节相同（`git diff --stat` 只有 `test/` 两个文件 + 版本号文件）。装 1.5.34 与装 1.5.33 行为完全一致，本版只为让单测在跨午夜时不再误报。

---

## 1.5.33（2026-11-11 行为变更：「对接默认落到当前会话」从准则落成代码——未绑定 chat 三档复用）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- 需求（李浩 2026-11-11 原话）：「对接机器人都默认当前对话的会话吧，别新建会话了，除非用户主动要求」；澄清后语义 = **绑定的对象是「发起对接的那个会话」**，不是「新建一个会话再绑过去」。后续追加：「这个默认机器人会话对接规则需要固化到 aiyayi 安装包里」。
- 1.5.32 只把这条写进 persona 准则与文档（零代码），**本版落成实际代码行为**。
- **改动落点**：`lib/feishu.js` 的 `onIncomingMessage()` 里 `action === 'new'` 分支原先「无条件新建会话并接入」，现改为三档决策；决策逻辑抽在纯函数 `lib/feishu-logic.js` 的 `decideUnboundChatRouting()`，候选采集在 `collectActiveSessionCandidates()`。
- **三档（零歧义才自动，绝不瞎猜）**：
  1. **恰好 1 个活跃真人会话** → `mappings[chatId] = 那个会话`，回「已接到你当前的会话：X。之后这个飞书对话的消息都会投到这里。」，**不新建**；
  2. **多个活跃** → **不绑不建**，回编号列表让用户选，格式 `1. 会话名（工作区：xxx）`，并明说「我不替你猜该投哪个」；用户回 `2` / `选2` / `第2个` / `绑定会话 2` 即接入。**刻意不挑"最近那个"**——会话各带自己的上下文，投错比多问一句糟糕得多（这是需求方特别强调的点）；
  3. **0 个活跃** → 才新建，并照实回「没有可复用的活跃会话，已给你新建并接入 X」，**不谎称接在原会话上**。
- **候选排除规则**（每条对应一个真实串味风险，纯函数 `normalizeSessionCandidates()` 统一负责）：子智能体（`header.origin === 'subagent'` 或带 `header.parentSession`）、微信通道会话（`weixin-` 前缀，1.5.28 串味教训）、飞书自建会话（`feishu-` 前缀，那是给别的 chat 的）、**已被别的 chat 绑定的会话**（否则两个 chat 抢同一会话），以及重复 id。
- **开关**：`feishu.reuseActiveSession` 默认 `true`；**只有布尔 `false` 才回退** 1.5.32 旧行为（一律新建）——字符串 `"false"` / `0` / `null` 都当开启，防 YAML 误配把默认规则悄悄关掉。
- **显式要求优先**：用户说「新建会话 X」（`routeMessage` 返回 `name` 非空）时直接新建、跳过三档复用——那是主动要求。
- **待选状态**：多活跃时的候选列表落盘 `feishu/pending-choice.json`，TTL **10 分钟**；过期或越界都会明确回一句，不静默吞。只认纯序号——`绑定会话 sess-abc` 这种真 id 交给 `routeMessage` 的 bind 分支，不被抢。
  - **按 chatId 分键存**（`{ chatId: { candidates, createdAt } }`），不是全局单条——这是写完后审 diff 时实测出来的真缺陷：初版只有一份全局待选，宿主同时挂两个飞书 chat 时，**chat B 的「2」会把 chat A 的候选消费掉，并把 B 接到 A 选的会话上**。现在读写清全部带 chatId，两个 chat 的待选并存、各选各的，有专门用例覆盖（`c7`）。
- **已绑定 chat 零影响（硬底线）**：`routeMessage()` 里 `mappings[chatId]` 存在即 `action:'route'`，**先于一切判断**，三档决策只在 `action==='new' && name==null` 时才进入。线上 `oc_f327…` 那条绑定不受任何影响，有专门的回归断言（见下）。
- **数据来源（实测 asar 核对，非推测）**：
  - 活跃会话：`ctx.get('sessions').list()`（header 带 `origin`/`parentSession`/`cwd`）；
  - 会话标题：`ctx.get('sessionTitle').get(session)` → 折叠快照的 `?.title` 才是字符串；
  - 工作区：`ctx.get('workspaceRegistry').list()` → `{id, title, path, sessionIds}`，一次拿全工作区名与路径（比从 agent 上摸 cwd 靠谱，asar:9045243 的 `workspaces()` 同源）；
  - 取不到标题 → `未命名会话（<ID 前 8 位>）`；取不到工作区 → 列表行不拼括号（不留空的「（工作区：）」）。
  - `inject` 补 `'sessions'`（其余两个服务早已在 inject 里）。
- **验证（2026-11-11 本机实跑）**：
  - 全量单测 `node --test "test/*.test.mjs"`：**158 项全通过 / 0 失败**（1.5.32 基线 157，新增 `test/feishu-reuse-session.test.mjs` 一组）。
  - 新测试覆盖父级点名的五种情况：**(1) 1 个会话 → reuse**、**(2) 多个 → choose**（含列表渲染格式、超过 8 个截断并说明余数、文案含"不替你猜"）、**(3) 0 个 → new**（文案照实说新建、不许出现"接到你当前"字样）、**(4) 已绑定 chat 行为完全不变**（`oc_f327…` 回归：普通消息 / 有其它活跃会话 / 说「接入飞书」三种情形一律 route 原会话，且候选 0/1/3 个时都不改投）、**(5) `reuseActiveSession=false` 回退**（含"只有布尔 false 才算关"的一串取值断言）。
  - 另覆盖：候选排除五类 + 去重、未命名占位带 ID 前 8 位、`workspaceTitle` 缺失回落 `cwd`、选号回复六种写法、真 id 不被抢、越界/过期/无待选/坏 JSON 四种边界、`pending-choice.json` 落盘读回与清空、以及 10 条静态接线核对（含"选号消费必须排在 routeMessage 之前"、"显式新建必须在复用决策之前分流"）。
  - `lib/feishu.js` 单独做语法解析（把两个宿主包 import 换成本地模块后 `node --check`）通过——它依赖 `@larksuiteoapi/node-sdk` 与 `@deepseek-ai/dsh-llm`，不便直接 import 做端到端，理由同 1.5.32 条目（坑 #76 同片雷区）。
  - persona 体检测试从 27 条扩到 32 条，新增断言：1 个直接接过去 / 多个给列表 / 不许替用户挑最近那个 / 0 个才新建 / `feishu.reuseActiveSession` 开关名在位。
- 版本号三处对齐：`package.json` version、本条目、profile `cordis.patch.yml` 里 `aiyayi-feishu` 的 `config.reloadTag` 均为 `1.5.33`（reloadTag 语义同上；仓里那份 patch 没有 reloadTag，别改错）。
- **未包含（留给以后，优先级低）**：微信侧「`allowlist` 显式放行但还没绑定」的首条消息仍会新建会话——空白名单下微信只放行已绑定用户，能走到这条分支的是极边缘情况，为避免把本版拖大，本版不动它。

---

## 1.5.32（2026-11-11 行为变更：首次提示同时告知微信 ClawBot 能力；「对接默认落到发起对接的会话」固化为准则）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- 需求（李浩 2026-11-11 原话）：「首次会话提醒飞书对接的同时，也提醒一下我们有微信 clawbot 机器人对接能力，如果用户需要我们可以指导用户对接微信机器人」；后续追加「这个默认机器人会话对接规则需要固化到 aiyayi 安装包里」。
- **本次只做文案 + persona 准则 + 文档，零路由代码改动**（路由改动拆到 1.5.33，见文末）。理由：路由是消息投递核心，一旦出问题会把现有 `oc_f327…` 正常绑定搞坏；文案与准则改完立刻见效，不需要碰路由。
- 改动：
  1. **首次会话提示加微信一句（147→210 字，上限 220）**：`lib/feishu.js` 的 `maybeGuideNewSession()` 原先硬编码一段 147 字文案，现改为调 `lib/feishu-logic.js` 的 `buildNewSessionGuideText()`。飞书原有内容**一字未删**（安装 app / open.feishu.cn 扫码 / 单聊自动接入），中间插入一句「另外我还能接微信 ClawBot 机器人（腾讯官方 iLink 协议），这条默认没开启；需要的话跟我说，我带你一步步接。」，结尾「如果不需要，回复「不用」即可跳过，我不会再提示。」原样保留在最后。
  2. **微信意图不走飞书引导**：`maybeOnboardIntent()` 里新增 `matchWeixinIntent()` 分支，并排在飞书分支之前。用户说「接入微信」→ 只做 `markGuided`（不再发飞书引导）+ 投一条微信接入指引（`buildWeixinOnboardText()`，含 enabled / weixin_login / 121 秒 / "没有 weixin-setup 技能"），**不写飞书的 pending-bind**（否则会把一个微信请求挂成飞书待接入目标）。
  3. **意图匹配扩词**：`matchWeixinIntent` 认 `接入微信|微信接入|绑定微信|微信绑定|接微信|连微信|接上微信|开通微信|加微信|添加微信`；与飞书共用同一套两道闸门（闸 1 短祈使句 ≤30 字、非多行；闸 2 含「怎么/如何/改造/代码…」等讨论词不触发）。**「微信怎么接」判为讨论性提问、不触发引导**，由模型照 persona 口头答——这是需求方的明确判断。`matchOnboardIntent` 的飞书词一条未动，`接入机器人|绑定机器人` 也保留（历史语义=飞书；「接入微信机器人」中间夹「微信」，不会命中这四个连续字，有测试锁定）。
  4. **persona 补【微信】段 + 两段各加一条对接会话准则**（`cordis.patch.yml`，纯模型可见 system prompt）：
     - 【微信】段：通道存在与**默认关闭**（`weixin.enabled` 必须显式 `true`，字符串 "true"/1 都不算）、工具四件（`weixin_status` / `weixin_login` 二维码 121 秒寿命 / `weixin_bind` / `weixin_unbind`）、开启三件套（enabled + accounts `[{accountId, credentialRef}]` + 先扫码拿凭证）、空白名单 = 只放行已显式绑定的用户（**与官方相反，别照官方文档念**）、**没有 weixin-setup 技能**（别假装有）。
     - 【飞书】【微信】各一条：**对接默认落在「发起对接的那个会话」，能复用就复用、别给他新建**，只有用户明确说「新建会话」才新建；兜底新建（chat 从没走过对接）要照实说"给你新建了会话 X"，别谎称接在原会话上。
  5. **README**：能力表补「微信桥接」一行，另加「对接落到哪个会话（默认规则，1.5.32 固化）」一行，写明这条属行为约定而非可选配置。
  6. **判定抽纯函数**：`decideNewSessionGuide({sessionId, isSubagent, alreadyGuided, chatId})` 承接 `maybeGuideNewSession` 原四个跳过条件（子智能体 / `weixin-` 前缀通道会话 / 已引导过 / 已绑定 chat），行为不变但可单测。
- 验证（2026-11-11 本机实跑）：
  - 全量单测 `node --test "test/*.test.mjs"`：**157 项全通过 / 0 失败**（1.5.31 基线 156 项，新增 `test/feishu-weixin-guide.test.mjs` 一组）。
  - 新测试锁四层：文案（飞书原句逐句在位 + 微信/ClawBot/iLink/腾讯官方在 + `默认没开启` + 结尾「不用」句在最末 + **长度 ≤220**）、注入判定（未绑定→注入；已绑定/已引导/子智能体/`weixin-` 通道→不注入；`^weixin-` 才算通道，`dev-weixin-x` 不算）、意图（8 个微信祈使句触发；`微信怎么接` 等讨论句不触发；长句/多行不触发；飞书行为不变 + `接入微信机器人` 不误判为飞书）、接线（`feishu.js` 真调这四个纯函数，且微信分支排在飞书分支之前）。
  - **为什么不断言 `deliverToSession` 端到端**：导入 `lib/feishu.js` 需要 `@larksuiteoapi/node-sdk` 与 `@deepseek-ai/dsh-llm` 两个桩包，而 `feishu-accumulate.test.mjs` 会在 repo 的 `node_modules` 里建/删同一批桩目录——`node --test` 多文件并发跑会互相删（坑 #76 同一片雷区）。改用「纯函数 + 静态接线核对」，不碰 `node_modules`、不与并发测试抢文件。
  - persona 体检测试从 19 条扩到 27 条，新增断言：微信通道存在 / 默认关闭说实话 / 121 秒 / 没有 weixin-setup 技能 / 空白名单语义 / 对接默认落当前会话 / 不主动新建 / 微信绑定同样落当前会话。
- 版本号三处对齐：`package.json` version、本条目、profile `cordis.patch.yml` 里 `aiyayi-feishu` 的 `config.reloadTag` 均为 `1.5.32`（reloadTag 语义同上；仓里那份 patch 没有 reloadTag，别改错）。
- **未包含（拆到 1.5.33）**：路由代码的实际改动。现状摸排结论——
  - 飞书 `routeMessage()`（`lib/feishu-logic.js`）：chat 已绑定 → 投给映射会话；`绑定会话 X` → 绑到 X；`新建会话 X` → 新建；**其余（未绑定 chat 的普通消息）→ 无条件新建会话**。这是用户所说"发条消息就新建"的唯一命中点。
  - 飞书扫码接入路径**本来就符合要求**：会话 A 说「接入飞书」→ `maybeOnboardIntent` 写 `pending-bind{sessionId: A}` → 进单聊 `bot_p2p_chat_entered_v1` → `mappings[chatId] = A`。代码里没有任何"先建会话再绑"的路径。
  - 微信 `handleInbound()`：`bindings` 有 → 直接投（复用、不新建）；没有 → 新建并绑定。但 `decideInbound()` 在空白名单下**只放行已绑定用户**，陌生消息直接丢弃，所以实际走不到"陌生消息就新建"；`weixin_bind` 缺省 sessionId 就是当前会话，autoNext 只补 userId、不建会话——已符合需求。
  - 1.5.33 方案（已与上层确认）：`feishu.reuseActiveSession` 默认 `true`；恰好 1 个活跃真人会话 → 直接绑、不新建并回一句告知；多个活跃 → 不绑不建、给编号列表让用户选（**不挑"最近那个"**，会话之间有上下文，投错很尴尬）；0 个活跃 → 才新建并明说。**零歧义才自动**。已绑定路径完全不动，`oc_f327…` 不受影响，且要先给它留回归测试。

---

## 1.5.31（2026-11-11 修复：PowerShell 体检拿到 `major: null`——探测链补上 powershell.exe 一级）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- 症状：1.5.28 的首次对话 PowerShell 体检，落盘的 `pwsh.json` 里 `major` 恒为 `null`。提醒虽然提过一次，但底层判断是空的——`isPwshTooOld(null)` 恒为 true，碰巧说出了对的话，却拿不出"当前到底是几"。
- **根因（实测确认，不是 BOM、不是编码、不是字段名对不上）**：探测链只到 `pwsh` 为止。本机（`C:\Users\LH`，2026-11-11 实测）根本没装 PowerShell 7——`where pwsh` 零命中、`Get-AppxPackage '*PowerShell*'` 空、`winget list --name PowerShell` 无匹配、`C:\Program Files\PowerShell` 不存在、`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe` 也不存在（全盘常见位置递归搜 `pwsh.exe` 零命中），机器上只有系统自带的 `powershell.exe` 5.1（`$PSVersionTable.PSVersion = 5.1.19041.6456`，PSEdition=Desktop）。探测链在 pwsh 全落空后就直接收工给了 `null`，**从来没退回去问 5.1 是几**。于是 `null` 这个值把"没装 pwsh"和"装了但解析失败"糊成一团，谁也分不出来。
  - 顺带记一笔：1.5.28 头注释里写的"探 `powershell.exe` 永远不会失败，所以不探"是**错的设计前提**——正因为 5.1 几乎必然存在，才应该探它拿真实版本号。
- 修法（改动全部落在 `lib/pwsh-check.js`，不涉其他模块）：
  1. **探测链加一级（核心修复）**：`pwsh`（走 PATH）→ 已知绝对路径候选 → **`powershell.exe`**。拿到 5 就正常报"5 是旧版、该提示升级"，**不再算探测失败**；只有三级全落空才是真的没探到东西。
  2. **绝对路径候选用 `lstat` 预筛**（派生自 dsh-ops 的 `isSpawnableFile`，MIT，文件头已注明出处）：`existsSync`/`statSync` 在 Windows Store 的 0 字节 app execution alias 上会因 EACCES 吞异常返回 false，把"已装好"误判成"没装"。`lstat` 认符号链接；且**只筛确认的 ENOENT/ENOTDIR**，EACCES 等一律放行交给 `spawn` 判——真正作数的永远是 spawn 的结果。
  3. **候选清单补全**：`ProgramFiles\PowerShell\7` → `7-preview` → `ProgramFiles(x86)` 同路径 → `%LOCALAPPDATA%\Microsoft\WindowsApps` → scoop（`~\scoop\shims`、`~\scoop\apps\powershell\current`）→ chocolatey（`%ProgramData%\chocolatey\bin`）。
  4. **失败不静默**：状态文件升到 `version: 2`，除 `major` 外新增 `status` / `source`（`pwsh` / `pwsh-path` / `windows-powershell` / `none`）/ `detail` 三个字段；解析不出来时 `detail` 带上输出原文前 120 字，不再只给一个 `unparsable`。
  5. **编码兜底**：探针命令前置 `try{[Console]::OutputEncoding=[Text.Encoding]::UTF8}catch{}`；stdout 改成**保留原始字节**（原先 `String(chunk)` 先按 UTF-8 猜一遍就丢了信息），由新增的 `decodeOutput()` 按 BOM 判 UTF-8/UTF-16LE/UTF-16BE、无 BOM 走 UTF-8、解出替换字符再退 GBK。
  6. **解析放宽**：整行匹配不上时，整串是个版本号（`7.4.1`）也认主版本；但噪音里的数字不认（`WARNING: 12 things` → `null`），宁可降级也不瞎猜出一个 ≥7 把提醒吞掉。
  7. **向后兼容**：读到 1.5.30 及以前那种没有 `version` 字段的旧 `pwsh.json`（正是本 bug 留下的 `major: null` 旧账）时判为"没查过"重测，但把 `notifiedAt` 保住——升级后不会把已经说过的话再唠叨一遍。
- 验证（2026-11-11 本机实跑，不是推演）：
  - 全量单测 `node --test "test/*.test.mjs"`：**156 项全通过 / 0 失败**（`pwsh-check.test.mjs` 由 38 项扩到 44 项）。
  - 真机端到端（import 真模块、起真子进程）：本机只有 5.1 的环境下 `detectPwshVersion()` 返回 `{status:'ok', major:5, via:'powershell.exe', source:'windows-powershell'}`，落盘 `major: 5`——**`major` 从 `null` 变成真实的 5**；`maybePwshNotice()` 680ms 内给出升级提示。
  - 失败降级：pwsh 与 powershell.exe 都不存在时 `{status:'missing', major:null, source:'none', detail:'pwsh: ENOENT; …; powershell.exe: ENOENT'}`，不抛错、不崩；非零退出时 `detail` 带退出码。
  - 编码怪异：UTF-8 BOM + 中文噪音行 → 7；UTF-16LE（带 BOM）→ 5；`7.4.1` → 7；纯噪音 → `null`（老实降级）。
  - 向后兼容：读 1.5.30 旧格式缓存 → 判为需要重测、`notifiedAt` 保留；重测后拿到 `major: 5`。
- 版本号三处对齐：`package.json` version、本条目、profile `cordis.patch.yml` 里 `aiyayi-feishu` 的 `config.reloadTag` 均为 `1.5.31`（reloadTag 语义同 1.5.29 条目：只要求值变了以触发 HMR，不参与部署值比对）。
- 不含功能性改动的部分：微信通道（1.5.27 并入、1.5.28 收尾，默认关闭）本版**一行未动**。

## 1.5.30（2026-11-11 修复：create-bot 脚本注释里的实测出处改用 <记忆根> 占位）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本版首个改动是源码仓 commit `bbaf4f1`（2026-11-11，阿依娅伊）：`skills/feishu-setup/scripts/create-bot.js` 里两处注释的实测出处——默认权限清单 `DEFAULT_SCOPES` 里 `im:resource` 的依据、默认回调 `DEFAULT_CALLBACKS` 里 `card.action.trigger` 的依据——原先写的是本机盘符绝对路径（…\记忆\feishu\workspaces\…），改用 `<记忆根>/feishu/workspaces/.../` 占位，别人装包后不会再看到一条只对某台机器成立的路径。
- 为什么单独发一版：1.5.29 已发布到 npm，但发布点早于 `bbaf4f1`，包里仍是写死本机路径的注释；本版就是把这处修正带进发布包。除该注释外不含功能性代码改动。
- 版本号三处对齐：`package.json` version、本条目、profile patch 里 `aiyayi-feishu` 的 `config.reloadTag` 均为 `1.5.30`（reloadTag 语义同 1.5.29 条目：只要求值变了以触发 HMR，不参与部署值比对）。
- 打包与 npm 发布不在本次范围内：本版只做版本号对齐 + 推 git（gitcode / gitee / github 三个远端），打包与 npm 发布留作下一步单独执行，故本条目不记包体积等实测数字。

## 1.5.29（2026-11-11 修复：发布包排除 test/、测试收尾清理残留空目录）

- 环境：DSH-执行智能体（DeepSeek Harness 子会话，模型名未确证）
- git：本版改动就地落在开发/安装目录 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-aiyayi`（该目录**无 .git**，故本版没有自己的 commit）；源码仓 `…\源码\dsh-aiyayi` 本次未纳入。
- 修一（根因修复，坑 #76）：**1.5.28 的测试会在插件目录里造桩包空目录，遮蔽宿主的模块解析。** `test/feishu-accumulate.test.mjs` 为了能 import `lib/feishu.js`，会在插件自己的 `node_modules/` 下 `mkdirSync` 造两个桩包——`@deepseek-ai/dsh-llm`（宿主供给）与 `@larksuiteoapi/node-sdk`；收尾只 `rmSync` 删桩**文件**，**不删造出来的目录**，于是插件目录里留下 `node_modules/@deepseek-ai/dsh-llm/`、`node_modules/@larksuiteoapi/node-sdk/` 以及父包域空目录。线上跑过测试后，宿主对这些包的解析会先撞上插件的空目录 → `aiyayi-feishu` 入口 import 直接 `Cannot find package`（1.5.28 装版后实测）。
  修法：删完桩文件后**逐级向上删空目录**——只删空目录（`removeDirIfEmpty`），遇到非空立刻停（不碰别人的包），且不越过插件自身的 `node_modules`（不删到 profile 之上）。
- 修二（发布包排除开发文件）：`package.json` 的 `files` 白名单**去掉 `test/`**，并补上 `README.md` / `LICENSE`（此前靠 npm 默认规则入包，加白名单后必须显式列出）。1.5.28 的包把整个 `test/` 发了出去：28 个测试文件、占包内 75 个文件的三分之一以上。
- 为什么仍然保留 `test/` 目录本体：测试留在仓库/开发目录里照常跑（`node --test "test/*.test.mjs"`），只是**不进发布包**——发布包里没有测试，就没有"装完包再被测试造空目录"这条链路。
- 为什么保留 `skills/`：运行期真的读——`lib/presence.js` 的 `syncBundledSkills()`（presence.js:1096-1126）在启动时 `readdirSync(join(pkgDir,'skills'))`，把包内技能逐个同步到 `$DSH_HOME/skills`（回退 `~/.dsh/skills`）。删了它，其他用户 npm 装包后 feishu-setup 技能就没了。
- 打包实测（`npm pack --dry-run --json`）：改前 **75 个文件 / 399663 字节**（其中 `test/` 28 个、`lib/` 35 个、`skills/` 6 个）；加白名单后 **47 个文件 / 322038 字节**（`test/` **0** 个、`lib/` 35 个不变、`skills/` 6 个不变）。少 28 个文件、约 77.6 KB。
- 版本号三处对齐：`package.json` version、本条目、profile patch 里 `aiyayi-feishu` 的 `config.reloadTag` 均为 `1.5.29`（reloadTag 语义是"结构性变更触发 HMR 重跑插件"的标记，只要求**值变了**，不参与任何部署值比对，故写版本号即可）。

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
    本版实测经过：先按 `presence-clock.test.mjs` 的老写法（只设 `AIYAYI_HOME`）跑单测，跑完发现真机 `…\记忆\pwsh.json` 被创建，里面 `notifiedAt` 已被写成"提过了"——**等于把用户本该在首次对话看到的那唯一一次提示提前吃掉了**。污染源逐个排查（对 24 个测试文件挨个删掉状态文件后单跑、检查是否重建）只命中 `presence-clock.test.mjs` 一个。
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
    修复：ENOENT 时补「绝对路径兜底探测」——挨个试 `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`、`%ProgramFiles%\PowerShell\7(或 7-preview)\pwsh.exe`、`%ProgramFiles(x86)%\PowerShell\7\pwsh.exe`、以及 `%ProgramFiles%\WindowsApps\Microsoft.PowerShell_*` 包目录，命中即视为已装。真机实测兜底后返回 `{status:'ok', major:7, via:'%USERPROFILE%\AppData\Local\Microsoft\WindowsApps\pwsh.exe'}`，不再误报。
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
  - 仓库全量基线不变：24 个测试文件里仍是 3 个已知失败（`alarm-inject` 硬编码不存在的旧路径 `…\output\...`；`home-relocate`/`tools-surface` 磁盘类型探测断言），与本次改动无关，1.5.21/1.5.22 条目已记录同一基线。
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
  硬编码旧路径（本机盘符前缀，已脱敏）导致 `ERR_MODULE_NOT_FOUND`，与本次改动无关）。
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
> 均已并入本清单末位）；**#73–#76 同样记在版本条目内**（#73 在 1.5.26、#74/#75 在 1.5.28、#76 在 1.5.29）；
> README 正文与各版本条目引用的「坑 #N」即本清单编号。
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
37. **改插件后用 `install_bundle` 重装是空操作，junction 已让源码即时生效（2026-11-07 实测）**：`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-aiyayi` 是 **Junction**（目标 `…\output\dsh-aiyayi-fix`），所以改完源码文件立刻落盘可见、`package.json` 的 version 也是新的；此时 `plugin_manager install_bundle` 返回 `{"application":"failed","error":{"code":"already-installed"}}`。**真正要拦住的是进程**：日志会给 `changed modules keep running their previous code until a restart`，即运行中的模块还是旧代码，必须重启 DSH 才生效。所以"装好了"与"生效了"是两件事——验证时先看日志那句 warn，别拿 install_bundle 的成功与否当判据。

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
56. **宿主 patch 里「新增插件」必须用 `insert:` 包裹；从快照恢复 patch 文件前先验内容（2026-11-10 实测，aiyayi-feishu 桥接中断约半天）**：profile 根 patch（`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`）里新增宿主插件的正确写法是 `- insert:` 块（根级 append）；裸 `- id: aiyayi-feishu / name: ...` 行是 **id-targeted 覆盖**——目标不存在时 loader（cordis-plugin-include `applyPatches`）只 warn `patch: entry "aiyayi-feishu" not found` 并跳过，插件静默不装。危险在于症状延迟：HMR 期间旧实例还在跑（unmanaged-plugin 保留旧代码），一切"看起来正常"；**DSH 重启重建插件树后裸行 no-op，插件直接消失**，飞书长连接断、新会话里 feishu_status 报未配置。本案成因：误把 bundle patch（gh_repo/cordis.patch.yml，只含三个 agent preset）覆盖到 profile 根 patch，再从 recovery 快照（`%USERPROFILE%\.dsh\recovery\<ms>-<uuid>\cordis.patch.yml`）恢复——扫全部 31 份快照，aiyayi-feishu 全是裸行（DSH 快照不保留手工编辑的 `insert:` 语法），照原样恢复＝把 bug 也恢复了。教训：①bundle patch 与 profile 根 patch 是职责不同的两个文件（前者只声明 agent preset、经 package.json `dsh.bundle.patch` 引用，装到 `node_modules\dsh-aiyayi\cordis.patch.yml`；后者做 id 覆盖/禁用/宿主插件 insert），覆盖前先比对 head 注释与 id 集合；②从快照/备份恢复后必须验证关键声明还在（id 清单 + 新增插件有无 `insert:` 包裹）；③判定插件是否真在跑：宿主日志搜插件 id 的「已就绪」/连接建立日志——`patch: entry "X" not found` 与正常加载**可共存**（desktop-shell、mnemon* 的 disable 覆盖行天天 warn 但功能正常），warn 本身不是故障证据，**缺少「已就绪」才是**。

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

77. **宿主 tools.register() 的 JSON Schema 校验只接受单一 type 字符串；type 数组必被 UNSUPPORTED_SCHEMA 拒，且注册失败被逐工具 try/catch 吞成 warn、表面看不出（2026-11-12 实锤；1.5.39 修）**：工具定义的 `parameters` / `output.schema` 里任何属性写 `type: ['integer','null']` 这类**数组**，宿主注册校验直接报 "must be a single type string (type arrays are not supported)"（错误类 UNSUPPORTED_SCHEMA）→ 该工具注册失败。更险的是插件 `apply()` 里逐工具 try/catch（toolkit.js 约 921-927 行）把注册异常吞成 `logger.warn`——**插件照常激活、表面一切正常**，工具就是不出现；1.5.38 的 toolkit 三件套就这么整版注册失败，直到下版排查才发现（1.5.38 全部三个工具实际都没装上）。修法：可空语义一律写单类型 + 字段不进 required + 在 description 注明缺省（如 `exitCode: { type: 'integer', description: '…为 null（缺省）' }`）。排查教训：**别拿"插件激活成功"当"工具注册成功"**——注册是否成功要看注册返回/注册表与运行日志里的 warn；回归防线见 `test/toolkit.test.mjs` 6b 节（复刻宿主校验规则逐层扫 type、守门员自检能抓出 type 数组写法）。

78. **宿主不只校验注册端 schema，也校验「执行输出」；而 `null` ≠ 缺省——条件性返回字段必须与 schema 对齐，否则操作成功、调用方只看到一句校验错误（2026-11-12 实锤；1.5.40 修）**：宿主把工具 `execute` 的返回值拿去跑 `validateJsonSchemaValue(output.schema, value)`（内置 JSON Schema 子集校验器），命中三类违例即判输出非法：①`required` 里的字段缺一个 → `missing required property "value.x"`；②字段存在但类型不符 → `"value.x" must be an integer/string/boolean`——**`null` 算"存在且类型错"，不是缺省**；③`additionalProperties: false` 时多了没声明的键也会违例。1.5.39 把 type 改成单类型后，实现层仍是「条件性返回」（`toolkit_cmd` 的 `truncated` 部分路径不出现、`exitCode` 超时/被拒给 `null`；`toolkit_write` 的 `backupPath` 新建给 `null`；`toolkit_read` 的 `mtime` 探测不到给 `null`），于是**注册全过、一执行就被拒**：`toolkit_cmd` 报 `missing required property 'value.truncated'; 'value.exitCode' must be an integer`，`toolkit_write` 报 `'value.backupPath' must be a string`（`toolkit_read` 因不返回 null 字段而幸免）。最坑的一点是**报错发生在校验环节、底层操作其实已经执行**——write 的目标文件真实写入了 63 字节完整内容，cmd 的命令也跑了只是结果被吞，调用方会把校验失败误当"操作失败"。修法：①**单一出口归一**——三个工具所有返回路径（成功/拒绝/超时/拉不起进程/内部异常）一律先过 `shapeCmdOutput`/`shapeReadOutput`/`shapeWriteOutput`，压成与 `output.schema` 逐字段一致的形状（字段不少、单类型、无额外键），别指望"记得每个分支都填"；②可空语义用**约定值**承担并在 description 写明：`exitCode` 无真实退出码填 **-1**（配合 `ok`/`denied`/`timedOut` 判别）、`backupPath` 未备份填**空串**、`mtime` 探测不到填**空串**、`truncated` 恒 boolean；③`required` 列全 properties（字段恒有值后才敢这么写），留痕 `usage.jsonl` 仍保留 `null` 旧语义不污染统计。教训：**改 schema 必须同步审实现层的每一个返回路径**（grep 该工具所有 `finish()`/`return` 出口），且**可空字段有两种表达法——"不进 required"（1.5.39 口径）与"进 required + 约定值"（本版口径）——混用就是这次翻车**；注册层测试（6b）永远抓不到输出层问题，必须有"真实调用 execute + 逐字段过校验"的回归（6c 节，含守门员自检能复现今天三种真实报错）。排障顺序也变了：**输出校验失败时先核实底层实际效果**（文件在不在、命令有没有副作用），再定论"失败"。

81. **压缩前沉淀（precompact）把系统注入节点当"对话材料"沉淀进记忆库——每会话产出一份 60–71KB 的假"经验文档"（2026-11-13 实锤；1.6.1 修）**：症状是记忆库里凭空多出成批文档，内容整段是 persona 开头（`You are an AI agent…`）与核心记忆、MNEMON 快照，被写成"经验文档"落进 `docs/`；**每个会话一份、每份 60–71KB**，索引跟着涨。根因三层叠加：① **时机A的取材窗口抓在 surface 尾部**（最近 12 条节点），而系统注入节点（persona / 核心记忆 / MNEMON / presence 的 `[时间]`/`[重逢]`/`[闹钟]`/`[状态]`/`[记忆]` / updates / time-context / skill-catalog）**每一步都追加在尾部**——越是刚开始的新会话，尾部的东西越全是注入文本，真实对话根本不在窗口里；② **没有"真有用户说过话"的前置门**，新会话开场（还没有任何真实用户消息）就可能跑到沉淀判定，`judgeSettle` 看到大段文本判 worth；③ **名额先占后判**——`settledThisSession.add(session)` 原来写在 `runPrecompact` 之前，一次误触发（verdict 其实不值得沉淀）就**永久烧掉该会话的自动沉淀名额**，后面真该沉淀时反而没机会了。修法三道，缺一不可：**元数据判据（主防线，抄宿主判据）**——`isRealConversationMessage` 只收 `role==='assistant'` 与 `source.kind==='user'` 的直发文本；宿主侧事实（asar 59643-59645）：user-role 的上下文注入其 `source.kind` 是 `'time-context'`/`'aiyayi-presence'`/`'compact-checkpoint'` 之类，**绝不冒充 `'user'`**（原文 "User-role context injections do not establish a user-created conversation"），所以这一条能一刀切掉绝大多数注入；**缺 `source` 元数据时按"不是真实对话"处理**——宁可漏收，不收垃圾。**特征表兜底（拦主防线拦不住的）**——`isInjectedNodeText`：首行前缀 `You are an AI agent` / `[时间]` / `[重逢]` / `[闹钟]` / `[闹钟·异常]` / `[状态]` / `[记忆]`，正文特征词 `MNEMON` / `〔系统提示·非用户发言〕`；为什么需要这一层：**飞书/微信的引导注入走 `agent.followup`，`source.kind` 也是 `'user'`**（1.5.45 刚踩过同款），压缩后零宽前缀丢失的引导件、以用户身份重现的 persona 文本也一样。**前置门 + 名额后置**——`hasRealUserMessage` 全量扫 surface（不只尾部），一条真实用户消息都没有就直接 return，不做沉淀检查；`settledThisSession` 改为 **verdict 判定 worth / settled 为 true 之后才 add**。教训：**"消息的 role 是 user"不等于"用户说过话"**——注入通道（followup / context injection / checkpoint）全都可以是 user-role，靠 role 判别必然翻车，要看 `source.kind` 与文本特征；另外**别把"扫描窗口"当成"会话内容"**，窗口取尾部而注入永远在尾部，等于窗口天生偏向噪音。
