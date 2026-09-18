// Локальная генерация изображений: мост к Stable Diffusion WebUI
// (Automatic1111-совместимый API, по умолчанию http://127.0.0.1:7860).
// Всё работает локально и приватно. Без внешних зависимостей — только HTTP.
// Также даёт агентам инструмент generate_image (результат — в панель артефактов).
const http = require('http');
const store = require('./store');

let uiSender = null;
function setUISender(fn) { uiSender = fn; }

function baseUrl() { return store.get('settings.sdUrl', 'http://127.0.0.1:7860'); }

function req(method, path, body, timeoutMs) {
  return new Promise((resolve) => {
    let u; try { u = new URL(baseUrl() + path); } catch (e) { return resolve({ ok: false, error: 'Неверный адрес SD: ' + e.message }); }
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => { let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => {
        if (res.statusCode >= 400) return resolve({ ok: false, error: 'SD HTTP ' + res.statusCode });
        try { resolve({ ok: true, data: JSON.parse(buf) }); } catch { resolve({ ok: false, error: 'Некорректный ответ SD' }); }
      }); });
    r.on('error', (e) => resolve({ ok: false, error: e.message + ' (запущен ли Stable Diffusion WebUI с флагом --api?)' }));
    r.setTimeout(timeoutMs || 180000, () => r.destroy(new Error('таймаут генерации')));
    if (data) r.write(data); r.end();
  });
}

async function status() {
  const r = await req('GET', '/sdapi/v1/sd-models', null, 5000);
  if (!r.ok) return { ok: false, error: r.error };
  const cur = await req('GET', '/sdapi/v1/options', null, 5000);
  return { ok: true, models: (r.data || []).map((m) => m.model_name || m.title), current: cur.ok ? cur.data.sd_model_checkpoint : null };
}

async function generate({ prompt, negative, steps, width, height, sampler, cfg, seed }) {
  if (!prompt || !String(prompt).trim()) return { ok: false, error: 'Пустой промпт' };
  const body = {
    prompt: String(prompt), negative_prompt: String(negative || ''),
    steps: Math.min(60, Math.max(1, +steps || 24)),
    width: +width || 512, height: +height || 512,
    sampler_name: sampler || 'Euler a', cfg_scale: +cfg || 7,
    seed: (seed != null && seed !== '') ? +seed : -1, n_iter: 1, batch_size: 1
  };
  const r = await req('POST', '/sdapi/v1/txt2img', body);
  if (!r.ok) return r;
  const img = r.data && r.data.images && r.data.images[0];
  if (!img) return { ok: false, error: 'SD не вернул изображение' };
  let info = {}; try { info = JSON.parse(r.data.info || '{}'); } catch {}
  return { ok: true, base64: img, seed: info.seed, width: body.width, height: body.height };
}

const toolSchemas = [
  { type: 'function', function: { name: 'generate_image', description: 'Сгенерировать изображение по текстовому описанию (локальный Stable Diffusion). Результат покажется в панели артефактов.', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Что нарисовать (лучше по-английски)' }, negative: { type: 'string', description: 'Что исключить' } }, required: ['prompt'] } } }
];
const toolHandlers = {
  generate_image: async (a) => {
    const r = await generate({ prompt: a.prompt, negative: a.negative });
    if (!r.ok) return 'ОШИБКА генерации изображения: ' + r.error;
    uiSender && uiSender('artifact:image', { title: 'Сгенерировано: ' + String(a.prompt).slice(0, 40), base64: r.base64 });
    return 'Изображение сгенерировано и показано в панели артефактов (seed ' + (r.seed != null ? r.seed : '?') + ').';
  }
};

module.exports = { setUISender, status, generate, toolSchemas, toolHandlers };
