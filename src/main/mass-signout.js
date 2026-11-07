// === "Many of your logins look gone" ==========================================
//
// signed-in.js and signout-why.js explain ONE lost sign-in. When a profile is
// reset, a Windows account is changed or something wipes the cookie jar, dozens
// vanish at once and each looks like its own small mystery. This compares the
// number of sites you are signed in to with the number the last run saw, and
// when it falls by more than half (from at least 6) puts one item in the
// Attention Inbox pointing at the newest backup that checks out.
//
// What is stored: ONE number and ONE time (userData/signin-baseline.json:
// { count, at }). Never a list of sites; the only site data this reads is the
// cookie metadata signed-in.js already reads, in memory, to count.
//
// It cannot fire when:
//   - there is no baseline yet (a fresh profile, a first run of this feature);
//   - the baseline is under 6 (too few for a drop to mean anything);
//   - the owner just cleared data on purpose: every deliberate clearing path
//     calls deliberate(), which forgets the baseline, so the next count is
//     simply the new normal;
//   - the baseline was reset by a failed read (an unreadable file is an error
//     that is reported, not a fresh start that hides a drop).
//
// Only persistent sign-ins are counted (a cookie with an expiry date): the ones
// that end with the browser (session cookies) are gone at every start by design
// and would read as a drop every time.
'use strict';

const nodeFs = require('fs');
const nodePath = require('path');

const MIN_BASELINE = 6;
const DROP = 0.5;

function createMassSignout({ file, fs = nodeFs, now = () => Date.now(), countSignIns, newestBackup = () => null, onDrop, log = () => {} }) {
  if (typeof countSignIns !== 'function') throw new Error('createMassSignout needs a way to count sign-ins');
  if (typeof onDrop !== 'function') throw new Error('createMassSignout needs somewhere to report a drop');

  // -> { count: number|null, at: number } | null (no file). A file that exists but cannot be read throws.
  function read() {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The sign-in baseline cannot be read', { cause: err }); }
    if (!v || typeof v !== 'object' || (v.count !== null && !Number.isInteger(v.count)) || v.count < 0 || !Number.isFinite(v.at)) throw new Error('The sign-in baseline is not in the form Vex wrote');
    return { count: v.count, at: v.at };
  }
  // Whole or not at all, and synchronous: it can run as Vex quits.
  function write(count) {
    const tmp = file + '.' + process.pid + '.tmp';
    try {
      fs.mkdirSync(nodePath.dirname(file), { recursive: true });
      // vex-allow-plain-write: written to a temp name and renamed into place on the next line, so the real file is whole or untouched
      fs.writeFileSync(tmp, JSON.stringify({ count, at: now() }), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch (rmErr) { log('[SignIns] could not delete ' + tmp + ': ' + rmErr.code); }
      throw err;
    }
  }

  // After a deliberate clear the jar is still emptying for a moment; the in-session refresh waits so it cannot
  // record a half-cleared number as the baseline.
  let quietUntil = 0;
  const dropped = (before, current) => before >= MIN_BASELINE && (before - current) / before > DROP;

  // At start. -> { fired, why, before?, now? }
  async function check() {
    const n = await countSignIns();
    if (!Number.isInteger(n) || n < 0) throw new Error('The count of sign-ins was not a number');
    const base = read();
    if (!base || base.count === null) { write(n); return { fired: false, why: base ? 'reset' : 'fresh', now: n }; }
    if (dropped(base.count, n)) {
      write(n);
      onDrop({ before: base.count, now: n, since: base.at, backup: newestBackup() });
      log('[SignIns] sign-ins fell from ' + base.count + ' to ' + n);
      return { fired: true, before: base.count, now: n };
    }
    write(n);
    return { fired: false, why: 'steady', before: base.count, now: n };
  }

  // While Vex runs: keep the baseline current, but never let a collapse become the new normal in silence.
  // (A collapse during a session waits for the next start's check to be reported.)
  async function refresh() {
    if (now() < quietUntil) return { kept: true, why: 'recent clear' };
    const n = await countSignIns();
    const base = read();
    if (base && base.count !== null && dropped(base.count, n)) return { kept: true };
    write(n);
    return { kept: false };
  }

  // The owner cleared data on purpose (Clear browsing data, the privacy clean-up, a forget-this-site sweep ...).
  function deliberate(why) {
    quietUntil = now() + 10 * 60 * 1000;
    write(null);
    log('[SignIns] baseline forgotten after: ' + why);
  }

  return { check, refresh, deliberate, read };
}

module.exports = { createMassSignout, MIN_BASELINE, DROP };
