// @vitest-environment node
// Authenticator backup (passphrase, scrypt + AES-256-GCM), restore, and
// Google Authenticator's otpauth-migration:// export (src/main/totp-transfer.js).
import { describe, it, expect, beforeEach } from 'vitest';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { encryptBackup, decryptBackup, parseMigration, base32, registerTotpTransfer } = require('../../src/main/totp-transfer.js');

// --- a tiny protobuf writer, to build Google's payload the way the app does ---
const varint = (n) => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); };
const field = (num, wire, value) => Buffer.concat([varint(num * 8 + wire), wire === 2 ? Buffer.concat([varint(value.length), value]) : varint(value)]);
const otp = ({ secret, name, issuer, alg = 1, digits = 1, type = 2 }) => Buffer.concat([
  field(1, 2, Buffer.from(secret)), field(2, 2, Buffer.from(name)), field(3, 2, Buffer.from(issuer)),
  field(4, 0, alg), field(5, 0, digits), field(6, 0, type),
]);
const migration = (...accounts) => 'otpauth-migration://offline?data=' + encodeURIComponent(
  Buffer.concat([...accounts.map(a => field(1, 2, otp(a))), field(2, 0, 1), field(3, 0, 1), field(4, 0, 0)]).toString('base64'));

describe('Google Authenticator export', () => {
  it('reads every TOTP account, with issuer, label, algorithm and digits', () => {
    const r = parseMigration(migration(
      { secret: 'Hello!\xde\xad\xbe\xef', name: 'GitHub:octo', issuer: '' },
      { secret: '12345678901234567890', name: 'me@example.com', issuer: 'Example', alg: 2, digits: 2 },
      { secret: 'counter', name: 'old', issuer: 'HOTP Co', type: 1 },
    ));
    expect(r.skipped).toBe(1);
    expect(r.accounts).toEqual([
      { label: 'octo', issuer: 'GitHub', secret: base32(Buffer.from('Hello!\xde\xad\xbe\xef')), algorithm: 'sha1', digits: 6, period: 30 },
      { label: 'me@example.com', issuer: 'Example', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algorithm: 'sha256', digits: 8, period: 30 },
    ]);
  });
  it('base32 matches RFC 4648', () => {
    expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32(Buffer.from('f'))).toBe('MY');
  });
  it('says plainly when the link is not one, or is damaged', () => {
    expect(() => parseMigration('otpauth://totp/x?secret=AAAA')).toThrow(/not a Google Authenticator export link/);
    expect(() => parseMigration('otpauth-migration://offline?data=' + Buffer.from([0x0a, 0x50, 0x01]).toString('base64'))).toThrow(/damaged/);
  });
});

describe('backup file', () => {
  const accounts = [{ id: 'x', label: 'octo', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha1', digits: 6, period: 30, created: 'c' }];
  it('round-trips with the passphrase, and holds no secret in the clear', async () => {
    const text = await encryptBackup(accounts, 'correct horse');
    expect(text).not.toContain('JBSWY3DPEHPK3PXP');
    expect(text).not.toContain('octo');
    expect(JSON.parse(text)).toMatchObject({ format: 'vex-authenticator-backup', version: 1, kdf: { name: 'scrypt', N: 32768, r: 8, p: 1 }, cipher: { name: 'aes-256-gcm' } });
    expect(await decryptBackup(text, 'correct horse')).toEqual([{ label: 'octo', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha1', digits: 6, period: 30 }]);
  });
  it('refuses a wrong passphrase, a changed file, a short passphrase and other files', async () => {
    const text = await encryptBackup(accounts, 'correct horse');
    await expect(decryptBackup(text, 'wrong horse!')).rejects.toThrow('Wrong passphrase, or the file was changed');
    const f = JSON.parse(text); f.data = Buffer.from('x' + Buffer.from(f.data, 'base64').toString('binary'), 'binary').toString('base64');
    await expect(decryptBackup(JSON.stringify(f), 'correct horse')).rejects.toThrow('Wrong passphrase, or the file was changed');
    await expect(encryptBackup(accounts, 'short')).rejects.toThrow(/at least 8/);
    await expect(decryptBackup('{"hello":1}', 'correct horse')).rejects.toThrow(/not a Vex authenticator backup/);
  });
});

describe('IPC', () => {
  let dir, handlers, store, saved, locked, nextPick;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-totp-transfer-'));
    handlers = {}; saved = 0; locked = false;
    store = [{ id: 'a', label: 'octo', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha1', digits: 6, period: 30 }];
    const dialog = {
      showSaveDialog: async () => ({ canceled: false, filePath: path.join(dir, 'b.vexauth') }),
      showOpenDialog: async () => nextPick,
    };
    registerTotpTransfer({
      ipcMain: { handle: (c, fn) => { handlers[c] = fn; } }, dialog, app: { getPath: () => dir }, windowFor: () => ({}),
      load: () => structuredClone(store), save: async (arr) => { store = arr; saved++; },
      validate: (e) => { if (!/^[A-Z2-7]+$/i.test(e.secret)) throw new Error('Invalid secret'); }, isLocked: () => locked,
    });
  });
  const call = (c, ...a) => handlers[c]({ sender: {} }, ...a);

  it('backs up to the picked file and restores into a fresh store, skipping what is there', async () => {
    expect(await call('totp:export-backup', 'correct horse')).toEqual({ ok: true, count: 1, path: path.join(dir, 'b.vexauth') });
    nextPick = { canceled: false, filePaths: [path.join(dir, 'b.vexauth')] };
    expect(await call('totp:import-backup', 'correct horse')).toEqual({ ok: true, added: 0, duplicates: 1, invalid: 0 });
    store = [];
    expect(await call('totp:import-backup', 'correct horse')).toEqual({ ok: true, added: 1, duplicates: 0, invalid: 0 });
    expect(store[0]).toMatchObject({ label: 'octo', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' });
    expect(store[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(call('totp:import-backup', 'not the one')).rejects.toThrow('Wrong passphrase');
  });

  it('imports a Google export, adding only new accounts', async () => {
    const r = await call('totp:import-migration', migration(
      { secret: 'Hello!\xde\xad\xbe\xef', name: 'GitHub:octo', issuer: '' },
      { secret: 'Hello!\xde\xad\xbe\xef', name: 'dup', issuer: 'Dup' },
    ));
    expect(r).toEqual({ added: 1, duplicates: 1, invalid: 0, skipped: 0 });
    expect(store.map(a => a.issuer)).toEqual(['GitHub', 'GitHub']);
  });

  it('refuses everything while Vex is locked', async () => {
    locked = true;
    await expect(call('totp:export-backup', 'correct horse')).rejects.toThrow(/locked/);
    await expect(call('totp:import-backup', 'correct horse')).rejects.toThrow(/locked/);
    await expect(call('totp:import-migration', migration({ secret: 'abc', name: 'n', issuer: 'i' }))).rejects.toThrow(/locked/);
    expect(saved).toBe(0);
  });

  it('is wired into main.js with the real store and key check', () => {
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toContain("load: totpLoad, save: totpSave, validate: (entry) => _totpCode(entry.secret, entry), isLocked: () => _vexLocked });");
  });
});
