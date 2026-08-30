// === Picture-in-Picture Window Manager ===
//
// The pop-out is a REAL top-level window, not an overlay. That distinction is
// the whole point of this file: it used to be created with
// `skipTaskbar: true` + the 'screen-saver' always-on-top level, which on
// Windows marks the window WS_EX_TOOLWINDOW — it floats above everything but
// gets NO taskbar button and NO Alt+Tab entry. So once you Alt+Tab away the
// focus moved to another app while the pop-out kept painting on top, and there
// was no way back to it: it wasn't in the switcher, and with `minimizable:
// false` + `frame: false` it had no titlebar to click either. It read as
// "stuck/minimized".
//
// Now: framed, minimizable, taskbar-visible, and floated at the gentle
// 'floating' level (which does not sit above fullscreen apps or trap the
// Alt+Tab switcher). It behaves like every other window on the system —
// Alt+Tab reaches it, the taskbar lists it, and it can be moved and minimized.

const { BrowserWindow } = require('electron');

let pipWindow = null;
// Always-on-top preference for the pop-out. Toggled with Ctrl+Shift+P inside
// the window; kept in a module-level var so a re-popped window keeps the choice
// for the rest of the session.
let pipAlwaysOnTop = true;

const PIP_TITLE = 'Vex — Picture-in-Picture';

// Float at 'floating', never 'screen-saver': the screen-saver level draws over
// fullscreen apps and over the Alt+Tab switcher itself. Also drop on-top while
// the pop-out is fullscreen — an always-on-top fullscreen window blocks app
// switching entirely.
function applyPipOnTop(win) {
  try { win.setAlwaysOnTop(pipAlwaysOnTop && !win.isFullScreen(), 'floating'); } catch { /* ignore */ }
}

// Bring an existing pop-out back: un-minimize first (focus() alone does not
// restore a minimized window on Windows), then raise and focus it.
function revealPipWindow(win) {
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  } catch { /* ignore */ }
}

function createPipWindow(url) {
  if (pipWindow && !pipWindow.isDestroyed()) {
    // Re-popping the SAME page just brings the existing window forward —
    // reloading would restart the video that's already playing in it.
    let current = '';
    try { current = pipWindow.webContents.getURL() || ''; } catch { /* ignore */ }
    if (current !== url) pipWindow.loadURL(url);
    revealPipWindow(pipWindow);
    return pipWindow;
  }

  pipWindow = new BrowserWindow({
    width: 400,
    height: 225,
    title: PIP_TITLE,
    // A real frame: gives the window a titlebar to drag, a minimize button, and
    // a name in the Alt+Tab switcher. The old frameless window loaded an
    // arbitrary page URL, so it had no drag region either — it could not be
    // moved, minimized, or switched to.
    frame: true,
    alwaysOnTop: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    // false (the default) is load-bearing: `true` sets WS_EX_TOOLWINDOW on
    // Windows, which removes the window from BOTH the taskbar and Alt+Tab.
    skipTaskbar: false,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  applyPipOnTop(pipWindow);
  pipWindow.setAspectRatio(16 / 9);
  pipWindow.loadURL(url);

  // Keep our title in Alt+Tab / the taskbar instead of letting the popped-out
  // page rename the window to something unrecognizable.
  pipWindow.on('page-title-updated', (e) => { e.preventDefault(); });

  // Fullscreen ⇄ windowed: never stay on-top while fullscreen (Alt+Tab trap).
  pipWindow.on('enter-full-screen', () => applyPipOnTop(pipWindow));
  pipWindow.on('leave-full-screen', () => applyPipOnTop(pipWindow));

  // Ctrl+Shift+P inside the pop-out toggles the on-top pin, so it can be sent
  // behind other windows instead of only being escapable by closing it.
  // Ctrl+W / Escape closes it.
  pipWindow.webContents.on('before-input-event', (_e, input) => {
    if (!input || input.type !== 'keyDown') return;
    if (input.control && input.shift && (input.key === 'P' || input.key === 'p')) {
      pipAlwaysOnTop = !pipAlwaysOnTop;
      applyPipOnTop(pipWindow);
      return;
    }
    if ((input.control && (input.key === 'W' || input.key === 'w')) || input.key === 'Escape') {
      try { if (!pipWindow.isDestroyed()) pipWindow.close(); } catch { /* ignore */ }
    }
  });

  pipWindow.on('closed', () => {
    pipWindow = null;
  });

  return pipWindow;
}

function closePipWindow() {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.close();
    pipWindow = null;
  }
}

function isPipOpen() {
  return pipWindow && !pipWindow.isDestroyed();
}

// Raise an already-open pop-out (restoring it if minimized). Returns false when
// there is nothing open to focus.
function focusPipWindow() {
  if (!isPipOpen()) return false;
  revealPipWindow(pipWindow);
  return true;
}

module.exports = { createPipWindow, closePipWindow, isPipOpen, focusPipWindow };
