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
    stopLossPct: +c.stopLossPct || 0,        // стоп-лосс, % от входа (или флаг вкл для ATR)
    takeProfitPct: +c.takeProfitPct || 0,    // тейк-профит, % от входа
    trailingPct: +c.trailingPct || 0,        // трейлинг-стоп, % от пика (или флаг вкл для ATR)
    stopType: c.stopType === 'atr' ? 'atr' : 'percent', // тип стопа
    atrMult: +c.atrMult || 2,                // множитель ATR
    tp1Pct: +c.tp1Pct || 0,                  // первая цель (частичный выход), %
    tp1SellPct: +c.tp1SellPct || 50,         // сколько % позиции продать на первой цели
    breakeven: c.breakeven === true,         // после цели 1 — стоп в безубыток
    regimeFilter: c.regimeFilter === true,   // лонги только при risk-on (широта рынка)
    sizeMode: c.sizeMode === 'risk' ? 'risk' : 'fixed', // сайзинг: фикс или по риску/волатильности
    riskAmount: +c.riskAmount || 200,        // риск на сделку для sizeMode=risk
    shadowMode: c.shadowMode === true,       // параллельно тестировать все стратегии «вхолостую»
    maxDrawdownPct: +c.maxDrawdownPct || 0,  // автостоп: выключиться при просадке счёта выше %
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

const STRAT_CACHE = new Map(); // symbol -> { strategy, params, at } для авто-выбора

async function pickStrategy(c, symbol, candles) {
  if (c.strategy !== 'auto') return { strategy: c.strategy, params: c.params };
  const cached = STRAT_CACHE.get(symbol);
  if (cached && Date.now() - cached.at < 6 * 3600000) return cached;
  let best = null;
  for (const st of backtest.STRATEGIES) { const def = {}; st.params.forEach(([k, , v]) => def[k] = v); const r = backtest.simulate(candles, st.id, def); const sc = r.m.sharpe * 2 + r.m.return / 10 - r.m.maxDrawdown / 10; if (!best || sc > best.sc) best = { strategy: st.id, params: def, sc, at: Date.now() }; }
  STRAT_CACHE.set(symbol, best); emit('autoStrat', { symbol, message: `авто-стратегия: ${best.strategy}` });
  return best;
}
function sizeQty(c, candles, price) {
  if (c.sizeMode === 'risk') { const av = backtest.atr(candles, 14); if (av) { const dist = c.stopType === 'atr' ? c.atrMult * av : price * (c.stopLossPct || 5) / 100; if (dist > 0) return Math.max(1, Math.floor(c.riskAmount / dist)); } }
  return c.qty;
}

async function evaluate() {
  const c = cfg();
  if (!c.enabled) return;
  const state = c._state || {};
  // Фильтр режима рынка: широта считается один раз за прогон.
  let regimeOff = false;
  if (c.regimeFilter) { try { const b = await require('./screener').breadth(); if (b.ok) regimeOff = b.regime === 'risk-off'; } catch {} }
  const quotes = {};
  for (const symbol of c.symbols) {
    try {
      const d = await markets.candles({ symbol, interval: c.interval, range: c.range });
      if (!d.ok || d.candles.length < 30) continue;
      const price = d.candles[d.candles.length - 1].c;
      quotes[symbol.toUpperCase()] = price;
      let st = state[symbol] || {};

      // Теневая лаборатория: параллельно прогоняем ВСЕ стратегии на уже
      // загруженных свечах (без денег) и показываем рейтинг — бесплатно.
      if (c.shadowMode) {
        try { const board = require('./shadowlab').boardFromCandles(d.candles); emit('shadow', { symbol, board: board.slice(0, 6), current: (c.strategy === 'auto' ? (STRAT_CACHE.get(symbol) || {}).strategy : c.strategy) }); } catch {}
      }

      // Синхронизация состояния с бумажной позицией (на случай рестарта).
      if (c.mode === 'paper') {
        const pos = paper.valuation().positions.find((p) => p.symbol === symbol.toUpperCase());
        if (pos && st.side !== 'buy') st = { side: 'buy', entry: pos.avg, peak: Math.max(pos.avg, price), at: Date.now() };
        if (!pos && st.side === 'buy') st = { side: null };
      }

      // 1) Управление открытой позицией: лесенка ТП / тейк-профит / стоп / трейлинг.
      if (st.side === 'buy' && st.entry) {
        st.peak = Math.max(st.peak || st.entry, price);
        // Лесенка тейк-профита: частичный выход на первой цели.
        if (c.tp1Pct && !st.tp1Done && price >= st.entry * (1 + c.tp1Pct / 100)) {
          await sellPartial(c, symbol, price, c.tp1SellPct);
          st.tp1Done = true; state[symbol] = st;
          emit('exit', { symbol, reason: `take-profit-1 (${c.tp1SellPct}%)`, price });
          continue;
        }
        const av = c.stopType === 'atr' ? backtest.atr(d.candles, 14) : null;
        let exit = null;
        if (c.takeProfitPct && price >= st.entry * (1 + c.takeProfitPct / 100)) exit = 'take-profit';
        else if (c.stopLossPct) {
          const lvl = (c.stopType === 'atr' && av) ? st.entry - c.atrMult * av : st.entry * (1 - c.stopLossPct / 100);
          if (price <= lvl) exit = 'stop-loss' + (av ? ' (ATR)' : '');
        }
        if (!exit && c.trailingPct) {
          const lvl = (c.stopType === 'atr' && av) ? st.peak - c.atrMult * av : st.peak * (1 - c.trailingPct / 100);
          if (price <= lvl) exit = 'trailing-stop' + (av ? ' (ATR)' : '');
        }
        // Стоп в безубыток после первой цели.
        if (!exit && c.breakeven && st.tp1Done && price <= st.entry) exit = 'breakeven (безубыток)';
        if (exit) { await sell(c, symbol, price, exit); emit('exit', { symbol, reason: exit, price }); state[symbol] = { side: null }; continue; }
      }

      // 2) Сигнал стратегии (с авто-выбором лучшей под тикер, если включено).
      const pick = await pickStrategy(c, symbol, d.candles);
      const sig = backtest.lastSignal(pick.strategy, d.candles, pick.params);
      if (!sig || sig === st.side) { state[symbol] = st; continue; }
      emit('signal', { symbol, signal: sig, price });

      if (sig === 'buy') {
        if (st.side === 'buy') { state[symbol] = st; continue; } // уже в позиции
        // Фильтр режима рынка.
        if (regimeOff) { emit('skip', { symbol, message: 'пропуск buy: рынок risk-off (широта)' }); state[symbol] = { side: null }; continue; }
        // Фильтр по сентименту.
        if (c.useSentiment) { try { const s = await require('./news').sentiment(symbol); if (s.ok && s.score < -20) { emit('skip', { symbol, message: `пропуск buy: негативный сентимент (${s.score})` }); state[symbol] = { side: null }; continue; } } catch {} }
        // Мульти-таймфрейм подтверждение: старший ТФ не должен быть против покупки.
        if (c.confirmTf) {
          const tr = await markets.trend({ symbol, interval: c.confirmTf });
          if (tr.ok && tr.trend === 'down') { emit('skip', { symbol, message: `пропуск buy: старший ТФ ${c.confirmTf} вниз` }); state[symbol] = { side: null }; continue; }
          emit('confirm', { symbol, message: `${c.confirmTf} тренд: ${tr.trend || '?'}` });
        }
        // «ИИ за рулём»: сигнал идёт не в сделку, а на оценку нейросети-супервайзеру.
        const copilot = require('./copilot');
        if (copilot.enabled()) {
          emit('toAI', { symbol, message: 'сигнал buy → на анализ ИИ-супервайзеру' });
          await copilot.consider({ symbol, action: 'buy', signal: 'bot', price, reason: c.strategy });
          state[symbol] = { side: null };
          continue;
        }
        await buy(c, symbol, price, sizeQty(c, d.candles, price));
        state[symbol] = { side: 'buy', entry: price, peak: price, at: Date.now() };
      } else { // sell-сигнал
        if (st.side === 'buy') { await sell(c, symbol, price, c.strategy + ' сигнал'); }
        state[symbol] = { side: null };
      }
    } catch (e) { emit('error', { symbol, message: e.message }); }
  }
  saveState(state);
  // Защитный автостоп: при просадке бумажного счёта выше лимита — выключаемся.
  if (c.maxDrawdownPct && c.mode === 'paper') {
    try {
      const v = paper.valuation(quotes);
      let peak = store.get('botPeakEquity', v.equity);
      if (v.equity > peak) { peak = v.equity; store.set('botPeakEquity', peak); }
      const dd = peak > 0 ? (peak - v.equity) / peak * 100 : 0;
      if (dd >= c.maxDrawdownPct) {
        setCfg({ enabled: false });
        emit('exit', { symbol: '—', reason: `circuit-breaker: просадка ${dd.toFixed(1)}%`, price: 0 });
        uiSender && uiSender('watcher:fired', { title: '🛑 Бот остановлен (автостоп)', message: `Просадка счёта ${dd.toFixed(1)}% превысила лимит ${c.maxDrawdownPct}%.` });
      }
    } catch {}
  }
}

async function buy(c, symbol, price, qty) {
  qty = Math.max(1, qty || c.qty);
  if (c.mode === 'paper') {
    const pos = paper.valuation().positions.find((p) => p.symbol === symbol.toUpperCase());
    if (!pos) { const r = paper.trade({ symbol, side: 'buy', qty, price, reason: c.strategy, source: 'bot' }); report(symbol, 'buy', qty, price, r); }
  } else await brokerOrder(c, symbol, 'buy');
}
async function sell(c, symbol, price, reason) {
  if (c.mode === 'paper') {
    const pos = paper.valuation().positions.find((p) => p.symbol === symbol.toUpperCase());
    if (pos) { const r = paper.trade({ symbol, side: 'sell', qty: pos.qty, price, reason, source: 'bot' }); report(symbol, 'sell', pos.qty, price, r); }
  } else await brokerOrder(c, symbol, 'sell');
}
async function sellPartial(c, symbol, price, pct) {
  if (c.mode === 'paper') {
    const pos = paper.valuation().positions.find((p) => p.symbol === symbol.toUpperCase());
    if (pos) { const qty = Math.max(1, Math.floor(pos.qty * (pct / 100))); const r = paper.trade({ symbol, side: 'sell', qty, price, reason: 'take-profit-1', source: 'bot' }); report(symbol, 'sell', qty, price, r); }
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
