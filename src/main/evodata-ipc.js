'use strict';
// === Datasets kept from page tables: the window's side (IPC) ===
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
const { createDatasetStore } = require('./evodata-datasets-store');

function registerDatasets({ ipcMain, dialog, windowOf, baseDir, downloadsDir, fsImpl = fs, now = Date.now, log = console }) {
  let store = null;
  // baseDir may be a function so the profile folder is asked for when the first request comes, not at start-up.
  const datasets = () => (store || (store = createDatasetStore({ dir: path.join(typeof baseDir === 'function' ? baseDir() : baseDir, 'kept-pages', 'datasets'), fsImpl, now, log })));
  const guard = guarded(log);

  // ---- datasets ----
  ipcMain.handle('recall:dataset-list', guard(() => { const s = datasets(); return { items: s.list(), bytes: s.totalBytes(), limits: s.LIMITS }; }));
  ipcMain.handle('recall:dataset-get', guard((_e, id) => ({ dataset: datasets().get(id) })));
  ipcMain.handle('recall:dataset-create', guard((_e, args) => {
    const r = datasets().create(args);
    return { id: r.dataset.id, rows: r.dataset.rows.length, columns: r.dataset.columns.length, duplicates: r.duplicates, capped: r.capped };
  }));
  ipcMain.handle('recall:dataset-append', guard((_e, id, rows, keyColumn) => {
    const r = datasets().append(id, rows, keyColumn == null ? {} : { keyColumn });
    return { added: r.added, skipped: r.skipped, capped: r.capped, rows: r.dataset.rows.length };
  }));
  ipcMain.handle('recall:dataset-append-watch', guard((_e, watchId, row) => ({ datasets: datasets().appendForWatch(watchId, row) })));
  ipcMain.handle('recall:dataset-set-watch', guard((_e, id, watchId) => ({ meta: datasets().setWatch(id, watchId) })));
  ipcMain.handle('recall:dataset-delete', guard((_e, id) => ({ removed: datasets().remove(id) })));
  ipcMain.handle('recall:dataset-clear', guard(() => ({ removed: datasets().clearAll() })));
  // The file is written here, not in the window: a dataset can be 5 MB and the text never has to cross the bridge twice.
  ipcMain.handle('recall:dataset-export', guard(async (e, id, format) => {
    const out = datasets().exportAs(id, format);
    const win = windowOf(e);
    const options = {
      title: 'Save the dataset', defaultPath: path.join(downloadsDir(), out.name),
      filters: [out.ext === 'json' ? { name: 'JSON', extensions: ['json'] } : { name: 'CSV', extensions: ['csv'] }],
    };
    const picked = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    if (picked.canceled || !picked.filePath) return { cancelled: true };
    await fsImpl.promises.writeFile(picked.filePath, out.text, 'utf8');
    return { path: picked.filePath };
  }));

  return { datasets };
}

module.exports = { registerDatasets };

