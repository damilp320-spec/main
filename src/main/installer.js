// Установка Ollama и загрузка моделей с прогрессом.
const http = require('http');
const https = require('https');
const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const system = require('./system');

// Каталог рекомендованных локальных моделей. Подобраны под обычный ПК
// и под полноценную работу автономных агентов (хороший tool-calling).
const CATALOG = [
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    vendor: 'Meta',
    size: '2.0 GB',
    ram: 8,
    tags: ['быстрая', 'tool-calling', 'универсальная'],
    desc: 'Лёгкая и быстрая модель с поддержкой вызова инструментов. Идеальна как «мозг» агента на слабом ПК.',
    best: true
  },
  {
    id: 'qwen2.5:7b',
    name: 'Qwen 2.5 7B',
    vendor: 'Alibaba',
    size: '4.7 GB',
    ram: 16,
    tags: ['tool-calling', 'агенты', 'код'],
    desc: 'Один из лучших открытых вариантов для агентов: надёжный tool-calling, хорошо рассуждает и пишет код.',
    best: true
  },
  {
    id: 'gemma2:9b',
    name: 'Gemma 2 9B',
    vendor: 'Google',
    size: '5.4 GB',
    ram: 16,
    tags: ['универсальная', 'качество'],
    desc: 'Сильная универсальная модель Google. Отличное качество ответов при умеренных требованиях.'
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    vendor: 'Mistral AI',
    size: '4.1 GB',
    ram: 16,
    tags: ['быстрая', 'tool-calling'],
    desc: 'Очень быстрая модель с хорошим балансом скорости и качества, поддерживает инструменты.'
  },
  {
    id: 'phi3.5:3.8b',
    name: 'Phi 3.5 Mini',
    vendor: 'Microsoft',
    size: '2.2 GB',
    ram: 8,
    tags: ['быстрая', 'компактная'],
    desc: 'Компактная модель Microsoft — отлично работает даже на ноутбуках с 8 ГБ ОЗУ.'
  },
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    vendor: 'Meta',
    size: '4.9 GB',
    ram: 16,
    tags: ['tool-calling', 'популярная'],
    desc: 'Самая популярная локальная модель. Надёжный tool-calling и большой контекст.'
  },
  {
    id: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B',
    vendor: 'Alibaba',
    size: '4.7 GB',
    ram: 16,
    tags: ['код', 'агенты'],
    desc: 'Специализирована на программировании — для агента-разработчика и автоматизации скриптов.'
  },
  {
    id: 'nomic-embed-text',
    name: 'Nomic Embed (эмбеддинги)',
    vendor: 'Nomic',
    size: '0.3 GB',
    ram: 8,
    tags: ['эмбеддинги', 'память'],
    desc: 'Модель эмбеддингов для долговременной памяти агентов и поиска по документам (RAG).'
  }
];

function getCatalog() {
  return CATALOG;
}

// Подбор моделей под реальное «железо» пользователя.
function recommend() {
  const totalGb = Math.round(os.totalmem() / (1024 ** 3));
  let picks;
  if (totalGb <= 8) picks = ['llama3.2:3b', 'phi3.5:3.8b', 'nomic-embed-text'];
  else if (totalGb <= 16) picks = ['qwen2.5:7b', 'llama3.2:3b', 'nomic-embed-text'];
  else picks = ['qwen2.5:7b', 'gemma2:9b', 'qwen2.5-coder:7b', 'nomic-embed-text'];
  return { totalGb, models: CATALOG.filter((m) => picks.includes(m.id)) };
}

function checkOllamaInstalled() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
    exec(cmd, (err, stdout) => resolve(!err && !!stdout.trim()));
  });
}

// Установка Ollama. На Windows скачиваем официальный установщик и запускаем тихо.
function installOllama(onProgress) {
  return new Promise(async (resolve) => {
    const already = await checkOllamaInstalled();
    if (already) {
      onProgress && onProgress({ stage: 'ollama', percent: 100, message: 'Ollama уже установлена' });
      return resolve({ ok: true, alreadyInstalled: true });
    }

    if (process.platform === 'win32') {
      const url = 'https://ollama.com/download/OllamaSetup.exe';
      const dest = path.join(os.tmpdir(), 'OllamaSetup.exe');
      onProgress && onProgress({ stage: 'ollama', percent: 1, message: 'Скачивание установщика Ollama…' });
      downloadFile(url, dest, (pct) => onProgress && onProgress({ stage: 'ollama', percent: pct, message: `Скачивание Ollama… ${pct}%` }))
        .then(() => {
          onProgress && onProgress({ stage: 'ollama', percent: 99, message: 'Запуск установщика…' });
          const proc = spawn(dest, ['/SILENT'], { detached: true, stdio: 'ignore' });
          proc.unref();
          onProgress && onProgress({ stage: 'ollama', percent: 100, message: 'Установщик Ollama запущен' });
          resolve({ ok: true });
        })
        .catch((e) => resolve({ ok: false, error: e.message }));
    } else {
      // Linux/Mac: официальный скрипт установки.
      onProgress && onProgress({ stage: 'ollama', percent: 10, message: 'Установка через официальный скрипт…' });
      const proc = spawn('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], { stdio: 'ignore' });
      proc.on('close', (code) => {
        onProgress && onProgress({ stage: 'ollama', percent: 100, message: code === 0 ? 'Готово' : 'Ошибка установки' });
        resolve({ ok: code === 0 });
      });
    }
  });
}

function downloadFile(url, dest, onPct) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location);
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) onPct && onPct(Math.min(99, Math.round((received / total) * 100)));
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    get(url).on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
  });
}

// Загрузка модели через Ollama API со стримингом прогресса.
function pullModel(name, onProgress) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ name, stream: true });
    const req = http.request(
      { host: '127.0.0.1', port: 11434, path: '/api/pull', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          let nl;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const obj = JSON.parse(line);
              let percent = 0;
              if (obj.total && obj.completed) percent = Math.round((obj.completed / obj.total) * 100);
              onProgress && onProgress({ stage: 'model', model: name, percent, message: obj.status || 'Загрузка…' });
            } catch { /* ignore */ }
          }
        });
        res.on('end', () => { onProgress && onProgress({ stage: 'model', model: name, percent: 100, message: 'Готово' }); resolve({ ok: true }); });
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

// Полный быстрый сценарий: установить Ollama + подходящие модели.
async function quickSetup(onProgress) {
  const r = await installOllama(onProgress);
  if (!r.ok) return { ok: false, step: 'ollama', error: r.error };
  // Ждём поднятия сервера.
  const ollama = require('./ollama');
  for (let i = 0; i < 20; i++) {
    const s = await ollama.status();
    if (s.running) break;
    await new Promise((res) => setTimeout(res, 1500));
  }
  const rec = recommend();
  for (const m of rec.models) {
    await pullModel(m.id, onProgress);
  }
  onProgress && onProgress({ stage: 'done', percent: 100, message: 'Готово! Агенты настроены.' });
  return { ok: true, installed: rec.models.map((m) => m.id) };
}

module.exports = { getCatalog, recommend, installOllama, pullModel, quickSetup, checkOllamaInstalled };
