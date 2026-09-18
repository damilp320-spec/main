// Простое JSON-хранилище конфигурации в каталоге userData.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'nexus-config.json');
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
