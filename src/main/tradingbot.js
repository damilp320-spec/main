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

// Готовые торговые режимы (профили риска) — чтобы ИИ/пользователю было просто.
const PROFILES = {
  aggressive: { strategy: 'momentum', params: { period: 5, threshold: 4 }, interval: '1h', range: '1mo', intervalMin: 10, useSentiment: false, confirmTf: '', stopLossPct: 5, takeProfitPct: 10, trailingPct: 4 },
  moderate: { strategy: 'macd', params: { fast: 12, slow: 26, signal: 9 }, interval: '1d', range: '6mo', intervalMin: 30, useSentiment: true, confirmTf: '1wk', stopLossPct: 8, takeProfitPct: 20, trailingPct: 8 },
  longterm: { strategy: 'golden_cross', params: { fast: 50, slow: 200 }, interval: '1d', range: '2y', intervalMin: 240, useSentiment: true, confirmTf: '1wk', stopLossPct: 15, takeProfitPct: 50, trailingPct: 15 }
};

function cfg() {
  const c = store.get('settings.bot', {}) || {};
  return {
    enabled: c.enabled === true,
    profile: c.profile || 'moderate',
    mode: c.mode === 'broker' ? 'broker' : 'paper',
    symbols: Array.isArray(c.symbols) && c.symbols.length ? c.symbols : (store.get('marketWatchlist', []).map((w) => w.symbol)),
    strategy: c.strategy || 'macd',
    params: c.params || {},
    interval: c.interval || '1d',
    range: c.range || '6mo',
    intervalMin: Math.max(1, +c.intervalMin || 15),
    qty: Math.max(1, +c.qty || 10),
    useSentiment: c.useSentiment === true,
    confirmTf: c.confirmTf || '',           // мульти-таймфрейм подтверждение ('', '1d', '1wk')
    stopLossPct: +c.stopLossPct || 0,        // стоп-лосс, % от входа
    takeProfitPct: +c.takeProfitPct || 0,    // тейк-профит, % от входа
    trailingPct: +c.trailingPct || 0,        // трейлинг-стоп, % от пика
    _state: c._state || {}
  };
}

// Применить профиль риска (агрессивный/умеренный/долгосрочный).
function applyProfile(name) {
  const p = PROFILES[name]; if (!p) return { ok: false, error: 'Неизвестный режим' };
  return setCfg({ profile: name, strategy: p.strategy, params: p.params, interval: p.interval, range: p.range, intervalMin: p.intervalMin, useSentiment: p.useSentiment, confirmTf: p.confirmTf, stopLossPct: p.stopLossPct, takeProfitPct: p.takeProfitPct, trailingPct: p.trailingPct });
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
      const price = d.candles[d.candles.length - 1].c;
      let st = state[symbol] || {};

      // Синхронизация состояния с бумажной позицией (на случай рестарта).
      if (c.mode === 'paper') {
        const pos = paper.valuation().positions.find((p) => p.symbol === symbol.toUpperCase());
        if (pos && st.side !== 'buy') st = { side: 'buy', entry: pos.avg, peak: Math.max(pos.avg, price), at: Date.now() };
        if (!pos && st.side === 'buy') st = { side: null };
      }

      // 1) Управление открытой позицией: трейлинг-стоп / тейк-профит / стоп-лосс.
      if (st.side === 'buy' && st.entry) {
        st.peak = Math.max(st.peak || st.entry, price);
        let exit = null;
        if (c.takeProfitPct && price >= st.entry * (1 + c.takeProfitPct / 100)) exit = 'take-profit';
        else if (c.stopLossPct && price <= st.entry * (1 - c.stopLossPct / 100)) exit = 'stop-loss';
        else if (c.trailingPct && price <= st.peak * (1 - c.trailingPct / 100)) exit = 'trailing-stop';
        if (exit) { await sell(c, symbol, price, exit); emit('exit', { symbol, reason: exit, price }); state[symbol] = { side: null }; continue; }
      }

      // 2) Сигнал стратегии.
      const sig = backtest.lastSignal(c.strategy, d.candles, c.params);
      if (!sig || sig === st.side) { state[symbol] = st; continue; }
      emit('signal', { symbol, signal: sig, price });

      if (sig === 'buy') {
        if (st.side === 'buy') { state[symbol] = st; continue; } // уже в позиции
        // Фильтр по сентименту.
        if (c.useSentiment) { try { const s = await require('./news').sentiment(symbol); if (s.ok && s.score < -20) { emit('skip', { symbol, message: `пропуск buy: негативный сентимент (${s.score})` }); state[symbol] = { side: null }; continue; } } catch {} }
        // Мульти-таймфрейм подтверждение: старший ТФ не должен быть против покупки.
        if (c.confirmTf) {
          const tr = await markets.trend({ symbol, interval: c.confirmTf });
          if (tr.ok && tr.trend === 'down') { emit('skip', { symbol, message: `пропуск buy: старший ТФ ${c.confirmTf} вниз` }); state[symbol] = { side: null }; continue; }
          emit('confirm', { symbol, message: `${c.confirmTf} тренд: ${tr.trend || '?'}` });
        }
        await buy(c, symbol, price);
        state[symbol] = { side: 'buy', entry: price, peak: price, at: Date.now() };
      } else { // sell-сигнал
        if (st.side === 'buy') { await sell(c, symbol, price, c.strategy + ' сигнал'); }
        state[symbol] = { side: null };
      }
    } catch (e) { emit('error', { symbol, message: e.message }); }
  }
  saveState(state);
}

async function buy(c, symbol, price) {
  if (c.mode === 'paper') {
    const pos = paper.valuation().positions.find((p) => p.symbol === symbol.toUpperCase());
    if (!pos) { const r = paper.trade({ symbol, side: 'buy', qty: c.qty, price, reason: c.strategy, source: 'bot' }); report(symbol, 'buy', c.qty, price, r); }
  } else await brokerOrder(c, symbol, 'buy');
}
async function sell(c, symbol, price, reason) {
  if (c.mode === 'paper') {
    const pos = paper.valuation().positions.find((p) => p.symbol === symbol.toUpperCase());
    if (pos) { const r = paper.trade({ symbol, side: 'sell', qty: pos.qty, price, reason, source: 'bot' }); report(symbol, 'sell', pos.qty, price, r); }
  } else await brokerOrder(c, symbol, 'sell');
}
async function brokerOrder(c, symbol, dir) {
  try {
    const trading = require('./trading');
    const inst = await trading.findInstrument(symbol);
    if (!inst.ok || !inst.instruments.length) { emit('error', { symbol, message: 'инструмент не найден у брокера' }); return; }
    const it = inst.instruments[0];
    const r = await trading.requestOrder({ figi: it.figi, ticker: it.ticker, lots: c.qty, lotSize: it.lot, direction: dir }, 'bot');
    emit('order', { symbol, signal: dir, message: r.blocked ? ('заблокировано: ' + r.error) : (r.pending ? 'ожидает подтверждения' : (r.ok ? (r.message || 'отправлено') : ('ошибка: ' + r.error))) });
  } catch (e) { emit('error', { symbol, message: e.message }); }
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

module.exports = { init, setUISender, setCfg, applyProfile, publicCfg, start, stop, runOnce, evaluate, PROFILES };
