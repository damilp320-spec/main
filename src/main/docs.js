// Понимание документов: извлечение текста из PDF/DOCX/XLSX/изображений и
// загрузка в RAG-память. Использует CLI-утилиты, если они есть в системе
// (pdftotext из poppler, soffice из LibreOffice, tesseract для OCR) — без
// обязательных зависимостей. Если утилиты нет — честно сообщаем об этом.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function has(cmd) {
  try {
    const probe = process.platform === 'win32' ? spawnSync('where', [cmd]) : spawnSync('which', [cmd]);
    return probe.status === 0;
  } catch { return false; }
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r.stdout || '';
}

// Извлечь текст из файла по расширению. Возвращает { ok, text, method } либо { ok:false, error }.
function extractText(full) {
  if (!fs.existsSync(full)) return { ok: false, error: 'Файл не найден' };
  const ext = path.extname(full).toLowerCase();

  // Текстовые форматы — читаем напрямую.
  if (['.txt', '.md', '.csv', '.json', '.log', '.xml', '.html', '.htm', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.go', '.rs'].includes(ext)) {
    return { ok: true, text: fs.readFileSync(full, 'utf8').slice(0, 200000), method: 'plain' };
  }

  if (ext === '.pdf') {
    if (has('pdftotext')) {
      try { return { ok: true, text: run('pdftotext', ['-layout', full, '-']).slice(0, 200000), method: 'pdftotext' }; }
      catch (e) { return { ok: false, error: 'pdftotext: ' + e.message }; }
    }
    return { ok: false, error: 'Для PDF нужен pdftotext (poppler). Установите poppler-utils.' };
  }

  if (['.docx', '.doc', '.odt', '.rtf', '.pptx', '.ppt', '.xlsx', '.xls', '.ods'].includes(ext)) {
    if (has('soffice') || has('libreoffice')) {
      const bin = has('soffice') ? 'soffice' : 'libreoffice';
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythera-doc-'));
      try {
        run(bin, ['--headless', '--convert-to', 'txt:Text', '--outdir', outDir, full]);
        const txt = fs.readdirSync(outDir).find((f) => f.endsWith('.txt'));
        if (txt) return { ok: true, text: fs.readFileSync(path.join(outDir, txt), 'utf8').slice(0, 200000), method: bin };
        return { ok: false, error: 'Не удалось конвертировать документ.' };
      } catch (e) { return { ok: false, error: bin + ': ' + e.message }; }
      finally { try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {} }
    }
    return { ok: false, error: 'Для Office-документов нужен LibreOffice (soffice).' };
  }

  if (['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp'].includes(ext)) {
    if (has('tesseract')) {
      try { return { ok: true, text: run('tesseract', [full, 'stdout']).slice(0, 200000), method: 'tesseract-ocr' }; }
      catch (e) { return { ok: false, error: 'tesseract: ' + e.message }; }
    }
    return { ok: false, error: 'Для OCR изображений нужен tesseract. (Либо используйте take_screenshot для мультимодальной модели.)' };
  }

  return { ok: false, error: 'Неподдерживаемый формат: ' + ext };
}

function resolve(p) {
  const system = require('./system');
  return system.resolveSafe(p);
}

async function readDocument(p) {
  let full; try { full = resolve(p); } catch (e) { return 'ОШИБКА: ' + e.message; }
  const r = extractText(full);
  if (!r.ok) return 'ОШИБКА: ' + r.error;
  return `Текст документа (${r.method}, ${r.text.length} симв.):\n\n${r.text.slice(0, 8000)}${r.text.length > 8000 ? '\n…(обрезано)' : ''}`;
}

async function ingestDocument(p, scope) {
  const rag = require('./rag');
  let full; try { full = resolve(p); } catch (e) { return 'ОШИБКА: ' + e.message; }
  const r = extractText(full);
  if (!r.ok) return 'ОШИБКА: ' + r.error;
  if (!r.text.trim()) return 'ОШИБКА: документ пуст или текст не распознан.';
  const res = await rag.addDocument(scope || 'kb', r.text, path.basename(full));
  return res.ok ? `Документ проиндексирован в базу знаний: ${res.added} фрагм. (${path.basename(full)}).` : ('ОШИБКА RAG: ' + res.error);
}

function capabilities() {
  return { pdftotext: has('pdftotext'), soffice: has('soffice') || has('libreoffice'), tesseract: has('tesseract') };
}

const toolSchemas = [
  { type: 'function', function: { name: 'read_document', description: 'Извлечь и прочитать текст из документа: PDF, DOCX, XLSX, PPTX, изображение (OCR). Укажи путь к файлу.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'ingest_document', description: 'Загрузить документ (PDF/DOCX/XLSX/изображение) в базу знаний (RAG) для последующего поиска.', parameters: { type: 'object', properties: { path: { type: 'string' }, scope: { type: 'string', description: 'kb (база знаний) или id агента' } }, required: ['path'] } } }
];

const toolHandlers = {
  read_document: (a) => readDocument(a.path),
  ingest_document: (a) => ingestDocument(a.path, a.scope)
};

module.exports = { extractText, readDocument, ingestDocument, capabilities, toolSchemas, toolHandlers };
