// Диагностика системы: одна точка, проверяющая все интеграции и подсказывающая,
// что настроено, чего не хватает и как починить. Учитывает множество
// опциональных зависимостей приложения.
const { spawnSync } = require('child_process');
const https = require('https');
const store = require('./store');

function hasCmd(cmd) {
  try { const p = process.platform === 'win32' ? spawnSync('where', [cmd]) : spawnSync('which', [cmd]); return p.status === 0; } catch { return false; }
}
function pyOk(args) { try { const py = process.platform === 'win32' ? 'python' : 'python3'; return spawnSync(py, args, { timeout: 6000 }).status === 0; } catch { return false; } }

function netCheck() {
  return new Promise((resolve) => {
    const req = https.request({ host: 'query1.finance.yahoo.com', path: '/v1/test/getcrumb', method: 'GET', headers: { 'User-Agent': 'Mythera' } }, (res) => { res.resume(); resolve(res.statusCode < 500); });
    req.on('error', () => resolve(false));
    req.setTimeout(6000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// status: 'ok' | 'warn' | 'off'
async function run() {
  const ollama = require('./ollama');
  const docs = require('./docs');
  const checks = [];
  const add = (id, label, status, detail, hint) => checks.push({ id, label, status, detail: detail || '', hint: hint || '' });

  // Ollama + модели.
  const ost = await ollama.status();
  if (ost.running) {
    const models = await ollama.listModels();
    add('ollama', 'Ollama', 'ok', `работает · моделей: ${models.length}`, models.length ? '' : 'Установите модель в разделе «Установка ИИ».');
    const names = models.map((m) => m.name || '');
    const embed = store.get('settings.embedModel', 'nomic-embed-text');
    add('embed', 'Модель эмбеддингов (RAG)', names.some((n) => n.includes(embed.split(':')[0])) ? 'ok' : 'warn', names.some((n) => n.includes(embed.split(':')[0])) ? embed : 'не установлена', `ollama pull ${embed}`);
  } else {
    add('ollama', 'Ollama', 'off', 'не запущена', 'Установите Ollama и запустите сервер (раздел «Установка ИИ»).');
  }

  // Python + библиотеки.
  const py = pyOk(['--version']);
  add('python', 'Python', py ? 'ok' : 'warn', py ? 'доступен' : 'не найден', py ? '' : 'Установите Python 3 (нужен для запуска кода и графиков).');
  if (py) {
    const mpl = pyOk(['-c', 'import matplotlib, pandas']);
    add('pydata', 'matplotlib + pandas', mpl ? 'ok' : 'warn', mpl ? 'установлены' : 'отсутствуют', mpl ? '' : 'pip install matplotlib pandas — для графиков и анализа данных.');
  }

  // Документы.
  const dc = docs.capabilities();
  add('docs', 'Документы (PDF/Office/OCR)', (dc.pdftotext || dc.soffice || dc.tesseract) ? 'ok' : 'warn',
    `PDF ${dc.pdftotext ? '✓' : '✗'} · Office ${dc.soffice ? '✓' : '✗'} · OCR ${dc.tesseract ? '✓' : '✗'}`,
    'PDF: poppler-utils · Office: LibreOffice · OCR: tesseract.');

  // Stable Diffusion.
  try { const img = require('./imagegen'); const s = await img.status(); add('sd', 'Stable Diffusion', s.ok ? 'ok' : 'off', s.ok ? 'подключён' : 'не запущен', s.ok ? '' : 'Запустите SD WebUI с флагом --api (раздел «Изображения»).'); }
  catch { add('sd', 'Stable Diffusion', 'off', 'недоступен', ''); }

  // Речь.
  try { const speech = require('./speech'); const sp = await speech.detect(); const any = sp && (sp.piper || sp.whisper || sp.tts || sp.stt); add('speech', 'Локальная речь (TTS/STT)', any ? 'ok' : 'warn', any ? 'настроена' : 'браузерная по умолчанию', any ? '' : 'Установите Piper/Faster-Whisper для локальной речи (необязательно).'); }
  catch { add('speech', 'Локальная речь', 'warn', 'браузерная', ''); }

  // Брокер.
  try { const trading = require('./trading'); const tc = trading.publicCfg(); add('broker', 'Брокер (торговля)', tc.hasToken ? 'ok' : 'off', tc.hasToken ? `${tc.env}${tc.dryRun ? ' · dry-run' : ''}` : 'токен не задан', tc.hasToken ? '' : 'Добавьте токен в разделе «Торговля» (по желанию).'); }
  catch { add('broker', 'Брокер', 'off', '', ''); }

  // MCP.
  try { const mcp = require('./mcp'); const on = store.get('settings.mcpEnabled', false); const conn = mcp.listConnected(); add('mcp', 'MCP-серверы', on ? (conn.length ? 'ok' : 'warn') : 'off', on ? `подключено: ${conn.length}` : 'выключено', on && !conn.length ? 'Проверьте команды серверов в настройках.' : ''); }
  catch { add('mcp', 'MCP', 'off', '', ''); }

  // Сеть.
  const net = await netCheck();
  add('net', 'Интернет (новости/рынки)', net ? 'ok' : 'warn', net ? 'доступен' : 'недоступен', net ? '' : 'Проверьте подключение/файрвол. Локальные функции работают и без сети.');

  const okN = checks.filter((c) => c.status === 'ok').length;
  return { checks, summary: { ok: okN, total: checks.length, at: Date.now() } };
}

module.exports = { run };
