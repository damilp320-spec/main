const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

const on = (ch, fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, handler);
  return () => ipcRenderer.removeListener(ch, handler);
};

contextBridge.exposeInMainWorld('nexus', {
  // Окно
  win: {
    minimize: () => invoke('win:minimize'),
    maximize: () => invoke('win:maximize'),
    close: () => invoke('win:close')
  },
  // Хранилище
  store: {
    get: (k, d) => invoke('store:get', k, d),
    set: (k, v) => invoke('store:set', k, v)
  },
  // Система
  system: {
    info: () => invoke('system:info'),
    stats: () => invoke('system:stats'),
    setAutostart: (e) => invoke('system:setAutostart', e),
    openExternal: (u) => invoke('system:openExternal', u)
  },
  // Ollama / установка
  installer: {
    ollamaStatus: () => invoke('ollama:status'),
    startServer: () => invoke('ollama:start'),
    listModels: () => invoke('ollama:models'),
    installOllama: () => invoke('installer:installOllama'),
    pullModel: (n) => invoke('installer:pullModel', n),
    deleteModel: (n) => invoke('installer:deleteModel', n),
    catalog: () => invoke('installer:catalog'),
    recommend: () => invoke('installer:recommend'),
    quickSetup: () => invoke('installer:quickSetup')
  },
  // Агенты
  agents: {
    list: () => invoke('agents:list'),
    save: (a) => invoke('agents:save', a),
    delete: (id) => invoke('agents:delete', id),
    templates: () => invoke('agents:templates'),
    chat: (p) => invoke('agents:chat', p),
    stop: (s) => invoke('agents:stop', s),
    history: () => invoke('agents:history'),
    clearHistory: () => invoke('agents:clearHistory')
  },
  // Планировщик
  tasks: {
    list: () => invoke('tasks:list'),
    save: (t) => invoke('tasks:save', t),
    delete: (id) => invoke('tasks:delete', id),
    toggle: (id, e) => invoke('tasks:toggle', id, e),
    runNow: (id) => invoke('tasks:runNow', id)
  },
  // Голос
  voice: {
    start: () => invoke('voice:start'),
    stop: () => invoke('voice:stopListen'),
    speak: (t) => invoke('voice:speak', t),
    state: () => invoke('voice:state'),
    reportTranscript: (t) => invoke('voice:transcript', t),
    reportCommand: (t) => invoke('voice:command', t)
  },
  // События из главного процесса
  on
});
