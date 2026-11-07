'use strict';
// === Extra things remembered in Recall: the window's side (IPC) ===
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
const { createExtrasStore } = require('./evodata-extras-store');

function registerExtras({ ipcMain, baseDir, fsImpl = fs, now = Date.now, log = console }) {
  let store = null;
  const extras = () => (store || (store = createExtrasStore({ file: path.join(typeof baseDir === 'function' ? baseDir() : baseDir, 'kept-pages', 'recall-extras.json'), fsImpl, now, log })));
  const guard = guarded(log);

  // ---- things remembered in Recall ----
  ipcMain.handle('recall:extra-add', guard((_e, input) => extras().add(input)));
  ipcMain.handle('recall:extra-list', guard(() => { const s = extras(); return { items: s.list(), bytes: s.bytes(), limits: s.LIMITS }; }));
  ipcMain.handle('recall:extra-remove', guard((_e, id) => ({ removed: extras().remove(id) })));
  ipcMain.handle('recall:extra-clear', guard(() => ({ removed: extras().clearAll() })));

  return { extras };
}

module.exports = { registerExtras };

