// DCA — автопокупки по расписанию (усреднение). Периодически покупает на
// фиксированную сумму выбранный актив (бумажный счёт или брокер через гейты).
const store = require('./store');
const markets = require('./markets');
const paper = require('./paper');
const { randomUUID } = require('crypto');

let notify = null, timer = null;
function init(deps) { notify = deps && deps.notify; if (timer) clearInterval(timer); timer = setInterval(tick, 5 * 60000); tick(); }
function shutdown() { if (timer) clearInterval(timer); timer = null; }

function list() { return store.get('dcaPlans', []); }
function save(p) {
  const all = list();
  p.symbol = String(p.symbol || '').toUpperCase();
  p.amount = Math.max(1, +p.amount || 0);
  p.everyHours = Math.max(1, +p.everyHours || 24);
  p.mode = p.mode === 'broker' ? 'broker' : 'paper';
  if (!p.id) { p.id = 'dca-' + randomUUID().slice(0, 8); p.enabled = p.enabled !== false; p.nextRun = Date.now(); p.runs = 0; all.push(p); }
  else { const i = all.findIndex((x) => x.id === p.id); if (i >= 0) { p.runs = all[i].runs || 0; all[i] = p; } else all.push(p); }
  store.set('dcaPlans', all); return p;
}
function remove(id) { store.set('dcaPlans', list().filter((p) => p.id !== id)); return { ok: true }; }
function toggle(id, on) { const all = list(); const p = all.find((x) => x.id === id); if (p) { p.enabled = on; store.set('dcaPlans', all); } return { ok: true }; }

async function execute(plan) {
  const d = await markets.candles({ symbol: plan.symbol, interval: '1d', range: '5d' });
  if (!d.ok || !d.candles.length) return { ok: false, error: 'нет цены' };
  const price = d.candles[d.candles.length - 1].c;
  const qty = Math.floor(plan.amount / price);
  if (qty < 1) return { ok: false, error: 'сумма меньше цены 1 шт' };
  if (plan.mode === 'paper') {
    const r = paper.trade({ symbol: plan.symbol, side: 'buy', qty, price, reason: 'DCA', source: 'dca' });
    if (r.ok) notify && notify({ title: '💵 DCA: ' + plan.symbol, message: `куплено ${qty} @ ${price.toFixed(2)} (бумажный)` });
    return r;
  }
  try {
    const trading = require('./trading');
    const inst = await trading.findInstrument(plan.symbol);
    if (!inst.ok || !inst.instruments.length) return { ok: false, error: 'инструмент не найден' };
    const it = inst.instruments[0];
    const r = await trading.requestOrder({ figi: it.figi, ticker: it.ticker, lots: Math.max(1, Math.floor(qty / (it.lot || 1))), lotSize: it.lot, direction: 'buy' }, 'dca');
    notify && notify({ title: '💵 DCA: ' + plan.symbol, message: r.pending ? 'заявка на подтверждение' : (r.ok ? 'отправлено' : ('ошибка: ' + r.error)) });
    return r;
  } catch (e) { return { ok: false, error: e.message }; }
}

async function tick() {
  const all = list(); let changed = false;
  for (const p of all) {
    if (p.enabled === false) continue;
    if (Date.now() < (p.nextRun || 0)) continue;
    await execute(p);
    p.lastRun = Date.now(); p.nextRun = Date.now() + p.everyHours * 3600000; p.runs = (p.runs || 0) + 1; changed = true;
  }
  if (changed) store.set('dcaPlans', all);
}
async function runNow(id) { const p = list().find((x) => x.id === id); if (!p) return { ok: false }; const r = await execute(p); p.lastRun = Date.now(); p.nextRun = Date.now() + p.everyHours * 3600000; p.runs = (p.runs || 0) + 1; store.set('dcaPlans', list().map((x) => x.id === id ? p : x)); return r; }

module.exports = { init, shutdown, list, save, remove, toggle, runNow };
