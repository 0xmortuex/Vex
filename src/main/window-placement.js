// === Where the window was, and never off the screen (T2-082) =================
//
// Vex remembers the size and place of its window and puts it back at start. A
// monitor that has been unplugged since must never leave the window somewhere
// nobody can reach it, so the saved place is clamped to the screens that exist
// NOW, at start and again whenever the set of screens changes.
//
// Pure of Electron: screens come in as work areas, files are injected.

const MIN_W = 800, MIN_H = 600;          // the window's own minimum (main.js)

const whole = (n) => Number.isFinite(n) ? Math.round(n) : NaN;

function valid(b) {
  return !!b && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k])) && b.width > 0 && b.height > 0;
}

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// The bounds moved and shrunk so they sit inside one of the work areas: the one
// they overlap most, else the first (the primary). `changed` says whether anything moved.
// A window that is already fully inside a screen is returned as it was.
function clamp(bounds, workAreas) {
  if (!valid(bounds)) throw new Error('The saved window place is not usable');
  if (!Array.isArray(workAreas) || !workAreas.length || !workAreas.every(valid)) throw new Error('There is no screen to place the window on');
  let best = workAreas[0], bestArea = -1;
  for (const wa of workAreas) {
    const a = overlap(bounds, wa);
    if (a > bestArea) { best = wa; bestArea = a; }
  }
  const width = Math.min(Math.max(whole(bounds.width), Math.min(MIN_W, best.width)), best.width);
  const height = Math.min(Math.max(whole(bounds.height), Math.min(MIN_H, best.height)), best.height);
  const x = Math.min(Math.max(whole(bounds.x), best.x), best.x + best.width - width);
  const y = Math.min(Math.max(whole(bounds.y), best.y), best.y + best.height - height);
  const out = { x, y, width, height };
  return { bounds: out, changed: out.x !== bounds.x || out.y !== bounds.y || out.width !== bounds.width || out.height !== bounds.height };
}

// file: where the place is kept. fs: node's. Both injected.
function createPlacementStore({ fs, file }) {
  return {
    // The saved bounds or null when none was saved yet. A file that cannot be
    // read is reported, not ignored: the caller decides.
    load() {
      let raw;
      try { raw = fs.readFileSync(file, 'utf8'); }
      catch (err) { if (err && err.code === 'ENOENT') return null; throw err; }
      const parsed = JSON.parse(raw);
      if (!valid(parsed)) throw new Error('window-bounds.json does not hold a window place');
      return { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height };
    },
    save(bounds) {
      if (!valid(bounds)) throw new Error('Not a window place');
      fs.writeFileSync(file, JSON.stringify({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }));
    },
  };
}

// Keeps a live window on a screen. getWorkAreas() -> [{x,y,width,height}].
// Returns { place(), settle(), saveSoon(), flush() }.
function createWindowPlacement({ win, getWorkAreas, store, log = () => {}, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  let timer = null;
  const usable = () => !win.isDestroyed() && !win.isMinimized() && !win.isMaximized() && !win.isFullScreen();

  // Move the window back onto a screen if it is off every one.
  function settle() {
    if (!usable()) return false;
    const { bounds, changed } = clamp(win.getBounds(), getWorkAreas());
    if (!changed) return false;
    win.setBounds(bounds);
    log('[Window] moved back onto a screen after the screens changed');
    return true;
  }
  function flush() {
    if (timer) { clearTimeoutFn(timer); timer = null; }
    if (usable()) store.save(win.getBounds());
  }
  function saveSoon() {
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => { timer = null; try { flush(); } catch (err) { log('[Window] could not remember the window place: ' + err.message); } }, 800);
  }
  return { settle, saveSoon, flush };
}

module.exports = { clamp, valid, createPlacementStore, createWindowPlacement, MIN_W, MIN_H };
