'use strict';
// === Pages as data the person keeps: one folder of JSON files and a small index ===
//
// The three opt-in features that keep data on disk (datasets from page tables, text versions of a page, extra things
// remembered in Recall) keep it under ONE folder of the profile, <userData>/kept-pages/, and nowhere else:
//
//   kept-pages/datasets/<id>.json       one dataset per file, plus index.json (a small list of them)
//   kept-pages/versions/<id>.json       one kept page per file (its text versions), plus index.json
//   kept-pages/recall-extras.json       the remembered clips, file names, reminders and notes (small, one file)
//
// Why not recall.json: that file is one bare array of about 4 MB, rewritten whole at most once a minute. Anything
// added to it would make every write bigger. These files are separate, each is written whole through the safe
// writer (file-store.js: temp file, fsync, rename, so a crash leaves the old file), and a write only touches the one
// dataset, page or list that changed. No backup copy is made (a dataset can be 5 MB; the rename already protects the
// original), and a file that cannot be read is kept aside by readJsonRecoverSync, never rewritten.
//
// "Delete everything this feature keeps" is clearAll() on each store: it removes every file in the store's own
// folder (and the folder when it is empty) and nothing outside it.
//
// Everything that touches the disk takes an injectable `fsImpl` so a failing disk can be simulated.
// No network, no window, no Electron in these files.
const fs = require('fs');
const path = require('path');
const { atomicWriteSync, readJsonRecoverSync } = require('./file-store');
const { VexPageSensitivity } = require('../renderer/js/page-sensitivity');

const ID_OK = /^[a-z][a-z0-9]{1,40}$/;
const randomId = () => Math.random().toString(36).slice(2, 8);

// Wrap one IPC handler body: { ok: true, ...result }, or a thrown error becomes { ok: false, error } and is written to
// the log. The window shows the sentence; nothing is swallowed.
function guarded(log) {
  return (fn) => async (e, ...args) => {
    try { return { ok: true, ...(await fn(e, ...args)) }; }
    catch (err) {
      log.error('[KeptPages] a request was refused or failed:', err && err.message);
      return { ok: false, error: (err && err.message) || 'Something went wrong' };
    }
  };
}

// A page the person's own data must stay away from: banking, payment, sign-in, mail, health. Same list as the
// element zapper and the archive. Throws the plain-words reason.
function refuseSensitive(url) {
  const why = VexPageSensitivity.reason(url);
  if (why) throw new Error(why);
}

// ---- one folder of JSON files and a small index -----------------------------------------------------
function createEntityStore({ dir, metaOf, fsImpl = fs, log = console }) {
  if (!dir) throw new Error('createEntityStore: no folder');
  const indexFile = path.join(dir, 'index.json');
  let index = null;     // id -> meta, loaded on first use

  const fileOf = (id) => {
    if (!ID_OK.test(String(id))) throw new Error('That id is not valid');
    return path.join(dir, id + '.json');
  };
  function saveIndex() {
    atomicWriteSync(indexFile, JSON.stringify({ v: 1, items: index }), { backup: false, fsImpl });
  }

  // The index is a convenience: when it is missing, damaged or out of step with the folder (a crash between a file
  // and its index line), it is rebuilt from the files.
  function load() {
    if (index) return index;
    index = {};
    const r = readJsonRecoverSync(indexFile, { fsImpl });
    if (r.source === 'lost') log.error('[KeptPages] the index in ' + dir + ' could not be read and is rebuilt from the files (the old one was kept aside):', r.error && r.error.message);
    if (r.data && typeof r.data === 'object' && r.data.items && typeof r.data.items === 'object') {
      for (const [id, meta] of Object.entries(r.data.items)) if (ID_OK.test(id) && meta && typeof meta === 'object') index[id] = meta;
    }
    let names = [];
    try { names = fsImpl.readdirSync(dir); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    const onDisk = new Set(names.filter(n => /^[a-z][a-z0-9]{1,40}\.json$/.test(n) && n !== 'index.json').map(n => n.slice(0, -5)));
    let changed = false;
    for (const id of Object.keys(index)) if (!onDisk.has(id)) { delete index[id]; changed = true; }
    for (const id of onDisk) {
      if (index[id]) continue;
      const e = readJsonRecoverSync(fileOf(id), { fsImpl });
      if (e.source === 'lost') { log.error('[KeptPages] ' + id + '.json could not be read and was kept aside:', e.error && e.error.message); continue; }
      if (e.data && typeof e.data === 'object') { index[id] = metaOf(e.data); changed = true; }
    }
    if (changed) saveIndex();
    return index;
  }

  return {
    dir,
    list() { return Object.values(load()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); },
    count() { return Object.keys(load()).length; },
    has(id) { return !!load()[id]; },
    meta(id) { return load()[id] || null; },
    totalBytes() { return Object.values(load()).reduce((s, m) => s + (m.bytes || 0), 0); },
    read(id) {
      load();
      if (!index[id]) return null;
      const r = readJsonRecoverSync(fileOf(id), { fsImpl });
      if (r.source === 'lost') throw new Error('That file could not be read; a copy of it was kept aside in ' + dir);
      return r.data;
    },
    write(id, entity) {
      load();
      atomicWriteSync(fileOf(id), JSON.stringify(entity), { backup: false, fsImpl });
      index[id] = metaOf(entity);
      saveIndex();
    },
    remove(id) {
      load();
      if (!index[id]) return false;
      const file = fileOf(id);
      fsImpl.rmSync(file, { force: true });
      fsImpl.rmSync(file + '.bak', { force: true });
      delete index[id];
      saveIndex();
      return true;
    },
    // Every file in this store's folder, then the folder itself when nothing else is in it.
    clearAll() {
      let names = [];
      try { names = fsImpl.readdirSync(dir); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      for (const n of names) fsImpl.rmSync(path.join(dir, n), { force: true });
      index = {};
      try { fsImpl.rmdirSync(dir); } catch (err) { if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTEMPTY')) throw err; }
      return names.length;
    },
  };
}

module.exports = { createEntityStore, refuseSensitive, guarded, ID_OK, randomId, VexPageSensitivity };
