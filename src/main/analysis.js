// Анализ данных + графики. Агент-аналитик читает таблицы (CSV/XLSX) и строит
// графики через matplotlib, которые сразу рендерятся в панель артефактов.
// Без обязательных зависимостей: если нет pandas/matplotlib — честная ошибка.
const fs = require('fs');
const path = require('path');
const system = require('./system');

let uiSender = null;
function setUISender(fn) { uiSender = fn; }

// Простейший парсер CSV (для предпросмотра без pandas).
function parseCsvPreview(text, rows) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return '(пустой файл)';
  const head = lines.slice(0, (rows || 10) + 1);
  const cols = (lines[0].match(/,/g) || []).length + 1;
  return `Строк: ${lines.length - 1}, столбцов: ${cols}\n\n` + head.join('\n');
}

async function readTable({ path: p, rows }) {
  let full; try { full = system.resolveSafe(p); } catch (e) { return 'ОШИБКА: ' + e.message; }
  if (!fs.existsSync(full)) return 'ОШИБКА: файл не найден';
  const ext = path.extname(full).toLowerCase();
  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    return 'Таблица ' + path.basename(full) + ':\n' + parseCsvPreview(fs.readFileSync(full, 'utf8'), rows);
  }
  if (['.xlsx', '.xls', '.ods'].includes(ext)) {
    // Через документ-конвертер (LibreOffice) best-effort.
    try {
      const docs = require('./docs');
      const r = docs.extractText(full);
      if (r.ok) return 'Таблица ' + path.basename(full) + ' (извлечено):\n' + r.text.slice(0, 4000);
      return 'ОШИБКА: ' + r.error;
    } catch (e) { return 'ОШИБКА: ' + e.message; }
  }
  return 'ОШИБКА: неподдерживаемый формат таблицы: ' + ext;
}

// Запуск Python-кода, строящего график. Мы форсируем безоконный бэкенд и
// сохраняем фигуру в PNG, который показываем в панели артефактов.
async function runChart({ code, title }) {
  if (!code || !String(code).trim()) return 'ОШИБКА: пустой код графика.';
  const outName = '.mythera_chart_' + Date.now() + '.png';
  const outPath = path.join(system.safeRoot(), outName);
  const wrapped =
    'import matplotlib\nmatplotlib.use("Agg")\nimport matplotlib.pyplot as plt\n' +
    String(code) + '\n' +
    `try:\n    plt.savefig(r"${outPath.replace(/\\/g, '\\\\')}", dpi=120, bbox_inches="tight")\n    print("CHART_OK")\nexcept Exception as e:\n    print("CHART_ERR:", e)\n`;
  const result = await system.callTool('run_python', { code: wrapped });
  if (!fs.existsSync(outPath)) {
    return 'ОШИБКА: график не построен. Вывод Python:\n' + String(result).slice(0, 1500) +
      '\n(Проверьте, установлены ли matplotlib/pandas: pip install matplotlib pandas)';
  }
  try {
    const b64 = fs.readFileSync(outPath).toString('base64');
    // Шлём артефакт в UI (откроется панель превью с изображением).
    uiSender && uiSender('artifact:image', { title: title || 'График', base64: b64 });
    fs.unlinkSync(outPath);
    return 'График построен и показан в панели артефактов.';
  } catch (e) { return 'ОШИБКА чтения графика: ' + e.message; }
}

const toolSchemas = [
  { type: 'function', function: { name: 'read_table', description: 'Прочитать и кратко описать таблицу данных (CSV/TSV/XLSX): число строк/столбцов и первые строки.', parameters: { type: 'object', properties: { path: { type: 'string' }, rows: { type: 'number', description: 'Сколько строк показать (по умолчанию 10)' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'run_chart', description: 'Построить график из Python-кода (matplotlib). В коде используй plt.* — фигура сама сохранится и покажется в панели артефактов. Данные читай через pandas (pd.read_csv и т.п.).', parameters: { type: 'object', properties: { code: { type: 'string', description: 'Python-код, формирующий график через matplotlib' }, title: { type: 'string' } }, required: ['code'] } } }
];

const toolHandlers = {
  read_table: (a) => readTable(a),
  run_chart: (a) => runChart(a)
};

module.exports = { setUISender, toolSchemas, toolHandlers, readTable, runChart };
