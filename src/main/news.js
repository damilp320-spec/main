// Новости и сентимент по тикеру/теме. Источник — поиск Yahoo Finance (без
// ключа). ИИ-оценка настроения через локальную модель. Даёт агентам инструмент
// market_news для фундаментального контекста к теханализу.
const https = require('https');
const store = require('./store');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function get(url) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: e.message }); }
    const r = https.request({ host: u.host, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'application/json' } },
      (res) => { let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => { try { resolve({ ok: res.statusCode < 400, data: JSON.parse(buf), status: res.statusCode }); } catch { resolve({ ok: false, error: 'parse' }); } }); });
    r.on('error', (e) => resolve({ ok: false, error: e.message }));
    r.setTimeout(12000, () => r.destroy(new Error('timeout')));
    r.end();
  });
}

async function fetchNews(query) {
  const r = await get(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=12&quotesCount=0`);
  if (!r.ok) return { ok: false, error: r.error || ('HTTP ' + r.status) };
  const news = (r.data.news || []).map((n) => ({
    title: n.title, publisher: n.publisher, link: n.link,
    time: n.providerPublishTime ? n.providerPublishTime * 1000 : null
  }));
  return { ok: true, news };
}

// ИИ-оценка настроения по заголовкам.
async function sentiment(query) {
  const r = await fetchNews(query);
  if (!r.ok) return r;
  if (!r.news.length) return { ok: true, news: [], summary: 'Свежих новостей не найдено.', score: 0 };
  const ollama = require('./ollama');
  const model = store.get('settings.defaultModel', '') || 'qwen2.5:7b';
  const headlines = r.news.slice(0, 10).map((n, i) => `${i + 1}. ${n.title} (${n.publisher || ''})`).join('\n');
  const sys = 'Ты — финансовый аналитик новостей. По заголовкам оцени общий сентимент по инструменту. Ответь СТРОГО в формате:\nОЦЕНКА: <число от -100 (резко негативно) до +100 (резко позитивно)>\nКРАТКО: <2-3 предложения сводки>\nОтвечай по-русски.';
  try {
    const res = await ollama.chatStream({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: 'Тема: ' + query + '\n\nЗаголовки:\n' + headlines }], options: { temperature: 0.3 } }, null);
    const txt = res.content || '';
    const m = /ОЦЕНКА:\s*(-?\d+)/i.exec(txt);
    const score = m ? Math.max(-100, Math.min(100, parseInt(m[1], 10))) : 0;
    const sm = /КРАТКО:\s*([\s\S]+)/i.exec(txt);
    return { ok: true, news: r.news, score, summary: sm ? sm[1].trim() : txt.trim() };
  } catch (e) { return { ok: true, news: r.news, score: 0, summary: 'Не удалось оценить: ' + e.message }; }
}

const toolSchemas = [
  { type: 'function', function: { name: 'market_news', description: 'Получить свежие новости и оценку настроения (сентимент) по тикеру/компании/теме для фундаментального контекста.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Тикер или название (AAPL, Сбербанк, Bitcoin)' } }, required: ['query'] } } }
];
const toolHandlers = {
  market_news: async (a) => {
    const r = await sentiment(a.query);
    if (!r.ok) return 'ОШИБКА: ' + r.error;
    return `Сентимент по «${a.query}»: ${r.score > 20 ? 'позитивный' : r.score < -20 ? 'негативный' : 'нейтральный'} (${r.score}).\n${r.summary}\n\nЗаголовки:\n` + r.news.slice(0, 6).map((n) => '• ' + n.title).join('\n');
  }
};

module.exports = { fetchNews, sentiment, toolSchemas, toolHandlers };
