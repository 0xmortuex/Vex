const { app, BrowserWindow, session, ipcMain, protocol, globalShortcut, Menu, net, shell, dialog } = require('electron');
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

  // Ad blocker
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (adBlockerEnabled && shouldBlock(details.url)) {
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });

  // Also strip headers for named partitions (sidebar panels)
  const partitions = ['persist:whatsapp', 'persist:claude'];
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

    ses.webRequest.onBeforeRequest((details, callback) => {
      if (adBlockerEnabled && shouldBlock(details.url)) {
        callback({ cancel: true });
      } else {
        callback({ cancel: false });
      }
    });
  });

  // Set user agent to Chrome to avoid "unsupported browser" blocks
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  session.defaultSession.setUserAgent(chromeUA);
  partitions.forEach(p => session.fromPartition(p).setUserAgent(chromeUA));

  // Downloads with full tracking
  session.defaultSession.on('will-download', (event, item) => {
    const savePath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);

    const downloadInfo = {
      id: Date.now().toString(),
      fileName: item.getFilename(),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      path: savePath,
      startedAt: new Date().toISOString()
    };
    mainWindow.webContents.send('download-started', downloadInfo);

    item.on('updated', (e, state) => {
      mainWindow.webContents.send('download-progress', {
        id: downloadInfo.id,
        receivedBytes: item.getReceivedBytes(),
        state: state
      });
    });

    item.once('done', (e, state) => {
      mainWindow.webContents.send('download-complete', {
        id: downloadInfo.id,
        fileName: downloadInfo.fileName,
        state: state,
        path: savePath
      });
    });
  });


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
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
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

ipcMain.handle('is-fullscreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('open-private-window', () => {
  const privSession = session.fromPartition(`private:${Date.now()}`);
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
