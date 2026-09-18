// Скринер активов и рыночная широта. Сканирует набор тикеров по условиям
// (RSI, тренд, изменение, близость к экстремуму, пробой) и считает «широту»
// рынка (доля активов выше своей SMA50) как индикатор риск-он/риск-офф.
const markets = require('./markets');
const store = require('./store');

const POPULAR = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'NFLX', 'JPM', 'V', 'XOM', 'BTC-USD', 'ETH-USD', 'SOL-USD', 'SPY', 'QQQ'];

function rsi(c, n = 14) { if (c.length < n + 1) return null; let g = 0, l = 0; for (let i = c.length - n; i < c.length; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; } const rs = l === 0 ? 100 : g / l; return +(100 - 100 / (1 + rs)).toFixed(1); }
function smaLast(c, n) { if (c.length < n) return null; let s = 0; for (let i = c.length - n; i < c.length; i++) s += c[i]; return s / n; }

async function metrics(symbol) {
  const d = await markets.candles({ symbol, interval: '1d', range: '6mo' });
  if (!d.ok || d.candles.length < 30) return null;
  const c = d.candles.map((x) => x.c);
  const price = c[c.length - 1];
  const sma20 = smaLast(c, 20), sma50 = smaLast(c, 50);
  const hi = Math.max(...c.slice(-60)), lo = Math.min(...c.slice(-60));
  const chg = (price / c[c.length - 22] - 1) * 100; // ~месяц
  const breakout = price >= Math.max(...d.candles.slice(-21, -1).map((x) => x.h));
  return { symbol, price: +price.toFixed(2), rsi: rsi(c), sma20: sma20 ? +sma20.toFixed(2) : null, sma50: sma50 ? +sma50.toFixed(2) : null, change1m: +chg.toFixed(1), aboveSma50: sma50 ? price > sma50 : null, nearLow: +(((price - lo) / (hi - lo)) * 100).toFixed(0), breakout, trend: sma20 && price > sma20 ? 'up' : 'down' };
}

function universe(custom) {
  const wl = store.get('marketWatchlist', []).map((w) => w.symbol);
  return [...new Set([...(custom && custom.length ? custom : []), ...(custom && custom.length ? [] : wl), ...POPULAR])].slice(0, 24);
}

async function scan(filters, custom) {
  filters = filters || {};
  const syms = universe(custom);
  const all = (await Promise.all(syms.map((s) => metrics(s).catch(() => null)))).filter(Boolean);
  const match = all.filter((m) => {
    if (filters.rsiMax != null && !(m.rsi != null && m.rsi <= filters.rsiMax)) return false;
    if (filters.rsiMin != null && !(m.rsi != null && m.rsi >= filters.rsiMin)) return false;
    if (filters.trendUp && m.trend !== 'up') return false;
    if (filters.trendDown && m.trend !== 'down') return false;
    if (filters.minChange != null && !(m.change1m >= filters.minChange)) return false;
    if (filters.maxChange != null && !(m.change1m <= filters.maxChange)) return false;
    if (filters.breakout && !m.breakout) return false;
    if (filters.nearLow != null && !(m.nearLow <= filters.nearLow)) return false;
    return true;
  });
  match.sort((a, b) => b.change1m - a.change1m);
  return { ok: true, matches: match, scanned: all.length };
}

// Рыночная широта: доля активов выше своей SMA50 → риск-он/риск-офф.
async function breadth(custom) {
  const syms = universe(custom);
  const all = (await Promise.all(syms.map((s) => metrics(s).catch(() => null)))).filter((m) => m && m.aboveSma50 != null);
  if (!all.length) return { ok: false, error: 'нет данных' };
  const above = all.filter((m) => m.aboveSma50).length;
  const pct = Math.round((above / all.length) * 100);
  const label = pct >= 70 ? 'Жадность (риск-он)' : pct >= 50 ? 'Нейтрально-бычий' : pct >= 30 ? 'Осторожность' : 'Страх (риск-офф)';
  return { ok: true, pct, above, total: all.length, label, regime: pct >= 50 ? 'risk-on' : 'risk-off' };
}

const toolSchemas = [
  { type: 'function', function: { name: 'screen_assets', description: 'Скринер активов по условиям: rsiMax, rsiMin, trendUp, minChange, breakout, nearLow. Возвращает подходящие тикеры с метриками.', parameters: { type: 'object', properties: { rsiMax: { type: 'number' }, rsiMin: { type: 'number' }, trendUp: { type: 'boolean' }, minChange: { type: 'number' }, breakout: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'market_breadth', description: 'Рыночная широта (доля активов выше SMA50) — индикатор риск-он/риск-офф.', parameters: { type: 'object', properties: {} } } }
];
const toolHandlers = {
  screen_assets: async (a) => { const r = await scan(a); return r.matches.length ? r.matches.slice(0, 12).map((m) => `${m.symbol}: ${m.price} RSI ${m.rsi} тренд ${m.trend} мес ${m.change1m >= 0 ? '+' : ''}${m.change1m}%`).join('\n') : 'Под условия ничего не найдено.'; },
  market_breadth: async () => { const r = await breadth(); return r.ok ? `Широта рынка: ${r.pct}% выше SMA50 (${r.above}/${r.total}) — ${r.label}` : 'ОШИБКА: ' + r.error; }
};

module.exports = { scan, breadth, metrics, universe, POPULAR, toolSchemas, toolHandlers };
