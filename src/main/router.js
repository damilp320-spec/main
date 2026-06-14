// Маршрутизатор инструментов: вместо того чтобы вываливать модели все 40+
// инструментов сразу (что путает небольшие локальные модели и раздувает
// контекст), мы выбираем релевантное подмножество под конкретный запрос и роль
// агента. Это ощутимо повышает точность вызова инструментов на 7–14B моделях.
//
// Подход без новых зависимостей: ключевые слова + «бандлы» инструментов + роль.

// Инструменты, полезные почти всегда (ядро): остаются доступны при любом запросе.
const CORE = ['user_paths', 'list_dir', 'read_file', 'write_file', 'web_search', 'run_command'];

// Тематические бандлы: набор инструментов + слова-триггеры (рус/eng).
const BUNDLES = [
  { name: 'code', tools: ['run_python', 'run_command', 'read_file', 'write_file', 'create_directory', 'list_dir'],
    kw: ['код', 'програм', 'скрипт', 'функци', 'питон', 'python', 'java', 'node', 'npm', 'pytest', 'тест', 'компил', 'сборк', 'build', 'debug', 'багов', 'баг', 'ошибк', 'class', 'функция', 'репозитор', 'git'] },
  { name: 'files', tools: ['read_file', 'write_file', 'create_directory', 'list_dir', 'user_paths', 'open_app'],
    kw: ['файл', 'папк', 'директор', 'сохрани', 'создай', 'удали', 'переименуй', 'file', 'folder', 'directory', 'рабочий стол', 'desktop', 'документ'] },
  { name: 'web', tools: ['web_search', 'http_get', 'open_url', 'open_website', 'web_search_open'],
    kw: ['найди', 'поищи', 'интернет', 'сайт', 'ссылк', 'url', 'web', 'search', 'google', 'открой стран', 'новост', 'погод', 'курс'] },
  { name: 'system', tools: ['run_command', 'system_info', 'open_app', 'notify', 'user_paths'],
    kw: ['систем', 'процесс', 'powershell', 'команд', 'запусти', 'приложени', 'программу', 'диск', 'память', 'cpu', 'ram', 'уведомлени', 'notify'] },
  { name: 'media', tools: ['play_music', 'set_volume', 'change_volume', 'mute_audio', 'get_volume', 'open_website'],
    kw: ['музык', 'песн', 'трек', 'громкост', 'звук', 'volume', 'play', 'music', 'spotify', 'youtube', 'видео', 'плеер'] },
  { name: 'smarthome', tools: ['smart_home', 'smart_home_list'],
    kw: ['умный дом', 'свет', 'лампа', 'розетк', 'термостат', 'устройств', 'smart', 'light', 'device', 'выключи свет', 'включи свет'] },
  { name: 'minecraft', tools: ['mc_create_plugin', 'mc_compile_plugin', 'mc_list_plugins', 'mc_create_mod', 'mc_compile_mod'],
    kw: ['minecraft', 'майнкрафт', 'плагин', 'paper', 'spigot', 'bukkit', 'forge', 'fabric', 'мод '] },
  { name: 'remote', tools: ['remote_list', 'remote_ls', 'remote_read', 'remote_write', 'remote_exec'],
    kw: ['сервер', 'ssh', 'удалён', 'remote', 'конфиг сервера', 'деплой', 'vps'] },
  { name: 'translate', tools: ['translate_file'],
    kw: ['перевед', 'перевод', 'translate', 'локализ'] },
  { name: 'vision', tools: ['take_screenshot'],
    kw: ['экран', 'скриншот', 'screenshot', 'что на экране', 'покажи экран', 'посмотри', 'see screen', 'увидь'] },
  { name: 'appcontrol', tools: ['create_skill', 'create_agent', 'queue_task', 'remember_knowledge', 'app_set_setting', 'app_open', 'app_state'],
    kw: ['скил', 'плагин', 'создай агента', 'очеред', 'запомни', 'настройк приложени', 'открой раздел', 'skill', 'queue', 'remember'] },
  { name: 'web-automation', tools: ['web_goto', 'web_read', 'web_click', 'web_type', 'web_screenshot', 'web_back'],
    kw: ['зайди на', 'кликни', 'нажми кнопк', 'заполни форм', 'браузер', 'browse', 'navigate', 'авторизуй', 'логин на сайт'] },
  { name: 'gui', tools: ['gui_click', 'gui_move', 'gui_type', 'gui_key', 'gui_screenshot'],
    kw: ['мышк', 'мышь', 'курсор', 'клик по', 'нажми клавиш', 'набери текст', 'mouse', 'keyboard', 'горяч клавиш'] },
  { name: 'data', tools: ['read_table', 'run_chart', 'read_document', 'run_python', 'read_file'],
    kw: ['данны', 'таблиц', 'csv', 'excel', 'xlsx', 'график', 'диаграмм', 'chart', 'plot', 'статист', 'метрик', 'анализ', 'pandas', 'matplotlib', 'визуализ', 'документ', 'pdf'] },
  { name: 'markets', tools: ['market_data', 'web_search', 'http_get'],
    kw: ['акци', 'акция', 'фьючерс', 'крипт', 'биткоин', 'bitcoin', 'btc', 'eth', 'котировк', 'тикер', 'бирж', 'трейд', 'инвест', 'stock', 'ticker', 'futures', 'forex', 'форекс', 'индекс', 'nasdaq', 's&p', 'доллар', 'нефть', 'золото', 'цена акц', 'свеч'] }
];

// Роль агента → бандлы, которые всегда полезны для него (даже без слов-триггеров).
function rolesFor(agent) {
  const s = ((agent && agent.system) || '').toLowerCase();
  const id = (agent && agent.id) || '';
  const roles = new Set();
  if (/программ|код|coder|devops|debug|reviewer|sql|qwen.?code|инженер/.test(s) || /coder|qwencode|debug|devops|review/.test(id)) roles.add('code');
  if (/minecraft|майнкрафт|плагин/.test(s)) roles.add('minecraft');
  if (/сервер|ssh|remote|админ/.test(s)) roles.add('remote');
  if (/перевод|translat/.test(s)) roles.add('translate');
  if (/исследова|research|интернет|поиск/.test(s)) roles.add('web');
  if (/файл|органайз|куратор|бэкап|backup|cleaner|уборщик/.test(s)) roles.add('files');
  if (/умный дом|smart.?home/.test(s)) roles.add('smarthome');
  if (/голос|voice|компаньон/.test(s)) { roles.add('media'); }
  if (/автоматиз|automation|систем/.test(s)) { roles.add('system'); roles.add('files'); }
  return roles;
}

// Главная функция: из полного списка схем выбираем подмножество.
// allSchemas — массив схем (как из allToolSchemas()); message — текст пользователя;
// agent — объект агента; cap — максимум инструментов.
function selectTools(allSchemas, message, agent, cap = 16) {
  const byName = new Map(allSchemas.map((t) => [t.function.name, t]));
  const msg = String(message || '').toLowerCase();
  const wanted = new Map(); // name -> score

  const add = (name, score) => {
    if (!byName.has(name)) return; // инструмент мог быть отключён в настройках
    wanted.set(name, Math.max(wanted.get(name) || 0, score));
  };

  // 1) Ядро — всегда.
  CORE.forEach((n) => add(n, 1));

  // 2) Бандлы по роли агента (вес 3).
  const roles = rolesFor(agent);
  for (const b of BUNDLES) if (roles.has(b.name)) b.tools.forEach((t) => add(t, 3));

  // 3) Бандлы по ключевым словам запроса (вес 5 — приоритетнее роли).
  for (const b of BUNDLES) {
    if (b.kw.some((k) => msg.includes(k))) b.tools.forEach((t) => add(t, 5));
  }

  // 4) Скилы (динамические инструменты) подмешиваем, если запрос длинный/неоднозначный
  //    или прямо упоминает действие скила — они дёшевы и специфичны.
  for (const t of allSchemas) {
    const n = t.function.name;
    if (/^skill_/.test(n) || (t._skill)) {
      const desc = ((t.function.description || '') + ' ' + n).toLowerCase();
      const words = desc.split(/[^a-zа-я0-9]+/).filter((w) => w.length > 4);
      if (words.some((w) => msg.includes(w))) add(n, 6);
    }
  }

  // Если ничего толком не выбралось (короткий/болтливый запрос) — даём широкий
  // дефолт: ядро + web + files + system, чтобы не лишать агента возможностей.
  if (wanted.size <= CORE.length) {
    ['web', 'files', 'system'].forEach((bn) => {
      const b = BUNDLES.find((x) => x.name === bn);
      b && b.tools.forEach((t) => add(t, 2));
    });
  }

  // Сортируем по весу и режем по cap.
  const ranked = [...wanted.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map(([n]) => n);
  const set = new Set(ranked);
  const out = allSchemas.filter((t) => set.has(t.function.name));
  return out.length ? out : allSchemas; // страховка
}

module.exports = { selectTools, BUNDLES, CORE };
