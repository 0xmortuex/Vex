// @vitest-environment node
//
// The rolling automatic backup (src/main/auto-backups.js): opt-in, once a day, 7 daily and 4 weekly,
// whole or not at all, never while a game runs / on battery / in quiet hours, and never with a secret in it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createAutoBackups, newestValid, KEEP_DAILY, KEEP_WEEKLY } = require('../../src/main/auto-backups.js');
const { createUpdateBackups } = require('../../src/main/update-backups.js');
const { VexBackup } = require('../../src/renderer/js/backup.js');

const DAY = 24 * 3600 * 1000;
let root, dir, cfg, clock, gates, log;
const snap = (extra = {}) => JSON.stringify(VexBackup.seal({ v: 2, at: '2026-11-01T10:00:00.000Z', app: '2.60.0', includes: [], items: { 'vex.notes': '[1]', 'vex.theme': 'x' }, stores: { settings: { a: 1 } }, main: {}, ...extra }));
const make = (over = {}) => createAutoBackups({ fs, dir, configFile: cfg, VexBackup, now: () => clock, gates, log, ...over });
const names = (d = dir) => fs.readdirSync(d).sort();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-autobk-'));
  dir = path.join(root, 'backups');
  cfg = path.join(root, 'auto-backup.json');
  clock = new Date(2026, 10, 1, 14, 30, 0).getTime();
  gates = { game: () => false, battery: () => false, quiet: () => false, encrypted: () => false };
  log = { warn: vi.fn() };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('opt-in', () => {
  it('is off until the person turns it on: nothing is written and nothing is created', () => {
    const b = make();
    expect(b.state().on).toBe(false);
    expect(b.due()).toEqual({ due: false, why: 'off' });
    expect(b.save(snap())).toEqual({ ok: false, skipped: 'off' });
    expect(fs.existsSync(dir)).toBe(false);
  });
  it('remembers the choice across restarts', () => {
    make().setConfig({ on: true });
    expect(make().state().on).toBe(true);
    make().setConfig({ on: false });
    expect(make().state().on).toBe(false);
  });
  it('refuses a damaged settings file instead of treating it as "off"', () => {
    fs.writeFileSync(cfg, '{nope');
    expect(() => make().state()).toThrow(/cannot be read/);
  });
});

describe('once a day, daily and weekly', () => {
  it('writes a daily and (the first time) a weekly copy, then waits until tomorrow', () => {
    const b = make();
    b.setConfig({ on: true });
    const r = b.save(snap());
    expect(r).toMatchObject({ ok: true, weekly: true });
    expect(names()).toEqual([expect.stringMatching(/^auto-daily-2026-11-01-143000\.json$/), expect.stringMatching(/^auto-weekly-2026-11-01-143000\.json$/)]);
    clock += 3600 * 1000;
    expect(b.save(snap())).toEqual({ ok: false, skipped: 'today' });
    expect(names().length).toBe(2);
    clock += DAY;
    expect(b.save(snap())).toMatchObject({ ok: true, weekly: false });   // a weekly one only every 7 days
    expect(names().length).toBe(3);
  });
  it('keeps 7 daily and 4 weekly, and removes the older ones', () => {
    const b = make();
    b.setConfig({ on: true });
    for (let i = 0; i < 60; i++) { expect(b.save(snap()).ok).toBe(true); clock += DAY; }
    const all = b.list();
    expect(all.filter(x => x.kind === 'daily').length).toBe(KEEP_DAILY);
    expect(all.filter(x => x.kind === 'weekly').length).toBe(KEEP_WEEKLY);
    expect(names().length).toBe(KEEP_DAILY + KEEP_WEEKLY);
    // the newest daily is yesterday's, the oldest weekly is about four weeks back
    expect(all.filter(x => x.kind === 'daily')[0].at).toBeGreaterThan(clock - 2 * DAY);
    expect(all.filter(x => x.kind === 'weekly').at(-1).at).toBeLessThan(clock - 21 * DAY);
  });
  it('the update backups never see these files and never prune them', () => {
    const b = make();
    b.setConfig({ on: true });
    b.save(snap());
    const upd = createUpdateBackups({ fs, dir, now: () => new Date(clock), log });
    expect(upd.list()).toEqual([]);
    for (let i = 0; i < 8; i++) { upd.save('2.60.' + i, JSON.stringify({ v: 1, items: { 'vex.a': '1' }, stores: {} })); clock += 1000; }
    expect(upd.list().length).toBe(5);
    expect(names().filter(n => n.startsWith('auto-')).length).toBe(2);
    b.prune();
    expect(names().filter(n => n.startsWith('before-')).length).toBe(5);
  });
});

describe('it keeps still when it should', () => {
  for (const [gate, why] of [['game', 'game'], ['battery', 'battery'], ['quiet', 'quiet'], ['encrypted', 'profile-encrypted']]) {
    it(`does nothing while the ${gate} gate says so, and records no failure`, () => {
      make().setConfig({ on: true });
      gates[gate] = () => true;
      const b = make();
      expect(b.due()).toEqual({ due: false, why });
      expect(b.save(snap())).toEqual({ ok: false, skipped: why });
      expect(fs.existsSync(dir)).toBe(false);
      expect(b.state().lastFailAt).toBe(0);
      gates[gate] = () => false;
      expect(make().save(snap()).ok).toBe(true);     // and it goes through once the gate opens
    });
  }
});

describe('whole or not at all', () => {
  it('a rename that fails leaves the older backups alone, no half file, and says so once for the day', () => {
    const b = make();
    b.setConfig({ on: true });
    b.save(snap());
    const before = names();
    clock += DAY;
    const flaky = { ...fs, renameSync: (from, to) => { if (String(to).includes(path.sep + 'backups' + path.sep)) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); return fs.renameSync(from, to); } };
    const bad = make({ fs: flaky });
    const r = bad.save(snap());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not save the automatic backup \(EBUSY\)/);
    expect(names()).toEqual(before);                     // nothing new, nothing half-written, no .tmp
    expect(bad.state().lastError).toMatch(/EBUSY/);
    // a second try the same day is not made: one notice a day, no retry storm
    expect(make().due()).toEqual({ due: false, why: 'failed-today' });
    clock += DAY;
    expect(make().save(snap()).ok).toBe(true);
  });
  it('a write that fails half way (disk full) removes its temp file', () => {
    const b = make();
    b.setConfig({ on: true });
    // the small settings file still writes; the backup (a few hundred bytes more) hits the full disk
    const full = { ...fs, writeFileSync: (f, text, ...a) => { if (String(text).length > 200) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); return fs.writeFileSync(f, text, ...a); } };
    const r = make({ fs: full }).save(snap());
    expect(r).toMatchObject({ ok: false });
    expect(fs.existsSync(dir) ? names().filter(x => x.endsWith('.tmp') || x.startsWith('auto-')) : []).toEqual([]);
  });
});

describe('secrets and damage', () => {
  it('scrubs anything the backup filter calls a secret, and the checksum is made over what was kept', () => {
    const b = make();
    b.setConfig({ on: true });
    const text = snap({ items: { 'vex.notes': '[1]', 'vex.lockPin': '{"hash":"HASH-OF-PIN"}', 'vex.mcpServers': '[{"token":"TOKEN-123"}]', 'vex.someApiKey': 'KEY-XYZ', 'not-ours': 'x' } });
    const r = b.save(text);
    expect(r.ok).toBe(true);
    expect(r.stripped).toBe(4);
    const written = fs.readFileSync(path.join(dir, r.name), 'utf8');
    for (const secret of ['HASH-OF-PIN', 'TOKEN-123', 'KEY-XYZ', 'not-ours']) expect(written).not.toContain(secret);
    const data = JSON.parse(written);
    expect(Object.keys(data.items)).toEqual(['vex.notes']);
    expect(VexBackup.verify(data)).toBe('verified');
  });
  it('never keeps a snapshot whose checksum does not match, or one that is not a backup', () => {
    const b = make();
    b.setConfig({ on: true });
    const d = JSON.parse(snap());
    d.items['vex.notes'] = 'changed after sealing';
    expect(b.save(JSON.stringify(d)).error).toMatch(/damaged/);
    clock += DAY;
    expect(b.save('{"nope":1}').error).toMatch(/not in Vex/);
    clock += DAY;
    expect(b.save('x'.repeat(11 * 1024 * 1024)).error).toMatch(/larger than 10 MB/);
    expect(fs.existsSync(dir) ? names() : []).toEqual([]);
  });
  it('reads a name only if it is one of its own', () => {
    const b = make();
    expect(() => b.read('../auto-backup.json')).toThrow(/not a backup Vex made automatically/);
    expect(() => b.read('before-2.0.0-2026-01-01-000000.json')).toThrow(/not a backup/);
  });
});

describe('the second folder', () => {
  it('gets a copy of each file, prunes only its own kind of file, and a failure there does not fail the backup', () => {
    const second = path.join(root, 'OneDrive-Documents');
    fs.mkdirSync(second);
    fs.writeFileSync(path.join(second, 'my-thesis.docx'), 'precious');
    fs.writeFileSync(path.join(second, 'auto-daily-notes.txt'), 'not ours either');
    const b = make();
    b.setConfig({ on: true });
    b.setConfig({ folder2: second });
    for (let i = 0; i < 12; i++) { expect(b.save(snap())).toMatchObject({ ok: true, second: { ok: true } }); clock += DAY; }
    const there = fs.readdirSync(second);
    expect(there).toContain('my-thesis.docx');
    expect(there).toContain('auto-daily-notes.txt');
    expect(there.filter(n => /^auto-daily-\d{4}/.test(n)).length).toBe(KEEP_DAILY);
    fs.rmSync(second, { recursive: true, force: true });                      // the drive went away
    const r = b.save(snap());
    expect(r.ok).toBe(true);
    expect(r.second.ok).toBe(false);
    expect(r.second.error).toMatch(/second copy could not be written/);
    expect(b.state().lastError).toMatch(/second copy/);
    expect(fs.existsSync(path.join(dir, r.name))).toBe(true);
  });
  it('only takes a real, existing, absolute folder', () => {
    const b = make();
    expect(() => b.setConfig({ folder2: 'relative/dir' })).toThrow(/full path/);
    expect(() => b.setConfig({ folder2: path.join(root, 'missing') })).toThrow(/cannot be opened/);
    fs.writeFileSync(path.join(root, 'afile'), 'x');
    expect(() => b.setConfig({ folder2: path.join(root, 'afile') })).toThrow(/not a folder/);
    expect(b.setConfig({ folder2: root }).folder2).toBe(root);
    expect(b.setConfig({ folder2: null }).folder2).toBe(null);
  });
});

describe('the newest valid backup (for the mass sign-out notice)', () => {
  it('skips a newer damaged file and an unreadable one', () => {
    const good = snap();
    const bad = JSON.parse(good); bad.items['vex.notes'] = 'x';
    const found = newestValid([
      { name: 'a', at: 5, read: () => JSON.stringify(bad) },
      { name: 'b', at: 4, read: () => { throw new Error('EBUSY'); } },
      { name: 'c', at: 3, read: () => good },
      { name: 'd', at: 1, read: () => good },
    ], VexBackup);
    expect(found).toEqual({ name: 'c', at: 3 });
    expect(newestValid([{ name: 'a', at: 1, read: () => 'junk' }], VexBackup)).toBe(null);
  });
});
