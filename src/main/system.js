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
  const root = store.get('settings.workspace', path.join(os.homedir(), 'MytheraAI-Workspace'));
  fs.mkdirSync(root, { recursive: true });
  return root;
}

// Критические системные каталоги — запись запрещена всегда.
const PROTECTED = process.platform === 'win32'
  ? [/^[a-z]:\\windows/i, /^[a-z]:\\program files/i, /\\system32/i, /\\\$recycle/i]
  : [/^\/(etc|bin|sbin|boot|sys|proc|dev|usr|lib|var\/lib)(\/|$)/, /^\/$/];

// Безопасное разрешение пути с защитой от выхода из песочницы.
// confine=true (по умолчанию для записи) — строго внутри рабочего пространства.
function resolveSafe(p, { write = false } = {}) {
  const root = safeRoot();
  const fullDisk = store.get('settings.fullDiskAccess', false);
  let full = path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.join(root, p));
  const rootNorm = path.normalize(root + path.sep);
  const insideRoot = (full + path.sep).startsWith(rootNorm);

  if (!fullDisk && !insideRoot) {
    throw new Error('Доступ только к рабочему пространству. Полный доступ к диску можно включить в настройках.');
  }
  if (write && PROTECTED.some((re) => re.test(full))) {
    throw new Error('Запись в системный каталог запрещена политикой безопасности.');
  }
  return full;
}

// Усиленная проверка опасных команд (regex + пользовательский список).
const DANGER_PATTERNS = [
  /\bformat\b\s+[a-z]:/i, /\bdiskpart\b/i, /\bmkfs\b/i, /\bdd\s+if=/i,
  /\bdel\b\s+\/[sqf]/i, /\brmdir\b\s+\/s/i, /\brd\b\s+\/s/i,
  /rm\s+-rf?\s+[~/]/i, /rm\s+-rf?\s+\*/i, /:\(\)\s*\{.*\};:/, /\bshutdown\b/i, /\breboot\b/i,
  /\bvssadmin\b/i, /\bbcdedit\b/i, /\bcipher\b\s+\/w/i, /\bfsutil\b/i,
  /reg\s+delete/i, /\bschtasks\b/i, /\bnet\s+user\b/i, /\bnetsh\b/i,
  /Remove-Item.*-Recurse.*-Force/i, /\bFormat-Volume\b/i, /\bClear-Disk\b/i,
  /\bRemove-Item\b.*\\Windows/i, /chmod\s+-R\s+777\s+\//, />\s*\/dev\/sd[a-z]/i,
  /\bkillall\b/i, /Stop-Computer/i, /Restart-Computer/i
];
function screenCommand(command) {
  const extra = store.get('settings.blockedCommands', []);
  if (extra.some((b) => b && command.toLowerCase().includes(String(b).toLowerCase()))) return 'пользовательский фильтр';
  if (DANGER_PATTERNS.some((re) => re.test(command))) return 'разрушительная операция';
  return null;
}

// Прозрачность для пользователя: что именно блокируется (вопрос доверия к tool-use).
function securityInfo() {
  return {
    patterns: DANGER_PATTERNS.map((re) => re.source),
    custom: store.get('settings.blockedCommands', []),
    sandbox: {
      workspace: safeRoot(),
      fullDiskAccess: store.get('settings.fullDiskAccess', false),
      allowShell: store.get('settings.allowShell', true),
      protectedDirs: PROTECTED.map((re) => re.source)
    }
  };
}

// Демонстрация фильтра: проверяет команду так же, как при вызове агентом.
function screenTest(cmd) { const reason = screenCommand(String(cmd || '')); return { command: cmd, blocked: !!reason, reason }; }

function isSafeUrl(url) {
  try { const u = new URL(String(url)); return ['http:', 'https:', 'mailto:'].includes(u.protocol); }
  catch { return false; }
}

const tools = {
  async run_command({ command }) {
    if (!store.get('settings.allowShell', true)) return 'Выполнение команд отключено в настройках безопасности.';
    command = String(command || '');
    const reason = screenCommand(command);
    if (reason) return `Команда заблокирована политикой безопасности (${reason}): "${command.slice(0, 120)}".`;
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
      let out = '';
      let proc;
      try { proc = spawn(shell, args, { cwd: safeRoot(), windowsHide: true }); }
      catch (e) { return resolve('Ошибка запуска: ' + e.message); }
      proc.stdout.on('data', (d) => { out += d; if (out.length > 100000) { proc.kill(); } });
      proc.stderr.on('data', (d) => { out += d; });
      const timer = setTimeout(() => { proc.kill(); resolve(out + '\n[прервано: таймаут 60с]'); }, 60000);
      proc.on('close', (code) => { clearTimeout(timer); resolve((out || '(нет вывода)').slice(0, 100000) + `\n[код выхода: ${code}]`); });
      proc.on('error', (e) => { clearTimeout(timer); resolve('Ошибка запуска: ' + e.message); });
    });
  },

  async read_file({ path: p }) {
    try { return fs.readFileSync(resolveSafe(p), 'utf8').slice(0, 20000); }
    catch (e) { return 'Не удалось прочитать файл: ' + e.message; }
  },

  async write_file({ path: p, content }) {
    try {
      const full = resolveSafe(p, { write: true });
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content ?? '', 'utf8');
      return 'Файл сохранён: ' + full;
    } catch (e) { return 'Ошибка записи: ' + e.message; }
  },

  async list_dir({ path: p }) {
    try {
      const full = p ? resolveSafe(p) : safeRoot();
      return fs.readdirSync(full, { withFileTypes: true })
        .map((d) => (d.isDirectory() ? '[DIR] ' : '      ') + d.name).join('\n') || '(пусто)';
    } catch (e) { return 'Ошибка: ' + e.message; }
  },

  async open_app({ name }) {
    name = String(name || '');
    if (screenCommand(name)) return 'Запуск заблокирован политикой безопасности.';
    return new Promise((resolve) => {
      // Без sh:true и интерполяции в общий шелл — открываем безопасно.
      let proc;
      if (process.platform === 'win32') proc = spawn('cmd.exe', ['/c', 'start', '', name], { windowsHide: true });
      else proc = spawn('xdg-open', [name]);
      proc.on('error', (e) => resolve('Не удалось открыть: ' + e.message));
      proc.on('close', () => resolve('Открыто: ' + name));
    });
  },

  async open_url({ url }) {
    if (!isSafeUrl(url)) return 'Недопустимый URL (разрешены только http/https/mailto).';
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
    if (!isSafeUrl(url)) return 'Недопустимый URL (разрешены только http/https).';
    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http;
      let received = 0;
      const req = lib.get(url, { timeout: 15000 }, (res) => {
        let buf = '';
        res.on('data', (c) => { received += c.length; buf += c; if (received > 50000) { req.destroy(); resolve(buf.slice(0, 8000)); } });
        res.on('end', () => resolve(buf.slice(0, 8000)));
      });
      req.on('timeout', () => { req.destroy(); resolve('Таймаут запроса.'); });
      req.on('error', (e) => resolve('Ошибка запроса: ' + e.message));
    });
  },

  async system_info() {
    const i = getInfo(); const s = getStats();
    return `ОС: ${i.platform} ${i.release}\nCPU: ${i.cpuModel} (${i.cpus} ядер)\nОЗУ: ${s.memUsedGb}/${s.memTotalGb} ГБ (${s.memUsedPercent}%)\nЗагрузка CPU: ${s.cpuLoad}`;
  },

  async notify({ title, message }) {
    // Уведомление пробрасывается в UI через возвращаемое значение и Notification API рендерера.
    return `__NOTIFY__${JSON.stringify({ title: title || 'Mythera AI', message: message || '' })}`;
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

// Список дисков для выбора места установки моделей.
function listDrives() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const ps = 'Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 3} | ForEach-Object { "$($_.DeviceID)|$($_.FreeSpace)|$($_.Size)|$($_.VolumeName)" }';
      exec(`powershell -NoProfile -Command "${ps}"`, { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve([{ path: 'C:\\', label: 'Системный диск', freeGb: null, totalGb: null }]);
        const drives = stdout.trim().split('\n').map((line) => {
          const [dev, free, size, name] = line.trim().split('|');
          return { path: dev + '\\', label: name || dev, freeGb: free ? +(free / 1024 ** 3).toFixed(1) : null, totalGb: size ? +(size / 1024 ** 3).toFixed(1) : null };
        });
        resolve(drives);
      });
    } else {
      // Unix: показываем домашний и корневой разделы.
      const home = os.homedir();
      resolve([
        { path: home, label: 'Домашний каталог', freeGb: null, totalGb: null },
        { path: '/', label: 'Корневой раздел', freeGb: null, totalGb: null }
      ]);
    }
  });
}

module.exports = { getInfo, getStats, setAutostart, tools, toolSchemas, callTool, safeRoot, listDrives, isSafeUrl, resolveSafe, screenCommand, securityInfo, screenTest };
