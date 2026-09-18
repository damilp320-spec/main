// Облачный мост (опционально): эскалация к мощной облачной модели, когда
// локальной не хватает. Приватность по умолчанию — выключено; работает только
// при явно заданном пользователем API-ключе. Поддержка OpenAI-совместимого
// API (OpenAI, Together, Groq, OpenRouter, локальные прокси) и Anthropic.
// Ключ хранится зашифрованно через secrets (safeStorage).
const https = require('https');
const store = require('./store');

function secrets() { try { return require('./secrets'); } catch { return null; } }

function getKey() {
  const enc = store.get('settings.cloudApiKeyEnc', '');
  const s = secrets();
  if (enc && s && s.decrypt) { try { const k = s.decrypt(enc); if (k) return k; } catch {} }
  return store.get('settings.cloudApiKey', '') || ''; // запасной путь (не шифрованный)
}
function setKey(key) {
  const s = secrets();
  if (key && s && s.available && s.available() && s.encrypt) {
    try { store.set('settings.cloudApiKeyEnc', s.encrypt(key)); store.set('settings.cloudApiKey', ''); return { ok: true, encrypted: true }; } catch {}
  }
  store.set('settings.cloudApiKey', key || ''); // safeStorage недоступен — пишем как есть
  if (!key) store.set('settings.cloudApiKeyEnc', '');
  return { ok: true, encrypted: false };
}

function enabled() { return store.get('settings.cloudEnabled', false) && !!getKey(); }

function cfg() {
  return {
    provider: store.get('settings.cloudProvider', 'openai'), // 'openai' | 'anthropic'
    baseUrl: store.get('settings.cloudBaseUrl', ''),         // напр. https://openrouter.ai/api/v1
    model: store.get('settings.cloudModel', 'gpt-4o-mini')
  };
}

function postJSON(host, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({ host, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => { let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } }); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function parseBase(url, def) {
  try { const u = new URL(url || def); return { host: u.host, base: u.pathname.replace(/\/$/, '') }; }
  catch { const u = new URL(def); return { host: u.host, base: u.pathname.replace(/\/$/, '') }; }
}

// Один запрос к облаку. messages — стандартный формат [{role,content}].
async function ask(messages, opts = {}) {
  if (!getKey()) return { ok: false, error: 'Не задан облачный API-ключ.' };
  const c = cfg();
  const key = getKey();
  try {
    if (c.provider === 'anthropic') {
      const { host, base } = parseBase(c.baseUrl, 'https://api.anthropic.com');
      const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));
      const r = await postJSON(host, base + '/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model: c.model || 'claude-3-5-sonnet-latest', max_tokens: opts.max_tokens || 1024, system: sys || undefined, messages: msgs });
      if (r.status >= 400) return { ok: false, error: 'Облако: ' + (r.body && r.body.error && r.body.error.message || r.status) };
      const text = (r.body && r.body.content && r.body.content.map((b) => b.text || '').join('')) || '';
      return { ok: true, text, model: c.model };
    }
    // OpenAI-совместимый по умолчанию.
    const { host, base } = parseBase(c.baseUrl, 'https://api.openai.com/v1');
    const r = await postJSON(host, base + '/chat/completions', { Authorization: 'Bearer ' + key },
      { model: c.model || 'gpt-4o-mini', messages, temperature: opts.temperature != null ? opts.temperature : 0.7, max_tokens: opts.max_tokens || 1024 });
    if (r.status >= 400) return { ok: false, error: 'Облако: ' + (r.body && r.body.error && r.body.error.message || r.status) };
    const text = (r.body && r.body.choices && r.body.choices[0] && r.body.choices[0].message && r.body.choices[0].message.content) || '';
    return { ok: true, text, model: c.model };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function test() {
  const r = await ask([{ role: 'user', content: 'Ответь одним словом: ОК' }], { max_tokens: 10 });
  return r.ok ? { ok: true, model: r.model, sample: (r.text || '').trim().slice(0, 40) } : r;
}

module.exports = { ask, test, enabled, getKey, setKey, cfg, hasKey: () => !!getKey() };
