#!/usr/bin/env node
/**
 * get-cookies.js — 从运行中的 Edge（CDP，默认 9222）抓 open.feishu.cn 会话所需 cookie 头 + csrf token
 * 为什么需要：create-bot.js 是 Node 直调 HTTP，浏览器里的 session/票据（含 httpOnly）不会自动带上，
 *   后端校验「x-csrf-token 头 == cookie 里的 lark_oapi_csrf_token」，且登录态靠 session cookie——必须把
 *   浏览器 cookie 整包搬过来拼成 Cookie 头。
 * 前置：Edge 已带 --remote-debugging-port=9222 打开且 open.feishu.cn 已登录。
 * 用法：node get-cookies.js [--port 9222]   → 输出 JSON：{csrf, cookie}
 *      node get-cookies.js --header         → 输出单行 Cookie 头字符串（便于 shell 捕获）
 */
const http = require('http');

const argv = process.argv.slice(2);
const i = argv.indexOf('--port');
const PORT = i >= 0 ? parseInt(argv[i + 1], 10) : 9222;
const HEADER_ONLY = argv.includes('--header');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const pages = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const page = pages.find(p => p.type === 'page' && p.url.includes('open.feishu.cn'));
  if (!page) throw new Error('没找到 open.feishu.cn 页面 target');

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

  await send('Network.enable');
  const r = await send('Network.getAllCookies');
  const cookies = (r.result && r.result.cookies) || [];

  // 只留 feishu 域 cookie（去掉广告/统计域垃圾），按 name 去重（后写优先）
  const byName = {};
  cookies
    .filter(c => (c.domain || '').includes('feishu.cn'))
    .forEach(c => { byName[c.name] = c.value; });
  const cookieHeader = Object.entries(byName).map(([n, v]) => n + '=' + v).join('; ');
  const csrf = byName['lark_oapi_csrf_token'] || null;

  ws.close();
  if (!csrf || !cookieHeader) throw new Error('没抓到完整会话（csrf=' + !!csrf + '）——确认 open.feishu.cn 已登录');
  if (HEADER_ONLY) { process.stdout.write(cookieHeader); }
  else { process.stdout.write(JSON.stringify({ csrf, cookie: cookieHeader })); }
  process.exit(0);
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
