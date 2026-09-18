// Рендерер мини-окна быстрого запуска. Использует window.mythera (preload).
const N = window.mythera;
const $ = (s) => document.querySelector(s);
let ctx = { clipboard: '', activeWindow: '' };
let useContext = true;
let busy = false;

async function refreshContext() {
  try { ctx = await N.quickask.context(); } catch { ctx = { clipboard: '', activeWindow: '' }; }
  const box = $('#q-ctx');
  const parts = [];
  if (ctx.activeWindow) parts.push(`<b>Окно:</b> ${esc(ctx.activeWindow).slice(0, 80)}`);
  if (ctx.clipboard) parts.push(`<b>Буфер:</b> ${esc(ctx.clipboard).slice(0, 100)}${ctx.clipboard.length > 100 ? '…' : ''}`);
  if (parts.length && useContext) { box.innerHTML = parts.join(' &nbsp;·&nbsp; '); box.classList.add('on'); }
  else box.classList.remove('on');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

N.on('quickask:open', async () => {
  $('#q-in').value = '';
  $('#q-body').innerHTML = '<span class="qa-empty">Контекст активного окна и буфера обмена подхватывается автоматически.</span>';
  await refreshContext();
  setTimeout(() => $('#q-in').focus(), 30);
});

async function run() {
  if (busy) return;
  const text = $('#q-in').value.trim();
  if (!text) return;
  busy = true;
  $('#q-body').innerHTML = '<span class="spin">⏳</span> Думаю…';
  let message = text;
  if (useContext && (ctx.clipboard || ctx.activeWindow)) {
    message = text + '\n\n[Контекст]' +
      (ctx.activeWindow ? `\nАктивное окно: ${ctx.activeWindow}` : '') +
      (ctx.clipboard ? `\nБуфер обмена:\n${ctx.clipboard}` : '');
  }
  try {
    const agents = await N.agents.list();
    const agentId = (agents[0] && agents[0].id) || 'tpl-assistant';
    const r = await N.agents.chat({ agentId, message, history: [], effort: 'fast' });
    $('#q-body').textContent = (r && r.text) || '(пусто)';
  } catch (e) {
    $('#q-body').textContent = 'Ошибка: ' + e.message;
  }
  busy = false;
}

$('#q-go').onclick = run;
$('#q-in').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); run(); }
  if (e.key === 'Escape') { e.preventDefault(); N.quickask.hide(); }
});
$('#q-ctxbtn').onclick = () => { useContext = !useContext; $('#q-ctxbtn').textContent = '📎 контекст: ' + (useContext ? 'вкл' : 'выкл'); refreshContext(); };
