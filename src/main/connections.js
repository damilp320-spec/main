// Хаб внешних подключений: GitHub, Telegram, универсальные вебхуки и др.
// Токены шифруются через safeStorage. Сервисы доступны агентам как инструменты.
const https = require('https');
const store = require('./store');
function secrets() { try { return require('./secrets'); } catch { return null; } }

function setTok(key, val) {
  const s = secrets();
  if (val && s && s.encrypt) { try { store.set('settings.' + key + 'Enc', s.encrypt(val)); return { ok: true, encrypted: true }; } catch {} }
  if (!val) store.set('settings.' + key + 'Enc', '');
  return { ok: !!val, encrypted: false };
}
function getTok(key) {
  const enc = store.get('settings.' + key + 'Enc', ''); const s = secrets();
  if (enc && s && s.decrypt) { try { return s.decrypt(enc) || ''; } catch {} }
  return '';
}

function reqJSON(method, urlStr, headers, body) {
  return new Promise((resolve) => {
    let u; try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: e.message }); }
    const data = body ? JSON.stringify(body) : null;
    const h = { 'User-Agent': 'Mythera', 'Accept': 'application/json', ...(headers || {}) };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const req = https.request({ host: u.host, path: u.pathname + u.search, method, headers: h }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch {}
        resolve({ ok: res.statusCode < 400, status: res.statusCode, data: j, raw: buf });
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data); req.end();
  });
}

// ---------------- GitHub ----------------
function ghHeaders() {
  const tk = getTok('github');
  const h = { 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' };
  if (tk) h.Authorization = 'Bearer ' + tk; // часть эндпоинтов (поиск) работает и без токена
  return h;
}
function ghErr(r) { return (r.data && r.data.message) || r.error || ('HTTP ' + r.status); }
async function githubUser() {
  if (!getTok('github')) return { ok: false, error: 'Нет токена GitHub' };
  const r = await reqJSON('GET', 'https://api.github.com/user', ghHeaders());
  return r.ok ? { ok: true, login: r.data.login, name: r.data.name, repos: r.data.public_repos } : { ok: false, error: (r.data && r.data.message) || ('HTTP ' + r.status) };
}
async function githubRepos() {
  const r = await reqJSON('GET', 'https://api.github.com/user/repos?per_page=30&sort=updated', ghHeaders());
  if (!r.ok) return { ok: false, error: (r.data && r.data.message) || ('HTTP ' + r.status) };
  return { ok: true, repos: (r.data || []).map((x) => ({ full: x.full_name, desc: x.description, stars: x.stargazers_count, lang: x.language, url: x.html_url, open_issues: x.open_issues_count })) };
}
async function githubIssues(repo) {
  const r = await reqJSON('GET', `https://api.github.com/repos/${repo}/issues?per_page=20&state=open`, ghHeaders());
  if (!r.ok) return { ok: false, error: (r.data && r.data.message) || ('HTTP ' + r.status) };
  return { ok: true, issues: (r.data || []).filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, user: i.user && i.user.login, url: i.html_url, comments: i.comments })) };
}
async function githubCreateIssue(repo, title, body) {
  const r = await reqJSON('POST', `https://api.github.com/repos/${repo}/issues`, ghHeaders(), { title, body });
  return r.ok ? { ok: true, number: r.data.number, url: r.data.html_url } : { ok: false, error: ghErr(r) };
}
async function githubPRs(repo) {
  const r = await reqJSON('GET', `https://api.github.com/repos/${repo}/pulls?per_page=20&state=open`, ghHeaders());
  if (!r.ok) return { ok: false, error: ghErr(r) };
  return { ok: true, prs: (r.data || []).map((p) => ({ number: p.number, title: p.title, user: p.user && p.user.login, url: p.html_url, draft: p.draft, base: p.base && p.base.ref, head: p.head && p.head.ref })) };
}
async function githubCommits(repo) {
  const r = await reqJSON('GET', `https://api.github.com/repos/${repo}/commits?per_page=15`, ghHeaders());
  if (!r.ok) return { ok: false, error: ghErr(r) };
  return { ok: true, commits: (r.data || []).map((c) => ({ sha: (c.sha || '').slice(0, 7), msg: ((c.commit && c.commit.message) || '').split('\n')[0], author: c.commit && c.commit.author && c.commit.author.name, date: c.commit && c.commit.author && c.commit.author.date })) };
}
async function githubSearch(q) {
  const r = await reqJSON('GET', `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=10&sort=stars`, ghHeaders());
  if (!r.ok) return { ok: false, error: ghErr(r) };
  return { ok: true, repos: ((r.data && r.data.items) || []).map((x) => ({ full: x.full_name, desc: x.description, stars: x.stargazers_count, lang: x.language, url: x.html_url })) };
}
async function githubNotifications() {
  if (!getTok('github')) return { ok: false, error: 'Нет токена GitHub' };
  const r = await reqJSON('GET', 'https://api.github.com/notifications?per_page=20', ghHeaders());
  if (!r.ok) return { ok: false, error: ghErr(r) };
  return { ok: true, items: (r.data || []).map((n) => ({ title: n.subject && n.subject.title, type: n.subject && n.subject.type, repo: n.repository && n.repository.full_name, reason: n.reason })) };
}

// ---------------- Telegram ----------------
async function telegramSend(text) {
  const tok = getTok('telegram'); const chat = store.get('settings.telegramChat', '');
  if (!tok || !chat) return { ok: false, error: 'Не задан токен/чат Telegram' };
  const r = await reqJSON('POST', `https://api.telegram.org/bot${tok}/sendMessage`, {}, { chat_id: chat, text: String(text).slice(0, 4000) });
  return r.ok ? { ok: true } : { ok: false, error: (r.data && r.data.description) || ('HTTP ' + r.status) };
}
async function telegramTest() { const r = await telegramSend('✅ Mythera подключена к Telegram.'); return r; }

// ---------------- Discord ----------------
async function discordSend(text) {
  const url = getTok('discordWebhook');
  if (!url) return { ok: false, error: 'Не задан вебхук Discord' };
  const r = await reqJSON('POST', url, {}, { content: String(text).slice(0, 1900) });
  return r.ok ? { ok: true } : { ok: false, error: r.error || ('HTTP ' + r.status) };
}
async function discordTest() { return discordSend('✅ Mythera подключена к Discord.'); }

// ---------------- Slack ----------------
async function slackSend(text) {
  const url = getTok('slackWebhook');
  if (!url) return { ok: false, error: 'Не задан вебхук Slack' };
  const r = await reqJSON('POST', url, {}, { text: String(text).slice(0, 3000) });
  return r.ok ? { ok: true } : { ok: false, error: r.error || ('HTTP ' + r.status) };
}
async function slackTest() { return slackSend('✅ Mythera подключена к Slack.'); }

// ---------------- Weather (open-meteo, без ключа) ----------------
const WCODE = { 0: 'ясно', 1: 'преим. ясно', 2: 'переменная облачность', 3: 'пасмурно', 45: 'туман', 48: 'изморозь', 51: 'морось', 61: 'дождь', 63: 'дождь', 65: 'сильный дождь', 71: 'снег', 73: 'снег', 75: 'сильный снег', 80: 'ливень', 95: 'гроза' };
async function weather(place) {
  const g = await reqJSON('GET', `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place || '')}&count=1&language=ru`, {});
  const hit = g.ok && g.data && g.data.results && g.data.results[0];
  if (!hit) return { ok: false, error: 'Место не найдено' };
  const w = await reqJSON('GET', `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code`, {});
  const c = w.ok && w.data && w.data.current;
  if (!c) return { ok: false, error: w.error || 'Нет данных о погоде' };
  return { ok: true, place: `${hit.name}, ${hit.country || ''}`.trim(), temp: c.temperature_2m, wind: c.wind_speed_10m, humidity: c.relative_humidity_2m, desc: WCODE[c.weather_code] || ('код ' + c.weather_code) };
}

// ---------------- Generic webhook / HTTP ----------------
async function webhookPost(url, payload) {
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'Только https URL' };
  const r = await reqJSON('POST', url, {}, typeof payload === 'string' ? { text: payload } : (payload || {}));
  return r.ok ? { ok: true, status: r.status } : { ok: false, error: r.error || ('HTTP ' + r.status) };
}
// Универсальный HTTP-запрос к любому REST API (для интеграций «и т.д.»).
async function httpRequest({ method = 'GET', url, headers, body, auth } = {}) {
  if (store.get('settings.httpTool', true) === false) return { ok: false, error: 'HTTP-инструмент отключён в настройках безопасности.' };
  if (!/^https:\/\//i.test(url || '')) return { ok: false, error: 'Разрешены только https URL.' };
  const h = { ...(headers || {}) };
  if (auth) h.Authorization = /\s/.test(auth) ? auth : ('Bearer ' + auth);
  const r = await reqJSON(String(method).toUpperCase(), url, h, body);
  return { ok: r.ok, status: r.status, data: r.data, raw: (r.raw || '').slice(0, 4000), error: r.error };
}

function status() {
  return {
    github: !!getTok('github'),
    telegram: !!getTok('telegram') && !!store.get('settings.telegramChat', ''),
    telegramChat: store.get('settings.telegramChat', ''),
    discord: !!getTok('discordWebhook'),
    slack: !!getTok('slackWebhook')
  };
}

const toolSchemas = [
  { type: 'function', function: { name: 'github_repos', description: 'Список репозиториев пользователя на GitHub (требует подключения).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'github_issues', description: 'Открытые issues репозитория GitHub (формат owner/repo).', parameters: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] } } },
  { type: 'function', function: { name: 'github_create_issue', description: 'Создать issue в репозитории GitHub (owner/repo).', parameters: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, required: ['repo', 'title'] } } },
  { type: 'function', function: { name: 'github_prs', description: 'Открытые pull request-ы репозитория GitHub (owner/repo).', parameters: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] } } },
  { type: 'function', function: { name: 'github_commits', description: 'Последние коммиты репозитория GitHub (owner/repo).', parameters: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] } } },
  { type: 'function', function: { name: 'github_search', description: 'Поиск публичных репозиториев на GitHub по запросу.', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } } },
  { type: 'function', function: { name: 'github_notifications', description: 'Непрочитанные уведомления GitHub (требует токен).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'telegram_send', description: 'Отправить сообщение в Telegram (на настроенный чат).', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'discord_send', description: 'Отправить сообщение в Discord через настроенный вебхук.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'slack_send', description: 'Отправить сообщение в Slack через настроенный вебхук.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'weather', description: 'Текущая погода в указанном городе/месте.', parameters: { type: 'object', properties: { place: { type: 'string' } }, required: ['place'] } } },
  { type: 'function', function: { name: 'http_request', description: 'Универсальный HTTP-запрос к любому REST API (только https). Можно задать метод, заголовки, тело и токен авторизации.', parameters: { type: 'object', properties: { method: { type: 'string' }, url: { type: 'string' }, headers: { type: 'object' }, body: { type: 'object' }, auth: { type: 'string', description: 'Токен (будет добавлен как Bearer) или готовый заголовок Authorization.' } }, required: ['url'] } } }
];
const toolHandlers = {
  github_repos: async () => { const r = await githubRepos(); return r.ok ? r.repos.map((x) => `• ${x.full} ⭐${x.stars} ${x.lang || ''} — ${x.desc || ''}`).join('\n') : 'ОШИБКА: ' + r.error; },
  github_issues: async (a) => { const r = await githubIssues(a.repo); return r.ok ? (r.issues.map((i) => `#${i.number} ${i.title} (@${i.user})`).join('\n') || 'Нет открытых issues.') : 'ОШИБКА: ' + r.error; },
  github_create_issue: async (a) => { const r = await githubCreateIssue(a.repo, a.title, a.body || ''); return r.ok ? `Issue создан: #${r.number} ${r.url}` : 'ОШИБКА: ' + r.error; },
  github_prs: async (a) => { const r = await githubPRs(a.repo); return r.ok ? (r.prs.map((p) => `#${p.number} ${p.title} (@${p.user}${p.draft ? ', draft' : ''}) ${p.head}→${p.base}`).join('\n') || 'Нет открытых PR.') : 'ОШИБКА: ' + r.error; },
  github_commits: async (a) => { const r = await githubCommits(a.repo); return r.ok ? r.commits.map((c) => `${c.sha} ${c.msg} — ${c.author}`).join('\n') : 'ОШИБКА: ' + r.error; },
  github_search: async (a) => { const r = await githubSearch(a.q); return r.ok ? (r.repos.map((x) => `• ${x.full} ⭐${x.stars} ${x.lang || ''} — ${x.desc || ''}`).join('\n') || 'Ничего не найдено.') : 'ОШИБКА: ' + r.error; },
  github_notifications: async () => { const r = await githubNotifications(); return r.ok ? (r.items.map((n) => `• [${n.repo}] ${n.title} (${n.reason})`).join('\n') || 'Нет новых уведомлений.') : 'ОШИБКА: ' + r.error; },
  telegram_send: async (a) => { const r = await telegramSend(a.text); return r.ok ? 'Отправлено в Telegram.' : 'ОШИБКА: ' + r.error; },
  discord_send: async (a) => { const r = await discordSend(a.text); return r.ok ? 'Отправлено в Discord.' : 'ОШИБКА: ' + r.error; },
  slack_send: async (a) => { const r = await slackSend(a.text); return r.ok ? 'Отправлено в Slack.' : 'ОШИБКА: ' + r.error; },
  weather: async (a) => { const r = await weather(a.place); return r.ok ? `${r.place}: ${r.temp}°C, ${r.desc}, ветер ${r.wind} км/ч, влажность ${r.humidity}%` : 'ОШИБКА: ' + r.error; },
  http_request: async (a) => { const r = await httpRequest(a); return r.ok ? (typeof r.data !== 'undefined' && r.data !== null ? JSON.stringify(r.data).slice(0, 3500) : (r.raw || `OK ${r.status}`)) : 'ОШИБКА: ' + (r.error || ('HTTP ' + r.status)); }
};

module.exports = {
  setTok, getTok, status, githubUser, githubRepos, githubIssues, githubCreateIssue,
  githubPRs, githubCommits, githubSearch, githubNotifications,
  telegramSend, telegramTest, discordSend, discordTest, slackSend, slackTest,
  weather, httpRequest, webhookPost, toolSchemas, toolHandlers
};
