// Аналитика и инсайты по работе агентов. Агрегирует уже собираемые данные —
// телеметрию запусков (telemetryLog) и ленту активности (activityLog) — в сводку
// для дашборда. Чистое чтение, без новых зависимостей и без побочных эффектов.
const store = require('./store');

const DAY = 86400000;

function summary() {
  const tel = store.get('telemetryLog', []);
  const acts = store.get('activityLog', []);
  const now = Date.now();
  const runs = tel.length;

  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const totalTokens = sum(tel, (t) => t.tokens);
  const totalToolCalls = sum(tel, (t) => t.toolCalls);
  const totalSteps = sum(tel, (t) => t.steps);
  const avgMs = runs ? Math.round(sum(tel, (t) => t.ms) / runs) : 0;
  const avgTps = runs ? +(sum(tel, (t) => t.tokPerSec) / runs).toFixed(1) : 0;

  // По агентам.
  const ba = {};
  tel.forEach((t) => {
    const k = t.agentName || t.agentId || '?';
    const e = (ba[k] = ba[k] || { runs: 0, ms: 0, tokens: 0 });
    e.runs++; e.ms += t.ms || 0; e.tokens += t.tokens || 0;
  });
  const agents = Object.entries(ba).map(([name, v]) => ({ name, runs: v.runs, avgMs: Math.round(v.ms / v.runs), tokens: v.tokens }))
    .sort((a, b) => b.runs - a.runs).slice(0, 8);

  // По моделям.
  const bm = {};
  tel.forEach((t) => { const k = t.model || '?'; bm[k] = (bm[k] || 0) + 1; });
  const models = Object.entries(bm).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);

  // Запуски по дням (последние 14).
  const days = [];
  const idx = {};
  for (let i = 13; i >= 0; i--) {
    const key = new Date(now - i * DAY).toISOString().slice(0, 10);
    idx[key] = days.length; days.push({ day: key, runs: 0 });
  }
  tel.forEach((t) => { const k = new Date(t.at || now).toISOString().slice(0, 10); if (k in idx) days[idx[k]].runs++; });

  // Топ инструментов (из ленты активности).
  const bt = {};
  acts.filter((a) => a.type === 'tool').forEach((a) => { bt[a.source] = (bt[a.source] || 0) + 1; });
  const tools = Object.entries(bt).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 10);

  const errors = acts.filter((a) => a.level === 'error').length;
  const actToday = acts.filter((a) => (a.at || 0) >= now - DAY).length;
  const reasoning = acts.filter((a) => a.type === 'reason').length;
  const trades = acts.filter((a) => a.type === 'trade').length;

  return {
    runs, totalTokens, totalToolCalls, totalSteps, avgMs, avgTps,
    agents, models, days, tools,
    actions: acts.length, errors, actToday, reasoning, trades
  };
}

module.exports = { summary };
