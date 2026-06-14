// Проектные рабочие пространства: группируют контекст (RAG-знания, заметки,
// активный набор) вокруг конкретного проекта. У каждого проекта свой scope
// знаний («proj:<id>»), так что база знаний одного проекта не смешивается с
// другим. Активный проект влияет на то, какие знания агент подтягивает.
const store = require('./store');

function list() { return store.get('projects', []); }

function active() {
  const id = store.get('settings.activeProject', '');
  return list().find((p) => p.id === id) || null;
}
function activeScope() { const a = active(); return a ? 'proj:' + a.id : null; }

function create(name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return { ok: false, error: 'Пустое имя' };
  const id = 'proj-' + Math.random().toString(36).slice(2, 9);
  const projects = list();
  projects.push({ id, name, createdAt: Date.now() });
  store.set('projects', projects);
  store.set('settings.activeProject', id); // новый проект сразу активен
  return { ok: true, id };
}

function rename(id, name) {
  const projects = list();
  const p = projects.find((x) => x.id === id);
  if (!p) return { ok: false, error: 'Не найден' };
  p.name = String(name || '').trim().slice(0, 60) || p.name;
  store.set('projects', projects);
  return { ok: true };
}

function remove(id) {
  store.set('projects', list().filter((p) => p.id !== id));
  // Чистим знания проекта.
  try { require('./rag').clearDocs('proj:' + id); } catch { /* noop */ }
  if (store.get('settings.activeProject', '') === id) store.set('settings.activeProject', '');
  return { ok: true };
}

function setActive(id) {
  if (id && !list().some((p) => p.id === id)) return { ok: false, error: 'Не найден' };
  store.set('settings.activeProject', id || '');
  return { ok: true, active: id || null };
}

module.exports = { list, active, activeScope, create, rename, remove, setActive };
