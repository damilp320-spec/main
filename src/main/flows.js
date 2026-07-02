// Сценарии-конвейеры (визуальный конструктор): последовательность шагов
// триггер → агент → инструмент → действие. Движок выполняет шаги по порядку,
// передавая вывод предыдущего шага в следующий ({input}).
// Персистится в store('flows'). Триггеры startup/interval запускаются на старте.
const store = require('./store');

let runAgent = null;     // (agentId, prompt) => Promise<text>
let runTool = null;      // (name, args) => Promise<string>
let speak = null;        // (text) => void
let notify = null;       // (payload) => void
const intervals = new Map();

function init(deps) { runAgent = deps.runAgent; runTool = deps.runTool; speak = deps.speak; notify = deps.notify; }

function list() { return store.get('flows', []); }
function save(flow) {
  const all = list();
  if (!flow.id) flow.id = 'flow-' + Math.random().toString(36).slice(2, 9);
  const i = all.findIndex((f) => f.id === flow.id);
  if (i >= 0) all[i] = flow; else all.push(flow);
  store.set('flows', all);
  scheduleTriggers();
  return flow;
}
function remove(id) { store.set('flows', list().filter((f) => f.id !== id)); scheduleTriggers(); return { ok: true }; }

function fill(tpl, ctx) { return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? ctx[k] : '')); }

// Выполнить сценарий по шагам.
async function run(id, sendToUI) {
  const flow = list().find((f) => f.id === id);
  if (!flow) return { ok: false, error: 'Сценарий не найден' };
  const emit = (ev, p) => sendToUI && sendToUI(ev, { flowId: id, ...p });
  emit('flow:start', { name: flow.name });
  let input = '';
  const steps = flow.steps || [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    emit('flow:step', { index: i, type: st.type, state: 'run' });
    try {
      if (st.type === 'agent') {
        input = await runAgent(st.agentId || 'tpl-assistant', fill(st.prompt, { input }));
      } else if (st.type === 'tool') {
        let args = st.args || {};
        if (typeof args === 'string') { try { args = JSON.parse(fill(args, { input })); } catch { args = {}; } }
        input = await runTool(st.tool, args);
      } else if (st.type === 'notify') {
        notify && notify({ title: fill(st.title || 'Сценарий', { input }), message: fill(st.message || input, { input }) });
      } else if (st.type === 'speak') {
        speak && speak(fill(st.text || input, { input }));
      } else if (st.type === 'wait') {
        await new Promise((r) => setTimeout(r, Math.min(60000, (parseInt(st.seconds, 10) || 1) * 1000)));
      }
      emit('flow:step', { index: i, type: st.type, state: 'done', output: String(input || '').slice(0, 200) });
    } catch (e) {
      emit('flow:step', { index: i, type: st.type, state: 'error', output: e.message });
      emit('flow:done', { ok: false, error: e.message });
      return { ok: false, error: e.message };
    }
  }
  emit('flow:done', { ok: true, output: String(input || '').slice(0, 400) });
  return { ok: true, output: input };
}

// Триггеры по расписанию (startup выполняется через startupRun).
function scheduleTriggers() {
  for (const [, h] of intervals) clearInterval(h);
  intervals.clear();
  for (const f of list()) {
    if (f.enabled === false) continue;
    const tr = f.trigger || {};
    if (tr.type === 'interval' && tr.intervalSec) {
      const ms = Math.max(30, parseInt(tr.intervalSec, 10)) * 1000;
      intervals.set(f.id, setInterval(() => run(f.id, global.__flowSender), ms));
    }
  }
}

function startupRun(sendToUI) {
  global.__flowSender = sendToUI;
  scheduleTriggers();
  for (const f of list()) {
    if (f.enabled !== false && f.trigger && f.trigger.type === 'startup') run(f.id, sendToUI);
  }
}

module.exports = { init, list, save, remove, run, startupRun };
