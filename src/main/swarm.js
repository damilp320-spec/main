// Мультиагентные сценарии (swarm) с настоящим лидером-координатором.
// Лидер распределяет подзадачи, ПРОВЕРЯЕТ работу каждого исполнителя,
// просит доработки (диалог между агентами), а в конце несколько раз
// перепроверяет достижение цели и доводит её до конца.
const { randomUUID } = require('crypto');
const ollama = require('./ollama');
const cfg = require('./store');

function leaderModel() { return cfg.get('settings.defaultModel', '') || 'qwen2.5:7b'; }

async function ask(prompt, onChunk) {
  const res = await ollama.chatStream({ model: leaderModel(), messages: [{ role: 'user', content: prompt }], options: { temperature: 0.5 } }, onChunk || null);
  return (res.content || '').trim();
}
function parseJson(text, fallback) {
  const m = text.match(/[[{][\s\S]*[\]}]/);
  if (!m) return fallback;
  try { return JSON.parse(m[0]); } catch { return fallback; }
}

// Лидер делит цель на подзадачи с назначением исполнителя и критерием приёмки.
async function plan(goal, agents) {
  const roster = agents.map((a, i) => `${i + 1}. ${a.name} — ${String(a.system).slice(0, 120)}`).join('\n');
  const prompt = `Ты — лидер команды AI-агентов. Цель: «${goal}».\n\nКоманда:\n${roster}\n\n` +
    `Разбей цель на 2–5 последовательных подзадач. Для каждой укажи номер исполнителя и критерий приёмки (как понять, что сделано хорошо). ` +
    `Ответ строго JSON-массивом: [{"agent": <номер>, "task": "<что сделать>", "criteria": "<критерий приёмки>"}]. Только JSON.`;
  const arr = parseJson(await ask(prompt), null);
  if (!Array.isArray(arr) || !arr.length) return [{ agent: 1, task: goal, criteria: 'Цель достигнута' }];
  return arr.filter((s) => s && s.task).map((s) => ({
    agent: Math.max(1, Math.min(agents.length, +s.agent || 1)),
    task: String(s.task),
    criteria: String(s.criteria || 'Соответствует цели')
  }));
}

// Лидер оценивает результат исполнителя: принять или вернуть на доработку.
async function review(goal, task, criteria, result) {
  const prompt = `Ты — лидер-ревьюер. Цель проекта: «${goal}». Подзадача: «${task}». Критерий приёмки: «${criteria}».\n\n` +
    `Результат исполнителя:\n"""${String(result).slice(0, 1500)}"""\n\n` +
    `Оцени строго. Ответ JSON: {"verdict": "accept" | "revise", "feedback": "<что улучшить, если revise>"}. Только JSON.`;
  const r = parseJson(await ask(prompt), { verdict: 'accept', feedback: '' });
  return { verdict: r.verdict === 'revise' ? 'revise' : 'accept', feedback: String(r.feedback || '') };
}

async function runWorker(agentMod, agent, prompt) {
  try {
    const r = await agentMod.chat({ agentId: agent.id, message: prompt, history: [] }, null);
    return r.text || '(пустой ответ)';
  } catch (e) { return 'ОШИБКА исполнителя: ' + e.message; }
}

async function run({ goal, agentIds }, sendToUI) {
  const agentMod = require('./agent');
  const all = agentMod.listAgents();
  const agents = agentIds.map((id) => all.find((a) => a.id === id)).filter(Boolean);
  if (!agents.length) return { ok: false, error: 'Не выбрано ни одного агента' };

  const runId = randomUUID();
  const emit = (ch, data) => sendToUI && sendToUI(ch, { runId, ...data });
  const MAX_REVISIONS = 2, MAX_ROUNDS = 2;
  const accepted = []; // {agent, task, text}

  emit('swarm:status', { phase: 'plan', message: 'Лидер планирует…' });
  let steps = await plan(goal, agents);
  emit('swarm:plan', { steps: steps.map((s) => ({ agent: agents[s.agent - 1].name, task: s.task })) });

  let stepIndex = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const agent = agents[step.agent - 1] || agents[0];
      const ctx = accepted.length ? '\n\nУже сделано командой:\n' + accepted.map((r, j) => `• ${r.agent}: ${String(r.text).slice(0, 400)}`).join('\n') : '';
      let feedback = '';
      let result = '';
      for (let rev = 0; rev <= MAX_REVISIONS; rev++) {
        emit('swarm:step', { index: stepIndex, agent: agent.name, task: step.task, state: rev ? 'revise' : 'run', note: feedback });
        const prompt = `Цель команды: «${goal}».\nТвоя подзадача: ${step.task}\nКритерий приёмки: ${step.criteria}${ctx}` +
          (feedback ? `\n\nЛидер вернул на доработку: ${feedback}\nУчти замечания и переделай.` : '');
        result = await runWorker(agentMod, agent, prompt);
        const verdict = await review(goal, step.task, step.criteria, result);
        emit('swarm:review', { index: stepIndex, agent: agent.name, verdict: verdict.verdict, feedback: verdict.feedback });
        if (verdict.verdict === 'accept' || rev === MAX_REVISIONS) { feedback = ''; break; }
        feedback = verdict.feedback || 'Улучши качество и полноту.';
      }
      accepted.push({ agent: agent.name, task: step.task, text: result });
      emit('swarm:step', { index: stepIndex, agent: agent.name, task: step.task, state: 'done', result: String(result).slice(0, 1500) });
      stepIndex++;
    }

    // Лидер перепроверяет, достигнута ли цель целиком.
    emit('swarm:status', { phase: 'verify', message: `Лидер проверяет результат (раунд ${round + 1})…` });
    const check = parseJson(await ask(
      `Цель: «${goal}». Сделанная работа:\n${accepted.map((r) => `• ${r.agent}: ${String(r.text).slice(0, 400)}`).join('\n')}\n\n` +
      `Цель достигнута полностью? Если нет — какие ещё подзадачи нужны? ` +
      `Ответ JSON: {"done": true|false, "followups": [{"agent": <номер 1-${agents.length}>, "task": "...", "criteria": "..."}]}. Только JSON.`),
      { done: true, followups: [] });
    if (check.done || !Array.isArray(check.followups) || !check.followups.length) break;
    steps = check.followups.filter((s) => s && s.task).map((s) => ({ agent: Math.max(1, Math.min(agents.length, +s.agent || 1)), task: String(s.task), criteria: String(s.criteria || 'Соответствует цели') }));
    emit('swarm:plan', { steps: steps.map((s) => ({ agent: agents[s.agent - 1].name, task: s.task })), append: true });
  }

  // Финальное сведение лидером.
  emit('swarm:status', { phase: 'aggregate', message: 'Лидер сводит итог…' });
  const final = await ask(
    `Ты — лидер команды. Цель: «${goal}». Результаты:\n${accepted.map((r, i) => `Шаг ${i + 1} (${r.agent}): ${String(r.text).slice(0, 700)}`).join('\n\n')}\n\nСоставь итоговый связный ответ пользователю.`,
    (chunk) => emit('swarm:final-chunk', { chunk }));
  emit('swarm:done', { text: final });
  return { ok: true, runId, steps: accepted, final };
}

module.exports = { run, plan };
