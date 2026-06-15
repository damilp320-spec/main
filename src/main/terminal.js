// Встроенный терминал/CLI: интерактивная консоль с рабочим каталогом, той же
// защитой команд (screenCommand) и песочницей, что и у инструментов агента.
const { spawn } = require('child_process');
const path = require('path');
const system = require('./system');
const store = require('./store');

let cwd = ''; // относительно рабочего пространства

function fullCwd() { try { return system.resolveSafe(cwd || '.'); } catch { return system.safeRoot(); } }
function prompt() { return (cwd ? cwd : '~') + ' $'; }

async function run(line) {
  line = String(line || '').trim();
  if (!line) return { ok: true, out: '', cwd, prompt: prompt() };
  if (line === 'clear' || line === 'cls') return { ok: true, clear: true, cwd, prompt: prompt() };
  if (line === 'pwd') return { ok: true, out: fullCwd(), cwd, prompt: prompt() };
  // Навигация по каталогам (виртуальный cwd внутри песочницы).
  const cd = /^cd\s+(.+)$/.exec(line) || (line === 'cd' ? ['cd', ''] : null);
  if (cd) {
    const arg = cd[1].trim().replace(/^["']|["']$/g, '');
    try {
      const target = !arg || arg === '~' ? '' : (arg === '..' ? path.dirname(cwd || '.') : path.join(cwd || '.', arg));
      const full = system.resolveSafe(target || '.');
      let rel = path.relative(system.safeRoot(), full); if (rel.startsWith('..') || path.isAbsolute(rel)) rel = '';
      cwd = rel;
      return { ok: true, out: '', cwd, prompt: prompt() };
    } catch (e) { return { ok: false, out: e.message, cwd, prompt: prompt() }; }
  }
  if (!store.get('settings.allowShell', true)) return { ok: false, out: 'Выполнение команд отключено в настройках безопасности.', cwd, prompt: prompt() };
  const reason = system.screenCommand(line);
  if (reason) return { ok: false, out: `⛔ Заблокировано политикой безопасности (${reason}).`, cwd, prompt: prompt() };
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', line] : ['-c', line];
    let out = ''; let proc;
    try { proc = spawn(shell, args, { cwd: fullCwd(), windowsHide: true }); }
    catch (e) { return resolve({ ok: false, out: 'Ошибка запуска: ' + e.message, cwd, prompt: prompt() }); }
    proc.stdout.on('data', (d) => { out += d; if (out.length > 60000) proc.kill(); });
    proc.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { proc.kill(); resolve({ ok: false, out: out + '\n[таймаут 30с]', cwd, prompt: prompt() }); }, 30000);
    proc.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out: (out || '').slice(0, 60000), code, cwd, prompt: prompt() }); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, out: 'Ошибка запуска: ' + e.message, cwd, prompt: prompt() }); });
  });
}

function state() { return { cwd, prompt: prompt(), root: system.safeRoot() }; }

module.exports = { run, state };
