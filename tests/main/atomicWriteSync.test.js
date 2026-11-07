// A2: small config files are written atomically. Fault injection: a throwing / partial fs must leave the
// original file as it was (the original is only replaced by the final rename).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { atomicWriteSync, readJsonRecoverSync } = require('../../src/main/file-store.js');
const { createBootGuard } = require('../../src/main/safe-mode.js');
const { createCrashLog } = require('../../src/main/crash-log.js');
const { createPlacementStore } = require('../../src/main/window-placement.js');
const { createDownloadPrefs } = require('../../src/main/download-prefs.js');
const { createSafeDownload } = require('../../src/main/safe-download.js');
const { createHidGrants } = require('../../src/main/hid-grants.js');
const ext = require('../../src/main/extensions.js');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-aws-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// The real fs, except that one named step fails. `partial` makes the write step put half the bytes down first
// (a disk that fills up, or a kill in the middle of the write).
function faultyFs(failStep, { code = 'EIO', partial = false } = {}) {
  const boom = () => Object.assign(new Error('injected ' + failStep), { code });
  const wrapped = { ...fs };
  for (const name of ['mkdirSync', 'openSync', 'fsyncSync', 'closeSync', 'copyFileSync', 'renameSync']) {
    wrapped[name] = (...a) => { if (name === failStep) throw boom(); return fs[name](...a); };
  }
  wrapped.writeFileSync = (target, data, ...rest) => {
    if (failStep === 'writeFileSync') {
      if (partial && typeof target === 'number') fs.writeSync(target, String(data).slice(0, Math.floor(String(data).length / 2)));
      throw boom();
    }
    return fs.writeFileSync(target, data, ...rest);
  };
  return wrapped;
}
const leftovers = (d) => fs.readdirSync(d).filter(n => n.endsWith('.tmp'));

describe('atomicWriteSync', () => {
  it('writes the file, keeps one .bak of the previous content and leaves no temp file', () => {
    const f = path.join(dir, 'a.json');
    atomicWriteSync(f, '{"v":1}');
    expect(fs.readFileSync(f, 'utf8')).toBe('{"v":1}');
    expect(fs.existsSync(f + '.bak')).toBe(false);
    atomicWriteSync(f, '{"v":2}');
    expect(fs.readFileSync(f, 'utf8')).toBe('{"v":2}');
    expect(fs.readFileSync(f + '.bak', 'utf8')).toBe('{"v":1}');
    expect(leftovers(dir)).toEqual([]);
  });

  for (const step of ['openSync', 'writeFileSync', 'fsyncSync', 'copyFileSync', 'renameSync']) {
    it(`a failure at ${step} leaves the original file whole and removes the temp file`, () => {
      const f = path.join(dir, 'a.json');
      fs.writeFileSync(f, '{"keep":"me"}');
      expect(() => atomicWriteSync(f, '{"new":"value-that-is-longer"}', { fsImpl: faultyFs(step, { partial: true }), retryDelays: [] })).toThrow(/injected/);
      expect(fs.readFileSync(f, 'utf8')).toBe('{"keep":"me"}');
      expect(leftovers(dir)).toEqual([]);
    });
  }

  it('a disk-full error (ENOSPC) in the middle of the write is raised and the original survives', () => {
    const f = path.join(dir, 'a.json');
    fs.writeFileSync(f, '{"keep":1}');
    let thrown;
    try { atomicWriteSync(f, '{"x":"y"}', { fsImpl: faultyFs('writeFileSync', { code: 'ENOSPC', partial: true }) }); } catch (e) { thrown = e; }
    expect(thrown && thrown.code).toBe('ENOSPC');
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ keep: 1 });
  });

  it('a lock that lasts only a moment (EPERM on the rename) is retried; a lasting one is raised', () => {
    const f = path.join(dir, 'a.json');
    fs.writeFileSync(f, 'old');
    let fails = 2;
    const flaky = { ...fs, renameSync: (a, b) => { if (fails-- > 0) throw Object.assign(new Error('locked'), { code: 'EPERM' }); return fs.renameSync(a, b); } };
    atomicWriteSync(f, 'new', { fsImpl: flaky, sleep: () => {} });
    expect(fs.readFileSync(f, 'utf8')).toBe('new');
    const stuck = { ...fs, renameSync: () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); } };
    expect(() => atomicWriteSync(f, 'newer', { fsImpl: stuck, sleep: () => {} })).toThrow(/locked/);
    expect(fs.readFileSync(f, 'utf8')).toBe('new');
  });
});

describe('readJsonRecoverSync', () => {
  it('says missing, file, backup and lost, and keeps a broken file aside', () => {
    const f = path.join(dir, 'r.json');
    expect(readJsonRecoverSync(f)).toEqual({ data: null, source: 'missing' });
    atomicWriteSync(f, '{"a":1}');
    expect(readJsonRecoverSync(f)).toEqual({ data: { a: 1 }, source: 'file' });
    atomicWriteSync(f, '{"a":2}');                      // .bak now holds {"a":1}
    fs.writeFileSync(f, '{"a":');                       // cut in half
    const got = readJsonRecoverSync(f);
    expect(got.source).toBe('backup');
    expect(got.data).toEqual({ a: 1 });
    expect(fs.readFileSync(got.corruptCopy, 'utf8')).toBe('{"a":');
    fs.writeFileSync(f + '.bak', 'nope');
    fs.writeFileSync(f, '{"a":');
    const lost = readJsonRecoverSync(f);
    expect(lost.source).toBe('lost');
    expect(lost.data).toBeNull();
    expect(fs.existsSync(lost.corruptCopy)).toBe(true);
    expect(fs.readFileSync(f, 'utf8')).toBe('{"a":');   // nothing is rewritten or deleted here
  });
});

describe('the config writers go through it', () => {
  it('boot-guard state survives a failed save', () => {
    const f = path.join(dir, 'boot-state.json');
    const good = createBootGuard({ dir, fs });
    good.begin();
    const before = fs.readFileSync(path.join(dir, 'boot-state.json'), 'utf8');
    const notes = [];
    const bad = createBootGuard({ dir, fs: faultyFs('renameSync', { partial: true }), log: (m) => notes.push(m) });
    bad.begin();
    expect(fs.readFileSync(f, 'utf8')).toBe(before);
    expect(notes.some(n => /could not record the boot state/.test(n))).toBe(true);
    expect(leftovers(dir)).toEqual([]);
  });

  it('crash log survives a failed save', () => {
    const good = createCrashLog({ dir, fs });
    good.add('crash', 'first');
    const file = path.join(dir, 'crash-log.json');
    const before = fs.readFileSync(file, 'utf8');
    const bad = createCrashLog({ dir, fs: faultyFs('writeFileSync', { partial: true }) });
    expect(bad.add('crash', 'second')).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('window place survives a failed save', () => {
    const file = path.join(dir, 'window-bounds.json');
    createPlacementStore({ fs, file }).save({ x: 1, y: 2, width: 900, height: 700 });
    expect(() => createPlacementStore({ fs: faultyFs('writeFileSync', { partial: true }), file }).save({ x: 5, y: 5, width: 1000, height: 800 })).toThrow(/injected/);
    expect(createPlacementStore({ fs, file }).load()).toEqual({ x: 1, y: 2, width: 900, height: 700 });
  });

  it('download choices survive a failed save', () => {
    const file = path.join(dir, 'download-prefs.json');
    const mk = (f) => createDownloadPrefs({ fs: f, file, defaultFolder: () => dir });
    mk(fs).setAsk(true);
    const before = fs.readFileSync(file, 'utf8');
    expect(() => mk(faultyFs('writeFileSync', { code: 'ENOSPC', partial: true })).setAsk(false)).toThrow(/injected/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('safe-download choices survive a failed save', () => {
    const file = path.join(dir, 'safe-download.json');
    const mk = (f) => createSafeDownload({ fs: f, file, quarantineDir: path.join(dir, 'q') });
    mk(fs).set({ on: true });
    const before = fs.readFileSync(file, 'utf8');
    expect(() => mk(faultyFs('renameSync', { partial: true })).set({ on: false })).toThrow(/injected/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('HID grants survive a failed save (default writer)', () => {
    const grants = createHidGrants({ userDataPath: dir });
    grants.grant('persist:main', 'https://a.example', 1, 2);
    const before = fs.readFileSync(grants.file, 'utf8');
    const real = fs.renameSync;
    fs.renameSync = () => { throw Object.assign(new Error('injected rename'), { code: 'EIO' }); };
    try { expect(() => grants.grant('persist:main', 'https://b.example', 3, 4)).toThrow(/injected/); }
    finally { fs.renameSync = real; }
    expect(fs.readFileSync(grants.file, 'utf8')).toBe(before);
  });

  it('the extension state files (disabled list, scopes, sources, file access) go through it and survive a cut', () => {
    ext.writeDisabled(dir, new Set(['a']));
    ext.writeDisabled(dir, new Set(['a', 'b']));
    expect(fs.readFileSync(ext.disabledPath(dir) + '.bak', 'utf8')).toContain('"a"');
    const before = fs.readFileSync(ext.disabledPath(dir), 'utf8');
    const real = fs.renameSync;
    fs.renameSync = () => { throw Object.assign(new Error('injected rename'), { code: 'EIO' }); };
    try { expect(() => ext.writeDisabled(dir, new Set())).toThrow(/injected/); }
    finally { fs.renameSync = real; }
    expect(fs.readFileSync(ext.disabledPath(dir), 'utf8')).toBe(before);
    expect(ext.readDisabled(dir)).toEqual(new Set(['a', 'b']));
    expect(leftovers(dir)).toEqual([]);
  });
});
