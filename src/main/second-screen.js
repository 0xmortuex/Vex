// === The second-screen window: a game's guide, on the other monitor ==========
//
// T2-049. While a game is full screen on one monitor, the guide for it (the
// pages saved in Game mode, a loadout card's source) belongs on the other one.
// This is a window of Vex's own for exactly that.
//
// What it is NOT, on purpose (anti-cheat perception, and the owner's rule):
//   - never always-on-top, never full screen, never an overlay: an ordinary
//     window you can alt-tab to, so it can never sit over a game;
//   - it never reads, hooks or screenshots a game: it knows a game is running
//     only from the program name Vex already watches for;
//   - with a game running and only ONE monitor it refuses to open, with the
//     reason, instead of opening on top of the game;
//   - with two monitors it opens on the one that is not the primary (the game
//     is normally on the primary) unless it remembers where it was.
//
// It shows ordinary http(s) pages in its own session partition (no Vex
// preload, no node, permissions denied, downloads cancelled, popups denied).
// Keys: Ctrl+Tab / Ctrl+Shift+Tab next / previous page, Ctrl+= Ctrl+- Ctrl+0
// the zoom (the "big text"), Ctrl+W closes it. No chrome beyond the title bar.
//
// Pure helpers first (tested without Electron), then the window.
const MAX_PAGES = 12;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
const DEFAULT_ZOOM = 1.4;           // "big text": the second screen is read from a chair, not a desk
const DEFAULT_SIZE = { width: 720, height: 900 };
const PARTITION = 'persist:vex-second-screen';
const MAX_TIMERS = 24;
const EVERY_CHOICES = [0, 86400000, 604800000];    // one-off, daily, weekly

// [{ title, url }] -> the same, cleaned. Throws on anything but http(s).
function cleanPages(pages) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('There is no page to show on the second screen');
  if (pages.length > MAX_PAGES) throw new Error('The second screen shows up to ' + MAX_PAGES + ' pages');
  return pages.map((p, i) => {
    if (!p || typeof p.url !== 'string') throw new Error('Page ' + (i + 1) + ' has no address');
    let u;
    try { u = new URL(p.url); } catch (err) { throw new Error('Page ' + (i + 1) + ' is not an address', { cause: err }); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https pages can be shown on the second screen');
    return { title: String(p.title || u.hostname).slice(0, 120), url: u.href };
  });
}

// [{ name, at, every }] -> the same, cleaned. `at` is the next moment (ms), `every` the period (0 = one-off).
function cleanTimers(timers) {
  if (timers === undefined || timers === null) return [];
  if (!Array.isArray(timers)) throw new Error('The timers are a list');
  if (timers.length > MAX_TIMERS) throw new Error('The second screen shows up to ' + MAX_TIMERS + ' timers');
  return timers.map((t, i) => {
    if (!t || typeof t.name !== 'string' || !t.name.trim()) throw new Error('Timer ' + (i + 1) + ' has no name');
    if (!Number.isFinite(t.at) || t.at <= 0) throw new Error('Timer ' + (i + 1) + ' has no moment');
    if (!EVERY_CHOICES.includes(t.every)) throw new Error('Timer ' + (i + 1) + ' repeats in a way the second screen does not know');
    return { name: t.name.trim().slice(0, 60), at: t.at, every: t.every };
  });
}

// The page of reset timers: plain text, counted down in the window itself. The names are put in
// as data (JSON with < escaped), never as markup, and the page may not load or run anything else.
function timersHtml(timers) {
  const data = JSON.stringify(timers).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, ' ');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">'
    + '<title>Reset timers</title><style>'
    + 'body{margin:0;padding:24px;background:#111;color:#eee;font:20px/1.4 system-ui,sans-serif}h1{font-size:22px;margin:0 0 16px;font-weight:600}'
    + 'ul{list-style:none;margin:0;padding:0}li{display:flex;justify-content:space-between;gap:24px;padding:12px 0;border-top:1px solid #333}li:first-child{border-top:0}'
    + '.t{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}.n{opacity:.9}.d{opacity:.6;font-size:15px}'
    + '</style></head><body><h1>Reset timers</h1><ul id="l"></ul>'
    + '<script>const T=' + data + ';'
    + 'function nextAt(t,now){if(!t.every)return t.at>=now?t.at:null;if(t.at>=now)return t.at;return t.at+Math.ceil((now-t.at)/t.every)*t.every;}'
    + 'function span(ms){const s=Math.max(0,Math.floor(ms/1000)),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60;'
    + 'return d?d+" d "+h+" h":h?h+" h "+m+" min":m?m+" min "+x+" s":x+" s";}'
    + 'function draw(){const now=Date.now(),l=document.getElementById("l");l.textContent="";'
    + 'const rows=T.map(t=>({t,n:nextAt(t,now)})).sort((a,b)=>(a.n==null)-(b.n==null)||a.n-b.n);'
    + 'for(const r of rows){const li=document.createElement("li"),a=document.createElement("span"),b=document.createElement("span");'
    + 'a.className="n";a.textContent=r.t.name;b.className="t";b.textContent=r.n==null?"has passed":span(r.n-now);li.append(a,b);l.appendChild(li);}'
    + 'if(!rows.length){const li=document.createElement("li");li.textContent="No timers.";l.appendChild(li);}}'
    + 'draw();setInterval(draw,1000);'
    + '</script></body></html>';
}

function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) throw new Error('The zoom is a number');
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 100) / 100;
}

// displays: [{ id, bounds, workArea }] (Electron's shape). Returns the display
// to open on, or throws when opening would put it over a game.
//   savedId   the display it was last on, if that display is still connected
//   gameRunning  a game is known to be running (a program name, nothing more)
function pickDisplay({ displays, primaryId, savedId, gameRunning }) {
  if (!Array.isArray(displays) || !displays.length) throw new Error('No display is connected');
  const saved = savedId != null && displays.find(d => d.id === savedId);
  if (displays.length === 1) {
    if (gameRunning) throw new Error('A game is running and there is only one screen. The second-screen window would sit over the game, so it stays closed. Connect a second monitor, or close it after the game.');
    return displays[0];
  }
  if (saved && !(gameRunning && saved.id === primaryId)) return saved;
  return displays.find(d => d.id !== primaryId) || displays[0];
}

// Is a saved rectangle still mostly on `display`?
function fitsDisplay(b, display) {
  if (!b || !display || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return false;
  const a = display.workArea;
  const vx = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
  const vy = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
  return vx >= 160 && vy >= 120;
}

// Where to put a window of `size` on `display`: the saved bounds if they fit
// there, else centred on its work area.
function placeOn(display, saved, size = DEFAULT_SIZE) {
  if (fitsDisplay(saved, display)) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  const a = display.workArea;
  const width = Math.min(size.width, a.width);
  const height = Math.min(size.height, a.height);
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
}

// Which key does what. -> 'next' | 'prev' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'close' | null
function keyAction(input) {
  if (!input || input.type !== 'keyDown') return null;
  const ctrl = !!(input.control || input.meta);
  if (!ctrl) return null;
  const k = String(input.key || '');
  if (k === 'Tab') return input.shift ? 'prev' : 'next';
  if (k === '=' || k === '+') return 'zoom-in';
  if (k === '-' || k === '_') return 'zoom-out';
  if (k === '0') return 'zoom-reset';
  if (k === 'w' || k === 'W') return 'close';
  return null;
}

// deps: { BrowserWindow, screen, session, readState(), writeState(obj), isGameRunning(), log }
function createSecondScreen(deps) {
  const { BrowserWindow, screen, session, readState, writeState, isGameRunning } = deps;
  const log = deps.log || ((m) => console.error(m));
  let win = null;
  let pages = [];
  let index = 0;
  let zoom = DEFAULT_ZOOM;
  let configured = false;

  function configureSession() {
    if (configured) return;
    const ses = session.fromPartition(PARTITION);
    // A guide page asks for nothing: not the camera, the microphone, the location or notifications.
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => { e.preventDefault(); });
    configured = true;
  }

  function title() {
    const p = pages[index];
    return 'Vex second screen' + (p ? ': ' + p.title + ' (' + (index + 1) + '/' + pages.length + ')' : '');
  }

  function show() {
    if (!win || win.isDestroyed()) return;
    const p = pages[index];
    win.setTitle(title());
    const target = p.timers ? 'data:text/html;charset=utf-8,' + encodeURIComponent(timersHtml(p.timers)) : p.url;
    win.loadURL(target).catch((err) => { if (err && err.code !== 'ERR_ABORTED') log('[SecondScreen] could not load ' + p.url + ': ' + err.message); });
  }

  function persist() {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const bounds = win.getBounds();
    const d = screen.getDisplayMatching(bounds);
    writeState({ bounds, displayId: d.id, zoom });
  }

  function setZoom(z) {
    zoom = clampZoom(z);
    if (win && !win.isDestroyed()) win.webContents.setZoomFactor(zoom);
    persist();
    return zoom;
  }

  function act(action) {
    if (action === 'next') { index = (index + 1) % pages.length; show(); }
    else if (action === 'prev') { index = (index - 1 + pages.length) % pages.length; show(); }
    else if (action === 'zoom-in') setZoom(zoom + ZOOM_STEP);
    else if (action === 'zoom-out') setZoom(zoom - ZOOM_STEP);
    else if (action === 'zoom-reset') setZoom(DEFAULT_ZOOM);
    else if (action === 'close') close();
  }

  function open({ pages: given, index: at = 0, zoom: z, timers: givenTimers }) {
    const timers = cleanTimers(givenTimers);
    const clean = Array.isArray(given) && given.length ? cleanPages(given) : [];
    if (!clean.length && !timers.length) throw new Error('There is no page to show on the second screen');
    if (timers.length) clean.push({ title: 'Reset timers', url: '', timers });
    const saved = readState() || {};
    const displays = screen.getAllDisplays();
    const display = pickDisplay({ displays, primaryId: screen.getPrimaryDisplay().id, savedId: saved.displayId, gameRunning: !!isGameRunning() });
    pages = clean;
    index = Math.min(Math.max(0, Math.floor(Number(at)) || 0), pages.length - 1);
    zoom = clampZoom(z != null ? z : (saved.zoom != null ? saved.zoom : DEFAULT_ZOOM));
    if (win && !win.isDestroyed()) {
      show();
      win.webContents.setZoomFactor(zoom);
      return state();
    }
    configureSession();
    const box = placeOn(display, saved.displayId === display.id ? saved.bounds : null);
    win = new BrowserWindow({
      ...box,
      minWidth: 320, minHeight: 240,
      title: 'Vex second screen',
      backgroundColor: '#000000',
      // Windowed only, by construction: none of these can be turned on later.
      alwaysOnTop: false, fullscreenable: false, skipTaskbar: false,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      },
    });
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, url) => { if (!/^https?:/i.test(url)) e.preventDefault(); });
    wc.on('page-title-updated', (e) => { e.preventDefault(); win && !win.isDestroyed() && win.setTitle(title()); });
    wc.on('did-finish-load', () => { try { wc.setZoomFactor(zoom); } catch (err) { log('[SecondScreen] zoom: ' + err.message); } });
    wc.on('before-input-event', (event, input) => {
      const a = keyAction(input);
      if (a) { event.preventDefault(); act(a); }
    });
    // HTML fullscreen (a video's own button) is refused: windowed only.
    wc.on('enter-html-full-screen', () => { try { win.webContents.executeJavaScript('document.exitFullscreen && document.exitFullscreen()'); } catch (err) { log('[SecondScreen] could not leave fullscreen: ' + err.message); } });
    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(persist, 400); };
    win.on('move', later);
    win.on('resize', later);
    win.on('closed', () => { clearTimeout(timer); win = null; });
    show();
    return state();
  }

  function close() {
    if (win && !win.isDestroyed()) { persist(); win.destroy(); }
    win = null;
    return state();
  }

  function state() {
    const isOpen = !!(win && !win.isDestroyed());
    return { open: isOpen, index, count: pages.length, zoom, title: isOpen ? title() : '' };
  }

  return { open, close, state, act };
}

module.exports = { createSecondScreen, cleanPages, cleanTimers, timersHtml, clampZoom, pickDisplay, fitsDisplay, placeOn, keyAction, MAX_PAGES, DEFAULT_ZOOM, PARTITION };
