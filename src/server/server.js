#!/usr/bin/env node
// ОТДЕЛЬНОЕ приложение для торговли — автономный веб-терминал.
//
// Полноценный торговый интерфейс БЕЗ основного приложения и без Electron:
// лёгкий HTTP-сервер на чистом Node.js отдаёт самодостаточный дашборд
// (график, индикаторы, управление ботом, бумажный счёт, статистика, живой
// лог) и JSON-API. Открывается в любом браузере, работает и на сервере/VPS.
// Конфиг и бумажный счёт — общие с приложением и с CLI (тот же каталог данных).
//
//   node src/server/server.js            # http://127.0.0.1:7799
//   PORT=8080 HOST=0.0.0.0 node src/server/server.js
//
// Безопасность: по умолчанию слушает только localhost. Торговый контур не
// ослаблен — веб-терминал управляет БУМАЖНЫМ ботом; для live-брокера
// используйте основное приложение (там заявки проходят все гейты).

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const M = path.join(__dirname, '..', 'main');
const tradingbot = require(path.join(M, 'tradingbot'));
const paper = require(path.join(M, 'paper'));
const markets = require(path.join(M, 'markets'));
const backtest = require(path.join(M, 'backtest'));
const notifier = require(path.join(M, 'notifier'));
const store = require(path.join(M, 'store'));

const PORT = +process.env.PORT || 7799;
const HOST = process.env.HOST || '127.0.0.1';

// ---- Живой поток событий бота в браузер (Server-Sent Events) ----
const sseClients = new Set();
function broadcast(kind, payload) {
  const line = `data: ${JSON.stringify({ kind, ...payload, at: Date.now() })}\n\n`;
  for (const res of sseClients) { try { res.write(line); } catch {} }
}
tradingbot.setUISender((ev, p) => {
  if (ev === 'bot:event') broadcast(p.kind, p);
  else if (ev === 'watcher:fired') broadcast('notice', { title: p.title, message: p.message });
});

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve) => {
    let buf = ''; req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function api(req, res, pathname, query) {
  try {
    // ---- Состояние: конфиг + счёт + статистика + пауза ----
    if (pathname === '/api/state' && req.method === 'GET') {
      const cfg = tradingbot.publicCfg();
      const val = paper.valuation();
      const stats = tradingbot.botStats();
      const pausedUntil = store.get('botPausedUntil', 0) || 0;
      return send(res, 200, { ok: true, cfg, account: val, stats, notify: notifier.publicCfg(), pausedUntil: pausedUntil > Date.now() ? pausedUntil : 0, strategies: backtest.STRATEGIES, profiles: Object.keys(tradingbot.PROFILES) });
    }
    // ---- Сохранить настройки (без авто-старта торговли) ----
    if (pathname === '/api/set' && req.method === 'POST') {
      const patch = await readJson(req);
      tradingbot.setCfg(patch, { noStart: true });
      return send(res, 200, { ok: true, cfg: tradingbot.publicCfg() });
    }
    if (pathname === '/api/profile' && req.method === 'POST') {
      const { name } = await readJson(req);
      const p = tradingbot.PROFILES[name];
      if (!p) return send(res, 400, { ok: false, error: 'Неизвестный режим' });
      tradingbot.setCfg({ profile: name, strategy: p.strategy, params: p.params, interval: p.interval, range: p.range, intervalMin: p.intervalMin, useSentiment: p.useSentiment, confirmTf: p.confirmTf, stopLossPct: p.stopLossPct, takeProfitPct: p.takeProfitPct, trailingPct: p.trailingPct }, { noStart: true });
      return send(res, 200, { ok: true, cfg: tradingbot.publicCfg() });
    }
    // ---- Запуск/остановка автономного цикла ----
    if (pathname === '/api/start' && req.method === 'POST') {
      const cfg = tradingbot.publicCfg();
      if (!cfg.symbols.length) return send(res, 400, { ok: false, error: 'Нет тикеров' });
      tradingbot.setCfg({ enabled: true }, { noStart: true });
      tradingbot.start();
      broadcast('notice', { title: '▶️ Бот запущен', message: `${cfg.mode} · ${cfg.strategy} · ${cfg.symbols.join(', ')}` });
      return send(res, 200, { ok: true, running: true });
    }
    if (pathname === '/api/stop' && req.method === 'POST') {
      tradingbot.setCfg({ enabled: false }, { noStart: true });
      tradingbot.stop();
      broadcast('notice', { title: '⏹️ Бот остановлен', message: '' });
      return send(res, 200, { ok: true, running: false });
    }
    if (pathname === '/api/run-once' && req.method === 'POST') {
      await tradingbot.evaluate(true);
      return send(res, 200, { ok: true, account: paper.valuation() });
    }
    if (pathname === '/api/panic' && req.method === 'POST') {
      tradingbot.setCfg({ enabled: false }, { noStart: true }); tradingbot.stop();
      try { const trading = require(path.join(M, 'trading')); if (trading.panic) await trading.panic(); } catch {}
      broadcast('notice', { title: '🛑 Стоп-кран', message: 'Бот остановлен' });
      return send(res, 200, { ok: true });
    }
    // ---- Мульти-факторный разбор тикера ----
    if (pathname === '/api/insight' && req.method === 'GET') {
      return send(res, 200, await tradingbot.insight(query.symbol));
    }
    // ---- Свечи для графика ----
    if (pathname === '/api/candles' && req.method === 'GET') {
      const d = await markets.candles({ symbol: query.symbol, interval: query.interval || '1d', range: query.range || '6mo' });
      if (!d.ok) return send(res, 200, d);
      return send(res, 200, { ok: true, symbol: d.symbol, candles: d.candles.slice(-200).map((x) => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v })) });
    }
    // ---- Бэктест бота ----
    if (pathname === '/api/backtest' && req.method === 'POST') {
      return send(res, 200, await backtest.runBot(await readJson(req)));
    }
    // ---- Бумажный счёт: сброс, история ----
    if (pathname === '/api/reset' && req.method === 'POST') {
      const { cap } = await readJson(req); paper.reset(+cap || 100000);
      return send(res, 200, { ok: true, account: paper.valuation() });
    }
    if (pathname === '/api/history' && req.method === 'GET') {
      return send(res, 200, { ok: true, history: paper.history() });
    }
    if (pathname === '/api/equity' && req.method === 'GET') {
      return send(res, 200, { ok: true, curve: paper.equityCurve().slice(-500) });
    }
    // ---- Уведомления ----
    if (pathname === '/api/notify' && req.method === 'POST') {
      const body = await readJson(req);
      if (body._test) return send(res, 200, await notifier.test());
      notifier.setCfg(body);
      return send(res, 200, { ok: true, notify: notifier.publicCfg() });
    }
    // ---- Живой поток событий ----
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
      req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
      return;
    }
    send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    send(res, 500, { ok: false, error: e.message });
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  if (pathname.startsWith('/api/')) return api(req, res, pathname, parsed.query);
  // Статика дашборда (только index.html — самодостаточный).
  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(full, (err, data) => {
    if (err) { send(res, 404, 'not found', { 'Content-Type': 'text/plain' }); return; }
    const ext = path.extname(full);
    const mime = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }); res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  📈 Торговый веб-терминал запущен:  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
  console.log(`  Данные: ${store.all ? '(общие с приложением)' : ''}`);
  if (HOST === '0.0.0.0') console.log('  ⚠️ Слушает на всех интерфейсах — открыт из сети. Для локального доступа не задавайте HOST.');
  console.log('  Ctrl+C — остановка.\n');
});
process.on('SIGINT', () => { tradingbot.stop(); server.close(); process.exit(0); });
process.on('SIGTERM', () => { tradingbot.stop(); server.close(); process.exit(0); });

module.exports = { server };
