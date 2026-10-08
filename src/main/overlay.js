// === Overlay mini-Vex =======================================================
//
// A small window that floats over everything else, at whatever opacity you
// like: a guide, a map, a wiki or a stream chat beside a game in borderless
// window mode. It is a real page in Vex's own session, so you stay signed in.
//
// Beyond a thin move/close bar it has no chrome of its own — the keys do the
// work, and they are handled here, before the page sees them, so a page that
// swallows keystrokes cannot trap you in it:
//   Esc            close
//   Ctrl+Up/Down   more / less see-through
//   Ctrl+P         float above other windows, or not
//
// (A game running in exclusive fullscreen draws over everything, this
// included; borderless windowed is the mode this is for.)

const MIN_OPACITY = 0.2;

// The keys alone were not enough: with frame:false and no bar, the mouse could
// neither move nor close the window (found 2026-09-29). This thin bar, like the
// PiP window's (src/preload-pip.js), is a drag handle with a close button. It
// runs in its own isolated world after every load — the overlay shows any site
// and has no preload — so page scripts cannot reach it, and it lives in a
// closed shadow root styled by a constructed sheet, which page CSS cannot
// restyle and a strict style-src CSP does not block. It stays dim until
// hovered and is 20px tall, so it covers as little of the page as it can.
const BAR_WORLD = 1017;
const BAR_SCRIPT = `(() => {
  const HOST_ID = 'vex-overlay-bar';
  const build = () => {
    if (!document.body || document.getElementById(HOST_ID)) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    for (const [k, v] of [['position', 'fixed'], ['inset', '0 0 auto 0'], ['height', '20px'], ['z-index', '2147483647'],
      ['display', 'block'], ['visibility', 'visible'], ['opacity', '1'], ['pointer-events', 'auto']]) host.style.setProperty(k, v, 'important');
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(':host{all:initial}'
      + '.bar{position:fixed;top:0;left:0;right:0;height:20px;display:flex;align-items:center;justify-content:flex-end;'
      + 'background:rgba(12,12,14,.75);opacity:.35;transition:opacity .15s ease;-webkit-app-region:drag;user-select:none}'
      + '.bar:hover{opacity:1}'
      + 'button{all:unset;-webkit-app-region:no-drag;width:28px;height:20px;display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer}'
      + 'button:hover{background:#e5484d}');
    root.adoptedStyleSheets = [sheet];
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.title = 'Drag to move. Esc closes, Ctrl+Up/Down changes see-through, Ctrl+P floats on top or not.';
    const close = document.createElement('button');
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close overlay');
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of [['width', '12'], ['height', '12'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'],
      ['stroke-width', '2'], ['stroke-linecap', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    svg.appendChild(path);
    close.appendChild(svg);
    close.addEventListener('click', () => window.close());
    bar.appendChild(close);
    root.appendChild(bar);
    document.body.appendChild(host);
  };
  build();
  // A page that rebuilds its body would take the bar with it.
  if (!window.__vexOverlayBarHeal) window.__vexOverlayBarHeal = setInterval(build, 2000);
})();`;

function createOverlayWindow({ BrowserWindow, url, opacity = 0.92, partition = 'persist:main', preload = null, onOpacity = null }) {
  const win = new BrowserWindow({
    width: 420, height: 560, minWidth: 220, minHeight: 160,
    frame: false, alwaysOnTop: true, resizable: true, minimizable: true, maximizable: false,
    skipTaskbar: false, title: 'Vex overlay', backgroundColor: '#111111',
    webPreferences: { partition, preload: preload || undefined, contextIsolation: true, nodeIntegration: false, webSecurity: true, additionalArguments: ['--vex-web-window'] },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  let current = clamp(opacity);
  win.setOpacity(current);
  win.loadURL(url);

  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScriptInIsolatedWorld(BAR_WORLD, [{ code: BAR_SCRIPT }])
      .catch((err) => console.error('[overlay] could not add the move/close bar:', err && err.message));
  });

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

module.exports = { createOverlayWindow, clamp, MIN_OPACITY, BAR_SCRIPT };
