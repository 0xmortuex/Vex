const { app, BrowserWindow, session, ipcMain, protocol, globalShortcut, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { shouldBlock } = require('./adblocker');
const { createPipWindow, closePipWindow } = require('./pip');

let mainWindow = null;
let adBlockerEnabled = true;

// Storage helpers
const userDataPath = app.getPath('userData');
const storagePath = path.join(userDataPath, 'vex-storage');

if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
}

function getStorageFile(key) {
  return path.join(storagePath, `${key}.json`);
}

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
  const partitions = ['persist:discord', 'persist:whatsapp', 'persist:claude'];
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

  // Downloads
  session.defaultSession.on('will-download', (event, item) => {
    const fileName = item.getFilename();
    const totalBytes = item.getTotalBytes();

    mainWindow.webContents.send('download-started', { fileName, totalBytes });

    item.on('done', (e, state) => {
      mainWindow.webContents.send('download-complete', { fileName, state });
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Custom protocol handler for vex://
app.whenReady().then(() => {
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
