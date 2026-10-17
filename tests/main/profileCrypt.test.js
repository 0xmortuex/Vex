// T3-123: the encrypted profile lock. Every test builds a fixture profile in a temp folder; nothing
// here touches %APPDATA%\vex.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const PC = req('../../src/main/profile-crypt.js');
const { createProfileCrypt, ProfileLockError, isEnvelope, makeRecoveryCode, normaliseRecoveryCode, profileFiles } = PC;
const KDF = { N: 16384, r: 8, p: 1 };   // the cheapest cost the engine accepts: tests only
const PASS = 'correct horse battery';
const SECRET = 'NOTE-ABOUT-MY-DOCTOR-7731';

const dirs = [];
function profile(extra = {}) {
  const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'vex-pc-'));
  dirs.push(dir);
  nodeFs.mkdirSync(path.join(dir, 'vex-storage'), { recursive: true });
  const files = {
    'vex-persist.json': JSON.stringify({ __vexPreferenceStore: 1, 'vex.notes': JSON.stringify([SECRET]), 'vex.theme': '"light"' }),
    'vex-persist.json.bak': JSON.stringify({ __vexPreferenceStore: 1, 'vex.notes': JSON.stringify([SECRET + ' older']) }),
    'vex-persist-volatile.json': JSON.stringify({ __vexPreferenceStore: 1, 'vex.history': JSON.stringify([{ url: 'https://' + SECRET + '.example' }]) }),
    'vex-storage/tabs.json': JSON.stringify({ $vexStore: 1, data: [{ url: 'https://' + SECRET + '.test' }] }),
    ...extra,
  };
  for (const [rel, text] of Object.entries(files)) nodeFs.writeFileSync(path.join(dir, rel), text);
  return { dir, files, rels: Object.keys(files), engine: () => createProfileCrypt({ userDataPath: dir, kdf: KDF }) };
}
afterEach(() => { for (const d of dirs.splice(0)) nodeFs.rmSync(d, { recursive: true, force: true }); });

const read = (p, rel) => nodeFs.readFileSync(path.join(p.dir, rel));
function walk(dir, out = []) {
  for (const e of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}
const anyPlaintext = (p, needle = SECRET) => walk(p.dir).filter((f) => nodeFs.readFileSync(f).includes(needle));
// A copy of fs whose renameSync fails (code EIO, not retried) once `fail(target)` says so.
function faultyFs(fail) {
  return { ...nodeFs, renameSync: (from, to) => { if (fail(String(to))) { const e = new Error('disk fault'); e.code = 'EIO'; throw e; } return nodeFs.renameSync(from, to); } };
}

describe('recovery code', () => {
  it('is 8 groups of 4, from an alphabet without look-alikes, and reads back loosely', () => {
    const code = makeRecoveryCode();
    expect(code).toMatch(/^(?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(normaliseRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code.replace(/-/g, ''));
    expect(makeRecoveryCode()).not.toBe(code);
  });
  it('refuses the wrong length or characters', () => {
    expect(() => normaliseRecoveryCode('ABCD')).toThrow(/32 letters/);
    expect(() => normaliseRecoveryCode('U'.repeat(32))).toThrow(/32 letters/);
  });
});

describe('enable', () => {
  it('encrypts every file in place, leaves no plaintext anywhere, and gives the recovery code once', async () => {
    const p = profile();
    const e = p.engine();
    expect(e.status()).toMatchObject({ enabled: false, state: 'plain', locked: false });
    const r = await e.enable({ passphrase: PASS, files: p.rels });
    expect(r.recoveryCode).toMatch(/^(?:[0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(r.leftovers).toEqual([]);
    for (const rel of p.rels) expect(isEnvelope(read(p, rel))).toBe(true);
    expect(anyPlaintext(p)).toEqual([]);
    // Nothing of the plaintext, the snapshot, the .pc-bak copies, or the code is on disk.
    expect(nodeFs.existsSync(path.join(p.dir, 'profile-lock-snapshot'))).toBe(false);
    expect(walk(p.dir).filter((f) => /\.pc-/.test(f))).toEqual([]);
    expect(walk(p.dir).filter((f) => nodeFs.readFileSync(f).includes(r.recoveryCode.replace(/-/g, '')))).toEqual([]);
    expect(e.status()).toMatchObject({ enabled: true, state: 'encrypted', locked: false });
  });

  it('opens with the passphrase, and with the recovery code typed loosely, in a fresh process', async () => {
    const p = profile();
    const { recoveryCode } = await p.engine().enable({ passphrase: PASS, files: p.rels });
    const a = p.engine();
    expect(a.status().locked).toBe(true);
    expect(() => a.codec.decode(read(p, 'vex-persist.json'))).toThrow(/locked/);
    await a.unlock(PASS);
    expect(a.codec.decode(read(p, 'vex-persist.json')).toString()).toBe(p.files['vex-persist.json']);
    expect(a.codec.decode(read(p, 'vex-storage/tabs.json')).toString()).toBe(p.files['vex-storage/tabs.json']);
    const b = p.engine();
    await b.unlockWithRecovery(recoveryCode.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o'));
    expect(b.codec.decode(read(p, 'vex-persist-volatile.json')).toString()).toBe(p.files['vex-persist-volatile.json']);
  });

  it('refuses a wrong passphrase and a wrong recovery code, and stays locked', async () => {
    const p = profile();
    const { recoveryCode } = await p.engine().enable({ passphrase: PASS, files: p.rels });
    const a = p.engine();
    await expect(a.unlock('not the passphrase')).rejects.toMatchObject({ code: 'WRONG_SECRET' });
    await expect(a.unlock('')).rejects.toMatchObject({ code: 'WRONG_SECRET' });
    await expect(a.unlockWithRecovery(makeRecoveryCode())).rejects.toMatchObject({ code: 'WRONG_SECRET' });
    await expect(a.unlockWithRecovery('nope')).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect(a.status().locked).toBe(true);
    await a.unlockWithRecovery(recoveryCode);
    expect(a.status().locked).toBe(false);
  });

  it('refuses a weak passphrase, a profile already encrypted, and changes nothing', async () => {
    const p = profile();
    const before = p.rels.map((rel) => read(p, rel));
    await expect(p.engine().enable({ passphrase: 'short', files: p.rels })).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect(p.rels.map((rel) => read(p, rel))).toEqual(before);
    expect(nodeFs.existsSync(path.join(p.dir, 'profile-lock.json'))).toBe(false);
    const e = p.engine();
    await e.enable({ passphrase: PASS, files: p.rels });
    await expect(e.enable({ passphrase: PASS, files: p.rels })).rejects.toMatchObject({ code: 'BAD_STATE' });
  });

  it('refuses files outside the profile folder and the lock\'s own files', async () => {
    const p = profile();
    await expect(p.engine().enable({ passphrase: PASS, files: ['../escape.json'] })).rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(p.engine().enable({ passphrase: PASS, files: ['profile-lock.json'] })).rejects.toMatchObject({ code: 'BAD_INPUT' });
  });

  it('stops before changing anything when a file the caller checks is not readable', async () => {
    const p = profile({ 'vex-persist.json': '{ this is not json' });
    const validate = (rel, bytes) => { if (rel === 'vex-persist.json') JSON.parse(bytes.toString()); };
    await expect(p.engine().enable({ passphrase: PASS, files: p.rels, validate })).rejects.toThrow();
    for (const rel of p.rels) expect(isEnvelope(read(p, rel))).toBe(false);
    expect(nodeFs.existsSync(path.join(p.dir, 'profile-lock.json'))).toBe(false);
    expect(nodeFs.existsSync(path.join(p.dir, 'profile-lock-snapshot'))).toBe(false);
  });

  it('skips a file that does not exist', async () => {
    const p = profile();
    const r = await p.engine().enable({ passphrase: PASS, files: [...p.rels, 'vex-persist.json.gen1'] });
    expect(r.files).not.toContain('vex-persist.json.gen1');
  });
});

describe('a failure while encrypting leaves plaintext', () => {
  it('puts every file back byte for byte, removes the header, snapshot and copies', async () => {
    const p = profile();
    const before = new Map(p.rels.map((rel) => [rel, read(p, rel)]));
    let hits = 0;
    // The second data file's final rename fails; the first one is already encrypted by then.
    const fsMod = faultyFs((to) => /vex-persist-volatile\.json$/.test(to) && ++hits === 1);
    const e = createProfileCrypt({ userDataPath: p.dir, fsMod, kdf: KDF });
    await expect(e.enable({ passphrase: PASS, files: p.rels })).rejects.toThrow(/disk fault/);
    for (const [rel, bytes] of before) expect(read(p, rel).equals(bytes)).toBe(true);
    expect(walk(p.dir).filter((f) => /profile-lock|\.pc-/.test(f))).toEqual([]);
    expect(e.status().enabled).toBe(false);
  });

  it('after a crash (the undo failing too) the next start restores the plaintext with no key', async () => {
    const p = profile();
    const before = new Map(p.rels.map((rel) => [rel, read(p, rel)]));
    // The 2nd file to be encrypted fails; from then on every rename fails, so the undo cannot run either.
    let dead = false;
    const fsMod = faultyFs((to) => { if (/vex-persist-volatile\.json$/.test(to)) dead = true; return dead; });
    const e = createProfileCrypt({ userDataPath: p.dir, fsMod, kdf: KDF });
    await expect(e.enable({ passphrase: PASS, files: p.rels })).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
    // The picture a crash leaves: a migrating header, some files encrypted, the plaintext in .pc-bak and the snapshot.
    expect(JSON.parse(read(p, 'profile-lock.json').toString()).state).toBe('migrating');
    expect(nodeFs.existsSync(path.join(p.dir, 'profile-lock-snapshot', 'manifest.json'))).toBe(true);
    expect(p.rels.some((rel) => isEnvelope(read(p, rel)))).toBe(true);

    const next = p.engine();                       // a new run of Vex
    expect(next.recover()).toEqual({ recovered: true, state: 'plain' });
    for (const [rel, bytes] of before) expect(read(p, rel).equals(bytes)).toBe(true);
    expect(walk(p.dir).filter((f) => /profile-lock|\.pc-/.test(f))).toEqual([]);
    expect(next.status().enabled).toBe(false);
  });

  it('recovers from the snapshot when a file\'s .pc-bak is missing', async () => {
    const p = profile();
    const before = new Map(p.rels.map((rel) => [rel, read(p, rel)]));
    let dead = false;
    const fsMod = faultyFs((to) => { if (/vex-storage[\\/]tabs\.json$/.test(to)) dead = true; return dead; });
    await expect(createProfileCrypt({ userDataPath: p.dir, fsMod, kdf: KDF }).enable({ passphrase: PASS, files: p.rels })).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
    for (const rel of p.rels) nodeFs.rmSync(path.join(p.dir, rel + '.pc-bak'), { force: true });
    const encrypted = p.rels.filter((rel) => isEnvelope(read(p, rel)));
    expect(encrypted.length).toBeGreaterThan(0);
    p.engine().recover();
    for (const [rel, bytes] of before) expect(read(p, rel).equals(bytes)).toBe(true);
  });

  it('refuses to guess when an encrypted file has neither a copy nor a snapshot', async () => {
    const p = profile();
    let dead = false;
    const fsMod = faultyFs((to) => { if (/vex-persist-volatile\.json$/.test(to)) dead = true; return dead; });
    await expect(createProfileCrypt({ userDataPath: p.dir, fsMod, kdf: KDF }).enable({ passphrase: PASS, files: p.rels })).rejects.toThrow();
    nodeFs.rmSync(path.join(p.dir, 'profile-lock-snapshot'), { recursive: true, force: true });
    for (const rel of p.rels) nodeFs.rmSync(path.join(p.dir, rel + '.pc-bak'), { force: true });
    expect(() => p.engine().recover()).toThrow(/neither a \.pc-bak nor a snapshot/);
    expect(nodeFs.existsSync(path.join(p.dir, 'profile-lock.json'))).toBe(true);   // not dropped: nothing was restored
  });
});

describe('corrupt files and headers', () => {
  it('names a damaged encrypted file and does not read it', async () => {
    const p = profile();
    await p.engine().enable({ passphrase: PASS, files: p.rels });
    const bytes = read(p, 'vex-persist.json');
    bytes[bytes.length - 5] ^= 0xff;
    nodeFs.writeFileSync(path.join(p.dir, 'vex-persist.json'), bytes);
    const e = p.engine();
    await e.unlock(PASS);
    expect(() => e.codec.decode(read(p, 'vex-persist.json'))).toThrow(/damaged|another key/);
    expect(e.codec.decode(read(p, 'vex-persist-volatile.json')).toString()).toBe(p.files['vex-persist-volatile.json']);
  });
  it('a cut-short encrypted file is corrupt, not empty', async () => {
    const p = profile();
    await p.engine().enable({ passphrase: PASS, files: p.rels });
    nodeFs.writeFileSync(path.join(p.dir, 'vex-persist.json'), read(p, 'vex-persist.json').subarray(0, 20));
    const e = p.engine();
    await e.unlock(PASS);
    expect(() => e.codec.decode(read(p, 'vex-persist.json'))).toThrow(ProfileLockError);
  });
  it('switching back with a damaged file stops and leaves the profile encrypted', async () => {
    const p = profile();
    await p.engine().enable({ passphrase: PASS, files: p.rels });
    const bytes = read(p, 'vex-persist-volatile.json');
    bytes[bytes.length - 3] ^= 0xff;
    nodeFs.writeFileSync(path.join(p.dir, 'vex-persist-volatile.json'), bytes);
    const e = p.engine();
    await expect(e.disable({ passphrase: PASS, files: p.rels })).rejects.toMatchObject({ code: 'CORRUPT' });
    expect(e.status().state).toBe('encrypted');
    for (const rel of p.rels) expect(isEnvelope(read(p, rel))).toBe(true);
    expect(walk(p.dir).filter((f) => /\.pc-/.test(f))).toEqual([]);
    await e.unlock(PASS);   // still opens
  });
  it('a damaged header falls back to its .bak; with no good copy it is an error, never "plain"', async () => {
    const p = profile();
    const e = p.engine();
    await e.enable({ passphrase: PASS, files: p.rels });
    await e.newRecoveryCode({ passphrase: PASS });             // a second save, so a .bak exists
    nodeFs.writeFileSync(path.join(p.dir, 'profile-lock.json'), '{ cut');
    const again = p.engine();
    expect(again.status().enabled).toBe(true);
    await again.unlock(PASS);
    nodeFs.writeFileSync(path.join(p.dir, 'profile-lock.json'), '{ cut');
    nodeFs.writeFileSync(path.join(p.dir, 'profile-lock.json.bak'), 'also cut');
    expect(() => p.engine().status()).toThrow(/cannot be read/);
    nodeFs.rmSync(path.join(p.dir, 'profile-lock.json'));
    expect(() => p.engine().status()).toThrow(/missing/);
  });
  it('a header with a hostile scrypt cost is refused', async () => {
    const p = profile();
    await p.engine().enable({ passphrase: PASS, files: p.rels });
    const h = JSON.parse(read(p, 'profile-lock.json').toString());
    h.kdf.N = 2 ** 25;
    nodeFs.writeFileSync(path.join(p.dir, 'profile-lock.json'), JSON.stringify(h));
    nodeFs.rmSync(path.join(p.dir, 'profile-lock.json.bak'), { force: true });
    expect(() => p.engine().status()).toThrow(ProfileLockError);
  });
});

describe('switching back to plaintext', () => {
  it('restores every file byte for byte, then the codec passes plain bytes through', async () => {
    const p = profile();
    const { recoveryCode } = await p.engine().enable({ passphrase: PASS, files: p.rels });
    const e = p.engine();
    const r = await e.disable({ recoveryCode, files: p.rels });
    expect(r.files.sort()).toEqual([...p.rels].sort());
    for (const rel of p.rels) expect(read(p, rel).toString()).toBe(p.files[rel]);
    expect(walk(p.dir).filter((f) => /profile-lock|\.pc-/.test(f))).toEqual([]);
    expect(e.status().enabled).toBe(false);
    expect(e.codec.encode(Buffer.from('x')).toString()).toBe('x');
    expect(p.engine().status().enabled).toBe(false);
  });
  it('needs a secret, and a wrong one changes nothing', async () => {
    const p = profile();
    await p.engine().enable({ passphrase: PASS, files: p.rels });
    await expect(p.engine().disable({ files: p.rels })).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(p.engine().disable({ passphrase: 'wrong wrong wrong', files: p.rels })).rejects.toMatchObject({ code: 'WRONG_SECRET' });
    for (const rel of p.rels) expect(isEnvelope(read(p, rel))).toBe(true);
    expect(p.engine().status().state).toBe('encrypted');
  });
  it('a failure part way puts the encrypted files back and keeps the lock', async () => {
    const p = profile();
    await p.engine().enable({ passphrase: PASS, files: p.rels });
    const before = new Map(p.rels.map((rel) => [rel, read(p, rel)]));
    let n = 0;
    const fsMod = faultyFs((to) => /vex-persist-volatile\.json$/.test(to) && ++n === 1);
    const e = createProfileCrypt({ userDataPath: p.dir, fsMod, kdf: KDF });
    await expect(e.disable({ passphrase: PASS, files: p.rels })).rejects.toThrow(/disk fault/);
    for (const [rel, bytes] of before) expect(read(p, rel).equals(bytes)).toBe(true);
    expect(e.status().state).toBe('encrypted');
    expect(walk(p.dir).filter((f) => /\.pc-/.test(f))).toEqual([]);
    await p.engine().unlock(PASS);
  });
  it('run again after a crash in the middle it finishes the job', async () => {
    const p = profile();
    await p.engine().enable({ passphrase: PASS, files: p.rels });
    // The crash: header says decrypting, one file already plain (its encrypted copy as .pc-enc), the rest encrypted.
    const e = p.engine();
    await e.unlock(PASS);
    const h = JSON.parse(read(p, 'profile-lock.json').toString());
    h.state = 'decrypting';
    nodeFs.writeFileSync(path.join(p.dir, 'profile-lock.json'), JSON.stringify(h));
    nodeFs.writeFileSync(path.join(p.dir, 'vex-persist.json.pc-enc'), read(p, 'vex-persist.json'));
    nodeFs.writeFileSync(path.join(p.dir, 'vex-persist.json'), e.codec.decode(read(p, 'vex-persist.json')));
    const fresh = p.engine();
    expect(fresh.status()).toMatchObject({ state: 'decrypting', locked: true });
    await fresh.disable({ passphrase: PASS, files: p.rels });
    for (const rel of p.rels) expect(read(p, rel).toString()).toBe(p.files[rel]);
    expect(walk(p.dir).filter((f) => /profile-lock|\.pc-/.test(f))).toEqual([]);
  });
});

describe('changing the secrets', () => {
  it('a new passphrase opens, the old one does not, the recovery code still does, and no file is rewritten', async () => {
    const p = profile();
    const { recoveryCode } = await p.engine().enable({ passphrase: PASS, files: p.rels });
    const bytesBefore = p.rels.map((rel) => read(p, rel));
    const e = p.engine();
    await expect(e.changePassphrase({ current: 'wrong wrong wrong', next: 'a brand new phrase' })).rejects.toMatchObject({ code: 'WRONG_SECRET' });
    await e.changePassphrase({ current: PASS, next: 'a brand new phrase' });
    expect(p.rels.map((rel) => read(p, rel))).toEqual(bytesBefore);
    await expect(p.engine().unlock(PASS)).rejects.toMatchObject({ code: 'WRONG_SECRET' });
    await p.engine().unlock('a brand new phrase');
    await p.engine().unlockWithRecovery(recoveryCode);
  });
  it('a new recovery code replaces the old one', async () => {
    const p = profile();
    const { recoveryCode } = await p.engine().enable({ passphrase: PASS, files: p.rels });
    const fresh = await p.engine().newRecoveryCode({ passphrase: PASS });
    expect(fresh.recoveryCode).not.toBe(recoveryCode);
    await expect(p.engine().unlockWithRecovery(recoveryCode)).rejects.toMatchObject({ code: 'WRONG_SECRET' });
    await p.engine().unlockWithRecovery(fresh.recoveryCode);
    await p.engine().unlock(PASS);
  });
  it('a weak new passphrase is refused', async () => {
    const p = profile();
    const e = p.engine();
    await e.enable({ passphrase: PASS, files: p.rels });
    await expect(e.changePassphrase({ current: PASS, next: '1234' })).rejects.toMatchObject({ code: 'BAD_INPUT' });
  });
});

describe('codec', () => {
  it('passes plain bytes through when there is no lock, and refuses to write while locked', async () => {
    const p = profile();
    const e = p.engine();
    expect(e.codec.encode(Buffer.from('plain')).toString()).toBe('plain');
    expect(e.codec.decode(Buffer.from('plain')).toString()).toBe('plain');
    await e.enable({ passphrase: PASS, files: p.rels });
    const locked = p.engine();
    expect(() => locked.codec.encode(Buffer.from('x'))).toThrow(/locked/);
    await locked.unlock(PASS);
    expect(isEnvelope(locked.codec.encode(Buffer.from('x')))).toBe(true);
    locked.lock();
    expect(() => locked.codec.encode(Buffer.from('x'))).toThrow(/locked/);
  });
  it('a plaintext file next to encrypted ones still reads (a profile part way through)', async () => {
    const p = profile();
    const e = p.engine();
    await e.enable({ passphrase: PASS, files: p.rels });
    expect(e.codec.decode(Buffer.from('{"plain":1}')).toString()).toBe('{"plain":1}');
  });
});

describe('profileFiles and leftovers', () => {
  it('lists the preference copies and the chosen store keys, not temp or lock files', () => {
    const p = profile({ 'vex-persist.json.gen1': '{}', 'vex-persist.json.corrupt-20260101000000': '{}', 'vex-persist.json.pc-bak': 'x', 'vex-persist.json.tmp': 'x', 'vex-storage/theme.json': '"x"', 'profile-lock.json': '{}' });
    const list = profileFiles(p.dir, nodeFs, ['tabs', 'groups']);
    expect(list).toEqual(expect.arrayContaining(['vex-persist.json', 'vex-persist.json.bak', 'vex-persist.json.gen1', 'vex-persist.json.corrupt-20260101000000', 'vex-persist-volatile.json', 'vex-storage/tabs.json']));
    expect(list).not.toContain('vex-persist.json.pc-bak');
    expect(list).not.toContain('vex-persist.json.tmp');
    expect(list).not.toContain('vex-storage/theme.json');
    expect(list).not.toContain('profile-lock.json');
    expect(() => profileFiles(p.dir, nodeFs, ['../x'])).toThrow(/invalid storage key/);
  });
  it('keeps a plaintext leftover whose encrypted partner does not open, and removes one whose partner does', async () => {
    const p = profile();
    const e = p.engine();
    await e.enable({ passphrase: PASS, files: p.rels });
    nodeFs.writeFileSync(path.join(p.dir, 'vex-persist.json.pc-bak'), 'plain leftover');
    const volatileBytes = read(p, 'vex-persist-volatile.json');
    volatileBytes[volatileBytes.length - 2] ^= 1;
    nodeFs.writeFileSync(path.join(p.dir, 'vex-persist-volatile.json'), volatileBytes);
    nodeFs.writeFileSync(path.join(p.dir, 'vex-persist-volatile.json.pc-bak'), 'plain leftover too');
    const kept = e.sweepResidue();
    expect(kept).toContain('vex-persist-volatile.json.pc-bak');
    expect(kept).not.toContain('vex-persist.json.pc-bak');
    expect(nodeFs.existsSync(path.join(p.dir, 'vex-persist.json.pc-bak'))).toBe(false);
  });
});
