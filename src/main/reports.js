// Отчёты и сводки: агрегирование телеметрии агентов и подготовка данных для
// экспорта (диалоги, портфель, журнал сделок). Генерацию текста отчётов
// (Markdown) и скачивание выполняет рендерер; здесь — агрегаты и выборки.
const store = require('./store');

// Сводка телеметрии «как работают агенты».
function telemetrySummary() {
  const log = store.get('telemetryLog', []);
  if (!log.length) return { count: 0, byModel: [], totalTokens: 0, avgTps: 0, avgMs: 0, recent: [] };
  let totalTokens = 0, totalMs = 0, totalToolCalls = 0;
  const models = {};
  for (const e of log) {
    totalTokens += e.tokens || 0; totalMs += e.ms || 0; totalToolCalls += e.toolCalls || 0;
    const m = e.model || '?';
    if (!models[m]) models[m] = { model: m, count: 0, tokens: 0, ms: 0 };
    models[m].count++; models[m].tokens += e.tokens || 0; models[m].ms += e.ms || 0;
  }
  const byModel = Object.values(models).map((m) => ({ model: m.model, count: m.count, tokens: m.tokens, avgTps: m.ms > 0 ? +(m.tokens / (m.ms / 1000)).toFixed(1) : 0 })).sort((a, b) => b.count - a.count);
  return {
    count: log.length, totalTokens, totalToolCalls,
    avgTps: totalMs > 0 ? +(totalTokens / (totalMs / 1000)).toFixed(1) : 0,
    avgMs: Math.round(totalMs / log.length),
    byModel,
    recent: log.slice(-30).reverse()
  };
}

function telemetryClear() { store.set('telemetryLog', []); return { ok: true }; }

module.exports = { telemetrySummary, telemetryClear };
