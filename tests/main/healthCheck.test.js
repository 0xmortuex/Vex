// @vitest-environment node
//
// The health check (src/main/health-check.js): scan changes nothing; a repair
// is made only for a finding the scan reports now; what needs a yes is refused
// without one; everything is kept for undo; stored values are handed back to
// the interface rather than removed behind its back.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createHealthCheck, BIG_KEY_CHARS } = require('../../src/main/health-check.js');
const { validate } = require('../../src/main/ipc-schemas.js');

let dir, persisted, clock;
const p = (...a) => path.join(dir, ...a);
const make = () => createHealthCheck({ fs, userDataPath: dir, getPersisted: () => persisted, now: () => new Date(clock), log: { warn() {}, error() {} } });
const ids = (r) => r.findings.map(f => f.id).sort();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-health-'));
  fs.mkdirSync(p('vex-storage'));
  persisted = { 'vex.theme': '"dark"', 'vex.notes': '[{"a":1}]' };
  fs.writeFileSync(p('vex-persist.json'), JSON.stringify(persisted));
  clock = new Date(2026, 9, 16, 12, 0, 0).getTime();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('scan', () => {
  it('finds nothing on a healthy profile, and changes nothing', () => {
    const before = fs.readdirSync(dir).sort();
    const r = make().scan();
    expect(r.findings).toEqual([]);
    expect(r.checked.length).toBeGreaterThan(3);
    expect(fs.readdirSync(dir).sort()).toEqual(before);
  });

  it('reports a damaged store with a good .bak as a safe repair', () => {
    fs.writeFileSync(p('vex-storage', 'settings.json'), '{ broken');
    fs.writeFileSync(p('vex-storage', 'settings.json.bak'), JSON.stringify({ $vexStore: 1, data: { a: 1 } }));
    const f = make().scan().findings.find(x => x.id === 'file-corrupt:vex-storage/settings.json');
    expect(f.severity).toBe('error');
    expect(f.fix).toMatchObject({ action: 'restore-bak', confirm: false });
  });

  it('a damaged store with no good copy needs a yes', () => {
    fs.writeFileSync(p('vex-storage', 'notes.json'), 'nope');
    const f = make().scan().findings.find(x => x.id === 'file-corrupt:vex-storage/notes.json');
    expect(f.fix).toMatchObject({ action: 'quarantine', confirm: true });
  });

  it('flags a value that looks like JSON but is not, a wrong kind, and an oversized one', () => {
    persisted['vex.broken'] = '{"a": [1,';
    persisted['vex.wrong'] = { not: 'text' };
    persisted['vex.huge'] = 'x'.repeat(BIG_KEY_CHARS + 1);
    const got = ids(make().scan());
    expect(got).toEqual(expect.arrayContaining(['key-json:vex.broken', 'key-type:vex.wrong', 'key-big:vex.huge']));
    expect(got).not.toContain('key-json:vex.notes');
  });

  it('finds old temp files, and leaves a fresh one (a save may be in progress)', () => {
    fs.writeFileSync(p('vex-persist.json.1111.tmp'), 'x');
    fs.writeFileSync(p('vex-storage', 'fresh.json.2222.tmp'), 'x');
    const old = new Date(clock - 3600e3);
    fs.utimesSync(p('vex-persist.json.1111.tmp'), old, old);
    fs.utimesSync(p('vex-storage', 'fresh.json.2222.tmp'), new Date(clock), new Date(clock));
    const got = ids(make().scan());
    expect(got).toContain('tmp:vex-persist.json.1111.tmp');
    expect(got).not.toContain('tmp:vex-storage/fresh.json.2222.tmp');
  });

  it('reports orphans and old migration leftovers without offering to delete them', () => {
    fs.writeFileSync(p('vex-storage', 'gone.json.bak'), '{}');
    fs.mkdirSync(p('settings-backups'));
    fs.writeFileSync(p('settings-backups', 'vex-persist-x.json'), '{}');
    fs.writeFileSync(p('vex-storage', 'history.json'), '{}');
    const r = make().scan();
    for (const id of ['orphan-bak:gone.json.bak', 'legacy-waiting', 'history-json']) {
      expect(r.findings.find(f => f.id === id).fix).toBeNull();
    }
  });

  it('never returns an internal path to the interface', () => {
    fs.writeFileSync(p('vex-persist.json.1.tmp'), 'x');
    const old = new Date(clock - 3600e3);
    fs.utimesSync(p('vex-persist.json.1.tmp'), old, old);
    expect(JSON.stringify(make().scan())).not.toContain(dir.replace(/\\/g, '\\\\'));
  });
});

describe('repair and undo', () => {
  it('restores the .bak and keeps the damaged file for undo', () => {
    fs.writeFileSync(p('vex-storage', 'settings.json'), '{ broken');
    const good = JSON.stringify({ $vexStore: 1, data: { a: 1 } });
    fs.writeFileSync(p('vex-storage', 'settings.json.bak'), good);
    const h = make();
    const r = h.fix(['file-corrupt:vex-storage/settings.json']);
    expect(r.applied).toHaveLength(1);
    expect(fs.readFileSync(p('vex-storage', 'settings.json'), 'utf8')).toBe(good);
    expect(h.scan().findings).toEqual([]);
    const u = h.undo(r.run);
    expect(u.restored).toEqual(['vex-storage/settings.json']);
    expect(fs.readFileSync(p('vex-storage', 'settings.json'), 'utf8')).toBe('{ broken');
  });

  it('refuses what needs a yes unless it is confirmed, then keeps it for undo', () => {
    fs.writeFileSync(p('vex-storage', 'notes.json'), 'nope');
    const h = make();
    const id = 'file-corrupt:vex-storage/notes.json';
    const refused = h.fix([id]);
    expect(refused.applied).toEqual([]);
    expect(refused.skipped[0].reason).toMatch(/confirmation/);
    expect(fs.existsSync(p('vex-storage', 'notes.json'))).toBe(true);
    const r = h.fix([id], { confirmed: true });
    expect(fs.existsSync(p('vex-storage', 'notes.json'))).toBe(false);
    h.undo(r.run);
    expect(fs.readFileSync(p('vex-storage', 'notes.json'), 'utf8')).toBe('nope');
  });

  it('hands stored values back to the interface instead of removing them, and undo returns them', () => {
    persisted['vex.broken'] = '{"a": [1,';
    const h = make();
    const r = h.fix(['key-json:vex.broken'], { confirmed: true });
    expect(r.removeKeys).toEqual(['vex.broken']);
    expect(persisted['vex.broken']).toBe('{"a": [1,');   // main did not touch it
    const u = h.undo(r.run);
    expect(u.restoreKeys).toEqual({ 'vex.broken': '{"a": [1,' });
  });

  it('removes only a leftover temp file it found itself, and ignores ids it did not report', () => {
    fs.writeFileSync(p('vex-persist.json.1.tmp'), 'x');
    const old = new Date(clock - 3600e3);
    fs.utimesSync(p('vex-persist.json.1.tmp'), old, old);
    const h = make();
    const r = h.fix(['tmp:vex-persist.json.1.tmp', 'tmp:vex-persist.json', 'file-corrupt:../../etc/passwd']);
    expect(r.applied.map(a => a.id)).toEqual(['tmp:vex-persist.json.1.tmp']);
    expect(r.skipped).toHaveLength(2);
    expect(fs.existsSync(p('vex-persist.json'))).toBe(true);
    expect(fs.existsSync(p('vex-persist.json.1.tmp'))).toBe(false);
    h.undo(r.run);
    expect(fs.existsSync(p('vex-persist.json.1.tmp'))).toBe(true);
  });

  it('keeps only the last three undo records, and only undoes runs it made', () => {
    const h = make();
    const made = [];
    for (let i = 0; i < 5; i++) {
      clock += 1000;
      persisted['vex.broken'] = '[' + i;
      made.push(h.fix(['key-json:vex.broken'], { confirmed: true }).run);
    }
    expect(h.runs()).toHaveLength(3);
    expect(() => h.undo('../..')).toThrow(/not a repair/);
    expect(() => h.undo(made[0])).toThrow(/cannot be undone/);
  });
});

describe('IPC contract', () => {
  it('a scan takes nothing; a repair names ids; an undo names a run', () => {
    expect(() => validate('health:scan', [])).not.toThrow();
    expect(() => validate('health:scan', ['x'])).toThrow();
    expect(() => validate('health:fix', [['tmp:a'], true])).not.toThrow();
    expect(() => validate('health:fix', [['tmp:a']])).not.toThrow();
    expect(() => validate('health:fix', [[]])).toThrow();
    expect(() => validate('health:fix', ['tmp:a'])).toThrow();
    expect(() => validate('health:fix', [[{ path: 'C:/x' }]])).toThrow();
    expect(() => validate('health:undo', ['20261016-120000'])).not.toThrow();
    expect(() => validate('health:undo', ['..\\..\\x'])).toThrow();
  });

  it('is exposed by the preload, UI-only, and off in private windows', () => {
    const preload = fs.readFileSync('src/preload.js', 'utf8');
    for (const c of ['health:scan', 'health:fix', 'health:undo']) expect(preload).toContain(`'${c}'`);
    const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
    for (const c of ['health:scan', 'health:fix', 'health:undo']) expect(UI_ONLY_CHANNELS.has(c)).toBe(true);
    expect(fs.readFileSync('src/main/ipc-policy.js', 'utf8')).toMatch(/PRIVATE_DISABLED = [^\n]*health:/);
  });
});
