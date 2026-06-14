// RSS/Atom-читалка с ИИ-дайджестом. Парсинг XML — без зависимостей (регулярки).
// Ленты хранятся в store. ИИ-сводка — через локальную модель.
const https = require('https');
const http = require('http');
const store = require('./store');

const UA = 'Mozilla/5.0 (compatible; MytheraRSS/1.0)';

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: e.message }); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' } },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 4) {
          res.resume(); const next = res.headers.location.startsWith('http') ? res.headers.location : u.origin + res.headers.location;
          return resolve(fetchUrl(next, redirects + 1));
        }
        let buf = ''; res.on('data', (c) => { buf += c; if (buf.length > 4 * 1024 * 1024) req.destroy(); });
        res.on('end', () => resolve({ ok: res.statusCode < 400, xml: buf }));
      });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(12000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function tag(block, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (m) return clean(m[1]);
  // Atom link с href.
  if (name === 'link') { const l = /<link[^>]*href=["']([^"']+)["']/i.exec(block); if (l) return l[1]; }
  return '';
}
function clean(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function parseFeed(xml, sourceUrl) {
  const feedTitle = tag(xml, 'title') || sourceUrl;
  const items = [];
  const re = /<(item|entry)[\s\S]*?<\/\1>/gi; let m;
  while ((m = re.exec(xml)) && items.length < 30) {
    const b = m[0];
    const dateStr = tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date');
    items.push({ title: tag(b, 'title'), link: tag(b, 'link'), summary: (tag(b, 'description') || tag(b, 'summary') || '').slice(0, 300), date: dateStr ? Date.parse(dateStr) || null : null, source: feedTitle });
  }
  return { title: feedTitle, items };
}

function feeds() { return store.get('rssFeeds', []); }
function addFeed(url, title) {
  url = String(url || '').trim(); if (!url) return { ok: false };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const list = feeds(); if (list.some((f) => f.url === url)) return { ok: true };
  list.push({ url, title: title || url }); store.set('rssFeeds', list); return { ok: true };
}
function removeFeed(url) { store.set('rssFeeds', feeds().filter((f) => f.url !== url)); return { ok: true }; }

async function fetchFeed(url) {
  const r = await fetchUrl(url);
  if (!r.ok) return { ok: false, error: r.error || 'не загрузилось', url };
  return { ok: true, ...parseFeed(r.xml, url), url };
}

// Все ленты, объединённые и отсортированные по дате.
async function aggregate() {
  const list = feeds();
  const results = await Promise.all(list.map((f) => fetchFeed(f.url)));
  let items = [];
  for (const r of results) if (r.ok) items = items.concat(r.items);
  items.sort((a, b) => (b.date || 0) - (a.date || 0));
  return { ok: true, items: items.slice(0, 60), feeds: results.map((r) => ({ url: r.url, ok: r.ok, title: r.title, error: r.error })) };
}

async function digest() {
  const agg = await aggregate();
  if (!agg.items.length) return { ok: false, error: 'Нет новостей в лентах.' };
  const ollama = require('./ollama');
  const model = store.get('settings.defaultModel', '') || 'qwen2.5:7b';
  const heads = agg.items.slice(0, 25).map((i, n) => `${n + 1}. ${i.title} — ${i.source}`).join('\n');
  const sys = 'Ты — редактор новостного дайджеста. По списку заголовков составь КРАТКУЮ сводку самого важного: 5-7 пунктов, сгруппируй по темам. По-русски, без воды.';
  try {
    const res = await ollama.chatStream({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: heads }], options: { temperature: 0.4 } }, null);
    return { ok: true, digest: (res.content || '').trim(), count: agg.items.length };
  } catch (e) { return { ok: false, error: e.message }; }
}

const toolSchemas = [
  { type: 'function', function: { name: 'rss_digest', description: 'Сделать ИИ-дайджест из подписанных RSS-лент пользователя (главные новости кратко).', parameters: { type: 'object', properties: {} } } }
];
const toolHandlers = {
  rss_digest: async () => { const r = await digest(); return r.ok ? r.digest : ('ОШИБКА: ' + r.error); }
};

module.exports = { feeds, addFeed, removeFeed, fetchFeed, aggregate, digest, toolSchemas, toolHandlers };
