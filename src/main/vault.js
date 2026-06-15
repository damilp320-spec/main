// Хранилище секретов: зашифрованный сейф для паролей/ключей/заметок.
// Значения шифруются через safeStorage. Доступ агентов СТРОГО опционален:
// по умолчанию выключен глобально и для каждого секрета отдельно.
const store = require('./store');
const { randomUUID } = require('crypto');
function secrets() { try { return require('./secrets'); } catch { return null; } }

function enc(v) { const s = secrets(); return (s && s.encrypt) ? s.encrypt(String(v == null ? '' : v)) : String(v == null ? '' : v); }
function dec(v) { const s = secrets(); return (s && s.decrypt) ? s.decrypt(v) : v; }

function all() { return store.get('vault', []); }
function list() { return all().map((v) => ({ id: v.id, name: v.name, type: v.type || 'password', agentAllowed: !!v.agentAllowed, updated: v.updated })); }
function get(id) { const v = all().find((x) => x.id === id); return v ? { id: v.id, name: v.name, type: v.type, agentAllowed: !!v.agentAllowed, value: dec(v.enc) } : null; }
function save(e) {
  const list0 = all();
  e.name = String(e.name || 'secret').slice(0, 80);
  const rec = { id: e.id || ('v-' + randomUUID().slice(0, 8)), name: e.name, type: e.type || 'password', agentAllowed: !!e.agentAllowed, enc: enc(e.value), updated: Date.now() };
  const i = list0.findIndex((x) => x.id === rec.id);
  if (i >= 0) { if (e.value === undefined) rec.enc = list0[i].enc; list0[i] = rec; } else list0.push(rec);
  store.set('vault', list0.slice(0, 500));
  return { ok: true, id: rec.id };
}
function remove(id) { store.set('vault', all().filter((x) => x.id !== id)); return { ok: true }; }
function available() { const s = secrets(); return { encrypted: !!(s && s.available && s.available()) }; }

// Доступ агента — только если глобально разрешено И секрет помечен agentAllowed.
function agentGet(name) {
  if (!store.get('settings.vaultAgentAccess', false)) return { ok: false, error: 'Доступ агентов к сейфу выключен.' };
  const v = all().find((x) => x.name.toLowerCase() === String(name || '').toLowerCase());
  if (!v) return { ok: false, error: 'Секрет не найден.' };
  if (!v.agentAllowed) return { ok: false, error: 'Этот секрет не разрешён для агентов.' };
  return { ok: true, value: dec(v.enc) };
}

const toolSchemas = [
  { type: 'function', function: { name: 'get_secret', description: 'Получить секрет из хранилища по имени. Доступно только если пользователь явно разрешил доступ агентам и пометил секрет.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } }
];
const toolHandlers = {
  get_secret: (a) => { const r = agentGet(a.name); return r.ok ? r.value : ('ОТКАЗАНО: ' + r.error); }
};

module.exports = { list, get, save, remove, available, agentGet, toolSchemas, toolHandlers };
