// Компьютерное зрение: захват скриншотов экрана для UI-агентов.
// Использует Electron desktopCapturer. Кадр передаётся мультимодальной модели
// (например llama3.2-vision / llava / moondream) через поле images в Ollama.
const { desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

let lastShot = null; // base64 PNG последнего скриншота (для vision-сообщения)

async function capture() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.min(width, 1600), height: Math.min(height, 900) }
  });
  if (!sources.length) throw new Error('Источник экрана не найден');
  const img = sources[0].thumbnail;
  const png = img.toPNG();
  const b64 = png.toString('base64');
  lastShot = b64;
  // Сохраняем копию в рабочее пространство для пользователя.
  try {
    const dir = path.join(require('./system').safeRoot(), 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'shot-' + Date.now() + '.png');
    fs.writeFileSync(file, png);
    return { ok: true, file, base64: b64, width: img.getSize().width, height: img.getSize().height };
  } catch (e) {
    return { ok: true, base64: b64 };
  }
}

function takeLast() { const s = lastShot; return s; }
function clearLast() { lastShot = null; }

module.exports = { capture, takeLast, clearLast };
