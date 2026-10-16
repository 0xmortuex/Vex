// === Picture-in-Picture: where it sat for each game, and when to hide ========
//
// T2-059. The floating video window remembers one position (pip-state.json).
// With Game mode's game list there is a better key: the game being played, so
// the player returns to the corner of the second screen it was put in for THAT
// game. A position is a position on a monitor, so the monitor is remembered
// with it, and one saved on a monitor that is gone is not used (pip.js checks
// that with its usableBounds()).
//
// And a window of Vex's own that floats above a fullscreen game is the thing
// the owner does not want. When a game is fullscreen the player is hidden, and
// it comes back, where it was, when the game stops being fullscreen.
//
// This file is the pure part: no Electron, no files, so it is tested alone.
const MAX_CONTEXTS = 40;

// A game key: the program name, lower case, letters digits dot dash underscore.
// '' means "no game": the one remembered position is used as before.
function contextKey(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new Error('A PiP game key is text');
  const k = value.trim().toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
  if (!k) return '';
  if (k.length > 80 || !/^[a-z0-9][a-z0-9._ -]*$/.test(k)) throw new Error('That is not a usable game key');
  return k;
}

// The bounds to open at: this game's own if it has any that still land on a
// screen, otherwise the last one used. `usable(b)` is pip.js's check.
function boundsFor(state, ctx, usable) {
  const own = ctx && state && state.byContext && state.byContext[ctx];
  return (own && usable(own)) || usable(state && state.bounds) || null;
}

// A copy of `state` with this game's bounds set; the oldest game is dropped
// past MAX_CONTEXTS (insertion order, a re-saved game moves to the end).
function remember(state, ctx, bounds) {
  const next = { ...(state || {}) };
  if (!ctx || !bounds) return next;
  const by = { ...(next.byContext || {}) };
  delete by[ctx];
  by[ctx] = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  const keys = Object.keys(by);
  while (keys.length > MAX_CONTEXTS) delete by[keys.shift()];
  next.byContext = by;
  return next;
}

// Hide only while a fullscreen game is up AND the person asked for it.
function shouldHide({ hideOverGame, gameFullscreen }) {
  return hideOverGame === true && gameFullscreen === true;
}

module.exports = { contextKey, boundsFor, remember, shouldHide, MAX_CONTEXTS };
