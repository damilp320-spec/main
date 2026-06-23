// Быстрая установка внешних инструментов: локальная речь (Piper + Faster-Whisper)
// и окружение для сборки модов Minecraft (JDK, Gradle, Maven).
// Команды выполняются последовательно, вывод стримится в UI. Best-effort:
// если пакетного менеджера нет — честно сообщаем шаги для ручной установки.
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

function which(cmd) {
  return new Promise((res) => exec((process.platform === 'win32' ? 'where ' : 'command -v ') + cmd, { windowsHide: true }, (e, o) => res(!e && !!String(o).trim())));
}

// Выполнить команду со стримингом строк в onLog. Возвращает код выхода.
function runStream(cmd, args, onLog) {
  return new Promise((resolve) => {
    onLog && onLog('$ ' + cmd + ' ' + args.join(' ') + '\n');
    let proc;
    try { proc = spawn(cmd, args, { windowsHide: true, shell: process.platform === 'win32' }); }
    catch (e) { onLog && onLog('Ошибка запуска: ' + e.message + '\n'); return resolve(-1); }
    proc.stdout.on('data', (d) => onLog && onLog(String(d)));
    proc.stderr.on('data', (d) => onLog && onLog(String(d)));
    proc.on('error', (e) => { onLog && onLog('Ошибка: ' + e.message + '\n'); resolve(-1); });
    proc.on('close', (code) => { onLog && onLog(`[код выхода: ${code}]\n`); resolve(code); });
  });
}

// Установка движков речи через pip (piper-tts + faster-whisper).
async function installSpeech(onLog) {
  const hasPip = (await which('pip')) || (await which('pip3')) || (await which('python')) || (await which('python3'));
  if (!hasPip) {
    onLog && onLog('Python/pip не найдены. Установите Python 3 (python.org) и повторите.\n');
    return { ok: false, error: 'Python/pip не найдены' };
  }
  const pip = (await which('pip')) ? 'pip' : (await which('pip3')) ? 'pip3' : null;
  const py = process.platform === 'win32' ? 'python' : 'python3';
  let code;
  if (pip) code = await runStream(pip, ['install', '--upgrade', 'piper-tts', 'faster-whisper'], onLog);
  else code = await runStream(py, ['-m', 'pip', 'install', '--upgrade', 'piper-tts', 'faster-whisper'], onLog);
  if (code !== 0) return { ok: false, error: 'pip install завершился с кодом ' + code };

  // Автоматически скачиваем голос Piper под язык интерфейса и настраиваем его —
  // иначе TTS остаётся на «виндовском» голосе, т.к. модель не задана.
  let voiceSet = false;
  try {
    const store = require('./store');
    const lang = String(store.get('settings.lang', 'en') || 'en').slice(0, 2);
    const VOICE = { ru: 'ru_RU-irina-medium', en: 'en_US-amy-medium', uk: 'uk_UA-ukrainian_tts-medium', de: 'de_DE-thorsten-medium', es: 'es_ES-davefx-medium', zh: 'zh_CN-huayan-medium' };
    const voice = VOICE[lang] || 'en_US-amy-medium';
    let dir;
    try { const { app } = require('electron'); dir = path.join(app.getPath('userData'), 'piper-voices'); }
    catch { dir = path.join(require('os').tmpdir(), 'mythera-piper-voices'); }
    fs.mkdirSync(dir, { recursive: true });
    onLog && onLog(`\n=== Скачиваю голос Piper: ${voice} ===\n`);
    const dl = await runStream(py, ['-m', 'piper.download_voices', voice, '--data-dir', dir], onLog);
    if (dl === 0) {
      const onnx = fs.readdirSync(dir).filter((f) => f.endsWith('.onnx')).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      if (onnx) { store.set('settings.piperVoice', onnx); store.set('settings.ttsEngine', 'piper'); voiceSet = true; onLog && onLog(`\n✅ Голос Piper настроен и включён: ${path.basename(onnx)}\n`); }
    }
    if (!voiceSet) onLog && onLog('\n⚠️ Не удалось авто-скачать голос. Скачайте вручную:\n  ' + py + ' -m piper.download_voices ' + voice + '\nи укажите путь к .onnx в Настройках → Голос.\n');
  } catch (e) { onLog && onLog('\n⚠️ Авто-настройка голоса не удалась: ' + e.message + '\n'); }

  return { ok: true, voiceSet, note: voiceSet ? 'Piper установлен и включён.' : 'Установлено. Укажите голос Piper в настройках.' };
}

// Установка окружения сборки модов: JDK 21, Gradle, Maven (через winget на Windows).
async function installMcTools(onLog) {
  if (process.platform === 'win32') {
    if (!(await which('winget'))) { onLog && onLog('winget не найден. Обновите «Установщик приложений» из Microsoft Store.\n'); return { ok: false, error: 'winget не найден' }; }
    const pkgs = [['Microsoft.OpenJDK.21', 'JDK 21'], ['Gradle.Gradle', 'Gradle'], ['Apache.Maven', 'Maven']];
    let okAll = true;
    for (const [id, label] of pkgs) {
      onLog && onLog(`\n=== Установка ${label} ===\n`);
      const code = await runStream('winget', ['install', '-e', '--id', id, '--accept-source-agreements', '--accept-package-agreements'], onLog);
      if (code !== 0) okAll = false;
    }
    onLog && onLog(okAll ? '\n✅ Готово. Перезапустите терминал/приложение, чтобы PATH обновился.\n' : '\n⚠️ Часть пакетов не установилась — проверьте лог.\n');
    return { ok: okAll, note: 'Перезапустите приложение для обновления PATH.' };
  }
  // Linux/mac — подсказки (пакетные менеджеры разные).
  onLog && onLog('На Linux/mac установите вручную:\n  • JDK 21 (Temurin/OpenJDK)\n  • Gradle\n  • Maven\nНапример (Debian/Ubuntu): sudo apt install openjdk-21-jdk gradle maven\n');
  return { ok: false, error: 'Автоустановка только для Windows (winget)' };
}

module.exports = { installSpeech, installMcTools };
