// Рыночные данные: котировки и свечи акций, фьючерсов, криптовалют, форекса и
// индексов. Источник — публичный Yahoo Finance chart API (без ключа), с
// запасным вариантом Stooq для дневных данных. Без внешних зависимостей.
// Также даёт агентам инструмент market_data для анализа.
const https = require('https');
const store = require('./store');

let uiSender = null;
function setUISender(fn) { uiSender = fn; }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function httpsGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(e); }
    const req = https.request({ host: u.host, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': UA, 'Accept': '*/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 4) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location : (u.origin + res.headers.location);
        return resolve(httpsGet(next, redirects + 1));
      }
      let buf = '';
      res.on('data', (c) => { buf += c; if (buf.length > 6 * 1024 * 1024) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Свечи через Yahoo Finance v8.
async function candles({ symbol, interval, range }) {
  symbol = String(symbol || '').trim();
  if (!symbol) return { ok: false, error: 'Не указан тикер' };
  interval = interval || '1d';
  range = range || '6mo';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
  try {
    const r = await httpsGet(url);
    if (r.status !== 200) return await stooqFallback(symbol, interval);
    const j = JSON.parse(r.body);
    const res = j.chart && j.chart.result && j.chart.result[0];
    if (!res || !res.timestamp) {
      const err = j.chart && j.chart.error && j.chart.error.description;
      return await stooqFallback(symbol, interval, err);
    }
    const q = res.indicators.quote[0];
    const out = [];
    for (let i = 0; i < res.timestamp.length; i++) {
      if (q.close[i] == null) continue;
      out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume ? q.volume[i] : 0 });
    }
    const m = res.meta || {};
    return { ok: true, symbol: m.symbol || symbol, currency: m.currency || '', price: m.regularMarketPrice, candles: out, source: 'Yahoo Finance' };
  } catch (e) {
    return await stooqFallback(symbol, interval, e.message);
  }
}

// Запасной источник дневных данных — Stooq CSV (для акций/индексов/форекса).
async function stooqFallback(symbol, interval, prevErr) {
  try {
    const s = symbol.toLowerCase().replace('^', '').replace('=f', '').replace('=x', '');
    const sym = s.includes('.') ? s : (s + '.us'); // эвристика для акций США
    const r = await httpsGet(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`);
    if (r.status !== 200 || !/^Date,/.test(r.body)) return { ok: false, error: prevErr || 'Нет данных по тикеру ' + symbol };
    const rows = r.body.trim().split('\n').slice(1).slice(-260);
    const out = rows.map((line) => {
      const [d, o, h, l, c, v] = line.split(',');
      return { t: new Date(d).getTime(), o: +o, h: +h, l: +l, c: +c, v: +v || 0 };
    }).filter((x) => !isNaN(x.c));
    if (!out.length) return { ok: false, error: prevErr || 'Нет данных' };
    return { ok: true, symbol, currency: '', price: out[out.length - 1].c, candles: out, source: 'Stooq' };
  } catch (e) { return { ok: false, error: prevErr || e.message }; }
}

// Поиск тикера по названию.
async function search(query) {
  try {
    const r = await httpsGet(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`);
    if (r.status !== 200) return { ok: false, error: 'Поиск недоступен' };
    const j = JSON.parse(r.body);
    return { ok: true, results: (j.quotes || []).filter((q) => q.symbol).map((q) => ({ symbol: q.symbol, name: q.shortname || q.longname || '', type: q.quoteType, exchange: q.exchange })) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---- Индикаторы ----
function sma(arr, n) { const out = []; for (let i = 0; i < arr.length; i++) { if (i < n - 1) { out.push(null); continue; } let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j]; out.push(s / n); } return out; }
function ema(arr, n) { const out = []; const k = 2 / (n + 1); let prev = null; for (let i = 0; i < arr.length; i++) { if (arr[i] == null) { out.push(null); continue; } prev = prev == null ? arr[i] : arr[i] * k + prev * (1 - k); out.push(prev); } return out; }
function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = closes.length - n; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  const rs = loss === 0 ? 100 : gain / loss;
  return +(100 - 100 / (1 + rs)).toFixed(1);
}

// Текстовая сводка для ИИ-анализа / инструмента агента.
function summarize(data) {
  const c = data.candles;
  const closes = c.map((x) => x.c);
  const last = closes[closes.length - 1];
  const first = closes[0];
  const chg = ((last - first) / first) * 100;
  const hi = Math.max(...c.map((x) => x.h));
  const lo = Math.min(...c.map((x) => x.l));
  const sma20 = sma(closes, 20).pop();
  const sma50 = sma(closes, 50).pop();
  const r = rsi(closes);
  const recent = closes.slice(-10).map((x) => x.toFixed(2)).join(', ');
  return `Тикер: ${data.symbol} (${data.source})\nЦена: ${last != null ? last.toFixed(2) : '?'} ${data.currency || ''}\nИзменение за период: ${chg.toFixed(2)}%\nМакс/мин периода: ${hi.toFixed(2)} / ${lo.toFixed(2)}\nSMA20: ${sma20 ? sma20.toFixed(2) : 'н/д'}, SMA50: ${sma50 ? sma50.toFixed(2) : 'н/д'}\nRSI(14): ${r != null ? r : 'н/д'}\nПоследние закрытия: ${recent}`;
}

// Тренд по таймфрейму (для мульти-таймфрейм подтверждения и виджета).
async function trend({ symbol, interval, range }) {
  const def = interval === '1wk' ? '2y' : interval === '1h' ? '1mo' : '6mo';
  const d = await candles({ symbol, interval: interval || '1d', range: range || def });
  if (!d.ok || d.candles.length < 25) return { ok: false, trend: 'unknown' };
  const closes = d.candles.map((c) => c.c);
  const s = sma(closes, 20);
  const last = s[s.length - 1], prev = s[s.length - 11] != null ? s[s.length - 11] : s[s.length - 6];
  if (last == null) return { ok: false, trend: 'unknown' };
  const price = closes[closes.length - 1];
  const up = price > last && (prev == null || last >= prev);
  const down = price < last && (prev == null || last <= prev);
  return { ok: true, trend: up ? 'up' : down ? 'down' : 'flat', price, sma20: +last.toFixed(2) };
}

// Инструмент агента: получить рыночные данные.
async function marketDataTool({ symbol, interval, range }) {
  const d = await candles({ symbol, interval, range });
  if (!d.ok) return 'ОШИБКА: ' + d.error;
  return summarize(d);
}

// ИИ-анализ графика (через локальную модель).
async function analyze({ symbol, interval, range }) {
  const d = await candles({ symbol, interval, range });
  if (!d.ok) return { ok: false, error: d.error };
  const ollama = require('./ollama');
  const model = store.get('settings.defaultModel', '') || 'qwen2.5:7b';
  const sys = 'Ты — финансовый аналитик. По числовым данным дай КРАТКИЙ разбор (5-7 предложений): тренд, ключевые уровни, импульс (RSI), сигналы SMA, риски. В конце добавь дисклеймер, что это не инвестиционная рекомендация. Отвечай по-русски.';
  try {
    const res = await ollama.chatStream({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: summarize(d) }], options: { temperature: 0.5 } }, null);
    return { ok: true, text: (res.content || '').trim(), summary: summarize(d) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---- Список отслеживания ----
function getWatchlist() { return store.get('marketWatchlist', []); }
function setWatchlist(list) { store.set('marketWatchlist', Array.isArray(list) ? list.slice(0, 50) : []); return { ok: true }; }

const toolSchemas = [
  { type: 'function', function: { name: 'market_data', description: 'Получить рыночные данные и индикаторы по тикеру (акции, фьючерсы, крипта, форекс, индексы). Примеры тикеров: AAPL, TSLA, BTC-USD, ES=F (фьючерс S&P), CL=F (нефть), EURUSD=X, ^GSPC (индекс S&P 500).', parameters: { type: 'object', properties: { symbol: { type: 'string' }, interval: { type: 'string', description: '1d, 1h, 5m, 1wk и т.п.' }, range: { type: 'string', description: '1d, 5d, 1mo, 6mo, 1y, 5y, max' } }, required: ['symbol'] } } }
];
const toolHandlers = { market_data: (a) => marketDataTool(a) };

module.exports = { setUISender, candles, search, analyze, summarize, trend, getWatchlist, setWatchlist, toolSchemas, toolHandlers };
