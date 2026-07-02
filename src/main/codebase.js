// Индексация кодовой базы в RAG: обходит папку/репозиторий, читает исходники и
// индексирует их в scope 'code'. Кодер-агент и чат получают контекст по проекту.
const fs = require('fs');
const path = require('path');
const system = require('./system');
const store = require('./store');

let uiSender = null;
function setUISender(fn) { uiSender = fn; }

const CODE_EXT = /\.(js|ts|jsx|tsx|mjs|cjs|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|scala|sh|bash|sql|html|css|scss|less|vue|svelte|json|ya?ml|toml|md|txt|gradle|dockerfile|ini|cfg)$/i;
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', 'out', 'target', 'vendor', '.idea', '.vscode', 'coverage', '.cache']);

// Безопасное разрешение корня: внутри песочницы всегда, вне — только при
// включённом «Полном доступе к диску».
function resolveRoot(p) {
  if (!p) return system.safeRoot();
  if (path.isAbsolute(p)) {
    const full = path.resolve(p);
    const root = system.safeRoot();
    if (!full.startsWith(root) && !store.get('settings.fullDiskAccess', false)) {
      throw new Error('Папка вне песочницы. Включите «Полный доступ к диску» в настройках для индексации внешних проектов.');
    }
    return full;
  }
  return system.resolveSafe(p);
}

async function index({ path: p, scope, max }, onProgress) {
  const rag = require('./rag');
  scope = scope || 'code';
  let root; try { root = resolveRoot(p); } catch (e) { return { ok: false, error: e.message }; }
  if (!fs.existsSync(root)) return { ok: false, error: 'Папка не найдена: ' + root };
  const cap = Math.min(600, +max || 400);
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 8 || files.length > cap) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      if (IGNORE.has(e.name)) continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp, depth + 1);
      else if (CODE_EXT.test(e.name)) { try { if (fs.statSync(fp).size < 200000) files.push(fp); } catch {} }
    }
  };
  walk(root, 0);
  if (!files.length) return { ok: false, error: 'Не найдено файлов кода для индексации.' };
  rag.clearDocs(scope); // полная переиндексация
  let indexed = 0, chunks = 0;
  for (const f of files) {
    if (indexed >= cap) break;
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (!txt.trim()) continue;
    const rel = path.relative(root, f).split(path.sep).join('/');
    onProgress && onProgress({ stage: 'index', file: rel, indexed: indexed + 1, total: Math.min(files.length, cap) });
    const r = await rag.addDocument(scope, txt.slice(0, 40000), rel);
    if (r.ok) { indexed++; chunks += r.added; }
    else return { ok: false, error: r.error + ' (установлена ли модель эмбеддингов?)', indexed, chunks };
  }
  store.set('codebaseRoot', root);
  onProgress && onProgress({ stage: 'done', indexed, chunks });
  return { ok: true, indexed, chunks, files: files.length, root };
}

async function search({ query, scope }) {
  const rag = require('./rag');
  const hits = await rag.retrieve(scope || 'code', query, 6);
  return { ok: true, hits };
}

const toolSchemas = [
  { type: 'function', function: { name: 'index_codebase', description: 'Проиндексировать папку/репозиторий с кодом в базу знаний (RAG) для вопросов по проекту. Путь — относительно рабочего пространства или абсолютный (нужен полный доступ к диску).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_code', description: 'Найти релевантные фрагменты в проиндексированной кодовой базе по запросу.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }
];
const toolHandlers = {
  index_codebase: async (a) => { const r = await index({ path: a.path }, (p) => uiSender && uiSender('codebase:progress', p)); return r.ok ? `Кодовая база проиндексирована: файлов ${r.indexed}, фрагментов ${r.chunks} (${r.root}). Теперь можно спрашивать по проекту.` : ('ОШИБКА: ' + r.error); },
  search_code: async (a) => { const r = await search({ query: a.query }); return r.hits.length ? r.hits.map((h) => `• [${h.source}] ${h.text.slice(0, 200)}`).join('\n\n') : 'Ничего не найдено (база кода проиндексирована?).'; }
};

module.exports = { setUISender, index, search, toolSchemas, toolHandlers };
