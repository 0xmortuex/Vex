// T3-123: a PIN or passphrase stored with scrypt, made and checked by the main process. The old
// PBKDF2 records keep working (tests/main/lockPin.test.js).
import { describe, it, expect } from 'vitest';
const { createLockGate, parseRecord, makeScryptRecord, secretShapeOk, SCRYPT_DEFAULT, PASSPHRASE_MIN, PASSPHRASE_MAX } = require('../../src/main/lock-pin.js');

describe('scrypt records', () => {
  it('makes a record that names its own cost and does not contain the secret', async () => {
    const rec = await makeScryptRecord('correct horse battery');
    expect(rec).toMatchObject({ kdf: 'scrypt', N: SCRYPT_DEFAULT.N, r: SCRYPT_DEFAULT.r, p: SCRYPT_DEFAULT.p });
    expect(JSON.stringify(rec)).not.toContain('correct horse');
    expect(Buffer.from(rec.salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(rec.hash, 'base64')).toHaveLength(32);
    expect(parseRecord(JSON.stringify(rec))).toMatchObject({ kdf: 'scrypt' });
  });
  it('salts: the same secret gives a different record each time', async () => {
    const a = await makeScryptRecord('1234'), b = await makeScryptRecord('1234');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
  it('refuses secrets that are neither a PIN nor a passphrase', async () => {
    for (const s of ['123', '1'.repeat(13), 'short', 'x'.repeat(PASSPHRASE_MAX + 1), '', 4821, null]) {
      await expect(makeScryptRecord(s), String(s)).rejects.toThrow();
    }
    expect(PASSPHRASE_MIN).toBe(8);
  });
  it('refuses a stored record with a cost that is out of bounds, or an unknown kdf', () => {
    const base = { salt: 'AAAA', hash: 'AAAA', kdf: 'scrypt', N: 32768, r: 8, p: 1 };
    expect(() => parseRecord(JSON.stringify(base))).not.toThrow();
    for (const bad of [{ N: 3 }, { N: 2 ** 30 }, { N: 20000 }, { r: 1 }, { r: 64 }, { p: 0 }, { p: 99 }, { kdf: 'md5' }]) {
      expect(() => parseRecord(JSON.stringify({ ...base, ...bad })), JSON.stringify(bad)).toThrow(/cannot be read/);
    }
  });
  it('shapes: a PBKDF2 record takes only digits, a scrypt record also a passphrase', () => {
    expect(secretShapeOk({ salt: 'a', hash: 'b' }, '4821')).toBe(true);
    expect(secretShapeOk({ salt: 'a', hash: 'b' }, 'a long passphrase')).toBe(false);
    expect(secretShapeOk({ kdf: 'scrypt' }, 'a long passphrase')).toBe(true);
    expect(secretShapeOk({ kdf: 'scrypt' }, 'short')).toBe(false);
  });
});

describe('the gate with a scrypt record', () => {
  it('opens for the right passphrase and PIN, refuses wrong ones', async () => {
    const pass = JSON.stringify(await makeScryptRecord('my long passphrase'));
    const gate = createLockGate({ readRecord: () => pass });
    expect(await gate.tryUnlock('my long passphrasf')).toEqual({ ok: false, error: 'Wrong PIN' });
    expect(await gate.tryUnlock('1234')).toEqual({ ok: false, error: 'Wrong PIN' });
    expect(await gate.tryUnlock('my long passphrase')).toEqual({ ok: true });
    const pin = JSON.stringify(await makeScryptRecord('4821'));
    const g2 = createLockGate({ readRecord: () => pin });
    expect(await g2.tryUnlock('4821')).toEqual({ ok: true });
  });
  it('five wrong passphrases in a row make it wait, even for the right one', async () => {
    const rec = JSON.stringify(await makeScryptRecord('my long passphrase'));
    let t = 1e6;
    const gate = createLockGate({ readRecord: () => rec, now: () => t });
    for (let i = 0; i < 4; i++) expect((await gate.tryUnlock('wrong wrong wrong')).error).toBe('Wrong PIN');
    expect((await gate.tryUnlock('wrong wrong wrong')).error).toMatch(/Too many tries/);
    expect((await gate.tryUnlock('my long passphrase')).error).toMatch(/Too many tries/);
    t += 30001;
    expect(await gate.tryUnlock('my long passphrase')).toEqual({ ok: true });
  }, 60000);
  it('a too-long or non-string secret is refused before the record is read', async () => {
    const gate = createLockGate({ readRecord: () => { throw new Error('must not be read'); } });
    for (const s of ['x'.repeat(PASSPHRASE_MAX + 1), 12345678, undefined]) expect((await gate.tryUnlock(s)).ok).toBe(false);
  });
});
