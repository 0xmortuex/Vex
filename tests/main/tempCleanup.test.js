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
    expect(MAIN).toContain("require('./main/temp-cleanup').removeStaleTemps([userDataPath, storagePath])");
  });

  it('says which files it could not remove', async () => {
    const f = make(store, `tabs.json.${UUID}.tmp`);
    const fsp = { ...fs.promises, unlink: async () => { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; } };
    const r = await removeStaleTemps([store], { fsp });
    expect(r.removed).toEqual([]);
    expect(r.failed).toEqual([{ file: f, error: 'EPERM: operation not permitted' }]);
  });
});
