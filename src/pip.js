const { BrowserWindow, screen, app } = require('electron');
const path = require('path');
const fs = require('fs');

let pipWindow = null;
// User's pin preference, persisted. Kept out of the window so a re-open
// remembers it even after the window is destroyed.
let alwaysOnTop = true;
let saveTimer = null;

// Remembered geometry + pin preference, same convention as the Discord
// pop-out's popout-state.json.
const STATE_FILE = () => path.join(app.getPath('userData'), 'pip-state.json');
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) || {}; } catch { return {}; }
}
function writeState(state) {
  try { fs.writeFileSync(STATE_FILE(), JSON.stringify(state || {})); } catch { /* ignore */ }
}

const DEFAULT_BOUNDS = { width: 480, height: 300 };

// A position saved on a monitor that is no longer attached would put the
// window off-screen — i.e. an always-on-top window you can neither see nor
// close. Only restore bounds that still land on a connected display.
function usableBounds(saved) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y) ||
      !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return null;
  try {
    const area = screen.getDisplayMatching(saved).workArea;
    const visibleX = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
    const visibleY = Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y);
    if (visibleX < 80 || visibleY < 40) return null;
  } catch { return null; }
  return saved;
}

function applyOnTop() {
  if (!pipWindow || pipWindow.isDestroyed()) return;
  // 'floating', not 'screen-saver': the screen-saver level sits above
  // fullscreen apps and traps Alt+Tab behind it. Same reasoning as the Discord
  // pop-out.
  try { pipWindow.setAlwaysOnTop(alwaysOnTop, 'floating'); } catch { /* ignore */ }
  try { pipWindow.webContents.send('pip:pin-state', alwaysOnTop); } catch { /* ignore */ }
}

function persist() {
  if (!pipWindow || pipWindow.isDestroyed()) return;
  const state = { alwaysOnTop };
  try {
    if (!pipWindow.isMinimized() && !pipWindow.isMaximized() && !pipWindow.isFullScreen()) {
      state.bounds = pipWindow.getBounds();
    } else {
      state.bounds = readState().bounds;
    }
  } catch { /* ignore */ }
  writeState(state);
}

function createPipWindow(url) {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.loadURL(url);
    pipWindow.show();
    pipWindow.focus();
    return pipWindow;
  }

  const saved = readState();
  if (typeof saved.alwaysOnTop === 'boolean') alwaysOnTop = saved.alwaysOnTop;
  const bounds = usableBounds(saved.bounds);

  pipWindow = new BrowserWindow({
    width: bounds ? bounds.width : DEFAULT_BOUNDS.width,
    height: bounds ? bounds.height : DEFAULT_BOUNDS.height,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    minWidth: 220,
    minHeight: 140,
    frame: false,
    alwaysOnTop,
    resizable: true,
    // Closable at the OS level too: a taskbar entry and a minimize button are
    // the fallbacks if the in-page control bar ever fails to draw. The old
    // window had neither, plus no frame and no injected UI, which is why it
    // could not be closed at all.
    minimizable: true,
    maximizable: false,
    closable: true,
    skipTaskbar: false,
    title: 'Vex Picture-in-Picture',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-pip.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  applyOnTop();
  // applyOnTop() above runs before the page exists, so its pin-state message is
  // dropped; re-send once the preload is listening or a restored 'unpinned'
  // preference would still show a pinned button.
  pipWindow.webContents.on('did-finish-load', () => {
    try { pipWindow.webContents.send('pip:pin-state', alwaysOnTop); } catch { /* ignore */ }
  });
  pipWindow.loadURL(url);

  // Main-process key bindings. These fire before the page sees the keystroke,
  // so the window stays closable even on a page that swallows keydown.
  pipWindow.webContents.on('before-input-event', (event, input) => {
    if (!input || input.type !== 'keyDown') return;
    if (input.key === 'Escape' || ((input.control || input.meta) && (input.key === 'w' || input.key === 'W'))) {
      event.preventDefault();
      closePipWindow();
      return;
    }
    if (input.control && input.shift && (input.key === 'p' || input.key === 'P')) {
      event.preventDefault();
      togglePipPin();
    }
  });

  const debouncedPersist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); };
  pipWindow.on('resize', debouncedPersist);
  pipWindow.on('move', debouncedPersist);

  // Zombie-window guards: a hung or crashed renderer in an always-on-top
  // frameless window is exactly the "can't close it" case, so tear it down.
  pipWindow.webContents.on('render-process-gone', (_e, d) => {
    console.error('[Vex PiP] render-process-gone reason=%s exitCode=%s — destroying window', d && d.reason, d && d.exitCode);
    closePipWindow();
  });
  pipWindow.on('unresponsive', () => {
    console.error('[Vex PiP] window unresponsive — destroying it');
    closePipWindow();
  });
  pipWindow.webContents.on('did-fail-load', (_e, ec, ed, u) => {
    if (ec === -3) return; // ERR_ABORTED — a superseded navigation, not a failure
    console.error('[Vex PiP] did-fail-load code=%s desc=%s url=%s', ec, ed, u);
  });

  pipWindow.on('close', persist);
  pipWindow.on('closed', () => { clearTimeout(saveTimer); saveTimer = null; pipWindow = null; });

  return pipWindow;
}

function closePipWindow() {
  if (!pipWindow || pipWindow.isDestroyed()) { pipWindow = null; return; }
  clearTimeout(saveTimer);
  saveTimer = null;
  persist();
  // destroy(), not close(): close() runs the page's beforeunload handler, and
  // a page that cancels it would keep this frameless always-on-top window alive
  // with no way for the user to dismiss it.
  try { pipWindow.destroy(); } catch (e) { console.error('[Vex PiP] destroy failed:', e.message); }
  pipWindow = null;
}

function togglePipPin() {
  alwaysOnTop = !alwaysOnTop;
  applyOnTop();
  persist();
  return alwaysOnTop;
}

function isPipOpen() {
  return !!(pipWindow && !pipWindow.isDestroyed());
}

module.exports = { createPipWindow, closePipWindow, togglePipPin, isPipOpen };
