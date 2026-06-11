// Перевод больших массивов данных: разбивка на чанки, перевод локальной
// моделью, склейка. Поддерживает обычный текст, JSON-значения и .properties.
const fs = require('fs');
const path = require('path');
const ollama = require('./ollama');
const system = require('./system');

const CHUNK_CHARS = 2500;

function splitText(text) {
  const chunks = [];
  const paras = text.split(/\n\s*\n/);
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > CHUNK_CHARS && buf) { chunks.push(buf); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  if (buf) chunks.push(buf);
  // Очень длинные абзацы режем жёстко.
  return chunks.flatMap((c) => c.length <= CHUNK_CHARS * 1.5 ? [c] : c.match(new RegExp(`[\\s\\S]{1,${CHUNK_CHARS}}`, 'g')));
}

async function translateChunk(model, text, targetLang, sourceLang) {
  const sys = `Ты профессиональный переводчик. Переведи текст ${sourceLang && sourceLang !== 'auto' ? 'с ' + sourceLang + ' ' : ''}на язык: ${targetLang}. Сохраняй форматирование, разметку, плейсхолдеры ({0}, %s, §a и т.п.) и структуру. Верни ТОЛЬКО перевод без пояснений.`;
  const res = await ollama.chatStream({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: text }] }, null);
  return (res.content || '').trim();
}

// Перевод произвольного текста с прогрессом.
async function translateText({ model, text, targetLang, sourceLang }, onProgress) {
  const chunks = splitText(text);
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress && onProgress({ percent: Math.round((i / chunks.length) * 100), message: `Чанк ${i + 1}/${chunks.length}` });
    out.push(await translateChunk(model, chunks[i], targetLang, sourceLang));
  }
  onProgress && onProgress({ percent: 100, message: 'Готово' });
  return out.join('\n\n');
}

// Перевод JSON: переводим только строковые значения, ключи не трогаем.
async function translateJson({ model, json, targetLang, sourceLang }, onProgress) {
  const strings = [];
  const collect = (v) => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(json);
  const unique = [...new Set(strings.filter((s) => s.trim().length > 1))];
  const map = {};
  for (let i = 0; i < unique.length; i++) {
    onProgress && onProgress({ percent: Math.round((i / unique.length) * 100), message: `Строка ${i + 1}/${unique.length}` });
    map[unique[i]] = await translateChunk(model, unique[i], targetLang, sourceLang);
  }
  const apply = (v) => {
    if (typeof v === 'string') return map[v] ?? v;
    if (Array.isArray(v)) return v.map(apply);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = apply(v[k]); return o; }
    return v;
  };
  onProgress && onProgress({ percent: 100, message: 'Готово' });
  return apply(json);
}

// Перевод файла из рабочего пространства; результат — рядом с суффиксом .translated.
async function translateFile({ model, file, targetLang, sourceLang }, onProgress) {
  const full = path.isAbsolute(file) ? file : path.join(system.safeRoot(), file);
  if (!fs.existsSync(full)) return { ok: false, error: 'Файл не найден: ' + full };
  const ext = path.extname(full).toLowerCase();
  const raw = fs.readFileSync(full, 'utf8');
  let result, outPath;
  if (ext === '.json') {
    const obj = JSON.parse(raw);
    result = JSON.stringify(await translateJson({ model, json: obj, targetLang, sourceLang }, onProgress), null, 2);
  } else {
    result = await translateText({ model, text: raw, targetLang, sourceLang }, onProgress);
  }
  outPath = full.replace(new RegExp(`(\\${ext})?$`), `.${shortLang(targetLang)}${ext}`);
  fs.writeFileSync(outPath, result, 'utf8');
  return { ok: true, outPath };
}

function shortLang(l) { return String(l).toLowerCase().slice(0, 2).replace(/[^a-z]/g, '') || 'tr'; }

/* ------ Инструмент для агентов ------ */
const toolSchemas = [
  { type: 'function', function: { name: 'translate_file', description: 'Перевести файл (текст/JSON/локализацию) на другой язык. Большие файлы обрабатываются по частям.', parameters: { type: 'object', properties: { file: { type: 'string' }, targetLang: { type: 'string' }, sourceLang: { type: 'string' } }, required: ['file', 'targetLang'] } } }
];

const toolHandlers = {
  async translate_file({ file, targetLang, sourceLang }) {
    const model = require('./store').get('settings.translateModel', 'qwen2.5:7b');
    const r = await translateFile({ model, file, targetLang, sourceLang: sourceLang || 'auto' }, null);
    return r.ok ? 'Переведено: ' + r.outPath : 'Ошибка: ' + r.error;
  }
};

module.exports = { translateText, translateJson, translateFile, splitText, toolSchemas, toolHandlers };
