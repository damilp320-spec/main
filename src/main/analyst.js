// Глубокий анализ актива: техника + новости вокруг актива + макро-контекст
// (страна/сектор) → синтез локальной моделью в структурный вердикт.
const store = require('./store');
const markets = require('./markets');
const news = require('./news');

// Определяем «родину» актива и макро-контекст по тикеру.
function assetContext(symbol) {
  symbol = String(symbol || '').toUpperCase();
  if (symbol.endsWith('=X')) return { kind: 'forex', macro: 'валютный рынок и денежно-кредитная политика' };
  if (symbol.endsWith('=F')) return { kind: 'futures', macro: 'сырьевые рынки и спрос/предложение' };
  if (/-USD$/.test(symbol) || /^(BTC|ETH|SOL|XRP|ADA|DOGE|BNB)\b/.test(symbol)) return { kind: 'crypto', macro: 'рынок криптовалют, регулирование и ликвидность' };
  if (/^\^/.test(symbol)) return { kind: 'index', macro: 'широкий фондовый рынок' };
  const suf = { '.ME': 'Россия', '.DE': 'Германия', '.L': 'Великобритания', '.PA': 'Франция', '.HK': 'Гонконг и Китай', '.SS': 'Китай', '.SZ': 'Китай', '.T': 'Япония', '.TO': 'Канада', '.AX': 'Австралия', '.SA': 'Бразилия', '.NS': 'Индия', '.BO': 'Индия', '.SW': 'Швейцария', '.MI': 'Италия', '.AS': 'Нидерланды', '.ST': 'Швеция', '.KS': 'Южная Корея', '.MX': 'Мексика' };
  for (const [s, country] of Object.entries(suf)) if (symbol.endsWith(s)) return { kind: 'stock', country, macro: 'экономика страны ' + country };
  return { kind: 'stock', country: 'США', macro: 'экономика США (ФРС, инфляция, ставки)' };
}

async function deepAnalysis(symbol, profile) {
  const d = await markets.candles({ symbol, interval: '1d', range: '6mo' });
  if (!d.ok) return { ok: false, error: d.error };
  const tech = markets.summarize(d);
  const ctx = assetContext(symbol);
  const [assetNews, macroNews] = await Promise.all([
    news.sentiment(symbol).catch(() => ({ ok: false })),
    news.sentiment(ctx.country || ctx.macro).catch(() => ({ ok: false }))
  ]);
  const model = store.get('settings.defaultModel', '') || 'qwen2.5:7b';
  const horizon = { aggressive: 'краткосрочный (дни)', moderate: 'среднесрочный (недели)', longterm: 'долгосрочный (месяцы)' }[profile || 'moderate'];
  const sys = `Ты — портфельный аналитик. Дай КОМПЛЕКСНУЮ оценку с учётом: технического анализа графика, новостного фона вокруг САМОГО актива и МАКРО-контекста (страна/сектор/политика). Горизонт: ${horizon}. Ответь СТРОГО в формате:
ВЕРДИКТ: BUY|HOLD|SELL
УВЕРЕННОСТЬ: <0-100>
ОБОСНОВАНИЕ: 4-6 предложений — отдельно про технику, новости актива, макро/страну и ключевые риски.
В конце добавь, что это НЕ инвестиционная рекомендация. По-русски.`;
  const user = `Актив: ${symbol} (${ctx.kind}${ctx.country ? ', ' + ctx.country : ''})\n\n[Техника]\n${tech}\n\n[Новости вокруг актива] сентимент ${assetNews.ok ? assetNews.score : 'н/д'}:\n${assetNews.ok ? assetNews.summary : '—'}\n\n[Макро/страна: ${ctx.country || ctx.macro}] сентимент ${macroNews.ok ? macroNews.score : 'н/д'}:\n${macroNews.ok ? macroNews.summary : '—'}`;
  try {
    const ollama = require('./ollama');
    const res = await ollama.chatStream({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], options: { temperature: 0.4 } }, null);
    const txt = res.content || '';
    const verdict = ((/ВЕРДИКТ:\s*(BUY|HOLD|SELL)/i.exec(txt) || [])[1] || 'HOLD').toUpperCase();
    const conf = +((/(УВЕРЕННОСТЬ|CONFIDENCE)[:\s]*(\d+)/i.exec(txt) || [])[2]) || 50;
    return { ok: true, symbol, verdict, confidence: conf, text: txt.trim(), assetSentiment: assetNews.ok ? assetNews.score : null, macroSentiment: macroNews.ok ? macroNews.score : null, context: ctx };
  } catch (e) { return { ok: false, error: e.message }; }
}

const toolSchemas = [
  { type: 'function', function: { name: 'deep_analysis', description: 'Комплексный анализ актива: техника + новости вокруг актива + макро-контекст страны/сектора → вердикт BUY/HOLD/SELL с обоснованием.', parameters: { type: 'object', properties: { symbol: { type: 'string' }, horizon: { type: 'string', description: 'aggressive|moderate|longterm' } }, required: ['symbol'] } } }
];
const toolHandlers = {
  deep_analysis: async (a) => { const r = await deepAnalysis(a.symbol, a.horizon); return r.ok ? `${r.verdict} (уверенность ${r.confidence}%)\n${r.text}` : ('ОШИБКА: ' + r.error); }
};

module.exports = { deepAnalysis, assetContext, toolSchemas, toolHandlers };
