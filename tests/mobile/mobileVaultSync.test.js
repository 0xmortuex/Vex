// @vitest-environment jsdom
//
// The two features that would be worst to get subtly wrong: the vault (a
// password manager that fills the wrong field, or a 2FA code that is off by
// one time step, is worse than none) and sync (a record format that drifts
// from the desktop's means two devices that quietly cannot read each other).
//
// The sync half runs the desktop's own copied files, so a drift shows up here
// rather than on a phone.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

// jsdom's window.crypto has no subtle, and is a getter — define over it.
if (!window.crypto || !window.crypto.subtle) {
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
}
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const store = {};
const secrets = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexBridge = {
  vaultGet: async key => secrets[key] || '',
  vaultSet: async (key, value) => { secrets[key] = value; },
  authenticate: vi.fn(async () => ({ ok: true })),
  evaluate: vi.fn(async () => ({ result: '"filled"' }))
};
window.VexSearch = { prettyHost: url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } } };
window.VexCollections = { id: prefix => prefix + Math.random().toString(36).slice(2, 8) };

const { VexVault } = require('../../mobile/www/js/vault.js');
require('../../mobile/www/js/shared/sync-crypto.js');
const records = require('../../mobile/www/js/shared/sync-records.js');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(secrets)) delete secrets[key];
  VexVault.lock();
  window.VexBridge.authenticate.mockClear();
});

describe('two-factor codes', () => {
  // RFC 6238's own vectors, SHA-1, secret "12345678901234567890".
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('matches the RFC at every published time step', async () => {
    expect(await VexVault.totp(SECRET, { digits: 8, at: 59000 })).toBe('94287082');
    expect(await VexVault.totp(SECRET, { digits: 8, at: 1111111109000 })).toBe('07081804');
    expect(await VexVault.totp(SECRET, { digits: 8, at: 1111111111000 })).toBe('14050471');
    expect(await VexVault.totp(SECRET, { digits: 8, at: 1234567890000 })).toBe('89005924');
  });

  it('gives six digits by default, and the same ones inside a step', async () => {
    // 1700000010 is exactly on a 30-second boundary, so both of these are the
    // same step — a test that straddles one proves nothing.
    const first = await VexVault.totp(SECRET, { at: 1700000010000 });
    const second = await VexVault.totp(SECRET, { at: 1700000039000 });
    expect(first).toMatch(/^\d{6}$/);
    expect(second).toBe(first);
  });

  it('changes at the step boundary', async () => {
    const before = await VexVault.totp(SECRET, { at: 1700000039000 });
    const after = await VexVault.totp(SECRET, { at: 1700000040000 });
    expect(after).not.toBe(before);
  });

  it('decodes base32 the way authenticator apps write it', () => {
    expect([...VexVault.base32Decode('JBSWY3DP')]).toEqual([72, 101, 108, 108, 111]);   // "Hello"
    expect([...VexVault.base32Decode('jbswy3dp  ')]).toEqual([72, 101, 108, 108, 111]);
  });

  it('refuses a secret that is not one', async () => {
    await expect(VexVault.totp('!!!!')).rejects.toThrow(/2FA secret/);
  });

  it('reads an otpauth:// enrolment URI', () => {
    const parsed = VexVault.parseOtpAuth('otpauth://totp/GitHub:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6');
    expect(parsed).toMatchObject({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'GitHub', account: 'me@example.com', digits: 6 });
    expect(VexVault.parseOtpAuth('https://example.com')).toBe(null);
  });
});

describe('making a password up', () => {
  it('is the length asked for, inside sane bounds', () => {
    expect(VexVault.makePassword().length).toBe(20);
    expect(VexVault.makePassword({ length: 32 }).length).toBe(32);
    // Nothing shorter than 8 and nothing longer than 64, whatever is asked.
    expect(VexVault.makePassword({ length: 2 }).length).toBe(8);
    expect(VexVault.makePassword({ length: 500 }).length).toBe(64);
  });

  it('carries one of each class that was asked for, so a site cannot refuse it', () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const made = VexVault.makePassword({ length: 12 });
      expect(made).toMatch(/[a-z]/);
      expect(made).toMatch(/[A-Z]/);
      expect(made).toMatch(/[0-9]/);
      expect(made).toMatch(/[!#$%&*+\-=?@^_~]/);
    }
  });

  it('leaves out a class that was not asked for', () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const made = VexVault.makePassword({ length: 16, symbols: false, digits: false, upper: false });
      expect(made).toMatch(/^[a-z]+$/);
    }
  });

  it('never uses the characters nobody can read apart', () => {
    const made = VexVault.makePassword({ length: 64 });
    expect(made).not.toMatch(/[lIO01]/);
  });

  it('does not repeat itself', () => {
    const seen = new Set();
    for (let attempt = 0; attempt < 50; attempt++) seen.add(VexVault.makePassword());
    expect(seen.size).toBe(50);
  });

  it('does not favour the front of the alphabet', () => {
    // A modulo without rejection sampling leans on the first few characters.
    // Over ten thousand draws the first and last thirds should be close.
    const counts = new Map();
    for (let attempt = 0; attempt < 250; attempt++) {
      for (const character of VexVault.makePassword({ length: 40 })) {
        counts.set(character, (counts.get(character) || 0) + 1);
      }
    }
    const tallies = [...counts.values()].sort((a, b) => a - b);
    const low = tallies[0];
    const high = tallies[tallies.length - 1];
    expect(high / low).toBeLessThan(3);
  });
});

describe('the vault', () => {
  it('stays locked until a fingerprint says otherwise', async () => {
    expect(VexVault.locked()).toBe(true);
    expect(VexVault.all()).toEqual([]);
    expect(await VexVault.unlock()).toBe(true);
    expect(window.VexBridge.authenticate).toHaveBeenCalled();
    expect(VexVault.locked()).toBe(false);
  });

  it('refuses to open when the prompt is refused', async () => {
    window.VexBridge.authenticate.mockResolvedValueOnce({ ok: false });
    expect(await VexVault.unlock()).toBe(false);
    expect(VexVault.locked()).toBe(true);
  });

  it('keeps the passwords out of ordinary settings storage', async () => {
    await VexVault.unlock();
    await VexVault.save({ host: 'example.com', username: 'me', password: 'hunter2' });
    expect(JSON.stringify(store)).not.toContain('hunter2');
    expect(JSON.stringify(secrets)).toContain('hunter2');
  });

  it('remembers which sites it has something for, without unlocking', async () => {
    await VexVault.unlock();
    await VexVault.save({ host: 'example.com', username: 'me', password: 'x' });
    VexVault.lock();
    expect(VexVault.hasFor('example.com')).toBe(true);
    expect(VexVault.hasFor('login.example.com')).toBe(true);
    expect(VexVault.hasFor('other.test')).toBe(false);
  });

  it('updates an existing login rather than stacking duplicates', async () => {
    await VexVault.unlock();
    await VexVault.save({ host: 'example.com', username: 'me', password: 'one' });
    await VexVault.save({ host: 'example.com', username: 'me', password: 'two' });
    expect(VexVault.all()).toHaveLength(1);
    expect(VexVault.all()[0].password).toBe('two');
  });

  it('fills by running a script in the page, and never submits', async () => {
    await VexVault.unlock();
    await VexVault.fill('t1', { username: 'me@example.com', password: 'hunter2' });
    const script = window.VexBridge.evaluate.mock.calls.at(-1)[1];
    expect(script).toContain('input[type=password]');
    expect(script).toContain('"me@example.com"');
    expect(script).not.toMatch(/\.submit\(|requestSubmit/);
  });

  it('keeps only the details it was given, and no card numbers', async () => {
    await VexVault.saveProfile({ name: 'A Person', email: 'a@example.com', card: '4111111111111111' });
    expect(VexVault.profile()).toEqual({ name: 'A Person', email: 'a@example.com' });
    expect(JSON.stringify(store)).not.toContain('4111');
  });
});

describe('sync records — the desktop’s own file', () => {
  it('merges two devices without losing either side', () => {
    const phone = records.capture(records.empty(),
      records.flatten({ 'preference:vex.bookmarks': [{ id: 'a', url: 'https://a' }] }), 'phone');
    const pc = records.capture(records.empty(),
      records.flatten({ 'preference:vex.bookmarks': [{ id: 'b', url: 'https://b' }] }), 'pc');
    const merged = records.unflatten(records.values(records.merge(phone, pc)));
    expect(merged['preference:vex.bookmarks'].map(entry => entry.id).sort()).toEqual(['a', 'b']);
  });

  it('carries a deletion across, rather than resurrecting the row', () => {
    let phone = records.capture(records.empty(),
      records.flatten({ 'preference:vex.bookmarks': [{ id: 'a', url: 'https://a' }] }), 'phone');
    const pc = records.merge(records.empty(), phone);
    phone = records.capture(phone, records.flatten({ 'preference:vex.bookmarks': [] }), 'phone');
    const merged = records.unflatten(records.values(records.merge(pc, phone)));
    expect(merged['preference:vex.bookmarks']).toEqual([]);
  });

  it('refuses a document that is not the schema it knows', () => {
    expect(() => records.valid({ schema: 1, records: {} })).toThrow(/schema/);
    expect(() => records.valid({ schema: 2, records: { a: { clock: {}, deleted: 'no' } } })).toThrow(/record/);
  });
});

describe('sync encryption', () => {
  it('round-trips through a key that never leaves the device', async () => {
    const key = await SyncCrypto.generateKey();
    const blob = await SyncCrypto.encrypt({ bookmarks: [{ url: 'https://example.com' }] }, key);
    expect(typeof blob).toBe('string');
    expect(blob).not.toContain('example.com');
    const back = await SyncCrypto.decrypt(blob, key);
    expect(back.bookmarks[0].url).toBe('https://example.com');
  });

  it('cannot be read with another key', async () => {
    const mine = await SyncCrypto.generateKey();
    const theirs = await SyncCrypto.generateKey();
    const blob = await SyncCrypto.encrypt({ secret: 1 }, mine);
    await expect(SyncCrypto.decrypt(blob, theirs)).rejects.toBeTruthy();
  });

  it('turns a key into the recovery code you type on the second device', async () => {
    const key = await SyncCrypto.generateKey();
    const hex = SyncCrypto.keyToHex(await SyncCrypto.exportKey(key));
    const formatted = SyncCrypto.formatRecoveryCode(hex);
    expect(formatted).toMatch(/^[0-9A-F]{8}(-[0-9A-F]{8}){7}$/);
    expect(SyncCrypto.parseRecoveryCode(formatted)).toBe(hex);
    expect(() => SyncCrypto.hexToKey('nope')).toThrow(/Invalid recovery code/);
  });
});

describe('reading a login form', () => {
  it('takes the fields whether the WebView encodes once or twice', async () => {
    const payload = { ok: true, username: 'me@example.com', password: 'hunter2' };
    window.VexBridge.evaluate.mockResolvedValueOnce({ result: JSON.stringify(payload) });
    expect(await VexVault.readFields('t1')).toMatchObject(payload);

    window.VexBridge.evaluate.mockResolvedValueOnce({ result: JSON.stringify(JSON.stringify(payload)) });
    expect(await VexVault.readFields('t1')).toMatchObject(payload);
  });

  it('is null when the page has no form, or answers with rubbish', async () => {
    window.VexBridge.evaluate.mockResolvedValueOnce({ result: JSON.stringify({ ok: false }) });
    expect(await VexVault.readFields('t1')).toBe(null);
    window.VexBridge.evaluate.mockResolvedValueOnce({ result: 'undefined' });
    expect(await VexVault.readFields('t1')).toBe(null);
    window.VexBridge.evaluate.mockResolvedValueOnce({ result: null });
    expect(await VexVault.readFields('t1')).toBe(null);
  });
});


describe('2FA codes as the QR code describes them', () => {
  // RFC 6238 appendix B, T = 59 s, eight digits.
  it('does SHA-256 and SHA-512 when asked', async () => {
    const sha256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
    const sha512 = 'GEZDGNBVGY3TQOJQ'.repeat(6) + 'GEZDGNA';
    expect(await VexVault.totp(sha256, { digits: 8, algorithm: 'SHA256', at: 59000 })).toBe('46119246');
    expect(await VexVault.totp(sha512, { digits: 8, algorithm: 'SHA512', at: 59000 })).toBe('90693936');
  });

  it('keeps the digits, period and algorithm of a scanned code', async () => {
    await VexVault.save({
      host: 'bank.example', username: 'me',
      secret: 'otpauth://totp/Bank:me?secret=JBSWY3DPEHPK3PXP&issuer=Bank&digits=8&period=60&algorithm=SHA256'
    });
    const entry = VexVault.forHost('bank.example')[0];
    expect(entry.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(VexVault.codeOptions(entry)).toEqual({ digits: 8, period: 60, algorithm: 'SHA256' });
    expect(await VexVault.totp(entry.secret, VexVault.codeOptions(entry))).toMatch(/^\d{8}$/);
  });
});

describe('filling only where a login belongs', () => {
  it('knows a subdomain from another site', () => {
    const entry = { host: 'example.com' };
    expect(VexVault.belongsOn(entry, 'example.com')).toBe(true);
    expect(VexVault.belongsOn(entry, 'login.example.com')).toBe(true);
    expect(VexVault.belongsOn(entry, 'example.com.evil.net')).toBe(false);
    expect(VexVault.belongsOn(entry, 'notexample.com')).toBe(false);
  });

  it('refuses in the page itself when the page is another site', async () => {
    let script = '';
    window.VexBridge.evaluate = async (id, code) => { script = code; return { result: '"wrong-host"' }; };
    expect(await VexVault.fill('t1', { host: 'example.com', username: 'a', password: 'b' })).toBe('wrong-host');
    expect(script).toContain('"example.com"');
    // And the check is real: run it against a page on another host.
    document.body.innerHTML = '<form><input type="email"><input type="password"></form>';
    // jsdom's location is about:blank / localhost — not example.com.
    // eslint-disable-next-line no-eval
    expect((0, eval)(script)).toBe('wrong-host');
    expect(document.querySelector('input[type=password]').value).toBe('');
  });
});
