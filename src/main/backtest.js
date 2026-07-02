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

// Риск-метрики по кривой капитала и сделкам.
function metricsOf(c, equity, trades, START) {
  const finalEq = equity[equity.length - 1] || START;
  const ret = (finalEq / START - 1) * 100;
  const buyHold = (c[c.length - 1].c / c[0].c - 1) * 100;
  let peak = -Infinity, maxDD = 0;
  for (const e of equity) { if (e > peak) peak = e; const dd = (peak - e) / peak * 100; if (dd > maxDD) maxDD = dd; }
  const wins = trades.filter((t) => t.pnl > 0);
  const winRate = trades.length ? (wins.length / trades.length * 100) : 0;
  // Sharpe по дневным доходностям кривой (годовой, безриск.ставка 0).
  const rets = []; for (let i = 1; i < equity.length; i++) if (equity[i - 1] > 0) rets.push(equity[i] / equity[i - 1] - 1);
  const mean = rets.reduce((s, v) => s + v, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length || 1));
  const sharpe = sd ? +(mean / sd * Math.sqrt(252)).toFixed(2) : 0;
  // Profit factor = сумма прибылей / |сумма убытков|.
  const gp = wins.reduce((s, t) => s + t.pnl, 0); const gl = Math.abs(trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = gl ? +(gp / gl).toFixed(2) : (gp ? 99 : 0);
  return { return: +ret.toFixed(2), buyHold: +buyHold.toFixed(2), maxDrawdown: +maxDD.toFixed(2), trades: trades.length, winRate: +winRate.toFixed(1), sharpe, profitFactor };
}

// Симуляция стратегии на массиве свечей (long-only, без рефетча).
function simulate(c, strategy, params) {
  const sig = signals(strategy || 'sma_cross', c, params || {});
  const START = 10000; let cash = START, units = 0, entry = 0; const equity = [], trades = [];
  for (let i = 0; i < c.length; i++) {
    const price = c[i].c;
    if (sig[i] === 'buy' && cash > 0) { units = cash / price; cash = 0; entry = price; }
    else if (sig[i] === 'sell' && units > 0) { trades.push({ at: c[i].t, pnl: +((price - entry) / entry * 100).toFixed(2) }); cash = units * price; units = 0; }
    equity.push(cash + units * price);
  }
  if (units > 0) trades.push({ at: c[c.length - 1].t, pnl: +((c[c.length - 1].c - entry) / entry * 100).toFixed(2), open: true });
  return { equity, trades, m: metricsOf(c, equity, trades, START) };
}

async function run({ symbol, interval, range, strategy, params }) {
  const d = await markets.candles({ symbol, interval, range });
  if (!d.ok) return { ok: false, error: d.error };
  const c = d.candles;
  if (c.length < 30) return { ok: false, error: 'Недостаточно данных для бэктеста.' };
  const r = simulate(c, strategy || 'sma_cross', params || {});
  const sig = signals(strategy || 'sma_cross', c, params || {});
  const markers = []; for (let i = 0; i < sig.length; i++) if (sig[i]) markers.push({ t: c[i].t, type: sig[i], price: +c[i].c.toFixed(2) });
  return { ok: true, symbol: d.symbol, strategy: strategy || 'sma_cross', ...r.m, equity: r.equity, times: c.map((x) => x.t), closes: c.map((x) => x.c), tradeList: r.trades.slice(-20), markers };
}

// Авто-выбор лучшей стратегии для тикера по риск-доходности (Sharpe).
async function bestStrategy({ symbol, interval, range }) {
  const d = await markets.candles({ symbol, interval, range });
  if (!d.ok || d.candles.length < 40) return { ok: false, error: d.ok ? 'мало данных' : d.error };
  let best = null; const all = [];
  for (const st of STRATEGIES) {
    const def = {}; st.params.forEach(([k, , v]) => def[k] = v);
    const r = simulate(d.candles, st.id, def);
    const score = r.m.sharpe * 2 + r.m.return / 10 - r.m.maxDrawdown / 10;
    all.push({ strategy: st.id, ...r.m, score: +score.toFixed(2), params: def });
    if (!best || score > best.score) best = all[all.length - 1];
  }
  all.sort((a, b) => b.score - a.score);
  return { ok: true, symbol: d.symbol, best, all: all.slice(0, 8) };
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

// Average True Range — для адаптивных (волатильностных) стопов.
function atr(candles, n = 14) {
  if (!candles || candles.length < n + 1) return null;
  let sum = 0;
  for (let i = candles.length - n; i < candles.length; i++) {
    const tr = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c));
    sum += tr;
  }
  return sum / n;
}

// Последний сигнал стратегии по свежим свечам (для ИИ-бота).
function lastSignal(strategy, candles, params) {
  const sig = signals(strategy, candles, params || {});
  for (let i = sig.length - 1; i >= Math.max(0, sig.length - 2); i--) if (sig[i]) return sig[i];
  return null;
}

// Оптимизатор: перебор сеток параметров. Walk-forward: подбор на обучающем
// куске + проверка на «невиданном» (out-of-sample) — защита от переоптимизации.
async function optimize({ symbol, interval, range, strategy, walkForward }) {
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
  const d = await markets.candles({ symbol, interval, range }); // фетч один раз
  if (!d.ok) return d;
  const c = d.candles; if (c.length < 40) return { ok: false, error: 'Мало данных.' };
  let combos = [{}];
  for (const g of grids) combos = combos.flatMap((x) => g.v.map((val) => ({ ...x, [g.k]: val })));
  combos = combos.slice(0, 60);
  // Walk-forward: 70% обучение, 30% контроль.
  const split = Math.floor(c.length * 0.7);
  const train = walkForward ? c.slice(0, split) : c;
  const score = (m) => m.return - m.maxDrawdown * 0.3 + m.sharpe * 5;
  let best = null; const results = [];
  for (const params of combos) {
    const r = simulate(train, strategy, params);
    const sc = score(r.m);
    results.push({ params, return: r.m.return, maxDrawdown: r.m.maxDrawdown, trades: r.m.trades, winRate: r.m.winRate, sharpe: r.m.sharpe, profitFactor: r.m.profitFactor, score: +sc.toFixed(2) });
    if (!best || sc > best.score) best = results[results.length - 1];
  }
  results.sort((a, b) => b.score - a.score);
  let oos = null;
  if (walkForward && best) { const t = simulate(c.slice(split), strategy, best.params); oos = { return: t.m.return, maxDrawdown: t.m.maxDrawdown, sharpe: t.m.sharpe, trades: t.m.trades, winRate: t.m.winRate }; }
  return { ok: true, best, top: results.slice(0, 8), oos, walkForward: !!walkForward };
}

function atrAt(c, i, n) { if (i < n) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += Math.max(c[j].h - c[j].l, Math.abs(c[j].h - c[j - 1].c), Math.abs(c[j].l - c[j - 1].c)); return s / n; }

// Бэктест ВСЕЙ логики бота: сигналы + лесенка ТП + стоп-лосс/трейлинг (%, ATR).
async function runBot(opts) {
  const d = await markets.candles(opts);
  if (!d.ok) return { ok: false, error: d.error };
  const c = d.candles; if (c.length < 30) return { ok: false, error: 'Мало данных.' };
  const p = opts.params || {};
  const sig = signals(opts.strategy || 'macd', c, p);
  const START = 10000;
  let cash = START, units = 0, entry = 0, peak = 0, tp1Done = false;
  const equity = [], trades = [];
  const slP = +opts.stopLossPct || 0, tpP = +opts.takeProfitPct || 0, trP = +opts.trailingPct || 0;
  const tp1 = +opts.tp1Pct || 0, tp1Sell = +opts.tp1SellPct || 50, atrMode = opts.stopType === 'atr', atrMult = +opts.atrMult || 2;
  for (let i = 0; i < c.length; i++) {
    const price = c[i].c;
    if (units > 0) {
      peak = Math.max(peak, price);
      const av = atrMode ? atrAt(c, i, 14) : null;
      if (tp1 && !tp1Done && price >= entry * (1 + tp1 / 100)) { const sold = units * (tp1Sell / 100); cash += sold * price; trades.push({ at: c[i].t, pnl: +((price - entry) / entry * 100).toFixed(2), partial: true }); units -= sold; tp1Done = true; }
      let exit = null;
      if (tpP && price >= entry * (1 + tpP / 100)) exit = 1;
      else if (slP) { const lvl = atrMode && av ? entry - atrMult * av : entry * (1 - slP / 100); if (price <= lvl) exit = 1; }
      if (!exit && trP) { const lvl = atrMode && av ? peak - atrMult * av : peak * (1 - trP / 100); if (price <= lvl) exit = 1; }
      if (!exit && sig[i] === 'sell') exit = 1;
      if (exit) { cash += units * price; trades.push({ at: c[i].t, pnl: +((price - entry) / entry * 100).toFixed(2) }); units = 0; }
    } else if (sig[i] === 'buy') { units = cash / price; cash = 0; entry = price; peak = price; tp1Done = false; }
    equity.push(cash + units * price);
  }
  if (units > 0) { trades.push({ at: c[c.length - 1].t, pnl: +((c[c.length - 1].c - entry) / entry * 100).toFixed(2), open: true }); }
  const finalEq = equity[equity.length - 1];
  const ret = (finalEq / START - 1) * 100;
  const buyHold = (c[c.length - 1].c / c[0].c - 1) * 100;
  let pk = -Infinity, maxDD = 0; for (const e of equity) { if (e > pk) pk = e; const dd = (pk - e) / pk * 100; if (dd > maxDD) maxDD = dd; }
  const full = trades.filter((t) => !t.partial); const wins = full.filter((t) => t.pnl > 0);
  const rets = []; for (let i = 1; i < equity.length; i++) if (equity[i - 1] > 0) rets.push(equity[i] / equity[i - 1] - 1);
  const mean = rets.reduce((s, v) => s + v, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length || 1));
  const sharpe = sd ? +(mean / sd * Math.sqrt(252)).toFixed(2) : 0;
  const gp = wins.reduce((s, t) => s + t.pnl, 0); const gl = Math.abs(full.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  return { ok: true, symbol: d.symbol, return: +ret.toFixed(2), buyHold: +buyHold.toFixed(2), maxDrawdown: +maxDD.toFixed(2), trades: full.length, partials: trades.length - full.length, winRate: full.length ? +((wins.length / full.length) * 100).toFixed(1) : 0, sharpe, profitFactor: gl ? +(gp / gl).toFixed(2) : (gp ? 99 : 0), equity, closes: c.map((x) => x.c) };
}

// Монте-Карло риска: бутстрэп последовательности сделок → распределение итогов,
// просадок, вероятность убытка и «риск разорения». Честная оценка неопределённости.
async function montecarlo({ symbol, interval, range, strategy, params, iterations, ruinPct }) {
  const d = await markets.candles({ symbol, interval, range });
  if (!d.ok) return d;
  if (d.candles.length < 40) return { ok: false, error: 'Мало данных.' };
  const sim = simulate(d.candles, strategy || 'macd', params || {});
  const rets = sim.trades.filter((t) => t.pnl != null).map((t) => t.pnl);
  if (rets.length < 5) return { ok: false, error: 'Слишком мало сделок для Монте-Карло (нужно 5+).' };
  const N = Math.min(5000, Math.max(200, +iterations || 1000));
  const ruin = +ruinPct || 50;
  const finals = [], dds = []; let losses = 0, ruined = 0;
  for (let it = 0; it < N; it++) {
    let eq = 1, peak = 1, maxdd = 0;
    for (let k = 0; k < rets.length; k++) { eq *= (1 + rets[Math.floor(Math.random() * rets.length)] / 100); if (eq > peak) peak = eq; const dd = (peak - eq) / peak * 100; if (dd > maxdd) maxdd = dd; if (eq <= 0) { eq = 0.0001; break; } }
    const fr = (eq - 1) * 100; finals.push(fr); dds.push(maxdd);
    if (fr < 0) losses++; if (maxdd >= ruin) ruined++;
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  // Гистограмма итоговых доходностей (20 корзин).
  const lo = finals[0], hi = finals[finals.length - 1], span = (hi - lo) || 1, bins = new Array(20).fill(0);
  for (const f of finals) bins[Math.min(19, Math.floor((f - lo) / span * 20))]++;
  const hist = bins.map((count, i) => ({ x: +(lo + (i + 0.5) / 20 * span).toFixed(1), count }));
  return {
    ok: true, symbol: d.symbol, iterations: N, tradesUsed: rets.length,
    median: +pct(finals, 0.5).toFixed(1), p5: +pct(finals, 0.05).toFixed(1), p95: +pct(finals, 0.95).toFixed(1),
    pLoss: +(losses / N * 100).toFixed(1), riskOfRuin: +(ruined / N * 100).toFixed(1), ruinPct: ruin,
    medianDD: +pct(dds, 0.5).toFixed(1), worstDD: +pct(dds, 0.95).toFixed(1), hist
  };
}

module.exports = { run, runBot, optimize, montecarlo, simulate, bestStrategy, signals, lastSignal, atr, STRATEGIES };

