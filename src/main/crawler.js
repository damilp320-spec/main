// «Обучение с сайта»: агент обходит страницы сайта, извлекает текст и
// индексирует его в RAG-память для последующих ответов. Без зависимостей —
// HTTP(S) + простая очистка HTML. Уважает один домен и лимит страниц.
const http = require('http');
const https = require('https');
const store = require('./store');

const UA = 'Mozilla/5.0 (compatible; MytheraBot/1.0)';

function fetchPage(url) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: e.message }); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'text/html' } },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const next = res.headers.location.startsWith('http') ? res.headers.location : u.origin + res.headers.location;
          return resolve(fetchPage(next));
        }
        const ct = res.headers['content-type'] || '';
        if (!ct.includes('html') && !ct.includes('text')) { res.resume(); return resolve({ ok: false, error: 'не HTML' }); }
        let buf = ''; res.on('data', (c) => { buf += c; if (buf.length > 3 * 1024 * 1024) req.destroy(); });
        res.on('end', () => resolve({ ok: true, html: buf, url: u.href, origin: u.origin }));
      });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function title(html) { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html); return m ? htmlToText(m[1]).slice(0, 100) : ''; }
function links(html, origin, base) {
  const out = new Set();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi; let m;
  while ((m = re.exec(html))) {
    let href = m[1].trim();
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try { const abs = new URL(href, base).href; if (abs.startsWith(origin) && /^https?:/.test(abs)) out.add(abs.split('#')[0]); } catch {}
  }
  return [...out];
}

// Обход сайта (BFS) и индексация. onProgress(payload) — события в UI.
async function learn({ url, maxPages, scope }, onProgress) {
  const rag = require('./rag');
  scope = scope || 'kb';
  maxPages = Math.min(30, Math.max(1, parseInt(maxPages, 10) || 8));
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const first = await fetchPage(url);
  if (!first.ok) return { ok: false, error: first.error };
  const origin = first.origin;
  const queue = [first.url]; const seen = new Set([first.url]);
  let indexed = 0, totalChunks = 0;
  while (queue.length && indexed < maxPages) {
    const pageUrl = queue.shift();
    const page = (pageUrl === first.url) ? first : await fetchPage(pageUrl);
    if (!page.ok) continue;
    const text = htmlToText(page.html);
    if (text.length > 200) {
      onProgress && onProgress({ stage: 'index', url: pageUrl, indexed: indexed + 1, max: maxPages });
      const r = await rag.addDocument(scope, text, title(page.html) || pageUrl);
      if (r.ok) { indexed++; totalChunks += r.added; }
      else return { ok: false, error: r.error, indexed, chunks: totalChunks };
    }
    for (const l of links(page.html, origin, pageUrl)) { if (!seen.has(l) && seen.size < maxPages * 4) { seen.add(l); queue.push(l); } }
  }
  onProgress && onProgress({ stage: 'done', indexed, chunks: totalChunks });
  return { ok: true, indexed, chunks: totalChunks, origin };
}

const toolSchemas = [
  { type: 'function', function: { name: 'learn_website', description: 'Обойти сайт и проиндексировать его содержимое в базу знаний (RAG) для последующих ответов. Укажи URL и при желании число страниц.', parameters: { type: 'object', properties: { url: { type: 'string' }, maxPages: { type: 'number' } }, required: ['url'] } } }
];
const toolHandlers = {
  learn_website: async (a) => {
    const r = await learn({ url: a.url, maxPages: a.maxPages });
    return r.ok ? `Сайт изучен: проиндексировано страниц ${r.indexed}, фрагментов ${r.chunks}. Теперь можно задавать вопросы по содержимому.` : ('ОШИБКА: ' + r.error);
  }
};

module.exports = { learn, fetchPage, htmlToText, toolSchemas, toolHandlers };
