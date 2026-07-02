// Глобальный быстрый запуск: системная горячая клавиша вызывает мини-окно
// («Spotlight для ИИ») из любого приложения. Агент сразу получает контекст —
// буфер обмена и заголовок активного окна — и действует, не открывая всё
// приложение. Включается настройкой settings.quickAsk.
const { BrowserWindow, clipboard, screen } = require('electron');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('./store');

let win = null;
let getMainWin = null;

function init(deps) { getMainWin = deps.getMainWin; }
function enabled() { return store.get('settings.quickAsk', true); }

function build() {
  const w = new BrowserWindow({
    width: 680, height: 460, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  w.loadFile(path.join(__dirname, '../renderer/quickask.html'));
  w.setAlwaysOnTop(true, 'screen-saver');
  // Прячем при потере фокуса (как у системного поиска).
  w.on('blur', () => { if (win && win.isVisible()) win.hide(); });
  return w;
}

function center() {
  if (!win) return;
  const cur = screen.getCursorScreenPoint();
  const disp = screen.getDisplayNearestPoint(cur);
  const { x, y, width } = disp.workArea;
  const b = win.getBounds();
  win.setBounds({ x: Math.round(x + (width - b.width) / 2), y: Math.round(y + disp.workArea.height * 0.18), width: b.width, height: b.height });
}

function show() {
  if (!enabled()) return;
  if (!win || win.isDestroyed()) win = build();
  center();
  win.show(); win.focus();
  win.webContents.send('quickask:open');
}
function hide() { if (win && !win.isDestroyed()) win.hide(); }
function toggle() { (win && win.isVisible()) ? hide() : show(); }

// Контекст для агента: буфер обмена + заголовок активного окна (best-effort).
function getContext() {
  let clip = '';
  try { clip = clipboard.readText() || ''; } catch {}
  let activeWindow = '';
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
        'Add-Type @"\nusing System;using System.Runtime.InteropServices;using System.Text;public class W{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);}\n"@; $b=New-Object System.Text.StringBuilder 256; [W]::GetWindowText([W]::GetForegroundWindow(),$b,256) | Out-Null; $b.ToString()'],
        { windowsHide: true, timeout: 4000, encoding: 'utf8' });
      if (r.status === 0) activeWindow = (r.stdout || '').trim();
    } else if (process.platform === 'linux') {
      const r = spawnSync('xdotool', ['getactivewindow', 'getwindowname'], { timeout: 3000, encoding: 'utf8' });
      if (r.status === 0) activeWindow = (r.stdout || '').trim();
    } else if (process.platform === 'darwin') {
      const r = spawnSync('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], { timeout: 3000, encoding: 'utf8' });
      if (r.status === 0) activeWindow = (r.stdout || '').trim();
    }
  } catch {}
  return { clipboard: clip.slice(0, 4000), activeWindow };
}

function destroy() { if (win && !win.isDestroyed()) { win.destroy(); win = null; } }

module.exports = { init, show, hide, toggle, getContext, enabled, destroy };
