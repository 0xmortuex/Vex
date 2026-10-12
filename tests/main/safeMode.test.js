// src/main/safe-mode.js — the way back in when Vex will not start.
//
// Everything else assumes Vex starts. When it does not — an extension that
// breaks the session, a bad update — there is nothing to click, because the
// thing you would click is what failed. Two launches that never finish put the
// third into safe mode, and the first launch of a new version asks for a backup
// of the settings as the old one left them (src/main/update-backups.js).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBootGuard, FAILS_BEFORE_SAFE } = require('../../src/main/safe-mode.js');

let dir, settings, clock;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-safe-'));
  settings = path.join(dir, 'vex-persist.json');
  fs.writeFileSync(settings, JSON.stringify({ 'vex.theme': 'oxford' }));
  clock = 1_700_000_000_000;
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const guard = (over = {}) => createBootGuard({ dir, fs, argv: [], version: '2.31.90', now: () => (clock += 1000), ...over });

describe('a launch that finishes', () => {
  it('is not safe mode, and leaves nothing to worry about for the next one', () => {
    const g = guard();
    expect(g.begin()).toMatchObject({ safeMode: false, fails: 0, crashed: false });
    g.started();
    expect(guard().begin()).toMatchObject({ safeMode: false, fails: 0, crashed: false });
  });
});

describe('launches that crash on the way up', () => {
  it('one is bad luck; two in a row means safe mode', () => {
    expect(guard().begin().safeMode).toBe(false);              // 1st: never calls started()
    const second = guard().begin();                            // 2nd: sees "starting"
    expect(second).toMatchObject({ crashed: true, fails: 1, safeMode: false });
    const third = guard().begin();
    expect(third).toMatchObject({ crashed: true, fails: FAILS_BEFORE_SAFE, safeMode: true });
  });

  it('one good launch clears the count', () => {
    guard().begin();
    const g = guard(); g.begin(); g.started();
    expect(guard().begin()).toMatchObject({ safeMode: false, fails: 0 });
  });

  it('--safe-mode asks for it outright', () => {
    const r = guard({ argv: ['vex.exe', '--safe-mode'] }).begin();
    expect(r).toMatchObject({ safeMode: true, asked: true, fails: 0 });
  });

  it('an unreadable or missing state file is a clean start, not a crash', () => {
    expect(guard().begin().crashed).toBe(false);               // no file yet
    fs.writeFileSync(path.join(dir, 'boot-state.json'), 'not json {');
    expect(guard().begin()).toMatchObject({ crashed: false, safeMode: false });
  });

  it('a state file that cannot be written does not stop Vex starting', () => {
    const readOnly = { ...fs, writeFileSync: () => { throw new Error('EACCES'); } };
    const log = [];
    expect(() => createBootGuard({ dir, fs: readOnly, version: '1.0.0', log: (m) => log.push(m) }).begin()).not.toThrow();
    expect(log.join(' ')).toMatch(/could not record the boot state/);
  });
});

// The backup at the first start of a new version is update-backups.js's
// (saveAtFirstStart); the boot guard decides when, and says how it went.
describe('the backup at the first start of a new version', () => {
  const backups = (impl = () => ({ name: 'before-x.json' })) => vi.fn(impl);

  it('is asked for on the first launch of a new version, with the version before and when it started', () => {
    const g1 = guard({ version: '2.31.89' }); g1.begin(); g1.started();
    const startedAt = clock;
    const backupFirstStart = backups();
    const r = guard({ version: '2.31.90', backupFirstStart }).begin();
    expect(backupFirstStart).toHaveBeenCalledWith({ version: '2.31.90', from: '2.31.89', since: startedAt });
    expect(r.updateBackup).toEqual({ ok: true, name: 'before-x.json', version: '2.31.90' });
  });

  it('is not asked for again on every launch of the same version', () => {
    const g = guard(); g.begin(); g.started();
    const backupFirstStart = backups();
    const g2 = guard({ backupFirstStart }); expect(g2.begin().updateBackup).toBeNull(); g2.started();
    expect(backupFirstStart).not.toHaveBeenCalled();
  });

  it('nothing to back up is not news', () => {
    const r = guard({ backupFirstStart: backups(() => null) }).begin();
    expect(r.updateBackup).toBeNull();
  });

  it('one that fails does not stop Vex starting, and is in what begin() returns, not only the log', () => {
    const g1 = guard({ version: '2.31.89' }); g1.begin(); g1.started();
    const log = [];
    const r = guard({ version: '2.31.90', log: (m) => log.push(m), backupFirstStart: backups(() => { throw new Error('Vex could not save the backup in its backups folder (ENOSPC)'); }) }).begin();
    expect(r).toMatchObject({ safeMode: false, updateBackup: { ok: false, version: '2.31.90', error: 'Vex could not save the backup in its backups folder (ENOSPC)' } });
    expect(log.join(' ')).toMatch(/could not back up the settings at the first start of 2\.31\.90/);
  });

  it('end to end: the backup lands in the one backups folder, secrets left out', () => {
    const { createUpdateBackups } = require('../../src/main/update-backups.js');
    fs.writeFileSync(settings, JSON.stringify({ 'vex.theme': 'oxford', 'vex.lockPin': 'hash' }));
    const store = createUpdateBackups({ fs, dir: path.join(dir, 'backups'), log: { warn() {} } });
    const g1 = guard({ version: '2.31.89' }); g1.begin(); g1.started();
    const r = guard({ version: '2.31.90', backupFirstStart: (o) => store.saveAtFirstStart({ ...o, persistFile: settings }) }).begin();
    expect(r.updateBackup.ok).toBe(true);
    const [only] = store.list();
    expect(only).toMatchObject({ kind: 'before', version: '2.31.90', name: r.updateBackup.name });
    expect(JSON.parse(store.read(only.name)).items).toEqual({ 'vex.theme': 'oxford' });
    expect(fs.existsSync(path.join(dir, 'settings-backups'))).toBe(false);
  });
});
describe('an update that will not start', () => {
  it('names the version it replaced once safe mode kicks in, so it can be offered back', () => {
    const old = guard({ version: '2.32.36' }); old.begin(); old.started();
    expect(guard({ version: '2.32.37' }).begin().brokenSinceUpdateFrom).toBeNull();   // crashes
    expect(guard({ version: '2.32.37' }).begin().brokenSinceUpdateFrom).toBeNull();   // crashes again
    expect(guard({ version: '2.32.37' }).begin()).toMatchObject({ safeMode: true, brokenSinceUpdateFrom: '2.32.36' });
  });

  it('crashes with no update behind them offer nothing', () => {
    const g = guard(); g.begin(); g.started();
    guard().begin(); guard().begin();
    expect(guard().begin()).toMatchObject({ safeMode: true, brokenSinceUpdateFrom: null });
  });

  it('a good launch forgets the old version', () => {
    const old = guard({ version: '2.32.36' }); old.begin(); old.started();
    const up = guard({ version: '2.32.37' }); up.begin(); up.started();
    guard({ version: '2.32.37' }).begin(); guard({ version: '2.32.37' }).begin();
    expect(guard({ version: '2.32.37' }).begin().brokenSinceUpdateFrom).toBeNull();
  });
});
