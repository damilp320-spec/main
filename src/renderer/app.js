/* Mythera AI Hub — логика интерфейса (рендерер) */
const N = window.mythera;
const { t, setLangCode, getLangCode, applyStaticI18n, LANGS } = window.I18N_API;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const state = {
  view: 'dashboard',
  agents: [],
  activeAgentId: null,
  chat: [], // {role, text}
  sessionId: null,
  busy: false,
  voiceListening: false
};

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

/* ---------------- Tab sorting (drag to reorder + persist) ---------------- */
async function applyNavOrder() {
  const order = await N.store.get('settings.navOrder', null);
  const sidebar = $('.sidebar');
  const spacer = $('.sidebar-spacer');
  if (order && sidebar && spacer) {
    order.forEach((view) => { const item = $(`.nav-item[data-view="${view}"]`); if (item) sidebar.insertBefore(item, spacer); });
  }
  enableNavDrag();
}
function enableNavDrag() {
  let dragged = null;
  $$('.nav-item').forEach((item) => {
    item.draggable = true;
    item.ondragstart = (e) => { dragged = item; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    item.ondragend = () => { item.classList.remove('dragging'); persistNavOrder(); };
    item.ondragover = (e) => {
      e.preventDefault();
      if (!dragged || dragged === item) return;
      const rect = item.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      item.parentNode.insertBefore(dragged, after ? item.nextSibling : item);
    };
  });
}
function persistNavOrder() {
  const order = $$('.sidebar .nav-item').map((b) => b.dataset.view);
  N.store.set('settings.navOrder', order);
}

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
function render() {
  content.scrollTop = 0;
  content.className = 'content fade-in';
  const map = { dashboard: viewDashboard, agents: viewAgents, marketplace: viewMarketplace, scenarios: viewScenarios, scheduler: viewScheduler, minecraft: viewMinecraft, servers: viewServers, translator: viewTranslator, smarthome: viewSmartHome, knowledge: viewKnowledge, swarm: viewSwarm, skills: viewSkills, dispatch: viewDispatch, prompts: viewPrompts, voice: viewVoice, developer: viewDeveloper, settings: viewSettings };
  (map[state.view] || viewDashboard)();
}

/* ---------- Dashboard ---------- */
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
        <button class="btn ghost" id="dl-latest">⬇️ Скачать последнюю версию</button>
      </div>
    </div>
    <div class="grid cols-4">
      <div class="card stat"><span class="lbl">${esc(t('dash.statusOllama'))}</span><span class="big">${ollama.running ? 'OK' : '—'}</span><span class="muted">${ollama.running ? 'сервер активен' : 'не запущен'}</span></div>
      <div class="card stat"><span class="lbl">${esc(t('dash.models'))}</span><span class="big">${models.length}</span><span class="muted">установлено</span></div>
      <div class="card stat"><span class="lbl">${esc(t('dash.agents'))}</span><span class="big">${agents.length}</span><span class="muted">настроено</span></div>
      <div class="card stat"><span class="lbl">${esc(t('dash.tasks'))}</span><span class="big">${tasks.filter((x) => x.enabled).length}</span><span class="muted">активно</span></div>
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
    </div>`;

  $('#qs').onclick = quickSetup;
  $('#goagents').onclick = () => navigate('agents');
  $('#dl-latest').onclick = () => N.system.openExternal('https://github.com/damilp320-spec/main/releases/latest');
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
    <div class="view-head"><h1>Установка ИИ</h1><p>Локальные нейросети для автономных агентов. Каждая работает прямо на вашем ПК.</p></div>
    ${!ollama.running ? `<div class="card" style="margin-bottom:16px;border-color:var(--warn)">
      <div class="row between"><div><h3>⚠️ Ollama не запущена</h3><p class="muted">Ollama — движок для локальных моделей. Установите его одной кнопкой.</p></div>
      <button class="btn primary" id="install-ollama">Установить / запустить Ollama</button></div></div>` : ''}
    <div class="grid cols-3" id="cat"></div>`;

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

  content.innerHTML = `
    <div class="view-head row between"><div><h1>${esc(t('nav.agents'))}</h1><p>Автономные помощники с доступом к компьютеру и интернету</p></div>
      <div class="row"><button class="btn ghost" id="gallery-agent">🧩 Галерея</button><button class="btn ghost" id="import-agent">📥 ${esc(t('btn.import'))}</button><button class="btn primary" id="new-agent">＋ ${esc(t('btn.newAgent'))}</button></div></div>
    <div class="agents-layout">
      <div class="agent-list" id="agent-list"></div>
      <div class="chat" id="chat">
        <div class="chat-head"><div id="chat-title"></div><div class="row"><button class="btn ghost sm" id="mem-agent">🧠 Память</button><button class="btn ghost sm" id="export-agent">📤</button><button class="btn ghost sm" id="edit-agent">✎ Настроить</button><button class="btn ghost sm" id="clear-chat">Очистить</button></div></div>
        <div class="chat-body" id="chat-body"></div>
        <div class="chat-input">
          <textarea id="chat-text" placeholder="Напишите задачу… (агент может управлять ПК и искать в сети)"></textarea>
          <button class="btn primary" id="send-btn">Отпр.</button>
        </div>
      </div>
    </div>`;

  $('#new-agent').onclick = async () => {
    const count = state.agents.length;
    if (await ensureLimit('agents', count, 'Лимит агентов на бесплатном тарифе')) editAgent(null);
  };
  $('#gallery-agent').onclick = () => templateGallery();
  $('#import-agent').onclick = () => $('#agent-import-input').click();
  $('#export-agent').onclick = () => exportActiveAgent();
  $('#edit-agent').onclick = () => editAgent(state.agents.find(a => a.id === state.activeAgentId));
  $('#clear-chat').onclick = () => { state.chat = []; renderChat(); };
  $('#mem-agent').onclick = () => showMemory(state.activeAgentId);

  const list = $('#agent-list');
  state.agents.forEach((a) => {
    const p = el('div', 'agent-pill' + (a.id === state.activeAgentId ? ' active' : ''));
    p.innerHTML = `<span class="ico">${a.icon || '🤖'}</span><div class="meta"><b>${esc(a.name)}</b><br><small>${esc(a.model || '')}</small></div>`;
    p.onclick = () => { state.activeAgentId = a.id; state.chat = []; viewAgents(); };
    list.appendChild(p);
  });

  const active = state.agents.find(a => a.id === state.activeAgentId);
  $('#chat-title').innerHTML = active ? `<b>${active.icon || '🤖'} ${esc(active.name)}</b> <span class="tag">${esc(autonomyLabel(active.autonomy))}</span>` : '';
  renderChat();

  $('#send-btn').onclick = sendChat;
  $('#chat-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });

  // Промпт из библиотеки — подставляем в поле ввода.
  if (state.pendingPrompt) { $('#chat-text').value = state.pendingPrompt; state.pendingPrompt = null; $('#chat-text').focus(); }
}

// В начале render()
async function render() {
  content.scrollTop = 0;
  content.className = 'content fade-in';
  try {
    const map = { ... };
    const fn = map[state.view] || viewDashboard;
    await fn();                    // ← await + try
  } catch (e) {
    console.error('Render error:', e);
    content.innerHTML = `<div class="card" style="color:var(--danger);padding:40px">
      <h2>Ошибка загрузки вкладки</h2>
      <p>${esc(e.message || e)}</p>
      <button onclick="location.reload()">Перезагрузить</button>
    </div>`;
  }
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
  if (!state.chat.length) {
    body.innerHTML = `<div class="empty"><div class="big-ico">🤖</div><p>Начните диалог. Агент может выполнять команды, читать/писать файлы, искать в интернете и открывать приложения.</p></div>`;
    return;
  }
  body.innerHTML = '';
  state.chat.forEach((m) => {
    const d = el('div', 'msg ' + m.role);
    d.textContent = m.text;
    body.appendChild(d);
  });
  body.scrollTop = body.scrollHeight;
}

async function sendChat() {
  const ta = $('#chat-text');
  const text = ta.value.trim();
  if (!text || state.busy) return;
  ta.value = '';
  state.chat.push({ role: 'user', text });
  state.busy = true;
  renderChat();

  const history = state.chat.filter(m => m.role === 'user' || m.role === 'bot').slice(0, -1)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));

  const botMsg = { role: 'bot', text: '' };
  state.chat.push(botMsg);
  renderChat();

  state.sessionId = 'sess-' + Date.now();
  await N.agents.chat({ agentId: state.activeAgentId, sessionId: state.sessionId, message: text, history });
  state.busy = false;
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
    <div class="view-head row between"><div><h1>Планировщик задач</h1><p>Что делать при включении ПК, по расписанию или интервалу</p></div>
      <button class="btn primary" id="new-task">＋ Новая задача</button></div>
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
    <div class="view-head row between"><div><h1>Minecraft студия</h1><p>Плагины Paper/Spigot (Maven) и моды Forge/Fabric (Gradle) — генерация и компиляция в .jar</p></div>
      <div class="row"><button class="btn ghost" id="mc-newmod">＋ Мод</button><button class="btn primary" id="mc-new">＋ Плагин</button></div></div>
    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card"><h3>☕ Java (JDK)</h3><p class="muted">${env.java ? '✅ ' + esc(env.javaVersion || 'установлена') : '❌ не найдена · <code>' + esc(env.hints.java) + '</code>'}</p></div>
      <div class="card"><h3>📦 Maven</h3><p class="muted">${env.maven ? '✅ ' + esc(env.mavenVersion || 'установлен') : '❌ не найден · <code>' + esc(env.hints.maven) + '</code>'}</p></div>
      <div class="card"><h3>🐘 Gradle</h3><p class="muted">${env.gradle ? '✅ ' + esc(env.gradleVersion || 'установлен') : '❌ не найден · <code>' + esc(env.hints.gradle) + '</code>'}</p></div>
    </div>
    <div class="grid" id="mc-projects"></div>`;
  $('#mc-new').onclick = () => newMcPlugin(templates);
  $('#mc-newmod').onclick = () => newMcMod(loaders);

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
    <div class="view-head row between"><div><h1>Удалённые серверы</h1><p>SSH-проводник по файловой системе, редактор конфигов, команды</p></div>
      <button class="btn primary" id="srv-new">＋ Подключение</button></div>
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
    <div class="view-head"><h1>Перевод больших данных</h1><p>Перевод текста и файлов (TXT/JSON/локализации) локальной моделью с разбивкой на части</p></div>
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
    <div class="view-head"><h1>📚 ${esc(t('nav.knowledge'))}</h1><p>RAG-память на эмбеддингах: агенты подтягивают релевантные знания под запрос</p></div>
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
  $('#kb-search').onclick = async () => {
    const q = $('#kb-q').value.trim(); if (!q) return;
    $('#kb-results').innerHTML = '<span class="spin"></span>';
    const hits = await N.rag.retrieve('kb', q);
    $('#kb-results').innerHTML = hits.length ? hits.map((h) => `<div class="card" style="margin-bottom:8px"><small class="muted">${esc(h.source)} · ${h.score}</small><br>${esc(h.text.slice(0, 300))}</div>`).join('') : '<p class="muted">Ничего не найдено (или RAG/модель не настроены).</p>';
  };
}

/* ---------- Swarm (multi-agent) ---------- */
let swarmState = { running: false };
async function viewSwarm() {
  const agents = await N.agents.list();
  content.innerHTML = `
    <div class="view-head"><h1>🐝 ${esc(t('nav.swarm'))}</h1><p>Команда агентов: координатор делит цель на подзадачи и распределяет их между специалистами</p></div>
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
    $('#sw-out').innerHTML = '<div class="card"><b>План…</b><div id="sw-steps" style="margin-top:10px"></div><div id="sw-final" class="msg bot" style="margin-top:12px;display:none"></div></div>';
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
    <div class="view-head row between"><div><h1>🧩 ${esc(t('nav.skills'))}</h1><p>Плагины-навыки агентов: безопасные шаблоны команд и HTTP-запросов</p></div>
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
    <div class="view-head"><h1>📡 ${esc(t('nav.dispatch'))}</h1><p>Локальный удалённый доступ к агентам (в духе Claude dispatch) — управляйте ими с телефона в той же сети</p></div>
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
    <div class="view-head row between"><div><h1>🏠 ${esc(t('nav.smarthome'))}</h1><p>Управление устройствами умного дома голосом и агентами — поддержка всех популярных протоколов, включая РФ/СНГ</p></div>
      <button class="btn primary" id="sh-new">＋ Устройство</button></div>
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
    <div class="view-head"><h1>🛠️ ${esc(t('nav.developer'))}</h1><p>Режим полного контроля для профессионалов: сырые параметры модели, конфиг и инструменты</p></div>
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
    <div class="view-head"><h1>${esc(t('nav.voice'))}</h1><p>Говорите — агент слушает, выполняет и отвечает голосом</p></div>
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
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>💡 Примеры команд</h3>
      <div style="margin-top:8px">
        ${['Включи Imagine Dragons на YouTube Music', 'Сделай громкость 30%', 'Выключи свет на кухне', 'Открой YouTube', 'Сделай скриншот и опиши экран', 'Какая загрузка системы?'].map(c => `<span class="tag accent">«${esc(c)}»</span>`).join('')}
      </div>
    </div>`;
  $('#voice-toggle').onclick = toggleVoice;
  $('#voice-test').onclick = () => speakOut('Mythera voice assistant is ready.');
  $('#vreplies').onchange = (e) => N.store.set('settings.voiceReplies', e.target.checked);
  $('#wake-on').onchange = (e) => N.store.set('settings.wakeEnabled', e.target.checked);
  $('#wake-word').onchange = (e) => N.store.set('settings.wakeWord', e.target.value.trim() || 'Mythera');
  $('#tts-engine').onchange = (e) => { N.store.set('settings.ttsEngine', e.target.value); toast('TTS', e.target.value, 'ok'); };
  $('#stt-engine').onchange = (e) => { N.store.set('settings.sttEngine', e.target.value); toast('STT', e.target.value, 'ok'); };
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
    temperature: await g('temperature', 0.7),
    maxSteps: await g('maxSteps', 0),
    defaultModel: await g('defaultModel', '')
  };
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
        <label class="field"><span>${esc(t('set.maxSteps'))}</span><input type="number" id="set-steps" min="0" max="30" value="${s.maxSteps}" placeholder="авто"></label>
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
  $('#set-lang').onchange = async (e) => { setLangCode(e.target.value); await N.store.set('settings.lang', e.target.value); applyStaticI18n(); viewSettings(); };
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

/* ================= VOICE (Web Speech API + wake-word) ================= */
const VOICE_LANG = () => ({ ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', es: 'es-ES', de: 'de-DE', zh: 'zh-CN' }[getLangCode()] || 'en-US');
let recognition = null;
function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = VOICE_LANG();
  r.continuous = true; // непрерывно — нужно для wake-word
  r.interimResults = true;
  r.onresult = (e) => {
    let interim = '', finalT = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalT += tr; else interim += tr;
    }
    const vt = $('#vt'); if (vt) vt.textContent = finalT || interim || '…';
    if (finalT.trim()) handleVoiceCommand(finalT.trim());
  };
  r.onerror = () => {};
  r.onend = () => { if (state.voiceListening) { try { r.start(); } catch {} } };
  return r;
}

function toggleVoice() {
  state.voiceListening ? stopVoice() : startVoice();
}
function startVoice() {
  if (!recognition) recognition = setupRecognition();
  if (!recognition) { toast('Недоступно', 'Распознавание речи не поддерживается', 'err'); return; }
  state.voiceListening = true;
  N.voice.start();
  try { recognition.start(); } catch {}
  updateVoiceUI();
}
function stopVoice() {
  state.voiceListening = false;
  N.voice.stop();
  if (recognition) try { recognition.stop(); } catch {}
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

async function speakOut(text) {
  // Piper (локальный TTS) — если включён и настроен; иначе Web Speech API.
  const engine = await N.store.get('settings.ttsEngine', 'web');
  if (engine === 'piper') {
    try {
      const r = await N.speech.synthesize(text);
      if (r.ok && r.file) {
        const audio = new Audio('file://' + r.file);
        audio.playbackRate = await N.store.get('settings.voiceRate', 1);
        audio.onended = async () => { if (state.voiceListening && await N.store.get('settings.autoListen', false)) { try { recognition && recognition.start(); } catch {} } };
        audio.play(); return;
      }
    } catch {}
  }
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = VOICE_LANG();
  u.rate = await N.store.get('settings.voiceRate', 1);
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith(u.lang.slice(0, 2)));
  if (v) u.voice = v;
  u.onend = async () => { if (state.voiceListening && await N.store.get('settings.autoListen', false)) { try { recognition && recognition.start(); } catch {} } };
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* Плавающая кнопка голоса */
$('#voice-fab').onclick = () => { if (state.view !== 'voice') navigate('voice'); toggleVoice(); };

/* ---------- Scenarios (готовые сценарии в один клик) ---------- */
const SCENARIOS = [
  { id: 'morning', icon: '🌅', name: 'Утренний помощник', desc: 'При включении ПК агент озвучивает план дня и сводку новостей.',
    agentTpl: 'tpl-assistant', task: { name: 'Утренний брифинг', trigger: 'onStartup', action: 'agent', prompt: 'Составь короткий утренний брифинг: дата, погода (найди в интернете), и 3 главные задачи на день. Будь краток.' } },
  { id: 'autoclean', icon: '🧹', name: 'Авто-уборка диска', desc: 'Каждый день проверяет мусор и предлагает очистку.',
    agentTpl: 'tpl-cleaner', task: { name: 'Проверка диска', trigger: 'daily', time: '20:00', action: 'agent', prompt: 'Проверь, что занимает место на диске, и предложи, что безопасно удалить.' } },
  { id: 'devbox', icon: '💻', name: 'Рабочее место разработчика', desc: 'Добавляет агентов: программист, ревьюер, отладчик.',
    agents: ['tpl-coder', 'tpl-reviewer', 'tpl-debug'] },
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
  content.innerHTML = `<div class="view-head"><h1>Сценарии использования</h1><p>Готовые наборы агентов и автоматизаций — настройка в один клик</p></div><div class="grid cols-3" id="scn"></div>`;
  const wrap = $('#scn');
  SCENARIOS.forEach((s) => {
    const c = el('div', 'card scenario-card', `<div class="scn-ico">${s.icon}</div><h3>${esc(s.name)}</h3><p class="muted">${esc(s.desc)}</p><button class="btn primary sm" style="margin-top:10px">Применить</button>`);
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
  content.innerHTML = `<div class="view-head"><h1>${esc(t('nav.prompts'))} <span class="tag">${count}</span></h1><p>Готовые задачи в один клик — отправятся выбранному агенту</p></div>
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
    nav('dashboard', '🏠', t('nav.dashboard')),
    nav('agents', '🤖', t('nav.agents')),
    nav('marketplace', '⬇️', t('nav.marketplace')),
    nav('scenarios', '🎬', t('nav.scenarios')),
    nav('scheduler', '⏰', t('nav.scheduler')),
    nav('minecraft', '🧱', t('nav.minecraft')),
    nav('servers', '🖥️', t('nav.servers')),
    nav('translator', '🌐', t('nav.translator')),
    nav('prompts', '💡', t('nav.prompts')),
    nav('voice', '🎙️', t('nav.voice')),
    nav('smarthome', '🏠', t('nav.smarthome')),
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#cmdk').style.display === 'flex' ? closeCmdk() : openCmdk(); return; }
  if ($('#cmdk').style.display === 'flex') {
    if (e.key === 'Escape') closeCmdk();
    else if (e.key === 'ArrowDown') { e.preventDefault(); cmdkSel = Math.min(cmdkItems.length - 1, cmdkSel + 1); renderCmdk($('#cmdk-input').value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkSel = Math.max(0, cmdkSel - 1); renderCmdk($('#cmdk-input').value); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmdk(cmdkSel); }
  }
});
$('#cmdk-input').addEventListener('input', (e) => { cmdkSel = 0; renderCmdk(e.target.value); });
$('#cmdk').addEventListener('click', (e) => { if (e.target.id === 'cmdk') closeCmdk(); });
$('#cmdk-hint').onclick = openCmdk;

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

/* ---------- Onboarding wizard ---------- */
const ONB_USECASES = [
  { id: 'assistant', ico: '🧠', name: 'Личный ассистент', sub: 'Ответы, поиск, помощь по задачам' },
  { id: 'automation', ico: '⚙️', name: 'Автоматизация ПК', sub: 'Команды, файлы, рутина' },
  { id: 'coding', ico: '💻', name: 'Разработка', sub: 'Код, Minecraft, серверы' },
  { id: 'voice', ico: '🎙️', name: 'Голосовой помощник', sub: 'Управление голосом' }
];
async function startOnboarding() {
  const onb = $('#onb'); onb.style.display = 'flex';
  let step = 0; const picks = new Set(['assistant']);
  const rec = await N.installer.recommend();

  function steps() {
    return [
      // 0 — Welcome
      `<div class="onb-logo">🧠</div>
       <h1>Добро пожаловать в Mythera AI Hub</h1>
       <p class="lead">За пару минут настроим автономных AI-агентов, которые работают прямо на вашем ПК — приватно, без подписок и без облака. Они умеют управлять компьютером, искать в интернете и выполнять задачи по расписанию.</p>
       <div class="onb-actions"><span></span><button class="btn primary" id="onb-next">Начать →</button></div>`,
      // 1 — Use cases
      `<h1>Для чего будете использовать?</h1>
       <p class="lead">Выберите одно или несколько — подберём подходящих агентов и модели.</p>
       <div class="usecase-grid">${ONB_USECASES.map((u) => `<div class="usecase ${picks.has(u.id) ? 'sel' : ''}" data-uc="${u.id}"><span class="ico">${u.ico}</span><div><b>${u.name}</b><br><small>${u.sub}</small></div></div>`).join('')}</div>
       <div class="onb-actions"><button class="btn ghost" id="onb-back">← Назад</button><button class="btn primary" id="onb-next">Далее →</button></div>`,
      // 2 — Hardware + models
      `<h1>Ваш компьютер готов</h1>
       <p class="lead">Обнаружено ОЗУ: <b>${rec.totalGb} ГБ</b>. Под него подобраны оптимальные локальные модели:</p>
       <div class="onb-pick">${rec.models.map((m) => `<div class="onb-model-row"><div><b>${esc(m.name)}</b> <span class="model-size">${esc(m.size)}</span><br><small class="muted">${esc(m.desc)}</small></div></div>`).join('')}</div>
       <div class="onb-actions"><button class="btn ghost" id="onb-back">← Назад</button><div class="row"><button class="btn ghost" id="onb-skip">Пропустить</button><button class="btn primary" id="onb-install">⚡ Установить и настроить</button></div></div>`,
      // 3 — Installing
      `<div class="onb-logo">⚙️</div>
       <h1>Устанавливаем…</h1>
       <p class="lead">Скачиваем движок и модели. Можно свернуть окно — мы продолжим в фоне.</p>
       <div class="progress" style="height:10px"><i id="onb-bar"></i></div>
       <p class="muted" id="onb-msg" style="margin-top:10px">Подготовка…</p>
       <div class="onb-actions"><span></span><button class="btn ghost" id="onb-bg" disabled>Готово</button></div>`,
      // 4 — Done
      `<div class="onb-logo">🎉</div>
       <h1>Всё готово!</h1>
       <p class="lead">Агенты настроены. Откройте раздел «Агенты» и начните диалог, или нажмите <b>Ctrl+K</b> для быстрого доступа к любой функции. Голос — по кнопке 🎤 или <b>Ctrl+Shift+Space</b>.</p>
       <div class="onb-actions"><span></span><button class="btn primary" id="onb-finish">Начать работу →</button></div>`
    ];
  }
  function draw() {
    const total = 5;
    onb.innerHTML = `<div class="onb-card"><div class="onb-steps">${Array.from({ length: total }, (_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>${steps()[step]}</div>`;
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
      if (!r.ok) toast('Установка', r.error || 'Возникла ошибка, можно повторить в разделе «Установка ИИ»', 'err');
    };
  }
  draw();
}

/* ================= IPC events ================= */
N.on('navigate', (view) => navigate(view));

N.on('agents:stream', ({ sessionId, chunk }) => {
  if (sessionId !== state.sessionId) return;
  const last = state.chat[state.chat.length - 1];
  if (last && last.role === 'bot') { last.text += chunk; renderChat(); }
});
N.on('agents:tool', ({ name, args }) => {
  if (state.view !== 'agents') return;
  state.chat.push({ role: 'tool', text: `⚙️ ${name}(${JSON.stringify(args).slice(0, 120)})` });
  // вставляем перед ботом, который ещё пишет
  const bot = state.chat.pop(); // tool
  const idx = state.chat.length - 1;
  state.chat.splice(idx, 0, bot);
  renderChat();
});
N.on('agents:toolResult', ({ name, result }) => {
  if (state.view !== 'agents') return;
  const bot = state.chat.pop();
  state.chat.push({ role: 'tool', text: `✅ ${name} → ${String(result).slice(0, 160)}` });
  state.chat.push(bot);
  renderChat();
});
N.on('agents:notify', async ({ title, message }) => { if (await N.store.get('settings.notifications', true)) toast(title || 'Агент', message); });
N.on('agents:done', ({ text }) => { state.busy = false; });

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
N.on('voice:state', ({ listening }) => {
  state.voiceListening = listening;
  if (listening && !recognition?.['running']) { /* hotkey toggled */ if (state.view !== 'voice') navigate('voice'); startVoice(); }
  else if (!listening) stopVoice();
});

N.on('scheduler:fired', async ({ name }) => { if (await N.store.get('settings.notifications', true)) toast('Задача выполнена', name, 'ok'); });

N.on('mc:log', ({ log }) => { if (window.__mcLog) { window.__mcLog.textContent += log; window.__mcLog.scrollTop = window.__mcLog.scrollHeight; } });

/* Swarm события */
N.on('swarm:plan', ({ steps }) => {
  const box = $('#sw-steps'); if (!box) return;
  box.innerHTML = steps.map((s, i) => `<div class="card" id="sw-step-${i}" style="margin-bottom:8px"><b>${i + 1}. ${esc(s.agent)}</b> <span class="tag" id="sw-state-${i}">ожидание</span><br><small class="muted">${esc(s.task)}</small><div class="muted" id="sw-res-${i}" style="margin-top:6px"></div></div>`).join('');
});
N.on('swarm:step', ({ index, agent, state: stt, result }) => {
  const tag = $('#sw-state-' + index); if (tag) tag.textContent = stt === 'run' ? '⏳ работает' : '✅ готово';
  if (result) { const r = $('#sw-res-' + index); if (r) r.textContent = String(result).slice(0, 400); }
});
N.on('swarm:final-chunk', ({ chunk }) => {
  const f = $('#sw-final'); if (f) { f.style.display = 'block'; f.textContent += chunk; }
});
N.on('swarm:done', () => { toast('Команда завершила работу', '', 'ok'); });
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
    if (st.running) { b.textContent = '● Ollama активна'; b.className = 'badge ok'; }
    else { b.textContent = '● Ollama не запущена'; b.className = 'badge off'; }
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
  await applyNavOrder();
  render();
  pollStats(); pollOllama();
  setInterval(pollStats, 3000);
  setInterval(pollOllama, 5000);
  // Первый запуск — мастер настройки.
  const onboarded = await N.store.get('onboarded', false);
  if (!onboarded) startOnboarding();
})();
