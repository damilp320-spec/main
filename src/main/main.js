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

function sendToUI(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
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

app.on('before-quit', () => { isQuitting = true; voice.stop(); scheduler.shutdown(); });
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
