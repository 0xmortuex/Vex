// Leftover temp files from Vex's own saves are removed at start (audit S9),
// and nothing else ever is.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { removeStaleTemps, isVexTemp, MIN_AGE_MS } = require('../../src/main/temp-cleanup.js');
const { atomicWrite } = require('../../src/main/file-store.js');

let root, store;
const UUID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const old = Date.now() - MIN_AGE_MS - 60000;
function make(dir, name, { age = old, data = '' } = {}) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, data);
  fs.utimesSync(f, age / 1000, age / 1000);
  return f;
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-temp-cleanup-'));
  store = path.join(root, 'vex-storage');
  fs.mkdirSync(store);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('leftover temp files', () => {
  it('removes an old save leftover, like the owner\'s 0-byte tabs.json one', async () => {
    const tabs = make(store, `tabs.json.${UUID}.tmp`);
    const vault = make(root, `vault.dat.${UUID.replace('3f2b', 'aaaa')}.tmp`, { data: 'x' });
    const r = await removeStaleTemps([root, store]);
    expect(r.failed).toEqual([]);
    expect(r.removed.sort()).toEqual([tabs, vault].sort());
    expect(fs.existsSync(tabs)).toBe(false);
    expect(fs.existsSync(vault)).toBe(false);
  });

  it('leaves everything else alone', async () => {
    const keep = [
      make(store, 'tabs.json'),
      make(store, 'tabs.json.bak'),
      make(root, `tabs.json.${UUID}.tmp`, { age: Date.now() - 60000 }),      // a save in progress
      make(root, 'notes.tmp'),                                                // not ours
      make(root, 'session-routing.json.tmp'),                                 // another writer's name
      make(root, 'profiles.json.1234.tmp'),                                   // pid-named
      make(root, `${UUID}.tmp`),                                              // no file name in front
      make(root, `x.${UUID.toUpperCase()}.tmp`),
    ];
    const nested = path.join(store, 'deeper');
    fs.mkdirSync(nested);
    keep.push(make(nested, `tabs.json.${UUID}.tmp`));                         // not a folder it was given
    fs.mkdirSync(path.join(root, `dir.${UUID}.tmp`));                         // a folder with the name
    const r = await removeStaleTemps([root, store]);
    expect(r).toEqual({ removed: [], failed: [] });
    for (const f of keep) expect(fs.existsSync(f), f).toBe(true);
    expect(fs.existsSync(path.join(root, `dir.${UUID}.tmp`))).toBe(true);
  });

  it('matches exactly what atomicWrite leaves', async () => {
    const fsSrc = fs.readFileSync(path.join(__dirname, '../../src/main/file-store.js'), 'utf8');
    expect(fsSrc).toContain("const temp = file + '.' + randomUUID() + '.tmp';");
    for (let i = 0; i < 50; i++) expect(isVexTemp('tabs.json.' + require('node:crypto').randomUUID() + '.tmp')).toBe(true);
    // A finished save leaves nothing for the clean-up to find.
    await atomicWrite(path.join(store, 'tabs.json'), '{}', { backup: false });
    expect(fs.readdirSync(store).filter(isVexTemp)).toEqual([]);
  });

  it('a folder that does not exist is skipped; the start-up call is wired', async () => {
    expect(await removeStaleTemps([path.join(root, 'missing')])).toEqual({ removed: [], failed: [] });
    const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(MAIN).toContain("require('./main/temp-cleanup').removeStaleTemps([userDataPath, storagePath], { holdsProfileLock: gotTheLock, inUse: require('./main/file-store').isTempInUse })");
  });

  it('says which files it could not remove', async () => {
    const f = make(store, `tabs.json.${UUID}.tmp`);
    const fsp = { ...fs.promises, unlink: async () => { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; } };
    const r = await removeStaleTemps([store], { fsp });
    expect(r.removed).toEqual([]);
    expect(r.failed).toEqual([{ file: f, error: 'EPERM: operation not permitted' }]);
  });
});

// A13: an interrupted save is cleaned after 10 minutes, not a day, but only when this process holds the profile's
// single-instance lock, and never a temp file a live write of this process is using. Fake clock, fake directory.
describe('leftovers after 10 minutes (A13)', () => {
  const { LOCKED_MIN_AGE_MS } = require('../../src/main/temp-cleanup.js');
  const { isTempInUse } = require('../../src/main/file-store.js');
  const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
  const U = (n) => `3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f6${n}`;
  const names = {
    fresh: `a.json.${U(0)}.tmp`, nineMin: `b.json.${U(1)}.tmp`, elevenMin: `c.json.${U(2)}.tmp`,
    hour: `d.json.${U(3)}.tmp`, live: `e.json.${U(4)}.tmp`, notOurs: 'notes.tmp', real: 'a.json',
  };
  const ages = { fresh: 5_000, nineMin: 9 * 60_000, elevenMin: 11 * 60_000, hour: 3600_000, live: 3600_000, notOurs: 3600_000, real: 3600_000 };
  const fake = () => {
    const unlinked = [];
    const byName = Object.fromEntries(Object.entries(names).map(([k, n]) => [n, ages[k]]));
    const fsp = {
      readdir: async () => Object.keys(byName).map(n => ({ name: n, isFile: () => true })),
      lstat: async (f) => ({ isFile: () => true, mtimeMs: NOW - byName[path.basename(f)] }),
      unlink: async (f) => { unlinked.push(path.basename(f)); },
    };
    return { fsp, unlinked };
  };

  it('without the lock the age is still a day (nothing of the above is old enough)', async () => {
    const { fsp, unlinked } = fake();
    const r = await removeStaleTemps(['/p'], { now: NOW, fsp });
    expect(r.removed).toEqual([]);
    expect(unlinked).toEqual([]);
  });

  it('holding the lock: removes those older than 10 minutes, keeps the younger, the not-ours and the real file', async () => {
    const { fsp, unlinked } = fake();
    const r = await removeStaleTemps(['/p'], { now: NOW, fsp, holdsProfileLock: true });
    expect(unlinked.sort()).toEqual([names.elevenMin, names.hour, names.live].sort());
    expect(r.failed).toEqual([]);
    expect(LOCKED_MIN_AGE_MS).toBe(10 * 60 * 1000);
  });

  it('never a temp file a live write is using, however old it looks', async () => {
    const { fsp, unlinked } = fake();
    await removeStaleTemps(['/p'], { now: NOW, fsp, holdsProfileLock: true, inUse: (f) => path.basename(f) === names.live });
    expect(unlinked).not.toContain(names.live);
    expect(unlinked.sort()).toEqual([names.elevenMin, names.hour].sort());
  });

  it('an explicit age still wins over the lock rule', async () => {
    const { fsp, unlinked } = fake();
    await removeStaleTemps(['/p'], { now: NOW, fsp, holdsProfileLock: true, minAgeMs: 2 * 3600_000 });
    expect(unlinked).toEqual([]);
  });

  it('file-store reports the temp file of a write that is running, and forgets it after (async and sync, success and failure)', async () => {
    const target = path.join(store, 'live.json');
    const seen = [];
    const realOpen = fs.promises.open;
    fs.promises.open = async (f, ...a) => { seen.push(['async', f, isTempInUse(f)]); return realOpen.call(fs.promises, f, ...a); };
    try { await atomicWrite(target, '{}', { backup: false }); } finally { fs.promises.open = realOpen; }
    const { atomicWriteSync } = require('../../src/main/file-store.js');
    const syncFs = { ...fs, openSync: (f, ...a) => { seen.push(['sync', f, isTempInUse(f)]); return fs.openSync(f, ...a); } };
    atomicWriteSync(target, '{"a":1}', { fsImpl: syncFs });
    const boom = { ...fs, openSync: (f) => { seen.push(['boom', f, isTempInUse(f)]); throw new Error('injected'); } };
    expect(() => atomicWriteSync(target, '{"b":1}', { fsImpl: boom })).toThrow(/injected/);
    expect(seen.map(s => [s[0], s[2]])).toEqual([['async', true], ['sync', true], ['boom', true]]);
    for (const s of seen) expect(isTempInUse(s[1])).toBe(false);
  });

  it('the real directory: a 20-minute-old leftover goes, a fresh one stays (real files, real clock arithmetic)', async () => {
    const old20 = make(store, `x.json.${U(5)}.tmp`, { age: Date.now() - 20 * 60_000 });
    const fresh = make(store, `y.json.${U(6)}.tmp`, { age: Date.now() - 60_000 });
    const r = await removeStaleTemps([store], { holdsProfileLock: true });
    expect(r.removed).toEqual([old20]);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
