// Плагины-«скилы»: расширяемые навыки агентов.
// Скил — ДЕКЛАРАТИВНЫЙ манифест (не произвольный JS, чтобы не открывать дыру).
// Типы: 'command' (шаблон команды, проходит ТОТ ЖЕ фильтр опасных команд),
//       'http' (запрос к URL, только http/https).
// Скилы превращаются в инструменты агента (tool-calling).
const cfg = require('./store');
const system = require('./system');
const https = require('https');
const http = require('http');

const BUILTIN = [
  { id: 'skill-gitstatus', name: 'git_status', label: 'Git статус', type: 'command', description: 'Показать статус git-репозитория в рабочем пространстве.', params: [], template: 'git status && git log --oneline -5' },
  { id: 'skill-ipinfo', name: 'public_ip', label: 'Публичный IP', type: 'http', description: 'Узнать публичный IP-адрес и геолокацию.', method: 'GET', params: [], template: 'https://ipinfo.io/json' },
  { id: 'skill-diskspace', name: 'disk_space', label: 'Свободное место', type: 'command', description: 'Показать свободное место на дисках.', params: [], template: process.platform === 'win32' ? 'Get-PSDrive -PSProvider FileSystem' : 'df -h' },
  { id: 'skill-weather', name: 'weather', label: 'Погода', type: 'http', description: 'Погода в указанном городе.', method: 'GET', params: [{ name: 'city', description: 'Город' }], template: 'https://wttr.in/{city}?format=3' }
];

function sanitizeName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'skill'; }

function listSkills() {
  const user = cfg.get('skills', null);
  if (!user) { cfg.set('skills', BUILTIN); return BUILTIN.slice(); }
  return user;
}

function saveSkill(skill) {
  const list = listSkills();
  skill.name = sanitizeName(skill.name || skill.label);
  if (!skill.id) skill.id = 'skill-' + Math.random().toString(36).slice(2, 9);
  const idx = list.findIndex((s) => s.id === skill.id);
  if (idx >= 0) list[idx] = skill; else list.push(skill);
  cfg.set('skills', list);
  return skill;
}

function deleteSkill(id) { cfg.set('skills', listSkills().filter((s) => s.id !== id)); return { ok: true }; }

function fill(tpl, args) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => encodeArg(args[k]));
}
function encodeArg(v) { return v == null ? '' : String(v); }

// Скилы как схемы инструментов для модели.
function toolSchemas() {
  return listSkills().filter((s) => s.enabled !== false).map((s) => ({
    type: 'function',
    function: {
      name: s.name,
      description: '[Скил] ' + (s.description || s.label),
      parameters: {
        type: 'object',
        properties: Object.fromEntries((s.params || []).map((p) => [p.name, { type: 'string', description: p.description || '' }])),
        required: (s.params || []).map((p) => p.name)
      }
    }
  }));
}

function findByTool(name) { return listSkills().find((s) => s.name === name && s.enabled !== false); }

async function runSkill(name, args) {
  const s = findByTool(name);
  if (!s) return null; // не наш инструмент
  if (s.type === 'command') {
    const cmd = fill(s.template, args || {});
    return system.callTool('run_command', { command: cmd }); // проходит фильтр опасных команд
  }
  if (s.type === 'http') {
    let url = fill(s.template, args || {});
    if (!system.isSafeUrl(url)) return 'Скил заблокирован: недопустимый URL.';
    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, { timeout: 15000, headers: { 'User-Agent': 'curl/8' } }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; if (buf.length > 16000) req.destroy(); });
        res.on('end', () => resolve(buf.slice(0, 8000)));
      });
      req.on('timeout', () => { req.destroy(); resolve('Таймаут запроса.'); });
      req.on('error', (e) => resolve('Ошибка: ' + e.message));
    });
  }
  return 'Неизвестный тип скила.';
}

function isSkillTool(name) { return !!findByTool(name); }

function exportSkill(id) {
  const s = listSkills().find((x) => x.id === id);
  if (!s) return null;
  return { _type: 'mythera-skill', version: 1, name: s.name, label: s.label, type: s.type, description: s.description, method: s.method, params: s.params, template: s.template };
}

function importSkill(obj) {
  if (!obj || obj._type !== 'mythera-skill') return { ok: false, error: 'Это не файл скила Mythera' };
  if (!['command', 'http'].includes(obj.type)) return { ok: false, error: 'Недопустимый тип скила' };
  const skill = saveSkill({ name: obj.name, label: obj.label || obj.name, type: obj.type, description: obj.description || '', method: obj.method || 'GET', params: Array.isArray(obj.params) ? obj.params : [], template: String(obj.template || '') });
  return { ok: true, skill };
}

module.exports = { listSkills, saveSkill, deleteSkill, toolSchemas, runSkill, isSkillTool, exportSkill, importSkill };
