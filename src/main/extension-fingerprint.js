'use strict';
// === "Did an extension's code change without Vex installing or updating it?" ====
//
// An installed extension is a folder of files Vex loads at every start. Vex writes those files in exactly two places: an install
// and an update. This keeps a fingerprint (SHA-256 over every file's path, size and content hash) taken when Vex finished an install
// or update, and at a later launch looks again. If the files differ and Vex did not do it, the owner is told once, with a button
// to turn that extension off. Nothing is repaired, switched off or deleted here.
//
// HONEST LIMITS
//   * A program running as you can change the record too, or keep a file's size and date and change its content. This catches
//     accidents (a half-finished copy, a sync tool, a hand edit) and clumsy tampering, not a careful same-user attacker.
//   * Extensions that were installed before this existed are recorded as they are at the first look; what changed before that is unknown.
//   * After a Vex update the first look re-records silently (Vex itself may rewrite an extension's manifest or its storage shim).
//   * An extension with more than maxFiles files or maxBytes of data is not fingerprinted; it is listed as "skipped" and said so.
//
// COST. A normal launch hashes nothing: an extension whose files all have the size and modified time that were recorded is not read.
// Only an extension whose sizes or dates moved is hashed, file by file with a pause between files (the caller starts this well
// after start-up). Every failure is reported to `log` and stops only that extension.
const crypto = require('crypto');
const nodePath = require('path');
const { atomicWriteSync, readJsonRecoverSync } = require('./file-store');

const DEFAULT_MAX_FILES = 4000;
const DEFAULT_MAX_BYTES = 80 * 1024 * 1024;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function createExtensionFingerprints({
  fs = require('fs'), extensionsDir, file, appVersion, now = () => Date.now(), log = console,
  maxFiles = DEFAULT_MAX_FILES, maxBytes = DEFAULT_MAX_BYTES, ignore = [], yieldNow = () => new Promise(r => setImmediate(r)),
}) {
  if (!extensionsDir || !file || !appVersion) throw new Error('The extension fingerprints need the extensions folder, a record file and the Vex version');
  const skipTop = new Set(ignore);       // file names directly in an extension's folder that Vex itself rewrites (its storage shim)
  let store = null;                      // { v:1, items:{ folder:{...} } }, loaded on first use
  let chain = Promise.resolve();         // one scan or record at a time

  function load() {
    if (store) return store;
    store = { v: 1, items: {} };
    const r = readJsonRecoverSync(file, { fsImpl: fs });
    if (r.source === 'lost') log.error('[ExtFingerprint] the record could not be read and was kept aside (' + r.corruptCopy + '); extensions are recorded again:', r.error && r.error.message);
    if (r.data && r.data.v === 1 && r.data.items && typeof r.data.items === 'object' && !Array.isArray(r.data.items)) store = { v: 1, items: { ...r.data.items } };
    return store;
  }
  function save() { atomicWriteSync(file, JSON.stringify(load()), { fsImpl: fs }); }

  // The files of one extension, sorted, without following links: { files:[{rel,size,mtimeMs,link}], over?:'files'|'bytes' }.
  function list(folder) {
    const root = nodePath.join(extensionsDir, folder);
    const files = [];
    let bytes = 0;
    const stack = [''];
    while (stack.length) {
      const dir = stack.pop();
      const names = fs.readdirSync(nodePath.join(root, dir)).sort();
      for (const name of names) {
        if (!dir && skipTop.has(name)) continue;
        const rel = dir ? dir + '/' + name : name;
        const st = fs.lstatSync(nodePath.join(root, rel));
        if (st.isSymbolicLink()) { files.push({ rel, link: true, size: 0, mtimeMs: 0 }); }
        else if (st.isDirectory()) stack.push(rel);
        else if (st.isFile()) {
          files.push({ rel, size: st.size, mtimeMs: st.mtimeMs });
          bytes += st.size;
        }
        if (files.length > maxFiles) return { files, bytes, over: 'files' };
        if (bytes > maxBytes) return { files, bytes, over: 'bytes' };
      }
    }
    files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    return { files, bytes };
  }
  const statSigOf = (files) => sha(files.map(f => f.rel + '\0' + f.size + '\0' + f.mtimeMs + (f.link ? '\0L' : '')).join('\n'));

  function hashFile(folder, rel) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const s = fs.createReadStream(nodePath.join(extensionsDir, folder, rel), { highWaterMark: 1024 * 1024 });
      s.on('data', c => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
    });
  }
  async function contentSha(folder, files) {
    const lines = [];
    for (const f of files) {
      await yieldNow();
      lines.push(f.rel + '\0' + f.size + '\0' + (f.link ? 'link' : await hashFile(folder, f.rel)));
    }
    return sha(lines.join('\n'));
  }

  // Take the fingerprint of one folder now. -> the record to keep.
  async function take(folder) {
    const scan = list(folder);
    if (scan.over) return { skipped: scan.over, at: now(), vex: appVersion };
    const statSig = statSigOf(scan.files);
    return { sha256: await contentSha(folder, scan.files), statSig, files: scan.files.length, bytes: scan.bytes, at: now(), vex: appVersion };
  }

  // Vex has just installed or updated this extension: its files as they are now are the approved ones.
  function record(folder) {
    const run = async () => {
      const rec = await take(folder);
      load().items[folder] = rec;
      save();
      return rec;
    };
    chain = chain.then(run, run);
    return chain;
  }
  // The files are not in their final form yet (a copy that is switched off, or loads after a restart): the next look records them.
  function forget(folder) {
    const items = load().items;
    if (!(folder in items)) return false;
    delete items[folder];
    save();
    return true;
  }

  // Look at every folder in `folders`. -> { changed:[{folder,files,bytes}], skipped:[{folder,reason,fresh}], recorded:n, unreadable:[{folder,error}] }
  //   fresh: this is the first time the extension is reported as too big (the caller says it once).
  function check(folders) {
    const run = async () => {
      const items = load().items;
      const out = { changed: [], skipped: [], recorded: 0, unreadable: [] };
      let dirty = false;
      const names = new Set(folders);
      for (const gone of Object.keys(items)) if (!names.has(gone)) { delete items[gone]; dirty = true; }
      for (const folder of folders) {
        try {
          const rec = items[folder];
          const scan = list(folder);
          if (scan.over) {
            out.skipped.push({ folder, reason: scan.over, fresh: !(rec && rec.skipped) });
            if (!(rec && rec.skipped === scan.over)) { items[folder] = { skipped: scan.over, at: now(), vex: appVersion }; dirty = true; }
            continue;
          }
          const statSig = statSigOf(scan.files);
          if (!rec || rec.skipped) {
            items[folder] = { sha256: await contentSha(folder, scan.files), statSig, files: scan.files.length, bytes: scan.bytes, at: now(), vex: appVersion };
            out.recorded++; dirty = true;
            continue;
          }
          if (rec.statSig === statSig && rec.vex === appVersion) continue;      // nothing moved: nothing is read
          const sum = await contentSha(folder, scan.files);
          if (sum === rec.sha256) { items[folder] = { ...rec, statSig, vex: appVersion }; dirty = true; continue; }   // only dates moved
          if (rec.vex !== appVersion) { items[folder] = { sha256: sum, statSig, files: scan.files.length, bytes: scan.bytes, at: now(), vex: appVersion }; out.recorded++; dirty = true; continue; }
          if (rec.reported === sum) { items[folder] = { ...rec, statSig }; dirty = true; continue; }                   // told already
          out.changed.push({ folder, files: scan.files.length, bytes: scan.bytes });
          items[folder] = { ...rec, statSig, reported: sum };
          dirty = true;
        } catch (err) {
          log.error('[ExtFingerprint] could not look at ' + folder + ':', err.message);
          out.unreadable.push({ folder, error: err.message });
        }
      }
      if (dirty) save();
      return out;
    };
    chain = chain.then(run, run);
    return chain;
  }

  return { record, forget, check, list };
}

module.exports = { createExtensionFingerprints, DEFAULT_MAX_FILES, DEFAULT_MAX_BYTES };
