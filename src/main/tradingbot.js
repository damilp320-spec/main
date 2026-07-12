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
const indicators = require('./indicators');

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
    signalRoute: c.signalRoute === 'ai' ? 'ai' : 'direct', // 'direct' — бот торгует сам; 'ai' — через ИИ-супервайзера
    volumeFilter: c.volumeFilter === true,   // вход только при объёме выше среднего (подтверждение)
    adxMin: +c.adxMin || 0,                  // мин. сила тренда ADX для входа (0 = выкл)
    patternFilter: c.patternFilter === true, // не покупать против медвежьих свечных паттернов
    srFilter: c.srFilter === true,           // не покупать вплотную под сопротивлением (< 1×ATR)
    minConfluence: +c.minConfluence || 0,    // мин. конфлюэнс-скор (-100…100) для входа (0 = выкл)
    maxPositions: +c.maxPositions || 0,      // портфель: макс. одновременных позиций (0 = без лимита)
    maxPosPct: +c.maxPosPct || 0,            // портфель: макс. % капитала на одну позицию (0 = выкл)
    corrMax: +c.corrMax || 0,                // портфель: не покупать при корреляции с позицией выше порога (0 = выкл)
    cooldownMin: +c.cooldownMin || 0,        // пауза после выхода из тикера, мин (0 = выкл)
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
// Сброс ручных уровней (стоп/тейк) по тикеру — при закрытии позиции.
function clearOverride(symbol) { try { const all = store.get('chartLevels', {}) || {}; const k = String(symbol || '').toUpperCase(); if (all[k]) { delete all[k]; store.set('chartLevels', all); } } catch {} }
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
  let qty = c.qty;
  if (c.sizeMode === 'risk') { const av = backtest.atr(candles, 14); if (av) { const dist = c.stopType === 'atr' ? c.atrMult * av : price * (c.stopLossPct || 5) / 100; if (dist > 0) qty = Math.max(1, Math.floor(c.riskAmount / dist)); } }
  // Портфельный лимит: не больше maxPosPct % капитала на одну позицию.
  if (c.maxPosPct && c.mode === 'paper' && price > 0) {
    const cap = Math.floor(paper.valuation().equity * c.maxPosPct / 100 / price);
    qty = Math.min(qty, Math.max(1, cap));
  }
  return qty;
}

// Корреляция дневных доходностей двух тикеров за 3 месяца (свечи кэширует markets).
async function dailyCorrelation(a, b) {
  const [da, db] = await Promise.all([markets.candles({ symbol: a, interval: '1d', range: '3mo' }), markets.candles({ symbol: b, interval: '1d', range: '3mo' })]);
  if (!da.ok || !db.ok) return null;
  const rets = (d) => { const cl = d.candles.map((x) => x.c); return cl.slice(1).map((v, i) => v / cl[i] - 1); };
  const xa = rets(da), xb = rets(db); const n = Math.min(xa.length, xb.length);
  if (n < 20) return null;
  const va = xa.slice(-n), vb = xb.slice(-n);
  const ma = va.reduce((s, v) => s + v, 0) / n, mb = vb.reduce((s, v) => s + v, 0) / n;
  let num = 0, dda = 0, ddb = 0;
  for (let i = 0; i < n; i++) { num += (va[i] - ma) * (vb[i] - mb); dda += (va[i] - ma) ** 2; ddb += (vb[i] - mb) ** 2; }
  return dda && ddb ? num / Math.sqrt(dda * ddb) : null;
}

// Расширенные фильтры входа: пауза после выхода, портфельные лимиты, объём,
// ADX, свечные паттерны, уровни и конфлюэнс. Возвращает причину-вето или null.
async function entryVeto(c, symbol, candles, price, st) {
  if (c.cooldownMin && st.lastExitAt && Date.now() - st.lastExitAt < c.cooldownMin * 60000) {
    const left = Math.ceil((c.cooldownMin * 60000 - (Date.now() - st.lastExitAt)) / 60000);
    return `пауза после выхода (ещё ${left} мин)`;
  }
  if (c.mode === 'paper') {
    const positions = paper.valuation().positions;
    if (c.maxPositions && positions.length >= c.maxPositions) return `лимит позиций (${positions.length}/${c.maxPositions})`;
    if (c.corrMax) {
      for (const p of positions) {
        if (p.symbol === symbol.toUpperCase()) continue;
        const corr = await dailyCorrelation(symbol, p.symbol);
        if (corr != null && corr > c.corrMax) return `корреляция с ${p.symbol} ${corr.toFixed(2)} > ${c.corrMax} (риск концентрации)`;
      }
    }
  }
  if (c.volumeFilter) {
    const vols = candles.map((x) => x.v || 0);
    const va = indicators.sma(vols, 20)[vols.length - 1];
    if (va && vols[vols.length - 1] < va) return 'объём ниже среднего за 20 свечей (нет подтверждения)';
  }
  if (c.adxMin) {
    const ad = indicators.adx(candles, 14); const i = candles.length - 1;
    if (ad.adx[i] != null && (ad.adx[i] < c.adxMin || ad.plus[i] <= ad.minus[i])) return `слабый/медвежий тренд: ADX ${ad.adx[i].toFixed(0)} (порог ${c.adxMin})`;
  }
  if (c.patternFilter) {
    const bears = indicators.lastPatterns(candles).filter((p) => p.dir === -1);
    if (bears.length) return 'медвежий свечной паттерн: ' + bears.map((p) => p.name).join(', ');
  }
  if (c.srFilter) {
    const sr = indicators.srLevels(candles);
    if (sr.resistance && sr.atr && (sr.resistance.price - price) < sr.atr) return `сопротивление ${sr.resistance.price} ближе 1×ATR — мало запаса хода`;
  }
  if (c.minConfluence) {
    const an = indicators.analyze(candles);
    if (an.ok && an.score < c.minConfluence) return `конфлюэнс ${an.score} < ${c.minConfluence}`;
  }
  return null;
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
        if (!pos && st.side === 'buy') st = { side: null, lastExitAt: Date.now() };
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
        // Ручные уровни с графика (перетаскивание/безубыток) имеют приоритет.
        const ov = (store.get('chartLevels', {}) || {})[symbol.toUpperCase()] || {};
        if (ov.tp != null && price >= ov.tp) exit = 'take-profit (ручной)';
        else if (ov.stop != null && price <= ov.stop) exit = 'stop (ручной)';
        if (exit) { /* ручной уровень сработал */ }
        else if (c.takeProfitPct && price >= st.entry * (1 + c.takeProfitPct / 100)) exit = 'take-profit';
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
        if (exit) { await sell(c, symbol, price, exit); emit('exit', { symbol, reason: exit, price }); state[symbol] = { side: null, lastExitAt: Date.now() }; clearOverride(symbol); continue; }
      }

      // 2) Сигнал стратегии (с авто-выбором лучшей под тикер, если включено).
      const pick = await pickStrategy(c, symbol, d.candles);
      const sig = backtest.lastSignal(pick.strategy, d.candles, pick.params);
      if (!sig || sig === st.side) { state[symbol] = st; continue; }
      emit('signal', { symbol, signal: sig, price });

      if (sig === 'buy') {
        if (st.side === 'buy') { state[symbol] = st; continue; } // уже в позиции
        const noPos = { side: null, lastExitAt: st.lastExitAt }; // сохраняем время выхода для паузы
        // Фильтр режима рынка.
        if (regimeOff) { emit('skip', { symbol, message: 'пропуск buy: рынок risk-off (широта)' }); state[symbol] = noPos; continue; }
        // Расширенные фильтры: пауза/портфель/объём/ADX/паттерны/уровни/конфлюэнс.
        const veto = await entryVeto(c, symbol, d.candles, price, st);
        if (veto) { emit('skip', { symbol, message: 'пропуск buy: ' + veto }); state[symbol] = noPos; continue; }
        // Фильтр по сентименту.
        if (c.useSentiment) { try { const s = await require('./news').sentiment(symbol); if (s.ok && s.score < -20) { emit('skip', { symbol, message: `пропуск buy: негативный сентимент (${s.score})` }); state[symbol] = noPos; continue; } } catch {} }
        // Мульти-таймфрейм подтверждение: старший ТФ не должен быть против покупки.
        if (c.confirmTf) {
          const tr = await markets.trend({ symbol, interval: c.confirmTf });
          if (tr.ok && tr.trend === 'down') { emit('skip', { symbol, message: `пропуск buy: старший ТФ ${c.confirmTf} вниз` }); state[symbol] = noPos; continue; }
          emit('confirm', { symbol, message: `${c.confirmTf} тренд: ${tr.trend || '?'}` });
        }
        // Маршрут сигнала: по умолчанию бот торгует САМ. Опционально (signalRoute='ai')
        // сигнал идёт не в сделку, а на оценку нейросети-супервайзеру («ИИ за рулём»).
        const copilot = require('./copilot');
        if (c.signalRoute === 'ai' && copilot.enabled()) {
          emit('toAI', { symbol, message: 'сигнал buy → ИИ-супервайзеру на анализ' });
          try {
            const dec = await copilot.consider({ symbol, action: 'buy', signal: 'bot', price, reason: c.strategy });
            // Возвращаем итог в лог бота, чтобы сигнал не «исчезал» молча.
            emit('confirm', { symbol, message: dec && dec.approved ? `ИИ одобрил (${dec.confidence}%) → создано предложение` : `ИИ отклонил${dec ? ' (' + dec.confidence + '%)' : ''}: ${(dec && dec.reason) || 'нет ответа'}` });
          } catch (e) { emit('error', { symbol, message: 'ИИ-супервайзер недоступен: ' + e.message + ' (проверьте, запущен ли Ollama)' }); }
          state[symbol] = noPos;
          continue;
        }
        await buy(c, symbol, price, sizeQty(c, d.candles, price));
        state[symbol] = { side: 'buy', entry: price, peak: price, at: Date.now() };
      } else { // sell-сигнал
        if (st.side === 'buy') { await sell(c, symbol, price, c.strategy + ' сигнал'); }
        state[symbol] = { side: null, lastExitAt: st.side === 'buy' ? Date.now() : st.lastExitAt };
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
// Ручной прогон с понятной обратной связью (чтобы было видно, что бот «жив»).
async function runOnce() {
  const c = cfg();
  if (!c.enabled) { emit('status', { message: '⚠️ бот выключен — включите «Включить бота»' }); return { ok: false, error: 'disabled' }; }
  if (!c.symbols.length) { emit('status', { message: '⚠️ нет тикеров — добавьте символы или watchlist' }); return { ok: false, error: 'no symbols' }; }
  const before = paper.valuation().positions.length;
  emit('status', { message: `прогон ${c.symbols.length} тикеров (${c.strategy}, ${c.signalRoute === 'ai' ? 'через ИИ' : 'бот сам'})…` });
  await evaluate();
  const after = paper.valuation().positions.length;
  emit('status', { message: `✓ прогон завершён · открытых позиций: ${after}${after === before ? ' (без изменений — нет свежего сигнала)' : ''}` });
  return { ok: true, positions: after };
}

// Мульти-факторный разбор тикера: все индикаторы + паттерны + уровни + Фибо +
// дивергенции + конфлюэнс, плюс старший ТФ и сентимент новостей (если включены).
async function insight(symbol) {
  const c = cfg();
  symbol = String(symbol || c.symbols[0] || '').trim();
  if (!symbol) return { ok: false, error: 'Не указан тикер.' };
  const d = await markets.candles({ symbol, interval: c.interval, range: c.range });
  if (!d.ok) return { ok: false, error: d.error };
  const an = indicators.analyze(d.candles);
  if (!an.ok) return an;
  let htf = null;
  if (c.confirmTf) { try { const tr = await markets.trend({ symbol, interval: c.confirmTf }); if (tr.ok) htf = { interval: c.confirmTf, trend: tr.trend }; } catch {} }
  let news = null;
  if (c.useSentiment) { try { const s = await require('./news').sentiment(symbol); if (s.ok) news = { score: s.score, summary: s.summary }; } catch {} }
  return { ok: true, symbol: d.symbol, interval: c.interval, ...an, htf, news };
}

// Статистика сделок бота по бумажному счёту: винрейт, профит-фактор,
// матожидание, средние прибыль/убыток и разбивка по тикерам.
function botStats() {
  const hist = paper.state().history.filter((h) => h.source === 'bot');
  const closed = hist.filter((h) => h.side === 'sell' && h.pnl != null);
  if (!closed.length) return { ok: false, error: 'no trades', buys: hist.filter((h) => h.side === 'buy').length };
  const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl <= 0);
  const gp = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const bySymbol = {};
  for (const t of closed) { const b = bySymbol[t.symbol] || (bySymbol[t.symbol] = { trades: 0, pnl: 0, wins: 0 }); b.trades++; b.pnl += t.pnl; if (t.pnl > 0) b.wins++; }
  const symbols = Object.entries(bySymbol).map(([symbol, b]) => ({ symbol, trades: b.trades, pnl: +b.pnl.toFixed(2), winRate: +(b.wins / b.trades * 100).toFixed(0) })).sort((a, b) => b.pnl - a.pnl);
  return {
    ok: true, trades: closed.length, buys: hist.filter((h) => h.side === 'buy').length,
    winRate: +(wins.length / closed.length * 100).toFixed(1),
    profitFactor: gl ? +(gp / gl).toFixed(2) : (gp ? 99 : 0),
    totalPnl: +(gp - gl).toFixed(2),
    expectancy: +((gp - gl) / closed.length).toFixed(2),
    avgWin: wins.length ? +(gp / wins.length).toFixed(2) : 0,
    avgLoss: losses.length ? +(gl / losses.length).toFixed(2) : 0,
    best: +Math.max(...closed.map((t) => t.pnl)).toFixed(2),
    worst: +Math.min(...closed.map((t) => t.pnl)).toFixed(2),
    lastAt: closed[closed.length - 1].at, symbols
  };
}

module.exports = { init, setUISender, setCfg, applyProfile, publicCfg, start, stop, runOnce, evaluate, insight, botStats, PROFILES };
