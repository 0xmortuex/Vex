// @vitest-environment node
//
// The backup made before each update (src/main/update-backups.js): the same
// file Settings › Backup saves, kept in userData/backups as
// before-<version>-<date>.json, newest five only, and read back by name only.
// Also the one place the first-start backup and the old settings-backups copies go.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createUpdateBackups, KEEP } = require('../../src/main/update-backups.js');

let dir, clock, log;
const backup = (items = { 'vex.notes': '[]' }) => JSON.stringify({ v: 1, at: '2026-10-01T10:00:00.000Z', app: '2.35.0', items, stores: {} });
const make = () => createUpdateBackups({ fs, dir, now: () => new Date(clock), log });

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vex-updbk-')), 'backups');
  clock = new Date(2026, 9, 1, 14, 5, 9).getTime();
  log = { warn: vi.fn() };
});
afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));

describe('before an update', () => {
  it('saves the backup under the version it comes before, with the date', () => {
    const r = make().save('2.35.1', backup());
    expect(r.name).toBe('before-2.35.1-2026-10-01-140509.json');
    expect(fs.readFileSync(path.join(dir, r.name), 'utf8')).toBe(backup());
    expect(fs.readdirSync(dir)).toEqual([r.name]);
  });

  it('keeps only the newest five', () => {
    const b = make();
    for (let i = 0; i < 7; i++) { b.save('2.35.' + (i + 1), backup()); clock += 60000; }
    expect(KEEP).toBe(5);
    expect(b.list().map(x => x.version)).toEqual(['2.35.7', '2.35.6', '2.35.5', '2.35.4', '2.35.3']);
    expect(fs.readdirSync(dir)).toHaveLength(5);
  });

  it('lists them newest first, with version, time and size, and reads one back', () => {
    const b = make();
    b.save('2.35.1', backup());
    clock += 3600 * 1000;
    b.save('2.35.2', backup({ 'vex.theme': 'oxford' }));
    fs.writeFileSync(path.join(dir, 'something-else.json'), '{}');
    const list = b.list();
    expect(list.map(x => x.name)).toEqual(['before-2.35.2-2026-10-01-150509.json', 'before-2.35.1-2026-10-01-140509.json']);
    expect(list[0]).toMatchObject({ kind: 'before', version: '2.35.2', at: new Date(2026, 9, 1, 15, 5, 9).getTime(), bytes: Buffer.byteLength(backup({ 'vex.theme': 'oxford' })) });
    expect(JSON.parse(b.read(list[0].name)).items).toEqual({ 'vex.theme': 'oxford' });
  });

  it('refuses what is not a backup, and names that are not its own', () => {
    const b = make();
    expect(() => b.save('2.35.1', '')).toThrow(/empty/);
    expect(() => b.save('2.35.1', '{not json')).toThrow(/not readable/);
    expect(() => b.save('2.35.1', JSON.stringify({ v: 2, items: {} }))).toThrow(/backup format/);
    expect(() => b.save('../../evil', backup())).toThrow(/Not a version/);
    expect(() => b.save('2.35.1', JSON.stringify({ v: 1, items: { big: 'x'.repeat(11 * 1024 * 1024) } }))).toThrow(/larger than 10 MB/);
    expect(() => b.read('../settings.json')).toThrow(/not a backup Vex made/);
    expect(() => b.read('before-2.35.1-2026-10-01-140509.json\\..\\x')).toThrow(/not a backup Vex made/);
    expect(b.list()).toEqual([]);
  });

  it('a backup that cannot be written is an error, and leaves nothing half-written', () => {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, 'a file where the folder should be');
    expect(() => make().save('2.35.1', backup())).toThrow(/^Vex could not save the backup in its backups folder \(E[A-Z]+\)$/);
    expect(log.warn).toHaveBeenCalled();
    expect(fs.readdirSync(path.dirname(dir))).toEqual(['backups']);
  });
});

// The first start of a version installed some other way (safe-mode.js calls
// it): the same file, from vex-persist.json, without the secrets.
describe('at the first start of a new version', () => {
  let persist;
  beforeEach(() => {
    persist = path.join(path.dirname(dir), 'vex-persist.json');
    fs.writeFileSync(persist, JSON.stringify({
      __vexPreferenceStore: 1,
      'vex.theme': 'oxford', 'vex.notes': '[1]',
      'vex.lockPin': 'pbkdf2$hash', 'vex.syncToken': 'abc', 'vex.mcpServers': '[{"url":"https://x?token=1"}]',
      'vex.installedAt': '1', 'vex.aiConversations': '[]', 'vex.history': '[]',
      'other': 'x',
    }));
  });

  it('backs up the settings as Settings › Backup would, secrets left out', () => {
    const r = make().saveAtFirstStart({ version: '2.35.2', from: '2.35.1', persistFile: persist, since: 0 });
    expect(r.name).toBe('before-2.35.2-2026-10-01-140509.json');
    const data = JSON.parse(fs.readFileSync(path.join(dir, r.name), 'utf8'));
    expect(data).toMatchObject({ v: 1, app: '2.35.1', stores: {}, madeAt: 'first-start' });
    expect(data.items).toEqual({ 'vex.theme': 'oxford', 'vex.notes': '[1]' });
    expect(data.skipped).toBe(3);
  });

  it('is not made again when the update cover already backed up for this version since the last start', () => {
    const b = make();
    const since = clock - 60000;
    b.save('2.35.2', backup());
    clock += 120000;
    expect(b.saveAtFirstStart({ version: '2.35.2', persistFile: persist, since })).toBeNull();
    // An old backup for the same version (gone back and forth) does not count.
    expect(b.saveAtFirstStart({ version: '2.35.2', persistFile: persist, since: clock - 1000 }).name).toMatch(/^before-2\.35\.2-/);
  });

  it('no settings yet: nothing to back up; unreadable settings: an error', () => {
    fs.rmSync(persist);
    expect(make().saveAtFirstStart({ version: '2.35.2', persistFile: persist })).toBeNull();
    fs.writeFileSync(persist, '{broken');
    expect(() => make().saveAtFirstStart({ version: '2.35.2', persistFile: persist })).toThrow(/could not read its settings/);
    expect(make().list()).toEqual([]);
  });

  it('a backups folder that cannot be read is an error that names no path', () => {
    fs.writeFileSync(dir, 'a file where the folder should be');
    expect(() => make().saveAtFirstStart({ version: '2.35.2', persistFile: persist })).toThrow(/^Vex could not read its backups folder \(E[A-Z]+\)$/);
  });
});

// Until v18.59 the first start kept raw copies of vex-persist.json in
// settings-backups. They are moved here once, secrets out, and stay restorable.
describe('the older settings copies', () => {
  let legacy;
  beforeEach(() => {
    legacy = path.join(path.dirname(dir), 'settings-backups');
    fs.mkdirSync(legacy, { recursive: true });
  });
  const put = (name, value, when) => {
    const f = path.join(legacy, name);
    fs.writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value));
    fs.utimesSync(f, when / 1000, when / 1000);
  };

  it('are converted into the backups folder, listed and read back, and only then removed', () => {
    put('vex-persist-2.31.89.json', { 'vex.theme': 'old', 'vex.history': '[1]', 'vex.lockPin': 'h', 'vex.syncToken': 't' }, new Date(2026, 8, 1, 8, 0, 0).getTime());
    put('vex-persist-first-run.json', { 'vex.theme': 'first' }, new Date(2026, 7, 1, 8, 0, 0).getTime());
    const b = make();
    const r = b.migrateLegacy(legacy);
    expect(r.failed).toEqual([]);
    expect(r.moved.sort()).toEqual(['settings-2.31.89-2026-09-01-080000.json', 'settings-first-run-2026-08-01-080000.json']);
    expect(fs.existsSync(legacy)).toBe(false);
    const list = b.list();
    expect(list.map(x => [x.kind, x.version])).toEqual([['settings', '2.31.89'], ['settings', 'first-run']]);
    const data = JSON.parse(b.read(list[0].name));
    // Everything a restore can write is still there; the secrets are not.
    expect(data).toMatchObject({ v: 1, app: '2.31.89', items: { 'vex.theme': 'old', 'vex.history': '[1]' }, skipped: 2 });
    expect(Object.keys(data.items)).toEqual(['vex.theme', 'vex.history']);
    expect(make().migrateLegacy(legacy)).toEqual({ moved: [], failed: [] });
  });

  it('one that cannot be converted stays where it was, and says why', () => {
    put('vex-persist-2.31.88.json', '{not json', Date.now());
    put('notes.txt', 'mine', Date.now());
    const r = make().migrateLegacy(legacy);
    expect(r.moved).toEqual([]);
    expect(r.failed.map(f => f.name)).toEqual(['vex-persist-2.31.88.json']);
    expect(fs.readdirSync(legacy).sort()).toEqual(['notes.txt', 'vex-persist-2.31.88.json']);
  });

  it('one that cannot be written is not removed', () => {
    put('vex-persist-2.31.89.json', { 'vex.theme': 'old' }, Date.now());
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, 'a file where the folder should be');
    const r = make().migrateLegacy(legacy);
    expect(r.failed).toEqual([{ name: 'vex-persist-2.31.89.json', error: expect.stringMatching(/could not save the backup/) }]);
    expect(fs.readdirSync(legacy)).toEqual(['vex-persist-2.31.89.json']);
  });

  it('count toward the same newest five when the next backup is saved', () => {
    for (let i = 0; i < 5; i++) put(`vex-persist-2.31.${i}.json`, { 'vex.theme': String(i) }, new Date(2026, 8, 1 + i).getTime());
    const b = make();
    b.migrateLegacy(legacy);
    expect(b.list()).toHaveLength(5);
    const saved = b.save('2.35.1', backup());
    expect(saved.removed).toEqual(['settings-2.31.0-2026-09-01-000000.json']);
    expect(b.list()[0].name).toBe(saved.name);
  });
});