// Понимание браузера: открытие сайтов и запуск музыки в системном браузере.
// БЕЗ встроенного плеера — мы лишь открываем нужную страницу/поиск в браузере
// по умолчанию (Spotify, Apple Music, YouTube Music, Яндекс Музыка, VK и т.д.).
const { shell } = require('electron');
const cfg = require('./store');
const system = require('./system');

// Музыкальные сервисы: как построить URL поиска/воспроизведения.
const MUSIC = {
  spotify: { name: 'Spotify', url: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}` },
  apple: { name: 'Apple Music', url: (q) => `https://music.apple.com/search?term=${encodeURIComponent(q)}` },
  ytmusic: { name: 'YouTube Music', url: (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}` },
  youtube: { name: 'YouTube', url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  yandex: { name: 'Яндекс Музыка', url: (q) => `https://music.yandex.ru/search?text=${encodeURIComponent(q)}` },
  vk: { name: 'VK Музыка', url: (q) => `https://vk.com/audio?q=${encodeURIComponent(q)}` },
  zvuk: { name: 'Звук', url: (q) => `https://zvuk.com/search?query=${encodeURIComponent(q)}` },
  soundcloud: { name: 'SoundCloud', url: (q) => `https://soundcloud.com/search?q=${encodeURIComponent(q)}` },
  deezer: { name: 'Deezer', url: (q) => `https://www.deezer.com/search/${encodeURIComponent(q)}` }
};

// Популярные веб-сервисы для команды «открой …».
const SERVICES = {
  youtube: 'https://youtube.com', gmail: 'https://mail.google.com', github: 'https://github.com',
  maps: 'https://maps.google.com', translate: 'https://translate.google.com', chatgpt: 'https://chatgpt.com',
  vk: 'https://vk.com', telegram: 'https://web.telegram.org', whatsapp: 'https://web.whatsapp.com',
  yandex: 'https://ya.ru', google: 'https://google.com', wikipedia: 'https://wikipedia.org',
  netflix: 'https://netflix.com', kinopoisk: 'https://kinopoisk.ru', twitch: 'https://twitch.tv',
  ozon: 'https://ozon.ru', wildberries: 'https://wildberries.ru', aliexpress: 'https://aliexpress.ru'
};

function defaultMusic() { return cfg.get('settings.musicService', 'ytmusic'); }

function openUrl(url) {
  if (!system.isSafeUrl(url)) return { ok: false, error: 'Недопустимый URL' };
  shell.openExternal(url);
  return { ok: true, url };
}

function playMusic(query, service) {
  const key = (service || '').toLowerCase();
  const svc = MUSIC[key] || MUSIC[defaultMusic()] || MUSIC.ytmusic;
  if (!query) return { ok: false, error: 'Не указано, что включить' };
  const url = svc.url(query);
  shell.openExternal(url);
  return { ok: true, service: svc.name, url, query };
}

function openService(name) {
  const key = String(name || '').toLowerCase().trim();
  // Прямой сервис.
  if (SERVICES[key]) { shell.openExternal(SERVICES[key]); return { ok: true, url: SERVICES[key] }; }
  // Иначе — поисковый запрос в Google.
  const url = `https://www.google.com/search?q=${encodeURIComponent(name)}`;
  shell.openExternal(url);
  return { ok: true, url, search: true };
}

function webSearch(query, engine) {
  const engines = { google: 'https://www.google.com/search?q=', yandex: 'https://yandex.ru/search/?text=', bing: 'https://www.bing.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=' };
  const base = engines[(engine || 'google').toLowerCase()] || engines.google;
  const url = base + encodeURIComponent(query);
  shell.openExternal(url);
  return { ok: true, url };
}

/* ------ Инструменты для агентов ------ */
const toolSchemas = [
  { type: 'function', function: { name: 'play_music', description: 'Включить музыку в браузере: открывает поиск/трек в музыкальном сервисе. service: spotify, apple, ytmusic, youtube, yandex, vk, zvuk, soundcloud, deezer (по умолчанию — из настроек).', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Что включить: трек, исполнитель, плейлист' }, service: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'open_website', description: 'Открыть сайт или известный сервис в браузере по умолчанию (например youtube, gmail, github, ozon).', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Имя сервиса или URL' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'web_search_open', description: 'Открыть поисковый запрос в браузере. engine: google, yandex, bing, duckduckgo.', parameters: { type: 'object', properties: { query: { type: 'string' }, engine: { type: 'string' } }, required: ['query'] } } }
];

const toolHandlers = {
  async play_music({ query, service }) { const r = playMusic(query, service); return r.ok ? `Открываю «${query}» в ${r.service}: ${r.url}` : 'Ошибка: ' + r.error; },
  async open_website({ name }) { const r = openService(name); return r.ok ? 'Открыто: ' + r.url : 'Ошибка'; },
  async web_search_open({ query, engine }) { const r = webSearch(query, engine); return 'Открыт поиск: ' + r.url; }
};

function musicServices() { return Object.entries(MUSIC).map(([id, s]) => ({ id, name: s.name })); }

module.exports = { openUrl, playMusic, openService, webSearch, musicServices, toolSchemas, toolHandlers };
