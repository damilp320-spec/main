// Бумажный (симуляционный) торговый счёт: безопасная площадка для ИИ-бота и
// ручной торговли без реальных денег. Хранит наличные, позиции и историю сделок.
const store = require('./store');

const KEY = 'paperAccount';
function acc() {
  const a = store.get(KEY, null);
  if (!a) { const fresh = { cash: 100000, start: 100000, positions: {}, history: [], createdAt: Date.now() }; store.set(KEY, fresh); return fresh; }
  return a;
}
function persist(a) { a.history = a.history.slice(-500); store.set(KEY, a); }

function reset(startCash) {
  const c = +startCash || 100000;
  store.set(KEY, { cash: c, start: c, positions: {}, history: [], createdAt: Date.now() });
  return { ok: true };
}

// Купить/продать по заданной цене. side: 'buy'|'sell'. qty — штук.
function trade({ symbol, side, qty, price, reason, source }) {
  symbol = String(symbol || '').toUpperCase(); qty = Math.max(0, +qty || 0); price = +price || 0;
  if (!symbol || !qty || !price) return { ok: false, error: 'Некорректные параметры сделки.' };
  const a = acc();
  const pos = a.positions[symbol] || { qty: 0, avg: 0 };
  if (side === 'buy') {
    const cost = qty * price;
    if (cost > a.cash) return { ok: false, error: 'Недостаточно средств на бумажном счёте.' };
    a.cash -= cost;
    const total = pos.qty + qty;
    pos.avg = total ? (pos.avg * pos.qty + cost) / total : price;
    pos.qty = total;
    a.positions[symbol] = pos;
  } else {
    if (pos.qty < qty) return { ok: false, error: 'Недостаточно бумаг для продажи.' };
    a.cash += qty * price;
    const pnl = (price - pos.avg) * qty;
    pos.qty -= qty;
    if (pos.qty <= 0.0000001) delete a.positions[symbol]; else a.positions[symbol] = pos;
    a.history.push({ at: Date.now(), symbol, side, qty, price, pnl: +pnl.toFixed(2), reason: reason || '', source: source || 'manual' });
    persist(a);
    return { ok: true, pnl: +pnl.toFixed(2) };
  }
  a.history.push({ at: Date.now(), symbol, side, qty, price, reason: reason || '', source: source || 'manual' });
  persist(a);
  return { ok: true };
}

// Оценка стоимости счёта по текущим ценам { symbol: price }.
function valuation(quotes) {
  const a = acc(); let posVal = 0; const positions = [];
  for (const [sym, p] of Object.entries(a.positions)) {
    const cur = (quotes && quotes[sym]) || p.avg;
    const val = p.qty * cur; posVal += val;
    positions.push({ symbol: sym, qty: p.qty, avg: p.avg, price: cur, value: +val.toFixed(2), pnl: +((cur - p.avg) * p.qty).toFixed(2), pnlPct: +(((cur - p.avg) / p.avg) * 100).toFixed(2) });
  }
  const equity = a.cash + posVal;
  return { cash: +a.cash.toFixed(2), positions, equity: +equity.toFixed(2), start: a.start, totalPnl: +(equity - a.start).toFixed(2), totalPnlPct: +(((equity - a.start) / a.start) * 100).toFixed(2), trades: a.history.length };
}
function state() { return acc(); }
function history() { return acc().history.slice(-60).reverse(); }

module.exports = { reset, trade, valuation, state, history };
