// Конструктор моделей: сборка кастомных Ollama-моделей из UI через Modelfile
// и команду `ollama create`. Полученную модель можно сразу назначить агенту.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function sanitizeName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom-model'; }

// Сформировать содержимое Modelfile.
function buildModelfile({ base, system, params }) {
  const lines = ['FROM ' + (base || 'qwen2.5:7b')];
  if (system && String(system).trim()) lines.push('SYSTEM """' + String(system).trim() + '"""');
  const p = params || {};
  for (const k of ['temperature', 'num_ctx', 'top_p', 'top_k', 'repeat_penalty', 'num_predict', 'seed']) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '') lines.push('PARAMETER ' + k + ' ' + p[k]);
  }
  if (p.stop) String(p.stop).split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => lines.push('PARAMETER stop ' + JSON.stringify(s)));
  return lines.join('\n') + '\n';
}

// Создать модель. onLog(line) — поток вывода в UI.
function create({ name, base, system, params }, onLog) {
  return new Promise((resolve) => {
    name = sanitizeName(name);
    let dir;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythera-modelfile-'));
      const mf = path.join(dir, 'Modelfile');
      fs.writeFileSync(mf, buildModelfile({ base, system, params }), 'utf8');
      const cmd = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
      const proc = spawn(cmd, ['create', name, '-f', mf]);
      let log = '';
      const push = (d) => { const s = d.toString(); log += s; onLog && onLog(s); };
      proc.stdout.on('data', push); proc.stderr.on('data', push);
      proc.on('error', (e) => { cleanup(dir); resolve({ ok: false, error: 'Не удалось запустить ollama: ' + e.message + ' (установлен ли он?)', log }); });
      proc.on('close', (code) => { cleanup(dir); resolve(code === 0 ? { ok: true, name, log } : { ok: false, error: 'ollama create завершился с кодом ' + code, log }); });
    } catch (e) { cleanup(dir); resolve({ ok: false, error: e.message }); }
  });
}
function cleanup(dir) { try { if (dir) fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

// Предпросмотр Modelfile (для UI).
function preview(opts) { return buildModelfile(opts); }

module.exports = { create, preview, buildModelfile, sanitizeName };
