// === Overlay mini-Vex =======================================================
//
// A small window that floats over everything else, at whatever opacity you
// like: a guide, a map, a wiki or a stream chat beside a game in borderless
// window mode. It is a real page in Vex's own session, so you stay signed in.
//
// It has no chrome of its own — the keys do the work, and they are handled
// here, before the page sees them, so a page that swallows keystrokes cannot
// trap you in it:
//   Esc            close
//   Ctrl+Up/Down   more / less see-through
//   Ctrl+P         float above other windows, or not
//
// (A game running in exclusive fullscreen draws over everything, this
// included; borderless windowed is the mode this is for.)

const MIN_OPACITY = 0.2;

function createOverlayWindow({ BrowserWindow, url, opacity = 0.92, partition = 'persist:main', preload = null, onOpacity = null }) {
  const win = new BrowserWindow({
    width: 420, height: 560, minWidth: 220, minHeight: 160,
    frame: false, alwaysOnTop: true, resizable: true, minimizable: true, maximizable: false,
    skipTaskbar: false, title: 'Vex overlay', backgroundColor: '#111111',
    webPreferences: { partition, preload: preload || undefined, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  let current = clamp(opacity);
  win.setOpacity(current);
  win.loadURL(url);

  win.webContents.on('before-input-event', (event, input) => {
    if (!input || input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'Escape') { event.preventDefault(); win.close(); return; }
    if (!ctrl) return;
    if (input.key === 'ArrowUp' || input.key === 'ArrowDown') {
      event.preventDefault();
      current = clamp(current + (input.key === 'ArrowUp' ? 0.05 : -0.05));
      win.setOpacity(current);
      if (onOpacity) onOpacity(current);
      return;
    }
    if ((input.key || '').toLowerCase() === 'p') {
      event.preventDefault();
      const on = !win.isAlwaysOnTop();
      win.setAlwaysOnTop(on, 'screen-saver');
    }
  });
  return win;
}

function clamp(n) { return Math.min(1, Math.max(MIN_OPACITY, Math.round(Number(n) * 100) / 100)); }

module.exports = { createOverlayWindow, clamp, MIN_OPACITY };
