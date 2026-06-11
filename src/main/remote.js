// Удалённые серверы: SSH-проводник по файловой системе, редактор конфигов,
// выполнение команд. Подключения хранятся в конфиге (пароль/ключ — на свой риск).
const path = require('path');
const store = require('./store');
const secrets = require('./secrets');

let Client = null;
try { Client = require('ssh2').Client; } catch { /* зависимость может отсутствовать в dev */ }

function listConnections() {
  // Не отдаём пароли в UI — только метаданные.
  return store.get('remotes', []).map((c) => ({ id: c.id, name: c.name, host: c.host, port: c.port, username: c.username, hasPassword: !!c.password, hasKey: !!c.privateKey }));
}

function saveConnection(conn) {
  const list = store.get('remotes', []);
  if (!conn.id) conn.id = 'remote-' + Math.random().toString(36).slice(2, 9);
  const idx = list.findIndex((c) => c.id === conn.id);
  // Сохраняем существующий секрет, если в форме его не меняли.
  if (idx >= 0) {
    if (!conn.password) conn.password = list[idx].password; else conn.password = secrets.encrypt(conn.password);
    if (!conn.privateKey) conn.privateKey = list[idx].privateKey; else conn.privateKey = secrets.encrypt(conn.privateKey);
    if (conn.passphrase) conn.passphrase = secrets.encrypt(conn.passphrase);
    list[idx] = conn;
  } else {
    // Шифруем секреты перед сохранением.
    if (conn.password) conn.password = secrets.encrypt(conn.password);
    if (conn.privateKey) conn.privateKey = secrets.encrypt(conn.privateKey);
    if (conn.passphrase) conn.passphrase = secrets.encrypt(conn.passphrase);
    list.push(conn);
  }
  store.set('remotes', list);
  return { id: conn.id };
}

function deleteConnection(id) {
  store.set('remotes', store.get('remotes', []).filter((c) => c.id !== id));
  return { ok: true };
}

// Возвращает подключение с расшифрованными секретами (только для использования внутри main).
function getConn(id) {
  const c = store.get('remotes', []).find((x) => x.id === id);
  if (!c) return null;
  return {
    ...c,
    password: c.password ? secrets.decrypt(c.password) : undefined,
    privateKey: c.privateKey ? secrets.decrypt(c.privateKey) : undefined,
    passphrase: c.passphrase ? secrets.decrypt(c.passphrase) : undefined
  };
}

function connect(conn) {
  return new Promise((resolve, reject) => {
    if (!Client) return reject(new Error('Модуль ssh2 не установлен (выполните npm install).'));
    const c = new Client();
    const opts = { host: conn.host, port: conn.port || 22, username: conn.username, readyTimeout: 15000 };
    if (conn.privateKey) opts.privateKey = conn.privateKey;
    if (conn.passphrase) opts.passphrase = conn.passphrase;
    if (conn.password) opts.password = conn.password;
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect(opts);
  });
}

function withConnection(id, fn) {
  const conn = getConn(id);
  if (!conn) return Promise.reject(new Error('Подключение не найдено'));
  return connect(conn).then(async (c) => {
    try { return await fn(c); }
    finally { c.end(); }
  });
}

function test(id) {
  return withConnection(id, async () => ({ ok: true }))
    .then((r) => r).catch((e) => ({ ok: false, error: e.message }));
}

function sftp(client) {
  return new Promise((resolve, reject) => client.sftp((err, s) => (err ? reject(err) : resolve(s))));
}

function listDir(id, dir = '.') {
  return withConnection(id, async (c) => {
    const s = await sftp(c);
    return new Promise((resolve, reject) => {
      s.readdir(dir, (err, list) => {
        if (err) return reject(err);
        resolve(list.map((e) => ({
          name: e.filename,
          dir: (e.attrs.mode & 0o170000) === 0o040000,
          size: e.attrs.size,
          mtime: e.attrs.mtime
        })).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)));
      });
    });
  }).then((files) => ({ ok: true, dir, files })).catch((e) => ({ ok: false, error: e.message }));
}

function readFile(id, filePath) {
  return withConnection(id, async (c) => {
    const s = await sftp(c);
    return new Promise((resolve, reject) => {
      const chunks = [];
      s.createReadStream(filePath)
        .on('data', (d) => { chunks.push(d); if (Buffer.concat(chunks).length > 2_000_000) { /* cap 2MB */ } })
        .on('error', reject)
        .on('end', () => resolve(Buffer.concat(chunks).toString('utf8').slice(0, 2_000_000)));
    });
  }).then((content) => ({ ok: true, content })).catch((e) => ({ ok: false, error: e.message }));
}

function writeFile(id, filePath, content) {
  return withConnection(id, async (c) => {
    const s = await sftp(c);
    return new Promise((resolve, reject) => {
      const ws = s.createWriteStream(filePath);
      ws.on('error', reject);
      ws.on('close', () => resolve());
      ws.end(Buffer.from(content ?? '', 'utf8'));
    });
  }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
}

function exec(id, command) {
  return withConnection(id, async (c) => new Promise((resolve, reject) => {
    c.exec(command, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', (d) => (out += d));
      stream.stderr.on('data', (d) => (out += d));
      stream.on('close', () => resolve(out));
    });
  })).then((output) => ({ ok: true, output })).catch((e) => ({ ok: false, error: e.message }));
}

/* ------ Инструменты для агентов ------ */
const toolSchemas = [
  { type: 'function', function: { name: 'remote_list', description: 'Список сохранённых удалённых серверов (id и имя).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'remote_ls', description: 'Показать содержимое каталога на удалённом сервере по SSH.', parameters: { type: 'object', properties: { server: { type: 'string', description: 'id или имя сервера' }, path: { type: 'string' } }, required: ['server'] } } },
  { type: 'function', function: { name: 'remote_read', description: 'Прочитать файл (например конфиг) на удалённом сервере.', parameters: { type: 'object', properties: { server: { type: 'string' }, path: { type: 'string' } }, required: ['server', 'path'] } } },
  { type: 'function', function: { name: 'remote_write', description: 'Записать/изменить файл (конфиг) на удалённом сервере.', parameters: { type: 'object', properties: { server: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } }, required: ['server', 'path', 'content'] } } },
  { type: 'function', function: { name: 'remote_exec', description: 'Выполнить команду на удалённом сервере по SSH.', parameters: { type: 'object', properties: { server: { type: 'string' }, command: { type: 'string' } }, required: ['server', 'command'] } } }
];

function resolveServerId(ref) {
  const list = store.get('remotes', []);
  const byId = list.find((c) => c.id === ref);
  if (byId) return byId.id;
  const byName = list.find((c) => c.name && c.name.toLowerCase() === String(ref).toLowerCase());
  return byName ? byName.id : null;
}

const toolHandlers = {
  async remote_list() {
    const l = listConnections();
    return l.length ? l.map((c) => `${c.name} (${c.username}@${c.host}:${c.port}) id=${c.id}`).join('\n') : 'Серверов нет. Добавьте подключение в разделе «Серверы».';
  },
  async remote_ls({ server, path: p }) {
    const id = resolveServerId(server); if (!id) return 'Сервер не найден: ' + server;
    const r = await listDir(id, p || '.');
    return r.ok ? r.files.map((f) => (f.dir ? '[DIR] ' : '      ') + f.name).join('\n') : 'Ошибка: ' + r.error;
  },
  async remote_read({ server, path: p }) {
    const id = resolveServerId(server); if (!id) return 'Сервер не найден: ' + server;
    const r = await readFile(id, p);
    return r.ok ? r.content.slice(0, 8000) : 'Ошибка: ' + r.error;
  },
  async remote_write({ server, path: p, content }) {
    const id = resolveServerId(server); if (!id) return 'Сервер не найден: ' + server;
    const r = await writeFile(id, p, content);
    return r.ok ? 'Файл записан: ' + p : 'Ошибка: ' + r.error;
  },
  async remote_exec({ server, command }) {
    const id = resolveServerId(server); if (!id) return 'Сервер не найден: ' + server;
    const r = await exec(id, command);
    return r.ok ? (r.output || '(нет вывода)').slice(0, 6000) : 'Ошибка: ' + r.error;
  }
};

module.exports = { listConnections, saveConnection, deleteConnection, test, listDir, readFile, writeFile, exec, toolSchemas, toolHandlers, available: !!Client };
