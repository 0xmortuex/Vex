// === Keep Vex's window on top (T2-053) =======================================
//
// A plain "always on top" switch for Vex's OWN window, for docs beside a game
// that runs windowed or on another screen. It never touches any other program.
//
// It must never sit over a full-screen game: while a full-screen game has the
// screen the window is let go of (and put back when the game is over), and the
// switch is refused outright when Vex itself is full screen. It also never
// raises, shows or focuses the window: it only sets the window's own level.
//
// Pure of Electron: the window and the game signal are injected.
function createKeepOnTop({ getWindow, fullscreenGame, log = () => {} }) {
  if (typeof getWindow !== 'function') throw new TypeError('createKeepOnTop: getWindow is required');
  if (typeof fullscreenGame !== 'function') throw new TypeError('createKeepOnTop: fullscreenGame is required');
  let wanted = false;       // what the person asked for
  let applied = false;      // what the window really is now

  const win = () => {
    const w = getWindow();
    return w && !(typeof w.isDestroyed === 'function' && w.isDestroyed()) ? w : null;
  };

  function apply() {
    const w = win();
    if (!w) return false;
    const want = wanted && !fullscreenGame() && !(typeof w.isFullScreen === 'function' && w.isFullScreen());
    if (want === applied) return applied;
    w.setAlwaysOnTop(want);                 // the default level: above windows, below the taskbar and full-screen apps
    applied = want;
    if (wanted && !want) log('[KeepOnTop] let go while a full-screen window has the screen');
    return applied;
  }

  // -> { wanted, active, held } held: wanted but let go because of a full-screen game
  function state() { return { wanted, active: applied, held: wanted && !applied }; }

  function set(on) {
    if (typeof on !== 'boolean') throw new TypeError('Keep on top is true or false');
    wanted = on;
    if (!win()) throw new Error('There is no window to keep on top');
    apply();
    return state();
  }

  return { set, state, recheck: () => { apply(); return state(); } };
}

module.exports = { createKeepOnTop };
