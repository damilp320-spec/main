// Быстрая установка внешних инструментов: локальная речь (Piper + Faster-Whisper)
// и окружение для сборки модов Minecraft (JDK, Gradle, Maven).
// Команды выполняются последовательно, вывод стримится в UI. Best-effort:
// если пакетного менеджера нет — честно сообщаем шаги для ручной установки.
const { spawn, exec } = require('child_process');

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
  let code;
  if (pip) code = await runStream(pip, ['install', '--upgrade', 'piper-tts', 'faster-whisper'], onLog);
  else code = await runStream(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'pip', 'install', '--upgrade', 'piper-tts', 'faster-whisper'], onLog);
  if (code === 0) {
    onLog && onLog('\n✅ Готово. faster-whisper установлен. Для Piper скачайте голос (.onnx), например:\n  python -m piper.download_voices ru_RU-irina-medium\nи укажите путь к нему в Настройках → Голос.\n');
    return { ok: true, note: 'Установлено. Укажите голос Piper в настройках при необходимости.' };
  }
  return { ok: false, error: 'pip install завершился с кодом ' + code };
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
