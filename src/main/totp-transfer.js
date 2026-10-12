// === Authenticator: backup, restore, and Google Authenticator import =======
//
// Backup: every account (with its secret) in one file, encrypted with a
// passphrase the person chooses: scrypt (N 2^15, r 8, p 1) makes the key,
// AES-256-GCM seals the data. Without the passphrase the file is useless;
// with a wrong one the GCM tag fails and nothing is read. Written by main
// after the person picks where; the secrets never reach the window.
//
// Google Authenticator's "Transfer accounts" QR holds an
// otpauth-migration://offline?data=<base64 protobuf> link with many accounts
// at once (MigrationPayload, field 1 = repeated OtpParameters). Only TOTP
// accounts are taken; HOTP (counter) ones are counted and left out, as Vex's
// authenticator is TOTP only.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT = 'vex-authenticator-backup';
const KDF = { name: 'scrypt', N: 32768, r: 8, p: 1 };
const MIN_PASSPHRASE = 8;

function scrypt(passphrase, salt, { N, r, p }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(passphrase), salt, 32, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function encryptBackup(accounts, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters`);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await scrypt(passphrase, salt, KDF);
  const plain = JSON.stringify({ accounts: accounts.map(a => ({ label: a.label, issuer: a.issuer, secret: a.secret, algorithm: a.algorithm, digits: a.digits, period: a.period })) });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return JSON.stringify({
    format: FORMAT, version: 1,
    kdf: { ...KDF, salt: salt.toString('base64') },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    data: data.toString('base64'),
  }, null, 1);
}

async function decryptBackup(text, passphrase) {
  let file;
  try { file = JSON.parse(String(text)); } catch { throw new Error('That file is not a Vex authenticator backup'); }
  if (!file || file.format !== FORMAT || file.version !== 1 || !file.kdf || !file.cipher || typeof file.data !== 'string') throw new Error('That file is not a Vex authenticator backup');
  const { N, r, p } = file.kdf;
  if (file.kdf.name !== 'scrypt' || ![N, r, p].every(Number.isInteger) || N > 1 << 20 || r > 16 || p > 4) throw new Error('That backup uses settings Vex does not read');
  const key = await scrypt(passphrase, Buffer.from(file.kdf.salt, 'base64'), { N, r, p });
  let plain;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.cipher.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(file.cipher.tag, 'base64'));
    plain = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new Error('Wrong passphrase, or the file was changed'); }
  const parsed = JSON.parse(plain);
  if (!parsed || !Array.isArray(parsed.accounts)) throw new Error('That backup holds no accounts');
  return parsed.accounts;
}

// --- protobuf, just enough for MigrationPayload ---
function readVarint(buf, pos) {
  let result = 0, shift = 0, byte;
  do {
    if (pos >= buf.length) throw new Error('truncated');
    byte = buf[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (shift > 63) throw new Error('varint too long');
  } while (byte & 0x80);
  return [result, pos];
}
// -> Map(fieldNumber -> [values]); length-delimited values are Buffers.
function readMessage(buf) {
  const fields = new Map();
  let pos = 0;
  while (pos < buf.length) {
    let tag; [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8), wire = tag & 7;
    let value;
    if (wire === 0) [value, pos] = readVarint(buf, pos);
    else if (wire === 2) { let len; [len, pos] = readVarint(buf, pos); if (pos + len > buf.length) throw new Error('truncated'); value = buf.subarray(pos, pos + len); pos += len; }
    else if (wire === 1) { pos += 8; continue; }
    else if (wire === 5) { pos += 4; continue; }
    else throw new Error('unsupported wire type');
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  return fields;
}

function base32(buf) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

// -> { accounts: [{ label, issuer, secret, algorithm, digits, period }], skipped }
function parseMigration(uri) {
  let u;
  try { u = new URL(String(uri).trim()); } catch { throw new Error('That is not a Google Authenticator export link'); }
  if (u.protocol !== 'otpauth-migration:') throw new Error('That is not a Google Authenticator export link');
  const data = u.searchParams.get('data');
  if (!data) throw new Error('The export link has no accounts in it');
  let payload;
  try { payload = readMessage(Buffer.from(data.replace(/ /g, '+'), 'base64')); }
  catch { throw new Error('The export link is damaged; scan the QR code again'); }
  const ALG = { 0: 'sha1', 1: 'sha1', 2: 'sha256', 3: 'sha512' };
  const accounts = [];
  let skipped = 0;
  for (const raw of payload.get(1) || []) {
    let f;
    try { f = readMessage(raw); } catch { skipped++; continue; }
    const one = (n) => (f.get(n) || [])[0];
    const secret = one(1), type = one(6) || 0, alg = one(4) || 0, digits = one(5) || 0;
    if (!secret || !secret.length || type === 1 || !(alg in ALG)) { skipped++; continue; }   // HOTP, MD5, or empty
    let label = one(2) ? one(2).toString('utf8') : '';
    let issuer = one(3) ? one(3).toString('utf8') : '';
    if (label.includes(':')) { const [head, ...rest] = label.split(':'); if (!issuer) issuer = head.trim(); label = rest.join(':').trim(); }
    accounts.push({ label: label || issuer || 'Account', issuer, secret: base32(secret), algorithm: ALG[alg], digits: digits === 2 ? 8 : 6, period: 30 });
  }
  return { accounts, skipped };
}

// load() / save(arr): the encrypted authenticator store in main.js.
// validate(entry): throws on a key no code can be made from.
function registerTotpTransfer({ ipcMain, dialog, app, windowFor, load, save, validate, isLocked }) {
  const refuseWhileLocked = () => { if (isLocked()) throw new Error('Vex is locked — unlock it first'); };
  const key = (a) => String(a.secret || '').replace(/\s/g, '').replace(/=+$/, '').toUpperCase();

  // Adds what is not there yet (same secret = same account).
  async function addAccounts(list) {
    const arr = load();
    const have = new Set(arr.map(key));
    let added = 0, duplicates = 0, invalid = 0;
    for (const a of list) {
      const entry = {
        label: String(a.label || '').slice(0, 4096) || 'Account', issuer: String(a.issuer || '').slice(0, 4096),
        secret: String(a.secret || '').replace(/\s/g, ''), algorithm: a.algorithm, digits: a.digits, period: a.period,
      };
      try { validate(entry); } catch { invalid++; continue; }
      if (have.has(key(entry))) { duplicates++; continue; }
      have.add(key(entry));
      arr.push({ ...entry, id: crypto.randomUUID(), created: new Date().toISOString() });
      added++;
    }
    if (added) await save(arr);
    return { added, duplicates, invalid };
  }

  ipcMain.handle('totp:import-migration', async (_e, uri) => {
    refuseWhileLocked();
    const { accounts, skipped } = parseMigration(uri);
    if (!accounts.length) throw new Error(skipped ? 'The export holds only counter-based (HOTP) accounts, which Vex does not support' : 'The export link has no accounts in it');
    return { ...(await addAccounts(accounts)), skipped };
  });

  // The name and account shown for one authenticator entry (imports often
  // arrive as "Account"). The secret is never touched.
  ipcMain.handle('totp:rename', async (_e, id, issuer, label) => {
    refuseWhileLocked();
    const arr = load();
    const entry = arr.find(a => a.id === id);
    if (!entry) return { ok: false, error: 'That account is no longer in the Authenticator' };
    const i = String(issuer || '').trim().slice(0, 4096), l = String(label || '').trim().slice(0, 4096);
    if (!i && !l) return { ok: false, error: 'Give it a name' };
    entry.issuer = i;
    entry.label = l || i;
    await save(arr);
    return { ok: true };
  });

  ipcMain.handle('totp:export-backup', async (e, passphrase) => {
    refuseWhileLocked();
    const arr = load();
    if (!arr.length) return { ok: false, error: 'There are no authenticator accounts to back up' };
    const text = await encryptBackup(arr, passphrase);
    const win = windowFor(e);
    const opts = { title: 'Save authenticator backup', defaultPath: path.join(app.getPath('documents'), 'Vex Authenticator backup.vexauth'), filters: [{ name: 'Vex authenticator backup', extensions: ['vexauth'] }] };
    const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(picked.filePath, text, 'utf8');
    return { ok: true, count: arr.length, path: picked.filePath };
  });

  ipcMain.handle('totp:import-backup', async (e, passphrase) => {
    refuseWhileLocked();
    const win = windowFor(e);
    const opts = { title: 'Restore authenticator backup', filters: [{ name: 'Vex authenticator backup', extensions: ['vexauth'] }], properties: ['openFile'] };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) return { ok: false, canceled: true };
    const file = picked.filePaths[0];
    if ((await fs.promises.stat(file)).size > 5 * 1024 * 1024) throw new Error('That file is too large to be an authenticator backup');
    const accounts = await decryptBackup(await fs.promises.readFile(file, 'utf8'), passphrase);
    return { ok: true, ...(await addAccounts(accounts)) };
  });
  return { addAccounts };
}

module.exports = { encryptBackup, decryptBackup, parseMigration, base32, registerTotpTransfer, MIN_PASSPHRASE };
