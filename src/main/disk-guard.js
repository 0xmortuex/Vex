'use strict';
// === Free space on the drive Vex keeps your data on ============================
//
// Nothing in the main process looked at free space: a full disk showed up as a failed save at close time, and Vex
// could not be closed cleanly any more (see main/flush-rescue.js for that half). This is the other half:
//   - warnIfLow(): below ~2 GB free, one note in the Attention Inbox (main/attention-notes.js), at most once a day.
//     It runs at start and when a save fails; there is no timer, so it costs nothing in the background.
//   - check({ need }) / require({ need, what }): before a LARGE write (the update installer, a pre-update backup, a
//     voice model, a recording) - refused when the write would leave less than the floor (512 MB) free. A refusal
//     is an error with code EDISKLOW and a plain message; nothing is written.
// If the free space cannot be read at all (statfs fails), the write is NOT blocked: a safety net that can only say
// "no" on a guess would stop updates on a drive that is fine. The failure is logged out loud and reported in the
// result (`unknown: true`), never swallowed.
//
// statfs is injectable, so the tests never touch a real disk.
const fs = require('fs');

const MB = 1024 * 1024;
const GB = 1024 * MB;
const WARN_BELOW = 2 * GB;
const FLOOR = 512 * MB;
const WARN_EVERY_MS = 24 * 60 * 60 * 1000;

// Plain English; the window and the native dialogs translate it (js/i18n-ui.js, main/i18n-main.js).
const REFUSAL = 'There is not enough free space on the drive Vex keeps your data on. Free some space and try again.';

class DiskLowError extends Error {
  constructor(what, free, need) {
    super(REFUSAL);
    this.name = 'DiskLowError';
    this.code = 'EDISKLOW';
    this.what = what; this.free = free; this.need = need;
  }
}

function createDiskGuard({ dir, statfs = (d) => fs.promises.statfs(d), notes = null, log = console, now = () => Date.now(), warnBelow = WARN_BELOW, floor = FLOOR }) {
  if (!dir) throw new Error('createDiskGuard needs the folder whose drive it watches');
  let lastWarn = null;

  // Bytes free for this user on the drive of `dir`.
  async function freeBytes() {
    const s = await statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    if (!Number.isFinite(free) || free < 0) throw new Error('The drive reported a free size that makes no sense');
    return free;
  }

  // { ok, free, need } or { ok: true, unknown: true, error } when the size cannot be read.
  async function check({ need = 0, what = 'a write' } = {}) {
    let free;
    try { free = await freeBytes(); }
    catch (error) {
      log.error('[DiskGuard] could not read the free space before ' + what + ' (it goes ahead):', error.message);
      return { ok: true, unknown: true, error };
    }
    return { ok: free - Math.max(0, need) >= floor, free, need };
  }

  async function require_({ need = 0, what = 'a write' } = {}) {
    const r = await check({ need, what });
    if (!r.ok) {
      log.error(`[DiskGuard] refused ${what}: ${Math.round(r.free / MB)} MB free, ${Math.round(r.need / MB)} MB needed, ${Math.round(floor / MB)} MB must stay free`);
      throw new DiskLowError(what, r.free, r.need);
    }
    return r;
  }

  // Posts the "nearly full" note when under the warning level, at most once a day. Returns the free bytes, or null.
  async function warnIfLow() {
    const r = await check({ what: 'the free-space look' });
    if (r.unknown) return null;
    if (r.free < warnBelow && notes && (lastWarn === null || now() - lastWarn >= WARN_EVERY_MS)) {
      lastWarn = now();
      notes.post({
        feature: 'disk-space', id: 'low', label: 'Disk space',
        title: 'Your disk is nearly full',
        body: 'Less than 2 GB is free on the drive Vex keeps your data on. Free some space soon, or saving can fail.',
      });
    }
    return r.free;
  }

  return { freeBytes, check, require: require_, warnIfLow };
}

module.exports = { createDiskGuard, DiskLowError, REFUSAL, WARN_BELOW, FLOOR };
