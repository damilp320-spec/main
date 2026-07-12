// Простое JSON-хранилище конфигурации в каталоге userData. Работает и БЕЗ
// Electron (headless-режим бота): тогда берётся тот же каталог, который
// Electron выбрал бы по умолчанию, чтобы конфиг был общим с приложением,
// либо путь из переменной окружения MYTHERA_DATA_DIR.
const fs = require('fs');
const path = require('path');
const os = require('os');

let cache = null;
let dataDir = null;

function resolveDataDir() {
  if (dataDir) return dataDir;
  if (process.env.MYTHERA_DATA_DIR) return (dataDir = process.env.MYTHERA_DATA_DIR);
  try { const { app } = require('electron'); if (app && app.getPath) return (dataDir = app.getPath('userData')); } catch {}
  const name = 'Mythera AI Hub'; // = productName (каталог userData Electron)
  const home = os.homedir();
  dataDir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), name)
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', name)
      : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), name);
  return dataDir;
}

function file() {
  return path.join(resolveDataDir(), 'nexus-config.json');
}

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('store persist failed:', e.message);
  }
}

function get(key, def) {
  const obj = load();
  const parts = key.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return def;
    cur = cur[p];
  }
  return cur === undefined ? def : cur;
}

function set(key, value) {
  const obj = load();
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  persist();
}

// Полный доступ к конфигу (для режима «полного контроля»).
function all() { return JSON.parse(JSON.stringify(load())); }
function replaceAll(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Ожидался объект' };
  cache = obj; persist();
  return { ok: true };
}

module.exports = { get, set, all, replaceAll };
