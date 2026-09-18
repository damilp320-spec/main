// Пульт автоматизаций: статус всех фоновых «движков» приложения и общий стоп.
const store = require('./store');

function status() {
  const bot = store.get('settings.bot', {}) || {};
  const copilot = store.get('settings.copilot', {}) || {};
  const watchers = store.get('watchers', []);
  const dca = store.get('dcaPlans', []);
  const alerts = store.get('priceAlerts', []);
  const flows = store.get('flows', []);
  const cal = store.get('calendar', []);
  const now = Date.now();
  return {
    bot: { on: bot.enabled === true, detail: `${bot.mode || 'paper'} · ${bot.strategy || 'macd'}` },
    copilot: { on: copilot.enabled === true, detail: copilot.risk || 'balanced' },
    alerts: { on: alerts.some((a) => a.enabled !== false), count: alerts.filter((a) => a.enabled !== false).length },
    dca: { on: dca.some((p) => p.enabled !== false), count: dca.filter((p) => p.enabled !== false).length },
    watchers: { on: watchers.some((w) => w.enabled !== false), count: watchers.filter((w) => w.enabled !== false).length },
    flows: { on: flows.some((f) => f.enabled !== false && f.trigger && f.trigger.type === 'interval'), count: flows.filter((f) => f.enabled !== false && f.trigger && f.trigger.type === 'interval').length },
    dailyDigest: { on: store.get('settings.dailyDigest', false) },
    dispatch: { on: store.get('dispatch.enabled', false) },
    mcp: { on: store.get('settings.mcpEnabled', false), count: (store.get('settings.mcpServers', []) || []).length },
    calendar: { on: cal.some((e) => e.start > now && !e._reminded), count: cal.filter((e) => e.start > now).length }
  };
}

// Общий «стоп-кран»: выключает все автономные циклы.
function stopAll() {
  const r = { stopped: [] };
  try { require('./tradingbot').setCfg({ enabled: false }); r.stopped.push('бот'); } catch {}
  try { require('./copilot').setCfg({ enabled: false }); r.stopped.push('копилот'); } catch {}
  store.set('settings.dailyDigest', false);
  try { const w = require('./watchers'); w.list().forEach((x) => { if (x.enabled !== false) w.toggle(x.id, false); }); r.stopped.push('наблюдатели'); } catch {}
  try { const d = require('./dca'); d.list().forEach((x) => { if (x.enabled !== false) d.toggle(x.id, false); }); r.stopped.push('DCA'); } catch {}
  try { const a = require('./alerts'); a.list().forEach((x) => { if (x.enabled !== false) a.toggle(x.id, false); }); r.stopped.push('алерты'); } catch {}
  try { const f = require('./flows'); f.list().forEach((x) => { if (x.enabled !== false) { x.enabled = false; f.save(x); } }); r.stopped.push('сценарии'); } catch {}
  r.ok = true;
  return r;
}

module.exports = { status, stopAll };
