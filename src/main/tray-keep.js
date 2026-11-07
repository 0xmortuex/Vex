// === Keep Vex running in the tray ============================================
//
// Closing the last window used to quit Vex, which stopped reminders, download
// completion, the Discord and Spotify panels, sync and scheduled recipes. With
// Settings > "Keep Vex running in the tray when I close the window" switched ON
// (it is OFF until chosen), the window's X hides the window instead and a tray
// icon stays by the clock: left click shows or hides the window, double click
// opens it, the menu has Open Vex, New tab, Pause notifications and Quit Vex.
//
// The decision "hide or close?" is a pure function (decideClose,
// decideAllClosed) so every way of leaving can be tested without a tray.
// Only the person pressing the window's X is a reason to hide. Every other way
// out really closes: Quit Vex in the tray, installing an update, restarting,
// another profile's update, Windows logging off or shutting down, the profile
// unlock window, a plain app.quit(), and --safe-mode. A hidden window is a
// hidden window in Chromium's eyes too (measured: document.hidden turns true),
// so the idle-sleep of background tabs (Memory Saver) works as it does for a
// minimised window. Private windows are closed when the window is hidden.
'use strict';

const { atomicWriteSync } = require('./file-store');

// Why a window is closing. 'user' is the X button / Alt+F4; everything else is a real close.
const CLOSE_REASONS = Object.freeze(['user', 'quit', 'session-end', 'update', 'restart', 'profile', 'tray-quit']);

// -> { action: 'hide' | 'close', why }
function decideClose({ enabled, reason, safeMode = false, isPrivate = false, trayReady = true } = {}) {
  if (!CLOSE_REASONS.includes(reason)) throw new Error('Unknown reason for closing a window: ' + String(reason));
  if (reason !== 'user') return { action: 'close', why: 'real-quit:' + reason };
  if (enabled !== true) return { action: 'close', why: 'setting-off' };
  if (safeMode) return { action: 'close', why: 'safe-mode' };
  if (isPrivate) return { action: 'close', why: 'private-window' };
  // Never hide a window with no tray icon to bring it back from.
  if (!trayReady) return { action: 'close', why: 'no-tray' };
  return { action: 'hide', why: 'keep-in-tray' };
}

// When the last window has closed: should the app stay alive? -> 'stay' | 'quit'
function decideAllClosed({ enabled, safeMode = false, quitting = false, trayReady = false } = {}) {
  if (quitting || safeMode || enabled !== true || !trayReady) return 'quit';
  return 'stay';
}

const PAUSE_MS = 60 * 60 * 1000;
const NOTICE_TEXT = 'Vex is still running in the tray. Right-click the icon to quit.';

function createTrayKeep({
  fs, file, electron, iconPath, getMainWindow, closePrivateWindows, newTab, reopenMain, quitApp,
  quiet = null, notice, translate = (s) => s, safeMode = false, platform = process.platform, log = () => {},
}) {
  const { Tray, Menu, nativeImage } = electron || {};
  let prefs = { keepInTray: false, noticed: false };
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
      prefs = { keepInTray: saved.keepInTray === true, noticed: saved.noticed === true };
    }
  } catch (err) { console.error('[Tray] could not read the tray setting, keeping Vex closing normally:', err.message); }

  let tray = null;
  let quitting = false;
  let forceClose = false;
  const write = () => atomicWriteSync(file, JSON.stringify(prefs), { fsImpl: fs });

  const win = () => { const w = getMainWindow(); return w && !w.isDestroyed() ? w : null; };
  const t = (s) => translate(s);

  function menu() {
    const paused = !!(quiet && quiet.isPaused());
    const items = [
      { label: t('Open Vex'), click: () => restore() },
      { label: t('New tab'), click: () => { restore(); newTab(); } },
    ];
    if (quiet) {
      items.push({ label: t('Pause notifications'), type: 'checkbox', checked: paused, click: () => togglePause().catch((err) => console.error('[Tray] could not pause notifications:', err.message)) });
    }
    items.push({ type: 'separator' }, { label: t('Quit Vex'), click: () => { quitting = true; quitApp(); } });
    return Menu.buildFromTemplate(items);
  }
  async function togglePause() {
    if (quiet.isPaused()) await quiet.resume(); else await quiet.pause(PAUSE_MS);
    refreshMenu();
  }
  function refreshMenu() { if (tray && !tray.isDestroyed()) tray.setContextMenu(menu()); }

  function ensureTray() {
    if (tray && !tray.isDestroyed()) return;
    if (platform !== 'win32') return;
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('The tray icon could not be read from ' + iconPath);
    tray = new Tray(icon);
    tray.setToolTip('Vex');
    tray.setContextMenu(menu());
    tray.on('click', () => toggle());
    tray.on('double-click', () => restore());
    tray.on('right-click', () => refreshMenu());
  }
  function dropTray() { if (tray && !tray.isDestroyed()) tray.destroy(); tray = null; }
  const trayReady = () => !!(tray && !tray.isDestroyed());

  function restore() {
    const w = win();
    if (!w) { reopenMain(); return; }
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }
  function toggle() {
    const w = win();
    if (w && w.isVisible() && !w.isMinimized() && w.isFocused()) w.hide(); else restore();
  }

  // Called from the window's close event. Returns true when it hid the window (the caller stops the close).
  function handleClose(w, { isPrivate = false } = {}) {
    const reason = quitting ? 'quit' : forceClose ? 'restart' : 'user';
    const d = decideClose({ enabled: prefs.keepInTray, reason, safeMode, isPrivate, trayReady: trayReady() });
    if (d.action !== 'hide') return false;
    w.hide();
    try { closePrivateWindows(); } catch (err) { console.error('[Tray] could not close the private windows:', err.message); }
    if (!prefs.noticed) {
      prefs.noticed = true;
      try { write(); } catch (err) { console.error('[Tray] could not remember that the tray notice was shown:', err.message); }
      notice(t(NOTICE_TEXT));
    }
    log('[Tray] window hidden, Vex keeps running in the tray');
    return true;
  }

  // 'window-all-closed': true means stay alive.
  function handleAllClosed() {
    return decideAllClosed({ enabled: prefs.keepInTray, safeMode, quitting, trayReady: trayReady() }) === 'stay';
  }

  function get() { return { keepInTray: prefs.keepInTray, supported: platform === 'win32' && !safeMode, safeMode }; }
  function set(on) {
    if (typeof on !== 'boolean') throw new Error('Keep in the tray must be on or off');
    if (on && platform !== 'win32') throw new Error('The tray icon is only available on Windows');
    if (on && safeMode) throw new Error('Vex started in safe mode, which does not keep running in the tray');
    if (on) ensureTray(); else dropTray();
    prefs.keepInTray = on;
    write();
    return get();
  }
  // Starts the tray at launch when the setting is on.
  function start() {
    if (prefs.keepInTray && !safeMode) {
      try { ensureTray(); } catch (err) { console.error('[Tray] could not make the tray icon:', err.message); }
    }
  }

  return {
    get, set, start, handleClose, handleAllClosed, restore, refreshMenu,
    markQuitting: () => { quitting = true; },
    setForceClose: (on) => { forceClose = !!on; },
    isQuitting: () => quitting,
    destroy: dropTray,
  };
}

module.exports = { createTrayKeep, decideClose, decideAllClosed, CLOSE_REASONS, NOTICE_TEXT };
