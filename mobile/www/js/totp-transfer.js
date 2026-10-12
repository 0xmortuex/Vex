// === Vex Mobile — 2FA codes: backup, restore, Google Authenticator import ===
//
// The desktop's main/totp-transfer.js, on the phone, file for file:
//
//   Backup   every account with its secret, in one file locked with a
//            passphrase: scrypt (N 2^15, r 8, p 1) makes the key, AES-256-GCM
//            seals the data. A .vexauth file from the computer opens here and
//            one made here opens there. Without the passphrase it is useless;
//            with a wrong one the GCM tag fails and nothing is read.
//
//   Import   Google Authenticator's "Transfer accounts" QR code, an
//            otpauth-migration://offline?data=<base64 protobuf> link with many
//            accounts at once. Only TOTP accounts are taken; counter-based
//            (HOTP) ones are counted and left out, as on the desktop.
//
// WebCrypto has PBKDF2 and AES-GCM but no scrypt, so scrypt's own part (the
// memory-hard mixing, RFC 7914) is written out here; PBKDF2 does the rest.

const VexTotpTransfer = (() => {
  const FORMAT = 'vex-authenticator-backup';
  const KDF = { name: 'scrypt', N: 32768, r: 8, p: 1 };
  const MIN_PASSPHRASE = 8;

  const utf8 = text => new TextEncoder().encode(text);
  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  function fromBase64(text) {
    const binary = atob(String(text).replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  const random = length => crypto.getRandomValues(new Uint8Array(length));

  // ── scrypt (RFC 7914) ────────────────────────────────────────────────────
  async function pbkdf2(password, salt, length) {
    const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, key, length * 8));
  }

  // Salsa20/8 on 16 words, in place.
  function salsa8(B, x) {
    for (let i = 0; i < 16; i++) x[i] = B[i];
    const R = (a, b) => (a << b) | (a >>> (32 - b));
    for (let i = 0; i < 8; i += 2) {
      x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
      x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
      x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
      x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
      x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
      x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
      x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
      x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
    }
    for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
  }

  // BlockMix: B (2r blocks of 16 words) → Y, using X as scratch.
  function blockMix(B, Y, r, X, x) {
    X.set(B.subarray((2 * r - 1) * 16, 2 * r * 16));
    for (let i = 0; i < 2 * r; i++) {
      for (let j = 0; j < 16; j++) X[j] ^= B[i * 16 + j];
      salsa8(X, x);
      Y.set(X, (i % 2 === 0 ? i / 2 : r + (i - 1) / 2) * 16);
    }
  }

  function romix(block, N, r) {
    const words = 32 * r;
    const X = new Uint32Array(words);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    for (let i = 0; i < words; i++) X[i] = view.getUint32(i * 4, true);
    const V = new Uint32Array(words * N);
    const Y = new Uint32Array(words);
    const T = new Uint32Array(16);
    const x = new Uint32Array(16);
    for (let i = 0; i < N; i++) {
      V.set(X, i * words);
      blockMix(X, Y, r, T, x);
      X.set(Y);
    }
    for (let i = 0; i < N; i++) {
      const j = X[(2 * r - 1) * 16] & (N - 1);
      for (let k = 0; k < words; k++) X[k] ^= V[j * words + k];
      blockMix(X, Y, r, T, x);
      X.set(Y);
    }
    for (let i = 0; i < words; i++) view.setUint32(i * 4, X[i], true);
  }

  /** scrypt(password, salt, N, r, p, 32 bytes): the key a backup is locked with. */
  async function scrypt(password, salt, { N, r, p }, length = 32) {
    const pass = typeof password === 'string' ? utf8(password) : password;
    const B = await pbkdf2(pass, salt, p * 128 * r);
    for (let i = 0; i < p; i++) romix(B.subarray(i * 128 * r, (i + 1) * 128 * r), N, r);
    return pbkdf2(pass, B, length);
  }

  // ── The backup file ──────────────────────────────────────────────────────
  async function aesKey(raw) {
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  /** accounts: [{ label, issuer, secret, algorithm, digits, period }] → the .vexauth text. */
  async function encryptBackup(accounts, passphrase) {
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) throw new Error('Use a passphrase of at least ' + MIN_PASSPHRASE + ' characters');
    const salt = random(16);
    const iv = random(12);
    const key = await aesKey(await scrypt(passphrase, salt, KDF));
    const plain = JSON.stringify({ accounts: accounts.map(a => ({ label: a.label, issuer: a.issuer, secret: a.secret, algorithm: a.algorithm, digits: a.digits, period: a.period })) });
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(plain)));
    return JSON.stringify({
      format: FORMAT, version: 1,
      kdf: { ...KDF, salt: toBase64(salt) },
      cipher: { name: 'aes-256-gcm', iv: toBase64(iv), tag: toBase64(sealed.subarray(sealed.length - 16)) },
      data: toBase64(sealed.subarray(0, sealed.length - 16))
    }, null, 1);
  }

  async function decryptBackup(text, passphrase) {
    let file;
    try { file = JSON.parse(String(text)); } catch { throw new Error('That file is not a Vex authenticator backup'); }
    if (!file || file.format !== FORMAT || file.version !== 1 || !file.kdf || !file.cipher || typeof file.data !== 'string') throw new Error('That file is not a Vex authenticator backup');
    const { N, r, p } = file.kdf;
    if (file.kdf.name !== 'scrypt' || ![N, r, p].every(Number.isInteger) || N > 1 << 20 || r > 16 || p > 4 || (N & (N - 1)) !== 0) throw new Error('That backup uses settings Vex does not read');
    const key = await aesKey(await scrypt(String(passphrase || ''), fromBase64(file.kdf.salt), { N, r, p }));
    let plain;
    try {
      const data = fromBase64(file.data);
      const tag = fromBase64(file.cipher.tag);
      const joined = new Uint8Array(data.length + tag.length);
      joined.set(data); joined.set(tag, data.length);
      plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(file.cipher.iv) }, key, joined));
    } catch { throw new Error('Wrong passphrase, or the file was changed'); }
    const parsed = JSON.parse(plain);
    if (!parsed || !Array.isArray(parsed.accounts)) throw new Error('That backup holds no accounts');
    return parsed.accounts;
  }

  // ── Google Authenticator's transfer QR ───────────────────────────────────
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
  function readMessage(buf) {
    const fields = new Map();
    let pos = 0;
    while (pos < buf.length) {
      let tag;
      [tag, pos] = readVarint(buf, pos);
      const field = Math.floor(tag / 8), wire = tag & 7;
      let value;
      if (wire === 0) [value, pos] = readVarint(buf, pos);
      else if (wire === 2) {
        let len;
        [len, pos] = readVarint(buf, pos);
        if (pos + len > buf.length) throw new Error('truncated');
        value = buf.subarray(pos, pos + len);
        pos += len;
      } else if (wire === 1) { pos += 8; continue; }
      else if (wire === 5) { pos += 4; continue; }
      else throw new Error('unsupported wire type');
      if (!fields.has(field)) fields.set(field, []);
      fields.get(field).push(value);
    }
    return fields;
  }
  function base32(bytes) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, value = 0, out = '';
    for (const byte of bytes) {
      value = (value << 8) | byte; bits += 8;
      while (bits >= 5) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += A[(value << (5 - bits)) & 31];
    return out;
  }

  /** → { accounts: [{ label, issuer, secret, algorithm, digits, period }], skipped } */
  function parseMigration(uri) {
    let u;
    try { u = new URL(String(uri).trim()); } catch { throw new Error('That is not a Google Authenticator export link'); }
    if (u.protocol !== 'otpauth-migration:') throw new Error('That is not a Google Authenticator export link');
    const data = u.searchParams.get('data');
    if (!data) throw new Error('The export link has no accounts in it');
    let payload;
    try { payload = readMessage(fromBase64(data)); }
    catch { throw new Error('The export link is damaged; scan the QR code again'); }
    const ALG = { 0: 'sha1', 1: 'sha1', 2: 'sha256', 3: 'sha512' };
    const decode = bytes => new TextDecoder().decode(bytes);
    const accounts = [];
    let skipped = 0;
    for (const raw of payload.get(1) || []) {
      let f;
      try { f = readMessage(raw); } catch { skipped++; continue; }
      const one = n => (f.get(n) || [])[0];
      const secret = one(1), type = one(6) || 0, alg = one(4) || 0, digits = one(5) || 0;
      if (!secret || !secret.length || type === 1 || !(alg in ALG)) { skipped++; continue; }
      let label = one(2) ? decode(one(2)) : '';
      let issuer = one(3) ? decode(one(3)) : '';
      if (label.includes(':')) { const [head, ...rest] = label.split(':'); if (!issuer) issuer = head.trim(); label = rest.join(':').trim(); }
      accounts.push({ label: label || issuer || 'Account', issuer, secret: base32(secret), algorithm: ALG[alg], digits: digits === 2 ? 8 : 6, period: 30 });
    }
    return { accounts, skipped };
  }

  return { FORMAT, KDF, MIN_PASSPHRASE, scrypt, encryptBackup, decryptBackup, parseMigration, base32 };
})();

if (typeof window !== 'undefined') window.VexTotpTransfer = VexTotpTransfer;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTotpTransfer };
