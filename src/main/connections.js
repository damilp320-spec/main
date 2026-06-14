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
function ghHeaders() { return { Authorization: 'Bearer ' + getTok('github'), 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' }; }
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
  return r.ok ? { ok: true, number: r.data.number, url: r.data.html_url } : { ok: false, error: (r.data && r.data.message) || ('HTTP ' + r.status) };
}

// ---------------- Telegram ----------------
async function telegramSend(text) {
  const tok = getTok('telegram'); const chat = store.get('settings.telegramChat', '');
  if (!tok || !chat) return { ok: false, error: 'Не задан токен/чат Telegram' };
  const r = await reqJSON('POST', `https://api.telegram.org/bot${tok}/sendMessage`, {}, { chat_id: chat, text: String(text).slice(0, 4000) });
  return r.ok ? { ok: true } : { ok: false, error: (r.data && r.data.description) || ('HTTP ' + r.status) };
}
async function telegramTest() { const r = await telegramSend('✅ Mythera подключена к Telegram.'); return r; }

// ---------------- Generic webhook ----------------
async function webhookPost(url, payload) {
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'Только https URL' };
  const r = await reqJSON('POST', url, {}, typeof payload === 'string' ? { text: payload } : (payload || {}));
  return r.ok ? { ok: true, status: r.status } : { ok: false, error: r.error || ('HTTP ' + r.status) };
}

function status() {
  return {
    github: !!getTok('github'),
    telegram: !!getTok('telegram') && !!store.get('settings.telegramChat', ''),
    telegramChat: store.get('settings.telegramChat', '')
  };
}

const toolSchemas = [
  { type: 'function', function: { name: 'github_repos', description: 'Список репозиториев пользователя на GitHub (требует подключения).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'github_issues', description: 'Открытые issues репозитория GitHub (формат owner/repo).', parameters: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] } } },
  { type: 'function', function: { name: 'github_create_issue', description: 'Создать issue в репозитории GitHub (owner/repo).', parameters: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, required: ['repo', 'title'] } } },
  { type: 'function', function: { name: 'telegram_send', description: 'Отправить сообщение в Telegram (на настроенный чат).', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } }
];
const toolHandlers = {
  github_repos: async () => { const r = await githubRepos(); return r.ok ? r.repos.map((x) => `• ${x.full} ⭐${x.stars} ${x.lang || ''} — ${x.desc || ''}`).join('\n') : 'ОШИБКА: ' + r.error; },
  github_issues: async (a) => { const r = await githubIssues(a.repo); return r.ok ? (r.issues.map((i) => `#${i.number} ${i.title} (@${i.user})`).join('\n') || 'Нет открытых issues.') : 'ОШИБКА: ' + r.error; },
  github_create_issue: async (a) => { const r = await githubCreateIssue(a.repo, a.title, a.body || ''); return r.ok ? `Issue создан: #${r.number} ${r.url}` : 'ОШИБКА: ' + r.error; },
  telegram_send: async (a) => { const r = await telegramSend(a.text); return r.ok ? 'Отправлено в Telegram.' : 'ОШИБКА: ' + r.error; }
};

module.exports = {
  setTok, getTok, status, githubUser, githubRepos, githubIssues, githubCreateIssue,
  telegramSend, telegramTest, webhookPost, toolSchemas, toolHandlers
};
