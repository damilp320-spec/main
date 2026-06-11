// Локальная речь: Piper (TTS) + Faster-Whisper (STT).
// Даёт лучшее качество и полный оффлайн по сравнению с Web Speech API.
// Если бинарники не установлены — отдаём fallback:'web', и рендерер
// использует встроенный Web Speech API.
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cfg = require('./store');

function which(cmd) {
  return new Promise((resolve) => {
    const c = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    exec(c, { windowsHide: true }, (err, out) => resolve(!err && out.trim() ? out.trim().split('\n')[0].trim() : null));
  });
}

function pyHasFasterWhisper() {
  return new Promise((resolve) => {
    exec('python -c "import faster_whisper"', { windowsHide: true }, (err) => resolve(!err));
  });
}

// Состояние движков и подсказки по установке.
async function detect() {
  const piperPath = cfg.get('settings.piperPath', '') || await which('piper');
  const piperVoice = cfg.get('settings.piperVoice', '');
  const whisperCmd = cfg.get('settings.whisperCmd', '') || await which('whisper-ctranslate2') || await which('faster-whisper');
  const pyWhisper = whisperCmd ? false : await pyHasFasterWhisper();
  return {
    piper: { available: !!piperPath && !!piperVoice, bin: piperPath || null, voice: piperVoice || null,
      hint: 'Скачайте piper и голос (.onnx) с github.com/rhasspy/piper, укажите пути в настройках.' },
    whisper: { available: !!whisperCmd || pyWhisper, cmd: whisperCmd || (pyWhisper ? 'python' : null),
      hint: 'Установите: pip install faster-whisper  (или whisper-ctranslate2).' },
    engines: {
      tts: cfg.get('settings.ttsEngine', 'web'),   // 'web' | 'piper'
      stt: cfg.get('settings.sttEngine', 'web')    // 'web' | 'whisper'
    }
  };
}

// Синтез речи через Piper -> путь к WAV (рендерер проигрывает file://).
async function synthesize(text) {
  const d = await detect();
  if (cfg.get('settings.ttsEngine', 'web') !== 'piper' || !d.piper.available) return { ok: false, fallback: 'web' };
  const out = path.join(os.tmpdir(), 'mythera-tts-' + Date.now() + '.wav');
  return new Promise((resolve) => {
    const proc = spawn(d.piper.bin, ['--model', d.piper.voice, '--output_file', out], { windowsHide: true });
    proc.on('error', (e) => resolve({ ok: false, fallback: 'web', error: e.message }));
    proc.stdin.write(String(text)); proc.stdin.end();
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(out)) resolve({ ok: true, file: out });
      else resolve({ ok: false, fallback: 'web' });
    });
  });
}

// Распознавание: принимает аудио (base64) -> текст через faster-whisper.
async function transcribe(audioB64, mime) {
  const d = await detect();
  if (cfg.get('settings.sttEngine', 'web') !== 'whisper' || !d.whisper.available) return { ok: false, fallback: 'web' };
  const ext = (mime && mime.includes('wav')) ? 'wav' : 'webm';
  const inFile = path.join(os.tmpdir(), 'mythera-stt-' + Date.now() + '.' + ext);
  try { fs.writeFileSync(inFile, Buffer.from(audioB64, 'base64')); }
  catch (e) { return { ok: false, fallback: 'web', error: e.message }; }
  const lang = (cfg.get('settings.lang', 'en') || 'en').slice(0, 2);
  const model = cfg.get('settings.whisperModel', 'base');
  return new Promise((resolve) => {
    let args, bin = d.whisper.cmd;
    if (bin === 'python') {
      const py = `import sys;from faster_whisper import WhisperModel;m=WhisperModel('${model}');segs,_=m.transcribe(r'${inFile}',language='${lang}');print(' '.join(s.text for s in segs))`;
      bin = 'python'; args = ['-c', py];
    } else {
      args = [inFile, '--model', model, '--language', lang, '--output_format', 'txt', '--output_dir', os.tmpdir()];
    }
    let out = '';
    const proc = spawn(bin, args, { windowsHide: true });
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', () => {});
    proc.on('error', (e) => resolve({ ok: false, fallback: 'web', error: e.message }));
    proc.on('close', () => {
      let text = out.trim();
      if (!text) { // CLI пишет в .txt
        const txt = path.join(os.tmpdir(), path.basename(inFile).replace(/\.\w+$/, '.txt'));
        try { text = fs.readFileSync(txt, 'utf8').trim(); } catch {}
      }
      resolve(text ? { ok: true, text } : { ok: false, fallback: 'web' });
    });
  });
}

module.exports = { detect, synthesize, transcribe };
