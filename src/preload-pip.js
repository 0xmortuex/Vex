// === Preload for the PiP pop-out window ===
//
// The PiP window is frameless — a floating video player shouldn't wear an OS
// title bar. But frameless also meant it had NO close affordance whatsoever:
// no titlebar X, no taskbar button, no keyboard handler and nothing injected
// into the page. Once open, the only way out was Task Manager.
//
// This preload draws Vex's own control bar over the page: a drag handle, "back
// to tab", a pin toggle and a close button. It runs in the isolated world,
// which still shares the DOM, so it builds the bar directly rather than going
// through the page: an injected inline <script> is refused by any strict page
// CSP, and webContents.executeJavaScript would have to be re-run by hand on
// every navigation.
//
// The bar lives inside a shadow root so page CSS can't restyle or hide it, and
// the main process additionally binds Escape / Ctrl+W (see pip.js) so the
// window stays closable even if a page manages to eat the DOM entirely.

const { ipcRenderer } = require('electron');

const HOST_ID = 'vex-pip-controls';

const BAR_CSS = `
  :host { all: initial; }
  .bar {
    position: fixed; top: 0; left: 0; right: 0; height: 32px;
    display: flex; align-items: center; gap: 4px;
    padding: 0 4px 0 10px;
    font: 12px/1 system-ui, "Segoe UI", sans-serif;
    color: #fff;
    background: linear-gradient(to bottom, rgba(12,12,14,.92), rgba(12,12,14,.55));
    opacity: .6; transition: opacity .15s ease;
    -webkit-app-region: drag;
    user-select: none;
  }
  .bar:hover { opacity: 1; }
  .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .8; }
  button {
    -webkit-app-region: no-drag;
    all: unset;
    width: 26px; height: 24px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 5px; cursor: pointer;
    font: 13px/1 system-ui, "Segoe UI", sans-serif; color: #fff;
  }
  button:hover { background: rgba(255,255,255,.18); }
  button.close:hover { background: #e5484d; }
  button.pinned { background: rgba(255,255,255,.22); }
`;

let pinned = true;

function build() {
  if (!document.body || document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  // The host must sit above every page element and must not be reachable by
  // page selectors, so set the few properties that matter as !important.
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('inset', '0 0 auto 0', 'important');
  host.style.setProperty('height', '32px', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('visibility', 'visible', 'important');
  host.style.setProperty('opacity', '1', 'important');
  host.style.setProperty('pointer-events', 'auto', 'important');

  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = BAR_CSS;

  const bar = document.createElement('div');
  bar.className = 'bar';

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = 'Vex Picture-in-Picture';

  const mkBtn = (label, tip, cls) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = tip;
    if (cls) b.className = cls;
    return b;
  };

  const backBtn = mkBtn('↩', 'Back to tab (returns you to Vex and closes this window)');
  const pinBtn = mkBtn('\u{1F4CC}', 'Keep on top (Ctrl+Shift+P)', 'pinned');
  const closeBtn = mkBtn('✕', 'Close (Esc)', 'close');

  backBtn.addEventListener('click', () => ipcRenderer.send('pip:back-to-tab'));
  closeBtn.addEventListener('click', () => ipcRenderer.send('pip:close'));
  pinBtn.addEventListener('click', () => ipcRenderer.send('pip:toggle-pin'));

  bar.append(title, backBtn, pinBtn, closeBtn);
  root.append(style, bar);
  document.body.appendChild(host);

  currentPinBtn = pinBtn;
  paintPin();
}

// The pin button's look follows the main process's stored preference. Kept out
// of build() on purpose: build() re-runs whenever a navigation wipes the bar
// out of the DOM, and registering the listener there would stack a fresh one
// on every page load.
let currentPinBtn = null;
function paintPin() {
  if (!currentPinBtn) return;
  currentPinBtn.className = pinned ? 'pinned' : '';
  currentPinBtn.title = pinned ? 'Keep on top (Ctrl+Shift+P)' : 'Not on top (Ctrl+Shift+P)';
}
ipcRenderer.on('pip:pin-state', (_e, on) => { pinned = !!on; paintPin(); });

function ensure() {
  try { build(); } catch (e) { console.error('[Vex PiP] control bar failed:', e.message); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensure, { once: true });
} else {
  ensure();
}
// Cheap self-heal: if a page tears the bar out of the DOM, rebuild it.
setInterval(ensure, 2000);

// Keyboard escapes. The main process binds these too (before-input-event in
// pip.js) so they work even when the page has focus and swallows key events;
// this listener covers the window before any page script sees the key.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { ipcRenderer.send('pip:close'); return; }
  if (e.key === 'w' && (e.ctrlKey || e.metaKey)) { ipcRenderer.send('pip:close'); }
}, true);
