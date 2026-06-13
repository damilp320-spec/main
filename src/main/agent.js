// Движок автономных агентов: цикл «модель → инструмент → модель».
const { randomUUID } = require('crypto');
const store = require('./store');
const ollama = require('./ollama');
const system = require('./system');
const memory = require('./memory');
const minecraft = require('./minecraft');
const remote = require('./remote');
const translator = require('./translator');
const skills = require('./skills');
const rag = require('./rag');
const screen = require('./screen');
const browser = require('./browser');
const audio = require('./audio');
const smarthome = require('./smarthome');
const constitution = require('./constitution');
const appcontrol = require('./appcontrol');

const activeSessions = new Map(); // sessionId -> { stop: bool }

// Инструмент компьютерного зрения — захват скриншота для UI-агентов.
const visionToolSchema = {
  type: 'function',
  function: { name: 'take_screenshot', description: 'Сделать скриншот экрана, чтобы УВИДЕТЬ, что сейчас на экране (для мультимодальных моделей).', parameters: { type: 'object', properties: {} } }
};

// Полный набор инструментов = базовые + расширения + скилы + зрение.
function allToolSchemas() {
  const disabled = store.get('settings.disabledTools', []);
  const all = [
    ...system.toolSchemas,
    ...minecraft.toolSchemas,
    ...remote.toolSchemas,
    ...translator.toolSchemas,
    ...browser.toolSchemas,
    ...audio.toolSchemas,
    ...smarthome.toolSchemas,
    ...(store.get('settings.appControl', true) ? appcontrol.toolSchemas : []),
    ...skills.toolSchemas(),
    visionToolSchema
  ];
  // «Полный контроль»: можно отключать отдельные инструменты.
  return disabled.length ? all.filter((t) => !disabled.includes(t.function.name)) : all;
}

const extraHandlers = { ...minecraft.toolHandlers, ...remote.toolHandlers, ...translator.toolHandlers, ...browser.toolHandlers, ...audio.toolHandlers, ...smarthome.toolHandlers, ...appcontrol.toolHandlers };

async function dispatchTool(name, args) {
  if (skills.isSkillTool(name)) {
    try { return await skills.runSkill(name, args || {}); }
    catch (e) { return `Ошибка скила ${name}: ${e.message}`; }
  }
  if (extraHandlers[name]) {
    try { return await extraHandlers[name](args || {}); }
    catch (e) { return `Ошибка инструмента ${name}: ${e.message}`; }
  }
  return system.callTool(name, args);
}

// Агенты, создаваемые при первом запуске.
const DEFAULT_AGENTS = [
  { id: 'tpl-assistant', name: 'Личный ассистент', icon: '🧠', model: 'qwen2.5:7b', autonomy: 'balanced', system: 'Ты — личный AI-ассистент на компьютере пользователя с Windows 11. Помогаешь с задачами, ищешь информацию в интернете, управляешь файлами. Используй инструменты, когда это нужно. Отвечай кратко и по-русски.' },
  { id: 'tpl-automation', name: 'Автоматизатор ПК', icon: '⚙️', model: 'qwen2.5:7b', autonomy: 'autonomous', system: 'Ты — автономный агент автоматизации Windows 11. Выполняешь задачи через PowerShell, управляешь файлами и приложениями. Действуй пошагово, проверяй результат каждого шага. Не выполняй разрушительных операций.' },
  { id: 'tpl-researcher', name: 'Исследователь', icon: '🔎', model: 'qwen2.5:7b', autonomy: 'balanced', system: 'Ты — агент-исследователь. Ищешь в интернете информацию, открываешь страницы, собираешь и систематизируешь данные, сохраняешь отчёты в файлы. Всегда указывай источники.' },
  { id: 'tpl-coder', name: 'Программист', icon: '💻', model: 'qwen2.5-coder:7b', autonomy: 'balanced', system: 'Ты — агент-программист. Пишешь, читаешь и запускаешь код, создаёшь файлы проектов, выполняешь команды сборки. Объясняй свои действия кратко.' },
  { id: 'tpl-voice', name: 'Голосовой компаньон', icon: '🎙️', model: 'llama3.2:3b', autonomy: 'balanced', system: 'Ты — голосовой ассистент. Отвечаешь очень кратко, разговорным языком, без markdown — твои ответы будут озвучены. Используй инструменты при необходимости.' }
];

// Большая галерея шаблонов (каталог), которые можно добавить в один клик.
const TEMPLATES = [
  // — Продуктивность —
  { id: 'tpl-assistant', cat: 'Продуктивность', name: 'Личный ассистент', icon: '🧠', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Универсальный помощник на каждый день.', system: 'Ты — личный AI-ассистент на Windows 11. Помогаешь с задачами, ищешь информацию, управляешь файлами. Отвечай кратко и по-русски.' },
  { id: 'tpl-planner', cat: 'Продуктивность', name: 'Планировщик дня', icon: '📅', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Составляет планы, расставляет приоритеты.', system: 'Ты — коуч по продуктивности. Помогаешь составить план дня/недели, расставить приоритеты по матрице Эйзенхауэра, разбить большие задачи на шаги. Будь конкретным и мотивирующим.' },
  { id: 'tpl-email', cat: 'Продуктивность', name: 'Помощник по письмам', icon: '✉️', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Пишет и улучшает деловые письма.', system: 'Ты — помощник по деловой переписке. Пишешь, сокращаешь и улучшаешь письма, подбираешь тон. Предлагай 2-3 варианта.' },
  { id: 'tpl-notes', cat: 'Продуктивность', name: 'Конспектор', icon: '📝', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Делает конспекты и саммари из файлов.', system: 'Ты — агент-конспектор. Читаешь документы из рабочего пространства и делаешь структурированные конспекты, выделяешь главное, формируешь чек-листы. Сохраняй результат в файл.' },
  { id: 'tpl-meeting', cat: 'Продуктивность', name: 'Секретарь встреч', icon: '🗒️', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Протоколы, решения, задачи из заметок.', system: 'Ты — секретарь. Из текста встречи выделяешь решения, ответственных и задачи с дедлайнами. Формируешь аккуратный протокол.' },

  // — Разработка —
  { id: 'tpl-coder', cat: 'Разработка', name: 'Программист', icon: '💻', model: 'qwen2.5-coder:7b', autonomy: 'balanced', desc: 'Пишет, читает и запускает код.', system: 'Ты — агент-программист. Пишешь, читаешь и запускаешь код, создаёшь файлы проектов, выполняешь сборку. Объясняй кратко.' },
  { id: 'tpl-minecraft', cat: 'Разработка', name: 'Minecraft-разработчик', icon: '🧱', model: 'qwen2.5-coder:7b', autonomy: 'autonomous', desc: 'Создаёт и компилирует плагины Paper/Spigot.', system: 'Ты — разработчик плагинов Minecraft (Paper/Spigot). Создавай проекты через mc_create_plugin, правь Java через write_file, собирай mc_compile_plugin и исправляй ошибки по логам. Пиши корректный код под Bukkit/Paper API.' },
  { id: 'tpl-devops', cat: 'Разработка', name: 'Серверный администратор', icon: '🖥️', model: 'qwen2.5:7b', autonomy: 'autonomous', desc: 'SSH, конфиги, команды на серверах.', system: 'Ты — администратор удалённых серверов. Через remote_* изучаешь ФС по SSH, читаешь и правишь конфиги, выполняешь команды. Перед изменением конфига читай его. Без разрушительных операций.' },
  { id: 'tpl-reviewer', cat: 'Разработка', name: 'Ревьюер кода', icon: '🔬', model: 'qwen2.5-coder:7b', autonomy: 'balanced', desc: 'Находит баги и предлагает улучшения.', system: 'Ты — ревьюер кода. Читаешь файлы и ищешь баги, уязвимости, нарушения стиля. Предлагаешь конкретные правки с пояснением.' },
  { id: 'tpl-debug', cat: 'Разработка', name: 'Отладчик', icon: '🐞', model: 'qwen2.5-coder:7b', autonomy: 'autonomous', desc: 'Воспроизводит и чинит ошибки.', system: 'Ты — агент-отладчик. Запускаешь код/тесты, читаешь ошибки, выдвигаешь гипотезы и проверяешь их, пока не починишь. Объясняй причину бага.' },
  { id: 'tpl-sql', cat: 'Разработка', name: 'SQL-аналитик', icon: '🗄️', model: 'qwen2.5-coder:7b', autonomy: 'balanced', desc: 'Пишет и объясняет SQL-запросы.', system: 'Ты — эксперт по SQL. Пишешь, оптимизируешь и объясняешь запросы для разных СУБД. Предупреждай об опасных операциях.' },
  { id: 'tpl-regex', cat: 'Разработка', name: 'Мастер regex', icon: '🔣', model: 'qwen2.5-coder:7b', autonomy: 'chat-only', desc: 'Строит и объясняет регулярные выражения.', system: 'Ты — мастер регулярных выражений. Строишь regex по описанию, объясняешь каждую часть и приводишь примеры совпадений.' },

  // — Система —
  { id: 'tpl-automation', cat: 'Система', name: 'Автоматизатор ПК', icon: '⚙️', model: 'qwen2.5:7b', autonomy: 'autonomous', desc: 'Рутина через PowerShell и файлы.', system: 'Ты — агент автоматизации Windows 11. Выполняешь задачи через PowerShell, управляешь файлами и приложениями. Действуй пошагово, проверяй результат. Без разрушительных операций.' },
  { id: 'tpl-cleaner', cat: 'Система', name: 'Уборщик диска', icon: '🧹', model: 'qwen2.5:7b', autonomy: 'autonomous', desc: 'Находит мусор и освобождает место.', system: 'Ты — агент по обслуживанию ПК. Анализируешь, что занимает место, находишь временные/дублирующиеся файлы и предлагаешь безопасную очистку. Перед удалением всегда подтверждай.' },
  { id: 'tpl-organizer', cat: 'Система', name: 'Файловый куратор', icon: '🗂️', model: 'qwen2.5:7b', autonomy: 'autonomous', desc: 'Раскладывает файлы по папкам.', system: 'Ты — агент-органайзер файлов. Сортируешь файлы по типам/датам, переименовываешь по шаблону, наводишь порядок в папках рабочего пространства.' },
  { id: 'tpl-monitor', cat: 'Система', name: 'Монитор системы', icon: '📊', model: 'llama3.2:3b', autonomy: 'balanced', desc: 'Следит за нагрузкой и здоровьем ПК.', system: 'Ты — агент мониторинга. Показываешь загрузку CPU/RAM/диска, выявляешь проблемы и даёшь рекомендации простым языком.' },
  { id: 'tpl-backup', cat: 'Система', name: 'Бэкап-агент', icon: '💾', model: 'qwen2.5:7b', autonomy: 'autonomous', desc: 'Создаёт архивы важных папок.', system: 'Ты — агент резервного копирования. Архивируешь указанные папки с датой в имени, проверяешь целостность, ведёшь журнал бэкапов.' },

  // — Контент и данные —
  { id: 'tpl-translator', cat: 'Контент', name: 'Переводчик данных', icon: '🌐', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Переводит файлы и большие тексты.', system: 'Ты — переводчик. Переводишь большие данные и файлы через translate_file, сохраняя форматирование и плейсхолдеры. В локализациях переводишь только значения.' },
  { id: 'tpl-researcher', cat: 'Контент', name: 'Исследователь', icon: '🔎', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Собирает и систематизирует данные из сети.', system: 'Ты — агент-исследователь. Ищешь в интернете, открываешь страницы, систематизируешь данные и сохраняешь отчёты. Указывай источники.' },
  { id: 'tpl-copywriter', cat: 'Контент', name: 'Копирайтер', icon: '✍️', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Тексты, посты, заголовки.', system: 'Ты — копирайтер. Пишешь цепляющие тексты, посты и заголовки под аудиторию и площадку. Предлагай варианты и объясняй выбор.' },
  { id: 'tpl-summary', cat: 'Контент', name: 'Суммаризатор', icon: '📄', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Кратко пересказывает длинные тексты.', system: 'Ты — агент-суммаризатор. Делаешь краткие и точные пересказы длинных текстов и файлов, сохраняя ключевые факты и цифры.' },
  { id: 'tpl-seo', cat: 'Контент', name: 'SEO-специалист', icon: '🔍', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Ключевые слова и оптимизация текста.', system: 'Ты — SEO-специалист. Подбираешь ключевые слова, улучшаешь тексты под поиск, формируешь мета-описания. Учитывай естественность текста.' },
  { id: 'tpl-data', cat: 'Контент', name: 'Аналитик данных', icon: '📈', model: 'qwen2.5-coder:7b', autonomy: 'autonomous', desc: 'Разбирает CSV/JSON, считает метрики.', system: 'Ты — аналитик данных. Читаешь CSV/JSON из рабочего пространства, считаешь статистику, находишь закономерности и сохраняешь выводы. При необходимости пишешь скрипты.' },

  // — Творчество —
  { id: 'tpl-brainstorm', cat: 'Творчество', name: 'Генератор идей', icon: '💡', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Мозговой штурм без границ.', system: 'Ты — генератор идей. Проводишь мозговой штурм, предлагаешь смелые и нестандартные идеи, развиваешь мысли пользователя. Не критикуй на этапе генерации.' },
  { id: 'tpl-story', cat: 'Творчество', name: 'Писатель историй', icon: '📖', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Сюжеты, персонажи, тексты.', system: 'Ты — писатель. Сочиняешь увлекательные истории, прорабатываешь персонажей и сюжет. Пишешь живым языком, поддерживаешь выбранный жанр.' },
  { id: 'tpl-gamemaster', cat: 'Творчество', name: 'Гейм-мастер', icon: '🎲', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Ведёт текстовые ролевые приключения.', system: 'Ты — гейм-мастер текстовой RPG. Описываешь мир, ведёшь приключение, реагируешь на действия игрока и бросаешь «кубики». Поддерживай интригу.' },
  { id: 'tpl-poet', cat: 'Творчество', name: 'Поэт', icon: '🎭', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Стихи, рифмы, поздравления.', system: 'Ты — поэт. Сочиняешь стихи, рифмованные поздравления и тексты под настроение и повод. Соблюдай размер и рифму.' },

  // — Образование —
  { id: 'tpl-tutor', cat: 'Образование', name: 'Репетитор', icon: '🎓', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Объясняет темы простым языком.', system: 'Ты — терпеливый репетитор. Объясняешь сложные темы простыми словами и примерами, проверяешь понимание вопросами, подстраиваешься под уровень.' },
  { id: 'tpl-lang', cat: 'Образование', name: 'Языковой партнёр', icon: '🗣️', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Практика иностранного языка.', system: 'Ты — партнёр для изучения языков. Ведёшь диалог на выбранном языке по уровню пользователя, мягко исправляешь ошибки и поясняешь.' },
  { id: 'tpl-exam', cat: 'Образование', name: 'Экзаменатор', icon: '📚', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Готовит к экзаменам, задаёт вопросы.', system: 'Ты — экзаменатор. Готовишь к экзамену по теме: задаёшь вопросы разной сложности, проверяешь ответы, объясняешь ошибки и даёшь итоговую оценку.' },

  // — Бизнес и дом —
  { id: 'tpl-finance', cat: 'Бизнес', name: 'Финансовый помощник', icon: '💰', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Бюджет, расходы, расчёты.', system: 'Ты — помощник по личным финансам. Помогаешь вести бюджет, считать расходы и накопления, давать общие советы. Не даёшь инвестиционных гарантий.' },
  { id: 'tpl-startup', cat: 'Бизнес', name: 'Бизнес-консультант', icon: '🚀', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Идеи, модели, стратегия.', system: 'Ты — бизнес-консультант. Помогаешь продумать бизнес-модель, MVP, стратегию выхода на рынок и монетизацию. Мысли структурно и критично.' },
  { id: 'tpl-chef', cat: 'Дом и жизнь', name: 'Шеф-повар', icon: '🍳', model: 'llama3.2:3b', autonomy: 'chat-only', desc: 'Рецепты из того, что есть.', system: 'Ты — шеф-повар. Предлагаешь рецепты из доступных продуктов, учитываешь время и ограничения, даёшь пошаговые инструкции.' },
  { id: 'tpl-fitness', cat: 'Дом и жизнь', name: 'Фитнес-тренер', icon: '🏋️', model: 'qwen2.5:7b', autonomy: 'chat-only', desc: 'Тренировки и режим.', system: 'Ты — фитнес-тренер. Составляешь программы тренировок и питания под цель и уровень. Напоминай о консультации с врачом при необходимости.' },
  { id: 'tpl-travel', cat: 'Дом и жизнь', name: 'Тревел-планировщик', icon: '✈️', model: 'qwen2.5:7b', autonomy: 'balanced', desc: 'Маршруты и идеи для поездок.', system: 'Ты — тревел-планировщик. Составляешь маршруты, ищешь идеи и достопримечательности, учитываешь бюджет и сроки. Сохраняй план в файл.' }
];

function getTemplates() { return TEMPLATES; }

function listAgents() {
  const saved = store.get('agents', null);
  if (!saved) {
    // Первичная инициализация: материализуем базовый набор агентов.
    const init = DEFAULT_AGENTS.map((t) => ({ ...t }));
    store.set('agents', init);
    return init;
  }
  return saved;
}

// Добавить агента из шаблона галереи (с новым уникальным id).
function addFromTemplate(templateId) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) return { ok: false, error: 'Шаблон не найден' };
  const agent = { id: 'agent-' + randomUUID().slice(0, 8), name: t.name, icon: t.icon, model: t.model, autonomy: t.autonomy, system: t.system };
  const list = listAgents();
  list.push(agent);
  store.set('agents', list);
  return { ok: true, agent };
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

// Экспорт агента в переносимый объект (для обмена .json).
function exportAgent(id) {
  const a = listAgents().find((x) => x.id === id);
  if (!a) return null;
  return { _type: 'mythera-agent', version: 1, name: a.name, icon: a.icon, model: a.model, autonomy: a.autonomy, system: a.system };
}

// Импорт агента из объекта (создаёт нового с новым id).
function importAgent(obj) {
  if (!obj || obj._type !== 'mythera-agent' && obj._type !== 'nexus-agent') return { ok: false, error: 'Это не файл агента Nexus' };
  const agent = {
    id: 'agent-' + randomUUID().slice(0, 8),
    name: (obj.name || 'Импортированный агент').slice(0, 60),
    icon: obj.icon || '🤖',
    model: obj.model || 'qwen2.5:7b',
    autonomy: ['chat-only', 'balanced', 'autonomous'].includes(obj.autonomy) ? obj.autonomy : 'balanced',
    system: String(obj.system || '').slice(0, 4000)
  };
  saveAgent(agent);
  return { ok: true, agent };
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

// Глобальная директива поведения для ВСЕХ агентов: честность о результатах
// инструментов (главная причина «вранья» про созданные файлы/папки) и проактивность.
const HONESTY = `\n\n[Важные правила]\n` +
  `1. ЧЕСТНОСТЬ: никогда не утверждай, что действие выполнено, если соответствующий инструмент не вернул подтверждение (OK/путь). Если инструмент вернул «ОШИБКА» — честно сообщи это пользователю и НЕ выдавай за успех.\n` +
  `2. ФАЙЛЫ И ПАПКИ: чтобы создать файл — используй write_file, чтобы папку — create_directory. Реальные пути узнавай через user_paths. Для рабочего стола используй «Рабочий стол/имя». Если путь не указан — создавай в рабочем пространстве и ЯВНО назови итоговый путь.\n` +
  `3. КОД: можешь создавать .py и другие файлы через write_file и запускать их через run_python.\n` +
  `4. ИНИЦИАТИВА: если видишь лучший вариант или риск — предложи его пользователю до выполнения.`;

// Директивы уровня усилий (как «effort» у Claude).
const EFFORT = {
  fast: { steps: 4, temp: 0.4, note: '\n[Режим: быстро] Отвечай кратко и по делу, минимум шагов.' },
  balanced: { steps: null, temp: null, note: '' },
  thorough: { steps: 60, temp: 0.7, note: '\n[Режим: тщательно] Думай пошагово, проверяй промежуточные результаты, не торопись.' },
  max: { steps: 100, temp: 0.7, note: '\n[Режим: максимум] Доводи задачу до конца, перепроверяй каждый шаг несколько раз, не останавливайся, пока цель не достигнута и проверена.' }
};

// Основной агентный цикл с tool-calling.
async function chat({ agentId, sessionId, message, history, effort }, sendToUI) {
  const agent = listAgents().find((a) => a.id === agentId) || TEMPLATES[0];
  sessionId = sessionId || randomUUID();
  const sess = { stop: false };
  activeSessions.set(sessionId, sess);

  const model = agent.model || store.get('settings.defaultModel', '') || 'qwen2.5:7b';
  const eff = EFFORT[effort] || EFFORT.balanced;
  // Инжектируем долговременную память (факты) + RAG-знания под конкретный запрос.
  const memCtx = memory.buildContext(agent.id);
  let ragCtx = '';
  try { ragCtx = await rag.buildContext(agent.id, message); } catch { /* RAG best effort */ }
  const messages = [{ role: 'system', content: agent.system + constitution.build() + HONESTY + eff.note + memCtx + ragCtx }];
  // Сжимаем длинную историю, чтобы контекст жил долго, но не разрастался.
  let hist = history || [];
  if (hist.length > memory.COMPACT_AFTER) hist = await memory.compactHistory(hist, model);
  hist.forEach((m) => messages.push(m));
  messages.push({ role: 'user', content: message });

  const useTools = agent.autonomy !== 'chat-only';
  // Многошаговые задачи: база 40 шагов в автономном режиме; effort и настройки переопределяют.
  const baseSteps = agent.autonomy === 'autonomous' ? 40 : 8;
  const override = parseInt(store.get('settings.maxSteps', 0), 10);
  const maxSteps = Math.min(100, override > 0 ? override : (eff.steps || baseSteps));
  const temperature = eff.temp != null ? eff.temp : store.get('settings.temperature', 0.7);
  const options = { temperature: typeof temperature === 'number' ? temperature : 0.7 };
  // Режим «полного контроля»: профи задают сырые параметры Ollama.
  const adv = store.get('settings.advanced', {}) || {};
  if (store.get('settings.fullControl', false)) {
    for (const k of ['top_p', 'top_k', 'num_ctx', 'repeat_penalty', 'seed', 'num_predict', 'min_p', 'tfs_z', 'mirostat']) {
      if (adv[k] !== undefined && adv[k] !== null && adv[k] !== '') options[k] = +adv[k];
    }
    if (adv.stop) options.stop = String(adv.stop).split(',').map((s) => s.trim()).filter(Boolean);
  }
  let finalText = '';

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (sess.stop) { finalText += '\n[остановлено пользователем]'; break; }

      const res = await ollama.chatStream(
        { model, messages, tools: useTools ? allToolSchemas() : null, options },
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

          // Компьютерное зрение: захват экрана и передача кадра модели.
          if (fname === 'take_screenshot') {
            try {
              const shot = await screen.capture();
              sendToUI && sendToUI('agents:toolResult', { sessionId, name: fname, result: 'Скриншот сделан' + (shot.file ? ': ' + shot.file : '') });
              messages.push({ role: 'tool', content: 'Скриншот экрана получен и прикреплён ниже.' });
              messages.push({ role: 'user', content: 'Вот текущий экран:', images: [shot.base64] });
            } catch (e) {
              messages.push({ role: 'tool', content: 'Не удалось сделать скриншот: ' + e.message });
            }
            continue;
          }

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
  getTemplates, listAgents, saveAgent, deleteAgent, exportAgent, importAgent, addFromTemplate,
  getHistory, clearHistory, stopSession,
  chat, quickAsk, runScheduledTask
};
