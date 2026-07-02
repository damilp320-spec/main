// Единая лента активности (аудит). Собирает в одном месте всё, что делают
// автономные агенты: вызовы инструментов, команды терминала, сделки, сработавшие
// наблюдатели/планировщик, автоматизации. Это повышает доверие и наблюдаемость —
// пользователь видит и может проверить каждое действие.
const store = require('./store');

const KEY = 'activityLog';
const MAX = 600; // кольцевой буфер: храним последние N событий

let emit = null;
function setUISender(fn) { emit = fn; }

function list({ type, source, limit = 200, since } = {}) {
  let items = store.get(KEY, []);
  if (type) items = items.filter((e) => e.type === type);
  if (source) items = items.filter((e) => e.source === source);
  if (since) items = items.filter((e) => e.at >= since);
  return items.slice(-Math.max(1, Math.min(limit, MAX))).reverse();
}

function clear() { store.set(KEY, []); return { ok: true }; }

// Сводка: счётчики по типам и за последние сутки — для шапки раздела.
function stats() {
  const items = store.get(KEY, []);
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const byType = {};
  let errors = 0; let today = 0;
  for (const e of items) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.level === 'error') errors++;
    if (e.at >= dayAgo) today++;
  }
  return { total: items.length, today, errors, byType };
}

// Запись события. level: info|warn|error|success. Возвращает запись.
function log({ type = 'event', title = '', detail = '', level = 'info', source = '' } = {}) {
  try {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: Date.now(), type, title: String(title).slice(0, 200),
      detail: String(detail || '').slice(0, 500), level, source: String(source || '').slice(0, 40)
    };
    const items = store.get(KEY, []);
    items.push(entry);
    if (items.length > MAX) items.splice(0, items.length - MAX);
    store.set(KEY, items);
    if (emit) { try { emit('activity:added', entry); } catch {} }
    return entry;
  } catch { return null; }
}

module.exports = { setUISender, log, list, clear, stats, MAX };
