// Усилители интеллекта агентов: адаптивное усилие, обучение на своей истории
// (few-shot), self-consistency (best-of-N) и критик-модель (второе мнение).
// Все приёмы опциональны и повышают качество ценой дополнительных вызовов.
const store = require('./store');
const ollama = require('./ollama');

// Оценка сложности запроса (для адаптивного усилия) — дёшево, по эвристикам.
function difficulty(message) {
  const m = String(message || '').toLowerCase();
  let s = 0;
  if (m.length > 300 || (m.match(/\?/g) || []).length >= 2) s++;
  if (/код|програм|python|java|algorithm|алгоритм|sql|регуляр|функци|class|оптимизир|спроектир|реализуй/.test(m)) s++;       // код/инженерия
  if (/почему|сравни|докажи|объясни|оцени|проанализир|分析|обоснуй|разбер/.test(m)) s++;                                       // рассуждение
  if (/по шагам|step by step|сначала|затем|во-первых|план|многошаг|тщательно|подробно/.test(m)) s++;                          // многошаговость
  return s >= 2 ? 'hard' : 'easy';
}

function cosine(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9); }

// Few-shot из прошлых УСПЕШНЫХ диалогов. Семантический отбор (эмбеддинги) при
// включённой настройке, иначе по ключевым словам.
async function fewShotContext(agentId, message) {
  if (!store.get('settings.learnFromHistory', false)) return '';
  const hist = store.get('chatHistory', []).filter((h) => h.agentId === agentId && h.user && h.assistant && !/ошибк|не удалось|error|failed/i.test(h.assistant));
  if (!hist.length) return '';
  const words = String(message || '').toLowerCase().split(/[^a-zа-я0-9]+/).filter((w) => w.length > 3);
  if (!words.length) return '';
  // Предфильтр по ключевым словам.
  let cands = hist.map((h) => { const t = (h.user + ' ' + h.assistant).toLowerCase(); return { h, s: words.filter((w) => t.includes(w)).length }; }).filter((x) => x.s >= 1).sort((a, b) => b.s - a.s).slice(0, 12);
  if (!cands.length) return '';
  // Семантическое уточнение по эмбеддингам (если включено и доступно).
  if (store.get('settings.semanticFewShot', false)) {
    try {
      const rag = require('./rag');
      const qv = await rag.embed(message);
      for (const c of cands) { try { c.sim = cosine(qv, await rag.embed(String(c.h.user).slice(0, 400))); } catch { c.sim = 0; } }
      cands.sort((a, b) => (b.sim || 0) - (a.sim || 0));
    } catch { /* fallback на ключевые слова */ }
  }
  const top = cands.slice(0, 2);
  return '\n\nПримеры, как ты УСПЕШНО решал похожие запросы ранее (учись на своём опыте, но не копируй слепо):\n' +
    top.map((x) => `• Запрос: ${String(x.h.user).slice(0, 180)}\n  Хороший ответ: ${String(x.h.assistant).slice(0, 280)}`).join('\n');
}

// Reflexion: краткий «урок» из неудачной попытки для следующей итерации.
async function reflexion(model, userMsg, answer, critique) {
  try {
    const r = await ollama.chatStream({ model, messages: [
      { role: 'system', content: 'Ты анализируешь неудачную попытку. Сформулируй ОДИН короткий конкретный урок (что сделать иначе в следующий раз), чтобы исправить проблему. Одно предложение.' },
      { role: 'user', content: `Запрос: ${String(userMsg).slice(0, 400)}\nОтвет/попытка: ${String(answer).slice(0, 500)}\nЗамечание: ${String(critique).slice(0, 300)}` }
    ], options: { temperature: 0.3 } }, null);
    return (r.content || '').trim().slice(0, 200);
  } catch { return ''; }
}

// Глубокий ризонинг: декомпозиция задачи на подвопросы → решение каждого →
// синтез (least-to-most / o1-подобный test-time reasoning).
async function deepReason({ model, messages, message, finalText, sendToUI, sessionId }) {
  try {
    const plan = await ollama.chatStream({ model, messages: [
      { role: 'system', content: 'Разбей задачу на 2-4 ключевых ПОДВОПРОСА, ответы на которые нужны для точного решения. Верни ТОЛЬКО JSON: {"steps":["...","..."]}' },
      { role: 'user', content: String(message) }
    ], options: { temperature: 0.3, format: 'json' } }, null);
    let steps = []; try { steps = (JSON.parse(plan.content || '{}').steps || []).slice(0, 4); } catch {}
    if (steps.length < 2) return finalText;
    sendToUI && sendToUI('agents:reason', { sessionId, note: `декомпозиция: ${steps.length} подзадач` });
    const solved = [];
    for (const st of steps) {
      const r = await ollama.chatStream({ model, messages: [...messages, { role: 'user', content: 'Реши кратко и точно эту подзадачу (только суть): ' + st }], options: { temperature: 0.3 } }, null);
      solved.push(`— ${st}\n  → ${(r.content || '').trim().slice(0, 400)}`);
    }
    const syn = await ollama.chatStream({ model, messages: [...messages, { role: 'user', content: 'Опираясь на решения подзадач:\n' + solved.join('\n') + '\n\nДай ИТОГОВЫЙ точный и связный ответ на исходный запрос (без предисловий, без перечисления подзадач).' }], options: { temperature: 0.4 } }, null);
    return (syn.content && syn.content.length > 20) ? syn.content : finalText;
  } catch { return finalText; }
}

// Уточнение финального ответа: deep-reasoning → self-consistency → критик.
async function refine({ messages, model, finalText, effort, hard, message, sendToUI, sessionId }) {
  let out = finalText;
  if (!out || out.length < 30) return out;
  const deep = effort === 'max' || hard;

  // Глубокий ризонинг (декомпозиция) — для сложных задач.
  if (store.get('settings.deepReasoning', false) && deep) {
    out = await deepReason({ model, messages, message, finalText: out, sendToUI, sessionId });
  }

  // Self-consistency (best-of-N) — только в режиме «максимум».
  if (store.get('settings.selfConsistency', false) && effort === 'max') {
    try {
      const samples = [out];
      for (let i = 0; i < 2; i++) { const r = await ollama.chatStream({ model, messages, options: { temperature: 0.9 } }, null); if (r.content && r.content.length > 20) samples.push(r.content); }
      if (samples.length > 1) {
        sendToUI && sendToUI('agents:reason', { sessionId, note: `self-consistency: ${samples.length} вариантов` });
        const judge = [{ role: 'system', content: 'Тебе даны несколько вариантов ответа на один запрос. Выбери САМЫЙ точный, полный и корректный. Ответь ТОЛЬКО номером лучшего варианта.' }, { role: 'user', content: samples.map((s, i) => `Вариант ${i + 1}:\n${s}`).join('\n\n') }];
        const j = await ollama.chatStream({ model, messages: judge, options: { temperature: 0 } }, null);
        const n = parseInt((/(\d+)/.exec(j.content || '') || [])[1], 10);
        if (n >= 1 && n <= samples.length) out = samples[n - 1];
      }
    } catch { /* best effort */ }
  }

  // Критик-модель (второе мнение / дебаты) — для thorough/max.
  const critic = store.get('settings.criticModel', '');
  if (critic && (effort === 'thorough' || effort === 'max')) {
    try {
      const userMsg = [...messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
      const q = userMsg ? String(userMsg.content).slice(0, 800) : String(message || '');
      let crit = '';
      if (store.get('settings.criticDebate', false) && effort === 'max') {
        // Дебаты: скептик critic vs защитник model → разбор разногласий.
        const skeptic = await ollama.chatStream({ model: critic, messages: [{ role: 'system', content: 'Ты — скептик. Жёстко оспорь ответ: найди слабые места, ошибки, контрпримеры.' }, { role: 'user', content: `Запрос: ${q}\nОтвет: ${String(out).slice(0, 1200)}` }], options: { temperature: 0.5 } }, null);
        const defense = await ollama.chatStream({ model, messages: [{ role: 'system', content: 'Ты защищаешь свой ответ. Согласись с обоснованной критикой и укажи, что реально нужно исправить (или почему критика неверна).' }, { role: 'user', content: `Ответ: ${String(out).slice(0, 1000)}\nКритика скептика: ${(skeptic.content || '').slice(0, 600)}` }], options: { temperature: 0.3 } }, null);
        crit = 'Скептик: ' + (skeptic.content || '').slice(0, 400) + '\nЗащита: ' + (defense.content || '').slice(0, 300);
        sendToUI && sendToUI('agents:reason', { sessionId, note: 'дебаты: скептик vs защитник' });
      } else {
        const cr = await ollama.chatStream({ model: critic, messages: [
          { role: 'system', content: 'Ты — строгий рецензент. Найди ФАКТИЧЕСКИЕ ошибки, неточности и упущения в ответе на запрос. Если ответ верный и полный — напиши ровно «ОК». Иначе кратко перечисли проблемы.' },
          { role: 'user', content: `Запрос: ${q}\n\nОтвет: ${String(out).slice(0, 1500)}` }
        ], options: { temperature: 0.2 } }, null);
        crit = (cr.content || '').trim();
        if (crit && !/^\s*(ок|ok)\b/i.test(crit)) sendToUI && sendToUI('agents:reason', { sessionId, note: 'критик: ' + crit.slice(0, 140) });
        else crit = '';
      }
      if (crit) {
        const rev = await ollama.chatStream({ model, messages: [...messages, { role: 'assistant', content: out }, { role: 'user', content: 'Разбор/критика:\n' + crit + '\nУчти обоснованные замечания и дай улучшенный ОКОНЧАТЕЛЬНЫЙ ответ (без предисловий).' }], options: { temperature: 0.4 } }, null);
        if (rev.content && rev.content.length > 20) out = rev.content;
      }
    } catch { /* best effort */ }
  }
  return out;
}

module.exports = { difficulty, fewShotContext, reflexion, deepReason, refine };
