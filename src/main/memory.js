// Умная долговременная память агентов.
// Принципы: храним только важные факты, дедуплицируем, ограничиваем размер,
// старую историю чата сжимаем в краткое резюме — контекст живёт долго,
// но не забивается ненужным.
const store = require('./store');
const ollama = require('./ollama');

const MAX_FACTS = 50;          // максимум фактов на агента
const MAX_CONTEXT_CHARS = 1600; // сколько памяти инжектится в промпт
const COMPACT_AFTER = 16;       // сжимать историю длиннее N сообщений

function keyFor(agentId) { return 'memory.' + agentId; }

function listFacts(agentId) { return store.get(keyFor(agentId), []); }

function clearFacts(agentId) { store.set(keyFor(agentId), []); return { ok: true }; }

function addFact(agentId, text, score = 1) {
  text = String(text || '').trim();
  if (!text || text.length < 6) return;
  const facts = listFacts(agentId);
  const low = text.toLowerCase();
  // Дедупликация: не добавляем то, что уже есть (по вхождению).
  if (facts.some((f) => f.text.toLowerCase() === low || f.text.toLowerCase().includes(low) || low.includes(f.text.toLowerCase()))) return;
  facts.push({ text: text.slice(0, 300), score, at: Date.now() });
  // Переполнение: выбрасываем наименее ценные и самые старые.
  facts.sort((a, b) => (b.score - a.score) || (b.at - a.at));
  store.set(keyFor(agentId), facts.slice(0, MAX_FACTS));
}

// Затухание важности со временем: свежие факты весомее старых, но базовый
// score не даёт совсем забыть важное (период полураспада ~45 дней).
const HALF_LIFE_MS = 45 * 24 * 3600 * 1000;
function decayed(f, now) {
  const age = now - (f.at || now);
  const factor = Math.pow(0.5, age / HALF_LIFE_MS);
  return (f.score || 1) * (0.4 + 0.6 * factor); // не опускаем ниже 40% базовой важности
}

// Блок памяти для системного промпта. Если передан query — подмешиваем
// релевантные факты (кросс-сессионная «вспоминалка») с приоритетом.
function buildContext(agentId, query) {
  const facts = listFacts(agentId);
  if (!facts.length) return '';
  const now = Date.now();
  const qWords = String(query || '').toLowerCase().split(/[^a-zа-я0-9]+/).filter((w) => w.length > 3);
  const ranked = facts.map((f) => {
    let s = decayed(f, now);
    if (qWords.length) {
      const low = f.text.toLowerCase();
      const hits = qWords.filter((w) => low.includes(w)).length;
      if (hits) s += hits * 1.5; // буст за релевантность запросу
    }
    return { f, s };
  }).sort((a, b) => b.s - a.s);

  let out = [];
  let total = 0;
  for (const { f } of ranked) {
    if (total + f.text.length > MAX_CONTEXT_CHARS) break;
    out.push('• ' + f.text);
    total += f.text.length;
  }
  return out.length ? `\n\nДолговременная память (важные факты о пользователе и прошлых задачах):\n${out.join('\n')}` : '';
}

// После диалога просим модель выделить факты, которые стоит помнить долго.
// Запускается в фоне и не блокирует ответ.
async function remember(agentId, model, userMsg, assistantMsg) {
  try {
    const prompt = `Диалог:\nПользователь: ${String(userMsg).slice(0, 800)}\nАссистент: ${String(assistantMsg).slice(0, 800)}\n\nВыдели до 2 КОРОТКИХ фактов, которые стоит помнить ДОЛГОСРОЧНО (предпочтения пользователя, важные пути/серверы/проекты, постоянные договорённости). НЕ включай разовые мелочи, приветствия, погоду, текущие вопросы. Каждый факт с новой строки, без нумерации. Если ничего важного — ответь ровно: NONE`;
    const res = await ollama.chatStream({ model, messages: [{ role: 'user', content: prompt }] }, null);
    const text = (res.content || '').trim();
    if (!text || /^NONE/i.test(text)) return;
    text.split('\n').map((s) => s.replace(/^[-•*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 2)
      .forEach((f) => addFact(agentId, f, 2));
  } catch { /* память — best effort */ }
}

// Сжатие длинной истории: старые сообщения свёртываются в одно резюме,
// свежие остаются как есть.
async function compactHistory(messages, model) {
  if (messages.length <= COMPACT_AFTER) return messages;
  const old = messages.slice(0, messages.length - 8);
  const fresh = messages.slice(-8);
  try {
    const dialog = old.map((m) => (m.role === 'user' ? 'П: ' : 'А: ') + String(m.content).slice(0, 300)).join('\n');
    const res = await ollama.chatStream({
      model,
      messages: [{ role: 'user', content: `Сожми диалог в краткое резюме (до 120 слов), сохранив только важное для продолжения разговора:\n${dialog}` }]
    }, null);
    const summary = (res.content || '').trim();
    if (summary) {
      return [{ role: 'system', content: 'Резюме предыдущей части диалога: ' + summary }, ...fresh];
    }
  } catch { /* при ошибке просто обрезаем */ }
  return fresh;
}

module.exports = { listFacts, clearFacts, addFact, buildContext, remember, compactHistory, COMPACT_AFTER };
