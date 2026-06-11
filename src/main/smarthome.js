// Умный дом: поддержка множества протоколов, включая популярные в РФ/СНГ.
// Большинство экосистем достигаются через свой хаб/облако, поэтому исполнение
// маршрутизируется в один из РАБОЧИХ бэкендов:
//   • homeassistant — REST API HA (мост к Matter, Zigbee, HomeKit, Tuya, Xiaomi,
//     Sonoff, Aqara, ESPHome, Tasmota и сотням интеграций);
//   • mqtt — нативная публикация (Zigbee2MQTT, Tasmota, ESPHome, DIY);
//   • yandex — Умный дом Яндекс / Алиса (облачный IoT API);
//   • webhook — универсальный HTTP (Sber Салют сценарии, IFTTT, Tuya cloud,
//     Google Home routines, кастомные мосты).
const http = require('http');
const https = require('https');
const net = require('net');
const cfg = require('./store');
const secrets = require('./secrets');
const system = require('./system');

// Каталог протоколов для UI: что выбрать и как это исполняется.
const PROTOCOLS = [
  { id: 'homeassistant', name: 'Home Assistant', backend: 'ha', region: 'global', note: 'Универсальный хаб: Matter, Zigbee, HomeKit, Tuya, Xiaomi, Sonoff, Aqara…' },
  { id: 'mqtt', name: 'MQTT / Zigbee2MQTT', backend: 'mqtt', region: 'global', note: 'Tasmota, ESPHome, Zigbee2MQTT, DIY-устройства.' },
  { id: 'yandex', name: 'Яндекс Умный дом (Алиса)', backend: 'yandex', region: 'ru', note: 'Облачный IoT API Яндекса (OAuth-токен).' },
  { id: 'sber', name: 'SberDevices (Салют)', backend: 'webhook', region: 'ru', note: 'Через вебхук сценария Салют/SmartHome.' },
  { id: 'tuya', name: 'Tuya / Смарт Лайф', backend: 'webhook', region: 'global', note: 'Через Tuya Cloud webhook или HA.' },
  { id: 'xiaomi', name: 'Xiaomi Mi Home / Aqara', backend: 'ha', region: 'global', note: 'Через Home Assistant.' },
  { id: 'google', name: 'Google Home', backend: 'webhook', region: 'global', note: 'Через рутины/вебхук.' },
  { id: 'homekit', name: 'Apple HomeKit', backend: 'ha', region: 'global', note: 'Через Home Assistant Bridge.' },
  { id: 'matter', name: 'Matter', backend: 'ha', region: 'global', note: 'Через Matter-контроллер в HA.' },
  { id: 'tasmota', name: 'Tasmota', backend: 'mqtt', region: 'global', note: 'MQTT или HTTP-команды.' },
  { id: 'esphome', name: 'ESPHome', backend: 'ha', region: 'global', note: 'Через Home Assistant.' },
  { id: 'sonoff', name: 'Sonoff / eWeLink', backend: 'webhook', region: 'global', note: 'Через eWeLink webhook или HA.' },
  { id: 'ifttt', name: 'IFTTT', backend: 'webhook', region: 'global', note: 'Webhook-триггер Maker.' },
  { id: 'webhook', name: 'Универсальный вебхук', backend: 'webhook', region: 'global', note: 'Любой HTTP GET/POST.' }
];

function backendFor(proto) { const p = PROTOCOLS.find((x) => x.id === proto); return p ? p.backend : 'webhook'; }

/* ---------- Хранилище устройств (секреты шифруются) ---------- */
const SECRET_KEYS = ['token', 'password', 'apiKey', 'clientSecret'];

function listDevices() {
  return cfg.get('smarthome', []).map((d) => ({ id: d.id, name: d.name, protocol: d.protocol, entity: d.entity, host: d.host }));
}
function rawDevices() { return cfg.get('smarthome', []); }

function saveDevice(dev) {
  const list = rawDevices();
  if (!dev.id) dev.id = 'dev-' + Math.random().toString(36).slice(2, 9);
  const idx = list.findIndex((d) => d.id === dev.id);
  // Шифруем секреты; пустые при редактировании — берём из старого.
  for (const k of SECRET_KEYS) {
    if (dev[k]) dev[k] = secrets.encrypt(dev[k]);
    else if (idx >= 0 && list[idx][k]) dev[k] = list[idx][k];
  }
  if (idx >= 0) list[idx] = dev; else list.push(dev);
  cfg.set('smarthome', list);
  return { id: dev.id };
}
function deleteDevice(id) { cfg.set('smarthome', rawDevices().filter((d) => d.id !== id)); return { ok: true }; }

function getDevice(ref) {
  const list = rawDevices();
  const d = list.find((x) => x.id === ref) || list.find((x) => x.name && x.name.toLowerCase() === String(ref).toLowerCase());
  if (!d) return null;
  const out = { ...d };
  for (const k of SECRET_KEYS) if (out[k]) out[k] = secrets.decrypt(out[k]);
  return out;
}

/* ---------- HTTP-помощник ---------- */
function httpReq(method, url, headers, body) {
  return new Promise((resolve) => {
    if (!system.isSafeUrl(url)) return resolve({ ok: false, error: 'Недопустимый URL' });
    const lib = url.startsWith('https') ? https : http;
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const u = new URL(url);
    const req = lib.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers }, timeout: 10000 }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, body: buf.slice(0, 2000) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'таймаут' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

/* ---------- Нативная публикация MQTT (3.1.1) ---------- */
function mqttPublish({ host, port, username, password, topic, payload }) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port: port || 1883, timeout: 8000 });
    const enc = (s) => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
    sock.on('connect', () => {
      // CONNECT
      let payloadBuf = enc('mythera-' + Math.random().toString(36).slice(2, 8));
      let flags = 0x02; // clean session
      if (username) { flags |= 0x80; payloadBuf = Buffer.concat([payloadBuf, enc(username)]); }
      if (password) { flags |= 0x40; payloadBuf = Buffer.concat([payloadBuf, enc(password)]); }
      const varHeader = Buffer.concat([enc('MQTT'), Buffer.from([0x04, flags, 0, 60])]);
      const connect = Buffer.concat([varHeader, payloadBuf]);
      sock.write(Buffer.concat([Buffer.from([0x10, connect.length]), connect]));
    });
    let connected = false;
    sock.on('data', (d) => {
      if (!connected && d[0] === 0x20) { // CONNACK
        connected = true;
        const t = enc(topic);
        const body = Buffer.concat([t, Buffer.from(String(payload))]);
        // PUBLISH QoS0
        const len = body.length;
        const lenBytes = [];
        let x = len; do { let e = x % 128; x = Math.floor(x / 128); if (x > 0) e |= 128; lenBytes.push(e); } while (x > 0);
        sock.write(Buffer.concat([Buffer.from([0x30, ...lenBytes]), body]));
        sock.write(Buffer.from([0xE0, 0])); // DISCONNECT
        sock.end();
        resolve({ ok: true });
      }
    });
    sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, error: 'таймаут MQTT' }); });
    sock.on('error', (e) => resolve({ ok: false, error: e.message }));
    sock.on('close', () => { if (!connected) resolve({ ok: false, error: 'нет соединения с брокером' }); });
  });
}

/* ---------- Исполнение действия ---------- */
// action: 'on' | 'off' | 'toggle' | 'set' ; value — яркость/значение/команда
async function execute(ref, action, value) {
  const d = getDevice(ref);
  if (!d) return { ok: false, error: 'Устройство не найдено: ' + ref };
  const backend = backendFor(d.protocol);

  if (backend === 'ha') {
    // Home Assistant REST: POST /api/services/<domain>/<service>
    const base = (d.host || '').replace(/\/$/, '');
    const entity = d.entity; // напр. light.kitchen
    const domain = (entity || 'homeassistant').split('.')[0];
    let service = action === 'off' ? 'turn_off' : action === 'toggle' ? 'toggle' : 'turn_on';
    const body = { entity_id: entity };
    if (action === 'set' && value != null) { if (domain === 'light') body.brightness_pct = +value; else body.value = value; }
    const r = await httpReq('POST', `${base}/api/services/${domain}/${service}`, { Authorization: 'Bearer ' + (d.token || '') }, body);
    return r.ok ? { ok: true, info: `HA ${entity} → ${service}` } : { ok: false, error: r.error || ('HTTP ' + r.status) };
  }

  if (backend === 'mqtt') {
    // Zigbee2MQTT/Tasmota: топик из настроек, payload по действию.
    const topic = d.entity || d.topic || 'zigbee2mqtt/device/set';
    let payload = d.payloadTemplate;
    if (!payload) payload = action === 'set' ? JSON.stringify({ brightness: +value }) : JSON.stringify({ state: action === 'off' ? 'OFF' : action === 'toggle' ? 'TOGGLE' : 'ON' });
    else payload = payload.replace('{action}', action).replace('{value}', value == null ? '' : value);
    const r = await mqttPublish({ host: d.host, port: d.port, username: d.username, password: d.password, topic, payload });
    return r.ok ? { ok: true, info: `MQTT ${topic} ← ${payload}` } : r;
  }

  if (backend === 'yandex') {
    // Яндекс Умный дом: задаём состояние on_off.
    const r = await httpReq('POST', 'https://api.iot.yandex.net/v1.0/devices/actions',
      { Authorization: 'Bearer ' + (d.token || '') },
      { devices: [{ id: d.entity, actions: [{ type: 'devices.capabilities.on_off', state: { instance: 'on', value: action !== 'off' } }] }] });
    return r.ok ? { ok: true, info: 'Яндекс: ' + d.entity } : { ok: false, error: r.error || ('HTTP ' + r.status) };
  }

  // webhook (Sber, IFTTT, Tuya cloud, кастом): подставляем {action}/{value} в URL/тело.
  const method = d.method || 'POST';
  const url = (d.host || '').replace('{action}', action).replace('{value}', value == null ? '' : encodeURIComponent(value));
  const bodyTpl = d.payloadTemplate ? d.payloadTemplate.replace('{action}', action).replace('{value}', value == null ? '' : value) : JSON.stringify({ action, value });
  const headers = d.apiKey ? { Authorization: 'Bearer ' + d.apiKey } : {};
  const r = await httpReq(method, url, headers, method === 'GET' ? null : bodyTpl);
  return r.ok ? { ok: true, info: 'Webhook отправлен' } : { ok: false, error: r.error || ('HTTP ' + r.status) };
}

async function test(id) { return execute(id, 'toggle'); }

/* ------ Инструменты для агентов ------ */
const toolSchemas = [
  { type: 'function', function: { name: 'smart_home', description: 'Управление устройствами умного дома. action: on, off, toggle, set. value — яркость/значение (для set).', parameters: { type: 'object', properties: { device: { type: 'string', description: 'имя или id устройства' }, action: { type: 'string' }, value: { type: 'string' } }, required: ['device', 'action'] } } },
  { type: 'function', function: { name: 'smart_home_list', description: 'Список настроенных устройств умного дома.', parameters: { type: 'object', properties: {} } } }
];
const toolHandlers = {
  async smart_home({ device, action, value }) { const r = await execute(device, action, value); return r.ok ? '✅ ' + (r.info || 'выполнено') : 'Ошибка: ' + r.error; },
  async smart_home_list() { const l = listDevices(); return l.length ? l.map((d) => `${d.name} [${d.protocol}]`).join('\n') : 'Устройств нет. Добавьте в разделе «Умный дом».'; }
};

module.exports = { PROTOCOLS, listDevices, saveDevice, deleteDevice, execute, test, toolSchemas, toolHandlers };
