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

/* ================= VIEWS ================= */
const content = $('#content');
function render() {
  content.scrollTop = 0;
  content.className = 'content fade-in';
  const map = { dashboard: viewDashboard, agents: viewAgents, marketplace: viewMarketplace, scheduler: viewScheduler, voice: viewVoice, settings: viewSettings };
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
      <button class="btn primary" id="new-agent">＋ Новый агент</button></div>
    <div class="agents-layout">
      <div class="agent-list" id="agent-list"></div>
      <div class="chat" id="chat">
        <div class="chat-head"><div id="chat-title"></div><div class="row"><button class="btn ghost sm" id="edit-agent">✎ Настроить</button><button class="btn ghost sm" id="clear-chat">Очистить</button></div></div>
        <div class="chat-body" id="chat-body"></div>
        <div class="chat-input">
          <textarea id="chat-text" placeholder="Напишите задачу… (агент может управлять ПК и искать в сети)"></textarea>
          <button class="btn primary" id="send-btn">Отпр.</button>
        </div>
      </div>
    </div>`;

  $('#new-agent').onclick = () => editAgent(null);
  $('#edit-agent').onclick = () => editAgent(state.agents.find(a => a.id === state.activeAgentId));
  $('#clear-chat').onclick = () => { state.chat = []; renderChat(); };

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
}

function autonomyLabel(a) { return ({ 'chat-only': 'только чат', balanced: 'сбалансированный', autonomous: 'автономный' })[a] || 'сбалансированный'; }

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
  $('#new-task').onclick = () => editTask(null, agents);

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
    workspace: await N.store.get('settings.workspace', '')
  };
  const info = await N.system.info();
  content.innerHTML = `
    <div class="view-head"><h1>Настройки</h1><p>Поведение приложения и безопасность агентов</p></div>
    <div class="grid cols-2">
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
        <h3>ℹ️ О приложении</h3>
        <p class="muted">Nexus AI Hub v${esc(info.appVersion)}<br>${esc(info.platform)} ${esc(info.release)} · ${info.cpus} ядер</p>
        <p class="muted" style="margin-top:8px">Все нейросети работают локально. Доступ в интернет — только для инструментов поиска по вашему запросу.</p>
      </div>
    </div>`;
  bindToggle('set-autostart', async (v) => { await N.system.setAutostart(v); toast('Автозапуск', v ? 'включён' : 'выключен', 'ok'); });
  bindToggle('set-tray', (v) => N.store.set('settings.minimizeToTray', v));
  bindToggle('set-shell', (v) => N.store.set('settings.allowShell', v));
  bindToggle('set-vreplies', (v) => N.store.set('settings.voiceReplies', v));
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

N.on('installer:progress', (p) => {
  const bar = $('#qsbar'); const msg = $('#qsmsg');
  if (bar) bar.style.width = (p.percent || 0) + '%';
  if (msg) msg.textContent = p.message || '';
  // прогресс на карточках marketplace
  $$('.model-card').forEach((c) => {
    if (p.model && (c.innerHTML.includes(p.model))) {
      const pr = c.querySelector('.progress'); const pm = c.querySelector('.prog-msg');
      if (pr) { pr.style.display = 'block'; pr.querySelector('i').style.width = (p.percent || 0) + '%'; }
      if (pm) pm.textContent = p.message || '';
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
  render();
  pollStats(); pollOllama();
  setInterval(pollStats, 3000);
  setInterval(pollOllama, 5000);
})();
