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

// Возвращает массив сигналов 'buy'|'sell'|null по индексам свечей.
function signals(strategy, c, p) {
  const closes = c.map((x) => x.c);
  const sig = new Array(closes.length).fill(null);
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
  { id: 'rsi', name: 'RSI пороги', params: [['period', 'Период RSI', 14], ['oversold', 'Перепроданность', 30], ['overbought', 'Перекупленность', 70]] },
  { id: 'breakout', name: 'Пробой канала', params: [['lookback', 'Окно (свечей)', 20]] }
];

module.exports = { run, STRATEGIES };
