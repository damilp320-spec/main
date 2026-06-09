// Движок автономных агентов: цикл «модель → инструмент → модель».
const { randomUUID } = require('crypto');
const store = require('./store');
const ollama = require('./ollama');
const system = require('./system');
const memory = require('./memory');
const minecraft = require('./minecraft');
const remote = require('./remote');
const translator = require('./translator');

const activeSessions = new Map(); // sessionId -> { stop: bool }

// Полный набор инструментов = базовые + расширения (Minecraft, серверы, перевод).
function allToolSchemas() {
  return [
    ...system.toolSchemas,
    ...minecraft.toolSchemas,
    ...remote.toolSchemas,
    ...translator.toolSchemas
  ];
}

const extraHandlers = { ...minecraft.toolHandlers, ...remote.toolHandlers, ...translator.toolHandlers };

async function dispatchTool(name, args) {
  if (extraHandlers[name]) {
    try { return await extraHandlers[name](args || {}); }
    catch (e) { return `Ошибка инструмента ${name}: ${e.message}`; }
  }
  return system.callTool(name, args);
}

// Готовые шаблоны агентов «из коробки».
const TEMPLATES = [
  {
    id: 'tpl-assistant',
    name: 'Личный ассистент',
    icon: '🧠',
    model: 'qwen2.5:7b',
    autonomy: 'balanced',
    system: 'Ты — личный AI-ассистент на компьютере пользователя с Windows 11. Помогаешь с задачами, ищешь информацию в интернете, управляешь файлами. Используй инструменты, когда это нужно. Отвечай кратко и по-русски.'
  },
  {
    id: 'tpl-automation',
    name: 'Автоматизатор ПК',
    icon: '⚙️',
    model: 'qwen2.5:7b',
    autonomy: 'autonomous',
    system: 'Ты — автономный агент автоматизации Windows 11. Выполняешь задачи через PowerShell, управляешь файлами и приложениями. Действуй пошагово, проверяй результат каждого шага через инструменты. Не выполняй разрушительных операций.'
  },
  {
    id: 'tpl-researcher',
    name: 'Исследователь',
    icon: '🔎',
    model: 'qwen2.5:7b',
    autonomy: 'balanced',
    system: 'Ты — агент-исследователь. Ищешь в интернете информацию, открываешь страницы, собираешь и систематизируешь данные, сохраняешь отчёты в файлы. Всегда указывай источники.'
  },
  {
    id: 'tpl-coder',
    name: 'Программист',
    icon: '💻',
    model: 'qwen2.5-coder:7b',
    autonomy: 'balanced',
    system: 'Ты — агент-программист. Пишешь, читаешь и запускаешь код, создаёшь файлы проектов, выполняешь команды сборки. Объясняй свои действия кратко.'
  },
  {
    id: 'tpl-voice',
    name: 'Голосовой компаньон',
    icon: '🎙️',
    model: 'llama3.2:3b',
    autonomy: 'balanced',
    system: 'Ты — голосовой ассистент. Отвечаешь очень кратко, разговорным языком, без markdown — твои ответы будут озвучены. Используй инструменты при необходимости.'
  },
  {
    id: 'tpl-minecraft',
    name: 'Minecraft-разработчик',
    icon: '🧱',
    model: 'qwen2.5-coder:7b',
    autonomy: 'autonomous',
    system: 'Ты — агент-разработчик плагинов Minecraft (Paper/Spigot). Создавай проекты через mc_create_plugin, правь Java-код через write_file (он лежит в minecraft-plugins/<имя>/src), собирай через mc_compile_plugin и читай логи ошибок, исправляя их итеративно. Пиши корректный код под Bukkit/Paper API.'
  },
  {
    id: 'tpl-devops',
    name: 'Серверный администратор',
    icon: '🖥️',
    model: 'qwen2.5:7b',
    autonomy: 'autonomous',
    system: 'Ты — агент-администратор удалённых серверов. Через инструменты remote_* изучай файловую систему по SSH, читай и правь конфиги, выполняй команды. Действуй осторожно: перед изменением конфига сначала прочитай его. Не выполняй разрушительных операций без явного запроса.'
  },
  {
    id: 'tpl-translator',
    name: 'Переводчик данных',
    icon: '🌐',
    model: 'qwen2.5:7b',
    autonomy: 'balanced',
    system: 'Ты — агент-переводчик. Переводишь большие массивы данных и файлы через translate_file, сохраняя форматирование и плейсхолдеры. Для файлов локализации (JSON/.properties) переводи только значения.'
  }
];

function getTemplates() { return TEMPLATES; }

function listAgents() {
  const saved = store.get('agents', null);
  if (!saved) {
    // Первичная инициализация: материализуем шаблоны как пользовательские агенты.
    const init = TEMPLATES.map((t) => ({ ...t }));
    store.set('agents', init);
    return init;
  }
  return saved;
}

function saveAgent(agent) {
  const list = listAgents();
  const idx = list.findIndex((a) => a.id === agent.id);
  if (idx >= 0) list[idx] = agent;
  else { agent.id = agent.id || 'agent-' + randomUUID().slice(0, 8); list.push(agent); }
  store.set('agents', list);
  return agent;
}

function deleteAgent(id) {
  const list = listAgents().filter((a) => a.id !== id);
  store.set('agents', list);
  return { ok: true };
}

function getHistory() { return store.get('chatHistory', []); }
function clearHistory() { store.set('chatHistory', []); return { ok: true }; }
function pushHistory(entry) {
  const h = getHistory();
  h.push(entry);
  store.set('chatHistory', h.slice(-200));
}

function stopSession(sessionId) {
  const s = activeSessions.get(sessionId);
  if (s) s.stop = true;
  return { ok: true };
}

// Основной агентный цикл с tool-calling.
async function chat({ agentId, sessionId, message, history }, sendToUI) {
  const agent = listAgents().find((a) => a.id === agentId) || TEMPLATES[0];
  sessionId = sessionId || randomUUID();
  const sess = { stop: false };
  activeSessions.set(sessionId, sess);

  const model = agent.model || 'qwen2.5:7b';
  // Инжектируем долговременную память в системный промпт.
  const memCtx = memory.buildContext(agent.id);
  const messages = [{ role: 'system', content: agent.system + memCtx }];
  // Сжимаем длинную историю, чтобы контекст жил долго, но не разрастался.
  let hist = history || [];
  if (hist.length > memory.COMPACT_AFTER) hist = await memory.compactHistory(hist, model);
  hist.forEach((m) => messages.push(m));
  messages.push({ role: 'user', content: message });

  const useTools = agent.autonomy !== 'chat-only';
  const maxSteps = agent.autonomy === 'autonomous' ? 14 : 6;
  let finalText = '';

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (sess.stop) { finalText += '\n[остановлено пользователем]'; break; }

      const res = await ollama.chatStream(
        { model, messages, tools: useTools ? allToolSchemas() : null },
        (chunk) => sendToUI && sendToUI('agents:stream', { sessionId, chunk })
      );

      finalText = res.content;

      if (res.toolCalls && res.toolCalls.length) {
        messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls });
        for (const tc of res.toolCalls) {
          const fname = tc.function && tc.function.name;
          let args = tc.function && tc.function.arguments;
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
          sendToUI && sendToUI('agents:tool', { sessionId, name: fname, args });
          let result = await dispatchTool(fname, args);
          // Спец-обработка уведомлений.
          if (typeof result === 'string' && result.startsWith('__NOTIFY__')) {
            try { sendToUI && sendToUI('agents:notify', JSON.parse(result.slice(10))); } catch {}
            result = 'Уведомление показано.';
          }
          sendToUI && sendToUI('agents:toolResult', { sessionId, name: fname, result: String(result).slice(0, 2000) });
          messages.push({ role: 'tool', content: String(result) });
        }
        continue; // даём модели обработать результаты инструментов
      }
      break; // нет вызовов инструментов — финальный ответ готов
    }
  } catch (e) {
    finalText = 'Ошибка агента: ' + e.message + '\n\nУбедитесь, что Ollama запущена и модель установлена.';
  }

  activeSessions.delete(sessionId);
  pushHistory({ agentId, agentName: agent.name, at: Date.now(), user: message, assistant: finalText });
  sendToUI && sendToUI('agents:done', { sessionId, text: finalText });
  // В фоне выделяем важные факты в долговременную память (не блокирует ответ).
  if (store.get('settings.longMemory', true)) {
    memory.remember(agent.id, model, message, finalText).catch(() => {});
  }
  return { sessionId, text: finalText };
}

// Быстрый вопрос без UI-сессии (используется голосовым ассистентом).
async function quickAsk(text, sendToUI) {
  const voiceAgent = listAgents().find((a) => a.id === 'tpl-voice') || TEMPLATES[4];
  const r = await chat({ agentId: voiceAgent.id, message: text, history: [] }, sendToUI);
  return r.text;
}

// Запуск задачи планировщика через агента.
async function runScheduledTask(task, sendToUI) {
  const agentId = task.agentId || 'tpl-assistant';
  const r = await chat({ agentId, message: task.prompt, history: [] }, sendToUI);
  return r.text;
}

module.exports = {
  getTemplates, listAgents, saveAgent, deleteAgent,
  getHistory, clearHistory, stopSession,
  chat, quickAsk, runScheduledTask
};
