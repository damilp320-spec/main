// «Бесшовное взаимодействие»: инструменты, которыми агент управляет САМИМ
// приложением — создаёт скилы/плагины, новых агентов, ставит задачи в очередь,
// сохраняет знания, переключает разделы и настройки. Это превращает Mythera
// в платформу, которую ИИ может расширять под себя.
const cfg = require('./store');

let uiSend = null; // (channel, payload) -> renderer
function setUISender(fn) { uiSend = fn; }
function enabled() { return cfg.get('settings.appControl', true); }

const SETTABLE = new Set(['effort', 'defaultModel', 'temperature', 'maxSteps', 'rag', 'constitution', 'voiceReplies', 'autoListen', 'notifications', 'taskConcurrency', 'musicService', 'toolRouting', 'modelRouting', 'selfVerify', 'visibleThinking', 'webAutomation', 'guiAutomation', 'operator', 'autoLearnSkills', 'duplexVoice', 'artifacts']);
const VIEWS = new Set(['dashboard', 'agents', 'marketplace', 'scenarios', 'scheduler', 'minecraft', 'servers', 'translator', 'smarthome', 'knowledge', 'swarm', 'queue', 'skills', 'dispatch', 'prompts', 'voice', 'developer', 'settings']);

const toolSchemas = [
  { type: 'function', function: { name: 'create_skill', description: 'Создать новый плагин-скил (навык) приложения. type: command (шаблон команды) или http (URL). Скил станет доступен всем агентам как инструмент.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'имя-инструмент a-z_' }, label: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, template: { type: 'string', description: 'команда или URL с плейсхолдерами {param}' }, params: { type: 'string', description: 'параметры через запятую' } }, required: ['name', 'type', 'template'] } } },
  { type: 'function', function: { name: 'create_agent', description: 'Создать нового агента-специалиста с заданным характером (системным промптом).', parameters: { type: 'object', properties: { name: { type: 'string' }, icon: { type: 'string' }, model: { type: 'string' }, autonomy: { type: 'string', description: 'chat-only | balanced | autonomous' }, system: { type: 'string', description: 'роль и характер агента' } }, required: ['name', 'system'] } } },
  { type: 'function', function: { name: 'queue_task', description: 'Поставить задачу в очередь задач приложения (выполнится в фоне). agents — имена агентов через запятую (несколько = команда swarm).', parameters: { type: 'object', properties: { goal: { type: 'string' }, agents: { type: 'string' }, priority: { type: 'number' } }, required: ['goal'] } } },
  { type: 'function', function: { name: 'remember_knowledge', description: 'Сохранить текст в общую базу знаний (RAG), чтобы агенты использовали его в будущем.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'app_set_setting', description: 'Изменить настройку приложения. key: effort, defaultModel, temperature, maxSteps, rag, constitution, voiceReplies, notifications, taskConcurrency, musicService.', parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] } } },
  { type: 'function', function: { name: 'app_open', description: 'Открыть раздел приложения в интерфейсе (agents, queue, skills, knowledge, smarthome, settings и т.д.).', parameters: { type: 'object', properties: { view: { type: 'string' } }, required: ['view'] } } },
  { type: 'function', function: { name: 'app_state', description: 'Сводка состояния приложения: какие есть агенты, скилы, модели и задачи (чтобы понять, что можно сделать).', parameters: { type: 'object', properties: {} } } }
];

function coerce(v) {
  if (v === 'true') return true; if (v === 'false') return false;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) return +v;
  return v;
}

const toolHandlers = {
  async create_skill({ name, label, type, description, template, params }) {
    if (!enabled()) return 'Управление приложением отключено в настройках.';
    if (!['command', 'http'].includes(type)) return 'type должен быть command или http.';
    const skills = require('./skills');
    const p = (params ? String(params).split(',').map((s) => s.trim()).filter(Boolean) : []).map((n) => ({ name: n, description: '' }));
    const s = skills.saveSkill({ name, label: label || name, type, description: description || '', template, params: p, method: 'GET' });
    uiSend && uiSend('app:changed', { what: 'skills' });
    return `OK: скил «${s.label}» создан (инструмент ${s.name}). Доступен агентам.`;
  },
  async create_agent({ name, icon, model, autonomy, system }) {
    if (!enabled()) return 'Управление приложением отключено в настройках.';
    const agent = require('./agent');
    const a = agent.saveAgent({ name: String(name).slice(0, 60), icon: icon || '🤖', model: model || cfg.get('settings.defaultModel', '') || 'qwen2.5:7b', autonomy: ['chat-only', 'balanced', 'autonomous'].includes(autonomy) ? autonomy : 'balanced', system: String(system).slice(0, 4000) });
    uiSend && uiSend('app:changed', { what: 'agents' });
    return `OK: агент «${a.name}» создан.`;
  },
  async queue_task({ goal, agents, priority }) {
    if (!enabled()) return 'Управление приложением отключено в настройках.';
    const agentMod = require('./agent');
    const taskQueue = require('./taskQueue');
    let agentIds = [];
    if (agents) {
      const names = String(agents).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      agentIds = agentMod.listAgents().filter((a) => names.includes(String(a.name).toLowerCase())).map((a) => a.id);
    }
    const r = taskQueue.add({ goal, agentIds, priority: priority || 3 });
    uiSend && uiSend('app:changed', { what: 'queue' });
    return r.ok ? `OK: задача добавлена в очередь (id ${r.task.id}).` : 'Ошибка: ' + r.error;
  },
  async remember_knowledge({ text }) {
    const rag = require('./rag');
    const r = await rag.addDocument('kb', text, 'agent');
    return r.ok ? `OK: сохранено в базу знаний (${r.added} фрагм.).` : 'Ошибка: ' + r.error + ' (установлена ли модель эмбеддингов?)';
  },
  async app_set_setting({ key, value }) {
    if (!enabled()) return 'Управление приложением отключено в настройках.';
    if (!SETTABLE.has(key)) return `Настройка «${key}» недоступна для изменения агентом.`;
    cfg.set('settings.' + key, coerce(value));
    uiSend && uiSend('app:changed', { what: 'settings', key });
    return `OK: настройка ${key} = ${value}.`;
  },
  async app_open({ view }) {
    if (!VIEWS.has(view)) return `Раздел «${view}» не найден.`;
    uiSend && uiSend('navigate', view);
    return `OK: открыт раздел ${view}.`;
  },
  async app_state() {
    const agentMod = require('./agent');
    const skills = require('./skills');
    const taskQueue = require('./taskQueue');
    const ollama = require('./ollama');
    const agents = agentMod.listAgents().map((a) => a.name);
    const sk = skills.listSkills().map((s) => s.name);
    const models = (await ollama.listModels().catch(() => [])).map((m) => m.name);
    const q = taskQueue.list();
    const counts = q.tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});
    return `Агенты (${agents.length}): ${agents.join(', ')}\nСкилы: ${sk.join(', ') || '—'}\nМодели: ${models.join(', ') || 'нет'}\nОчередь: ${JSON.stringify(counts)}`;
  }
};

module.exports = { toolSchemas, toolHandlers, setUISender, enabled };
