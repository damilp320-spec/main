// ИИ-режим торговли: автономный бот, который по стратегии генерирует сигналы и
// торгует. БЕЗОПАСНОСТЬ ПРЕВЫШЕ ВСЕГО:
//   • По умолчанию режим 'paper' — сделки на БУМАЖНОМ счёте (без реальных денег).
//   • В режиме 'broker' каждая заявка проходит ВСЕ гейты trading.requestOrder
//     (подтверждение человеком, лимиты, dry-run) — бот не может обойти защиту.
//   • Опционально сверяется с новостным сентиментом перед покупкой.
const store = require('./store');
const markets = require('./markets');
const backtest = require('./backtest');
const paper = require('./paper');

let uiSender = null, timer = null;
function setUISender(fn) { uiSender = fn; }
function emit(kind, payload) { uiSender && uiSender('bot:event', { kind, ...payload }); }

function cfg() {
  const c = store.get('settings.bot', {}) || {};
  return {
    enabled: c.enabled === true,
    mode: c.mode === 'broker' ? 'broker' : 'paper',
    symbols: Array.isArray(c.symbols) && c.symbols.length ? c.symbols : (store.get('marketWatchlist', []).map((w) => w.symbol)),
    strategy: c.strategy || 'sma_cross',
    params: c.params || {},
    interval: c.interval || '1d',
    range: c.range || '6mo',
    intervalMin: Math.max(1, +c.intervalMin || 15),
    qty: Math.max(1, +c.qty || 10),
    useSentiment: c.useSentiment === true,
    _state: c._state || {}
  };
}
function setCfg(patch) {
  const c = Object.assign(cfg(), patch || {});
  store.set('settings.bot', c);
  if (c.enabled) restart(); else stop();
  return { ok: true, cfg: publicCfg() };
}
function saveState(st) { const c = store.get('settings.bot', {}) || {}; c._state = st; store.set('settings.bot', c); }
function publicCfg() { const c = cfg(); return { ...c, running: !!timer, brokerSafe: brokerSafety() }; }

// Текущий уровень защиты для брокерского режима (для предупреждений в UI).
function brokerSafety() {
  try { const tc = require('./trading').publicCfg(); return { live: tc.env === 'live', dryRun: tc.dryRun, confirm: tc.confirmEveryOrder, autoTrade: tc.autoTrade }; }
  catch { return null; }
}

async function evaluate() {
  const c = cfg();
  if (!c.enabled) return;
  const state = c._state || {};
  for (const symbol of c.symbols) {
    try {
      const d = await markets.candles({ symbol, interval: c.interval, range: c.range });
      if (!d.ok || d.candles.length < 30) continue;
      const sig = backtest.lastSignal(c.strategy, d.candles, c.params);
      if (!sig) continue;
      const price = d.candles[d.candles.length - 1].c;
      const prev = state[symbol] && state[symbol].side;
      if (sig === prev) continue; // сигнал не изменился — не дублируем
      emit('signal', { symbol, signal: sig, price });

      // Фильтр по сентименту (только для покупок).
      if (c.useSentiment && sig === 'buy') {
        try { const s = await require('./news').sentiment(symbol); if (s.ok && s.score < -20) { emit('skip', { symbol, message: `пропуск buy: негативный сентимент (${s.score})` }); state[symbol] = { side: sig, at: Date.now() }; continue; } } catch {}
      }

      await act(c, symbol, sig, price);
      state[symbol] = { side: sig, at: Date.now() };
    } catch (e) { emit('error', { symbol, message: e.message }); }
  }
  saveState(state);
}

async function act(c, symbol, sig, price) {
  if (c.mode === 'paper') {
    const v = paper.valuation();
    const pos = v.positions.find((p) => p.symbol === symbol.toUpperCase());
    if (sig === 'buy' && !pos) { const r = paper.trade({ symbol, side: 'buy', qty: c.qty, price, reason: c.strategy + ' сигнал', source: 'bot' }); report(symbol, 'buy', c.qty, price, r); }
    else if (sig === 'sell' && pos) { const r = paper.trade({ symbol, side: 'sell', qty: pos.qty, price, reason: c.strategy + ' сигнал', source: 'bot' }); report(symbol, 'sell', pos.qty, price, r); }
  } else {
    // Брокерский режим — через все гейты безопасности.
    try {
      const trading = require('./trading');
      const inst = await trading.findInstrument(symbol);
      if (!inst.ok || !inst.instruments.length) { emit('error', { symbol, message: 'инструмент не найден у брокера' }); return; }
      const it = inst.instruments[0];
      const r = await trading.requestOrder({ figi: it.figi, ticker: it.ticker, lots: c.qty, lotSize: it.lot, direction: sig }, 'bot');
      emit('order', { symbol, signal: sig, message: r.blocked ? ('заблокировано: ' + r.error) : (r.pending ? 'ожидает подтверждения' : (r.ok ? (r.message || 'отправлено') : ('ошибка: ' + r.error))) });
    } catch (e) { emit('error', { symbol, message: e.message }); }
  }
}
function report(symbol, side, qty, price, r) {
  if (r.ok) {
    emit('trade', { symbol, side, qty, price, pnl: r.pnl });
    uiSender && uiSender('watcher:fired', { title: '🤖 Бот: ' + side.toUpperCase() + ' ' + symbol, message: `${qty} @ ${price.toFixed(2)}${r.pnl != null ? ' · P&L ' + r.pnl : ''} (бумажный)` });
  } else emit('error', { symbol, message: r.error });
}

function start() { stop(); const c = cfg(); if (!c.enabled) return; timer = setInterval(evaluate, c.intervalMin * 60000); evaluate(); emit('status', { running: true }); }
function stop() { if (timer) { clearInterval(timer); timer = null; emit('status', { running: false }); } }
function restart() { stop(); start(); }
function init(deps) { if (deps && deps.sendToUI) uiSender = deps.sendToUI; if (cfg().enabled) start(); }
function runOnce() { return evaluate(); }

module.exports = { init, setUISender, setCfg, publicCfg, start, stop, runOnce, evaluate };
