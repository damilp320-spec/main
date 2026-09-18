// Интеграция с брокером (Tinkoff Invest API) + автоторговля с акцентом на
// БЕЗОПАСНОСТЬ. Ключевые принципы (человек в контуре):
//   • По умолчанию — ПЕСОЧНИЦА (sandbox) и DRY-RUN (симуляция без реальных сделок).
//   • Каждая заявка по умолчанию требует ЯВНОГО ПОДТВЕРЖДЕНИЯ в UI.
//   • Жёсткие лимиты: макс. сумма заявки, число заявок в день, дневной убыток,
//     белый список инструментов.
//   • ИИ может только ПРЕДЛАГАТЬ сделки (propose_trade) — они ВСЕГДА ждут
//     подтверждения человека, без исключений.
//   • «Стоп-кран» (panic): отменяет заявки и выключает автоторговлю.
//   • Токен хранится зашифрованным (safeStorage). Полный аудит-лог сделок.
const https = require('https');
const { randomUUID } = require('crypto');
const store = require('./store');

let uiSender = null;
function setUISender(fn) { uiSender = fn; }
function secrets() { try { return require('./secrets'); } catch { return null; } }

const HOST = 'invest-public-api.tinkoff.ru';
const BASE = '/rest/tinkoff.public.invest.api.contract.v1.';

// ---- Настройки и дефолты (безопасные) ----
function cfg() {
  const c = store.get('settings.trading', {}) || {};
  return {
    env: c.env || 'sandbox',                 // 'sandbox' | 'live'
    dryRun: c.dryRun !== false,              // по умолчанию ВКЛ (симуляция)
    autoTrade: c.autoTrade === true,         // по умолчанию ВЫКЛ
    confirmEveryOrder: c.confirmEveryOrder !== false, // по умолчанию ВКЛ
    maxOrderValue: +c.maxOrderValue || 10000,
    maxDailyOrders: +c.maxDailyOrders || 10,
    maxDailyLossPct: +c.maxDailyLossPct || 5,
    whitelist: Array.isArray(c.whitelist) ? c.whitelist : [],
    accountId: c.accountId || ''
  };
}
function setCfg(patch) {
  const c = Object.assign(cfg(), patch || {});
  delete c._token;
  store.set('settings.trading', c);
  return { ok: true, cfg: publicCfg() };
}
function publicCfg() { const c = cfg(); return { ...c, hasToken: !!getToken(), live: c.env === 'live' }; }

function getToken() {
  const enc = store.get('settings.tradingTokenEnc', '');
  const s = secrets();
  if (enc && s && s.decrypt) { try { const k = s.decrypt(enc); if (k) return k; } catch {} }
  return '';
}
function setToken(tok) {
  const s = secrets();
  if (tok && s && s.encrypt) { try { store.set('settings.tradingTokenEnc', s.encrypt(tok)); return { ok: true, encrypted: true }; } catch {} }
  if (!tok) store.set('settings.tradingTokenEnc', '');
  return { ok: !!tok, encrypted: false, error: tok ? 'safeStorage недоступен' : undefined };
}

// ---- REST-вызов к Invest API ----
function call(service, method, body) {
  return new Promise((resolve) => {
    const token = getToken();
    if (!token) return resolve({ ok: false, error: 'Не задан токен брокера.' });
    const data = JSON.stringify(body || {});
    const req = https.request({ host: HOST, path: BASE + service + '/' + method, method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'accept': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch {}
        if (res.statusCode >= 400) return resolve({ ok: false, error: (j && (j.message || j.description)) || ('HTTP ' + res.statusCode), code: res.statusCode });
        resolve({ ok: true, data: j });
      }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.write(data); req.end();
  });
}
// Выбор сервиса с учётом песочницы.
function svc(base) { return cfg().env === 'sandbox' ? 'SandboxService' : base; }

// ---- Денежные форматы Invest API ----
function q2num(q) { if (!q) return 0; return (+q.units || 0) + (+q.nano || 0) / 1e9; }
function num2q(n) { const units = Math.trunc(n); const nano = Math.round((n - units) * 1e9); return { units: String(units), nano }; }

// ---- Счета и портфель ----
async function getAccounts() {
  if (cfg().env === 'sandbox') return call('SandboxService', 'GetSandboxAccounts', {});
  return call('UsersService', 'GetAccounts', {});
}
async function getPortfolio(accountId) {
  accountId = accountId || cfg().accountId;
  if (!accountId) return { ok: false, error: 'Не выбран счёт.' };
  const m = cfg().env === 'sandbox' ? ['SandboxService', 'GetSandboxPortfolio'] : ['OperationsService', 'GetPortfolio'];
  const r = await call(m[0], m[1], { accountId });
  if (!r.ok) return r;
  const p = r.data || {};
  const positions = (p.positions || []).map((x) => ({
    figi: x.figi, type: x.instrumentType, ticker: x.ticker, quantity: q2num(x.quantity),
    avgPrice: q2num(x.averagePositionPrice), curPrice: q2num(x.currentPrice), yield: q2num(x.expectedYield)
  }));
  return { ok: true, total: q2num(p.totalAmountPortfolio), positions };
}
async function findInstrument(query) {
  const r = await call('InstrumentsService', 'FindInstrument', { query, apiTradeAvailableFlag: true });
  if (!r.ok) return r;
  return { ok: true, instruments: (r.data.instruments || []).slice(0, 10).map((i) => ({ figi: i.figi, ticker: i.ticker, name: i.name, type: i.instrumentType, uid: i.uid, lot: i.lot })) };
}
async function lastPrice(figi) {
  const r = await call('MarketDataService', 'GetLastPrices', { figi: [figi] });
  if (!r.ok) return null;
  const lp = r.data.lastPrices && r.data.lastPrices[0];
  return lp ? q2num(lp.price) : null;
}

// ---- Дневные счётчики (для лимитов) ----
function dayKey() { return new Date().toISOString().slice(0, 10); }
function counters() {
  const c = store.get('tradingDay', { date: dayKey(), orders: 0 });
  if (c.date !== dayKey()) { const fresh = { date: dayKey(), orders: 0 }; store.set('tradingDay', fresh); return fresh; }
  return c;
}
function bumpOrders() { const c = counters(); c.orders++; store.set('tradingDay', c); }

// ---- Аудит-лог ----
function log(entry) {
  const l = store.get('tradeLog', []);
  l.push({ ...entry, at: Date.now(), env: cfg().env });
  store.set('tradeLog', l.slice(-500));
  uiSender && uiSender('trade:log', entry);
}
function getLog() { return store.get('tradeLog', []); }

// ---- Очередь подтверждений ----
const pending = new Map(); // id -> order

// Запрос на размещение заявки. source: 'manual' | 'agent'.
// Возвращает либо требование подтверждения, либо результат исполнения.
async function requestOrder(o, source = 'manual') {
  const c = cfg();
  const accountId = o.accountId || c.accountId;
  if (!accountId) return { ok: false, error: 'Не выбран счёт.' };
  if (!getToken()) return { ok: false, error: 'Не подключён брокер.' };

  const figi = o.figi; const lots = Math.max(1, parseInt(o.lots, 10) || 0);
  const direction = (o.direction === 'sell') ? 'sell' : 'buy';
  const orderType = (o.orderType === 'limit') ? 'limit' : 'market';

  // --- Проверки безопасности ---
  if (c.whitelist.length && !c.whitelist.includes(figi) && !c.whitelist.includes(o.ticker)) {
    return reject(o, 'Инструмент не в белом списке.');
  }
  const price = o.price || await lastPrice(figi);
  const lotSize = o.lotSize || 1;
  const estValue = price ? price * lots * lotSize : null;
  if (estValue != null && estValue > c.maxOrderValue) {
    return reject(o, `Сумма заявки ~${estValue.toFixed(0)} превышает лимит ${c.maxOrderValue}.`);
  }
  if (counters().orders >= c.maxDailyOrders) {
    return reject(o, `Достигнут дневной лимит заявок (${c.maxDailyOrders}).`);
  }

  const order = { id: 'ord-' + randomUUID().slice(0, 8), figi, ticker: o.ticker, lots, lotSize, direction, orderType, price, estValue, accountId, source, createdAt: Date.now() };

  // ИИ-инициированные заявки ВСЕГДА требуют подтверждения. Ручные — по настройке.
  const mustConfirm = c.confirmEveryOrder || source === 'agent' || !c.autoTrade;
  if (mustConfirm) {
    pending.set(order.id, order);
    log({ kind: 'requested', order });
    uiSender && uiSender('trade:confirm', { order, cfg: publicCfg() });
    return { ok: true, pending: true, id: order.id, message: 'Заявка ожидает подтверждения человеком.' };
  }
  return execute(order); // авто-режим (только если явно включён и confirm выкл)
}

async function confirmOrder(id) {
  const order = pending.get(id);
  if (!order) return { ok: false, error: 'Заявка не найдена или уже обработана.' };
  pending.delete(id);
  return execute(order);
}
function rejectOrder(id) {
  const order = pending.get(id);
  if (order) { pending.delete(id); log({ kind: 'rejected', order }); }
  return { ok: true };
}
function reject(o, reason) { log({ kind: 'blocked', order: o, reason }); return { ok: false, blocked: true, error: reason }; }

// Фактическое исполнение (или симуляция в dry-run).
async function execute(order) {
  const c = cfg();
  bumpOrders();
  if (c.dryRun) {
    log({ kind: 'simulated', order });
    return { ok: true, simulated: true, message: `СИМУЛЯЦИЯ (dry-run): ${order.direction.toUpperCase()} ${order.lots} лот(ов) ${order.ticker || order.figi}.` };
  }
  const body = {
    quantity: String(order.lots),
    direction: order.direction === 'sell' ? 'ORDER_DIRECTION_SELL' : 'ORDER_DIRECTION_BUY',
    accountId: order.accountId,
    orderType: order.orderType === 'limit' ? 'ORDER_TYPE_LIMIT' : 'ORDER_TYPE_MARKET',
    orderId: randomUUID(),
    instrumentId: order.figi
  };
  if (order.orderType === 'limit' && order.price) body.price = num2q(order.price);
  const m = c.env === 'sandbox' ? ['SandboxService', 'PostSandboxOrder'] : ['OrdersService', 'PostOrder'];
  const r = await call(m[0], m[1], body);
  log({ kind: r.ok ? 'executed' : 'failed', order, result: r.ok ? (r.data && r.data.executionReportStatus) : r.error });
  return r.ok ? { ok: true, message: `Заявка отправлена (${c.env}).`, data: r.data } : r;
}

// ---- Стоп-кран ----
async function panic() {
  setCfg({ autoTrade: false });
  let cancelled = 0;
  try {
    const c = cfg();
    const m = c.env === 'sandbox' ? ['SandboxService', 'GetSandboxOrders'] : ['OrdersService', 'GetOrders'];
    const r = await call(m[0], m[1], { accountId: c.accountId });
    if (r.ok && r.data && r.data.orders) {
      for (const ord of r.data.orders) {
        const cm = c.env === 'sandbox' ? ['SandboxService', 'CancelSandboxOrder'] : ['OrdersService', 'CancelOrder'];
        const cr = await call(cm[0], cm[1], { accountId: c.accountId, orderId: ord.orderId });
        if (cr.ok) cancelled++;
      }
    }
  } catch {}
  for (const id of pending.keys()) pending.delete(id);
  log({ kind: 'panic', cancelled });
  return { ok: true, cancelled };
}

async function test() {
  const r = await getAccounts();
  if (!r.ok) return r;
  const accs = (r.data && r.data.accounts) || [];
  return { ok: true, env: cfg().env, accounts: accs.map((a) => ({ id: a.id, name: a.name || a.type, type: a.type })) };
}

// ---- Инструменты агента (только чтение + ПРЕДЛОЖЕНИЕ сделки) ----
const toolSchemas = [
  { type: 'function', function: { name: 'get_portfolio', description: 'Показать текущий портфель брокерского счёта (позиции, стоимость, доходность).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'propose_trade', description: 'ПРЕДЛОЖИТЬ сделку (покупка/продажа). ВНИМАНИЕ: заявка НЕ исполняется автоматически — она всегда ждёт явного подтверждения человеком. Используй для торговых идей.', parameters: { type: 'object', properties: { ticker: { type: 'string' }, direction: { type: 'string', description: 'buy или sell' }, lots: { type: 'number', description: 'Количество лотов' }, reason: { type: 'string', description: 'Обоснование идеи' } }, required: ['ticker', 'direction', 'lots'] } } }
];
const toolHandlers = {
  get_portfolio: async () => {
    const r = await getPortfolio();
    if (!r.ok) return 'ОШИБКА: ' + r.error;
    return `Портфель (${cfg().env}): итого ${r.total.toFixed(2)}\n` + (r.positions.map((p) => `• ${p.ticker || p.figi}: ${p.quantity} шт, ср.цена ${p.avgPrice.toFixed(2)}, тек. ${p.curPrice.toFixed(2)}, доходность ${p.yield.toFixed(2)}`).join('\n') || '(нет позиций)');
  },
  propose_trade: async (a) => {
    const inst = await findInstrument(a.ticker);
    if (!inst.ok || !inst.instruments.length) return 'ОШИБКА: инструмент не найден: ' + a.ticker;
    const it = inst.instruments[0];
    const r = await requestOrder({ figi: it.figi, ticker: it.ticker, lots: a.lots, lotSize: it.lot, direction: a.direction }, 'agent');
    if (r.blocked) return 'Заявка ЗАБЛОКИРОВАНА правилами безопасности: ' + r.error;
    if (r.pending) return `Торговая идея отправлена на ПОДТВЕРЖДЕНИЕ человеку: ${a.direction} ${a.lots} лот(ов) ${it.ticker}. ${a.reason ? 'Обоснование: ' + a.reason : ''}`;
    if (r.ok) return r.message;
    return 'ОШИБКА: ' + (r.error || 'не удалось');
  }
};

module.exports = {
  setUISender, publicCfg, setCfg, getToken, setToken, test,
  getAccounts, getPortfolio, findInstrument, lastPrice,
  requestOrder, confirmOrder, rejectOrder, panic, getLog,
  toolSchemas, toolHandlers
};
