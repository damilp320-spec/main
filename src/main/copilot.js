// «ИИ за рулём» — проактивный супервайзер. Сырые сигналы (от бота или от
// мониторинга) НЕ идут пользователю напрямую: сначала нейросеть-аналитик
// оценивает их в контексте ЦЕЛИ пользователя, новостей, макро и рыночной
// широты. Только обоснованные сигналы становятся ПРЕДЛОЖЕНИЯМИ пользователю.
// Режим отключаемый; модель выбирается отдельно. Безопасность сохранена:
// исполнение — бумага или брокер через все гейты.
const store = require('./store');
const { randomUUID } = require('crypto');

let uiSender = null, timer = null;
function setUISender(fn) { uiSender = fn; }
function emit(ev, p) { uiSender && uiSender(ev, p); }

function cfg() {
  const c = store.get('settings.copilot', {}) || {};
  return {
    enabled: c.enabled === true,
    goal: c.goal || 'Найти прибыльные активы и заработать максимально безопасным способом.',
    model: c.model || store.get('settings.defaultModel', '') || 'qwen2.5:7b',
    risk: ['conservative', 'balanced', 'aggressive'].includes(c.risk) ? c.risk : 'balanced',
    autoActPaper: c.autoActPaper === true,   // авто-исполнять одобренное на бумаге
    minConfidence: +c.minConfidence || 60,
    everyMin: Math.max(5, +c.everyMin || 30)
  };
}
function setCfg(patch) { const c = Object.assign(cfg(), patch || {}); store.set('settings.copilot', c); if (c.enabled) restart(); else stop(); return { ok: true, cfg: publicCfg() }; }
function publicCfg() { return { ...cfg(), running: !!timer }; }
function enabled() { return cfg().enabled; }

function proposals() { return store.get('copilotProposals', []); }
function addProposal(p) { const all = proposals(); all.push(p); store.set('copilotProposals', all.slice(-100)); emit('copilot:proposal', { proposal: p }); emit('watcher:fired', { title: '🧭 ИИ предлагает: ' + p.action.toUpperCase() + ' ' + p.symbol, message: `${p.reasoning.slice(0, 100)} (увер. ${p.confidence}%)` }); }
function setProposalStatus(id, status) { const all = proposals(); const p = all.find((x) => x.id === id); if (p) { p.status = status; store.set('copilotProposals', all); } return p; }

// Оценка сигнала нейросетью-аналитиком. Возвращает решение.
async function consider({ symbol, action, signal, price, reason }) {
  const c = cfg();
  const ollama = require('./ollama');
  const markets = require('./markets'); const news = require('./news'); const screener = require('./screener');
  // Контекст: техника, новости, макро/широта.
  let tech = '', sent = null, breadth = null;
  try { const d = await markets.candles({ symbol, interval: '1d', range: '6mo' }); if (d.ok) tech = markets.summarize(d); } catch {}
  try { const s = await news.sentiment(symbol); if (s.ok) sent = s.score; } catch {}
  try { const b = await screener.breadth(); if (b.ok) breadth = b; } catch {}
  const riskNote = { conservative: 'Приоритет — СОХРАННОСТЬ капитала. Одобряй только сильные, подтверждённые сигналы с попутным рынком.', balanced: 'Баланс риска и доходности.', aggressive: 'Допустим повышенный риск ради доходности, но без авантюр.' }[c.risk];
  const sys = `Ты — риск-менеджер и аналитик «за рулём». Цель пользователя: «${c.goal}». Профиль риска: ${c.risk}. ${riskNote}
Тебе приходит СЫРОЙ сигнал от торгового бота. Реши, ОБОСНОВАН ли он, с учётом техники, новостей вокруг актива и состояния рынка (широта). Ответь СТРОГО:
РЕШЕНИЕ: ОДОБРИТЬ|ОТКЛОНИТЬ
УВЕРЕННОСТЬ: <0-100>
ПРИЧИНА: 1-2 предложения.`;
  const user = `Сигнал: ${action || signal} ${symbol} @ ${price} (${reason || 'стратегия'})
[Техника]\n${tech || 'н/д'}
[Сентимент новостей]: ${sent != null ? sent : 'н/д'}
[Широта рынка]: ${breadth ? breadth.pct + '% выше SMA50 — ' + breadth.label + ' (' + breadth.regime + ')' : 'н/д'}`;
  let decision = { approved: false, confidence: 0, reason: 'нет ответа модели' };
  try {
    const r = await ollama.chatStream({ model: c.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], options: { temperature: 0.3 } }, null);
    const txt = r.content || '';
    const approved = /РЕШЕНИЕ:\s*ОДОБРИТЬ/i.test(txt);
    const conf = +((/УВЕРЕННОСТЬ[:\s]*(\d+)/i.exec(txt) || [])[1]) || 0;
    const why = (/ПРИЧИНА:\s*([\s\S]+)/i.exec(txt) || [])[1] || txt;
    decision = { approved: approved && conf >= c.minConfidence, confidence: conf, reason: why.trim().slice(0, 300) };
  } catch (e) { decision = { approved: false, confidence: 0, reason: 'ошибка анализа: ' + e.message }; }

  emit('copilot:considered', { symbol, action: action || signal, approved: decision.approved, confidence: decision.confidence });
  if (decision.approved) {
    const p = { id: 'prop-' + randomUUID().slice(0, 8), symbol, action: action || signal || 'buy', signal, price, confidence: decision.confidence, reasoning: decision.reason, at: Date.now(), status: 'pending' };
    addProposal(p);
    if (c.autoActPaper) { await act(p.id); }
  }
  return decision;
}

// Исполнить предложение (бумага или брокер через гейты).
async function act(id) {
  const p = proposals().find((x) => x.id === id);
  if (!p || p.status === 'executed') return { ok: false, error: 'не найдено' };
  const paper = require('./paper'); const markets = require('./markets');
  const d = await markets.candles({ symbol: p.symbol, interval: '1d', range: '5d' });
  const price = d.ok && d.candles.length ? d.candles[d.candles.length - 1].c : p.price;
  const mode = store.get('settings.copilot.exec', 'paper');
  if (mode === 'broker') {
    try {
      const trading = require('./trading');
      const inst = await trading.findInstrument(p.symbol);
      if (!inst.ok || !inst.instruments.length) return { ok: false, error: 'инструмент не найден' };
      const it = inst.instruments[0];
      const r = await trading.requestOrder({ figi: it.figi, ticker: it.ticker, lots: 1, lotSize: it.lot, direction: p.action }, 'copilot');
      setProposalStatus(id, r.pending ? 'pending-broker' : 'executed');
      return r;
    } catch (e) { return { ok: false, error: e.message }; }
  }
  const amount = +store.get('settings.copilot.amount', 1000);
  const qty = Math.max(1, Math.floor(amount / price));
  const r = paper.trade({ symbol: p.symbol, side: p.action === 'sell' ? 'sell' : 'buy', qty, price, reason: 'copilot', source: 'copilot' });
  setProposalStatus(id, r.ok ? 'executed' : 'failed');
  if (r.ok) emit('watcher:fired', { title: '🧭 Исполнено (бумага): ' + p.symbol, message: `${p.action} ${qty} @ ${price.toFixed(2)}` });
  return r;
}
function dismiss(id) { setProposalStatus(id, 'dismissed'); return { ok: true }; }

// Проактивный мониторинг: ищем возможности под цель/риск, валидируем, предлагаем.
async function monitor() {
  const c = cfg(); if (!c.enabled) return;
  const screener = require('./screener');
  emit('copilot:status', { stage: 'scanning' });
  const filters = c.risk === 'aggressive' ? { rsiMax: 38 } : c.risk === 'conservative' ? { trendUp: true, minChange: 0 } : { trendUp: true };
  let res; try { res = await screener.scan(filters); } catch { return; }
  const candidates = (res.matches || []).slice(0, 3);
  // Не дублируем недавно предложенное.
  const recent = new Set(proposals().filter((p) => Date.now() - p.at < 12 * 3600000).map((p) => p.symbol));
  for (const m of candidates) {
    if (recent.has(m.symbol)) continue;
    await consider({ symbol: m.symbol, action: 'buy', signal: 'monitor', price: m.price, reason: `скринер: RSI ${m.rsi}, тренд ${m.trend}, мес ${m.change1m}%` });
  }
  emit('copilot:status', { stage: 'idle' });
}

function start() { stop(); if (!cfg().enabled) return; timer = setInterval(monitor, cfg().everyMin * 60000); monitor(); }
function stop() { if (timer) { clearInterval(timer); timer = null; } }
function restart() { stop(); start(); }
function init(deps) { if (deps && deps.sendToUI) uiSender = deps.sendToUI; if (cfg().enabled) start(); }

module.exports = { init, setUISender, setCfg, publicCfg, enabled, consider, act, dismiss, monitor, proposals, start, stop };
