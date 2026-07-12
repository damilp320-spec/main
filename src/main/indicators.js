// Библиотека теханализа: ВСЕ классические индикаторы (тренд/импульс/объём/
// волатильность), свечные паттерны, уровни поддержки-сопротивления, Фибоначчи,
// дивергенции RSI и конфлюэнс-скоринг — взвешенное «голосование» всех приёмов
// сразу. Используется ботом (фильтры входа), бэктестером (новые стратегии) и
// UI (мульти-факторный разбор тикера). Без внешних зависимостей.

// ---- Базовые серии (выровнены по индексам свечей, null = мало данных) ----
function sma(arr, n) { const out = []; let s = 0; for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= n) s -= arr[i - n]; out.push(i >= n - 1 ? s / n : null); } return out; }
function ema(arr, n) { const k = 2 / (n + 1); const out = []; let prev = null; for (let i = 0; i < arr.length; i++) { prev = prev == null ? arr[i] : arr[i] * k + prev * (1 - k); out.push(i >= n - 1 ? prev : null); } return out; }
function rsiSeries(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    if (i <= n) { gain += g; loss += l; if (i === n) { const rs = loss === 0 ? 100 : gain / loss; out[i] = 100 - 100 / (1 + rs); gain /= n; loss /= n; } }
    else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; const rs = loss === 0 ? 100 : gain / loss; out[i] = 100 - 100 / (1 + rs); }
  }
  return out;
}
function trueRange(c, i) { if (i === 0) return c[0].h - c[0].l; return Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)); }
function atrSeries(c, n = 14) {
  const out = new Array(c.length).fill(null); let prev = null;
  for (let i = 0; i < c.length; i++) {
    const tr = trueRange(c, i);
    if (i < n) { prev = prev == null ? tr : prev + tr; if (i === n - 1) { prev /= n; out[i] = prev; } }
    else { prev = (prev * (n - 1) + tr) / n; out[i] = prev; } // сглаживание Уайлдера
  }
  return out;
}

// ---- Импульсные осцилляторы ----
function stochastic(c, kN = 14, dN = 3) {
  const K = new Array(c.length).fill(null);
  for (let i = kN - 1; i < c.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kN + 1; j <= i; j++) { if (c[j].h > hh) hh = c[j].h; if (c[j].l < ll) ll = c[j].l; }
    K[i] = hh === ll ? 50 : (c[i].c - ll) / (hh - ll) * 100;
  }
  const D = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) { if (i < kN - 1 + dN - 1) continue; let s = 0, cnt = 0; for (let j = i - dN + 1; j <= i; j++) { if (K[j] != null) { s += K[j]; cnt++; } } D[i] = cnt ? s / cnt : null; }
  return { K, D };
}
function cci(c, n = 20) {
  const tp = c.map((x) => (x.h + x.l + x.c) / 3);
  const m = sma(tp, n);
  const out = new Array(c.length).fill(null);
  for (let i = n - 1; i < c.length; i++) { let dev = 0; for (let j = i - n + 1; j <= i; j++) dev += Math.abs(tp[j] - m[i]); dev /= n; out[i] = dev ? (tp[i] - m[i]) / (0.015 * dev) : 0; }
  return out;
}
function williamsR(c, n = 14) {
  const out = new Array(c.length).fill(null);
  for (let i = n - 1; i < c.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { if (c[j].h > hh) hh = c[j].h; if (c[j].l < ll) ll = c[j].l; }
    out[i] = hh === ll ? -50 : (hh - c[i].c) / (hh - ll) * -100;
  }
  return out;
}

// ---- Тренд и его сила ----
// ADX/DMI по Уайлдеру: сила тренда (adx) + направление (+DI против -DI).
function adx(c, n = 14) {
  const len = c.length;
  const plus = new Array(len).fill(null), minus = new Array(len).fill(null), out = new Array(len).fill(null);
  if (len < n + 1) return { adx: out, plus, minus };
  let sTR = 0, sP = 0, sM = 0, adxPrev = null; const dxs = [];
  for (let i = 1; i < len; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
    const pDM = up > dn && up > 0 ? up : 0, mDM = dn > up && dn > 0 ? dn : 0;
    const tr = trueRange(c, i);
    if (i <= n) { sTR += tr; sP += pDM; sM += mDM; if (i < n) continue; }
    else { sTR = sTR - sTR / n + tr; sP = sP - sP / n + pDM; sM = sM - sM / n + mDM; }
    const pDI = sTR ? sP / sTR * 100 : 0, mDI = sTR ? sM / sTR * 100 : 0;
    plus[i] = pDI; minus[i] = mDI;
    const dx = (pDI + mDI) ? Math.abs(pDI - mDI) / (pDI + mDI) * 100 : 0;
    if (adxPrev == null) { dxs.push(dx); if (dxs.length === n) { adxPrev = dxs.reduce((a, b) => a + b, 0) / n; out[i] = adxPrev; } }
    else { adxPrev = (adxPrev * (n - 1) + dx) / n; out[i] = adxPrev; }
  }
  return { adx: out, plus, minus };
}
// SuperTrend: линия-перевёртыш на основе ATR. trend: 1 (бычий) / -1 (медвежий).
function supertrend(c, period = 10, mult = 3) {
  const a = atrSeries(c, period);
  const len = c.length;
  const trend = new Array(len).fill(null), line = new Array(len).fill(null);
  let fu = null, fl = null, tr = 1;
  for (let i = 0; i < len; i++) {
    if (a[i] == null) continue;
    const mid = (c[i].h + c[i].l) / 2;
    const bu = mid + mult * a[i], bl = mid - mult * a[i];
    fu = (fu == null || bu < fu || c[i - 1].c > fu) ? bu : fu;
    fl = (fl == null || bl > fl || c[i - 1].c < fl) ? bl : fl;
    if (c[i].c > fu) tr = 1; else if (c[i].c < fl) tr = -1;
    trend[i] = tr; line[i] = tr === 1 ? fl : fu;
  }
  return { trend, line };
}
// Ишимоку: тенкан/киджун + границы облака (спаны сдвинуты на shift вперёд,
// поэтому облако для бара i — это спаны, посчитанные на баре i-shift).
function ichimoku(c, tenkanN = 9, kijunN = 26, spanBN = 52, shift = 26) {
  const mid = (n) => { const out = new Array(c.length).fill(null); for (let i = n - 1; i < c.length; i++) { let hh = -Infinity, ll = Infinity; for (let j = i - n + 1; j <= i; j++) { if (c[j].h > hh) hh = c[j].h; if (c[j].l < ll) ll = c[j].l; } out[i] = (hh + ll) / 2; } return out; };
  const tenkan = mid(tenkanN), kijun = mid(kijunN), spanBraw = mid(spanBN);
  const spanA = c.map((_, i) => (tenkan[i] != null && kijun[i] != null) ? (tenkan[i] + kijun[i]) / 2 : null);
  const cloudTop = c.map((_, i) => { const j = i - shift; if (j < 0 || spanA[j] == null || spanBraw[j] == null) return null; return Math.max(spanA[j], spanBraw[j]); });
  const cloudBot = c.map((_, i) => { const j = i - shift; if (j < 0 || spanA[j] == null || spanBraw[j] == null) return null; return Math.min(spanA[j], spanBraw[j]); });
  return { tenkan, kijun, spanA, spanB: spanBraw, cloudTop, cloudBot };
}

// ---- Объём ----
function obv(c) { const out = [0]; for (let i = 1; i < c.length; i++) out.push(out[i - 1] + (c[i].c > c[i - 1].c ? (c[i].v || 0) : c[i].c < c[i - 1].c ? -(c[i].v || 0) : 0)); return out; }
function vwapSeries(c) { const out = []; let pv = 0, vv = 0; for (const x of c) { const tp = (x.h + x.l + x.c) / 3; pv += tp * (x.v || 0); vv += x.v || 0; out.push(vv ? pv / vv : tp); } return out; }
function mfi(c, n = 14) {
  const out = new Array(c.length).fill(null);
  const tp = c.map((x) => (x.h + x.l + x.c) / 3);
  for (let i = n; i < c.length; i++) {
    let pos = 0, neg = 0;
    for (let j = i - n + 1; j <= i; j++) { const f = tp[j] * (c[j].v || 0); if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f; }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

// ---- Волатильность ----
function bollinger(closes, n = 20, mult = 2) {
  const m = sma(closes, n);
  const up = new Array(closes.length).fill(null), lo = new Array(closes.length).fill(null), pctB = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let v = 0; for (let j = i - n + 1; j <= i; j++) v += (closes[j] - m[i]) ** 2;
    const sd = Math.sqrt(v / n);
    up[i] = m[i] + mult * sd; lo[i] = m[i] - mult * sd;
    pctB[i] = up[i] === lo[i] ? 0.5 : (closes[i] - lo[i]) / (up[i] - lo[i]);
  }
  return { mid: m, up, lo, pctB };
}
function macdSeries(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  const macd = closes.map((_, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null);
  const valid = macd.map((x) => x == null ? 0 : x);
  const sig = ema(valid, signal).map((x, i) => macd[i] == null ? null : x);
  const hist = macd.map((x, i) => (x != null && sig[i] != null) ? x - sig[i] : null);
  return { macd, signal: sig, hist };
}

// ---- Свечные паттерны на баре i (dir: +1 бычий, -1 медвежий, 0 — неопределённость) ----
function patternsAt(c, i, smaTrend) {
  if (i < 2) return [];
  const b = c[i], p = c[i - 1], pp = c[i - 2];
  const body = (x) => Math.abs(x.c - x.o), range = (x) => (x.h - x.l) || 1e-9;
  const upSh = (x) => x.h - Math.max(x.c, x.o), loSh = (x) => Math.min(x.c, x.o) - x.l;
  const bull = (x) => x.c > x.o, bear = (x) => x.o > x.c;
  const trendUp = smaTrend != null ? b.c > smaTrend : b.c > pp.c;
  const out = [];
  if (body(b) <= 0.1 * range(b)) out.push({ id: 'doji', name: 'Дожи (нерешительность)', dir: 0, strength: 1 });
  if (!trendUp && loSh(b) >= 2 * body(b) && upSh(b) <= body(b)) out.push({ id: 'hammer', name: 'Молот', dir: 1, strength: 1 });
  if (trendUp && upSh(b) >= 2 * body(b) && loSh(b) <= body(b)) out.push({ id: 'shooting_star', name: 'Падающая звезда', dir: -1, strength: 1 });
  if (bear(p) && bull(b) && b.c >= p.o && b.o <= p.c && body(b) > body(p) * 0.9) out.push({ id: 'engulf_bull', name: 'Бычье поглощение', dir: 1, strength: 2 });
  if (bull(p) && bear(b) && b.o >= p.c && b.c <= p.o && body(b) > body(p) * 0.9) out.push({ id: 'engulf_bear', name: 'Медвежье поглощение', dir: -1, strength: 2 });
  if (bear(pp) && body(p) < 0.3 * range(p) && bull(b) && b.c > (pp.o + pp.c) / 2) out.push({ id: 'morning_star', name: 'Утренняя звезда', dir: 1, strength: 2 });
  if (bull(pp) && body(p) < 0.3 * range(p) && bear(b) && b.c < (pp.o + pp.c) / 2) out.push({ id: 'evening_star', name: 'Вечерняя звезда', dir: -1, strength: 2 });
  if (bull(pp) && bull(p) && bull(b) && p.c > pp.c && b.c > p.c && body(pp) > 0.5 * range(pp) && body(p) > 0.5 * range(p) && body(b) > 0.5 * range(b)) out.push({ id: 'three_soldiers', name: 'Три белых солдата', dir: 1, strength: 2 });
  if (bear(pp) && bear(p) && bear(b) && p.c < pp.c && b.c < p.c && body(pp) > 0.5 * range(pp) && body(p) > 0.5 * range(p) && body(b) > 0.5 * range(b)) out.push({ id: 'three_crows', name: 'Три чёрных вороны', dir: -1, strength: 2 });
  if (bear(p) && bull(b) && b.o < p.c && b.c > (p.o + p.c) / 2 && b.c < p.o) out.push({ id: 'piercing', name: 'Просвет в облаках', dir: 1, strength: 1 });
  if (bull(p) && bear(b) && b.o > p.c && b.c < (p.o + p.c) / 2 && b.c > p.o) out.push({ id: 'dark_cloud', name: 'Завеса из тёмных облаков', dir: -1, strength: 1 });
  return out;
}
// Паттерны на последнем баре (с контекстом тренда по SMA20).
function lastPatterns(c) {
  if (c.length < 3) return [];
  const s20 = sma(c.map((x) => x.c), 20);
  return patternsAt(c, c.length - 1, s20[c.length - 1]);
}

// ---- Уровни поддержки/сопротивления: фрактальные пивоты + кластеризация ----
function srLevels(c, lookback = 150) {
  const n = c.length; if (n < 10) return { levels: [], support: null, resistance: null };
  const from = Math.max(2, n - lookback);
  const piv = [];
  for (let i = from; i < n - 2; i++) {
    if (c[i].h > c[i - 1].h && c[i].h > c[i - 2].h && c[i].h > c[i + 1].h && c[i].h > c[i + 2].h) piv.push(c[i].h);
    if (c[i].l < c[i - 1].l && c[i].l < c[i - 2].l && c[i].l < c[i + 1].l && c[i].l < c[i + 2].l) piv.push(c[i].l);
  }
  const price = c[n - 1].c;
  const a = atrSeries(c, 14)[n - 1] || price * 0.01;
  piv.sort((x, y) => x - y);
  const levels = [];
  for (const p of piv) { // кластеры пивотов в пределах 0.5·ATR = один уровень
    const last = levels[levels.length - 1];
    if (last && Math.abs(p - last.sum / last.touches) <= 0.5 * a) { last.sum += p; last.touches++; }
    else levels.push({ sum: p, touches: 1 });
  }
  const flat = levels.map((l) => ({ price: +(l.sum / l.touches).toFixed(4), touches: l.touches })).filter((l) => l.touches >= 1);
  flat.sort((x, y) => y.touches - x.touches);
  const strong = flat.slice(0, 8).sort((x, y) => x.price - y.price);
  let support = null, resistance = null;
  for (const l of strong) { if (l.price < price && (!support || l.price > support.price)) support = l; if (l.price > price && (!resistance || l.price < resistance.price)) resistance = l; }
  return { levels: strong, support, resistance, atr: a };
}

// ---- Фибоначчи по последнему свингу ----
function fibLevels(c, lookback = 120) {
  const n = c.length; if (n < 10) return null;
  const win = c.slice(Math.max(0, n - lookback));
  let hi = -Infinity, lo = Infinity, hiIdx = 0, loIdx = 0;
  win.forEach((x, i) => { if (x.h > hi) { hi = x.h; hiIdx = i; } if (x.l < lo) { lo = x.l; loIdx = i; } });
  const dirUp = hiIdx > loIdx; // последний импульс: вверх (коррекции вниз от максимума)
  const span = hi - lo || 1e-9;
  const ks = [0.236, 0.382, 0.5, 0.618, 0.786];
  const levels = ks.map((k) => ({ k, price: +(dirUp ? hi - span * k : lo + span * k).toFixed(4) }));
  return { swingHigh: +hi.toFixed(4), swingLow: +lo.toFixed(4), dir: dirUp ? 'up' : 'down', levels };
}

// ---- Дивергенция RSI против цены (классическая, по двум последним пивотам) ----
function rsiDivergence(c, win = 60) {
  const n = c.length; if (n < 20) return null;
  const closes = c.map((x) => x.c);
  const r = rsiSeries(closes, 14);
  const from = Math.max(2, n - win);
  const lows = [], highs = [];
  for (let i = from; i < n - 2; i++) {
    if (closes[i] < closes[i - 1] && closes[i] < closes[i - 2] && closes[i] < closes[i + 1] && closes[i] < closes[i + 2] && r[i] != null) lows.push({ i, p: closes[i], r: r[i] });
    if (closes[i] > closes[i - 1] && closes[i] > closes[i - 2] && closes[i] > closes[i + 1] && closes[i] > closes[i + 2] && r[i] != null) highs.push({ i, p: closes[i], r: r[i] });
  }
  let bullish = false, bearish = false;
  if (lows.length >= 2) { const a = lows[lows.length - 2], b = lows[lows.length - 1]; bullish = b.p < a.p && b.r > a.r + 1; } // цена ниже, RSI выше
  if (highs.length >= 2) { const a = highs[highs.length - 2], b = highs[highs.length - 1]; bearish = b.p > a.p && b.r < a.r - 1; }
  return { bullish, bearish };
}

// ---- Конфлюэнс: взвешенное голосование индикаторов, -100…+100 на каждый бар ----
function confluenceSeries(c) {
  const closes = c.map((x) => x.c);
  const s50 = sma(closes, 50), s200 = sma(closes, 200);
  const r = rsiSeries(closes, 14);
  const m = macdSeries(closes);
  const st = stochastic(c, 14, 3);
  const sup = supertrend(c, 10, 3);
  const ad = adx(c, 14);
  const ob = obv(c); const obSma = sma(ob, 20);
  const bb = bollinger(closes, 20, 2);
  const ich = ichimoku(c);
  const out = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) {
    let sc = 0, w = 0;
    const add = (v, weight) => { if (v != null) { sc += v * weight; w += weight; } };
    if (s50[i] != null) add(closes[i] > s50[i] ? 1 : -1, 1);
    if (s200[i] != null) add(closes[i] > s200[i] ? 1 : -1, 1);
    if (s50[i] != null && s200[i] != null) add(s50[i] > s200[i] ? 1 : -1, 1);
    if (r[i] != null) add(Math.max(-1, Math.min(1, (r[i] - 50) / 25)), 1.5);
    if (m.hist[i] != null) add(m.hist[i] > 0 ? 1 : -1, 1.5);
    if (st.K[i] != null && st.D[i] != null) add(st.K[i] > st.D[i] ? 1 : -1, 1);
    if (sup.trend[i] != null) add(sup.trend[i], 2);
    if (ad.adx[i] != null && ad.plus[i] != null) add((ad.plus[i] > ad.minus[i] ? 1 : -1) * Math.min(1, ad.adx[i] / 40), 1.5);
    if (obSma[i] != null) add(ob[i] > obSma[i] ? 1 : -1, 1);
    if (bb.mid[i] != null) add(closes[i] > bb.mid[i] ? 1 : -1, 1);
    if (ich.cloudTop[i] != null) add(closes[i] > ich.cloudTop[i] ? 1 : closes[i] < ich.cloudBot[i] ? -1 : 0, 1.5);
    out[i] = w ? +(sc / w * 100).toFixed(1) : null;
  }
  return out;
}

// ---- Полный мульти-факторный разбор последнего бара (для бота и UI) ----
function analyze(c) {
  if (!c || c.length < 30) return { ok: false, error: 'Мало данных для анализа (нужно 30+ свечей).' };
  const n = c.length, i = n - 1;
  const closes = c.map((x) => x.c);
  const price = closes[i];
  const s50 = sma(closes, 50)[i], s200 = sma(closes, 200)[i];
  const r = rsiSeries(closes, 14)[i];
  const m = macdSeries(closes);
  const st = stochastic(c, 14, 3);
  const sup = supertrend(c, 10, 3);
  const ad = adx(c, 14);
  const ob = obv(c); const obTrendUp = ob[i] > (sma(ob, 20)[i] ?? ob[i]);
  const bb = bollinger(closes, 20, 2);
  const ich = ichimoku(c);
  const wr = williamsR(c, 14)[i];
  const cc = cci(c, 20)[i];
  const mf = mfi(c, 14)[i];
  const vw = vwapSeries(c)[i];
  const volAvg = sma(c.map((x) => x.v || 0), 20)[i];
  const volRatio = volAvg ? +((c[i].v || 0) / volAvg).toFixed(2) : null;
  const pats = lastPatterns(c);
  const sr = srLevels(c);
  const fib = fibLevels(c);
  const div = rsiDivergence(c);
  const a = atrSeries(c, 14)[i];

  const comp = []; let sc = 0, w = 0;
  const add = (label, v, weight, note) => { comp.push({ label, score: +(v * weight).toFixed(2), max: weight, note: note || '' }); sc += v * weight; w += weight; };
  if (s50 != null) add('Цена vs SMA50', price > s50 ? 1 : -1, 1, price > s50 ? 'выше' : 'ниже');
  if (s200 != null) add('Цена vs SMA200', price > s200 ? 1 : -1, 1, price > s200 ? 'выше' : 'ниже');
  if (s50 != null && s200 != null) add('SMA50 vs SMA200', s50 > s200 ? 1 : -1, 1, s50 > s200 ? 'золотой крест' : 'мёртвый крест');
  if (r != null) add('RSI(14)', Math.max(-1, Math.min(1, (r - 50) / 25)), 1.5, r.toFixed(1) + (r > 70 ? ' (перекупленность)' : r < 30 ? ' (перепроданность)' : ''));
  if (m.hist[i] != null) add('MACD-гистограмма', m.hist[i] > 0 ? 1 : -1, 1.5, m.hist[i] > 0 ? 'бычья' : 'медвежья');
  if (st.K[i] != null && st.D[i] != null) add('Стохастик %K/%D', st.K[i] > st.D[i] ? 1 : -1, 1, `K ${st.K[i].toFixed(0)} / D ${st.D[i].toFixed(0)}`);
  if (sup.trend[i] != null) add('SuperTrend', sup.trend[i], 2, sup.trend[i] === 1 ? 'бычий' : 'медвежий');
  if (ad.adx[i] != null && ad.plus[i] != null) add('ADX/DMI', (ad.plus[i] > ad.minus[i] ? 1 : -1) * Math.min(1, ad.adx[i] / 40), 1.5, `ADX ${ad.adx[i].toFixed(0)} (${ad.adx[i] >= 25 ? 'тренд' : 'флэт'})`);
  add('OBV (объём)', obTrendUp ? 1 : -1, 1, obTrendUp ? 'накопление' : 'распределение');
  if (bb.pctB[i] != null) add('Боллинджер %B', Math.max(-1, Math.min(1, (bb.pctB[i] - 0.5) * 2)), 1, '%B ' + bb.pctB[i].toFixed(2));
  if (ich.cloudTop[i] != null) add('Ишимоку (облако)', price > ich.cloudTop[i] ? 1 : price < ich.cloudBot[i] ? -1 : 0, 1.5, price > ich.cloudTop[i] ? 'выше облака' : price < ich.cloudBot[i] ? 'ниже облака' : 'в облаке');
  if (wr != null) add('Williams %R', Math.max(-1, Math.min(1, (wr + 50) / 25)), 0.5, wr.toFixed(0));
  if (cc != null) add('CCI(20)', Math.max(-1, Math.min(1, cc / 150)), 0.5, cc.toFixed(0));
  if (mf != null) add('MFI (денежный поток)', Math.max(-1, Math.min(1, (mf - 50) / 25)), 0.5, mf.toFixed(0));
  if (vw != null) add('Цена vs VWAP', price > vw ? 1 : -1, 0.5, price > vw ? 'выше' : 'ниже');
  const patScore = pats.reduce((s, p) => s + p.dir * p.strength, 0);
  if (pats.length) add('Свечные паттерны', Math.max(-1, Math.min(1, patScore / 2)), 1.5, pats.map((p) => p.name).join(', '));
  if (div && (div.bullish || div.bearish)) add('Дивергенция RSI', div.bullish ? 1 : -1, 1.5, div.bullish ? 'бычья' : 'медвежья');
  if (sr.support && sr.resistance && a) {
    const room = (sr.resistance.price - price) / a; // запас хода до сопротивления в ATR
    add('Запас до сопротивления', Math.max(-1, Math.min(1, (room - 1) / 2)), 1, room.toFixed(1) + '×ATR');
  }
  const score = w ? +(sc / w * 100).toFixed(1) : 0;
  const verdict = score >= 50 ? 'strong_buy' : score >= 20 ? 'buy' : score <= -50 ? 'strong_sell' : score <= -20 ? 'sell' : 'neutral';
  return {
    ok: true, price: +price.toFixed(4), score, verdict, components: comp,
    patterns: pats, sr: { support: sr.support, resistance: sr.resistance }, fib, divergence: div,
    indicators: {
      rsi: r != null ? +r.toFixed(1) : null, adx: ad.adx[i] != null ? +ad.adx[i].toFixed(1) : null,
      macdHist: m.hist[i] != null ? +m.hist[i].toFixed(4) : null, stochK: st.K[i] != null ? +st.K[i].toFixed(1) : null,
      supertrend: sup.trend[i], atr: a != null ? +a.toFixed(4) : null, volRatio,
      sma50: s50 != null ? +s50.toFixed(4) : null, sma200: s200 != null ? +s200.toFixed(4) : null, vwap: vw != null ? +vw.toFixed(4) : null
    }
  };
}

module.exports = {
  sma, ema, rsiSeries, atrSeries, stochastic, cci, williamsR, adx, supertrend, ichimoku,
  obv, vwapSeries, mfi, bollinger, macdSeries, patternsAt, lastPatterns, srLevels, fibLevels,
  rsiDivergence, confluenceSeries, analyze
};
