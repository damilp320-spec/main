// Лицензирование и тарифы (Free / Pro / Trial).
// Активация работает офлайн через контрольную сумму ключа. В продакшене
// ключи должны выдаваться и подписываться на сервере — здесь самодостаточный
// скелет, демонстрирующий тарифную модель и гейтинг функций.
const crypto = require('crypto');
const store = require('./store');

const SALT = 'NX1-nexus-ai-hub';
const TRIAL_DAYS = 14;

// Лимиты бесплатного тарифа. Pro снимает их.
const FREE_LIMITS = {
  agents: 5,        // всего агентов (включая шаблоны)
  tasks: 3,         // активных задач планировщика
  servers: 1,       // сохранённых SSH-подключений
  translateChars: 20000, // символов за один перевод
};

// Функции, доступные только в Pro/Trial.
const PRO_FEATURES = new Set([
  'cloud-bridge',     // мост к облачным моделям (резерв/ускорение)
  'rag-memory',       // память с эмбеддингами (RAG)
  'multi-agent',      // мультиагентные сценарии (swarm)
  'premium-themes',   // премиум-оформление
  'priority-support', // приоритетная поддержка
]);

function genKey(tier = 'PRO') {
  const body = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex
  const check = checksum(tier, body);
  return `NEXUS-${tier}-${body}-${check}`;
}

function checksum(tier, body) {
  return crypto.createHash('sha256').update(`${SALT}|${tier}|${body}`).digest('hex').slice(0, 4).toUpperCase();
}

function validateKey(key) {
  const m = /^NEXUS-([A-Z]+)-([0-9A-F]{8})-([0-9A-F]{4})$/.exec(String(key || '').trim().toUpperCase());
  if (!m) return { ok: false, error: 'Неверный формат ключа' };
  const [, tier, body, check] = m;
  if (checksum(tier, body) !== check) return { ok: false, error: 'Ключ недействителен' };
  if (tier !== 'PRO' && tier !== 'LIFE') return { ok: false, error: 'Неизвестный тариф' };
  return { ok: true, tier };
}

function getRaw() {
  return store.get('license', { plan: 'free', key: null, trialEndsAt: null, activatedAt: null });
}

function effectivePlan() {
  const l = getRaw();
  if (l.plan === 'pro') return 'pro';
  if (l.plan === 'trial' && l.trialEndsAt && Date.now() < l.trialEndsAt) return 'trial';
  return 'free';
}

function isPro() {
  const p = effectivePlan();
  return p === 'pro' || p === 'trial';
}

function status() {
  const l = getRaw();
  const plan = effectivePlan();
  let daysLeft = null;
  if (plan === 'trial') daysLeft = Math.ceil((l.trialEndsAt - Date.now()) / 86400000);
  return {
    plan,
    isPro: isPro(),
    daysLeft,
    trialUsed: !!l.trialEndsAt,
    key: l.key ? l.key.replace(/-[0-9A-F]{4}$/i, '-••••') : null,
    limits: FREE_LIMITS,
    proFeatures: [...PRO_FEATURES],
  };
}

function activate(key) {
  const v = validateKey(key);
  if (!v.ok) return v;
  store.set('license', { plan: 'pro', key: String(key).trim().toUpperCase(), trialEndsAt: getRaw().trialEndsAt, activatedAt: Date.now() });
  return { ok: true, plan: 'pro' };
}

function startTrial() {
  const l = getRaw();
  if (l.trialEndsAt) return { ok: false, error: 'Пробный период уже использовался' };
  store.set('license', { ...l, plan: 'trial', trialEndsAt: Date.now() + TRIAL_DAYS * 86400000 });
  return { ok: true, daysLeft: TRIAL_DAYS };
}

function deactivate() {
  const l = getRaw();
  store.set('license', { ...l, plan: 'free', key: null });
  return { ok: true };
}

// Проверка фичи / лимита. kind: имя фичи или 'agents'|'tasks'|'servers'|'translateChars'.
function can(kind, currentCount = 0) {
  if (isPro()) return { allowed: true };
  if (PRO_FEATURES.has(kind)) return { allowed: false, reason: 'pro-feature' };
  if (kind in FREE_LIMITS) {
    const limit = FREE_LIMITS[kind];
    if (currentCount >= limit) return { allowed: false, reason: 'limit', limit };
    return { allowed: true, limit, remaining: limit - currentCount };
  }
  return { allowed: true };
}

module.exports = { status, activate, startTrial, deactivate, can, isPro, validateKey, genKey, FREE_LIMITS, PRO_FEATURES };
