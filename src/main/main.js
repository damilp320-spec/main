const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, globalShortcut } = require('electron');
const path = require('path');

const store = require('./store');
const ollama = require('./ollama');
const installer = require('./installer');
const agent = require('./agent');
const scheduler = require('./scheduler');
const voice = require('./voice');
const system = require('./system');

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
  win.once('ready-to-show', () => win.show());

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
  tray.setToolTip('Nexus AI Hub');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Nexus AI Hub', click: () => { win.show(); win.focus(); } },
    { label: 'Голосовой ассистент', click: () => { win.show(); win.webContents.send('navigate', 'voice'); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { isQuitting = true; app.quit(); } }
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

  // Global hotkey: toggle voice listening
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      const listening = voice.toggle();
      sendToUI('voice:state', { listening });
    });
  } catch { /* hotkey may be taken */ }

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
ipcMain.handle('system:openExternal', (_e, url) => shell.openExternal(url));

/* ---------------- IPC: ollama / installer ---------------- */
ipcMain.handle('ollama:status', () => ollama.status());
ipcMain.handle('ollama:models', () => ollama.listModels());
ipcMain.handle('ollama:start', () => ollama.startServer());
ipcMain.handle('installer:installOllama', () => installer.installOllama((p) => sendToUI('installer:progress', p)));
ipcMain.handle('installer:pullModel', (_e, name) => installer.pullModel(name, (p) => sendToUI('installer:progress', p)));
ipcMain.handle('installer:deleteModel', (_e, name) => ollama.deleteModel(name));
ipcMain.handle('installer:catalog', () => installer.getCatalog());
ipcMain.handle('installer:recommend', () => installer.recommend());
ipcMain.handle('installer:quickSetup', () => installer.quickSetup((p) => sendToUI('installer:progress', p)));

/* ---------------- IPC: agents ---------------- */
ipcMain.handle('agents:list', () => agent.listAgents());
ipcMain.handle('agents:save', (_e, a) => agent.saveAgent(a));
ipcMain.handle('agents:delete', (_e, id) => agent.deleteAgent(id));
ipcMain.handle('agents:templates', () => agent.getTemplates());
ipcMain.handle('agents:chat', (_e, payload) => agent.chat(payload, sendToUI));
ipcMain.handle('agents:stop', (_e, sessionId) => agent.stopSession(sessionId));
ipcMain.handle('agents:history', () => agent.getHistory());
ipcMain.handle('agents:clearHistory', () => agent.clearHistory());

/* ---------------- IPC: scheduler ---------------- */
ipcMain.handle('tasks:list', () => scheduler.listTasks());
ipcMain.handle('tasks:save', (_e, t) => scheduler.saveTask(t));
ipcMain.handle('tasks:delete', (_e, id) => scheduler.deleteTask(id));
ipcMain.handle('tasks:toggle', (_e, id, enabled) => scheduler.toggleTask(id, enabled));
ipcMain.handle('tasks:runNow', (_e, id) => scheduler.runNow(id));

/* ---------------- IPC: voice ---------------- */
ipcMain.handle('voice:start', () => voice.start());
ipcMain.handle('voice:stopListen', () => voice.stop());
ipcMain.handle('voice:speak', (_e, text) => voice.speak(text));
ipcMain.handle('voice:state', () => voice.getState());
// Рендерер сообщает распознанную фразу / финальную команду.
ipcMain.handle('voice:transcript', (_e, text) => { voice.handleTranscript(text); return true; });
ipcMain.handle('voice:command', (_e, text) => { voice.handleCommand(text); return true; });
