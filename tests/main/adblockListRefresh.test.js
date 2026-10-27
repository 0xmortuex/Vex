// @vitest-environment node
//
// PE3: the ad-block lists were built once and then only read from the cache,
// so they never updated (the owner's were six weeks old). PE4: an older
// cache file (vex-adblock-engine.bin, 6.6 MB) was never deleted.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../src/adblocker-engine.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
const DAY = 24 * 60 * 60 * 1000;
const old = { blocker: { match: () => ({ match: false }), serialize: () => new Uint8Array([1]) }, fromElectronDetails: (d) => d };
afterEach(() => { E._setEngineForTests(null); vi.restoreAllMocks(); });

describe('refreshing stale filter lists', () => {
  it('leaves a cache younger than a week alone', async () => {
    E._setEngineForTests(old);
    const build = vi.fn();
    expect(await E.refreshIfStale('x', { now: () => 10 * DAY, stat: async () => ({ mtimeMs: 4 * DAY }), build })).toBe('fresh');
    expect(build).not.toHaveBeenCalled();
  });
  it('builds an older one again, saves it and blocks with the new lists', async () => {
    E._setEngineForTests(old);
    const fresh = { match: () => ({ match: true }), serialize: () => new Uint8Array([2, 3]) };
    const writes = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await E.refreshIfStale('cache.bin', { now: () => 10 * DAY, stat: async () => ({ mtimeMs: 2 * DAY }), build: async () => fresh, write: async (p, b) => writes.push([p, [...b]]) });
    expect(r).toBe('updated');
    expect(writes).toEqual([['cache.bin', [2, 3]]]);
    expect(E.engineBlocks({ isMainFrame: () => false })).toBe(true);
  });
  it('keeps the engine in use when the download fails', async () => {
    E._setEngineForTests(old);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await E.refreshIfStale('cache.bin', { now: () => 10 * DAY, stat: async () => ({ mtimeMs: 0 }), build: async () => { throw new Error('offline'); }, write: vi.fn() });
    expect(r).toBe('failed');
    expect(err.mock.calls[0].join(' ')).toMatch(/offline/);
    expect(E.engineBlocks({ isMainFrame: () => false })).toBe(false);
  });
  it('main.js checks in the background after start and daily, never before the engine is ready', () => {
    const at = main.indexOf("initAdblockEngine(adblockCache, ");
    const block = main.slice(at, at + 1200);
    expect(block).toMatch(/if \(!ok\) \{ adblockStarting = null; return; \}/);
    expect(block).toMatch(/setTimeout\(refresh, 60 \* 1000\)\.unref\(\)/);
    expect(block).toMatch(/setInterval\(refresh, 24 \* 60 \* 60 \* 1000\)\.unref\(\)/);
  });
});

describe('the orphaned old cache', () => {
  it('is deleted, and a missing one is no error', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-abe-'));
    const f = path.join(dir, 'vex-adblock-engine.bin');
    fs.writeFileSync(f, 'x');
    expect(await E.removeOrphanCache(f)).toBe(true);
    expect(fs.existsSync(f)).toBe(false);
    expect(await E.removeOrphanCache(f)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('main.js removes it at start', () => {
    expect(main).toMatch(/_adblockEngine\.removeOrphanCache\(path\.join\(app\.getPath\('userData'\), 'vex-adblock-engine\.bin'\)\)/);
  });
});

describe('the engine in use is the compact one, read back from the cached bytes (2026-10-28)', () => {
  // A blocker built from the lists holds them all parsed: about 110 MB of the main process's heap, against about 10 MB read back from its
  // serialized form. Measured on a fresh profile: 123 MB of heap in use 30 s after start with no cache, 24 MB with one.
  it('after a refresh the blocker that blocks is the one deserialized from the bytes that were saved', async () => {
    E._setEngineForTests(old);
    const built = { match: () => ({ match: false }), serialize: () => new Uint8Array([7, 8, 9]) };
    const compact = { match: () => ({ match: true }), tag: 'compact' };
    const seen = [];
    const written = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await E.refreshIfStale('cache.bin', {
      now: () => 10 * DAY, stat: async () => ({ mtimeMs: 0 }), build: async () => built,
      write: async (p, b) => { written.push(Array.from(b)); },
      deserialize: (b) => { seen.push(Array.from(b)); return compact; },
    });
    expect(r).toBe('updated');
    expect(written).toEqual([[7, 8, 9]]);
    expect(seen).toEqual([[7, 8, 9]]);                      // read back from exactly what was saved
    expect(E.engineBlocks({ isMainFrame: () => false })).toBe(true);   // and it is the compact one that answers
  });

  it('really does block the same requests after the round trip through the library (a real list)', async () => {
    const { ElectronBlocker, fromElectronDetails } = require('@ghostery/adblocker-electron');
    const built = ElectronBlocker.parse('||ads.example.com^\n||tracker.test^$third-party\n');
    const bytes = built.serialize();
    const back = ElectronBlocker.deserialize(bytes);
    E._setEngineForTests({ blocker: built, fromElectronDetails });
    const details = (url) => ({ url, resourceType: 'script', referrer: 'https://news.example.org/', method: 'GET', id: 1 });
    const before = ['https://ads.example.com/a.js', 'https://cdn.example.org/lib.js', 'https://tracker.test/t.js'].map(u => E.engineBlocks(details(u)));
    E._setEngineForTests({ blocker: back, fromElectronDetails });
    const after = ['https://ads.example.com/a.js', 'https://cdn.example.org/lib.js', 'https://tracker.test/t.js'].map(u => E.engineBlocks(details(u)));
    expect(before).toEqual([true, false, true]);
    expect(after).toEqual(before);
  });

  it('initEngine keeps the bytes the library cached and reads the engine back from them (the cache is only written when the lists were built)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/adblocker-engine.js'), 'utf8');
    expect(src).toMatch(/write: \(p, buf\) => \{ builtBytes = buf; return fsp\.writeFile\(p, buf\); \}/);
    expect(src).toMatch(/if \(builtBytes\) blocker = _compact\(builtBytes\);/);
  });
});
