const { app, BrowserWindow, session, ipcMain, protocol, globalShortcut, Menu, net, shell, dialog, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { shouldBlock } = require('./adblocker');
const { createPipWindow, closePipWindow } = require('./pip');

// Auto-updater (graceful — works in dev, fails silently if not packaged)
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch {}

let mainWindow = null;
let adBlockerEnabled = true;
let pendingOpenUrl = null;
// Auto-open DevTools when unpackaged (dev) or when --dev-tools is passed
const enableDevToolsAtStartup = process.argv.includes('--dev-tools') || !app.isPackaged;

// Clean up global shortcuts on quit
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });

// F11 / Escape fullscreen handling — shared between the main-window and every
// <webview> guest webContents, because before-input-event only fires on the
// webContents that actually has focus. Without attaching to both, F11 only
// works when Vex's chrome is focused (URL bar etc.) and dies the moment the
// user clicks into a page. Returns true if the input was consumed so callers
// can skip their remaining handlers.
function handleFullscreenShortcut(event, input) {
  if (!mainWindow || input.type !== 'keyDown') return false;

  if (input.key === 'F11' && !input.control && !input.alt && !input.shift && !input.meta) {
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    event.preventDefault();
    return true;
  }

  if (input.key === 'Escape' && mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    event.preventDefault();
    return true;
  }

  return false;
}

// F12 / Ctrl+Shift+I — toggle Chromium DevTools on the currently active webview.
// Attached to both the main window and every guest webContents for the same
// reason as the fullscreen handler: before-input-event only fires where focus
// lives, so without the guest hook F12 dies as soon as a page is clicked into.
// The renderer owns the "which tab is active" mapping, so we bounce through IPC
// rather than trying to guess from main.
function handleDevToolsShortcut(event, input) {
  if (!mainWindow || input.type !== 'keyDown') return false;

  const isDevToolsKey = input.key === 'F12' ||
    (input.control && input.shift && (input.key === 'I' || input.key === 'i'));
  if (!isDevToolsKey) return false;

  event.preventDefault();
  mainWindow.webContents.send('devtools:toggle');
  return true;
}

// === Single-instance lock (so external links route to existing Vex window) ===
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    const url = commandLine.find(a => a.startsWith('http://') || a.startsWith('https://'));
    if (url && mainWindow) {
      mainWindow.webContents.send('open-url', url);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// === Register Vex as HTTP/HTTPS protocol handler ===
if (process.defaultApp) {
  // Dev mode
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('http', process.execPath, [path.resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient('https', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
}

// macOS open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('open-url', url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingOpenUrl = url;
  }
});

// Storage helpers
const userDataPath = app.getPath('userData');

// === Download tracking helper (hoisted so private-window sessions can reuse it) ===
function _broadcastDownloadEvent(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) { try { w.webContents.send(channel, data); } catch {} }
  });
}
// === Site permission handler (geolocation, camera, mic, notifications, ...) ===
const permissionsFile = path.join(userDataPath, 'permissions.json');
const pendingPermissions = new Map();

// On cold start the renderer may not have registered its 'permission:request'
// listener yet when a webview fires a permission check. Queue sends until the
// renderer signals ready (or the fallback flush fires), otherwise the first
// prompt of the session silently times out.
let _permissionsRendererReady = false;
const _pendingPermissionSends = [];
function _deliverPermissionRequest(payload) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win) return false;
  try { win.webContents.send('permission:request', payload); return true; }
  catch { return false; }
}
function sendPermissionRequest(payload) {
  if (_permissionsRendererReady && _deliverPermissionRequest(payload)) return;
  _pendingPermissionSends.push(payload);
}
function _flushPermissionQueue(reason) {
  if (!_pendingPermissionSends.length) return;
  console.log(`[Permissions] flushing ${_pendingPermissionSends.length} queued request(s): ${reason}`);
  while (_pendingPermissionSends.length) {
    const p = _pendingPermissionSends.shift();
    if (!_deliverPermissionRequest(p)) {
      _pendingPermissionSends.unshift(p);
      return;
    }
  }
}
ipcMain.on('permissions:renderer-ready', () => {
  _permissionsRendererReady = true;
  _flushPermissionQueue('renderer signalled ready');
});

function loadPermissionDecisions() {
  try {
    if (fs.existsSync(permissionsFile)) {
      return JSON.parse(fs.readFileSync(permissionsFile, 'utf-8')) || {};
    }
  } catch {}
  return {};
}
function savePermissionDecisions(data) {
  try { fs.writeFileSync(permissionsFile, JSON.stringify(data, null, 2), 'utf-8'); }
  catch (err) { console.error('[Permissions] save failed:', err.message); }
}

function wirePermissionsOnSession(ses, tag) {
  if (!ses || ses.__vexPermsWired) return;
  ses.__vexPermsWired = true;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = 'unknown';
    try { origin = new URL((details && details.requestingUrl) || webContents.getURL()).origin; } catch {}

    console.log(`[Permissions] (${tag}) ${origin} requests: ${permission}`);

    // Standard browser auto-allow list
    const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-read', 'clipboard-sanitized-write']);
    if (AUTO_ALLOW.has(permission)) return callback(true);

    const NEEDS_PROMPT = new Set(['geolocation', 'media', 'mediaKeySystem', 'midi', 'midiSysex', 'notifications', 'camera', 'microphone', 'display-capture']);
    if (!NEEDS_PROMPT.has(permission)) {
      // Unknown permission — deny by default, but log so we can add it later
      console.log(`[Permissions] DENIED (unlisted): ${permission}`);
      return callback(false);
    }

    // Check persisted decisions
    const decisions = loadPermissionDecisions();
    const key = `${origin}::${permission}`;
    if (decisions[key] === 'allow') return callback(true);
    if (decisions[key] === 'deny')  return callback(false);

    // Ask the user — queued if the renderer isn't listening yet (cold start).
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pendingPermissions.set(id, callback);
    sendPermissionRequest({ id, origin, permission });

    // Safety timeout — if the user ignores the prompt for 2 minutes, deny.
    setTimeout(() => {
      if (pendingPermissions.has(id)) {
        pendingPermissions.delete(id);
        try { callback(false); } catch {}
      }
    }, 120000);
  });

  // Sync check (used by navigator.permissions.query) — only grant if explicitly allowed
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    const decisions = loadPermissionDecisions();
    return decisions[`${requestingOrigin}::${permission}`] === 'allow';
  });
}

ipcMain.handle('permission:respond', (_e, payload) => {
  const { id, decision, remember, origin, permission } = payload || {};
  const cb = pendingPermissions.get(id);
  if (!cb) return { ok: false, error: 'No pending request' };
  pendingPermissions.delete(id);
  try { cb(decision === 'allow'); } catch {}
  if (remember && origin && permission) {
    const d = loadPermissionDecisions();
    d[`${origin}::${permission}`] = decision;
    savePermissionDecisions(d);
  }
  return { ok: true };
});
ipcMain.handle('permissions:list',     () => loadPermissionDecisions());
ipcMain.handle('permissions:revoke',   (_e, key) => { const d = loadPermissionDecisions(); delete d[key]; savePermissionDecisions(d); return { ok: true }; });
ipcMain.handle('permissions:clear-all', () => { savePermissionDecisions({}); return { ok: true }; });

function wireAdblockerOnSession(ses, tag) {
  if (!ses || ses.__vexAdblockWired) return;
  ses.__vexAdblockWired = true;
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (adBlockerEnabled && shouldBlock(details.url)) {
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });
}

function wireDownloadsOnSession(ses, tag) {
  if (!ses || ses.__vexDownloadsWired) return;
  ses.__vexDownloadsWired = true;
  ses.on('will-download', (event, item) => {
    const savePath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
    const info = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileName: item.getFilename(),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      path: savePath,
      startedAt: new Date().toISOString()
    };
    console.log(`[Downloads] (${tag || 'session'}) start:`, info.fileName, info.totalBytes, 'bytes');
    _broadcastDownloadEvent('download-started', info);
    item.on('updated', (_e, state) => {
      _broadcastDownloadEvent('download-progress', {
        id: info.id,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state
      });
    });
    item.once('done', (_e, state) => {
      console.log(`[Downloads] (${tag || 'session'}) done:`, info.fileName, state);
      _broadcastDownloadEvent('download-complete', {
        id: info.id, fileName: info.fileName, state, path: savePath
      });
    });
  });
}

// === Phase 18: Chrome extension loader ===
const extensionsDir = path.join(userDataPath, 'extensions');
if (!fs.existsSync(extensionsDir)) fs.mkdirSync(extensionsDir, { recursive: true });

const EXT_PARTITIONS = ['persist:main']; // tabs all share this; add more if new partitions appear

function _copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) _copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function _extEntries() {
  if (!fs.existsSync(extensionsDir)) return [];
  return fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const extPath = path.join(extensionsDir, e.name);
      const manifestPath = path.join(extPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return null;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        return { folder: e.name, path: extPath, manifest };
      } catch { return null; }
    })
    .filter(Boolean);
}

async function _loadExtensionEverywhere(extPath) {
  const sessions = [session.defaultSession, ...EXT_PARTITIONS.map(p => session.fromPartition(p))];
  let loaded = null;
  for (const ses of sessions) {
    try {
      const ext = await ses.loadExtension(extPath, { allowFileAccess: true });
      if (!loaded) loaded = ext;
    } catch (err) {
      console.error(`[Extensions] load failed (${ses === session.defaultSession ? 'default' : 'partition'}):`, err.message);
    }
  }
  return loaded;
}

async function loadAllExtensionsOnStartup() {
  for (const entry of _extEntries()) {
    try {
      const ext = await _loadExtensionEverywhere(entry.path);
      if (ext) console.log(`[Extensions] Loaded: ${ext.name} v${ext.manifest.version}`);
    } catch (err) {
      console.error(`[Extensions] Failed to load ${entry.folder}:`, err.message);
    }
  }
}

ipcMain.handle('extensions:list', () => {
  return _extEntries().map(e => ({
    folder: e.folder,
    name: e.manifest.name || e.folder,
    version: e.manifest.version || '—',
    description: e.manifest.description || '',
    path: e.path
  }));
});

ipcMain.handle('extensions:install-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select extension folder (must contain manifest.json)',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };

  const sourceFolder = result.filePaths[0];
  const manifestPath = path.join(sourceFolder, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, error: 'No manifest.json in that folder' };

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const slug = String(manifest.name || 'extension').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const destFolder = path.join(extensionsDir, `${slug}-${Date.now()}`);
    _copyDirRecursive(sourceFolder, destFolder);
    const ext = await _loadExtensionEverywhere(destFolder);
    return ext
      ? { ok: true, id: ext.id, name: ext.name, version: ext.manifest.version }
      : { ok: false, error: 'Loaded files but extension didn\'t attach' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('extensions:install-zip', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select extension .zip or .crx',
    filters: [{ name: 'Extensions', extensions: ['zip', 'crx'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };

  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch { return { ok: false, error: 'adm-zip missing — run npm install' }; }

  try {
    const sourcePath = result.filePaths[0];
    let zipBuffer = fs.readFileSync(sourcePath);
    // Strip CRX header if present
    if (zipBuffer.slice(0, 4).toString() === 'Cr24') {
      const version = zipBuffer.readUInt32LE(4);
      if (version === 2) {
        const pubKeyLen = zipBuffer.readUInt32LE(8);
        const sigLen = zipBuffer.readUInt32LE(12);
        zipBuffer = zipBuffer.slice(16 + pubKeyLen + sigLen);
      } else if (version === 3) {
        const headerLen = zipBuffer.readUInt32LE(8);
        zipBuffer = zipBuffer.slice(12 + headerLen);
      } else {
        return { ok: false, error: 'Unknown CRX version: ' + version };
      }
    }
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    // Find manifest.json — prefer the root, but fall back to the shallowest
    // match if the archive has the extension inside a wrapper folder
    // (e.g. GitHub release zips like "uBlock0.chromium/manifest.json").
    let manifestEntry = entries.find(e => e.entryName === 'manifest.json');
    let rootPath = '';
    if (!manifestEntry) {
      const candidates = entries
        .filter(e => !e.isDirectory && e.entryName.endsWith('/manifest.json'))
        .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length);
      if (candidates.length) {
        manifestEntry = candidates[0];
        rootPath = manifestEntry.entryName.replace(/manifest\.json$/, ''); // keeps trailing slash
      }
    }
    if (!manifestEntry) return { ok: false, error: 'No manifest.json found anywhere in the archive' };

    const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
    const slug = String(manifest.name || 'extension').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const destFolder = path.join(extensionsDir, `${slug}-${Date.now()}`);
    if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

    // Extract only the files under rootPath (or everything if the manifest
    // is already at the archive root) and strip the wrapper prefix.
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = entry.entryName;
      if (rootPath && !name.startsWith(rootPath)) continue;
      const rel = rootPath ? name.slice(rootPath.length) : name;
      if (!rel) continue;
      const outPath = path.join(destFolder, rel);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outPath, entry.getData());
    }

    if (!fs.existsSync(path.join(destFolder, 'manifest.json'))) {
      fs.rmSync(destFolder, { recursive: true, force: true });
      return { ok: false, error: 'Failed to place manifest.json at destination root' };
    }

    const ext = await _loadExtensionEverywhere(destFolder);
    return ext
      ? { ok: true, id: ext.id, name: ext.name, version: ext.manifest.version }
      : { ok: false, error: 'Extracted but extension didn\'t load (check console for details)' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('extensions:uninstall', async (_e, folderName) => {
  const extPath = path.join(extensionsDir, folderName);
  if (!fs.existsSync(extPath)) return { ok: false, error: 'Not found' };
  try {
    const sessions = [session.defaultSession, ...EXT_PARTITIONS.map(p => session.fromPartition(p))];
    for (const ses of sessions) {
      try {
        for (const ext of ses.getAllExtensions()) {
          if (path.resolve(ext.path) === path.resolve(extPath)) ses.removeExtension(ext.id);
        }
      } catch {}
    }
    fs.rmSync(extPath, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('extensions:open-folder', () => { shell.openPath(extensionsDir); return { ok: true }; });

// Load installed extensions once the app is ready
app.whenReady().then(() => { loadAllExtensionsOnStartup().catch(() => {}); });

// === External protocol forwarding ===
// Custom-scheme URLs (roblox://, mailto:, discord://, etc.) aren't handled by
// Chromium — by default they error with ERR_UNKNOWN_URL_SCHEME inside a
// webview. Forward recognised ones to the OS via shell.openExternal so the
// installed desktop app launches. Note: webRequest.onBeforeRequest is a
// network-pipeline hook and never sees non-http schemes, so intercept at the
// navigation layer (will-navigate + setWindowOpenHandler) instead.
const EXTERNAL_PROTOCOLS = new Set([
  'roblox', 'roblox-player', 'roblox-studio',
  'mailto', 'tel', 'sms',
  'msteams', 'slack', 'zoommtg', 'zoomus', 'skype', 'discord',
  'vscode', 'vscode-insiders', 'obsidian',
  'spotify', 'steam',
  'ms-word', 'ms-excel', 'ms-powerpoint',
  'itmss', 'itms', 'itms-apps',
  'web+mastodon'
]);

function isExternalProtocol(url) {
  if (!url) return false;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!m) return false;
  return EXTERNAL_PROTOCOLS.has(m[1].toLowerCase());
}

function handleExternalProtocol(url) {
  if (!isExternalProtocol(url)) return false;
  console.log(`[Protocol] Forwarding to OS: ${url}`);
  shell.openExternal(url).catch(err => {
    console.error('[Protocol] openExternal failed:', err.message);
  });
  return true;
}

// === Route webview new-window requests into Vex tabs (not new BrowserWindows) ===
// The renderer's webview 'new-window' DOM event is legacy and unreliable in
// Electron 30+. setWindowOpenHandler in main is the supported path.
app.on('web-contents-created', (_event, contents) => {
  // Only intercept for webviews hosting tabs — never for the main window or
  // for extension background pages (those need their own window.open semantics).
  const type = contents.getType();
  if (type !== 'webview') return;

  contents.setWindowOpenHandler((details) => {
    const { url, disposition } = details || {};
    // External-protocol window.open (e.g. Roblox Play button spawns a hidden
    // window to roblox-player://…) — forward to the OS instead of creating a
    // dead tab that would just error out.
    if (handleExternalProtocol(url)) {
      return { action: 'deny' };
    }
    console.log(`[new-window] ${disposition} -> ${url}`);
    try {
      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
      if (win && url) {
        win.webContents.send('tab:create-from-external', {
          url,
          background: disposition === 'background-tab' || disposition === 'save-to-disk'
        });
      }
    } catch (err) { console.error('[new-window] forward failed:', err.message); }
    return { action: 'deny' };
  });

  // Same story for top-level navigations: some Roblox flows swap the current
  // webview's location to roblox-player://…, so catch those before Chromium
  // blocks them.
  contents.on('will-navigate', (evt, url) => {
    if (handleExternalProtocol(url)) {
      evt.preventDefault();
    }
  });

  // Subframe navigations — Roblox's "Play" button sets the src of a hidden
  // iframe to roblox-player://launch?…, which does NOT trigger will-navigate
  // (main-frame only). will-frame-navigate fires for every frame including
  // iframes, so the Bloxstrap handoff actually reaches the OS.
  if (typeof contents.on === 'function') {
    try {
      contents.on('will-frame-navigate', (evt, url) => {
        if (handleExternalProtocol(url)) {
          evt.preventDefault();
        }
      });
    } catch { /* older Electron without will-frame-navigate */ }
  }

  // Block window.onbeforeunload confirm prompts (prevents "Leave page?" spam
  // when user closes a tab that has an unload handler).
  contents.on('will-prevent-unload', (evt) => evt.preventDefault());

  // F11 / Esc fullscreen and F12 / Ctrl+Shift+I DevTools must work even when
  // the guest page has focus. Without this, pressing them inside any loaded
  // website is a no-op.
  contents.on('before-input-event', (event, input) => {
    if (handleFullscreenShortcut(event, input)) return;
    handleDevToolsShortcut(event, input);
  });
});
const storagePath = path.join(userDataPath, 'vex-storage');

if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
}

function getStorageFile(key) {
  return path.join(storagePath, `${key}.json`);
}

// === Persistent key/value store (survives reinstalls / Chromium-origin changes) ===
// Backs the localStorage shim in the renderer. Single JSON file, atomic writes.
const persistFile = path.join(userDataPath, 'vex-persist.json');
let _persistCache = null;
function _persistLoad() {
  if (_persistCache) return _persistCache;
  try {
    if (fs.existsSync(persistFile)) {
      _persistCache = JSON.parse(fs.readFileSync(persistFile, 'utf-8'));
    }
  } catch (e) { console.error('[persist] load failed:', e); }
  if (!_persistCache) _persistCache = {};
  return _persistCache;
}
function _persistSaveDebounced() {
  if (_persistSaveDebounced._t) clearTimeout(_persistSaveDebounced._t);
  _persistSaveDebounced._t = setTimeout(() => {
    try {
      const tmp = persistFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(_persistCache, null, 2), 'utf-8');
      fs.renameSync(tmp, persistFile);
    } catch (e) { console.error('[persist] save failed:', e); }
  }, 250);
}
ipcMain.handle('persist-get-all', () => _persistLoad());

// === Geolocation preference exposed to webview preloads ===
// The preload polyfill (preload-webview.js) runs in guest processes and can't
// touch the renderer's localStorage directly, so it asks us. We read from the
// already-loaded persist cache — values land here as the same JSON-stringified
// strings the renderer wrote via persist-set, so JSON.parse is required.
function _readPersistString(key, fallback) {
  const raw = _persistLoad()[key];
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch { return typeof raw === 'string' ? raw : fallback; }
}
ipcMain.handle('geolocation:get', () => {
  const mode = _readPersistString('vex.locationMode', 'manual');
  if (mode === 'off') return { mode: 'off' };
  if (mode === 'manual') {
    let m = _readPersistString('vex.manualLocation', null);
    // Defensive: if the value somehow round-tripped as a JSON-encoded string
    // (double-encoding), parse it one more layer.
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch {} }
    if (m && m.v && typeof m.v === 'object') m = m.v;
    const lat = m ? parseFloat(m.latitude) : NaN;
    const lng = m ? parseFloat(m.longitude) : NaN;
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return { mode: 'manual', latitude: lat, longitude: lng };
    }
    // No coords saved yet — fall through to IP so first-run isn't broken.
    return { mode: 'ip' };
  }
  return { mode: 'ip' };
});

// Geolocation permission gate — the polyfill can't go through Chromium's
// setPermissionRequestHandler because it has replaced navigator.geolocation,
// so it asks us here. We reuse the existing permission prompt + decision store.
ipcMain.handle('geolocation:check-permission', async (_e, { origin } = {}) => {
  if (!origin || origin === 'null') return 'allow';

  const decisions = loadPermissionDecisions();
  const key = `${origin}::geolocation`;
  if (decisions[key] === 'allow') return 'allow';
  if (decisions[key] === 'deny') return 'deny';

  return await new Promise((resolve) => {
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    const settle = (allowed) => {
      if (settled) return;
      settled = true;
      resolve(allowed ? 'allow' : 'deny');
    };
    // The existing permission:respond handler calls this with (true|false)
    // and persists the decision itself when `remember` is set.
    pendingPermissions.set(id, settle);
    sendPermissionRequest({ id, origin, permission: 'geolocation' });

    setTimeout(() => {
      if (pendingPermissions.has(id)) {
        pendingPermissions.delete(id);
        settle(false);
      }
    }, 60000);
  });
});
ipcMain.handle('persist-set', (_e, key, value) => {
  const data = _persistLoad();
  data[key] = value;
  _persistSaveDebounced();
  return true;
});
ipcMain.handle('persist-delete', (_e, key) => {
  const data = _persistLoad();
  delete data[key];
  _persistSaveDebounced();
  return true;
});
ipcMain.handle('get-user-data-path', () => userDataPath);

// === Phase 13: Vex Sync — encryption key + session metadata ===
const syncKeyFile = path.join(userDataPath, 'sync-key.bin');
const syncMetaFile = path.join(userDataPath, 'sync-meta.json');

ipcMain.handle('sync-save-key', (_e, hex) => {
  try {
    fs.writeFileSync(syncKeyFile, String(hex || ''), { encoding: 'utf-8', mode: 0o600 });
    return true;
  } catch (err) {
    console.error('[sync] save key failed:', err);
    return false;
  }
});

ipcMain.handle('sync-load-key', () => {
  try {
    if (!fs.existsSync(syncKeyFile)) return null;
    return fs.readFileSync(syncKeyFile, 'utf-8').trim() || null;
  } catch { return null; }
});

ipcMain.handle('sync-save-meta', (_e, meta) => {
  try {
    fs.writeFileSync(syncMetaFile, JSON.stringify(meta || {}, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[sync] save meta failed:', err);
    return false;
  }
});

ipcMain.handle('sync-load-meta', () => {
  try {
    if (!fs.existsSync(syncMetaFile)) return null;
    return JSON.parse(fs.readFileSync(syncMetaFile, 'utf-8'));
  } catch { return null; }
});

ipcMain.handle('sync-clear-state', () => {
  try {
    if (fs.existsSync(syncKeyFile)) fs.unlinkSync(syncKeyFile);
    if (fs.existsSync(syncMetaFile)) fs.unlinkSync(syncMetaFile);
    return true;
  } catch (err) {
    console.error('[sync] clear failed:', err);
    return false;
  }
});
// Flush synchronously on quit so nothing is lost
app.on('before-quit', () => {
  try {
    if (_persistCache) {
      fs.writeFileSync(persistFile, JSON.stringify(_persistCache, null, 2), 'utf-8');
    }
  } catch {}
});

// Register custom protocol BEFORE app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'vex', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (enableDevToolsAtStartup) {
    mainWindow.webContents.once('did-finish-load', () => {
      try { mainWindow.webContents.openDevTools({ mode: 'bottom' }); } catch {}
    });
  }

  // Belt-and-suspenders: if the renderer hasn't signalled 'permissions:renderer-ready'
  // within 500ms of did-finish-load, flush the queue anyway. Protects against
  // a renderer script that crashes before init() but still has the IPC channel.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!_permissionsRendererReady && _pendingPermissionSends.length) {
        console.warn('[Permissions] renderer-ready signal not received 500ms after load, flushing anyway');
      }
      _permissionsRendererReady = true;
      _flushPermissionQueue('fallback after did-finish-load');
    }, 500);
  });

  // Header stripping for webviews
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    if (responseHeaders) {
      delete responseHeaders['x-frame-options'];
      delete responseHeaders['X-Frame-Options'];
      delete responseHeaders['X-FRAME-OPTIONS'];
      if (responseHeaders['content-security-policy']) {
        responseHeaders['content-security-policy'] = responseHeaders['content-security-policy'].map(
          csp => csp.replace(/frame-ancestors[^;]*;?/gi, '')
        );
      }
      if (responseHeaders['Content-Security-Policy']) {
        responseHeaders['Content-Security-Policy'] = responseHeaders['Content-Security-Policy'].map(
          csp => csp.replace(/frame-ancestors[^;]*;?/gi, '')
        );
      }
    }
    callback({ responseHeaders });
  });

  // Named partitions used by sidebar panels (whatsapp/claude/gmail) — header stripping
  // so they can be embedded in panels. persist:main is the default tabs session;
  // it gets adblocker/permissions/downloads/preload wiring below but no header
  // strip since regular tabs don't need their own frame-ancestors loosened.
  const partitions = ['persist:whatsapp', 'persist:claude', 'persist:gmail'];
  partitions.forEach(partName => {
    const ses = session.fromPartition(partName);

    ses.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      if (responseHeaders) {
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['X-Frame-Options'];
        delete responseHeaders['X-FRAME-OPTIONS'];
        if (responseHeaders['content-security-policy']) {
          responseHeaders['content-security-policy'] = responseHeaders['content-security-policy'].map(
            csp => csp.replace(/frame-ancestors[^;]*;?/gi, '')
          );
        }
        if (responseHeaders['Content-Security-Policy']) {
          responseHeaders['Content-Security-Policy'] = responseHeaders['Content-Security-Policy'].map(
            csp => csp.replace(/frame-ancestors[^;]*;?/gi, '')
          );
        }
      }
      callback({ responseHeaders });
    });
  });

  // Ad blocker — attach on every session tabs actually use. Previously only
  // defaultSession and the two panel partitions were covered, so ads loaded
  // freely in regular tabs (which live in persist:main).
  wireAdblockerOnSession(session.defaultSession, 'default');
  wireAdblockerOnSession(session.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wireAdblockerOnSession(session.fromPartition(p), p));

  // Set user agent to Chrome to avoid "unsupported browser" blocks
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  session.defaultSession.setUserAgent(chromeUA);
  partitions.forEach(p => session.fromPartition(p).setUserAgent(chromeUA));

  // Downloads — wire on every session tabs might use. Previously only the
  // default session had a listener, so webview downloads (partition=persist:main)
  // silently saved with no IPC to the renderer → panel stayed empty.
  wireDownloadsOnSession(session.defaultSession, 'default');
  wireDownloadsOnSession(session.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wireDownloadsOnSession(session.fromPartition(p), p));

  wirePermissionsOnSession(session.defaultSession, 'default');
  wirePermissionsOnSession(session.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wirePermissionsOnSession(session.fromPartition(p), p));

  // Webview preload (PiP helpers + geolocation IP fallback) — attach to every
  // session so ALL pages get the polyfill. Use setPreloads so we don't clobber
  // any existing preload set elsewhere.
  const webviewPreload = path.join(__dirname, 'preload-webview.js');
  const sessions = [
    session.defaultSession,
    session.fromPartition('persist:main'),
    ...partitions.map(p => session.fromPartition(p))
  ];
  for (const ses of sessions) {
    try {
      const existing = ses.getPreloads ? ses.getPreloads() : [];
      if (!existing.includes(webviewPreload)) {
        ses.setPreloads([...existing, webviewPreload]);
      }
    } catch (err) { console.error('[Preload] attach failed:', err.message); }
  }


  // Fullscreen change events
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('fullscreen-changed', false);
  });

  // Signal renderer to save session before quit
  mainWindow.on('close', () => {
    if (mainWindow) {
      mainWindow.webContents.send('save-session-before-quit');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Auto-updater setup
function setupAutoUpdater() {
  if (!autoUpdater || !mainWindow) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', { version: info.version, releaseNotes: info.releaseNotes });
  });
  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-not-available');
  });
  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('update-download-progress', { percent: Math.round(p.percent), transferred: p.transferred, total: p.total });
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-error', { message: err.message });
  });

  // v2.0.0: do NOT auto-check at startup. The electron-updater startup check
  // spawns a bundled 7za.exe (for .blockmap differential-download inspection)
  // that links against MSVC 2015-2022 runtime, which triggers the VC++
  // Redistributable installer prompt on machines without that runtime.
  // Users can still trigger "Check for Updates" manually from Settings.
}

// v1.9.0 one-time cleanup: remove Phase 17A Memory Recorder artifacts
app.whenReady().then(() => {
  try {
    const userData = app.getPath('userData');
    const memoryDir = path.join(userData, 'memory');
    const keyFile = path.join(userData, 'memory-key.bin');
    const whisperDir = path.join(userData, 'assets', 'whisper');
    if (fs.existsSync(memoryDir)) { fs.rmSync(memoryDir, { recursive: true, force: true }); console.log('[Cleanup] Removed memory recorder data'); }
    if (fs.existsSync(keyFile))  { fs.unlinkSync(keyFile); console.log('[Cleanup] Removed memory encryption key'); }
    if (fs.existsSync(whisperDir)) { fs.rmSync(whisperDir, { recursive: true, force: true }); console.log('[Cleanup] Removed whisper assets'); }
  } catch (err) { console.warn('[Cleanup] Memory data cleanup failed:', err.message); }
});

// Custom protocol handler for vex://
app.whenReady().then(() => {
  // F12: toggle DevTools for the focused window (bottom panel)
  globalShortcut.register('F12', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (!w) return;
    if (w.webContents.isDevToolsOpened()) w.webContents.closeDevTools();
    else w.webContents.openDevTools({ mode: 'bottom' });
  });
  // Ctrl+Shift+F12: detached DevTools (backup when F12 is stolen by a webview)
  globalShortcut.register('CommandOrControl+Shift+F12', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (!w) return;
    w.webContents.openDevTools({ mode: 'detach' });
  });

  protocol.handle('vex', (request) => {
    const reqUrl = request.url;

    // vex://start → serve start.html via net.fetch(file://)
    if (reqUrl === 'vex://start' || reqUrl === 'vex://start/') {
      const filePath = path.join(__dirname, 'renderer', 'start.html');
      return net.fetch(pathToFileURL(filePath).toString());
    }

    // vex://start/css/foo.css → serve renderer/css/foo.css
    if (reqUrl.startsWith('vex://start/')) {
      const assetPath = reqUrl.replace('vex://start/', '');
      const fullPath = path.join(__dirname, 'renderer', assetPath);
      if (fs.existsSync(fullPath)) {
        return net.fetch(pathToFileURL(fullPath).toString());
      }
    }

    return new Response('Not Found', { status: 404 });
  });

  createWindow();
  setupAutoUpdater();

  // === Handle URL launched from external app (Discord, email, etc.) ===
  const launchUrl = pendingOpenUrl || process.argv.find(a => a.startsWith('http://') || a.startsWith('https://'));
  if (launchUrl && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('open-url', launchUrl);
    });
    pendingOpenUrl = null;
  }

  // Register global shortcuts
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key === 'k') {
      mainWindow.webContents.send('toggle-command-bar');
      event.preventDefault();
    }
    if (input.control && input.key === 'f') {
      mainWindow.webContents.send('find-in-page');
      event.preventDefault();
    }
    if (input.control && input.key === 't') {
      mainWindow.webContents.send('new-tab');
      event.preventDefault();
    }
    if (input.control && input.key === 'w') {
      mainWindow.webContents.send('close-tab');
      event.preventDefault();
    }
    if (input.control && input.key === 'r') {
      mainWindow.webContents.send('reload-tab');
      event.preventDefault();
    }
    if (input.control && (input.key === '=' || input.key === '+')) {
      mainWindow.webContents.send('zoom-in');
      event.preventDefault();
    }
    if (input.control && input.key === '-') {
      mainWindow.webContents.send('zoom-out');
      event.preventDefault();
    }
    if (input.control && input.key === '0') {
      mainWindow.webContents.send('zoom-reset');
      event.preventDefault();
    }
    if (input.alt && input.key === 'ArrowLeft') {
      mainWindow.webContents.send('navigate-back');
      event.preventDefault();
    }
    if (input.alt && input.key === 'ArrowRight') {
      mainWindow.webContents.send('navigate-forward');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'S') {
      mainWindow.webContents.send('toggle-split');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'P') {
      mainWindow.webContents.send('toggle-pip');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'N') {
      mainWindow.webContents.send('toggle-notes');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'O') {
      mainWindow.webContents.send('toggle-sessions');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'T') {
      mainWindow.webContents.send('reopen-last-closed');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'H') {
      // Ctrl+Shift+H — open history panel with AI search auto-selected
      mainWindow.webContents.send('toggle-history-ai');
      event.preventDefault();
    } else if (input.control && input.key === 'h') {
      mainWindow.webContents.send('toggle-history');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'M') {
      mainWindow.webContents.send('toggle-memory');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'Z') {
      mainWindow.webContents.send('sleep-current-tab');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'R') {
      mainWindow.webContents.send('toggle-reading-mode');
      event.preventDefault();
    }
    if (input.control && input.alt && input.key === 's') {
      mainWindow.webContents.send('take-screenshot');
      event.preventDefault();
    }
    if (handleFullscreenShortcut(event, input)) return;
    if (handleDevToolsShortcut(event, input)) return;
    if (input.control && input.key === 'm') {
      mainWindow.webContents.send('toggle-mute-tab');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'A') {
      mainWindow.webContents.send('toggle-ai-panel');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'L') {
      mainWindow.webContents.send('toggle-schedules');
      event.preventDefault();
    }
    if (input.control && !input.shift && !input.alt && input.key === 'b') {
      mainWindow.webContents.send('toggle-tabs-sidebar');
      event.preventDefault();
    }
  });

  // Disable default menu
  Menu.setApplicationMenu(null);
});

// IPC handlers
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());

ipcMain.handle('get-start-page-path', () => 'vex://start');
ipcMain.handle('get-start-page-url', () => {
  // Return file:// URL as a bulletproof fallback that never triggers OS "open with" dialog
  const filePath = path.join(__dirname, 'renderer', 'start.html');
  return pathToFileURL(filePath).toString();
});

ipcMain.handle('storage-save', (event, key, data) => {
  try {
    fs.writeFileSync(getStorageFile(key), JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Storage save error:', e);
    return false;
  }
});

ipcMain.handle('storage-load', (event, key) => {
  try {
    const file = getStorageFile(key);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    return null;
  } catch (e) {
    console.error('Storage load error:', e);
    return null;
  }
});

ipcMain.handle('open-pip-window', (event, url) => {
  try {
    createPipWindow(url);
    return true;
  } catch (e) {
    console.error('PiP window error:', e);
    return false;
  }
});

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

// Hard reload: clear the webview session's HTTP cache, then reloadIgnoringCache.
// The renderer passes the <webview>'s webContentsId; we resolve it here because
// webContents.session.clearCache() isn't reachable from the renderer side.
ipcMain.handle('webview:hard-reload', async (_e, webContentsId) => {
  try {
    const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'webContents not found' };
    if (wc.session && typeof wc.session.clearCache === 'function') {
      await wc.session.clearCache();
    }
    if (typeof wc.reloadIgnoringCache === 'function') wc.reloadIgnoringCache();
    else wc.reload();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('is-fullscreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

// Downloads IPC — open/show
ipcMain.handle('downloads:open-file', async (_e, filePath) => {
  try { const r = await shell.openPath(filePath); return { ok: !r, error: r || null }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('downloads:show-in-folder', (_e, filePath) => {
  try { shell.showItemInFolder(filePath); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('downloads:open-folder', async () => {
  try { await shell.openPath(app.getPath('downloads')); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('open-private-window', () => {
  const privSession = session.fromPartition(`private:${Date.now()}`);
  wireDownloadsOnSession(privSession, 'private');
  wirePermissionsOnSession(privSession, 'private');
  try {
    const preloadPath = path.join(__dirname, 'preload-webview.js');
    const existing = privSession.getPreloads ? privSession.getPreloads() : [];
    if (!existing.includes(preloadPath)) privSession.setPreloads([...existing, preloadPath]);
  } catch {}
  // Apply header stripping + ad blocker to private session
  privSession.webRequest.onHeadersReceived((details, callback) => {
    const rh = { ...details.responseHeaders };
    delete rh['x-frame-options']; delete rh['X-Frame-Options']; delete rh['X-FRAME-OPTIONS'];
    if (rh['content-security-policy']) rh['content-security-policy'] = rh['content-security-policy'].map(c => c.replace(/frame-ancestors[^;]*;?/gi, ''));
    if (rh['Content-Security-Policy']) rh['Content-Security-Policy'] = rh['Content-Security-Policy'].map(c => c.replace(/frame-ancestors[^;]*;?/gi, ''));
    callback({ responseHeaders: rh });
  });
  privSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: adBlockerEnabled && shouldBlock(details.url) });
  });
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  privSession.setUserAgent(chromeUA);

  const privWin = new BrowserWindow({
    width: 1200, height: 800, frame: false, titleBarStyle: 'hidden',
    backgroundColor: '#1a0a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, contextIsolation: true, nodeIntegration: false
    }
  });
  privWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { private: 'true' } });
  return true;
});

// Update IPC
ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return { ok: false, error: 'Updater not available in dev mode' };
  try { const r = await autoUpdater.checkForUpdates(); return { ok: true, info: r?.updateInfo }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('download-update', async () => {
  if (!autoUpdater) return { ok: false };
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('install-update', () => { autoUpdater?.quitAndInstall(false, true); });
ipcMain.handle('get-app-version', () => app.getVersion());

// Set as default browser — opens Windows Default Apps settings
ipcMain.handle('set-as-default-browser', async () => {
  try {
    if (process.platform === 'win32') {
      shell.openExternal('ms-settings:defaultapps');
    } else {
      shell.openExternal('https://support.apple.com/guide/mac-help/change-your-default-web-browser-mh35856/mac');
    }
    return true;
  } catch (e) {
    console.error('set-as-default-browser error:', e);
    return false;
  }
});

ipcMain.handle('is-default-browser', () => {
  try {
    return app.isDefaultProtocolClient('http');
  } catch { return false; }
});

ipcMain.handle('adblocker-get-state', () => adBlockerEnabled);
ipcMain.handle('adblocker-set-state', (event, enabled) => {
  adBlockerEnabled = enabled;
  return adBlockerEnabled;
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
