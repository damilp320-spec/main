// Центр уведомлений: единая история значимых событий приложения
// (наблюдатели, сценарии, сделки, ценовые алерты, новые скилы и т.п.).
// Хранится в store, ограничено по размеру. Рендерер показывает «колокольчик»
// с числом непрочитанных.
const store = require('./store');

let uiSender = null;
function setUISender(fn) { uiSender = fn; }

const KEY = 'notifications';
const MAX = 300;

function list() { return store.get(KEY, []); }

function add(entry) {
  const list0 = list();
  const note = {
    id: 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    kind: entry.kind || 'info',     // info | watcher | flow | trade | alert | skill | error
    title: String(entry.title || '').slice(0, 120),
    message: String(entry.message || '').slice(0, 300),
    at: Date.now(), read: false
  };
  list0.push(note);
  store.set(KEY, list0.slice(-MAX));
  uiSender && uiSender('notif:new', { note, unread: unread() });
  return note;
}

function unread() { return list().filter((n) => !n.read).length; }
function markRead(id) { const l = list(); const n = l.find((x) => x.id === id); if (n) n.read = true; store.set(KEY, l); return { ok: true, unread: unread() }; }
function markAllRead() { const l = list(); l.forEach((n) => (n.read = true)); store.set(KEY, l); return { ok: true, unread: 0 }; }
function clear() { store.set(KEY, []); return { ok: true }; }

module.exports = { setUISender, list, add, unread, markRead, markAllRead, clear };
