#!/usr/bin/env node
/**
 * create-bot.js v5 — 飞书机器人一键创建/验证脚本（2026-11-10 实跑打通全链路；v1 备份在 work/feishu-app-create/create-bot-v1.js；v5 加扫码前置 + bot_p2p_chat_entered_v1 默认订阅）
 *
 * 依据请求清单：docs/经验-飞书机器人创建全流程与请求清单.md（工作区）
 * 链路：上传图标 → 创建应用 → 开机器人 → 配权限 → 长连接事件订阅 → 建版本 → 提交发布
 * 人工介入点：
 *   - 扫码登录（v5 新增）：open.feishu.cn 是纯扫码形态（无密码框）。CDP bootstrap 检测到
 *     session cookie 缺失（未登录）时，自动导航登录页并提示「手机飞书扫码」，轮询等待
 *     登录态就绪后继续原链路（默认超时 10 分钟，--login-wait <秒> 可调）。
 *   - 人机验证（若触发风控）：脚本报错停顿并给指引，可用 CDP 在浏览器里手动过验证后重跑；
 *   - 首次发布管理员审核：仅「需审核」企业存在（本企业已验证为免审核，提交发布后自动上线）；
 *     create 提交发布后打印审核入口，用 verify 轮询/确认 appStatus=1。
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
 *   # 显式会话：
 *   node create-bot.js create --name xxx --csrf <window.csrfToken> --cookie "<getAllCookies 拼的整包 cookie 头>"
 *   # 审核后验证：
 *   node create-bot.js verify --app-id cli_xxx [--state <file>]
 *
 * --state 默认写 work/feishu-app-create/state-<name>.json（相对当前工作目录）。
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
const PORT = (() => { const i = argv.indexOf('--port'); return i >= 0 ? parseInt(argv[i + 1], 10) : 9222; })();
let CSRF = arg('csrf') || process.env.FEISHU_CSRF;
let COOKIE = arg('cookie') || process.env.FEISHU_COOKIE;
const UA = arg('ua') || process.env.FEISHU_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0';
const NAME = arg('name');
const DESC = arg('desc') || '脚本自动创建的飞书机器人，用途见应用名。';
const PERMS = (arg('permissions') || 'im:message,im:message:send_as_bot,im:chat,im:chat:read,im:message.p2p_msg:readonly,im:message.group_at_msg:readonly')
  .split(',').map(s => s.trim()).filter(Boolean);
// 改造 5：默认订阅新增 bot_p2p_chat_entered_v1（用户进入与 bot 的 P2P 单聊时触发，
// 权限要求=无，事件体含 chat_id + operator_id open_id）——新会话扫码接入的自动绑定靠它。
const EVENTS = (arg('events') || 'im.message.receive_v1,im.chat.access_event.bot_p2p_chat_entered_v1')
  .split(',').map(s => s.trim()).filter(Boolean);
const MEMBER = arg('member') || '7133153336450220036'; // 上次实锤的企业管理员 open_id（巴依浩爷，与 aiyayi-test 同账号），可用 --member 覆盖
const APP_VERSION = arg('app-version') || '1.0.0';
const CHANGELOG = arg('changelog') || '首次发布：机器人能力+消息权限+长连接事件订阅';
const ICON = arg('icon'); // 指定 PNG 路径；缺省自动生成一张 256x256 图标
const APP_ID = arg('app-id');
const STATE_FILE = arg('state') || (NAME ? path.join(process.cwd(), 'work', 'feishu-app-create', 'state-' + NAME + '.json') : null);
// 改造 4：扫码登录等待上限（毫秒）。未登录时脚本导航登录页、提示手机飞书扫码，轮询等待登录态就绪。
const LOGIN_WAIT_MS = arg('login-wait') ? parseInt(arg('login-wait'), 10) * 1000 : 10 * 60 * 1000;

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
    console.log('');
    console.log('📱 检测到未登录 open.feishu.cn —— 需要扫码登录（open.feishu.cn 是纯扫码形态，无密码框）');
    console.log('  将自动打开登录页；请在手机上用「飞书 app」扫码（或飞书内扫一扫）；');
    console.log('  登录成功后脚本自动继续，无需再做任何操作。');
    console.log('');
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
    console.log('✅ 登录态就绪，继续创建流程。');
  }

  const seen = new Set(); const parts = [];
  for (const c of cookies) {
    if (!/feishu\.cn$/.test(c.domain || '')) continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name); parts.push(c.name + '=' + c.value);
  }
  const cookie = parts.join('; ');
  ws.close();
  if (!parts.some(p => p.startsWith('session='))) throw new Error('CDP 未拿到 httpOnly session cookie（登录态缺失）');

  // window.csrfToken（页面 HTML 内嵌，后端接受的 fresh token）
  // 优先 Runtime.evaluate 读页面内存态；渲染进程卡死（Runtime.evaluate 挂起）时回退到
  // Node https GET 页面 HTML 正则提取（2026-11-10 实锤：/app 与 baseinfo 页 HTML 都内嵌）
  let csrf = null;
  try {
    const r0 = await withTimeoutPromise(send('Runtime.evaluate', { expression: 'window.csrfToken || null', returnByValue: true }), 5000);
    csrf = (r0.result && r0.result.result && r0.result.result.value) || null;
  } catch (e) { csrf = null; }
  if (!csrf) {
    try {
      const html = await httpsGet('/app', cookie);
      const m = html.match(/window\.csrfToken\s*=\s*"([^"]+)"/);
      if (m) csrf = m[1];
    } catch (e) { /* 保持 null */ }
  }
  if (!csrf) throw new Error('CDP 未拿到 window.csrfToken（页面可能没登录/已过期，请刷新 open.feishu.cn）');
  return { csrf, cookie };
}

// ---------- HTTP ----------
const HOST = 'open.feishu.cn';
function post(pathname, body) {
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
        try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
        catch (e) { reject(new Error('bad json: ' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
function humanPauseReason(json) {
  const msg = (json && (json.msg || '')) || '';
  if (json && json.code === 9499) return 'CSRF/会话失效（code 9499）：刷新 open.feishu.cn 页面让 window.csrfToken 更新，再重跑（脚本会自动从 CDP 重取）';
  if (json && json.code === 99991641) return 'session 失效（code 99991641）：浏览器登录态过期，重新登录 open.feishu.cn 后重跑';
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
        try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
        catch (e) { reject(new Error('bad json: ' + d.slice(0, 200))); }
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
    console.log('🎨 自动生成图标 -> ' + iconPath + (ICON ? '（--icon 指定路径无效，已回退自动生成）' : ''));
  }
  const { status, json } = await postUpload('/developers/v1/app/upload/image', iconPath);
  if (status !== 200 || !json || json.code !== 0) {
    throw new Error(`上传图标失败 /developers/v1/app/upload/image: http=${status} code=${json && json.code} msg=${json && json.msg}`);
  }
  const url = (json.data && (json.data.url || (json.data.urls && json.data.urls[0]))) || null;
  if (!url) throw new Error('上传图标成功但未返回 url: ' + JSON.stringify(json.data));
  console.log('🎨 图标已上传 -> ' + url.slice(0, 80) + '...');
  return url;
}
async function ok(pathname, body, step) {
  const { status, json } = await post(pathname, body);
  if (status !== 200 || !json || json.code !== 0) {
    const pause = humanPauseReason(json);
    throw new Error(`${step} 失败 ${pathname}: http=${status} code=${json && json.code} msg=${json && json.msg}` + (pause ? `\n⏸ 人工介入点：${pause}` : ''));
  }
  return json;
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
  console.log('📝 state -> ' + STATE_FILE);
}

// ---------- 子命令 ----------
async function cmdCreate() {
  if (!NAME) { console.error('缺少 --name（新应用名，如 aiyayi-script-test）'); process.exit(2); }
  console.log('==> 开始创建应用: ' + NAME);

  // 0. 上传应用图标（发布校验必填；先传图拿 url，再带进 app/create）
  const avatar = await uploadIcon();
  console.log('✅ 1/7 上传应用图标（发布校验必填）');

  // 1. 创建应用
  const create = await ok('/developers/v1/app/create', {
    appSceneType: 0, name: NAME, desc: DESC, avatar,
    i18n: { zh_cn: { name: NAME, description: DESC } }, primaryLang: 'zh_cn',
  }, '创建应用');
  const appId = create.data.ClientID;
  saveState({ appId, name: NAME, step: 'created' });
  console.log('✅ 2/7 创建应用 -> ' + appId);

  // 2. 开启机器人能力
  await ok(`/developers/v1/robot/switch/${appId}`, { enable: true }, '开机器人');
  await ok('/developers/v1/developer_panel/menu_ability', { clientId: appId, ability: ['bot'] }, '菜单能力');
  console.log('✅ 3/7 开启机器人能力');

  // 3. 配置权限（先 scope/all 拿数字 id，再批量添加）
  const scopeAll = await ok(`/developers/v1/scope/all/${appId}`, {}, '查权限目录');
  const scopes = scopeAll.data.scopes || [];
  const idMap = {}; scopes.forEach(s => { idMap[s.name] = String(s.id); });
  const missing = PERMS.filter(p => !idMap[p]);
  if (missing.length) throw new Error('权限未在 scope/all 中找到: ' + missing.join(','));
  const ids = PERMS.map(p => idMap[p]);
  await ok(`/developers/v1/scope/update/${appId}`, {
    appScopeIDs: ids, userScopeIDs: [], scopeIds: [], operation: 'add', isDeveloperPanel: true,
  }, '添加权限');
  console.log('✅ 4/7 配置权限 ' + ids.join('+') + ' (' + PERMS.join(',') + ')');

  // 4. 事件订阅（长连接）：先切模式再添加事件，顺序不能反
  await ok(`/developers/v1/event/switch/${appId}`, { eventMode: 4 }, '切长连接');
  await ok(`/developers/v1/event/update/${appId}`, {
    operation: 'add', events: [], appEvents: EVENTS, userEvents: [], eventMode: 4,
  }, '添加事件');
  console.log('✅ 5/7 长连接事件订阅 ' + EVENTS.join(','));

  // 5. 创建版本并提交发布
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
  console.log('✅ 6/7 创建版本 ' + APP_VERSION + ' -> versionId=' + versionId);

  await ok(`/developers/v1/publish/commit/${appId}/${versionId}`, {}, '提交发布');
  saveState({ step: 'published' });
  console.log('✅ 7/7 提交发布');

  console.log('\n' + JSON.stringify({ appId, versionId, name: NAME, next: 'verify' }, null, 2));
  console.log('\nℹ️ 上线确认（本企业已验证发布免审核，提交后异步生效，几秒内 appStatus 翻转）：');
  console.log('   node create-bot.js verify --app-id ' + appId);
  console.log('   若 appStatus=1 即上线成功；如需凭证：node ' + path.join(__dirname, 'save-secret.js') + ' --app-id ' + appId + ' --out <凭证路径>');
}

async function cmdVerify() {
  const st = loadState();
  const appId = APP_ID || st.appId;
  if (!appId) { console.error('缺少 --app-id（或 --state 文件里没有 appId）'); process.exit(2); }
  console.log('==> 验证应用: ' + appId);

  const app = await ok(`/developers/v1/app/${appId}`, {}, '应用状态');
  const scopes = await ok(`/developers/v1/scope/applied/${appId}`, {}, '权限核对');
  const ev = await ok(`/developers/v1/event/${appId}`, { needEventDetail: true }, '事件核对');
  let list = null;
  try { list = await ok(`/developers/v1/app_version/list/${appId}`, {}, '版本列表'); } catch (e) { console.warn('版本列表查询失败（不影响结论）: ' + e.message); }

  const d = app.data;
  const sc = (scopes.data.scopes || []).map(s => s.name + ':' + s.status).join(', ') || '(空)';
  const versions = (list && list.data.versions || []).map(v => `${v.appVersion}(status=${v.status},audit=${v.auditStatus})`).join('; ') || '(无)';
  const summary = {
    appId,
    name: d.name,
    appStatus: d.appStatus,          // 1 = 已上线
    auditStatus: d.auditStatus,      // 100 = 审核通过
    ability: d.ability || [],
    scopes: sc,
    eventMode: ev.data.eventMode,
    appEvents: (ev.data.appEventDetails || []).map(biz => (biz.items || []).map(it => it.id).join(',')).filter(Boolean).join(',') || '(无)',
    versions,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (d.appStatus === 1) console.log('\n✅ 应用已上线（appStatus=1）');
  else console.log(`\n⏸ 应用尚未上线（appStatus=${d.appStatus}, auditStatus=${d.auditStatus}）。首次发布需管理员审核，审核入口见 create 输出。`);
}

// ---------- main ----------
(async () => {
  // 未显式给 --csrf/--cookie 时，自动从 CDP bootstrap 会话
  if (!CSRF || !COOKIE) {
    const s = await cdpSession();
    if (!CSRF) CSRF = s.csrf;
    if (!COOKIE) COOKIE = s.cookie;
    console.log(`🔑 会话: CDP 端口 ${PORT} 自动 bootstrap（csrf=window.csrfToken, cookie 含 session）`);
  } else if (sub === 'create') {
    console.log('🔑 会话: 显式 --csrf/--cookie');
  }

  if (sub === 'verify') return await cmdVerify();
  if (sub === 'create' || !sub) return await cmdCreate();
  console.error('未知子命令: ' + sub + '（支持 create / verify）');
  process.exit(2);
})().catch(e => { console.error('\nERR ' + e.message); process.exit(1); });
