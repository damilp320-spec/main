// RAG-память на эмбеддингах (модель nomic-embed-text через Ollama).
// Хранит векторные «знания» агента и базу знаний, извлекает релевантное
// по косинусной близости и инжектит в контекст — память не раздувает промпт,
// но подтягивает именно то, что относится к запросу.
const ollama = require('./ollama');
const cfg = require('./store');
const fs = require('fs');
const path = require('path');

const EMBED_MODEL = () => cfg.get('settings.embedModel', 'nomic-embed-text');
const TOP_K = 5;

function keyFor(scope) { return 'rag.' + scope; } // scope: agentId | 'kb'

function listDocs(scope) { return cfg.get(keyFor(scope), []); }
function clearDocs(scope) { cfg.set(keyFor(scope), []); return { ok: true }; }

async function embed(text) {
  const r = await ollama.request('POST', '/api/embeddings', { model: EMBED_MODEL(), prompt: String(text).slice(0, 8000) });
  if (r && r.body && Array.isArray(r.body.embedding)) return r.body.embedding;
  throw new Error('Не удалось получить эмбеддинг (установлена ли модель ' + EMBED_MODEL() + '?)');
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// Разбивка длинного текста на чанки для индексации.
function chunk(text, size = 800) {
  const parts = String(text).split(/\n\s*\n/);
  const chunks = [];
  let buf = '';
  for (const p of parts) {
    if ((buf + '\n\n' + p).length > size && buf) { chunks.push(buf); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  if (buf) chunks.push(buf);
  return chunks.flatMap((c) => c.length <= size * 1.5 ? [c] : c.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) || []);
}

async function addDocument(scope, text, source = 'note') {
  const chunks = chunk(text);
  const docs = listDocs(scope);
  let added = 0;
  for (const c of chunks) {
    try {
      const vec = await embed(c);
      docs.push({ id: 'doc-' + Math.random().toString(36).slice(2, 9), text: c, source, vec, at: Date.now() });
      added++;
    } catch (e) { return { ok: false, error: e.message, added }; }
  }
  // Ограничиваем размер индекса.
  cfg.set(keyFor(scope), docs.slice(-500));
  return { ok: true, added };
}

async function ingestFile(scope, filePath) {
  const system = require('./system');
  let full;
  try { full = system.resolveSafe(filePath); } catch (e) { return { ok: false, error: e.message }; }
  if (!fs.existsSync(full)) return { ok: false, error: 'Файл не найден' };
  const text = fs.readFileSync(full, 'utf8');
  return addDocument(scope, text, path.basename(full));
}

// Извлечение релевантных фрагментов под запрос.
async function retrieve(scopes, query, k = TOP_K) {
  let pool = [];
  for (const s of [].concat(scopes)) pool = pool.concat(listDocs(s));
  if (!pool.length) return [];
  let qv;
  try { qv = await embed(query); } catch { return []; }
  return pool
    .map((d) => ({ d, score: cosine(qv, d.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((x) => x.score > 0.25)
    .map((x) => ({ text: x.d.text, source: x.d.source, score: +x.score.toFixed(3) }));
}

// Блок контекста для системного промпта.
async function buildContext(agentId, query) {
  if (!cfg.get('settings.rag', false)) return '';
  // Подмешиваем знания активного проекта (если задан), не смешивая проекты между собой.
  const scopes = [agentId, 'kb'];
  try { const ps = require('./projects').activeScope(); if (ps) scopes.push(ps); } catch { /* projects optional */ }
  const hits = await retrieve(scopes, query, TOP_K);
  if (!hits.length) return '';
  return '\n\nРелевантные знания (RAG):\n' + hits.map((h) => `• [${h.source}] ${h.text}`).join('\n');
}

function stats(scope) {
  const docs = listDocs(scope);
  return { count: docs.length, sources: [...new Set(docs.map((d) => d.source))] };
}

module.exports = { addDocument, ingestFile, retrieve, buildContext, listDocs, clearDocs, stats, embed };
