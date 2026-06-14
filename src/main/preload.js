const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

const on = (ch, fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, handler);
  return () => ipcRenderer.removeListener(ch, handler);
};

contextBridge.exposeInMainWorld('mythera', {
  // Окно
  win: {
    minimize: () => invoke('win:minimize'),
    maximize: () => invoke('win:maximize'),
    close: () => invoke('win:close')
  },
  // Хранилище
  store: {
    get: (k, d) => invoke('store:get', k, d),
    set: (k, v) => invoke('store:set', k, v),
    all: () => invoke('store:all'),
    replaceAll: (o) => invoke('store:replaceAll', o)
  },
  // Браузер / музыка
  browser: {
    play: (q, s) => invoke('browser:play', q, s),
    open: (n) => invoke('browser:open', n),
    search: (q, e) => invoke('browser:search', q, e),
    musicServices: () => invoke('browser:musicServices')
  },
  // Громкость системы
  audio: {
    get: () => invoke('audio:get'),
    set: (p) => invoke('audio:set', p),
    adjust: (d) => invoke('audio:adjust', d),
    mute: (m) => invoke('audio:mute', m)
  },
  // Умный дом
  smart: {
    protocols: () => invoke('smart:protocols'),
    list: () => invoke('smart:list'),
    save: (d) => invoke('smart:save', d),
    delete: (id) => invoke('smart:delete', id),
    execute: (id, a, v) => invoke('smart:execute', id, a, v),
    test: (id) => invoke('smart:test', id)
  },
  // Сырой вызов модели (полный контроль)
  ollamaRaw: (payload) => invoke('ollama:raw', payload),
  // Система
  system: {
    info: () => invoke('system:info'),
    stats: () => invoke('system:stats'),
    setAutostart: (e) => invoke('system:setAutostart', e),
    openExternal: (u) => invoke('system:openExternal', u),
    listDrives: () => invoke('system:listDrives'),
    pickFolder: (o) => invoke('system:pickFolder', o),
    security: () => invoke('system:security'),
    testCommand: (cmd) => invoke('system:testCommand', cmd),
    saveUpload: (name, b64) => invoke('system:saveUpload', name, b64)
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
    quickSetup: (models) => invoke('installer:quickSetup', models),
    setModelsDir: (dir) => invoke('installer:setModelsDir', dir),
    getModelsDir: () => invoke('installer:getModelsDir')
  },
  // Агенты
  agents: {
    list: () => invoke('agents:list'),
    save: (a) => invoke('agents:save', a),
    delete: (id) => invoke('agents:delete', id),
    templates: () => invoke('agents:templates'),
    addTemplate: (id) => invoke('agents:addTemplate', id),
    chat: (p) => invoke('agents:chat', p),
    stop: (s) => invoke('agents:stop', s),
    history: () => invoke('agents:history'),
    clearHistory: () => invoke('agents:clearHistory'),
    export: (id) => invoke('agents:export', id),
    import: (obj) => invoke('agents:import', obj)
  },
  // Лицензия / тарифы
  license: {
    status: () => invoke('license:status'),
    activate: (key) => invoke('license:activate', key),
    startTrial: () => invoke('license:startTrial'),
    deactivate: () => invoke('license:deactivate'),
    can: (kind, count) => invoke('license:can', kind, count)
  },
  // Планировщик
  tasks: {
    list: () => invoke('tasks:list'),
    save: (t) => invoke('tasks:save', t),
    delete: (id) => invoke('tasks:delete', id),
    toggle: (id, e) => invoke('tasks:toggle', id, e),
    runNow: (id) => invoke('tasks:runNow', id)
  },
  // Память
  memory: {
    list: (agentId) => invoke('memory:list', agentId),
    clear: (agentId) => invoke('memory:clear', agentId),
    add: (agentId, text) => invoke('memory:add', agentId, text)
  },
  // Minecraft-студия (плагины + Forge/Fabric моды)
  mc: {
    checkEnv: () => invoke('mc:checkEnv'),
    templates: () => invoke('mc:templates'),
    list: () => invoke('mc:list'),
    create: (o) => invoke('mc:create', o),
    compile: (n) => invoke('mc:compile', n),
    delete: (n) => invoke('mc:delete', n),
    createMod: (o) => invoke('mc:createMod', o),
    compileMod: (n) => invoke('mc:compileMod', n),
    modLoaders: () => invoke('mc:modLoaders')
  },
  // RAG-память (эмбеддинги)
  rag: {
    stats: (scope) => invoke('rag:stats', scope),
    add: (scope, text, source) => invoke('rag:add', scope, text, source),
    ingestFile: (scope, file) => invoke('rag:ingestFile', scope, file),
    clear: (scope) => invoke('rag:clear', scope),
    retrieve: (scope, q) => invoke('rag:retrieve', scope, q)
  },
  // Мультиагентные сценарии (swarm)
  swarm: { run: (o) => invoke('swarm:run', o) },
  // Плагины-скилы
  skills: {
    list: () => invoke('skills:list'),
    save: (s) => invoke('skills:save', s),
    delete: (id) => invoke('skills:delete', id),
    export: (id) => invoke('skills:export', id),
    import: (o) => invoke('skills:import', o)
  },
  // Компьютерное зрение
  screen: { capture: () => invoke('screen:capture') },
  // Локальная речь (Piper / Faster-Whisper)
  speech: {
    detect: () => invoke('speech:detect'),
    synthesize: (t) => invoke('speech:synthesize', t),
    transcribe: (b64, mime) => invoke('speech:transcribe', b64, mime)
  },
  // Быстрые установщики
  tooling: {
    installSpeech: () => invoke('tooling:installSpeech'),
    installMcTools: () => invoke('tooling:installMcTools')
  },
  // Очередь задач
  taskq: {
    list: () => invoke('taskq:list'),
    add: (o) => invoke('taskq:add', o),
    cancel: (id) => invoke('taskq:cancel', id),
    retry: (id) => invoke('taskq:retry', id),
    remove: (id) => invoke('taskq:remove', id),
    clearDone: () => invoke('taskq:clearDone'),
    pause: (v) => invoke('taskq:pause', v),
    duplicate: (id) => invoke('taskq:duplicate', id),
    setPriority: (id, p) => invoke('taskq:setPriority', id, p),
    runNow: (id) => invoke('taskq:runNow', id)
  },
  // Конституция агентов
  constitution: () => invoke('constitution:text'),
  // MCP — внешние серверы инструментов
  mcp: {
    list: () => invoke('mcp:list'),
    servers: () => invoke('mcp:servers'),
    save: (c) => invoke('mcp:save', c),
    delete: (id) => invoke('mcp:delete', id),
    connect: () => invoke('mcp:connect'),
    disconnect: () => invoke('mcp:disconnect')
  },
  // Веб-автоматизация (встроенный браузер)
  web: {
    goto: (url) => invoke('web:goto', url),
    read: () => invoke('web:read'),
    show: (v) => invoke('web:show', v),
    close: () => invoke('web:close')
  },
  // Понимание документов
  docs: {
    capabilities: () => invoke('docs:capabilities'),
    read: (p) => invoke('docs:read', p),
    ingest: (p, scope) => invoke('docs:ingest', p, scope)
  },
  // Облачный мост
  cloud: {
    test: () => invoke('cloud:test'),
    setKey: (k) => invoke('cloud:setKey', k),
    hasKey: () => invoke('cloud:hasKey'),
    ask: (m, o) => invoke('cloud:ask', m, o)
  },
  // Маршрутизация моделей
  models: {
    installed: () => invoke('models:installed'),
    pick: (kind, fb) => invoke('models:pick', kind, fb)
  },
  // Обратная связь (оценки ответов)
  feedback: {
    rate: (e) => invoke('feedback:rate', e),
    list: () => invoke('feedback:list')
  },
  // Оператор ПК (computer-use)
  operator: {
    run: (o) => invoke('operator:run', o),
    stop: (s) => invoke('operator:stop', s)
  },
  // Проектные рабочие пространства
  projects: {
    list: () => invoke('projects:list'),
    active: () => invoke('projects:active'),
    create: (n) => invoke('projects:create', n),
    rename: (id, n) => invoke('projects:rename', id, n),
    remove: (id) => invoke('projects:remove', id),
    setActive: (id) => invoke('projects:setActive', id)
  },
  // Быстрый запуск (мини-окно)
  quickask: {
    context: () => invoke('quickask:context'),
    hide: () => invoke('quickask:hide'),
    show: () => invoke('quickask:show')
  },
  // Проактивные наблюдатели
  watchers: {
    list: () => invoke('watchers:list'),
    save: (w) => invoke('watchers:save', w),
    remove: (id) => invoke('watchers:remove', id),
    toggle: (id, on) => invoke('watchers:toggle', id, on),
    fireNow: (id) => invoke('watchers:fireNow', id)
  },
  // Сценарии-конвейеры
  flows: {
    list: () => invoke('flows:list'),
    save: (f) => invoke('flows:save', f),
    remove: (id) => invoke('flows:remove', id),
    run: (id) => invoke('flows:run', id)
  },
  // Удалённый доступ (dispatch)
  dispatch: {
    status: () => invoke('dispatch:status'),
    start: () => invoke('dispatch:start'),
    stop: () => invoke('dispatch:stop'),
    regenToken: () => invoke('dispatch:regenToken'),
    setOption: (k, v) => invoke('dispatch:setOption', k, v)
  },
  // Удалённые серверы
  remote: {
    list: () => invoke('remote:list'),
    save: (c) => invoke('remote:save', c),
    delete: (id) => invoke('remote:delete', id),
    test: (id) => invoke('remote:test', id),
    ls: (id, dir) => invoke('remote:ls', id, dir),
    read: (id, p) => invoke('remote:read', id, p),
    write: (id, p, c) => invoke('remote:write', id, p, c),
    exec: (id, c) => invoke('remote:exec', id, c),
    available: () => invoke('remote:available')
  },
  // Переводчик
  translate: {
    text: (o) => invoke('translate:text', o),
    file: (o) => invoke('translate:file', o)
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
