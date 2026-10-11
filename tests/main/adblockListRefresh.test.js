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
    const at = main.indexOf("initAdblockEngine(adblockCache)");
    const block = main.slice(at, at + 1200);
    expect(block).toMatch(/if \(!ok\) return;/);
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
