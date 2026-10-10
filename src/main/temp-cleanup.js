'use strict';
// Leftover temporary files from Vex's own saves, removed at start.
//
// Every save goes through atomicWrite (./file-store.js): it writes
// "<file>.<random uuid>.tmp" and renames it over the file. A save cut off
// (power loss, a killed process) can leave that temp file behind, and nothing
// ever removed it: the owner's profile had a 0-byte tabs.json.<uuid>.tmp from
// 2026-09-30 (audit S9).
//
// Deliberately narrow: only the folders Vex saves into (given by the caller,
// not searched below), only regular files named exactly like atomicWrite's
// temp files, and only ones older than a day, so a save still in progress in
// another Vex window is never touched.

const fs = require('fs');
const path = require('path');

const MIN_AGE_MS = 24 * 60 * 60 * 1000;
// "<name>.<uuid v4>.tmp", as file-store.js's atomicWrite names them.
const ATOMIC_TEMP = /^.+\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

function isVexTemp(name) { return ATOMIC_TEMP.test(name); }

// Returns { removed: [paths], failed: [{ file, error }] }. A folder that does
// not exist yet is fine; any other error reading a folder is raised.
async function removeStaleTemps(dirs, { now = Date.now(), minAgeMs = MIN_AGE_MS, fsp = fs.promises } = {}) {
  const removed = [];
  const failed = [];
  for (const dir of dirs) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') continue; throw err; }
    for (const entry of entries) {
      if (!entry.isFile() || !isVexTemp(entry.name)) continue;
      const file = path.join(dir, entry.name);
      try {
        const st = await fsp.lstat(file);
        if (!st.isFile() || now - st.mtimeMs < minAgeMs) continue;
        await fsp.unlink(file);
        removed.push(file);
      } catch (err) {
        if (err.code === 'ENOENT') continue;   // gone already
        failed.push({ file, error: err.message });
      }
    }
  }
  return { removed, failed };
}

module.exports = { removeStaleTemps, isVexTemp, MIN_AGE_MS };
