// Теневая лаборатория стратегий: параллельно прогоняет ВСЕ стратегии «вхолостую»
// (без денег) на одних и тех же данных — показывает, где были точки входа/выхода
// и какая стратегия ведёт. Используется и отдельным разделом, и ботом во время
// наблюдения за активом (бесплатное параллельное тестирование).
const markets = require('./markets');
const backtest = require('./backtest');
const store = require('./store');

// Точки входа/выхода стратегии по свечам.
function markersFor(candles, strategy, params) {
  const sig = backtest.signals(strategy, candles, params || {});
  const out = [];
  for (let i = 0; i < sig.length; i++) if (sig[i]) out.push({ i, t: candles[i].t, type: sig[i], price: +candles[i].c.toFixed(2) });
  return out;
}

// Рейтинг стратегий по уже загруженным свечам (без сетевых запросов).
function boardFromCandles(candles) {
  const board = [];
  for (const st of backtest.STRATEGIES) {
    const def = {}; st.params.forEach(([k, , v]) => def[k] = v);
    const r = backtest.simulate(candles, st.id, def);
    const score = r.m.sharpe * 2 + r.m.return / 10 - r.m.maxDrawdown / 10;
    board.push({ strategy: st.id, name: st.name, params: def, return: r.m.return, sharpe: r.m.sharpe, profitFactor: r.m.profitFactor, maxDrawdown: r.m.maxDrawdown, trades: r.m.trades, winRate: r.m.winRate, score: +score.toFixed(2) });
  }
  board.sort((a, b) => b.score - a.score);
  return board;
}

// Отслеживаемые активы (для «форвардного» теста с момента старта наблюдения).
function tracked() { return store.get('shadowLab', {}); }
function track(symbol) { const t = tracked(); symbol = String(symbol).toUpperCase(); if (!t[symbol]) { t[symbol] = { since: Date.now() }; store.set('shadowLab', t); } return { ok: true, since: t[symbol].since }; }
function untrack(symbol) { const t = tracked(); delete t[String(symbol).toUpperCase()]; store.set('shadowLab', t); return { ok: true }; }
function isTracked(symbol) { return !!tracked()[String(symbol).toUpperCase()]; }

async function lab({ symbol, interval, range }) {
  const d = await markets.candles({ symbol, interval: interval || '1d', range: range || '1y' });
  if (!d.ok) return d;
  const c = d.candles;
  const board = boardFromCandles(c);
  const best = board[0];
  const bestMarkers = markersFor(c, best.strategy, best.params).slice(-40);
  // Форвардный тест: с момента, как вы начали наблюдать (out-of-sample вживую).
  let forward = null; const t = tracked()[String(symbol).toUpperCase()];
  if (t && t.since) {
    const fc = c.filter((x) => x.t >= t.since);
    if (fc.length > 25) forward = { since: t.since, board: boardFromCandles(fc).slice(0, 5) };
  }
  return { ok: true, symbol: d.symbol, board, bestStrategy: best.strategy, bestMarkers, forward, tracked: isTracked(symbol) };
}

// Маркеры конкретной стратегии (для наложения на график).
async function markers({ symbol, interval, range, strategy, params }) {
  const d = await markets.candles({ symbol, interval: interval || '1d', range: range || '6mo' });
  if (!d.ok) return d;
  let p = params;
  if (!p) { const st = backtest.STRATEGIES.find((x) => x.id === strategy); p = {}; if (st) st.params.forEach(([k, , v]) => p[k] = v); }
  return { ok: true, markers: markersFor(d.candles, strategy || 'macd', p) };
}

const toolSchemas = [
  { type: 'function', function: { name: 'strategy_lab', description: 'Параллельно протестировать ВСЕ стратегии на активе (без денег) и показать рейтинг: какая лучше под этот тикер.', parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } } }
];
const toolHandlers = {
  strategy_lab: async (a) => { const r = await lab({ symbol: a.symbol }); return r.ok ? `Лаборатория по ${r.symbol}:\n` + r.board.slice(0, 6).map((b, i) => `${i + 1}. ${b.name}: ${b.return >= 0 ? '+' : ''}${b.return}% · Sharpe ${b.sharpe} · PF ${b.profitFactor} · сделок ${b.trades}`).join('\n') : 'ОШИБКА: ' + r.error; }
};

module.exports = { lab, markers, boardFromCandles, markersFor, track, untrack, isTracked, toolSchemas, toolHandlers };
