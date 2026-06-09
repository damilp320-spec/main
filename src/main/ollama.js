// Клиент локального Ollama-сервера (http://localhost:11434).
const http = require('http');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 11434;

function request(method, pathName, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: HOST, port: PORT, path: pathName, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
          catch { resolve({ status: res.statusCode, body: buf }); }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function status() {
  try {
    const r = await request('GET', '/api/tags');
    return { running: r.status === 200 };
  } catch {
    return { running: false };
  }
}

async function listModels() {
  try {
    const r = await request('GET', '/api/tags');
    return (r.body && r.body.models) || [];
  } catch {
    return [];
  }
}

async function deleteModel(name) {
  try {
    await request('DELETE', '/api/delete', { name });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Стриминговый чат с поддержкой инструментов (tool calling).
function chatStream({ model, messages, tools }, onChunk) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model, messages, tools: tools || undefined, stream: true });
    const req = http.request(
      { host: HOST, port: PORT, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let buf = '';
        let full = '';
        let toolCalls = [];
        res.on('data', (c) => {
          buf += c;
          let nl;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.message) {
                if (obj.message.content) { full += obj.message.content; onChunk && onChunk(obj.message.content); }
                if (obj.message.tool_calls) toolCalls = toolCalls.concat(obj.message.tool_calls);
              }
            } catch { /* ignore partial */ }
          }
        });
        res.on('end', () => resolve({ content: full, toolCalls }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function startServer() {
  return new Promise((resolve) => {
    try {
      const cmd = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
      const proc = spawn(cmd, ['serve'], { detached: true, stdio: 'ignore' });
      proc.unref();
      setTimeout(async () => resolve(await status()), 1500);
    } catch (e) {
      resolve({ running: false, error: e.message });
    }
  });
}

module.exports = { status, listModels, deleteModel, chatStream, startServer, request };
