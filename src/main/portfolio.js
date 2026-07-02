// Портфельная аналитика: распределение, концентрация, диверсификация,
// реализованный P&L и винрейт — поверх бумажного счёта (с текущими ценами).
const paper = require('./paper');

function analyze(quotes) {
  const v = paper.valuation(quotes || {});
  const acc = paper.state();
  const equity = v.equity || 1;
  // Распределение (включая кэш).
  const alloc = v.positions.map((p) => ({ symbol: p.symbol, value: p.value, pct: +((p.value / equity) * 100).toFixed(1), pnlPct: p.pnlPct }));
  alloc.sort((a, b) => b.value - a.value);
  const cashPct = +((v.cash / equity) * 100).toFixed(1);
  // Концентрация: индекс Херфиндаля по позициям (0..1, выше = концентрированнее).
  const weights = v.positions.map((p) => p.value / (equity - v.cash || 1));
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const top = alloc[0] ? alloc[0].pct : 0;
  // Реализованный P&L и винрейт по истории закрытий.
  const closed = (acc.history || []).filter((h) => h.side === 'sell' && h.pnl != null);
  const wins = closed.filter((h) => h.pnl > 0).length;
  const realized = closed.reduce((s, h) => s + h.pnl, 0);
  const best = alloc.reduce((b, p) => (!b || p.pnlPct > b.pnlPct ? p : b), null);
  const worst = alloc.reduce((b, p) => (!b || p.pnlPct < b.pnlPct ? p : b), null);
  return {
    ok: true,
    equity: v.equity, cash: v.cash, cashPct,
    totalPnl: v.totalPnl, totalPnlPct: v.totalPnlPct,
    positions: alloc, positionsCount: v.positions.length,
    concentration: +(hhi).toFixed(2), topWeight: top,
    diversification: v.positions.length === 0 ? 'нет позиций' : (hhi > 0.5 ? 'низкая (концентрировано)' : hhi > 0.25 ? 'средняя' : 'хорошая'),
    realizedPnl: +realized.toFixed(2), closedTrades: closed.length, winRate: closed.length ? +((wins / closed.length) * 100).toFixed(1) : 0,
    best: best && best.pnlPct > 0 ? best : null, worst: worst && worst.pnlPct < 0 ? worst : null
  };
}

// План ребалансировки к целевым долям (targets: { symbol: pct }).
function rebalancePlan(targets, quotes) {
  const v = paper.valuation(quotes || {});
  const equity = v.equity || 1;
  const curVal = {}; const curPrice = {};
  v.positions.forEach((p) => { curVal[p.symbol] = p.value; curPrice[p.symbol] = p.price; });
  const plan = [];
  for (const [s0, pct] of Object.entries(targets || {})) {
    const sym = s0.toUpperCase();
    const price = (quotes && quotes[sym]) || curPrice[sym];
    if (!price) { plan.push({ symbol: sym, side: 'buy', qty: 0, note: 'нет цены' }); continue; }
    const diff = equity * (pct / 100) - (curVal[sym] || 0);
    if (Math.abs(diff) > equity * 0.01) { const qty = Math.floor(Math.abs(diff) / price); if (qty >= 1) plan.push({ symbol: sym, side: diff > 0 ? 'buy' : 'sell', qty, price: +price.toFixed(2), value: +(qty * price).toFixed(2) }); }
  }
  // Закрываем позиции вне целей.
  for (const p of v.positions) if (!(p.symbol in (targets || {})) && !(p.symbol.toLowerCase() in (targets || {}))) plan.push({ symbol: p.symbol, side: 'sell', qty: p.qty, price: p.price, value: p.value });
  return { ok: true, equity: v.equity, plan };
}
function rebalanceApply(targets, quotes) {
  const { plan } = rebalancePlan(targets, quotes);
  // Сначала продажи (освобождаем кэш), потом покупки.
  let done = 0;
  for (const it of plan.filter((x) => x.side === 'sell')) { if (paper.trade({ symbol: it.symbol, side: 'sell', qty: it.qty, price: it.price, reason: 'rebalance', source: 'rebalance' }).ok) done++; }
  for (const it of plan.filter((x) => x.side === 'buy' && x.qty)) { if (paper.trade({ symbol: it.symbol, side: 'buy', qty: it.qty, price: it.price, reason: 'rebalance', source: 'rebalance' }).ok) done++; }
  return { ok: true, executed: done, plan };
}

const toolSchemas = [
  { type: 'function', function: { name: 'portfolio_analytics', description: 'Аналитика бумажного портфеля: распределение, концентрация, диверсификация, P&L, винрейт.', parameters: { type: 'object', properties: {} } } }
];
const toolHandlers = {
  portfolio_analytics: () => {
    const a = analyze();
    return `Капитал: ${a.equity} (P&L ${a.totalPnl}, ${a.totalPnlPct}%)\nПозиций: ${a.positionsCount}, кэш ${a.cashPct}%\nДиверсификация: ${a.diversification} (концентрация ${a.concentration}, макс. доля ${a.topWeight}%)\nРеализованный P&L: ${a.realizedPnl}, винрейт ${a.winRate}% (${a.closedTrades} сделок)\n` +
      (a.positions.length ? 'Распределение:\n' + a.positions.map((p) => `• ${p.symbol}: ${p.pct}% (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct}%)`).join('\n') : 'Позиций нет.');
  }
};

module.exports = { analyze, rebalancePlan, rebalanceApply, toolSchemas, toolHandlers };
