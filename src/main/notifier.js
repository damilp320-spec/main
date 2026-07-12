// Внешние уведомления бота: Telegram и/или произвольный webhook (POST JSON).
// Работает и в приложении, и в headless-режиме (CLI) — чтобы бот, запущенный
// без интерфейса, сообщал о сделках, выходах и ошибках. Без зависимостей.
const https = require('https');
const store = require('./store');

function cfg() {
  const c = store.get('settings.notify', {}) || {};
  return {
    telegramToken: c.telegramToken || '',
    telegramChat: c.telegramChat || '',
    webhookUrl: c.webhookUrl || '',
    onTrade: c.onTrade !== false,   // сделки — по умолчанию ВКЛ
    onExit: c.onExit !== false,     // выходы (стоп/тейк) — по умолчанию ВКЛ
    onError: c.onError === true,    // ошибки — по умолчанию выкл
    onSignal: c.onSignal === true   // каждый сигнал — по умолчанию выкл (шумно)
  };
}
function setCfg(patch) { store.set('settings.notify', Object.assign(cfg(), patch || {})); return { ok: true, cfg: publicCfg() }; }
function publicCfg() { const c = cfg(); return { ...c, telegramToken: c.telegramToken ? '•••' + c.telegramToken.slice(-4) : '' }; }

function post(url, body, extraHeaders) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: e.message }); }
    const data = JSON.stringify(body || {});
    const req = https.request({ host: u.host, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(extraHeaders || {}) } },
      (res) => { let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, body: buf.slice(0, 300) })); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.write(data); req.end();
  });
}

// Отправить текст во все настроенные каналы.
async function send(text, payload) {
  const c = cfg();
  const results = {};
  if (c.telegramToken && c.telegramChat) {
    results.telegram = await post(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, { chat_id: c.telegramChat, text, disable_web_page_preview: true });
  }
  if (c.webhookUrl) {
    results.webhook = await post(c.webhookUrl, { text, ...(payload || {}), at: Date.now(), source: 'mythera-bot' });
  }
  const any = Object.values(results);
  return { ok: any.length ? any.some((r) => r.ok) : false, configured: any.length > 0, results };
}

// Уведомление о событии бота (kind — как в bot:event).
const fmt = (n) => (n != null && n.toFixed ? n.toFixed(2) : n);
function botMessage(kind, e) {
  if (kind === 'trade') return `🤖 Бот: ${e.side === 'buy' ? '🟢 ПОКУПКА' : '🔴 ПРОДАЖА'} ${e.symbol} ×${e.qty} @ ${fmt(e.price)}${e.pnl != null ? ` · P&L ${e.pnl}` : ''}`;
  if (kind === 'exit') return `🚪 Бот: выход ${e.symbol} (${e.reason}) @ ${fmt(e.price)}`;
  if (kind === 'error') return `⚠️ Бот, ошибка ${e.symbol || ''}: ${e.message || ''}`;
  if (kind === 'signal') return `📊 Бот: сигнал ${e.signal} ${e.symbol} @ ${fmt(e.price)}`;
  if (kind === 'order') return `📤 Бот: заявка ${e.signal || ''} ${e.symbol} — ${e.message || ''}`;
  return null;
}
async function notifyBot(kind, e) {
  const c = cfg();
  const want = (kind === 'trade' && c.onTrade) || (kind === 'exit' && c.onExit) || (kind === 'error' && c.onError) || (kind === 'signal' && c.onSignal) || kind === 'order' && c.onTrade;
  if (!want) return { ok: true, skipped: true };
  const text = botMessage(kind, e || {});
  if (!text) return { ok: true, skipped: true };
  return send(text, { kind, ...e });
}

async function test() {
  const r = await send('✅ Mythera AI Hub: тестовое уведомление торгового бота.');
  if (!r.configured) return { ok: false, error: 'Каналы не настроены: укажите Telegram-токен и chat_id или webhook URL.' };
  return r;
}

module.exports = { cfg, setCfg, publicCfg, send, notifyBot, test };
