// Координатор голосового ассистента.
// Распознавание речи (STT) и синтез (TTS) выполняются в рендерере через Web Speech API
// (доступно в Chromium внутри Electron). Здесь — управление состоянием и мост к UI.
const store = require('./store');

let cb = {};
let state = { listening: false, available: true };
let winRef = null;

function init(callbacks) { cb = callbacks; }
function bindWindow(w) { winRef = w; }

function send(channel, payload) {
  // main.js пробрасывает события в UI через свой sendToUI; здесь дублируем через cb.onState.
  if (cb.onState && channel === 'voice:state') cb.onState(payload);
}

function start() {
  state.listening = true;
  send('voice:state', { listening: true });
  return state;
}

function stop() {
  state.listening = false;
  send('voice:state', { listening: false });
  return state;
}

function toggle() {
  state.listening = !state.listening;
  send('voice:state', { listening: state.listening });
  return state.listening;
}

function getState() { return state; }

// Запрос на озвучивание: фактический синтез делает рендерер.
// Возвращаем текст, а main.js уже шлёт его в UI каналом voice:speak-request.
function speak(text) {
  if (cb.onSpeak) cb.onSpeak(text);
  return text;
}

// Команда, распознанная в рендерере, прилетает сюда (через IPC из preload).
function handleTranscript(text) {
  cb.onTranscript && cb.onTranscript(text);
}
function handleCommand(text) {
  cb.onCommand && cb.onCommand(text);
}

module.exports = { init, bindWindow, start, stop, toggle, getState, speak, handleTranscript, handleCommand };
