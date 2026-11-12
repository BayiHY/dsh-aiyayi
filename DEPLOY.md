# 阿依娅伊插件部署指南

## 当前发布状态

| 渠道 | 版本 | 位置 |
|---|---|---|
| npm | **1.5.44**（已发布，latest；2026-11-12T14:30:16Z） | https://www.npmjs.com/package/dsh-aiyayi |
| GitCode | **1.5.44**（commit `0a141c7`，已推） | https://gitcode.com/BayiHY/dsh-aiyayi |
| Gitee | **1.5.44**（commit `0a141c7`，已推） | https://gitee.com/BayiHY/dsh-aiyayi |
| GitHub | **1.5.44**（commit `0a141c7`，SSH 路，已推） | https://github.com/BayiHY/dsh-aiyayi |

本次发版：**1.5.44**（本地工具清单机制：`<记忆根>/toolbox.json` + `toolbox_list` / `toolbox_reload`；包内只留 3 个通用工具 + 2 个清单管理工具）。上一版 **1.5.43**（commit `1039dc8`，2026-11-12T13:13:36Z）是**破坏性变更**（三个私有工具移出工具面），**从 1.5.42 或更早升级的用户必须连读 1.5.43 与 1.5.44 两条 CHANGELOG**。1.5.42 那条历史说明保留在下方。

**1.5.43 待发布台账（2026-11-12 制作）**：`mem_sync` 的 P0/P1 缺陷修复 + **破坏性变更**（`watch_read`/`mem_sync`/`pkg_stats` 三个私有工具移出工具面）。改动 `lib/toolkit.js`（`TOOL_NAMES` 6→3、`builtins` 去掉三工具、`DEFAULT_CONFIG.memPushRemotes` 改 `[]`、`memBranch` 改 `''`）、`lib/toolkit-extra.js`（`resolveMemRemotes`/`resolveMemBranch`/`listRemotes`/`changedLinesOnly`/`scanDiffSensitive` 新增；`untrackedFiles` 前缀扩到 `?? `/`A `/`AM`；私钥正则 `[A-Z0-9 _-]*`；扫描只认 `+`/`-` 变化行；空远端与拿不到分支的守卫前置到 `git add` 之前保证零副作用；`partial` 改 `ok:false` + hint 附 `git remote` 实测远端名）、`lib/own-tools.js`（兜底表删三工具）、`package.json`（1.5.43）、`cordis.patch.yml`（注释标注三工具已移出 + 两个默认值已改）、`README.md`（工具箱表格标注移出）。**实现文件一行没删**（`toolkit-extra.js` / `toolkit-async.js` / `pkg-stats.js` 全在，1.5.44 本地清单复用）。新增 `test/mem-sync-1543.test.mjs` **78 条断言**（`%TEMP%` 沙盘，零副作用用「HEAD 未变 + `.git/index` 字节未变 + bare 远端 `rev-parse --verify HEAD` 失败」三重取证）；全量 **765 项 765 过 0 挂**（1.5.42 基线 698 全过）。profile `cordis.patch.yml` 已备份为 `cordis.patch.yml.bak-20261112-1.5.43`，`reloadTag` 已从 `1.5.42` 改 `1.5.43`（5482→5482 字节、无 BOM），**等李浩重启 DSH 生效**。

**1.5.43 发布台账（2026-11-12 补录，按 registry 实测回填）**：commit `1039dc8`，npm 发布 **2026-11-12T13:13:36Z**（registry `time["1.5.43"]` = `2026-11-12T13:13:36.025Z`，包 `modified` = `2026-11-12T13:13:36.288Z`）。tarball sha1 **`0e0f1a210dff0182227df9a6cfe3fd655e1bba43`**，integrity **`sha512-VO093Yk75qpHBm0e6/UXxPHgacnahQS9/BnkXNbaiwx70McOPsJU1jj3pav2jH35KV1t967N7LApkPhnzjwI2A==`**，`fileCount` **52**（与 1.5.42 同数：实现文件一行没删，只改了 toolkit.js / own-tools.js 的注册面与默认值）、`unpackedSize` 1235932。**`gitHead` 为空**——registry 文档里 1.5.43 条目**没有 `gitHead` 字段**（1.5.41/1.5.42 都有），`_from` 是 `file:dsh-aiyayi-1.5.43.tgz`、`_npmVersion` 11.19.0、`_nodeVersion` 26.7.0：说明那次是从本地 `npm pack` 出的 tgz 直接 `npm publish <tgz>` 的（不是从 git 目录发布），所以 npm 无法记录提交号。**核对结论：git 侧与 npm 侧对不上号只能靠这条台账人工绑定——1.5.43 = commit `1039dc8` 靠三家远端 main 指向确认，不是 registry 自证**。三远端（github/gitee/gitcode）1.5.43 均停在 `1039dc8`。

**1.5.44 发布台账（2026-11-12 制作 / 22:30 发布后回填）**：**本地工具清单机制**。新增 `lib/toolkit-manifest.js`（1022 行）+ `test/toolkit-manifest.test.mjs`（469 行）；改 `lib/toolkit.js`（`TOOL_NAMES` 由 3 项扩到 **5** 项：3 个通用 + `toolbox_list` / `toolbox_reload`；清单工具走 `registerOwnTool(name)` 动态放行）、`lib/own-tools.js`（静态表加两个管理工具）、`package.json`（1.5.44，exports/files 加 `./toolkit-manifest` / `lib/toolkit-manifest.js`）、`README.md`、`cordis.patch.yml`（注释）、三个既有测试的注册面断言。清单文件 `<记忆根>/toolbox.json`（`version:1` + `tools[]`，字段 name/enabled/script/description/timeoutMs/mode/args/env/cwd/params；`mode` 只支持 `"async"`，同步条目直接判校验失败）；**每个清单工具都走 `startDetachedTask`**，调用立刻返回 `{status:'started',taskId}`，跑完 followup 推回会话；失败显式报回（清单 JSON 错带行列、条目校验错带工具名+原因且不影响其他条目、脚本缺失不注册并报回、运行失败/超时带退出码与 stderr 尾部）。`toolbox_list` 只巡检不注册、`toolbox_reload` 注销旧工具按当前文件重注册。

  **发布结果（实测）**：合并方式 `git merge feat/toolbox-manifest` = **fast-forward（1039dc8..52d38e5）**；合并后 `node --test test/*.test.mjs` **39 个测试文件 / tests 167、pass 167、fail 0**。发版 commit **`0a141c7`**（`52d38e5` 之上的文案+台账提交），三远端（github/gitee/gitcode）main 均 = `0a141c7f071087d8877c76f0c079048886ecc961`。npm 发布 **2026-11-12T14:30:16Z**（`time["1.5.44"]` = `2026-11-12T14:30:16.689Z`），`npm publish dsh-aiyayi-1.5.44.tgz --registry=https://registry.npmjs.org/`（本地 tgz 直发，故与 1.5.43 一样**无 `gitHead` 字段**，`_from = file:dsh-aiyayi-1.5.44.tgz`、`_npmVersion 11.19.0`；提交号靠本台账与三家远端人工绑定）。tarball sha1 **`02a5f99ea9318b1fa92faf6115f6b35a3d7a252f`**，integrity **`sha512-VTNJru/VRY4MP+EA8xU4h6J1zbZA56qoL5gTFZsfb8/PclkfdgZyKHg9h0xt3aKf+aCsamYzetHSqaTCb0/4ow==`**，**53 个文件**（比 1.5.43 的 52 个多 1 个，正是 `lib/toolkit-manifest.js`；`test/` 排除）、`unpackedSize` 1302209、package size 466.4 kB。包内容解包实测：`TOOL_NAMES` = `toolkit_cmd/toolkit_read/toolkit_write/toolbox_list/toolbox_reload` 5 项；`mem_sync`/`watch_read`/`pkg_stats` **只在"已移除"注释里**、不在 `TOOL_NAMES` 与 `own-tools.js` 静态表；三个实现文件 `toolkit-extra.js`/`pkg-stats.js`/`toolkit-async.js` **都在包内**；`test/` 0 个文件。

  **profile 装版（实测三路一致）**：`pnpm add dsh-aiyayi@1.5.44 --save-exact --registry=https://registry.npmjs.org/`（用 DSH 自带 pnpm 11.28.5；其默认 registry 本身就是官方源，仍显式带 `--registry`）→ `package.json` 里 `dsh-aiyayi: "1.5.44"`（精确锁死）、`node_modules/dsh-aiyayi` 实测 1.5.44；**`pnpm install` 报 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: protobufjs@7.6.6`（与本包无关的既有依赖，未 approve）**。**53 个文件逐个 SHA256 tar/prof/源码三路比对：0 差异**（profile 53/53 命中、源码仓 53/53 命中、无"包里独有"文件）。**注意一个不可消除的预期差异**：发布后回填台账会改 `CHANGELOG.md`，而 npm 包内那份是**发布时的快照**（registry 上的 1.5.44 已冻结、不可改），所以回填后重跑三路比对时，`CHANGELOG.md` 会成为"源码仓 vs tar"的**唯一差异项**（本次实测正是如此：tar/prof 仍 0 差异，repo 侧差 1 个 `CHANGELOG.md`）；`DEPLOY.md` 不在 `files` 白名单、**不入包**，无此问题。以后比对时遇到这一条差异属正常，别当成装版失败。关键文件 SHA256：`lib/toolkit-manifest.js`=`6CB2375D515868B12C8767B6B55EEF098A1AAF686C1DD760E69A0C5C1E0F07E9`、`lib/toolkit.js`=`BE625C10BB4281A6C44DAEAEC74266520DEABDC2A1B96A86CBD4F14E6073662D`、`lib/own-tools.js`=`7F43B2C162BB78E05C3182D701CCF9218847434F1A58947CC1B158771AD6C62A`、`lib/toolkit-async.js`=`0A583FD2C0C5F5C5AA61416FA814856E249A86DE1556BCA4CF329A4D17322886`、`lib/pkg-stats.js`=`3CAFA598E8DF4DF857395261293FEAB533C3B78067FBC2BD641E04C87DF3EF80`、`lib/toolkit-extra.js`=`D092569A4A13C25C236DD54C5B23802CB262A0EE000B809FF7C9209FD8923B1F`。profile `cordis.patch.yml` 已备份为 `cordis.patch.yml.bak-20261112-1.5.44`，`reloadTag` 已从 `1.5.43` 改 `1.5.44`（5482→5482 字节、无 BOM），**未重启 DSH，等李浩安排**。

**逐版台账（2026-11-12 补录，1.5.42）**：
- **1.5.42**（commit `98ee5f8`）：工具箱加第三个具体工具 **`pkg_stats`**（**同步**，几秒内完成，不用 followup）。`lib/pkg-stats.js`（新增）：查 npm 下载量（`api.npmjs.org/downloads/point/{last-day,last-week,last-month}` 三个窗口**并发**取，`start`/`end` **原样带回**）+ registry 的 `dist-tags.latest` 与 `time[latest]`（直连 `registry.npmjs.org`，**不 shell 调 npm**）+ GitHub / Gitee / GitCode 的 star / fork / watcher / open issues。**三个实测坑写进了返回结构**：① npm 统计的 `end` **滞后约 2 天**，"last-day" 不是今天（实测 2026-11-12 查到的 last-day 是 11-10）——所以必须带回 start/end，否则会被误读成当日实况；② **GitHub API 直连在本机不通**（`fetch failed` / cause `ECONNRESET`），兜底走**第三方代理 `gh-proxy.com`**（会把查询的仓库路径暴露给它、会限流，`github.source` 标 `direct`/`gh-proxy`，可用 `pkgStatsAllowGithubProxy:false` 关掉）；③ **GitCode 无匿名 API**（`gitcode.com/api/v5` 返 400 `private-token, required`；`api.gitcode.com` 返 401，但**不在白名单六条内**故未用），页面上的 star 数是 UI 数字不作接口确证。**Gitee 的 `watchers_count` 是"关注数"**，语义与 GitHub watchers 不同。安全四层：域名白名单**精确主机名匹配**（六条，只 https、URL 不带凭据、非白名单请求根本不发）+ `repo`/`package` 逐段字符校验与 `encodeURIComponent` + 15 秒总预算（单请求 8s、GitHub 直连 4s 快速失败）；**每平台失败隔离**（只写进自己那段 `unavailable`，其余照常返回），全失败也返回合法结构、绝不抛。测试：`test/pkg-stats.test.mjs` **135 条断言**（全 mock fetch）；全量 **165 项 162 过 3 挂**（环境基线同前，零新增失败）。npm 发布 2026-11-12T07:46:35Z，tarball sha1 `9c6dbf5980e233c34f33cb2b0ecbc04c4b1f63d2`，integrity `sha512-fuLDKcHaqCBNo0c013QNkZs9G2GW1/LhjyZoHfsyqX3lzZImtSCF8APeXAMn45p89nnSaEPmCjKL0qiLAwt5Hw==`，**52 个文件**（比 1.5.41 的 51 个多 1 个，正是 `lib/pkg-stats.js`；`test/` 排除、`docs/` 不入包），registry `gitHead=98ee5f8e0c3ed88b8525781655d6264f4852a823`。profile 装版后 `lib/pkg-stats.js` SHA256=`3CAFA598E8DF4DF857395261293FEAB533C3B78067FBC2BD641E04C87DF3EF80`、`lib/toolkit.js`=`DD51ECA6754E6B1E450CED57F0514B2F37C198FB373D1A0253F46E7B09D01E28`、`lib/own-tools.js`=`4D9119690F00A2B967C3322170E1E8088528146BBA6EA3F627EECC7774A33FED`（tar/prof/源码**三路一致**；52 个文件全量比对 51/52，唯一差异 `cordis.patch.yml`）。**本版踩坑留档**：① `assertSafeSegment` 原来 `trim()`，会把 `repo="owner/ name"` **静默改写成 `owner/name`** 发出去（参数静默改写比直接拒更难查）→ 改为不 trim、带内部空白直接拒；② 总预算兜底的 `setTimeout` 原来 `unref()`，当被包的 fetch 永不 resolve 时它是**唯一撑着事件循环的东西**，unref 后 Node 直接退出、单测报 `unsettled top-level await` + **退出码 0**（比失败还难查）→ 有界计时器去掉 unref。**实测提醒（延续上条）**：本次 publish 成功后 registry 同步约 **2.4 分钟**才可见（轮询第 13 次、约 156 秒才 `latest=1.5.42` 且 shasum 匹配），期间 `dist-tags` 仍是 1.5.41、1.5.42 的 `dist.shasum` 查询为空——**不要当失败重发**。

**逐版台账（2026-11-12 补录，1.5.41）**：
- **1.5.41**（commit `6d5448a`）：**Toolbox 真异步能力**。`lib/toolkit-async.js` 新增 `startDetachedTask()`——立刻返回 `{status:'started', taskId}`、`setImmediate` 跑后台、完成后 `exec.agent.followup(createUserMessage({content:[{type:'text',text}], source:{kind:'user'}}))` 注入会话（投递前 `yieldHostPublication()` 让出宿主 publish 宏任务，坑 #68；source 无 undefined，坑 #65）；失败/超时/异常一律投递，task 表可查（不落盘）。`lib/toolkit-extra.js` 新增 `watch_read`（异步，180s 任务级超时杀进程树，关键指标 + 输出末尾推回会话）与 `mem_sync`（同步，`git status --porcelain -z` → `git diff HEAD` + 未跟踪文件敏感扫描 → add/commit → 逐个 push gitee/gitcode master；越界与命中敏感内容一律拒绝）。坑 #79 = 宿主 `await tool.execute(...)` 同步等，长任务必堵且无超时兜底；坑 #80 = `git status --porcelain` 默认 `core.quotepath=true` 把非 ASCII 路径转成八进制转义 → 读不到 → 静默跳过 → 漏扫未跟踪文件（已用 `-c core.quotepath=false` + `--porcelain -z` 修，单测抓住的）。测试：`test/toolkit-async.test.mjs` 128 条断言；全量 **164 项 161 过 3 挂**（环境基线同前）。npm 发布 2026-11-12T07:17:11Z，tarball sha1 `d8c96ead92d69568cac564dcea4cb2e10feea4d4`，integrity `sha512-7ih7JTMf2CXN63VTCZwUKh6RukDBuK3x1nrhJQarVRWaiG623l6911Lzz6S4URdf/JnSRAWMIJ3vrr786S8rLg==`，**51 个文件**（比 1.5.40 的 49 个多 2 个，正是 `lib/toolkit-async.js` + `lib/toolkit-extra.js`；`test/` 排除、`docs/` 不入包），registry `gitHead=6d5448ad53391b8d5c194afec35dd431ec0d2b14`。profile 装版后 `lib/toolkit-async.js` SHA256=`0A583FD2C0C5F5C5AA61416FA814856E249A86DE1556BCA4CF329A4D17322886`、`lib/toolkit-extra.js`=`9A3F44CFB7DE1E1438BB2E40C8FEDEF58495C07563015B887743F5576E7AE3C0`、`lib/toolkit.js`=`A6F0D48FCD071E9F5EE6639BDBE90BFC95046D17576398FCE916B20851B511D5`（tar/prof/源码**三路一致**；51 个文件全量比对 0 diff）。**实测提醒**：publish 成功后 registry 同步约 2.5 分钟才可见（本次轮询第 17 次、约 160 秒才 `latest=1.5.41`），期间 `dist-tags` 仍是 1.5.40 且 `dist.shasum` 查询为空——不要当失败重发。

**逐版台账（2026-11-12 补录，1.5.39 / 1.5.40）**：
- **1.5.39**（commit `eb09344`）：toolkit 三件套注册失败修复（`output.schema` 里 `type` 数组写法被宿主 UNSUPPORTED_SCHEMA 拒，改单类型；坑 #77）+ `feishu_bind` 自动绑定一步接入（不传 chatId 时挑最近活跃 chat 直接绑，旧绑定覆盖不追问；降级仅两种）。npm 发布 2026-11-12T05:08:39Z，tarball sha1 `3ace4af7f26f0263e48b24f8689a22753f7e7d22`，49 个文件（`test/` 排除、`docs/` 不入包）。
- **1.5.40**（commit `68ae1c6`）：toolkit_cmd / toolkit_write 执行输出不符 `output.schema` 的修复。根因：**宿主不只校验注册端 schema，也在工具 execute 的返回值上跑 `validateJsonSchemaValue(output.schema, value)`**，而 `null` **算「存在且类型错」、不等于缺省**；1.5.39 把 type 改单类型后实现层仍是条件性返回（`truncated` 部分路径不出现、`exitCode` 超时/被拒给 `null`、`backupPath` 新建给 `null`、`mtime` 探测不到给 `null`）→ 注册全过、一执行就被拒。修法：新增 `shapeCmdOutput`/`shapeReadOutput`/`shapeWriteOutput` 单一出口归一，可空语义改约定值（`exitCode` 无真实码→`-1`、`backupPath` 未备份→`''`、`mtime` 探测不到→`''`、`truncated` 恒 boolean），required 列全 properties；留痕 `usage.jsonl` 保留 `exitCode=null` 旧语义。npm 发布 2026-11-12T06:24:42Z，tarball sha1 `16dc0be6ae1a06fc1c481b855324792b66d54827`，integrity `sha512-J0ujQuKqTvQopPmWsx90BMgm++/26KiGE4IvbspBvpASob+cbaEOxvazayyjFcYVf++jCxk3FscgUuVZhl3nuw==`，**49 个文件**（`test/` 排除、`docs/` 不入包；与 1.5.39 同文件数）；profile 装版后 `lib/toolkit.js` SHA256=`2CC7CB3A7406387F70347C222D47F59BB967F4490C0D13A36FC51B073E71E5A7`、`lib/index.js`=`5DD7C8334443B274DBEC1362AD56A788F91194A2AEB398031BE335A2D778CC0D`、`lib/feishu.js`=`B3F89A64CF8D9C824A1FD95B47D57C8F6210D8B1E6E6EB748E2241C2F653D36A`、`lib/feishu-logic.js`=`1DA72D7B5588405737B827A5FC1602F2DCC008E838D02DF4D2BC5A77D659A51C`（本次 12 个关键文件 tar/prof/源码**三路全部一致**）。**顺带记一条实测手法**：把宿主校验器从 `app.asar` 按 `//#region lib/types/json-schema.js` 抽出成可加载模块，可对真实 execute 输出做交叉验证（详见 `docs/经验-宿主工具schema校验与feishu_bind自动绑定.md` 4.5 节）。

**发布流程备忘（2026-11-12 实测补充，三条新的事实）**：
1. **凭据确实在用户级 `.npmrc`**（`//registry.npmjs.org/:_authToken=…`，`npm_` 开头的 classic token，值 40 字符；本次核实有效：`npm whoami --registry=https://registry.npmjs.org/` → `bayihy`）——**本文档「发布流程」第 2 步的原有记载准确，无需更改**。真正会误导人的是另一件事：**用户级 `.npmrc` 的默认 `registry` 是 `https://registry.npmmirror.com/`**（镜像），而该 token 只绑定 `//registry.npmjs.org/` 这个 key。于是**不带 `--registry` 时**：`npm whoami` 报 `ENEEDAUTH`、`npm view dsh-aiyayi dist-tags` 查到的是镜像的旧数据（会显示 latest 落后、甚至没有刚发的版本）。**结论：本机所有 npm 查询与发布都必须显式带 `--registry=https://registry.npmjs.org/`**，别用裸 `npm view` / `npm whoami` 判断发布是否成功。
2. **发布后 registry 同步有延迟但不长**：1.5.40 实测 publish 成功（`+ dsh-aiyayi@1.5.40`）后，`npm view dsh-aiyayi@1.5.40 --registry=…` 连续约 2 分钟返回 `E404 No match found for version 1.5.40`、`dist-tags.latest` 仍是 1.5.39；约 2 分钟后一次轮询即返回 `latest=1.5.40` 且 shasum 匹配（`16dc0be6…`）。**看到 E404 别当发布失败重发**（重发会撞「版本已存在」），按 10 秒间隔轮询 `dist-tags.latest` + `dist.shasum` 两个值同时确认即可。
3. **⚠ registry 同步延迟不稳定（2.5 分钟 ~ 5.2 分钟），发布后回查至少等 6 分钟，期间绝不重发**（2026-11-12 第二次撞到，已形成规律）：
   - **1.5.41**：publish → latest 可见约 **2.5 分钟**（轮询第 17 次、约 160 秒）。
   - **1.5.42**：publish → latest 可见约 **2.4 分钟**（轮询第 13 次、约 156 秒）。
   - **1.5.44**：publish（`+ dsh-aiyayi@1.5.44`）→ **前 13 次轮询（约 5 分 11 秒）全部是 `latest=1.5.43` 且 `@1.5.44` 的 `dist.shasum` 查询为空**，第 **14** 次（publish 后 **约 5.2 分钟**）`dist-tags.latest=1.5.44` 与 `dist.shasum=02a5f99e…` 才同时到位。**比前两版慢一倍**。
   - **判据不变**：`dist-tags.latest` 与 `dist.shasum`（对比本地 `npm pack` 的 shasum）**两个值同时对上**才算发布成功；只有其中一个对上（或查询为空/E404）一律视为"还在同步"。
   - **红线**：期间**绝不重发**——重发会撞「版本已存在」，且无法回滚，只会让状态更难判。等满 6 分钟仍双值未到位，再按"记录实测时间 + 报给发版人"处理，不要靠重发试探。

（上一段落是台账截至 1.5.40 时的旧文：「本次发版版：1.5.40（toolkit 执行输出对齐 output.schema，坑 #78）。最近发布：2026-11-12T06:24:42Z，1.5.40；上一版 1.5.39」。1.5.41–1.5.44 的逐版台账见上方「逐版台账」段与 CHANGELOG。以下为截至 1.5.25 的详细台账，原文保留：）
- **1.5.22**（多应用多长连接，commit `1eb6255`）：config 支持 `apps` 数组（旧单 app 格式自动迁移+备份）；每应用独立 WS 长连接互不干扰；chat 归属机制（`chat-owners.json` 落盘 + `GET /im/v1/messages` 成员探测 + 230002 自愈重试）根因消灭「用 A 应用凭证往 B 应用的 chat 发消息」的 230002/400；`feishu_status` 增逐应用状态/chatOwners，`feishu_bind` 绑定前归属探测；messageId 去重防多 bot 重复投递。npm 发布 2026-11-11T04:59:21Z，tarball sha1 `65fcfa85ec3d1254e8394eeb3f5c7e26f0c3bd88`，**41 个文件**（files 数组排除 `skills/feishu-setup/scripts/logs`——此前运行日志会被打进包）；lib/feishu.js SHA256=`C19509A9A7549EF1875CF77E3384B4D74B3718B02AF7D32BD0914841E17A62BE`、lib/feishu-logic.js=`F56E3F198D409E4405C0EF9B22C4ED3E86D564CF2DEFE123176A2A1C4A449348`。
- **1.5.23**（commit `632c38a`）：`feishu_bind` 边界——230001 invalid container_id（chat 不存在/伪造）与 230002 同判 not-member 确定拒绝。npm 发布 2026-11-11T05:13:48Z，sha1 `ca6e7b0ad0d8d35eec88ec012c5dbc91893dfad4`。
- **1.5.24**（commit `c37fb1f`）：修 1.5.23 遗漏 import（`extractFeishuErrorCode` 未导入，probe 抛错即 ReferenceError）；**禁用宿主 `ask_user_question` 选项组件**（`cordis.patch.yml` 两处挂载 `disabled: true`，李浩拍板提问一律纯文本；1.5.18 的飞书点选作答链路随之退役，`tryAnswerByText` 文字兜底保留）。npm 发布 2026-11-11T05:20:36Z，sha1 `8d4e01f18becfc25390bb92fced1630c02a35d2d`。
- **1.5.25**（commit `d6a20a2`，**台账截至时的 latest**）：`extractFeishuErrorCode` 候选链补顶层 `feishuCode`（probe 抛错形状此前不被认出，230001 判定失效）。npm 发布 2026-11-11T05:24:34Z，sha1 `98ae715c91b414c131dd2c26f12f377648bbb000`，41 个文件；lib/feishu.js SHA256=`3F596A8E7741FBCBDB80A014E84300541D4B74DDFE974CC995F336443DF60302`、lib/feishu-logic.js=`AFF5CDAEDDBBFE422F6BE23EACF629B97B2A79665478899A9F1F9274A6398A40`。
- 1.5.23/24/25 的 tarball sha1 均与 `npm view` 官方源核验一致；desktop profile 已装 1.5.25 并跑通装版静态断言（mock ctx + 真实归属探测，ALL PASS）。

（上一版：1.5.21，修飞书回复正文首尾空白行——**无附件标记**路径；主修 `lib/feishu.js` `extractText(message).trim()`、兜底 `lib/feishu-logic.js` `stripAttachmentMarkers(text).trim()`；坑 #72。npm 发布 2026-11-11T02:41:49Z，tarball sha1 `1a228c30f01776f13b1d13710cb82cf9546ae4bf`，**40 个文件**（比 1.5.20 的 39 个多 1 个 `test/feishu-trim.test.mjs`）；lib/feishu.js SHA256=`124DC5947869542C5E626AA6397D1386AF40F0C85584A0A844B48784B64E92F6`、lib/feishu-logic.js=`C08FA889FD54D27C138377A7F8A26324CEB82E644A57F960EBFF6E668EBDAE57`。）
（上一版：1.5.20，飞书正文改走 interactive 卡片 + lark_md——纯文本 `msg_type=text` 不渲染 markdown；含 1.5.19 附件收发与交互卡片、1.5.20 markdown 渲染，及 create-bot v6 权限集中化。npm 发布 2026-11-11T01:26:23Z，tarball sha1 `6f1df9fb81341d6e449ff0d303aa6c07e7f87c39`，39 个文件；lib/feishu-logic.js SHA256=47442E13…、lib/feishu.js=ADBA20BC…。）

**1.5.21 的 commit 口径（2026-11-11 补）**：1.5.21 的原始 commit 是 `d470d3e`（提交信息「1.5.21：修飞书回复正文首尾空白行（无附件标记路径）…坑 #72」），
曾被一次 `git reset --hard 6808132` 丢弃，后由 `git reflog`（`HEAD@{1}: commit: 1.5.21：…`）找回，
以 `git cherry-pick d470d3e` **干净恢复**为仓库 commit **`c2cc1be`**（父提交 `6808132`，无冲突，作者/提交信息/时间戳原样保留）。
四渠道（npm/gitcode/gitee/github）推的都是 `c2cc1be`。仓库 tag 仍只到 v1.5.16，**1.5.21 无 tag**。

**create-bot v6 的版本口径（2026-11-11 补）**：create-bot v6（`skills/feishu-setup/scripts/create-bot.js`，+1201 行）**不属于任何 npm 版本号**——
它是**内置技能脚本**，不是插件本体代码；随 npm 包一起分发（所以 1.5.20 的 tarball 里含 v6），但**没有自己的版本号**。
它在源码仓**单独成 commit `2c16bee`**，与 1.5.20 的插件改动（commit `2de3f46`）互不依赖。
故上表「1.5.20（2c16bee）」表示的是**四渠道推的都是仓库 HEAD `2c16bee`**，不是「create-bot v6 是 1.5.20 的一部分」。

**npm 发布一览（2026-11-12 22:30 实测 registry `dist-tags`，双值核对）**：latest = **1.5.44**（2026-11-12T14:30:16Z 已发布，shasum `02a5f99e…` 与本地 tgz 一致；本表下方 1.5.40 口径是 06:24 时的旧值，按 registry 为准已更新）。
已发布：1.0.0、…、1.5.7、**1.5.14**、**1.5.15**、**1.5.16**、**1.5.17**、**1.5.20**、**1.5.21**、**1.5.22**、**1.5.23**、**1.5.24**、**1.5.25**、**1.5.26**、**1.5.27**、**1.5.28**、**1.5.29**、**1.5.30**、**1.5.31**、**1.5.32**、**1.5.33**、**1.5.34**、**1.5.35**、**1.5.36**、**1.5.37**、**1.5.38**、**1.5.39**、**1.5.40**、**1.5.41**、**1.5.42**、**1.5.43**、**1.5.44**；
跳号 1.3.0、1.4.1、1.4.2、1.5.0、1.5.1、1.5.2、1.5.3、**1.5.8–1.5.13** 从未发布到 npm；
**1.5.18 / 1.5.19 也从未发布到 npm**——它们的代码最终随 1.5.20 一起进 npm。
**版本事实以 npm registry 为准**，本表与 CHANGELOG 顶部「npm 发布一览」保持同一口径。

**git tag 现状（2026-11-11 核对）**：`v1.5.14` 是 **annotated tag**（指向 commit `1aa4774`），`v1.5.15` / `v1.5.16` 是 **lightweight tag**（三种语义混用，历史遗留）；**v1.5.17–v1.5.21 均无 tag**；**v1.5.22（`1eb6255`）、v1.5.23（`632c38a`）、v1.5.24（`c37fb1f`）、v1.5.25（`d6a20a2`）是 2026-11-11 补建的 lightweight tag，三远端已推齐**。
另外 **1.5.19 没有独立 commit**（`git log --all | grep 1.5.19` 为空）——它的代码被**并入 1.5.20 的 commit `2de3f46`** 才进仓库，
**别再去找「1.5.19 的 commit」**，那是不存在的。（1.5.18 有自己的 commit `f115874`，但同样**没有 tag**；
另注：该 commit 的**提交信息**里写的是「#70 上传需 im:resource:upload」，属旧笔误——git 历史不可改，
真名订正见 CHANGELOG 坑 #70 / #71：真名是 `im:resource`。）

**版本对齐说明（2026-11-11）**：npm **1.5.25** 与源码仓 `d6a20a2` 逐字节一致（装进 desktop profile 后实测 `lib/feishu.js`=3F596A8E…、`lib/feishu-logic.js`=AFF5CDAE… 与源码仓 SHA256 相同；1.5.22/1.5.23/1.5.24 各自装版时也做过同样的逐字节核对）。此前 npm 1.5.21 与源码仓 `c2cc1be` 逐字节一致（2026-11-11 实测：`npm pack dsh-aiyayi@1.5.21` 解包后与源码仓逐文件 SHA256 对照——六个文件全部 MATCH）。desktop profile 当前停在 **1.5.25**，等用户重启 DSH 做两条长连接的真连验收。

**GitHub 推送口径（2026-11-09 更正：原"未推/无密钥"记载已过时）**：`~/.ssh/github_ed25519` 密钥已配好可用，github 走 SSH 推送正常（remote `github` = git@github.com:BayiHY/dsh-aiyayi.git）。HTTPS 才是被 SNI 阻断的死路，别试。注意 SSH 只能推已有仓库，**建新仓要走网页或可达网络下的 API**。

**GitCode 认证方式变更（2026-11-09 实测；同日更正 token 记载）**：密码式 git 认证已停用（`remote: The password-based authentication of Git has been removed. Please use your personal access token instead`）。必须用 personal access token，但凭证**不在**用户级环境变量 `GITCODE_TOKEN`——该环境变量实测已不存在（Process/User/Machine 三域及注册表均查无），实际由 **git credential manager** 保存，直接推即可：

```powershell
git push gitcode main   # 凭证由 git credential manager 提供，无需把 token 拼进 URL
```


## 发布流程（维护者用）

发新版按此顺序（2026-11-05 起）：

1. **bump 版本**：改本仓库 `package.json` 的 `version`（**2026-11-09 更正：原记载的 `gh_repo/` 目录与 `publish.mjs` 已不存在**——npm 发布源就是本 git 仓库，1.5.7 即从它手动打包发布；旧 `bundle/` 目录已归档为工作区 `dsh-aiyayi-bundle-1.4.0.zip`，不再维护）。
2. **发布 npm**：在本仓库 `npm pack`（先核对产物文件清单），再 `npm publish dsh-aiyayi-<版本>.tgz --registry=https://registry.npmjs.org/`（凭据在用户级 `.npmrc` 的 `//registry.npmjs.org/:_authToken=`；**2026-11-09 更正：原 `node publish.mjs` 脚本已不存在，改手动两步**）。**⚠️ `--registry` 不能省**（2026-11-12 实测）：同一份 `.npmrc` 的默认 `registry` 指向 `registry.npmmirror.com` 镜像，而 token 只绑 `//registry.npmjs.org/`——不带 `--registry` 时 `npm whoami` 会报 ENEEDAUTH、`npm view` 查到的是镜像旧数据，详见「当前发布状态」段的两条备忘。发布前逐文件 SHA256 对照上一版官方 tarball 确认零漂移，发布后 `npm view dsh-aiyayi version --registry=https://registry.npmjs.org/` 验证（registry 处理有几分钟延迟，轮询即可）。
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
   - **安装方式（2026-11-11 实测，装 1.5.20 时踩到）**：desktop profile 是 **pnpm hoisted workspace**（`pnpm-lock.yaml` lockfileVersion 9.0，`pnpm-workspace.yaml` 写 `nodeLinker: hoisted`），**不要用 `npm i` 装**，会破坏 pnpm 的链接结构。
   - 若系统 `pnpm` / `dsh` 命令本身报 MODULE_NOT_FOUND（当时 DSH 的 shim 指向不存在的 `app.asar\node_modules\pnpm\bin\pnpm.mjs` 与 `lib\desktop-cli.js`），改用 DSH 界面里的插件管理升级；命令行兜底可用 `npx --yes pnpm@10 install`（先在该 profile 的 `package.json` 里把 `dependencies.dsh-aiyayi` 改成精确版本，再在 profile 目录执行），装完确认 `pnpm-lock.yaml` 的 lockfileVersion 仍是 9.0。
   - 校验口径：升级后 `node_modules\dsh-aiyayi\lib\` 的 SHA256 应与官方 tarball 完全一致；若线上代码本就等于目标版，重装只改 `package.json` 的版本号，lib 字节不变。

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
