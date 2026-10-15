'use strict';
// === The window your archived copies open in ==============================
//
// A saved page is somebody else's HTML. It is opened in a window of its own
// that can do nothing but show it:
//
//   - JavaScript is off for the whole window (so the page's scripts, which
//     were saved with it, never run);
//   - the window's session answers no request but the copy's own file, so a
//     picture or font the copy did not keep cannot be fetched from the
//     network, and nothing says "this person opened it";
//   - no preload, no Node, sandboxed, no permissions, no new windows, and no
//     navigation away from the copy.

const { pathToFileURL } = require('url');

const VIEWER_PARTITION = 'vex-archive-view';

function viewerPreferences() {
  return {
    javascript: false,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    webviewTag: false,
    plugins: false,
    spellcheck: false,
    navigateOnDragDrop: false,
    disableDialogs: true,
    allowRunningInsecureContent: false,
  };
}

// The only addresses the viewer's session lets through: the copy itself (a
// file: address) and inline data: values. Everything else is cancelled.
function isAllowedRequest(requestUrl, copyUrl) {
  const u = String(requestUrl || '');
  if (u === copyUrl) return true;
  if (/^data:/i.test(u)) return true;
  // The same file, spelled another way (case or %-escapes of the drive path).
  try {
    const a = new URL(u), b = new URL(copyUrl);
    return a.protocol === 'file:' && b.protocol === 'file:' && decodeURIComponent(a.pathname).toLowerCase() === decodeURIComponent(b.pathname).toLowerCase();
  } catch { return false; }
}

const open = new Set();
const guarded = new WeakSet();
const blockedAll = [];

// openCopy({ BrowserWindow, session, file, title, url, at }) -> the window.
// `session` is the viewer partition's session (made by the caller).
function openCopy({ BrowserWindow, session, file, title, url, at, parent }) {
  const copyUrl = pathToFileURL(file).href;
  open.add(copyUrl);
  if (!guarded.has(session)) {
    guarded.add(session);
    session.webRequest.onBeforeRequest((details, callback) => {
      if ([...open].some(u => isAllowedRequest(details.url, u))) return callback({});
      blockedAll.push(details.url); if (blockedAll.length > 200) blockedAll.shift();
      callback({ cancel: true });
    });
    session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
  }
  const when = at ? new Date(at).toLocaleString() : '';
  const win = new BrowserWindow({
    width: 1000, height: 760, minWidth: 420, minHeight: 320,
    title: 'Your copy: ' + String(title || url || '').slice(0, 120) + (when ? ' (saved ' + when + ')' : ''),
    autoHideMenuBar: true,
    show: true,
    parent: parent || undefined,
    webPreferences: { ...viewerPreferences(), session },
  });
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const keepHere = (event, to) => { if (!isAllowedRequest(to, copyUrl)) event.preventDefault(); };
  wc.on('will-navigate', keepHere);
  wc.on('will-redirect', keepHere);
  // The page's own title would replace the one that says it is a saved copy.
  wc.on('page-title-updated', (event) => event.preventDefault());
  win.loadURL(copyUrl);
  win.once('closed', () => open.delete(copyUrl));
  win.vexArchiveBlocked = blockedAll;
  return win;
}

module.exports = { openCopy, viewerPreferences, isAllowedRequest, VIEWER_PARTITION };
