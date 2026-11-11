#!/usr/bin/env node
/**
 * create-bot.js v6 — 飞书机器人一键创建/验证/补配置脚本
 * （v5 = 2026-11-10 实跑打通全链路；本 v6 在 v5 基础上做「权限/事件/回调集中化 + 幂等 + 日志 + 增量补权限」）
 *
 * 依据请求清单：docs/经验-飞书机器人创建全流程与请求清单.md（工作区）
 * 链路：上传图标 → 创建应用 → 开机器人 → 配权限 → 长连接事件订阅 → 卡片回调 → 建版本 → 提交发布
 *
 * ============================ v6 变更摘要（2026-11-11） ============================
 * 1) 权限清单集中成一处常量 DEFAULT_SCOPES（原先是 PERMS 内联默认值，散落且不好加）。
 * 2) 新增必需权限 im:resource（后台真实标识；「获取与上传图片或文件资源」）。
 *    背景：插件发图片/文件时飞书返回 400 code=99991672，缺的就是这条（CHANGELOG 坑 #70，
 *    实测报告 <记忆根>/feishu/workspaces/.../feishu-scope-grant/报告-权限申请.md）。
 *    ⚠ 后台**不存在** im:resource:upload 这个独立 scope（搜 0 条），im:resource 就是它的等价形态；
 *    脚本用 SCOPE_ALIASES 把 im:resource:upload 归一化成 im:resource 并打日志，避免配权限时找不到 id 直接崩。
 * 3) 新增事件/回调常量：DEFAULT_EVENTS 与 DEFAULT_CALLBACKS，事件名做别名归一化
 *    （im:message.receive_v1 → im.message.receive_v1，冒号/点混写是高频笔误）。
 * 4) card.action.trigger 是**回调**不是事件（后台「事件与回调 → 回调配置」tab；事件弹窗里搜 card 为 0 条）。
 *    新增 ensureCardCallback()：用 CDP 复用已登录 Edge 走「订阅方式→长连接→保存→添加回调→勾选 card.action.trigger」，
 *    已存在则跳过（幂等）。CDP 不可用时不阻断主流程，只记 warn 并在最终汇总里列为「待人工确认」。
 * 5) 幂等：配权限 / 配事件 / 配回调 三步都先读现状再算差集，只补缺的；重复跑不报错。
 * 6) 新增子命令 configure —— 对**已存在**的应用补权限/事件/回调（不动版本、不发布），
 *    这是本次「给 cli_aa79b06a5638dcf4 补 im:resource」的实际用法。
 * 7) 日志：每次运行在脚本同目录 logs/ 下写 create-bot-YYYYMMDD-HHmmss.log（含毫秒时间戳、每步开始/结束/结果）；
 *    失败处打印 http 状态码 + 飞书原始 code/msg + 原始 body 片段。
 * 8) --dry-run：只打印将要做的变更，不发任何写请求。
 * 9) 修 cdpSession 的缺陷：原版在读取 window.csrfToken **之前**就 ws.close()，
 *    导致 Runtime.evaluate 必然超时、每次都退到 httpsGet 兜底（能用但慢 5 秒）。v6 把 close 挪到最后。
 *
 * 人工介入点：
 *   - 扫码登录（v5 新增）：open.feishu.cn 是纯扫码形态（无密码框）。CDP bootstrap 检测到
 *     session cookie 缺失（未登录）时，自动导航登录页并提示「手机飞书扫码」，轮询等待
 *     登录态就绪后继续原链路（默认超时 10 分钟，--login-wait <秒> 可调）。
 *   - 人机验证（若触发风控）：脚本报错停顿并给指引，可用 CDP 在浏览器里手动过验证后重跑；
 *   - 首次发布管理员审核：仅「需审核」企业存在（本企业已验证为免审核，提交发布后自动上线）；
 *     create 提交发布后打印审核入口，用 verify 轮询/确认 appStatus=1。
 *   - 回调 UI 自动化（v6）：若页面结构变动导致点不到按钮，脚本会打印原始 body 文本，回退为人工在后台点一次。
 * 全程 HTTP 直调 open.feishu.cn/developers/v1/...，零依赖（Node 内建 https）。
 *
 * ⚠ 鉴权两个关键点（2026-11-10 实锤，原文档说法已过期）：
 *   1) x-csrf-token 头必须用页面 HTML 内嵌的 window.csrfToken（不是 cookie lark_oapi_csrf_token 的值，
 *      cookie 值已被后端拒绝 → 9499「csrf token check fail」）。
 *   2) Cookie 头必须含 httpOnly 的 session cookie：document.cookie 拿不到，要用 CDP Network.getAllCookies
 *      （缺 session → 99991641「session is invalid」）。
 *   因此默认从 CDP 自动 bootstrap（读 window.csrfToken + getAllCookies 全量 cookie）；
 *   --csrf/--cookie 或环境变量 FEISHU_CSRF/FEISHU_COOKIE 可显式传入（CDP 不可用时）。
 *
 * ⚠ 发布校验「应用图标」必填（2026-11-10 实锤）：
 *   app/create 的 avatar 传空串 → publish/commit 卡在「请先上传应用图标」。正确顺序：
 *   POST /developers/v1/app/upload/image（multipart，字段 file + uploadType=4(Icon) + isIsv=false）
 *   → data.url → 把该 url 作为 app/create 的 avatar。脚本默认自动生成一张 256x256 图标并上传，
 *   也可用 --icon <path> 指定自己的 PNG。
 *
 * 用法：
 *   # 一键（Edge 带 --remote-debugging-port=9222 且 open.feishu.cn 已登录）：
 *   node create-bot.js create --name aiyayi-script-test [--icon <png>] [--desc "..."] [--permissions ...] [--events ...] [--member <open_id>] [--app-version 1.0.0] [--changelog "..."] [--port 9222] [--state <file>]
 *   # 给已存在的应用补权限/事件/回调（v6 新增；不动版本、不发布）：
 *   node create-bot.js configure --app-id cli_xxx [--dry-run] [--skip-callback] [--no-callback-fallback] [--port 9222]
 *   # 给已存在的应用建版本并发布（v6.2 新增；对外动作，必须显式 --yes 才真发）：
 *   node create-bot.js publish --app-id cli_xxx --version 1.0.3 [--changelog "说明"] [--dry-run] [--yes] [--port 9222]
 *
 * 回调配置策略（v6.1）：默认 L0 直调内部 HTTP 接口（永不点 UI）；
 * 失败且属可重试错误才 L1 降级 CDP 点 UI；--no-callback-fallback 可禁用降级。
 * 注意：code 9499（参数校验失败=接口契约可能变了）与 10141（appId 不存在）**不降级**，
 * 因为点 UI 只会把真实问题掩盖掉。
 *   # 显式会话：
 *   node create-bot.js create --name xxx --csrf <window.csrfToken> --cookie "<getAllCookies 拼的整包 cookie 头>"
 *   # 审核后验证：
 *   node create-bot.js verify --app-id cli_xxx [--state <file>]
 *
 * --state 默认写 work/feishu-app-create/state-<name>.json（相对当前工作目录）。
 * 日志默认写 <脚本目录>/logs/create-bot-<时间戳>.log（--log-dir 可改）。
 * 输出：步骤进度打印 + 最终 JSON（appId/versionId）。appSecret 另用 save-secret.js（CDP 读页面）保存，不明文落此脚本输出。
 * 凭证只存本地（work/feishu-app-create/），勿入 git/文档明文。
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const sub = argv[0];
function arg(k) {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : undefined;
}
function flag(k) { return argv.indexOf('--' + k) >= 0; }
const PORT = (() => { const i = argv.indexOf('--port'); return i >= 0 ? parseInt(argv[i + 1], 10) : 9222; })();
let CSRF = arg('csrf') || process.env.FEISHU_CSRF;
let COOKIE = arg('cookie') || process.env.FEISHU_COOKIE;
const UA = arg('ua') || process.env.FEISHU_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0';
const NAME = arg('name');
const DESC = arg('desc') || '脚本自动创建的飞书机器人，用途见应用名。';
const DRY_RUN = flag('dry-run');
const SKIP_CALLBACK = flag('skip-callback');
const SKIP_EVENTS = flag('skip-events');
// v6.1：回调配置默认走「直调 HTTP」，失败才降级 CDP 点 UI；--no-callback-fallback 可禁掉降级（排障用）
const FALLBACK_CDP = !flag('no-callback-fallback');

// ============================================================================
// 权限 / 事件 / 回调清单 —— 以后加东西**只改这里**（v6 集中化）
// ============================================================================

/**
 * 默认应用权限（应用身份 tenant_access_token scope 名）。
 * 顺序与 2026-11-11 实测应用「阿依娅伊」后台一致，注释里的名字是后台中文名，方便人工核对。
 */
const DEFAULT_SCOPES = [
  'im:message',                          // 获取与发送单聊、群组消息（数字 id 20001）
  'im:message:send_as_bot',              // 以应用的身份发消息（1000）——发文本/卡片必需
  'im:chat',                             // 获取与更新群组信息（21001）
  'im:chat:read',                        // 查看群信息（1014181）
  'im:message.p2p_msg:readonly',         // 读取用户发给机器人的单聊消息（3000）
  'im:message.group_at_msg:readonly',    // 获取群组中用户@机器人消息（3001）
  // ↓ v6 新增，发图片/文件（im/v1/images、im/v1/files）必需；缺它飞书回 400 code=99991672
  'im:resource',                         // 获取与上传图片或文件资源（免审）
];

/**
 * scope 别名 → 后台真实标识。
 * 实锤（2026-11-11 报告-权限申请.md）：后台搜 im:resource:upload 为 0 条，
 * 唯一等价形态是 im:resource（关联 API = 上传图片 + 上传文件）。
 * 保留别名是为了让「工单写法 / 旧文档写法」也能直接粘进来跑，不至于 scope/all 里找不到 id 就崩。
 */
const SCOPE_ALIASES = {
  'im:resource:upload': 'im:resource',
  'im:resource:read': 'im:resource',
};

/** 默认事件订阅（长连接）。im.chat.access_event.bot_p2p_chat_entered_v1 供「新会话扫码接入」自动绑定。 */
const DEFAULT_EVENTS = [
  'im.message.receive_v1',                                // 接收消息 v2.0
  'im.chat.access_event.bot_p2p_chat_entered_v1',         // 用户进入与机器人的单聊 v2.0（权限要求=无）
];

/**
 * 事件名别名 → 官方写法。
 * 坑：权限 scope 用冒号分隔（im:message.p2p_msg:readonly），事件用点分隔（im.message.receive_v1），
 * 两者混写是高频笔误；这里归一化并打 warn，别让它静默变成「事件没配上」。
 */
const EVENT_ALIASES = {
  'im:message.receive_v1': 'im.message.receive_v1',
  'im.message.receive': 'im.message.receive_v1',
  'im:chat.access_event.bot_p2p_chat_entered_v1': 'im.chat.access_event.bot_p2p_chat_entered_v1',
  'im.chat.access_event.bot_p2p_chat_entered': 'im.chat.access_event.bot_p2p_chat_entered_v1',
};

/**
 * 默认回调（注意：回调 ≠ 事件，配在「事件与回调 → 回调配置」tab，订阅方式同样走长连接）。
 * card.action.trigger = 卡片回传交互：用户点卡片按钮时推送。
 * 实锤依据：<记忆根>/feishu/workspaces/.../feishu-card-callback/报告-回调配置实测.md
 *   - 后台事件弹窗里搜 card / card.action / trigger 均为 0 条 → 它不是事件；
 *   - 回调 tab 里「添加回调」先灰，必须先配「订阅方式=使用长连接接收回调」并保存才点亮；
 *   - card.action.trigger_v1（旧版）勾选框禁用，只能选新版。
 */
const DEFAULT_CALLBACKS = ['card.action.trigger'];

// ---------- 权限/事件解析 + 归一化 ----------
function normalizeScope(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const mapped = SCOPE_ALIASES[raw];
  if (mapped) {
    logLine('WARN', `权限别名归一化: ${raw} → ${mapped}（后台无 ${raw} 这个独立 scope）`);
    return mapped;
  }
  return raw;
}
function normalizeEvent(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const mapped = EVENT_ALIASES[raw];
  if (mapped) {
    logLine('WARN', `事件名归一化: ${raw} → ${mapped}（事件用点分隔，别跟权限的冒号写法混）`);
    return mapped;
  }
  return raw;
}

// 目标清单在 main() 里 logInit 之后才解析（parseTargets），这样别名归一化的 warn 能落进日志文件。
// 模块顶层就解析的话 LOG_FD 还处于 TDZ，别名 warn 只能打到控制台、丢了文件记录。
let PERMS = [];
let EVENTS = [];
let CALLBACKS = [];
function parseTargets() {
  PERMS = dedupe(
    (arg('permissions') || DEFAULT_SCOPES.join(','))
      .split(',').map(normalizeScope).filter(Boolean),
  );
  EVENTS = dedupe(
    (arg('events') || DEFAULT_EVENTS.join(','))
      .split(',').map(normalizeEvent).filter(Boolean),
  );
  CALLBACKS = dedupe(
    (arg('callbacks') || DEFAULT_CALLBACKS.join(','))
      .split(',').map(s => String(s || '').trim()).filter(Boolean),
  );
  logLine('INFO', `目标权限(${PERMS.length}): ${PERMS.join(',')}`);
  logLine('INFO', `目标事件(${EVENTS.length}): ${EVENTS.join(',')}`);
  logLine('INFO', `目标回调(${CALLBACKS.length}): ${CALLBACKS.join(',')}`);
}
const MEMBER = arg('member') || '7133153336450220036'; // 上次实锤的企业管理员 open_id（巴依浩爷，与 aiyayi-test 同账号），可用 --member 覆盖
const APP_VERSION = arg('app-version') || '1.0.0';
const CHANGELOG = arg('changelog') || '首次发布：机器人能力+消息权限+长连接事件订阅';
const ICON = arg('icon'); // 指定 PNG 路径；缺省自动生成一张 256x256 图标
const APP_ID = arg('app-id');
const STATE_FILE = arg('state') || (NAME ? path.join(process.cwd(), 'work', 'feishu-app-create', 'state-' + NAME + '.json') : null);
// 改造 4：扫码登录等待上限（毫秒）。未登录时脚本导航登录页、提示手机飞书扫码，轮询等待登录态就绪。
const LOGIN_WAIT_MS = arg('login-wait') ? parseInt(arg('login-wait'), 10) * 1000 : 10 * 60 * 1000;

// ---------- 日志（v6 新增：logs/ 下带时间戳，控制台与文件双写） ----------
const LOG_DIR = arg('log-dir') || path.join(__dirname, 'logs');
let LOG_FILE = null;
let LOG_FD = null;
function ts() {
  const d = new Date();
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  // 2026-11-11 06:50:28.123 +08:00（本机时区；只用于日志可读性）
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? '+' : '-';
  const tz = sign + pad(Math.floor(Math.abs(tzMin) / 60)) + ':' + pad(Math.abs(tzMin) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${tz}`;
}
function logInit(tag) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    LOG_FILE = path.join(LOG_DIR, `create-bot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.log`);
    LOG_FD = fs.openSync(LOG_FILE, 'a');
    logLine('INFO', `=== create-bot.js v6 启动 sub=${tag || sub || 'create'} pid=${process.pid} ===`);
    logLine('INFO', `cwd=${process.cwd()} script=${__filename}`);
    logLine('INFO', `node=${process.version} platform=${process.platform}`);
  } catch (e) {
    console.error('日志初始化失败（继续跑，只是不落文件）: ' + e.message);
    LOG_FILE = null; LOG_FD = null;
  }
}
function logLine(level, msg) {
  const line = `[${ts()}] ${String(level).toUpperCase().padEnd(5)} ${msg}`;
  if (level === 'ERROR') console.error(line); else console.log(line);
  if (LOG_FD !== null) {
    try { fs.writeSync(LOG_FD, line + '\n'); } catch (e) { /* 日志写失败不影响主流程 */ }
  }
}
function logError(step, err) {
  logLine('ERROR', `${step} 失败: ${err && err.message ? err.message : String(err)}`);
  if (err && err.raw) logLine('ERROR', `${step} 原始返回: ${String(err.raw).slice(0, 1200)}`);
  if (err && err.stack) {
    logLine('ERROR', `${step} 堆栈: ${String(err.stack).split('\n').slice(0, 6).join(' | ')}`);
  }
}
function dedupe(list) {
  const seen = new Set(); const out = [];
  for (const x of list) { if (!seen.has(x)) { seen.add(x); out.push(x); } }
  return out;
}
function errWithRaw(message, raw) { const e = new Error(message); e.raw = raw; return e; }

/**
 * --dry-run 保护壳：dry-run 下即使「读现状」的请求失败（无登录态、假 appId 等）也不炸，
 * 只记 warn 并返回 fallback，让使用者能看到「本来会做什么」。非 dry-run 照常向上抛。
 */
async function guarded(label, fn, fallback) {
  try { return await fn(); }
  catch (e) {
    if (DRY_RUN) {
      logLine('WARN', `[DRY-RUN] ${label} 读取/执行失败，按「待确认」跳过：${e.message}`);
      return typeof fallback === 'function' ? fallback(e) : fallback;
    }
    throw e;
  }
}

// ---------- CDP（自动 bootstrap 会话） ----------
function withTimeoutPromise(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + ms + 'ms')), ms))]);
}
function httpsGet(pathname, cookie) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST, path: pathname, method: 'GET',
      headers: Object.assign({
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      }, cookie ? { 'Cookie': cookie } : {}),
    }, (res) => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.end();
  });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
async function cdpSession() {
  // 改造 4：优先找已打开的 open.feishu.cn 页面；没有（未登录/未打开）则退而用任意
  // page 作为载体，由下面 ensureLoggedIn 导航到登录页。
  const pages = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const page = pages.find(p => p.type === 'page' && p.url.includes('open.feishu.cn'))
    || pages.find(p => p.type === 'page');
  if (!page) throw new Error(`CDP 没找到可用页面（端口 ${PORT}）——Edge 需带 --remote-debugging-port=${PORT} 打开`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = {};
  const send = (method, params = {}) => new Promise((resolve) => {
    const m = (++id).toString(); pending[m] = resolve;
    ws.send(JSON.stringify({ id: +m, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
  };
  await new Promise((r) => (ws.onopen = r));

  // 全量 cookie（含 httpOnly session —— document.cookie 拿不到；渲染进程卡死时也能拿）
  const readCookies = async () => {
    try {
      const r2 = await send('Network.getAllCookies');
      return (r2.result && r2.result.cookies) || [];
    } catch (e) {
      await send('Network.enable');
      const r2 = await send('Network.getAllCookies');
      return (r2.result && r2.result.cookies) || [];
    }
  };
  let cookies = await readCookies();
  const hasSessionCookie = (list) =>
    list.some(c => /feishu\.cn$/.test(c.domain || '') && c.name === 'session' && c.value);
  let loggedIn = hasSessionCookie(cookies);

  // 改造 4：扫码前置——未登录（无 session cookie）时，导航 open.feishu.cn/app
  // （会被重定向到 accounts.feishu.cn 登录页），提示手机飞书扫码，轮询等待
  // session cookie 出现后继续原链路。零依赖，超时默认 10 分钟（--login-wait N 秒）。
  if (!loggedIn) {
    logLine('INFO', '检测到未登录 open.feishu.cn —— 需要扫码登录（open.feishu.cn 是纯扫码形态，无密码框）');
    logLine('INFO', '  将自动打开登录页；请在手机上用「飞书 app」扫码（或飞书内扫一扫）；');
    logLine('INFO', '  登录成功后脚本自动继续，无需再做任何操作。');
    try { await send('Page.enable'); } catch (e) { /* 忽略 */ }
    await send('Page.navigate', { url: 'https://open.feishu.cn/app' });
    const deadline = Date.now() + LOGIN_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      cookies = await readCookies();
      if (hasSessionCookie(cookies)) { loggedIn = true; break; }
    }
    if (!loggedIn) {
      throw new Error(`等待扫码登录超时（${LOGIN_WAIT_MS / 1000} 秒）。请确认已用手机飞书扫码完成登录，再重新运行脚本。`);
    }
    logLine('INFO', '登录态就绪，继续创建流程。');
  }

  const seen = new Set(); const parts = [];
  for (const c of cookies) {
    if (!/feishu\.cn$/.test(c.domain || '')) continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name); parts.push(c.name + '=' + c.value);
  }
  const cookie = parts.join('; ');
  if (!parts.some(p => p.startsWith('session='))) { ws.close(); throw new Error('CDP 未拿到 httpOnly session cookie（登录态缺失）'); }

  // window.csrfToken（页面 HTML 内嵌，后端接受的 fresh token）
  // 优先 Runtime.evaluate 读页面内存态；渲染进程卡死（Runtime.evaluate 挂起）时回退到
  // Node https GET 页面 HTML 正则提取（2026-11-10 实锤：/app 与 baseinfo 页 HTML 都内嵌）
  // v6 修复：原版在这之前就 ws.close()，导致 Runtime.evaluate 必然超时（白等 5 秒），close 挪到读完 csrf 之后。
  let csrf = null;
  try {
    const r0 = await withTimeoutPromise(send('Runtime.evaluate', { expression: 'window.csrfToken || null', returnByValue: true }), 5000);
    csrf = (r0.result && r0.result.result && r0.result.result.value) || null;
  } catch (e) { csrf = null; }
  if (!csrf) {
    logLine('WARN', 'Runtime.evaluate 取 window.csrfToken 失败/超时 → 回退 httpsGet 页面 HTML 提取');
    try {
      const html = await httpsGet('/app', cookie);
      const m = html.match(/window\.csrfToken\s*=\s*"([^"]+)"/);
      if (m) csrf = m[1];
    } catch (e) { /* 保持 null */ }
  }
  ws.close();
  if (!csrf) throw new Error('CDP 未拿到 window.csrfToken（页面可能没登录/已过期，请刷新 open.feishu.cn）');
  logLine('INFO', `会话 bootstrap 完成（csrf 长度 ${csrf.length}，cookie ${parts.length} 项）`);
  return { csrf, cookie };
}

// ---------- CDP 页面直连（v6 新增：回调 UI 自动化用；独立于 cdpSession，不关用户的标签页） ----------
async function cdpAttachPage(urlIncludes) {
  let pages;
  try { pages = await getJson(`http://127.0.0.1:${PORT}/json/list`); } catch (e) {
    throw new Error(`CDP /json/list 不可达（端口 ${PORT}）: ${e.message}`);
  }
  const cands = pages.filter(p => p.type === 'page' && p.webSocketDebuggerUrl);
  // 只接管「目标应用后台」或「open.feishu.cn 应用首页」这类安全落点；
  // 找不到就新开一个 tab，**绝不**劫持用户正在看的其它标签页（导航 + 点击是不可逆的 UI 副作用）。
  let page = cands.find(p => urlIncludes && p.url.includes(urlIncludes))
    || cands.find(p => /^https:\/\/open\.feishu\.cn\/app\/?$/.test(p.url || ''))
    || null;
  if (!page) {
    const created = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/json/new?https://open.feishu.cn/app', method: 'PUT' }, (res) => {
        let d = ''; res.on('data', c => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      });
      req.on('error', reject); req.end();
    }).catch((e) => { throw new Error(`CDP 新建标签页失败（端口 ${PORT}）: ${e.message}——请先用带 --remote-debugging-port=${PORT} 的 Edge 打开 open.feishu.cn`); });
    logLine('INFO', '[回调] CDP 里没有已打开的后台页，已新建独立标签页: ' + (created && created.id ? created.id : '(unknown)'));
    if (created && created.webSocketDebuggerUrl) page = created;
    else throw new Error('CDP 新建标签页后没拿到 webSocketDebuggerUrl');
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error('cdp timeout: ' + method)); } }, 30000);
  });
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m.id || !pending.has(m.id)) return;
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error).slice(0, 400))); else resolve(m.result);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('cdp ws error')); });
  await send('Page.enable'); await send('Runtime.enable');
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r && r.exceptionDetails) throw errWithRaw('页面 JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r && r.result ? r.result.value : undefined;
  };
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
    await new Promise(r => setTimeout(r, 60));
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  };
  return { ws, send, evalJs, clickAt, close: () => { try { ws.close(); } catch (e) { /* ignore */ } } };
}

// ---------- HTTP ----------
const HOST = 'open.feishu.cn';

// ============================================================================
// v6.2：CSRF 预检 + 9499 重试（实锤根因，见 2026-11-11 抓包报告）
//   抓包证据：56 条 /developers/ 请求里恰好只有失败那条不带 x-csrf-token 头，
//   响应 {"code":9499,"msg":"x-csrf-token not exist in header"}；2.5 秒后原样重发即 200。
//   ⇒ 不是接口抽风，是前端 token 未就绪（页面刚导航完、window.csrfToken 还没填）。
//   ⇒ 遇到 9499 应当**等一会重试**，绝不能降级成「整批 add」（那会丢掉幂等性且掩盖真实问题）。
// ============================================================================
const CSRF_EXPECT_LEN = 88;          // 实测 token 固定 88 字符
const CSRF_WAIT_MAX_MS = 3000;       // 发请求前等 token 就绪的上限
const RETRY_9499_DELAY_MS = 1500;    // 撞 9499 后原样重试的等待

function csrfLooksReady() {
  return typeof CSRF === 'string' && CSRF.length >= CSRF_EXPECT_LEN;
}

/** 判断一次失败是不是「CSRF 未就绪」这一类（可重试），而不是接口契约变了。 */
function isCsrfNotReady(status, json, raw) {
  if (json && json.code === 9499) {
    const msg = String(json.msg || '');
    // 只有明确和 csrf 相关的 9499 才当「未就绪」；其它 9499 是参数校验失败，重试没意义
    if (/csrf/i.test(msg) || /x-csrf-token/i.test(String(raw || ''))) return true;
  }
  return false;
}

/** 从请求失败的 Error 上判断是否属于 csrf 未就绪（供「读现状」处决定要不要降级）。 */
function isCsrfError(err) {
  if (!err) return false;
  const s = String(err.message || '') + ' ' + String(err.raw || '');
  return /code=9499/.test(s) && /csrf|x-csrf-token/i.test(s);
}

/**
 * 确保 CSRF 就绪：为空/过短时从 CDP 重新 bootstrap，最多等 CSRF_WAIT_MAX_MS。
 * 拿不到也不阻断（后续请求会自己撞 9499 再重试），只记 warn。
 */
async function ensureCsrfReady(label) {
  if (csrfLooksReady()) return true;
  logLine('WARN', `csrf 未就绪（长度 ${CSRF ? CSRF.length : 0}，期望 ${CSRF_EXPECT_LEN}）——${label || '请求'}前尝试重新获取，最多等 ${CSRF_WAIT_MAX_MS}ms`);
  const deadline = Date.now() + CSRF_WAIT_MAX_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const s = await cdpSession();
      if (s && s.csrf) {
        CSRF = s.csrf;
        if (!COOKIE && s.cookie) COOKIE = s.cookie;
        if (csrfLooksReady()) {
          logLine('INFO', `csrf 已就绪（第 ${attempt} 次获取，长度 ${CSRF.length}）`);
          return true;
        }
      }
    } catch (e) {
      logLine('WARN', `csrf 重新获取失败（第 ${attempt} 次）: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  logLine('WARN', `csrf 等待 ${CSRF_WAIT_MAX_MS}ms 仍未就绪（长度 ${CSRF ? CSRF.length : 0}），继续尝试发送`);
  return false;
}

/** 单次 POST（不重试）。 */
function postOnce(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = https.request({
      host: HOST, path: pathname, method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-csrf-token': CSRF,
        'Referer': 'https://open.feishu.cn/app',
        'Origin': 'https://open.feishu.cn',
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      }, COOKIE ? { 'Cookie': COOKIE } : {}),
    }, (res) => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d), raw: d }); }
        catch (e) { reject(errWithRaw('bad json: ' + d.slice(0, 400), d)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * POST 统一入口（v6.2）：发前确保 csrf 就绪；撞 9499 且 msg 含 csrf 时等 1.5s 原样重试一次。
 * 重试后仍是 9499 就把失败结果原样返回（由 ok() 报错退出），**不降级**。
 */
async function post(pathname, body) {
  await ensureCsrfReady(pathname);
  let r = await postOnce(pathname, body);
  if (r.status !== 200 || !r.json || r.json.code !== 0) {
    if (isCsrfNotReady(r.status, r.json, r.raw)) {
      logLine('WARN', `csrf 未就绪，重试第 1 次：${pathname}（等 ${RETRY_9499_DELAY_MS}ms 后原样重发）`);
      await new Promise(res => setTimeout(res, RETRY_9499_DELAY_MS));
      await ensureCsrfReady(pathname + '（9499 重试前）');
      const r2 = await postOnce(pathname, body);
      if (r2.status === 200 && r2.json && r2.json.code === 0) {
        logLine('INFO', `csrf 重试成功：${pathname}`);
      } else if (isCsrfNotReady(r2.status, r2.json, r2.raw)) {
        logLine('ERROR', `csrf 未就绪，重试第 1 次仍失败（不再重试、不降级）：${pathname}`);
      }
      r = r2;
    }
  }
  return r;
}
function humanPauseReason(json) {
  const msg = (json && (json.msg || '')) || '';
  if (json && json.code === 9499 && /csrf/i.test(msg)) {
    return 'CSRF 未就绪（code 9499，msg="' + msg + '"）：脚本已自动等 1.5s 重试一次仍失败——' +
      '请刷新 open.feishu.cn 页面（让 window.csrfToken 更新）后重跑（脚本会从 CDP 重取）';
  }
  if (json && json.code === 9499) return '参数校验失败（code 9499，msg="' + msg + '"）：接口契约可能变了，请对照抓包核对 body 字段';
  if (json && json.code === 99991641) return 'session 失效（code 99991641）：浏览器登录态过期，重新登录 open.feishu.cn 后重跑';
  if (json && json.code === 99991672) return '缺 im:resource 权限（code 99991672）：本脚本 configure 子命令会自动补，或后台手工开通后重新发布版本';
  if (/验证|风控|频繁|captcha|slide/i.test(msg)) return '疑似人机验证/风控触发（msg=' + msg + '）：请李浩在浏览器里手动完成验证后重跑';
  return null;
}

// ---------- 图标：自动生成 + multipart 上传 ----------
function generateIcon(filePath) {
  // 256x256 RGBA PNG（蓝底白圆黑眼睛，示意机器人），零依赖 zlib
  const zlib = require('zlib');
  const W = 256, H = 256;
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    const rowStart = y * (1 + W * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < W; x++) {
      const p = rowStart + 1 + x * 4;
      const dx = x - 128, dy = y - 128;
      const inCircle = (dx * dx + dy * dy) <= 60 * 60;
      const inEyeL = ((x - 90) ** 2 + (y - 90) ** 2) <= 18 * 18;
      const inEyeR = ((x - 166) ** 2 + (y - 90) ** 2) <= 18 * 18;
      if (inCircle && !inEyeL && !inEyeR) { raw[p] = 255; raw[p + 1] = 255; raw[p + 2] = 255; raw[p + 3] = 255; }
      else if (inEyeL || inEyeR) { raw[p] = 0; raw[p + 1] = 0; raw[p + 2] = 0; raw[p + 3] = 255; }
      else { raw[p] = 0x3D; raw[p + 1] = 0x7E; raw[p + 2] = 0xFF; raw[p + 3] = 255; }
    }
  }
  const idat = zlib.deflateSync(raw);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crcTable = (() => {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
      return t;
    })();
    let crc = 0xFFFFFFFF;
    for (const b of Buffer.concat([typeBuf, data])) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    crcBuf.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
  return filePath;
}
function postUpload(pathname, filePath) {
  // multipart: file + uploadType=4(Icon) + isIsv=false（2026-11-10 实锤字段；之前漏 uploadType → 9499 Bad Request）
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2, 14);
    const head = '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="icon.png"\r\nContent-Type: image/png\r\n\r\n';
    const tail = '\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="uploadType"\r\n\r\n4\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="isIsv"\r\n\r\nfalse\r\n--' + boundary + '--\r\n';
    const body = Buffer.concat([Buffer.from(head), fs.readFileSync(filePath), Buffer.from(tail)]);
    const req = https.request({
      host: HOST, path: pathname, method: 'POST',
      headers: Object.assign({
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
        'x-csrf-token': CSRF,
        'Referer': 'https://open.feishu.cn/app',
        'Origin': 'https://open.feishu.cn',
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      }, COOKIE ? { 'Cookie': COOKIE } : {}),
    }, (res) => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d), raw: d }); }
        catch (e) { reject(errWithRaw('bad json: ' + d.slice(0, 400), d)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
async function uploadIcon() {
  // 返回 avatar url；缺 --icon 时自动生成
  let iconPath = ICON;
  if (!iconPath || !fs.existsSync(iconPath)) {
    iconPath = path.join(process.cwd(), 'work', 'feishu-app-create', 'icon-' + NAME + '.png');
    generateIcon(iconPath);
    logLine('INFO', '自动生成图标 -> ' + iconPath + (ICON ? '（--icon 指定路径无效，已回退自动生成）' : ''));
  }
  const { status, json, raw } = await postUpload('/developers/v1/app/upload/image', iconPath);
  if (status !== 200 || !json || json.code !== 0) {
    throw errWithRaw(`上传图标失败 /developers/v1/app/upload/image: http=${status} code=${json && json.code} msg=${json && json.msg}`, raw);
  }
  const url = (json.data && (json.data.url || (json.data.urls && json.data.urls[0]))) || null;
  if (!url) throw errWithRaw('上传图标成功但未返回 url: ' + JSON.stringify(json.data), raw);
  logLine('INFO', '图标已上传 -> ' + url.slice(0, 80) + '...');
  return url;
}
async function ok(pathname, body, step) {
  const t0 = Date.now();
  logLine('INFO', `→ ${step} POST ${pathname} body=${JSON.stringify(body || {}).slice(0, 600)}`);
  const { status, json, raw } = await post(pathname, body);
  const ms = Date.now() - t0;
  if (status !== 200 || !json || json.code !== 0) {
    // dry-run 下这些读现状的失败是被刻意容忍的，用 WARN 以免误读成「脚本坏了」
    const lvl = DRY_RUN ? 'WARN' : 'ERROR';
    logLine(lvl, `← ${step} 失败 http=${status} code=${json && json.code} msg=${json && json.msg} (${ms}ms)`);
    logLine(lvl, `← ${step} 原始返回(${String(raw || '').length}B): ${String(raw || '').slice(0, 1200)}`);
    const pause = humanPauseReason(json);
    if (pause) logLine('WARN', `人工介入点：${pause}`);
    throw errWithRaw(`${step} 失败 ${pathname}: http=${status} code=${json && json.code} msg=${json && json.msg}` + (pause ? `\n⏸ 人工介入点：${pause}` : ''), raw);
  }
  logLine('INFO', `← ${step} ok code=0 (${ms}ms)`);
  return json;
}
async function okGet(pathname, step) {
  // developers/v1 的查询接口，脚本沿用 POST 体 {}（与 v5 一致，实测可用）
  return await ok(pathname, {}, step);
}

// ---------- 工具 ----------
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveState(patch) {
  if (!STATE_FILE) return;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const st = Object.assign(loadState(), patch, { at: new Date().toISOString() });
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2), 'utf8');
  logLine('INFO', 'state -> ' + STATE_FILE);
}

// ============================================================================
// v6：幂等的「配权限 / 配事件 / 配回调」三段式（create 与 configure 共用）
// ============================================================================

/** 读已开通权限名列表（scope/applied）。失败返回 null（调用方据此降级为「直接 add」）。
 *  v6.2 例外：如果是 CSRF 未就绪（9499）重试仍失败，**不降级**而是向上抛 ——
 *  降级成「整批 add」会丢掉幂等性，还会把「token 没就绪」这个真问题掩盖掉。 */
async function readGrantedScopes(appId) {
  try {
    const r = await okGet(`/developers/v1/scope/applied/${appId}`, '读取已开通权限');
    return ((r.data && r.data.scopes) || []).map(s => s.name).filter(Boolean);
  } catch (e) {
    if (isCsrfError(e)) {
      logLine('ERROR', '读取已开通权限失败，且原因是 CSRF 未就绪（重试仍 9499）——不降级「整批 add」，直接报错退出');
      throw e;
    }
    logLine('WARN', '读取已开通权限失败（将退回「整批 add」策略，幂等性降低）: ' + e.message);
    return null;
  }
}

/**
 * 幂等配权限：算出「想要但还没有」的差集，只 add 差集；全齐则跳过。
 * @returns {Promise<{added:string[], skipped:string[], ids:string[]}>}
 */
async function ensureScopes(appId, wanted) {
  logLine('INFO', `[权限] 目标 ${wanted.length} 项: ${wanted.join(',')}`);
  const granted = await readGrantedScopes(appId);
  let missing = wanted.slice();
  const skipped = [];
  if (granted) {
    logLine('INFO', `[权限] 当前已开通 ${granted.length} 项: ${granted.join(',') || '(空)'}`);
    missing = wanted.filter(s => !granted.includes(s));
    skipped.push(...wanted.filter(s => granted.includes(s)));
    logLine('INFO', `[权限] 已存在跳过 ${skipped.length} 项${skipped.length ? ': ' + skipped.join(',') : ''}`);
    if (missing.length === 0) {
      logLine('INFO', '[权限] 全部已开通，无需变更（幂等跳过）');
      return { added: [], skipped, ids: [] };
    }
  }
  logLine('INFO', `[权限] 待新增 ${missing.length} 项: ${missing.join(',')}`);

  // scope/all 才有数字 id（scope/search、scope/relation 都不给 id）
  const scopeAll = await guarded('查权限目录', () => okGet(`/developers/v1/scope/all/${appId}`, '查权限目录'), null);
  if (!scopeAll) {
    logLine('WARN', '[DRY-RUN] 拿不到权限目录，无法解析数字 id；以下为「待新增」清单，实际 id 需联网解析: ' + missing.join(','));
    logLine('INFO', `[DRY-RUN] 将 POST /developers/v1/scope/update/${appId} (operation=add, scopes=${missing.join(',')})`);
    return { added: missing, skipped, ids: [] };
  }
  const scopes = (scopeAll.data && scopeAll.data.scopes) || [];
  const idMap = {}; scopes.forEach(s => { idMap[s.name] = String(s.id); });
  logLine('INFO', `[权限] 目录共 ${scopes.length} 条`);
  const notFound = missing.filter(p => !idMap[p]);
  if (notFound.length) {
    throw errWithRaw('以下权限在 scope/all 目录中找不到（多半是名字写错或该权限不适用于自建应用）: ' + notFound.join(', ') +
      '\n提示：后台没有 im:resource:upload 这个独立 scope，正确写法是 im:resource（脚本已做别名归一化）。',
      scopeAll.raw);
  }
  const ids = missing.map(p => idMap[p]);
  if (DRY_RUN) {
    logLine('INFO', `[DRY-RUN] 将 POST /developers/v1/scope/update/${appId} appScopeIDs=[${ids.join(',')}] operation=add`);
    return { added: missing, skipped, ids };
  }
  await ok(`/developers/v1/scope/update/${appId}`, {
    appScopeIDs: ids, userScopeIDs: [], scopeIds: [], operation: 'add', isDeveloperPanel: true,
  }, '添加权限');

  // 复核
  const after = await readGrantedScopes(appId);
  if (after) {
    const stillMissing = wanted.filter(s => !after.includes(s));
    if (stillMissing.length) {
      logLine('WARN', `[权限] add 成功但复核仍有缺失: ${stillMissing.join(',')}（可能需要重新发布版本或稍等生效）`);
    } else {
      logLine('INFO', '[权限] 复核通过，目标权限全部已开通');
    }
  }
  return { added: missing, skipped, ids };
}

/** 读当前已订阅事件名（event/{appId}?needEventDetail）。失败返回 null。 */
async function readSubscribedEvents(appId) {
  try {
    const r = await ok(`/developers/v1/event/${appId}`, { needEventDetail: true }, '读取事件订阅');
    const d = (r.data && r.data) || {};
    const names = [];
    for (const biz of (d.appEventDetails || [])) {
      for (const it of (biz.items || [])) if (it.id) names.push(it.id);
    }
    for (const ev of (d.events || [])) if (ev && ev.id) names.push(ev.id);
    for (const ev of (d.appEvents || [])) if (typeof ev === 'string') names.push(ev);
    return { names: dedupe(names), eventMode: d.eventMode, raw: r.raw };
  } catch (e) {
    // v6.2：CSRF 未就绪不降级（理由同 readGrantedScopes）
    if (isCsrfError(e)) {
      logLine('ERROR', '读取事件订阅失败，且原因是 CSRF 未就绪（重试仍 9499）——不降级「整批 add」，直接报错退出');
      throw e;
    }
    logLine('WARN', '读取事件订阅失败（将退回「整批 add」策略）: ' + e.message);
    return null;
  }
}

/** 幂等配事件（长连接）：先切 eventMode=4，再只补缺的事件。 */
async function ensureEvents(appId, wanted) {
  logLine('INFO', `[事件] 目标 ${wanted.length} 项: ${wanted.join(',')}`);
  const cur = await readSubscribedEvents(appId);
  let missing = wanted.slice();
  if (cur) {
    logLine('INFO', `[事件] 当前已订阅 ${cur.names.length} 项: ${cur.names.join(',') || '(空)'}；eventMode=${cur.eventMode}`);
    missing = wanted.filter(e => !cur.names.includes(e));
    if (cur.eventMode === 4 && missing.length === 0) {
      logLine('INFO', '[事件] 已是长连接且事件齐全，无需变更（幂等跳过）');
      return { added: [], skipped: wanted.slice() };
    }
  }
  logLine('INFO', `[事件] 待新增 ${missing.length} 项: ${missing.join(',') || '(无，仅校正订阅方式)'}`);
  if (DRY_RUN) {
    logLine('INFO', `[DRY-RUN] 将 POST /developers/v1/event/switch/${appId} {eventMode:4} 然后 event/update add=[${missing.join(',')}]`);
    return { added: missing, skipped: wanted.filter(w => !missing.includes(w)) };
  }
  // 顺序不能反：先切长连接再添加事件（v5 实锤）
  await ok(`/developers/v1/event/switch/${appId}`, { eventMode: 4 }, '切长连接');
  if (missing.length === 0) return { added: [], skipped: wanted.slice() };
  await ok(`/developers/v1/event/update/${appId}`, {
    operation: 'add', events: [], appEvents: missing, userEvents: [], eventMode: 4,
  }, '添加事件');
  const after = await readSubscribedEvents(appId);
  if (after) {
    const still = missing.filter(e => !after.names.includes(e));
    if (still.length) logLine('WARN', `[事件] add 成功但复核仍缺: ${still.join(',')}`);
    else logLine('INFO', '[事件] 复核通过');
  }
  return { added: missing, skipped: wanted.filter(w => !missing.includes(w)) };
}

/**
 * v6.1：幂等配卡片回调 card.action.trigger —— 三层策略
 *   L0 直调 HTTP（默认，见 ensureCardCallbackViaHttp）
 *   L1 降级 CDP 点 UI（见 ensureCardCallbackViaUi，v6 原始实现原样保留）
 *   L2 都不抛（除非 --require-callback），只记 warn + 返回 status
 * --skip-callback 跳过、--no-callback-fallback 禁掉 L1。
 * @returns {Promise<{status:'present'|'configured'|'skipped'|'failed', detail?:string, via?:string}>}
 */
async function ensureCardCallback(appId, wanted) {
  const want = wanted && wanted.length ? wanted : DEFAULT_CALLBACKS;
  logLine('INFO', `[回调] 目标 ${want.length} 项: ${want.join(',')}（回调 ≠ 事件，配在「回调配置」tab）`);
  if (SKIP_CALLBACK) { logLine('WARN', '[回调] --skip-callback，跳过'); return { status: 'skipped', detail: '--skip-callback' }; }
  if (DRY_RUN) { logLine('INFO', `[DRY-RUN] 将检查/配置回调 ${want.join(',')}`); return { status: 'skipped', detail: 'dry-run' }; }

  // ---- L0：直调 HTTP ----
  const httpRes = await ensureCardCallbackViaHttp(appId, want).catch(e => ({ status: 'failed', detail: '直调异常: ' + e.message, retryable: true }));
  if (httpRes.status !== 'failed') return Object.assign(httpRes, { via: 'http' });

  // 不可重试的失败：直调明确判定为「契约变了 / appId 有问题」，降级点 UI 只会掩盖问题
  if (!httpRes.retryable) {
    logLine('ERROR', '[回调] 直调失败且不可重试：' + httpRes.detail);
    logLine('ERROR', '[回调] 不降级 CDP —— 点 UI 会把真实问题掩盖掉，请先按上面的提示排查');
    return { status: 'failed', detail: httpRes.detail, via: 'http' };
  }

  if (!FALLBACK_CDP) {
    logLine('WARN', '[回调] 直调失败(' + httpRes.detail + ')，且 --no-callback-fallback 已禁用降级');
    return { status: 'failed', detail: httpRes.detail, via: 'http' };
  }

  // ---- L1：降级 CDP 点 UI ----
  logLine('WARN', '[回调] 直调失败(' + httpRes.detail + ')，降级 CDP 点 UI');
  try {
    const uiRes = await ensureCardCallbackViaUi(appId, want);
    return Object.assign(uiRes, { via: 'cdp-fallback' });
  } catch (e) {
    // ---- L2：不阻断主流程 ----
    logLine('WARN', '[回调] CDP 降级也失败，待人工确认: ' + e.message);
    return { status: 'failed', detail: e.message, via: 'cdp-fallback' };
  }
}

// ============================================================================
// v6.1 L0：直调 HTTP 配回调（替代 CDP 点 UI）
// 接口来源：capture\报告-回调接口.md（实测抓包）+ capture\改造建议.md（探针封口）
//   读配置      POST /developers/v1/callback/{appId}        -> {callbackMode, callbacks[]}
//   改订阅方式  POST /developers/v1/callback/switch/{appId} -> {callbackMode}
//   增删回调    POST /developers/v1/callback/update/{appId} -> {operation:'add'|'del', callbackMode, callbacks[]}
//
// ⚠️ 关键坑（2026-11-11 探针实证，见 capture\probe-results*.json）：
//   服务端**不校验 callbackMode 的枚举范围** —— 传 99 也能通过参数校验（返回 10141 而非 9499），
//   写错值不会报错，只会把订阅方式静默写坏。因此这里必须用常量 CALLBACK_MODE_LONG_CONN=4，并在写前 assert。
// ============================================================================

/** 回调订阅方式枚举（bundle module 19573 导出 tZ，实测响应 callbackMode=4 与 UI「长连接」互证） */
const CALLBACK_MODE = Object.freeze({ WEBHOOK: 1, APAAS_CLOUD_FUNCTION: 3, LONG_CONN: 4 });
const CALLBACK_MODE_LONG_CONN = CALLBACK_MODE.LONG_CONN;
const CALLBACK_MODE_VALID = Object.values(CALLBACK_MODE);

/** 直调失败分类用的错误码（探针实证的两个「不该降级」的分界码） */
const CB_CODE_BAD_REQUEST = 9499;   // 参数校验层失败 -> 接口契约可能变了
const CB_CODE_NOT_FOUND = 10141;    // 已过参数校验，业务层失败 -> 对象(appId)不存在

/** 写前硬约束：回调订阅方式只能是合法枚举，且本函数只允许写长连接 */
function assertCallbackMode(mode, where) {
  if (!CALLBACK_MODE_VALID.includes(mode)) {
    throw new Error(`[回调] ${where} 非法 callbackMode=${mode}（合法值 ${CALLBACK_MODE_VALID.join('/')}）——` +
      '服务端不校验枚举范围，写错会静默写坏配置，已阻止');
  }
  if (mode !== CALLBACK_MODE_LONG_CONN) {
    throw new Error(`[回调] ${where} 本脚本只允许写长连接(${CALLBACK_MODE_LONG_CONN})，拒绝写 ${mode}`);
  }
}

/** 直调读回调配置。成功返回 {callbackMode, callbacks}，失败抛带 code 的错。 */
async function cbRead(appId) {
  const r = await post(`/developers/v1/callback/${appId}`, {});
  if (r.status !== 200 || !r.json || r.json.code !== 0) {
    const e = errWithRaw(`读回调配置失败 http=${r.status} code=${r.json && r.json.code} msg=${r.json && r.json.msg}`, r.raw);
    e.code = r.json && r.json.code;
    throw e;
  }
  const d = r.json.data || {};
  return { callbackMode: d.callbackMode, callbacks: Array.isArray(d.callbacks) ? d.callbacks : [] };
}

/**
 * v6.1 L0 主体：读 → 已满足则返回 → 非长连接才 switch → 只补缺失的回调 → 读回复核。
 * 返回 status='failed' 时带 retryable 标记，供上层决定要不要降级 CDP：
 *   retryable=false  -> 9499（契约可能变了）或 10141（appId 本身有问题），不该偷偷退回点 UI
 *   retryable=true   -> 网络异常/未知错误码，可以降级
 */
async function ensureCardCallbackViaHttp(appId, want) {
  logLine('INFO', '[回调] L0 直调 HTTP: 读取当前配置…');

  // ---- 1) 读 ----
  let cur;
  try {
    cur = await cbRead(appId);
  } catch (e) {
    const code = e.code;
    if (code === CB_CODE_NOT_FOUND) {
      return { status: 'failed', retryable: false, detail: `appId 本身有问题（code ${CB_CODE_NOT_FOUND}）：${appId} 不存在或无权限，请核对 appId` };
    }
    if (code === CB_CODE_BAD_REQUEST) {
      return { status: 'failed', retryable: false, detail: `接口契约可能已变更（code ${CB_CODE_BAD_REQUEST} 参数校验失败）：回调读接口不接受当前请求，需重新抓包核对` };
    }
    return { status: 'failed', retryable: true, detail: e.message };
  }

  const have = cur.callbacks;
  const mode = cur.callbackMode;
  logLine('INFO', `[回调] 当前 callbackMode=${mode}，已订阅 [${have.join(',') || '空'}]`);

  // ---- 2) 幂等：已满足直接返回 ----
  if (mode === CALLBACK_MODE_LONG_CONN && want.every(x => have.includes(x))) {
    logLine('INFO', '[回调] 已是长连接且目标回调均已订阅，无需变更');
    return { status: 'present' };
  }

  // ---- 3) 非长连接才改订阅方式 ----
  if (mode !== CALLBACK_MODE_LONG_CONN) {
    const target = CALLBACK_MODE_LONG_CONN;
    assertCallbackMode(target, 'switchCallback 写前');   // 硬约束：只写 4
    logLine('INFO', `[回调] 订阅方式 ${mode} → ${target}（长连接）`);
    const r = await post(`/developers/v1/callback/switch/${appId}`, { callbackMode: target });
    const code = r.json && r.json.code;
    if (r.status !== 200 || code !== 0) {
      if (code === CB_CODE_BAD_REQUEST) {
        return { status: 'failed', retryable: false, detail: `接口契约可能已变更（switch code ${CB_CODE_BAD_REQUEST} 参数校验失败），需重新抓包核对` };
      }
      if (code === CB_CODE_NOT_FOUND) {
        return { status: 'failed', retryable: false, detail: `appId 本身有问题（switch code ${CB_CODE_NOT_FOUND}）` };
      }
      return { status: 'failed', retryable: true, detail: `设置长连接失败 http=${r.status} code=${code} msg=${r.json && r.json.msg}` };
    }
    logLine('INFO', '[回调] 订阅方式已设为长连接(callbackMode=4)');
  }

  // ---- 4) 只补缺失的回调（增量，非全量覆盖）----
  const missing = want.filter(x => !have.includes(x));
  if (missing.length) {
    assertCallbackMode(CALLBACK_MODE_LONG_CONN, 'updateCallback 写前');
    logLine('INFO', `[回调] 增量添加: ${missing.join(',')}（保留已有的 ${have.filter(x => !missing.includes(x)).join(',') || '无'}）`);
    const r = await post(`/developers/v1/callback/update/${appId}`, {
      operation: 'add',
      callbackMode: CALLBACK_MODE_LONG_CONN,
      callbacks: missing,
    });
    const code = r.json && r.json.code;
    if (r.status !== 200 || code !== 0) {
      if (code === CB_CODE_BAD_REQUEST) {
        return { status: 'failed', retryable: false, detail: `接口契约可能已变更（update code ${CB_CODE_BAD_REQUEST} 参数校验失败），需重新抓包核对` };
      }
      if (code === CB_CODE_NOT_FOUND) {
        return { status: 'failed', retryable: false, detail: `appId 本身有问题（update code ${CB_CODE_NOT_FOUND}）` };
      }
      return { status: 'failed', retryable: true, detail: `添加回调失败 http=${r.status} code=${code} msg=${r.json && r.json.msg}` };
    }
    logLine('INFO', `[回调] 已添加 ${missing.join(',')}`);
  } else {
    logLine('INFO', '[回调] 目标回调均已存在，跳过 update');
  }

  // ---- 5) 读回复核持久化 ----
  let after;
  try {
    after = await cbRead(appId);
  } catch (e) {
    return { status: 'failed', retryable: true, detail: '写入后回读失败: ' + e.message };
  }
  const got = after.callbacks;
  if (want.every(x => got.includes(x))) {
    logLine('INFO', `[回调] 复核心成功，当前 [${got.join(',')}]，callbackMode=${after.callbackMode}`);
    logLine('WARN', '[回调] 注意：后台提示「版本发布后，当前修改方可生效」——回调/权限变更需创建并发布版本才真正生效');
    return { status: 'configured' };
  }
  return { status: 'failed', retryable: false, detail: `写入后回读未见 ${want.join(',')}（当前 [${got.join(',') || '空'}]）——写入被接受但未生效，需人工核对` };
}

/**
 * v6.1 L1：CDP 点 UI 配回调（v6 原始实现，作为直调失败时的降级路径原样保留）。
 * 飞书没有公开「回调配置」写接口时的兜底；现在已改为直调优先，这里只在直调可重试失败时用。
 * @returns {Promise<{status:'present'|'configured'|'skipped'|'failed', detail?:string}>}
 */
async function ensureCardCallbackViaUi(appId, wanted) {
  const want = wanted && wanted.length ? wanted : DEFAULT_CALLBACKS;
  logLine('INFO', `[回调] 目标 ${want.length} 项: ${want.join(',')}（回调 ≠ 事件，配在「回调配置」tab）`);
  if (SKIP_CALLBACK) { logLine('WARN', '[回调] --skip-callback，跳过'); return { status: 'skipped', detail: '--skip-callback' }; }
  if (DRY_RUN) { logLine('INFO', `[DRY-RUN] 将检查/配置回调 ${want.join(',')}`); return { status: 'skipped', detail: 'dry-run' }; }

  let c;
  try { c = await cdpAttachPage(`open.feishu.cn/app/${appId}`); }
  catch (e) {
    logLine('WARN', '[回调] CDP 不可用，无法自动配回调（待人工确认）: ' + e.message);
    return { status: 'failed', detail: 'CDP 不可用: ' + e.message };
  }
  try {
    const url = `https://open.feishu.cn/app/${appId}/event?tab=callback`;
    logLine('INFO', '[回调] 导航 -> ' + url);
    await c.send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, 6000));

    const readState = () => c.evalJs(`(() => {
      const t = document.body.innerText || '';
      return {
        text: t.slice(0, 4000),
        hasWanted: ${JSON.stringify(want)}.every(x => t.includes(x)),
        subModeLongConn: /长连接\\s*接收回调/.test(t),
        empty: t.includes('暂无数据'),
      };
    })()`);

    let st = await readState();
    if (st.hasWanted) {
      logLine('INFO', '[回调] 已存在 ' + want.join(',') + '，无需变更（幂等跳过）');
      return { status: 'present' };
    }

    // 找「订阅方式」旁铅笔：优先点击含『订阅方式』行内的按钮
    const pencil = await c.evalJs(`(() => {
      const nodes = [...document.querySelectorAll('*')].filter(el => el.childElementCount === 0 && (el.textContent || '').trim() === '订阅方式');
      if (!nodes.length) return { ok: false, why: '页面没有「订阅方式」文字' };
      const label = nodes[nodes.length - 1];
      label.scrollIntoView({ block: 'center' });
      let row = label;
      for (let i = 0; i < 6 && row.parentElement; i++) {
        row = row.parentElement;
        const btns = [...row.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().width <= 40);
        if (btns.length) {
          const r = btns[0].getBoundingClientRect();
          return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }
      }
      return { ok: false, why: '订阅方式行内没找到按钮' };
    })()`);
    if (!pencil || !pencil.ok) {
      logLine('WARN', '[回调] 找不到「订阅方式」编辑按钮，待人工确认: ' + JSON.stringify(pencil));
      logLine('WARN', '[回调] 页面正文片段: ' + String(st.text).replace(/\s+/g, ' ').slice(0, 600));
      return { status: 'failed', detail: '找不到订阅方式编辑按钮' };
    }
    logLine('INFO', `[回调] 点击订阅方式编辑按钮 @(${pencil.x},${pencil.y})`);
    await c.clickAt(pencil.x, pencil.y);
    await new Promise(r => setTimeout(r, 2500));

    // 选「使用长连接接收回调」
    const radio = await c.evalJs(`(() => {
      const rs = [...document.querySelectorAll('input[type=radio]')].filter(r => r.getBoundingClientRect().width > 0);
      if (!rs.length) return { ok: false, why: '弹层里没有 radio' };
      const pick = rs.find(r => /长连接/.test((r.closest('label') || r.parentElement || {}).innerText || '')) || rs[0];
      pick.scrollIntoView({ block: 'center' });
      const r = pick.getBoundingClientRect();
      return { ok: true, checked: pick.checked, disabled: pick.disabled, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!radio || !radio.ok) {
      logLine('WARN', '[回调] 找不到长连接单选项，待人工确认: ' + JSON.stringify(radio));
      return { status: 'failed', detail: '找不到长连接单选项' };
    }
    if (!radio.checked) { logLine('INFO', `[回调] 选中「使用长连接接收回调」@(${radio.x},${radio.y})`); await c.clickAt(radio.x, radio.y); await new Promise(r => setTimeout(r, 800)); }
    else logLine('INFO', '[回调] 长连接已是选中态');

    const saveBtn = await c.evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].filter(x => (x.innerText || '').trim() === '保存' && !x.disabled)[0];
      if (!b) return { ok: false };
      const r = b.getBoundingClientRect();
      return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (saveBtn && saveBtn.ok) { logLine('INFO', '[回调] 点击保存'); await c.clickAt(saveBtn.x, saveBtn.y); await new Promise(r => setTimeout(r, 3500)); }
    else logLine('WARN', '[回调] 没找到可点的「保存」（可能已是长连接，直接继续）');

    // 添加回调
    const addCb = await c.evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].filter(x => (x.innerText || '').trim() === '添加回调')[0];
      if (!b) return { ok: false, why: '没有「添加回调」按钮' };
      if (b.disabled) return { ok: false, why: '「添加回调」仍置灰（订阅方式未配置成功）' };
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!addCb || !addCb.ok) {
      logLine('WARN', '[回调] ' + JSON.stringify(addCb) + ' —— 待人工确认');
      return { status: 'failed', detail: String((addCb && addCb.why) || '添加回调不可用') };
    }
    logLine('INFO', '[回调] 点击「添加回调」');
    await c.clickAt(addCb.x, addCb.y);
    await new Promise(r => setTimeout(r, 3000));

    const dlg = await c.evalJs(`(() => {
      const t = document.body.innerText || '';
      const boxes = [...document.querySelectorAll('input[type=checkbox]')].filter(b => b.getBoundingClientRect().width > 0);
      const target = boxes.find(b => !b.disabled);
      if (!target) return { ok: false, dlgHasCard: t.includes('card.action.trigger'), count: boxes.length };
      target.scrollIntoView({ block: 'center' });
      const r = target.getBoundingClientRect();
      return { ok: true, dlgHasCard: t.includes('card.action.trigger'), count: boxes.length, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!dlg || !dlg.ok) {
      logLine('WARN', '[回调] 回调弹窗里没有可用 checkbox，待人工确认: ' + JSON.stringify(dlg));
      return { status: 'failed', detail: '弹窗无可用 checkbox' };
    }
    if (!dlg.dlgHasCard) logLine('WARN', '[回调] 弹窗正文里没出现 card.action.trigger 字样，仍按「第一个可用项」勾选（有勾错风险，运行后请核对）');
    logLine('INFO', `[回调] 勾选 card.action.trigger @(${dlg.x},${dlg.y})`);
    await c.clickAt(dlg.x, dlg.y);
    await new Promise(r => setTimeout(r, 1200));

    const confirm = await c.evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].filter(x => (x.innerText || '').trim() === '添加' && !x.disabled)[0];
      if (!b) return { ok: false };
      const r = b.getBoundingClientRect();
      return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!confirm || !confirm.ok) { logLine('WARN', '[回调] 弹窗「添加」按钮不可点，待人工确认'); return { status: 'failed', detail: '弹窗添加按钮不可点' }; }
    logLine('INFO', '[回调] 点击弹窗「添加」');
    await c.clickAt(confirm.x, confirm.y);
    await new Promise(r => setTimeout(r, 4000));

    st = await readState();
    if (st.hasWanted) {
      logLine('INFO', '[回调] 配置成功，页面已出现 ' + want.join(','));
      logLine('WARN', '[回调] 注意：后台提示「版本发布后，当前修改方可生效」——回调/权限变更需创建并发布版本才真正生效');
      return { status: 'configured' };
    }
    await c.send('Page.reload', {});
    await new Promise(r => setTimeout(r, 5000));
    st = await readState();
    if (st.hasWanted) { logLine('INFO', '[回调] 刷新后确认存在 ' + want.join(',') + '（已持久化）'); return { status: 'configured' }; }
    logLine('WARN', '[回调] 添加后仍未在页面看到 ' + want.join(',') + '，待人工确认');
    logLine('WARN', '[回调] 页面正文片段: ' + String(st.text).replace(/\s+/g, ' ').slice(0, 600));
    return { status: 'failed', detail: '添加后页面未出现回调' };
  } catch (e) {
    logLine('WARN', '[回调] 自动配置异常，待人工确认: ' + e.message);
    return { status: 'failed', detail: e.message };
  } finally {
    try { c.close(); } catch (e) { /* ignore */ }
  }
}

// ---------- 子命令 ----------
async function cmdCreate() {
  if (!NAME) { logLine('ERROR', '缺少 --name（新应用名，如 aiyayi-script-test）'); process.exit(2); }
  logLine('INFO', '==> 开始创建应用: ' + NAME);

  // 0. 上传应用图标（发布校验必填；先传图拿 url，再带进 app/create）
  const avatar = DRY_RUN ? '(dry-run 未上传)' : await uploadIcon();
  logLine('INFO', '✅ 1/8 上传应用图标（发布校验必填）');

  // 1. 创建应用
  if (DRY_RUN) { logLine('INFO', '[DRY-RUN] 将 POST /developers/v1/app/create name=' + NAME); }
  const create = DRY_RUN ? { data: { ClientID: 'cli_dryrun' } } : await ok('/developers/v1/app/create', {
    appSceneType: 0, name: NAME, desc: DESC, avatar,
    i18n: { zh_cn: { name: NAME, description: DESC } }, primaryLang: 'zh_cn',
  }, '创建应用');
  const appId = create.data.ClientID;
  if (!DRY_RUN) saveState({ appId, name: NAME, step: 'created' });
  logLine('INFO', '✅ 2/8 创建应用 -> ' + appId);

  // 2. 开启机器人能力
  if (!DRY_RUN) {
    await ok(`/developers/v1/robot/switch/${appId}`, { enable: true }, '开机器人');
    await ok('/developers/v1/developer_panel/menu_ability', { clientId: appId, ability: ['bot'] }, '菜单能力');
  } else { logLine('INFO', '[DRY-RUN] 将开机器人 + 菜单能力'); }
  logLine('INFO', '✅ 3/8 开启机器人能力');

  // 3. 配置权限（v6：幂等，先读已开通再补差集）
  const scopeRes = await ensureScopes(appId, PERMS);
  logLine('INFO', '✅ 4/8 配置权限 新增=' + (scopeRes.added.join(',') || '(无)') + ' 跳过=' + (scopeRes.skipped.join(',') || '(无)'));

  // 4. 事件订阅（长连接，v6 幂等）
  const evRes = SKIP_EVENTS ? { added: [], skipped: EVENTS } : await ensureEvents(appId, EVENTS);
  logLine('INFO', '✅ 5/8 长连接事件订阅 新增=' + (evRes.added.join(',') || '(无)'));

  // 5. 卡片回调（v6 新增，CDP UI 自动化，失败不阻断）
  const cbRes = await ensureCardCallback(appId, CALLBACKS);
  logLine('INFO', `✅ 6/8 卡片回调 ${CALLBACKS.join(',')} -> ${cbRes.status}` + (cbRes.via ? ` [via=${cbRes.via}]` : '') + (cbRes.detail ? '（' + cbRes.detail + '）' : ''));

  // 6. 创建版本并提交发布
  if (DRY_RUN) {
    logLine('INFO', '[DRY-RUN] 将创建版本 ' + APP_VERSION + ' 并提交发布（不执行）');
    console.log('\n' + JSON.stringify({ dryRun: true, appId, scopes: PERMS, events: EVENTS, callbacks: CALLBACKS }, null, 2));
    return;
  }
  const version = await ok(`/developers/v1/app_version/create/${appId}`, {
    appVersion: APP_VERSION,
    mobileDefaultAbility: 'bot', pcDefaultAbility: 'bot',
    changeLog: CHANGELOG,
    visibleSuggest: { departments: [], members: [MEMBER], groups: [], isAll: 0 },
    applyReasonConfig: {
      apiPrivilegeNeedReason: false, contactPrivilegeNeedReason: false, dataPrivilegeReasonMap: {},
      visibleScopeNeedReason: false, apiPrivilegeReasonMap: {}, contactPrivilegeReason: '',
      isDataPrivilegeExpandMap: {}, visibleScopeReason: '', dataPrivilegeNeedReason: false,
      isAutoAudit: false, isContactExpand: false,
    },
    b2cShareSplitConfigSuggest: { b2cGroupChatShareEnable: false, b2cP2PChatShareEnable: false, b2cP2PChatNeedAudit: false },
    autoPublish: false,
    blackVisibleSuggest: { departments: [], members: [], groups: [], isAll: 0 },
  }, '创建版本');
  const versionId = version.data.versionId;
  saveState({ versionId, step: 'version_created' });
  logLine('INFO', '✅ 7/8 创建版本 ' + APP_VERSION + ' -> versionId=' + versionId);

  await ok(`/developers/v1/publish/commit/${appId}/${versionId}`, {}, '提交发布');
  saveState({ step: 'published' });
  logLine('INFO', '✅ 8/8 提交发布');

  console.log('\n' + JSON.stringify({ appId, versionId, name: NAME, callbacks: cbRes.status, log: LOG_FILE, next: 'verify' }, null, 2));
  logLine('INFO', '上线确认: node create-bot.js verify --app-id ' + appId);
  if (cbRes.status !== 'present' && cbRes.status !== 'configured') {
    logLine('WARN', '⚠ 卡片回调未确认成功（' + cbRes.status + '）——需人工在后台「事件与回调 → 回调配置」核对 card.action.trigger');
  }
}

/**
 * v6 新增子命令：对已存在应用补配置（权限 / 事件 / 回调），不动版本、不发布。
 * 用法：node create-bot.js configure --app-id cli_xxx [--dry-run] [--skip-callback] [--permissions ...]
 */
async function cmdConfigure() {
  const appId = APP_ID || loadState().appId;
  if (!appId) { logLine('ERROR', '缺少 --app-id（或 --state 文件里没有 appId）'); process.exit(2); }
  logLine('INFO', '==> 补配置应用: ' + appId + (DRY_RUN ? '（DRY-RUN）' : ''));

  const app = await guarded('应用状态', () => okGet(`/developers/v1/app/${appId}`, '应用状态'), { data: {} });
  const d = (app.data && app.data) || {};
  logLine('INFO', `应用: name=${d.name || '(dry-run 未取到)'} appStatus=${d.appStatus} auditStatus=${d.auditStatus}`);

  const scopeRes = await ensureScopes(appId, PERMS);
  const evRes = SKIP_EVENTS ? { added: [], skipped: EVENTS } : await ensureEvents(appId, EVENTS);
  const cbRes = await ensureCardCallback(appId, CALLBACKS);

  const summary = {
    appId,
    dryRun: DRY_RUN,
    scopes: { wanted: PERMS, added: scopeRes.added, skipped: scopeRes.skipped },
    events: { wanted: EVENTS, added: evRes.added },
    callbacks: { wanted: CALLBACKS, status: cbRes.status, detail: cbRes.detail || null },
    log: LOG_FILE,
  };
  console.log('\n' + JSON.stringify(summary, null, 2));
  logLine('INFO', 'configure 汇总: ' + JSON.stringify(summary));
  if (scopeRes.added.length || evRes.added.length || cbRes.status === 'configured') {
    logLine('WARN', '⚠ 有变更——按飞书规则需在后台「版本管理与发布」创建并发布新版本后生效');
  } else {
    logLine('INFO', '无变更（全部已就绪）');
  }
}

async function cmdVerify() {
  const st = loadState();
  const appId = APP_ID || st.appId;
  if (!appId) { logLine('ERROR', '缺少 --app-id（或 --state 文件里没有 appId）'); process.exit(2); }
  logLine('INFO', '==> 验证应用: ' + appId);

  const app = await okGet(`/developers/v1/app/${appId}`, '应用状态');
  const scopes = await okGet(`/developers/v1/scope/applied/${appId}`, '权限核对');
  const ev = await ok(`/developers/v1/event/${appId}`, { needEventDetail: true }, '事件核对');
  let list = null;
  try { list = await okGet(`/developers/v1/app_version/list/${appId}`, '版本列表'); } catch (e) { logLine('WARN', '版本列表查询失败（不影响结论）: ' + e.message); }

  const d = app.data;
  const sc = (scopes.data.scopes || []).map(s => s.name + ':' + s.status).join(', ') || '(空)';
  // v6.2.1 修正：原写 v.status / v.auditStatus → 一直打印 undefined。
  // 实测 app_version/list 的版本对象字段只有这 10 个（抓包核实，非推测）：
  //   appVersion, bindTenantId, bindTenantName, createUser, publishTime, publishUser,
  //   unshelveTime, updateRemark, versionId, versionStatus
  // ├ versionStatus 存在：2 = 已发布生效，100 = 首个已上线版本
  // └ auditStatus **不存在**（detail 里也只有 isAutoAudit/canAutoAudit 这类配置布尔值，
  //   不是版本审核状态），所以不再打印它，改用真实存在的 publishTime。
  // 兼容写法：v.versionStatus ?? v.status —— 万一飞书改回旧名也不崩。
  const verStatus = (v) => (v.versionStatus !== undefined ? v.versionStatus : v.status);
  const fmtTime = (sec) => {
    if (!sec) return '未发布';
    const dt = new Date(Number(sec) * 1000);
    if (isNaN(dt.getTime())) return String(sec);
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  };
  const versions = (list && list.data.versions || [])
    .map(v => `${v.appVersion}(status=${verStatus(v)},publishTime=${fmtTime(v.publishTime)})`)
    .join('; ') || '(无)';
  const missing = PERMS.filter(p => !(scopes.data.scopes || []).some(s => s.name === p));
  const summary = {
    appId,
    name: d.name,
    appStatus: d.appStatus,          // 1 = 已上线
    auditStatus: d.auditStatus,      // 100 = 审核通过
    ability: d.ability || [],
    scopes: sc,
    missingScopes: missing,          // v6：期望清单里还没开通的（空数组 = 齐了）
    eventMode: ev.data.eventMode,
    appEvents: (ev.data.appEventDetails || []).map(biz => (biz.items || []).map(it => it.id).join(',')).filter(Boolean).join(',') || '(无)',
    versions,
    callbacks: CALLBACKS,            // 回调需人工在后台核对（无公开查询接口）
    log: LOG_FILE,
  };
  console.log(JSON.stringify(summary, null, 2));
  logLine('INFO', 'verify 结果: ' + JSON.stringify(summary));
  if (missing.length) logLine('WARN', '⚠ 缺权限: ' + missing.join(',') + '（跑 configure 可自动补）');
  if (d.appStatus === 1) logLine('INFO', '应用已上线（appStatus=1）');
  else logLine('WARN', `应用尚未上线（appStatus=${d.appStatus}, auditStatus=${d.auditStatus}）。首次发布需管理员审核，审核入口见 create 输出。`);
}

// ============================================================================
// v6.2 新增子命令 publish：给**已存在**的应用「建版本 → 提交发布」
// 格式全部来自 2026-11-11 对 cli_aa79b06a5638dcf4 真实发布的抓包（报告-发布与权限抓包.md）：
//   ① POST /developers/v1/app_version/create/{appId}
//      body: appVersion / mobileDefaultAbility:"bot" / pcDefaultAbility:"bot" / changeLog /
//            visibleSuggest{...,isAll:0} / applyReasonConfig{...} / b2cShareSplitConfigSuggest{...} /
//            autoPublish:false / blackVisibleSuggest{...isAll:0}
//      → data.versionId
//   ② POST /developers/v1/publish/commit/{appId}/{versionId}   body: {}（**实测就是空对象**）
//      → data.isOk === true 才算成功
// 发布是对外动作：默认等同 dry-run，必须显式 --yes 才真发。
// ============================================================================
const PUB_VERSION = arg('version') || arg('app-version');
const PUB_CHANGELOG = arg('changelog');
const PUB_YES = flag('yes');

/** 构造 app_version/create 的 body（字段与实测抓包逐字对齐，别自作聪明增删）。 */
function buildVersionCreateBody(version, changelog) {
  return {
    appVersion: version,
    mobileDefaultAbility: 'bot',
    pcDefaultAbility: 'bot',
    changeLog: changelog,
    visibleSuggest: { departments: [], members: [MEMBER], groups: [], isAll: 0 },
    applyReasonConfig: {
      apiPrivilegeNeedReason: false,
      contactPrivilegeNeedReason: false,
      dataPrivilegeReasonMap: {},
      visibleScopeNeedReason: false,
      apiPrivilegeReasonMap: {},
      contactPrivilegeReason: '',
      isDataPrivilegeExpandMap: {},
      visibleScopeReason: '',
      dataPrivilegeNeedReason: false,
      isAutoAudit: false,
      isContactExpand: false,
    },
    b2cShareSplitConfigSuggest: {
      b2cGroupChatShareEnable: false,
      b2cP2PChatShareEnable: false,
      b2cP2PChatNeedAudit: false,
    },
    autoPublish: false,
    blackVisibleSuggest: { departments: [], members: [], groups: [], isAll: 0 },
  };
}

/** 版本是否「未发布」。实测 versionStatus：2 = 已发布/已生效，100 = 首个已上线版本；均非 0。 */
function isUnpublishedVersion(v) {
  return v && v.publishTime === 0 && v.isPublish !== true;
}

async function cmdPublish() {
  const appId = APP_ID || loadState().appId;
  if (!appId) { logLine('ERROR', '缺少 --app-id（或 --state 文件里没有 appId）'); process.exit(2); }
  if (!PUB_VERSION) { logLine('ERROR', '缺少 --version（要发布的版本号，如 1.0.3）'); process.exit(2); }

  const changelog = PUB_CHANGELOG || '更新应用版本';
  // 不传 --yes 时等同 dry-run：对外动作必须显式确认
  const effectiveDryRun = DRY_RUN || !PUB_YES;
  const createBody = buildVersionCreateBody(PUB_VERSION, changelog);

  logLine('INFO', '==> 发布应用: ' + appId + '  版本=' + PUB_VERSION + (effectiveDryRun ? '（DRY-RUN）' : '（真实发布）'));
  if (!DRY_RUN && !PUB_YES) {
    logLine('WARN', '未传 --yes —— 发布是对外动作，本次按 dry-run 处理，不会发任何请求。确认无误后加 --yes 重跑。');
  }

  // 预览：两个请求的完整 body 都打出来
  logLine('INFO', '将发请求 ① POST /developers/v1/app_version/create/' + appId);
  logLine('INFO', '   body=' + JSON.stringify(createBody));
  logLine('INFO', '将发请求 ② POST /developers/v1/publish/commit/' + appId + '/<上一步返回的 versionId>');
  logLine('INFO', '   body={}   （实测就是空对象，版本号只在 URL path 里）');

  if (effectiveDryRun) {
    const preview = {
      dryRun: true,
      reason: DRY_RUN ? '--dry-run' : '缺少 --yes',
      appId,
      version: PUB_VERSION,
      changelog,
      requests: [
        { method: 'POST', path: `/developers/v1/app_version/create/${appId}`, body: createBody },
        { method: 'POST', path: `/developers/v1/publish/commit/${appId}/{versionId}`, body: {} },
      ],
      log: LOG_FILE,
    };
    console.log('\n' + JSON.stringify(preview, null, 2));
    logLine('INFO', 'publish 预演完成（未发送任何写请求）');
    return;
  }

  // ---- 第一步：建版本 ----
  let versionId = null;
  let created = false;
  try {
    const vr = await ok(`/developers/v1/app_version/create/${appId}`, createBody, '创建版本');
    versionId = vr.data && vr.data.versionId;
    if (!versionId) throw errWithRaw('创建版本成功但未返回 versionId: ' + JSON.stringify(vr.data), vr.raw);
    created = true;
    logLine('INFO', '① 创建版本 ' + PUB_VERSION + ' -> versionId=' + versionId);
  } catch (e) {
    const code = (e.raw && (() => { try { return JSON.parse(e.raw).code; } catch (x) { return null; } })()) || null;
    const dupCode = 10002; // 实测约定：版本号已存在
    if (code !== dupCode) throw e;
    logLine('WARN', `创建版本返回 code=${dupCode}（版本号已存在）→ 查版本列表找可复用版本`);
    const list = await okGet(`/developers/v1/app_version/list/${appId}`, '版本列表');
    const versions = (list.data && list.data.versions) || [];
    const same = versions.filter(v => v.appVersion === PUB_VERSION);
    if (!same.length) {
      throw errWithRaw(`create 报 code=${dupCode}，但版本列表里找不到 ${PUB_VERSION}，无法复用`, list.raw);
    }
    // 优先复用「未发布」的同号版本；都发布了就取最新一条
    const reusable = same.find(isUnpublishedVersion) || same[0];
    versionId = reusable.versionId;
    logLine('WARN', `复用已有版本 ${PUB_VERSION} -> versionId=${versionId}（publishTime=${reusable.publishTime}，versionStatus=${reusable.versionStatus}）`);
    if (!isUnpublishedVersion(reusable)) {
      logLine('WARN', `⚠ 复用的版本看起来已经发布过（versionStatus=${reusable.versionStatus}）；如需重新发布请改用新版本号`);
    }
  }

  // ---- 第二步：提交发布（body 必须是空对象） ----
  const pr = await ok(`/developers/v1/publish/commit/${appId}/${versionId}`, {}, '提交发布');
  const isOk = !!(pr.data && pr.data.isOk);
  if (!isOk) {
    throw errWithRaw('提交发布返回 code=0 但 data.isOk 不为 true: ' + JSON.stringify(pr.data), pr.raw);
  }
  logLine('INFO', '② 提交发布成功（data.isOk=true）');

  const summary = {
    appId,
    version: PUB_VERSION,
    versionId,
    reusedExistingVersion: !created,
    changelog,
    publishOk: isOk,
    log: LOG_FILE,
  };
  console.log('\n' + JSON.stringify(summary, null, 2));
  logLine('INFO', 'publish 汇总: ' + JSON.stringify(summary));
  logLine('WARN', '⚠ 已提交发布。若企业需审核，请到后台「版本管理与发布」跟踪审核状态；可跑 verify 确认 appStatus');
}

// ---------- main ----------
(async () => {
  logInit(sub);
  parseTargets();
  // 未显式给 --csrf/--cookie 时，自动从 CDP bootstrap 会话
  if (!CSRF || !COOKIE) {
    const s = await cdpSession();
    if (!CSRF) CSRF = s.csrf;
    if (!COOKIE) COOKIE = s.cookie;
    logLine('INFO', `会话: CDP 端口 ${PORT} 自动 bootstrap（csrf=window.csrfToken, cookie 含 session）`);
  } else {
    logLine('INFO', '会话: 显式 --csrf/--cookie');
  }

  if (sub === 'verify') return await cmdVerify();
  if (sub === 'configure') return await cmdConfigure();
  if (sub === 'publish') return await cmdPublish();
  if (sub === 'create' || !sub) return await cmdCreate();
  logLine('ERROR', '未知子命令: ' + sub + '（支持 create / configure / verify / publish）');
  process.exit(2);
})().catch(e => {
  logError('主流程', e);
  console.error('\nERR ' + e.message);
  if (LOG_FILE) console.error('完整日志: ' + LOG_FILE);
  process.exit(1);
});
