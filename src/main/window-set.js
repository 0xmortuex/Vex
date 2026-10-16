// === Restore the whole window set (T3-095) =====================================
//
// Vex always opened its main window at 1400 x 900 in the middle of the first screen,
// whatever monitor you left it on, and the small windows made with "Open as App"
// were gone after a restart. With this switched on (Settings > Links and windows):
//
//   * the main window comes back where you left it: the same size, the same
//     place on the same monitor, maximised if it was. A place that is no longer on any
//     screen (the monitor was unplugged) is not used: the window keeps its size and
//     opens in the middle of the main screen;
//   * the "Open as App" windows that were open when Vex was last closed open again
//     (same address, session, size and place), up to eight;
//   * a window you closed is remembered (the last ten): "Reopen closed window" in
//     Ctrl+K brings the latest back.
//
// What is written, to window-set.json in the profile folder: sizes and places of
// windows, and the address, title and session NAME of an app window. A private
// window, a Tor tab's app window, the mini window and anything with a session that
// does not outlive the window are never written down. The file is replaced whole
// (write, then rename) so it cannot be left half-written.
//
// Everything outside the file system and the screen is injected so it can be tested.

const MAX_APPS = 8;
const MAX_CLOSED = 10;
const SAVE_DELAY_MS = 800;
const MIN_VISIBLE = { width: 120, height: 80 };

function isRect(r) {
  return !!r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && r.width > 0 && r.height > 0;
}

// Where a window saved at `saved` should open on the screens there are now.
// → { x, y, width, height } on a screen, or { width, height } (no place: centred) when it is on none.
function fitBounds(saved, workAreas, primaryWorkArea) {
  if (!isRect(saved)) throw new Error('A window place needs x, y, width and height');
  let best = null;
  for (const wa of workAreas) {
    const w = Math.min(saved.x + saved.width, wa.x + wa.width) - Math.max(saved.x, wa.x);
    const h = Math.min(saved.y + saved.height, wa.y + wa.height) - Math.max(saved.y, wa.y);
    if (w >= MIN_VISIBLE.width && h >= MIN_VISIBLE.height && (!best || w * h > best.area)) best = { wa, area: w * h };
  }
  if (!best) {
    const wa = primaryWorkArea;
    return { width: Math.min(saved.width, wa.width), height: Math.min(saved.height, wa.height) };
  }
  const wa = best.wa;
  const width = Math.min(saved.width, wa.width), height = Math.min(saved.height, wa.height);
  const x = Math.min(Math.max(saved.x, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(saved.y, wa.y), wa.y + wa.height - height);
  return { x, y, width, height };
}

function parsePrefs(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { on: true, apps: true };
  return { on: saved.on !== false, apps: saved.apps !== false };
}

function createWindowSet({ file, fs, getWorkAreas, getPrimaryWorkArea, getPrefs, log = () => {}, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let state = null;
  let timer = null;
  let quitting = false;
  const live = new Map();        // BrowserWindow -> app record, for the app windows open now

  function load() {
    if (state) return state;
    state = { v: 1, main: null, apps: [], closed: [] };
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return state; throw err; }
    try {
      const v = JSON.parse(raw);
      if (v && v.v === 1) {
        state.main = v.main && isRect(v.main.bounds) ? { bounds: v.main.bounds, maximized: v.main.maximized === true } : null;
        state.apps = (Array.isArray(v.apps) ? v.apps : []).filter(a => a && typeof a.url === 'string' && /^https?:/i.test(a.url)).slice(0, MAX_APPS);
        state.closed = (Array.isArray(v.closed) ? v.closed : []).filter(keepable).slice(0, MAX_CLOSED);
      }
    } catch (err) {
      // A damaged record is not worth failing a start for: it is said, and begun again.
      log('[WindowSet] window-set.json is damaged and starts again: ' + err.message);
    }
    return state;
  }

  function writeNow() {
    clearTimer(timer); timer = null;
    const s = load();
    const text = JSON.stringify({ v: 1, main: s.main, apps: s.apps, closed: s.closed });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  }
  function scheduleSave() {
    if (quitting) return;
    clearTimer(timer);
    timer = setTimer(() => { timer = null; try { writeNow(); } catch (err) { log('[WindowSet] could not save: ' + err.message); } }, SAVE_DELAY_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function enabled() { return parsePrefs(getPrefs()).on; }

  // ---- the main window ----------------------------------------------------------------
  // → { bounds: {x?, y?, width, height}, maximized } to open the main window with, or null.
  function mainPlacement() {
    if (!enabled()) return null;
    const s = load();
    if (!s.main) return null;
    return { bounds: fitBounds(s.main.bounds, getWorkAreas(), getPrimaryWorkArea()), maximized: s.main.maximized };
  }
  function trackMain(win) {
    if (!enabled()) return;
    const note = () => {
      if (!enabled() || quitting || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      const maximized = win.isMaximized();
      const bounds = typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : win.getBounds();
      if (!isRect(bounds)) return;
      load().main = { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, maximized };
      scheduleSave();
    };
    for (const ev of ['move', 'resize', 'maximize', 'unmaximize']) win.on(ev, note);
    win.on('close', note);
  }

  // ---- app windows --------------------------------------------------------------------
  // A session that outlives the window and is not Tor: the only kind that is ever written down.
  function keepable(info) {
    return !!info && typeof info.url === 'string' && /^https?:/i.test(info.url) && typeof info.partition === 'string' && info.partition.startsWith('persist:') && info.partition !== 'persist:route-tor';
  }
  function trackApp(win, info) {
    if (!enabled() || !keepable(info)) return;
    const rec = { url: info.url, title: String(info.title || '').slice(0, 120), partition: info.partition, bounds: null };
    live.set(win, rec);
    const sync = () => {
      if (quitting) return;
      const s = load();
      s.apps = [...live.values()].slice(0, MAX_APPS);
      scheduleSave();
    };
    const place = () => {
      if (win.isDestroyed() || win.isMinimized()) return;
      const b = win.getBounds();
      if (isRect(b)) { rec.bounds = { x: b.x, y: b.y, width: b.width, height: b.height }; sync(); }
    };
    for (const ev of ['move', 'resize']) win.on(ev, place);
    win.on('closed', () => {
      live.delete(win);
      // Closing every window at quit is not the person closing this one.
      if (quitting) return;
      const s = load();
      s.apps = [...live.values()];
      s.closed.unshift({ url: rec.url, title: rec.title, partition: rec.partition, bounds: rec.bounds, closedAt: now() });
      s.closed = s.closed.slice(0, MAX_CLOSED);
      scheduleSave();
    });
    place();
    sync();
  }
  // The app windows that were open when Vex last closed, each with where it was.
  function appsToRestore() {
    const p = parsePrefs(getPrefs());
    if (!p.on || !p.apps) return [];
    return load().apps.filter(keepable).map(a => ({
      url: a.url, title: a.title, partition: a.partition,
      bounds: isRect(a.bounds) ? fitBounds(a.bounds, getWorkAreas(), getPrimaryWorkArea()) : null,
    }));
  }

  // ---- closed windows -----------------------------------------------------------------
  function closedList() { return load().closed.map(c => ({ url: c.url, title: c.title, closedAt: c.closedAt })); }
  // The latest closed window, taken off the list. → its record, or null.
  function takeClosed() {
    const s = load();
    // An entry that is not an http(s) address in a kept session (a hand-edited file) is dropped, not opened.
    let c = s.closed.shift();
    while (c && !keepable(c)) c = s.closed.shift();
    if (!c) return null;
    scheduleSave();
    return { url: c.url, title: c.title, partition: c.partition, bounds: isRect(c.bounds) ? fitBounds(c.bounds, getWorkAreas(), getPrimaryWorkArea()) : null };
  }

  // Vex is quitting: what is open now is what comes back; windows closing with it are not "closed".
  function beginQuit() {
    if (quitting) return;
    if (enabled()) {
      const s = load();
      s.apps = [...live.values()];
      try { writeNow(); } catch (err) { log('[WindowSet] could not save at quit: ' + err.message); }
    }
    quitting = true;
  }

  return { load, mainPlacement, trackMain, trackApp, appsToRestore, closedList, takeClosed, beginQuit, enabled, flush: writeNow };
}

module.exports = { createWindowSet, fitBounds, parsePrefs, MAX_APPS, MAX_CLOSED, SAVE_DELAY_MS };
