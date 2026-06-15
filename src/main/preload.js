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
  // Брокер / автоторговля
  trade: {
    cfg: () => invoke('trade:cfg'),
    setCfg: (p) => invoke('trade:setCfg', p),
    setToken: (tok) => invoke('trade:setToken', tok),
    test: () => invoke('trade:test'),
    portfolio: (id) => invoke('trade:portfolio', id),
    find: (q) => invoke('trade:find', q),
    order: (o) => invoke('trade:order', o),
    confirm: (id) => invoke('trade:confirm', id),
    reject: (id) => invoke('trade:reject', id),
    panic: () => invoke('trade:panic'),
    log: () => invoke('trade:log')
  },
  // Генерация изображений (Stable Diffusion)
  img: {
    status: () => invoke('img:status'),
    generate: (o) => invoke('img:generate', o)
  },
  // Кодовое рабочее пространство (мини-IDE)
  ws: {
    tree: () => invoke('ws:tree'),
    read: (p) => invoke('ws:read', p),
    write: (p, c) => invoke('ws:write', p, c),
    create: (p, isDir) => invoke('ws:create', p, isDir),
    remove: (p) => invoke('ws:remove', p),
    run: (p) => invoke('ws:run', p)
  },
  // Новости и сентимент
  news: {
    fetch: (q) => invoke('news:fetch', q),
    sentiment: (q) => invoke('news:sentiment', q)
  },
  // Обучение с сайта (web → RAG)
  crawler: { learn: (o) => invoke('crawler:learn', o) },
  // Диагностика системы
  diag: { run: () => invoke('diag:run') },
  // Заметки (второй мозг)
  notes: {
    list: () => invoke('notes:list'),
    get: (id) => invoke('notes:get', id),
    save: (n) => invoke('notes:save', n),
    remove: (id) => invoke('notes:remove', id),
    search: (q) => invoke('notes:search', q),
    backlinks: (title) => invoke('notes:backlinks', title),
    byTitle: (title) => invoke('notes:byTitle', title),
    graph: () => invoke('notes:graph')
  },
  // Студия данных (SQL/CSV)
  data: {
    files: () => invoke('data:files'),
    describe: (f) => invoke('data:describe', f),
    query: (f, sql) => invoke('data:query', f, sql)
  },
  // RSS-читалка
  rss: {
    feeds: () => invoke('rss:feeds'),
    add: (url, title) => invoke('rss:add', url, title),
    remove: (url) => invoke('rss:remove', url),
    aggregate: () => invoke('rss:aggregate'),
    digest: () => invoke('rss:digest')
  },
  // Экспорт в PDF
  pdf: { export: (html, title) => invoke('pdf:export', html, title) },
  // Внешние подключения (GitHub/Telegram/webhook)
  conn: {
    status: () => invoke('conn:status'),
    setToken: (key, val) => invoke('conn:setToken', key, val),
    set: (k, v) => invoke('conn:set', k, v),
    githubUser: () => invoke('conn:githubUser'),
    githubRepos: () => invoke('conn:githubRepos'),
    githubIssues: (repo) => invoke('conn:githubIssues', repo),
    githubCreateIssue: (repo, title, body) => invoke('conn:githubCreateIssue', repo, title, body),
    telegramTest: () => invoke('conn:telegramTest'),
    webhook: (url, payload) => invoke('conn:webhook', url, payload)
  },
  // Календарь
  cal: {
    list: (from, to) => invoke('cal:list', from, to),
    save: (ev) => invoke('cal:save', ev),
    remove: (id) => invoke('cal:remove', id),
    exportICS: () => invoke('cal:exportICS'),
    importICS: (text) => invoke('cal:importICS', text)
  },
  // Email
  email: {
    cfg: () => invoke('email:cfg'),
    setCfg: (p) => invoke('email:setCfg', p),
    setPass: (p) => invoke('email:setPass', p),
    fetch: (n) => invoke('email:fetch', n),
    send: (m) => invoke('email:send', m)
  },
  // Конструктор моделей
  mb: {
    preview: (o) => invoke('mb:preview', o),
    create: (o) => invoke('mb:create', o)
  },
  // Плейграунд моделей
  playground: { ask: (model, prompt, opts) => invoke('playground:ask', model, prompt, opts) },
  // Бэктест стратегий
  backtest: {
    run: (o) => invoke('backtest:run', o),
    strategies: () => invoke('backtest:strategies'),
    optimize: (o) => invoke('backtest:optimize', o)
  },
  // ИИ-режим торговли + бумажный счёт
  bot: {
    cfg: () => invoke('bot:cfg'),
    setCfg: (p) => invoke('bot:setCfg', p),
    applyProfile: (n) => invoke('bot:applyProfile', n),
    runOnce: () => invoke('bot:runOnce')
  },
  analyst: { deep: (s, h) => invoke('analyst:deep', s, h) },
  portfolio: { analyze: (q) => invoke('portfolio:analyze', q) },
  alerts: {
    list: () => invoke('alerts:list'),
    save: (a) => invoke('alerts:save', a),
    remove: (id) => invoke('alerts:remove', id),
    toggle: (id, on) => invoke('alerts:toggle', id, on)
  },
  dca: {
    list: () => invoke('dca:list'),
    save: (p) => invoke('dca:save', p),
    remove: (id) => invoke('dca:remove', id),
    toggle: (id, on) => invoke('dca:toggle', id, on),
    runNow: (id) => invoke('dca:runNow', id)
  },
  journal: {
    list: () => invoke('journal:list'),
    save: (e) => invoke('journal:save', e),
    remove: (id) => invoke('journal:remove', id),
    syncPaper: () => invoke('journal:syncPaper'),
    stats: () => invoke('journal:stats'),
    review: () => invoke('journal:review')
  },
  marketsCorrelation: (symbols) => invoke('markets:correlation', symbols),
  tradeDigest: () => invoke('trade:digest'),
  backtestBot: (o) => invoke('backtest:runBot', o),
  backtestBest: (o) => invoke('backtest:bestStrategy', o),
  lab: {
    run: (o) => invoke('lab:run', o),
    markers: (o) => invoke('lab:markers', o),
    track: (s) => invoke('lab:track', s),
    untrack: (s) => invoke('lab:untrack', s)
  },
  screener: {
    scan: (f, c) => invoke('screener:scan', f, c),
    breadth: () => invoke('screener:breadth')
  },
  rebalance: {
    plan: (t, q) => invoke('portfolio:rebalancePlan', t, q),
    apply: (t, q) => invoke('portfolio:rebalanceApply', t, q)
  },
  copilot: {
    cfg: () => invoke('copilot:cfg'),
    setCfg: (p) => invoke('copilot:setCfg', p),
    proposals: () => invoke('copilot:proposals'),
    act: (id) => invoke('copilot:act', id),
    dismiss: (id) => invoke('copilot:dismiss', id),
    monitor: () => invoke('copilot:monitor')
  },
  paper: {
    valuation: (q) => invoke('paper:valuation', q),
    history: () => invoke('paper:history'),
    reset: (c) => invoke('paper:reset', c),
    trade: (o) => invoke('paper:trade', o)
  },
  // Центр уведомлений
  notif: {
    list: () => invoke('notif:list'),
    unread: () => invoke('notif:unread'),
    add: (e) => invoke('notif:add', e),
    markRead: (id) => invoke('notif:markRead', id),
    markAllRead: () => invoke('notif:markAllRead'),
    clear: () => invoke('notif:clear')
  },
  // Отчёты / телеметрия
  reports: {
    telemetry: () => invoke('reports:telemetry'),
    telemetryClear: () => invoke('reports:telemetryClear')
  },
  // Рынки (акции/фьючерсы/крипта)
  markets: {
    candles: (o) => invoke('markets:candles', o),
    search: (q) => invoke('markets:search', q),
    analyze: (o) => invoke('markets:analyze', o),
    watchlist: () => invoke('markets:watchlist'),
    setWatchlist: (l) => invoke('markets:setWatchlist', l)
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
