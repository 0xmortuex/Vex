'use strict';
// === Text versions of kept pages: the window's side (IPC) ===
//
// Vex's own window only (main/ipc-policy.js UI_ONLY_CHANNELS), and closed in a private window (every channel starts with
// `recall:`, which PRIVATE_DISABLED covers). A web page, a popup or an extension can not call them.
//
// Every handler answers { ok: true, ... } or { ok: false, error } with the plain words of what stopped it (a cap, a
// sensitive page, a file that could not be written); the window shows that sentence and the error is also written to
// the console. What each channel checks is checked again here, never taken from the window. The window decides whether
// the feature is switched on (its switch is a window preference); this file is the storage and the caps.
const fs = require('fs');
const path = require('path');
const { guarded } = require('./evodata-entity-store');
const { createVersionStore } = require('./evodata-versions-store');

function registerVersions({ ipcMain, baseDir, fsImpl = fs, now = Date.now, log = console }) {
  let store = null;
  const versions = () => (store || (store = createVersionStore({ dir: path.join(typeof baseDir === 'function' ? baseDir() : baseDir, 'kept-pages', 'versions'), fsImpl, now, log })));
  const guard = guarded(log);

  // ---- page text versions ----
  ipcMain.handle('recall:versions-list', guard(() => { const s = versions(); return { items: s.list(), bytes: s.totalBytes(), limits: s.LIMITS }; }));
  ipcMain.handle('recall:versions-keep', guard((_e, url, title) => ({ meta: versions().keep(url, title) })));
  ipcMain.handle('recall:versions-kept', guard((_e, url) => ({ kept: versions().isKept(url) })));
  ipcMain.handle('recall:versions-save', guard((_e, url, title, text) => versions().save(url, title, text)));
  ipcMain.handle('recall:versions-save-kept', guard((_e, url, title, text) => { const r = versions().saveIfKept(url, title, text); return r ? { ...r, kept: true } : { kept: false }; }));
  ipcMain.handle('recall:versions-of', guard((_e, id) => ({ versions: versions().versions(id) })));
  ipcMain.handle('recall:versions-text', guard((_e, id, at) => ({ text: versions().text(id, at) })));
  ipcMain.handle('recall:versions-diff', guard((_e, id, a, b) => ({ diff: versions().diff(id, a, b) })));
  ipcMain.handle('recall:versions-forget', guard((_e, id) => ({ removed: versions().forget(id) })));
  ipcMain.handle('recall:versions-clear', guard(() => ({ removed: versions().clearAll() })));

  return { versions };
}

module.exports = { registerVersions };

