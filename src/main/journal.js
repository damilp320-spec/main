// Журнал сделок с ИИ-разбором: ручные записи + импорт закрытых сделок с
// бумажного счёта; модель анализирует паттерны и ошибки.
const store = require('./store');
const { randomUUID } = require('crypto');

function list() { return store.get('tradeJournal', []).slice().sort((a, b) => (b.date || 0) - (a.date || 0)); }
function save(e) {
  const all = store.get('tradeJournal', []);
  e.symbol = String(e.symbol || '').toUpperCase();
  e.date = e.date || Date.now();
  if (!e.id) { e.id = 'j-' + randomUUID().slice(0, 8); all.push(e); }
  else { const i = all.findIndex((x) => x.id === e.id); if (i >= 0) all[i] = e; else all.push(e); }
  store.set('tradeJournal', all.slice(-1000)); return e;
}
function remove(id) { store.set('tradeJournal', store.get('tradeJournal', []).filter((e) => e.id !== id)); return { ok: true }; }

// Импорт закрытых сделок (sell с P&L) с бумажного счёта.
function syncPaper() {
  const paper = require('./paper');
  const hist = paper.state().history || [];
  const all = store.get('tradeJournal', []);
  const have = new Set(all.map((e) => e.ref).filter(Boolean));
  let added = 0;
  for (const h of hist) {
    if (h.side !== 'sell' || h.pnl == null) continue;
    const ref = 'paper:' + h.at + ':' + h.symbol;
    if (have.has(ref)) continue;
    all.push({ id: 'j-' + randomUUID().slice(0, 8), ref, symbol: h.symbol, side: 'sell', qty: h.qty, price: h.price, pnl: h.pnl, date: h.at, reason: h.reason || '', source: h.source || 'paper', outcome: h.pnl >= 0 ? 'win' : 'loss', notes: '' });
    added++;
  }
  store.set('tradeJournal', all.slice(-1000));
  return { ok: true, added };
}

function stats() {
  const all = list().filter((e) => e.pnl != null);
  if (!all.length) return { count: 0 };
  const wins = all.filter((e) => e.pnl > 0);
  const totalPnl = all.reduce((s, e) => s + (+e.pnl || 0), 0);
  const avgWin = wins.length ? wins.reduce((s, e) => s + e.pnl, 0) / wins.length : 0;
  const losses = all.filter((e) => e.pnl <= 0);
  const avgLoss = losses.length ? losses.reduce((s, e) => s + e.pnl, 0) / losses.length : 0;
  return { count: all.length, winRate: +((wins.length / all.length) * 100).toFixed(1), totalPnl: +totalPnl.toFixed(2), avgWin: +avgWin.toFixed(2), avgLoss: +avgLoss.toFixed(2), profitFactor: avgLoss ? +Math.abs((avgWin * wins.length) / (avgLoss * losses.length || 1)).toFixed(2) : null };
}

async function review() {
  const all = list().slice(0, 40);
  if (!all.length) return { ok: false, error: 'Журнал пуст.' };
  const ollama = require('./ollama');
  const model = store.get('settings.defaultModel', '') || 'qwen2.5:7b';
  const s = stats();
  const rows = all.map((e) => `${new Date(e.date).toLocaleDateString()} ${e.symbol} ${e.side} ${e.qty}@${e.price}${e.pnl != null ? ' P&L ' + e.pnl : ''}${e.reason ? ' [' + e.reason + ']' : ''}${e.notes ? ' — ' + e.notes : ''}`).join('\n');
  const sys = 'Ты — торговый коуч. По журналу сделок найди ПАТТЕРНЫ (что работает), ТИПИЧНЫЕ ОШИБКИ и дай 3-5 конкретных рекомендаций. Кратко, по-русски. Не инвестрекомендация.';
  try {
    const r = await ollama.chatStream({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: `Статистика: винрейт ${s.winRate}%, сделок ${s.count}, итог P&L ${s.totalPnl}, ср.прибыль ${s.avgWin}, ср.убыток ${s.avgLoss}.\n\nСделки:\n${rows}` }], options: { temperature: 0.4 } }, null);
    return { ok: true, text: (r.content || '').trim(), stats: s };
  } catch (e) { return { ok: false, error: e.message }; }
}

const toolSchemas = [
  { type: 'function', function: { name: 'journal_review', description: 'ИИ-разбор журнала сделок: паттерны, ошибки, рекомендации.', parameters: { type: 'object', properties: {} } } }
];
const toolHandlers = { journal_review: async () => { const r = await review(); return r.ok ? r.text : ('ОШИБКА: ' + r.error); } };

module.exports = { list, save, remove, syncPaper, stats, review, toolSchemas, toolHandlers };
