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

// ---- Кривая капитала (mark-to-market во времени) ----
const EQKEY = 'paperEquityCurve';
function equityCurve() { return store.get(EQKEY, []); }
// Снимок текущей оценки счёта. quotes — { symbol: price } (для mark-to-market).
function snapshot(quotes) {
  const v = valuation(quotes || {});
  const curve = store.get(EQKEY, []);
  const last = curve[curve.length - 1];
  const now = Date.now();
  // Не плодим точки чаще 1 раза в минуту, если капитал почти не изменился.
  if (last && now - last.at < 60000 && Math.abs(v.equity - last.equity) < 0.01) return v;
  curve.push({ at: now, equity: v.equity, pnlPct: v.totalPnlPct });
  store.set(EQKEY, curve.slice(-1000));
  return v;
}

function reset(startCash) {
  const c = +startCash || 100000;
  store.set(KEY, { cash: c, start: c, positions: {}, history: [], createdAt: Date.now() });
  store.set(EQKEY, [{ at: Date.now(), equity: c, pnlPct: 0 }]);
  return { ok: true };
}

// Метрики по кривой капитала: доходность, макс. просадка, Sharpe (по точкам).
function equityStats() {
  const curve = equityCurve();
  if (curve.length < 2) return { ok: false, points: curve.length };
  const vals = curve.map((p) => p.equity);
  const start = vals[0], last = vals[vals.length - 1];
  const ret = (last / start - 1) * 100;
  let peak = -Infinity, maxDD = 0;
  for (const v of vals) { if (v > peak) peak = v; const dd = peak > 0 ? (peak - v) / peak * 100 : 0; if (dd > maxDD) maxDD = dd; }
  const rets = []; for (let i = 1; i < vals.length; i++) if (vals[i - 1] > 0) rets.push(vals[i] / vals[i - 1] - 1);
  const mean = rets.reduce((s, v) => s + v, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length || 1));
  const sharpe = sd ? +(mean / sd).toFixed(2) : 0; // на точку (без годовой нормировки)
  return { ok: true, return: +ret.toFixed(2), maxDrawdown: +maxDD.toFixed(2), sharpe, points: curve.length, start, last: +last.toFixed(2), since: curve[0].at };
}

// Бенчмарк «купил и держи»: нормируем индекс/актив к капиталу на окне кривой.
// fromTs — опциональное начало окна (для переключателя периода день/неделя/всё).
async function benchmark(symbol, fromTs) {
  const curve = equityCurve();
  if (curve.length < 2) return { ok: false, error: 'мало точек' };
  const markets = require('./markets');
  const t0 = fromTs && fromTs > curve[0].at ? fromTs : curve[0].at;
  const t1 = curve[curve.length - 1].at;
  const startPt = curve.find((p) => p.at >= t0) || curve[0];
  const startEq = startPt.equity;
  const spanDays = (t1 - t0) / 86400000;
  const range = spanDays > 365 ? '2y' : spanDays > 90 ? '1y' : spanDays > 20 ? '3mo' : '1mo';
  const d = await markets.candles({ symbol: symbol || '^GSPC', interval: '1d', range });
  if (!d.ok) return { ok: false, error: d.error };
  const inWin = d.candles.filter((c) => c.t >= t0 - 5 * 86400000);
  if (!inWin.length) return { ok: false, error: 'нет данных за период' };
  const base = inWin[0].c;
  const series = inWin.map((c) => ({ at: c.t, value: +(startEq * c.c / base).toFixed(2) }));
  return { ok: true, symbol: d.symbol, series, benchReturn: +((inWin[inWin.length - 1].c / base - 1) * 100).toFixed(2) };
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
    const at = Date.now();
    a.history.push({ at, symbol, side, qty, price, pnl: +pnl.toFixed(2), reason: reason || '', source: source || 'manual' });
    persist(a);
    snapshot({ [symbol]: price });
    autoJournal({ at, symbol, side, qty, price, pnl: +pnl.toFixed(2), reason, source });
    return { ok: true, pnl: +pnl.toFixed(2) };
  }
  const at = Date.now();
  a.history.push({ at, symbol, side, qty, price, reason: reason || '', source: source || 'manual' });
  persist(a);
  snapshot({ [symbol]: price });
  autoJournal({ at, symbol, side, qty, price, reason, source });
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
// Авто-журналирование автоматических сделок (бот/копилот/DCA/ребаланс).
function autoJournal(e) {
  if (!['bot', 'copilot', 'dca', 'rebalance'].includes(e.source)) return;
  try { require('./journal').logAuto(e); } catch {}
}
function state() { return acc(); }
function history() { return acc().history.slice(-60).reverse(); }

module.exports = { reset, trade, valuation, state, history, equityCurve, snapshot, equityStats, benchmark };
