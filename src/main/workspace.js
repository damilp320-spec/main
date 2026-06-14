// Файловое рабочее пространство для мини-IDE: дерево файлов, чтение/запись и
// запуск кода. Все операции — строго внутри песочницы (system.resolveSafe),
// чтобы среда разработки не выходила за безопасные границы.
const fs = require('fs');
const path = require('path');
const system = require('./system');

const IGNORE = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.mythera_tmp.py']);

function rel(full) { return path.relative(system.safeRoot(), full).split(path.sep).join('/'); }

// Рекурсивное дерево (с ограничением глубины и числа узлов).
function tree(dir, depth = 0, budget = { n: 0 }) {
  const base = dir ? safe(dir) : system.safeRoot();
  const out = [];
  let entries;
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env') continue;
    if (IGNORE.has(e.name)) continue;
    if (budget.n++ > 800) break;
    const full = path.join(base, e.name);
    if (e.isDirectory()) {
      out.push({ name: e.name, path: rel(full), dir: true, children: depth < 4 ? tree(full, depth + 1, budget) : [] });
    } else {
      let size = 0; try { size = fs.statSync(full).size; } catch {}
      out.push({ name: e.name, path: rel(full), dir: false, size });
    }
  }
  return out;
}

function safe(p) { return system.resolveSafe(p); }

function read(p) {
  try {
    const full = safe(p);
    const st = fs.statSync(full);
    if (st.size > 2 * 1024 * 1024) return { ok: false, error: 'Файл слишком большой (>2 МБ)' };
    return { ok: true, content: fs.readFileSync(full, 'utf8') };
  } catch (e) { return { ok: false, error: e.message }; }
}

function write(p, content) {
  try { const full = safe(p, { write: true }) || system.resolveSafe(p, { write: true }); fs.writeFileSync(full, String(content), 'utf8'); return { ok: true, path: rel(full) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function create(p, isDir) {
  try {
    const full = system.resolveSafe(p, { write: true });
    if (isDir) fs.mkdirSync(full, { recursive: true });
    else { fs.mkdirSync(path.dirname(full), { recursive: true }); if (!fs.existsSync(full)) fs.writeFileSync(full, '', 'utf8'); }
    return { ok: true, path: rel(full) };
  } catch (e) { return { ok: false, error: e.message }; }
}

function remove(p) {
  try { fs.rmSync(safe(p), { recursive: true, force: true }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// Запуск файла: .py → run_python, иначе попытка через run_command по расширению.
async function run(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.py') return system.callTool('run_python', { path: p });
  if (ext === '.js') return system.callTool('run_command', { command: 'node "' + p + '"' });
  if (ext === '.sh') return system.callTool('run_command', { command: 'bash "' + p + '"' });
  if (ext === '.ps1') return system.callTool('run_command', { command: 'powershell -File "' + p + '"' });
  return 'Запуск для «' + ext + '» не поддерживается. Поддерживаются .py, .js, .sh, .ps1.';
}

module.exports = { tree, read, write, create, remove, run };
