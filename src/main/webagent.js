// Управляемая автоматизация браузера через встроенный Electron BrowserView —
// БЕЗ внешних зависимостей (никакого Puppeteer/Playwright). Агент может
// открывать страницы, читать текст, кликать, печатать, делать скриншоты.
//
// Безопасность: используется отдельный BrowserView с изоляцией; навигация
// разрешена только по http(s). По умолчанию модуль включается настройкой
// settings.webAutomation.
const store = require('./store');

let BrowserView, getWin;
let view = null;
let visible = false;

function init(deps) {
  getWin = deps.getWin;
  try { BrowserView = require('electron').BrowserView; } catch { BrowserView = null; }
}

function enabled() { return store.get('settings.webAutomation', false); }

function ensureView() {
  if (!enabled()) throw new Error('Веб-автоматизация выключена в настройках (settings.webAutomation).');
  if (!BrowserView) throw new Error('BrowserView недоступен в этой сборке Electron.');
  const win = getWin && getWin();
  if (!win) throw new Error('Окно приложения недоступно.');
  if (!view) {
    view = new BrowserView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) view.webContents.loadURL(url);
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (e, url) => { if (!/^https?:\/\//i.test(url)) e.preventDefault(); });
  }
  return { win, view };
}

// Показать/скрыть встроенный браузер поверх контента (право-нижняя панель).
function setVisible(v) {
  const { win } = ensureView();
  if (v && !visible) {
    win.addBrowserView(view);
    const b = win.getContentBounds();
    // Панель браузера: правая половина окна, ниже титула.
    view.setBounds({ x: Math.round(b.width * 0.45), y: 80, width: Math.round(b.width * 0.55) - 8, height: b.height - 96 });
    view.setAutoResize({ width: true, height: true });
    visible = true;
  } else if (!v && visible) {
    try { win.removeBrowserView(view); } catch { /* noop */ }
    visible = false;
  }
}

function wc() { return ensureView().view.webContents; }

async function goto(url) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  ensureView();
  if (store.get('settings.webAutomationShow', true)) setVisible(true);
  await wc().loadURL(url);
  await new Promise((r) => setTimeout(r, 600));
  return `Открыта страница: ${wc().getURL()} — «${wc().getTitle()}»`;
}

async function readPage() {
  const txt = await wc().executeJavaScript(
    `(() => { const b=document.body; if(!b) return ''; const t=(b.innerText||'').replace(/\\n{3,}/g,'\\n\\n').trim(); return t.slice(0, 6000); })()`
  );
  return txt || '(пусто)';
}

// Клик по CSS-селектору ИЛИ по видимому тексту ссылки/кнопки.
async function click(target) {
  const t = JSON.stringify(String(target || ''));
  const ok = await wc().executeJavaScript(`(() => {
    const sel = ${t};
    let el = null;
    try { el = document.querySelector(sel); } catch (e) {}
    if (!el) {
      const cands = [...document.querySelectorAll('a,button,[role=button],input[type=submit]')];
      el = cands.find((x) => (x.innerText||x.value||'').trim().toLowerCase().includes(sel.toLowerCase()));
    }
    if (!el) return false;
    el.scrollIntoView({block:'center'}); el.click(); return true;
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  return ok ? `Клик выполнен: ${target}` : `Не найден элемент: ${target}`;
}

async function type(selector, text) {
  const s = JSON.stringify(String(selector || '')); const v = JSON.stringify(String(text || ''));
  const ok = await wc().executeJavaScript(`(() => {
    let el=null; try { el=document.querySelector(${s}); } catch(e){}
    if(!el) el=document.querySelector('input,textarea');
    if(!el) return false;
    el.focus(); el.value=${v};
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  return ok ? `Введён текст в ${selector}` : `Поле не найдено: ${selector}`;
}

async function screenshot() {
  const img = await wc().capturePage();
  return { base64: img.toPNG().toString('base64') };
}

async function back() { try { wc().goBack(); await new Promise((r) => setTimeout(r, 400)); return 'Назад'; } catch { return 'Назад невозможно'; } }

function close() { try { if (visible) setVisible(false); } catch {} view = null; }

const toolSchemas = [
  { type: 'function', function: { name: 'web_goto', description: 'Открыть веб-страницу во встроенном браузере приложения (для дальнейшего чтения/кликов).', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Адрес страницы' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'web_read', description: 'Прочитать видимый текст текущей открытой страницы.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'web_click', description: 'Кликнуть по элементу страницы — по CSS-селектору или по тексту ссылки/кнопки.', parameters: { type: 'object', properties: { target: { type: 'string', description: 'CSS-селектор или видимый текст элемента' } }, required: ['target'] } } },
  { type: 'function', function: { name: 'web_type', description: 'Ввести текст в поле на странице (CSS-селектор поля + текст).', parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'web_back', description: 'Вернуться на предыдущую страницу.', parameters: { type: 'object', properties: {} } } }
];

const toolHandlers = {
  web_goto: (a) => goto(a.url),
  web_read: () => readPage(),
  web_click: (a) => click(a.target),
  web_type: (a) => type(a.selector, a.text),
  web_back: () => back()
};

module.exports = { init, toolSchemas, toolHandlers, goto, readPage, click, type, screenshot, back, setVisible, close, enabled };
