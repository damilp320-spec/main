/* Mythera AI Hub — логика интерфейса (рендерер) */
const N = window.mythera;
const { t, setLangCode, getLangCode, applyStaticI18n, LANGS } = window.I18N_API;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const state = {
  view: 'today',
  agents: [],
  activeAgentId: null,
  chats: {},           // agentId -> [{role, text}] — у каждого агента своя история
  streamAgentId: null, // агент, чей ответ сейчас стримится (одиночный режим)
  sessions: {},        // sessionId -> agentId (поддержка нескольких чатов одновременно)
  grid: { on: false, cells: [], cols: 3 }, // сетка 3×3 из окон-чатов
  attachment: null,    // прикреплённый к следующему сообщению файл
  sessionId: null,
  busy: false,
  voiceListening: false
};

// Активен ли сейчас запрос к данному агенту (для блокировки повторной отправки).
function agentBusy(agentId) { return Object.values(state.sessions).includes(agentId); }

// История текущего (или указанного) агента — создаётся при первом обращении.
function chatFor(agentId) {
  const id = agentId || state.activeAgentId;
  if (!state.chats[id]) state.chats[id] = [];
  return state.chats[id];
}
async function loadChat(agentId) {
  if (!state.chats[agentId]) state.chats[agentId] = (await N.store.get('chats.' + agentId, [])) || [];
  return state.chats[agentId];
}
function persistChat(agentId) {
  const id = agentId || state.activeAgentId;
  if (id) N.store.set('chats.' + id, (state.chats[id] || []).slice(-120));
}

/* ---------------- Window controls ---------------- */
$('#btn-min').onclick = () => N.win.minimize();
$('#btn-max').onclick = () => N.win.maximize();
$('#btn-close').onclick = () => N.win.close();

/* ---------------- Navigation ---------------- */
$$('.nav-item').forEach((b) => b.onclick = () => navigate(b.dataset.view));
function navigate(view) {
  state.view = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  render();
}

/* ---------------- Боковое меню: компактный (rail) режим ---------------- */
async function setupSidebar() {
  const collapsed = await N.store.get('sidebarCollapsed', false);
  applyRail(collapsed);
  const btn = $('#sidebar-collapse');
  if (btn) btn.onclick = async () => {
    const now = !document.body.classList.contains('rail');
    applyRail(now);
    await N.store.set('sidebarCollapsed', now);
  };
  syncNavTitles();
}
function applyRail(on) {
  document.body.classList.toggle('rail', on);
  const btn = $('#sidebar-collapse');
  if (btn) { btn.textContent = on ? '»' : '«'; btn.title = on ? t('sb.expand') : t('sb.collapse'); }
}
// Подсказки (tooltip) на пунктах меню — в свёрнутом режиме показывают название.
function syncNavTitles() {
  $$('.nav-item').forEach((b) => { const lbl = b.querySelector('span:not(.nav-ico)'); if (lbl) b.title = lbl.textContent; });
}
function toggleRail() { applyRail(!document.body.classList.contains('rail')); N.store.set('sidebarCollapsed', document.body.classList.contains('rail')); }

/* ---------------- Toasts ---------------- */
function toast(title, msg, kind) {
  const t = el('div', 'toast ' + (kind || ''));
  t.innerHTML = `<b>${esc(title)}</b>${msg ? `<p>${esc(msg)}</p>` : ''}`;
  $('#toast-wrap').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4200);
}

/* ---------------- Modal ---------------- */
function modal(html, onMount) {
  const back = el('div', 'modal-backdrop');
  const m = el('div', 'modal', html);
  back.appendChild(m);
  back.onclick = (e) => { if (e.target === back) back.remove(); };
  document.body.appendChild(back);
  onMount && onMount(m, () => back.remove());
  return back;
}

// Пресеты облачных провайдеров (OpenAI-совместимые) — модель-агностично.
// z.ai/GLM добавлен, чтобы можно было подключить GLM-модели в один клик.
const CLOUD_PRESETS = [
  { id: 'custom', name: '— выбрать пресет —', url: '' },
  { id: 'openai', name: 'OpenAI', provider: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'anthropic', name: 'Anthropic (Claude)', provider: 'anthropic', url: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest' },
  { id: 'zai', name: 'z.ai (GLM)', provider: 'openai', url: 'https://api.z.ai/api/paas/v4', model: 'glm-4-flash', note: 'впишите актуальное имя GLM-модели' },
  { id: 'bigmodel', name: 'Zhipu BigModel (GLM, CN)', provider: 'openai', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'deepseek', name: 'DeepSeek', provider: 'openai', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openrouter', name: 'OpenRouter', provider: 'openai', url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
  { id: 'groq', name: 'Groq', provider: 'openai', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'together', name: 'Together AI', provider: 'openai', url: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' }
];

/* ---------------- Themes ---------------- */
// Все темы доступны (Pro-режим временно отключён).
const ACCENTS = {
  violet: { a: '#7c5cff', b: '#29d3c2', name: 'Аметист' },
  ocean:  { a: '#3b82f6', b: '#22d3ee', name: 'Океан' },
  sunset: { a: '#ff7c5c', b: '#ffb547', name: 'Закат' },
  forest: { a: '#3ddc84', b: '#a3e635', name: 'Лес' },
  rose:   { a: '#ff5c9d', b: '#c77dff', name: 'Роза' },
  gold:   { a: '#f7b733', b: '#fc4a1a', name: 'Золото' },
  ice:    { a: '#7ee8fa', b: '#80a4ff', name: 'Лёд' },
  mono:   { a: '#9aa3b8', b: '#5b6478', name: 'Графит' }
};
async function applyTheme() {
  const th = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' });
  document.body.classList.toggle('light', th.mode === 'light');
  const ac = ACCENTS[th.accent] || ACCENTS.violet;
  const r = document.documentElement.style;
  r.setProperty('--accent', ac.a);
  r.setProperty('--accent-2', ac.b);
  r.setProperty('--accent-grad', `linear-gradient(135deg, ${ac.a} 0%, ${ac.b} 100%)`);
}

/* ---------------- Gating (Pro отключён — всё доступно) ---------------- */
async function ensurePro() { return true; }
async function ensureLimit() { return true; }

/* ================= VIEWS ================= */
const content = $('#content');
async function render() {
  content.scrollTop = 0;
  content.className = 'content fade-in';
  // Останавливаем авто-обновление рынков при уходе с раздела.
  if (state.view !== 'markets' && window.__marketTimer) { clearInterval(window.__marketTimer); window.__marketTimer = null; }
  const map = { today: viewToday, dashboard: viewDashboard, agents: viewAgents, marketplace: viewMarketplace, scenarios: viewScenarios, scheduler: viewScheduler, minecraft: viewMinecraft, servers: viewServers, translator: viewTranslator, smarthome: viewSmartHome, knowledge: viewKnowledge, swarm: viewSwarm, queue: viewQueue, skills: viewSkills, dispatch: viewDispatch, prompts: viewPrompts, voice: viewVoice, operator: viewOperator, automation: viewAutomation, markets: viewMarkets, trading: viewTrading, code: viewCode, images: viewImages, notes: viewNotes, data: viewData, rss: viewRss, calendar: viewCalendar, email: viewEmail, connections: viewConnections, playground: viewPlayground, diagnostics: viewDiagnostics, developer: viewDeveloper, settings: viewSettings };
  const fn = map[state.view] || viewDashboard;
  // Граница ошибок: сбой одной вкладки не «вешает» весь интерфейс.
  try {
    await fn();
  } catch (e) {
    console.error('Render error:', e);
    content.innerHTML = `<div class="card" style="padding:32px">
      <h2 style="color:var(--danger)">⚠️ ${esc(t('err.viewTitle'))}</h2>
      <p class="muted" style="margin:8px 0">${esc((e && e.message) || e)}</p>
      <button class="btn" id="err-retry">${esc(t('err.retry'))}</button></div>`;
    const r = $('#err-retry'); if (r) r.onclick = () => render();
  }
}

/* ---------- Dashboard ---------- */
/* ---------- «Сегодня»: личный центр управления ---------- */
async function viewToday() {
  const now = Date.now();
  content.innerHTML = `
    <div class="view-head"><h1>☀️ ${esc(t('today.title'))}</h1><p>${esc(t('today.sub'))} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
    <div class="grid cols-2">
      <div class="card today-card"><div class="row between"><h3>📅 ${esc(t('today.events'))}</h3><button class="btn ghost sm" data-go="calendar">→</button></div><div id="today-cal" class="muted">…</div></div>
      <div class="card today-card"><div class="row between"><h3>🔔 ${esc(t('today.notifs'))}</h3><button class="btn ghost sm" id="today-bell">→</button></div><div id="today-notif" class="muted">…</div></div>
      <div class="card today-card"><div class="row between"><h3>📋 ${esc(t('today.tasks'))}</h3><button class="btn ghost sm" data-go="queue">→</button></div><div id="today-tasks" class="muted">…</div></div>
      <div class="card today-card"><div class="row between"><h3>📈 ${esc(t('today.markets'))}</h3><button class="btn ghost sm" data-go="markets">→</button></div><div id="today-mkt" class="muted">…</div></div>
      <div class="card today-card" style="grid-column:1/-1"><div class="row between"><h3>📰 ${esc(t('today.news'))}</h3><button class="btn ghost sm" data-go="rss">→</button></div><div id="today-rss" class="muted">…</div></div>
    </div>`;
  $$('#content [data-go]').forEach((b) => b.onclick = () => navigate(b.dataset.go));
  $('#today-bell').onclick = toggleNotifPanel;

  // Календарь.
  N.cal.list(now - 3600000, now + 7 * 86400000).then((ev) => {
    const box = $('#today-cal'); if (!box) return;
    box.innerHTML = ev.length ? ev.slice(0, 6).map((e) => `<div class="today-row"><span>${esc(e.title)}</span><span class="muted">${new Date(e.start).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>`).join('') : `<span class="muted">${esc(t('today.noEvents'))}</span>`;
  });
  // Уведомления (непрочитанные).
  N.notif.list().then((list) => {
    const box = $('#today-notif'); if (!box) return;
    const un = list.filter((n) => !n.read).slice(-6).reverse();
    box.innerHTML = un.length ? un.map((n) => `<div class="today-row"><span>${NOTIF_ICON[n.kind] || 'ℹ️'} ${esc(n.title)}</span></div>`).join('') : `<span class="muted">${esc(t('today.noNotifs'))}</span>`;
  });
  // Задачи очереди.
  N.taskq.list().then((q) => {
    const box = $('#today-tasks'); if (!box) return;
    const active = (q.tasks || []).filter((x) => !TASK_TERMINAL.includes(x.status)).slice(0, 6);
    box.innerHTML = active.length ? active.map((x) => `<div class="today-row"><span>${TASK_STATUS[x.status] || '•'} ${esc(String(x.goal || '').slice(0, 50))}</span></div>`).join('') : `<span class="muted">${esc(t('today.noTasks'))}</span>`;
  });
  // Watchlist движения.
  N.markets.watchlist().then(async (wl) => {
    const box = $('#today-mkt'); if (!box) return;
    if (!wl.length) { box.innerHTML = `<span class="muted">${esc(t('today.noWatch'))}</span>`; return; }
    box.innerHTML = '';
    for (const w of wl.slice(0, 6)) {
      if (state.view !== 'today') return;
      const d = await N.markets.candles({ symbol: w.symbol, interval: '1d', range: '5d' });
      if (!box || state.view !== 'today') return;
      if (d.ok && d.candles.length) { const c = d.candles.map((x) => x.c); const chg = (c[c.length - 1] / c[0] - 1) * 100; box.innerHTML += `<div class="today-row"><span>${esc(w.symbol)}</span><span class="${chg >= 0 ? 'mk-up' : 'mk-down'}">${c[c.length - 1].toFixed(2)} ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%</span></div>`; }
    }
    if (!box.innerHTML) box.innerHTML = `<span class="muted">—</span>`;
  });
  // RSS заголовки.
  N.rss.feeds().then(async (feeds) => {
    const box = $('#today-rss'); if (!box) return;
    if (!feeds.length) { box.innerHTML = `<span class="muted">${esc(t('today.noRss'))}</span>`; return; }
    const agg = await N.rss.aggregate();
    if (!box || state.view !== 'today') return;
    box.innerHTML = agg.items.length ? agg.items.slice(0, 6).map((i) => `<div class="today-row"><a data-link="${esc(i.link)}">${esc(i.title)}</a><span class="muted" style="font-size:11px">${esc(i.source || '')}</span></div>`).join('') : `<span class="muted">—</span>`;
    $$('#today-rss [data-link]').forEach((a) => a.onclick = () => N.system.openExternal(a.dataset.link));
  });
}

async function viewDashboard() {
  const info = await N.system.info();
  const stats = await N.system.stats();
  const ollama = await N.installer.ollamaStatus();
  const models = ollama.running ? await N.installer.listModels() : [];
  const tasks = await N.tasks.list();
  const agents = await N.agents.list();

  content.innerHTML = `
    <div class="view-head"><h1>${esc(t('dash.title'))}</h1><p>${esc(t('dash.sub'))}</p></div>
    <div class="hero">
      <h2>👋 ${esc(t('dash.welcome'))}</h2>
      <p>${esc(t('dash.welcomeSub'))}</p>
      <div class="row wrap">
        <button class="btn primary" id="qs">${esc(t('dash.quickInstall'))}</button>
        <button class="btn ghost" id="goagents">${esc(t('dash.openAgents'))}</button>
        <button class="btn ghost" id="dl-latest">${esc(t('dash.download'))}</button>
      </div>
    </div>
    <div class="grid cols-4">
      <div class="card stat"><span class="lbl">${esc(t('dash.statusOllama'))}</span><span class="big">${ollama.running ? 'OK' : '—'}</span><span class="muted">${ollama.running ? t('dash.srvOn') : t('dash.srvOff')}</span></div>
      <div class="card stat"><span class="lbl">${esc(t('dash.models'))}</span><span class="big">${models.length}</span><span class="muted">${esc(t('dash.installedSub'))}</span></div>
      <div class="card stat"><span class="lbl">${esc(t('dash.agents'))}</span><span class="big">${agents.length}</span><span class="muted">${esc(t('dash.configured'))}</span></div>
      <div class="card stat"><span class="lbl">${esc(t('dash.tasks'))}</span><span class="big">${tasks.filter((x) => x.enabled).length}</span><span class="muted">${esc(t('dash.active'))}</span></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h3>💻 ${esc(t('dash.system'))}</h3>
        <p class="muted">${esc(info.cpuModel)}</p>
        <div style="margin-top:10px;font-size:13px;color:var(--muted)">
          RAM: ${stats.memUsedGb} / ${stats.memTotalGb} GB &nbsp;·&nbsp; ${info.cpus} cores &nbsp;·&nbsp; ${esc(info.platform)} ${esc(info.release)}
        </div>
      </div>
      <div class="card">
        <h3>📦 ${esc(t('dash.installed'))}</h3>
        ${models.length ? models.map(m => `<span class="tag accent">${esc(m.name)}</span>`).join('') : `<p class="muted" style="margin-top:8px">${esc(t('dash.noModels'))}</p>`}
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3>📊 ${esc(t('rep.telemetry'))}</h3>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn ghost sm" id="rep-chats">MD ${esc(t('rep.expChats'))}</button>
          <button class="btn ghost sm" id="rep-trades">MD ${esc(t('rep.expTrades'))}</button>
          <button class="btn ghost sm" id="rep-tel">MD ${esc(t('rep.expTel'))}</button>
          <button class="btn ghost sm" id="rep-pdf">📄 PDF ${esc(t('rep.expTel'))}</button>
        </div>
      </div>
      <div id="dash-tel" class="muted" style="margin-top:8px">…</div>
    </div>`;

  $('#qs').onclick = quickSetup;
  $('#goagents').onclick = () => navigate('agents');
  $('#dl-latest').onclick = () => N.system.openExternal('https://github.com/damilp320-spec/main/releases/latest');
  renderTelemetryCard();
  $('#rep-chats').onclick = exportChatsReport;
  $('#rep-trades').onclick = exportTradesReport;
  $('#rep-tel').onclick = exportTelemetryReport;
  $('#rep-pdf').onclick = async () => {
    const s = await N.reports.telemetry();
    if (!s.count) return toast('—', t('rep.noData'), 'err');
    const html = `<h1>📊 ${esc(t('rep.telemetry'))}</h1><p class="muted">${new Date().toLocaleString()}</p>
      <ul><li>${t('rep.runs')}: ${s.count}</li><li>${t('rep.totalTok')}: ${s.totalTokens}</li><li>${t('rep.avgTps')}: ${s.avgTps}</li><li>${t('rep.toolCalls')}: ${s.totalToolCalls}</li></ul>
      <h2>${t('rep.telemetry')} — ${esc(t('dash.models'))}</h2><table><tr><th>Model</th><th>Runs</th><th>Tokens</th><th>tok/s</th></tr>${s.byModel.map((m) => `<tr><td>${esc(m.model)}</td><td>${m.count}</td><td>${m.tokens}</td><td>${m.avgTps}</td></tr>`).join('')}</table>`;
    const r = await N.pdf.export(html, 'mythera-telemetry');
    toast(r.ok ? '📄 PDF' : '⚠️', r.ok ? r.path : r.error, r.ok ? 'ok' : 'err');
  };
}

async function renderTelemetryCard() {
  const box = $('#dash-tel'); if (!box) return;
  const s = await N.reports.telemetry();
  if (!s.count) { box.textContent = t('rep.noTel'); return; }
  box.innerHTML = `
    <div class="bt-stats">
      <div class="bt-stat"><span>${esc(t('rep.runs'))}</span><b>${s.count}</b></div>
      <div class="bt-stat"><span>${esc(t('rep.totalTok'))}</span><b>${s.totalTokens.toLocaleString()}</b></div>
      <div class="bt-stat"><span>${esc(t('rep.avgTps'))}</span><b>${s.avgTps}</b></div>
      <div class="bt-stat"><span>${esc(t('rep.avgMs'))}</span><b>${(s.avgMs / 1000).toFixed(1)}с</b></div>
      <div class="bt-stat"><span>${esc(t('rep.toolCalls'))}</span><b>${s.totalToolCalls}</b></div>
    </div>
    <div style="margin-top:10px">${s.byModel.map((m) => `<div class="row between" style="padding:4px 0;font-size:13px"><span>${esc(m.model)}</span><span class="muted">${m.count} · ${m.tokens.toLocaleString()} ток · ${m.avgTps} ток/с</span></div>`).join('')}</div>`;
}

// Скачать текст как файл (Blob + временная ссылка).
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
async function exportChatsReport() {
  const h = await N.agents.history();
  if (!h.length) return toast('—', t('rep.noData'), 'err');
  let md = `# Отчёт по диалогам\n\n_${new Date().toLocaleString()}_\n\n`;
  for (const e of h) md += `## ${e.agentName || e.agentId} · ${new Date(e.at).toLocaleString()}\n\n**Запрос:** ${e.user}\n\n**Ответ:** ${e.assistant}\n\n---\n\n`;
  downloadText('mythera-chats.md', md); toast('⬇', t('rep.saved'), 'ok');
}
async function exportTradesReport() {
  const log = await N.trade.log();
  if (!log.length) return toast('—', t('rep.noData'), 'err');
  let md = `# Журнал сделок\n\n_${new Date().toLocaleString()}_\n\n| Время | Среда | Событие | Сделка | Примечание |\n|---|---|---|---|---|\n`;
  for (const e of log) { const o = e.order || {}; md += `| ${new Date(e.at).toLocaleString()} | ${e.env || ''} | ${e.kind} | ${o.direction || ''} ${o.lots || ''} ${o.ticker || o.figi || ''} | ${e.reason || ''} |\n`; }
  downloadText('mythera-trades.md', md); toast('⬇', t('rep.saved'), 'ok');
}
async function exportTelemetryReport() {
  const s = await N.reports.telemetry();
  if (!s.count) return toast('—', t('rep.noData'), 'err');
  let md = `# Сводка телеметрии агентов\n\n_${new Date().toLocaleString()}_\n\n- Запусков: ${s.count}\n- Всего токенов: ${s.totalTokens}\n- Средняя скорость: ${s.avgTps} ток/с\n- Среднее время: ${(s.avgMs / 1000).toFixed(1)} с\n- Вызовов инструментов: ${s.totalToolCalls}\n\n## По моделям\n\n| Модель | Запусков | Токенов | ток/с |\n|---|---|---|---|\n`;
  for (const m of s.byModel) md += `| ${m.model} | ${m.count} | ${m.tokens} | ${m.avgTps} |\n`;
  downloadText('mythera-telemetry.md', md); toast('⬇', t('rep.saved'), 'ok');
}

async function quickSetup() {
  const rec = await N.installer.recommend();
  modal(`
    <h2>⚡ Быстрая установка</h2>
    <p class="muted">Под ваш ПК (${rec.totalGb} ГБ ОЗУ) подобраны модели:</p>
    <div style="margin:14px 0">${rec.models.map(m => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><b>${esc(m.name)}</b> <span class="model-size">${esc(m.size)}</span><br><small class="muted">${esc(m.desc)}</small></div></div>`).join('')}</div>
    <p class="muted">Будет установлена Ollama (если нужно) и загружены модели. Это может занять время и трафик.</p>
    <div id="qs-prog"></div>
    <div class="modal-actions">
      <button class="btn ghost" id="qs-cancel">Отмена</button>
      <button class="btn primary" id="qs-go">Установить</button>
    </div>`, (m, close) => {
    $('#qs-cancel', m).onclick = close;
    $('#qs-go', m).onclick = async () => {
      $('#qs-go', m).disabled = true;
      $('#qs-go', m).innerHTML = '<span class="spin"></span> Установка…';
      $('#qs-prog', m).innerHTML = '<div class="progress"><i id="qsbar"></i></div><p class="muted" id="qsmsg" style="margin-top:6px">Запуск…</p>';
      const r = await N.installer.quickSetup();
      if (r.ok) { toast('Готово', 'Агенты настроены и готовы к работе', 'ok'); close(); render(); }
      else { toast('Ошибка', r.error || 'Не удалось завершить установку', 'err'); $('#qs-go', m).disabled = false; $('#qs-go', m).textContent = 'Повторить'; }
    };
  });
}

/* ---------- Marketplace / Install ---------- */
async function viewMarketplace() {
  const ollama = await N.installer.ollamaStatus();
  const catalog = await N.installer.catalog();
  const installed = ollama.running ? await N.installer.listModels() : [];
  const installedIds = new Set(installed.map(m => m.name.split(':')[0] + ':' + (m.name.split(':')[1] || 'latest')));
  const isInstalled = (id) => installed.some(m => m.name === id || m.name.split(':')[0] === id.split(':')[0]);

  content.innerHTML = `
    <div class="view-head"><h1>${esc(t('mk.title'))}</h1><p>${esc(t('mk.sub'))}</p></div>
    ${!ollama.running ? `<div class="card" style="margin-bottom:16px;border-color:var(--warn)">
      <div class="row between"><div><h3>⚠️ Ollama не запущена</h3><p class="muted">Ollama — движок для локальных моделей. Установите его одной кнопкой.</p></div>
      <button class="btn primary" id="install-ollama">Установить / запустить Ollama</button></div></div>` : ''}
    <div class="card" style="margin-bottom:16px"><div class="row between" style="align-items:center"><div><h3>🛠️ ${esc(t('mb.title'))}</h3><p class="muted">${esc(t('mb.sub'))}</p></div><button class="btn primary" id="mb-open">${esc(t('mb.create'))}</button></div></div>
    <div class="grid cols-3" id="cat"></div>`;

  if ($('#mb-open')) $('#mb-open').onclick = modelBuilderModal;
  if ($('#install-ollama')) $('#install-ollama').onclick = async (e) => {
    e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Установка…';
    const st = await N.installer.ollamaStatus();
    if (!st.running) { await N.installer.startServer(); }
    const r = await N.installer.installOllama();
    if (r.alreadyInstalled) await N.installer.startServer();
    toast('Ollama', r.ok ? 'Команда установки/запуска выполнена' : (r.error || 'Ошибка'), r.ok ? 'ok' : 'err');
    setTimeout(render, 1500);
  };

  const cat = $('#cat');
  catalog.forEach((m) => {
    const done = isInstalled(m.id);
    const c = el('div', 'card model-card');
    c.innerHTML = `
      <div class="top">
        <div><h3>${esc(m.name)}</h3><span class="vendor">${esc(m.vendor)} · ${esc(m.id)}</span></div>
        ${m.best ? '<span class="best-flag">★ выбор</span>' : ''}
      </div>
      <p class="muted">${esc(m.desc)}</p>
      <div>${m.tags.map(t => `<span class="tag accent">${esc(t)}</span>`).join('')}</div>
      <div class="row between" style="margin-top:6px">
        <span class="model-size">${esc(m.size)} · ОЗУ ${m.ram}+ ГБ</span>
        ${done
          ? `<button class="btn sm danger" data-del="${esc(m.id)}">Удалить</button>`
          : `<button class="btn sm primary" data-pull="${esc(m.id)}">⬇️ Установить</button>`}
      </div>
      <div class="progress" style="display:none"><i></i></div>
      <small class="muted prog-msg"></small>`;
    cat.appendChild(c);

    const pull = c.querySelector('[data-pull]');
    if (pull) pull.onclick = async () => {
      if (!ollama.running) { toast('Ollama не запущена', 'Сначала установите/запустите Ollama', 'err'); return; }
      pull.disabled = true; pull.innerHTML = '<span class="spin"></span>';
      c.querySelector('.progress').style.display = 'block';
      const r = await N.installer.pullModel(m.id);
      if (r.ok) { toast('Установлено', m.name, 'ok'); render(); }
      else { toast('Ошибка', r.error, 'err'); pull.disabled = false; pull.textContent = 'Повторить'; }
    };
    const del = c.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      const r = await N.installer.deleteModel(m.id);
      toast(r.ok ? 'Удалено' : 'Ошибка', m.name, r.ok ? 'ok' : 'err');
      render();
    };
  });
}

/* ---------- Agents / Chat ---------- */
async function viewAgents() {
  state.agents = await N.agents.list();
  if (!state.activeAgentId && state.agents[0]) state.activeAgentId = state.agents[0].id;
  if (state.activeAgentId) await loadChat(state.activeAgentId);
  const effort = await N.store.get('settings.effort', 'balanced');
  // Состояние сетки.
  state.grid.on = await N.store.get('gridOn', false);
  state.grid.cols = await N.store.get('gridCols', 3);
  const savedCells = await N.store.get('gridCells', null);
  if (savedCells && savedCells.length) state.grid.cells = savedCells;
  else state.grid.cells = state.agents.slice(0, Math.min(9, state.agents.length || 1)).map((a, i) => ({ id: 'c' + i, agentId: a ? a.id : (state.agents[0] && state.agents[0].id) }));

  const effortSel = `<select id="effort-sel" class="effort-sel" title="${esc(t('eff.title'))}">
      <option value="fast" ${effort === 'fast' ? 'selected' : ''}>⚡ ${esc(t('eff.fast'))}</option>
      <option value="balanced" ${effort === 'balanced' ? 'selected' : ''}>⚖️ ${esc(t('eff.balanced'))}</option>
      <option value="thorough" ${effort === 'thorough' ? 'selected' : ''}>🔬 ${esc(t('eff.thorough'))}</option>
      <option value="max" ${effort === 'max' ? 'selected' : ''}>🧠 ${esc(t('eff.max'))}</option></select>`;

  const header = `
    <div class="view-head row between"><div><h1>${esc(t('nav.agents'))}</h1><p>${esc(t('agents.sub'))}</p></div>
      <div class="row">${effortSel}
        <button class="btn ghost" id="grid-toggle" title="${esc(t('agents.gridToggle'))}">${state.grid.on ? '▭ ' + esc(t('agents.single')) : '⊞ ' + esc(t('agents.grid'))}</button>
        <button class="btn ghost" id="gallery-agent">🧩 ${esc(t('agents.gallery'))}</button>
        <button class="btn ghost" id="import-agent">📥 ${esc(t('btn.import'))}</button>
        <button class="btn primary" id="new-agent">＋ ${esc(t('btn.newAgent'))}</button></div></div>`;

  const single = `
    <div class="agents-layout">
      <div class="agent-list" id="agent-list"></div>
      <div class="chat" id="chat">
        <div class="chat-head"><div id="chat-title"></div><div class="row">
          <button class="btn ghost sm" id="mem-agent">🧠 ${esc(t('agents.memory'))}</button><button class="btn ghost sm" id="export-agent">📤</button><button class="btn ghost sm" id="edit-agent">✎</button><button class="btn ghost sm" id="clear-chat">${esc(t('agents.clear'))}</button></div></div>
        <div class="chat-body" id="chat-body"></div>
        <div id="attach-bar"></div>
        <div class="chat-input">
          <button class="btn ghost" id="attach-btn" title="${esc(t('agents.attach'))}">📎</button>
          <textarea id="chat-text" placeholder="${esc(t('agents.placeholder'))}"></textarea>
          <button class="btn primary" id="send-btn">${esc(t('agents.send'))}</button>
        </div>
      </div>
    </div>`;

  content.innerHTML = header + (state.grid.on ? gridHTML() : single);

  // Общие кнопки шапки.
  $('#new-agent').onclick = async () => { if (await ensureLimit('agents', state.agents.length, 'Лимит')) editAgent(null); };
  $('#gallery-agent').onclick = () => templateGallery();
  $('#import-agent').onclick = () => $('#agent-import-input').click();
  $('#effort-sel').onchange = (e) => { N.store.set('settings.effort', e.target.value); toast('Effort', e.target.value, 'ok'); };
  $('#grid-toggle').onclick = async () => { state.grid.on = !state.grid.on; await N.store.set('gridOn', state.grid.on); viewAgents(); };

  if (state.grid.on) { wireGrid(); return; }

  // Одиночный режим.
  $('#export-agent').onclick = () => exportActiveAgent();
  $('#edit-agent').onclick = () => editAgent(state.agents.find(a => a.id === state.activeAgentId));
  $('#clear-chat').onclick = () => { state.chats[state.activeAgentId] = []; persistChat(); renderChat(); };
  $('#mem-agent').onclick = () => showMemory(state.activeAgentId);
  $('#attach-btn').onclick = () => $('#chat-file-input').click();
  renderAttachBar();

  const list = $('#agent-list');
  state.agents.forEach((a) => {
    const p = el('div', 'agent-pill' + (a.id === state.activeAgentId ? ' active' : ''));
    const cnt = (state.chats[a.id] || []).filter((m) => m.role === 'user').length;
    p.innerHTML = `<span class="ico">${a.icon || '🤖'}</span><div class="meta"><b>${esc(a.name)}</b><br><small>${esc(a.model || '')}${cnt ? ' · ' + cnt + ' 💬' : ''}</small></div>`;
    p.onclick = async () => { state.activeAgentId = a.id; await loadChat(a.id); viewAgents(); };
    list.appendChild(p);
  });

  const active = state.agents.find(a => a.id === state.activeAgentId);
  $('#chat-title').innerHTML = active ? `<b>${active.icon || '🤖'} ${esc(active.name)}</b> <span class="tag">${esc(autonomyLabel(active.autonomy))}</span>` : '';
  renderChat();
  updateBusyIndicators();

  $('#send-btn').onclick = sendChat;
  $('#chat-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });

  if (state.pendingPrompt) { $('#chat-text').value = state.pendingPrompt; state.pendingPrompt = null; $('#chat-text').focus(); }
}

/* ---------- Сетка 3×3 из окон-чатов ---------- */
function gridHTML() {
  const agentOpts = (sel) => state.agents.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a.icon || '🤖'} ${esc(a.name)}</option>`).join('');
  const cells = state.grid.cells.map((c) => `
    <div class="chat-cell" data-cell="${c.id}">
      <div class="cell-head">
        <select class="cell-agent" data-cell="${c.id}">${agentOpts(c.agentId)}</select>
        <span class="cell-busy" id="cell-busy-${c.id}" style="display:none">⏳</span>
        <span class="cell-actions"><span class="cell-clear" data-cell="${c.id}" title="${esc(t('agents.clear'))}">🧹</span><span class="cell-close" data-cell="${c.id}" title="${esc(t('q.cancel'))}">✕</span></span>
      </div>
      <div class="cell-body" id="cell-body-${c.id}"></div>
      <div class="cell-input">
        <textarea class="cell-text" data-cell="${c.id}" placeholder="${esc(t('agents.send'))}…"></textarea>
        <button class="btn primary sm cell-send" data-cell="${c.id}">▶</button>
      </div>
    </div>`).join('');
  const addBtn = state.grid.cells.length < 9 ? `<button class="cell-add" id="cell-add">＋ ${esc(t('agents.addCell'))}</button>` : '';
  return `<div class="grid-toolbar">
      <span class="muted">${esc(t('agents.windows'))}: ${state.grid.cells.length}/9</span>
      <div class="row"><span class="muted" style="font-size:12px">${esc(t('agents.cols'))}:</span>
        <button class="btn ghost sm cols-btn ${state.grid.cols === 2 ? 'active' : ''}" data-cols="2">2</button>
        <button class="btn ghost sm cols-btn ${state.grid.cols === 3 ? 'active' : ''}" data-cols="3">3</button>
        ${addBtn}</div>
    </div>
    <div class="chat-grid cols-${state.grid.cols}" id="chat-grid">${cells}</div>`;
}
function wireGrid() {
  $$('.cell-agent').forEach((sel) => sel.onchange = async () => {
    const c = state.grid.cells.find((x) => x.id === sel.dataset.cell); if (!c) return;
    c.agentId = sel.value; await loadChat(c.agentId); await persistGrid(); renderCellBody(c.id, c.agentId); updateBusyIndicators();
  });
  $$('.cell-send').forEach((b) => b.onclick = () => sendCell(b.dataset.cell));
  $$('.cell-text').forEach((ta) => ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCell(ta.dataset.cell); } }));
  $$('.cell-close').forEach((x) => x.onclick = async () => { state.grid.cells = state.grid.cells.filter((c) => c.id !== x.dataset.cell); await persistGrid(); viewAgents(); });
  $$('.cell-clear').forEach((x) => x.onclick = () => { const c = state.grid.cells.find((y) => y.id === x.dataset.cell); if (c) { state.chats[c.agentId] = []; persistChat(c.agentId); renderCellBody(c.id, c.agentId); } });
  $$('.cols-btn').forEach((b) => b.onclick = async () => { state.grid.cols = +b.dataset.cols; await N.store.set('gridCols', state.grid.cols); viewAgents(); });
  if ($('#cell-add')) $('#cell-add').onclick = async () => {
    if (state.grid.cells.length >= 9) return;
    const used = new Set(state.grid.cells.map((c) => c.agentId));
    const pick = state.agents.find((a) => !used.has(a.id)) || state.agents[0];
    state.grid.cells.push({ id: 'c' + Date.now().toString(36), agentId: pick && pick.id });
    await persistGrid(); viewAgents();
  };
  // загрузить истории и отрисовать ячейки
  (async () => {
    for (const c of state.grid.cells) { await loadChat(c.agentId); renderCellBody(c.id, c.agentId); }
    updateBusyIndicators();
  })();
}
function renderCellBody(cellId, agentId) {
  const body = document.getElementById('cell-body-' + cellId); if (!body) return;
  const chat = chatFor(agentId);
  if (!chat.length) { body.innerHTML = `<div class="cell-empty">🤖</div>`; return; }
  body.innerHTML = chat.map((m) => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join('');
  body.scrollTop = body.scrollHeight;
}
async function sendCell(cellId) {
  const c = state.grid.cells.find((x) => x.id === cellId); if (!c) return;
  const ta = document.querySelector(`.cell-text[data-cell="${cellId}"]`); if (!ta) return;
  const text = ta.value.trim(); if (!text) return;
  ta.value = '';
  await sendToAgent(c.agentId, text, null);
}
async function persistGrid() { await N.store.set('gridCells', state.grid.cells.map((c) => ({ id: c.id, agentId: c.agentId }))); }
function updateBusyIndicators() {
  const sb = $('#send-btn'); if (sb) sb.disabled = agentBusy(state.activeAgentId);
  if (state.grid.on) state.grid.cells.forEach((c) => { const d = document.getElementById('cell-busy-' + c.id); if (d) d.style.display = agentBusy(c.agentId) ? 'inline' : 'none'; });
}

function renderAttachBar() {
  const bar = $('#attach-bar'); if (!bar) return;
  if (!state.attachment) { bar.innerHTML = ''; return; }
  bar.innerHTML = `<div class="attach-chip">📎 ${esc(state.attachment.name)} <span id="attach-x">✕</span></div>`;
  const x = $('#attach-x'); if (x) x.onclick = () => { state.attachment = null; renderAttachBar(); };
}

async function exportActiveAgent() {
  if (!state.activeAgentId) return;
  const data = await N.agents.export(state.activeAgentId);
  if (!data) return toast('Ошибка', 'Агент не найден', 'err');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = (data.name || 'agent').replace(/[^\wа-яА-Я-]+/g, '_') + '.mythera.json';
  a.click(); URL.revokeObjectURL(a.href);
  toast('Экспортировано', data.name, 'ok');
}

// Галерея шаблонов агентов (намного больше готовых вариантов).
async function templateGallery() {
  const tpls = await N.agents.templates();
  const cats = [...new Set(tpls.map((x) => x.cat))];
  const body = cats.map((cat) => `
    <div class="tpl-cat">${esc(cat)}</div>
    <div class="grid cols-2">${tpls.filter((x) => x.cat === cat).map((x) => `
      <div class="card tpl-card" data-tpl="${esc(x.id)}">
        <div class="row" style="gap:10px"><span style="font-size:22px">${x.icon}</span>
        <div><b>${esc(x.name)}</b><br><small class="muted">${esc(x.desc || '')}</small></div></div>
        <button class="btn primary sm" data-add="${esc(x.id)}" style="margin-top:8px">＋ ${esc(t('btn.add'))}</button>
      </div>`).join('')}</div>`).join('');
  modal(`<h2>🧩 Галерея агентов <span class="tag">${tpls.length}</span></h2>
    <p class="muted">Готовые специалисты на любой случай. Добавьте в один клик.</p>
    <div style="max-height:60vh;overflow:auto;margin-top:10px">${body}</div>
    <div class="modal-actions"><button class="btn ghost" id="g-close">${esc(t('btn.close'))}</button></div>`, (m, close) => {
    $('#g-close', m).onclick = close;
    $$('[data-add]', m).forEach((b) => b.onclick = async () => {
      const r = await N.agents.addTemplate(b.dataset.add);
      if (r.ok) { toast('Добавлено', r.agent.name, 'ok'); state.activeAgentId = r.agent.id; close(); viewAgents(); }
      else toast('Ошибка', r.error, 'err');
    });
  });
}

function autonomyLabel(a) { return ({ 'chat-only': 'только чат', balanced: 'сбалансированный', autonomous: 'автономный' })[a] || 'сбалансированный'; }

async function showMemory(agentId) {
  const facts = await N.memory.list(agentId);
  modal(`<h2>🧠 Долговременная память</h2>
    <p class="muted">Агент сам сохраняет сюда важные факты после диалогов. Старая история сжимается, мусор не накапливается.</p>
    <div style="margin:14px 0">${facts.length ? facts.map((f, i) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px">• ${esc(f.text)}</span><button class="btn ghost sm" data-fdel="${i}">✕</button></div>`).join('') : '<p class="muted">Память пуста.</p>'}</div>
    <label class="field"><span>Добавить факт вручную</span><div class="row"><input id="mem-new" placeholder="Например: пользователь предпочитает Python"><button class="btn primary" id="mem-add">＋</button></div></label>
    <div class="modal-actions"><button class="btn danger" id="mem-clear">Очистить всё</button><button class="btn ghost" id="mem-close">Закрыть</button></div>`, (m, close) => {
    $('#mem-close', m).onclick = close;
    $('#mem-add', m).onclick = async () => { const v = $('#mem-new', m).value.trim(); if (v) { await N.memory.add(agentId, v); close(); showMemory(agentId); } };
    $('#mem-clear', m).onclick = async () => { await N.memory.clear(agentId); close(); showMemory(agentId); };
    $$('[data-fdel]', m).forEach((b) => b.onclick = async () => {
      // удаление одного факта: очищаем и пере-добавляем остальные
      const idx = +b.dataset.fdel; const keep = facts.filter((_, i) => i !== idx);
      await N.memory.clear(agentId); for (const f of keep) await N.memory.add(agentId, f.text);
      close(); showMemory(agentId);
    });
  });
}

function renderChat() {
  const body = $('#chat-body');
  if (!body) return;
  const chat = chatFor();
  if (!chat.length) {
    body.innerHTML = `<div class="empty"><div class="big-ico">🤖</div><p>${esc(t('agents.empty'))}</p></div>`;
    return;
  }
  body.innerHTML = '';
  chat.forEach((m, idx) => {
    // Видимое мышление: структурный план агента.
    if (m.role === 'plan' && Array.isArray(m.plan)) {
      const p = el('div', 'msg-plan');
      p.innerHTML = `<div class="plan-h">🧭 ${esc(t('think.plan'))}</div>` +
        m.plan.map((s, i) => `<div class="plan-step"><span class="plan-n">${i + 1}</span>${esc(s)}</div>`).join('');
      body.appendChild(p);
      return;
    }
    const d = el('div', 'msg ' + m.role);
    d.textContent = m.text;
    body.appendChild(d);
    // Артефакт: кнопка живого превью кода/HTML/графики.
    if (m.role === 'bot' && m.text && window.__artifactsOn) {
      const art = extractArtifact(m.text);
      if (art) {
        const ab = el('div', 'msg-art');
        ab.innerHTML = `<button class="btn ghost sm">${art.kind === 'html' ? '🖼' : '📄'} ${esc(t('art.preview'))}</button>`;
        ab.querySelector('button').onclick = () => openArtifact(art);
        body.appendChild(ab);
      }
    }
    // Телеметрия + оценка ответа на финальных сообщениях бота.
    if (m.role === 'bot' && m.text) {
      if (m.tel) {
        const f = el('div', 'msg-tel');
        f.textContent = `⏱ ${(m.tel.ms / 1000).toFixed(1)}${t('tel.sec')} · ${m.tel.tokens} ${t('tel.tok')} · ${m.tel.tokPerSec} ${t('tel.tps')} · ${m.tel.steps} ${t('tel.steps')}` +
          (m.tel.toolCalls ? ` · ${m.tel.toolCalls} 🔧` : '') + (m.tel.model ? ` · ${m.tel.model}` : '');
        body.appendChild(f);
      }
      if (m.id && !m.rated && (idx === chat.length - 1 || m.tel)) {
        const fb = el('div', 'msg-fb');
        fb.innerHTML = `<button class="fb-btn" data-r="up" title="${esc(t('fb.up'))}">👍</button><button class="fb-btn" data-r="down" title="${esc(t('fb.down'))}">👎</button>`;
        fb.querySelectorAll('.fb-btn').forEach((b) => b.onclick = () => rateMessage(m, b.dataset.r, fb));
        body.appendChild(fb);
      } else if (m.rated) {
        const r = el('div', 'msg-fb rated');
        r.textContent = m.rated === 'up' ? '👍' : '👎';
        body.appendChild(r);
      }
    }
  });
  body.scrollTop = body.scrollHeight;
}

// Оценка ответа агента (обратная связь — основа для будущих предпочтений).
async function rateMessage(m, rating, node) {
  m.rated = rating;
  try {
    await N.feedback.rate({ agentId: state.activeAgentId, rating, text: String(m.text || '').slice(0, 500) });
  } catch { /* best effort */ }
  if (node) { node.innerHTML = rating === 'up' ? '👍' : '👎'; node.classList.add('rated'); }
  persistChat(state.activeAgentId);
}

// Единое ядро отправки сообщения агенту (используется одиночным чатом и сеткой).
async function sendToAgent(agentId, rawText, attachment) {
  if (!agentId) return;
  if (agentBusy(agentId)) { toast(t('agents.busyTitle'), t('agents.busy'), 'err'); return; }
  let text = (rawText || '').trim();
  let userDisplay = text;
  if (attachment) {
    userDisplay = (text ? text + '\n\n' : '') + '📎 ' + attachment.name;
    text = (text ? text + '\n\n' : '') +
      (attachment.path ? `Прикреплён файл (сохранён в рабочем пространстве): ${attachment.path}\n` : '') +
      (attachment.content ? `Содержимое файла «${attachment.name}»:\n\`\`\`\n${attachment.content.slice(0, 12000)}\n\`\`\`` : '');
  }
  if (!text) return;
  const chat = chatFor(agentId);
  chat.push({ role: 'user', text: userDisplay });
  const history = chat.filter(m => m.role === 'user' || m.role === 'bot').slice(0, -1)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  chat.push({ role: 'bot', text: '', id: 'm-' + Date.now() });
  const sid = 'sess-' + agentId + '-' + Date.now();
  state.sessions[sid] = agentId;
  state.sessionId = sid;
  renderAgentEverywhere(agentId);
  const effort = await N.store.get('settings.effort', 'balanced');
  await N.agents.chat({ agentId, sessionId: sid, message: text, history, effort });
  // финал/persist выполняет обработчик agents:done
}

async function sendChat() {
  const ta = $('#chat-text');
  const text = ta.value.trim();
  if (!text && !state.attachment) return;
  if (agentBusy(state.activeAgentId)) { toast(t('agents.busyTitle'), t('agents.busy'), 'err'); return; }
  ta.value = '';
  const att = state.attachment; state.attachment = null; renderAttachBar();
  await sendToAgent(state.activeAgentId, text, att);
}

function editAgent(agent) {
  const isNew = !agent;
  agent = agent || { name: '', icon: '🤖', model: 'qwen2.5:7b', autonomy: 'balanced', system: '' };
  N.installer.listModels().then((models) => {
    const opts = (models.length ? models.map(m => m.name) : ['qwen2.5:7b', 'llama3.2:3b', 'mistral:7b'])
      .map(n => `<option value="${esc(n)}" ${n === agent.model ? 'selected' : ''}>${esc(n)}</option>`).join('');
    modal(`
      <h2>${isNew ? 'Новый агент' : 'Настройка агента'}</h2>
      <label class="field"><span>Имя</span><input id="a-name" value="${esc(agent.name)}" placeholder="Например: Личный ассистент"></label>
      <div class="row">
        <label class="field" style="width:80px"><span>Иконка</span><input id="a-icon" value="${esc(agent.icon)}"></label>
        <label class="field" style="flex:1"><span>Модель</span><select id="a-model">${opts}</select></label>
      </div>
      <label class="field"><span>Уровень автономии</span>
        <select id="a-auto">
          <option value="chat-only" ${agent.autonomy === 'chat-only' ? 'selected' : ''}>Только чат (без доступа к ПК)</option>
          <option value="balanced" ${agent.autonomy === 'balanced' ? 'selected' : ''}>Сбалансированный (инструменты по необходимости)</option>
          <option value="autonomous" ${agent.autonomy === 'autonomous' ? 'selected' : ''}>Автономный (многошаговые задачи)</option>
        </select></label>
      <label class="field"><span>Системный промпт (характер и роль)</span><textarea id="a-sys" style="min-height:110px">${esc(agent.system)}</textarea></label>
      <div class="modal-actions">
        ${!isNew ? '<button class="btn danger" id="a-del">Удалить</button>' : ''}
        <button class="btn ghost" id="a-cancel">Отмена</button>
        <button class="btn primary" id="a-save">Сохранить</button>
      </div>`, (m, close) => {
      $('#a-cancel', m).onclick = close;
      $('#a-save', m).onclick = async () => {
        const data = { ...agent, name: $('#a-name', m).value.trim() || 'Агент', icon: $('#a-icon', m).value || '🤖', model: $('#a-model', m).value, autonomy: $('#a-auto', m).value, system: $('#a-sys', m).value };
        const saved = await N.agents.save(data);
        state.activeAgentId = saved.id; close(); toast('Сохранено', saved.name, 'ok'); viewAgents();
      };
      if ($('#a-del', m)) $('#a-del', m).onclick = async () => { await N.agents.delete(agent.id); state.activeAgentId = null; close(); toast('Удалено', agent.name); viewAgents(); };
    });
  });
}

/* ---------- Scheduler ---------- */
async function viewScheduler() {
  const tasks = await N.tasks.list();
  const agents = await N.agents.list();
  content.innerHTML = `
    <div class="view-head row between"><div><h1>${esc(t('sch.title'))}</h1><p>${esc(t('sch.sub'))}</p></div>
      <button class="btn primary" id="new-task">${esc(t('sch.new'))}</button></div>
    <div class="grid" id="tasks"></div>`;
  $('#new-task').onclick = async () => { if (await ensureLimit('tasks', tasks.length, 'Лимит задач на бесплатном тарифе')) editTask(null, agents); };

  const wrap = $('#tasks');
  if (!tasks.length) { wrap.innerHTML = `<div class="empty"><div class="big-ico">⏰</div><p>Задач пока нет. Создайте автоматизацию: например, утренний брифинг при включении ПК.</p></div>`; return; }
  tasks.forEach((t) => {
    const c = el('div', 'card task-item between');
    c.innerHTML = `
      <div class="row" style="gap:14px">
        <label class="switch"><input type="checkbox" ${t.enabled ? 'checked' : ''} data-toggle="${t.id}"><span class="slider"></span></label>
        <div><b>${esc(t.name)}</b> <span class="trig">${triggerLabel(t)}</span><br>
        <small class="muted">${esc((t.action === 'speak' ? '🔊 ' + (t.speakText || '') : '🤖 ' + (t.prompt || '')).slice(0, 90))}</small></div>
      </div>
      <div class="row">
        <button class="btn ghost sm" data-run="${t.id}">▶ Запустить</button>
        <button class="btn ghost sm" data-edit="${t.id}">✎</button>
      </div>`;
    wrap.appendChild(c);
    c.querySelector('[data-toggle]').onchange = (e) => N.tasks.toggle(t.id, e.target.checked).then(() => toast('Обновлено', t.name, 'ok'));
    c.querySelector('[data-run]').onclick = () => { N.tasks.runNow(t.id); toast('Запущено', t.name, 'ok'); };
    c.querySelector('[data-edit]').onclick = () => editTask(t, agents);
  });
}

function triggerLabel(t) {
  if (t.trigger === 'onStartup') return 'при включении';
  if (t.trigger === 'interval') return `каждые ${t.intervalMinutes || 60} мин`;
  if (t.trigger === 'daily') return `ежедневно в ${t.time || '09:00'}`;
  return 'вручную';
}

function editTask(task, agents) {
  const isNew = !task;
  task = task || { name: '', trigger: 'onStartup', intervalMinutes: 60, time: '09:00', action: 'agent', agentId: agents[0]?.id, prompt: '', speakText: '', enabled: true };
  const agentOpts = agents.map(a => `<option value="${a.id}" ${a.id === task.agentId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  modal(`
    <h2>${isNew ? 'Новая задача' : 'Редактирование задачи'}</h2>
    <label class="field"><span>Название</span><input id="t-name" value="${esc(task.name)}" placeholder="Утренний брифинг"></label>
    <label class="field"><span>Триггер</span>
      <select id="t-trig">
        <option value="onStartup" ${task.trigger === 'onStartup' ? 'selected' : ''}>При включении ПК / запуске приложения</option>
        <option value="interval" ${task.trigger === 'interval' ? 'selected' : ''}>Каждые N минут</option>
        <option value="daily" ${task.trigger === 'daily' ? 'selected' : ''}>Ежедневно в указанное время</option>
        <option value="manual" ${task.trigger === 'manual' ? 'selected' : ''}>Только вручную</option>
      </select></label>
    <div class="row">
      <label class="field" id="wrap-interval" style="flex:1"><span>Интервал (минут)</span><input id="t-int" type="number" min="1" value="${task.intervalMinutes || 60}"></label>
      <label class="field" id="wrap-time" style="flex:1"><span>Время</span><input id="t-time" type="time" value="${task.time || '09:00'}"></label>
    </div>
    <label class="field"><span>Действие</span>
      <select id="t-act">
        <option value="agent" ${task.action === 'agent' ? 'selected' : ''}>Запустить агента с задачей</option>
        <option value="speak" ${task.action === 'speak' ? 'selected' : ''}>Озвучить текст</option>
      </select></label>
    <label class="field" id="wrap-agent"><span>Агент</span><select id="t-agent">${agentOpts}</select></label>
    <label class="field" id="wrap-prompt"><span>Задача для агента</span><textarea id="t-prompt" placeholder="Найди главные новости и составь краткий брифинг">${esc(task.prompt)}</textarea></label>
    <label class="field" id="wrap-speak" style="display:none"><span>Текст для озвучивания</span><textarea id="t-speak">${esc(task.speakText)}</textarea></label>
    <div class="modal-actions">
      ${!isNew ? '<button class="btn danger" id="t-del">Удалить</button>' : ''}
      <button class="btn ghost" id="t-cancel">Отмена</button>
      <button class="btn primary" id="t-save">Сохранить</button>
    </div>`, (m, close) => {
    const sync = () => {
      const trig = $('#t-trig', m).value, act = $('#t-act', m).value;
      $('#wrap-interval', m).style.display = trig === 'interval' ? 'block' : 'none';
      $('#wrap-time', m).style.display = trig === 'daily' ? 'block' : 'none';
      $('#wrap-agent', m).style.display = act === 'agent' ? 'block' : 'none';
      $('#wrap-prompt', m).style.display = act === 'agent' ? 'block' : 'none';
      $('#wrap-speak', m).style.display = act === 'speak' ? 'block' : 'none';
    };
    $('#t-trig', m).onchange = sync; $('#t-act', m).onchange = sync; sync();
    $('#t-cancel', m).onclick = close;
    $('#t-save', m).onclick = async () => {
      const data = { ...task, name: $('#t-name', m).value.trim() || 'Задача', trigger: $('#t-trig', m).value, intervalMinutes: +$('#t-int', m).value, time: $('#t-time', m).value, action: $('#t-act', m).value, agentId: $('#t-agent', m).value, prompt: $('#t-prompt', m).value, speakText: $('#t-speak', m).value };
      await N.tasks.save(data); close(); toast('Сохранено', data.name, 'ok'); viewScheduler();
    };
    if ($('#t-del', m)) $('#t-del', m).onclick = async () => { await N.tasks.delete(task.id); close(); toast('Удалено', task.name); viewScheduler(); };
  });
}

/* ---------- Minecraft Studio ---------- */
async function viewMinecraft() {
  const env = await N.mc.checkEnv();
  const projects = await N.mc.list();
  const templates = await N.mc.templates();
  const loaders = await N.mc.modLoaders();
  content.innerHTML = `
    <div class="view-head row between"><div><h1>${esc(t('mc.title'))}</h1><p>${esc(t('mc.sub'))}</p></div>
      <div class="row"><button class="btn ghost" id="mc-newmod">${esc(t('mc.newMod'))}</button><button class="btn primary" id="mc-new">${esc(t('mc.newPlugin'))}</button></div></div>
    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card"><h3>☕ Java (JDK)</h3><p class="muted">${env.java ? '✅ ' + esc(env.javaVersion || 'установлена') : '❌ не найдена · <code>' + esc(env.hints.java) + '</code>'}</p></div>
      <div class="card"><h3>📦 Maven</h3><p class="muted">${env.maven ? '✅ ' + esc(env.mavenVersion || 'установлен') : '❌ не найден · <code>' + esc(env.hints.maven) + '</code>'}</p></div>
      <div class="card"><h3>🐘 Gradle</h3><p class="muted">${env.gradle ? '✅ ' + esc(env.gradleVersion || 'установлен') : '❌ не найден · <code>' + esc(env.hints.gradle) + '</code>'}</p></div>
    </div>
    ${(!env.java || !env.gradle || !env.maven) ? '<button class="btn primary" id="mc-install-tools" style="margin-bottom:16px">⬇️ Установить всё для сборки модов (JDK 21 + Gradle + Maven)</button>' : ''}
    <div class="grid" id="mc-projects"></div>`;
  $('#mc-new').onclick = () => newMcPlugin(templates);
  $('#mc-newmod').onclick = () => newMcMod(loaders);
  if ($('#mc-install-tools')) $('#mc-install-tools').onclick = () => installLogModal('Установка инструментов сборки', () => N.tooling.installMcTools());

  const wrap = $('#mc-projects');
  if (!projects.length) { wrap.innerHTML = `<div class="empty"><div class="big-ico">🧱</div><p>Проектов пока нет. Создайте плагин или мод — или попросите агента: «создай мод Fabric».</p></div>`; return; }
  const kindIco = { plugin: '🧱', fabric: '🧵', forge: '🔨' };
  projects.forEach((p) => {
    const isMod = p.kind === 'forge' || p.kind === 'fabric';
    const c = el('div', 'card');
    c.innerHTML = `
      <div class="row between"><div><h3>${kindIco[p.kind] || '🧱'} ${esc(p.name)} <span class="tag">${esc(p.kind)}</span></h3>
        <p class="muted">${p.jar ? '✅ собран: ' + esc(p.jar.split(/[\\/]/).pop()) : (p.buildable ? 'готов к сборке' : 'нет файла сборки')}</p></div>
        <div class="row">
          <button class="btn primary sm" data-compile="${esc(p.name)}">⚙️ Компилировать</button>
          <button class="btn danger sm" data-del="${esc(p.name)}">Удалить</button>
        </div></div>
      <pre class="mc-log" style="display:none;margin-top:10px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:220px;overflow:auto;font-size:11px;font-family:Consolas,monospace;white-space:pre-wrap"></pre>`;
    wrap.appendChild(c);
    c.querySelector('[data-compile]').onclick = async (e) => {
      const log = c.querySelector('.mc-log'); log.style.display = 'block'; log.textContent = '';
      window.__mcLog = log;
      e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Сборка…';
      const r = isMod ? await N.mc.compileMod(p.name) : await N.mc.compile(p.name);
      e.target.disabled = false; e.target.textContent = '⚙️ Компилировать';
      if (r.ok) { toast('Собрано', p.name + '.jar готов', 'ok'); log.textContent += '\n✅ JAR: ' + r.jar; }
      else { toast('Ошибка сборки', r.error, 'err'); log.textContent += '\n❌ ' + r.error; }
    };
    c.querySelector('[data-del]').onclick = async () => { await N.mc.delete(p.name); toast('Удалено', p.name); viewMinecraft(); };
  });
}

function newMcMod(loaders) {
  const opts = Object.entries(loaders).map(([k, l]) => `<option value="${k}">${esc(l.label)} — ${esc(l.desc)}</option>`).join('');
  modal(`
    <h2>Новый мод Minecraft</h2>
    <label class="field"><span>Имя мода</span><input id="mm-name" placeholder="MyAwesomeMod"></label>
    <label class="field"><span>Лоадер</span><select id="mm-loader">${opts}</select></label>
    <div class="row">
      <label class="field" style="flex:1"><span>Версия MC</span><input id="mm-ver" value="1.21.1"></label>
      <label class="field" style="flex:1"><span>Автор</span><input id="mm-author" value="MytheraAI"></label>
    </div>
    <p class="muted">Создаётся Gradle-проект. Первая сборка скачивает зависимости (нужен интернет).</p>
    <div class="modal-actions"><button class="btn ghost" id="mm-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="mm-save">Создать</button></div>`, (m, close) => {
    $('#mm-cancel', m).onclick = close;
    $('#mm-save', m).onclick = async () => {
      const r = await N.mc.createMod({ name: $('#mm-name', m).value.trim() || 'MyMod', loader: $('#mm-loader', m).value, mcVersion: $('#mm-ver', m).value, author: $('#mm-author', m).value });
      if (r.ok) { toast('Создано', r.name + ' (' + r.loader + ')', 'ok'); close(); viewMinecraft(); }
      else toast('Ошибка', r.error, 'err');
    };
  });
}

function newMcPlugin(templates) {
  const opts = Object.entries(templates).map(([k, t]) => `<option value="${k}">${esc(t.label)} — ${esc(t.desc)}</option>`).join('');
  modal(`
    <h2>Новый плагин Minecraft</h2>
    <label class="field"><span>Имя плагина</span><input id="mc-name" placeholder="MyAwesomePlugin"></label>
    <label class="field"><span>Шаблон</span><select id="mc-tpl">${opts}</select></label>
    <div class="row">
      <label class="field" style="flex:1"><span>Версия MC</span><input id="mc-ver" value="1.21"></label>
      <label class="field" style="flex:1"><span>Автор</span><input id="mc-author" value="MytheraAI"></label>
    </div>
    <div class="modal-actions"><button class="btn ghost" id="mc-cancel">Отмена</button><button class="btn primary" id="mc-save">Создать</button></div>`, (m, close) => {
    $('#mc-cancel', m).onclick = close;
    $('#mc-save', m).onclick = async () => {
      const r = await N.mc.create({ name: $('#mc-name', m).value.trim() || 'MyPlugin', template: $('#mc-tpl', m).value, mcVersion: $('#mc-ver', m).value, author: $('#mc-author', m).value });
      if (r.ok) { toast('Создано', r.name, 'ok'); close(); viewMinecraft(); }
      else toast('Ошибка', r.error, 'err');
    };
  });
}

/* ---------- Remote Servers ---------- */
let currentServer = null, currentPath = '.';
async function viewServers() {
  const available = await N.remote.available();
  const servers = await N.remote.list();
  content.innerHTML = `
    <div class="view-head row between"><div><h1>${esc(t('srv.title'))}</h1><p>${esc(t('srv.sub'))}</p></div>
      <button class="btn primary" id="srv-new">${esc(t('srv.new'))}</button></div>
    ${!available ? '<div class="card" style="border-color:var(--warn);margin-bottom:16px"><p class="muted">⚠️ Модуль SSH (ssh2) не установлен. Выполните <code>npm install</code> и перезапустите.</p></div>' : ''}
    <div class="grid cols-2"><div id="srv-list"></div><div class="card" id="srv-explorer"><p class="muted">Выберите сервер слева, чтобы открыть файловую систему.</p></div></div>`;
  $('#srv-new').onclick = async () => { if (await ensureLimit('servers', servers.length, 'Лимит серверов на бесплатном тарифе')) editServer(null); };

  const list = $('#srv-list');
  if (!servers.length) { list.innerHTML = `<div class="empty"><div class="big-ico">🖥️</div><p>Серверов нет.</p></div>`; return; }
  servers.forEach((s) => {
    const c = el('div', 'card', `<div class="row between"><div><h3>🖥️ ${esc(s.name)}</h3><p class="muted">${esc(s.username)}@${esc(s.host)}:${s.port}</p></div>
      <div class="row"><button class="btn sm" data-open="${s.id}">📂 Открыть</button><button class="btn ghost sm" data-edit="${s.id}">✎</button></div></div>`);
    list.appendChild(c);
    c.querySelector('[data-open]').onclick = () => { currentServer = s.id; currentPath = '.'; openExplorer(); };
    c.querySelector('[data-edit]').onclick = () => editServer(s);
  });
}

async function openExplorer() {
  const exp = $('#srv-explorer');
  exp.innerHTML = `<div class="row between"><b>📂 ${esc(currentPath)}</b><button class="btn ghost sm" id="srv-cmd">⌨️ Команда</button></div><div id="srv-files" style="margin-top:10px"><p class="muted"><span class="spin"></span> Загрузка…</p></div>`;
  $('#srv-cmd').onclick = runRemoteCmd;
  const r = await N.remote.ls(currentServer, currentPath);
  const fw = $('#srv-files');
  if (!r.ok) { fw.innerHTML = `<p class="muted">❌ ${esc(r.error)}</p>`; return; }
  fw.innerHTML = '';
  if (currentPath !== '.' && currentPath !== '/') {
    const up = el('div', 'task-item', '<span>⬆️ ..</span>'); up.style.cursor = 'pointer'; up.style.padding = '6px 0';
    up.onclick = () => { currentPath = currentPath.replace(/\/[^/]+\/?$/, '') || '/'; openExplorer(); };
    fw.appendChild(up);
  }
  r.files.forEach((f) => {
    const row = el('div', 'task-item', `<span>${f.dir ? '📁' : '📄'} ${esc(f.name)}</span>`);
    row.style.cssText = 'cursor:pointer;padding:6px 0;border-bottom:1px solid var(--border)';
    row.onclick = () => {
      const np = (currentPath === '.' ? '' : currentPath.replace(/\/$/, '')) + '/' + f.name;
      if (f.dir) { currentPath = np; openExplorer(); }
      else editRemoteFile(np);
    };
    fw.appendChild(row);
  });
}

async function editRemoteFile(p) {
  const r = await N.remote.read(currentServer, p);
  if (!r.ok) { toast('Ошибка', r.error, 'err'); return; }
  modal(`<h2>📄 ${esc(p.split('/').pop())}</h2><p class="muted">${esc(p)}</p>
    <label class="field"><textarea id="rf-content" style="min-height:340px;font-family:Consolas,monospace;font-size:12px">${esc(r.content)}</textarea></label>
    <div class="modal-actions"><button class="btn ghost" id="rf-cancel">Закрыть</button><button class="btn primary" id="rf-save">💾 Сохранить на сервер</button></div>`, (m, close) => {
    $('#rf-cancel', m).onclick = close;
    $('#rf-save', m).onclick = async () => {
      const w = await N.remote.write(currentServer, p, $('#rf-content', m).value);
      toast(w.ok ? 'Сохранено' : 'Ошибка', w.ok ? p : w.error, w.ok ? 'ok' : 'err');
      if (w.ok) close();
    };
  });
}

function runRemoteCmd() {
  modal(`<h2>⌨️ Команда на сервере</h2>
    <label class="field"><input id="rc-cmd" placeholder="ls -la /etc"></label>
    <pre id="rc-out" style="display:none;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:300px;overflow:auto;font-size:12px;font-family:Consolas,monospace;white-space:pre-wrap"></pre>
    <div class="modal-actions"><button class="btn ghost" id="rc-close">Закрыть</button><button class="btn primary" id="rc-run">Выполнить</button></div>`, (m, close) => {
    $('#rc-close', m).onclick = close;
    $('#rc-run', m).onclick = async () => {
      const out = $('#rc-out', m); out.style.display = 'block'; out.textContent = 'Выполнение…';
      const r = await N.remote.exec(currentServer, $('#rc-cmd', m).value);
      out.textContent = r.ok ? (r.output || '(нет вывода)') : '❌ ' + r.error;
    };
  });
}

function editServer(s) {
  const isNew = !s;
  s = s || { name: '', host: '', port: 22, username: 'root' };
  modal(`<h2>${isNew ? 'Новое подключение' : 'Редактирование'}</h2>
    <label class="field"><span>Имя</span><input id="s-name" value="${esc(s.name)}" placeholder="Мой VPS"></label>
    <div class="row"><label class="field" style="flex:2"><span>Хост / IP</span><input id="s-host" value="${esc(s.host)}"></label>
      <label class="field" style="flex:1"><span>Порт</span><input id="s-port" type="number" value="${s.port || 22}"></label></div>
    <label class="field"><span>Пользователь</span><input id="s-user" value="${esc(s.username)}"></label>
    <label class="field"><span>Пароль ${s.hasPassword ? '(сохранён — оставьте пустым)' : ''}</span><input id="s-pass" type="password"></label>
    <label class="field"><span>Приватный ключ (опц., вставьте текст)</span><textarea id="s-key" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea></label>
    <div class="modal-actions">
      ${!isNew ? '<button class="btn danger" id="s-del">Удалить</button>' : ''}
      <button class="btn ghost" id="s-test">🔌 Тест</button>
      <button class="btn ghost" id="s-cancel">Отмена</button>
      <button class="btn primary" id="s-save">Сохранить</button>
    </div>`, (m, close) => {
    const gather = () => ({ ...s, name: $('#s-name', m).value.trim() || 'Сервер', host: $('#s-host', m).value.trim(), port: +$('#s-port', m).value || 22, username: $('#s-user', m).value.trim(), password: $('#s-pass', m).value || undefined, privateKey: $('#s-key', m).value.trim() || undefined });
    $('#s-cancel', m).onclick = close;
    $('#s-save', m).onclick = async () => { await N.remote.save(gather()); toast('Сохранено', 'Подключение', 'ok'); close(); viewServers(); };
    $('#s-test', m).onclick = async () => {
      const saved = await N.remote.save(gather()); s.id = saved.id;
      $('#s-test', m).innerHTML = '<span class="spin"></span>';
      const r = await N.remote.test(saved.id);
      $('#s-test', m).textContent = '🔌 Тест';
      toast(r.ok ? 'Успешно' : 'Ошибка', r.ok ? 'Соединение установлено' : r.error, r.ok ? 'ok' : 'err');
    };
    if ($('#s-del', m)) $('#s-del', m).onclick = async () => { await N.remote.delete(s.id); close(); toast('Удалено', s.name); viewServers(); };
  });
}

/* ---------- Translator ---------- */
async function viewTranslator() {
  const models = await N.installer.listModels();
  const modelOpts = (models.length ? models.map(m => m.name) : ['qwen2.5:7b']).map(n => `<option>${esc(n)}</option>`).join('');
  const langs = ['Русский', 'English', 'Español', '中文', 'Deutsch', 'Français', '日本語', 'Português', 'العربية', 'हिन्दी'];
  content.innerHTML = `
    <div class="view-head"><h1>${esc(t('tr.title'))}</h1><p>${esc(t('tr.sub'))}</p></div>
    <div class="card">
      <div class="row">
        <label class="field" style="flex:1"><span>Модель</span><select id="tr-model">${modelOpts}</select></label>
        <label class="field" style="flex:1"><span>С языка</span><select id="tr-src"><option value="auto">Авто-определение</option>${langs.map(l => `<option>${esc(l)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1"><span>На язык</span><select id="tr-dst">${langs.map(l => `<option ${l === 'English' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Исходный текст</span><textarea id="tr-input" style="min-height:160px" placeholder="Вставьте большой текст или JSON…"></textarea></label>
      <div class="row wrap">
        <button class="btn primary" id="tr-go">🌐 Перевести</button>
        <button class="btn ghost" id="tr-file">📄 Перевести файл из рабочего пространства</button>
        <button class="btn ghost" id="tr-copy">📋 Копировать результат</button>
      </div>
      <div class="progress" id="tr-prog" style="display:none;margin-top:12px"><i></i></div>
      <p class="muted" id="tr-msg" style="margin-top:6px"></p>
      <label class="field"><span>Результат</span><textarea id="tr-output" style="min-height:160px" readonly></textarea></label>
    </div>`;
  $('#tr-go').onclick = async () => {
    const text = $('#tr-input').value.trim();
    if (!text) return toast('Пусто', 'Введите текст', 'err');
    $('#tr-prog').style.display = 'block'; $('#tr-go').disabled = true; $('#tr-go').innerHTML = '<span class="spin"></span> Перевод…';
    const r = await N.translate.text({ model: $('#tr-model').value, text, targetLang: $('#tr-dst').value, sourceLang: $('#tr-src').value });
    $('#tr-output').value = r; $('#tr-go').disabled = false; $('#tr-go').textContent = '🌐 Перевести';
    toast('Готово', 'Перевод завершён', 'ok');
  };
  $('#tr-file').onclick = () => modal(`<h2>Перевести файл</h2><p class="muted">Путь относительно рабочего пространства (~/MytheraAI-Workspace) или абсолютный.</p>
    <label class="field"><input id="trf-path" placeholder="data/messages.json"></label>
    <div class="modal-actions"><button class="btn ghost" id="trf-cancel">Отмена</button><button class="btn primary" id="trf-go">Перевести</button></div>`, (m, close) => {
    $('#trf-cancel', m).onclick = close;
    $('#trf-go', m).onclick = async () => {
      $('#trf-go', m).innerHTML = '<span class="spin"></span>';
      const r = await N.translate.file({ model: $('#tr-model').value, file: $('#trf-path', m).value.trim(), targetLang: $('#tr-dst').value, sourceLang: $('#tr-src').value });
      toast(r.ok ? 'Готово' : 'Ошибка', r.ok ? r.outPath : r.error, r.ok ? 'ok' : 'err');
      if (r.ok) close();
    };
  });
  $('#tr-copy').onclick = () => { navigator.clipboard.writeText($('#tr-output').value); toast('Скопировано', '', 'ok'); };
}

/* ---------- Knowledge base (RAG) ---------- */
async function viewKnowledge() {
  const ragOn = await N.store.get('settings.rag', false);
  const embed = await N.store.get('settings.embedModel', 'nomic-embed-text');
  const st = await N.rag.stats('kb');
  content.innerHTML = `
    <div class="view-head"><h1>📚 ${esc(t('nav.knowledge'))}</h1><p>${esc(t('kb.sub'))}</p></div>
    <div class="card" style="margin-bottom:16px">
      <div class="row between"><div><b>RAG-память</b><br><small class="muted">Модель эмбеддингов: ${esc(embed)} · документов в базе: ${st.count}</small></div>
      <label class="switch"><input type="checkbox" id="rag-on" ${ragOn ? 'checked' : ''}><span class="slider"></span></label></div>
      ${st.count ? `<div style="margin-top:10px">${st.sources.map((s) => `<span class="tag accent">${esc(s)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="card">
      <h3>➕ Добавить знание</h3>
      <label class="field"><span>Текст / заметка</span><textarea id="kb-text" style="min-height:120px" placeholder="Вставьте текст, который агенты должны помнить и использовать…"></textarea></label>
      <div class="row wrap">
        <button class="btn primary" id="kb-add">Добавить в базу</button>
        <button class="btn ghost" id="kb-file">📄 Импорт файла из рабочего пространства</button>
        <button class="btn danger" id="kb-clear">Очистить базу</button>
      </div>
      <div id="kb-status" class="muted" style="margin-top:10px"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>🌐 ${esc(t('kb.learnSite'))}</h3>
      <p class="muted" style="margin-bottom:8px">${esc(t('kb.learnSiteSub'))}</p>
      <div class="row" style="gap:8px">
        <input id="kb-url" placeholder="https://docs.example.com" style="flex:1">
        <input id="kb-pages" type="number" value="8" min="1" max="30" style="max-width:80px" title="${esc(t('kb.maxPages'))}">
        <button class="btn primary" id="kb-learn">${esc(t('kb.learn'))}</button>
      </div>
      <div id="kb-crawl" class="muted" style="margin-top:8px"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>🔎 Проверить поиск</h3>
      <div class="row"><input id="kb-q" placeholder="Запрос для проверки релевантности…"><button class="btn" id="kb-search">Найти</button></div>
      <div id="kb-results" style="margin-top:10px"></div>
    </div>`;
  $('#rag-on').onchange = (e) => { N.store.set('settings.rag', e.target.checked); toast('RAG', e.target.checked ? 'включён' : 'выключен', 'ok'); };
  $('#kb-add').onclick = async () => {
    const text = $('#kb-text').value.trim(); if (!text) return;
    $('#kb-status').textContent = 'Индексация…';
    const r = await N.rag.add('kb', text, 'note');
    $('#kb-status').textContent = r.ok ? `Добавлено фрагментов: ${r.added}` : 'Ошибка: ' + r.error + ' (установлена ли модель эмбеддингов?)';
    if (r.ok) { $('#kb-text').value = ''; viewKnowledge(); }
  };
  $('#kb-file').onclick = () => modal(`<h2>Импорт файла в базу знаний</h2><p class="muted">Путь относительно рабочего пространства или абсолютный.</p>
    <label class="field"><input id="kbf-path" placeholder="docs/manual.txt"></label>
    <div class="modal-actions"><button class="btn ghost" id="kbf-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="kbf-go">Импорт</button></div>`, (m, close) => {
    $('#kbf-cancel', m).onclick = close;
    $('#kbf-go', m).onclick = async () => { const r = await N.rag.ingestFile('kb', $('#kbf-path', m).value.trim()); toast(r.ok ? 'OK' : 'Ошибка', r.ok ? `Фрагментов: ${r.added}` : r.error, r.ok ? 'ok' : 'err'); if (r.ok) { close(); viewKnowledge(); } };
  });
  $('#kb-clear').onclick = async () => { if (await confirmModal('Очистить базу знаний?', 'Все документы будут удалены.')) { await N.rag.clear('kb'); viewKnowledge(); } };
  $('#kb-learn').onclick = async () => {
    const url = $('#kb-url').value.trim(); if (!url) return;
    const status = $('#kb-crawl'); status.innerHTML = '<span class="spin">⏳</span> ' + esc(t('kb.crawling'));
    $('#kb-learn').disabled = true;
    const r = await N.crawler.learn({ url, maxPages: +$('#kb-pages').value || 8, scope: 'kb' });
    $('#kb-learn').disabled = false;
    if (r.ok) { status.innerHTML = `✅ ${t('kb.learned')}: ${r.indexed} стр., ${r.chunks} фрагм.`; setTimeout(viewKnowledge, 1500); }
    else status.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`;
  };
  $('#kb-search').onclick = async () => {
    const q = $('#kb-q').value.trim(); if (!q) return;
    $('#kb-results').innerHTML = '<span class="spin"></span>';
    const hits = await N.rag.retrieve('kb', q);
    $('#kb-results').innerHTML = hits.length ? hits.map((h) => `<div class="card" style="margin-bottom:8px"><small class="muted">${esc(h.source)} · ${h.score}</small><br>${esc(h.text.slice(0, 300))}</div>`).join('') : '<p class="muted">Ничего не найдено (или RAG/модель не настроены).</p>';
  };
}

/* ---------- Task queue ---------- */
const TASK_STATUS = { queued: '⏳', running: '⚙️', completed: '✅', failed: '❌', cancelled: '⏹️' };
const TASK_TERMINAL = ['completed', 'failed', 'cancelled'];
async function viewQueue() {
  const agents = await N.agents.list();
  const conc = await N.store.get('settings.taskConcurrency', 2);
  const q = await N.taskq.list();
  state.queueFilter = state.queueFilter || 'all';
  content.innerHTML = `
    <div class="view-head row between"><div><h1>📋 ${esc(t('nav.queue'))}</h1><p>${esc(t('q.sub'))}</p></div>
      <div class="row">
        <button class="btn ${q.paused ? 'primary' : 'ghost'}" id="q-pause">${q.paused ? '▶ ' + esc(t('q.resume')) : '⏸ ' + esc(t('q.pause'))}</button>
        <label class="muted" style="font-size:12px">${esc(t('q.concurrency'))}: <input id="q-conc" type="number" min="1" max="5" value="${conc}" style="width:54px"></label>
        <button class="btn ghost" id="q-clear">${esc(t('q.clearDone'))}</button><button class="btn primary" id="q-new">＋ ${esc(t('q.add'))}</button></div></div>
    <div class="row wrap" id="q-filters" style="margin-bottom:12px">
      ${['all', 'queued', 'running', 'completed', 'failed'].map((f) => `<button class="btn ghost sm q-filter ${state.queueFilter === f ? 'active' : ''}" data-f="${f}">${esc(t('q.f.' + f))}</button>`).join('')}
    </div>
    <div id="q-list"></div>`;
  $('#q-new').onclick = () => addTaskModal(agents);
  $('#q-clear').onclick = async () => { await N.taskq.clearDone(); renderQueue(); };
  $('#q-pause').onclick = async () => { await N.taskq.pause(!q.paused); viewQueue(); };
  $('#q-conc').onchange = (e) => N.store.set('settings.taskConcurrency', Math.max(1, Math.min(5, +e.target.value || 2)));
  $$('.q-filter').forEach((b) => b.onclick = () => { state.queueFilter = b.dataset.f; viewQueue(); });
  state.queueAgents = agents;
  renderQueue();
}
async function renderQueue() {
  const wrap = $('#q-list'); if (!wrap) return;
  const q = await N.taskq.list();
  let tasks = q.tasks || [];
  const agents = state.queueAgents || await N.agents.list();
  const nameOf = (id) => (agents.find((a) => a.id === id) || {}).name || '—';
  if (state.queueFilter && state.queueFilter !== 'all') tasks = tasks.filter((tk) => tk.status === state.queueFilter);
  if (!tasks.length) { wrap.innerHTML = `<div class="empty"><div class="big-ico">📋</div><p>${esc(t('q.empty'))}</p></div>`; return; }
  const order = { running: 0, queued: 1, failed: 2, cancelled: 3, completed: 4 };
  tasks.sort((a, b) => (order[a.status] - order[b.status]) || (b.priority - a.priority) || (a.createdAt - b.createdAt));
  const sched = (tk) => {
    const bits = [];
    if (tk.runAt && tk.runAt > Date.now()) bits.push('⏰ ' + new Date(tk.runAt).toLocaleTimeString());
    if (tk.dependsOn && tk.dependsOn.length) bits.push('🔗 ' + tk.dependsOn.length);
    return bits.length ? ' · ' + bits.join(' · ') : '';
  };
  wrap.innerHTML = tasks.map((tk) => `
    <div class="card" style="margin-bottom:10px" id="qt-${tk.id}">
      <div class="row between">
        <div><b>${TASK_STATUS[tk.status] || ''} ${esc(tk.goal.slice(0, 90))}</b>
          <br><small class="muted">${esc(t('q.prio'))} ${'★'.repeat(tk.priority)} · ${tk.mode === 'swarm' ? '🐝 ' + t('q.team') : '🤖 ' + esc(tk.agentIds.map(nameOf).join(', ') || t('q.auto'))} · ${esc(t('q.status.' + tk.status) || tk.status)}${sched(tk)}${tk.note ? ' · ' + esc(tk.note) : ''}${tk.error ? ' · ' + esc(tk.error) : ''}</small></div>
        <div class="row">
          ${tk.status === 'queued' ? `<button class="btn ghost sm" data-pup="${tk.id}" title="${esc(t('q.prioUp'))}">▲</button><button class="btn ghost sm" data-pdn="${tk.id}" title="${esc(t('q.prioDown'))}">▼</button>` : ''}
          ${tk.status === 'queued' && (tk.runAt > Date.now() || (tk.dependsOn && tk.dependsOn.length)) ? `<button class="btn ghost sm" data-now="${tk.id}" title="${esc(t('q.runNow'))}">⏵</button>` : ''}
          ${(tk.status === 'queued' || tk.status === 'running') ? `<button class="btn ghost sm" data-cancel="${tk.id}">${esc(t('q.cancel'))}</button>` : ''}
          ${TASK_TERMINAL.includes(tk.status) ? `<button class="btn ghost sm" data-retry="${tk.id}" title="${esc(t('q.retryT'))}">↻</button><button class="btn ghost sm" data-dup="${tk.id}" title="${esc(t('q.duplicate'))}">⧉</button>` : ''}
          <button class="btn ghost sm" data-rm="${tk.id}">✕</button>
        </div>
      </div>
      ${tk.status === 'running' ? `<div class="progress" style="margin-top:8px"><i style="width:${tk.progress || 0}%"></i></div>` : ''}
      ${tk.result ? `<div class="muted" style="margin-top:8px;font-size:12px;white-space:pre-wrap;max-height:140px;overflow:auto">${esc(String(tk.result).slice(0, 800))}</div>` : ''}
    </div>`).join('');
  const re = () => renderQueue();
  $$('[data-cancel]', wrap).forEach((b) => b.onclick = async () => { await N.taskq.cancel(b.dataset.cancel); re(); });
  $$('[data-retry]', wrap).forEach((b) => b.onclick = async () => { await N.taskq.retry(b.dataset.retry); re(); });
  $$('[data-rm]', wrap).forEach((b) => b.onclick = async () => { await N.taskq.remove(b.dataset.rm); re(); });
  $$('[data-dup]', wrap).forEach((b) => b.onclick = async () => { await N.taskq.duplicate(b.dataset.dup); re(); });
  $$('[data-now]', wrap).forEach((b) => b.onclick = async () => { await N.taskq.runNow(b.dataset.now); re(); });
  $$('[data-pup]', wrap).forEach((b) => b.onclick = async () => { const tk = tasks.find((x) => x.id === b.dataset.pup); await N.taskq.setPriority(b.dataset.pup, (tk.priority || 3) + 1); re(); });
  $$('[data-pdn]', wrap).forEach((b) => b.onclick = async () => { const tk = tasks.find((x) => x.id === b.dataset.pdn); await N.taskq.setPriority(b.dataset.pdn, (tk.priority || 3) - 1); re(); });
}
async function addTaskModal(agents) {
  const q = await N.taskq.list();
  const queued = (q.tasks || []).filter((tk) => tk.status === 'queued');
  const agentChecks = agents.map((a) => `<label class="row" style="gap:8px;padding:3px 0"><input type="checkbox" data-qa="${a.id}"><span>${a.icon || '🤖'} ${esc(a.name)}</span></label>`).join('');
  const depOpts = `<option value="">${esc(t('q.none'))}</option>` + queued.map((tk) => `<option value="${tk.id}">${esc(tk.goal.slice(0, 40))}</option>`).join('');
  modal(`<h2>＋ ${esc(t('q.add'))}</h2>
    <label class="field"><span>${esc(t('q.goal'))}</span><textarea id="q-goal" style="min-height:80px" placeholder="${esc(t('q.goalPh'))}"></textarea></label>
    <div class="row"><label class="field" style="flex:1"><span>${esc(t('q.prio'))}</span><select id="q-prio"><option value="5">★★★★★</option><option value="4">★★★★</option><option value="3" selected>★★★</option><option value="2">★★</option><option value="1">★</option></select></label>
      <label class="field" style="flex:1"><span>${esc(t('q.retries'))}</span><input id="q-ret" type="number" min="0" max="5" value="1"></label></div>
    <div class="row"><label class="field" style="flex:1"><span>${esc(t('q.delay'))}</span><input id="q-delay" type="number" min="0" value="0"></label>
      <label class="field" style="flex:1"><span>${esc(t('q.dependsOn'))}</span><select id="q-dep">${depOpts}</select></label></div>
    <p class="muted" style="margin:6px 0">${esc(t('q.pickAgents'))}</p>
    <div style="max-height:160px;overflow:auto">${agentChecks}</div>
    <div class="modal-actions"><button class="btn ghost" id="q-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="q-go">${esc(t('q.add'))}</button></div>`, (m, close) => {
    $('#q-cancel', m).onclick = close;
    $('#q-go', m).onclick = async () => {
      const goal = $('#q-goal', m).value.trim(); if (!goal) return;
      const agentIds = $$('[data-qa]:checked', m).map((x) => x.dataset.qa);
      const dep = $('#q-dep', m).value;
      const r = await N.taskq.add({ goal, agentIds, priority: +$('#q-prio', m).value, retries: +$('#q-ret', m).value, delaySec: +$('#q-delay', m).value || 0, dependsOn: dep ? [dep] : [] });
      if (r.ok) { toast(t('q.added'), '', 'ok'); close(); renderQueue(); } else toast('Ошибка', r.error, 'err');
    };
  });
}

/* ---------- Swarm (multi-agent) ---------- */
let swarmState = { running: false };
async function viewSwarm() {
  const agents = await N.agents.list();
  content.innerHTML = `
    <div class="view-head"><h1>🐝 ${esc(t('nav.swarm'))}</h1><p>${esc(t('sw.sub'))}</p></div>
    <div class="card">
      <label class="field"><span>Цель</span><textarea id="sw-goal" style="min-height:90px" placeholder="Например: исследуй тему X, напиши отчёт и сохрани в файл"></textarea></label>
      <p class="muted" style="margin:6px 0">Участники команды</p>
      <div id="sw-agents" class="grid cols-3"></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="sw-run">▶ Запустить команду</button></div>
    </div>
    <div id="sw-out" style="margin-top:16px"></div>`;
  const wrap = $('#sw-agents');
  agents.forEach((a) => {
    const c = el('label', 'card', `<div class="row" style="gap:8px"><input type="checkbox" data-ag="${a.id}"><span>${a.icon || '🤖'} ${esc(a.name)}</span></div>`);
    c.style.cursor = 'pointer';
    wrap.appendChild(c);
  });
  $('#sw-run').onclick = async () => {
    const goal = $('#sw-goal').value.trim();
    const agentIds = $$('#sw-agents [data-ag]:checked').map((x) => x.dataset.ag);
    if (!goal || !agentIds.length) return toast('Заполните', 'Нужны цель и хотя бы один агент', 'err');
    swarmState.running = true;
    $('#sw-out').innerHTML = '<div class="card"><div id="sw-status" class="muted"></div><div id="sw-plan" style="margin:8px 0"></div><div id="sw-steps" style="margin-top:10px"></div><div id="sw-final" class="msg bot" style="margin-top:12px;display:none"></div></div>';
    $('#sw-run').disabled = true; $('#sw-run').innerHTML = '<span class="spin"></span> Работает…';
    await N.swarm.run({ goal, agentIds });
    $('#sw-run').disabled = false; $('#sw-run').textContent = '▶ Запустить команду';
    swarmState.running = false;
  };
}

/* ---------- Skills (plugins) ---------- */
async function viewSkills() {
  const list = await N.skills.list();
  content.innerHTML = `
    <div class="view-head row between"><div><h1>🧩 ${esc(t('nav.skills'))}</h1><p>${esc(t('sk.sub'))}</p></div>
      <div class="row"><button class="btn ghost" id="sk-import">📥 ${esc(t('btn.import'))}</button><button class="btn primary" id="sk-new">＋ Новый скил</button></div></div>
    <div class="grid cols-2" id="sk-list"></div>`;
  $('#sk-new').onclick = () => editSkill(null);
  $('#sk-import').onclick = () => $('#skill-import-input').click();
  const wrap = $('#sk-list');
  list.forEach((s) => {
    const c = el('div', 'card', `<div class="row between"><div><b>${s.type === 'http' ? '🌐' : '⌨️'} ${esc(s.label || s.name)}</b> <span class="tag">${esc(s.type)}</span><br><small class="muted">${esc(s.description || '')}</small><br><code style="font-size:11px;color:var(--muted)">${esc(String(s.template).slice(0, 90))}</code></div></div>
      <div class="row" style="margin-top:8px"><button class="btn ghost sm" data-edit="${s.id}">✎</button><button class="btn ghost sm" data-exp="${s.id}">📤</button><button class="btn danger sm" data-del="${s.id}">${esc(t('btn.delete'))}</button></div>`);
    wrap.appendChild(c);
    c.querySelector('[data-edit]').onclick = () => editSkill(s);
    c.querySelector('[data-del]').onclick = async () => { await N.skills.delete(s.id); viewSkills(); };
    c.querySelector('[data-exp]').onclick = async () => { const data = await N.skills.export(s.id); downloadJson(data, (s.name || 'skill') + '.skill.json'); };
  });
}
function editSkill(skill) {
  const isNew = !skill;
  skill = skill || { label: '', name: '', type: 'command', description: '', method: 'GET', params: [], template: '' };
  const paramsStr = (skill.params || []).map((p) => p.name).join(', ');
  modal(`<h2>${isNew ? 'Новый скил' : 'Скил'}</h2>
    <label class="field"><span>Название</span><input id="sk-label" value="${esc(skill.label)}" placeholder="Погода"></label>
    <div class="row"><label class="field" style="flex:1"><span>Имя инструмента (a-z_)</span><input id="sk-name" value="${esc(skill.name)}" placeholder="weather"></label>
      <label class="field" style="flex:1"><span>Тип</span><select id="sk-type"><option value="command" ${skill.type === 'command' ? 'selected' : ''}>command</option><option value="http" ${skill.type === 'http' ? 'selected' : ''}>http</option></select></label></div>
    <label class="field"><span>Описание</span><input id="sk-desc" value="${esc(skill.description)}"></label>
    <label class="field"><span>Параметры (через запятую)</span><input id="sk-params" value="${esc(paramsStr)}" placeholder="city"></label>
    <label class="field"><span>Шаблон (плейсхолдеры {param}). command — команда; http — URL</span><textarea id="sk-tpl" style="min-height:80px;font-family:monospace">${esc(skill.template)}</textarea></label>
    <p class="muted">⚠️ command-скилы проходят тот же фильтр опасных команд, что и агент.</p>
    <div class="modal-actions"><button class="btn ghost" id="sk-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="sk-save">${esc(t('btn.save'))}</button></div>`, (m, close) => {
    $('#sk-cancel', m).onclick = close;
    $('#sk-save', m).onclick = async () => {
      const params = $('#sk-params', m).value.split(',').map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n, description: '' }));
      await N.skills.save({ ...skill, label: $('#sk-label', m).value.trim() || 'Скил', name: $('#sk-name', m).value.trim() || $('#sk-label', m).value.trim(), type: $('#sk-type', m).value, description: $('#sk-desc', m).value, params, template: $('#sk-tpl', m).value });
      close(); toast('OK', 'Скил сохранён', 'ok'); viewSkills();
    };
  });
}

/* ---------- Dispatch (remote access) ---------- */
async function viewDispatch() {
  const s = await N.dispatch.status();
  content.innerHTML = `
    <div class="view-head"><h1>📡 ${esc(t('nav.dispatch'))}</h1><p>${esc(t('dp.sub'))}</p></div>
    <div class="card">
      <div class="row between"><div><b>Локальный сервер</b><br><small class="muted">${s.running ? 'запущен' : 'остановлен'} · режим: ${s.mode}</small></div>
      <label class="switch"><input type="checkbox" id="dp-on" ${s.running ? 'checked' : ''}><span class="slider"></span></label></div>
      ${s.running ? `<div style="margin-top:14px">
        <p class="muted">Откройте на другом устройстве в той же сети:</p>
        ${s.urls.map((u) => `<div class="row between" style="padding:6px 0"><code>${esc(u)}</code><button class="btn ghost sm" data-copy="${esc(u)}">Копировать</button></div>`).join('')}
        <p class="muted" style="margin-top:10px">Токен доступа:</p>
        <div class="row"><code style="font-size:16px;letter-spacing:1px">${esc(s.token)}</code><button class="btn ghost sm" id="dp-regen">Обновить токен</button></div>
      </div>` : ''}
      <div class="row between" style="margin-top:14px"><span>Разрешить доступ из локальной сети (не только localhost)</span>
        <label class="switch"><input type="checkbox" id="dp-lan" ${s.lan ? 'checked' : ''}><span class="slider"></span></label></div>
      <label class="field" style="margin-top:10px"><span>Порт</span><input id="dp-port" type="number" value="${s.port}" style="max-width:140px"></label>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>🗺️ Дорожная карта доступа</h3>
      <p class="muted">✅ Сейчас: локальный режим (этот ПК / своя Wi-Fi сеть, с токеном).<br>
      🔜 В планах: <b>облачный режим</b> — защищённый туннель к ПК без проброса портов.<br>
      📱 В далёком будущем: <b>мобильное приложение</b> (веб-интерфейс уже спроектирован как основа PWA).</p>
    </div>`;
  $('#dp-on').onchange = async (e) => { const r = e.target.checked ? await N.dispatch.start() : await N.dispatch.stop(); toast('Dispatch', e.target.checked ? (r.running ? 'запущен' : 'ошибка: ' + (r.error || '')) : 'остановлен', r.running || !e.target.checked ? 'ok' : 'err'); viewDispatch(); };
  $('#dp-lan').onchange = async (e) => { await N.dispatch.setOption('lan', e.target.checked); toast('Перезапустите сервер', 'чтобы применить', 'ok'); };
  $('#dp-port').onchange = async (e) => { await N.dispatch.setOption('port', +e.target.value || 8765); };
  if ($('#dp-regen')) $('#dp-regen').onclick = async () => { await N.dispatch.regenToken(); viewDispatch(); };
  $$('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Скопировано', '', 'ok'); });
}

function downloadJson(data, filename) {
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- Smart Home ---------- */
async function viewSmartHome() {
  const protocols = await N.smart.protocols();
  const devices = await N.smart.list();
  content.innerHTML = `
    <div class="view-head row between"><div><h1>🏠 ${esc(t('nav.smarthome'))}</h1><p>${esc(t('sh.sub'))}</p></div>
      <button class="btn primary" id="sh-new">${esc(t('sh.new'))}</button></div>
    <div class="card" style="margin-bottom:16px">
      <h3>🔌 Поддерживаемые протоколы (${protocols.length})</h3>
      <div style="margin-top:8px">${protocols.map((p) => `<span class="tag accent" title="${esc(p.note)}">${p.region === 'ru' ? '🇷🇺 ' : ''}${esc(p.name)}</span>`).join('')}</div>
      <p class="muted" style="margin-top:8px">Большинство экосистем (Xiaomi, HomeKit, Matter, Tuya, Sonoff…) подключаются через хаб Home Assistant или вебхук — это покрывает «всё».</p>
    </div>
    <div class="grid cols-2" id="sh-list"></div>`;
  $('#sh-new').onclick = () => editDevice(null, protocols);
  const wrap = $('#sh-list');
  if (!devices.length) { wrap.innerHTML = `<div class="empty"><div class="big-ico">🏠</div><p>Устройств нет. Добавьте первое — затем скажите голосом: «включи свет на кухне».</p></div>`; return; }
  devices.forEach((d) => {
    const c = el('div', 'card', `<div class="row between"><div><b>${esc(d.name)}</b> <span class="tag">${esc(d.protocol)}</span><br><small class="muted">${esc(d.entity || d.host || '')}</small></div></div>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn sm" data-act="on">Вкл</button><button class="btn sm" data-act="off">Выкл</button>
        <button class="btn ghost sm" data-act="toggle">Переключить</button><button class="btn ghost sm" data-edit="1">✎</button><button class="btn danger sm" data-del="1">${esc(t('btn.delete'))}</button>
      </div>`);
    wrap.appendChild(c);
    c.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
      b.disabled = true; const r = await N.smart.execute(d.id, b.dataset.act);
      toast(r.ok ? '✅ ' + d.name : 'Ошибка', r.ok ? (r.info || '') : r.error, r.ok ? 'ok' : 'err'); b.disabled = false;
    });
    c.querySelector('[data-edit]').onclick = () => editDevice(d, protocols);
    c.querySelector('[data-del]').onclick = async () => { await N.smart.delete(d.id); viewSmartHome(); };
  });
}
function editDevice(dev, protocols) {
  const isNew = !dev;
  dev = dev || { name: '', protocol: 'homeassistant', host: '', entity: '', method: 'POST' };
  const opts = protocols.map((p) => `<option value="${p.id}" ${p.id === dev.protocol ? 'selected' : ''}>${p.region === 'ru' ? '🇷🇺 ' : ''}${esc(p.name)}</option>`).join('');
  const hint = {
    homeassistant: { host: 'http://homeassistant.local:8123', entity: 'light.kitchen', sec: 'Долгоживущий токен HA' },
    mqtt: { host: 'IP брокера (1883)', entity: 'zigbee2mqtt/lamp/set', sec: 'Пароль MQTT (опц.)' },
    yandex: { host: '(не нужен)', entity: 'device-id из Яндекса', sec: 'OAuth-токен Яндекса' },
    webhook: { host: 'https://…/{action}', entity: '', sec: 'Bearer-ключ (опц.)' }
  };
  modal(`<h2>${isNew ? 'Новое устройство' : 'Устройство'} умного дома</h2>
    <label class="field"><span>Название</span><input id="sh-name" value="${esc(dev.name)}" placeholder="Свет на кухне"></label>
    <label class="field"><span>Протокол</span><select id="sh-proto">${opts}</select></label>
    <label class="field"><span>Хост / URL</span><input id="sh-host" value="${esc(dev.host || '')}" placeholder="адрес хаба/брокера/вебхука"></label>
    <label class="field"><span>Сущность / топик / id</span><input id="sh-entity" value="${esc(dev.entity || '')}" placeholder="light.kitchen / topic / device-id"></label>
    <label class="field"><span>Токен / ключ / пароль ${dev.id ? '(оставьте пустым — не менять)' : ''}</span><input id="sh-token" type="password" placeholder="секрет (шифруется)"></label>
    <p class="muted" id="sh-hint"></p>
    <div class="modal-actions">${!isNew ? '<button class="btn ghost" id="sh-testbtn">🔌 Тест</button>' : ''}<button class="btn ghost" id="sh-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="sh-save">${esc(t('btn.save'))}</button></div>`, (m, close) => {
    const updHint = () => { const h = hint[$('#sh-proto', m).value] || hint.webhook; $('#sh-hint', m).innerHTML = `Хост: <code>${esc(h.host)}</code> · Сущность: <code>${esc(h.entity)}</code> · Секрет: ${esc(h.sec)}`; };
    $('#sh-proto', m).onchange = updHint; updHint();
    $('#sh-cancel', m).onclick = close;
    $('#sh-save', m).onclick = async () => {
      const d = { ...dev, name: $('#sh-name', m).value.trim() || 'Устройство', protocol: $('#sh-proto', m).value, host: $('#sh-host', m).value.trim(), entity: $('#sh-entity', m).value.trim() };
      const tok = $('#sh-token', m).value.trim(); if (tok) d.token = tok;
      await N.smart.save(d); close(); toast('OK', 'Сохранено', 'ok'); viewSmartHome();
    };
    if ($('#sh-testbtn', m)) $('#sh-testbtn', m).onclick = async () => { const r = await N.smart.test(dev.id); toast(r.ok ? 'OK' : 'Ошибка', r.ok ? (r.info || 'отправлено') : r.error, r.ok ? 'ok' : 'err'); };
  });
}

/* ---------- Developer / Full control ---------- */
async function viewDeveloper() {
  const full = await N.store.get('settings.fullControl', false);
  const adv = await N.store.get('settings.advanced', {});
  const models = await N.installer.listModels();
  const allTools = ['run_command', 'read_file', 'write_file', 'list_dir', 'open_app', 'open_url', 'web_search', 'http_get', 'play_music', 'open_website', 'web_search_open', 'set_volume', 'change_volume', 'mute_audio', 'smart_home', 'take_screenshot', 'remote_exec'];
  const disabled = await N.store.get('settings.disabledTools', []);
  content.innerHTML = `
    <div class="view-head"><h1>🛠️ ${esc(t('nav.developer'))}</h1><p>${esc(t('dev.sub'))}</p></div>
    <div class="card" style="margin-bottom:16px">
      <div class="row between"><div><b>Режим полного контроля</b><br><small class="muted">Включает применение сырых параметров ниже и расширенные настройки</small></div>
      <label class="switch"><input type="checkbox" id="fc-on" ${full ? 'checked' : ''}><span class="slider"></span></label></div>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <h3>⚙️ Параметры генерации (Ollama)</h3>
        ${advRow('top_p', 'top_p', adv.top_p, '0.9')}
        ${advRow('top_k', 'top_k', adv.top_k, '40')}
        ${advRow('num_ctx', 'Контекст (num_ctx)', adv.num_ctx, '4096')}
        ${advRow('repeat_penalty', 'repeat_penalty', adv.repeat_penalty, '1.1')}
        ${advRow('num_predict', 'Лимит токенов (num_predict)', adv.num_predict, '-1')}
        ${advRow('seed', 'seed', adv.seed, '0')}
        ${advRow('mirostat', 'mirostat (0/1/2)', adv.mirostat, '0')}
        <label class="field"><span>stop (через запятую)</span><input id="adv-stop" value="${esc(adv.stop || '')}" placeholder="\\n\\n, ###"></label>
      </div>
      <div class="card">
        <h3>🧰 Инструменты агентов</h3>
        <p class="muted">Отключите инструменты, которые агент НЕ должен использовать.</p>
        <div style="max-height:230px;overflow:auto;margin-top:8px">
          ${allTools.map((tn) => `<label class="row between" style="padding:5px 0"><code>${esc(tn)}</code><label class="switch"><input type="checkbox" data-tool="${tn}" ${disabled.includes(tn) ? '' : 'checked'}><span class="slider"></span></label></label>`).join('')}
        </div>
      </div>
      <div class="card">
        <h3>🖥️ Сырой вызов модели</h3>
        <label class="field"><span>Модель</span><select id="raw-model">${(models.length ? models.map((m) => m.name) : ['qwen2.5:7b']).map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
        <label class="field"><span>Промпт</span><textarea id="raw-prompt" style="min-height:80px">Привет! Кратко расскажи, кто ты.</textarea></label>
        <button class="btn primary" id="raw-run">▶ Выполнить</button>
        <pre id="raw-out" style="display:none;margin-top:10px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:200px;overflow:auto;font-size:12px;white-space:pre-wrap"></pre>
      </div>
      <div class="card">
        <h3>🗄️ Редактор конфигурации</h3>
        <p class="muted">Весь config приложения в JSON. Осторожно — неверный формат сбросит изменения.</p>
        <textarea id="cfg-json" style="min-height:200px;font-family:monospace;font-size:11px"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn primary" id="cfg-save">Сохранить конфиг</button><button class="btn ghost" id="cfg-export">📤 Экспорт</button><button class="btn ghost" id="cfg-reload">Обновить</button></div>
      </div>
    </div>`;
  $('#fc-on').onchange = (e) => { N.store.set('settings.fullControl', e.target.checked); toast('Полный контроль', e.target.checked ? 'включён' : 'выключен', 'ok'); };
  const saveAdv = () => {
    const a = {};
    ['top_p', 'top_k', 'num_ctx', 'repeat_penalty', 'num_predict', 'seed', 'mirostat'].forEach((k) => { const v = $('#adv-' + k).value.trim(); if (v !== '') a[k] = v; });
    const stop = $('#adv-stop').value.trim(); if (stop) a.stop = stop;
    N.store.set('settings.advanced', a);
  };
  $$('[id^="adv-"]').forEach((i) => i.onchange = saveAdv);
  $$('[data-tool]').forEach((cb) => cb.onchange = async () => {
    const off = $$('[data-tool]').filter((x) => !x.checked).map((x) => x.dataset.tool);
    await N.store.set('settings.disabledTools', off);
  });
  $('#raw-run').onclick = async () => {
    const out = $('#raw-out'); out.style.display = 'block'; out.textContent = 'Выполнение…';
    const adv2 = await N.store.get('settings.advanced', {});
    const r = await N.ollamaRaw({ model: $('#raw-model').value, messages: [{ role: 'user', content: $('#raw-prompt').value }], options: adv2 });
    out.textContent = (r && r.content) || JSON.stringify(r);
  };
  const loadCfg = async () => { $('#cfg-json').value = JSON.stringify(await N.store.all(), null, 2); };
  loadCfg();
  $('#cfg-reload').onclick = loadCfg;
  $('#cfg-save').onclick = async () => {
    try { const obj = JSON.parse($('#cfg-json').value); const r = await N.store.replaceAll(obj); toast(r.ok ? 'OK' : 'Ошибка', r.ok ? 'Конфиг сохранён' : r.error, r.ok ? 'ok' : 'err'); }
    catch { toast('Ошибка', 'Неверный JSON', 'err'); }
  };
  $('#cfg-export').onclick = async () => downloadJson(await N.store.all(), 'mythera-config.json');
}
function advRow(id, label, val, ph) {
  return `<label class="field"><span>${esc(label)}</span><input id="adv-${id}" value="${esc(val == null ? '' : val)}" placeholder="${esc(ph)}"></label>`;
}

/* ---------- Voice ---------- */
async function viewVoice() {
  const replies = await N.store.get('settings.voiceReplies', true);
  const wakeOn = await N.store.get('settings.wakeEnabled', false);
  const wakeWord = await N.store.get('settings.wakeWord', 'Mythera');
  const ttsEngine = await N.store.get('settings.ttsEngine', 'web');
  const sttEngine = await N.store.get('settings.sttEngine', 'web');
  const sp = await N.speech.detect();
  content.innerHTML = `
    <div class="view-head"><h1>${esc(t('nav.voice'))}</h1><p>${esc(t('voice.sub'))}</p></div>
    <div class="card">
      <div class="voice-stage">
        <div class="orb ${state.voiceListening ? 'listening' : ''}" id="orb">${state.voiceListening ? '👂' : '🎙️'}</div>
        <div class="voice-transcript" id="vt">${state.voiceListening ? (wakeOn ? 'Скажите «' + esc(wakeWord) + '»…' : 'Слушаю…') : 'Нажмите, чтобы начать'}</div>
        <div class="row">
          <button class="btn primary" id="voice-toggle">${state.voiceListening ? '⏹ Остановить' : '🎤 Начать слушать'}</button>
          <button class="btn ghost" id="voice-test">🔊 Проверить голос</button>
        </div>
        <p class="voice-hint">Горячая клавиша: Ctrl+Shift+Space</p>
        <label class="row" style="gap:10px"><label class="switch"><input type="checkbox" id="vreplies" ${replies ? 'checked' : ''}><span class="slider"></span></label><span class="muted">${esc(t('set.voiceReplies'))}</span></label>
      </div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h3>🔔 ${esc(t('set.wakeEnabled'))}</h3>
        <label class="row between" style="margin:10px 0"><span>Реагировать только после имени</span><label class="switch"><input type="checkbox" id="wake-on" ${wakeOn ? 'checked' : ''}><span class="slider"></span></label></label>
        <label class="field"><span>${esc(t('set.wakeWord'))}</span><input id="wake-word" value="${esc(wakeWord)}" placeholder="Mythera"></label>
        <p class="muted">Например: «${esc(wakeWord)}, какая загрузка системы?»</p>
      </div>
      <div class="card">
        <h3>🎚️ ${esc(t('set.voiceEngine'))}</h3>
        <label class="field"><span>${esc(t('set.ttsEngine'))}</span><select id="tts-engine">
          <option value="web" ${ttsEngine === 'web' ? 'selected' : ''}>Windows Speech (быстро)</option>
          <option value="piper" ${ttsEngine === 'piper' ? 'selected' : ''}>Piper — лучше качество, оффлайн ${sp.piper.available ? '✅' : '⚠️ не настроен'}</option>
        </select></label>
        <label class="field"><span>${esc(t('set.sttEngine'))}</span><select id="stt-engine">
          <option value="web" ${sttEngine === 'web' ? 'selected' : ''}>Web Speech (быстро)</option>
          <option value="whisper" ${sttEngine === 'whisper' ? 'selected' : ''}>Faster-Whisper — точнее, оффлайн ${sp.whisper.available ? '✅' : '⚠️ не настроен'}</option>
        </select></label>
        <p class="muted">${sp.piper.available ? '' : 'Piper: ' + esc(sp.piper.hint) + '<br>'}${sp.whisper.available ? '' : 'Whisper: ' + esc(sp.whisper.hint)}</p>
        <button class="btn" id="speech-install" style="margin-top:8px">⬇️ Установить локальную речь (Piper + Faster-Whisper)</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>🎧 ${esc(t('tr2.title'))}</h3>
      <p class="muted" style="margin-bottom:8px">${esc(t('tr2.sub'))}</p>
      <div class="row" style="gap:8px"><input id="tr2-file" type="file" accept="audio/*,video/*" style="flex:1"><button class="btn primary" id="tr2-go">${esc(t('tr2.run'))}</button></div>
      <div id="tr2-out" class="muted" style="margin-top:10px;white-space:pre-wrap;font-size:13px;line-height:1.5"></div>
      <div id="tr2-actions" style="margin-top:8px;display:none"><button class="btn ghost sm" id="tr2-note">📓 ${esc(t('tr2.toNote'))}</button><button class="btn ghost sm" id="tr2-kb">📚 ${esc(t('tr2.toKb'))}</button></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>💡 Примеры команд</h3>
      <div style="margin-top:8px">
        ${['Включи Imagine Dragons на YouTube Music', 'Сделай громкость 30%', 'Выключи свет на кухне', 'Открой YouTube', 'Сделай скриншот и опиши экран', 'Какая загрузка системы?'].map(c => `<span class="tag accent">«${esc(c)}»</span>`).join('')}
      </div>
    </div>`;
  let transcript = '';
  $('#tr2-go').onclick = async () => {
    const f = $('#tr2-file').files[0]; if (!f) return toast('🎧', t('tr2.pick'), 'err');
    const out = $('#tr2-out'); out.classList.remove('muted'); out.innerHTML = '<span class="spin">⏳</span> ' + esc(t('tr2.running'));
    try {
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const r = await N.speech.transcribe(btoa(bin), f.type || 'audio/wav');
      if (r && r.ok && r.text) { transcript = r.text; out.textContent = r.text; $('#tr2-actions').style.display = ''; }
      else { out.innerHTML = `<span class="mk-down">⚠️ ${esc((r && (r.error || r.hint)) || t('tr2.fail'))}</span>`; }
    } catch (e) { out.innerHTML = `<span class="mk-down">⚠️ ${esc(e.message)}</span>`; }
  };
  $('#tr2-note').onclick = async () => { if (!transcript) return; await N.notes.save({ title: 'Транскрипция ' + new Date().toLocaleDateString(), body: transcript, tags: ['транскрипция'] }); toast('📓', t('notes.saved'), 'ok'); };
  $('#tr2-kb').onclick = async () => { if (!transcript) return; const r = await N.rag.add('kb', transcript, 'транскрипция'); toast('📚', r.ok ? 'OK' : r.error, r.ok ? 'ok' : 'err'); };
  $('#voice-toggle').onclick = toggleVoice;
  $('#voice-test').onclick = () => speakOut('Mythera voice assistant is ready.');
  $('#vreplies').onchange = (e) => N.store.set('settings.voiceReplies', e.target.checked);
  $('#wake-on').onchange = (e) => N.store.set('settings.wakeEnabled', e.target.checked);
  $('#wake-word').onchange = (e) => N.store.set('settings.wakeWord', e.target.value.trim() || 'Mythera');
  $('#tts-engine').onchange = (e) => { N.store.set('settings.ttsEngine', e.target.value); toast('TTS', e.target.value, 'ok'); };
  $('#stt-engine').onchange = (e) => { N.store.set('settings.sttEngine', e.target.value); toast('STT', e.target.value, 'ok'); };
  $('#speech-install').onclick = () => installLogModal('Установка локальной речи', () => N.tooling.installSpeech());
}

/* ---------- Бэкап / восстановление ---------- */
async function backupExport() {
  const data = await N.store.all();
  const blob = { _type: 'mythera-backup', version: 1, at: Date.now(), data };
  downloadText('mythera-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(blob, null, 2), 'application/json');
  toast('💾', t('bk.exported'), 'ok');
}
function backupImport() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let obj; try { obj = JSON.parse(await f.text()); } catch { return toast('⚠️', t('bk.bad'), 'err'); }
    const data = obj && obj._type === 'mythera-backup' ? obj.data : (obj && typeof obj === 'object' ? obj : null);
    if (!data) return toast('⚠️', t('bk.bad'), 'err');
    if (!await confirmModal(t('bk.restore'), t('bk.restoreWarn'))) return;
    await N.store.replaceAll(data);
    toast('✅', t('bk.restored'), 'ok');
    setTimeout(() => location.reload(), 800);
  };
  inp.click();
}

/* ---------- Тур по возможностям ---------- */
const TOUR_STEPS = [
  { ico: '☀️', key: 'today', view: 'today' }, { ico: '🤖', key: 'agents', view: 'agents' },
  { ico: '📓', key: 'notes', view: 'notes' }, { ico: '🔗', key: 'auto', view: 'automation' },
  { ico: '📈', key: 'markets', view: 'markets' }, { ico: '🎨', key: 'images', view: 'images' },
  { ico: '🩺', key: 'diag', view: 'diagnostics' }, { ico: '🔍', key: 'search', view: null }
];
function startTour() {
  let i = 0;
  const render = (m, close) => {
    const s = TOUR_STEPS[i];
    m.innerHTML = `<div style="text-align:center"><div style="font-size:48px">${s.ico}</div><h2>${esc(t('tour.' + s.key + '.t'))}</h2><p class="muted" style="margin:10px 0">${esc(t('tour.' + s.key + '.d'))}</p>
      <div class="row" style="justify-content:center;gap:8px;margin-top:14px">
        ${i > 0 ? `<button class="btn ghost" id="tour-prev">←</button>` : ''}
        ${s.view ? `<button class="btn ghost" id="tour-go">${esc(t('tour.goto'))}</button>` : ''}
        <button class="btn primary" id="tour-next">${i < TOUR_STEPS.length - 1 ? esc(t('tour.next')) : esc(t('tour.done'))}</button>
      </div><div class="tour-dots">${TOUR_STEPS.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div></div>`;
    const prev = $('#tour-prev', m); if (prev) prev.onclick = () => { i--; render(m, close); };
    const go = $('#tour-go', m); if (go) go.onclick = () => { close(); navigate(s.view); };
    $('#tour-next', m).onclick = () => { if (i < TOUR_STEPS.length - 1) { i++; render(m, close); } else { N.store.set('settings.tourDone', true); close(); } };
  };
  modal('<div id="tour-body"></div>', (m, close) => render(m, close));
}

/* ---------- Персонализация вида ---------- */
async function applyViewPrefs() {
  const density = await N.store.get('settings.density', 'comfortable');
  const scale = await N.store.get('settings.fontScale', 1);
  document.body.classList.toggle('compact', density === 'compact');
  document.documentElement.style.fontSize = (14 * (+scale || 1)) + 'px';
}

/* ---------- Settings ---------- */
async function viewSettings() {
  const g = (k, d) => N.store.get('settings.' + k, d);
  const s = {
    autostart: await g('autostart', false),
    minimizeToTray: await g('minimizeToTray', true),
    startMinimized: await g('startMinimized', false),
    allowShell: await g('allowShell', true),
    fullDiskAccess: await g('fullDiskAccess', false),
    notifications: await g('notifications', true),
    voiceReplies: await g('voiceReplies', true),
    voiceRate: await g('voiceRate', 1),
    autoListen: await g('autoListen', false),
    longMemory: await g('longMemory', true),
    constitutionOn: await g('constitution', true),
    appControl: await g('appControl', true),
    temperature: await g('temperature', 0.7),
    maxSteps: await g('maxSteps', 0),
    defaultModel: await g('defaultModel', ''),
    toolRouting: await g('toolRouting', false),
    modelRouting: await g('modelRouting', false),
    selfVerify: await g('selfVerify', true),
    visibleThinking: await g('visibleThinking', true),
    webAutomation: await g('webAutomation', false),
    guiAutomation: await g('guiAutomation', false),
    mcpEnabled: await g('mcpEnabled', false),
    cloudEnabled: await g('cloudEnabled', false),
    cloudProvider: await g('cloudProvider', 'openai'),
    cloudModel: await g('cloudModel', 'gpt-4o-mini'),
    cloudBaseUrl: await g('cloudBaseUrl', ''),
    operator: await g('operator', false),
    autoLearnSkills: await g('autoLearnSkills', false),
    duplexVoice: await g('duplexVoice', false),
    artifacts: await g('artifacts', true),
    quickAsk: await g('quickAsk', true),
    tradingEnabled: await g('tradingEnabled', false),
    density: await g('density', 'comfortable'),
    fontScale: await g('fontScale', 1)
  };
  const docCaps = await N.docs.capabilities();
  const cloudKey = await N.cloud.hasKey();
  const mcpServers = await N.mcp.servers();
  const info = await N.system.info();
  const theme = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' });
  const lang = getLangCode();
  const modelsDir = await N.installer.getModelsDir();
  const models = await N.installer.listModels();
  const swatches = Object.entries(ACCENTS).map(([k, a]) =>
    `<span class="theme-swatch ${theme.accent === k ? 'sel' : ''}" data-accent="${k}" title="${a.name}" style="background:linear-gradient(135deg,${a.a},${a.b})"></span>`).join('');
  const langOpts = LANGS.map((l) => `<option value="${l.code}" ${l.code === lang ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const modelOpts = `<option value="">${esc(t('set.defaultModel'))}</option>` + (models.length ? models.map((m) => `<option value="${esc(m.name)}" ${m.name === s.defaultModel ? 'selected' : ''}>${esc(m.name)}</option>`).join('') : '');

  content.innerHTML = `
    <div class="view-head"><h1>${esc(t('set.title'))}</h1><p>${esc(t('set.sub'))}</p></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>🎨 ${esc(t('set.appearance'))}</h3>
        ${toggleRow('set-light', t('set.lightTheme'), theme.mode === 'light')}
        <p class="muted" style="margin:10px 0 6px">${esc(t('set.accent'))}</p>
        <div id="accent-row">${swatches}</div>
        <label class="field" style="margin-top:14px"><span>${esc(t('set.language'))}</span><select id="set-lang">${langOpts}</select></label>
        <label class="field"><span>${esc(t('set.density'))}</span><select id="set-density">
          <option value="comfortable" ${s.density === 'comfortable' ? 'selected' : ''}>${esc(t('set.comfortable'))}</option>
          <option value="compact" ${s.density === 'compact' ? 'selected' : ''}>${esc(t('set.compact'))}</option></select></label>
        <label class="field"><span>${esc(t('set.fontSize'))}: <b id="fs-val">${Math.round(s.fontScale * 100)}%</b></span><input type="range" id="set-fontscale" min="0.85" max="1.25" step="0.05" value="${s.fontScale}"></label>
        <button class="btn ghost sm" id="set-tour" style="margin-top:6px">🎓 ${esc(t('set.tour'))}</button>
      </div>
      <div class="card">
        <h3>🚀 ${esc(t('set.launch'))}</h3>
        ${toggleRow('set-autostart', t('set.autostart'), s.autostart)}
        ${toggleRow('set-tray', t('set.tray'), s.minimizeToTray)}
        ${toggleRow('set-startmin', t('set.startMin'), s.startMinimized)}
        ${toggleRow('set-notif', t('set.notifications'), s.notifications)}
      </div>
      <div class="card">
        <h3>🔐 ${esc(t('set.security'))}</h3>
        ${toggleRow('set-shell', t('set.allowShell'), s.allowShell)}
        ${toggleRow('set-fulldisk', t('set.fullDisk'), s.fullDiskAccess)}
        <p class="muted" style="margin-top:8px">${esc(t('set.dangerNote'))}</p>
        <button class="btn ghost sm" id="set-secinfo" style="margin-top:6px">🛡️ Что именно блокируется?</button>
      </div>
      <div class="card">
        <h3>💽 ${esc(t('set.models'))}</h3>
        <label class="field"><span>${esc(t('set.modelsDir'))}</span>
          <div class="row"><input id="set-modelsdir" value="${esc(modelsDir || '')}" placeholder="${esc(t('set.defaultDisk'))}" readonly>
          <button class="btn" id="set-pickdisk">${esc(t('set.chooseDisk'))}</button></div></label>
        <div id="drives-list" class="drives-list"></div>
        <label class="field"><span>${esc(t('set.defaultModel'))}</span><select id="set-defmodel">${modelOpts}</select></label>
      </div>
      <div class="card">
        <h3>🎙️ ${esc(t('set.voice'))}</h3>
        ${toggleRow('set-vreplies', t('set.voiceReplies'), s.voiceReplies)}
        ${toggleRow('set-autolisten', t('set.autoListen'), s.autoListen)}
        ${toggleRow('set-duplex', t('set.duplexVoice'), s.duplexVoice)}
        <p class="muted" style="margin:6px 0">${esc(t('set.duplexVoiceNote'))}</p>
        <label class="field" style="margin-top:10px"><span>${esc(t('set.voiceRate'))}: <b id="rate-val">${s.voiceRate}×</b></span>
          <input type="range" id="set-rate" min="0.5" max="2" step="0.1" value="${s.voiceRate}"></label>
      </div>
      <div class="card">
        <h3>🔊 Звук и музыка</h3>
        <label class="field"><span>Громкость системы: <b id="vol-val">…</b></span><input type="range" id="set-vol" min="0" max="100" step="1" value="50"></label>
        <label class="field"><span>Музыкальный сервис по умолчанию</span><select id="set-music"></select></label>
        <div class="row"><input id="set-playtest" placeholder="например: Imagine Dragons" style="flex:1"><button class="btn" id="set-playbtn">▶ Включить</button></div>
        <p class="muted" style="margin-top:6px">Музыка открывается в браузере по умолчанию (без встроенного плеера).</p>
      </div>
      <div class="card">
        <h3>🧠 ${esc(t('set.memory'))}</h3>
        ${toggleRow('set-mem', t('set.longMemory'), s.longMemory)}
        <p class="muted" style="margin:8px 0">${esc(t('set.memNote'))}</p>
        <label class="field"><span>${esc(t('set.temp'))}: <b id="temp-val">${s.temperature}</b></span>
          <input type="range" id="set-temp" min="0" max="1.5" step="0.05" value="${s.temperature}"></label>
        <label class="field"><span>${esc(t('set.maxSteps'))}</span><input type="number" id="set-steps" min="0" max="100" value="${s.maxSteps}" placeholder="авто"></label>
      </div>
      <div class="card">
        <h3>📜 ${esc(t('set.constitution'))}</h3>
        ${toggleRow('set-const', t('set.constitution'), s.constitutionOn)}
        <p class="muted" style="margin:8px 0">${esc(t('set.constitutionNote'))}</p>
        <button class="btn ghost sm" id="set-viewconst">${esc(t('set.viewConstitution'))}</button>
      </div>
      <div class="card">
        <h3>🔗 ${esc(t('set.appControl'))}</h3>
        ${toggleRow('set-appctl', t('set.appControl'), s.appControl)}
        <p class="muted" style="margin:8px 0">${esc(t('set.appControlNote'))}</p>
      </div>
      <div class="card">
        <h3>✨ ${esc(t('set.intelligence'))}</h3>
        ${toggleRow('set-toolrouting', t('set.toolRouting'), s.toolRouting)}
        <p class="muted" style="margin:6px 0">${esc(t('set.toolRoutingNote'))}</p>
        ${toggleRow('set-modelrouting', t('set.modelRouting'), s.modelRouting)}
        <p class="muted" style="margin:6px 0">${esc(t('set.modelRoutingNote'))}</p>
        ${toggleRow('set-selfverify', t('set.selfVerify'), s.selfVerify)}
        <p class="muted" style="margin:6px 0">${esc(t('set.selfVerifyNote'))}</p>
        ${toggleRow('set-visiblethink', t('set.visibleThinking'), s.visibleThinking)}
        <p class="muted" style="margin:6px 0">${esc(t('set.visibleThinkingNote'))}</p>
        ${toggleRow('set-autolearn', t('set.autoLearn'), s.autoLearnSkills)}
        <p class="muted" style="margin:6px 0">${esc(t('set.autoLearnNote'))}</p>
        ${toggleRow('set-artifacts', t('set.artifacts'), s.artifacts)}
        <p class="muted" style="margin:6px 0">${esc(t('set.artifactsNote'))}</p>
      </div>
      <div class="card">
        <h3>🦾 ${esc(t('set.capabilities'))}</h3>
        ${toggleRow('set-webauto', t('set.webAutomation'), s.webAutomation)}
        <p class="muted" style="margin:6px 0">${esc(t('set.webAutomationNote'))}</p>
        ${toggleRow('set-guiauto', t('set.guiAutomation'), s.guiAutomation)}
        <p class="muted" style="margin:6px 0">${esc(t('set.guiAutomationNote'))}</p>
        ${toggleRow('set-operator', t('set.operator'), s.operator)}
        <p class="muted" style="margin:6px 0">${esc(t('set.operatorNote'))}</p>
        ${toggleRow('set-quickask', t('set.quickAsk'), s.quickAsk)}
        <p class="muted" style="margin:6px 0">${esc(t('set.quickAskNote'))}</p>
        ${toggleRow('set-trading', t('set.trading'), s.tradingEnabled)}
        <p class="muted" style="margin:6px 0">${esc(t('set.tradingNote'))}</p>
        <p class="muted" style="margin:10px 0 4px"><b>${esc(t('set.docs'))}</b></p>
        <p class="muted" style="margin:4px 0">${esc(t('set.docsNote'))}</p>
        <p class="muted" style="margin:4px 0;font-family:monospace;font-size:11px">PDF ${docCaps.pdftotext ? '✅' : '⚪'} · Office ${docCaps.soffice ? '✅' : '⚪'} · OCR ${docCaps.tesseract ? '✅' : '⚪'}</p>
      </div>
      <div class="card">
        <h3>🔌 ${esc(t('set.mcp'))}</h3>
        ${toggleRow('set-mcp', t('set.mcpEnabled'), s.mcpEnabled)}
        <p class="muted" style="margin:6px 0">${esc(t('set.mcpNote'))}</p>
        <div id="mcp-list" style="margin:8px 0">${mcpServers.map((m) => `<div class="row" style="justify-content:space-between;align-items:center;margin:4px 0"><span>🔧 ${esc(m.name || m.id)} <small class="muted">${esc(m.command || '')}</small></span><button class="btn ghost sm" data-mcpdel="${esc(m.id)}">✕</button></div>`).join('') || `<small class="muted">—</small>`}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <input id="mcp-name" placeholder="${esc(t('set.mcpName'))}" style="flex:1;min-width:90px">
          <input id="mcp-cmd" placeholder="${esc(t('set.mcpCmd'))}" style="flex:1;min-width:110px">
          <input id="mcp-args" placeholder="${esc(t('set.mcpArgs'))}" style="flex:2;min-width:120px">
          <button class="btn sm" id="mcp-add">${esc(t('set.mcpAdd'))}</button>
        </div>
        <button class="btn ghost sm" id="mcp-connect" style="margin-top:8px">🔌 ${esc(t('set.mcpConnect'))}</button>
        <span id="mcp-status" class="muted" style="margin-left:8px;font-size:12px"></span>
      </div>
      <div class="card">
        <h3>☁️ ${esc(t('set.cloud'))}</h3>
        ${toggleRow('set-cloud', t('set.cloudEnabled'), s.cloudEnabled)}
        <p class="muted" style="margin:6px 0">${esc(t('set.cloudNote'))}</p>
        <label class="field"><span>${esc(t('set.cloudPreset'))}</span><select id="set-cloudpreset">${CLOUD_PRESETS.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(t('set.cloudProvider'))}</span><select id="set-cloudprov">
          <option value="openai" ${s.cloudProvider === 'openai' ? 'selected' : ''}>OpenAI-совместимый</option>
          <option value="anthropic" ${s.cloudProvider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
        </select></label>
        <label class="field"><span>${esc(t('set.cloudModel'))}</span><input id="set-cloudmodel" value="${esc(s.cloudModel)}"></label>
        <label class="field"><span>${esc(t('set.cloudBaseUrl'))}</span><input id="set-cloudurl" value="${esc(s.cloudBaseUrl)}" placeholder="https://api.openai.com/v1"></label>
        <label class="field"><span>${esc(t('set.cloudKey'))}</span><input id="set-cloudkey" type="password" placeholder="${cloudKey.hasKey ? '•••••• (сохранён)' : 'sk-…'}"></label>
        <div class="row" style="gap:6px"><button class="btn sm" id="cloud-savekey">${esc(t('set.cloudSaveKey'))}</button><button class="btn ghost sm" id="cloud-test">${esc(t('set.cloudTest'))}</button><span id="cloud-status" class="muted" style="font-size:12px"></span></div>
      </div>
      <div class="card">
        <h3>💾 ${esc(t('bk.title'))}</h3>
        <p class="muted" style="margin-bottom:10px">${esc(t('bk.sub'))}</p>
        <div class="row" style="gap:6px"><button class="btn primary" id="bk-export">⬇ ${esc(t('bk.export'))}</button><button class="btn ghost" id="bk-import">⬆ ${esc(t('bk.import'))}</button></div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h3>ℹ️ ${esc(t('set.about'))}</h3>
        <p class="muted">Mythera AI Hub v${esc(info.appVersion)} · ${esc(info.platform)} ${esc(info.release)} · ${info.cpus} ${'ядер/cores'}</p>
        <p class="muted" style="margin-top:8px">${esc(t('set.aboutLocal'))}</p>
        <p style="margin-top:12px;font-weight:700;background:var(--accent-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;display:inline-block">${esc(t('set.madeBy'))} ❤️</p>
        <p class="muted" style="margin-top:6px">Sponsored by <b style="color:var(--accent)">SWAGA1ABE7</b></p>
        <div style="margin-top:14px"><button class="btn ghost" id="set-reset">${esc(t('set.reset'))}</button></div>
      </div>
    </div>`;

  bindToggle('set-autostart', async (v) => { await N.system.setAutostart(v); toast('OK', t('set.autostart'), 'ok'); });
  bindToggle('set-tray', (v) => N.store.set('settings.minimizeToTray', v));
  bindToggle('set-startmin', (v) => N.store.set('settings.startMinimized', v));
  bindToggle('set-notif', (v) => N.store.set('settings.notifications', v));
  bindToggle('set-shell', (v) => N.store.set('settings.allowShell', v));
  $('#set-secinfo').onclick = showSecurityInfo;
  bindToggle('set-fulldisk', async (v) => {
    if (v) { const ok = await confirmModal('⚠️ Полный доступ к диску', 'Агенты смогут читать и писать файлы вне песочницы (системные каталоги всё равно защищены). Включить?'); if (!ok) return viewSettings(); }
    N.store.set('settings.fullDiskAccess', v);
  });
  bindToggle('set-vreplies', (v) => N.store.set('settings.voiceReplies', v));
  bindToggle('set-autolisten', (v) => N.store.set('settings.autoListen', v));
  bindToggle('set-mem', (v) => N.store.set('settings.longMemory', v));
  bindToggle('set-const', (v) => N.store.set('settings.constitution', v));
  bindToggle('set-appctl', (v) => N.store.set('settings.appControl', v));
  // Интеллект агентов.
  bindToggle('set-toolrouting', (v) => N.store.set('settings.toolRouting', v));
  bindToggle('set-modelrouting', (v) => N.store.set('settings.modelRouting', v));
  bindToggle('set-selfverify', (v) => N.store.set('settings.selfVerify', v));
  bindToggle('set-visiblethink', (v) => N.store.set('settings.visibleThinking', v));
  bindToggle('set-autolearn', (v) => N.store.set('settings.autoLearnSkills', v));
  bindToggle('set-artifacts', (v) => { N.store.set('settings.artifacts', v); window.__artifactsOn = v; });
  bindToggle('set-duplex', (v) => N.store.set('settings.duplexVoice', v));
  bindToggle('set-quickask', (v) => N.store.set('settings.quickAsk', v));
  bindToggle('set-trading', async (v) => { if (v) { const ok = await confirmModal('💹 ' + t('set.trading'), t('set.tradingNote')); if (!ok) return viewSettings(); } N.store.set('settings.tradingEnabled', v); });
  bindToggle('set-operator', async (v) => {
    if (v) { const ok = await confirmModal('🦾 ' + t('set.operator'), t('set.operatorNote')); if (!ok) return viewSettings(); N.store.set('settings.guiAutomation', true); }
    N.store.set('settings.operator', v);
  });
  // Возможности.
  bindToggle('set-webauto', async (v) => {
    if (v) { const ok = await confirmModal('🌐 ' + t('set.webAutomation'), t('set.webAutomationNote')); if (!ok) return viewSettings(); }
    N.store.set('settings.webAutomation', v);
  });
  bindToggle('set-guiauto', async (v) => {
    if (v) { const ok = await confirmModal('🖱️ ' + t('set.guiAutomation'), t('set.guiAutomationNote')); if (!ok) return viewSettings(); }
    N.store.set('settings.guiAutomation', v);
  });
  // MCP.
  bindToggle('set-mcp', (v) => N.store.set('settings.mcpEnabled', v));
  $('#mcp-add').onclick = async () => {
    const name = $('#mcp-name').value.trim(), cmd = $('#mcp-cmd').value.trim();
    if (!cmd) return toast(t('set.mcpCmd'), '—', 'err');
    const args = $('#mcp-args').value.trim().split(/\s+/).filter(Boolean);
    await N.mcp.save({ name: name || cmd, command: cmd, args });
    viewSettings();
  };
  $$('#mcp-list [data-mcpdel]').forEach((b) => b.onclick = async () => { await N.mcp.delete(b.dataset.mcpdel); viewSettings(); });
  $('#mcp-connect').onclick = async () => {
    $('#mcp-status').textContent = '…';
    const r = await N.mcp.connect();
    const okN = r.filter((x) => !x.error).length;
    $('#mcp-status').textContent = `${t('set.mcpConnected')}: ${okN}/${r.length}`;
  };
  // Облако.
  bindToggle('set-cloud', (v) => N.store.set('settings.cloudEnabled', v));
  $('#set-cloudprov').onchange = (e) => N.store.set('settings.cloudProvider', e.target.value);
  $('#set-cloudmodel').onchange = (e) => N.store.set('settings.cloudModel', e.target.value.trim());
  $('#set-cloudurl').onchange = (e) => N.store.set('settings.cloudBaseUrl', e.target.value.trim());
  $('#set-cloudpreset').onchange = async (e) => {
    const p = CLOUD_PRESETS.find((x) => x.id === e.target.value); if (!p || !p.url) return;
    $('#set-cloudprov').value = p.provider; $('#set-cloudurl').value = p.url; $('#set-cloudmodel').value = p.model;
    await N.store.set('settings.cloudProvider', p.provider); await N.store.set('settings.cloudBaseUrl', p.url); await N.store.set('settings.cloudModel', p.model);
    toast('☁️', p.name + (p.note ? ' · ' + p.note : ''), 'ok');
  };
  $('#cloud-savekey').onclick = async () => { const k = $('#set-cloudkey').value.trim(); if (!k) return; const r = await N.cloud.setKey(k); $('#set-cloudkey').value = ''; toast('☁️', r.encrypted ? 'OK (зашифрован)' : 'OK', 'ok'); };
  $('#cloud-test').onclick = async () => { $('#cloud-status').textContent = '…'; const r = await N.cloud.test(); $('#cloud-status').textContent = r.ok ? ('✅ ' + (r.model || '')) : ('❌ ' + (r.error || '')); };
  $('#set-viewconst').onclick = showConstitution;
  $('#set-density').onchange = async (e) => { await N.store.set('settings.density', e.target.value); applyViewPrefs(); };
  $('#set-fontscale').oninput = async (e) => { $('#fs-val').textContent = Math.round(e.target.value * 100) + '%'; await N.store.set('settings.fontScale', +e.target.value); applyViewPrefs(); };
  $('#set-tour').onclick = startTour;
  $('#bk-export').onclick = backupExport;
  $('#bk-import').onclick = backupImport;
  bindToggle('set-light', async (v) => { const th = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' }); th.mode = v ? 'light' : 'dark'; await N.store.set('settings.theme', th); applyTheme(); });
  $('#set-rate').oninput = (e) => { $('#rate-val').textContent = (+e.target.value).toFixed(1) + '×'; N.store.set('settings.voiceRate', +e.target.value); };
  // Звук и музыка.
  N.audio.get().then((r) => { if (r.percent != null) { $('#set-vol').value = r.percent; $('#vol-val').textContent = r.percent + '%'; } else $('#vol-val').textContent = 'н/д'; });
  $('#set-vol').oninput = (e) => { $('#vol-val').textContent = e.target.value + '%'; };
  $('#set-vol').onchange = (e) => N.audio.set(+e.target.value);
  N.browser.musicServices().then(async (svcs) => {
    const cur = await N.store.get('settings.musicService', 'ytmusic');
    $('#set-music').innerHTML = svcs.map((s) => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  });
  $('#set-music').onchange = (e) => N.store.set('settings.musicService', e.target.value);
  $('#set-playbtn').onclick = async () => { const q = $('#set-playtest').value.trim(); if (!q) return; const r = await N.browser.play(q); toast(r.ok ? '▶ ' + r.service : 'Ошибка', q, r.ok ? 'ok' : 'err'); };
  $('#set-temp').oninput = (e) => { $('#temp-val').textContent = (+e.target.value).toFixed(2); N.store.set('settings.temperature', +e.target.value); };
  $('#set-steps').onchange = (e) => N.store.set('settings.maxSteps', +e.target.value || 0);
  $('#set-defmodel').onchange = (e) => N.store.set('settings.defaultModel', e.target.value);
  $('#set-lang').onchange = async (e) => { setLangCode(e.target.value); await N.store.set('settings.lang', e.target.value); applyStaticI18n(); syncNavTitles(); applyRail(document.body.classList.contains('rail')); viewSettings(); };
  $$('#accent-row .theme-swatch').forEach((sw) => sw.onclick = async () => {
    const th = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' });
    th.accent = sw.dataset.accent; await N.store.set('settings.theme', th); applyTheme(); viewSettings();
  });
  $('#set-pickdisk').onclick = async () => {
    const dir = await N.system.pickFolder({ title: t('set.chooseDisk') });
    if (!dir) return;
    const r = await N.installer.setModelsDir(dir);
    toast(r.ok ? 'OK' : 'Ошибка', r.note || dir, r.ok ? 'ok' : 'err');
    viewSettings();
  };
  $('#set-reset').onclick = async () => {
    if (await confirmModal(t('set.reset'), t('set.resetConfirm'))) {
      const keep = await N.agents.list();
      await N.store.set('settings', {}); await N.store.set('onboarded', true);
      toast('OK', t('set.reset'), 'ok'); applyTheme(); viewSettings();
    }
  };
  // Список дисков для быстрого выбора.
  N.system.listDrives().then((drives) => {
    const dl = $('#drives-list'); if (!dl || !drives.length) return;
    dl.innerHTML = drives.map((d) => `<button class="drive-chip" data-path="${esc(d.path)}" title="${esc(d.path)}">💽 ${esc(d.label || d.path)}${d.freeGb != null ? ` · ${d.freeGb} ГБ своб.` : ''}</button>`).join('');
    $$('.drive-chip', dl).forEach((b) => b.onclick = async () => {
      const base = b.dataset.path.replace(/[\\/]+$/, '');
      const dir = base + (b.dataset.path.includes('\\') ? '\\MytheraAI-Models' : '/MytheraAI-Models');
      const r = await N.installer.setModelsDir(dir);
      toast(r.ok ? 'OK' : 'Ошибка', r.note || dir, r.ok ? 'ok' : 'err');
      viewSettings();
    });
  });
}

function toggleRow(id, label, on) {
  return `<label class="row between" style="margin:12px 0"><span>${esc(label)}</span><label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="slider"></span></label></label>`;
}
function bindToggle(id, fn) { const e = $('#' + id); if (e) e.onchange = (ev) => fn(ev.target.checked); }

// Прозрачность безопасности: показываем РЕАЛЬНЫЕ правила блокировки команд.
async function showSecurityInfo() {
  const info = await N.system.security();
  modal(`<h2>🛡️ Как блокируются опасные команды</h2>
    <p class="muted">Главный вопрос доверия к агенту, который может выполнять команды. Защита многоуровневая:</p>
    <ol style="margin:10px 0 14px 18px;font-size:13px;line-height:1.7">
      <li><b>Песочница файлов:</b> по умолчанию агент пишет только в <code>${esc(info.sandbox.workspace)}</code>. Выход за её пределы блокируется (если не включён полный доступ).</li>
      <li><b>Защищённые каталоги:</b> запись в системные папки запрещена ВСЕГДА, даже при полном доступе.</li>
      <li><b>Фильтр команд:</b> каждая команда проверяется регулярными выражениями ниже ещё ДО запуска. Совпадение → команда не выполняется.</li>
      <li><b>Выключатель:</b> выполнение команд можно отключить целиком (сейчас: ${info.sandbox.allowShell ? 'включено' : 'выключено'}).</li>
    </ol>
    <p class="muted">Заблокированные шаблоны (regex, ${info.patterns.length}):</p>
    <div style="max-height:160px;overflow:auto;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px;font-family:monospace;font-size:11px">${info.patterns.map((p) => esc(p)).join('<br>')}</div>
    <p class="muted" style="margin-top:12px">Проверьте сами — введите команду:</p>
    <div class="row"><input id="sec-test" placeholder="например: rm -rf /"><button class="btn" id="sec-run">Проверить</button></div>
    <div id="sec-res" style="margin-top:8px"></div>
    <div class="modal-actions"><button class="btn primary" id="sec-close">${esc(t('btn.close'))}</button></div>`, (m, close) => {
    $('#sec-close', m).onclick = close;
    const run = async () => {
      const r = await N.system.testCommand($('#sec-test', m).value);
      $('#sec-res', m).innerHTML = r.command ? `<div class="card" style="border-color:${r.blocked ? 'var(--danger)' : 'var(--ok)'}">${r.blocked ? '🚫 ЗАБЛОКИРОВАНО' : '✅ Разрешено'}${r.reason ? ' — ' + esc(r.reason) : ''}</div>` : '';
    };
    $('#sec-run', m).onclick = run;
    $('#sec-test', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  });
}

// Модальное окно установки с живым логом.
function installLogModal(title, runner) {
  modal(`<h2>${esc(title)}</h2>
    <pre id="install-log" style="margin:10px 0;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:320px;overflow:auto;font-size:11px;font-family:Consolas,monospace;white-space:pre-wrap">Запуск…\n</pre>
    <div class="modal-actions"><button class="btn primary" id="il-close">${esc(t('btn.close'))}</button></div>`, async (m, close) => {
    $('#il-close', m).onclick = close;
    window.__installLog = $('#install-log', m);
    try { const r = await runner(); const log = window.__installLog; if (log) log.textContent += '\n' + (r && r.ok ? '✅ ' + (r.note || 'Готово') : '⚠️ ' + ((r && r.error) || 'Не удалось')); }
    catch (e) { if (window.__installLog) window.__installLog.textContent += '\nОшибка: ' + e.message; }
  });
}
N.on('tooling:log', ({ line }) => { const log = window.__installLog; if (log) { log.textContent += line; log.scrollTop = log.scrollHeight; } });

// Конституция агентов — прозрачность характера и принципов.
async function showConstitution() {
  const text = await N.constitution();
  modal(`<h2>📜 ${esc(t('set.constitution'))}</h2>
    <p class="muted">${esc(t('set.constitutionNote'))}</p>
    <pre style="margin-top:10px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:14px;max-height:55vh;overflow:auto;font-size:12px;line-height:1.6;white-space:pre-wrap;font-family:inherit">${esc(text)}</pre>
    <div class="modal-actions"><button class="btn primary" id="const-close">${esc(t('btn.close'))}</button></div>`, (m, close) => {
    $('#const-close', m).onclick = close;
  });
}

// Простое подтверждение (да/нет).
function confirmModal(title, text) {
  return new Promise((resolve) => {
    let done = false;
    const back = modal(`<h2>${esc(title)}</h2><p class="muted" style="margin:8px 0">${esc(text)}</p>
      <div class="modal-actions"><button class="btn ghost" id="cf-no">${esc(t('btn.cancel'))}</button><button class="btn primary" id="cf-yes">OK</button></div>`,
      (m, close) => {
        $('#cf-no', m).onclick = () => { done = true; close(); resolve(false); };
        $('#cf-yes', m).onclick = () => { done = true; close(); resolve(true); };
      });
    back.addEventListener('click', (e) => { if (e.target === back && !done) resolve(false); });
  });
}

function promptModal(title, placeholder, value) {
  return new Promise((resolve) => {
    let done = false;
    const back = modal(`<h2>${esc(title)}</h2>
      <input id="pm-in" class="pm-input" placeholder="${esc(placeholder || '')}" value="${esc(value || '')}" style="width:100%;margin:10px 0">
      <div class="modal-actions"><button class="btn ghost" id="pm-no">${esc(t('btn.cancel'))}</button><button class="btn primary" id="pm-yes">OK</button></div>`,
      (m, close) => {
        const inp = $('#pm-in', m); inp && inp.focus();
        const ok = () => { done = true; const v = inp ? inp.value.trim() : ''; close(); resolve(v || null); };
        $('#pm-yes', m).onclick = ok;
        $('#pm-no', m).onclick = () => { done = true; close(); resolve(null); };
        inp && inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      });
    back.addEventListener('click', (e) => { if (e.target === back && !done) resolve(null); });
  });
}

/* ================= VOICE (Web Speech API + wake-word) ================= */
const VOICE_LANG = () => ({ ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', es: 'es-ES', de: 'de-DE', zh: 'zh-CN' }[getLangCode()] || 'en-US');
let recognition = null;
let recognitionRunning = false;   // реально ли сейчас запущено распознавание
let voiceManualStop = false;      // пользователь остановил вручную → не авто-перезапускать
function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = VOICE_LANG();
  r.continuous = true; // непрерывно — нужно для wake-word
  r.interimResults = true;
  r.onstart = () => { recognitionRunning = true; };
  r.onresult = (e) => {
    let interim = '', finalT = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalT += tr; else interim += tr;
    }
    // Barge-in: пользователь заговорил поверх ответа — прерываем речь.
    if (ttsActive && (interim.trim().length > 1 || finalT.trim())) speakInterrupt();
    const vt = $('#vt'); if (vt) vt.textContent = finalT || interim || '…';
    if (finalT.trim()) handleVoiceCommand(finalT.trim());
  };
  r.onerror = () => { /* 'no-speech'/'aborted' — пусть onend решит про перезапуск */ };
  r.onend = () => {
    recognitionRunning = false;
    // Авто-перезапуск ТОЛЬКО если всё ещё слушаем и не остановили вручную.
    if (state.voiceListening && !voiceManualStop) {
      setTimeout(() => { if (state.voiceListening && !recognitionRunning) { try { r.start(); } catch {} } }, 350);
    }
  };
  return r;
}

function toggleVoice() {
  state.voiceListening ? stopVoice() : startVoice();
}
function startVoice() {
  if (state.voiceListening) { updateVoiceUI(); return; } // уже слушаем — не дёргаем повторно
  if (!recognition) recognition = setupRecognition();
  if (!recognition) { toast('Недоступно', 'Распознавание речи не поддерживается', 'err'); return; }
  state.voiceListening = true;
  voiceManualStop = false;
  N.voice.start();
  if (!recognitionRunning) { try { recognition.start(); } catch {} }
  updateVoiceUI();
}
function stopVoice() {
  if (!state.voiceListening) { updateVoiceUI(); return; }
  state.voiceListening = false;
  voiceManualStop = true;
  N.voice.stop();
  if (recognition && recognitionRunning) { try { recognition.stop(); } catch {} }
  updateVoiceUI();
}
function updateVoiceUI() {
  $('#voice-fab').classList.toggle('active', state.voiceListening);
  const orb = $('#orb'); if (orb) { orb.classList.toggle('listening', state.voiceListening); orb.textContent = state.voiceListening ? '👂' : '🎙️'; }
  const tg = $('#voice-toggle'); if (tg) tg.textContent = state.voiceListening ? '⏹ Остановить' : '🎤 Начать слушать';
  const vt = $('#vt'); if (vt && !state.voiceListening) vt.textContent = 'Нажмите, чтобы начать';
}

async function handleVoiceCommand(rawText) {
  let text = rawText.trim();
  // Активация по имени: реагируем только если фраза начинается с «имени».
  const wakeOn = await N.store.get('settings.wakeEnabled', false);
  if (wakeOn) {
    const wake = (await N.store.get('settings.wakeWord', 'Mythera')).toLowerCase();
    const low = text.toLowerCase();
    const idx = low.indexOf(wake);
    if (idx === -1 || idx > 12) { const vt = $('#vt'); if (vt) vt.textContent = '😴 жду «' + wake + '»…'; return; }
    // Убираем имя и возможную запятую из начала команды.
    text = text.slice(idx + wake.length).replace(/^[\s,.:!—-]+/, '').trim();
    if (!text) { const vt = $('#vt'); if (vt) vt.textContent = '👂 да?'; return; }
  }
  const vt = $('#vt'); if (vt) vt.textContent = '💬 ' + text;
  N.voice.reportCommand(text);
  toast('Команда', text);
}

let ttsActive = false;        // сейчас говорит TTS (для barge-in в дуплексе)
let currentAudio = null;      // текущий Piper-Audio, чтобы прервать
// Прервать речь (barge-in): пользователь заговорил поверх ответа.
function speakInterrupt() {
  ttsActive = false;
  try { if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; } } catch {}
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch {}
}
// После завершения речи — продолжаем слушать (в дуплексе всегда, иначе по autoListen).
async function afterSpeak() {
  ttsActive = false;
  const duplex = await N.store.get('settings.duplexVoice', false);
  const cont = duplex || await N.store.get('settings.autoListen', false);
  if (state.voiceListening && !recognitionRunning && cont) { try { recognition && recognition.start(); } catch {} }
}
async function speakOut(text) {
  // Piper (локальный TTS) — если включён и настроен; иначе Web Speech API.
  const engine = await N.store.get('settings.ttsEngine', 'web');
  ttsActive = true;
  if (engine === 'piper') {
    try {
      const r = await N.speech.synthesize(text);
      if (r.ok && r.file) {
        const audio = new Audio('file://' + r.file);
        currentAudio = audio;
        audio.playbackRate = await N.store.get('settings.voiceRate', 1);
        audio.onended = () => { currentAudio = null; afterSpeak(); };
        audio.play(); return;
      }
    } catch {}
  }
  if (!('speechSynthesis' in window)) { ttsActive = false; return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = VOICE_LANG();
  u.rate = await N.store.get('settings.voiceRate', 1);
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith(u.lang.slice(0, 2)));
  if (v) u.voice = v;
  u.onend = () => afterSpeak();
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* Плавающая кнопка голоса */
$('#voice-fab').onclick = () => { if (state.view !== 'voice') navigate('voice'); toggleVoice(); };

/* ---------- Оператор ПК (computer-use) ---------- */
let operatorSession = null;
async function viewOperator() {
  const on = await N.store.get('settings.operator', false);
  const gerald = await N.store.get('settings.guiAutomation', false);
  content.innerHTML = `
    <div class="view-head"><h1>🦾 ${esc(t('op.title'))}</h1><p>${esc(t('op.sub'))}</p></div>
    ${on ? '' : `<div class="card warn-card">⚠️ ${esc(t('op.disabled'))} <button class="btn sm" id="op-enable">${esc(t('op.enable'))}</button></div>`}
    ${gerald ? '' : `<div class="card warn-card">🖱️ ${esc(t('op.needgui'))}</div>`}
    <div class="card">
      <label class="field"><span>${esc(t('op.goal'))}</span>
        <textarea id="op-goal" rows="2" placeholder="${esc(t('op.goalPh'))}"></textarea></label>
      <div class="row" style="gap:8px;align-items:center">
        <label class="field" style="max-width:140px"><span>${esc(t('op.maxSteps'))}</span><input type="number" id="op-steps" value="15" min="3" max="40"></label>
        <button class="btn primary" id="op-run" ${on ? '' : 'disabled'}>▶ ${esc(t('op.run'))}</button>
        <button class="btn ghost" id="op-stop" style="display:none">⏹ ${esc(t('op.stop'))}</button>
      </div>
      <p class="muted" style="margin-top:8px">${esc(t('op.note'))}</p>
    </div>
    <div class="card" id="op-log-card" style="display:none">
      <h3>📡 ${esc(t('op.live'))}</h3>
      <div id="op-log" class="op-log"></div>
    </div>`;
  if ($('#op-enable')) $('#op-enable').onclick = async () => { await N.store.set('settings.operator', true); await N.store.set('settings.guiAutomation', true); viewOperator(); };
  $('#op-run').onclick = async () => {
    const goal = $('#op-goal').value.trim(); if (!goal) return;
    const maxSteps = +$('#op-steps').value || 15;
    operatorSession = 'op-' + Date.now();
    $('#op-log').innerHTML = ''; $('#op-log-card').style.display = '';
    $('#op-run').style.display = 'none'; $('#op-stop').style.display = '';
    opLog('goal', '🎯 ' + goal);
    await N.operator.run({ sessionId: operatorSession, goal, maxSteps });
  };
  $('#op-stop').onclick = () => { if (operatorSession) N.operator.stop(operatorSession); };
}
function opLog(kind, text) {
  const box = $('#op-log'); if (!box) return;
  const d = el('div', 'op-line op-' + kind);
  d.textContent = text;
  box.appendChild(d); box.scrollTop = box.scrollHeight;
}
N.on('operator:frame', ({ step, width, height }) => opLog('frame', `👁 ${t('op.step')} ${step + 1}${width ? ` · ${width}×${height}` : ''}`));
N.on('operator:think', () => {});
N.on('operator:action', ({ name, args }) => opLog('action', `⚙️ ${name}(${JSON.stringify(args || {}).slice(0, 80)})`));
N.on('operator:result', ({ name, result }) => opLog('result', `↳ ${String(result).slice(0, 120)}`));
N.on('operator:warn', ({ message }) => opLog('warn', '⚠️ ' + message));
N.on('operator:done', ({ ok, summary, error }) => {
  opLog('done', (ok ? '✅ ' : '❌ ') + (summary || error || ''));
  const r = $('#op-run'), s = $('#op-stop'); if (r) r.style.display = ''; if (s) s.style.display = 'none';
  operatorSession = null;
  if (summary) toast('🦾 ' + t('op.title'), String(summary).slice(0, 80), ok ? 'ok' : 'err');
});

/* ---------- Центр уведомлений ---------- */
const NOTIF_ICON = { watcher: '👁', flow: '🪄', trade: '💹', alert: '🔔', skill: '🎓', error: '⚠️', info: 'ℹ️' };
async function updateBellBadge() {
  const n = await N.notif.unread();
  const b = $('#bell-badge'); if (!b) return;
  if (n > 0) { b.textContent = n > 99 ? '99+' : n; b.style.display = ''; } else b.style.display = 'none';
}
async function toggleNotifPanel() {
  const p = $('#notif-panel'); if (!p) return;
  if (p.style.display === 'none' || !p.style.display) { await renderNotifPanel(); p.style.display = 'flex'; await N.notif.markAllRead(); updateBellBadge(); }
  else p.style.display = 'none';
}
async function renderNotifPanel() {
  const box = $('#notif-list'); if (!box) return;
  const items = (await N.notif.list()).slice(-60).reverse();
  box.innerHTML = items.length ? items.map((nt) => `
    <div class="notif-item ${nt.read ? '' : 'unread'}">
      <span class="notif-ico">${NOTIF_ICON[nt.kind] || 'ℹ️'}</span>
      <div class="notif-body"><b>${esc(nt.title)}</b><div class="notif-msg">${esc(nt.message)}</div><div class="notif-time">${new Date(nt.at).toLocaleString()}</div></div>
    </div>`).join('') : `<p class="muted" style="padding:14px">${esc(t('notif.empty'))}</p>`;
}
N.on('notif:new', ({ unread }) => {
  const b = $('#bell-badge'); if (b) { if (unread > 0) { b.textContent = unread > 99 ? '99+' : unread; b.style.display = ''; } }
  if ($('#notif-panel') && $('#notif-panel').style.display === 'flex') renderNotifPanel();
});

/* ---------- Торговля: брокер (Tinkoff Invest) + безопасная автоторговля ---------- */
async function viewTrading() {
  const c = await N.trade.cfg();
  const live = c.env === 'live';
  content.innerHTML = `
    <div class="view-head"><h1>💹 ${esc(t('tr.title'))}</h1><p>${esc(t('tr.sub'))}</p></div>
    <div class="card ${live ? 'tr-live' : 'tr-safe'}">
      <b>${live ? '🔴 ' + esc(t('tr.liveMode')) : '🟢 ' + esc(t('tr.sandboxMode'))}</b>
      <span class="muted" style="margin-left:8px">${c.dryRun ? '· ' + esc(t('tr.dryOn')) : '· ' + esc(t('tr.dryOff'))}</span>
      <p class="muted" style="margin-top:6px">${esc(t('tr.disclaimer'))}</p>
    </div>
    <div class="card" id="cp-card"><h3>🧭 ${esc(t('cp.title'))}</h3><div id="cp-body"></div></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>🔌 ${esc(t('tr.connection'))}</h3>
        <label class="field"><span>${esc(t('tr.env'))}</span><select id="tr-env">
          <option value="sandbox" ${!live ? 'selected' : ''}>🟢 ${esc(t('tr.sandbox'))}</option>
          <option value="live" ${live ? 'selected' : ''}>🔴 ${esc(t('tr.live'))}</option></select></label>
        <label class="field"><span>${esc(t('tr.token'))}</span><input id="tr-token" type="password" placeholder="${c.hasToken ? '•••••• (сохранён)' : 't.xxxxxxxx'}"></label>
        <div class="row" style="gap:6px"><button class="btn sm" id="tr-savetok">${esc(t('tr.saveToken'))}</button><button class="btn ghost sm" id="tr-test">${esc(t('tr.test'))}</button></div>
        <div id="tr-accs" style="margin-top:10px"></div>
        <p class="muted" style="margin-top:8px;font-size:11px">${esc(t('tr.tokenHint'))}</p>
      </div>
      <div class="card">
        <h3>🛡️ ${esc(t('tr.safety'))}</h3>
        ${toggleRow('tr-dry', t('tr.dryRun'), c.dryRun)}
        ${toggleRow('tr-confirm', t('tr.confirmEach'), c.confirmEveryOrder)}
        ${toggleRow('tr-auto', t('tr.autoTrade'), c.autoTrade)}
        <p class="muted" style="margin:4px 0 10px;font-size:11px">${esc(t('tr.autoNote'))}</p>
        <label class="field"><span>${esc(t('tr.maxOrder'))}</span><input type="number" id="tr-maxval" value="${esc(c.maxOrderValue)}"></label>
        <div class="row" style="gap:8px">
          <label class="field"><span>${esc(t('tr.maxDaily'))}</span><input type="number" id="tr-maxday" value="${esc(c.maxDailyOrders)}"></label>
          <label class="field"><span>${esc(t('tr.maxLoss'))}</span><input type="number" id="tr-maxloss" value="${esc(c.maxDailyLossPct)}"></label>
        </div>
        <label class="field"><span>${esc(t('tr.whitelist'))}</span><input id="tr-wl" value="${esc((c.whitelist || []).join(', '))}" placeholder="AAPL, SBER, ..."></label>
        <button class="btn danger" id="tr-panic" style="margin-top:6px">🛑 ${esc(t('tr.panic'))}</button>
      </div>
      <div class="card">
        <h3>📊 ${esc(t('tr.portfolio'))}</h3>
        <button class="btn ghost sm" id="tr-loadpf">↻ ${esc(t('tr.loadPf'))}</button>
        <div id="tr-pf" style="margin-top:10px" class="muted">${esc(t('tr.pfHint'))}</div>
      </div>
      <div class="card">
        <h3>🧾 ${esc(t('tr.order'))}</h3>
        <label class="field"><span>${esc(t('tr.instrument'))}</span><div class="row"><input id="tr-tkr" placeholder="AAPL / SBER"><button class="btn ghost" id="tr-find">🔍</button></div></label>
        <div id="tr-found" class="muted" style="font-size:12px;margin:4px 0"></div>
        <div class="row" style="gap:8px">
          <label class="field"><span>${esc(t('tr.direction'))}</span><select id="tr-dir"><option value="buy">🟢 ${esc(t('tr.buy'))}</option><option value="sell">🔴 ${esc(t('tr.sell'))}</option></select></label>
          <label class="field"><span>${esc(t('tr.lots'))}</span><input type="number" id="tr-lots" value="1" min="1"></label>
          <label class="field"><span>${esc(t('tr.type'))}</span><select id="tr-otype"><option value="market">${esc(t('tr.market'))}</option><option value="limit">${esc(t('tr.limit'))}</option></select></label>
        </div>
        <label class="field tr-lim" style="display:none"><span>${esc(t('tr.price'))}</span><input type="number" id="tr-price" step="0.01"></label>
        <button class="btn primary" id="tr-place" style="margin-top:6px">${esc(t('tr.place'))}</button>
      </div>
      <div class="card" id="bot-card"><h3>🤖 ${esc(t('bot.title'))}</h3><div id="bot-body"></div></div>
      <div class="card" id="paper-card"><h3>🧪 ${esc(t('bot.paper'))}</h3><div id="paper-body"></div></div>
      <div class="card" id="pa-card" style="grid-column:1/-1"><div class="row between"><h3>📊 ${esc(t('pa.title'))}</h3><span><button class="btn ghost sm" id="pa-rebal">⚖️ ${esc(t('rb.title'))}</button><button class="btn ghost sm" id="pa-refresh">↻</button></span></div><div id="pa-body" class="muted"></div></div>
      <div class="card" id="dca-card">
        <h3>💵 ${esc(t('dca.title'))}</h3>
        <div class="row" style="gap:6px;flex-wrap:wrap;align-items:flex-end">
          <label class="field" style="max-width:110px"><span>${esc(t('al.ticker'))}</span><input id="dca-sym" placeholder="AAPL"></label>
          <label class="field" style="max-width:110px"><span>${esc(t('dca.amount'))}</span><input id="dca-amt" type="number" value="100"></label>
          <label class="field" style="max-width:120px"><span>${esc(t('dca.every'))}</span><input id="dca-hrs" type="number" value="168"></label>
          <button class="btn" id="dca-add">＋</button>
        </div>
        <div id="dca-list" style="margin-top:8px"></div>
      </div>
      <div class="card" id="corr-card"><div class="row between"><h3>🧬 ${esc(t('corr.title'))}</h3><button class="btn ghost sm" id="corr-run">↻</button></div><div id="corr-body" class="muted">${esc(t('corr.hint'))}</div></div>
      <div class="card" id="jr-card" style="grid-column:1/-1">
        <div class="row between"><h3>📒 ${esc(t('jr.title'))}</h3><span><button class="btn ghost sm" id="jr-sync">⬇ ${esc(t('jr.sync'))}</button><button class="btn ghost sm" id="jr-review">🤖 ${esc(t('jr.review'))}</button></span></div>
        <div id="jr-stats" class="muted" style="margin:6px 0"></div>
        <div id="jr-ai" class="mk-ai"></div>
        <div id="jr-list"></div>
      </div>
      <div class="card">
        <h3>🧮 ${esc(t('rk.title'))}</h3>
        <div class="row" style="gap:8px"><label class="field"><span>${esc(t('rk.account'))}</span><input id="rk-acc" type="number" value="10000"></label><label class="field"><span>${esc(t('rk.risk'))}</span><input id="rk-risk" type="number" value="1"></label></div>
        <div class="row" style="gap:8px"><label class="field"><span>${esc(t('rk.entry'))}</span><input id="rk-entry" type="number" step="0.01"></label><label class="field"><span>${esc(t('rk.stop'))}</span><input id="rk-stop" type="number" step="0.01"></label></div>
        <div id="rk-out" class="muted" style="margin-top:8px"></div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h3>📜 ${esc(t('tr.audit'))}</h3>
        <div id="tr-log" class="tr-log"></div>
      </div>
    </div>`;
  renderCopilot();
  renderBotCard();
  renderPaperCard();
  renderPortfolioAnalytics();
  renderDca();
  renderJournal();
  $('#pa-refresh').onclick = renderPortfolioAnalytics;
  $('#pa-rebal').onclick = rebalanceModal;
  $('#dca-add').onclick = async () => { const sym = $('#dca-sym').value.trim(); if (!sym) return; await N.dca.save({ symbol: sym, amount: +$('#dca-amt').value || 100, everyHours: +$('#dca-hrs').value || 168, mode: 'paper' }); $('#dca-sym').value = ''; renderDca(); };
  $('#corr-run').onclick = renderCorrelation;
  $('#jr-sync').onclick = async () => { const r = await N.journal.syncPaper(); toast('📒', t('jr.synced') + ': ' + r.added, 'ok'); renderJournal(); };
  $('#jr-review').onclick = async () => { const ai = $('#jr-ai'); ai.innerHTML = '<span class="spin">⏳</span> ' + esc(t('jr.reviewing')); const r = await N.journal.review(); ai.textContent = r.ok ? r.text : ('⚠️ ' + r.error); };
  const rk = () => {
    const acc = +$('#rk-acc').value, risk = +$('#rk-risk').value, e = +$('#rk-entry').value, s = +$('#rk-stop').value;
    const out = $('#rk-out'); if (!acc || !risk || !e || !s || e === s) { out.textContent = t('rk.hint'); return; }
    const riskAmt = acc * risk / 100; const perShare = Math.abs(e - s); const shares = Math.floor(riskAmt / perShare);
    out.innerHTML = `<b>${esc(t('rk.size'))}: ${shares}</b> ${esc(t('rk.shares'))} · ${esc(t('rk.exposure'))} ${(shares * e).toFixed(0)} · ${esc(t('rk.atRisk'))} ${riskAmt.toFixed(0)} (${(shares * perShare).toFixed(0)})`;
  };
  ['#rk-acc', '#rk-risk', '#rk-entry', '#rk-stop'].forEach((s) => { const el2 = $(s); if (el2) el2.oninput = rk; });

  let foundInstrument = null;
  // Переключение окружения с предупреждением для live.
  $('#tr-env').onchange = async (e) => {
    if (e.target.value === 'live') {
      const ok = await confirmModal('🔴 ' + t('tr.live'), t('tr.liveWarn'));
      if (!ok) { e.target.value = 'sandbox'; return; }
    }
    await N.trade.setCfg({ env: e.target.value }); viewTrading();
  };
  $('#tr-savetok').onclick = async () => { const tok = $('#tr-token').value.trim(); if (!tok) return; const r = await N.trade.setToken(tok); $('#tr-token').value = ''; toast('🔑', r.encrypted ? 'OK (зашифрован)' : 'OK', 'ok'); };
  $('#tr-test').onclick = async () => {
    const r = await N.trade.test(); const box = $('#tr-accs');
    if (!r.ok) { box.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
    box.innerHTML = `<label class="field"><span>${esc(t('tr.account'))}</span><select id="tr-acc">${r.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.id)})</option>`).join('')}</select></label>`;
    const sel = $('#tr-acc'); if (sel) sel.onchange = () => N.trade.setCfg({ accountId: sel.value });
    if (r.accounts[0]) N.trade.setCfg({ accountId: r.accounts[0].id });
    toast('✅', t('tr.connected') + ': ' + r.accounts.length, 'ok');
  };
  bindToggle('tr-dry', async (v) => { if (!v) { const ok = await confirmModal('⚠️ ' + t('tr.dryRun'), t('tr.dryOffWarn')); if (!ok) return viewTrading(); } N.trade.setCfg({ dryRun: v }); });
  bindToggle('tr-confirm', async (v) => { if (!v) { const ok = await confirmModal('⚠️ ' + t('tr.confirmEach'), t('tr.confirmOffWarn')); if (!ok) return viewTrading(); } N.trade.setCfg({ confirmEveryOrder: v }); });
  bindToggle('tr-auto', async (v) => { if (v) { const ok = await confirmModal('⚠️ ' + t('tr.autoTrade'), t('tr.autoWarn')); if (!ok) return viewTrading(); } N.trade.setCfg({ autoTrade: v }); });
  $('#tr-maxval').onchange = (e) => N.trade.setCfg({ maxOrderValue: +e.target.value || 0 });
  $('#tr-maxday').onchange = (e) => N.trade.setCfg({ maxDailyOrders: +e.target.value || 0 });
  $('#tr-maxloss').onchange = (e) => N.trade.setCfg({ maxDailyLossPct: +e.target.value || 0 });
  $('#tr-wl').onchange = (e) => N.trade.setCfg({ whitelist: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) });
  $('#tr-panic').onclick = async () => { if (await confirmModal('🛑 ' + t('tr.panic'), t('tr.panicConfirm'))) { const r = await N.trade.panic(); toast('🛑', t('tr.panicDone') + ': ' + r.cancelled, 'ok'); viewTrading(); } };
  $('#tr-loadpf').onclick = async () => {
    const pf = $('#tr-pf'); pf.textContent = '⏳…';
    const r = await N.trade.portfolio();
    if (!r.ok) { pf.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
    pf.innerHTML = `<b>${esc(t('tr.total'))}: ${r.total.toFixed(2)}</b>` + (r.positions.length ? '<table class="tr-pf-tbl"><tr><th>Тикер</th><th>Кол-во</th><th>Ср.цена</th><th>Тек.</th><th>Дох.</th></tr>' + r.positions.map((p) => `<tr><td>${esc(p.ticker || p.figi)}</td><td>${p.quantity}</td><td>${p.avgPrice.toFixed(2)}</td><td>${p.curPrice.toFixed(2)}</td><td class="${p.yield >= 0 ? 'mk-up' : 'mk-down'}">${p.yield.toFixed(2)}</td></tr>`).join('') + '</table>' : `<p class="muted">${esc(t('tr.noPos'))}</p>`);
  };
  $('#tr-otype').onchange = (e) => { $('.tr-lim').style.display = e.target.value === 'limit' ? '' : 'none'; };
  $('#tr-find').onclick = async () => {
    const q = $('#tr-tkr').value.trim(); if (!q) return;
    const r = await N.trade.find(q); const box = $('#tr-found');
    if (!r.ok || !r.instruments.length) { box.innerHTML = `<span class="mk-down">не найдено</span>`; foundInstrument = null; return; }
    foundInstrument = r.instruments[0];
    box.innerHTML = `✅ ${esc(foundInstrument.name)} (${esc(foundInstrument.ticker)}, ${esc(foundInstrument.type)}, лот ${foundInstrument.lot})`;
  };
  $('#tr-place').onclick = async () => {
    if (!foundInstrument) { toast(t('tr.instrument'), 'Сначала найдите инструмент', 'err'); return; }
    const o = { figi: foundInstrument.figi, ticker: foundInstrument.ticker, lotSize: foundInstrument.lot, direction: $('#tr-dir').value, lots: +$('#tr-lots').value || 1, orderType: $('#tr-otype').value };
    if (o.orderType === 'limit') o.price = +$('#tr-price').value || null;
    const r = await N.trade.order(o);
    if (r.blocked) toast('🛡️ ' + t('tr.blocked'), r.error, 'err');
    else if (r.pending) toast('⏳', t('tr.pendingConfirm'), 'ok');
    else if (r.ok) toast('✅', r.message, 'ok');
    else toast('⚠️', r.error || 'ошибка', 'err');
  };
  renderTradeLog();
}

// ИИ-режим торговли.
async function renderBotCard() {
  const box = $('#bot-body'); if (!box) return;
  const c = await N.bot.cfg();
  const strats = await N.backtest.strategies();
  const safe = c.brokerSafe;
  box.innerHTML = `
    ${toggleRow('bot-enable', t('bot.enable'), c.enabled)}
    <p class="muted" style="font-size:12px;margin:4px 0">${esc(t('bot.profile'))}:</p>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${[['aggressive', '⚡', t('bot.aggressive')], ['moderate', '⚖️', t('bot.moderate')], ['longterm', '🏔️', t('bot.longterm')]].map(([id, ic, lbl]) => `<button class="btn ${c.profile === id ? 'primary' : 'ghost'} sm" data-prof="${id}">${ic} ${esc(lbl)}</button>`).join('')}
    </div>
    <div class="row" style="gap:8px">
      <label class="field"><span>${esc(t('bot.mode'))}</span><select id="bot-mode"><option value="paper" ${c.mode === 'paper' ? 'selected' : ''}>🧪 ${esc(t('bot.modePaper'))}</option><option value="broker" ${c.mode === 'broker' ? 'selected' : ''}>💹 ${esc(t('bot.modeBroker'))}</option></select></label>
      <label class="field"><span>${esc(t('bot.strategy'))}</span><select id="bot-strat">${strats.map((s) => `<option value="${s.id}" ${s.id === c.strategy ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    </div>
    <div class="row" style="gap:8px">
      <label class="field" style="max-width:100px"><span>${esc(t('bot.qty'))}</span><input id="bot-qty" type="number" value="${c.qty}"></label>
      <label class="field" style="max-width:130px"><span>${esc(t('bot.every'))}</span><input id="bot-int" type="number" value="${c.intervalMin}"></label>
      <label class="field" style="max-width:100px"><span>${esc(t('bot.candle'))}</span><select id="bot-candle"><option value="1d" ${c.interval === '1d' ? 'selected' : ''}>1д</option><option value="1h" ${c.interval === '1h' ? 'selected' : ''}>1ч</option></select></label>
    </div>
    <label class="field"><span>${esc(t('bot.symbols'))}</span><input id="bot-syms" value="${esc(c.symbols.join(', '))}" placeholder="AAPL, BTC-USD"></label>
    <div class="row" style="gap:8px">
      <label class="field" style="max-width:150px"><span>${esc(t('bot.mtf'))}</span><select id="bot-mtf"><option value="" ${!c.confirmTf ? 'selected' : ''}>${esc(t('bot.mtfOff'))}</option><option value="1d" ${c.confirmTf === '1d' ? 'selected' : ''}>1д</option><option value="1wk" ${c.confirmTf === '1wk' ? 'selected' : ''}>1нед</option></select></label>
    </div>
    <div class="row" style="gap:8px">
      <label class="field" style="max-width:130px"><span>${esc(t('bot.stopType'))}</span><select id="bot-stoptype"><option value="percent" ${c.stopType !== 'atr' ? 'selected' : ''}>${esc(t('bot.percent'))}</option><option value="atr" ${c.stopType === 'atr' ? 'selected' : ''}>ATR</option></select></label>
      <label class="field" style="max-width:120px ${c.stopType === 'atr' ? '' : 'display:none'}" id="bot-atrwrap"><span>${esc(t('bot.atrMult'))}</span><input id="bot-atr" type="number" step="0.5" value="${c.atrMult}"></label>
    </div>
    <div class="row" style="gap:8px">
      <label class="field"><span>${esc(t('bot.sl'))}${c.stopType === 'atr' ? '' : ' %'}</span><input id="bot-sl" type="number" value="${c.stopLossPct}"></label>
      <label class="field"><span>${esc(t('bot.tp'))} %</span><input id="bot-tp" type="number" value="${c.takeProfitPct}"></label>
      <label class="field"><span>${esc(t('bot.trail'))}${c.stopType === 'atr' ? '' : ' %'}</span><input id="bot-trail" type="number" value="${c.trailingPct}"></label>
    </div>
    <div class="row" style="gap:8px">
      <label class="field"><span>${esc(t('bot.tp1'))} %</span><input id="bot-tp1" type="number" value="${c.tp1Pct}" title="${esc(t('bot.tp1Hint'))}"></label>
      <label class="field"><span>${esc(t('bot.tp1sell'))} %</span><input id="bot-tp1sell" type="number" value="${c.tp1SellPct}"></label>
    </div>
    ${toggleRow('bot-sent', t('bot.sentiment'), c.useSentiment)}
    ${c.mode === 'broker' && safe ? `<div class="card ${safe.live && !safe.dryRun ? 'tr-live' : 'tr-safe'}" style="margin:6px 0;font-size:12px"><b>${safe.live ? '🔴 LIVE' : '🟢 sandbox'}</b>${safe.dryRun ? ' · 🧪 dry-run' : ''} · ${safe.confirm ? '✅ ' + esc(t('bot.willConfirm')) : '⚠️ ' + esc(t('bot.willAuto'))}</div>` : ''}
    <div class="row" style="gap:6px"><button class="btn ghost sm" id="bot-once">▶ ${esc(t('bot.runOnce'))}</button><button class="btn ghost sm" id="bot-bt">🧪 ${esc(t('bot.backtest'))}</button><span id="bot-status" class="muted" style="font-size:12px">${c.running ? '🟢 ' + esc(t('bot.running')) : ''}</span></div>
    <div id="bot-bt-res" style="margin-top:8px"></div>
    <div id="bot-log" class="op-log" style="max-height:150px;margin-top:8px"></div>
    <p class="muted" style="font-size:11px;margin-top:6px">${esc(t('bot.note'))}</p>`;
  const saveCfg = () => N.bot.setCfg({ mode: $('#bot-mode').value, strategy: $('#bot-strat').value, qty: +$('#bot-qty').value || 1, intervalMin: +$('#bot-int').value || 15, interval: $('#bot-candle').value, symbols: $('#bot-syms').value.split(',').map((s) => s.trim()).filter(Boolean), useSentiment: $('#bot-sent').checked, confirmTf: $('#bot-mtf').value, stopLossPct: +$('#bot-sl').value || 0, takeProfitPct: +$('#bot-tp').value || 0, trailingPct: +$('#bot-trail').value || 0, stopType: $('#bot-stoptype').value, atrMult: +$('#bot-atr').value || 2, tp1Pct: +$('#bot-tp1').value || 0, tp1SellPct: +$('#bot-tp1sell').value || 50 });
  $('#bot-bt').onclick = async () => {
    const c2 = await N.bot.cfg(); const sym = (c2.symbols[0] || 'AAPL'); const res = $('#bot-bt-res');
    res.innerHTML = '<span class="spin">⏳</span> ' + esc(t('bot.btRun')) + ' ' + esc(sym);
    const r = await N.backtestBot({ symbol: sym, interval: c2.interval, range: c2.range, strategy: c2.strategy, params: c2.params, stopLossPct: c2.stopLossPct, takeProfitPct: c2.takeProfitPct, trailingPct: c2.trailingPct, tp1Pct: c2.tp1Pct, tp1SellPct: c2.tp1SellPct, stopType: c2.stopType, atrMult: c2.atrMult });
    if (!r.ok) { res.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
    res.innerHTML = `<div class="bt-stats"><div class="bt-stat"><span>${esc(sym)} ${esc(t('bt.return'))}</span><b class="${r.return >= 0 ? 'mk-up' : 'mk-down'}">${r.return}%</b></div><div class="bt-stat"><span>B&H</span><b>${r.buyHold}%</b></div><div class="bt-stat"><span>${esc(t('bt.trades'))}</span><b>${r.trades}${r.partials ? '+' + r.partials + 'ч' : ''}</b></div><div class="bt-stat"><span>${esc(t('bt.winRate'))}</span><b>${r.winRate}%</b></div><div class="bt-stat"><span>${esc(t('bt.maxDD'))}</span><b class="mk-down">-${r.maxDrawdown}%</b></div></div>`;
  };
  $$('#bot-body [data-prof]').forEach((b) => b.onclick = async () => { await N.bot.applyProfile(b.dataset.prof); toast('🤖', t('bot.profileSet') + ': ' + b.textContent.trim(), 'ok'); renderBotCard(); });
  bindToggle('bot-enable', async (v) => { if (v && !await confirmModal('🤖 ' + t('bot.title'), t('bot.enableWarn'))) return renderBotCard(); await N.bot.setCfg({ enabled: v }); renderBotCard(); });
  ['#bot-mode', '#bot-strat', '#bot-qty', '#bot-int', '#bot-candle', '#bot-syms', '#bot-mtf', '#bot-sl', '#bot-tp', '#bot-trail', '#bot-stoptype', '#bot-atr', '#bot-tp1', '#bot-tp1sell'].forEach((s) => { const e = $(s); if (e) e.onchange = async () => { await saveCfg(); if (s === '#bot-mode' || s === '#bot-stoptype') renderBotCard(); }; });
  bindToggle('bot-sent', () => saveCfg());
  $('#bot-once').onclick = async () => { $('#bot-status').textContent = '⏳'; await N.bot.runOnce(); $('#bot-status').textContent = '✓ ' + t('bot.evaluated'); renderPaperCard(); };
}
async function renderPaperCard() {
  const box = $('#paper-body'); if (!box) return;
  let v = await N.paper.valuation();
  const quotes = {};
  for (const p of v.positions) { if (state.view !== 'trading') return; const d = await N.markets.candles({ symbol: p.symbol, interval: '1d', range: '5d' }); if (d.ok && d.candles.length) quotes[p.symbol] = d.candles[d.candles.length - 1].c; }
  if (Object.keys(quotes).length) v = await N.paper.valuation(quotes);
  if (!box || state.view !== 'trading') return;
  box.innerHTML = `
    <div class="bt-stats">
      <div class="bt-stat"><span>${esc(t('bot.equity'))}</span><b>${v.equity.toLocaleString()}</b></div>
      <div class="bt-stat"><span>${esc(t('bot.cash'))}</span><b>${v.cash.toLocaleString()}</b></div>
      <div class="bt-stat"><span>P&L</span><b class="${v.totalPnl >= 0 ? 'mk-up' : 'mk-down'}">${v.totalPnl >= 0 ? '+' : ''}${v.totalPnl} (${v.totalPnlPct}%)</b></div>
    </div>
    ${v.positions.length ? `<table class="tr-pf-tbl"><tr><th>Тикер</th><th>Кол-во</th><th>Ср.</th><th>Тек.</th><th>P&L</th></tr>${v.positions.map((p) => `<tr><td>${esc(p.symbol)}</td><td>${p.qty}</td><td>${p.avg.toFixed(2)}</td><td>${p.price.toFixed(2)}</td><td class="${p.pnl >= 0 ? 'mk-up' : 'mk-down'}">${p.pnl} (${p.pnlPct}%)</td></tr>`).join('')}</table>` : `<p class="muted">${esc(t('bot.noPos'))}</p>`}
    <button class="btn ghost sm" id="paper-reset" style="margin-top:8px">↺ ${esc(t('bot.reset'))}</button>`;
  $('#paper-reset').onclick = async () => { if (await confirmModal(t('bot.reset'), t('bot.resetConfirm'))) { await N.paper.reset(100000); renderPaperCard(); renderPortfolioAnalytics(); } };
}
async function renderPortfolioAnalytics() {
  const box = $('#pa-body'); if (!box) return;
  box.innerHTML = '<span class="spin">⏳</span>';
  const v0 = await N.paper.valuation();
  const quotes = {};
  for (const p of v0.positions) { if (state.view !== 'trading') return; const d = await N.markets.candles({ symbol: p.symbol, interval: '1d', range: '5d' }); if (d.ok && d.candles.length) quotes[p.symbol] = d.candles[d.candles.length - 1].c; }
  const a = await N.portfolio.analyze(quotes);
  if (!box || state.view !== 'trading') return;
  const colors = ['#7c5cff', '#29d3c2', '#ff7c5c', '#ffb547', '#3ddc84', '#ff5c9d', '#80a4ff', '#f7b733'];
  const bar = a.positions.length ? `<div class="pa-bar">${a.positions.map((p, i) => `<span style="width:${p.pct}%;background:${colors[i % colors.length]}" title="${esc(p.symbol)} ${p.pct}%"></span>`).join('')}${a.cashPct > 0 ? `<span style="width:${a.cashPct}%;background:var(--bg-3)" title="Кэш ${a.cashPct}%"></span>` : ''}</div>
    <div class="pa-legend">${a.positions.map((p, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${esc(p.symbol)} ${p.pct}%</span>`).join('')}<span><i style="background:var(--bg-3)"></i>${esc(t('pa.cash'))} ${a.cashPct}%</span></div>` : `<p class="muted">${esc(t('bot.noPos'))}</p>`;
  box.innerHTML = bar + `<div class="bt-stats" style="margin-top:10px">
      <div class="bt-stat"><span>${esc(t('pa.diversification'))}</span><b>${esc(a.diversification)}</b></div>
      <div class="bt-stat"><span>${esc(t('pa.concentration'))}</span><b>${a.concentration}</b></div>
      <div class="bt-stat"><span>${esc(t('pa.positions'))}</span><b>${a.positionsCount}</b></div>
      <div class="bt-stat"><span>${esc(t('pa.realized'))}</span><b class="${a.realizedPnl >= 0 ? 'mk-up' : 'mk-down'}">${a.realizedPnl}</b></div>
      <div class="bt-stat"><span>${esc(t('pa.winRate'))}</span><b>${a.winRate}%</b></div>
      ${a.best ? `<div class="bt-stat"><span>${esc(t('pa.best'))}</span><b class="mk-up">${esc(a.best.symbol)} +${a.best.pnlPct}%</b></div>` : ''}
      ${a.worst ? `<div class="bt-stat"><span>${esc(t('pa.worst'))}</span><b class="mk-down">${esc(a.worst.symbol)} ${a.worst.pnlPct}%</b></div>` : ''}
    </div>`;
}
// «ИИ за рулём» — супервайзер + лента предложений.
async function renderCopilot() {
  const box = $('#cp-body'); if (!box) return;
  const c = await N.copilot.cfg();
  const models = await N.installer.listModels();
  const modelOpts = (models.length ? models.map((m) => m.name) : [c.model]).map((n) => `<option value="${esc(n)}" ${n === c.model ? 'selected' : ''}>${esc(n)}</option>`).join('');
  box.innerHTML = `
    <p class="muted" style="font-size:12px;margin-bottom:8px">${esc(t('cp.sub'))}</p>
    ${toggleRow('cp-enable', t('cp.enable'), c.enabled)}
    <label class="field"><span>${esc(t('cp.goal'))}</span><textarea id="cp-goal" rows="2" placeholder="${esc(t('cp.goalPh'))}">${esc(c.goal)}</textarea></label>
    <div class="row" style="gap:8px">
      <label class="field"><span>${esc(t('cp.model'))}</span><select id="cp-model">${modelOpts}</select></label>
      <label class="field" style="max-width:150px"><span>${esc(t('cp.risk'))}</span><select id="cp-risk"><option value="conservative" ${c.risk === 'conservative' ? 'selected' : ''}>${esc(t('cp.conservative'))}</option><option value="balanced" ${c.risk === 'balanced' ? 'selected' : ''}>${esc(t('cp.balanced'))}</option><option value="aggressive" ${c.risk === 'aggressive' ? 'selected' : ''}>${esc(t('cp.aggressive'))}</option></select></label>
      <label class="field" style="max-width:120px"><span>${esc(t('cp.minConf'))}</span><input id="cp-conf" type="number" value="${c.minConfidence}"></label>
    </div>
    <div class="row" style="gap:8px;align-items:center">
      ${toggleRow('cp-auto', t('cp.autoPaper'), c.autoActPaper)}
      <button class="btn ghost sm" id="cp-monitor">🔍 ${esc(t('cp.monitorNow'))}</button><span id="cp-status" class="muted" style="font-size:12px"></span>
    </div>
    <p class="muted" style="font-size:11px;margin:4px 0 10px">${esc(t('cp.note'))}</p>
    <h4 style="margin:8px 0 4px">📥 ${esc(t('cp.proposals'))}</h4>
    <div id="cp-props"></div>`;
  const save = () => N.copilot.setCfg({ goal: $('#cp-goal').value.trim(), model: $('#cp-model').value, risk: $('#cp-risk').value, minConfidence: +$('#cp-conf').value || 60, autoActPaper: $('#cp-auto').checked });
  bindToggle('cp-enable', async (v) => { if (v && !await confirmModal('🧭 ' + t('cp.title'), t('cp.enableWarn'))) return renderCopilot(); await N.copilot.setCfg({ enabled: v }); renderCopilot(); });
  ['#cp-goal', '#cp-model', '#cp-risk', '#cp-conf'].forEach((s) => { const e = $(s); if (e) e.onchange = save; });
  bindToggle('cp-auto', save);
  $('#cp-monitor').onclick = async () => { $('#cp-status').textContent = '⏳ ' + t('cp.scanning'); await N.copilot.monitor(); $('#cp-status').textContent = '✓'; renderProposals(); };
  renderProposals();
}
async function renderProposals() {
  const box = $('#cp-props'); if (!box) return;
  const props = (await N.copilot.proposals()).filter((p) => p.status === 'pending').slice(-8).reverse();
  box.innerHTML = props.length ? props.map((p) => `<div class="cp-prop"><div><b class="${p.action === 'buy' ? 'mk-up' : 'mk-down'}">${p.action.toUpperCase()} ${esc(p.symbol)}</b> <span class="muted">@ ${(p.price || 0).toFixed ? p.price.toFixed(2) : p.price} · ${esc(t('mk.confidence'))} ${p.confidence}%</span><div class="muted" style="font-size:12px;margin-top:2px">${esc(p.reasoning)}</div></div><span style="white-space:nowrap"><button class="btn primary sm" data-act="${esc(p.id)}">✓</button><button class="btn ghost sm" data-dis="${esc(p.id)}">✕</button></span></div>`).join('') : `<p class="muted">${esc(t('cp.noProps'))}</p>`;
  $$('#cp-props [data-act]').forEach((b) => b.onclick = async () => { const r = await N.copilot.act(b.dataset.act); toast('🧭', r.ok ? (r.message || t('cp.executed')) : (r.error || ''), r.ok ? 'ok' : 'err'); renderProposals(); if (state.view === 'trading') renderPaperCard(); });
  $$('#cp-props [data-dis]').forEach((b) => b.onclick = async () => { await N.copilot.dismiss(b.dataset.dis); renderProposals(); });
}
N.on('copilot:proposal', () => { if (state.view === 'trading') renderProposals(); });
N.on('copilot:status', ({ stage }) => { const s = $('#cp-status'); if (s && state.view === 'trading') s.textContent = stage === 'scanning' ? '⏳ ' + t('cp.scanning') : ''; });

async function rebalanceModal() {
  modal(`<h2>⚖️ ${esc(t('rb.title'))}</h2>
    <p class="muted">${esc(t('rb.sub'))}</p>
    <label class="field"><span>${esc(t('rb.targets'))}</span><input id="rb-in" placeholder="AAPL:40, MSFT:30, BTC-USD:30"></label>
    <div id="rb-plan" class="muted" style="margin:8px 0"></div>
    <div class="modal-actions"><button class="btn ghost" id="rb-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="rb-apply" disabled>${esc(t('rb.apply'))}</button></div>`,
    (m, close) => {
      let targets = {}, quotes = {};
      const parse = () => { targets = {}; $('#rb-in', m).value.split(',').forEach((p) => { const [s, v] = p.split(':'); if (s && v) targets[s.trim().toUpperCase()] = +v; }); };
      const preview = async () => {
        parse(); if (!Object.keys(targets).length) return;
        $('#rb-plan', m).innerHTML = '<span class="spin">⏳</span>';
        quotes = {};
        for (const s of Object.keys(targets)) { const d = await N.markets.candles({ symbol: s, interval: '1d', range: '5d' }); if (d.ok && d.candles.length) quotes[s] = d.candles[d.candles.length - 1].c; }
        const r = await N.rebalance.plan(targets, quotes);
        $('#rb-plan', m).innerHTML = r.plan.length ? r.plan.map((x) => `<div class="${x.side === 'buy' ? 'mk-up' : 'mk-down'}">${x.side === 'buy' ? '🟢' : '🔴'} ${x.side} ${x.qty} ${esc(x.symbol)} @ ${x.price || '?'}</div>`).join('') : `<span class="muted">${esc(t('rb.balanced'))}</span>`;
        $('#rb-apply', m).disabled = !r.plan.length;
      };
      $('#rb-in', m).onchange = preview;
      $('#rb-cancel', m).onclick = close;
      $('#rb-apply', m).onclick = async () => { const r = await N.rebalance.apply(targets, quotes); toast('⚖️', t('rb.done') + ': ' + r.executed, 'ok'); close(); if (state.view === 'trading') { renderPaperCard(); renderPortfolioAnalytics(); } };
    });
}
async function renderDca() {
  const box = $('#dca-list'); if (!box) return;
  const all = await N.dca.list();
  box.innerHTML = all.length ? all.map((p) => `<div class="al-item"><label class="switch"><input type="checkbox" data-tg="${esc(p.id)}" ${p.enabled !== false ? 'checked' : ''}><span class="slider"></span></label><span><b>${esc(p.symbol)}</b> ${p.amount} / ${p.everyHours}ч · ${esc(p.mode)} <small class="muted">(${p.runs || 0}×)</small></span><span style="margin-left:auto"><button class="btn ghost sm" data-run="${esc(p.id)}">▶</button><button class="btn ghost sm" data-rm="${esc(p.id)}">✕</button></span></div>`).join('') : `<p class="muted">${esc(t('dca.empty'))}</p>`;
  $$('#dca-list [data-tg]').forEach((c) => c.onchange = () => N.dca.toggle(c.dataset.tg, c.checked));
  $$('#dca-list [data-run]').forEach((b) => b.onclick = async () => { const r = await N.dca.runNow(b.dataset.run); toast('💵', r.ok ? 'OK' : r.error, r.ok ? 'ok' : 'err'); renderDca(); if (state.view === 'trading') renderPaperCard(); });
  $$('#dca-list [data-rm]').forEach((b) => b.onclick = async () => { await N.dca.remove(b.dataset.rm); renderDca(); });
}
async function renderCorrelation() {
  const box = $('#corr-body'); if (!box) return;
  box.innerHTML = '<span class="spin">⏳</span>';
  const wl = await N.markets.watchlist();
  const syms = wl.map((w) => w.symbol).slice(0, 6);
  if (syms.length < 2) { box.innerHTML = `<span class="muted">${esc(t('corr.need'))}</span>`; return; }
  const r = await N.marketsCorrelation(syms);
  if (!r.ok) { box.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
  const col = (v) => v >= 0.7 ? 'rgba(239,83,80,.5)' : v >= 0.4 ? 'rgba(247,183,51,.4)' : v <= -0.3 ? 'rgba(38,166,154,.4)' : 'transparent';
  box.classList.remove('muted');
  box.innerHTML = `<table class="data-tbl"><tr><th></th>${r.symbols.map((s) => `<th>${esc(s)}</th>`).join('')}</tr>${r.matrix.map((row, i) => `<tr><th>${esc(r.symbols[i])}</th>${row.map((v) => `<td style="background:${col(v)};text-align:center">${v}</td>`).join('')}</tr>`).join('')}</table><p class="muted" style="font-size:11px;margin-top:6px">${esc(t('corr.note'))}</p>`;
}
async function renderJournal() {
  const stBox = $('#jr-stats'), listBox = $('#jr-list'); if (!stBox) return;
  const s = await N.journal.stats();
  stBox.innerHTML = s.count ? `<b>${s.count}</b> ${esc(t('jr.trades'))} · ${esc(t('pa.winRate'))} ${s.winRate}% · P&L <b class="${s.totalPnl >= 0 ? 'mk-up' : 'mk-down'}">${s.totalPnl}</b> · ${esc(t('jr.avgWin'))} ${s.avgWin} / ${esc(t('jr.avgLoss'))} ${s.avgLoss}${s.profitFactor ? ' · PF ' + s.profitFactor : ''}` : `<span class="muted">${esc(t('jr.empty'))}</span>`;
  const all = await N.journal.list();
  listBox.innerHTML = all.slice(0, 30).map((e) => `<div class="al-item"><span>${new Date(e.date).toLocaleDateString()} <b>${esc(e.symbol)}</b> ${esc(e.side)} ${e.qty}@${e.price}${e.pnl != null ? ` · <span class="${e.pnl >= 0 ? 'mk-up' : 'mk-down'}">P&L ${e.pnl}</span>` : ''} <small class="muted">${esc(e.reason || '')}</small></span><button class="btn ghost sm" data-rm="${esc(e.id)}" style="margin-left:auto">✕</button></div>`).join('');
  $$('#jr-list [data-rm]').forEach((b) => b.onclick = async () => { await N.journal.remove(b.dataset.rm); renderJournal(); });
}
N.on('bot:event', (e) => {
  const log = $('#bot-log');
  if (log && state.view === 'trading') {
    const ic = { signal: '📊', trade: '✅', order: '📤', skip: '⤵️', error: '⚠️', status: '🔄', exit: '🚪', confirm: '🧭' };
    const msg = e.kind === 'signal' ? `${e.symbol}: ${e.signal} @ ${(e.price || 0).toFixed ? e.price.toFixed(2) : e.price}` : e.kind === 'trade' ? `${e.symbol}: ${e.side} ${e.qty} @ ${e.price.toFixed(2)}${e.pnl != null ? ' · P&L ' + e.pnl : ''}` : e.kind === 'exit' ? `${e.symbol}: выход (${e.reason}) @ ${(e.price || 0).toFixed ? e.price.toFixed(2) : e.price}` : `${e.symbol || ''} ${e.message || ''}`;
    const d = el('div', 'op-line op-' + (e.kind === 'trade' ? 'action' : e.kind === 'error' ? 'warn' : e.kind === 'exit' ? 'action' : 'frame'));
    d.textContent = `${ic[e.kind] || '•'} ${msg}`;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  if (e.kind === 'trade' && state.view === 'trading') renderPaperCard();
});

async function renderTradeLog() {
  const box = $('#tr-log'); if (!box) return;
  const log = (await N.trade.log()).slice(-30).reverse();
  const ic = { requested: '📝', executed: '✅', simulated: '🧪', blocked: '🛡️', rejected: '🚫', failed: '❌', panic: '🛑' };
  box.innerHTML = log.length ? log.map((e) => {
    const o = e.order || {}; const when = new Date(e.at).toLocaleTimeString();
    return `<div class="tr-log-line"><span>${ic[e.kind] || '•'} ${esc(e.kind)}</span> <span class="muted">${when} · ${esc(e.env || '')}</span> ${o.ticker ? `<span>${esc(o.direction || '')} ${o.lots || ''} ${esc(o.ticker)}</span>` : ''} ${e.reason ? `<span class="mk-down">${esc(e.reason)}</span>` : ''}</div>`;
  }).join('') : `<p class="muted">${esc(t('tr.logEmpty'))}</p>`;
}
// Глобальный модал подтверждения заявки (приходит от ручного размещения и от ИИ).
N.on('trade:confirm', ({ order, cfg }) => {
  const live = cfg && cfg.env === 'live'; const dry = cfg && cfg.dryRun;
  modal(`<h2>${order.source === 'agent' ? '🤖 ' : '🧾 '}${esc(t('tr.confirmTitle'))}</h2>
    <div class="card ${live && !dry ? 'tr-live' : 'tr-safe'}" style="margin:8px 0">
      <div style="font-size:18px"><b class="${order.direction === 'buy' ? 'mk-up' : 'mk-down'}">${order.direction === 'buy' ? '🟢 ПОКУПКА' : '🔴 ПРОДАЖА'}</b> ${esc(order.ticker || order.figi)}</div>
      <p style="margin-top:6px">${esc(t('tr.lots'))}: <b>${order.lots}</b> · ${esc(t('tr.type'))}: ${esc(order.orderType)}${order.price ? ' @ ' + order.price : ''}</p>
      ${order.estValue ? `<p class="muted">≈ ${order.estValue.toFixed(2)}</p>` : ''}
      <p class="muted" style="font-size:12px">${esc(t('tr.env'))}: ${live ? '🔴 LIVE' : '🟢 sandbox'} ${dry ? '· 🧪 dry-run (симуляция)' : (live ? '· ⚠️ РЕАЛЬНЫЕ ДЕНЬГИ' : '')}</p>
      ${order.source === 'agent' ? `<p class="muted" style="font-size:12px">${esc(t('tr.byAgent'))}</p>` : ''}
    </div>
    <div class="modal-actions"><button class="btn ghost" id="tc-no">${esc(t('tr.cReject'))}</button><button class="btn ${live && !dry ? 'danger' : 'primary'}" id="tc-yes">${esc(t('tr.cApprove'))}${live && !dry ? ' (РЕАЛЬНО)' : ''}</button></div>`,
    (m, close) => {
      $('#tc-no', m).onclick = async () => { await N.trade.reject(order.id); close(); if (state.view === 'trading') renderTradeLog(); };
      $('#tc-yes', m).onclick = async () => { close(); const r = await N.trade.confirm(order.id); toast(r.ok ? '✅' : '⚠️', r.message || r.error || '', r.ok ? 'ok' : 'err'); if (state.view === 'trading') { renderTradeLog(); } };
    });
});
N.on('trade:log', () => { if (state.view === 'trading') renderTradeLog(); });

/* ---------- Заметки / «второй мозг» ---------- */
function mdToHtml(md) {
  let h = esc(md);
  h = h.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => `<a class="wikilink" data-note="${esc(a.trim())}">${esc((b || a).trim())}</a>`);
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^[-*] (.+)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  return h.replace(/\n/g, '<br>');
}
async function viewNotes() {
  if (!state.notes) state.notes = { openId: null, q: '' };
  content.innerHTML = `
    <div class="view-head"><h1>📓 ${esc(t('notes.title'))}</h1><p>${esc(t('notes.sub'))}</p></div>
    <div class="notes-layout">
      <div class="card notes-list-card">
        <div class="row" style="gap:6px"><input id="notes-q" placeholder="${esc(t('notes.search'))}" value="${esc(state.notes.q)}" style="flex:1"><button class="btn sm" id="notes-new">＋</button></div>
        <div id="notes-list" class="notes-list"></div>
      </div>
      <div class="card notes-edit-card" id="notes-edit"></div>
    </div>`;
  $('#notes-q').oninput = (e) => { state.notes.q = e.target.value; renderNotesList(); };
  $('#notes-new').onclick = async () => { const n = await N.notes.save({ title: t('notes.untitled'), body: '' }); state.notes.openId = n.id; await renderNotesList(); openNote(n.id); };
  await renderNotesList();
  if (state.notes.openId) openNote(state.notes.openId); else renderNoteEditor(null);
}
async function renderNotesList() {
  const box = $('#notes-list'); if (!box) return;
  const items = state.notes.q ? await N.notes.search(state.notes.q) : await N.notes.list();
  items.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  box.innerHTML = items.length ? items.map((n) => `<div class="note-item ${state.notes.openId === n.id ? 'active' : ''}" data-id="${esc(n.id)}"><b>${esc(n.title)}</b><div class="note-snip">${esc(n.snippet || '')}</div></div>`).join('') : `<p class="muted" style="font-size:12px;padding:8px">${esc(t('notes.empty'))}</p>`;
  $$('#notes-list [data-id]').forEach((el2) => el2.onclick = () => openNote(el2.dataset.id));
}
async function openNote(id) {
  const n = await N.notes.get(id); if (!n) return;
  state.notes.openId = id;
  $$('#notes-list .note-item').forEach((el2) => el2.classList.toggle('active', el2.dataset.id === id));
  renderNoteEditor(n);
  const bl = await N.notes.backlinks(n.title);
  const blBox = $('#note-backlinks'); if (blBox) { blBox.innerHTML = bl.length ? '<b>' + t('notes.backlinks') + ':</b> ' + bl.map((b) => `<a class="wikilink" data-open="${esc(b.id)}">${esc(b.title)}</a>`).join(', ') : ''; $$('#note-backlinks [data-open]').forEach((a) => a.onclick = () => openNote(a.dataset.open)); }
}
function renderNoteEditor(n) {
  const box = $('#notes-edit'); if (!box) return;
  if (!n) { box.innerHTML = `<div class="empty"><div class="big-ico">📓</div><p>${esc(t('notes.pick'))}</p></div>`; return; }
  box.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
      <input id="note-title" value="${esc(n.title)}" class="note-title-input">
      <span><button class="btn ghost sm" id="note-preview">👁</button><button class="btn ghost sm" id="note-pdf">⬇PDF</button><button class="btn ghost sm" id="note-del">🗑</button></span>
    </div>
    <input id="note-tags" value="${esc((n.tags || []).join(', '))}" placeholder="${esc(t('notes.tags'))}" class="note-tags-input">
    <textarea id="note-body" class="note-body" placeholder="${esc(t('notes.bodyHint'))}">${esc(n.body)}</textarea>
    <div id="note-prev" class="note-prev" style="display:none"></div>
    <div id="note-backlinks" class="note-backlinks"></div>
    <div class="muted" id="note-saved" style="font-size:11px;margin-top:4px"></div>`;
  let timer = null;
  const save = async () => { const note = { id: n.id, title: $('#note-title').value, body: $('#note-body').value, tags: $('#note-tags').value }; await N.notes.save(note); $('#note-saved').textContent = '✓ ' + t('notes.saved'); renderNotesList(); };
  const autosave = () => { clearTimeout(timer); $('#note-saved').textContent = '…'; timer = setTimeout(save, 700); };
  $('#note-title').oninput = autosave; $('#note-tags').oninput = autosave; $('#note-body').oninput = autosave;
  $('#note-del').onclick = async () => { if (await confirmModal(t('notes.del'), n.title)) { await N.notes.remove(n.id); state.notes.openId = null; await renderNotesList(); renderNoteEditor(null); } };
  $('#note-preview').onclick = () => {
    const prev = $('#note-prev'), body = $('#note-body');
    if (prev.style.display === 'none') { prev.innerHTML = mdToHtml($('#note-body').value); prev.style.display = ''; body.style.display = 'none'; $$('#note-prev .wikilink').forEach((a) => a.onclick = async () => { const tn = await N.notes.byTitle(a.dataset.note); if (tn) openNote(tn.id); else { const nn = await N.notes.save({ title: a.dataset.note, body: '' }); renderNotesList(); openNote(nn.id); } }); }
    else { prev.style.display = 'none'; body.style.display = ''; }
  };
  $('#note-pdf').onclick = () => exportNotePdf(n);
}
async function exportNotePdf(n) {
  const html = `<h1>${esc(n.title)}</h1>${(n.tags || []).length ? `<p class="muted">${esc(n.tags.join(', '))}</p>` : ''}<div>${mdToHtml($('#note-body') ? $('#note-body').value : n.body)}</div>`;
  const r = await N.pdf.export(html, n.title);
  toast(r.ok ? '⬇ PDF' : '⚠️', r.ok ? r.path : r.error, r.ok ? 'ok' : 'err');
}

/* ---------- Студия данных (SQL / CSV) ---------- */
async function viewData() {
  if (!state.data) state.data = { file: '', sql: 'SELECT * FROM data LIMIT 50' };
  const files = await N.data.files();
  content.innerHTML = `
    <div class="view-head"><h1>🗃️ ${esc(t('data.title'))}</h1><p>${esc(t('data.sub'))}</p></div>
    <div class="card">
      <label class="field"><span>${esc(t('data.file'))}</span>
        <div class="row"><select id="data-file" style="flex:1"><option value="">${esc(t('data.pick'))}</option>${files.map((f) => `<option value="${esc(f)}" ${f === state.data.file ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <button class="btn ghost" id="data-open">${esc(t('data.open'))}</button></div></label>
      <div id="data-meta" class="muted" style="font-size:12px"></div>
      <label class="field" style="margin-top:8px"><span>SQL ${esc(t('data.sqlHint'))}</span><textarea id="data-sql" rows="3" class="code-editor" style="min-height:auto">${esc(state.data.sql)}</textarea></label>
      <div class="row" style="gap:8px"><button class="btn primary" id="data-run">▶ ${esc(t('data.run'))}</button><button class="btn ghost" id="data-csv">⬇ CSV</button></div>
    </div>
    <div class="card"><div id="data-result" class="muted">${esc(t('data.resultHint'))}</div></div>`;
  $('#data-file').onchange = (e) => { state.data.file = e.target.value; };
  $('#data-open').onclick = async () => {
    if (!state.data.file) return; const meta = $('#data-meta'); meta.textContent = '…';
    const r = await N.data.describe(state.data.file);
    if (!r.ok) { meta.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
    if (r.kind === 'sqlite') { meta.innerHTML = `🗄️ SQLite · ${esc(t('data.tables'))}: ${r.tables.map((tb) => `<a class="wikilink" data-tbl="${esc(tb)}">${esc(tb)}</a>`).join(', ')}`; $$('#data-meta [data-tbl]').forEach((a) => a.onclick = () => { $('#data-sql').value = `SELECT * FROM ${a.dataset.tbl} LIMIT 50`; }); }
    else { meta.innerHTML = `📄 CSV · ${esc(t('data.cols'))}: ${r.columns.join(', ')} · ${esc(t('data.tableData'))}`; renderDataTable(r.columns, r.rows); }
  };
  $('#data-run').onclick = async () => {
    if (!state.data.file) return toast('🗃️', t('data.pickFirst'), 'err');
    state.data.sql = $('#data-sql').value;
    const box = $('#data-result'); box.innerHTML = '<span class="spin">⏳</span>';
    const r = await N.data.query(state.data.file, state.data.sql);
    if (!r.ok) { box.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
    window.__lastData = r; renderDataTable(r.columns, r.rows);
  };
  $('#data-csv').onclick = () => {
    const d = window.__lastData; if (!d) return;
    const csv = [d.columns.join(',')].concat(d.rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(','))).join('\n');
    downloadText('query-result.csv', csv, 'text/csv');
  };
  if (state.data.file) $('#data-open').click();
}
function renderDataTable(cols, rows) {
  const box = $('#data-result'); if (!box) return;
  if (!rows.length) { box.innerHTML = `<p class="muted">${esc(t('data.noRows'))}</p>`; return; }
  box.innerHTML = `<div class="data-tbl-wrap"><table class="data-tbl"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 300).map((r) => `<tr>${r.map((c) => `<td>${esc(String(c == null ? '' : c)).slice(0, 200)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted" style="font-size:11px;margin-top:6px">${rows.length} ${esc(t('data.rowsShown'))}</p>`;
}

/* ---------- RSS-читалка + ИИ-дайджест ---------- */
async function viewRss() {
  content.innerHTML = `
    <div class="view-head"><h1>📰 ${esc(t('rss.title'))}</h1><p>${esc(t('rss.sub'))}</p></div>
    <div class="card">
      <div class="row" style="gap:8px"><input id="rss-url" placeholder="https://example.com/feed.xml" style="flex:1"><button class="btn" id="rss-add">${esc(t('rss.add'))}</button>
        <button class="btn ghost" id="rss-refresh">↻ ${esc(t('rss.refresh'))}</button><button class="btn primary" id="rss-digest">🧠 ${esc(t('rss.digest'))}</button></div>
      <div id="rss-feeds" class="rss-feeds"></div>
    </div>
    <div id="rss-digest-box"></div>
    <div class="card"><div id="rss-items" class="muted">${esc(t('rss.loading'))}</div></div>`;
  $('#rss-add').onclick = async () => { const u = $('#rss-url').value.trim(); if (!u) return; await N.rss.add(u); $('#rss-url').value = ''; viewRss(); };
  $('#rss-refresh').onclick = viewRss;
  $('#rss-digest').onclick = async () => {
    const box = $('#rss-digest-box'); box.innerHTML = `<div class="card"><span class="spin">⏳</span> ${esc(t('rss.digesting'))}</div>`;
    const r = await N.rss.digest();
    box.innerHTML = r.ok ? `<div class="card"><h3>🧠 ${esc(t('rss.digest'))}</h3><div style="white-space:pre-wrap;line-height:1.5">${esc(r.digest)}</div></div>` : `<div class="card mk-down">⚠️ ${esc(r.error)}</div>`;
  };
  const feeds = await N.rss.feeds();
  $('#rss-feeds').innerHTML = feeds.length ? feeds.map((f) => `<span class="rss-chip">${esc(f.title || f.url)} <span data-rm="${esc(f.url)}">✕</span></span>`).join('') : `<span class="muted" style="font-size:12px">${esc(t('rss.noFeeds'))}</span>`;
  $$('#rss-feeds [data-rm]').forEach((x) => x.onclick = async () => { await N.rss.remove(x.dataset.rm); viewRss(); });
  const agg = await N.rss.aggregate();
  const box = $('#rss-items');
  box.innerHTML = agg.items.length ? agg.items.map((i) => `<div class="news-item"><a data-link="${esc(i.link)}">${esc(i.title)}</a><span class="news-meta">${esc(i.source || '')}${i.date ? ' · ' + new Date(i.date).toLocaleString() : ''}</span></div>`).join('') : `<p class="muted">${esc(t('rss.empty'))}</p>`;
  $$('#rss-items [data-link]').forEach((a) => a.onclick = () => N.system.openExternal(a.dataset.link));
}

/* ---------- Календарь и напоминания ---------- */
async function viewCalendar() {
  const now = Date.now();
  const events = await N.cal.list(now - 86400000, now + 60 * 86400000);
  content.innerHTML = `
    <div class="view-head"><h1>📅 ${esc(t('cal.title'))}</h1><p>${esc(t('cal.sub'))}</p></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>➕ ${esc(t('cal.add'))}</h3>
        <label class="field"><span>${esc(t('cal.evTitle'))}</span><input id="cal-title"></label>
        <div class="row" style="gap:8px">
          <label class="field"><span>${esc(t('cal.start'))}</span><input id="cal-start" type="datetime-local"></label>
          <label class="field" style="max-width:120px"><span>${esc(t('cal.dur'))}</span><input id="cal-dur" type="number" value="60"></label>
          <label class="field" style="max-width:120px"><span>${esc(t('cal.remind'))}</span><input id="cal-remind" type="number" value="10"></label>
        </div>
        <label class="field"><span>${esc(t('cal.notes'))}</span><textarea id="cal-notes" rows="2"></textarea></label>
        <div class="row" style="gap:6px"><button class="btn primary" id="cal-save">${esc(t('cal.saveEv'))}</button>
          <button class="btn ghost" id="cal-export">⬇ ICS</button><button class="btn ghost" id="cal-import">⬆ ICS</button></div>
      </div>
      <div class="card">
        <h3>🗓 ${esc(t('cal.upcoming'))}</h3>
        <div id="cal-list" class="cal-list"></div>
      </div>
    </div>`;
  const renderList = () => {
    const box = $('#cal-list');
    box.innerHTML = events.length ? events.map((e) => {
      const soon = e.start - now < 86400000 && e.start > now;
      return `<div class="cal-item ${soon ? 'soon' : ''}"><div><b>${esc(e.title)}</b><div class="muted" style="font-size:12px">${new Date(e.start).toLocaleString()}${e.notes ? ' · ' + esc(e.notes.slice(0, 40)) : ''}</div></div><button class="btn ghost sm" data-del="${esc(e.id)}">🗑</button></div>`;
    }).join('') : `<p class="muted">${esc(t('cal.empty'))}</p>`;
    $$('#cal-list [data-del]').forEach((b) => b.onclick = async () => { await N.cal.remove(b.dataset.del); viewCalendar(); });
  };
  renderList();
  $('#cal-save').onclick = async () => {
    const title = $('#cal-title').value.trim(); const startV = $('#cal-start').value;
    if (!title || !startV) return toast('📅', t('cal.needTitle'), 'err');
    const start = new Date(startV).getTime();
    await N.cal.save({ title, start, end: start + (+$('#cal-dur').value || 60) * 60000, notes: $('#cal-notes').value.trim(), remindMin: +$('#cal-remind').value || 0 });
    toast('📅', t('cal.added'), 'ok'); viewCalendar();
  };
  $('#cal-export').onclick = async () => { const ics = await N.cal.exportICS(); downloadText('mythera-calendar.ics', ics, 'text/calendar'); };
  $('#cal-import').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.ics';
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const r = await N.cal.importICS(await f.text()); toast('📅', t('cal.imported') + ': ' + r.added, 'ok'); viewCalendar(); };
    inp.click();
  };
}

/* ---------- Email-ассистент ---------- */
async function viewEmail() {
  const c = await N.email.cfg();
  const enabled = await N.store.get('settings.emailEnabled', false);
  content.innerHTML = `
    <div class="view-head"><h1>✉️ ${esc(t('em.title'))}</h1><p>${esc(t('em.sub'))}</p></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>🔌 ${esc(t('em.setup'))}</h3>
        <div class="row" style="gap:8px"><label class="field"><span>IMAP ${esc(t('em.host'))}</span><input id="em-imap" value="${esc(c.imapHost)}" placeholder="imap.gmail.com"></label><label class="field" style="max-width:90px"><span>${esc(t('em.port'))}</span><input id="em-imapport" value="${esc(c.imapPort)}"></label></div>
        <div class="row" style="gap:8px"><label class="field"><span>SMTP ${esc(t('em.host'))}</span><input id="em-smtp" value="${esc(c.smtpHost)}" placeholder="smtp.gmail.com"></label><label class="field" style="max-width:90px"><span>${esc(t('em.port'))}</span><input id="em-smtpport" value="${esc(c.smtpPort)}"></label></div>
        <label class="field"><span>${esc(t('em.user'))}</span><input id="em-user" value="${esc(c.user)}" placeholder="you@example.com"></label>
        <label class="field"><span>${esc(t('em.pass'))}</span><input id="em-pass" type="password" placeholder="${c.hasPassword ? '•••••• (сохранён)' : esc(t('em.appPass'))}"></label>
        <div class="row" style="gap:6px"><button class="btn primary" id="em-savecfg">${esc(t('em.save'))}</button>${toggleRow('em-enable', t('em.aiTools'), enabled)}</div>
        <p class="muted" style="font-size:11px;margin-top:6px">${esc(t('em.note'))}</p>
      </div>
      <div class="card">
        <h3>📥 ${esc(t('em.inbox'))} <button class="btn ghost sm" id="em-refresh" style="float:right">↻</button></h3>
        <div id="em-list" class="muted">${esc(t('em.loadHint'))}</div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h3>✍️ ${esc(t('em.compose'))}</h3>
        <label class="field"><span>${esc(t('em.to'))}</span><input id="em-to" placeholder="recipient@example.com"></label>
        <label class="field"><span>${esc(t('em.subject'))}</span><input id="em-subj"></label>
        <label class="field"><span>${esc(t('em.body'))}</span><textarea id="em-body" rows="4"></textarea></label>
        <div class="row" style="gap:6px"><button class="btn primary" id="em-send">${esc(t('em.sendBtn'))}</button><button class="btn ghost" id="em-draft">🤖 ${esc(t('em.aiDraft'))}</button></div>
      </div>
    </div>`;
  $('#em-savecfg').onclick = async () => {
    await N.email.setCfg({ imapHost: $('#em-imap').value.trim(), imapPort: +$('#em-imapport').value || 993, smtpHost: $('#em-smtp').value.trim(), smtpPort: +$('#em-smtpport').value || 465, user: $('#em-user').value.trim(), from: $('#em-user').value.trim() });
    const p = $('#em-pass').value.trim(); if (p) await N.email.setPass(p);
    toast('✉️', t('em.saved'), 'ok');
  };
  bindToggle('em-enable', (v) => N.store.set('settings.emailEnabled', v));
  const loadInbox = async () => { const box = $('#em-list'); box.innerHTML = '<span class="spin">⏳</span>'; const r = await N.email.fetch(12); box.innerHTML = r.ok ? (r.messages.length ? r.messages.map((m) => `<div class="em-item ${m.seen ? '' : 'unread'}"><b>${esc(m.subject)}</b><div class="muted" style="font-size:12px">${esc(m.from)} · ${esc(m.date)}</div></div>`).join('') : `<p class="muted">${esc(t('em.noMail'))}</p>`) : `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; };
  $('#em-refresh').onclick = loadInbox;
  $('#em-send').onclick = async () => {
    const to = $('#em-to').value.trim(); if (!to) return toast('✉️', t('em.needTo'), 'err');
    if (!await confirmModal(t('em.sendConfirm'), to + ' · ' + ($('#em-subj').value || '(без темы)'))) return;
    const r = await N.email.send({ to, subject: $('#em-subj').value, body: $('#em-body').value });
    toast(r.ok ? '✅' : '⚠️', r.ok ? t('em.sent') : r.error, r.ok ? 'ok' : 'err');
  };
  $('#em-draft').onclick = async () => {
    const ctx = $('#em-body').value.trim() || $('#em-subj').value.trim(); if (!ctx) return toast('🤖', t('em.draftHint'), 'err');
    $('#em-body').value = '⏳…';
    const agents = await N.agents.list();
    const r = await N.agents.chat({ agentId: (agents[0] && agents[0].id) || 'tpl-assistant', message: 'Напиши вежливый деловой email на основе: ' + ctx + '. Только текст письма, без пояснений.', history: [], effort: 'fast' });
    $('#em-body').value = r.text || '';
  };
}

/* ---------- Подключения (GitHub / Telegram / вебхуки) ---------- */
async function viewConnections() {
  const st = await N.conn.status();
  content.innerHTML = `
    <div class="view-head"><h1>🔗 ${esc(t('conn.title'))}</h1><p>${esc(t('conn.sub'))}</p></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>🐙 GitHub ${st.github ? '<span class="mk-up" style="font-size:12px">● ' + esc(t('conn.connected')) + '</span>' : ''}</h3>
        <label class="field"><span>${esc(t('conn.token'))}</span><input id="gh-token" type="password" placeholder="${st.github ? '•••••• (сохранён)' : 'ghp_…'}"></label>
        <div class="row" style="gap:6px"><button class="btn primary" id="gh-save">${esc(t('conn.saveToken'))}</button><button class="btn ghost" id="gh-load">${esc(t('conn.loadRepos'))}</button></div>
        <p class="muted" style="font-size:11px;margin-top:6px">${esc(t('conn.ghHint'))}</p>
        <div id="gh-result" style="margin-top:10px"></div>
      </div>
      <div class="card">
        <h3>✈️ Telegram ${st.telegram ? '<span class="mk-up" style="font-size:12px">●</span>' : ''}</h3>
        <label class="field"><span>${esc(t('conn.botToken'))}</span><input id="tg-token" type="password" placeholder="123456:ABC…"></label>
        <label class="field"><span>Chat ID</span><input id="tg-chat" value="${esc(st.telegramChat || '')}" placeholder="123456789"></label>
        <div class="row" style="gap:6px"><button class="btn primary" id="tg-save">${esc(t('conn.saveToken'))}</button><button class="btn ghost" id="tg-test">${esc(t('conn.test'))}</button></div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h3>🪝 ${esc(t('conn.webhook'))}</h3>
        <div class="row" style="gap:8px"><input id="wh-url" placeholder="https://hooks.example.com/..." style="flex:2"><input id="wh-msg" placeholder="${esc(t('conn.message'))}" style="flex:1"><button class="btn" id="wh-send">${esc(t('conn.sendWh'))}</button></div>
        <p class="muted" style="font-size:11px;margin-top:6px">${esc(t('conn.whHint'))}</p>
      </div>
    </div>`;
  $('#gh-save').onclick = async () => { const tk = $('#gh-token').value.trim(); if (tk) await N.conn.setToken('github', tk); $('#gh-token').value = ''; const u = await N.conn.githubUser(); toast(u.ok ? '✅ GitHub' : '⚠️', u.ok ? '@' + u.login : u.error, u.ok ? 'ok' : 'err'); viewConnections(); };
  $('#gh-load').onclick = async () => {
    const box = $('#gh-result'); box.innerHTML = '<span class="spin">⏳</span>';
    const r = await N.conn.githubRepos();
    if (!r.ok) { box.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
    box.innerHTML = r.repos.map((x) => `<div class="gh-repo"><a data-link="${esc(x.url)}"><b>${esc(x.full)}</b></a> ⭐${x.stars} ${esc(x.lang || '')} <span class="muted">· ${x.open_issues} issues</span><div class="muted" style="font-size:12px">${esc(x.desc || '')}</div></div>`).join('');
    $$('#gh-result [data-link]').forEach((a) => a.onclick = () => N.system.openExternal(a.dataset.link));
  };
  $('#tg-save').onclick = async () => { const tk = $('#tg-token').value.trim(); if (tk) await N.conn.setToken('telegram', tk); await N.conn.set('telegramChat', $('#tg-chat').value.trim()); $('#tg-token').value = ''; toast('✈️', t('em.saved'), 'ok'); };
  $('#tg-test').onclick = async () => { const r = await N.conn.telegramTest(); toast(r.ok ? '✅' : '⚠️', r.ok ? t('conn.tgSent') : r.error, r.ok ? 'ok' : 'err'); };
  $('#wh-send').onclick = async () => { const url = $('#wh-url').value.trim(); if (!url) return; const r = await N.conn.webhook(url, $('#wh-msg').value.trim()); toast(r.ok ? '✅' : '⚠️', r.ok ? 'OK ' + r.status : r.error, r.ok ? 'ok' : 'err'); };
}

/* ---------- Конструктор моделей (Modelfile) ---------- */
async function modelBuilderModal() {
  const models = await N.installer.listModels();
  const opts = (models.length ? models.map((m) => m.name) : ['qwen2.5:7b', 'llama3.2:3b']).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  modal(`<h2>🛠️ ${esc(t('mb.title'))}</h2>
    <label class="field"><span>${esc(t('mb.name'))}</span><input id="mb-name" placeholder="my-assistant"></label>
    <label class="field"><span>${esc(t('mb.base'))}</span><select id="mb-base">${opts}</select></label>
    <label class="field"><span>${esc(t('mb.system'))}</span><textarea id="mb-system" rows="3" placeholder="Ты — ..."></textarea></label>
    <div class="row" style="gap:8px">
      <label class="field" style="max-width:130px"><span>temperature</span><input id="mb-temp" type="number" step="0.1" value="0.7"></label>
      <label class="field" style="max-width:130px"><span>num_ctx</span><input id="mb-ctx" type="number" value="4096"></label>
    </div>
    <details style="margin:6px 0"><summary class="muted" style="cursor:pointer">${esc(t('mb.preview'))}</summary><pre id="mb-prev" class="code-out" style="margin-top:6px"></pre></details>
    <pre id="mb-log" class="code-out" style="display:none;max-height:160px"></pre>
    <div class="modal-actions"><button class="btn ghost" id="mb-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="mb-go">${esc(t('mb.build'))}</button></div>`,
    (m, close) => {
      const opt = () => ({ name: $('#mb-name', m).value, base: $('#mb-base', m).value, system: $('#mb-system', m).value, params: { temperature: $('#mb-temp', m).value, num_ctx: $('#mb-ctx', m).value } });
      const upd = async () => { $('#mb-prev', m).textContent = await N.mb.preview(opt()); };
      ['#mb-name', '#mb-base', '#mb-system', '#mb-temp', '#mb-ctx'].forEach((s) => { const el2 = $(s, m); if (el2) el2.oninput = upd; }); upd();
      $('#mb-cancel', m).onclick = close;
      $('#mb-go', m).onclick = async () => {
        const o = opt(); if (!o.name.trim()) return toast('🛠️', t('mb.needName'), 'err');
        const log = $('#mb-log', m); log.style.display = 'block'; log.textContent = '⏳ ' + t('mb.building') + '\n';
        window.__mbLog = log;
        $('#mb-go', m).disabled = true;
        const r = await N.mb.create(o);
        $('#mb-go', m).disabled = false;
        if (r.ok) { toast('✅', t('mb.done') + ': ' + r.name, 'ok'); close(); render(); }
        else { log.textContent += '\n❌ ' + r.error; }
      };
    });
}
N.on('mb:log', ({ line }) => { if (window.__mbLog) { window.__mbLog.textContent += line; window.__mbLog.scrollTop = window.__mbLog.scrollHeight; } });

/* ---------- Плейграунд моделей (A/B сравнение) ---------- */
async function viewPlayground() {
  const models = await N.installer.listModels();
  if (!state.pgPicks) state.pgPicks = models.slice(0, 2).map((m) => m.name);
  content.innerHTML = `
    <div class="view-head"><h1>⚖️ ${esc(t('pg.title'))}</h1><p>${esc(t('pg.sub'))}</p></div>
    <div class="card">
      <p class="muted" style="margin-bottom:8px">${esc(t('pg.pick'))}</p>
      <div id="pg-models" class="pg-models">${models.length ? models.map((m) => `<label class="pg-chip"><input type="checkbox" value="${esc(m.name)}" ${state.pgPicks.includes(m.name) ? 'checked' : ''}> ${esc(m.name)}</label>`).join('') : `<span class="muted">${esc(t('pg.noModels'))}</span>`}</div>
      <label class="field" style="margin-top:10px"><span>${esc(t('pg.prompt'))}</span><textarea id="pg-prompt" rows="3" placeholder="${esc(t('pg.promptPh'))}"></textarea></label>
      <button class="btn primary" id="pg-run">▶ ${esc(t('pg.run'))}</button>
    </div>
    <div id="pg-results" class="pg-results"></div>`;
  $$('#pg-models input').forEach((c) => c.onchange = () => { state.pgPicks = $$('#pg-models input:checked').map((x) => x.value); });
  $('#pg-run').onclick = async () => {
    const prompt = $('#pg-prompt').value.trim(); if (!prompt) return;
    const picks = $$('#pg-models input:checked').map((x) => x.value);
    if (!picks.length) return toast('⚖️', t('pg.pickAtLeast'), 'err');
    const box = $('#pg-results');
    box.innerHTML = picks.map((m, i) => `<div class="card pg-col"><div class="pg-col-head"><b>${esc(m)}</b><span class="pg-stat" id="pg-stat-${i}">⏳</span></div><div class="pg-out" id="pg-out-${i}"><span class="spin">⏳</span></div></div>`).join('');
    box.className = 'pg-results cols-' + Math.min(picks.length, 3);
    picks.forEach(async (m, i) => {
      const r = await N.playground.ask(m, prompt);
      const out = $('#pg-out-' + i), stat = $('#pg-stat-' + i);
      if (!out) return;
      if (r.ok) { out.textContent = r.text || '(пусто)'; stat.textContent = `${(r.ms / 1000).toFixed(1)}с · ${r.tokens} ток · ${r.tps} ток/с`; }
      else { out.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; stat.textContent = '—'; }
    });
  };
}

/* ---------- Диагностика системы ---------- */
async function viewDiagnostics() {
  content.innerHTML = `
    <div class="view-head"><h1>🩺 ${esc(t('diag.title'))}</h1><p>${esc(t('diag.sub'))}</p></div>
    <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div id="diag-summary" class="muted">${esc(t('diag.running'))}</div><button class="btn ghost sm" id="diag-refresh">↻ ${esc(t('diag.refresh'))}</button></div></div>
    <div id="diag-list"></div>`;
  $('#diag-refresh').onclick = viewDiagnostics;
  const r = await N.diag.run();
  const ic = { ok: '✅', warn: '⚠️', off: '⛔' };
  $('#diag-summary').innerHTML = `<b>${r.summary.ok}/${r.summary.total}</b> ${esc(t('diag.okOf'))}`;
  $('#diag-list').innerHTML = r.checks.map((c) => `
    <div class="card diag-item diag-${c.status}">
      <div class="diag-row"><span class="diag-ic">${ic[c.status]}</span><b>${esc(c.label)}</b><span class="diag-detail">${esc(c.detail)}</span></div>
      ${c.hint && c.status !== 'ok' ? `<div class="diag-hint">💡 ${esc(c.hint)}</div>` : ''}
    </div>`).join('');
}

/* ---------- Генерация изображений (Stable Diffusion) ---------- */
async function viewImages() {
  if (!state.imgGallery) state.imgGallery = [];
  content.innerHTML = `
    <div class="view-head"><h1>🎨 ${esc(t('img.title'))}</h1><p>${esc(t('img.sub'))}</p></div>
    <div class="card" id="img-status-card"><span class="muted">${esc(t('img.checking'))}</span></div>
    <div class="grid cols-2">
      <div class="card">
        <label class="field"><span>${esc(t('img.prompt'))}</span><textarea id="img-prompt" rows="3" placeholder="a cozy cabin in the snowy mountains, golden hour, highly detailed"></textarea></label>
        <label class="field"><span>${esc(t('img.negative'))}</span><input id="img-neg" placeholder="blurry, low quality, watermark"></label>
        <div class="row" style="gap:8px">
          <label class="field" style="max-width:130px"><span>${esc(t('img.size'))}</span><select id="img-size"><option value="512x512">512×512</option><option value="768x512">768×512</option><option value="512x768">512×768</option><option value="768x768">768×768</option></select></label>
          <label class="field" style="max-width:130px"><span>${esc(t('img.steps'))}: <b id="img-steps-v">24</b></span><input type="range" id="img-steps" min="8" max="50" value="24"></label>
        </div>
        <button class="btn primary" id="img-gen">✨ ${esc(t('img.generate'))}</button>
        <a class="btn ghost sm" id="img-seturl" style="margin-left:8px">⚙️ ${esc(t('img.server'))}</a>
      </div>
      <div class="card">
        <h3>${esc(t('img.result'))}</h3>
        <div id="img-result" class="img-result"><span class="muted">${esc(t('img.resultHint'))}</span></div>
      </div>
    </div>
    <div class="card"><h3>🖼 ${esc(t('img.gallery'))}</h3><div id="img-gallery" class="img-gallery"></div></div>`;
  $('#img-steps').oninput = (e) => { $('#img-steps-v').textContent = e.target.value; };
  N.img.status().then((s) => {
    const c = $('#img-status-card'); if (!c) return;
    c.innerHTML = s.ok ? `<span class="mk-up">✅ ${esc(t('img.connected'))}</span> <span class="muted">${esc((s.current || '').toString().slice(0, 60))}</span>` : `<span class="mk-down">⚠️ ${esc(s.error)}</span> <span class="muted">${esc(t('img.needServer'))}</span>`;
  });
  $('#img-seturl').onclick = async () => {
    const cur = await N.store.get('settings.sdUrl', 'http://127.0.0.1:7860');
    const url = await promptModal(t('img.server'), 'http://127.0.0.1:7860', cur);
    if (url) { await N.store.set('settings.sdUrl', url.trim()); viewImages(); }
  };
  $('#img-gen').onclick = async () => {
    const prompt = $('#img-prompt').value.trim(); if (!prompt) return;
    const [w, h] = $('#img-size').value.split('x').map(Number);
    const box = $('#img-result'); box.innerHTML = `<div class="img-loading"><span class="spin">⏳</span> ${esc(t('img.generating'))}</div>`;
    $('#img-gen').disabled = true;
    const r = await N.img.generate({ prompt, negative: $('#img-neg').value.trim(), width: w, height: h, steps: +$('#img-steps').value });
    $('#img-gen').disabled = false;
    if (!r.ok) { box.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
    const src = 'data:image/png;base64,' + r.base64;
    box.innerHTML = `<img class="img-out" src="${src}"><div class="row" style="gap:6px;margin-top:8px"><button class="btn ghost sm" id="img-dl">⬇ ${esc(t('img.save'))}</button><span class="muted" style="font-size:11px">seed ${r.seed != null ? r.seed : '?'}</span></div>`;
    $('#img-dl').onclick = () => { const a = document.createElement('a'); a.href = src; a.download = 'mythera-' + Date.now() + '.png'; a.click(); };
    state.imgGallery.unshift({ src, prompt }); state.imgGallery = state.imgGallery.slice(0, 12);
    renderImgGallery();
  };
  renderImgGallery();
}
function renderImgGallery() {
  const g = $('#img-gallery'); if (!g) return;
  g.innerHTML = (state.imgGallery || []).length ? state.imgGallery.map((it) => `<img class="img-thumb" src="${it.src}" title="${esc(it.prompt)}">`).join('') : `<p class="muted">${esc(t('img.galleryEmpty'))}</p>`;
  $$('#img-gallery .img-thumb').forEach((im) => im.onclick = () => openArtifact({ kind: 'image', titleText: 'Изображение', base64: im.src.split(',')[1] }));
}

/* ---------- Мини-IDE: код ---------- */
async function viewCode() {
  if (!state.code) state.code = { openPath: null, expanded: {} };
  content.innerHTML = `
    <div class="view-head"><h1>📝 ${esc(t('code.title'))}</h1><p>${esc(t('code.sub'))}</p></div>
    <div class="code-layout">
      <div class="card code-tree-card">
        <div class="row" style="justify-content:space-between;align-items:center"><b>${esc(t('code.files'))}</b>
          <span><button class="btn ghost sm" id="code-new">＋</button><button class="btn ghost sm" id="code-refresh">↻</button></span></div>
        <div id="code-tree" class="code-tree"></div>
      </div>
      <div class="card code-edit-card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <b id="code-fname" class="muted">${esc(t('code.noFile'))}</b>
          <span><button class="btn sm" id="code-save" disabled>💾 ${esc(t('code.save'))}</button><button class="btn primary sm" id="code-run" disabled>▶ ${esc(t('code.run'))}</button></span></div>
        <textarea id="code-editor" class="code-editor" spellcheck="false" placeholder="${esc(t('code.editorHint'))}"></textarea>
        <div class="code-out-head">${esc(t('code.output'))}</div>
        <pre id="code-out" class="code-out"></pre>
      </div>
    </div>`;
  await refreshTree();
  $('#code-refresh').onclick = refreshTree;
  $('#code-new').onclick = async () => {
    const name = await promptModal(t('code.newFile'), 'script.py');
    if (!name) return; const r = await N.ws.create(name, false);
    if (r.ok) { await refreshTree(); openCodeFile(r.path); } else toast('⚠️', r.error, 'err');
  };
  $('#code-save').onclick = saveCodeFile;
  $('#code-run').onclick = runCodeFile;
  $('#code-editor').oninput = () => { const s = $('#code-save'); if (s) s.disabled = !state.code.openPath; };
  $('#code-editor').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCodeFile(); } });
}
async function refreshTree() {
  const box = $('#code-tree'); if (!box) return;
  const tree = await N.ws.tree();
  box.innerHTML = tree.length ? treeHTML(tree) : `<p class="muted" style="font-size:12px">${esc(t('code.empty'))}</p>`;
  $$('#code-tree [data-file]').forEach((el2) => el2.onclick = () => openCodeFile(el2.dataset.file));
  $$('#code-tree [data-dir]').forEach((el2) => el2.onclick = () => { state.code.expanded[el2.dataset.dir] = !state.code.expanded[el2.dataset.dir]; refreshTree(); });
}
function treeHTML(nodes, depth = 0) {
  return nodes.map((n) => {
    const pad = `style="padding-left:${depth * 12 + 4}px"`;
    if (n.dir) {
      const open = state.code.expanded[n.path];
      return `<div class="tree-node tree-dir" data-dir="${esc(n.path)}" ${pad}>${open ? '📂' : '📁'} ${esc(n.name)}</div>` + (open && n.children ? treeHTML(n.children, depth + 1) : '');
    }
    return `<div class="tree-node tree-file ${state.code.openPath === n.path ? 'active' : ''}" data-file="${esc(n.path)}" ${pad}>📄 ${esc(n.name)}</div>`;
  }).join('');
}
async function openCodeFile(path) {
  const r = await N.ws.read(path);
  if (!r.ok) { toast('⚠️', r.error, 'err'); return; }
  state.code.openPath = path;
  $('#code-editor').value = r.content;
  $('#code-fname').textContent = path; $('#code-fname').classList.remove('muted');
  $('#code-save').disabled = true; $('#code-run').disabled = false;
  $$('#code-tree .tree-file').forEach((el2) => el2.classList.toggle('active', el2.dataset.file === path));
}
async function saveCodeFile() {
  if (!state.code.openPath) return;
  const r = await N.ws.write(state.code.openPath, $('#code-editor').value);
  if (r.ok) { $('#code-save').disabled = true; toast('💾', t('code.saved'), 'ok'); } else toast('⚠️', r.error, 'err');
}
async function runCodeFile() {
  if (!state.code.openPath) return;
  await saveCodeFile();
  const out = $('#code-out'); out.textContent = '⏳…';
  const r = await N.ws.run(state.code.openPath);
  out.textContent = String(r);
}

/* ---------- Рынки: акции / фьючерсы / крипта / форекс / индексы ---------- */
const MARKET_PRESETS = [
  { label: 'Акции', items: [['AAPL', 'Apple'], ['TSLA', 'Tesla'], ['NVDA', 'NVIDIA'], ['MSFT', 'Microsoft'], ['SBER.ME', 'Сбер']] },
  { label: 'Крипта', items: [['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ethereum'], ['SOL-USD', 'Solana']] },
  { label: 'Фьючерсы', items: [['ES=F', 'S&P 500'], ['NQ=F', 'Nasdaq'], ['CL=F', 'Нефть'], ['GC=F', 'Золото']] },
  { label: 'Форекс', items: [['EURUSD=X', 'EUR/USD'], ['RUB=X', 'USD/RUB']] },
  { label: 'Индексы', items: [['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^DJI', 'Dow Jones'], ['IMOEX.ME', 'МосБиржа']] }
];
const MARKET_INTERVALS = [['5m', '5м'], ['15m', '15м'], ['1h', '1ч'], ['1d', '1д'], ['1wk', '1н']];
const MARKET_RANGES = [['5d', '5д'], ['1mo', '1мес'], ['3mo', '3мес'], ['6mo', '6мес'], ['1y', '1г'], ['5y', '5л'], ['max', 'макс']];

async function viewMarkets() {
  if (!state.market) state.market = { symbol: 'AAPL', interval: '1d', range: '6mo', sma20: true, sma50: true };
  const mk = state.market;
  const presetHTML = MARKET_PRESETS.map((g) => `<div class="mk-preset-group"><span class="mk-preset-label">${esc(g.label)}</span>${g.items.map(([s, n]) => `<button class="mk-chip" data-sym="${esc(s)}" title="${esc(n)}">${esc(s)}</button>`).join('')}</div>`).join('');
  content.innerHTML = `
    <div class="view-head"><h1>📈 ${esc(t('mkt.title'))}</h1><p>${esc(t('mkt.sub'))}</p></div>
    <div class="card">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="flex:1;min-width:180px"><span>${esc(t('mk.symbol'))}</span>
          <div class="row"><input id="mk-sym" value="${esc(mk.symbol)}" placeholder="AAPL, BTC-USD, ES=F…"><button class="btn" id="mk-load">${esc(t('mk.load'))}</button></div></label>
        <label class="field" style="max-width:120px"><span>${esc(t('mk.interval'))}</span><select id="mk-int">${MARKET_INTERVALS.map(([v, l]) => `<option value="${v}" ${v === mk.interval ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field" style="max-width:120px"><span>${esc(t('mk.range'))}</span><select id="mk-rng">${MARKET_RANGES.map(([v, l]) => `<option value="${v}" ${v === mk.range ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="btn primary" id="mk-analyze">🧠 ${esc(t('mk.analyze'))}</button>
      </div>
      <div class="mk-presets">${presetHTML}</div>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div id="mk-quote" class="mk-quote">—</div>
        <div class="row" style="gap:10px">
          <label class="mk-ind"><input type="checkbox" id="mk-sma20" ${mk.sma20 ? 'checked' : ''}> SMA20</label>
          <label class="mk-ind"><input type="checkbox" id="mk-sma50" ${mk.sma50 ? 'checked' : ''}> SMA50</label>
          <button class="btn ghost sm" id="mk-watch">⭐ ${esc(t('mk.watch'))}</button>
        </div>
      </div>
      <div class="mk-chart-wrap"><canvas id="mk-canvas"></canvas><div id="mk-loading" class="mk-loading">${esc(t('mk.loading'))}</div></div>
    </div>
    <div class="card">
      <h3>🧪 ${esc(t('bt.title'))}</h3>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="max-width:200px"><span>${esc(t('bt.strategy'))}</span><select id="bt-strat"></select></label>
        <div id="bt-params" class="row" style="gap:8px;flex-wrap:wrap"></div>
        <button class="btn primary" id="bt-run">▶ ${esc(t('bt.run'))}</button>
        <button class="btn ghost" id="bt-opt">🔧 ${esc(t('bt.optimize'))}</button>
      </div>
      <div id="bt-result" style="margin-top:12px"></div>
      <p class="muted" style="font-size:11px;margin-top:8px">${esc(t('bt.note'))}</p>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>⭐ ${esc(t('mk.watchlist'))}</h3><div id="mk-wl"></div></div>
      <div class="card"><div class="row between"><h3>🧠 ${esc(t('mk.aiTitle'))}</h3><button class="btn ghost sm" id="mk-deep">🔬 ${esc(t('mk.deep'))}</button></div><div id="mk-ai" class="mk-ai muted">${esc(t('mk.aiHint'))}</div></div>
      <div class="card" style="grid-column:1/-1"><h3>🔔 ${esc(t('al.title'))}</h3>
        <div class="row" style="gap:6px;flex-wrap:wrap;align-items:flex-end">
          <label class="field" style="max-width:120px"><span>${esc(t('al.ticker'))}</span><input id="al-sym" placeholder="AAPL"></label>
          <label class="field" style="max-width:170px"><span>${esc(t('al.cond'))}</span><select id="al-type"><option value="price_above">${esc(t('al.priceAbove'))}</option><option value="price_below">${esc(t('al.priceBelow'))}</option><option value="rsi_above">RSI ≥</option><option value="rsi_below">RSI ≤</option></select></label>
          <label class="field" style="max-width:100px"><span>${esc(t('al.value'))}</span><input id="al-val" type="number"></label>
          <button class="btn" id="al-add">＋ ${esc(t('al.add'))}</button>
        </div>
        <div id="al-list" style="margin-top:10px"></div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <div class="row" style="justify-content:space-between;align-items:center"><h3>📰 ${esc(t('news.title'))}</h3><button class="btn ghost sm" id="mk-sentiment">🧠 ${esc(t('news.sentiment'))}</button></div>
        <div id="mk-sent" class="muted" style="margin:6px 0;font-size:13px"></div>
        <div id="mk-news" class="mk-news muted">${esc(t('news.hint'))}</div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <div class="row between"><h3>🔎 ${esc(t('sc.title'))}</h3><span id="sc-breadth" class="muted" style="font-size:12px"></span></div>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin:6px 0">
          ${[['dip', '📉 ' + t('sc.dip')], ['momentum', '🚀 ' + t('sc.momentum')], ['breakout', '⚡ ' + t('sc.breakout')], ['trend', '📈 ' + t('sc.trend')]].map(([id, lbl]) => `<button class="btn ghost sm" data-screen="${id}">${esc(lbl)}</button>`).join('')}
        </div>
        <div id="sc-result" class="muted">${esc(t('sc.hint'))}</div>
      </div>
    </div>`;

  N.screener.breadth().then((b) => { const el2 = $('#sc-breadth'); if (el2 && b.ok) el2.innerHTML = `🌡 ${esc(t('sc.breadthLbl'))}: <b class="${b.regime === 'risk-on' ? 'mk-up' : 'mk-down'}">${b.pct}% — ${esc(b.label)}</b>`; });
  const SC_FILTERS = { dip: { rsiMax: 35 }, momentum: { trendUp: true, minChange: 5 }, breakout: { breakout: true }, trend: { trendUp: true } };
  $$('#content [data-screen]').forEach((b) => b.onclick = async () => {
    const box = $('#sc-result'); box.classList.remove('muted'); box.innerHTML = '<span class="spin">⏳</span> ' + esc(t('sc.scanning'));
    const r = await N.screener.scan(SC_FILTERS[b.dataset.screen]);
    box.innerHTML = r.matches.length ? `<table class="data-tbl"><tr><th>Тикер</th><th>Цена</th><th>RSI</th><th>Тренд</th><th>Мес%</th></tr>${r.matches.slice(0, 15).map((m) => `<tr><td><a class="wikilink" data-loadsym="${esc(m.symbol)}">${esc(m.symbol)}</a></td><td>${m.price}</td><td>${m.rsi}</td><td class="${m.trend === 'up' ? 'mk-up' : 'mk-down'}">${m.trend}</td><td class="${m.change1m >= 0 ? 'mk-up' : 'mk-down'}">${m.change1m >= 0 ? '+' : ''}${m.change1m}%</td></tr>`).join('')}</table>` : `<span class="muted">${esc(t('sc.none'))}</span>`;
    $$('#sc-result [data-loadsym]').forEach((a) => a.onclick = () => { mk.symbol = a.dataset.loadsym; $('#mk-sym').value = mk.symbol; loadMarket(); });
  });

  const load = async (sym) => { if (sym) mk.symbol = sym; mk.interval = $('#mk-int').value; mk.range = $('#mk-rng').value; $('#mk-sym').value = mk.symbol; await loadMarket(); };
  $('#mk-load').onclick = () => load($('#mk-sym').value.trim());
  $('#mk-sym').addEventListener('keydown', (e) => { if (e.key === 'Enter') load($('#mk-sym').value.trim()); });
  $('#mk-int').onchange = () => load();
  $('#mk-rng').onchange = () => load();
  $$('#content .mk-chip').forEach((b) => b.onclick = () => load(b.dataset.sym));
  $('#mk-sma20').onchange = (e) => { mk.sma20 = e.target.checked; drawMarket(); };
  $('#mk-sma50').onchange = (e) => { mk.sma50 = e.target.checked; drawMarket(); };
  $('#mk-watch').onclick = addToWatchlist;
  $('#mk-analyze').onclick = analyzeMarket;
  $('#mk-deep').onclick = deepAnalyzeMarket;
  $('#mk-sentiment').onclick = analyzeSentiment;
  $('#al-add').onclick = async () => {
    const sym = ($('#al-sym').value.trim() || mk.symbol); const val = +$('#al-val').value;
    if (!sym || !val) return toast('🔔', t('al.need'), 'err');
    await N.alerts.save({ symbol: sym, type: $('#al-type').value, value: val });
    $('#al-val').value = ''; renderAlerts();
  };
  $('#al-sym').value = mk.symbol;
  renderAlerts();
  window.addEventListener('resize', drawMarket);
  await renderWatchlist();
  await initBacktest();
  await loadMarket();
  // Авто-обновление текущего тикера.
  if (window.__marketTimer) clearInterval(window.__marketTimer);
  window.__marketTimer = setInterval(() => { if (state.view === 'markets') loadMarket(true); }, 45000);
}

async function initBacktest() {
  const strats = await N.backtest.strategies();
  const sel = $('#bt-strat'); if (!sel) return;
  sel.innerHTML = strats.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  const renderParams = () => {
    const s = strats.find((x) => x.id === sel.value) || strats[0];
    $('#bt-params').innerHTML = s.params.map(([key, label, def]) => `<label class="field" style="max-width:120px"><span>${esc(label)}</span><input type="number" data-bp="${esc(key)}" value="${def}"></label>`).join('');
  };
  sel.onchange = renderParams; renderParams();
  $('#bt-run').onclick = runBacktest;
  $('#bt-opt').onclick = runOptimize;
}
async function runOptimize() {
  const mk = state.market; const box = $('#bt-result');
  box.innerHTML = '<span class="spin">⏳</span> ' + esc(t('bt.optimizing'));
  const r = await N.backtest.optimize({ symbol: mk.symbol, interval: mk.interval, range: mk.range, strategy: $('#bt-strat').value });
  if (!r.ok) { box.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
  box.innerHTML = `<p><b>${esc(t('bt.best'))}:</b> ${esc(JSON.stringify(r.best.params))} → <span class="${r.best.return >= 0 ? 'mk-up' : 'mk-down'}">${r.best.return}%</span> · DD -${r.best.maxDrawdown}% · ${r.best.winRate}% win</p>
    <table class="tr-pf-tbl"><tr><th>${esc(t('bt.params'))}</th><th>Return</th><th>DD</th><th>Win</th><th>Score</th></tr>${r.top.map((x) => `<tr><td>${esc(JSON.stringify(x.params))}</td><td class="${x.return >= 0 ? 'mk-up' : 'mk-down'}">${x.return}%</td><td>-${x.maxDrawdown}%</td><td>${x.winRate}%</td><td>${x.score}</td></tr>`).join('')}</table>
    <button class="btn ghost sm" id="bt-apply" style="margin-top:8px">${esc(t('bt.apply'))}</button>`;
  $('#bt-apply').onclick = () => { Object.entries(r.best.params).forEach(([k, v]) => { const i = $(`#bt-params [data-bp="${k}"]`); if (i) i.value = v; }); runBacktest(); };
}
async function runBacktest() {
  const mk = state.market;
  const params = {}; $$('#bt-params [data-bp]').forEach((i) => params[i.dataset.bp] = +i.value);
  const box = $('#bt-result'); box.innerHTML = '<span class="spin">⏳</span> ' + esc(t('bt.running'));
  const r = await N.backtest.run({ symbol: mk.symbol, interval: mk.interval, range: mk.range, strategy: $('#bt-strat').value, params });
  if (!r.ok) { box.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
  const better = r.return >= r.buyHold;
  box.innerHTML = `
    <div class="bt-stats">
      <div class="bt-stat"><span>${esc(t('bt.return'))}</span><b class="${r.return >= 0 ? 'mk-up' : 'mk-down'}">${r.return}%</b></div>
      <div class="bt-stat"><span>Buy&Hold</span><b class="${r.buyHold >= 0 ? 'mk-up' : 'mk-down'}">${r.buyHold}%</b></div>
      <div class="bt-stat"><span>${esc(t('bt.vsHold'))}</span><b class="${better ? 'mk-up' : 'mk-down'}">${better ? '▲' : '▼'} ${(r.return - r.buyHold).toFixed(2)}%</b></div>
      <div class="bt-stat"><span>${esc(t('bt.trades'))}</span><b>${r.trades}</b></div>
      <div class="bt-stat"><span>${esc(t('bt.winRate'))}</span><b>${r.winRate}%</b></div>
      <div class="bt-stat"><span>${esc(t('bt.maxDD'))}</span><b class="mk-down">-${r.maxDrawdown}%</b></div>
    </div>
    <div class="bt-chart-wrap"><canvas id="bt-canvas"></canvas></div>`;
  drawEquity(r);
}
function drawEquity(r) {
  const cv = $('#bt-canvas'); if (!cv) return;
  const wrap = cv.parentElement; const W = wrap.clientWidth; const H = 160; const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const eq = r.equity; const base = r.closes; const n = eq.length;
  const padL = 4, padR = 50, padT = 8, padB = 8; const cw = W - padL - padR, ch = H - padT - padB;
  // Нормируем кривую стратегии и buy&hold от стартового капитала.
  const start = eq[0]; const stratPct = eq.map((e) => (e / start - 1) * 100);
  const holdPct = base.map((c) => (c / base[0] - 1) * 100);
  let lo = Infinity, hi = -Infinity; for (const v of stratPct.concat(holdPct)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const x = (i) => padL + (i / (n - 1)) * cw; const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ch;
  const css = getComputedStyle(document.body); const txt = css.getPropertyValue('--muted') || '#8b93a7';
  // Нулевая линия.
  ctx.strokeStyle = 'rgba(140,150,170,.2)'; ctx.beginPath(); ctx.moveTo(padL, y(0)); ctx.lineTo(padL + cw, y(0)); ctx.stroke();
  const line = (vals, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); vals.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))); ctx.stroke(); };
  line(holdPct, 'rgba(140,150,170,.5)', 1);
  line(stratPct, r.return >= 0 ? '#26a69a' : '#ef5350', 1.8);
  ctx.fillStyle = txt; ctx.font = '10px Consolas, monospace';
  ctx.fillText(hi.toFixed(0) + '%', padL + cw + 4, y(hi) + 4);
  ctx.fillText(lo.toFixed(0) + '%', padL + cw + 4, y(lo) + 4);
}

async function loadMarket(silent) {
  const mk = state.market;
  if (!silent) { const l = $('#mk-loading'); if (l) l.style.display = 'flex'; }
  const d = await N.markets.candles({ symbol: mk.symbol, interval: mk.interval, range: mk.range });
  const l = $('#mk-loading'); if (l) l.style.display = 'none';
  if (!d.ok) { const q = $('#mk-quote'); if (q) q.innerHTML = `<span class="mk-down">⚠️ ${esc(d.error || 'нет данных')}</span>`; mk.data = null; drawMarket(); return; }
  mk.data = d;
  const c = d.candles; const last = c[c.length - 1].c; const first = c[0].c;
  const chg = ((last - first) / first) * 100; const up = chg >= 0;
  const q = $('#mk-quote');
  if (q) q.innerHTML = `<b>${esc(d.symbol)}</b> <span class="mk-price">${last.toFixed(2)} ${esc(d.currency || '')}</span> <span class="${up ? 'mk-up' : 'mk-down'}">${up ? '▲' : '▼'} ${chg.toFixed(2)}%</span> <span class="muted" style="font-size:11px">· ${esc(d.source)}</span>`;
  drawMarket();
  checkAlerts(d.symbol, last);
  if (!silent) loadNews();
}
async function loadNews() {
  const box = $('#mk-news'); if (!box) return;
  box.textContent = '…';
  const r = await N.news.fetch(state.market.symbol);
  if (!r.ok || !r.news.length) { box.innerHTML = `<span class="muted">${esc(t('news.none'))}</span>`; return; }
  box.innerHTML = r.news.slice(0, 8).map((n) => `<div class="news-item"><a data-link="${esc(n.link)}">${esc(n.title)}</a><span class="news-meta">${esc(n.publisher || '')}${n.time ? ' · ' + new Date(n.time).toLocaleDateString() : ''}</span></div>`).join('');
  $$('#mk-news [data-link]').forEach((a) => a.onclick = () => N.system.openExternal(a.dataset.link));
}
async function renderAlerts() {
  const box = $('#al-list'); if (!box) return;
  const all = await N.alerts.list();
  const lbl = { price_above: t('al.priceAbove'), price_below: t('al.priceBelow'), rsi_above: 'RSI ≥', rsi_below: 'RSI ≤' };
  box.innerHTML = all.length ? all.map((a) => `<div class="al-item"><label class="switch"><input type="checkbox" data-tg="${esc(a.id)}" ${a.enabled !== false ? 'checked' : ''}><span class="slider"></span></label><span><b>${esc(a.symbol)}</b> ${esc(lbl[a.type] || a.type)} <b>${a.value}</b></span>${a._fired ? '<span class="mk-up" style="font-size:11px">● сработал</span>' : ''}<button class="btn ghost sm" data-rm="${esc(a.id)}" style="margin-left:auto">✕</button></div>`).join('') : `<p class="muted">${esc(t('al.empty'))}</p>`;
  $$('#al-list [data-tg]').forEach((c) => c.onchange = () => N.alerts.toggle(c.dataset.tg, c.checked));
  $$('#al-list [data-rm]').forEach((b) => b.onclick = async () => { await N.alerts.remove(b.dataset.rm); renderAlerts(); });
}
async function analyzeSentiment() {
  const box = $('#mk-sent'); if (!box) return;
  box.classList.remove('muted'); box.innerHTML = '<span class="spin">⏳</span> ' + esc(t('news.analyzing'));
  const r = await N.news.sentiment(state.market.symbol);
  if (!r.ok) { box.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
  const label = r.score > 20 ? `<span class="mk-up">${t('news.positive')} (+${r.score})</span>` : r.score < -20 ? `<span class="mk-down">${t('news.negative')} (${r.score})</span>` : `<span class="muted">${t('news.neutral')} (${r.score})</span>`;
  box.innerHTML = `<b>${t('news.sentiment')}:</b> ${label}<br>${esc(r.summary)}`;
}

// Свечной график на canvas (без внешних библиотек).
function drawMarket() {
  const cv = $('#mk-canvas'); if (!cv) return;
  const mk = state.market; const data = mk.data;
  const wrap = cv.parentElement; const W = wrap.clientWidth; const H = wrap.clientHeight || 340;
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  if (!data || !data.candles.length) return;
  const css = getComputedStyle(document.body);
  const grid = 'rgba(140,150,170,.14)'; const txt = css.getPropertyValue('--muted') || '#8b93a7';
  const c = data.candles;
  const padL = 6, padR = 60, padT = 12, padB = 26, volH = 36;
  const chartW = W - padL - padR; const chartH = H - padT - padB - volH;
  let lo = Infinity, hi = -Infinity, vMax = 0;
  for (const k of c) { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; if (k.v > vMax) vMax = k.v; }
  const pad = (hi - lo) * 0.05 || 1; lo -= pad; hi += pad;
  const x = (i) => padL + (i + 0.5) * (chartW / c.length);
  const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * chartH;
  // Сетка + ценовая ось.
  ctx.strokeStyle = grid; ctx.fillStyle = txt; ctx.font = '10px Consolas, monospace'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = padT + (chartH * i) / 4; const price = hi - ((hi - lo) * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + chartW, gy); ctx.stroke();
    ctx.fillText(price.toFixed(2), padL + chartW + 4, gy + 3);
  }
  // Объёмы.
  for (let i = 0; i < c.length; i++) {
    const vh = vMax ? (c[i].v / vMax) * (volH - 4) : 0;
    ctx.fillStyle = c[i].c >= c[i].o ? 'rgba(38,166,154,.35)' : 'rgba(239,83,80,.35)';
    const bw = Math.max(1, (chartW / c.length) * 0.6);
    ctx.fillRect(x(i) - bw / 2, H - padB - vh, bw, vh);
  }
  // Свечи.
  const bw = Math.max(1, (chartW / c.length) * 0.62);
  for (let i = 0; i < c.length; i++) {
    const k = c[i]; const up = k.c >= k.o; const col = up ? '#26a69a' : '#ef5350';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(i), y(k.h)); ctx.lineTo(x(i), y(k.l)); ctx.stroke();
    const yo = y(k.o), yc = y(k.c); const top = Math.min(yo, yc); const hgt = Math.max(1, Math.abs(yc - yo));
    ctx.fillRect(x(i) - bw / 2, top, bw, hgt);
  }
  // SMA-наложения.
  const closes = c.map((k) => k.c);
  const drawLine = (vals, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath(); let started = false; for (let i = 0; i < vals.length; i++) { if (vals[i] == null) continue; const px = x(i), py = y(vals[i]); if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py); } ctx.stroke(); };
  if (mk.sma20) drawLine(smaCalc(closes, 20), '#f7b733');
  if (mk.sma50) drawLine(smaCalc(closes, 50), '#7c5cff');
  // Линия последней цены.
  const lastP = closes[closes.length - 1]; ctx.strokeStyle = 'rgba(124,92,255,.6)'; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(padL, y(lastP)); ctx.lineTo(padL + chartW, y(lastP)); ctx.stroke(); ctx.setLineDash([]);
  // Подписи дат (5 шт).
  ctx.fillStyle = txt;
  for (let i = 0; i <= 4; i++) {
    const idx = Math.round((c.length - 1) * i / 4); const d = new Date(c[idx].t);
    const lbl = (mk.interval.includes('m') || mk.interval.includes('h')) ? `${d.getDate()}.${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
    ctx.fillText(lbl, Math.min(x(idx) - 18, padL + chartW - 60), H - 6);
  }
}
function smaCalc(arr, n) { const out = []; for (let i = 0; i < arr.length; i++) { if (i < n - 1) { out.push(null); continue; } let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j]; out.push(s / n); } return out; }

async function analyzeMarket() {
  const mk = state.market; const ai = $('#mk-ai'); if (!ai) return;
  ai.classList.remove('muted'); ai.innerHTML = '<span class="spin">⏳</span> ' + esc(t('mk.analyzing'));
  const r = await N.markets.analyze({ symbol: mk.symbol, interval: mk.interval, range: mk.range });
  ai.textContent = r.ok ? r.text : ('⚠️ ' + (r.error || 'ошибка'));
}
async function deepAnalyzeMarket() {
  const mk = state.market; const ai = $('#mk-ai'); if (!ai) return;
  ai.classList.remove('muted'); ai.innerHTML = '<span class="spin">⏳</span> ' + esc(t('mk.deepRun'));
  const r = await N.analyst.deep(mk.symbol, 'moderate');
  if (!r.ok) { ai.innerHTML = `<span class="mk-down">⚠️ ${esc(r.error)}</span>`; return; }
  const vc = r.verdict === 'BUY' ? 'mk-up' : r.verdict === 'SELL' ? 'mk-down' : 'muted';
  ai.innerHTML = `<div style="margin-bottom:8px"><span class="pa-verdict ${vc}">${esc(r.verdict)}</span> <span class="muted">${esc(t('mk.confidence'))} ${r.confidence}% · ${esc(t('mk.assetNews'))} ${r.assetSentiment != null ? r.assetSentiment : 'н/д'} · ${esc(t('mk.macro'))} ${r.macroSentiment != null ? r.macroSentiment : 'н/д'}${r.context && r.context.country ? ' (' + esc(r.context.country) + ')' : ''}</span></div><div style="white-space:pre-wrap;line-height:1.5">${esc(r.text)}</div>`;
}

async function addToWatchlist() {
  const mk = state.market; if (!mk.symbol) return;
  const wl = await N.markets.watchlist();
  if (!wl.some((w) => w.symbol === mk.symbol)) { wl.push({ symbol: mk.symbol, name: (mk.data && mk.data.symbol) || mk.symbol, alert: null }); await N.markets.setWatchlist(wl); }
  renderWatchlist();
  toast('⭐', mk.symbol + ' → ' + t('mk.watchlist'), 'ok');
}
async function renderWatchlist() {
  const box = $('#mk-wl'); if (!box) return;
  const wl = await N.markets.watchlist();
  box.innerHTML = wl.length ? wl.map((w, idx) => `
    <div class="mk-wl-item">
      <span class="mk-wl-sym" data-load="${esc(w.symbol)}">${esc(w.symbol)}</span>
      <canvas class="mk-spark" id="spark-${idx}" width="80" height="22"></canvas>
      <span class="mk-wl-q" id="wlq-${idx}">…</span>
      <input class="mk-alert" data-alert="${esc(w.symbol)}" type="number" placeholder="🔔" value="${w.alert != null ? esc(w.alert) : ''}" title="${esc(t('mk.alertHint'))}">
      <button class="btn ghost sm" data-rm="${esc(w.symbol)}">✕</button>
    </div>`).join('') : `<p class="muted">${esc(t('mk.wlEmpty'))}</p>`;
  $$('#mk-wl [data-load]').forEach((s) => s.onclick = () => { state.market.symbol = s.dataset.load; $('#mk-sym').value = s.dataset.load; loadMarket(); });
  $$('#mk-wl [data-rm]').forEach((b) => b.onclick = async () => { await N.markets.setWatchlist((await N.markets.watchlist()).filter((w) => w.symbol !== b.dataset.rm)); renderWatchlist(); });
  $$('#mk-wl [data-alert]').forEach((inp) => inp.onchange = async () => { const list = await N.markets.watchlist(); const it = list.find((w) => w.symbol === inp.dataset.alert); if (it) { it.alert = inp.value ? +inp.value : null; await N.markets.setWatchlist(list); } });
  // Живые котировки + мини-график (последовательно, чтобы не перегружать API).
  for (let i = 0; i < wl.length; i++) {
    if (state.view !== 'markets') break;
    const d = await N.markets.candles({ symbol: wl[i].symbol, interval: '1d', range: '1mo' });
    const ql = $('#wlq-' + i); if (!ql) continue;
    if (!d.ok || !d.candles.length) { ql.textContent = '—'; continue; }
    const cl = d.candles.map((x) => x.c); const last = cl[cl.length - 1]; const chg = (last / cl[0] - 1) * 100;
    ql.innerHTML = `<span class="${chg >= 0 ? 'mk-up' : 'mk-down'}">${last.toFixed(2)} ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%</span>`;
    drawSparkline($('#spark-' + i), cl, chg >= 0);
  }
}
function drawSparkline(cv, vals, up) {
  if (!cv) return; const dpr = window.devicePixelRatio || 1; const W = 80, H = 22;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  ctx.strokeStyle = up ? '#26a69a' : '#ef5350'; ctx.lineWidth = 1.2; ctx.beginPath();
  vals.forEach((v, i) => { const x = (i / (vals.length - 1)) * (W - 2) + 1; const y = (1 - (v - lo) / (hi - lo)) * (H - 4) + 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
}
async function checkAlerts(symbol, price) {
  const wl = await N.markets.watchlist();
  const it = wl.find((w) => w.symbol === symbol);
  if (it && it.alert != null) {
    const key = '__alerted_' + symbol;
    if (!window[key] && ((it._last != null && ((it._last < it.alert && price >= it.alert) || (it._last > it.alert && price <= it.alert))) || Math.abs(price - it.alert) / it.alert < 0.001)) {
      toast('🔔 ' + symbol, `${t('mk.alertHit')} ${it.alert} (${price.toFixed(2)})`, 'ok');
      N.notif.add({ kind: 'alert', title: '🔔 ' + symbol, message: `${t('mk.alertHit')} ${it.alert} (${price.toFixed(2)})` });
      window[key] = true; setTimeout(() => { window[key] = false; }, 300000);
    }
    it._last = price;
  }
}

/* ---------- Автоматизация: сценарии-конвейеры + наблюдатели ---------- */
const STEP_TYPES = { agent: '🤖', tool: '🔧', notify: '🔔', speak: '🗣️', wait: '⏳' };
async function viewAutomation() {
  const tab = state.autoTab || 'flows';
  content.innerHTML = `
    <div class="view-head"><h1>🔗 ${esc(t('auto.title'))}</h1><p>${esc(t('auto.sub'))}</p></div>
    <div class="tabs"><button class="tab ${tab === 'flows' ? 'active' : ''}" data-tab="flows">🪄 ${esc(t('auto.flows'))}</button>
      <button class="tab ${tab === 'watchers' ? 'active' : ''}" data-tab="watchers">👁 ${esc(t('auto.watchers'))}</button></div>
    <div id="auto-body"></div>`;
  $$('.tabs .tab').forEach((b) => b.onclick = () => { state.autoTab = b.dataset.tab; viewAutomation(); });
  if (tab === 'flows') await renderFlows(); else await renderWatchers();
}

async function renderFlows() {
  const box = $('#auto-body');
  const flows = await N.flows.list();
  box.innerHTML = `<div class="row" style="justify-content:flex-end;margin-bottom:10px"><button class="btn primary" id="flow-new">＋ ${esc(t('auto.newFlow'))}</button></div>
    ${flows.length ? flows.map((f) => `
      <div class="card flow-card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <b>🪄 ${esc(f.name || 'Сценарий')}</b>
          <span class="muted" style="font-size:12px">${esc(t('auto.trigger'))}: ${esc(triggerLabel(f.trigger))}</span>
        </div>
        <div class="flow-steps">${(f.steps || []).map((s) => `<span class="flow-pill">${STEP_TYPES[s.type] || '•'} ${esc(s.type)}</span>`).join('<span class="flow-arrow">→</span>') || '<span class="muted">нет шагов</span>'}</div>
        <div class="row" style="gap:6px;margin-top:8px">
          <button class="btn sm" data-run="${esc(f.id)}">▶ ${esc(t('auto.run'))}</button>
          <button class="btn ghost sm" data-edit="${esc(f.id)}">✎</button>
          <button class="btn ghost sm" data-del="${esc(f.id)}">🗑</button>
          <span class="flow-status" id="flowst-${esc(f.id)}"></span>
        </div>
      </div>`).join('') : `<div class="card muted">${esc(t('auto.noFlows'))}</div>`}`;
  $('#flow-new').onclick = () => flowEditor(null);
  $$('#auto-body [data-run]').forEach((b) => b.onclick = () => { $('#flowst-' + b.dataset.run).textContent = '⏳'; N.flows.run(b.dataset.run); });
  $$('#auto-body [data-edit]').forEach((b) => b.onclick = async () => flowEditor((await N.flows.list()).find((f) => f.id === b.dataset.edit)));
  $$('#auto-body [data-del]').forEach((b) => b.onclick = async () => { if (await confirmModal(t('auto.delFlow'), t('auto.delConfirm'))) { await N.flows.remove(b.dataset.del); renderFlows(); } });
}
function triggerLabel(tr) { tr = tr || {}; if (tr.type === 'interval') return `каждые ${tr.intervalSec || 3600}с`; if (tr.type === 'startup') return 'при запуске'; return 'вручную'; }

async function flowEditor(flow) {
  const agents = await N.agents.list();
  flow = flow ? JSON.parse(JSON.stringify(flow)) : { name: '', trigger: { type: 'manual' }, steps: [], enabled: true };
  const agentOpts = (sel) => agents.map((a) => `<option value="${esc(a.id)}" ${a.id === sel ? 'selected' : ''}>${esc(a.icon || '')} ${esc(a.name)}</option>`).join('');
  const renderSteps = () => flow.steps.map((s, i) => `
    <div class="card step-card" style="margin:6px 0">
      <div class="row" style="justify-content:space-between"><b>${STEP_TYPES[s.type] || '•'} ${esc(s.type)}</b>
        <span><button class="btn ghost sm" data-up="${i}">↑</button><button class="btn ghost sm" data-down="${i}">↓</button><button class="btn ghost sm" data-rm="${i}">✕</button></span></div>
      ${s.type === 'agent' ? `<label class="field"><span>Агент</span><select data-f="agentId" data-i="${i}">${agentOpts(s.agentId)}</select></label>
        <label class="field"><span>Промпт (исп. {input})</span><textarea data-f="prompt" data-i="${i}" rows="2">${esc(s.prompt || '')}</textarea></label>` : ''}
      ${s.type === 'tool' ? `<label class="field"><span>Инструмент/скил</span><input data-f="tool" data-i="${i}" value="${esc(s.tool || '')}" placeholder="web_search"></label>
        <label class="field"><span>Аргументы (JSON, {input})</span><input data-f="args" data-i="${i}" value="${esc(typeof s.args === 'string' ? s.args : JSON.stringify(s.args || {}))}"></label>` : ''}
      ${s.type === 'notify' ? `<label class="field"><span>Заголовок</span><input data-f="title" data-i="${i}" value="${esc(s.title || '')}"></label>
        <label class="field"><span>Текст ({input})</span><input data-f="message" data-i="${i}" value="${esc(s.message || '')}"></label>` : ''}
      ${s.type === 'speak' ? `<label class="field"><span>Текст ({input})</span><input data-f="text" data-i="${i}" value="${esc(s.text || '')}"></label>` : ''}
      ${s.type === 'wait' ? `<label class="field"><span>Секунд</span><input type="number" data-f="seconds" data-i="${i}" value="${esc(s.seconds || 2)}"></label>` : ''}
    </div>`).join('');
  modal(`<h2>${esc(t('auto.flowEdit'))}</h2>
    <label class="field"><span>${esc(t('auto.name'))}</span><input id="fe-name" value="${esc(flow.name)}"></label>
    <label class="field"><span>${esc(t('auto.trigger'))}</span><select id="fe-trig">
      <option value="manual" ${flow.trigger.type === 'manual' ? 'selected' : ''}>Вручную</option>
      <option value="startup" ${flow.trigger.type === 'startup' ? 'selected' : ''}>При запуске</option>
      <option value="interval" ${flow.trigger.type === 'interval' ? 'selected' : ''}>По интервалу</option>
    </select></label>
    <label class="field" id="fe-int-wrap" style="${flow.trigger.type === 'interval' ? '' : 'display:none'}"><span>Интервал, сек</span><input type="number" id="fe-int" value="${esc(flow.trigger.intervalSec || 3600)}"></label>
    <div id="fe-steps">${renderSteps()}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:8px 0">${Object.keys(STEP_TYPES).map((k) => `<button class="btn ghost sm" data-add="${k}">＋ ${STEP_TYPES[k]} ${k}</button>`).join('')}</div>
    <div class="modal-actions"><button class="btn ghost" id="fe-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="fe-save">${esc(t('btn.save'))}</button></div>`,
    (m, close) => {
      const reRender = () => { $('#fe-steps', m).innerHTML = renderSteps(); wire(); };
      const wire = () => {
        $$('[data-add]', m).forEach((b) => b.onclick = () => { flow.steps.push({ type: b.dataset.add }); reRender(); });
        $$('[data-rm]', m).forEach((b) => b.onclick = () => { flow.steps.splice(+b.dataset.rm, 1); reRender(); });
        $$('[data-up]', m).forEach((b) => b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [flow.steps[i - 1], flow.steps[i]] = [flow.steps[i], flow.steps[i - 1]]; reRender(); } });
        $$('[data-down]', m).forEach((b) => b.onclick = () => { const i = +b.dataset.down; if (i < flow.steps.length - 1) { [flow.steps[i + 1], flow.steps[i]] = [flow.steps[i], flow.steps[i + 1]]; reRender(); } });
        $$('[data-f]', m).forEach((inp) => inp.onchange = () => { flow.steps[+inp.dataset.i][inp.dataset.f] = inp.value; });
      };
      wire();
      $('#fe-trig', m).onchange = (e) => { $('#fe-int-wrap', m).style.display = e.target.value === 'interval' ? '' : 'none'; };
      $('#fe-cancel', m).onclick = close;
      $('#fe-save', m).onclick = async () => {
        flow.name = $('#fe-name', m).value.trim() || 'Сценарий';
        const tt = $('#fe-trig', m).value;
        flow.trigger = tt === 'interval' ? { type: 'interval', intervalSec: +$('#fe-int', m).value || 3600 } : { type: tt };
        await N.flows.save(flow); close(); renderFlows();
      };
    });
}
N.on('flow:start', ({ flowId, name }) => { const s = $('#flowst-' + flowId); if (s) s.textContent = '⏳ ' + (name || ''); });
N.on('flow:step', ({ flowId, index, state: st }) => { const s = $('#flowst-' + flowId); if (s) s.textContent = `шаг ${index + 1}: ${st}`; });
N.on('flow:done', ({ flowId, ok }) => { const s = $('#flowst-' + flowId); if (s) s.textContent = ok ? '✅ готово' : '❌ ошибка'; });

async function renderWatchers() {
  const box = $('#auto-body');
  const ws = await N.watchers.list();
  const agents = await N.agents.list();
  box.innerHTML = `<div class="row" style="justify-content:flex-end;margin-bottom:10px"><button class="btn primary" id="w-new">＋ ${esc(t('auto.newWatcher'))}</button></div>
    ${ws.length ? ws.map((w) => `
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <b>👁 ${esc(w.name || 'Наблюдатель')}</b>
          <label class="switch"><input type="checkbox" data-tg="${esc(w.id)}" ${w.enabled !== false ? 'checked' : ''}><span class="slider"></span></label>
        </div>
        <p class="muted" style="font-size:12px;margin:6px 0">${esc(watcherLabel(w))}</p>
        <div class="row" style="gap:6px"><button class="btn sm" data-fire="${esc(w.id)}">▶ ${esc(t('auto.runNow'))}</button>
          <button class="btn ghost sm" data-edit="${esc(w.id)}">✎</button><button class="btn ghost sm" data-del="${esc(w.id)}">🗑</button></div>
      </div>`).join('') : `<div class="card muted">${esc(t('auto.noWatchers'))}</div>`}`;
  $('#w-new').onclick = () => watcherEditor(null, agents);
  $$('#auto-body [data-tg]').forEach((c) => c.onchange = () => N.watchers.toggle(c.dataset.tg, c.checked));
  $$('#auto-body [data-fire]').forEach((b) => b.onclick = () => { N.watchers.fireNow(b.dataset.fire); toast('👁', t('auto.fired'), 'ok'); });
  $$('#auto-body [data-edit]').forEach((b) => b.onclick = async () => watcherEditor(ws.find((w) => w.id === b.dataset.edit), agents));
  $$('#auto-body [data-del]').forEach((b) => b.onclick = async () => { if (await confirmModal(t('auto.delWatcher'), t('auto.delConfirm'))) { await N.watchers.remove(b.dataset.del); renderWatchers(); } });
}
function watcherLabel(w) {
  if (w.type === 'folder') return `📁 Папка: ${w.path || '?'} → агент при изменении`;
  if (w.type === 'interval') return `⏱ Каждые ${w.intervalSec || 3600}с → агент`;
  if (w.type === 'disk') return `💽 Диск ${w.path || '~'}: тревога ниже ${w.thresholdPct || 10}%`;
  return w.type;
}
async function watcherEditor(w, agents) {
  w = w ? JSON.parse(JSON.stringify(w)) : { name: '', type: 'folder', enabled: true, agentId: 'tpl-assistant', prompt: '', intervalSec: 3600, thresholdPct: 10 };
  const agentOpts = agents.map((a) => `<option value="${esc(a.id)}" ${a.id === w.agentId ? 'selected' : ''}>${esc(a.icon || '')} ${esc(a.name)}</option>`).join('');
  modal(`<h2>${esc(t('auto.watcherEdit'))}</h2>
    <label class="field"><span>${esc(t('auto.name'))}</span><input id="we-name" value="${esc(w.name)}"></label>
    <label class="field"><span>${esc(t('auto.type'))}</span><select id="we-type">
      <option value="folder" ${w.type === 'folder' ? 'selected' : ''}>📁 Папка</option>
      <option value="interval" ${w.type === 'interval' ? 'selected' : ''}>⏱ Интервал</option>
      <option value="disk" ${w.type === 'disk' ? 'selected' : ''}>💽 Свободное место</option>
    </select></label>
    <label class="field we-path" style="${w.type === 'disk' || w.type === 'folder' ? '' : 'display:none'}"><span>${esc(t('auto.path'))}</span><div class="row"><input id="we-path" value="${esc(w.path || '')}" placeholder="C:\\Users\\...\\Downloads"><button class="btn ghost" id="we-pick">📂</button></div></label>
    <label class="field we-int" style="${w.type === 'interval' || w.type === 'disk' ? '' : 'display:none'}"><span>Интервал, сек</span><input type="number" id="we-int" value="${esc(w.intervalSec || 3600)}"></label>
    <label class="field we-thr" style="${w.type === 'disk' ? '' : 'display:none'}"><span>Порог, %</span><input type="number" id="we-thr" value="${esc(w.thresholdPct || 10)}"></label>
    <label class="field"><span>${esc(t('auto.agent'))}</span><select id="we-agent">${agentOpts}</select></label>
    <label class="field"><span>${esc(t('auto.prompt'))} ({event})</span><textarea id="we-prompt" rows="2">${esc(w.prompt || '')}</textarea></label>
    <div class="modal-actions"><button class="btn ghost" id="we-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="we-save">${esc(t('btn.save'))}</button></div>`,
    (m, close) => {
      $('#we-type', m).onchange = (e) => {
        const v = e.target.value;
        $('.we-path', m).style.display = (v === 'folder' || v === 'disk') ? '' : 'none';
        $('.we-int', m).style.display = (v === 'interval' || v === 'disk') ? '' : 'none';
        $('.we-thr', m).style.display = v === 'disk' ? '' : 'none';
      };
      $('#we-pick', m).onclick = async () => { const d = await N.system.pickFolder({ title: 'Папка для наблюдения' }); if (d) $('#we-path', m).value = d; };
      $('#we-cancel', m).onclick = close;
      $('#we-save', m).onclick = async () => {
        w.name = $('#we-name', m).value.trim() || 'Наблюдатель';
        w.type = $('#we-type', m).value;
        w.path = $('#we-path', m).value.trim();
        w.intervalSec = +$('#we-int', m).value || 3600;
        w.thresholdPct = +$('#we-thr', m).value || 10;
        w.agentId = $('#we-agent', m).value;
        w.prompt = $('#we-prompt', m).value.trim();
        await N.watchers.save(w); close(); renderWatchers();
      };
    });
}

/* ---------- Проектные рабочие пространства ---------- */
async function initProjectSelector() {
  const sel = $('#proj-select'); if (!sel) return;
  const projects = await N.projects.list();
  const active = await N.store.get('settings.activeProject', '');
  sel.innerHTML = `<option value="">${esc(t('proj.none'))}</option>` +
    projects.map((p) => `<option value="${esc(p.id)}" ${p.id === active ? 'selected' : ''}>📁 ${esc(p.name)}</option>`).join('') +
    `<option value="__new">＋ ${esc(t('proj.new'))}</option>` +
    (active ? `<option value="__del">🗑 ${esc(t('proj.del'))}</option>` : '');
  sel.onchange = async () => {
    const v = sel.value;
    if (v === '__new') {
      const name = await promptModal(t('proj.new'), t('proj.namePh'));
      if (name) { await N.projects.create(name); toast('📁', t('proj.created'), 'ok'); }
      return initProjectSelector();
    }
    if (v === '__del') {
      const cur = await N.store.get('settings.activeProject', '');
      if (cur && await confirmModal(t('proj.del'), t('proj.delConfirm'))) { await N.projects.remove(cur); toast('🗑', t('proj.deleted'), 'ok'); }
      return initProjectSelector();
    }
    await N.projects.setActive(v);
    toast('📁', v ? t('proj.switched') : t('proj.none'), 'ok');
  };
}
N.on('learner:skill', ({ skill }) => { toast('🎓 ' + t('learn.new'), (skill && skill.label) || '', 'ok'); });
N.on('crawler:progress', (p) => { const s = $('#kb-crawl'); if (s && p.stage === 'index') s.innerHTML = `<span class="spin">⏳</span> ${esc(t('kb.crawling'))} ${p.indexed}/${p.max} · ${esc(String(p.url || '').slice(0, 50))}`; });
// График из анализа данных → панель артефактов.
N.on('artifact:image', ({ title, base64 }) => { openArtifact({ kind: 'image', titleText: title, base64 }); });
// Проактивный наблюдатель сработал.
N.on('watcher:fired', ({ title, message }) => toast(title || '👁', String(message || '').slice(0, 100), 'ok'));

/* ---------- Артефакты (живой превью) ---------- */
const ARTIFACT_RE = /```(\w+)?\n([\s\S]*?)```/g;
// Извлекает первый «превьюшный» блок (html/svg/markdown/код) из текста.
function extractArtifact(text) {
  ARTIFACT_RE.lastIndex = 0; let m;
  while ((m = ARTIFACT_RE.exec(text))) {
    const lang = (m[1] || '').toLowerCase(); const code = m[2];
    if (['html', 'svg', 'xml'].includes(lang)) return { kind: 'html', lang, code };
    if (['js', 'javascript', 'css', 'python', 'py', 'json', 'ts', 'java', 'c', 'cpp', 'go', 'rust', 'sh', 'bash'].includes(lang)) return { kind: 'code', lang, code };
  }
  // Голый HTML без ограждения.
  if (/<(!doctype|html|svg|div|h1|table)[\s>]/i.test(text) && text.includes('</')) return { kind: 'html', lang: 'html', code: text };
  return null;
}
function openArtifact(art) {
  const pane = $('#artifact-pane'), body = $('#artifact-body'), title = $('#artifact-title');
  if (!pane) return;
  title.textContent = (art.kind === 'html' ? '🖼 ' : '📄 ') + (art.lang || 'artifact');
  body.innerHTML = '';
  if (art.kind === 'image') {
    title.textContent = '📊 ' + (art.titleText || 'График');
    const img = el('img', 'artifact-img');
    img.src = 'data:image/png;base64,' + art.base64;
    body.appendChild(img);
  } else if (art.kind === 'html') {
    const frame = el('iframe', 'artifact-frame');
    frame.setAttribute('sandbox', 'allow-scripts'); // изоляция: без доступа к родителю/сети cookies
    frame.srcdoc = art.lang === 'svg' ? `<body style="margin:0;display:grid;place-items:center;background:#fff">${art.code}</body>` : art.code;
    body.appendChild(frame);
  } else {
    const pre = el('pre', 'artifact-code'); pre.textContent = art.code; body.appendChild(pre);
  }
  pane.style.display = 'flex';
  document.body.classList.add('artifact-open');
  window.__lastArtifact = art;
}
function closeArtifact() { const p = $('#artifact-pane'); if (p) p.style.display = 'none'; document.body.classList.remove('artifact-open'); }

/* ---------- Scenarios (готовые сценарии в один клик) ---------- */
const SCENARIOS = [
  { id: 'morning', icon: '🌅', name: 'Утренний помощник', desc: 'При включении ПК агент озвучивает план дня и сводку новостей.',
    agentTpl: 'tpl-assistant', task: { name: 'Утренний брифинг', trigger: 'onStartup', action: 'agent', prompt: 'Составь короткий утренний брифинг: дата, погода (найди в интернете), и 3 главные задачи на день. Будь краток.' } },
  { id: 'autoclean', icon: '🧹', name: 'Авто-уборка диска', desc: 'Каждый день проверяет мусор и предлагает очистку.',
    agentTpl: 'tpl-cleaner', task: { name: 'Проверка диска', trigger: 'daily', time: '20:00', action: 'agent', prompt: 'Проверь, что занимает место на диске, и предложи, что безопасно удалить.' } },
  { id: 'devbox', icon: '💻', name: 'Рабочее место разработчика', desc: 'Добавляет агентов: программист, ревьюер, отладчик.',
    agents: ['tpl-coder', 'tpl-reviewer', 'tpl-debug'] },
  { id: 'qwencode', icon: '⌨️', name: 'Qwen-Code студия', desc: 'Автономный кодер (как Qwen Code CLI) + ревьюер + отладчик. Поставит модель Qwen3-Coder/Devstral под ваше железо.',
    agents: ['tpl-qwencode', 'tpl-reviewer', 'tpl-debug'], installCoder: true },
  { id: 'content', icon: '✍️', name: 'Контент-студия', desc: 'Копирайтер, SEO-специалист и переводчик для контента.',
    agents: ['tpl-copywriter', 'tpl-seo', 'tpl-translator'] },
  { id: 'study', icon: '🎓', name: 'Учебный набор', desc: 'Репетитор, языковой партнёр и экзаменатор.',
    agents: ['tpl-tutor', 'tpl-lang', 'tpl-exam'] },
  { id: 'mcserver', icon: '🧱', name: 'Minecraft-хостинг', desc: 'Разработчик плагинов и админ сервера.',
    agents: ['tpl-minecraft', 'tpl-devops'] },
  { id: 'home', icon: '🏠', name: 'Дом и быт', desc: 'Шеф-повар, фитнес-тренер и тревел-планировщик.',
    agents: ['tpl-chef', 'tpl-fitness', 'tpl-travel'] },
  { id: 'nightnews', icon: '🌙', name: 'Вечерняя сводка', desc: 'Каждый вечер собирает новости по вашим темам в файл.',
    agentTpl: 'tpl-researcher', task: { name: 'Вечерняя сводка', trigger: 'daily', time: '21:00', action: 'agent', prompt: 'Найди главные новости за день по теме технологий и ИИ, составь краткую сводку и сохрани в файл news.md.' } }
];
async function viewScenarios() {
  content.innerHTML = `<div class="view-head"><h1>${esc(t('scn.title'))}</h1><p>${esc(t('scn.sub'))}</p></div><div class="grid cols-3" id="scn"></div>`;
  const wrap = $('#scn');
  SCENARIOS.forEach((s) => {
    const c = el('div', 'card scenario-card', `<div class="scn-ico">${s.icon}</div><h3>${esc(s.name)}</h3><p class="muted">${esc(s.desc)}</p><button class="btn primary sm" style="margin-top:10px">${esc(t('scn.apply'))}</button>`);
    c.querySelector('button').onclick = () => applyScenario(s);
    wrap.appendChild(c);
  });
}
async function applyScenario(s) {
  let added = 0;
  const ids = s.agents || (s.agentTpl ? [s.agentTpl] : []);
  let lastAgent = null;
  for (const tpl of ids) { const r = await N.agents.addTemplate(tpl); if (r.ok) { added++; lastAgent = r.agent; } }
  if (s.task) {
    const taskData = { ...s.task, agentId: lastAgent ? lastAgent.id : undefined, enabled: true };
    await N.tasks.save(taskData);
  }
  toast('Сценарий применён', s.name + (added ? ` · +${added} агент(ов)` : '') + (s.task ? ' · +задача' : ''), 'ok');
  // Сценарий просит установить кодерскую модель — предложим её скачать.
  if (s.installCoder) {
    const rec = await N.installer.recommend();
    const coder = (rec.coder) || 'qwen2.5-coder:7b';
    const has = (await N.installer.listModels()).some((m) => m.name.split(':')[0] === coder.split(':')[0]);
    if (!has && await confirmModal('⌨️ Qwen-Code', `Скачать кодерскую модель «${coder}» под ваше железо? Она нужна автономному кодеру.`)) {
      navigate('marketplace');
      toast('Загрузка', coder + ' — следите за прогрессом', 'ok');
      N.installer.pullModel(coder);
    }
  }
}

/* ---------- Prompts library ---------- */
const PROMPT_LIB = {
  'Продуктивность': [
    { t: 'Утренний брифинг', p: 'Составь краткий план на сегодня: погода (найди в сети), важные задачи и одна мотивирующая мысль.' },
    { t: 'Разбор «Загрузок»', p: 'Посмотри файлы в папке загрузок и предложи, как их разложить по категориям.' },
    { t: 'Резюме документа', p: 'Прочитай указанный файл и сделай краткое резюме в 5 пунктах.' },
    { t: 'План недели', p: 'Помоги составить план на неделю с приоритетами по матрице Эйзенхауэра.' },
    { t: 'Список дел', p: 'Преврати мой свободный текст в структурированный список задач с приоритетами.' },
    { t: 'Помодоро-план', p: 'Разбей мою большую задачу на 25-минутные блоки с короткими перерывами.' }
  ],
  'Система и автоматизация': [
    { t: 'Очистка диска', p: 'Найди, что занимает место на диске, и предложи безопасные способы освободить место.' },
    { t: 'Информация о ПК', p: 'Покажи характеристики системы и текущую нагрузку понятным языком.' },
    { t: 'Бэкап папки', p: 'Создай архив указанной папки с датой в имени.' },
    { t: 'Навести порядок', p: 'Разложи файлы в рабочем пространстве по папкам согласно их типам.' },
    { t: 'Массовое переименование', p: 'Переименуй все изображения в папке по шаблону photo_001, photo_002 и т.д.' },
    { t: 'Поиск дубликатов', p: 'Найди возможные дубликаты файлов в рабочем пространстве и покажи список.' },
    { t: 'Что в автозагрузке', p: 'Покажи, какие программы запускаются вместе с Windows.' }
  ],
  'Разработка': [
    { t: 'Плагин Minecraft /heal', p: 'Создай плагин Minecraft с командой /heal, которая лечит игрока, и скомпилируй его.' },
    { t: 'Плагин приветствия', p: 'Сделай плагин Minecraft, который приветствует игрока при входе на сервер, и собери jar.' },
    { t: 'Конфиг nginx', p: 'Подключись к серверу, открой конфиг nginx и покажи его содержимое.' },
    { t: 'PowerShell-скрипт', p: 'Напиши и запусти PowerShell-скрипт, который переименует все .txt в папке по шаблону.' },
    { t: 'Каркас проекта', p: 'Создай структуру нового Node.js проекта с package.json и базовым index.js.' },
    { t: 'Собери приложение «с нуля»', p: 'Создай в рабочем пространстве полноценное приложение: продумай структуру, создай все нужные файлы, напиши код, добавь README и запусти/проверь, что оно работает. Опиши задумку: <опиши, что нужно сделать>.' },
    { t: 'Разбери репозиторий', p: 'Изучи проект в рабочем пространстве (дерево файлов, ключевые модули) и составь краткое описание архитектуры, стека и точек входа.' },
    { t: 'Добавь фичу + тесты', p: 'Добавь в текущий проект новую функцию <опиши>, напиши к ней тесты, запусти их и исправляй, пока не пройдут.' },
    { t: 'Объясни код', p: 'Прочитай указанный файл с кодом и объясни, что он делает, простыми словами.' },
    { t: 'Найди баги', p: 'Просмотри указанный файл и найди потенциальные баги и уязвимости.' },
    { t: 'Git-статус', p: 'Покажи статус git-репозитория и последние 5 коммитов.' }
  ],
  'Данные и контент': [
    { t: 'Перевод файла', p: 'Переведи файл локализации messages.json на английский, сохранив плейсхолдеры.' },
    { t: 'Поиск и сводка', p: 'Найди в интернете последние новости по теме ИИ и сделай сводку с источниками.' },
    { t: 'Пост для соцсетей', p: 'Напиши 3 варианта поста для соцсетей на заданную тему с эмодзи и хэштегами.' },
    { t: 'Анализ CSV', p: 'Прочитай указанный CSV-файл и посчитай базовую статистику по колонкам.' },
    { t: 'Заголовки', p: 'Предложи 10 цепляющих заголовков для статьи на заданную тему.' },
    { t: 'Резюме видео', p: 'По ссылке найди описание и сделай краткий пересказ темы.' }
  ],
  'Обучение и творчество': [
    { t: 'Объясни тему', p: 'Объясни мне выбранную тему простыми словами с примером, как для новичка.' },
    { t: 'Проверь знания', p: 'Задай мне 5 вопросов по теме, затем оцени мои ответы.' },
    { t: 'Практика языка', p: 'Давай поговорим по-английски на уровне B1, мягко исправляй мои ошибки.' },
    { t: 'Идеи проекта', p: 'Предложи 10 идей пет-проектов для портфолио начинающего разработчика.' },
    { t: 'Короткий рассказ', p: 'Напиши короткий фантастический рассказ из 200 слов по моей завязке.' },
    { t: 'Текстовая RPG', p: 'Запусти текстовое фэнтези-приключение, я играю главного героя.' }
  ],
  'Дом и жизнь': [
    { t: 'Рецепт из продуктов', p: 'Предложи рецепт ужина из продуктов, которые я перечислю.' },
    { t: 'План тренировок', p: 'Составь программу тренировок дома на неделю для начинающего.' },
    { t: 'Маршрут поездки', p: 'Составь план поездки на выходные в заданный город с учётом бюджета.' },
    { t: 'Список покупок', p: 'Сделай список покупок для рецептов, которые я планирую на неделю.' }
  ]
};
async function viewPrompts() {
  const count = Object.values(PROMPT_LIB).reduce((n, a) => n + a.length, 0);
  content.innerHTML = `<div class="view-head"><h1>${esc(t('nav.prompts'))} <span class="tag">${count}</span></h1><p>${esc(t('pr.sub'))}</p></div>
    <input id="pl-search" placeholder="🔎 Поиск по промптам…" style="margin-bottom:16px"><div id="pl"></div>`;
  const draw = (q) => {
    const wrap = $('#pl'); wrap.innerHTML = '';
    q = (q || '').toLowerCase();
    for (const [cat, items] of Object.entries(PROMPT_LIB)) {
      const filtered = items.filter((it) => !q || (it.t + ' ' + it.p).toLowerCase().includes(q));
      if (!filtered.length) continue;
      wrap.appendChild(el('div', 'prompt-cat', cat));
      const grid = el('div', 'grid cols-3');
      filtered.forEach((it) => {
        const c = el('div', 'card prompt-card', `<h3>${esc(it.t)}</h3><p class="muted">${esc(it.p)}</p>`);
        c.onclick = () => { state.pendingPrompt = it.p; navigate('agents'); };
        grid.appendChild(c);
      });
      wrap.appendChild(grid);
    }
  };
  draw('');
  $('#pl-search').addEventListener('input', (e) => draw(e.target.value));
}

/* ---------- Command Palette (Ctrl+K) ---------- */
let cmdkSel = 0, cmdkItems = [];
function buildCommands() {
  const nav = (v, ico, label, sub) => ({ ico, label, sub: sub || 'Раздел', run: () => navigate(v) });
  const cmds = [
    nav('today', '☀️', t('nav.today')),
    nav('dashboard', '🏠', t('nav.dashboard')),
    nav('agents', '🤖', t('nav.agents')),
    { ico: '🔍', label: t('gs.cmd'), sub: 'Действие', run: openGSearch },
    { ico: '🎓', label: t('set.tour'), sub: 'Действие', run: startTour },
    { ico: '💾', label: t('bk.export'), sub: 'Действие', run: backupExport },
    nav('marketplace', '⬇️', t('nav.marketplace')),
    nav('playground', '⚖️', t('nav.playground')),
    nav('diagnostics', '🩺', t('nav.diagnostics')),
    nav('scenarios', '🎬', t('nav.scenarios')),
    nav('scheduler', '⏰', t('nav.scheduler')),
    nav('minecraft', '🧱', t('nav.minecraft')),
    nav('servers', '🖥️', t('nav.servers')),
    nav('translator', '🌐', t('nav.translator')),
    nav('prompts', '💡', t('nav.prompts')),
    nav('voice', '🎙️', t('nav.voice')),
    nav('operator', '🦾', t('nav.operator')),
    nav('smarthome', '🏠', t('nav.smarthome')),
    nav('knowledge', '📚', t('nav.knowledge')),
    nav('notes', '📓', t('nav.notes')),
    nav('swarm', '🐝', t('nav.swarm')),
    nav('skills', '🧩', t('nav.skills')),
    nav('code', '📝', t('nav.code')),
    nav('images', '🎨', t('nav.images')),
    nav('data', '🗃️', t('nav.data')),
    nav('rss', '📰', t('nav.rss')),
    nav('calendar', '📅', t('nav.calendar')),
    nav('email', '✉️', t('nav.email')),
    nav('connections', '🔗', t('nav.connections')),
    nav('automation', '🔗', t('nav.automation')),
    nav('markets', '📈', t('nav.markets')),
    nav('trading', '💹', t('nav.trading')),
    nav('dispatch', '📡', t('nav.dispatch')),
    nav('queue', '📋', t('nav.queue')),
    nav('developer', '🛠️', t('nav.developer')),
    nav('settings', '⚙️', t('nav.settings')),
    { ico: '➕', label: t('btn.newAgent'), sub: 'Действие', run: () => { navigate('agents'); setTimeout(() => editAgent(null), 50); } },
    { ico: '🧩', label: 'Галерея шаблонов', sub: 'Действие', run: () => { navigate('agents'); setTimeout(templateGallery, 50); } },
    { ico: '⚡', label: 'Быстрая установка моделей', sub: 'Действие', run: () => { navigate('dashboard'); setTimeout(quickSetup, 50); } },
    { ico: '🎤', label: 'Включить/выключить голос', sub: 'Действие', run: () => { navigate('voice'); toggleVoice(); } },
    { ico: '🎵', label: 'Включить музыку…', sub: 'Действие', run: () => promptPlayMusic() },
    { ico: '🔇', label: 'Выключить звук', sub: 'Действие', run: async () => { await N.audio.mute(true); toast('Звук', 'выключен', 'ok'); } },
    { ico: '🔊', label: 'Включить звук', sub: 'Действие', run: async () => { await N.audio.mute(false); toast('Звук', 'включён', 'ok'); } },
    { ico: '🌗', label: 'Переключить тему', sub: 'Действие', run: toggleThemeMode },
    { ico: '🧘', label: 'Фокус-режим (скрыть меню)', sub: 'Действие', run: toggleFocusMode },
    { ico: '↔️', label: 'Свернуть/развернуть меню', sub: 'Действие', run: toggleRail },
    { ico: '📥', label: t('btn.import'), sub: 'Действие', run: () => $('#agent-import-input').click() }
  ];
  return cmds;
}
function openCmdk() {
  const back = $('#cmdk'); back.style.display = 'flex';
  const inp = $('#cmdk-input'); inp.value = ''; cmdkSel = 0;
  renderCmdk('');
  setTimeout(() => inp.focus(), 30);
}
function closeCmdk() { $('#cmdk').style.display = 'none'; }
function renderCmdk(q) {
  const all = buildCommands();
  cmdkItems = q ? all.filter((c) => (c.label + ' ' + c.sub).toLowerCase().includes(q.toLowerCase())) : all;
  if (cmdkSel >= cmdkItems.length) cmdkSel = 0;
  const list = $('#cmdk-list');
  list.innerHTML = cmdkItems.map((c, i) => `<div class="cmdk-item ${i === cmdkSel ? 'sel' : ''}" data-i="${i}"><span class="ico">${c.ico}</span><span>${esc(c.label)}</span><span class="sub">${esc(c.sub)}</span></div>`).join('') || '<div class="cmdk-item">Ничего не найдено</div>';
  $$('.cmdk-item', list).forEach((it) => { if (it.dataset.i != null) it.onclick = () => runCmdk(+it.dataset.i); });
}
function runCmdk(i) { const c = cmdkItems[i]; if (c) { closeCmdk(); c.run(); } }

/* ---------- Глобальный поиск (по всему контенту) ---------- */
let gsTimer = null, gsItems = [], gsSel = 0;
function openGSearch() { const b = $('#gsearch'); b.style.display = 'flex'; const inp = $('#gsearch-input'); inp.value = ''; gsItems = []; gsSel = 0; $('#gsearch-list').innerHTML = `<div class="cmdk-item">${esc(t('gs.hint'))}</div>`; setTimeout(() => inp.focus(), 20); }
function closeGSearch() { $('#gsearch').style.display = 'none'; }
async function renderGSearch(q) {
  q = q.trim(); const list = $('#gsearch-list');
  if (q.length < 2) { list.innerHTML = `<div class="cmdk-item">${esc(t('gs.hint'))}</div>`; gsItems = []; return; }
  list.innerHTML = `<div class="cmdk-item"><span class="spin">⏳</span></div>`;
  const items = [];
  const ql = q.toLowerCase();
  // Команды/разделы.
  buildCommands().filter((c) => (c.label + ' ' + c.sub).toLowerCase().includes(ql)).slice(0, 4).forEach((c) => items.push({ ico: c.ico, label: c.label, sub: c.sub, run: c.run }));
  // Параллельно собираем из источников.
  const [notes, hist, kb, cal, files] = await Promise.all([
    N.notes.search(q).catch(() => []),
    N.agents.history().catch(() => []),
    N.rag.retrieve('kb', q).catch(() => []),
    N.cal.list().catch(() => []),
    N.ws.tree().catch(() => [])
  ]);
  notes.slice(0, 5).forEach((n) => items.push({ ico: '📓', label: n.title, sub: 'Заметка · ' + (n.snippet || ''), run: () => { navigate('notes'); setTimeout(() => openNote(n.id), 200); } }));
  hist.filter((h) => (h.user + ' ' + h.assistant).toLowerCase().includes(ql)).slice(-4).reverse().forEach((h) => items.push({ ico: '💬', label: String(h.user || '').slice(0, 60), sub: 'Диалог · ' + (h.agentName || ''), run: () => navigate('agents') }));
  kb.slice(0, 4).forEach((h) => items.push({ ico: '📚', label: String(h.text || '').slice(0, 60), sub: 'Знание · ' + (h.source || ''), run: () => navigate('knowledge') }));
  cal.filter((e) => e.title.toLowerCase().includes(ql)).slice(0, 4).forEach((e) => items.push({ ico: '📅', label: e.title, sub: 'Событие · ' + new Date(e.start).toLocaleDateString(), run: () => navigate('calendar') }));
  const flat = []; const walk = (ns) => ns.forEach((n) => { if (n.dir) walk(n.children || []); else flat.push(n); });
  walk(files); flat.filter((f) => f.name.toLowerCase().includes(ql)).slice(0, 5).forEach((f) => items.push({ ico: '📄', label: f.name, sub: 'Файл · ' + f.path, run: () => { navigate('code'); setTimeout(() => openCodeFile(f.path), 250); } }));

  gsItems = items; gsSel = 0;
  list.innerHTML = items.length ? items.map((c, i) => `<div class="cmdk-item ${i === 0 ? 'sel' : ''}" data-i="${i}"><span class="ico">${c.ico}</span><span>${esc(c.label)}</span><span class="sub">${esc(c.sub)}</span></div>`).join('') : `<div class="cmdk-item">${esc(t('gs.none'))}</div>`;
  $$('.cmdk-item', list).forEach((it) => { if (it.dataset.i != null) it.onclick = () => runGSearch(+it.dataset.i); });
}
function runGSearch(i) { const c = gsItems[i]; if (c) { closeGSearch(); c.run(); } }

async function toggleThemeMode() {
  const th = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' });
  th.mode = th.mode === 'light' ? 'dark' : 'light';
  await N.store.set('settings.theme', th);
  applyTheme();
}

// UX: фокус-режим — скрыть боковое меню (Ctrl+B).
function toggleFocusMode() { document.body.classList.toggle('focus-mode'); }

// UX: быстрый запуск музыки через мини-диалог.
function promptPlayMusic() {
  modal(`<h2>🎵 Что включить?</h2>
    <label class="field"><input id="pm-q" placeholder="исполнитель, трек или плейлист" autofocus></label>
    <div class="modal-actions"><button class="btn ghost" id="pm-cancel">${esc(t('btn.cancel'))}</button><button class="btn primary" id="pm-go">▶ Включить</button></div>`, (m, close) => {
    const go = async () => { const q = $('#pm-q', m).value.trim(); if (!q) return; const r = await N.browser.play(q); toast(r.ok ? '▶ ' + r.service : 'Ошибка', q, r.ok ? 'ok' : 'err'); close(); };
    $('#pm-cancel', m).onclick = close; $('#pm-go', m).onclick = go;
    $('#pm-q', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => $('#pm-q', m).focus(), 30);
  });
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleFocusMode(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); toggleRail(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#cmdk').style.display === 'flex' ? closeCmdk() : openCmdk(); return; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#gsearch').style.display === 'flex' ? closeGSearch() : openGSearch(); return; }
  if ($('#cmdk').style.display === 'flex') {
    if (e.key === 'Escape') closeCmdk();
    else if (e.key === 'ArrowDown') { e.preventDefault(); cmdkSel = Math.min(cmdkItems.length - 1, cmdkSel + 1); renderCmdk($('#cmdk-input').value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkSel = Math.max(0, cmdkSel - 1); renderCmdk($('#cmdk-input').value); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmdk(cmdkSel); }
  }
  if ($('#gsearch').style.display === 'flex') {
    if (e.key === 'Escape') closeGSearch();
    else if (e.key === 'ArrowDown') { e.preventDefault(); gsSel = Math.min(gsItems.length - 1, gsSel + 1); $$('#gsearch-list .cmdk-item').forEach((it, i) => it.classList.toggle('sel', i === gsSel)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); gsSel = Math.max(0, gsSel - 1); $$('#gsearch-list .cmdk-item').forEach((it, i) => it.classList.toggle('sel', i === gsSel)); }
    else if (e.key === 'Enter') { e.preventDefault(); runGSearch(gsSel); }
  }
});
$('#cmdk-input').addEventListener('input', (e) => { cmdkSel = 0; renderCmdk(e.target.value); });
$('#cmdk').addEventListener('click', (e) => { if (e.target.id === 'cmdk') closeCmdk(); });
$('#cmdk-hint').onclick = openCmdk;
$('#gsearch-input').addEventListener('input', (e) => { clearTimeout(gsTimer); gsTimer = setTimeout(() => renderGSearch(e.target.value), 250); });
$('#gsearch').addEventListener('click', (e) => { if (e.target.id === 'gsearch') closeGSearch(); });
$('#gsearch-btn').onclick = openGSearch;

/* Импорт агента из файла */
$('#agent-import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    const r = await N.agents.import(obj);
    if (r.ok) { toast('Импортировано', r.agent.name, 'ok'); state.activeAgentId = r.agent.id; if (state.view === 'agents') viewAgents(); else navigate('agents'); }
    else toast('Ошибка', r.error, 'err');
  } catch { toast('Ошибка', 'Не удалось прочитать файл', 'err'); }
  e.target.value = '';
});

$('#skill-import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const r = await N.skills.import(JSON.parse(await file.text()));
    toast(r.ok ? 'Импортировано' : 'Ошибка', r.ok ? r.skill.label : r.error, r.ok ? 'ok' : 'err');
    if (r.ok && state.view === 'skills') viewSkills();
  } catch { toast('Ошибка', 'Не удалось прочитать файл', 'err'); }
  e.target.value = '';
});

// Прикрепление файла к чату: сохраняем в рабочее пространство (агент сможет read_file),
// а для текстовых — ещё и кладём содержимое прямо в сообщение.
const TEXT_EXT = /\.(txt|md|json|csv|log|js|ts|py|java|html|css|xml|yml|yaml|ini|cfg|conf|sh|bat|ps1|sql|c|cpp|h|go|rs|rb|php|toml|env|gradle|properties)$/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|rtf|png|jpe?g|bmp|tiff?|webp)$/i;
$('#chat-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  if (file.size > 10 * 1024 * 1024) return toast('Слишком большой', 'до 10 МБ', 'err');
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    const saved = await N.system.saveUpload(file.name, b64);
    let contentText = null;
    if (TEXT_EXT.test(file.name) || file.type.startsWith('text')) {
      try { contentText = await file.text(); } catch {}
    } else if (DOC_EXT.test(file.name) && saved && saved.path) {
      // Документы (PDF/DOCX/XLSX/PPTX/изображения) — извлекаем текст, чтобы файл
      // можно было «закинуть» в ЛЮБОЙ чат и спрашивать по содержимому.
      toast('📄 ' + t('att.extracting'), file.name);
      const r = await N.docs.read(saved.path);
      if (typeof r === 'string' && !r.startsWith('ОШИБКА')) contentText = r;
      else toast('⚠️', (typeof r === 'string' ? r : t('att.extractFail')).slice(0, 80), 'err');
    }
    state.attachment = { name: file.name, path: saved && saved.path, content: contentText };
    renderAttachBar();
    toast(t('att.attached'), file.name, 'ok');
  } catch (err) { toast('Ошибка', err.message, 'err'); }
});

/* ---------- Onboarding wizard ---------- */
const ONB_USECASES = [
  { id: 'assistant', ico: '🧠' }, { id: 'automation', ico: '⚙️' },
  { id: 'coding', ico: '💻' }, { id: 'voice', ico: '🎙️' }
];
async function startOnboarding() {
  const onb = $('#onb'); onb.style.display = 'flex';
  let step = 0; const picks = new Set(['assistant']);
  const rec = await N.installer.recommend();

  function steps() {
    const langOpts = LANGS.map((l) => `<option value="${l.code}" ${l.code === getLangCode() ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    return [
      // 0 — Welcome (+ выбор языка сразу)
      `<div class="onb-logo">🧠</div>
       <h1>${esc(t('onb.welcomeTitle'))}</h1>
       <p class="lead">${esc(t('onb.welcomeLead'))}</p>
       <label class="field" style="max-width:280px"><span>${esc(t('onb.language'))}</span><select id="onb-lang">${langOpts}</select></label>
       <div class="onb-actions"><span></span><button class="btn primary" id="onb-next">${esc(t('onb.start'))}</button></div>`,
      // 1 — Use cases
      `<h1>${esc(t('onb.usecaseTitle'))}</h1>
       <p class="lead">${esc(t('onb.usecaseLead'))}</p>
       <div class="usecase-grid">${ONB_USECASES.map((u) => `<div class="usecase ${picks.has(u.id) ? 'sel' : ''}" data-uc="${u.id}"><span class="ico">${u.ico}</span><div><b>${esc(t('onb.uc.' + u.id))}</b><br><small>${esc(t('onb.uc.' + u.id + 'Sub'))}</small></div></div>`).join('')}</div>
       <div class="onb-actions"><button class="btn ghost" id="onb-back">${esc(t('onb.back'))}</button><button class="btn primary" id="onb-next">${esc(t('onb.next'))}</button></div>`,
      // 2 — Hardware + models
      `<h1>${esc(t('onb.hwTitle'))}</h1>
       <p class="lead">${esc(t('onb.hwLead').replace('{gb}', rec.totalGb))}</p>
       <div class="onb-pick">${rec.models.map((m) => `<div class="onb-model-row"><div><b>${esc(m.name)}</b> <span class="model-size">${esc(m.size)}</span><br><small class="muted">${esc(m.desc)}</small></div></div>`).join('')}</div>
       <div class="onb-actions"><button class="btn ghost" id="onb-back">${esc(t('onb.back'))}</button><div class="row"><button class="btn ghost" id="onb-skip">${esc(t('onb.skip'))}</button><button class="btn primary" id="onb-install">${esc(t('onb.install'))}</button></div></div>`,
      // 3 — Installing
      `<div class="onb-logo">⚙️</div>
       <h1>${esc(t('onb.installTitle'))}</h1>
       <p class="lead">${esc(t('onb.installLead'))}</p>
       <div class="progress" style="height:10px"><i id="onb-bar"></i></div>
       <p class="muted" id="onb-msg" style="margin-top:10px">${esc(t('onb.preparing'))}</p>
       <div class="onb-actions"><span></span><button class="btn ghost" id="onb-bg" disabled>${esc(t('onb.ready'))}</button></div>`,
      // 4 — Done
      `<div class="onb-logo">🎉</div>
       <h1>${esc(t('onb.doneTitle'))}</h1>
       <p class="lead">${esc(t('onb.doneLead'))}</p>
       <div class="onb-actions"><span></span><button class="btn primary" id="onb-finish">${esc(t('onb.startWork'))}</button></div>`
    ];
  }
  function draw() {
    const total = 5;
    onb.innerHTML = `<div class="onb-card"><div class="onb-steps">${Array.from({ length: total }, (_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>${steps()[step]}</div>`;
    const langSel = $('#onb-lang', onb);
    if (langSel) langSel.onchange = async (e) => { setLangCode(e.target.value); await N.store.set('settings.lang', e.target.value); applyStaticI18n(); draw(); };
    const next = $('#onb-next', onb); if (next) next.onclick = () => { step++; draw(); };
    const back = $('#onb-back', onb); if (back) back.onclick = () => { step--; draw(); };
    const finish = $('#onb-finish', onb); if (finish) finish.onclick = async () => { await N.store.set('onboarded', true); onb.style.display = 'none'; navigate('agents'); };
    const skip = $('#onb-skip', onb); if (skip) skip.onclick = async () => { await N.store.set('onboarded', true); onb.style.display = 'none'; render(); };
    $$('.usecase', onb).forEach((u) => u.onclick = () => { const id = u.dataset.uc; picks.has(id) ? picks.delete(id) : picks.add(id); u.classList.toggle('sel'); });
    const inst = $('#onb-install', onb);
    if (inst) inst.onclick = async () => {
      step = 3; draw();
      window.__onbActive = true;
      const r = await N.installer.quickSetup();
      window.__onbActive = false;
      const bar = $('#onb-bar', onb); if (bar) bar.style.width = '100%';
      const bg = $('#onb-bg', onb); if (bg) bg.disabled = false;
      step = 4; draw();
      if (!r.ok) toast('Mythera', r.error || 'Возникла ошибка, можно повторить в разделе «Установка ИИ»', 'err');
    };
  }
  draw();
}

/* ================= IPC events ================= */
N.on('navigate', (view) => navigate(view));

// События стрима направляются в чат АГЕНТА, чей ответ выполняется (streamAgentId),
// а перерисовываем только если этот агент сейчас открыт.
// Маршрутизация событий по sessionId → agentId. Поддерживает несколько
// одновременных чатов (сетка 3×3): каждый стрим идёт в чат своего агента.
function sessAgent(sessionId) { return state.sessions[sessionId] || null; }
N.on('agents:stream', ({ sessionId, chunk }) => {
  const agentId = sessAgent(sessionId); if (!agentId) return;
  const c = chatFor(agentId);
  const last = c[c.length - 1];
  if (last && last.role === 'bot') { last.text += chunk; renderAgentEverywhere(agentId); }
});
N.on('agents:tool', ({ sessionId, name, args }) => {
  const agentId = sessAgent(sessionId); if (!agentId) return;
  const c = chatFor(agentId);
  const bot = c.pop();
  c.push({ role: 'tool', text: `⚙️ ${name}(${JSON.stringify(args).slice(0, 120)})` });
  if (bot) c.push(bot);
  renderAgentEverywhere(agentId);
});
N.on('agents:toolResult', ({ sessionId, name, result }) => {
  const agentId = sessAgent(sessionId); if (!agentId) return;
  const c = chatFor(agentId);
  const bot = c.pop();
  c.push({ role: 'tool', text: `✅ ${name} → ${String(result).slice(0, 160)}` });
  if (bot) c.push(bot);
  renderAgentEverywhere(agentId);
});
N.on('agents:notify', async ({ title, message }) => { if (await N.store.get('settings.notifications', true)) toast(title || 'Агент', message); });
// Видимое мышление: показываем план агента перед действиями.
N.on('agents:plan', ({ sessionId, plan }) => {
  const agentId = sessAgent(sessionId); if (!agentId || !Array.isArray(plan) || !plan.length) return;
  const c = chatFor(agentId);
  const bot = c.pop();
  c.push({ role: 'plan', plan, text: '🧭 ' + plan.join(' · ') });
  if (bot) c.push(bot);
  renderAgentEverywhere(agentId);
});
// Самопроверка: ненавязчивый индикатор фазы проверки.
N.on('agents:verify', ({ sessionId, stage }) => {
  const agentId = sessAgent(sessionId); if (!agentId || stage !== 'start') return;
  const c = chatFor(agentId);
  const bot = c.pop();
  c.push({ role: 'tool', text: '🔎 ' + t('think.verify') });
  if (bot) c.push(bot);
  renderAgentEverywhere(agentId);
});
N.on('agents:done', ({ sessionId, text, telemetry }) => {
  const agentId = sessAgent(sessionId);
  if (agentId) {
    // Привязываем телеметрию к последнему ответу бота.
    if (telemetry) {
      const c = chatFor(agentId);
      for (let i = c.length - 1; i >= 0; i--) { if (c[i].role === 'bot') { c[i].tel = telemetry; break; } }
    }
    persistChat(agentId); delete state.sessions[sessionId]; renderAgentEverywhere(agentId);
  }
  if (!Object.keys(state.sessions).length) state.busy = false;
});

// Перерисовать чат данного агента во всех местах, где он показан.
function renderAgentEverywhere(agentId) {
  if (state.grid.on) {
    state.grid.cells.forEach((cell) => { if (cell.agentId === agentId) renderCellBody(cell.id, agentId); });
  } else if (agentId === state.activeAgentId) {
    renderChat();
  }
  // обновляем индикатор «печатает» в шапке ячеек/чата
  updateBusyIndicators();
}

function fmtBytes(n) { if (!n) return '0'; const u = ['Б', 'КБ', 'МБ', 'ГБ']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
function fmtEta(s) { if (s == null) return ''; if (s < 60) return s + ' с'; const m = Math.floor(s / 60); return m + ' мин ' + (s % 60) + ' с'; }
function dlLine(p) {
  let line = p.message || 'Загрузка…';
  if (p.total) line += ` · ${fmtBytes(p.completed)} / ${fmtBytes(p.total)}`;
  if (p.speed) line += ` · ${fmtBytes(p.speed)}/с`;
  if (p.etaSec != null && p.etaSec > 0) line += ` · осталось ${fmtEta(p.etaSec)}`;
  return line;
}
N.on('installer:progress', (p) => {
  const line = dlLine(p);
  const bar = $('#qsbar'); const msg = $('#qsmsg');
  if (bar) bar.style.width = (p.percent || 0) + '%';
  if (msg) msg.textContent = line;
  // прогресс онбординга
  const ob = $('#onb-bar'); const om = $('#onb-msg');
  if (window.__onbActive && ob) { ob.style.width = (p.percent || 0) + '%'; if (om) om.textContent = line; }
  // прогресс на карточках marketplace
  $$('.model-card').forEach((c) => {
    if (p.model && (c.innerHTML.includes(p.model))) {
      const pr = c.querySelector('.progress'); const pm = c.querySelector('.prog-msg');
      if (pr) { pr.style.display = 'block'; pr.querySelector('i').style.width = (p.percent || 0) + '%'; }
      if (pm) pm.textContent = line;
    }
  });
});

N.on('voice:reply', (text) => {
  const vt = $('#vt'); if (vt) vt.textContent = '🤖 ' + text;
});
N.on('voice:speak-request', (text) => speakOut(text));
// Глобальная горячая клавиша. Рендерер — единственный владелец состояния
// распознавания, поэтому никакого эхо-цикла больше нет.
N.on('voice:hotkey', () => { if (state.view !== 'voice') navigate('voice'); toggleVoice(); });

N.on('scheduler:fired', async ({ name }) => { if (await N.store.get('settings.notifications', true)) toast('Задача выполнена', name, 'ok'); });

/* Очередь задач: живое обновление списка + уведомление о завершении. */
N.on('taskq:event', async ({ ev, payload }) => {
  if (state.view === 'queue') renderQueue();
  if (ev === 'task:finished' && payload && payload.status === 'completed' && await N.store.get('settings.notifications', true)) {
    toast('📋 ' + t('q.status.completed'), String(payload.goal || '').slice(0, 60), 'ok');
  }
});

// Агент изменил приложение (создал скил/агента, поставил задачу и т.п.) — обновляем UI.
N.on('app:changed', ({ what }) => {
  const map = { skills: 'skills', agents: 'agents', queue: 'queue', settings: 'settings' };
  if (map[what] && state.view === map[what]) render();
  if (what === 'skills') toast('🧩', t('appChanged.skill'), 'ok');
  else if (what === 'agents') toast('🤖', t('appChanged.agent'), 'ok');
});

N.on('mc:log', ({ log }) => { if (window.__mcLog) { window.__mcLog.textContent += log; window.__mcLog.scrollTop = window.__mcLog.scrollHeight; } });

/* Swarm события (лидер делегирует, ревьюит, перепроверяет) */
function swEnsureStep(index, agent, task) {
  let card = document.getElementById('sw-step-' + index);
  const box = $('#sw-steps');
  if (!card && box) {
    card = el('div', 'card'); card.id = 'sw-step-' + index; card.style.marginBottom = '8px';
    card.innerHTML = `<b>Шаг ${index + 1} · <span id="sw-ag-${index}">${esc(agent || '')}</span></b> <span class="tag" id="sw-state-${index}">…</span>
      <br><small class="muted" id="sw-task-${index}">${esc(task || '')}</small>
      <div id="sw-note-${index}" style="margin-top:6px;font-size:12px;color:var(--accent-2)"></div>
      <div id="sw-res-${index}" style="margin-top:6px;font-size:12px;white-space:pre-wrap"></div>`;
    box.appendChild(card);
  }
  return card;
}
N.on('swarm:status', ({ message }) => { const s = $('#sw-status'); if (s) s.textContent = message || ''; });
N.on('swarm:plan', ({ steps, append }) => {
  const pl = $('#sw-plan'); if (!pl) return;
  const html = '<b>План лидера:</b> ' + steps.map((s, i) => `<span class="tag accent">${i + 1}. ${esc(s.agent)}: ${esc(String(s.task).slice(0, 50))}</span>`).join(' ');
  if (append) pl.innerHTML += '<br>' + html; else pl.innerHTML = html;
});
N.on('swarm:step', ({ index, agent, task, state: stt, result }) => {
  swEnsureStep(index, agent, task);
  const ag = $('#sw-ag-' + index); if (ag && agent) ag.textContent = agent;
  const tk = $('#sw-task-' + index); if (tk && task) tk.textContent = task;
  const tag = $('#sw-state-' + index);
  if (tag) tag.textContent = stt === 'run' ? '⏳ работает' : stt === 'revise' ? '✏️ доработка' : '✅ готово';
  if (result) { const r = $('#sw-res-' + index); if (r) r.textContent = String(result).slice(0, 500); }
});
N.on('swarm:review', ({ index, verdict, feedback }) => {
  const n = $('#sw-note-' + index); if (!n) return;
  n.textContent = verdict === 'accept' ? '👍 лидер принял работу' : '🔁 лидер вернул на доработку: ' + (feedback || '');
});
N.on('swarm:final-chunk', ({ chunk }) => {
  const f = $('#sw-final'); if (f) { f.style.display = 'block'; f.textContent += chunk; }
});
N.on('swarm:done', () => { const s = $('#sw-status'); if (s) s.textContent = '✅ Готово'; toast('Команда завершила работу', '', 'ok'); });
N.on('translate:progress', (p) => {
  const bar = $('#tr-prog'); const msg = $('#tr-msg');
  if (bar) { bar.style.display = 'block'; bar.querySelector('i').style.width = (p.percent || 0) + '%'; }
  if (msg) msg.textContent = p.message || '';
});

/* ================= System monitor ================= */
async function pollStats() {
  try {
    const s = await N.system.stats();
    const cpu = Math.min(100, Math.round(s.cpuLoad * 25));
    $('#cpu-bar') && ($('#cpu-bar').style.width = cpu + '%');
    $('#ram-bar') && ($('#ram-bar').style.width = s.memUsedPercent + '%');
  } catch {}
}
async function pollOllama() {
  try {
    const st = await N.installer.ollamaStatus();
    const b = $('#ollama-badge');
    if (st.running) { b.textContent = t('badge.on'); b.className = 'badge ok'; }
    else { b.textContent = t('badge.off'); b.className = 'badge off'; }
  } catch {}
}

/* ================= Boot ================= */
(async function boot() {
  // Загружаем голоса синтеза заранее.
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  // Язык интерфейса.
  const lang = await N.store.get('settings.lang', null);
  if (lang) setLangCode(lang);
  applyStaticI18n();
  await applyTheme();
  await applyViewPrefs();
  await setupSidebar();
  await initProjectSelector();
  window.__artifactsOn = await N.store.get('settings.artifacts', true);
  // Панель артефактов: кнопки управления.
  const ac = $('#artifact-close'); if (ac) ac.onclick = closeArtifact;
  const ar = $('#artifact-refresh'); if (ar) ar.onclick = () => { if (window.__lastArtifact) openArtifact(window.__lastArtifact); };
  // Центр уведомлений.
  const bell = $('#bell-btn'); if (bell) bell.onclick = toggleNotifPanel;
  const nra = $('#notif-readall'); if (nra) nra.onclick = async () => { await N.notif.markAllRead(); renderNotifPanel(); updateBellBadge(); };
  const ncl = $('#notif-clear'); if (ncl) ncl.onclick = async () => { await N.notif.clear(); renderNotifPanel(); updateBellBadge(); };
  document.addEventListener('click', (e) => { const p = $('#notif-panel'); if (p && p.style.display === 'flex' && !p.contains(e.target) && e.target.id !== 'bell-btn' && !$('#bell-btn').contains(e.target)) p.style.display = 'none'; });
  updateBellBadge();
  render();
  pollStats(); pollOllama();
  setInterval(pollStats, 3000);
  setInterval(pollOllama, 5000);
  // Первый запуск — мастер настройки.
  const onboarded = await N.store.get('onboarded', false);
  if (!onboarded) startOnboarding();
})();
