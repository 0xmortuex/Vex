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

// A second kind of record (T3-123): a PIN or passphrase hashed with scrypt, made
// here in main (Web Crypto in the window has no scrypt). The record names its
// own cost so it can be raised later without locking anyone out; the cost is
// bounded on read so a damaged or planted record cannot ask for gigabytes.
const SCRYPT_DEFAULT = Object.freeze({ N: 32768, r: 8, p: 1 });
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const PASSPHRASE_MIN = 8;
const PASSPHRASE_MAX = 128;

function scryptParamsOk(rec) {
  const { N, r, p } = rec;
  return Number.isInteger(N) && N >= 16384 && N <= 1048576 && (N & (N - 1)) === 0
    && Number.isInteger(r) && r >= 8 && r <= 16 && Number.isInteger(p) && p >= 1 && p <= 4;
}

function parseRecord(raw) {
  if (raw == null || raw === '') return null;
  let rec;
  try { rec = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw new Error('The stored PIN cannot be read'); }
  if (!rec) return null;
  if (typeof rec.salt !== 'string' || typeof rec.hash !== 'string') throw new Error('The stored PIN cannot be read');
  if (rec.kdf !== undefined && rec.kdf !== 'scrypt') throw new Error('The stored PIN cannot be read');
  if (rec.kdf === 'scrypt' && !scryptParamsOk(rec)) throw new Error('The stored PIN cannot be read');
  return rec;
}

function hashPin(pin, saltB64) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(pin), Buffer.from(saltB64, 'base64'), ITERATIONS, 32, 'sha256', (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

function hashScrypt(secret, saltB64, { N, r, p }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(secret), Buffer.from(saltB64, 'base64'), 32, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

async function pinMatches(record, pin) {
  const want = Buffer.from(record.hash, 'base64');
  const got = record.kdf === 'scrypt' ? await hashScrypt(pin, record.salt, record) : await hashPin(pin, record.salt);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// What a PIN or passphrase may look like for this record: the old PBKDF2 records
// were made for 4-12 digits; a scrypt record takes 4-12 digits or an 8-128
// character passphrase (see makeScryptRecord).
function secretShapeOk(record, secret) {
  if (typeof secret !== 'string') return false;
  if (/^\d{4,12}$/.test(secret)) return true;
  return !!record && record.kdf === 'scrypt' && secret.length >= PASSPHRASE_MIN && secret.length <= PASSPHRASE_MAX;
}

// A new record for a PIN (4-12 digits) or a passphrase (8-128 characters). The
// value goes in as given: it is never trimmed, so what is typed is what is hashed.
async function makeScryptRecord(secret) {
  if (typeof secret !== 'string') throw new Error('Choose a PIN or a passphrase');
  const isPin = /^\d{4,12}$/.test(secret);
  if (!isPin && (secret.length < PASSPHRASE_MIN || secret.length > PASSPHRASE_MAX)) {
    throw new Error('A PIN is 4 to 12 digits; a passphrase is ' + PASSPHRASE_MIN + ' to ' + PASSPHRASE_MAX + ' characters');
  }
  const salt = crypto.randomBytes(16).toString('base64');
  const key = await hashScrypt(secret, salt, SCRYPT_DEFAULT);
  return { kdf: 'scrypt', ...SCRYPT_DEFAULT, salt, hash: key.toString('base64') };
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

  // One guess at a time: parallel calls would read the same wrong-PIN count
  // and so count as one failure between them (audit, 2026-10).
  let chain = Promise.resolve();
  function tryUnlock(pin) {
    const run = chain.then(() => checkPin(pin));
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  // -> { ok: true } or { ok: false, error }
  async function checkPin(pin) {
    // Not even the right length for any kind of record: refused before the record is read.
    if (typeof pin !== 'string' || pin.length < 4 || pin.length > PASSPHRASE_MAX) return { ok: false, error: 'Wrong PIN' };
    const st = await load();
    const left = st.waitUntil - now();
    if (left > 0) return { ok: false, error: 'Too many tries — wait ' + waitText(left) };
    const record = parseRecord(readRecord());
    if (!record) return { ok: false, error: 'No PIN is saved, so Vex cannot check it. Restart Vex to open it.' };
    if (!secretShapeOk(record, pin)) return { ok: false, error: 'Wrong PIN' };
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

module.exports = { createLockGate, parseRecord, pinMatches, makeScryptRecord, secretShapeOk, SCRYPT_DEFAULT, PASSPHRASE_MIN, PASSPHRASE_MAX, fileStore, waitFor, waitText, ITERATIONS, MAX_FAILS, WAIT_MS, MAX_WAIT_MS };
