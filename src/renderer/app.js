/* Nexus AI Hub — логика интерфейса (рендерер) */
const N = window.nexus;
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
const ACCENTS = {
  violet: { a: '#7c5cff', b: '#29d3c2', name: 'Аметист', pro: false },
  ocean:  { a: '#3b82f6', b: '#22d3ee', name: 'Океан', pro: false },
  sunset: { a: '#ff7c5c', b: '#ffb547', name: 'Закат', pro: true },
  forest: { a: '#3ddc84', b: '#a3e635', name: 'Лес', pro: true },
  rose:   { a: '#ff5c9d', b: '#c77dff', name: 'Роза', pro: true }
};
async function applyTheme() {
  const t = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' });
  document.body.classList.toggle('light', t.mode === 'light');
  const ac = ACCENTS[t.accent] || ACCENTS.violet;
  const r = document.documentElement.style;
  r.setProperty('--accent', ac.a);
  r.setProperty('--accent-2', ac.b);
  r.setProperty('--accent-grad', `linear-gradient(135deg, ${ac.a} 0%, ${ac.b} 100%)`);
}

/* ---------------- Licensing helpers ---------------- */
let LIC = { plan: 'free', isPro: false };
async function refreshLicense() {
  LIC = await N.license.status();
  const badge = $('#plan-badge');
  if (badge) {
    badge.textContent = LIC.plan === 'pro' ? 'PRO' : LIC.plan === 'trial' ? `PRO · ${LIC.daysLeft}д` : 'Free';
    badge.classList.toggle('pro', LIC.isPro);
  }
  return LIC;
}
// Гейт Pro-функции: если нет доступа — показать апгрейд и вернуть false.
async function ensurePro(featureLabel) {
  await refreshLicense();
  if (LIC.isPro) return true;
  upgradeModal(featureLabel);
  return false;
}
// Гейт лимита (agents/tasks/servers/translateChars).
async function ensureLimit(kind, currentCount, label) {
  const r = await N.license.can(kind, currentCount);
  if (r.allowed) return true;
  upgradeModal(label, r.reason === 'limit' ? `Бесплатный тариф: до ${r.limit}. Перейдите на Pro, чтобы снять лимит.` : '');
  return false;
}
function upgradeModal(feature, note) {
  modal(`
    <div style="text-align:center">
      <div class="onb-logo" style="margin:0 auto 14px">⭐</div>
      <h2>Это возможность Nexus Pro</h2>
      <p class="muted" style="margin:8px 0">${esc(feature ? feature + '. ' : '')}${esc(note || 'Откройте все функции без ограничений.')}</p>
    </div>
    <div class="modal-actions" style="justify-content:center">
      <button class="btn ghost" id="up-later">Позже</button>
      <button class="btn primary" id="up-go">⭐ Открыть Nexus Pro</button>
    </div>`, (m, close) => {
    $('#up-later', m).onclick = close;
    $('#up-go', m).onclick = () => { close(); navigate('pro'); };
  });
}

/* ================= VIEWS ================= */
const content = $('#content');
function render() {
  content.scrollTop = 0;
  content.className = 'content fade-in';
  const map = { dashboard: viewDashboard, agents: viewAgents, marketplace: viewMarketplace, scheduler: viewScheduler, minecraft: viewMinecraft, servers: viewServers, translator: viewTranslator, prompts: viewPrompts, voice: viewVoice, settings: viewSettings, pro: viewPro };
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
    <div class="view-head"><h1>Главная</h1><p>Центр управления автономными AI-агентами</p></div>
    <div class="hero">
      <h2>👋 Добро пожаловать в Nexus AI Hub</h2>
      <p>Локальные нейросети, которые работают автономно на вашем ПК, управляют компьютером, имеют доступ к интернету и выполняют задачи по расписанию. Всё приватно — данные не покидают устройство.</p>
      <div class="row wrap">
        <button class="btn primary" id="qs">⚡ Быстрая установка (рекомендуется)</button>
        <button class="btn ghost" id="goagents">🤖 Открыть агентов</button>
      </div>
    </div>
    <div class="grid cols-4">
      <div class="card stat"><span class="lbl">Статус Ollama</span><span class="big">${ollama.running ? 'OK' : '—'}</span><span class="muted">${ollama.running ? 'сервер активен' : 'не запущен'}</span></div>
      <div class="card stat"><span class="lbl">Моделей</span><span class="big">${models.length}</span><span class="muted">установлено</span></div>
      <div class="card stat"><span class="lbl">Агентов</span><span class="big">${agents.length}</span><span class="muted">настроено</span></div>
      <div class="card stat"><span class="lbl">Задач</span><span class="big">${tasks.filter(t => t.enabled).length}</span><span class="muted">активно</span></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h3>💻 Система</h3>
        <p class="muted">${esc(info.cpuModel)}</p>
        <div style="margin-top:10px;font-size:13px;color:var(--muted)">
          ОЗУ: ${stats.memUsedGb} / ${stats.memTotalGb} ГБ &nbsp;·&nbsp; Ядер: ${info.cpus} &nbsp;·&nbsp; ${esc(info.platform)} ${esc(info.release)}
        </div>
      </div>
      <div class="card">
        <h3>📦 Установленные модели</h3>
        ${models.length ? models.map(m => `<span class="tag accent">${esc(m.name)}</span>`).join('') : '<p class="muted" style="margin-top:8px">Пока нет. Нажмите «Быстрая установка».</p>'}
      </div>
    </div>`;

  $('#qs').onclick = quickSetup;
  $('#goagents').onclick = () => navigate('agents');
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
    <div class="view-head row between"><div><h1>Агенты</h1><p>Автономные помощники с доступом к компьютеру и интернету</p></div>
      <div class="row"><button class="btn ghost" id="import-agent">📥 Импорт</button><button class="btn primary" id="new-agent">＋ Новый агент</button></div></div>
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

async function exportActiveAgent() {
  if (!state.activeAgentId) return;
  const data = await N.agents.export(state.activeAgentId);
  if (!data) return toast('Ошибка', 'Агент не найден', 'err');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = (data.name || 'agent').replace(/[^\wа-яА-Я-]+/g, '_') + '.nexus.json';
  a.click(); URL.revokeObjectURL(a.href);
  toast('Экспортировано', data.name, 'ok');
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
  content.innerHTML = `
    <div class="view-head row between"><div><h1>Minecraft студия</h1><p>Создание и компиляция плагинов Paper/Spigot в .jar</p></div>
      <button class="btn primary" id="mc-new">＋ Новый плагин</button></div>
    <div class="grid cols-2" style="margin-bottom:16px">
      <div class="card"><h3>☕ Java (JDK)</h3><p class="muted">${env.java ? '✅ ' + esc(env.javaVersion || 'установлена') : '❌ не найдена · <code>' + esc(env.hints.java) + '</code>'}</p></div>
      <div class="card"><h3>📦 Maven</h3><p class="muted">${env.maven ? '✅ ' + esc(env.mavenVersion || 'установлен') : '❌ не найден · <code>' + esc(env.hints.maven) + '</code>'}</p></div>
    </div>
    <div class="grid" id="mc-projects"></div>`;
  $('#mc-new').onclick = () => newMcPlugin(templates);

  const wrap = $('#mc-projects');
  if (!projects.length) { wrap.innerHTML = `<div class="empty"><div class="big-ico">🧱</div><p>Плагинов пока нет. Создайте первый — или попросите агента: «создай плагин с командой».</p></div>`; return; }
  projects.forEach((p) => {
    const c = el('div', 'card');
    c.innerHTML = `
      <div class="row between"><div><h3>🧱 ${esc(p.name)}</h3>
        <p class="muted">${p.jar ? '✅ собран: ' + esc(p.jar.split(/[\\/]/).pop()) : (p.hasPom ? 'готов к сборке' : 'нет pom.xml')}</p></div>
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
      const r = await N.mc.compile(p.name);
      e.target.disabled = false; e.target.textContent = '⚙️ Компилировать';
      if (r.ok) { toast('Собрано', p.name + '.jar готов', 'ok'); log.textContent += '\n✅ JAR: ' + r.jar; }
      else { toast('Ошибка сборки', r.error, 'err'); log.textContent += '\n❌ ' + r.error; }
    };
    c.querySelector('[data-del]').onclick = async () => { await N.mc.delete(p.name); toast('Удалено', p.name); viewMinecraft(); };
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
      <label class="field" style="flex:1"><span>Автор</span><input id="mc-author" value="NexusAI"></label>
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
    const lim = await N.license.can('translateChars', text.length);
    if (!lim.allowed) return upgradeModal('Перевод больших объёмов', `Бесплатно — до ${lim.limit} символов за раз. В тексте ${text.length}. Откройте Pro для безлимита.`);
    $('#tr-prog').style.display = 'block'; $('#tr-go').disabled = true; $('#tr-go').innerHTML = '<span class="spin"></span> Перевод…';
    const r = await N.translate.text({ model: $('#tr-model').value, text, targetLang: $('#tr-dst').value, sourceLang: $('#tr-src').value });
    $('#tr-output').value = r; $('#tr-go').disabled = false; $('#tr-go').textContent = '🌐 Перевести';
    toast('Готово', 'Перевод завершён', 'ok');
  };
  $('#tr-file').onclick = () => modal(`<h2>Перевести файл</h2><p class="muted">Путь относительно рабочего пространства (~/NexusAI-Workspace) или абсолютный.</p>
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

/* ---------- Voice ---------- */
async function viewVoice() {
  const replies = await N.store.get('settings.voiceReplies', true);
  content.innerHTML = `
    <div class="view-head"><h1>Голосовой ассистент</h1><p>Говорите — агент слушает, выполняет и отвечает голосом</p></div>
    <div class="card">
      <div class="voice-stage">
        <div class="orb ${state.voiceListening ? 'listening' : ''}" id="orb">${state.voiceListening ? '👂' : '🎙️'}</div>
        <div class="voice-transcript" id="vt">${state.voiceListening ? 'Слушаю…' : 'Нажмите, чтобы начать'}</div>
        <div class="row">
          <button class="btn primary" id="voice-toggle">${state.voiceListening ? '⏹ Остановить' : '🎤 Начать слушать'}</button>
          <button class="btn ghost" id="voice-test">🔊 Проверить голос</button>
        </div>
        <p class="voice-hint">Горячая клавиша: Ctrl+Shift+Space · Команды обрабатывает «Голосовой компаньон»</p>
        <label class="row" style="gap:10px"><label class="switch"><input type="checkbox" id="vreplies" ${replies ? 'checked' : ''}><span class="slider"></span></label><span class="muted">Озвучивать ответы агента</span></label>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>💡 Примеры команд</h3>
      <div style="margin-top:8px">
        ${['Какая сейчас загрузка системы?', 'Найди в интернете погоду в Москве', 'Создай файл заметки на рабочем столе', 'Открой калькулятор', 'Составь план на день'].map(c => `<span class="tag accent">«${esc(c)}»</span>`).join('')}
      </div>
    </div>`;
  $('#voice-toggle').onclick = toggleVoice;
  $('#voice-test').onclick = () => speakOut('Голосовой ассистент Нексус готов к работе.');
  $('#vreplies').onchange = (e) => N.store.set('settings.voiceReplies', e.target.checked);
}

/* ---------- Settings ---------- */
async function viewSettings() {
  const s = {
    autostart: await N.store.get('settings.autostart', false),
    minimizeToTray: await N.store.get('settings.minimizeToTray', true),
    allowShell: await N.store.get('settings.allowShell', true),
    voiceReplies: await N.store.get('settings.voiceReplies', true),
    longMemory: await N.store.get('settings.longMemory', true),
    workspace: await N.store.get('settings.workspace', '')
  };
  const info = await N.system.info();
  const theme = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' });
  await refreshLicense();
  const swatches = Object.entries(ACCENTS).map(([k, a]) =>
    `<span class="theme-swatch ${theme.accent === k ? 'sel' : ''}" data-accent="${k}" title="${a.name}${a.pro ? ' (Pro)' : ''}" style="background:linear-gradient(135deg,${a.a},${a.b})">${a.pro && !LIC.isPro ? '🔒' : ''}</span>`).join('');
  content.innerHTML = `
    <div class="view-head"><h1>Настройки</h1><p>Поведение приложения, оформление и безопасность агентов</p></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>🎨 Оформление</h3>
        ${toggleRow('set-light', 'Светлая тема', theme.mode === 'light')}
        <p class="muted" style="margin:10px 0 6px">Акцентный цвет</p>
        <div id="accent-row">${swatches}</div>
      </div>
      <div class="card">
        <h3>🚀 Запуск</h3>
        ${toggleRow('set-autostart', 'Запускать вместе с Windows', s.autostart)}
        ${toggleRow('set-tray', 'Сворачивать в трей при закрытии', s.minimizeToTray)}
      </div>
      <div class="card">
        <h3>🔐 Безопасность агентов</h3>
        ${toggleRow('set-shell', 'Разрешить выполнение команд (PowerShell)', s.allowShell)}
        <p class="muted" style="margin-top:8px">Опасные команды (format, shutdown, rm -rf и др.) всегда блокируются. Агенты работают в каталоге-песочнице.</p>
      </div>
      <div class="card">
        <h3>🎙️ Голос</h3>
        ${toggleRow('set-vreplies', 'Озвучивать ответы агента', s.voiceReplies)}
      </div>
      <div class="card">
        <h3>🧠 Память</h3>
        ${toggleRow('set-mem', 'Долговременная память (агент запоминает важное)', s.longMemory)}
        <p class="muted" style="margin-top:8px">Включено: после диалогов агент сохраняет ключевые факты, старая история сжимается в резюме. Контекст живёт долго, но не разрастается мусором.</p>
      </div>
      <div class="card">
        <h3>ℹ️ О приложении</h3>
        <p class="muted">Nexus AI Hub v${esc(info.appVersion)}<br>${esc(info.platform)} ${esc(info.release)} · ${info.cpus} ядер</p>
        <p class="muted" style="margin-top:8px">Все нейросети работают локально. Доступ в интернет — только для инструментов поиска по вашему запросу.</p>
      </div>
    </div>`;
  bindToggle('set-autostart', async (v) => { await N.system.setAutostart(v); toast('Автозапуск', v ? 'включён' : 'выключен', 'ok'); });
  bindToggle('set-tray', (v) => N.store.set('settings.minimizeToTray', v));
  bindToggle('set-shell', (v) => N.store.set('settings.allowShell', v));
  bindToggle('set-vreplies', (v) => N.store.set('settings.voiceReplies', v));
  bindToggle('set-mem', (v) => N.store.set('settings.longMemory', v));
  bindToggle('set-light', async (v) => { const t = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' }); t.mode = v ? 'light' : 'dark'; await N.store.set('settings.theme', t); applyTheme(); });
  $$('#accent-row .theme-swatch').forEach((sw) => sw.onclick = async () => {
    const key = sw.dataset.accent;
    if (ACCENTS[key].pro && !LIC.isPro) return upgradeModal('Премиум-темы оформления');
    const t = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' });
    t.accent = key; await N.store.set('settings.theme', t); applyTheme(); viewSettings();
  });
}

function toggleRow(id, label, on) {
  return `<label class="row between" style="margin:12px 0"><span>${esc(label)}</span><label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="slider"></span></label></label>`;
}
function bindToggle(id, fn) { const e = $('#' + id); if (e) e.onchange = (ev) => fn(ev.target.checked); }

/* ================= VOICE (Web Speech API) ================= */
let recognition = null;
function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'ru-RU';
  r.continuous = false;
  r.interimResults = true;
  r.onresult = (e) => {
    let interim = '', finalT = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalT += tr; else interim += tr;
    }
    const vt = $('#vt'); if (vt) vt.textContent = finalT || interim || 'Слушаю…';
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

async function handleVoiceCommand(text) {
  const vt = $('#vt'); if (vt) vt.textContent = '💬 ' + text;
  N.voice.reportCommand(text);
  // Если открыт экран голоса — показываем «думает».
  toast('Команда', text);
}

function speakOut(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  const ru = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('ru'));
  if (ru) u.voice = ru;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* Плавающая кнопка голоса */
$('#voice-fab').onclick = () => { if (state.view !== 'voice') navigate('voice'); toggleVoice(); };

/* ---------- Pro / Upgrade view ---------- */
async function viewPro() {
  const lic = await refreshLicense();
  const free = lic.limits;
  content.innerHTML = `
    <div class="view-head"><h1>Nexus Pro</h1><p>Снимите все ограничения и откройте продвинутые возможности</p></div>
    ${lic.isPro ? `<div class="hero"><h2>✨ У вас активен ${lic.plan === 'trial' ? 'пробный период Pro' : 'тариф Pro'}</h2>
      <p>${lic.plan === 'trial' ? 'Осталось дней: ' + lic.daysLeft + '. ' : ''}Спасибо за поддержку! Все функции разблокированы.</p>
      <button class="btn ghost" id="deact">Отвязать ключ</button></div>` : ''}
    <div class="pricing">
      <div class="price-card">
        <div class="plan-name">Free</div>
        <div class="price">0 ₽<small>/ навсегда</small></div>
        <ul>
          <li>Локальные нейросети без ограничений</li>
          <li>До ${free.agents} агентов</li>
          <li>До ${free.tasks} задач планировщика</li>
          <li>1 удалённый сервер</li>
          <li>Перевод до ${(free.translateChars/1000)}k символов за раз</li>
          <li class="off">Премиум-темы</li>
          <li class="off">RAG-память и мультиагентные сценарии</li>
          <li class="off">Облачный мост и приоритетная поддержка</li>
        </ul>
        <button class="btn ghost" disabled>${lic.isPro ? 'Базовый' : 'Текущий план'}</button>
      </div>
      <div class="price-card featured">
        <div class="ribbon">Популярный</div>
        <div class="plan-name">Pro</div>
        <div class="price">499 ₽<small>/ мес · или 3990 ₽/год</small></div>
        <ul>
          <li>Всё из Free, без лимитов</li>
          <li>Неограниченно агентов, задач и серверов</li>
          <li>Премиум-темы оформления</li>
          <li>RAG-память (эмбеддинги) и мультиагентные сценарии</li>
          <li>Облачный мост: резерв на мощные модели</li>
          <li>Приоритетная поддержка и ранний доступ</li>
        </ul>
        <div class="row" style="gap:8px">
          ${lic.isPro ? '<button class="btn primary" disabled>Активно</button>' :
            `<button class="btn primary" id="buy">Оформить Pro</button>
             ${lic.trialUsed ? '' : '<button class="btn ghost" id="trial">14 дней бесплатно</button>'}`}
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3>🔑 Активация по ключу</h3>
      <p class="muted">Уже есть лицензионный ключ? Введите его (формат NEXUS-PRO-XXXXXXXX-XXXX).</p>
      <div class="row" style="margin-top:10px"><input id="lic-key" placeholder="NEXUS-PRO-........-...."><button class="btn primary" id="lic-act">Активировать</button></div>
    </div>`;

  if ($('#deact')) $('#deact').onclick = async () => { await N.license.deactivate(); toast('Готово', 'Ключ отвязан'); refreshLicense(); viewPro(); };
  if ($('#buy')) $('#buy').onclick = () => N.system.openExternal('https://nexus-ai-hub.app/pro');
  if ($('#trial')) $('#trial').onclick = async () => {
    const r = await N.license.startTrial();
    if (r.ok) { toast('Пробный Pro активирован', r.daysLeft + ' дней', 'ok'); refreshLicense(); viewPro(); }
    else toast('Не вышло', r.error, 'err');
  };
  $('#lic-act').onclick = async () => {
    const r = await N.license.activate($('#lic-key').value);
    if (r.ok) { toast('Pro активирован', 'Спасибо!', 'ok'); await applyTheme(); refreshLicense(); viewPro(); }
    else toast('Ошибка ключа', r.error, 'err');
  };
}

/* ---------- Prompts library ---------- */
const PROMPT_LIB = {
  'Продуктивность': [
    { t: 'Утренний брифинг', p: 'Составь краткий план на сегодня: погода, важные задачи и одна мотивирующая мысль.' },
    { t: 'Разбор папки Загрузки', p: 'Посмотри файлы в папке загрузок и предложи, как их разложить по категориям.' },
    { t: 'Резюме документа', p: 'Прочитай указанный файл и сделай краткое резюме в 5 пунктах.' }
  ],
  'Система и автоматизация': [
    { t: 'Очистка диска', p: 'Найди, что занимает место на диске, и предложи безопасные способы освободить место.' },
    { t: 'Информация о ПК', p: 'Покажи характеристики системы и текущую нагрузку.' },
    { t: 'Бэкап проекта', p: 'Создай архив указанной папки с датой в имени.' }
  ],
  'Разработка': [
    { t: 'Плагин Minecraft', p: 'Создай плагин Minecraft с командой /heal, которая лечит игрока, и скомпилируй его.' },
    { t: 'Настройка сервера', p: 'Подключись к серверу, открой конфиг nginx и покажи его содержимое.' },
    { t: 'Скрипт автоматизации', p: 'Напиши и запусти PowerShell-скрипт, который переименует все .txt в папке по шаблону.' }
  ],
  'Данные и контент': [
    { t: 'Перевод файла', p: 'Переведи файл локализации messages.json на английский, сохранив плейсхолдеры.' },
    { t: 'Поиск и сводка', p: 'Найди в интернете последние новости по теме ИИ и сделай сводку с источниками.' }
  ]
};
async function viewPrompts() {
  content.innerHTML = `<div class="view-head"><h1>Библиотека промптов</h1><p>Готовые задачи в один клик — отправятся выбранному агенту</p></div><div id="pl"></div>`;
  const wrap = $('#pl');
  for (const [cat, items] of Object.entries(PROMPT_LIB)) {
    wrap.appendChild(el('div', 'prompt-cat', cat));
    const grid = el('div', 'grid cols-3');
    items.forEach((it) => {
      const c = el('div', 'card prompt-card', `<h3>${esc(it.t)}</h3><p class="muted">${esc(it.p)}</p>`);
      c.onclick = () => { state.pendingPrompt = it.p; navigate('agents'); };
      grid.appendChild(c);
    });
    wrap.appendChild(grid);
  }
}

/* ---------- Command Palette (Ctrl+K) ---------- */
let cmdkSel = 0, cmdkItems = [];
function buildCommands() {
  const nav = (v, ico, label, sub) => ({ ico, label, sub: sub || 'Раздел', run: () => navigate(v) });
  const cmds = [
    nav('dashboard', '🏠', 'Главная'),
    nav('agents', '🤖', 'Агенты'),
    nav('marketplace', '⬇️', 'Установка ИИ'),
    nav('scheduler', '⏰', 'Планировщик'),
    nav('minecraft', '🧱', 'Minecraft студия'),
    nav('servers', '🖥️', 'Удалённые серверы'),
    nav('translator', '🌐', 'Перевод данных'),
    nav('prompts', '💡', 'Библиотека промптов'),
    nav('voice', '🎙️', 'Голосовой ассистент'),
    nav('settings', '⚙️', 'Настройки'),
    nav('pro', '⭐', 'Nexus Pro'),
    { ico: '➕', label: 'Новый агент', sub: 'Действие', run: () => { navigate('agents'); setTimeout(() => editAgent(null), 50); } },
    { ico: '⚡', label: 'Быстрая установка моделей', sub: 'Действие', run: () => { navigate('dashboard'); setTimeout(quickSetup, 50); } },
    { ico: '🎤', label: 'Включить/выключить голос', sub: 'Действие', run: () => { navigate('voice'); toggleVoice(); } },
    { ico: '🌗', label: 'Переключить тему', sub: 'Действие', run: toggleThemeMode },
    { ico: '📥', label: 'Импортировать агента', sub: 'Действие', run: () => $('#agent-import-input').click() }
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
  const t = await N.store.get('settings.theme', { mode: 'dark', accent: 'violet' });
  t.mode = t.mode === 'light' ? 'dark' : 'light';
  await N.store.set('settings.theme', t);
  applyTheme();
}

document.addEventListener('keydown', (e) => {
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
$('#plan-badge').onclick = () => navigate('pro');

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
       <h1>Добро пожаловать в Nexus AI Hub</h1>
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
N.on('agents:notify', ({ title, message }) => toast(title || 'Агент', message));
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

N.on('scheduler:fired', ({ name }) => toast('Задача выполнена', name, 'ok'));

N.on('mc:log', ({ log }) => { if (window.__mcLog) { window.__mcLog.textContent += log; window.__mcLog.scrollTop = window.__mcLog.scrollHeight; } });
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
  await applyTheme();
  await refreshLicense();
  render();
  pollStats(); pollOllama();
  setInterval(pollStats, 3000);
  setInterval(pollOllama, 5000);
  setInterval(refreshLicense, 60000);
  // Первый запуск — мастер настройки.
  const onboarded = await N.store.get('onboarded', false);
  if (!onboarded) startOnboarding();
})();
