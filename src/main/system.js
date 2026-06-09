// Взаимодействие агентов с компьютером (Windows 11) + системная информация.
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec, spawn } = require('child_process');
const { app, shell } = require('electron');

const store = require('./store');

function getInfo() {
  return {
    platform: process.platform,
    release: os.release(),
    hostname: os.hostname(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: (os.cpus()[0] || {}).model || 'unknown',
    totalMem: os.totalmem(),
    appVersion: app.getVersion()
  };
}

function getStats() {
  const total = os.totalmem();
  const free = os.freemem();
  const load = os.loadavg()[0];
  return {
    memUsedPercent: Math.round(((total - free) / total) * 100),
    memUsedGb: +((total - free) / 1024 ** 3).toFixed(1),
    memTotalGb: +(total / 1024 ** 3).toFixed(1),
    cpuLoad: +load.toFixed(2),
    uptime: os.uptime()
  };
}

// Автозапуск приложения вместе с Windows.
function setAutostart(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--autostart'] });
    store.set('settings.autostart', !!enabled);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* =========================================================
 *  Инструменты, доступные автономным агентам.
 *  Каждый — async, принимает аргументы и возвращает строку-результат.
 *  Опасные действия проверяются по белому/чёрному списку и настройкам.
 * ========================================================= */

function safeRoot() {
  // По умолчанию агент работает в «песочнице» рабочего пространства.
  const root = store.get('settings.workspace', path.join(os.homedir(), 'NexusAI-Workspace'));
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function resolveInWorkspace(p) {
  const root = safeRoot();
  const full = path.isAbsolute(p) ? p : path.join(root, p);
  return full;
}

const tools = {
  async run_command({ command }) {
    if (!store.get('settings.allowShell', true)) return 'Выполнение команд отключено в настройках безопасности.';
    const blocked = store.get('settings.blockedCommands', ['format', 'del /', 'rm -rf /', 'shutdown', 'mkfs', 'diskpart']);
    if (blocked.some((b) => command.toLowerCase().includes(b))) return `Команда заблокирована политикой безопасности: "${command}".`;
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const args = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command];
      let out = '';
      const proc = spawn(shell, args, { cwd: safeRoot() });
      proc.stdout.on('data', (d) => (out += d));
      proc.stderr.on('data', (d) => (out += d));
      const timer = setTimeout(() => { proc.kill(); resolve(out + '\n[прервано: таймаут 60с]'); }, 60000);
      proc.on('close', (code) => { clearTimeout(timer); resolve((out || '(нет вывода)') + `\n[код выхода: ${code}]`); });
      proc.on('error', (e) => { clearTimeout(timer); resolve('Ошибка запуска: ' + e.message); });
    });
  },

  async read_file({ path: p }) {
    try { return fs.readFileSync(resolveInWorkspace(p), 'utf8').slice(0, 20000); }
    catch (e) { return 'Не удалось прочитать файл: ' + e.message; }
  },

  async write_file({ path: p, content }) {
    try {
      const full = resolveInWorkspace(p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content ?? '', 'utf8');
      return 'Файл сохранён: ' + full;
    } catch (e) { return 'Ошибка записи: ' + e.message; }
  },

  async list_dir({ path: p }) {
    try {
      const full = p ? resolveInWorkspace(p) : safeRoot();
      return fs.readdirSync(full, { withFileTypes: true })
        .map((d) => (d.isDirectory() ? '[DIR] ' : '      ') + d.name).join('\n') || '(пусто)';
    } catch (e) { return 'Ошибка: ' + e.message; }
  },

  async open_app({ name }) {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? `start "" "${name}"` : `open "${name}" || xdg-open "${name}"`;
      exec(cmd, { shell: true }, (err) => resolve(err ? 'Не удалось открыть: ' + err.message : 'Открыто: ' + name));
    });
  },

  async open_url({ url }) {
    try { await shell.openExternal(url); return 'Открыт URL: ' + url; }
    catch (e) { return 'Ошибка: ' + e.message; }
  },

  async web_search({ query }) {
    // Лёгкий поиск через DuckDuckGo Instant Answer API (без ключей).
    return new Promise((resolve) => {
      const u = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
      https.get(u, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            const parts = [];
            if (j.AbstractText) parts.push(j.AbstractText);
            (j.RelatedTopics || []).slice(0, 5).forEach((t) => { if (t.Text) parts.push('• ' + t.Text); });
            resolve(parts.join('\n') || 'Ничего не найдено. Попробуйте open_url с поисковой системой.');
          } catch { resolve('Поиск не дал структурированного ответа.'); }
        });
      }).on('error', (e) => resolve('Ошибка поиска: ' + e.message));
    });
  },

  async http_get({ url }) {
    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http;
      lib.get(url, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve(buf.slice(0, 8000)));
      }).on('error', (e) => resolve('Ошибка запроса: ' + e.message));
    });
  },

  async system_info() {
    const i = getInfo(); const s = getStats();
    return `ОС: ${i.platform} ${i.release}\nCPU: ${i.cpuModel} (${i.cpus} ядер)\nОЗУ: ${s.memUsedGb}/${s.memTotalGb} ГБ (${s.memUsedPercent}%)\nЗагрузка CPU: ${s.cpuLoad}`;
  },

  async notify({ title, message }) {
    // Уведомление пробрасывается в UI через возвращаемое значение и Notification API рендерера.
    return `__NOTIFY__${JSON.stringify({ title: title || 'Nexus AI', message: message || '' })}`;
  }
};

// JSON-схемы инструментов для tool-calling Ollama.
const toolSchemas = [
  { type: 'function', function: { name: 'run_command', description: 'Выполнить команду PowerShell/shell на компьютере пользователя и вернуть вывод.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Команда для выполнения' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Прочитать содержимое текстового файла из рабочего пространства.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Создать или перезаписать файл в рабочем пространстве.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'list_dir', description: 'Показать список файлов в каталоге рабочего пространства.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'open_app', description: 'Запустить приложение или открыть файл по имени/пути.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'open_url', description: 'Открыть URL в браузере по умолчанию.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Найти информацию в интернете по запросу.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'http_get', description: 'Загрузить содержимое веб-страницы или API по URL.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'system_info', description: 'Получить сведения о системе и нагрузке.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'notify', description: 'Показать всплывающее уведомление пользователю.', parameters: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' } }, required: ['message'] } } }
];

async function callTool(name, args) {
  const fn = tools[name];
  if (!fn) return `Неизвестный инструмент: ${name}`;
  try { return await fn(args || {}); }
  catch (e) { return `Ошибка инструмента ${name}: ${e.message}`; }
}

module.exports = { getInfo, getStats, setAutostart, tools, toolSchemas, callTool, safeRoot };
