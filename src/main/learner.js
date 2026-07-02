// Самообучение: после успешно решённой задачи агент выделяет ПЕРЕИСПОЛЬЗУЕМЫЙ
// скил (декларативный манифест — команда или http-запрос с параметрами) и
// добавляет его в библиотеку. Из соображений безопасности новые скилы создаются
// ВЫКЛЮЧЕННЫМИ — пользователь просматривает и включает их сам.
// Включается настройкой settings.autoLearnSkills.
const store = require('./store');
const ollama = require('./ollama');
const skills = require('./skills');

function enabled() { return store.get('settings.autoLearnSkills', false); }

// Грубая эвристика «задача нетривиальная и успешная»: были вызовы инструментов
// и финальный текст не похож на ошибку.
function looksSuccessful(toolCalls, finalText) {
  if (!toolCalls || toolCalls < 1) return false;
  const t = String(finalText || '').toLowerCase();
  if (/ошибк|error|не удалось|failed|не получилось/.test(t)) return false;
  return true;
}

const PROMPT = (userMsg, finalText) => `Ты — инженер по автоматизации. По завершённому диалогу реши, можно ли превратить РЕШЕНИЕ в ПЕРЕИСПОЛЬЗУЕМЫЙ навык (скил) для будущих похожих задач.

Запрос пользователя: ${String(userMsg).slice(0, 600)}
Итог агента: ${String(finalText).slice(0, 600)}

Скил — это шаблон ОДНОГО действия с параметрами в фигурных скобках. Тип:
- "command": shell/PowerShell команда (например, архивировать папку, узнать что-то о системе);
- "http": GET-запрос к публичному API (например, погода, курсы валют).

Ответь СТРОГО одним JSON-объектом без markdown:
{"useful": true|false, "name": "short_snake_case", "label": "Короткое название", "description": "Что делает", "type": "command"|"http", "params": [{"name":"x","description":"..."}], "template": "команда или URL с {x}"}
Если задача разовая/неподходящая для шаблона — верни {"useful": false}. Не выдумывай опасных команд (format, rm -rf, shutdown).`;

async function maybeLearn({ model, userMsg, finalText, toolCalls }, sendToUI) {
  if (!enabled() || !looksSuccessful(toolCalls, finalText)) return;
  try {
    const res = await ollama.chatStream({ model, messages: [{ role: 'user', content: PROMPT(userMsg, finalText) }], options: { temperature: 0.2 } }, null);
    const m = /\{[\s\S]*\}/.exec(res.content || '');
    if (!m) return;
    let obj; try { obj = JSON.parse(m[0]); } catch { return; }
    if (!obj.useful || !obj.template || !['command', 'http'].includes(obj.type)) return;
    if (!obj.name) return;

    // Дедупликация по имени.
    const existing = skills.listSkills();
    const nm = String(obj.name).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    if (existing.some((s) => s.name === nm)) return;

    const skill = skills.saveSkill({
      name: nm,
      label: String(obj.label || obj.name).slice(0, 60),
      type: obj.type,
      description: '🤖 ' + String(obj.description || '').slice(0, 200),
      method: 'GET',
      params: Array.isArray(obj.params) ? obj.params.filter((p) => p && p.name).map((p) => ({ name: String(p.name).slice(0, 30), description: String(p.description || '').slice(0, 120) })) : [],
      template: String(obj.template).slice(0, 500),
      enabled: false,    // важно: новый скил выключен до проверки пользователем
      learned: true
    });
    sendToUI && sendToUI('learner:skill', { skill });
  } catch { /* самообучение — best effort */ }
}

module.exports = { maybeLearn, enabled };
