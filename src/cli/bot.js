#!/usr/bin/env node
// Автономный запуск торгового бота БЕЗ основного приложения (headless).
//
// Использует те же модули main-процесса (tradingbot/paper/markets/backtest/
// indicators/notifier/trading), но без Electron и без UI. Конфиг общий с
// приложением (тот же каталог userData), поэтому настройки, сделанные в GUI,
// подхватываются здесь и наоборот. Секреты (токен брокера) в headless-режиме
// не расшифровываются — для live-брокера используйте GUI; бумажный режим
// работает полностью автономно.
//
// Примеры:
//   node src/cli/bot.js run                 # демон: цикл по intervalMin
//   node src/cli/bot.js once                # один прогон и выход
//   node src/cli/bot.js config              # показать настройки
//   node src/cli/bot.js set mode=paper strategy=confluence symbols=AAPL,BTC-USD
//   node src/cli/bot.js set enabled=true intervalMin=15
//   node src/cli/bot.js profile moderate    # применить профиль риска
//   node src/cli/bot.js stats               # статистика сделок бота
//   node src/cli/bot.js insight AAPL        # мульти-факторный разбор тикера
//   node src/cli/bot.js account             # состояние бумажного счёта
//   node src/cli/bot.js reset 100000        # сбросить бумажный счёт
//   node src/cli/bot.js notify test         # проверить Telegram/webhook
//   node src/cli/bot.js panic               # аварийно остановить бота
//
// Каталог данных можно переопределить: MYTHERA_DATA_DIR=/path node src/cli/bot.js run

const path = require('path');
const M = path.join(__dirname, '..', 'main');
const tradingbot = require(path.join(M, 'tradingbot'));
const paper = require(path.join(M, 'paper'));
const notifier = require(path.join(M, 'notifier'));
const store = require(path.join(M, 'store'));

const C = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m' };
const color = process.stdout.isTTY;
const c = (code, s) => (color ? code + s + C.reset : s);
const ts = () => new Date().toLocaleTimeString();

// Печать событий бота в консоль (тот же поток, что уходит в UI).
function logEvent(ev, payload) {
  if (ev === 'watcher:fired') { console.log(c(C.yellow, `[${ts()}] 🔔 ${payload.title} — ${payload.message}`)); return; }
  if (ev !== 'bot:event') return;
  const e = payload || {};
  const icons = { signal: '📊', trade: '✅', order: '📤', skip: c(C.dim, '⤵️'), error: '⚠️', status: '🔄', exit: '🚪', confirm: '🧭', autoStrat: '🧠', shadow: '🌓' };
  const ic = icons[e.kind] || '•';
  let msg;
  if (e.kind === 'trade') msg = c(C.green, `${e.symbol}: ${e.side} ${e.qty} @ ${fx(e.price)}${e.pnl != null ? ' · P&L ' + e.pnl : ''}`);
  else if (e.kind === 'exit') msg = c(C.cyan, `${e.symbol}: выход (${e.reason}) @ ${fx(e.price)}`);
  else if (e.kind === 'error') msg = c(C.red, `${e.symbol || ''} ${e.message || ''}`);
  else if (e.kind === 'signal') msg = `${e.symbol}: сигнал ${e.signal} @ ${fx(e.price)}`;
  else if (e.kind === 'shadow') return; // слишком шумно для консоли
  else msg = `${e.symbol || ''} ${e.message || ''}`.trim();
  if (!msg) return; // пустые статус-события (running true/false) не печатаем
  console.log(`[${ts()}] ${ic} ${msg}`);
}
function fx(n) { return (n != null && n.toFixed) ? n.toFixed(2) : n; }

// Разбор `key=value` с приведением типов (bool/number/list/JSON-объект params).
function parseSet(args) {
  const patch = {};
  for (const a of args) {
    const i = a.indexOf('=');
    if (i < 0) continue;
    const k = a.slice(0, i), raw = a.slice(i + 1);
    if (k === 'symbols') patch.symbols = raw.split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === 'params') { try { patch.params = JSON.parse(raw); } catch { console.error('params: ожидался JSON'); } }
    else if (raw === 'true' || raw === 'false') patch[k] = raw === 'true';
    else if (raw !== '' && !isNaN(+raw)) patch[k] = +raw;
    else patch[k] = raw;
  }
  return patch;
}

function printCfg() {
  const cfg = tradingbot.publicCfg();
  const show = ['enabled', 'running', 'mode', 'strategy', 'signalRoute', 'symbols', 'interval', 'range', 'intervalMin', 'qty', 'sizeMode', 'riskAmount',
    'stopType', 'atrMult', 'stopLossPct', 'takeProfitPct', 'trailingPct', 'tp1Pct', 'tp1SellPct', 'breakeven',
    'confirmTf', 'useSentiment', 'regimeFilter', 'shadowMode', 'maxDrawdownPct', 'maxDailyLossPct',
    'volumeFilter', 'adxMin', 'patternFilter', 'srFilter', 'minConfluence', 'cooldownMin',
    'maxPositions', 'maxPosPct', 'corrMax', 'tradeHours', 'skipWeekend'];
  console.log(c(C.bold, '🤖 Настройки бота:'));
  for (const k of show) { const v = cfg[k]; console.log(`  ${k.padEnd(16)} ${c(C.cyan, Array.isArray(v) ? v.join(', ') : String(v))}`); }
  if (cfg.brokerSafe) console.log(c(C.dim, `  broker: ${cfg.brokerSafe.live ? 'LIVE' : 'sandbox'}${cfg.brokerSafe.dryRun ? ' · dry-run' : ''} · confirm=${cfg.brokerSafe.confirm}`));
  const pausedUntil = store.get('botPausedUntil', 0) || 0;
  if (pausedUntil > Date.now()) console.log(c(C.yellow, `  ⏸️ пауза (дневной лимит) до ${new Date(pausedUntil).toLocaleString()}`));
}

function printStats() {
  const s = tradingbot.botStats();
  if (!s.ok) { console.log(c(C.dim, `Закрытых сделок бота нет${s.buys ? ` (открытых покупок: ${s.buys})` : ''}.`)); return; }
  console.log(c(C.bold, '📊 Статистика сделок бота:'));
  console.log(`  сделок ${s.trades} · винрейт ${c(s.winRate >= 50 ? C.green : C.red, s.winRate + '%')} · PF ${c(s.profitFactor >= 1 ? C.green : C.red, s.profitFactor)}`);
  console.log(`  P&L ${c(s.totalPnl >= 0 ? C.green : C.red, (s.totalPnl >= 0 ? '+' : '') + s.totalPnl)} · матожидание ${s.expectancy} · ср.+${s.avgWin}/−${s.avgLoss} · лучшая +${s.best}/худшая ${s.worst}`);
  for (const x of s.symbols.slice(0, 10)) console.log(`    ${x.symbol.padEnd(10)} ${x.trades} сд · ${x.winRate}% · ${c(x.pnl >= 0 ? C.green : C.red, (x.pnl >= 0 ? '+' : '') + x.pnl)}`);
}

function printAccount() {
  const v = paper.valuation();
  console.log(c(C.bold, '🧪 Бумажный счёт:'));
  console.log(`  капитал ${c(C.cyan, v.equity.toLocaleString())} · наличные ${v.cash.toLocaleString()} · P&L ${c(v.totalPnl >= 0 ? C.green : C.red, (v.totalPnl >= 0 ? '+' : '') + v.totalPnl + ' (' + v.totalPnlPct + '%)')}`);
  if (v.positions.length) for (const p of v.positions) console.log(`    ${p.symbol.padEnd(10)} ×${p.qty} ср.${p.avg.toFixed(2)} тек.${p.price.toFixed(2)} ${c(p.pnl >= 0 ? C.green : C.red, (p.pnl >= 0 ? '+' : '') + p.pnl + ' (' + p.pnlPct + '%)')}`);
  else console.log(c(C.dim, '    позиций нет'));
}

async function printInsight(symbol) {
  const r = await tradingbot.insight(symbol);
  if (!r.ok) { console.error(c(C.red, '⚠️ ' + r.error)); return; }
  const vc = { strong_buy: C.green, buy: C.green, neutral: C.dim, sell: C.red, strong_sell: C.red }[r.verdict] || C.reset;
  console.log(c(C.bold, `🔍 ${r.symbol} @ ${r.price}`) + ' — ' + c(vc, `${r.verdict} (${r.score})`));
  for (const k of r.components) console.log(`  ${k.label.padEnd(24)} ${c(k.score >= 0 ? C.green : C.red, (k.score >= 0 ? '+' : '') + k.score)}${k.note ? c(C.dim, '  ' + k.note) : ''}`);
  if (r.sr && r.sr.support) console.log(c(C.dim, `  поддержка ${r.sr.support.price}${r.sr.resistance ? ' · сопротивление ' + r.sr.resistance.price : ''}`));
  if (r.htf) console.log(c(C.dim, `  старший ТФ ${r.htf.interval}: ${r.htf.trend}`));
  if (r.news) console.log(c(C.dim, `  новости: ${r.news.score > 0 ? '+' : ''}${r.news.score}`));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  tradingbot.setUISender(logEvent);

  switch (cmd) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 27).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      break;

    case 'config':
    case 'cfg':
      printCfg();
      break;

    case 'set': {
      const patch = parseSet(rest);
      if (!Object.keys(patch).length) { console.error('Нечего менять. Пример: set mode=paper symbols=AAPL,BTC-USD enabled=true'); process.exit(1); }
      tradingbot.setCfg(patch, { noStart: true }); // только сохранить, без торговли
      console.log(c(C.green, '✓ сохранено'));
      printCfg();
      break;
    }

    case 'profile': {
      const name = rest[0];
      const p = tradingbot.PROFILES[name];
      if (!p) { console.error(c(C.red, '⚠️ Неизвестный режим. Доступно: ' + Object.keys(tradingbot.PROFILES).join(', '))); process.exit(1); }
      tradingbot.setCfg({ profile: name, strategy: p.strategy, params: p.params, interval: p.interval, range: p.range, intervalMin: p.intervalMin, useSentiment: p.useSentiment, confirmTf: p.confirmTf, stopLossPct: p.stopLossPct, takeProfitPct: p.takeProfitPct, trailingPct: p.trailingPct }, { noStart: true });
      console.log(c(C.green, `✓ профиль «${name}» применён`));
      printCfg();
      break;
    }

    case 'enable':
      tradingbot.setCfg({ enabled: true }, { noStart: true });
      console.log(c(C.green, '✓ бот включён (запустите `run` для автономной работы)'));
      break;
    case 'disable':
      tradingbot.setCfg({ enabled: false }, { noStart: true });
      console.log(c(C.yellow, '✓ бот выключен'));
      break;

    case 'once': {
      console.log(c(C.dim, `[${ts()}] прогон…`));
      await tradingbot.evaluate(true); // force: один прогон даже если enabled=false
      console.log(c(C.green, `[${ts()}] ✓ прогон завершён`));
      printAccount();
      break;
    }

    case 'run': {
      const cfg = tradingbot.publicCfg();
      if (!cfg.symbols.length) { console.error(c(C.red, '⚠️ нет тикеров. Задайте: set symbols=AAPL,BTC-USD')); process.exit(1); }
      if (!cfg.enabled) { console.log(c(C.yellow, 'ℹ️ бот выключен — включаю для этого запуска (enabled=true)')); tradingbot.setCfg({ enabled: true }, { noStart: true }); }
      const iv = tradingbot.publicCfg().intervalMin;
      console.log(c(C.bold, `🤖 Автономный бот запущен. Режим: ${cfg.mode} · стратегия: ${cfg.strategy} · тикеры: ${cfg.symbols.join(', ')} · интервал: ${iv} мин.`));
      console.log(c(C.dim, 'Ctrl+C для остановки. Уведомления: ' + (notifier.cfg().telegramToken || notifier.cfg().webhookUrl ? 'настроены' : 'нет')));
      try { await notifier.send(`🤖 Автономный торговый бот запущен (${cfg.mode}, ${cfg.strategy}, ${cfg.symbols.join(', ')}).`); } catch {}
      tradingbot.start(); // сам запускает первый evaluate + setInterval
      const shutdown = async () => {
        console.log(c(C.yellow, '\nОстановка…'));
        tradingbot.stop();
        try { await notifier.send('🛑 Автономный торговый бот остановлен.'); } catch {}
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      break; // держим процесс живым через таймер бота
    }

    case 'stats':
      printStats();
      break;

    case 'account':
    case 'acc':
      printAccount();
      break;

    case 'insight':
      await printInsight(rest[0]);
      break;

    case 'reset': {
      const cap = +rest[0] || 100000;
      paper.reset(cap);
      console.log(c(C.green, `✓ бумажный счёт сброшен к ${cap.toLocaleString()}`));
      break;
    }

    case 'notify': {
      const sub = rest[0];
      if (sub === 'test') { const r = await notifier.test(); console.log(r.ok ? c(C.green, '✓ уведомление отправлено') : c(C.red, '⚠️ ' + (r.error || 'не удалось'))); }
      else if (sub === 'set') { notifier.setCfg(parseSet(rest.slice(1))); console.log(c(C.green, '✓ сохранено'), notifier.publicCfg()); }
      else console.log('notify test | notify set telegramToken=... telegramChat=... webhookUrl=...');
      break;
    }

    case 'serve': {
      // Запуск отдельного веб-терминала (тот же процесс).
      const p = rest.find((a) => /^\d+$/.test(a));
      if (p) process.env.PORT = p;
      require(path.join(__dirname, '..', 'server', 'server'));
      break; // сервер держит процесс живым
    }

    case 'panic':
      tradingbot.setCfg({ enabled: false });
      tradingbot.stop();
      try { const trading = require(path.join(M, 'trading')); if (trading.panic) await trading.panic(); } catch {}
      console.log(c(C.red, '🛑 бот остановлен, автоторговля выключена'));
      break;

    default:
      console.error(c(C.red, 'Неизвестная команда: ' + cmd) + '. Запустите без аргументов для справки.');
      process.exit(1);
  }
}

main().catch((e) => { console.error(c(C.red, 'Ошибка: ' + (e && e.stack || e))); process.exit(1); });
