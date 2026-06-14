// Локальный календарь: события, напоминания, импорт/экспорт ICS.
// Напоминания проверяются по таймеру и шлются как уведомления.
const store = require('./store');
const { randomUUID } = require('crypto');

let notify = null;
let timer = null;

function init(deps) {
  notify = deps && deps.notify;
  if (timer) clearInterval(timer);
  timer = setInterval(checkReminders, 60000); // раз в минуту
  checkReminders();
}
function shutdown() { if (timer) clearInterval(timer); timer = null; }

function all() { return store.get('calendar', []); }
function list(fromTs, toTs) {
  let ev = all();
  if (fromTs != null) ev = ev.filter((e) => e.start >= fromTs);
  if (toTs != null) ev = ev.filter((e) => e.start <= toTs);
  return ev.sort((a, b) => a.start - b.start);
}
function save(ev) {
  const list0 = all();
  ev.title = String(ev.title || 'Событие').slice(0, 200);
  ev.start = +ev.start || Date.now();
  ev.end = +ev.end || (ev.start + 3600000);
  ev.notes = String(ev.notes || '').slice(0, 1000);
  ev.remindMin = ev.remindMin == null ? 10 : +ev.remindMin;
  if (!ev.id) { ev.id = 'ev-' + randomUUID().slice(0, 8); list0.push(ev); }
  else { const i = list0.findIndex((e) => e.id === ev.id); if (i >= 0) { ev._reminded = list0[i]._reminded; list0[i] = ev; } else list0.push(ev); }
  store.set('calendar', list0);
  return ev;
}
function remove(id) { store.set('calendar', all().filter((e) => e.id !== id)); return { ok: true }; }

function checkReminders() {
  const now = Date.now(); const list0 = all(); let changed = false;
  for (const e of list0) {
    if (e._reminded || e.remindMin == null) continue;
    const remindAt = e.start - e.remindMin * 60000;
    if (now >= remindAt && now < e.start + 60000) {
      e._reminded = true; changed = true;
      const mins = Math.max(0, Math.round((e.start - now) / 60000));
      notify && notify({ title: '📅 ' + e.title, message: mins > 0 ? `через ${mins} мин · ${new Date(e.start).toLocaleString()}` : `сейчас · ${new Date(e.start).toLocaleTimeString()}` });
    }
  }
  if (changed) store.set('calendar', list0);
}

// ---- ICS ----
function pad(n) { return String(n).padStart(2, '0'); }
function toICSDate(ts) { const d = new Date(ts); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'; }
function exportICS() {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mythera//Calendar//EN'];
  for (const e of all()) {
    lines.push('BEGIN:VEVENT', 'UID:' + e.id + '@mythera', 'DTSTAMP:' + toICSDate(Date.now()),
      'DTSTART:' + toICSDate(e.start), 'DTEND:' + toICSDate(e.end),
      'SUMMARY:' + String(e.title).replace(/[\r\n,;]/g, ' '),
      'DESCRIPTION:' + String(e.notes || '').replace(/[\r\n]/g, ' '), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function parseICSDate(s) {
  const m = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(s);
  if (!m) return Date.now();
  const utc = !!m[7];
  const args = [+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
  return utc ? Date.UTC(...args) : new Date(...args).getTime();
}
function importICS(text) {
  const blocks = String(text).split(/BEGIN:VEVENT/i).slice(1); let added = 0;
  for (const b of blocks) {
    const body = b.split(/END:VEVENT/i)[0];
    const get = (k) => { const m = new RegExp(k + '[^:]*:(.+)', 'i').exec(body); return m ? m[1].trim() : ''; };
    const start = get('DTSTART'); if (!start) continue;
    save({ title: get('SUMMARY') || 'Событие', start: parseICSDate(start), end: get('DTEND') ? parseICSDate(get('DTEND')) : parseICSDate(start) + 3600000, notes: get('DESCRIPTION'), remindMin: 10 });
    added++;
  }
  return { ok: true, added };
}

const toolSchemas = [
  { type: 'function', function: { name: 'add_event', description: 'Добавить событие в календарь. Дату/время указывай в ISO (например 2026-06-20T15:00).', parameters: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string' }, durationMin: { type: 'number' }, notes: { type: 'string' } }, required: ['title', 'start'] } } },
  { type: 'function', function: { name: 'list_events', description: 'Показать ближайшие события календаря.', parameters: { type: 'object', properties: { days: { type: 'number' } } } } }
];
const toolHandlers = {
  add_event: (a) => {
    const start = Date.parse(a.start); if (isNaN(start)) return 'ОШИБКА: не разобрать дату «' + a.start + '». Используй формат 2026-06-20T15:00.';
    const e = save({ title: a.title, start, end: start + (a.durationMin || 60) * 60000, notes: a.notes });
    return `Событие добавлено: «${e.title}» на ${new Date(e.start).toLocaleString()}.`;
  },
  list_events: (a) => {
    const to = Date.now() + (a && a.days ? a.days : 14) * 86400000;
    const ev = list(Date.now() - 3600000, to);
    return ev.length ? ev.map((e) => `• ${new Date(e.start).toLocaleString()} — ${e.title}`).join('\n') : 'Ближайших событий нет.';
  }
};

module.exports = { init, shutdown, list, save, remove, exportICS, importICS, toolSchemas, toolHandlers };
