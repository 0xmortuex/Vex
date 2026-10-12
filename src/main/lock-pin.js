// === Unlocking Vex is main's decision ======================================
//
// Main used to take the window's word for it: 'vex-lock:state' false and the
// vault, the authenticator and the windows hidden by the lock were open again.
// Anyone at the keyboard could open DevTools on the lock screen and type
// VexLock.unlock() (audit B1, 2026-10-10). Now the window hands main the PIN,
// main checks it against the stored hash itself, and only a right PIN unlocks.
//
// The hash is the one js/vex-lock.js has always stored ('vex.lockPin' in the
// preference file): PBKDF2-SHA-256, 150 000 rounds, 16-byte salt, 32-byte key,
// salt and hash in base64. Main also counts wrong PINs on its own, so a page
// of script that reached the IPC could not guess faster than the lock screen.
const crypto = require('crypto');

const ITERATIONS = 150000;
const MAX_FAILS = 5;
const WAIT_MS = 30000;
// Each round of five wrong PINs doubles the wait: 30 s, 1 min, 2 min ... up
// to an hour. A fixed thirty seconds let a 4-digit PIN be walked through in
// under a day (audit SE2, 2026-10-10).
const MAX_WAIT_MS = 60 * 60 * 1000;

function waitFor(round) {
  const n = Math.max(1, Math.floor(Number(round)) || 1);
  return Math.min(WAIT_MS * 2 ** (n - 1), MAX_WAIT_MS);
}

function waitText(ms) {
  const s = Math.ceil(ms / 1000);
  return s < 120 ? s + ' s' : Math.ceil(s / 60) + ' min';
}

function parseRecord(raw) {
  if (raw == null || raw === '') return null;
  let rec;
  try { rec = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw new Error('The stored PIN cannot be read'); }
  if (!rec) return null;
  if (typeof rec.salt !== 'string' || typeof rec.hash !== 'string') throw new Error('The stored PIN cannot be read');
  return rec;
}

function hashPin(pin, saltB64) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(pin), Buffer.from(saltB64, 'base64'), ITERATIONS, 32, 'sha256', (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

async function pinMatches(record, pin) {
  const want = Buffer.from(record.hash, 'base64');
  const got = await hashPin(pin, record.salt);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// readRecord() -> the stored 'vex.lockPin' value (a JSON string), or nothing.
// store: { load() -> { fails, rounds, waitUntil } | null, save(state) }, both
// may be async. Main keeps it in a file, so a restart no longer hands out
// five fresh tries; without a store the count lives in memory.
function createLockGate({ readRecord, now = () => Date.now(), store }) {
  if (typeof readRecord !== 'function') throw new Error('createLockGate: no PIN reader');
  let memory = null;
  const io = store || { load: () => memory, save: (st) => { memory = { ...st }; } };

  async function load() {
    const st = await io.load();
    if (st == null) return { fails: 0, rounds: 0, waitUntil: 0 };
    const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
    const out = { fails: num(st.fails), rounds: num(st.rounds), waitUntil: num(st.waitUntil) };
    // Never more than one wait from now: a clock that jumped back would
    // otherwise refuse the right PIN for as long as the jump.
    if (out.waitUntil) out.waitUntil = Math.min(out.waitUntil, now() + waitFor(out.rounds));
    return out;
  }

  // -> { ok: true } or { ok: false, error }
  async function tryUnlock(pin) {
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) return { ok: false, error: 'Wrong PIN' };
    const st = await load();
    const left = st.waitUntil - now();
    if (left > 0) return { ok: false, error: 'Too many tries — wait ' + waitText(left) };
    const record = parseRecord(readRecord());
    if (!record) return { ok: false, error: 'No PIN is saved, so Vex cannot check it. Restart Vex to open it.' };
    if (await pinMatches(record, pin)) {
      if (st.fails || st.rounds || st.waitUntil) await io.save({ fails: 0, rounds: 0, waitUntil: 0 });
      return { ok: true };
    }
    st.fails += 1;
    if (st.fails >= MAX_FAILS) {
      st.fails = 0;
      st.rounds += 1;
      const wait = waitFor(st.rounds);
      st.waitUntil = now() + wait;
      await io.save(st);
      return { ok: false, error: 'Too many tries — wait ' + waitText(wait) };
    }
    await io.save(st);
    return { ok: false, error: 'Wrong PIN' };
  }

  return { tryUnlock };
}

// The wrong-PIN count kept in a small JSON file (main passes
// <userData>/lock-tries.json). A file that cannot be read is an error, not a
// fresh start: starting over would hand a guesser five new tries.
function fileStore(file, { atomicWrite } = {}) {
  const fs = require('fs');
  if (typeof atomicWrite !== 'function') throw new Error('fileStore: no atomicWrite');
  return {
    async load() {
      let raw;
      try { raw = await fs.promises.readFile(file, 'utf8'); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      try { return JSON.parse(raw); }
      catch { throw new Error('The count of wrong PINs cannot be read (' + file + ')'); }
    },
    save: (st) => atomicWrite(file, JSON.stringify(st), { backup: false }),
  };
}

module.exports = { createLockGate, parseRecord, pinMatches, fileStore, waitFor, waitText, ITERATIONS, MAX_FAILS, WAIT_MS, MAX_WAIT_MS };
