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
const { dedupeVencordFolders, MARKER } = require('../../src/main/vencord-folders.js');

// Build a folder tree: { 'vencord-1': { manifest: true, mtime: 1000 }, ... }
function makeDir(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vencord-'));
  for (const [name, opts] of Object.entries(spec)) {
    const p = path.join(dir, name);
    fs.mkdirSync(p, { recursive: true });
    if (opts.manifest !== false) fs.writeFileSync(path.join(p, 'manifest.json'), '{"name":"' + name + '"}');
    // Folders Vex installed carry its marker; { marked: false } is a custom or older-Vex folder.
    if (opts.marked !== false) fs.writeFileSync(path.join(p, MARKER), '1');
    if (opts.mtime) fs.utimesSync(p, new Date(opts.mtime), new Date(opts.mtime));
  }
  return dir;
}

const run = (dir, protect) => {
  const log = [];
  const result = dedupeVencordFolders({ fs, path, dir, log: (m) => log.push(m), protect });
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

describe('only what Vex installed is deleted', () => {
  it('a custom (unmarked) folder survives whether it is newer or older', () => {
    for (const [customMtime, staleVexLeft] of [['2026-01-01T00:00:00Z', 0], ['2024-01-01T00:00:00Z', 1]]) {
      const dir = makeDir({
        'vencord-custom': { marked: false, mtime: customMtime },
        'vencord-vex-a': { mtime: '2025-01-01T00:00:00Z' },
        'vencord-vex-b': { mtime: '2025-06-01T00:00:00Z' },
      });
      const r = run(dir);
      expect(r.left, customMtime).toContain('vencord-custom');
      expect(r.left.filter(n => n.startsWith('vencord-vex'))).toHaveLength(staleVexLeft);
    }
  });

  it('a marked stale copy is removed', () => {
    const dir = makeDir({ 'vencord-old': { mtime: '2025-01-01T00:00:00Z' }, 'vencord-new': { mtime: '2025-06-01T00:00:00Z' } });
    expect(run(dir).left).toEqual(['vencord-new']);
  });

  it('an unmarked folder survives, with or without a manifest, and is logged once', () => {
    const dir = makeDir({ 'vencord-hand': { marked: false }, 'vencord-hand-broken': { marked: false, manifest: false } });
    const r = run(dir);
    expect(r.left).toEqual(['vencord-hand', 'vencord-hand-broken']);
    expect(r.removed).toEqual([]);
    expect(r.log.join(' ')).toMatch(/leaving vencord-hand-broken alone/);
    expect(run(dir).log.join(' ')).not.toMatch(/leaving vencord-hand-broken alone/);
  });

  it('the loaded copy survives even when marked and older', () => {
    const dir = makeDir({ 'vencord-loaded': { mtime: '2025-01-01T00:00:00Z' }, 'vencord-newer': { mtime: '2025-06-01T00:00:00Z' } });
    const r = run(dir, [path.join(dir, 'vencord-loaded')]);
    expect(r.left).toEqual(['vencord-loaded', 'vencord-newer']);
  });

  it('a folder the local-build path points into survives', () => {
    const dir = makeDir({ 'vencord-local': { mtime: '2025-01-01T00:00:00Z' }, 'vencord-newer': { mtime: '2025-06-01T00:00:00Z' } });
    const r = run(dir, [path.join(dir, 'vencord-local', 'dist', 'extension-chrome.zip')]);
    expect(r.left).toEqual(['vencord-local', 'vencord-newer']);
  });

  it('main.js marks what it installs and passes the loaded and local-build paths', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(src).toMatch(/slug === 'vencord'[\s\S]{0,200}vencord-folders'\)\.MARKER/);
    expect(src).toMatch(/dedupeVencordFolders\(\{\s*fs, path, dir: extensionsDir, log: _vlog, protect/);
    expect(src).toMatch(/getAllExtensions\(\)\) protect\.push/);
    expect(src).toMatch(/vencord-local\.json'\), 'utf8'\)\); if \(cfg && cfg\.path\) protect\.push/);
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
