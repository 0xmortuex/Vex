// @vitest-environment node
//
// Installing a Vencord build leaves a new vencord-<timestamp> folder behind.
// Several piling up means Chromium can load a stale one, which is exactly how
// "install my build" appeared to do nothing for a user while a months-old
// build kept winning.
//
// The ordering rule matters and is the part that was wrong: a DISABLED folder
// (manifest renamed away) can have a newer modification time than the working
// build, so a plain keep-newest kept the dead one and deleted the good one.

import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { dedupeVencordFolders } = require('../../src/main/vencord-folders.js');

// Build a folder tree: { 'vencord-1': { manifest: true, mtime: 1000 }, ... }
function makeDir(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vencord-'));
  for (const [name, opts] of Object.entries(spec)) {
    const p = path.join(dir, name);
    fs.mkdirSync(p, { recursive: true });
    if (opts.manifest !== false) fs.writeFileSync(path.join(p, 'manifest.json'), '{"name":"' + name + '"}');
    if (opts.mtime) fs.utimesSync(p, new Date(opts.mtime), new Date(opts.mtime));
  }
  return dir;
}

const run = (dir) => {
  const log = [];
  const result = dedupeVencordFolders({ fs, path, dir, log: (m) => log.push(m) });
  return { ...result, log, left: fs.readdirSync(dir).sort() };
};

describe('choosing which build survives', () => {
  it('keeps the newest of several working builds', () => {
    const dir = makeDir({
      'vencord-100': { mtime: '2025-01-01T00:00:00Z' },
      'vencord-200': { mtime: '2025-06-01T00:00:00Z' },
      'vencord-300': { mtime: '2025-03-01T00:00:00Z' },
    });
    const r = run(dir);
    expect(r.kept).toBe('vencord-200');
    expect(r.left).toEqual(['vencord-200']);
  });

  // The actual bug.
  it('never keeps a disabled folder over a working build, even if it is newer', () => {
    const dir = makeDir({
      'vencord-old-working': { mtime: '2025-01-01T00:00:00Z' },
      'vencord-new-disabled': { manifest: false, mtime: '2025-12-01T00:00:00Z' },
    });
    const r = run(dir);
    expect(r.kept, 'the disabled folder was kept over the one that works').toBe('vencord-old-working');
    expect(r.left).toEqual(['vencord-old-working']);
  });

  it('removes every folder that cannot load', () => {
    const dir = makeDir({
      'vencord-a': { manifest: false },
      'vencord-b': { manifest: false },
      'vencord-c': {},
    });
    const r = run(dir);
    expect(r.left).toEqual(['vencord-c']);
    expect(r.removed.sort()).toEqual(['vencord-a', 'vencord-b']);
  });
});

describe('leaving things alone', () => {
  it('does nothing when there is only one build', () => {
    const dir = makeDir({ 'vencord-only': {} });
    const r = run(dir);
    expect(r.kept).toBe('vencord-only');
    expect(r.removed).toEqual([]);
    expect(r.left).toEqual(['vencord-only']);
  });

  it('never touches a folder that is not a Vencord build', () => {
    const dir = makeDir({
      'vencord-1': { mtime: '2025-01-01T00:00:00Z' },
      'vencord-2': { mtime: '2025-02-01T00:00:00Z' },
      'dark-reader': {},
      'my-notes': { manifest: false },
    });
    const r = run(dir);
    expect(r.left).toEqual(['dark-reader', 'my-notes', 'vencord-2']);
  });

  it('copes with an empty extensions folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vencord-'));
    const r = run(dir);
    expect(r.kept).toBeNull();
    expect(r.removed).toEqual([]);
  });

  it('reports rather than throws when the folder is missing entirely', () => {
    const log = [];
    const result = dedupeVencordFolders({ fs, path, dir: path.join(os.tmpdir(), 'no-such-dir-' + Date.now()), log: (m) => log.push(m) });
    expect(result.kept).toBeNull();
    expect(log.join(' ')).toMatch(/dedupe error/);
  });

  it('works with no logger supplied', () => {
    const dir = makeDir({ 'vencord-1': {} });
    expect(() => dedupeVencordFolders({ fs, path, dir })).not.toThrow();
  });
});
