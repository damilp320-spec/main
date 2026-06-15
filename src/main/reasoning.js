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

// Few-shot из прошлых УСПЕШНЫХ и положительно оценённых диалогов.
function fewShotContext(agentId, message) {
  if (!store.get('settings.learnFromHistory', false)) return '';
  const hist = store.get('chatHistory', []).filter((h) => h.agentId === agentId && h.user && h.assistant && !/ошибк|не удалось|error|failed/i.test(h.assistant));
  if (!hist.length) return '';
  const words = String(message || '').toLowerCase().split(/[^a-zа-я0-9]+/).filter((w) => w.length > 3);
  if (!words.length) return '';
  const scored = hist.map((h) => { const t = (h.user + ' ' + h.assistant).toLowerCase(); return { h, s: words.filter((w) => t.includes(w)).length }; })
    .filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 2);
  if (!scored.length) return '';
  return '\n\nПримеры, как ты УСПЕШНО решал похожие запросы ранее (учись на своём опыте, но не копируй слепо):\n' +
    scored.map((x) => `• Запрос: ${String(x.h.user).slice(0, 180)}\n  Хороший ответ: ${String(x.h.assistant).slice(0, 280)}`).join('\n');
}

// Уточнение финального ответа: self-consistency + критик-модель.
async function refine({ messages, model, finalText, effort, sendToUI, sessionId }) {
  let out = finalText;
  if (!out || out.length < 30) return out;

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

  // Критик-модель (второе мнение) — для thorough/max.
  const critic = store.get('settings.criticModel', '');
  if (critic && (effort === 'thorough' || effort === 'max')) {
    try {
      const userMsg = [...messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
      const cr = await ollama.chatStream({ model: critic, messages: [
        { role: 'system', content: 'Ты — строгий рецензент. Найди ФАКТИЧЕСКИЕ ошибки, неточности и упущения в ответе на запрос. Если ответ верный и полный — напиши ровно «ОК». Иначе кратко перечисли проблемы.' },
        { role: 'user', content: `Запрос: ${userMsg ? String(userMsg.content).slice(0, 800) : ''}\n\nОтвет: ${String(out).slice(0, 1500)}` }
      ], options: { temperature: 0.2 } }, null);
      const crit = (cr.content || '').trim();
      if (crit && !/^\s*(ок|ok)\b/i.test(crit)) {
        sendToUI && sendToUI('agents:reason', { sessionId, note: 'критик: ' + crit.slice(0, 140) });
        const rev = await ollama.chatStream({ model, messages: [...messages, { role: 'assistant', content: out }, { role: 'user', content: 'Независимый рецензент отметил: ' + crit + '\nУчти замечания и дай улучшенный ОКОНЧАТЕЛЬНЫЙ ответ (без предисловий).' }], options: { temperature: 0.4 } }, null);
        if (rev.content && rev.content.length > 20) out = rev.content;
      }
    } catch { /* best effort */ }
  }
  return out;
}

module.exports = { difficulty, fewShotContext, refine };
