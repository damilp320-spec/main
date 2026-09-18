// Маршрутизатор моделей: автоматически подбирает наиболее подходящую из
// УСТАНОВЛЕННЫХ моделей под тип подзадачи — кодер для кода, мультимодальная
// для экрана, быстрая маленькая для болтовни. Это повышает качество без
// ручного переключения моделей пользователем.
const ollama = require('./ollama');
const store = require('./store');

let cache = { at: 0, names: [] };

async function installed() {
  // Кэш на 30 секунд, чтобы не дёргать Ollama на каждый шаг агента.
  if (Date.now() - cache.at < 30000 && cache.names.length) return cache.names;
  try {
    const list = await ollama.listModels();
    cache = { at: Date.now(), names: list.map((m) => m.name || m.model).filter(Boolean) };
  } catch { /* оставляем старый кэш */ }
  return cache.names;
}

// Признаки моделей по имени.
const isCoder = (n) => /coder|code|devstral|deepseek-coder|starcoder|codestral|codeqwen/i.test(n);
const isVision = (n) => /llava|vision|-vl|llama3.2-vision|moondream|minicpm-v|bakllava|qwen2.?vl/i.test(n);
const isSmall = (n) => /(:|-)(0\.5|1|1\.5|2|3)b|llama3\.2:(1|3)b|qwen2\.5:(0\.5|1\.5|3)b|phi|gemma2:2b|smollm/i.test(n);

// Оценка «размера» модели для выбора самой мощной/самой лёгкой.
function sizeRank(n) {
  const m = /(\d+(?:\.\d+)?)\s*b/i.exec(n);
  return m ? parseFloat(m[1]) : 7;
}

// Выбрать модель под вид задачи. kind: 'code' | 'vision' | 'fast' | 'chat'.
// fallback — модель агента; возвращаем её, если ничего лучше нет или роутер выключен.
async function pick(kind, fallback) {
  if (!store.get('settings.modelRouting', false)) return fallback;
  const names = await installed();
  if (!names.length) return fallback;

  let pool = names;
  if (kind === 'code') pool = names.filter(isCoder);
  else if (kind === 'vision') pool = names.filter(isVision);
  else if (kind === 'fast') pool = names.filter(isSmall);

  if (!pool.length) {
    // Нет специализированной — возвращаем дефолт (для vision это важно: без
    // мультимодальной модели скриншот бесполезен, но пусть решает вызывающий).
    return fallback;
  }
  // Для кода/зрения берём самую мощную из подходящих, для fast — самую лёгкую.
  pool.sort((a, b) => kind === 'fast' ? sizeRank(a) - sizeRank(b) : sizeRank(b) - sizeRank(a));
  return pool[0] || fallback;
}

// Есть ли вообще мультимодальная модель (чтобы решать, предлагать ли скриншот).
async function hasVision() {
  return (await installed()).some(isVision);
}

function invalidate() { cache = { at: 0, names: [] }; }

module.exports = { pick, hasVision, installed, invalidate, isCoder, isVision, isSmall };
