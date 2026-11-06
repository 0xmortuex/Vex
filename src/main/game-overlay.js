// === In-game overlay =========================================================
//
// A small Vex window you raise with a global hotkey while a game runs, showing
// what you would otherwise alt-tab for: a guide page, Discord, a scratch pad, a
// timer, music buttons and a quick search.
//
// ANTI-CHEAT SAFE BY DESIGN. This is an ordinary, separate top-level window of
// Vex's own process. It never injects into, hooks, attaches to or reads the
// memory of a game, never captures the game's screen, never installs a global
// keyboard or mouse hook, and never loads a DLL into anything. The only
// system-wide thing it asks Windows for is one Electron globalShortcut (the
// RegisterHotKey call every program may make). The game is known only by the
// program NAME that Game mode already reads from the process list. A test
// (tests/main/gameOverlay.test.js) fails if this file ever mentions the APIs
// an overlay hook would need.
//
// It works over borderless and windowed games. A game in exclusive fullscreen
// owns the display and Windows may hide every other window, this one included;
// the Settings text says so and suggests borderless mode.
//
// This file: the pure rules (settings, address check, per-game memory, hotkey
// refusal) and the state machine (hidden until needed, destroyed after a while
// hidden). buildWindow() is the only part that touches Electron, and it is
// handed Electron's classes, so the rest is tested without a display.

const pipMemory = require('./pip-memory');
const gameHotkeys = require('./game-hotkeys');

// The panels the person can choose to show, in the order they appear.
const PANELS = ['guide', 'discord', 'notes', 'timer', 'music', 'search'];
const DEFAULT_HOTKEY = 'Ctrl+Alt+Shift+O';   // Ctrl+Alt+O is "Split view: next pane" in Vex
const MIN_OPACITY = 0.2;
const MAX_GUIDES = 40;
const MAX_NOTES = 20000;
const MAX_URL = 2048;
const DISCORD_URL = 'https://discord.com/channels/@me';
const SIZES = { expanded: { width: 460, height: 600 }, compact: { width: 380, height: 150 } };
const MIN_SIZE = { width: 300, height: 120 };

const DEFAULTS = Object.freeze({
  on: false,
  hotkey: DEFAULT_HOTKEY,
  opacity: 0.92,
  clickThrough: false,
  compact: false,
  hint: false,
  destroyMinutes: 5,
  panels: ['guide', 'notes', 'timer', 'music', 'search'],
  guides: {},
  defaultGuide: '',
});

function clampOpacity(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) throw new Error('The see-through level must be a number');
  return Math.min(1, Math.max(MIN_OPACITY, Math.round(v * 100) / 100));
}

// An address the overlay may show: a plain web address the person typed, with no
// password in it. Anything else (file:, javascript:, vex:, data:) is refused.
function guideUrl(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error('That address is empty');
  if (text.length > MAX_URL) throw new Error('That address is too long');
  let u;
  try { u = new URL(text); } catch { throw new Error('That is not a web address: ' + text.slice(0, 60)); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https addresses can be used (' + u.protocol + ' was refused)');
  if (u.username || u.password) throw new Error('An address with a password in it is refused');
  if (!u.hostname) throw new Error('That address has no site in it');
  return u.href;
}

function cleanPanels(list) {
  if (!Array.isArray(list)) throw new Error('The panels must be a list');
  const out = [];
  for (const p of list) {
    if (!PANELS.includes(p)) throw new Error('Unknown overlay panel: ' + String(p).slice(0, 40));
    if (!out.includes(p)) out.push(p);
  }
  if (!out.length) throw new Error('Show at least one panel');
  return PANELS.filter(p => out.includes(p));
}

function cleanGuides(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('The guide addresses must be a list of games');
  const out = {};
  const keys = Object.keys(map);
  if (keys.length > MAX_GUIDES) throw new Error('At most ' + MAX_GUIDES + ' games can have a guide address');
  for (const k of keys) {
    const key = pipMemory.contextKey(k);
    if (!key) throw new Error('A guide address needs a game name');
    out[key] = guideUrl(map[k]);
  }
  return out;
}

// Strict: used when the person (or Settings) hands over new settings. Throws
// the first thing wrong, so Settings can say it.
function cleanConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The overlay settings must be an object');
  const c = { ...DEFAULTS, guides: {}, panels: [...DEFAULTS.panels] };
  if ('on' in input) { if (typeof input.on !== 'boolean') throw new Error('"on" must be true or false'); c.on = input.on; }
  if ('hotkey' in input) {
    const key = String(input.hotkey || '').trim();
    if (!gameHotkeys.isSafeAccelerator(key)) throw new Error('The hotkey needs a modifier and a key, for example Ctrl+Alt+Shift+O');
    c.hotkey = key;
  }
  if ('opacity' in input) c.opacity = clampOpacity(input.opacity);
  for (const k of ['clickThrough', 'compact', 'hint']) if (k in input) { if (typeof input[k] !== 'boolean') throw new Error('"' + k + '" must be true or false'); c[k] = input[k]; }
  if ('destroyMinutes' in input) {
    const m = input.destroyMinutes;
    if (!Number.isInteger(m) || m < 0 || m > 240) throw new Error('Minutes before the hidden overlay is closed must be 0 to 240 (0 = never)');
    c.destroyMinutes = m;
  }
  if ('panels' in input) c.panels = cleanPanels(input.panels);
  if ('guides' in input) c.guides = cleanGuides(input.guides);
  if ('defaultGuide' in input) c.defaultGuide = input.defaultGuide ? guideUrl(input.defaultGuide) : '';
  return c;
}

// Lenient: what a saved profile holds. A part that no longer passes falls back to
// its default and is listed in `dropped`, so the caller can say so.
function parseConfig(saved) {
  const dropped = [];
  const merged = { ...DEFAULTS, guides: {}, panels: [...DEFAULTS.panels] };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { config: merged, dropped };
  // cleanConfig({key}) fills every other field with its default, so take one field at a time.
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in saved)) continue;
    try { merged[key] = cleanConfig({ [key]: saved[key] })[key]; }
    catch { dropped.push(key); }
  }
  return { config: merged, dropped };
}

// The guide for this game: its own address, else the default one, else none.
function guideFor(config, gameKey) {
  return (gameKey && config.guides[gameKey]) || config.defaultGuide || '';
}

// Where a quick search goes: the person's own search engine, handed over as a
// template with %s for the words.
function searchUrl(template, query) {
  const q = String(query == null ? '' : query).trim();
  if (!q) throw new Error('Type something to search for');
  if (q.length > 300) throw new Error('That search is too long');
  if (typeof template !== 'string' || !template.includes('%s')) throw new Error('No search engine is set up for the overlay');
  return guideUrl(template.split('%s').join(encodeURIComponent(q)));
}

// ---- remembered place and size, per game (the PiP window's way: pip-memory.js) ----
// Two sets, because the small bar and the full card have different sizes.
function emptyMemory() { return { expanded: {}, compact: {}, notes: {} }; }

function parseMemory(raw) {
  const m = emptyMemory();
  if (!raw || typeof raw !== 'object') return m;
  for (const mode of ['expanded', 'compact']) if (raw[mode] && typeof raw[mode] === 'object') m[mode] = raw[mode];
  if (raw.notes && typeof raw.notes === 'object') {
    for (const [k, v] of Object.entries(raw.notes)) if (typeof v === 'string') m.notes[k] = v.slice(0, MAX_NOTES);
  }
  return m;
}

function boundsFor(memory, mode, gameKey, usable) {
  const st = memory[mode] || {};
  return pipMemory.boundsFor(st, gameKey, usable);
}

function rememberBounds(memory, mode, gameKey, bounds) {
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) throw new Error('Cannot remember a window with no size');
  const key = gameKey || '';
  const next = { ...memory };
  const st = { ...(memory[mode] || {}) };
  st.bounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  next[mode] = key ? pipMemory.remember(st, key, bounds) : st;
  return next;
}

// A saved place counts only if a good part of it is still on a screen.
function usableOn(workAreas) {
  return (b) => {
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !(b.width >= MIN_SIZE.width) || !(b.height >= MIN_SIZE.height)) return null;
    const ok = workAreas.some(a => {
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      return w >= Math.min(b.width, 160) && h >= Math.min(b.height, 80);
    });
    return ok ? b : null;
  };
}

// Where a first-time window goes: the top-right of the main screen.
function defaultBounds(workArea, mode) {
  const size = SIZES[mode];
  const margin = 24;
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + margin),
    width: Math.min(size.width, workArea.width),
    height: Math.min(size.height, workArea.height),
  };
}

// ---- the state machine ----------------------------------------------------------
//
//   none --show--> shown --hide--> hidden --(destroyMinutes later)--> none
//                    ^________show______|
//
// The window is made the first time it is needed and destroyed after
// destroyMinutes hidden (0 = kept), so a game that never uses it never pays for
// it. Nothing here polls: there is one timer, set when it is hidden.
//
// deps:
//   makeWindow({ mode, bounds, clickThrough, opacity, game, onBounds, onClosed }) → handle
//   handle: show() hide() destroy() isDestroyed() setClickThrough(b) setOpacity(n) setMode(mode, bounds)
//           getBounds() send(channel, payload) showHint(text)
//   globalShortcut: register(accel, fn) → boolean, unregister(accel)
//   getConfig() → config; memory: { load() → raw, save(raw) }
//   workAreas() → [{x,y,width,height}]; primaryWorkArea() → rect
//   conflicts() → [accelerator] already held by other Vex features
function createOverlayController(deps) {
  const { makeWindow, globalShortcut, getConfig, memory, workAreas, primaryWorkArea } = deps;
  for (const [name, v] of Object.entries({ makeWindow, getConfig, workAreas, primaryWorkArea })) if (typeof v !== 'function') throw new TypeError('createOverlayController: ' + name + ' is required');
  if (!globalShortcut || typeof globalShortcut.register !== 'function') throw new TypeError('createOverlayController: globalShortcut is required');
  const log = deps.log || (() => {});
  const setTimer = deps.setTimer || setTimeout;
  const clearTimer = deps.clearTimer || clearTimeout;
  const conflicts = deps.conflicts || (() => []);

  let mem = parseMemory(memory ? memory.load() : null);
  let win = null;
  let status = 'none';            // none | shown | hidden
  let game = '';                  // the game's key ('' = none known)
  let clickThrough = null;        // null = follow the setting; else this session's choice
  let compact = null;
  let opacity = null;
  let destroyTimer = null;
  let saveTimer = null;
  let hintTimer = null;
  let hinting = false;            // the short "press X to open" box after a game starts
  let hotkey = { accelerator: '', registered: false, error: '' };

  const cfg = () => getConfig();
  const isClickThrough = () => (clickThrough == null ? cfg().clickThrough : clickThrough);
  const isCompact = () => (compact == null ? cfg().compact : compact);
  const currentOpacity = () => (opacity == null ? cfg().opacity : opacity);
  const mode = () => (isCompact() ? 'compact' : 'expanded');

  function snapshot() {
    return { status, game, clickThrough: isClickThrough(), compact: isCompact(), opacity: currentOpacity(), hotkey: { ...hotkey }, hint: hinting ? hotkey.accelerator : '' };
  }
  function push() {
    if (win && !win.isDestroyed()) win.send('gameoverlay:state', deps.decorate ? deps.decorate(snapshot()) : snapshot());
  }

  function persist() {
    if (!memory) return;
    memory.save(mem);
  }
  function remember() {
    if (!win || win.isDestroyed() || hinting) return;   // the hint's small box is not a place to remember
    mem = rememberBounds(mem, mode(), game, win.getBounds());
    persist();
  }
  function scheduleRemember() {
    if (saveTimer) clearTimer(saveTimer);
    saveTimer = setTimer(() => { saveTimer = null; remember(); }, 600);
  }

  function pickBounds() {
    const found = boundsFor(mem, mode(), game, usableOn(workAreas()));
    return found || defaultBounds(primaryWorkArea(), mode());
  }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    win = makeWindow({
      mode: mode(), bounds: pickBounds(), clickThrough: isClickThrough(), opacity: currentOpacity(), game,
      onBounds: scheduleRemember,
      onClosed: () => { win = null; if (status !== 'none') { status = 'none'; log('[GameOverlay] the window was closed'); } },
    });
    return win;
  }

  function cancelDestroy() { if (destroyTimer) { clearTimer(destroyTimer); destroyTimer = null; } }

  function show() {
    // Said out loud to whoever asked (the hotkey shows it as a message), never skipped quietly.
    const why = deps.canShow ? deps.canShow() : '';
    if (why) throw new Error(why);
    cancelDestroy();
    if (hintTimer) { clearTimer(hintTimer); hintTimer = null; }
    const wasHinting = hinting;
    hinting = false;
    const w = ensureWindow();
    if (wasHinting) { w.setMode(mode(), pickBounds()); w.setClickThrough(isClickThrough()); }
    w.show();                      // shows WITHOUT taking the focus (handle uses showInactive)
    status = 'shown';
    push();
    return snapshot();
  }

  function hide() {
    if (hintTimer) { clearTimer(hintTimer); hintTimer = null; }
    if (!win || win.isDestroyed() || status !== 'shown') return snapshot();
    if (saveTimer) { clearTimer(saveTimer); saveTimer = null; }
    remember();                    // does nothing while only the hint box is up
    hinting = false;
    win.hide();
    status = 'hidden';
    const minutes = cfg().destroyMinutes;
    if (minutes > 0) destroyTimer = setTimer(destroy, minutes * 60 * 1000);
    return snapshot();
  }

  function destroy() {
    cancelDestroy();
    if (hintTimer) { clearTimer(hintTimer); hintTimer = null; }
    if (saveTimer) { clearTimer(saveTimer); saveTimer = null; }
    const w = win;
    win = null;
    const wasHinting = hinting;
    hinting = false;
    if (w && !w.isDestroyed()) { if (status === 'shown' && !wasHinting) { mem = rememberBounds(mem, mode(), game, w.getBounds()); persist(); } w.destroy(); }
    status = 'none';
    return snapshot();
  }

  // The first press during the hint opens the overlay; the next one hides it.
  function toggle() { return (status === 'shown' && !hinting) ? hide() : show(); }

  function setClickThrough(on) {
    if (typeof on !== 'boolean') throw new Error('Click-through is on or off');
    clickThrough = on;
    if (win && !win.isDestroyed()) win.setClickThrough(on);
    push();
    return snapshot();
  }

  function setOpacityLevel(level) {
    opacity = clampOpacity(level);
    if (win && !win.isDestroyed()) win.setOpacity(opacity);
    push();
    return snapshot();
  }

  function setCompact(on) {
    if (typeof on !== 'boolean') throw new Error('Compact is on or off');
    if (win && !win.isDestroyed() && status === 'shown') remember();
    compact = on;
    if (win && !win.isDestroyed()) win.setMode(mode(), pickBounds());
    push();
    return snapshot();
  }

  // The game the overlay is for. A different game means its own place and size.
  function setGame(key) {
    const next = key ? pipMemory.contextKey(key) : '';
    if (next === game) return snapshot();
    if (win && !win.isDestroyed() && status === 'shown') remember();
    game = next;
    if (win && !win.isDestroyed() && status === 'shown') win.setMode(mode(), pickBounds());
    push();
    return snapshot();
  }

  // Game mode's detection reports a game starting or ending. Only a hint is ever
  // shown by itself, never the full overlay, never with focus.
  function onGame(state) {
    const running = !!(state && state.game);
    setGame(running ? (state.app || '') : '');
    const c = cfg();
    if (!c.on || !c.hint || !running || status === 'shown' || !hotkey.registered) return;
    if (deps.canShow && deps.canShow()) return;     // locked: no hint either
    const w = ensureWindow();
    hinting = true;
    w.showHint(boundsFor(mem, 'compact', game, usableOn(workAreas())) || defaultBounds(primaryWorkArea(), 'compact'));
    status = 'shown';
    push();
    hintTimer = setTimer(() => { hintTimer = null; if (status === 'shown') hide(); }, 9000);
  }

  // ---- the hotkey: one Electron globalShortcut, released on quit ----------------
  function registerHotkey(accel) {
    const want = String(accel == null ? cfg().hotkey : accel).trim();
    releaseHotkey();
    if (!gameHotkeys.isSafeAccelerator(want)) {
      hotkey = { accelerator: want, registered: false, error: 'That needs a modifier and a key, for example Ctrl+Alt+Shift+O' };
      return { ...hotkey };
    }
    const norm = gameHotkeys.normalizeAccelerator(want);
    if (conflicts().map(gameHotkeys.normalizeAccelerator).includes(norm)) {
      hotkey = { accelerator: want, registered: false, error: want + ' is already used by another Vex shortcut. Pick another one.' };
      return { ...hotkey };
    }
    let ok;
    try { ok = globalShortcut.register(want, () => { try { toggle(); } catch (err) { log('[GameOverlay] the hotkey failed: ' + err.message); if (deps.notify) deps.notify('The overlay could not open: ' + err.message); } }); }
    catch (err) {
      hotkey = { accelerator: want, registered: false, error: 'Windows refused ' + want + ': ' + err.message };
      return { ...hotkey };
    }
    // Windows hands a combination to whoever asked first.
    hotkey = ok
      ? { accelerator: want, registered: true, error: '' }
      : { accelerator: want, registered: false, error: 'Another program already uses ' + want + '. Pick a different key in Settings.' };
    log('[GameOverlay] hotkey ' + want + (ok ? ' registered' : ' refused'));
    return { ...hotkey };
  }

  function releaseHotkey() {
    if (hotkey.registered) { try { globalShortcut.unregister(hotkey.accelerator); } catch (err) { log('[GameOverlay] could not release ' + hotkey.accelerator + ': ' + err.message); } }
    hotkey = { accelerator: hotkey.accelerator, registered: false, error: '' };
  }

  // The settings changed (or loaded): follow them.
  function applyConfig() {
    const c = cfg();
    if (!c.on) {
      releaseHotkey();
      if (status !== 'none') destroy();
      return { ...hotkey };
    }
    const result = (hotkey.registered && hotkey.accelerator === c.hotkey) ? { ...hotkey } : registerHotkey(c.hotkey);
    clickThrough = null; compact = null; opacity = null;
    if (win && !win.isDestroyed()) {
      win.setOpacity(currentOpacity());
      win.setClickThrough(isClickThrough());
      win.setMode(mode(), pickBounds());
    }
    push();
    return result;
  }

  function dispose() {
    releaseHotkey();
    if (win && !win.isDestroyed() && status === 'shown') { try { remember(); } catch (err) { log('[GameOverlay] could not remember the place: ' + err.message); } }
    destroy();
  }

  function saveNotes(text) {
    if (typeof text !== 'string' || text.length > MAX_NOTES) throw new Error('The notes are too long');
    const key = game || '_';
    mem = { ...mem, notes: { ...mem.notes } };
    delete mem.notes[key];
    mem.notes[key] = text;
    const keys = Object.keys(mem.notes);
    while (keys.length > MAX_GUIDES + 1) delete mem.notes[keys.shift()];
    persist();
  }
  const notes = () => mem.notes[game || '_'] || '';

  return {
    show, hide, toggle, destroy, dispose, setClickThrough, setOpacity: setOpacityLevel, setCompact, setGame, onGame,
    registerHotkey, releaseHotkey, applyConfig, saveNotes, notes, state: snapshot,
    hasWindow: () => !!(win && !win.isDestroyed()), window: () => win,
    memory: () => mem,
  };
}

// ---- the real window (Electron) -------------------------------------------------
// Given Electron's classes so tests never need them. The page is Vex's own
// renderer/game-overlay.html with its own tight preload.
function buildWindow({ BrowserWindow, WebContentsView, path, root, nativeTheme, backgroundColor, onKey }) {
  return function makeWindow({ bounds, clickThrough, opacity, onBounds, onClosed }) {
    const win = new BrowserWindow({
      ...bounds,
      minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height,
      frame: false, show: false, resizable: true, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: !clickThrough,
      title: 'Vex overlay', backgroundColor: backgroundColor() || (nativeTheme.shouldUseDarkColors ? '#1b1b1f' : '#ffffff'),
      webPreferences: {
        preload: path.join(root, 'preload-game-overlay.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: true,
      },
    });
    // Above a borderless fullscreen game, which a plain always-on-top window is not.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setOpacity(opacity);
    if (clickThrough) win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && onKey) { event.preventDefault(); onKey('Escape'); }
    });
    win.loadFile(path.join(root, 'renderer', 'game-overlay.html'));
    win.on('moved', onBounds);
    win.on('resized', onBounds);
    win.on('closed', onClosed);

    const handle = {
      view: null,
      show() { if (!win.isDestroyed()) win.showInactive(); },
      hide() { if (win.isDestroyed()) return; win.blur(); this.closeView(); win.hide(); },
      destroy() { this.closeView(); if (!win.isDestroyed()) win.destroy(); },
      isDestroyed: () => win.isDestroyed(),
      setClickThrough(on) {
        // Click-through windows pass the mouse to the game and cannot take the keyboard.
        win.setFocusable(!on);
        win.setIgnoreMouseEvents(on, on ? { forward: true } : undefined);
      },
      setInteractive(on) { if (!win.isDestroyed()) win.setIgnoreMouseEvents(!on, !on ? { forward: true } : undefined); },
      setOpacity: (n) => win.setOpacity(n),
      setMode(m, b) { win.setBounds(b); },
      getBounds: () => win.getBounds(),
      send(channel, payload) { if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload); },
      // A short note in the compact box, click-through and without focus: it never takes the game's input.
      showHint(b) { win.setBounds(b); win.setFocusable(false); win.setIgnoreMouseEvents(true, { forward: true }); win.showInactive(); },
      // The guide and Discord are web pages in a view laid over the card. They are
      // closed when the overlay is hidden, so a hidden overlay holds no page.
      openView({ url, partition, rect, configure }) {
        this.closeView();
        const view = new WebContentsView({ webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } });
        if (configure) configure(view.webContents);
        win.contentView.addChildView(view);
        view.setBounds(rect);
        view.webContents.loadURL(url).catch((err) => { console.error('[GameOverlay] could not load ' + url + ': ' + err.message); });
        this.view = view;
        return view;
      },
      setViewBounds(rect) { if (this.view) this.view.setBounds(rect); },
      closeView() {
        const v = this.view;
        this.view = null;
        if (!v) return;
        try { win.contentView.removeChildView(v); } catch (err) { console.error('[GameOverlay] could not remove the page view:', err.message); }
        if (!v.webContents.isDestroyed()) v.webContents.close();
      },
      raw: win,
    };
    return handle;
  };
}

module.exports = {
  PANELS, DEFAULTS, DEFAULT_HOTKEY, DISCORD_URL, SIZES, MIN_SIZE, MIN_OPACITY, MAX_NOTES,
  clampOpacity, guideUrl, cleanConfig, parseConfig, guideFor, searchUrl,
  emptyMemory, parseMemory, boundsFor, rememberBounds, usableOn, defaultBounds,
  createOverlayController, buildWindow,
};
