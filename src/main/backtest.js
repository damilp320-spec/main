// Бэктестер торговых стратегий: безопасная проверка идей на ИСТОРИИ (без денег).
// Правила (пересечение SMA, RSI-пороги, пробой канала) прогоняются по свечам,
// считается кривая доходности, винрейт, просадка и сравнение с buy&hold.
const markets = require('./markets');

function sma(arr, n) { const out = []; let s = 0; for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= n) s -= arr[i - n]; out.push(i >= n - 1 ? s / n : null); } return out; }
function rsiSeries(closes, n) {
  const out = new Array(closes.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    if (i <= n) { gain += g; loss += l; if (i === n) { const rs = loss === 0 ? 100 : gain / loss; out[i] = 100 - 100 / (1 + rs); gain /= n; loss /= n; } }
    else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; const rs = loss === 0 ? 100 : gain / loss; out[i] = 100 - 100 / (1 + rs); }
  }
  return out;
}

function emaArr(arr, n) { const k = 2 / (n + 1); const out = []; let prev = null; for (let i = 0; i < arr.length; i++) { prev = prev == null ? arr[i] : arr[i] * k + prev * (1 - k); out.push(i >= n - 1 ? prev : null); } return out; }
function stdArr(arr, n) { const out = []; for (let i = 0; i < arr.length; i++) { if (i < n - 1) { out.push(null); continue; } let m = 0; for (let j = i - n + 1; j <= i; j++) m += arr[j]; m /= n; let v = 0; for (let j = i - n + 1; j <= i; j++) v += (arr[j] - m) ** 2; out.push(Math.sqrt(v / n)); } return out; }
function macdArr(closes, fast, slow, signal) { const ef = emaArr(closes, fast), es = emaArr(closes, slow); const macd = closes.map((_, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null); const valid = macd.map((x) => x == null ? 0 : x); const sigLine = emaArr(valid, signal).map((x, i) => macd[i] == null ? null : x); return { macd, signal: sigLine }; }

// Возвращает массив сигналов 'buy'|'sell'|null по индексам свечей.
function signals(strategy, c, p) {
  const closes = c.map((x) => x.c);
  const sig = new Array(closes.length).fill(null);
  const cross = (a, b, i) => (a[i - 1] != null && b[i - 1] != null && a[i] != null && b[i] != null) ? (a[i - 1] <= b[i - 1] && a[i] > b[i] ? 'buy' : a[i - 1] >= b[i - 1] && a[i] < b[i] ? 'sell' : null) : null;
  if (strategy === 'sma_cross') {
    const f = sma(closes, p.fast || 10), s = sma(closes, p.slow || 30);
    for (let i = 1; i < closes.length; i++) {
      if (f[i] == null || s[i] == null || f[i - 1] == null || s[i - 1] == null) continue;
      if (f[i - 1] <= s[i - 1] && f[i] > s[i]) sig[i] = 'buy';
      else if (f[i - 1] >= s[i - 1] && f[i] < s[i]) sig[i] = 'sell';
    }
  } else if (strategy === 'rsi') {
    const r = rsiSeries(closes, p.period || 14); const lo = p.oversold || 30, hi = p.overbought || 70;
    for (let i = 1; i < closes.length; i++) {
      if (r[i] == null || r[i - 1] == null) continue;
      if (r[i - 1] >= lo && r[i] < lo) sig[i] = 'buy';
      else if (r[i - 1] <= hi && r[i] > hi) sig[i] = 'sell';
    }
  } else if (strategy === 'breakout') {
    const lb = p.lookback || 20;
    for (let i = lb; i < closes.length; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - lb; j < i; j++) { if (c[j].h > hh) hh = c[j].h; if (c[j].l < ll) ll = c[j].l; }
      if (c[i].c > hh) sig[i] = 'buy'; else if (c[i].c < ll) sig[i] = 'sell';
    }
  } else if (strategy === 'ema_cross') {
    const f = emaArr(closes, p.fast || 12), s = emaArr(closes, p.slow || 26);
    for (let i = 1; i < closes.length; i++) sig[i] = cross(f, s, i);
  } else if (strategy === 'macd') {
    const m = macdArr(closes, p.fast || 12, p.slow || 26, p.signal || 9);
    for (let i = 1; i < closes.length; i++) sig[i] = cross(m.macd, m.signal, i);
  } else if (strategy === 'bollinger') {
    const n = p.period || 20, mult = p.mult || 2; const ma = sma(closes, n), sd = stdArr(closes, n);
    for (let i = 1; i < closes.length; i++) {
      if (ma[i] == null || sd[i] == null) continue;
      const lo = ma[i] - mult * sd[i], up = ma[i] + mult * sd[i], lo0 = ma[i - 1] - mult * sd[i - 1], up0 = ma[i - 1] + mult * sd[i - 1];
      if (closes[i - 1] >= lo0 && closes[i] < lo) sig[i] = 'buy';        // отскок от нижней границы
      else if (closes[i - 1] <= up0 && closes[i] > up) sig[i] = 'sell';
    }
  } else if (strategy === 'momentum') {
    const n = p.period || 10, thr = p.threshold || 5;
    for (let i = n + 1; i < closes.length; i++) {
      const roc = (closes[i] / closes[i - n] - 1) * 100, roc0 = (closes[i - 1] / closes[i - 1 - n] - 1) * 100;
      if (roc0 <= thr && roc > thr) sig[i] = 'buy'; else if (roc0 >= -thr && roc < -thr) sig[i] = 'sell';
    }
  } else if (strategy === 'golden_cross') {
    const f = sma(closes, p.fast || 50), s = sma(closes, p.slow || 200);
    for (let i = 1; i < closes.length; i++) sig[i] = cross(f, s, i);
  }
  return sig;
}

async function run({ symbol, interval, range, strategy, params }) {
  const d = await markets.candles({ symbol, interval, range });
  if (!d.ok) return { ok: false, error: d.error };
  const c = d.candles;
  if (c.length < 30) return { ok: false, error: 'Недостаточно данных для бэктеста.' };
  const p = params || {};
  const sig = signals(strategy || 'sma_cross', c, p);

  const START = 10000;
  let cash = START, units = 0, entry = 0;
  const equity = []; const trades = [];
  for (let i = 0; i < c.length; i++) {
    const price = c[i].c;
    if (sig[i] === 'buy' && cash > 0) { units = cash / price; cash = 0; entry = price; }
    else if (sig[i] === 'sell' && units > 0) { const pnl = (price - entry) / entry * 100; trades.push({ at: c[i].t, pnl: +pnl.toFixed(2) }); cash = units * price; units = 0; }
    equity.push(cash + units * price);
  }
  // Закрываем открытую позицию по последней цене.
  if (units > 0) { const price = c[c.length - 1].c; trades.push({ at: c[c.length - 1].t, pnl: +((price - entry) / entry * 100).toFixed(2), open: true }); }

  const finalEq = equity[equity.length - 1];
  const ret = (finalEq / START - 1) * 100;
  const buyHold = (c[c.length - 1].c / c[0].c - 1) * 100;
  // Максимальная просадка.
  let peak = -Infinity, maxDD = 0;
  for (const e of equity) { if (e > peak) peak = e; const dd = (peak - e) / peak * 100; if (dd > maxDD) maxDD = dd; }
  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length ? (wins / trades.length * 100) : 0;

  return {
    ok: true, symbol: d.symbol, strategy: strategy || 'sma_cross',
    return: +ret.toFixed(2), buyHold: +buyHold.toFixed(2), maxDrawdown: +maxDD.toFixed(2),
    trades: trades.length, winRate: +winRate.toFixed(1),
    equity, times: c.map((x) => x.t), closes: c.map((x) => x.c),
    tradeList: trades.slice(-20)
  };
}

const STRATEGIES = [
  { id: 'sma_cross', name: 'Пересечение SMA', params: [['fast', 'Быстрая SMA', 10], ['slow', 'Медленная SMA', 30]] },
  { id: 'ema_cross', name: 'Пересечение EMA', params: [['fast', 'Быстрая EMA', 12], ['slow', 'Медленная EMA', 26]] },
  { id: 'macd', name: 'MACD', params: [['fast', 'Быстрая', 12], ['slow', 'Медленная', 26], ['signal', 'Сигнальная', 9]] },
  { id: 'rsi', name: 'RSI пороги', params: [['period', 'Период RSI', 14], ['oversold', 'Перепроданность', 30], ['overbought', 'Перекупленность', 70]] },
  { id: 'bollinger', name: 'Полосы Боллинджера', params: [['period', 'Период', 20], ['mult', 'Множитель σ', 2]] },
  { id: 'momentum', name: 'Моментум (ROC)', params: [['period', 'Период', 10], ['threshold', 'Порог %', 5]] },
  { id: 'breakout', name: 'Пробой канала', params: [['lookback', 'Окно (свечей)', 20]] },
  { id: 'golden_cross', name: 'Золотой крест (50/200)', params: [['fast', 'Быстрая SMA', 50], ['slow', 'Медленная SMA', 200]] }
];

// Последний сигнал стратегии по свежим свечам (для ИИ-бота).
function lastSignal(strategy, candles, params) {
  const sig = signals(strategy, candles, params || {});
  for (let i = sig.length - 1; i >= Math.max(0, sig.length - 2); i--) if (sig[i]) return sig[i];
  return null;
}

// Оптимизатор: перебор сеток параметров, поиск лучшей по доходности.
async function optimize({ symbol, interval, range, strategy }) {
  const grids = {
    sma_cross: [{ k: 'fast', v: [5, 10, 15, 20] }, { k: 'slow', v: [30, 50, 100] }],
    ema_cross: [{ k: 'fast', v: [8, 12, 20] }, { k: 'slow', v: [21, 26, 50] }],
    macd: [{ k: 'fast', v: [8, 12] }, { k: 'slow', v: [21, 26] }, { k: 'signal', v: [7, 9] }],
    rsi: [{ k: 'period', v: [9, 14, 21] }, { k: 'oversold', v: [20, 30] }, { k: 'overbought', v: [70, 80] }],
    bollinger: [{ k: 'period', v: [14, 20, 30] }, { k: 'mult', v: [1.5, 2, 2.5] }],
    momentum: [{ k: 'period', v: [5, 10, 20] }, { k: 'threshold', v: [3, 5, 8] }],
    breakout: [{ k: 'lookback', v: [10, 20, 30, 55] }],
    golden_cross: [{ k: 'fast', v: [20, 50] }, { k: 'slow', v: [100, 200] }]
  }[strategy || 'sma_cross'];
  if (!grids) return { ok: false, error: 'Нет сетки для стратегии' };
  // Декартово произведение значений параметров.
  let combos = [{}];
  for (const g of grids) combos = combos.flatMap((c) => g.v.map((val) => ({ ...c, [g.k]: val })));
  let best = null; const results = [];
  for (const params of combos.slice(0, 60)) {
    const r = await run({ symbol, interval, range, strategy, params });
    if (!r.ok) return r;
    const score = r.return - r.maxDrawdown * 0.3; // штраф за просадку
    results.push({ params, return: r.return, maxDrawdown: r.maxDrawdown, trades: r.trades, winRate: r.winRate, score: +score.toFixed(2) });
    if (!best || score > best.score) best = results[results.length - 1];
  }
  results.sort((a, b) => b.score - a.score);
  return { ok: true, best, top: results.slice(0, 8) };
}

module.exports = { run, optimize, signals, lastSignal, STRATEGIES };

