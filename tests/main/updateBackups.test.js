// @vitest-environment node
//
// The backup made before each update (src/main/update-backups.js): the same
// file Settings › Backup saves, kept in userData/backups as
// before-<version>-<date>.json, newest three only, and read back by name only.
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

  it('keeps only the newest three', () => {
    const b = make();
    for (let i = 0; i < 5; i++) { b.save('2.35.' + (i + 1), backup()); clock += 60000; }
    expect(KEEP).toBe(3);
    expect(b.list().map(x => x.version)).toEqual(['2.35.5', '2.35.4', '2.35.3']);
    expect(fs.readdirSync(dir)).toHaveLength(3);
  });

  it('lists them newest first, with version, time and size, and reads one back', () => {
    const b = make();
    b.save('2.35.1', backup());
    clock += 3600 * 1000;
    b.save('2.35.2', backup({ 'vex.theme': 'oxford' }));
    fs.writeFileSync(path.join(dir, 'something-else.json'), '{}');
    const list = b.list();
    expect(list.map(x => x.name)).toEqual(['before-2.35.2-2026-10-01-150509.json', 'before-2.35.1-2026-10-01-140509.json']);
    expect(list[0]).toMatchObject({ version: '2.35.2', at: new Date(2026, 9, 1, 15, 5, 9).getTime(), bytes: Buffer.byteLength(backup({ 'vex.theme': 'oxford' })) });
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
