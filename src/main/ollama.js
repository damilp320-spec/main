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

// Прогрев модели: пустой запрос загружает её в память (keep_alive держит её там),
// чтобы первый реальный ответ не ждал «холодной» загрузки (часто 2-10 с).
async function preload(model, keepAlive) {
  if (!model) return { ok: false };
  try { await request('POST', '/api/generate', { model, prompt: '', keep_alive: keepAlive != null ? keepAlive : '30m' }); return { ok: true, model }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// Стриминговый чат с поддержкой инструментов (tool calling).
// keepAlive держит модель «тёплой»; format ('json') ограничивает вывод.
function chatStream({ model, messages, tools, options, keepAlive, format }, onChunk) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model, messages, tools: tools || undefined, options: options || undefined, keep_alive: keepAlive != null ? keepAlive : undefined, format: format || undefined, stream: true });
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
      const store = require('./store');
      const cmd = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
      // Каталог хранения моделей (выбор диска пользователем) через OLLAMA_MODELS.
      const env = { ...process.env };
      const modelsDir = store.get('settings.modelsDir', null);
      if (modelsDir) {
        try { require('fs').mkdirSync(modelsDir, { recursive: true }); } catch { /* noop */ }
        env.OLLAMA_MODELS = modelsDir;
      }
      // Ускорение инференса (применяется, когда сервер стартует из приложения):
      env.OLLAMA_KEEP_ALIVE = store.get('settings.keepAlive', '30m') || '30m';        // держим модели «тёплыми»
      if (store.get('settings.flashAttn', true)) env.OLLAMA_FLASH_ATTENTION = '1';     // flash-attention: быстрее и меньше памяти
      const kv = store.get('settings.kvCacheType', '');                                // квантованный KV-кэш
      if (kv) env.OLLAMA_KV_CACHE_TYPE = kv;
      const par = parseInt(store.get('settings.numParallel', 0), 10);
      if (par > 0) env.OLLAMA_NUM_PARALLEL = String(par);
      const proc = spawn(cmd, ['serve'], { detached: true, stdio: 'ignore', env });
      proc.unref();
      setTimeout(async () => resolve(await status()), 1500);
    } catch (e) {
      resolve({ running: false, error: e.message });
    }
  });
}

module.exports = { status, listModels, deleteModel, chatStream, startServer, request, preload };
