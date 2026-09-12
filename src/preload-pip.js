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

// The bar shows what is playing, when the player knows.
let pageTitle = '';
let currentTitleEl = null;
function paintTitle() {
  if (currentTitleEl) currentTitleEl.textContent = pageTitle || 'Vex Picture-in-Picture';
}


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
  currentTitleEl = title;
  title.textContent = pageTitle || 'Vex Picture-in-Picture';

  const ICON = (inner) => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  // `label` is plain text, or markup from ICON().
  const mkBtn = (label, tip, cls) => {
    const b = document.createElement('button');
    if (label.startsWith('<svg')) b.innerHTML = label; else b.textContent = label;
    b.setAttribute('aria-label', tip);
    b.title = tip;
    if (cls) b.className = cls;
    return b;
  };

  const backBtn = mkBtn(ICON('<path d="M4.5 10.5h10a5 5 0 0 1 0 10H9"/><path d="m8.5 6-4 4.5 4 4.5"/>'), 'Back to tab (returns you to Vex and closes this window)');
  const pinBtn = mkBtn(ICON('<path d="M9 4h6l-1 6 3.5 3H6.5L10 10z"/><path d="M12 13v7"/>'), 'Keep on top (Ctrl+Shift+P)', 'pinned');
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

// === The floating player ==================================================
// When the window is showing pip-player.html rather than a whole site, main
// hands over the video the tab was playing: its source, where it had got to,
// and whether it was paused. The page itself has no script (its CSP forbids
// one), so everything is done from here.
ipcRenderer.on('pip:media', (_e, media) => {
  const video = document.getElementById('vex-pip-video');
  if (!video || !media || !media.src) return;
  const fail = (why) => {
    const box = document.getElementById('msg');
    const detail = document.getElementById('msg-detail');
    if (detail && why) detail.textContent = why;
    if (box) box.classList.add('show');
    video.style.display = 'none';
  };
  video.addEventListener('error', () => {
    // Most often a CDN that wants the page's own cookies or referer.
    fail('The site would not serve this video to a separate window. Close this and use the tab.');
  }, { once: true });
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(media.currentTime) && media.currentTime > 0) {
      try { video.currentTime = media.currentTime; } catch { /* unseekable stream */ }
    }
    if (media.paused) { try { video.pause(); } catch { /* fine */ } }
  }, { once: true });
  if (media.poster) video.poster = media.poster;
  video.src = media.src;
  pageTitle = media.title || '';
  paintTitle();
});

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
