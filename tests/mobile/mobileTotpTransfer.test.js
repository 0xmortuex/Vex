// @vitest-environment node
//
// 2FA backups and Google Authenticator import on the phone, against the
// desktop's own main/totp-transfer.js: a .vexauth file made on either opens
// on the other, and a transfer QR reads the same on both. scrypt is written
// out on the phone (WebCrypto has none), so it is held to RFC 7914 and to
// Node's own.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

const { VexTotpTransfer } = require('../../mobile/www/js/totp-transfer.js');
const desktop = require('../../src/main/totp-transfer.js');

const ACCOUNTS = [
  { label: 'octo', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha1', digits: 6, period: 30 },
  { label: 'me@example.com', issuer: 'Bank', secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'sha256', digits: 8, period: 30 }
];

describe('scrypt', () => {
  it('matches RFC 7914’s vector', async () => {
    const key = await VexTotpTransfer.scrypt('password', new TextEncoder().encode('NaCl'), { N: 1024, r: 8, p: 16 }, 64);
    expect(Buffer.from(key).toString('hex')).toBe('fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640');
  });

  it('matches Node’s at the backup’s own settings', async () => {
    const salt = crypto.randomBytes(16);
    const mine = await VexTotpTransfer.scrypt('correct horse', new Uint8Array(salt), { N: 32768, r: 8, p: 1 });
    const node = crypto.scryptSync('correct horse', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 32768 * 8 * 2 });
    expect(Buffer.from(mine).toString('hex')).toBe(node.toString('hex'));
  }, 30000);
});

describe('the backup file', () => {
  it('a backup made on the computer opens on the phone', async () => {
    const text = await desktop.encryptBackup(ACCOUNTS, 'a long passphrase');
    expect(await VexTotpTransfer.decryptBackup(text, 'a long passphrase')).toEqual(ACCOUNTS);
  }, 30000);

  it('a backup made on the phone opens on the computer, and a wrong passphrase reads nothing', async () => {
    const text = await VexTotpTransfer.encryptBackup(ACCOUNTS, 'a long passphrase');
    expect(JSON.parse(text).format).toBe('vex-authenticator-backup');
    expect(await desktop.decryptBackup(text, 'a long passphrase')).toEqual(ACCOUNTS);
    await expect(VexTotpTransfer.decryptBackup(text, 'the wrong one!')).rejects.toThrow(/Wrong passphrase/);
    await expect(VexTotpTransfer.encryptBackup(ACCOUNTS, 'short')).rejects.toThrow(/at least 8/);
    await expect(VexTotpTransfer.decryptBackup('{"format":"nope"}', 'whatever!')).rejects.toThrow(/not a Vex authenticator backup/);
  }, 60000);
});

describe('Google Authenticator’s transfer QR', () => {
  // A MigrationPayload, built by hand: field 1 = OtpParameters
  // { 1 secret, 2 name, 3 issuer, 4 algorithm, 5 digits, 6 type }.
  const varint = n => { const out = []; while (n > 127) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); return out; };
  const field = (number, bytes) => [...varint(number * 8 + 2), ...varint(bytes.length), ...bytes];
  const num = (number, value) => [...varint(number * 8), ...varint(value)];
  const text = value => [...Buffer.from(value, 'utf8')];
  const otp = ({ secret, name, issuer, alg = 1, digits = 1, type = 2 }) =>
    [...field(1, [...secret]), ...field(2, text(name)), ...field(3, text(issuer)), ...num(4, alg), ...num(5, digits), ...num(6, type)];
  const link = parts => 'otpauth-migration://offline?data=' + encodeURIComponent(Buffer.from(parts.flatMap(part => field(1, part))).toString('base64'));

  it('reads every TOTP account, as the computer does, and leaves out the counter-based ones', () => {
    const uri = link([
      otp({ secret: Buffer.from('Hello!\xde\xad\xbe\xef', 'latin1'), name: 'GitHub:octo', issuer: '' }),
      otp({ secret: Buffer.from('12345678901234567890'), name: 'me@bank', issuer: 'Bank', alg: 2, digits: 2 }),
      otp({ secret: Buffer.from('counter'), name: 'old', issuer: 'HOTP', type: 1 })
    ]);
    const mine = VexTotpTransfer.parseMigration(uri);
    expect(mine).toEqual(desktop.parseMigration(uri));
    expect(mine.skipped).toBe(1);
    expect(mine.accounts[0]).toMatchObject({ label: 'octo', issuer: 'GitHub', algorithm: 'sha1', digits: 6 });
    expect(mine.accounts[1]).toMatchObject({ label: 'me@bank', issuer: 'Bank', algorithm: 'sha256', digits: 8, secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });
  });

  it('says what is wrong with a link that is not one', () => {
    expect(() => VexTotpTransfer.parseMigration('https://example.com/')).toThrow(/not a Google Authenticator export link/);
    expect(() => VexTotpTransfer.parseMigration('otpauth-migration://offline')).toThrow(/no accounts/);
  });
});
