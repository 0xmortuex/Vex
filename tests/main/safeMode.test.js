// src/main/safe-mode.js — the way back in when Vex will not start.
//
// Everything else assumes Vex starts. When it does not — an extension that
// breaks the session, a bad update — there is nothing to click, because the
// thing you would click is what failed. Two launches that never finish put the
// third into safe mode, and the first launch of a new version keeps a copy of
// the settings as they were under the old one.

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

const guard = (over = {}) => createBootGuard({ dir, fs, argv: [], version: '2.31.90', settingsFile: settings, now: () => (clock += 1000), ...over });

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
    expect(() => createBootGuard({ dir, fs: readOnly, version: '1.0.0', settingsFile: settings, log: (m) => log.push(m) }).begin()).not.toThrow();
    expect(log.join(' ')).toMatch(/could not record the boot state/);
  });
});

describe('the settings snapshot', () => {
  it('the first launch of a new version keeps the settings as they were under the old one', () => {
    const g1 = guard({ version: '2.31.89' }); g1.begin(); g1.started();
    fs.writeFileSync(settings, JSON.stringify({ 'vex.theme': 'broken-by-the-update' }));
    guard({ version: '2.31.90' }).begin();
    const kept = guard().snapshots();
    expect(kept.map(s => s.label)).toContain('2.31.89');
    expect(JSON.parse(fs.readFileSync(kept.find(s => s.label === '2.31.89').path, 'utf8'))).toEqual({ 'vex.theme': 'broken-by-the-update' });
  });

  it('is not taken again on every launch of the same version', () => {
    const g = guard(); g.begin(); g.started();
    const first = guard().snapshots().length;
    const g2 = guard(); g2.begin(); g2.started();
    expect(guard().snapshots()).toHaveLength(first);
  });

  it('keeps the five most recent', () => {
    for (let i = 0; i < 9; i++) { const g = guard({ version: '2.31.' + i }); g.begin(); g.started(); }
    expect(guard().snapshots().length).toBeLessThanOrEqual(5);
  });

  it('restoring puts the file back, after copying aside what is there now', () => {
    const g1 = guard({ version: '2.31.89' }); g1.begin(); g1.started();
    fs.writeFileSync(settings, JSON.stringify({ 'vex.theme': 'after' }));
    const g2 = guard({ version: '2.31.90' }); g2.begin();
    fs.writeFileSync(settings, JSON.stringify({ 'vex.theme': 'now' }));

    g2.restoreSettings('2.31.89');
    expect(JSON.parse(fs.readFileSync(settings, 'utf8'))).toEqual({ 'vex.theme': 'after' });
    const before = g2.snapshots().find(s => s.label === 'before-restore');
    expect(JSON.parse(fs.readFileSync(before.path, 'utf8'))).toEqual({ 'vex.theme': 'now' });   // the restore is undoable
    expect(() => g2.restoreSettings('nope')).toThrow(/No settings backup called "nope"/);
  });

  it('no settings file yet: nothing is kept and nothing throws', () => {
    fs.rmSync(settings);
    const g = guard();
    expect(g.snapshotSettings('x')).toBe(null);
    expect(g.snapshots()).toEqual([]);
  });
});
