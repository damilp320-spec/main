// Проактивные агенты-наблюдатели: фоновые «вотчеры», которые сами реагируют
// на события и запускают агента. Типы:
//   folder   — следит за папкой; новый/изменённый файл → запуск агента
//   interval — периодически запускает агента (например, сводка раз в час)
//   disk     — мониторит свободное место; ниже порога → запуск агента/уведомление
// Персистится в store('watchers'). Запускается на старте приложения.
const fs = require('fs');
const os = require('os');
const store = require('./store');

let runner = null;   // (agentId, prompt) => Promise<text>
let notify = null;   // (payload) => void
const live = new Map(); // id -> { stop() }

function init(deps) { runner = deps.runAgent; notify = deps.notify; }

function list() { return store.get('watchers', []); }
function save(w) {
  const all = list();
  if (!w.id) w.id = 'watch-' + Math.random().toString(36).slice(2, 9);
  const i = all.findIndex((x) => x.id === w.id);
  if (i >= 0) all[i] = w; else all.push(w);
  store.set('watchers', all);
  restart(w.id);
  return w;
}
function remove(id) { stop(id); store.set('watchers', list().filter((w) => w.id !== id)); return { ok: true }; }
function toggle(id, enabled) {
  const all = list(); const w = all.find((x) => x.id === id);
  if (!w) return { ok: false };
  w.enabled = enabled; store.set('watchers', all);
  enabled ? startOne(w) : stop(id);
  return { ok: true };
}

async function fire(w, reason) {
  if (!runner) return;
  const prompt = String(w.prompt || 'Обработай событие.').replace(/\{event\}/g, reason || '');
  try {
    const text = await runner(w.agentId || 'tpl-assistant', prompt);
    notify && notify({ title: '👁 ' + (w.name || 'Наблюдатель'), message: String(text || '').slice(0, 140), watcherId: w.id });
  } catch (e) { notify && notify({ title: '👁 ' + (w.name || 'Наблюдатель'), message: 'Ошибка: ' + e.message, watcherId: w.id }); }
}

function startOne(w) {
  if (!w || w.enabled === false) return;
  stop(w.id);
  try {
    if (w.type === 'folder' && w.path) {
      let timer = null; const seen = new Set();
      const watcher = fs.watch(w.path, { persistent: false }, (ev, fname) => {
        if (!fname) return;
        clearTimeout(timer);
        timer = setTimeout(() => { fire(w, `файл «${fname}» в папке ${w.path}`); }, 1500); // дебаунс
      });
      live.set(w.id, { stop: () => { try { watcher.close(); } catch {} clearTimeout(timer); } });
    } else if (w.type === 'interval') {
      const ms = Math.max(30, parseInt(w.intervalSec, 10) || 3600) * 1000;
      const h = setInterval(() => fire(w, 'плановый запуск'), ms);
      live.set(w.id, { stop: () => clearInterval(h) });
    } else if (w.type === 'disk') {
      const ms = Math.max(60, parseInt(w.intervalSec, 10) || 600) * 1000;
      const threshold = Math.max(1, parseInt(w.thresholdPct, 10) || 10);
      const h = setInterval(async () => {
        const pct = freePercent(w.path || os.homedir());
        if (pct != null && pct < threshold) fire(w, `мало места на диске: свободно ${pct}% (порог ${threshold}%)`);
      }, ms);
      live.set(w.id, { stop: () => clearInterval(h) });
    }
  } catch (e) { notify && notify({ title: '👁 Наблюдатель', message: 'Не удалось запустить: ' + e.message }); }
}

function freePercent(p) {
  try {
    const st = fs.statfsSync ? fs.statfsSync(p) : null; // Node 18+
    if (st && st.blocks) return Math.round((st.bavail / st.blocks) * 100);
  } catch {}
  return null;
}

function stop(id) { const l = live.get(id); if (l) { l.stop(); live.delete(id); } }
function startAll() { list().forEach((w) => { if (w.enabled !== false) startOne(w); }); }
function stopAll() { for (const [, l] of live) l.stop(); live.clear(); }
function restart(id) { const w = list().find((x) => x.id === id); stop(id); if (w && w.enabled !== false) startOne(w); }

module.exports = { init, list, save, remove, toggle, startAll, stopAll, fireNow: (id) => { const w = list().find((x) => x.id === id); if (w) fire(w, 'ручной запуск'); return { ok: true }; } };
