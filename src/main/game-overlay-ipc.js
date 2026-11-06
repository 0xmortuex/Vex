// === In-game overlay: the Electron wiring ====================================
//
// main/game-overlay.js holds the rules and the state machine. This file hands
// it Electron's classes, keeps the small amount of state the overlay needs
// (settings and theme colours pushed by Vex's own window, the timer, the notes)
// and answers the overlay window's few IPC channels.
//
// Anti-cheat: nothing here looks at another program. The only system-wide
// request is the one globalShortcut inside the controller; the game is known by
// the program NAME Game mode already read. See game-overlay.js.

const overlay = require('./game-overlay');

const MUSIC_ACTIONS = ['toggle', 'next', 'prev', 'status'];
const MUSIC_WAIT_MS = 8000;
const MAX_TOKENS = 80;

// The theme colours Vex's window hands over: --vex-* names and two look names.
function cleanTokens(tokens) {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new Error('The theme colours must be an object');
  const out = {};
  const keys = Object.keys(tokens);
  if (keys.length > MAX_TOKENS) throw new Error('Too many theme values');
  for (const k of keys) {
    const v = tokens[k];
    if (typeof v !== 'string' || v.length > 300) throw new Error('A theme value must be short text: ' + k);
    if (!/^--vex-[a-z0-9-]{1,48}$/.test(k) && k !== 'data-theme' && k !== 'data-gui-style') throw new Error('Not a theme name: ' + k.slice(0, 40));
    out[k] = v;
  }
  return out;
}

function install(deps) {
  const { ipcMain, electron, path, fs, root, userDataPath, loadSaved, getMainWindow, secureSessions, openAsTab, conflicts, isLocked, log = () => {} } = deps;
  const { BrowserWindow, WebContentsView, globalShortcut, screen, nativeTheme } = electron;

  let config = overlay.parseConfig(null).config;
  let tokens = {};
  let searchTemplate = '';
  let lang = 'en';
  let timer = { mode: 'stopwatch', running: false, startedAt: 0, elapsedMs: 0, durationMs: 0 };
  let viewState = null;             // { panel, url } of the page view now open
  let searchUrlNow = '';
  const musicWaiting = new Map();   // request id -> { resolve, reject, timer }
  let musicSeq = 0;

  const stateFile = path.join(userDataPath, 'game-overlay-state.json');
  const memory = {
    load() {
      let text;
      try { text = fs.readFileSync(stateFile, 'utf8'); }
      catch (err) { if (err && err.code === 'ENOENT') return null; throw err; }
      return JSON.parse(text);
    },
    save(raw) {
      try { fs.writeFileSync(stateFile, JSON.stringify(raw)); }
      catch (err) { console.error('[GameOverlay] could not save where the overlay sat:', err.message); }
    },
  };

  const ctl = overlay.createOverlayController({
    makeWindow: overlay.buildWindow({
      BrowserWindow, WebContentsView, path, root: path.join(root), nativeTheme,
      backgroundColor: () => tokens['--vex-bg-base'] || '',
      onKey: (key) => { if (key === 'Escape') ctl.hide(); },
    }),
    globalShortcut,
    getConfig: () => config,
    memory,
    workAreas: () => screen.getAllDisplays().map(d => d.workArea),
    primaryWorkArea: () => screen.getPrimaryDisplay().workArea,
    conflicts,
    canShow: () => (isLocked() ? 'Vex is locked. Unlock it first.' : ''),
    notify: (message) => { const w = getMainWindow(); if (w && !w.isDestroyed()) w.webContents.send('vex:toast', message); },
    decorate: (s) => ({ ...s, tokens, lang, panels: config.panels, hasSearch: searchTemplate.includes('%s') }),
    log,
  });

  function loadSavedConfig() {
    const raw = loadSaved();
    if (!raw) return { dropped: [] };
    let parsed;
    try { parsed = JSON.parse(raw); } catch (err) { throw new Error('The saved overlay settings are not readable: ' + err.message, { cause: err }); }
    const r = overlay.parseConfig(parsed);
    config = r.config;
    return { dropped: r.dropped };
  }

  // ---- the overlay window's own channels ----------------------------------------
  function fromOverlay(event) {
    const w = ctl.window();
    if (!w || w.isDestroyed() || event.sender !== w.raw.webContents) throw new Error('Only the overlay window can do this');
    return w;
  }
  const h = (channel, fn) => ipcMain.handle(channel, (event, ...args) => fn(event, ...args));

  h('gameoverlay:get', (event) => {
    fromOverlay(event);
    return { ...ctl.state(), tokens, lang, panels: config.panels, hasSearch: searchTemplate.includes('%s'),
      notes: ctl.notes(), timer, guide: overlay.guideFor(config, ctl.state().game) };
  });
  h('gameoverlay:hide', (event) => { fromOverlay(event); return ctl.hide(); });
  h('gameoverlay:click-through', (event, on) => { fromOverlay(event); return ctl.setClickThrough(on); });
  h('gameoverlay:interactive', (event, on) => {
    const w = fromOverlay(event);
    // Only meaningful while the window is click-through: a hovered button lets the mouse in.
    if (ctl.state().clickThrough) w.setInteractive(on);
    return { ok: true };
  });
  h('gameoverlay:opacity', (event, level) => { fromOverlay(event); return ctl.setOpacity(level); });
  h('gameoverlay:compact', (event, on) => { fromOverlay(event); closeView(); return ctl.setCompact(on); });
  h('gameoverlay:save-notes', (event, text) => { fromOverlay(event); ctl.saveNotes(text); return { ok: true }; });
  h('gameoverlay:timer', (event, t) => { fromOverlay(event); timer = { mode: t.mode, running: t.running, startedAt: t.startedAt, elapsedMs: t.elapsedMs, durationMs: t.durationMs }; return { ok: true }; });
  h('gameoverlay:search', (event, query) => {
    fromOverlay(event);
    searchUrlNow = overlay.searchUrl(searchTemplate, query);
    return { ok: true };
  });

  function closeView() {
    const w = ctl.window();
    if (w && !w.isDestroyed()) w.closeView();
    viewState = null;
  }

  // A page view laid over the card: the guide, Discord or the search results.
  h('gameoverlay:view', (event, req) => {
    const w = fromOverlay(event);
    if (req.panel === 'none') { closeView(); return { ok: true }; }
    const state = ctl.state();
    let url, partition;
    if (req.panel === 'guide') {
      url = overlay.guideFor(config, state.game);
      if (!url) throw new Error('No guide address is set' + (state.game ? ' for ' + state.game : '') + '. Add one in Settings, Game overlay.');
      partition = 'persist:main';
    } else if (req.panel === 'search') {
      url = searchUrlNow;
      if (!url) return { ok: true, empty: true };
      partition = 'persist:main';
    } else if (req.panel === 'discord') {
      url = overlay.DISCORD_URL;
      partition = 'persist:discord';   // the Discord panel's own session: already signed in, no second login
    } else throw new Error('Unknown overlay panel');
    const rect = { x: req.x, y: req.y, width: req.width, height: req.height };
    if (viewState && viewState.panel === req.panel && viewState.url === url && w.view) { w.setViewBounds(rect); return { ok: true, url }; }
    secureSessions.fromPartition(partition);
    w.openView({
      url, partition, rect,
      configure: (wc) => {
        secureSessions.registerWebWindow(wc);
        // A link that wants a new window becomes a tab of the main window (the same way Open as App does it).
        wc.setWindowOpenHandler(({ url: target }) => { if (/^https?:\/\//i.test(target || '')) openAsTab(target); return { action: 'deny' }; });
      },
    });
    viewState = { panel: req.panel, url };
    return { ok: true, url };
  });

  // Music: the buttons act on the Spotify panel inside Vex's main window, which
  // is already signed in. The overlay never plays anything by itself.
  h('gameoverlay:music', (event, action) => {
    fromOverlay(event);
    if (!MUSIC_ACTIONS.includes(action)) throw new Error('Unknown music action');
    const main = getMainWindow();
    if (!main || main.isDestroyed()) throw new Error('Vex\'s main window is closed, so there is no music panel to control');
    const id = String(++musicSeq);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { musicWaiting.delete(id); reject(new Error('The music panel did not answer')); }, MUSIC_WAIT_MS);
      musicWaiting.set(id, { resolve, reject, timer: t });
      main.webContents.send('gameoverlay:music-request', { id, action });
    });
  });
  ipcMain.on('gameoverlay:music-answer', (event, answer) => {
    const m = getMainWindow();
    if (!m || m.isDestroyed() || event.sender !== m.webContents) return;
    const wait = musicWaiting.get(answer.id);
    if (!wait) return;
    musicWaiting.delete(answer.id);
    clearTimeout(wait.timer);
    if (answer.ok) wait.resolve({ ok: true, title: answer.title || '', artist: answer.artist || '', state: answer.state || '' });
    else wait.reject(new Error(answer.error || 'The music panel could not do that'));
  });

  // ---- Vex's own window: settings in, toggle, status ------------------------------
  const fromMain = (event) => {
    const m = getMainWindow();
    if (!m || m.isDestroyed() || event.sender !== m.webContents) throw new Error('Only the main Vex window can do this');
  };
  h('gameoverlay:config', (event, req) => {
    fromMain(event);
    config = overlay.cleanConfig(req.config);
    if (req.tokens) tokens = cleanTokens(req.tokens);
    if (typeof req.searchTemplate === 'string') searchTemplate = req.searchTemplate;
    if (req.lang) lang = req.lang;
    const hotkey = ctl.applyConfig();
    return { hotkey, state: ctl.state() };
  });
  h('gameoverlay:toggle', (event) => {
    fromMain(event);
    if (!config.on) throw new Error('The overlay is switched off. Turn it on in Settings, Game overlay.');
    return ctl.toggle();
  });
  h('gameoverlay:status', (event) => { fromMain(event); return { state: ctl.state(), hotkey: ctl.state().hotkey }; });

  return {
    ctl,
    // At start-up, once the profile is readable: the saved settings, and the hotkey if the overlay is on.
    start() {
      const { dropped } = loadSavedConfig();
      if (dropped.length) console.error('[GameOverlay] these saved overlay settings were not valid and were reset: ' + dropped.join(', '));
      const r = ctl.applyConfig();
      if (config.on && !r.registered) console.error('[GameOverlay] hotkey not registered: ' + r.error);
      return r;
    },
    onGame: (state) => ctl.onGame(state),
    dispose() { for (const w of musicWaiting.values()) clearTimeout(w.timer); musicWaiting.clear(); ctl.dispose(); },
  };
}

module.exports = { install, cleanTokens, MUSIC_ACTIONS };
