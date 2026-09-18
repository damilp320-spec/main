// Управление мышью и клавиатурой ОС (GUI-автоматизация). Реализовано через
// PowerShell + System.Windows.Forms / user32 — БЕЗ нативных зависимостей.
// Работает на Windows 11 (целевая платформа приложения); на других ОС вернёт
// понятную ошибку. Включается настройкой settings.guiAutomation.
const { spawn } = require('child_process');
const store = require('./store');

function enabled() { return store.get('settings.guiAutomation', false); }

function guard() {
  if (!enabled()) return 'GUI-автоматизация выключена в настройках (settings.guiAutomation).';
  if (process.platform !== 'win32') return 'GUI-автоматизация поддерживается только на Windows.';
  return null;
}

// Запуск PowerShell-скрипта, возврат stdout/ошибки.
function ps(script) {
  return new Promise((resolve) => {
    try {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
      let out = '', err = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('close', (code) => resolve(code === 0 ? (out.trim() || 'OK') : ('ОШИБКА: ' + (err.trim() || 'код ' + code))));
      p.on('error', (e) => resolve('ОШИБКА: ' + e.message));
    } catch (e) { resolve('ОШИБКА: ' + e.message); }
  });
}

const ADDTYPE = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);';`;

async function move(x, y) {
  const g = guard(); if (g) return g;
  return ps(`${ADDTYPE} [W.U]::SetCursorPos(${+x|0},${+y|0}) | Out-Null; 'OK'`);
}

async function click(x, y, button) {
  const g = guard(); if (g) return g;
  const right = String(button).toLowerCase() === 'right';
  const down = right ? '0x0008' : '0x0002', up = right ? '0x0010' : '0x0004';
  const moveCmd = (x != null && y != null) ? `[W.U]::SetCursorPos(${+x|0},${+y|0}) | Out-Null; Start-Sleep -Milliseconds 60;` : '';
  return ps(`${ADDTYPE} ${moveCmd} [W.U]::mouse_event(${down},0,0,0,0); [W.U]::mouse_event(${up},0,0,0,0); 'OK'`);
}

// Безопасное экранирование текста для SendKeys (спецсимволы +^%~(){}[]).
function escSendKeys(t) {
  return String(t).replace(/([+^%~(){}\[\]])/g, '{$1}');
}

async function type(text) {
  const g = guard(); if (g) return g;
  const esc = escSendKeys(text).replace(/'/g, "''");
  return ps(`${ADDTYPE} [System.Windows.Forms.SendKeys]::SendWait('${esc}'); 'OK'`);
}

// Нажатие спец-клавиши: enter, tab, esc, up/down/left/right, f1..f12, ctrl+c и т.п.
const KEYMAP = { enter: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', space: ' ', backspace: '{BACKSPACE}', delete: '{DELETE}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}' };
function toSendKeys(key) {
  let k = String(key).toLowerCase().trim();
  let mods = '';
  if (k.includes('+')) {
    const parts = k.split('+').map((s) => s.trim());
    k = parts.pop();
    for (const m of parts) { if (m === 'ctrl' || m === 'control') mods += '^'; else if (m === 'alt') mods += '%'; else if (m === 'shift') mods += '+'; }
  }
  let base = KEYMAP[k] || (/^f([1-9]|1[0-2])$/.test(k) ? '{' + k.toUpperCase() + '}' : k);
  return mods + base;
}

async function key(k) {
  const g = guard(); if (g) return g;
  const sk = toSendKeys(k).replace(/'/g, "''");
  return ps(`${ADDTYPE} [System.Windows.Forms.SendKeys]::SendWait('${sk}'); 'OK'`);
}

const toolSchemas = [
  { type: 'function', function: { name: 'gui_move', description: 'Переместить курсор мыши в точку экрана (пиксельные координаты).', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } } },
  { type: 'function', function: { name: 'gui_click', description: 'Клик мышью. Можно задать координаты x,y (иначе клик в текущей точке) и button (left/right).', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string' } } } } },
  { type: 'function', function: { name: 'gui_type', description: 'Напечатать текст с клавиатуры в активное окно.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'gui_key', description: 'Нажать клавишу или сочетание: enter, tab, esc, f5, "ctrl+c", "alt+tab" и т.п.', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } }
];

const toolHandlers = {
  gui_move: (a) => move(a.x, a.y),
  gui_click: (a) => click(a.x, a.y, a.button),
  gui_type: (a) => type(a.text),
  gui_key: (a) => key(a.key)
};

module.exports = { toolSchemas, toolHandlers, move, click, type, key, enabled };
