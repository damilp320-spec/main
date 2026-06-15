const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, globalShortcut, dialog } = require('electron');
const path = require('path');

const store = require('./store');
const ollama = require('./ollama');
const installer = require('./installer');
const agent = require('./agent');
const scheduler = require('./scheduler');
const voice = require('./voice');
const system = require('./system');
const memory = require('./memory');
const minecraft = require('./minecraft');
const remote = require('./remote');
const translator = require('./translator');
const licensing = require('./licensing');
const rag = require('./rag');
const swarm = require('./swarm');
const skills = require('./skills');
const screen = require('./screen');
const speech = require('./speech');
const dispatch = require('./dispatch');
const browser = require('./browser');
const audio = require('./audio');
const smarthome = require('./smarthome');
const tooling = require('./tooling');
const taskQueue = require('./taskQueue');
const constitution = require('./constitution');
const webagent = require('./webagent');
const gui = require('./gui');
const mcp = require('./mcp');
const docs = require('./docs');
const cloud = require('./cloud');
const modelrouter = require('./modelrouter');
const operator = require('./operator');
const projects = require('./projects');
const quickask = require('./quickask');
const watchers = require('./watchers');
const flows = require('./flows');
const analysis = require('./analysis');
const markets = require('./markets');
const trading = require('./trading');
const backtest = require('./backtest');
const notifications = require('./notifications');
const reports = require('./reports');
const imagegen = require('./imagegen');
const workspace = require('./workspace');
const news = require('./news');
const crawler = require('./crawler');
const diagnostics = require('./diagnostics');
const notes = require('./notes');
const datastudio = require('./datastudio');
const rss = require('./rss');
const connections = require('./connections');
const calendar = require('./calendar');
const email = require('./email');
const modelbuilder = require('./modelbuilder');
const paper = require('./paper');
const tradingbot = require('./tradingbot');
const analyst = require('./analyst');
const portfolio = require('./portfolio');
const alerts = require('./alerts');
const dca = require('./dca');
const journal = require('./journal');
const screener = require('./screener');
const copilot = require('./copilot');
const shadowlab = require('./shadowlab');
const engines = require('./engines');
const terminal = require('./terminal');
const activity = require('./activity');
const vault = require('./vault');
const codebase = require('./codebase');
const fs = require('fs');

let win = null;
let tray = null;
let isQuitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0b0e14',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => {
    const startMin = store.get('settings.startMinimized', false) && process.argv.includes('--autostart');
    if (!startMin) win.show();
  });

  // Безопасность окна: запрещаем навигацию вовне и всплывающие окна,
  // внешние ссылки открываем только в системном браузере и только http(s).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (!isQuitting && store.get('settings.minimizeToTray', true)) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  // 16x16 violet dot as a programmatic tray icon (no binary assets needed)
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const cx = 7.5, cy = 7.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const i = (y * size + x) * 4;
      const a = d < 6 ? 255 : d < 7.2 ? Math.round(255 * (7.2 - d) / 1.2) : 0;
      buf[i] = 124; buf[i + 1] = 92; buf[i + 2] = 255; buf[i + 3] = a; // BGRA ~ violet
    }
  }
  const icon = nativeImage.createFromBitmap(buf, { width: size, height: size });
  tray = new Tray(icon);
  tray.setToolTip('Mythera AI Hub');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Mythera AI Hub', click: () => { win.show(); win.focus(); } },
    { label: 'Voice assistant', click: () => { win.show(); win.webContents.send('navigate', 'voice'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}

// Каналы, которые попадают в центр уведомлений (история событий).
function recordNotification(channel, p) {
  try {
    if (channel === 'watcher:fired') return notifications.add({ kind: 'watcher', title: p.title || 'Наблюдатель', message: p.message || '' });
    if (channel === 'scheduler:fired') return notifications.add({ kind: 'flow', title: p.title || p.name || 'Сценарий', message: p.message || '' });
    if (channel === 'learner:skill') return notifications.add({ kind: 'skill', title: 'Новый скил предложен', message: (p.skill && p.skill.label) || '' });
    if (channel === 'trade:log' && p && ['executed', 'simulated', 'blocked', 'failed', 'panic'].includes(p.kind)) {
      const o = p.order || {};
      return notifications.add({ kind: 'trade', title: 'Сделка: ' + p.kind, message: `${o.direction || ''} ${o.lots || ''} ${o.ticker || o.figi || ''} ${p.reason || ''}`.trim() });
    }
  } catch { /* notifications best effort */ }
}
// Каналы, которые попадают в единую ленту активности (аудит). Тул-вызовы и
// команды терминала логируются у источника, поэтому здесь — события верхнего уровня.
const ACTIVITY_CHANNELS = {
  'watcher:fired': 'alert', 'scheduler:fired': 'schedule', 'trade:log': 'trade',
  'flow:done': 'automation', 'mcp:connected': 'system', 'agents:reason': 'reason'
};
function captureActivity(channel, payload) {
  if (channel === 'activity:added') return; // защита от рекурсии
  const type = ACTIVITY_CHANNELS[channel];
  if (!type) return;
  try {
    const p = payload || {};
    let title, detail, level = p.level || 'info';
    if (channel === 'trade:log') {
      const o = p.order || {};
      title = `${p.kind || 'trade'}: ${o.direction || ''} ${o.lots || ''} ${o.ticker || o.figi || ''}`.trim();
      detail = p.reason || o.orderType || '';
      if (/reject|error|fail/i.test(p.kind || '')) level = 'error';
    } else {
      title = p.title || p.name || p.message || channel;
      detail = (p.title && p.message) ? p.message : (p.detail || '');
    }
    activity.log({ type, source: channel.split(':')[0], title, detail, level });
  } catch {}
}
function sendToUI(channel, payload) {
  recordNotification(channel, payload);
  captureActivity(channel, payload);
  // Склейка: трейдинговые события → внешние каналы (если включено в подключениях).
  if (channel === 'watcher:fired' && payload && /[🤖🧭💵🔔📈🚪🛑]/.test(payload.title || '')) {
    const txt = ((payload.title || '') + '\n' + (payload.message || '')).slice(0, 600);
    if (store.get('settings.tradeAlertsTelegram', false)) connections.telegramSend(txt).catch(() => {});
    if (store.get('settings.tradeAlertsDiscord', false)) connections.discordSend(txt).catch(() => {});
    if (store.get('settings.tradeAlertsSlack', false)) connections.slackSend(txt).catch(() => {});
  }
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Ежедневный P&L-дайджест: сводка бумажного портфеля + журнала → уведомление/Telegram.
function dailyDigest(force) {
  if (!force && !store.get('settings.dailyDigest', false)) return;
  const today = new Date().toISOString().slice(0, 10);
  if (!force && store.get('lastDigestDay', '') === today) return;
  store.set('lastDigestDay', today);
  try {
    const v = paper.valuation();
    const s = journal.stats();
    const msg = `Капитал ${v.equity} (P&L ${v.totalPnl >= 0 ? '+' : ''}${v.totalPnl}, ${v.totalPnlPct}%) · позиций ${v.positions.length}` + (s.count ? ` · винрейт ${s.winRate}% за ${s.count} сделок` : '');
    sendToUI('watcher:fired', { title: '📊 Дневной дайджест', message: msg });
  } catch {}
}

app.whenReady().then(async () => {
  createWindow();
  createTray();

  scheduler.init({
    runAgentTask: (task) => agent.runScheduledTask(task, sendToUI),
    speak: (text) => voice.speak(text),
    notify: (payload) => sendToUI('scheduler:fired', payload)
  });

  voice.init({
    onTranscript: (t) => sendToUI('voice:transcript', t),
    onCommand: async (text) => {
      sendToUI('voice:command', text);
      const reply = await agent.quickAsk(text, sendToUI);
      if (store.get('settings.voiceReplies', true)) voice.speak(reply);
      sendToUI('voice:reply', reply);
    },
    onSpeak: (text) => sendToUI('voice:speak-request', text),
    onState: (s) => sendToUI('voice:state', s)
  });

  // Global hotkey: toggle voice listening.
  // Используем выделенный канал voice:hotkey — рендерер сам владеет состоянием
  // распознавания. Не дёргаем voice.toggle(), чтобы не было эха voice:state,
  // которое раньше создавало бесконечный цикл вкл/выкл.
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => sendToUI('voice:hotkey'));
  } catch { /* hotkey may be taken */ }

  // Бесшовное управление приложением агентами: даём модулю отправлять события в UI.
  require('./appcontrol').setUISender(sendToUI);

  // Веб-автоматизация: даём модулю доступ к главному окну (BrowserView).
  webagent.init({ getWin: () => win });

  // MCP: подключаем настроенные внешние серверы инструментов (если включено).
  if (store.get('settings.mcpEnabled', false)) {
    mcp.connectAll().then((r) => sendToUI('mcp:connected', r)).catch(() => {});
  }

  // Анализ данных: модуль шлёт построенные графики в панель артефактов.
  analysis.setUISender(sendToUI);
  codebase.setUISender(sendToUI);
  // Лента активности: живые обновления в раздел «Активность».
  activity.setUISender(sendToUI);
  // Брокер/торговля: подтверждения и аудит-события в UI.
  trading.setUISender(sendToUI);
  // Центр уведомлений.
  notifications.setUISender(sendToUI);
  // Генерация изображений: результат в панель артефактов.
  imagegen.setUISender(sendToUI);

  // Глобальный быстрый запуск (Spotlight для ИИ) + горячая клавиша.
  quickask.init({ getMainWin: () => win });
  try { globalShortcut.register('CommandOrControl+Shift+A', () => quickask.toggle()); } catch { /* hotkey may be taken */ }

  // Проактивные наблюдатели + сценарии-конвейеры.
  const runAgent = async (agentId, prompt) => (await agent.chat({ agentId, message: prompt, history: [] }, sendToUI)).text;
  watchers.init({ runAgent, notify: (p) => sendToUI('watcher:fired', p) });
  watchers.startAll();
  flows.init({
    runAgent,
    runTool: (name, args) => agent.dispatchTool(name, args),
    speak: (text) => voice.speak(text),
    notify: (p) => sendToUI('scheduler:fired', p)
  });
  flows.startupRun(sendToUI);

  // Календарь: напоминания о событиях.
  calendar.init({ notify: (p) => sendToUI('watcher:fired', p) });
  // ИИ-режим торговли (по умолчанию бумажный счёт).
  tradingbot.init({ sendToUI });
  // Алерты по индикаторам/ценам → уведомления.
  alerts.init({ notify: (p) => sendToUI('watcher:fired', p) });
  // DCA-автопокупки по расписанию.
  dca.init({ notify: (p) => sendToUI('watcher:fired', p) });
  // «ИИ за рулём» — проактивный супервайзер.
  copilot.init({ sendToUI });
  // Ежедневный дайджест (проверяем раз в час, шлём раз в день).
  setInterval(dailyDigest, 3600000);
  setTimeout(dailyDigest, 60000);

  // Очередь задач: пробрасываем события в UI и возобновляем незавершённые.
  taskQueue.load();
  ['task:added', 'task:started', 'task:progress', 'task:finished', 'queue:update'].forEach((ev) =>
    taskQueue.on(ev, (payload) => sendToUI('taskq:event', { ev, payload })));
  taskQueue.process();

  // Удалённый доступ (локальный сервер) — автозапуск, если включён.
  if (store.get('dispatch.enabled', false)) {
    dispatch.start().then((s) => sendToUI('dispatch:status', s)).catch(() => {});
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { isQuitting = true; voice.stop(); scheduler.shutdown(); try { mcp.disconnectAll(); } catch {} try { webagent.close(); } catch {} try { watchers.stopAll(); } catch {} try { quickask.destroy(); } catch {} try { calendar.shutdown(); } catch {} try { alerts.shutdown(); } catch {} try { dca.shutdown(); } catch {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ---------------- IPC: window controls ---------------- */
ipcMain.handle('win:minimize', () => win.minimize());
ipcMain.handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.handle('win:close', () => win.close());

/* ---------------- IPC: settings / store ---------------- */
ipcMain.handle('store:get', (_e, key, def) => store.get(key, def));
ipcMain.handle('store:set', (_e, key, value) => { store.set(key, value); return true; });

/* ---------------- IPC: system ---------------- */
ipcMain.handle('system:info', () => system.getInfo());
ipcMain.handle('system:stats', () => system.getStats());
ipcMain.handle('system:setAutostart', (_e, enabled) => system.setAutostart(enabled));
ipcMain.handle('system:openExternal', (_e, url) => { if (system.isSafeUrl(url)) shell.openExternal(url); return true; });
ipcMain.handle('system:listDrives', () => system.listDrives());
ipcMain.handle('system:security', () => system.securityInfo());
ipcMain.handle('system:testCommand', (_e, cmd) => system.screenTest(cmd));
ipcMain.handle('system:saveUpload', (_e, name, b64) => system.saveUpload(name, b64));
ipcMain.handle('system:pickFolder', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: (opts && opts.title) || 'Выберите папку' });
  return r.canceled ? null : r.filePaths[0];
});

/* ---------------- IPC: ollama / installer ---------------- */
ipcMain.handle('ollama:status', () => ollama.status());
ipcMain.handle('ollama:models', () => ollama.listModels());
ipcMain.handle('ollama:start', () => ollama.startServer());
ipcMain.handle('installer:installOllama', () => installer.installOllama((p) => sendToUI('installer:progress', p)));
ipcMain.handle('installer:pullModel', (_e, name) => installer.pullModel(name, (p) => sendToUI('installer:progress', p)));
ipcMain.handle('installer:deleteModel', (_e, name) => ollama.deleteModel(name));
ipcMain.handle('installer:catalog', () => installer.getCatalog());
ipcMain.handle('installer:recommend', () => installer.recommend());
ipcMain.handle('installer:quickSetup', (_e, models) => installer.quickSetup((p) => sendToUI('installer:progress', p), models));
ipcMain.handle('installer:setModelsDir', (_e, dir) => installer.setModelsDir(dir));
ipcMain.handle('installer:getModelsDir', () => installer.getModelsDir());

/* ---------------- IPC: agents ---------------- */
ipcMain.handle('agents:list', () => agent.listAgents());
ipcMain.handle('agents:save', (_e, a) => agent.saveAgent(a));
ipcMain.handle('agents:delete', (_e, id) => agent.deleteAgent(id));
ipcMain.handle('agents:templates', () => agent.getTemplates());
ipcMain.handle('agents:chat', (_e, payload) => agent.chat(payload, sendToUI));
ipcMain.handle('agents:stop', (_e, sessionId) => agent.stopSession(sessionId));
ipcMain.handle('agents:history', () => agent.getHistory());
ipcMain.handle('agents:clearHistory', () => agent.clearHistory());
ipcMain.handle('agents:export', (_e, id) => agent.exportAgent(id));
ipcMain.handle('agents:import', (_e, obj) => agent.importAgent(obj));
ipcMain.handle('agents:addTemplate', (_e, tplId) => agent.addFromTemplate(tplId));

/* ---------------- IPC: licensing / monetization ---------------- */
ipcMain.handle('license:status', () => licensing.status());
ipcMain.handle('license:activate', (_e, key) => licensing.activate(key));
ipcMain.handle('license:startTrial', () => licensing.startTrial());
ipcMain.handle('license:deactivate', () => licensing.deactivate());
ipcMain.handle('license:can', (_e, kind, count) => licensing.can(kind, count));

/* ---------------- IPC: scheduler ---------------- */
ipcMain.handle('tasks:list', () => scheduler.listTasks());
ipcMain.handle('tasks:save', (_e, t) => scheduler.saveTask(t));
ipcMain.handle('tasks:delete', (_e, id) => scheduler.deleteTask(id));
ipcMain.handle('tasks:toggle', (_e, id, enabled) => scheduler.toggleTask(id, enabled));
ipcMain.handle('tasks:runNow', (_e, id) => scheduler.runNow(id));

/* ---------------- IPC: memory ---------------- */
ipcMain.handle('memory:list', (_e, agentId) => memory.listFacts(agentId));
ipcMain.handle('memory:clear', (_e, agentId) => memory.clearFacts(agentId));
ipcMain.handle('memory:add', (_e, agentId, text) => { memory.addFact(agentId, text, 3); return memory.listFacts(agentId); });

/* ---------------- IPC: minecraft ---------------- */
ipcMain.handle('mc:checkEnv', () => minecraft.checkEnv());
ipcMain.handle('mc:templates', () => minecraft.TEMPLATES);
ipcMain.handle('mc:list', () => minecraft.listProjects());
ipcMain.handle('mc:create', (_e, opts) => minecraft.createProject(opts));
ipcMain.handle('mc:compile', (_e, name) => minecraft.compileProject(name, (log) => sendToUI('mc:log', { name, log })));
ipcMain.handle('mc:delete', (_e, name) => minecraft.deleteProject(name));
ipcMain.handle('mc:createMod', (_e, opts) => minecraft.createMod(opts));
ipcMain.handle('mc:compileMod', (_e, name) => minecraft.compileMod(name, (log) => sendToUI('mc:log', { name, log })));
ipcMain.handle('mc:modLoaders', () => minecraft.MOD_LOADERS);

/* ---------------- IPC: remote servers ---------------- */
ipcMain.handle('remote:list', () => remote.listConnections());
ipcMain.handle('remote:save', (_e, c) => remote.saveConnection(c));
ipcMain.handle('remote:delete', (_e, id) => remote.deleteConnection(id));
ipcMain.handle('remote:test', (_e, id) => remote.test(id));
ipcMain.handle('remote:ls', (_e, id, dir) => remote.listDir(id, dir));
ipcMain.handle('remote:read', (_e, id, p) => remote.readFile(id, p));
ipcMain.handle('remote:write', (_e, id, p, content) => remote.writeFile(id, p, content));
ipcMain.handle('remote:exec', (_e, id, cmd) => remote.exec(id, cmd));
ipcMain.handle('remote:available', () => remote.available);

/* ---------------- IPC: translator ---------------- */
ipcMain.handle('translate:text', (_e, opts) => translator.translateText(opts, (p) => sendToUI('translate:progress', p)));
ipcMain.handle('translate:file', (_e, opts) => translator.translateFile(opts, (p) => sendToUI('translate:progress', p)));

/* ---------------- IPC: voice ---------------- */
ipcMain.handle('voice:start', () => voice.start());
ipcMain.handle('voice:stopListen', () => voice.stop());
ipcMain.handle('voice:speak', (_e, text) => voice.speak(text));
ipcMain.handle('voice:state', () => voice.getState());
// Рендерер сообщает распознанную фразу / финальную команду.
ipcMain.handle('voice:transcript', (_e, text) => { voice.handleTranscript(text); return true; });
ipcMain.handle('voice:command', (_e, text) => { voice.handleCommand(text); return true; });

/* ---------------- IPC: task queue ---------------- */
ipcMain.handle('taskq:list', () => taskQueue.list());
ipcMain.handle('taskq:add', (_e, opts) => taskQueue.add(opts));
ipcMain.handle('taskq:cancel', (_e, id) => taskQueue.cancel(id));
ipcMain.handle('taskq:retry', (_e, id) => taskQueue.retry(id));
ipcMain.handle('taskq:remove', (_e, id) => taskQueue.remove(id));
ipcMain.handle('taskq:clearDone', () => taskQueue.clearDone());
ipcMain.handle('taskq:pause', (_e, v) => taskQueue.setPaused(v));
ipcMain.handle('taskq:duplicate', (_e, id) => taskQueue.duplicate(id));
ipcMain.handle('taskq:setPriority', (_e, id, p) => taskQueue.setPriority(id, p));
ipcMain.handle('taskq:runNow', (_e, id) => taskQueue.runNow(id));

/* ---------------- IPC: constitution ---------------- */
ipcMain.handle('constitution:text', () => constitution.text());

/* ---------------- IPC: tooling (quick installers) ---------------- */
ipcMain.handle('tooling:installSpeech', () => tooling.installSpeech((line) => sendToUI('tooling:log', { kind: 'speech', line })));
ipcMain.handle('tooling:installMcTools', () => tooling.installMcTools((line) => sendToUI('tooling:log', { kind: 'mc', line })));

/* ---------------- IPC: speech (Piper / Faster-Whisper) ---------------- */
ipcMain.handle('speech:detect', () => speech.detect());
ipcMain.handle('speech:synthesize', (_e, text) => speech.synthesize(text));
ipcMain.handle('speech:transcribe', (_e, b64, mime) => speech.transcribe(b64, mime));

/* ---------------- IPC: RAG memory ---------------- */
ipcMain.handle('rag:stats', (_e, scope) => rag.stats(scope || 'kb'));
ipcMain.handle('rag:add', (_e, scope, text, source) => rag.addDocument(scope || 'kb', text, source));
ipcMain.handle('rag:ingestFile', (_e, scope, file) => rag.ingestFile(scope || 'kb', file));
ipcMain.handle('rag:clear', (_e, scope) => rag.clearDocs(scope || 'kb'));
ipcMain.handle('rag:retrieve', (_e, scope, q) => rag.retrieve(scope || 'kb', q));

/* ---------------- IPC: swarm (multi-agent) ---------------- */
ipcMain.handle('swarm:run', (_e, opts) => swarm.run(opts, sendToUI));

/* ---------------- IPC: skills (plugins) ---------------- */
ipcMain.handle('skills:list', () => skills.listSkills());
ipcMain.handle('skills:save', (_e, s) => skills.saveSkill(s));
ipcMain.handle('skills:delete', (_e, id) => skills.deleteSkill(id));
ipcMain.handle('skills:export', (_e, id) => skills.exportSkill(id));
ipcMain.handle('skills:import', (_e, obj) => skills.importSkill(obj));

/* ---------------- IPC: computer vision ---------------- */
ipcMain.handle('screen:capture', () => screen.capture());

/* ---------------- IPC: browser / music ---------------- */
ipcMain.handle('browser:play', (_e, query, service) => browser.playMusic(query, service));
ipcMain.handle('browser:open', (_e, name) => browser.openService(name));
ipcMain.handle('browser:search', (_e, q, engine) => browser.webSearch(q, engine));
ipcMain.handle('browser:musicServices', () => browser.musicServices());

/* ---------------- IPC: system audio (volume) ---------------- */
ipcMain.handle('audio:get', () => audio.getVolume());
ipcMain.handle('audio:set', (_e, p) => audio.setVolume(p));
ipcMain.handle('audio:adjust', (_e, d) => audio.adjust(d));
ipcMain.handle('audio:mute', (_e, m) => audio.mute(m));

/* ---------------- IPC: smart home ---------------- */
ipcMain.handle('smart:protocols', () => smarthome.PROTOCOLS);
ipcMain.handle('smart:list', () => smarthome.listDevices());
ipcMain.handle('smart:save', (_e, d) => smarthome.saveDevice(d));
ipcMain.handle('smart:delete', (_e, id) => smarthome.deleteDevice(id));
ipcMain.handle('smart:execute', (_e, id, action, value) => smarthome.execute(id, action, value));
ipcMain.handle('smart:test', (_e, id) => smarthome.test(id));

/* ---------------- IPC: full control (pro) ---------------- */
ipcMain.handle('store:all', () => store.all());
ipcMain.handle('store:replaceAll', (_e, obj) => store.replaceAll(obj));
ipcMain.handle('ollama:raw', (_e, payload) => ollama.chatStream(payload, null));

/* ---------------- IPC: dispatch (remote access) ---------------- */
ipcMain.handle('dispatch:status', () => dispatch.status());
ipcMain.handle('dispatch:start', () => { store.set('dispatch.enabled', true); return dispatch.start(); });
ipcMain.handle('dispatch:stop', () => { store.set('dispatch.enabled', false); return dispatch.stop(); });
ipcMain.handle('dispatch:regenToken', () => { dispatch.regenToken(); return dispatch.status(); });
ipcMain.handle('dispatch:setOption', (_e, key, value) => { store.set('dispatch.' + key, value); return dispatch.status(); });

/* ---------------- IPC: MCP (external tool servers) ---------------- */
ipcMain.handle('mcp:list', () => mcp.listConnected());
ipcMain.handle('mcp:servers', () => mcp.cfg());
ipcMain.handle('mcp:save', (_e, c) => mcp.saveServer(c));
ipcMain.handle('mcp:delete', (_e, id) => mcp.deleteServer(id));
ipcMain.handle('mcp:connect', async () => { const r = await mcp.connectAll(); sendToUI('mcp:connected', r); return r; });
ipcMain.handle('mcp:disconnect', () => { mcp.disconnectAll(); return { ok: true }; });

/* ---------------- IPC: web automation ---------------- */
ipcMain.handle('web:goto', (_e, url) => webagent.goto(url));
ipcMain.handle('web:read', () => webagent.readPage());
ipcMain.handle('web:show', (_e, v) => { webagent.setVisible(!!v); return { ok: true }; });
ipcMain.handle('web:close', () => { webagent.close(); return { ok: true }; });

/* ---------------- IPC: document understanding ---------------- */
ipcMain.handle('docs:capabilities', () => docs.capabilities());
ipcMain.handle('docs:read', (_e, p) => docs.readDocument(p));
ipcMain.handle('docs:ingest', (_e, p, scope) => docs.ingestDocument(p, scope));

/* ---------------- IPC: cloud bridge ---------------- */
ipcMain.handle('cloud:test', () => cloud.test());
ipcMain.handle('cloud:setKey', (_e, key) => cloud.setKey(key));
ipcMain.handle('cloud:hasKey', () => ({ hasKey: cloud.hasKey(), enabled: cloud.enabled() }));
ipcMain.handle('cloud:ask', (_e, messages, opts) => cloud.ask(messages, opts));

/* ---------------- IPC: model routing ---------------- */
ipcMain.handle('models:installed', () => modelrouter.installed());
ipcMain.handle('models:pick', (_e, kind, fallback) => modelrouter.pick(kind, fallback));

/* ---------------- IPC: computer-use operator ---------------- */
ipcMain.handle('operator:run', (_e, opts) => operator.run(opts, sendToUI));
ipcMain.handle('operator:stop', (_e, sessionId) => operator.stop(sessionId));

/* ---------------- IPC: project workspaces ---------------- */
ipcMain.handle('projects:list', () => projects.list());
ipcMain.handle('projects:active', () => projects.active());
ipcMain.handle('projects:create', (_e, name) => projects.create(name));
ipcMain.handle('projects:rename', (_e, id, name) => projects.rename(id, name));
ipcMain.handle('projects:remove', (_e, id) => projects.remove(id));
ipcMain.handle('projects:setActive', (_e, id) => projects.setActive(id));

/* ---------------- IPC: quick-ask launcher ---------------- */
ipcMain.handle('quickask:context', () => quickask.getContext());
ipcMain.handle('quickask:hide', () => { quickask.hide(); return true; });
ipcMain.handle('quickask:show', () => { quickask.show(); return true; });

/* ---------------- IPC: proactive watchers ---------------- */
ipcMain.handle('watchers:list', () => watchers.list());
ipcMain.handle('watchers:save', (_e, w) => watchers.save(w));
ipcMain.handle('watchers:remove', (_e, id) => watchers.remove(id));
ipcMain.handle('watchers:toggle', (_e, id, on) => watchers.toggle(id, on));
ipcMain.handle('watchers:fireNow', (_e, id) => watchers.fireNow(id));

/* ---------------- IPC: broker / auto-trading ---------------- */
ipcMain.handle('trade:cfg', () => trading.publicCfg());
ipcMain.handle('trade:setCfg', (_e, patch) => trading.setCfg(patch));
ipcMain.handle('trade:setToken', (_e, tok) => trading.setToken(tok));
ipcMain.handle('trade:test', () => trading.test());
ipcMain.handle('trade:portfolio', (_e, accountId) => trading.getPortfolio(accountId));
ipcMain.handle('trade:find', (_e, q) => trading.findInstrument(q));
ipcMain.handle('trade:order', (_e, o) => trading.requestOrder(o, 'manual'));
ipcMain.handle('trade:confirm', (_e, id) => trading.confirmOrder(id));
ipcMain.handle('trade:reject', (_e, id) => trading.rejectOrder(id));
ipcMain.handle('trade:panic', () => trading.panic());
ipcMain.handle('trade:log', () => trading.getLog());

/* ---------------- IPC: image generation (Stable Diffusion) ---------------- */
ipcMain.handle('img:status', () => imagegen.status());
ipcMain.handle('img:generate', (_e, opts) => imagegen.generate(opts));

/* ---------------- IPC: code workspace (mini-IDE) ---------------- */
ipcMain.handle('ws:tree', () => workspace.tree());
ipcMain.handle('ws:read', (_e, p) => workspace.read(p));
ipcMain.handle('ws:write', (_e, p, c) => workspace.write(p, c));
ipcMain.handle('ws:create', (_e, p, isDir) => workspace.create(p, isDir));
ipcMain.handle('ws:remove', (_e, p) => workspace.remove(p));
ipcMain.handle('ws:run', (_e, p) => workspace.run(p));

/* ---------------- IPC: news & sentiment ---------------- */
ipcMain.handle('news:fetch', (_e, q) => news.fetchNews(q));
ipcMain.handle('news:sentiment', (_e, q) => news.sentiment(q));

/* ---------------- IPC: web-to-RAG crawler ---------------- */
ipcMain.handle('crawler:learn', (_e, opts) => crawler.learn(opts, (p) => sendToUI('crawler:progress', p)));

/* ---------------- IPC: diagnostics ---------------- */
ipcMain.handle('diag:run', () => diagnostics.run());

/* ---------------- IPC: connections (GitHub/Telegram/webhook) ---------------- */
ipcMain.handle('conn:status', () => connections.status());
ipcMain.handle('conn:setToken', (_e, key, val) => connections.setTok(key, val));
ipcMain.handle('conn:set', (_e, k, v) => { store.set('settings.' + k, v); return true; });
ipcMain.handle('conn:githubUser', () => connections.githubUser());
ipcMain.handle('conn:githubRepos', () => connections.githubRepos());
ipcMain.handle('conn:githubIssues', (_e, repo) => connections.githubIssues(repo));
ipcMain.handle('conn:githubCreateIssue', (_e, repo, title, body) => connections.githubCreateIssue(repo, title, body));
ipcMain.handle('conn:telegramTest', () => connections.telegramTest());
ipcMain.handle('conn:webhook', (_e, url, payload) => connections.webhookPost(url, payload));
ipcMain.handle('conn:githubPRs', (_e, repo) => connections.githubPRs(repo));
ipcMain.handle('conn:githubCommits', (_e, repo) => connections.githubCommits(repo));
ipcMain.handle('conn:githubSearch', (_e, q) => connections.githubSearch(q));
ipcMain.handle('conn:githubNotifications', () => connections.githubNotifications());
ipcMain.handle('conn:discordTest', () => connections.discordTest());
ipcMain.handle('conn:slackTest', () => connections.slackTest());
ipcMain.handle('conn:weather', (_e, place) => connections.weather(place));

/* ---------------- IPC: calendar ---------------- */
ipcMain.handle('cal:list', (_e, from, to) => calendar.list(from, to));
ipcMain.handle('cal:save', (_e, ev) => calendar.save(ev));
ipcMain.handle('cal:remove', (_e, id) => calendar.remove(id));
ipcMain.handle('cal:exportICS', () => calendar.exportICS());
ipcMain.handle('cal:importICS', (_e, text) => calendar.importICS(text));

/* ---------------- IPC: email ---------------- */
ipcMain.handle('email:cfg', () => email.publicCfg());
ipcMain.handle('email:setCfg', (_e, patch) => email.setCfg(patch));
ipcMain.handle('email:setPass', (_e, p) => email.setPass(p));
ipcMain.handle('email:fetch', (_e, n) => email.imapFetch(n));
ipcMain.handle('email:send', (_e, msg) => email.smtpSend(msg));

/* ---------------- IPC: model builder ---------------- */
ipcMain.handle('mb:preview', (_e, opts) => modelbuilder.preview(opts));
ipcMain.handle('mb:create', (_e, opts) => modelbuilder.create(opts, (line) => sendToUI('mb:log', { line })));

/* ---------------- IPC: notes (second brain) ---------------- */
ipcMain.handle('notes:list', () => notes.list());
ipcMain.handle('notes:get', (_e, id) => notes.get(id));
ipcMain.handle('notes:save', (_e, n) => notes.save(n));
ipcMain.handle('notes:remove', (_e, id) => notes.remove(id));
ipcMain.handle('notes:search', (_e, q) => notes.search(q));
ipcMain.handle('notes:backlinks', (_e, title) => notes.backlinks(title));
ipcMain.handle('notes:byTitle', (_e, title) => notes.getByTitle(title));
ipcMain.handle('notes:graph', () => notes.graph());

/* ---------------- IPC: data studio (SQL/CSV) ---------------- */
ipcMain.handle('data:files', () => datastudio.listFiles());
ipcMain.handle('data:describe', (_e, f) => datastudio.describe(f));
ipcMain.handle('data:query', (_e, f, sql) => datastudio.query(f, sql));

/* ---------------- IPC: RSS reader ---------------- */
ipcMain.handle('rss:feeds', () => rss.feeds());
ipcMain.handle('rss:add', (_e, url, title) => rss.addFeed(url, title));
ipcMain.handle('rss:remove', (_e, url) => rss.removeFeed(url));
ipcMain.handle('rss:aggregate', () => rss.aggregate());
ipcMain.handle('rss:digest', () => rss.digest());

/* ---------------- IPC: PDF export (native printToPDF) ---------------- */
ipcMain.handle('pdf:export', async (_e, htmlBody, title) => {
  let w;
  try {
    const safeTitle = String(title || 'report').replace(/[^\wа-яА-Я\- ]+/g, '_').slice(0, 80);
    const css = 'body{font-family:Segoe UI,Arial,sans-serif;color:#111;margin:32px;line-height:1.5} h1{color:#5b3df5} h2{border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:24px} table{border-collapse:collapse;width:100%;margin:8px 0} th,td{border:1px solid #ccc;padding:6px 9px;text-align:left;font-size:13px} code,pre{background:#f4f4f8;border-radius:4px;padding:2px 5px} img{max-width:100%} .muted{color:#777}';
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${htmlBody}</body></html>`;
    const tmp = path.join(app.getPath('temp'), 'mythera-report-' + Date.now() + '.html');
    fs.writeFileSync(tmp, html, 'utf8');
    w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await w.loadFile(tmp);
    const pdf = await w.webContents.printToPDF({ printBackground: true, margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    const dir = store.get('settings.fullDiskAccess', false) ? app.getPath('downloads') : app.getPath('downloads');
    const out = path.join(dir, safeTitle + '.pdf');
    fs.writeFileSync(out, pdf);
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: true, path: out };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { if (w && !w.isDestroyed()) w.destroy(); }
});

/* ---------------- IPC: model playground ---------------- */
ipcMain.handle('playground:ask', async (_e, model, prompt, opts) => {
  const t0 = Date.now(); let chars = 0;
  try {
    const r = await ollama.chatStream({ model, messages: [{ role: 'user', content: String(prompt || '') }], options: opts || {} }, (c) => { chars += c.length; });
    const ms = Date.now() - t0; const tokens = Math.round(chars / 4);
    return { ok: true, model, text: r.content || '', ms, tokens, tps: ms > 0 ? +(tokens / (ms / 1000)).toFixed(1) : 0 };
  } catch (e) { return { ok: false, model, error: e.message }; }
});

/* ---------------- IPC: backtesting ---------------- */
ipcMain.handle('backtest:run', (_e, opts) => backtest.run(opts));
ipcMain.handle('backtest:strategies', () => backtest.STRATEGIES);
ipcMain.handle('backtest:optimize', (_e, opts) => backtest.optimize(opts));

/* ---------------- IPC: AI trading bot + paper account ---------------- */
ipcMain.handle('bot:cfg', () => tradingbot.publicCfg());
ipcMain.handle('bot:setCfg', (_e, patch) => tradingbot.setCfg(patch));
ipcMain.handle('bot:applyProfile', (_e, name) => tradingbot.applyProfile(name));
ipcMain.handle('bot:runOnce', () => tradingbot.runOnce());
ipcMain.handle('analyst:deep', (_e, symbol, horizon) => analyst.deepAnalysis(symbol, horizon));
ipcMain.handle('portfolio:analyze', (_e, quotes) => portfolio.analyze(quotes));
ipcMain.handle('alerts:list', () => alerts.list());
ipcMain.handle('alerts:save', (_e, a) => alerts.save(a));
ipcMain.handle('alerts:remove', (_e, id) => alerts.remove(id));
ipcMain.handle('alerts:toggle', (_e, id, on) => alerts.toggle(id, on));
ipcMain.handle('dca:list', () => dca.list());
ipcMain.handle('dca:save', (_e, p) => dca.save(p));
ipcMain.handle('dca:remove', (_e, id) => dca.remove(id));
ipcMain.handle('dca:toggle', (_e, id, on) => dca.toggle(id, on));
ipcMain.handle('dca:runNow', (_e, id) => dca.runNow(id));
ipcMain.handle('journal:list', () => journal.list());
ipcMain.handle('journal:save', (_e, e) => journal.save(e));
ipcMain.handle('journal:remove', (_e, id) => journal.remove(id));
ipcMain.handle('journal:syncPaper', () => journal.syncPaper());
ipcMain.handle('journal:stats', () => journal.stats());
ipcMain.handle('journal:review', () => journal.review());
ipcMain.handle('markets:correlation', (_e, symbols) => markets.correlation(symbols));
ipcMain.handle('backtest:runBot', (_e, opts) => backtest.runBot(opts));
ipcMain.handle('backtest:bestStrategy', (_e, opts) => backtest.bestStrategy(opts));
ipcMain.handle('backtest:montecarlo', (_e, opts) => backtest.montecarlo(opts));
ipcMain.handle('term:run', (_e, line) => terminal.run(line));
ipcMain.handle('term:state', () => terminal.state());
ipcMain.handle('activity:list', (_e, q) => activity.list(q || {}));
ipcMain.handle('activity:stats', () => activity.stats());
ipcMain.handle('activity:clear', () => activity.clear());
ipcMain.handle('engines:status', () => engines.status());
ipcMain.handle('engines:stopAll', () => engines.stopAll());
ipcMain.handle('vault:list', () => vault.list());
ipcMain.handle('vault:get', (_e, id) => vault.get(id));
ipcMain.handle('vault:save', (_e, e) => vault.save(e));
ipcMain.handle('vault:remove', (_e, id) => vault.remove(id));
ipcMain.handle('vault:available', () => vault.available());
ipcMain.handle('codebase:index', (_e, opts) => codebase.index(opts, (p) => sendToUI('codebase:progress', p)));
ipcMain.handle('codebase:search', (_e, opts) => codebase.search(opts));
ipcMain.handle('codebase:root', () => store.get('codebaseRoot', ''));
ipcMain.handle('lab:run', (_e, opts) => shadowlab.lab(opts));
ipcMain.handle('lab:markers', (_e, opts) => shadowlab.markers(opts));
ipcMain.handle('trade:digest', () => { dailyDigest(true); return { ok: true }; });
ipcMain.handle('lab:track', (_e, sym) => shadowlab.track(sym));
ipcMain.handle('lab:untrack', (_e, sym) => shadowlab.untrack(sym));
ipcMain.handle('screener:scan', (_e, filters, custom) => screener.scan(filters, custom));
ipcMain.handle('screener:breadth', () => screener.breadth());
ipcMain.handle('portfolio:rebalancePlan', (_e, t, q) => portfolio.rebalancePlan(t, q));
ipcMain.handle('portfolio:rebalanceApply', (_e, t, q) => portfolio.rebalanceApply(t, q));
ipcMain.handle('copilot:cfg', () => copilot.publicCfg());
ipcMain.handle('copilot:setCfg', (_e, patch) => copilot.setCfg(patch));
ipcMain.handle('copilot:proposals', () => copilot.proposals());
ipcMain.handle('copilot:act', (_e, id) => copilot.act(id));
ipcMain.handle('copilot:dismiss', (_e, id) => copilot.dismiss(id));
ipcMain.handle('copilot:monitor', () => copilot.monitor());
ipcMain.handle('paper:valuation', (_e, quotes) => paper.valuation(quotes));
ipcMain.handle('paper:history', () => paper.history());
ipcMain.handle('paper:reset', (_e, cash) => paper.reset(cash));
ipcMain.handle('paper:trade', (_e, o) => paper.trade(o));

/* ---------------- IPC: notifications center ---------------- */
ipcMain.handle('notif:list', () => notifications.list());
ipcMain.handle('notif:unread', () => notifications.unread());
ipcMain.handle('notif:add', (_e, e) => notifications.add(e));
ipcMain.handle('notif:markRead', (_e, id) => notifications.markRead(id));
ipcMain.handle('notif:markAllRead', () => notifications.markAllRead());
ipcMain.handle('notif:clear', () => notifications.clear());

/* ---------------- IPC: reports / telemetry ---------------- */
ipcMain.handle('reports:telemetry', () => reports.telemetrySummary());
ipcMain.handle('reports:telemetryClear', () => reports.telemetryClear());

/* ---------------- IPC: markets (stocks/futures/crypto) ---------------- */
ipcMain.handle('markets:candles', (_e, opts) => markets.candles(opts));
ipcMain.handle('markets:search', (_e, q) => markets.search(q));
ipcMain.handle('markets:analyze', (_e, opts) => markets.analyze(opts));
ipcMain.handle('markets:watchlist', () => markets.getWatchlist());
ipcMain.handle('markets:setWatchlist', (_e, list) => markets.setWatchlist(list));

/* ---------------- IPC: workflow flows ---------------- */
ipcMain.handle('flows:list', () => flows.list());
ipcMain.handle('flows:save', (_e, f) => flows.save(f));
ipcMain.handle('flows:remove', (_e, id) => flows.remove(id));
ipcMain.handle('flows:run', (_e, id) => flows.run(id, sendToUI));

/* ---------------- IPC: feedback ratings ---------------- */
ipcMain.handle('feedback:rate', (_e, entry) => {
  const list = store.get('feedback', []);
  list.push({ ...entry, at: Date.now() });
  store.set('feedback', list.slice(-500));
  return { ok: true };
});
ipcMain.handle('feedback:list', () => store.get('feedback', []));
