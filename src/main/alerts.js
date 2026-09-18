// Алерты по индикаторам/ценам: фоново проверяют условия и шлют уведомления.
// Типы: price_above, price_below, rsi_above, rsi_below. Перезаряжаются, когда
// условие перестаёт выполняться (чтобы не спамить).
const store = require('./store');
const markets = require('./markets');
const { randomUUID } = require('crypto');

let notify = null, timer = null;
function init(deps) { notify = deps && deps.notify; if (timer) clearInterval(timer); timer = setInterval(checkAll, 5 * 60000); checkAll(); }
function shutdown() { if (timer) clearInterval(timer); timer = null; }

function list() { return store.get('priceAlerts', []); }
function save(a) {
  const all = list();
  a.symbol = String(a.symbol || '').toUpperCase();
  a.value = +a.value || 0;
  if (!a.id) { a.id = 'al-' + randomUUID().slice(0, 8); a.enabled = a.enabled !== false; all.push(a); }
  else { const i = all.findIndex((x) => x.id === a.id); if (i >= 0) all[i] = a; else all.push(a); }
  store.set('priceAlerts', all); return a;
}
function remove(id) { store.set('priceAlerts', list().filter((a) => a.id !== id)); return { ok: true }; }
function toggle(id, on) { const all = list(); const a = all.find((x) => x.id === id); if (a) { a.enabled = on; store.set('priceAlerts', all); } return { ok: true }; }

function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = closes.length - n; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  const rs = l === 0 ? 100 : g / l;
  return 100 - 100 / (1 + rs);
}

const LABEL = { price_above: 'цена выше', price_below: 'цена ниже', rsi_above: 'RSI выше', rsi_below: 'RSI ниже' };

async function checkAll() {
  const all = list(); if (!all.length) return;
  // Группируем по тикеру, чтобы не дёргать API лишний раз.
  const bySym = {};
  for (const a of all) { if (a.enabled === false) continue; (bySym[a.symbol] = bySym[a.symbol] || []).push(a); }
  let changed = false;
  for (const [symbol, arr] of Object.entries(bySym)) {
    const d = await markets.candles({ symbol, interval: '1d', range: '3mo' });
    if (!d.ok || !d.candles.length) continue;
    const closes = d.candles.map((c) => c.c);
    const price = closes[closes.length - 1];
    const rv = rsi(closes);
    for (const a of arr) {
      let met = false;
      if (a.type === 'price_above') met = price >= a.value;
      else if (a.type === 'price_below') met = price <= a.value;
      else if (a.type === 'rsi_above') met = rv != null && rv >= a.value;
      else if (a.type === 'rsi_below') met = rv != null && rv <= a.value;
      if (met && !a._fired) {
        a._fired = true; changed = true;
        const cur = a.type.startsWith('rsi') ? `RSI ${rv.toFixed(0)}` : price.toFixed(2);
        // Склейка: сигнал не пользователю, а на проверку ИИ-супервайзеру.
        if (a.toCopilot) { try { const cp = require('./copilot'); if (cp.enabled()) { cp.consider({ symbol, action: a.type.includes('above') && a.type.startsWith('rsi') ? 'sell' : 'buy', signal: 'alert', price, reason: `алерт: ${LABEL[a.type]} ${a.value} (${cur})` }); continue; } } catch {} }
        notify && notify({ title: '🔔 ' + symbol, message: `${LABEL[a.type]} ${a.value} (тек. ${cur})` });
      } else if (!met && a._fired) { a._fired = false; changed = true; }
    }
  }
  if (changed) store.set('priceAlerts', all);
}

module.exports = { init, shutdown, list, save, remove, toggle };
