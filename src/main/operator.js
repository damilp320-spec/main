// «Оператор ПК» (computer-use): автономный контур ВИЖУ → РЕШАЮ → ДЕЙСТВУЮ →
// ПРОВЕРЯЮ. Объединяет компьютерное зрение (скриншот), управление мышью/
// клавиатурой (gui) и встроенный браузер (web) в один цикл. На каждом шаге
// агент получает свежий кадр экрана и решает следующее действие.
//
// Требует мультимодальную модель (llava/qwen-vl и т.п.), иначе «видеть» не сможет.
// Включается настройкой settings.operator и работает поверх gui/web автоматизации.
const ollama = require('./ollama');
const store = require('./store');
const screen = require('./screen');
const gui = require('./gui');
const webagent = require('./webagent');
const modelrouter = require('./modelrouter');

const sessions = new Map(); // sessionId -> { stop }

// Набор действий, который мы даём модели (подмножество, специфичное для оператора).
function actionTools() {
  return [
    ...gui.toolSchemas,
    ...(store.get('settings.webAutomation', false) ? webagent.toolSchemas : []),
    { type: 'function', function: { name: 'task_done', description: 'Вызови, когда цель ДОСТИГНУТА. Кратко опиши итог в summary.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
    { type: 'function', function: { name: 'wait', description: 'Подождать N секунд (например, пока загрузится окно).', parameters: { type: 'object', properties: { seconds: { type: 'number' } } } } }
  ];
}

const SYSTEM = `Ты — «Оператор ПК»: автономный агент, который управляет компьютером, ГЛЯДЯ на экран.
Принцип работы на каждом шаге:
1) ПОСМОТРИ на приложенный свежий скриншот экрана.
2) Реши ОДНО следующее действие, ведущее к цели.
3) Выполни его через инструмент: gui_click(x,y) / gui_move / gui_type(text) / gui_key(key) и (если доступно) web_goto/web_click/web_type.
4) Координаты бери из того, что РЕАЛЬНО видишь на скриншоте (в пикселях). Не выдумывай элементы, которых нет.
Правила: действуй маленькими шагами, по одному действию за раз; после действия ты получишь новый скриншот и оценишь результат. Когда цель достигнута — вызови task_done с кратким итогом. Если застрял или цель невозможна — тоже вызови task_done и честно объясни.`;

async function run({ sessionId, goal, maxSteps }, sendToUI) {
  sessionId = sessionId || ('op-' + Date.now());
  const sess = { stop: false };
  sessions.set(sessionId, sess);
  const emit = (ev, payload) => sendToUI && sendToUI(ev, { sessionId, ...payload });

  if (!store.get('settings.operator', false)) { emit('operator:done', { ok: false, error: 'Режим «Оператор ПК» выключен в настройках.' }); sessions.delete(sessionId); return { ok: false }; }

  const fallback = store.get('settings.defaultModel', '') || 'qwen2.5:7b';
  let model = await modelrouter.pick('vision', fallback);
  const hasVision = await modelrouter.hasVision();
  if (!hasVision) emit('operator:warn', { message: 'Нет мультимодальной модели — оператор работает «вслепую». Установите llava или qwen2.5-vl для зрения.' });

  const tools = actionTools();
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Цель: ' + goal }];
  const budget = Math.min(40, Math.max(3, parseInt(maxSteps, 10) || 15));
  let summary = '';

  try {
    for (let step = 0; step < budget; step++) {
      if (sess.stop) { summary = '[остановлено пользователем]'; break; }
      // 1) ВИЖУ — свежий кадр экрана.
      let shot;
      try { shot = await screen.capture(); }
      catch (e) { emit('operator:warn', { message: 'Скриншот не удался: ' + e.message }); shot = null; }
      if (shot && shot.base64) {
        emit('operator:frame', { step, width: shot.width, height: shot.height });
        messages.push({ role: 'user', content: `Шаг ${step + 1}. Текущий экран${shot.width ? ` (${shot.width}×${shot.height})` : ''}:`, images: [shot.base64] });
        // Держим контекст компактным: оставляем не больше 3 последних изображений.
        trimImages(messages, 3);
      }

      // 2) РЕШАЮ — модель выбирает действие.
      const res = await ollama.chatStream({ model, messages, tools, options: { temperature: 0.2 } },
        (chunk) => emit('operator:think', { chunk }));
      messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls || [] });

      if (!res.toolCalls || !res.toolCalls.length) {
        // Нет действия — считаем рассуждение финальным.
        summary = res.content || 'Готово.';
        break;
      }

      // 3) ДЕЙСТВУЮ.
      let finished = false;
      for (const tc of res.toolCalls) {
        const name = tc.function && tc.function.name;
        let args = tc.function && tc.function.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        emit('operator:action', { step, name, args });

        if (name === 'task_done') { summary = (args && args.summary) || 'Цель достигнута.'; finished = true; break; }
        if (name === 'wait') { await new Promise((r) => setTimeout(r, Math.min(8000, ((args && args.seconds) || 1) * 1000))); messages.push({ role: 'tool', content: 'Подождал.' }); continue; }

        let result;
        try {
          if (gui.toolHandlers[name]) result = await gui.toolHandlers[name](args || {});
          else if (webagent.toolHandlers[name]) result = await webagent.toolHandlers[name](args || {});
          else result = 'Неизвестное действие: ' + name;
        } catch (e) { result = 'ОШИБКА: ' + e.message; }
        emit('operator:result', { step, name, result: String(result).slice(0, 300) });
        messages.push({ role: 'tool', content: String(result) });
      }
      if (finished) break;
      await new Promise((r) => setTimeout(r, 400)); // дать UI/ОС отрисоваться перед новым кадром
    }
  } catch (e) {
    summary = 'Ошибка оператора: ' + e.message;
  }

  sessions.delete(sessionId);
  emit('operator:done', { ok: true, summary });
  return { ok: true, summary };
}

// Оставляем только N последних сообщений с изображениями (экономия контекста).
function trimImages(messages, keep) {
  const idxs = [];
  messages.forEach((m, i) => { if (m.images && m.images.length) idxs.push(i); });
  const drop = idxs.slice(0, Math.max(0, idxs.length - keep));
  for (const i of drop) { delete messages[i].images; messages[i].content = '(прошлый экран — скрыт для экономии)'; }
}

function stop(sessionId) { const s = sessions.get(sessionId); if (s) s.stop = true; return { ok: true }; }

module.exports = { run, stop };
