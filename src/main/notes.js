// «Второй мозг»: личные markdown-заметки с [[вики-ссылками]], поиском и
// обратными связями. Хранятся в store. Агент может создавать заметки из
// диалогов и искать по всей базе (инструменты save_note/search_notes/read_note).
const store = require('./store');
const { randomUUID } = require('crypto');

const KEY = 'notes';
const LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

function all() { return store.get(KEY, []); }
function persist(list) { store.set(KEY, list.slice(0, 2000)); }

function linksOf(body) {
  const out = new Set(); let m; LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(body || ''))) out.add(m[1].trim());
  return [...out];
}

function list() { return all().map((n) => ({ id: n.id, title: n.title, updated: n.updated, tags: n.tags || [], snippet: String(n.body || '').slice(0, 120) })); }
function get(id) { return all().find((n) => n.id === id) || null; }
function getByTitle(title) { const t = String(title || '').toLowerCase(); return all().find((n) => (n.title || '').toLowerCase() === t) || null; }

function save(note) {
  const list0 = all();
  note.title = String(note.title || 'Без названия').slice(0, 200).trim() || 'Без названия';
  note.body = String(note.body || '');
  note.tags = Array.isArray(note.tags) ? note.tags : (note.tags ? String(note.tags).split(',').map((s) => s.trim()).filter(Boolean) : []);
  note.links = linksOf(note.body);
  note.updated = Date.now();
  if (!note.id) { note.id = 'note-' + randomUUID().slice(0, 8); note.created = Date.now(); list0.push(note); }
  else { const i = list0.findIndex((n) => n.id === note.id); if (i >= 0) { note.created = list0[i].created; list0[i] = note; } else { note.created = Date.now(); list0.push(note); } }
  persist(list0);
  return note;
}
function remove(id) { persist(all().filter((n) => n.id !== id)); return { ok: true }; }

function search(q) {
  q = String(q || '').toLowerCase().trim();
  if (!q) return list();
  return all().filter((n) => (n.title + ' ' + n.body + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q))
    .map((n) => ({ id: n.id, title: n.title, updated: n.updated, snippet: snippetAround(n.body, q) }));
}
function snippetAround(body, q) {
  const i = String(body || '').toLowerCase().indexOf(q);
  if (i < 0) return String(body || '').slice(0, 120);
  return (i > 30 ? '…' : '') + body.slice(Math.max(0, i - 30), i + 90) + '…';
}

// Заметки, ссылающиеся на данную (обратные связи).
function backlinks(title) {
  const t = String(title || '').toLowerCase();
  return all().filter((n) => (n.links || linksOf(n.body)).some((l) => l.toLowerCase() === t)).map((n) => ({ id: n.id, title: n.title }));
}

// Граф связей для визуализации.
function graph() {
  const notes = all();
  const titles = new Map(notes.map((n) => [n.title.toLowerCase(), n]));
  const nodes = notes.map((n) => ({ id: n.id, title: n.title, links: (n.links || linksOf(n.body)).length }));
  const edges = [];
  for (const n of notes) for (const l of (n.links || linksOf(n.body))) { const tgt = titles.get(l.toLowerCase()); if (tgt) edges.push({ from: n.id, to: tgt.id }); }
  return { nodes, edges };
}

const toolSchemas = [
  { type: 'function', function: { name: 'save_note', description: 'Сохранить заметку в личную базу знаний («второй мозг»). Используй [[Название]] для связей с другими заметками.', parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, tags: { type: 'string', description: 'теги через запятую' } }, required: ['title', 'body'] } } },
  { type: 'function', function: { name: 'search_notes', description: 'Найти заметки по запросу в личной базе знаний.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'read_note', description: 'Прочитать заметку по названию.', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } }
];
const toolHandlers = {
  save_note: (a) => { const n = save({ title: a.title, body: a.body, tags: a.tags }); return `Заметка сохранена: «${n.title}» (id ${n.id}).`; },
  search_notes: (a) => { const r = search(a.query); return r.length ? r.slice(0, 8).map((n) => `• ${n.title}: ${n.snippet}`).join('\n') : 'Ничего не найдено.'; },
  read_note: (a) => { const n = getByTitle(a.title); return n ? `# ${n.title}\n\n${n.body}` : 'Заметка не найдена: ' + a.title; }
};

module.exports = { list, get, getByTitle, save, remove, search, backlinks, graph, linksOf, toolSchemas, toolHandlers };
