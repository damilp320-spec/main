// Студия данных: просмотр и SQL-запросы к локальным данным.
// SQLite — напрямую; CSV — загружается во временную in-memory БД SQLite.
// Движок — системный Python (sqlite3 встроен), без Node-зависимостей.
// Для агентов есть инструмент query_data.
const fs = require('fs');
const path = require('path');
const system = require('./system');

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }

// Python-скрипт: открывает SQLite или грузит CSV в :memory:, выполняет SQL,
// печатает результат как JSON. Аргументы передаём base64, чтобы избежать инъекций.
function pyScript(file64, sql64) {
  return [
    'import base64,json,sqlite3,os,csv,sys',
    `file=base64.b64decode("${file64}").decode("utf-8")`,
    `sql=base64.b64decode("${sql64}").decode("utf-8")`,
    'ext=os.path.splitext(file)[1].lower()',
    'try:',
    '    if ext in (".db",".sqlite",".sqlite3"):',
    '        con=sqlite3.connect(file)',
    '    else:',
    '        con=sqlite3.connect(":memory:")',
    '        with open(file, newline="", encoding="utf-8", errors="replace") as f:',
    '            rd=csv.reader(f); headers=next(rd); rows=[r for r in rd]',
    '        cols=",".join(["\\""+h.replace("\\"","")+"\\" TEXT" for h in headers])',
    '        con.execute("CREATE TABLE data ("+cols+")")',
    '        con.executemany("INSERT INTO data VALUES ("+",".join(["?"]*len(headers))+")", rows)',
    '    cur=con.execute(sql)',
    '    c=[d[0] for d in cur.description] if cur.description else []',
    '    out=[list(r) for r in cur.fetchmany(500)]',
    '    print(json.dumps({"columns":c,"rows":out}))',
    'except Exception as e:',
    '    print(json.dumps({"error":str(e)}))'
  ].join('\n');
}

async function query(file, sql) {
  let full; try { full = system.resolveSafe(file); } catch (e) { return { ok: false, error: e.message }; }
  if (!fs.existsSync(full)) return { ok: false, error: 'Файл не найден: ' + file };
  const code = pyScript(b64(full), b64(sql));
  const out = await system.callTool('run_python', { code });
  // Извлекаем JSON-строку из вывода Python.
  const m = /\{[\s\S]*\}/.exec(String(out));
  if (!m) return { ok: false, error: 'Python не вернул данные. Установлен ли Python? Вывод: ' + String(out).slice(0, 300) };
  let j; try { j = JSON.parse(m[0]); } catch { return { ok: false, error: 'Не разобрать ответ: ' + m[0].slice(0, 200) }; }
  if (j.error) return { ok: false, error: j.error };
  return { ok: true, columns: j.columns || [], rows: j.rows || [] };
}

// Список таблиц для SQLite или столбцов для CSV.
async function describe(file) {
  const ext = path.extname(file).toLowerCase();
  if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
    const r = await query(file, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    if (!r.ok) return r;
    return { ok: true, kind: 'sqlite', tables: r.rows.map((x) => x[0]) };
  }
  // CSV: первые строки.
  const r = await query(file, 'SELECT * FROM data LIMIT 50');
  return r.ok ? { ok: true, kind: 'csv', table: 'data', columns: r.columns, rows: r.rows } : r;
}

// Найти файлы данных в рабочем пространстве.
function listFiles() {
  const root = system.safeRoot(); const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || ['node_modules', '.git'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(csv|tsv|db|sqlite|sqlite3|json)$/i.test(e.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
      if (out.length > 200) return;
    }
  };
  walk(root, 0);
  return out;
}

const toolSchemas = [
  { type: 'function', function: { name: 'query_data', description: 'Выполнить SQL-запрос к файлу данных в рабочем пространстве: SQLite (.db/.sqlite) напрямую или CSV (таблица называется data). Возвращает строки.', parameters: { type: 'object', properties: { file: { type: 'string' }, sql: { type: 'string' } }, required: ['file', 'sql'] } } }
];
const toolHandlers = {
  query_data: async (a) => {
    const r = await query(a.file, a.sql);
    if (!r.ok) return 'ОШИБКА: ' + r.error;
    if (!r.rows.length) return 'Запрос выполнен, строк нет.';
    const head = r.columns.join(' | ');
    const body = r.rows.slice(0, 30).map((row) => row.join(' | ')).join('\n');
    return `${head}\n${body}${r.rows.length > 30 ? '\n…(' + r.rows.length + ' строк)' : ''}`;
  }
};

module.exports = { query, describe, listFiles, toolSchemas, toolHandlers };
