#!/usr/bin/env node
/**
 * get-csrf.js — 从运行中的 Edge（CDP，默认端口 9222）读取 open.feishu.cn 的 CSRF token
 * 前置：Edge 已带 --remote-debugging-port=9222 打开且 open.feishu.cn 已登录（登录态在浏览器里）。
 * 用法：node get-csrf.js [--port 9222]
 * 输出：仅打印 token 值（便于 shell 捕获），不带任何多余字符。
 *
 * ⚠ 重要（2026-11-10 实锤）：后端校验的是页面 HTML 内嵌的 window.csrfToken，
 *   不是 cookie lark_oapi_csrf_token 的值（cookie 值已过期/不被接受，用它必得 9499）。
 *   读取顺序：window.csrfToken（首选）→ document.cookie → Network.getAllCookies（兜底）。
 */
const http = require('http');

const argv = process.argv.slice(2);
const i = argv.indexOf('--port');
const PORT = i >= 0 ? parseInt(argv[i + 1], 10) : 9222;

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
  if (!page) throw new Error('没找到 open.feishu.cn 页面 target（浏览器没开调试端口？没登录飞书？）');

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

  let token = null;

  // 方式 1（首选）：页面 HTML 内嵌的 window.csrfToken —— 后端真正接受的 fresh token
  const r0 = await send('Runtime.evaluate', { expression: 'window.csrfToken || null', returnByValue: true });
  token = (r0.result && r0.result.result && r0.result.result.value) || null;

  // 方式 2：document.cookie 的 lark_oapi_csrf_token（旧机制，2026-11-10 起已被后端拒绝，仅兜底）
  if (!token) {
    const r1 = await send('Runtime.evaluate', { expression: 'document.cookie', returnByValue: true });
    const m = (r1.result.result.value || '').match(/lark_oapi_csrf_token=([^;]+)/);
    token = m ? m[1] : null;
  }

  // 方式 3：Network.getAllCookies（含 httpOnly）
  if (!token) {
    try {
      const r2 = await send('Network.getAllCookies');
      const cookies = (r2.result && r2.result.cookies) || [];
      const hit = cookies.find(c => c.name === 'lark_oapi_csrf_token');
      token = hit ? hit.value : null;
    } catch (e) {
      await send('Network.enable');
      const r2 = await send('Network.getAllCookies');
      const cookies = (r2.result && r2.result.cookies) || [];
      const hit = cookies.find(c => c.name === 'lark_oapi_csrf_token');
      token = hit ? hit.value : null;
    }
  }

  ws.close();
  if (!token) throw new Error('未找到 csrf token（页面没登录 / 已过期，请刷新 open.feishu.cn 页面）');
  process.stdout.write(token);
  process.exit(0);
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
