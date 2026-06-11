// Мультиагентные сценарии (swarm): координатор делит цель на подзадачи,
// назначает их агентам-специалистам, собирает результат.
const { randomUUID } = require('crypto');
const ollama = require('./ollama');
const cfg = require('./store');

function planModel() { return cfg.get('settings.defaultModel', '') || 'qwen2.5:7b'; }

// Планировщик: разбивает цель на шаги и назначает агента каждому.
async function plan(goal, agents) {
  const roster = agents.map((a, i) => `${i + 1}. ${a.name} — ${a.system.slice(0, 120)}`).join('\n');
  const prompt = `Цель: ${goal}\n\nДоступные агенты:\n${roster}\n\nРазбей цель на 2-5 последовательных подзадач. Для каждой укажи номер агента и краткую формулировку. Ответ строго в JSON-массиве: [{"agent": <номер>, "task": "<текст>"}]. Только JSON, без пояснений.`;
  const res = await ollama.chatStream({ model: planModel(), messages: [{ role: 'user', content: prompt }] }, null);
  const m = (res.content || '').match(/\[[\s\S]*\]/);
  if (!m) return [{ agent: 1, task: goal }];
  try {
    const arr = JSON.parse(m[0]);
    return arr.filter((s) => s && s.task).map((s) => ({ agent: Math.max(1, Math.min(agents.length, +s.agent || 1)), task: String(s.task) }));
  } catch { return [{ agent: 1, task: goal }]; }
}

async function run({ goal, agentIds }, sendToUI) {
  const agentMod = require('./agent');
  const all = agentMod.listAgents();
  const agents = agentIds.map((id) => all.find((a) => a.id === id)).filter(Boolean);
  if (!agents.length) return { ok: false, error: 'Не выбрано ни одного агента' };

  const runId = randomUUID();
  sendToUI && sendToUI('swarm:status', { runId, phase: 'plan', message: 'Планирование…' });
  const steps = await plan(goal, agents);
  sendToUI && sendToUI('swarm:plan', { runId, steps: steps.map((s) => ({ agent: agents[s.agent - 1].name, task: s.task })) });

  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agent = agents[step.agent - 1] || agents[0];
    sendToUI && sendToUI('swarm:step', { runId, index: i, total: steps.length, agent: agent.name, task: step.task, state: 'run' });
    const context = results.length ? '\n\nРезультаты предыдущих шагов:\n' + results.map((r, j) => `Шаг ${j + 1} (${r.agent}): ${r.text.slice(0, 600)}`).join('\n') : '';
    const r = await agentMod.chat({ agentId: agent.id, message: step.task + context, history: [] }, null);
    results.push({ agent: agent.name, task: step.task, text: r.text });
    sendToUI && sendToUI('swarm:step', { runId, index: i, total: steps.length, agent: agent.name, task: step.task, state: 'done', result: r.text.slice(0, 1500) });
  }

  // Агрегация.
  sendToUI && sendToUI('swarm:status', { runId, phase: 'aggregate', message: 'Сведение результатов…' });
  const summaryPrompt = `Цель: ${goal}\n\nРезультаты работы команды агентов:\n${results.map((r, i) => `Шаг ${i + 1} (${r.agent}): ${r.text.slice(0, 800)}`).join('\n\n')}\n\nСоставь итоговый связный ответ для пользователя по цели.`;
  const final = await ollama.chatStream({ model: planModel(), messages: [{ role: 'user', content: summaryPrompt }] },
    (chunk) => sendToUI && sendToUI('swarm:final-chunk', { runId, chunk }));
  sendToUI && sendToUI('swarm:done', { runId, text: final.content });
  return { ok: true, runId, steps: results, final: final.content };
}

module.exports = { run, plan };
