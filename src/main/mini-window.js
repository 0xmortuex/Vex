// === A small window for links handed over by other programs (T3-079) ============
//
// A link clicked in Discord, Steam or a mail program reaches Vex as a second start
// (main.js, second-instance). It normally becomes a tab in the main window and
// brings that window forward, which is a lot of Vex for a link you only wanted to
// glance at, and over a game it is the wrong thing altogether. With this switched
// on (Settings > Links and windows, off by default) such a link opens in a small
// window of its own instead:
//
//   * in the normal profile's session (you are signed in as in a tab), sandboxed,
//     with no Vex preload: it is a page, not part of Vex's interface;
//   * shown with the same rule as every window Vex raises on its own
//     (raise-guard.js): while a full-screen game has the screen it appears
//     without taking the focus, and a dot goes on the taskbar button instead;
//   * Ctrl+Shift+Enter turns it into a tab of the main window and closes it
//     (Ctrl+W, or its X, just closes it); one nobody has looked at for a while
//     closes itself (15 minutes by default, never when set to 0);
//   * a link inside it that wants a new window becomes a tab, as in the other
//     small windows Vex opens (Open as App).
//
// Only a plain web address (http or https) is taken; anything else goes the old way.
// At most four are open; a fifth closes the oldest.

const MAX_WINDOWS = 4;
const DEFAULTS = { on: false, autoCloseMinutes: 15 };

function parsePrefs(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...DEFAULTS };
  const minutes = Number.isFinite(saved.autoCloseMinutes) ? Math.max(0, Math.min(240, Math.round(saved.autoCloseMinutes))) : DEFAULTS.autoCloseMinutes;
  return { on: saved.on === true, autoCloseMinutes: minutes };
}

function webAddress(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  return u.href;
}

function createMiniWindows({ BrowserWindow, getPrefs, partition = 'persist:main', register, openAsTab, reveal, log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const open = new Set();

  // → true when the link was taken (the caller then does nothing more with it).
  function take(url) {
    const prefs = parsePrefs(getPrefs());
    if (!prefs.on) return false;
    const href = webAddress(url);
    if (!href) return false;
    while (open.size >= MAX_WINDOWS) {
      const oldest = open.values().next().value;
      open.delete(oldest);
      if (!oldest.isDestroyed()) oldest.close();
    }
    const win = new BrowserWindow({
      width: 480, height: 720, minWidth: 320, minHeight: 360, show: false, autoHideMenuBar: true,
      title: 'Vex mini window',
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true, additionalArguments: ['--vex-web-window'] },
    });
    open.add(win);
    if (register) register(win);
    win.setMenuBarVisibility(false);

    let timer = null;
    const disarm = () => { if (timer) { clearTimer(timer); timer = null; } };
    const arm = () => {
      disarm();
      if (!prefs.autoCloseMinutes) return;
      timer = setTimer(() => { timer = null; if (!win.isDestroyed()) { log('[Mini] closed itself after ' + prefs.autoCloseMinutes + ' minutes unused'); win.close(); } }, prefs.autoCloseMinutes * 60 * 1000);
      if (timer && typeof timer.unref === 'function') timer.unref();
    };
    win.on('focus', disarm);
    win.on('blur', arm);
    win.on('closed', () => { disarm(); open.delete(win); });
    win.once('ready-to-show', () => {
      reveal(win, 'a link opened in the mini window');
      if (!win.isFocused()) arm();
    });

    const wc = win.webContents;
    wc.on('page-title-updated', (event, title) => {
      event.preventDefault();
      win.setTitle((title ? title.slice(0, 60) + ' - ' : '') + 'Vex mini window (Ctrl+Shift+Enter makes it a tab)');
    });
    wc.on('before-input-event', (event, input) => {
      if (!input || input.type !== 'keyDown') return;
      const key = String(input.key || '');
      if (input.control && input.shift && !input.alt && key === 'Enter') {
        event.preventDefault();
        const here = webAddress(wc.getURL()) || href;
        openAsTab(here);
        win.close();
      } else if (input.control && !input.shift && !input.alt && key.toLowerCase() === 'w') {
        event.preventDefault();
        win.close();
      }
    });
    win.loadURL(href).catch(err => {
      // A load stopped by another (a redirect, a download) is not a failure.
      if (!/ERR_ABORTED|\(-3\)/.test(String((err && err.message) || err))) log('[Mini] the link could not be loaded: ' + ((err && err.message) || err));
    });
    return true;
  }

  return { take, count: () => open.size, windows: () => [...open] };
}

module.exports = { createMiniWindows, parsePrefs, webAddress, MAX_WINDOWS, DEFAULTS };
