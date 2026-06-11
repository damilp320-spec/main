// Удалённый доступ к агентам (вдохновлено Claude dispatch).
// СЕЙЧАС: локальный HTTP-сервер на этом ПК. С другого устройства в той же
// сети (или по localhost) можно открыть веб-интерфейс и общаться с агентами.
// ЗАДЕЛ НА БУДУЩЕЕ: режим 'cloud-relay' (туннель через сервер) и мобильное
// приложение — веб-интерфейс ниже спроектирован как основа PWA.
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const cfg = require('./store');

let server = null;
let token = null;

function getToken() {
  if (!token) token = cfg.get('dispatch.token', null) || crypto.randomBytes(8).toString('hex');
  cfg.set('dispatch.token', token);
  return token;
}
function regenToken() { token = crypto.randomBytes(8).toString('hex'); cfg.set('dispatch.token', token); return token; }

function lanIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const i of ifs[name]) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

function status() {
  const port = cfg.get('dispatch.port', 8765);
  const lan = cfg.get('dispatch.lan', false);
  return {
    running: !!server,
    port,
    lan,
    mode: 'local', // зарезервировано: 'cloud-relay' в будущем
    token: getToken(),
    urls: server ? [`http://127.0.0.1:${port}`, ...(lan ? lanIPs().map((ip) => `http://${ip}:${port}`) : [])] : []
  };
}

function authed(req) {
  const url = new URL(req.url, 'http://x');
  const t = req.headers['x-token'] || url.searchParams.get('token');
  return t && t === getToken();
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-token,content-type' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname === '/') return send(res, 200, WEB_UI, 'text/html; charset=utf-8');
  if (url.pathname === '/manifest.json') return send(res, 200, MANIFEST);

  if (url.pathname.startsWith('/api/')) {
    if (!authed(req)) return send(res, 401, { error: 'Неверный токен' });
    const agent = require('./agent');
    if (url.pathname === '/api/agents') return send(res, 200, { agents: agent.listAgents().map((a) => ({ id: a.id, name: a.name, icon: a.icon })) });
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.message) return send(res, 400, { error: 'message required' });
      const r = await agent.chat({ agentId: body.agentId, message: String(body.message).slice(0, 4000), history: body.history || [] }, null);
      return send(res, 200, { text: r.text });
    }
    return send(res, 404, { error: 'not found' });
  }
  return send(res, 404, 'Not found', 'text/plain');
}

function start() {
  if (server) return status();
  const port = cfg.get('dispatch.port', 8765);
  const host = cfg.get('dispatch.lan', false) ? '0.0.0.0' : '127.0.0.1';
  return new Promise((resolve) => {
    server = http.createServer((req, res) => handle(req, res).catch(() => send(res, 500, { error: 'server error' })));
    server.on('error', (e) => { server = null; resolve({ running: false, error: e.message }); });
    server.listen(port, host, () => resolve(status()));
  });
}

function stop() { if (server) { server.close(); server = null; } return status(); }

// Заготовка под будущий НЕ локальный режим (облачный релей).
function cloudRelayPlaceholder() {
  return { available: false, note: 'Облачный режим появится позже: защищённый туннель к этому ПК без проброса портов.' };
}

const MANIFEST = JSON.stringify({ name: 'Mythera Dispatch', short_name: 'Mythera', display: 'standalone', background_color: '#0b0e14', theme_color: '#7c5cff', start_url: '.', icons: [] });

// Мобильно-дружественный веб-интерфейс (основа будущего мобильного приложения / PWA).
const WEB_UI = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="manifest" href="/manifest.json"><title>Mythera Dispatch</title>
<style>
*{box-sizing:border-box;margin:0;font-family:system-ui,sans-serif}
body{background:#0b0e14;color:#e6e9f0;height:100vh;display:flex;flex-direction:column}
header{padding:12px 16px;background:#11151f;border-bottom:1px solid #232a3a;display:flex;gap:10px;align-items:center}
.dot{width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#7c5cff,#29d3c2)}
select,input,button{font-size:16px;border-radius:10px;border:1px solid #232a3a;background:#161b27;color:#e6e9f0;padding:10px}
#log{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:85%;padding:10px 13px;border-radius:14px;white-space:pre-wrap;line-height:1.4}
.u{align-self:flex-end;background:linear-gradient(135deg,#7c5cff,#29d3c2);color:#0b0e14}
.b{align-self:flex-start;background:#161b27;border:1px solid #232a3a}
footer{padding:10px;display:flex;gap:8px;border-top:1px solid #232a3a}
#text{flex:1}
.gate{margin:auto;max-width:360px;padding:24px;text-align:center}
</style></head><body>
<div id="gate" class="gate">
  <div class="dot" style="margin:0 auto 14px;width:42px;height:42px"></div>
  <h2>Mythera Dispatch</h2>
  <p style="color:#8a93a8;margin:10px 0">Enter the access token shown in the app (Dispatch section).</p>
  <input id="tok" placeholder="token" style="width:100%;margin:10px 0">
  <button onclick="auth()" style="width:100%;background:linear-gradient(135deg,#7c5cff,#29d3c2);color:#0b0e14;font-weight:700;border:none">Connect</button>
</div>
<div id="app" style="display:none;flex-direction:column;height:100%">
  <header><div class="dot"></div><b>Mythera</b><select id="agent" style="margin-left:auto"></select></header>
  <div id="log"></div>
  <footer><input id="text" placeholder="Message…" onkeydown="if(event.key==='Enter')sendMsg()"><button onclick="sendMsg()">Send</button></footer>
</div>
<script>
let TOKEN=localStorage.getItem('mythera_tok')||'';
const $=s=>document.querySelector(s);
async function api(p,opt={}){opt.headers=Object.assign({'x-token':TOKEN,'content-type':'application/json'},opt.headers||{});const r=await fetch(p,opt);if(r.status===401)throw 0;return r.json();}
async function auth(){TOKEN=$('#tok').value.trim()||TOKEN;try{const d=await api('/api/agents');localStorage.setItem('mythera_tok',TOKEN);$('#gate').style.display='none';$('#app').style.display='flex';d.agents.forEach(a=>{const o=document.createElement('option');o.value=a.id;o.textContent=(a.icon||'')+' '+a.name;$('#agent').appendChild(o);});}catch(e){alert('Invalid token');}}
function add(t,cls){const d=document.createElement('div');d.className='msg '+cls;d.textContent=t;$('#log').appendChild(d);$('#log').scrollTop=1e9;return d;}
async function sendMsg(){const t=$('#text').value.trim();if(!t)return;$('#text').value='';add(t,'u');const b=add('…','b');try{const r=await api('/api/chat',{method:'POST',body:JSON.stringify({agentId:$('#agent').value,message:t})});b.textContent=r.text||'(no reply)';}catch(e){b.textContent='Error / token expired';}}
if(TOKEN)auth();
</script></body></html>`;

module.exports = { start, stop, status, regenToken, cloudRelayPlaceholder };
