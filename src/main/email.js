// Email-ассистент: чтение заголовков по IMAP и отправка по SMTP.
// Минимальный клиент на tls без зависимостей. Пароль шифруется (safeStorage).
// Примечание: протестировать вживую можно только с реальным почтовым сервером.
const tls = require('tls');
const store = require('./store');
function secrets() { try { return require('./secrets'); } catch { return null; } }

function cfg() {
  const c = store.get('settings.email', {}) || {};
  return { imapHost: c.imapHost || '', imapPort: +c.imapPort || 993, smtpHost: c.smtpHost || '', smtpPort: +c.smtpPort || 465, user: c.user || '', from: c.from || c.user || '' };
}
function setCfg(patch) { store.set('settings.email', Object.assign(cfg(), patch || {})); return { ok: true, cfg: publicCfg() }; }
function publicCfg() { const c = cfg(); return { ...c, hasPassword: !!getPass() }; }
function setPass(p) { const s = secrets(); if (p && s && s.encrypt) { try { store.set('settings.emailPassEnc', s.encrypt(p)); return { ok: true, encrypted: true }; } catch {} } if (!p) store.set('settings.emailPassEnc', ''); return { ok: !!p, encrypted: false }; }
function getPass() { const e = store.get('settings.emailPassEnc', ''); const s = secrets(); if (e && s && s.decrypt) { try { return s.decrypt(e) || ''; } catch {} } return ''; }

// ---------------- IMAP ----------------
function imapFetch(limit = 15) {
  return new Promise((resolve) => {
    const c = cfg(); const pass = getPass();
    if (!c.imapHost || !c.user || !pass) return resolve({ ok: false, error: 'IMAP не настроен (хост/логин/пароль).' });
    let stage = 'greet', tagN = 0, buf = '', total = 0, pending = null, done = false;
    const sock = tls.connect({ host: c.imapHost, port: c.imapPort, servername: c.imapHost }, () => {});
    const finish = (res) => { if (done) return; done = true; try { sock.end(); } catch {} resolve(res); };
    sock.setTimeout(20000, () => finish({ ok: false, error: 'IMAP таймаут' }));
    sock.on('error', (e) => finish({ ok: false, error: 'IMAP: ' + e.message }));
    const send = (cmd) => { tagN++; const tag = 'a' + tagN; pending = tag; sock.write(tag + ' ' + cmd + '\r\n'); return tag; };
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      // Греетинг сервера.
      if (stage === 'greet' && /\* OK/i.test(buf)) { buf = ''; stage = 'login'; send('LOGIN ' + JSON.stringify(c.user) + ' ' + JSON.stringify(pass)); return; }
      const lines = buf.split(/\r\n/);
      for (const line of lines) {
        const m = /^a(\d+) (OK|NO|BAD)(.*)$/i.exec(line);
        const exm = /^\* (\d+) EXISTS/i.exec(line);
        if (exm) total = +exm[1];
        if (m) {
          const ok = m[2].toUpperCase() === 'OK';
          if (stage === 'login') { if (!ok) return finish({ ok: false, error: 'Авторизация IMAP отклонена.' }); buf = ''; stage = 'select'; send('SELECT INBOX'); return; }
          if (stage === 'select') { if (!ok) return finish({ ok: false, error: 'Не открыть INBOX.' }); if (!total) return finish({ ok: true, messages: [], total: 0 }); buf = ''; stage = 'fetch'; const from = Math.max(1, total - limit + 1); send(`FETCH ${from}:${total} (FLAGS ENVELOPE INTERNALDATE)`); return; }
          if (stage === 'fetch') { return finish({ ok: true, total, messages: parseEnvelopes(buf) }); }
        }
      }
    });
  });
}
// Лёгкий разбор FETCH/ENVELOPE: тема, отправитель, дата, флаг прочитанности.
function parseEnvelopes(text) {
  const out = [];
  const re = /\* (\d+) FETCH \(([\s\S]*?)\r\n(?=\* \d+ FETCH|a\d+ )/g; let m;
  const blocks = text.split(/\* \d+ FETCH /).slice(1);
  for (const b of blocks) {
    const seen = /\\Seen/.test((/FLAGS \(([^)]*)\)/.exec(b) || [])[1] || '');
    const env = /ENVELOPE \(([\s\S]*)/i.exec(b);
    let subject = '', from = '', date = '';
    if (env) {
      const quoted = env[1].match(/"((?:[^"\\]|\\.)*)"|NIL/g) || [];
      const unq = (s) => s && s !== 'NIL' ? s.replace(/^"|"$/g, '').replace(/\\(.)/g, '$1') : '';
      date = unq(quoted[0]); subject = unq(quoted[1]);
      const addr = /\(\("([^"]*)" NIL "([^"]*)" "([^"]*)"\)/.exec(env[1]);
      if (addr) from = (addr[1] && addr[1] !== 'NIL' ? addr[1] + ' ' : '') + '<' + addr[2] + '@' + addr[3] + '>';
    }
    out.push({ subject: subject || '(без темы)', from, date, seen });
  }
  return out.reverse();
}

// ---------------- SMTP ----------------
function smtpSend({ to, subject, body }) {
  return new Promise((resolve) => {
    const c = cfg(); const pass = getPass();
    if (!c.smtpHost || !c.user || !pass) return resolve({ ok: false, error: 'SMTP не настроен.' });
    if (!to) return resolve({ ok: false, error: 'Не указан получатель.' });
    const sock = tls.connect({ host: c.smtpHost, port: c.smtpPort, servername: c.smtpHost }, () => {});
    let step = 0, done = false; const finish = (r) => { if (done) return; done = true; try { sock.end(); } catch {} resolve(r); };
    const seq = [
      'EHLO mythera', 'AUTH LOGIN', Buffer.from(c.user).toString('base64'), Buffer.from(pass).toString('base64'),
      `MAIL FROM:<${c.from}>`, `RCPT TO:<${to}>`, 'DATA',
      `From: ${c.from}\r\nTo: ${to}\r\nSubject: ${subject || '(без темы)'}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body || ''}\r\n.`
    ];
    sock.setTimeout(20000, () => finish({ ok: false, error: 'SMTP таймаут' }));
    sock.on('error', (e) => finish({ ok: false, error: 'SMTP: ' + e.message }));
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString(); if (!/\r\n$/.test(buf)) return;
      const code = parseInt(buf.slice(0, 3), 10); buf = '';
      if (code >= 400) return finish({ ok: false, error: 'SMTP ответ ' + code });
      if (step < seq.length) sock.write(seq[step++] + '\r\n');
      else finish({ ok: true });
    });
  });
}

const toolSchemas = [
  { type: 'function', function: { name: 'list_emails', description: 'Показать последние письма во входящих (тема, отправитель, дата).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'send_email', description: 'Отправить письмо. ВНИМАНИЕ: отправляет реально.', parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'body'] } } }
];
const toolHandlers = {
  list_emails: async () => { const r = await imapFetch(12); return r.ok ? (r.messages.map((m) => `${m.seen ? '  ' : '● '}${m.subject} — ${m.from} (${m.date})`).join('\n') || 'Писем нет.') : 'ОШИБКА: ' + r.error; },
  send_email: async (a) => { const r = await smtpSend({ to: a.to, subject: a.subject, body: a.body }); return r.ok ? 'Письмо отправлено.' : 'ОШИБКА: ' + r.error; }
};

module.exports = { publicCfg, setCfg, setPass, getPass, imapFetch, smtpSend, toolSchemas, toolHandlers };
