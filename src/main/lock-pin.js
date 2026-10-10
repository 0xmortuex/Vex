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
function createLockGate({ readRecord, now = () => Date.now() }) {
  if (typeof readRecord !== 'function') throw new Error('createLockGate: no PIN reader');
  let fails = 0;
  let waitUntil = 0;

  // -> { ok: true } or { ok: false, error }
  async function tryUnlock(pin) {
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) return { ok: false, error: 'Wrong PIN' };
    const left = waitUntil - now();
    if (left > 0) return { ok: false, error: 'Too many tries — wait ' + Math.ceil(left / 1000) + ' s' };
    const record = parseRecord(readRecord());
    if (!record) return { ok: false, error: 'No PIN is saved, so Vex cannot check it. Restart Vex to open it.' };
    if (await pinMatches(record, pin)) { fails = 0; waitUntil = 0; return { ok: true }; }
    fails += 1;
    if (fails >= MAX_FAILS) { fails = 0; waitUntil = now() + WAIT_MS; return { ok: false, error: 'Too many tries — wait 30 s' }; }
    return { ok: false, error: 'Wrong PIN' };
  }

  return { tryUnlock };
}

module.exports = { createLockGate, parseRecord, pinMatches, ITERATIONS, MAX_FAILS, WAIT_MS };
