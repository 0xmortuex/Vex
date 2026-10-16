// T0-012: the settings file is checked on every load (checksum), a bad one is
// kept aside and replaced from the newest good copy, and the history-like keys
// can live in a second file (off unless asked) with a verified, reversible
// migration. Fixture profiles are built in a temp folder; nothing real is read.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createPreferenceStore, VOLATILE_KEYS, readPreferenceFile } = req('../../src/main/storage.js');
const { createUpdateBackups } = req('../../src/main/update-backups.js');

const dirs = [];
function profile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-pref-'));
  dirs.push(dir);
  return { dir, main: path.join(dir, 'vex-persist.json'), vol: path.join(dir, 'vex-persist-volatile.json') };
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); vi.restoreAllMocks(); });

const quiet = { error: vi.fn(), warn: vi.fn() };
const history = JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ id: 'h' + i, url: 'https://site' + i + '.example/', title: 'Page ' + i })));
// A profile as an older Vex left it: one file, no checksum, history inside.
function legacy(p, extra = {}) {
  const data = { __vexPreferenceStore: 1, 'vex.theme': '"dark"', 'vex.zooms': '{"a":1}', 'vex.history': history, 'vex.downloads': '[{"id":"d1"}]', 'vex.aiNews.state': '{"seen":[1,2,3]}', ...extra };
  fs.writeFileSync(p.main, JSON.stringify(data));
  return data;
}
const open = (p, opts = {}) => createPreferenceStore(p.main, { volatileFile: p.vol, log: quiet, volatileDelayMs: 20, ...opts });
const wantSplit = { splitEnabled: () => true };
const wait = ms => new Promise(r => setTimeout(r, ms));

describe('checksum and recovery', () => {
  it('writes a checksum and reads the file back; a file without one (older Vex) still loads', async () => {
    const p = profile();
    const data = legacy(p);
    const s = open(p);
    expect(s.load()).toEqual(data);
    await s.set('vex.theme', '"light"');
    const onDisk = JSON.parse(fs.readFileSync(p.main, 'utf8'));
    expect(onDisk.__vexChecksum).toMatch(/^[0-9a-f]{64}$/);
    const again = open(p).load();
    expect(again['vex.theme']).toBe('"light"');
    expect(again.__vexChecksum).toBeUndefined();
    expect(readPreferenceFile(p.main)['vex.theme']).toBe('"light"');
  });

  it('a file that is valid JSON but does not match its checksum is not trusted', async () => {
    const p = profile();
    legacy(p);
    const s = open(p);
    await s.set('vex.theme', '"light"');
    await s.set('vex.theme', '"blue"');                    // .bak now holds "light"
    const text = fs.readFileSync(p.main, 'utf8').replace('blue', 'blu3');   // parses, same length, wrong sum
    fs.writeFileSync(p.main, text);
    const log = { error: vi.fn(), warn: vi.fn() };
    const loaded = open(p, { log }).load();
    expect(loaded['vex.theme']).toBe('"light"');
    expect(log.error).toHaveBeenCalled();
    expect(fs.readdirSync(p.dir).filter(n => n.startsWith('vex-persist.json.corrupt-'))).toHaveLength(1);
    // The recovered file is the one on disk now and reads cleanly.
    expect(readPreferenceFile(p.main)['vex.theme']).toBe('"light"');
  });

  it('a truncated file comes back from the backup and the damaged one is kept', async () => {
    const p = profile();
    legacy(p);
    const s = open(p);
    await s.set('vex.a', '1');
    await s.set('vex.b', '2');
    const full = fs.readFileSync(p.main, 'utf8');
    fs.writeFileSync(p.main, full.slice(0, Math.floor(full.length / 2)));
    const loaded = open(p).load();
    expect(loaded['vex.a']).toBe('1');                      // .bak = the file before the last save
    expect(loaded['vex.b']).toBeUndefined();
    const kept = fs.readdirSync(p.dir).filter(n => n.includes('.corrupt-'));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(p.dir, kept[0]), 'utf8')).toBe(full.slice(0, Math.floor(full.length / 2)));
  });

  it('falls back to a rolling generation when the file and its backup are both bad, and throws when nothing reads', async () => {
    const p = profile();
    legacy(p);
    open(p).load();                                          // a session start rotates gen1
    expect(fs.existsSync(p.main + '.gen1')).toBe(true);
    fs.writeFileSync(p.main, '{broken');
    fs.writeFileSync(p.main + '.bak', '{broken too');
    expect(open(p).load()['vex.theme']).toBe('"dark"');
    for (const f of [p.main, p.main + '.bak', p.main + '.gen1', p.main + '.gen2', p.main + '.gen3']) fs.writeFileSync(f, 'nope');
    expect(() => open(p).load()).toThrow();
    // Nothing was overwritten on the way.
    expect(fs.readFileSync(p.main, 'utf8')).toBe('nope');
  });

  it('keeps the generations moving: at most one every six hours', async () => {
    const p = profile();
    legacy(p);
    let t = 1_000_000;
    const s = open(p, { now: () => t });
    s.load();
    await s.set('vex.x', '1');
    t += 60_000;
    await s.set('vex.x', '2');
    expect(fs.existsSync(p.main + '.gen2')).toBe(false);
    t += 7 * 3600 * 1000;
    await s.set('vex.x', '3');
    expect(fs.existsSync(p.main + '.gen2')).toBe(true);
    expect(readPreferenceFile(p.main + '.gen1')['vex.x']).toBe('2');
  });

  it('a profile with no file starts empty, as before', () => {
    const p = profile();
    expect(open(p).load()).toEqual({});
  });
});

describe('the volatile split (off unless asked)', () => {
  it('does nothing while it is off: one file, no volatile file', async () => {
    const p = profile();
    legacy(p);
    const s = open(p);
    s.load();
    await s.set('vex.history', '[]');
    expect(fs.existsSync(p.vol)).toBe(false);
    expect(JSON.parse(fs.readFileSync(p.main, 'utf8'))['vex.history']).toBe('[]');
    expect(s.isSplit()).toBe(false);
  });

  it('migrates a fixture profile: nothing lost, old file kept, new layout reads back the same', async () => {
    const p = profile();
    const data = legacy(p);
    const before = fs.readFileSync(p.main);
    const s = open(p, wantSplit);
    const loaded = s.load();
    expect(loaded).toEqual(data);                           // the interface sees the same keys and values
    expect(s.isSplit()).toBe(true);
    expect(fs.readFileSync(p.main + '.pre-split').equals(before)).toBe(true);
    const mainKeys = Object.keys(readPreferenceFile(p.main));
    expect(mainKeys).toContain('vex.theme');
    expect(mainKeys).not.toContain('vex.history');
    expect(Object.keys(readPreferenceFile(p.vol)).sort()).toEqual(['__vexPreferenceStore', 'vex.aiNews.state', 'vex.downloads', 'vex.history']);
    expect(fs.statSync(p.main).size).toBeLessThan(before.length / 2);
    // A second start reads the split layout, sees the same data, and drops the pre-split copy.
    const again = open(p, wantSplit);
    expect(again.load()).toEqual(data);
    expect(fs.existsSync(p.main + '.pre-split')).toBe(false);
  });

  it('writes a volatile change to the volatile file only, and a setting to the settings file only', async () => {
    const p = profile();
    legacy(p);
    const s = open(p, wantSplit);
    s.load();
    const mainBefore = fs.readFileSync(p.main, 'utf8');
    await s.set('vex.history', '["new"]');
    await s.flush();
    expect(fs.readFileSync(p.main, 'utf8')).toBe(mainBefore);
    expect(readPreferenceFile(p.vol)['vex.history']).toBe('["new"]');
    const volBefore = fs.readFileSync(p.vol, 'utf8');
    await s.set('vex.theme', '"light"');
    expect(fs.readFileSync(p.vol, 'utf8')).toBe(volBefore);
    expect(readPreferenceFile(p.main)['vex.theme']).toBe('"light"');
    expect(open(p, wantSplit).load()['vex.history']).toBe('["new"]');
  });

  it('coalesces volatile writes and flush() writes them at once', async () => {
    const p = profile();
    legacy(p);
    const s = open(p, { ...wantSplit, volatileDelayMs: 60_000 });
    s.load();
    for (let i = 0; i < 20; i++) await s.set('vex.history', JSON.stringify([i]));
    expect(readPreferenceFile(p.vol)['vex.history']).toBe(history);   // still the migrated copy
    await s.flush();
    expect(readPreferenceFile(p.vol)['vex.history']).toBe('[19]');
  });

  it('a failed migration puts the old file back and stays single', () => {
    const p = profile();
    const data = legacy(p);
    const before = fs.readFileSync(p.main);
    fs.mkdirSync(p.vol);                                    // the volatile file cannot be written
    fs.writeFileSync(path.join(p.vol, 'x'), '1');
    const log = { error: vi.fn(), warn: vi.fn() };
    const s = open(p, { ...wantSplit, log });
    expect(s.load()).toEqual(data);
    expect(s.isSplit()).toBe(false);
    expect(log.error).toHaveBeenCalled();
    expect(readPreferenceFile(p.main)).toEqual(data);
    expect(fs.readFileSync(p.main + '.pre-split').equals(before)).toBe(true);
  });

  it('a volatile file that is damaged comes back from its backup; settings are untouched', async () => {
    const p = profile();
    legacy(p);
    const s = open(p, wantSplit);
    s.load();
    await s.set('vex.history', '["a"]'); await s.flush();
    await s.set('vex.history', '["b"]'); await s.flush();   // .bak holds ["a"]
    fs.writeFileSync(p.vol, fs.readFileSync(p.vol, 'utf8').slice(0, 30));
    const loaded = open(p, wantSplit).load();
    expect(loaded['vex.history']).toBe('["a"]');
    expect(loaded['vex.theme']).toBe('"dark"');
    expect(fs.readdirSync(p.dir).some(n => n.startsWith('vex-persist-volatile.json.corrupt-'))).toBe(true);
  });

  it('a volatile file that is gone and unrecoverable returns from the copy made before the split', async () => {
    const p = profile();
    const data = legacy(p);
    const s = open(p, wantSplit);
    s.load();                                               // migrated, pre-split kept, no clean start yet
    for (const f of fs.readdirSync(p.dir)) if (f.startsWith('vex-persist-volatile.json')) fs.rmSync(path.join(p.dir, f));
    const loaded = open(p, wantSplit).load();
    expect(loaded['vex.history']).toBe(data['vex.history']);
    expect(loaded['vex.downloads']).toBe(data['vex.downloads']);
  });

  it('switching it off merges the files back into one', async () => {
    const p = profile();
    const data = legacy(p);
    const s = open(p, wantSplit);
    s.load();
    await s.set('vex.history', '["z"]'); await s.flush();
    const off = open(p, { splitEnabled: () => false });
    const loaded = off.load();
    expect(loaded).toEqual({ ...data, 'vex.history': '["z"]' });
    expect(off.isSplit()).toBe(false);
    expect(readPreferenceFile(p.main)['vex.history']).toBe('["z"]');
    expect(readPreferenceFile(p.main).__vexSplit).toBeUndefined();
    expect(fs.existsSync(p.vol)).toBe(false);
    expect(fs.existsSync(p.vol + '.rolled-back')).toBe(true);
    await off.set('vex.history', '["after"]');             // writes the one file again
    expect(readPreferenceFile(p.main)['vex.history']).toBe('["after"]');
  });

  it('clearKeys wipes a volatile key from the file and from every copy', async () => {
    const p = profile();
    legacy(p);
    let t = 5_000_000;
    const s = open(p, { ...wantSplit, now: () => t });
    s.load();
    await s.set('vex.downloads', '[{"id":"secret-download"}]'); await s.flush();
    t += 7 * 3600 * 1000;
    await s.set('vex.downloads', '[{"id":"secret-download2"}]'); await s.flush();
    await s.clearKeys(['vex.downloads']);
    for (const n of fs.readdirSync(p.dir)) {
      if (n.includes('.tmp')) continue;
      expect(fs.readFileSync(path.join(p.dir, n), 'utf8'), n).not.toContain('secret-download');
    }
    expect(open(p, wantSplit).load()['vex.downloads']).toBeUndefined();
  });

  it('the first-start backup before an update includes the keys kept in the second file', async () => {
    const p = profile();
    legacy(p, { 'vex.bookmarks': '[1]' });
    open(p, wantSplit).load();
    const backups = createUpdateBackups({ fs, dir: path.join(p.dir, 'backups') });
    const r = backups.saveAtFirstStart({ version: '2.0.1', from: '2.0.0', persistFile: p.main, volatileFile: p.vol });
    const saved = JSON.parse(backups.read(r.name));
    expect(saved.items['vex.bookmarks']).toBe('[1]');
    expect(saved.items['vex.theme']).toBe('"dark"');
    expect(Object.keys(saved.items).length).toBeGreaterThan(2);
  });

  it('only history-like keys are volatile: no setting the app reads at start', () => {
    for (const k of VOLATILE_KEYS) expect(k).toMatch(/History|Log|history|recentlyClosed|downloads|Snapshots|Cache|state/);
    expect(VOLATILE_KEYS).not.toContain('vex.memorySaver');
    expect(VOLATILE_KEYS).not.toContain('vex.volatileSplit');
  });

  it('a 1.2 MB profile loads and saves fast enough (checksum cost)', async () => {
    const p = profile();
    legacy(p, { 'vex.history': 'x'.repeat(1_000_000) });
    const s = open(p);
    const t0 = performance.now();
    s.load();
    await s.set('vex.theme', '"light"');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
