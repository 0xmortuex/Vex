// === Keys Vex answers only while one of its own windows has the focus =====
//
// F12, Ctrl+Shift+F12, Ctrl+Shift+J and the boss key Ctrl+Alt+H were
// registered with globalShortcut, which is Windows-wide: while Vex ran, VS
// Code's F12, the Ctrl+Shift+J console of Chrome and Edge and Steam's F12
// screenshot were dead in every other program (audit B2, 2026-10-10). The
// handlers returned early when Vex was not in front, but Windows had already
// handed the key to Vex.
//
// They are now read from before-input-event on Vex's own windows and on the
// pages inside them, which only fires where the focus is. The one exception is
// bringing Vex back after the boss key hid it: with every window hidden none of
// them has the focus, so Ctrl+Alt+H is taken Windows-wide for exactly as long as
// Vex is hidden, and given back the moment it shows again.

// The DevTools key in an input from before-input-event, or null.
//   'window-docked'    F12             the window's own DevTools, at the bottom
//   'window-detached'  Ctrl+Shift+F12  the window's own DevTools, in a window
//   'focused-detached' Ctrl+Shift+J    DevTools for the page or panel with the focus
function devToolsKeyFor(input) {
  if (!input || input.type !== 'keyDown') return null;
  const ctrl = !!(input.control || input.meta);
  const key = String(input.key || '');
  if (key === 'F12' && !ctrl && !input.alt && !input.shift) return 'window-docked';
  if (key === 'F12' && ctrl && input.shift && !input.alt) return 'window-detached';
  if (ctrl && input.shift && !input.alt && key.toLowerCase() === 'j') return 'focused-detached';
  return null;
}

function isBossKey(input) {
  if (!input || input.type !== 'keyDown') return false;
  return !!(input.control || input.meta) && !!input.alt && !input.shift && String(input.key || '').toLowerCase() === 'h';
}

const BOSS_ACCELERATOR = 'CommandOrControl+Alt+H';

// Hide and mute every Vex window; Ctrl+Alt+H again (from anywhere) shows them.
//   windows()  -> the BrowserWindows to hide and show
//   contents() -> every webContents, muted while hidden
function createBossKey({ globalShortcut, windows, contents, log }) {
  if (!globalShortcut || typeof globalShortcut.register !== 'function') throw new Error('createBossKey: no globalShortcut');
  const note = typeof log === 'function' ? log : () => {};
  let hidden = false;

  function setMuted(on) {
    for (const wc of contents()) {
      try { if (!wc.isDestroyed()) wc.setAudioMuted(on); }
      catch (err) { note('[BossKey] could not ' + (on ? 'mute' : 'unmute') + ' a page: ' + err.message); }
    }
  }

  // Returns { ok, error }. Vex stays on screen when the key to bring it back
  // cannot be had: hiding it with no way back is worse than not hiding.
  function hide() {
    if (hidden) return { ok: true };
    let taken = false;
    try { taken = globalShortcut.register(BOSS_ACCELERATOR, restore); }
    catch (err) { return { ok: false, error: 'Ctrl+Alt+H could not be set up to bring Vex back: ' + err.message }; }
    if (!taken) return { ok: false, error: 'Another program has Ctrl+Alt+H, so Vex was not hidden: it could not be brought back with it' };
    hidden = true;
    for (const w of windows()) {
      try { if (!w.isDestroyed()) w.hide(); }
      catch (err) { note('[BossKey] could not hide a window: ' + err.message); }
    }
    setMuted(true);
    return { ok: true };
  }

  function restore() {
    if (!hidden) return { ok: true };
    hidden = false;
    try { globalShortcut.unregister(BOSS_ACCELERATOR); }
    catch (err) { note('[BossKey] could not give Ctrl+Alt+H back: ' + err.message); }
    for (const w of windows()) {
      try { if (!w.isDestroyed()) { w.show(); w.focus(); } }
      catch (err) { note('[BossKey] could not show a window: ' + err.message); }
    }
    setMuted(false);
    return { ok: true };
  }

  return { hide, restore, isHidden: () => hidden };
}

module.exports = { devToolsKeyFor, isBossKey, createBossKey, BOSS_ACCELERATOR };
