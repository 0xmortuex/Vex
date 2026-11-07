// @vitest-environment node
//
// The cache budget (src/main/cache-budget.js): opt-in, clears only the HTTP cache and the Code Cache of a partition,
// largest first, never CacheStorage, never a site whose tab is open. Run here on a temp folder with fake sessions
// and a fake clock; nothing touches a real profile.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const cb = require('../../src/main/cache-budget.js');

const KB = 1024;
let dir, clock, calls;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-cb-')); clock = 1_700_000_000_000; calls = []; });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function put(partition, rel, kb) {
  const file = path.join(dir, 'Partitions', partition, ...rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(kb * KB, 1));
}
// A partition with a given HTTP cache, code cache and CacheStorage (all in KB), and a cookie file that must never go.
function partition(name, { cache = 0, code = 0, storage = 0 } = {}) {
  if (cache) put(name, ['Cache', 'Cache_Data', 'f_000001'], cache);
  if (code) put(name, ['Code Cache', 'js', 'a_0'], code);
  if (storage) put(name, ['Service Worker', 'CacheStorage', 'x', 'y'], storage);
  put(name, ['Network', 'Cookies'], 1);
  put(name, ['IndexedDB', 'db', '1.ldb'], 1);
}
// A fake session that removes the folders the real call would clear, and records what it was asked.
function sessionFor(id) {
  const name = id.slice('persist:'.length);
  return {
    async clearCodeCaches(opts) { calls.push([id, 'code', JSON.stringify(opts)]); fs.rmSync(path.join(dir, 'Partitions', name, 'Code Cache'), { recursive: true, force: true }); },
    async clearCache() { calls.push([id, 'cache']); fs.rmSync(path.join(dir, 'Partitions', name, 'Cache'), { recursive: true, force: true }); },
    async clearStorageData() { calls.push([id, 'STORAGE-DATA']); },
  };
}
const make = (over = {}) => cb.createCacheBudget({ userDataPath: dir, fs, now: () => clock, sessionFor, ...over });

describe('measuring', () => {
  it('sizes the two disposable caches and reports CacheStorage without counting it', async () => {
    partition('discord', { cache: 100, code: 700, storage: 300 });
    partition('claude', { cache: 5, code: 600 });
    const m = await make().measure();
    const by = Object.fromEntries(m.parts.map(p => [p.id, p]));
    expect(by['persist:discord']).toMatchObject({ cache: 100 * KB, code: 700 * KB, cacheStorage: 300 * KB });
    expect(by['persist:claude']).toMatchObject({ cache: 5 * KB, code: 600 * KB, cacheStorage: 0 });
    expect(m.partial).toBe(false);
  });
  it('a profile with no Partitions folder has nothing to measure', async () => {
    expect(await make().measure()).toMatchObject({ parts: [], partial: false });
  });
  it('stops at its time cap and says the figures are partial', async () => {
    partition('a', { cache: 10, code: 10 });
    partition('b', { cache: 10, code: 10 });
    let t = 0;
    const m = await make({ now: () => (t += 1000), capMs: 1500 }).measure();   // every clock read costs a second
    expect(m.partial).toBe(true);
  });
  it('only plain folder names become a partition', () => {
    expect(cb.partitionIdOf('discord')).toBe('persist:discord');
    expect(cb.partitionIdOf('container-work%20pc')).toBe('persist:container-work pc');
    expect(cb.partitionIdOf('..')).toBeNull();
    expect(cb.partitionIdOf('a/b')).toBeNull();
    expect(cb.partitionIdOf('%E0%A4%A')).toBeNull();
  });
});

describe('the plan (pure)', () => {
  const parts = [
    { id: 'persist:main', dir: 'main', label: 'Main browsing', cache: 800, code: 400 },
    { id: 'persist:discord', dir: 'discord', label: 'discord', cache: 100, code: 700 },
    { id: 'persist:claude', dir: 'claude', label: 'claude', cache: 5, code: 600 },
    { id: 'persist:tiny', dir: 'tiny', label: 'tiny', cache: 1, code: 1 },
  ];
  it('does nothing when the total is within the limit', () => {
    const p = cb.plan(parts, 5000, {});
    expect(p.items).toEqual([]);
    expect(p.over).toBe(0);
  });
  it('takes the largest first and stops as soon as the total fits', () => {
    // total 2607, limit 1300: main (1200) first -> 1407 left over 1300 -> discord (800) -> fits
    const p = cb.plan(parts, 1300, {});
    expect(p.items.map(i => i.id)).toEqual(['persist:main', 'persist:discord']);
    expect(p.freeable).toBe(2000);
  });
  it('skips a site with a tab open (and says why) but not the main partition', () => {
    const p = cb.plan(parts, 1300, { open: new Set(['persist:discord', 'persist:main']) });
    expect(p.items.map(i => i.id)).toEqual(['persist:main', 'persist:claude']);
    expect(p.skipped.map(s => s.id)).toEqual(['persist:discord']);
    expect(p.skipped[0].reason).toMatch(/tab/);
  });
});

describe('clearing (unitBytes lets a few KB of files stand for gigabytes)', () => {
  const fixture = () => {
    partition('discord', { cache: 100, code: 700, storage: 300 });
    partition('claude', { cache: 5, code: 600 });
    partition('tiny', { cache: 1, code: 1 });
  };
  it('clears only the cache and the code cache, largest first, never cookies, IndexedDB or CacheStorage, and reports what it freed', async () => {
    fixture();
    // total 1407 KB; limit 1 unit = 650 KB: discord (800) goes, then 607 <= 650 so claude stays.
    const b = make({ unitBytes: 650 * KB });
    b.set({ enabled: true, limitGB: 1 });
    const pv = await b.preview();
    expect(pv.items.map(i => i.id)).toEqual(['persist:discord']);
    const r = await b.clear();
    expect(r.cleared).toEqual([{ id: 'persist:discord', label: 'discord', freed: 800 * KB }]);
    expect(r.freed).toBe(800 * KB);
    expect(r.errors).toEqual([]);
    expect(calls).toEqual([['persist:discord', 'code', '{"urls":[]}'], ['persist:discord', 'cache']]);
    const by = Object.fromEntries((await b.measure()).parts.map(x => [x.id, x]));
    expect(by['persist:discord']).toMatchObject({ cache: 0, code: 0, cacheStorage: 300 * KB });
    expect(by['persist:claude']).toMatchObject({ cache: 5 * KB, code: 600 * KB });
    expect(fs.existsSync(path.join(dir, 'Partitions', 'discord', 'Network', 'Cookies'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'Partitions', 'discord', 'IndexedDB', 'db', '1.ldb'))).toBe(true);
    expect(b.get().last.freed).toBe(800 * KB);
  });
  it('leaves a site with a tab open and goes on to the next one', async () => {
    fixture();
    const b = make({ unitBytes: 650 * KB, partitionsInUse: () => new Set(['persist:discord']) });
    b.set({ limitGB: 1 });
    const r = await b.clear();
    expect(r.skipped.map(s => s.id)).toEqual(['persist:discord']);
    expect(r.cleared.map(c => c.id)).toEqual(['persist:claude', 'persist:tiny']);
    expect(calls.some(c => c[0] === 'persist:discord')).toBe(false);
  });
  it('does not clear a site whose tab opened between the preview and the clearing', async () => {
    fixture();
    let asked = 0;
    // The first question (while planning) says nothing is open; every later one (right before clearing) says Discord is.
    const b = make({ unitBytes: 650 * KB, partitionsInUse: () => (asked++ === 0 ? new Set() : new Set(['persist:discord'])) });
    b.set({ limitGB: 1 });
    const r = await b.clear();
    expect(calls.some(c => c[0] === 'persist:discord')).toBe(false);
    expect(r.skipped.map(s => s.id)).toContain('persist:discord');
  });
  it('a failing session is reported and the others still run', async () => {
    fixture();
    const failing = (id) => (id === 'persist:discord'
      ? { clearCodeCaches: async () => { throw new Error('boom'); }, clearCache: async () => {} }
      : sessionFor(id));
    const logs = [];
    const b = make({ unitBytes: 1 * KB, sessionFor: failing, log: (m) => logs.push(m) });
    b.set({ limitGB: 1 });
    const r = await b.clear();
    expect(r.errors).toEqual([{ id: 'persist:discord', message: 'boom' }]);
    expect(r.cleared.map(c => c.id)).toContain('persist:claude');
    expect(logs.join(' | ')).toMatch(/boom/);
  });
  it('the status shows what would be cleared without clearing it', async () => {
    fixture();
    const b = make({ unitBytes: 650 * KB });
    b.set({ limitGB: 1 });
    const st = await b.status();
    expect(st.items.map(i => i.id)).toEqual(['persist:discord']);
    expect(st).toMatchObject({ enabled: false, minGB: cb.MIN_GB, maxGB: cb.MAX_GB });
    expect(calls).toEqual([]);
  });
});

describe('settings and the scheduled pass', () => {
  it('is off by default and the limit is checked', () => {
    const b = make();
    expect(b.get()).toMatchObject({ enabled: false, limitGB: cb.DEFAULT_GB, lastRunAt: 0 });
    expect(() => b.set({ limitGB: 0.5 })).toThrow(/GB/);
    expect(() => b.set({ limitGB: 500 })).toThrow(/GB/);
    expect(() => b.set({ enabled: 'yes' })).toThrow(/on or off/);
    expect(b.set({ enabled: true, limitGB: 2.26 })).toMatchObject({ enabled: true, limitGB: 2.3 });
    expect(make().get()).toMatchObject({ enabled: true, limitGB: 2.3 });   // kept on disk
  });
  it('stays quiet when it is off, was run today, a game runs, it is quiet hours, or the computer is not idle', async () => {
    const run = async (over, setup) => { const b = make({ idleSeconds: () => 99999, ...over }); if (setup) setup(b); return b.housekeeping(); };
    expect(await run({})).toEqual({ ran: false, reason: 'off' });
    const on = (b) => b.set({ enabled: true });
    expect(await run({ isGaming: () => true }, on)).toEqual({ ran: false, reason: 'a game is running' });
    expect(await run({ isQuiet: () => true }, on)).toEqual({ ran: false, reason: 'quiet hours' });
    expect(await run({ idleSeconds: () => 10 }, on)).toEqual({ ran: false, reason: 'not idle' });
    expect((await run({}, on)).ran).toBe(true);
    // a second pass the same day does nothing
    const b = make({ idleSeconds: () => 99999 });
    expect(await b.housekeeping()).toEqual({ ran: false, reason: 'already today' });
    clock += cb.DAY_MS + 1;
    expect((await b.housekeeping()).ran).toBe(true);
  });
  it('records an under-the-limit pass (so it does not measure again every half hour) and clears nothing', async () => {
    partition('discord', { cache: 10, code: 10 });
    const b = make({ idleSeconds: () => 99999 });
    b.set({ enabled: true });
    const r = await b.housekeeping();
    expect(r.ran).toBe(true);
    expect(r.report.cleared).toEqual([]);
    expect(calls).toEqual([]);
    expect(b.get().lastRunAt).toBe(clock);
  });
  it('refuses to run two clean-ups at once', async () => {
    const b = make({ yieldFn: () => new Promise(r => setTimeout(r, 5)) });
    partition('discord', { cache: 10, code: 10 });
    const first = b.clear();
    await expect(b.clear()).rejects.toThrow(/already running/);
    await first;
  });
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  it('never calls clearStorageData or touches cookies, and uses the two Electron APIs that were confirmed in electron.d.ts', () => {
    const src = read('src/main/cache-budget.js').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/clearStorageData\s*\(/);
    expect(src).toMatch(/clearCodeCaches\(\{ urls: \[\] \}\)/);
    expect(src).toMatch(/\.clearCache\(\)/);
    expect(src).not.toMatch(/cookies/i);
    const dts = read('node_modules/electron/electron.d.ts');
    expect(dts).toMatch(/clearCodeCaches\(options: ClearCodeCachesOptions\): Promise<void>/);
    expect(dts).toMatch(/clearCache\(\): Promise<void>/);
  });
});
