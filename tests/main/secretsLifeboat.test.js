// @vitest-environment node
//
// The encrypted secrets lifeboat (src/main/secrets-lifeboat.js). Every secret here is a made-up string, and a
// scan of every file the tests make, every log line and every error asserts that none of them (and not the
// passphrase) ever appears in the clear.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createLifeboat, GENERIC_BAD } = require('../../src/main/secrets-lifeboat.js');
const { cleanCard } = require('../../src/main/cards.js');

const PASS = 'fake passphrase for tests only 77';
const SECRETS = ['FAKE-PW-alpha-9Zq', 'FAKE-PW-bravo-4Xk', 'JBSWY3DPEHPK3PXP', 'GEZDGNBVGY3TQOJQ', '4111111111111111', 'FAKE-NOTE-private', 'FAKE-PRIVATE-KEY-DO-NOT-LEAK'];

let root, state, logs, calls, lifeboat, locked, now;
const FILES = () => ({ vault: path.join(root, 'vault.dat'), totp: path.join(root, 'totp.dat'), cards: path.join(root, 'cards.dat') });

function build(over = {}) {
  const f = FILES();
  const make = (name, startList) => {
    state[name] = startList;
    return {
      load: () => { if (locked) throw new Error('Vex is locked'); if (state[name + 'Broken']) throw new Error('Cannot read encrypted store; existing data has been preserved'); return structuredClone(state[name]); },
      save: vi.fn(async (list) => { calls.push(name + ':save'); state[name] = structuredClone(list); state[name + 'Broken'] = false; }),
    };
  };
  return createLifeboat({
    vault: make('vault', [
      { host: 'one.test', username: 'ann', password: 'FAKE-PW-alpha-9Zq', updatedAt: '2026-01-02T00:00:00.000Z', note: 'FAKE-NOTE-private' },
      { host: 'two.test', username: 'bob', password: 'FAKE-PW-bravo-4Xk', updatedAt: '2026-02-02T00:00:00.000Z' },
    ]),
    totp: { ...make('totp', [{ id: 't1', label: 'ann', issuer: 'One', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha1', digits: 6, period: 30 }]), validate: (a) => { if (!/^[A-Z2-7]+=*$/i.test(a.secret)) throw new Error('bad seed'); } },
    cards: make('cards', [{ id: 'c1', number: '4111111111111111', brand: 'Visa', name: 'ANN TEST', nickname: 'main', expMonth: 12, expYear: 2031, updatedAt: '2026-01-01T00:00:00.000Z' }]),
    passkeys: { list: () => [{ credentialId: 'cred1', rpId: 'passkey.test', rpName: 'Passkey', userName: 'ann@passkey.test', userDisplayName: 'Ann', nickname: 'laptop', createdAt: '2026-03-01T00:00:00.000Z', lastUsedAt: null, deviceOnly: true, privateKeyPkcs8: 'FAKE-PRIVATE-KEY-DO-NOT-LEAK' }] },
    files: f, backupsDir: path.join(root, 'backups'), isLocked: () => locked, now: () => new Date(now), cleanCard,
    log: (m) => logs.push(m), ...over,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-lifeboat-'));
  state = {}; logs = []; calls = []; locked = false; now = Date.UTC(2026, 10, 7, 12, 0, 0);
  lifeboat = build();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function everyFileText() {
  const out = [];
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else out.push([p, fs.readFileSync(p, 'latin1')]); } };
  walk(root);
  return out;
}
function assertNoPlaintext(extra = []) {
  for (const [file, text] of everyFileText()) {
    for (const s of [...SECRETS, PASS, ...extra]) {
      // the unreadable store we planted ourselves is allowed to hold its own bytes
      if (/unreadable|vault\.dat$|totp\.dat$|cards\.dat$/.test(file)) continue;
      expect(text, `${s} in ${file}`).not.toContain(s);
    }
  }
  for (const line of logs) for (const s of [...SECRETS, PASS]) expect(line).not.toContain(s);
}

describe('what goes in the file', () => {
  it('passwords, authenticator seeds and the passkey LIST; cards only when ticked; never a passkey key', () => {
    const p = lifeboat.collect();
    expect(lifeboat.counts(p)).toEqual({ passwords: 2, authenticator: 1, cards: 0, cardsIncluded: false, passkeys: 1 });
    expect(p.cards).toBe(null);
    expect(JSON.stringify(p)).not.toContain('FAKE-PRIVATE-KEY-DO-NOT-LEAK');
    expect(p.passkeys[0]).toEqual({ credentialId: 'cred1', rpId: 'passkey.test', rpName: 'Passkey', userName: 'ann@passkey.test', userDisplayName: 'Ann', nickname: 'laptop', createdAt: '2026-03-01T00:00:00.000Z', lastUsedAt: null });
    expect(p.notExported.passkeyKeys).toMatch(/never leaves Vex/);
    const withCards = lifeboat.collect({ includeCards: true });
    expect(lifeboat.counts(withCards)).toMatchObject({ cards: 1, cardsIncluded: true });
    expect(withCards.cards[0]).not.toHaveProperty('cvv');
    expect(withCards.notExported.cardCvv).toMatch(/never kept/);
  });
  it('refuses while Vex is locked', () => {
    locked = true;
    expect(() => lifeboat.collect()).toThrow(/locked/);
  });
});

describe('the file', () => {
  it('has a versioned header, a random salt and nonce each time, and only ciphertext', async () => {
    const a = JSON.parse(await lifeboat.seal(lifeboat.collect(), PASS));
    const b = JSON.parse(await lifeboat.seal(lifeboat.collect(), PASS));
    expect(a).toMatchObject({ format: 'vex-secrets-lifeboat', version: 1, kdf: { name: 'scrypt', N: 32768, r: 8, p: 1 }, cipher: { name: 'aes-256-gcm' } });
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
    expect(Buffer.from(a.kdf.salt, 'base64').length).toBe(16);
    expect(Buffer.from(a.cipher.iv, 'base64').length).toBe(12);
    expect(Buffer.from(a.cipher.tag, 'base64').length).toBe(16);
    const text = JSON.stringify(a);
    for (const s of SECRETS) expect(text).not.toContain(s);
    // padded to a 4 KB step: the size does not give the number of logins away
    expect(Buffer.from(a.data, 'base64').length % 4096).toBe(0);
  });
  it('opens with the right passphrase and no other', async () => {
    const text = await lifeboat.seal(lifeboat.collect({ includeCards: true }), PASS);
    const p = await lifeboat.open(text, PASS);
    expect(lifeboat.counts(p)).toEqual({ passwords: 2, authenticator: 1, cards: 1, cardsIncluded: true, passkeys: 1 });
    await expect(lifeboat.open(text, PASS + 'x')).rejects.toThrow(GENERIC_BAD);
    await expect(lifeboat.open(text, '')).rejects.toThrow(GENERIC_BAD);
  });
  it('every part of it is authenticated: a changed byte, date, cost, nonce or tag fails', async () => {
    const good = JSON.parse(await lifeboat.seal(lifeboat.collect(), PASS));
    const flip = (b64) => { const b = Buffer.from(b64, 'base64'); b[0] ^= 1; return b.toString('base64'); };
    const edits = {
      data: (f) => { f.data = flip(f.data); }, createdAt: (f) => { f.createdAt = '2020-01-01T00:00:00.000Z'; },
      salt: (f) => { f.kdf.salt = flip(f.kdf.salt); }, iv: (f) => { f.cipher.iv = flip(f.cipher.iv); }, tag: (f) => { f.cipher.tag = flip(f.cipher.tag); },
      cost: (f) => { f.kdf.N = 65536; },
    };
    for (const [name, edit] of Object.entries(edits)) {
      const f = JSON.parse(JSON.stringify(good));
      edit(f);
      await expect(lifeboat.open(JSON.stringify(f), PASS), name).rejects.toThrow(GENERIC_BAD);
    }
  });
  it('refuses files that are not its own, from a newer version, or with an unreasonable cost', async () => {
    const good = JSON.parse(await lifeboat.seal(lifeboat.collect(), PASS));
    await expect(lifeboat.open('not json', PASS)).rejects.toThrow(/not a Vex secrets file/);
    await expect(lifeboat.open('{"format":"other"}', PASS)).rejects.toThrow(/not a Vex secrets file/);
    await expect(lifeboat.open(JSON.stringify({ ...good, version: 2 }), PASS)).rejects.toThrow(/newer Vex/);
    await expect(lifeboat.open(JSON.stringify({ ...good, kdf: { ...good.kdf, N: 2 ** 30 } }), PASS)).rejects.toThrow(/settings Vex does not read/);
    await expect(lifeboat.open(JSON.stringify({ ...good, kdf: { ...good.kdf, name: 'pbkdf2' } }), PASS)).rejects.toThrow(/settings Vex does not read/);
  });
  it('needs a real passphrase to seal', async () => {
    await expect(lifeboat.seal(lifeboat.collect(), 'short')).rejects.toThrow(/at least 10/);
    await expect(lifeboat.seal(lifeboat.collect(), 'x'.repeat(200))).rejects.toThrow(/at most/);
  });
});

describe('export, with the mandatory verification', () => {
  it('writes ciphertext, verifies it by decrypting in memory, and reports counts', async () => {
    const file = path.join(root, 'out', 'secrets.vexsecrets');
    const r = await lifeboat.exportToFile(file, PASS, { includeCards: true });
    expect(r).toMatchObject({ verified: true, counts: { passwords: 2, authenticator: 1, cards: 1, passkeys: 1 } });
    expect(r.passkeys).toEqual([{ rpId: 'passkey.test', userName: 'ann@passkey.test' }]);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['secrets.vexsecrets']);     // no temp file left
    assertNoPlaintext();
    const v = await lifeboat.verifyFile(file, PASS);
    expect(v.counts.passwords).toBe(2);
    expect(v.live).toMatchObject({ passwords: 2, authenticator: 1, cards: 1, passkeys: 1 });
    await expect(lifeboat.verifyFile(file, 'another passphrase entirely')).rejects.toThrow(GENERIC_BAD);
  });
  it('deletes a file that does not verify (the disk gave back something else)', async () => {
    const file = path.join(root, 'bad.vexsecrets');
    const corrupting = { ...fs, readFileSync: (f, ...a) => { const t = fs.readFileSync(f, ...a); return String(f).endsWith('bad.vexsecrets') ? String(t).replace('"data": "', '"data": "AAAA') : t; } };
    const lb = build({ fs: corrupting });
    await expect(lb.exportToFile(file, PASS)).rejects.toThrow(/did not verify, so it was deleted/);
    expect(fs.existsSync(file)).toBe(false);
  });
  it('a failing rename leaves neither the file nor a temp file', async () => {
    const file = path.join(root, 'x', 'never.vexsecrets');
    const lb = build({ fs: { ...fs, renameSync: () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); } } });
    await expect(lb.exportToFile(file, PASS)).rejects.toThrow(/could not be written \(EBUSY\)/);
    expect(fs.readdirSync(path.join(root, 'x'))).toEqual([]);
  });
  it('a disk that fills half way leaves no readable fragment', async () => {
    const file = path.join(root, 'full.vexsecrets');
    const lb = build({ fs: { ...fs, writeFileSync: () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); } } });
    await expect(lb.exportToFile(file, PASS)).rejects.toThrow(/ENOSPC/);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(root).filter(n => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('restore', () => {
  const exportFile = async (opts) => { const f = path.join(root, 'e.vexsecrets'); await lifeboat.exportToFile(f, PASS, opts); return f; };

  it('has to be confirmed, and a wrong passphrase changes nothing', async () => {
    const f = await exportFile();
    await expect(lifeboat.restoreFromFile(f, PASS)).rejects.toThrow(/confirmed/);
    await expect(lifeboat.restoreFromFile(f, 'a different passphrase', { confirmed: true })).rejects.toThrow(GENERIC_BAD);
    expect(calls).toEqual([]);
    expect(fs.existsSync(path.join(root, 'backups'))).toBe(false);
  });

  it('into an empty profile brings everything back; there is nothing to keep a safety copy of', async () => {
    const f = await exportFile({ includeCards: true });
    state.vault = []; state.totp = []; state.cards = [];
    const plan = await lifeboat.plan(f, PASS);
    expect(plan).toMatchObject({ passwords: { add: 2, have: 0 }, authenticator: { add: 1, have: 0 }, cards: { add: 1, have: 0, included: true } });
    expect(plan.passkeys).toEqual([{ rpId: 'passkey.test', userName: 'ann@passkey.test' }]);
    const r = await lifeboat.restoreFromFile(f, PASS, { confirmed: true });
    expect(r.restored).toEqual({ passwords: 2, authenticator: 1, cards: 1 });
    expect(r.before).toBe(null);
    expect(state.vault.map(e => e.host)).toEqual(['one.test', 'two.test']);
    expect(state.vault[0].note).toBe('FAKE-NOTE-private');
    expect(state.totp[0]).toMatchObject({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'One' });
    expect(state.totp[0].id).toBeTruthy();
    expect(state.cards[0]).toMatchObject({ number: '4111111111111111', brand: 'Visa', expMonth: 12 });
    expect(r.passkeys).toBe(1);
    assertNoPlaintext();
  });

  it('writes a verified encrypted safety copy of what is there now BEFORE it changes anything, and never overwrites what exists', async () => {
    const f = await exportFile();
    state.vault = [{ host: 'one.test', username: 'ann', password: 'FAKE-PW-alpha-9Zq-CHANGED-LATER', updatedAt: '2026-05-05T00:00:00.000Z' }, { host: 'other.test', username: 'zed', password: 'FAKE-PW-bravo-4Xk', updatedAt: '2026-05-05T00:00:00.000Z' }];
    state.totp = [];
    calls.length = 0;
    const r = await lifeboat.restoreFromFile(f, PASS, { confirmed: true });
    expect(r.before).toMatchObject({ name: 'secrets-before-restore-20261107120000.vexsecrets', counts: { passwords: 2 } });
    expect(r.restored).toEqual({ passwords: 1, authenticator: 1, cards: 0 });
    expect(r.kept.passwords).toBe(1);
    expect(state.vault.find(e => e.host === 'one.test').password).toBe('FAKE-PW-alpha-9Zq-CHANGED-LATER');   // the live login wins
    expect(state.vault.map(e => e.host).sort()).toEqual(['one.test', 'other.test', 'two.test']);
    // the safety copy opens with the same passphrase and holds the OLD state
    const safety = path.join(root, 'backups', r.before.name);
    const old = await lifeboat.open(fs.readFileSync(safety, 'utf8'), PASS);
    expect(old.vault.map(e => e.host)).toEqual(['one.test', 'other.test']);
    assertNoPlaintext(['FAKE-PW-alpha-9Zq-CHANGED-LATER']);

    // and going back to it makes the stores exactly what they were
    const back = await lifeboat.restoreFromFile(safety, PASS, { confirmed: true, replace: true });
    expect(back.restored.passwords).toBe(2);
    expect(state.vault.map(e => e.host)).toEqual(['one.test', 'other.test']);
    expect(state.vault[0].password).toBe('FAKE-PW-alpha-9Zq-CHANGED-LATER');
    expect(state.totp).toEqual([]);
  });

  it('stops before changing anything if the safety copy cannot be made', async () => {
    const f = await exportFile();
    state.vault = [{ host: 'live.test', username: 'u', password: 'FAKE-PW-alpha-9Zq', updatedAt: '2026-05-05T00:00:00.000Z' }];
    calls.length = 0;
    const lb = build({ fs: { ...fs, mkdirSync: (p, ...a) => { if (String(p).endsWith('backups')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return fs.mkdirSync(p, ...a); } } });
    state.vault = [{ host: 'live.test', username: 'u', password: 'FAKE-PW-alpha-9Zq', updatedAt: '2026-05-05T00:00:00.000Z' }];
    await expect(lb.restoreFromFile(f, PASS, { confirmed: true })).rejects.toThrow(/EACCES/);
    expect(calls).toEqual([]);
    expect(state.vault.map(e => e.host)).toEqual(['live.test']);
  });

  it('a damaged safety copy (read back differently) also stops it before any change', async () => {
    const f = await exportFile();
    state.vault = [{ host: 'live.test', username: 'u', password: 'FAKE-PW-alpha-9Zq', updatedAt: '2026-05-05T00:00:00.000Z' }];
    const lb = build({ fs: { ...fs, readFileSync: (p, ...a) => { const t = fs.readFileSync(p, ...a); return String(p).includes('secrets-before-restore') ? String(t).replace('"data": "', '"data": "AAAA') : t; } } });
    state.vault = [{ host: 'live.test', username: 'u', password: 'FAKE-PW-alpha-9Zq', updatedAt: '2026-05-05T00:00:00.000Z' }];
    calls.length = 0;
    await expect(lb.restoreFromFile(f, PASS, { confirmed: true })).rejects.toThrow(/safety copy.*nothing was restored/);
    expect(calls).toEqual([]);
    expect(fs.readdirSync(path.join(root, 'backups')).filter(n => n.endsWith('.vexsecrets'))).toEqual([]);   // the bad copy was removed
  });

  it('a store DPAPI can no longer read is set aside, not deleted, then replaced', async () => {
    const f = await exportFile();
    fs.writeFileSync(FILES().vault, 'DPAPI-SEALED-BYTES-THAT-NO-LONGER-OPEN');
    state.vaultBroken = true;
    const plan = await lifeboat.plan(f, PASS);
    expect(plan.unreadable).toEqual(['passwords']);
    const r = await lifeboat.restoreFromFile(f, PASS, { confirmed: true });
    expect(r.setAside).toEqual(['vault.dat.unreadable-20261107120000']);
    expect(fs.readFileSync(path.join(root, 'vault.dat.unreadable-20261107120000'), 'utf8')).toBe('DPAPI-SEALED-BYTES-THAT-NO-LONGER-OPEN');
    expect(fs.existsSync(FILES().vault)).toBe(false);
    expect(r.restored.passwords).toBe(2);
    expect(state.vault.length).toBe(2);
  });

  it('if the unreadable store cannot be set aside, nothing is restored', async () => {
    const f = await exportFile();
    fs.writeFileSync(FILES().vault, 'SEALED');
    state.vaultBroken = true;
    const lb = build({ fs: { ...fs, renameSync: (a, b) => { if (String(b).includes('unreadable')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); return fs.renameSync(a, b); } } });
    state.vaultBroken = true;
    calls.length = 0;
    await expect(lb.restoreFromFile(f, PASS, { confirmed: true })).rejects.toThrow(/could not set the unreadable vault store aside/);
    expect(calls).toEqual([]);
    expect(fs.readFileSync(FILES().vault, 'utf8')).toBe('SEALED');
  });

  it('skips an authenticator seed that no code can be made from, and a card that fails its checks', async () => {
    const p = lifeboat.collect({ includeCards: true });
    p.totp.push({ label: 'bad', issuer: '', secret: '!!!notbase32!!!', algorithm: 'sha1', digits: 6, period: 30 });
    p.cards.push({ number: '1234567890123456', name: 'X', nickname: '', expMonth: 1, expYear: 2030 });
    const f = path.join(root, 'odd.vexsecrets');
    fs.writeFileSync(f, await lifeboat.seal(p, PASS));
    state.vault = []; state.totp = []; state.cards = [];
    const r = await lifeboat.restoreFromFile(f, PASS, { confirmed: true });
    expect(r.restored).toEqual({ passwords: 2, authenticator: 1, cards: 1 });
  });

  it('is refused while Vex is locked', async () => {
    const f = await exportFile();
    locked = true;
    await expect(lifeboat.restoreFromFile(f, PASS, { confirmed: true })).rejects.toThrow(/locked/);
    await expect(lifeboat.plan(f, PASS)).rejects.toThrow(/locked/);
  });
});

describe('nothing secret in any log, error or file', () => {
  it('through a whole export, wrong-passphrase attempt, restore and failures', async () => {
    const errors = [];
    const attempt = async (fn) => { try { await fn(); } catch (e) { errors.push(e.message + ' ' + (e.cause ? e.cause.message : '')); } };
    const f = path.join(root, 'all.vexsecrets');
    await lifeboat.exportToFile(f, PASS, { includeCards: true });
    await attempt(() => lifeboat.exportToFile(path.join(root, 'short.vexsecrets'), 'short'));
    await attempt(() => lifeboat.restoreFromFile(f, 'wrong passphrase wrong passphrase', { confirmed: true }));
    await attempt(() => lifeboat.open('{"format":"vex-secrets-lifeboat","version":1}', PASS));
    state.vault = []; state.totp = []; state.cards = [];
    await lifeboat.restoreFromFile(f, PASS, { confirmed: true });
    const consoleSpy = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    await attempt(() => lifeboat.restoreFromFile(f, PASS, { confirmed: true }));
    for (const line of [...errors, ...logs, ...consoleSpy.flatMap(s => s.mock.calls.flat().map(String))]) {
      for (const s of [...SECRETS, PASS, 'wrong passphrase wrong passphrase']) expect(line).not.toContain(s);
    }
    consoleSpy.forEach(s => s.mockRestore());
    assertNoPlaintext(['wrong passphrase wrong passphrase']);
    // and the only .vexsecrets / .tmp-like files are ciphertext
    const names = everyFileText().map(([p]) => path.basename(p));
    expect(names.filter(n => n.endsWith('.tmp'))).toEqual([]);
  });
});
