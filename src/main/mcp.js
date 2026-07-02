// Клиент Model Context Protocol (MCP): подключаемся к внешним MCP-серверам по
// stdio (JSON-RPC 2.0, построчно), обнаруживаем их инструменты и пробрасываем
// их агентам как обычные tool-calls с префиксом mcp_<server>_<tool>.
// Без внешних зависимостей — чистый child_process + JSON.
const { spawn } = require('child_process');
const store = require('./store');

const PROTOCOL_VERSION = '2024-11-05';
const servers = new Map(); // id -> { proc, nextId, pending, tools, name, ready }

function cfg() { return store.get('settings.mcpServers', []) || []; }

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24); }

function send(s, msg) {
  try { s.proc.stdin.write(JSON.stringify(msg) + '\n'); } catch { /* канал закрыт */ }
}

function rpc(s, method, params) {
  const id = s.nextId++;
  send(s, { jsonrpc: '2.0', id, method, params: params || {} });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.pending.delete(id); reject(new Error('MCP timeout: ' + method)); }, 20000);
    s.pending.set(id, { resolve, reject, timer });
  });
}

function handleLine(s, line) {
  line = line.trim(); if (!line) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id != null && s.pending.has(msg.id)) {
    const p = s.pending.get(msg.id); s.pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'));
    else p.resolve(msg.result);
  }
}

async function connectOne(c) {
  if (!c || !c.command || c.enabled === false) return;
  const id = c.id || slug(c.name || c.command);
  if (servers.has(id)) return; // уже подключён
  let proc;
  try {
    proc = spawn(c.command, c.args || [], { env: { ...process.env, ...(c.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { throw new Error(`MCP «${id}»: не удалось запустить (${e.message})`); }
  const s = { proc, nextId: 1, pending: new Map(), tools: [], name: c.name || id, ready: false };
  servers.set(id, s);
  let buf = '';
  proc.stdout.on('data', (d) => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { handleLine(s, buf.slice(0, nl)); buf = buf.slice(nl + 1); } });
  proc.on('exit', () => { servers.delete(id); });
  proc.on('error', () => { servers.delete(id); });

  await rpc(s, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Mythera', version: '1.0' } });
  send(s, { jsonrpc: '2.0', method: 'notifications/initialized' });
  try {
    const r = await rpc(s, 'tools/list', {});
    s.tools = (r && r.tools) || [];
  } catch { s.tools = []; }
  s.ready = true;
  return { id, name: s.name, tools: s.tools.length };
}

// Подключить все настроенные серверы (вызывается при старте/изменении настроек).
async function connectAll() {
  if (!store.get('settings.mcpEnabled', false)) return [];
  const results = [];
  for (const c of cfg()) {
    try { const r = await connectOne(c); if (r) results.push(r); }
    catch (e) { results.push({ id: c.id || c.name, error: e.message }); }
  }
  return results;
}

function disconnectAll() {
  for (const [, s] of servers) { try { s.proc.kill(); } catch {} }
  servers.clear();
}

// Схемы инструментов всех подключённых серверов (для allToolSchemas).
function toolSchemas() {
  const out = [];
  for (const [id, s] of servers) {
    if (!s.ready) continue;
    for (const t of s.tools) {
      out.push({
        type: 'function',
        _mcp: { server: id, tool: t.name },
        function: {
          name: `mcp_${id}_${slug(t.name)}`,
          description: `[MCP:${s.name}] ${t.description || t.name}`,
          parameters: t.inputSchema || { type: 'object', properties: {} }
        }
      });
    }
  }
  return out;
}

function isMcpTool(name) { return /^mcp_/.test(name); }

// Вызов MCP-инструмента по сгенерированному имени.
async function callTool(name, args) {
  for (const [id, s] of servers) {
    if (!s.ready) continue;
    for (const t of s.tools) {
      if (`mcp_${id}_${slug(t.name)}` === name) {
        const r = await rpc(s, 'tools/call', { name: t.name, arguments: args || {} });
        // Результат MCP — массив content-блоков; склеиваем текст.
        if (r && Array.isArray(r.content)) return r.content.map((b) => b.text || b.json || '').filter(Boolean).join('\n') || 'OK';
        return typeof r === 'string' ? r : JSON.stringify(r);
      }
    }
  }
  return 'ОШИБКА: MCP-инструмент не найден: ' + name;
}

function listConnected() {
  return [...servers.entries()].map(([id, s]) => ({ id, name: s.name, ready: s.ready, tools: s.tools.map((t) => t.name) }));
}

// Управление конфигом серверов из UI.
function saveServer(c) {
  const list = cfg();
  const id = c.id || slug(c.name || c.command) || ('srv-' + Date.now());
  c.id = id;
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list[i] = c; else list.push(c);
  store.set('settings.mcpServers', list);
  return { ok: true, id };
}
function deleteServer(id) {
  store.set('settings.mcpServers', cfg().filter((x) => x.id !== id));
  const s = servers.get(id); if (s) { try { s.proc.kill(); } catch {} servers.delete(id); }
  return { ok: true };
}

module.exports = { connectAll, connectOne, disconnectAll, toolSchemas, isMcpTool, callTool, listConnected, saveServer, deleteServer, cfg };
