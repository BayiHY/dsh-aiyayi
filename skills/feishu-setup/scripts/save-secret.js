#!/usr/bin/env node
// save-secret.js — 读取飞书开放平台应用的 App Secret 并落盘凭证文件（不明文打印）。
// 路线（无浏览器渲染依赖，浏览器渲染进程卡死也可用）：
//   1) CDP 页面 target Network.getAllCookies 拿全量 feishu.cn cookie（含 httpOnly session）
//   2) Node https GET https://open.feishu.cn/app/{appId}/baseinfo → 从 HTML 提取 window.csrfToken
//   3) POST /developers/v1/secret/{appId}（x-csrf-token + Cookie）→ data.secret 即明文 AppSecret
//   4) 写 { appId, appSecret, savedAt, note } 到 --out（默认 work/feishu-app-create/credential-{appId}.json）
// 用法：
//   node save-secret.js --app-id cli_xxx [--out <路径>] [--port 9222]
// 旧版 CDP 点眼睛方案（会触发 SPA 卡死，勿用）已废弃，代码保留于 work/feishu-app-create/probe-secret-v*.cjs。
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }
const APP_ID = arg('app-id', '');
const OUT = arg('out', '') || ('D:\\AI\\TRAE_PRO\\阿依娅依\\work\\feishu-app-create\\credential-' + APP_ID + '.json');
const PORT = arg('port', '9222');
if (!APP_ID) { console.error('用法: node save-secret.js --app-id cli_xxx [--out 路径]'); process.exit(1); }
function withTimeout(p, ms, label) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + label)), ms))]); }
function getJson(url) { return withTimeout(new Promise((resolve, reject) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(JSON.parse(d))); }).on('error', reject)), 8000, 'get ' + url); }

async function cdpCookies() {
  const pages = await getJson(`http://127.0.0.1:${PORT}/json/list`).catch(() => []);
  const targets = pages.filter(x => x.type === 'page' && x.webSocketDebuggerUrl);
  if (!targets.length) throw new Error('没有可用的页面 target（浏览器没开调试端口？）');
  for (const t of targets) {
    try {
      const header = await withTimeout(new Promise((resolve, reject) => {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('no reply')); }, 6000);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
        ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id !== 1) return; clearTimeout(timer); try { ws.close(); } catch (e) {} resolve(m); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('ws err')); };
      }), 8000, t.id.slice(0, 6));
      const cookies = (header.result && header.result.cookies) || [];
      const keep = cookies.filter(c => /feishu\.cn$/.test(c.domain));
      const byName = new Map();
      for (const c of keep) if (!byName.has(c.name)) byName.set(c.name, c);
      const h = Array.from(byName.values()).map(c => c.name + '=' + c.value).join('; ');
      if (h.includes('session=')) return h;
    } catch (e) { /* 下一个 target */ }
  }
  throw new Error('所有 target 都拿不到含 session 的 cookie');
}

function req(method, pathname, headers, body) {
  return withTimeout(new Promise((resolve, reject) => {
    const opt = { hostname: 'open.feishu.cn', path: pathname, method, headers };
    if (body) opt.headers['Content-Length'] = Buffer.byteLength(body);
    const r = https.request(opt, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    r.on('error', reject); if (body) r.write(body); r.end();
  }), 15000, method + ' ' + pathname);
}

(async () => {
  const cookieHeader = await cdpCookies();
  const html = await req('GET', '/app/' + APP_ID + '/baseinfo', {
    Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  });
  if (html.status !== 200) throw new Error('HTML 状态 ' + html.status);
  const m = html.body.match(/window\.csrfToken\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('HTML 里没找到 window.csrfToken');
  const csrf = m[1];
  const sec = await req('POST', '/developers/v1/secret/' + APP_ID, {
    'Content-Type': 'application/json', Cookie: cookieHeader, 'x-csrf-token': csrf,
    Origin: 'https://open.feishu.cn', Referer: 'https://open.feishu.cn/app/' + APP_ID + '/baseinfo',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
    Accept: 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty',
  }, '{}');
  const parsed = JSON.parse(sec.body);
  if (parsed.code !== 0) throw new Error('secret 接口失败 code=' + parsed.code + ' msg=' + parsed.msg);
  const secret = parsed.data && parsed.data.secret;
  if (!secret || !/^[A-Za-z0-9]{24,40}$/.test(secret)) throw new Error('响应里没有合法 secret 字段');
  const out = { appId: APP_ID, appSecret: secret, savedAt: new Date().toISOString(), note: '脚本创建的应用凭证，仅本地使用，勿入 git/文档' };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('✅ 凭证已写入: ' + OUT + '（appId=' + APP_ID + '，appSecret 已脱敏，长度 ' + secret.length + '）');
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
