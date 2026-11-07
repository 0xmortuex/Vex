// === The encrypted secrets lifeboat ==========================================
//
// Saved logins, authenticator seeds and cards are sealed with the operating
// system's key (Windows DPAPI). Without Vex Sync, a Windows reinstall, a reset
// profile or the loss of the DPAPI master key destroys all of them, and the
// ordinary backup deliberately holds none. This is the way out: ONE file,
// sealed with a passphrase the person chooses, that holds
//
//   passwords    every saved login (host, user name, password, note)
//   authenticator every 2FA account (label, issuer, secret, algorithm, digits, period)
//   cards        saved cards (number, name, expiry, nickname). Optional, off by
//                default: the card store was built as "this device only, no export"
//                (main/cards.js), so it goes in only when the person ticks it.
//                There is no CVV to export: Vex never kept one.
//   passkeys     only WHAT exists (site, account, name, dates). A passkey's
//                private key never leaves Vex's process by design (main/passkeys.js),
//                so it is not in the file and cannot be restored: the list says which
//                accounts need a new passkey.
//
// The file: a JSON header (format, version, date, scrypt cost and random salt,
// AES-256-GCM nonce and tag) and the ciphertext. The key comes from
// lock-pin.js (scrypt, the cost recorded in the file, bounded on read); the
// whole header is the GCM additional data, so changing the date or the cost
// fails authentication like changing a byte of the data does. A random 12-byte
// nonce and a random 16-byte salt per file. The payload is padded to a 4 KB
// step so the file size does not give the number of logins away.
//
// Rules this module keeps (and tests/main/secretsLifeboat.test.js pins):
//   - the passphrase is never stored, written or logged; it is an argument;
//   - plaintext secrets exist only in memory: a file written by this module
//     is the ciphertext, a pre-restore file is the ciphertext, and no temp file
//     ever holds more than that;
//   - no error message and no log line carries a secret or the passphrase;
//   - an export is VERIFIED before it is called done: the file is read back,
//     decrypted in memory and compared record by record with what was exported
//     (not only counted); a file that does not verify is deleted;
//   - a restore asks first (the caller passes confirmed: true), first writes an
//     automatic encrypted export of what is there now (so a bad restore is
//     reversible with the same passphrase), and refuses to go on if that cannot
//     be made;
//   - a restore adds what is missing and never overwrites a login, account or
//     card that is already there; a store that is unreadable (the DPAPI case) is
//     set aside under another name, never deleted, before it is replaced.
'use strict';

const nodeCrypto = require('crypto');
const nodeFs = require('fs');
const nodePath = require('path');
const lockPin = require('./lock-pin');

const FORMAT = 'vex-secrets-lifeboat';
const VERSION = 1;
const MIN_PASSPHRASE = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PAD_STEP = 4096;
const GENERIC_BAD = 'Wrong passphrase, or the file was changed';

const b64 = (buf) => Buffer.from(buf).toString('base64');
const stamp = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

function checkPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters`);
  if (passphrase.length > lockPin.PASSPHRASE_MAX) throw new Error(`Use a passphrase of at most ${lockPin.PASSPHRASE_MAX} characters`);
}

// The header fields the authentication covers (everything but the tag and the data).
function aadOf(file) {
  const k = file.kdf, c = file.cipher;
  return Buffer.from(JSON.stringify({
    format: file.format, version: file.version, createdAt: file.createdAt,
    kdf: { name: k.name, N: k.N, r: k.r, p: k.p, salt: k.salt }, cipher: { name: c.name, iv: c.iv },
  }), 'utf8');
}

// ---- the record cleaners (what is allowed back into a store) -----------------
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);

function cleanLogin(e) {
  if (!e || typeof e !== 'object') return null;
  const host = str(e.host, 253), username = str(e.username, 1024), password = str(e.password, 4096);
  if (!host || username === null || password === null || !host.trim()) return null;
  const out = { host, username, password, updatedAt: typeof e.updatedAt === 'string' && Number.isFinite(Date.parse(e.updatedAt)) ? e.updatedAt : new Date().toISOString() };
  if (typeof e.note === 'string' && e.note) out.note = e.note.slice(0, 4096);
  return out;
}
const totpKey = (a) => String(a.secret || '').replace(/\s/g, '').replace(/=+$/, '').toUpperCase();
function cleanTotp(a) {
  if (!a || typeof a !== 'object') return null;
  const secret = str(a.secret, 512);
  if (!secret || !secret.replace(/\s/g, '')) return null;
  return {
    label: String(a.label || '').slice(0, 4096) || 'Account', issuer: String(a.issuer || '').slice(0, 4096),
    secret: secret.replace(/\s/g, ''), algorithm: a.algorithm, digits: a.digits, period: a.period,
  };
}

function createLifeboat({
  vault, totp, cards, passkeys, files = {}, backupsDir, isLocked = () => false,
  fs = nodeFs, now = () => new Date(), randomBytes = nodeCrypto.randomBytes, randomUUID = nodeCrypto.randomUUID,
  cleanCard = null, log = () => {},
}) {
  const refuseWhileLocked = () => { if (isLocked()) throw new Error('Vex is locked: unlock it first'); };

  // ---- what is exportable --------------------------------------------------
  function collect({ includeCards = false } = {}) {
    refuseWhileLocked();
    const payload = { v: 1, createdAt: now().toISOString(), vault: vault.load().map(cleanLogin).filter(Boolean), totp: [], cards: null, passkeys: [], notExported: {} };
    payload.totp = totp.load().map(cleanTotp).filter(Boolean);
    if (includeCards) {
      payload.cards = cards.load().map(c => ({ number: String(c.number), name: c.name || '', nickname: c.nickname || '', expMonth: c.expMonth, expYear: c.expYear, brand: c.brand || '' }));
    }
    payload.passkeys = passkeys.list().map(p => ({
      credentialId: p.credentialId, rpId: p.rpId, rpName: p.rpName || '', userName: p.userName || '', userDisplayName: p.userDisplayName || '',
      nickname: p.nickname || '', createdAt: p.createdAt || null, lastUsedAt: p.lastUsedAt || null,
    }));
    payload.notExported = {
      passkeyKeys: 'A passkey’s private key never leaves Vex. Only the list is kept; each account needs a new passkey after a reinstall.',
      cardCvv: 'Vex never kept a card’s security code, so there is none to export.',
      cards: includeCards ? '' : 'Saved cards were not included (you did not tick them).',
    };
    return payload;
  }

  const counts = (p) => ({ passwords: p.vault.length, authenticator: p.totp.length, cards: p.cards ? p.cards.length : 0, cardsIncluded: !!p.cards, passkeys: p.passkeys.length });

  // A digest of the secret content, so "verified" means the same records, not just the same numbers.
  function digestOf(p) {
    const keep = { vault: p.vault, totp: p.totp, cards: p.cards, passkeys: p.passkeys };
    const sorted = (arr) => (arr ? [...arr].map(x => JSON.stringify(Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))))).sort() : null);
    return nodeCrypto.createHash('sha256').update(JSON.stringify({ vault: sorted(keep.vault), totp: sorted(keep.totp), cards: sorted(keep.cards), passkeys: sorted(keep.passkeys) })).digest('hex');
  }

  // ---- the sealed file -----------------------------------------------------
  async function seal(payload, passphrase) {
    checkPassphrase(passphrase);
    const record = await lockPin.makeScryptRecord(passphrase);       // fresh random salt, the standard cost
    const key = Buffer.from(record.hash, 'base64');
    try {
      const iv = randomBytes(12);
      const file = {
        format: FORMAT, version: VERSION, createdAt: payload.createdAt,
        kdf: { name: 'scrypt', N: record.N, r: record.r, p: record.p, salt: record.salt },
        cipher: { name: 'aes-256-gcm', iv: b64(iv), tag: '' },
      };
      const base = Buffer.byteLength(JSON.stringify({ ...payload, pad: '' }));
      const plain = Buffer.from(JSON.stringify({ ...payload, pad: 'x'.repeat((PAD_STEP - (base % PAD_STEP)) % PAD_STEP) }), 'utf8');
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aadOf(file));
      const data = Buffer.concat([cipher.update(plain), cipher.final()]);
      file.cipher.tag = b64(cipher.getAuthTag());
      file.data = b64(data);
      return JSON.stringify(file, null, 1);
    } finally { key.fill(0); }
  }

  async function open(text, passphrase) {
    if (typeof passphrase !== 'string' || !passphrase) throw new Error(GENERIC_BAD);
    if (typeof text !== 'string' || text.length > MAX_FILE_BYTES) throw new Error('That is not a Vex secrets file');
    let file;
    try { file = JSON.parse(text); } catch { throw new Error('That is not a Vex secrets file'); }
    if (!file || file.format !== FORMAT) throw new Error('That is not a Vex secrets file');
    if (file.version !== VERSION) throw new Error('This secrets file is from a newer Vex (version ' + String(file.version).slice(0, 8) + '); update Vex to open it');
    if (!file.kdf || !file.cipher || file.cipher.name !== 'aes-256-gcm' || typeof file.data !== 'string' || typeof file.cipher.iv !== 'string' || typeof file.cipher.tag !== 'string') throw new Error('That is not a Vex secrets file');
    let key;
    try { key = await lockPin.deriveScryptKey(passphrase, { kdf: file.kdf.name, N: file.kdf.N, r: file.kdf.r, p: file.kdf.p, salt: file.kdf.salt }); }
    catch { throw new Error('That secrets file uses settings Vex does not read'); }
    let plain;
    try {
      const d = nodeCrypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.cipher.iv, 'base64'));
      d.setAAD(aadOf(file));
      d.setAuthTag(Buffer.from(file.cipher.tag, 'base64'));
      plain = Buffer.concat([d.update(Buffer.from(file.data, 'base64')), d.final()]);
    } catch { throw new Error(GENERIC_BAD); }
    finally { key.fill(0); }
    let p;
    try { p = JSON.parse(plain.toString('utf8')); } catch { throw new Error(GENERIC_BAD); }
    plain.fill(0);
    if (!p || p.v !== 1 || !Array.isArray(p.vault) || !Array.isArray(p.totp) || !Array.isArray(p.passkeys)) throw new Error('That secrets file holds nothing Vex can read');
    delete p.pad;
    return p;
  }

  // ciphertext only, beside its final name, then renamed: no half file, and nothing readable in a temp.
  function writeAtomic(file, text) {
    const tmp = file + '.' + process.pid + '.tmp';
    try {
      fs.mkdirSync(nodePath.dirname(file), { recursive: true });
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch (rmErr) { log('[Lifeboat] could not delete a temporary file: ' + (rmErr.code || 'error')); }
      throw new Error('The file could not be written (' + (err.code || 'unknown error') + ')', { cause: err });
    }
  }

  // ---- export, with the mandatory verification -----------------------------
  // -> { counts, verified: true, bytes }. The file only stays if it verified.
  async function exportToFile(file, passphrase, { includeCards = false } = {}) {
    checkPassphrase(passphrase);
    const payload = collect({ includeCards });
    const want = digestOf(payload);
    const text = await seal(payload, passphrase);
    writeAtomic(file, text);
    try {
      const back = await open(fs.readFileSync(file, 'utf8'), passphrase);
      if (digestOf(back) !== want) throw new Error('the file did not decrypt to what was exported');
      const a = counts(payload), b = counts(back);
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('the counts in the file do not match');
    } catch (err) {
      try { fs.rmSync(file, { force: true }); } catch (rmErr) { log('[Lifeboat] could not delete the unverified file: ' + (rmErr.code || 'error')); }
      throw new Error('The export did not verify, so it was deleted (' + err.message + '). Nothing was kept.', { cause: err });
    }
    log('[Lifeboat] exported and verified: ' + JSON.stringify(counts(payload)));
    return { counts: counts(payload), passkeys: payload.passkeys.map(p => ({ rpId: p.rpId, userName: p.userName })), verified: true, bytes: Buffer.byteLength(text) };
  }

  // Decrypts a file in memory and compares it with what Vex holds now. Writes nothing.
  async function verifyFile(file, passphrase) {
    const payload = await open(fs.readFileSync(file, 'utf8'), passphrase);
    return { counts: counts(payload), createdAt: payload.createdAt, live: liveCounts(), passkeys: payload.passkeys.length };
  }
  function liveCounts() {
    const safe = (fn) => { try { return fn(); } catch { return null; } };
    return { passwords: safe(() => vault.load().length), authenticator: safe(() => totp.load().length), cards: safe(() => cards.load().length), passkeys: safe(() => passkeys.list().length) };
  }

  // ---- restore -------------------------------------------------------------
  const readStore = (name, store) => {
    try { return { list: store.load(), unreadable: false }; }
    catch (err) {
      if (isLocked()) throw err;
      if (!files[name]) throw err;
      return { list: [], unreadable: true };
    }
  };

  // What a restore would do, without doing it. -> counts of what would be added / is already there.
  async function plan(file, passphrase) {
    refuseWhileLocked();
    const p = await open(fs.readFileSync(file, 'utf8'), passphrase);
    const v = readStore('vault', vault), t = readStore('totp', totp), c = p.cards ? readStore('cards', cards) : { list: [], unreadable: false };
    const haveV = new Set(v.list.map(e => e.host + '\n' + e.username));
    const haveT = new Set(t.list.map(totpKey));
    const haveC = new Set(c.list.map(x => String(x.number)));
    const out = {
      createdAt: p.createdAt, counts: counts(p),
      passwords: { add: 0, have: 0 }, authenticator: { add: 0, have: 0 }, cards: { add: 0, have: 0, included: !!p.cards },
      unreadable: [v.unreadable && 'passwords', t.unreadable && 'authenticator', c.unreadable && 'cards'].filter(Boolean),
      passkeys: p.passkeys.map(k => ({ rpId: k.rpId, userName: k.userName })),
    };
    for (const e of p.vault.map(cleanLogin).filter(Boolean)) (haveV.has(e.host + '\n' + e.username) ? out.passwords.have++ : out.passwords.add++);
    for (const a of p.totp.map(cleanTotp).filter(Boolean)) (haveT.has(totpKey(a)) ? out.authenticator.have++ : out.authenticator.add++);
    for (const x of p.cards || []) (haveC.has(String(x.number)) ? out.cards.have++ : out.cards.add++);
    return out;
  }

  // Adds what is missing (replace: false), or makes the stores exactly what the file holds (replace: true, which is how
  // "go back to before the restore" uses the safety copy). -> { restored: {...}, kept: {...}, before: { name, counts }|null, setAside: [...], failed: [...] }
  async function restoreFromFile(file, passphrase, { confirmed = false, replace = false } = {}) {
    refuseWhileLocked();
    if (confirmed !== true) throw new Error('A restore has to be confirmed first');
    checkPassphrase(passphrase);
    const p = await open(fs.readFileSync(file, 'utf8'), passphrase);      // a wrong passphrase stops here, nothing touched
    const v = readStore('vault', vault), t = readStore('totp', totp), c = p.cards ? readStore('cards', cards) : { list: [], unreadable: false };

    // 1. the automatic export of what is there now, verified, BEFORE anything changes.
    const live = { v: 1, createdAt: now().toISOString(), vault: v.list.map(cleanLogin).filter(Boolean), totp: t.list.map(cleanTotp).filter(Boolean), cards: p.cards ? c.list.map(x => ({ number: String(x.number), name: x.name || '', nickname: x.nickname || '', expMonth: x.expMonth, expYear: x.expYear, brand: x.brand || '' })) : null, passkeys: [], notExported: {} };
    let before = null;
    if (live.vault.length || live.totp.length || (live.cards && live.cards.length)) {   // nothing there now: nothing to keep
      const name = `secrets-before-restore-${stamp(now())}.vexsecrets`;
      const target = nodePath.join(backupsDir, name);
      const text = await seal(live, passphrase);
      writeAtomic(target, text);
      try {
        const back = await open(fs.readFileSync(target, 'utf8'), passphrase);
        if (digestOf(back) !== digestOf(live)) throw new Error('it did not decrypt to what it should');
      } catch (err) {
        try { fs.rmSync(target, { force: true }); } catch (rmErr) { log('[Lifeboat] could not delete the unverified safety copy: ' + (rmErr.code || 'error')); }
        throw new Error('Vex could not make the safety copy of what you have now, so nothing was restored (' + err.message + ')', { cause: err });
      }
      before = { name, counts: counts(live) };
    }

    // 2. an unreadable store is set aside (never deleted) before it is replaced.
    const setAside = [];
    for (const [name, r] of [['vault', v], ['totp', t], ['cards', c]]) {
      if (!r.unreadable) continue;
      const from = files[name];
      const to = `${from}.unreadable-${stamp(now())}`;
      try { fs.renameSync(from, to); setAside.push(nodePath.basename(to)); }
      catch (err) { if (err.code !== 'ENOENT') throw new Error('Vex could not set the unreadable ' + name + ' store aside (' + (err.code || 'error') + '), so nothing was restored', { cause: err }); }
    }

    // 3. add what is missing; what is already there is left exactly as it is.
    const restored = { passwords: 0, authenticator: 0, cards: 0 };
    const kept = { passwords: 0, authenticator: 0, cards: 0 };
    const failed = [];
    try {
      const have = new Set(replace ? [] : v.list.map(e => e.host + '\n' + e.username));
      const next = replace ? [] : [...v.list];
      for (const e of p.vault.map(cleanLogin).filter(Boolean)) {
        const k = e.host + '\n' + e.username;
        if (have.has(k)) { kept.passwords++; continue; }
        have.add(k); next.push(e); restored.passwords++;
      }
      if (restored.passwords || replace) await vault.save(next);
    } catch (err) { failed.push('passwords (' + err.message + ')'); restored.passwords = 0; }
    try {
      const have = new Set(replace ? [] : t.list.map(totpKey));
      const next = replace ? [] : [...t.list];
      for (const a of p.totp.map(cleanTotp).filter(Boolean)) {
        if (have.has(totpKey(a))) { kept.authenticator++; continue; }
        try { totp.validate(a); } catch { continue; }
        have.add(totpKey(a)); next.push({ ...a, id: randomUUID(), created: now().toISOString() }); restored.authenticator++;
      }
      if (restored.authenticator || replace) await totp.save(next);
    } catch (err) { failed.push('authenticator (' + err.message + ')'); restored.authenticator = 0; }
    if (p.cards) {
      try {
        const have = new Set(replace ? [] : c.list.map(x => String(x.number)));
        const next = replace ? [] : [...c.list];
        for (const x of p.cards) {
          if (have.has(String(x.number))) { kept.cards++; continue; }
          let clean;
          try { clean = cleanCard(x); } catch { continue; }
          have.add(clean.number); next.push({ id: randomUUID(), ...clean, updatedAt: now().toISOString() }); restored.cards++;
        }
        if (restored.cards || replace) await cards.save(next);
      } catch (err) { failed.push('cards (' + err.message + ')'); restored.cards = 0; }
    }
    log('[Lifeboat] restored: ' + JSON.stringify({ restored, kept, failed: failed.length }));
    return { restored, kept, before, setAside, failed, passkeys: p.passkeys.length };
  }

  return { collect, counts, seal, open, exportToFile, verifyFile, plan, restoreFromFile, liveCounts, digestOf };
}

module.exports = { createLifeboat, FORMAT, VERSION, MIN_PASSPHRASE, GENERIC_BAD };
