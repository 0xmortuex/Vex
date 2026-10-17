// === Encrypted profile lock: encryption at rest for the personal stores (T3-123) ==
//
// The Vex lock (lock-pin.js) is a privacy screen. This is the other half the
// owner approved on 2026-10-17: opt-in encryption of the profile files that hold
// the notes, clips, history, journal, ledger and the open tabs, with a passphrase
// AND a recovery code, so that someone who copies the folder (or reads it with
// your Windows account while Vex is closed) gets ciphertext.
//
// Key design
//   * One random 256-bit data key. It never touches the disk in the clear.
//   * It is stored twice, each copy wrapped (AES-256-GCM) by a key made with scrypt
//     from (a) the passphrase and (b) the recovery code. Either one opens the
//     profile. The header, profile-lock.json, holds only the two wrapped copies.
//   * The recovery code (160 random bits, 8 groups of 4 characters) is returned
//     ONCE by enable()/newRecoveryCode(). It is never stored anywhere.
//   * Each file is "VEXPC1\0\0" + iv(12) + tag(16) + ciphertext (AES-256-GCM).
//     A file that does not start with that mark is plaintext and is read as it is,
//     so a profile that is half way through a change still reads.
//
// Never lock the owner out. Whatever fails, plaintext stays:
//   enable():  checks the passphrase and the code unwrap the key, takes a snapshot of
//              every file and verifies it by hash, writes a "migrating" header,
//              then per file: encrypt to a temp file, decrypt that temp file and
//              compare it with the original, copy the original to <file>.pc-bak,
//              rename the temp over the file. Only when every file decrypts to the
//              snapshot hash and a SECOND engine, reading only the disk, opens the
//              profile with the passphrase and with the recovery code, is the header
//              set to "encrypted" and the plaintext copies removed. Any failure
//              before that puts every file back from its .pc-bak (or the snapshot).
//   recover(): a crash during enable() leaves a "migrating" header; recover()
//              puts the plaintext back (no key needed) and removes the header.
//   disable(): the switch back to plaintext. Each file is decrypted to a temp file,
//              compared, the encrypted bytes are copied to <file>.pc-enc, the temp is
//              renamed over the file; the header goes last. A failure restores the
//              encrypted files. Running it again after a crash finishes the job.
//
// What it does not do (said plainly in Settings): Windows may keep old plaintext in
// free disk space (the .pc-bak and snapshot files are deleted, not wiped); the key is
// in this process's memory while Vex is unlocked; pages' own cookies and logins are
// Chromium's and are not covered; BitLocker is the answer for the whole disk.
const nodeFs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');

const MAGIC = Buffer.from('VEXPC1\0\0', 'latin1');
const HEADER_FILE = 'profile-lock.json';
const SNAPSHOT_DIR = 'profile-lock-snapshot';
const RESIDUE = /\.pc-(?:bak|tmp|enc|restore)(?:\.w)?$/;
const AAD_DATA = Buffer.from('vex-profile-lock/data/1');
const aadWrap = (id) => Buffer.from('vex-profile-lock/wrap/' + id);
const KDF_DEFAULT = Object.freeze({ N: 65536, r: 8, p: 1 });
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const PASSPHRASE_MIN = 8;
const PASSPHRASE_MAX = 128;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

class ProfileLockError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'ProfileLockError'; this.code = code; }
}

// ---- low level ---------------------------------------------------------------
function isEnvelope(buf) { return Buffer.isBuffer(buf) && buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC); }

function encryptBytes(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(AAD_DATA);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

function decryptBytes(key, buf) {
  if (!isEnvelope(buf)) throw new ProfileLockError('CORRUPT', 'The file is not an encrypted Vex file');
  if (buf.length < MAGIC.length + 28) throw new ProfileLockError('CORRUPT', 'The encrypted file is cut short');
  const iv = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buf.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(AAD_DATA);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(MAGIC.length + 28)), d.final()]); }
  catch (e) { throw new ProfileLockError('CORRUPT', 'The encrypted file failed its check: it is damaged, or it was made with another key', { cause: e }); }
}

function kdfOk(k) {
  return !!k && k.name === 'scrypt' && Number.isInteger(k.N) && k.N >= 16384 && k.N <= 131072 && (k.N & (k.N - 1)) === 0
    && Number.isInteger(k.r) && k.r >= 8 && k.r <= 16 && Number.isInteger(k.p) && k.p >= 1 && k.p <= 4;
}

function scryptKey(secret, salt, kdf) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(Buffer.from(String(secret), 'utf8'), salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: SCRYPT_MAXMEM }, (err, key) => { if (err) reject(err); else resolve(key); });
  });
}

async function wrapKey(dek, secret, id, kdf) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const kek = await scryptKey(secret, salt, kdf);
  const c = crypto.createCipheriv('aes-256-gcm', kek, iv);
  c.setAAD(aadWrap(id));
  const ct = Buffer.concat([c.update(dek), c.final()]);
  return { id, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

async function unwrapKey(w, secret, kdf) {
  const kek = await scryptKey(secret, Buffer.from(w.salt, 'base64'), kdf);
  const d = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(w.iv, 'base64'));
  d.setAAD(aadWrap(w.id));
  d.setAuthTag(Buffer.from(w.tag, 'base64'));
  try { return Buffer.concat([d.update(Buffer.from(w.ct, 'base64')), d.final()]); }
  catch (e) { throw new ProfileLockError('WRONG_SECRET', w.id === 'recovery' ? 'That recovery code does not open this profile' : 'Wrong passphrase', { cause: e }); }
}

// ---- recovery code -------------------------------------------------------------
function makeRecoveryCode(bytes = crypto.randomBytes(20)) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g).join('-');
}

// What is typed back: case, dashes and spaces do not matter, and the look-alikes
// O/0 and I/L/1 are read the way the alphabet has them.
function normaliseRecoveryCode(text) {
  const s = String(text == null ? '' : text).toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 32 || [...s].some((ch) => !ALPHABET.includes(ch))) throw new ProfileLockError('BAD_INPUT', 'A recovery code is 32 letters and digits, in groups of four');
  return s;
}

function checkPassphrase(p) {
  if (typeof p !== 'string' || p.length < PASSPHRASE_MIN || p.length > PASSPHRASE_MAX) {
    throw new ProfileLockError('BAD_INPUT', 'A passphrase is ' + PASSPHRASE_MIN + ' to ' + PASSPHRASE_MAX + ' characters');
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// The files holding the personal stores that live in the profile folder: the
// preference file and its volatile half (notes, clips, history, journal, ledger,
// every vex.* value), with their .bak, rolling generations and kept copies. Not
// the temp files and not the lock's own. Returned as paths relative to the folder.
// `storageKeys`: the keys of vex-storage/ (the JsonStore) that are encrypted too.
function profileFiles(userDataPath, fsMod = nodeFs, storageKeys = []) {
  const out = [];
  const isFile = (p) => { try { return fsMod.statSync(p).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
  for (const name of fsMod.readdirSync(userDataPath)) {
    if (!/^vex-persist(?:-volatile)?\.json(?:\.|$)/.test(name)) continue;
    if (RESIDUE.test(name) || /\.tmp$/.test(name)) continue;
    if (isFile(nodePath.join(userDataPath, name))) out.push(name);
  }
  const dir = nodePath.join(userDataPath, 'vex-storage');
  for (const key of storageKeys) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error('profileFiles: invalid storage key ' + key);
    for (const name of [key + '.json', key + '.json.bak']) if (isFile(nodePath.join(dir, name))) out.push('vex-storage/' + name);
  }
  return out.sort();
}

function createProfileCrypt({ userDataPath, fsMod = nodeFs, kdf = KDF_DEFAULT, now = () => Date.now() } = {}) {
  if (!userDataPath) throw new Error('createProfileCrypt: no profile folder');
  if (!kdfOk({ name: 'scrypt', ...kdf })) throw new Error('createProfileCrypt: unsupported scrypt cost');
  const headerPath = nodePath.join(userDataPath, HEADER_FILE);
  const snapDir = nodePath.join(userDataPath, SNAPSHOT_DIR);
  let key = null;           // the data key while unlocked
  let header;               // undefined: not read yet; null: none
  const abs = (rel) => nodePath.join(userDataPath, rel);

  // ---- files ------------------------------------------------------------------------
  function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  // Windows: another program can hold a file for a moment.
  function retry(op) {
    for (let i = 0; ; i++) {
      try { return op(); }
      catch (e) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(e && e.code) || i >= 6) throw e; sleep(25 * 2 ** i); }
    }
  }
  function writeFileAtomic(file, bytes, tmp = file + '.pc-tmp') {
    const fd = fsMod.openSync(tmp, 'w', 0o600);
    try { fsMod.writeSync(fd, bytes); fsMod.fsyncSync(fd); } finally { fsMod.closeSync(fd); }
    retry(() => fsMod.renameSync(tmp, file));
  }
  function readOrNull(file) {
    try { return fsMod.readFileSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  function rm(file) { fsMod.rmSync(file, { recursive: true, force: true }); }  // also the snapshot folder

  // ---- header -----------------------------------------------------------------------
  function shapeOk(h) {
    return !!h && h.v === 1 && ['encrypted', 'migrating', 'decrypting'].includes(h.state) && kdfOk(h.kdf)
      && Array.isArray(h.wraps) && ['passphrase', 'recovery'].every((id) => h.wraps.some((w) => w && w.id === id
        && ['salt', 'iv', 'tag', 'ct'].every((k) => typeof w[k] === 'string')));
  }
  function parseHeader(buf) {
    let h;
    try { h = JSON.parse(buf.toString('utf8')); } catch { return null; }
    return shapeOk(h) ? h : null;
  }
  function loadHeader() {
    if (header !== undefined) return header;
    const raw = readOrNull(headerPath);
    if (raw === null) {
      // A header that went missing while a .bak is left is not "no lock": the files may be encrypted.
      if (readOrNull(headerPath + '.bak') !== null) throw new ProfileLockError('CORRUPT', HEADER_FILE + ' is missing but ' + HEADER_FILE + '.bak is there. Vex will not start the profile as unencrypted. Restore the file from the .bak.');
      header = null; return header;
    }
    let h = parseHeader(raw);
    if (!h) {
      const bak = readOrNull(headerPath + '.bak');
      h = bak && parseHeader(bak);
      if (!h) throw new ProfileLockError('CORRUPT', HEADER_FILE + ' cannot be read and has no good .bak. The encrypted files cannot be opened without it.');
      writeFileAtomic(headerPath, Buffer.from(JSON.stringify(h)));
    }
    header = h; return header;
  }
  function saveHeader(h) {
    const previous = readOrNull(headerPath);
    if (previous !== null && parseHeader(previous)) writeFileAtomic(headerPath + '.bak', previous);
    writeFileAtomic(headerPath, Buffer.from(JSON.stringify(h)));
    const back = parseHeader(fsMod.readFileSync(headerPath));
    if (!back || JSON.stringify(back) !== JSON.stringify(h)) throw new ProfileLockError('VERIFY_FAILED', HEADER_FILE + ' did not read back the same');
    header = h;
  }
  function dropHeader() { rm(headerPath); rm(headerPath + '.bak'); header = null; }

  function normaliseFiles(files) {
    if (!Array.isArray(files)) throw new ProfileLockError('BAD_INPUT', 'No file list given');
    const out = [];
    for (const f of files) {
      if (typeof f !== 'string' || !f) throw new ProfileLockError('BAD_INPUT', 'A file name is not text');
      const rel = nodePath.relative(userDataPath, nodePath.resolve(userDataPath, f)).split(nodePath.sep).join('/');
      if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) throw new ProfileLockError('BAD_INPUT', f + ' is outside the profile folder');
      if (rel === HEADER_FILE || rel.startsWith(HEADER_FILE + '.') || RESIDUE.test(rel)) throw new ProfileLockError('BAD_INPUT', rel + ' is not a store');
      if (!out.includes(rel)) out.push(rel);
    }
    return out.filter((rel) => { try { return fsMod.statSync(abs(rel)).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; } });
  }

  // ---- state ------------------------------------------------------------------------
  function status() {
    const h = loadHeader();
    return { enabled: !!h, state: h ? h.state : 'plain', locked: !!h && !key, createdAt: h && h.createdAt ? h.createdAt : null };
  }
  const isLocked = () => { const h = loadHeader(); return !!h && !key; };

  // ---- the codec the stores use -----------------------------------------------------
  // decode: an encrypted file needs the key; a plaintext file reads as it is.
  // encode: with a lock on, every write is encrypted, and without the key it is refused.
  const codec = {
    isEnvelope,
    decode(buf) {
      if (!isEnvelope(buf)) return buf;
      if (!key) throw new ProfileLockError('LOCKED', 'The profile is locked: unlock it with the passphrase');
      return decryptBytes(key, buf);
    },
    encode(buf) {
      const h = loadHeader();
      if (!h) return buf;
      if (!key) throw new ProfileLockError('LOCKED', 'The profile is locked: unlock it with the passphrase');
      return encryptBytes(key, buf);
    },
  };

  // ---- unlock -----------------------------------------------------------------------
  async function unlock(passphrase) {
    const h = loadHeader();
    if (!h) throw new ProfileLockError('BAD_STATE', 'The profile is not encrypted');
    if (typeof passphrase !== 'string' || !passphrase) throw new ProfileLockError('WRONG_SECRET', 'Wrong passphrase');
    key = await unwrapKey(h.wraps.find((w) => w.id === 'passphrase'), passphrase, h.kdf);
    return { via: 'passphrase' };
  }
  async function unlockWithRecovery(code) {
    const h = loadHeader();
    if (!h) throw new ProfileLockError('BAD_STATE', 'The profile is not encrypted');
    key = await unwrapKey(h.wraps.find((w) => w.id === 'recovery'), normaliseRecoveryCode(code), h.kdf);
    return { via: 'recovery' };
  }
  function lock() { if (key) key.fill(0); key = null; }

  // ---- snapshot ---------------------------------------------------------------------
  function takeSnapshot(rels) {
    rm(snapDir);
    fsMod.mkdirSync(snapDir, { recursive: true });
    const entries = [];
    rels.forEach((rel, i) => {
      const bytes = fsMod.readFileSync(abs(rel));
      const name = i + '.bin';
      fsMod.writeFileSync(nodePath.join(snapDir, name), bytes);
      const back = fsMod.readFileSync(nodePath.join(snapDir, name));
      if (!back.equals(bytes)) throw new ProfileLockError('VERIFY_FAILED', 'The backup snapshot of ' + rel + ' did not read back the same');
      entries.push({ rel, name, sha256: sha256(bytes), bytes: bytes.length });
    });
    fsMod.writeFileSync(nodePath.join(snapDir, 'manifest.json'), JSON.stringify({ at: now(), entries }));
    return entries;
  }
  function readSnapshot() {
    const raw = readOrNull(nodePath.join(snapDir, 'manifest.json'));
    if (raw === null) return [];
    const m = JSON.parse(raw.toString('utf8'));
    return Array.isArray(m.entries) ? m.entries : [];
  }

  // ---- enable ------------------------------------------------------------------------
  async function enable({ passphrase, files, validate } = {}) {
    if (loadHeader()) throw new ProfileLockError('BAD_STATE', 'The profile is already encrypted');
    checkPassphrase(passphrase);
    const rels = normaliseFiles(files);
    const originals = new Map();
    for (const rel of rels) {
      const bytes = fsMod.readFileSync(abs(rel));
      if (isEnvelope(bytes)) throw new ProfileLockError('BAD_STATE', rel + ' is already encrypted but there is no lock header. Nothing was changed.');
      if (validate) validate(rel, bytes);
      originals.set(rel, bytes);
    }
    // 1. the key, the two wraps, and proof that both open before any file is touched
    const dek = crypto.randomBytes(32);
    const code = makeRecoveryCode();
    const kdfParams = { name: 'scrypt', ...kdf };
    const wraps = [await wrapKey(dek, passphrase, 'passphrase', kdfParams), await wrapKey(dek, normaliseRecoveryCode(code), 'recovery', kdfParams)];
    if (!(await unwrapKey(wraps[0], passphrase, kdfParams)).equals(dek) || !(await unwrapKey(wraps[1], normaliseRecoveryCode(code), kdfParams)).equals(dek)) {
      throw new ProfileLockError('VERIFY_FAILED', 'The key could not be wrapped safely. Nothing was changed.');
    }
    // 2. a verified snapshot of every file
    const entries = takeSnapshot(rels);
    // 3. the journal, then the files
    const h = { v: 1, state: 'migrating', kdf: kdfParams, wraps, createdAt: now(), journal: { files: rels, at: now() } };
    saveHeader(h);
    key = dek;
    try {
      for (const rel of rels) {
        const file = abs(rel), plain = originals.get(rel);
        const tmp = file + '.pc-tmp';
        writeFileAtomic(tmp, encryptBytes(dek, plain), tmp + '.w');
        if (!decryptBytes(dek, fsMod.readFileSync(tmp)).equals(plain)) throw new ProfileLockError('VERIFY_FAILED', rel + ' did not decrypt to what it was');
        writeFileAtomic(file + '.pc-bak', plain, file + '.pc-bak.w');
        if (!fsMod.readFileSync(file + '.pc-bak').equals(plain)) throw new ProfileLockError('VERIFY_FAILED', 'The copy of ' + rel + ' did not read back the same');
        retry(() => fsMod.renameSync(tmp, file));
      }
      for (const e of entries) {
        if (sha256(decryptBytes(dek, fsMod.readFileSync(abs(e.rel)))) !== e.sha256) throw new ProfileLockError('VERIFY_FAILED', e.rel + ' does not decrypt to the snapshot');
      }
      // A second engine that reads nothing but the disk must open it with BOTH secrets.
      const fresh = createProfileCrypt({ userDataPath, fsMod, kdf });
      for (const open of [() => fresh.unlock(passphrase), () => fresh.unlockWithRecovery(code)]) {
        await open();
        for (const e of entries) {
          if (sha256(fresh.codec.decode(fsMod.readFileSync(abs(e.rel)))) !== e.sha256) throw new ProfileLockError('VERIFY_FAILED', e.rel + ' does not open from the saved key');
        }
        fresh.lock();
      }
      saveHeader({ v: 1, state: 'encrypted', kdf: kdfParams, wraps, createdAt: h.createdAt });
    } catch (error) {
      const failure = error instanceof ProfileLockError ? error : new ProfileLockError('FAILED', 'Encrypting the profile failed: ' + error.message, { cause: error });
      key = null;
      try { rollbackMigration(); }
      catch (rollbackError) {
        throw new ProfileLockError('ROLLBACK_FAILED', failure.message + ' AND putting the files back failed: ' + rollbackError.message + '. Your plaintext is still in the .pc-bak files and the ' + SNAPSHOT_DIR + ' folder; restart Vex to try again.', { cause: failure });
      }
      throw failure;
    }
    const leftovers = sweepResidue();
    return { recoveryCode: code, files: rels, leftovers };
  }

  // The plaintext goes back; no key needed. Used when enable() fails and by recover().
  function rollbackMigration() {
    const h = loadHeader();
    if (!h || h.state !== 'migrating') throw new ProfileLockError('BAD_STATE', 'There is no interrupted encryption to undo');
    const snap = readSnapshot();
    const byRel = new Map(snap.map((e) => [e.rel, e]));
    const problems = [];
    for (const rel of (h.journal && h.journal.files) || []) {
      const file = abs(rel);
      try {
        const bakBytes = readOrNull(file + '.pc-bak');
        const current = readOrNull(file);
        if (bakBytes !== null) {
          writeFileAtomic(file, bakBytes, file + '.pc-restore');
        } else if (current !== null && !isEnvelope(current)) {
          continue; // never touched
        } else if (byRel.has(rel)) {
          const e = byRel.get(rel), bytes = fsMod.readFileSync(nodePath.join(snapDir, e.name));
          if (sha256(bytes) !== e.sha256) throw new ProfileLockError('CORRUPT', 'the snapshot of ' + rel + ' is damaged');
          writeFileAtomic(file, bytes, file + '.pc-restore');
        } else {
          throw new ProfileLockError('CORRUPT', rel + ' is encrypted and has neither a .pc-bak nor a snapshot');
        }
        const e = byRel.get(rel);
        if (e && sha256(fsMod.readFileSync(file)) !== e.sha256) throw new ProfileLockError('VERIFY_FAILED', rel + ' is not what it was before');
      } catch (err) { problems.push(rel + ': ' + err.message); }
    }
    if (problems.length) throw new ProfileLockError('ROLLBACK_FAILED', problems.join('; '));
    for (const rel of (h.journal && h.journal.files) || []) { rm(abs(rel) + '.pc-bak'); rm(abs(rel) + '.pc-tmp'); rm(abs(rel) + '.pc-tmp.w'); rm(abs(rel) + '.pc-bak.w'); rm(abs(rel) + '.pc-restore'); }
    rm(snapDir);
    dropHeader();
  }

  // At start: undo an encryption that never finished. Returns what it did.
  function recover() {
    const h = loadHeader();
    if (!h) return { recovered: false, state: 'plain' };
    if (h.state === 'migrating') { key = null; rollbackMigration(); return { recovered: true, state: 'plain' }; }
    return { recovered: false, state: h.state };
  }

  // Removes plaintext leftovers (.pc-bak, .pc-tmp, snapshot) once the encrypted file next to it opens.
  // A leftover whose partner does not open is kept and returned.
  // Whether the bytes are an encrypted file that the current key opens.
  function opens(bytes) {
    if (bytes === null || !isEnvelope(bytes)) return false;
    try { decryptBytes(key, bytes); return true; } catch (e) { if (e instanceof ProfileLockError) return false; throw e; }
  }
  function sweepResidue() {
    const h = loadHeader();
    const kept = [];
    if (!h || h.state !== 'encrypted' || !key) return kept;
    for (const sub of ['', 'vex-storage']) {
      let names;
      try { names = fsMod.readdirSync(abs(sub)); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      for (const base of names) {
        const m = /^(.*)\.pc-(?:bak|tmp|enc|restore)(?:\.w)?$/.exec(base);
        if (!m) continue;
        const name = sub ? sub + '/' + base : base, partnerName = sub ? sub + '/' + m[1] : m[1];
        if (opens(readOrNull(abs(partnerName))) || /\.pc-tmp/.test(base)) rm(abs(name)); else kept.push(name);
      }
    }
    if (!kept.length) rm(snapDir); else kept.push(SNAPSHOT_DIR);
    return kept;
  }

  // ---- disable: back to plaintext -----------------------------------------------------
  async function disable({ passphrase, recoveryCode, files, validate } = {}) {
    const h0 = loadHeader();
    if (!h0) throw new ProfileLockError('BAD_STATE', 'The profile is not encrypted');
    if (h0.state === 'migrating') throw new ProfileLockError('BAD_STATE', 'An encryption was interrupted: restart Vex to undo it first');
    if (passphrase) await unlock(passphrase); else if (recoveryCode) await unlockWithRecovery(recoveryCode);
    if (!key) throw new ProfileLockError('LOCKED', 'Unlock the profile (or give the passphrase or recovery code) first');
    const rels = normaliseFiles(files);
    saveHeader({ ...h0, state: 'decrypting', journal: { files: rels, at: now() } });
    const planned = new Map();
    try {
      for (const rel of rels) {
        const file = abs(rel), enc = fsMod.readFileSync(file);
        if (!isEnvelope(enc)) continue;
        const plain = decryptBytes(key, enc);
        if (validate) validate(rel, plain);
        const tmp = file + '.pc-tmp';
        writeFileAtomic(tmp, plain, tmp + '.w');
        if (!fsMod.readFileSync(tmp).equals(plain)) throw new ProfileLockError('VERIFY_FAILED', 'The plain copy of ' + rel + ' did not read back the same');
        writeFileAtomic(file + '.pc-enc', enc, file + '.pc-enc.w');
        retry(() => fsMod.renameSync(tmp, file));
        planned.set(rel, sha256(plain));
      }
      for (const [rel, sum] of planned) {
        if (sha256(fsMod.readFileSync(abs(rel))) !== sum) throw new ProfileLockError('VERIFY_FAILED', rel + ' is not what it was decrypted to');
      }
    } catch (error) {
      const failure = error instanceof ProfileLockError ? error : new ProfileLockError('FAILED', 'Decrypting the profile failed: ' + error.message, { cause: error });
      try {
        for (const rel of rels) {
          const enc = readOrNull(abs(rel) + '.pc-enc');
          if (enc !== null) writeFileAtomic(abs(rel), enc, abs(rel) + '.pc-restore');
          rm(abs(rel) + '.pc-enc'); rm(abs(rel) + '.pc-tmp'); rm(abs(rel) + '.pc-tmp.w'); rm(abs(rel) + '.pc-enc.w');
        }
        saveHeader({ ...h0, state: 'encrypted' });
      } catch (restoreError) {
        throw new ProfileLockError('ROLLBACK_FAILED', failure.message + ' AND putting the encrypted files back failed: ' + restoreError.message + '. The encrypted copies are the .pc-enc files; unlock and run the switch again.', { cause: failure });
      }
      throw failure;
    }
    for (const rel of rels) { rm(abs(rel) + '.pc-enc'); rm(abs(rel) + '.pc-enc.w'); }
    dropHeader();
    lock();
    return { files: [...planned.keys()] };
  }

  // ---- changing secrets ---------------------------------------------------------------
  async function changePassphrase({ current, next }) {
    const h = loadHeader();
    if (!h || h.state !== 'encrypted') throw new ProfileLockError('BAD_STATE', 'The profile is not in a state where the passphrase can change');
    checkPassphrase(next);
    const dek = await unwrapKey(h.wraps.find((w) => w.id === 'passphrase'), current, h.kdf);
    const wrapped = await wrapKey(dek, next, 'passphrase', h.kdf);
    if (!(await unwrapKey(wrapped, next, h.kdf)).equals(dek)) throw new ProfileLockError('VERIFY_FAILED', 'The new passphrase could not be saved safely');
    saveHeader({ ...h, wraps: h.wraps.map((w) => (w.id === 'passphrase' ? wrapped : w)) });
    key = dek;
  }
  async function newRecoveryCode({ passphrase }) {
    const h = loadHeader();
    if (!h || h.state !== 'encrypted') throw new ProfileLockError('BAD_STATE', 'The profile is not in a state where the recovery code can change');
    const dek = await unwrapKey(h.wraps.find((w) => w.id === 'passphrase'), passphrase, h.kdf);
    const code = makeRecoveryCode();
    const wrapped = await wrapKey(dek, normaliseRecoveryCode(code), 'recovery', h.kdf);
    if (!(await unwrapKey(wrapped, normaliseRecoveryCode(code), h.kdf)).equals(dek)) throw new ProfileLockError('VERIFY_FAILED', 'The new recovery code could not be saved safely');
    saveHeader({ ...h, wraps: h.wraps.map((w) => (w.id === 'recovery' ? wrapped : w)) });
    key = dek;
    return { recoveryCode: code };
  }

  return { status, isLocked, codec, unlock, unlockWithRecovery, lock, enable, disable, recover, changePassphrase, newRecoveryCode, sweepResidue, profileFiles: (storageKeys) => profileFiles(userDataPath, fsMod, storageKeys) };
}

module.exports = {
  createProfileCrypt, profileFiles, ProfileLockError, isEnvelope, encryptBytes, decryptBytes, makeRecoveryCode, normaliseRecoveryCode,
  MAGIC, HEADER_FILE, SNAPSHOT_DIR, KDF_DEFAULT, PASSPHRASE_MIN, PASSPHRASE_MAX,
};
