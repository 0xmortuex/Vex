// Which Vencord plugin allocates how much (src/main/discord-heap.js): the attribution over a fake heap profile with a
// KNOWN call tree and a KNOWN line map, the line-map file checks, and the debugger session against a fake debugger.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const H = require('../../src/main/discord-heap.js');

const KB = 1024;
const BUNDLE = 'file:///VencordWeb';
// line 0: col 0 core | col 100 Alpha | col 200 Beta | col 300 core;  line 1: col 0 Alpha
const MANIFEST = { schema: 'vex-plugin-ranges/1', bundle: 'dist/Vencord.js', bundleBytes: 10, bundleSha256: 'a'.repeat(64),
  owners: ['', 'Alpha', 'Beta'], runs: [0, 0, 0, 0, 100, 1, 0, 200, 2, 0, 300, 0, 1, 0, 1] };
const frame = (url, line, col, fn = '') => ({ functionName: fn, url, lineNumber: line, columnNumber: col });
const node = (callFrame, selfSize, children = []) => ({ callFrame, selfSize, children });

// Known tree:
//   (root)
//   +- discord render (discord.com)                 selfSize 10 KB   -> Discord / unattributed
//   |   +- alpha handler (bundle 0:150)             selfSize 20 KB   -> Alpha stack AND self
//   |       +- discord store emit (discord.com)     selfSize 5 KB    -> Alpha stack only (called by Alpha)
//   +- vencord core helper (bundle 0:350)           selfSize 7 KB    -> core
//   |   +- beta (bundle 0:250)                      selfSize 3 KB    -> Beta
//   +- alpha again (bundle 1:40)                    selfSize 2 KB    -> Alpha
//   +- discord only (discord.com)                   selfSize 1 KB    -> unattributed
const TREE = node(frame('', 0, 0, '(root)'), 0, [
  node(frame('https://discord.com/assets/a.js', 5, 5, 'render'), 10 * KB, [
    node(frame(BUNDLE, 0, 150, 'x'), 20 * KB, [node(frame('https://discord.com/assets/a.js', 9, 9, 'emit'), 5 * KB)]),
  ]),
  node(frame(BUNDLE, 0, 350, 'helper'), 7 * KB, [node(frame(BUNDLE, 0, 250, 'y'), 3 * KB)]),
  node(frame(BUNDLE, 1, 40, 'z'), 2 * KB),
  node(frame('https://discord.com/assets/b.js', 1, 1, 'other'), 1 * KB),
]);

describe('lookupOwner', () => {
  it('finds the owner by line and column', () => {
    expect(H.lookupOwner(MANIFEST, 0, 0)).toBe('');
    expect(H.lookupOwner(MANIFEST, 0, 99)).toBe('');
    expect(H.lookupOwner(MANIFEST, 0, 100)).toBe('Alpha');
    expect(H.lookupOwner(MANIFEST, 0, 250)).toBe('Beta');
    expect(H.lookupOwner(MANIFEST, 0, 5000)).toBe('');
    expect(H.lookupOwner(MANIFEST, 1, 40)).toBe('Alpha');
    expect(H.lookupOwner(MANIFEST, 99, 0)).toBe('Alpha');
  });
});

describe('attribute', () => {
  it('adds a known tree up per plugin, core and unattributed, and never spreads the rest over plugins', () => {
    const a = H.attribute({ head: TREE }, { manifest: MANIFEST, names: ['Alpha', 'Beta'] });
    expect(a.plugins.get('Alpha')).toEqual({ stack: 27 * KB, self: 22 * KB });
    expect(a.plugins.get('Beta')).toEqual({ stack: 3 * KB, self: 3 * KB });
    expect(a.core).toBe(7 * KB);
    expect(a.other).toBe(11 * KB);
    expect(a.total).toBe(48 * KB);
    expect(a.plugins.size).toBe(2);
    let sum = a.core + a.other;
    for (const v of a.plugins.values()) sum += v.stack;
    expect(sum).toBe(a.total);
    expect(a.bundleFrames).toBe(4);
  });

  it('counts an allocation for the plugin nearest to it on the stack (Beta called from core stays Beta)', () => {
    const a = H.attribute({ head: node(frame('', 0, 0), 0, [node(frame(BUNDLE, 0, 350), 0, [node(frame(BUNDLE, 0, 250), 0, [node(frame(BUNDLE, 0, 350), 4 * KB)])])]) }, { manifest: MANIFEST });
    expect(a.plugins.get('Beta')).toEqual({ stack: 4 * KB, self: 0 });
    expect(a.core).toBe(0);
  });

  it('without a line map falls back to names, and a Vencord frame is NOT guessed', () => {
    const tree = node(frame('', 0, 0), 0, [
      node(frame('http://x/src/plugins/messageLogger/index.tsx', 1, 1, 'q'), 8 * KB),
      node(frame(BUNDLE, 0, 150, 'MessageLoggerEnhanced.handle'), 6 * KB),
      node(frame(BUNDLE, 0, 150, 'short'), 2 * KB),
      node(frame(BUNDLE, 0, 150, 'MessageLoggerx'), 1 * KB),
    ]);
    const a = H.attribute({ head: tree }, { manifest: null, names: ['MessageLogger', 'MessageLoggerEnhanced', 'Alpha'] });
    expect(a.plugins.get('MessageLogger').stack).toBe(8 * KB);
    expect(a.plugins.get('MessageLoggerEnhanced').stack).toBe(6 * KB);
    expect(a.other).toBe(3 * KB);
    expect(a.core).toBe(0);
  });

  it('refuses a profile with no tree', () => {
    expect(() => H.attribute({}, {})).toThrow(/no call tree/);
    expect(() => H.attribute(null, {})).toThrow(/no call tree/);
  });
});

describe('cleanNames / makeNameMatcher', () => {
  it('accepts plain plugin names and refuses anything else', () => {
    expect(H.cleanNames(null)).toEqual([]);
    expect(H.cleanNames(['MessageLogger', 'Free Emoji-2'])).toEqual(['MessageLogger', 'Free Emoji-2']);
    expect(() => H.cleanNames('x')).toThrow(/not valid/);
    expect(() => H.cleanNames(['a/b'])).toThrow(/not valid/);
    expect(() => H.cleanNames([5])).toThrow(/not valid/);
    expect(() => H.cleanNames(new Array(601).fill('Abc'))).toThrow(/not valid/);
  });
});

describe('checkManifest / loadRanges', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vex-ranges-'));
  const write = (dir, bundle, patch = {}) => {
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'Vencord.js'), bundle);
    const m = { ...MANIFEST, bundleBytes: Buffer.byteLength(bundle), bundleSha256: crypto.createHash('sha256').update(bundle).digest('hex'), ...patch };
    fs.writeFileSync(path.join(dir, 'dist', 'vencord-plugin-ranges.json'), JSON.stringify(m));
  };

  it('accepts a matching file', () => {
    const d = tmp(); write(d, 'console.log(1)');
    const r = H.loadRanges(d);
    expect(r.status).toBe('ok');
    expect(r.manifest.owners).toEqual(['', 'Alpha', 'Beta']);
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('says missing when the build has no line map, and when Vencord is not installed', () => {
    const d = tmp(); fs.mkdirSync(path.join(d, 'dist'));
    expect(H.loadRanges(d).status).toBe('missing');
    expect(H.loadRanges(d).why).toMatch(/pnpm buildWeb/);
    expect(H.loadRanges(null).status).toBe('missing');
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('refuses a map made for another Vencord.js (stale)', () => {
    const d = tmp(); write(d, 'console.log(1)');
    fs.writeFileSync(path.join(d, 'dist', 'Vencord.js'), 'console.log(2)');
    const r = H.loadRanges(d);
    expect(r.status).toBe('stale');
    expect(r.manifest).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('refuses a file with the wrong shape', () => {
    for (const patch of [{ schema: 'x' }, { owners: ['x'] }, { runs: [0, 0] }, { runs: [0, 5, 0, 0, 5, 0] }, { runs: [0, 0, 9] }, { bundleSha256: 'zz' }]) {
      const d = tmp(); write(d, 'abc', patch);
      expect(H.loadRanges(d).status, JSON.stringify(patch)).toBe('unreadable');
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

// ---- a session over a fake debugger ----------------------------------------------------------------------------------------
function fake({ attached = false, audible = false, discord = true, profile = { head: TREE }, failOn = null } = {}) {
  const sent = [];
  const listeners = {};
  const dbg = {
    attached, detaches: 0, attaches: [],
    isAttached() { return this.attached; },
    attach(v) { this.attaches.push(v); this.attached = true; },
    detach() { this.attached = false; this.detaches++; (listeners.detach || []).forEach(f => f()); },
    on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); },
    async sendCommand(method, params) {
      sent.push([method, params]);
      if (method === failOn) throw new Error('boom ' + method);
      if (method === 'Runtime.getHeapUsage') return { usedSize: 100 * 1048576 + sent.length * 1048576, totalSize: 150 * 1048576 };
      if (method === 'HeapProfiler.getSamplingProfile') return { profile };
      return {};
    },
  };
  const wc = { isDestroyed: () => false, isCurrentlyAudible: () => audible, debugger: dbg, tag: discord };
  const timers = [];
  const heap = H.createDiscordHeap({
    webContents: { fromId: (id) => (id === 7 ? wc : null) },
    isDiscordContents: (w) => w.tag,
    loadManifest: () => ({ status: 'ok', why: '', manifest: MANIFEST }),
    setTimeoutFn: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeoutFn: (t) => { t.cleared = true; },
    now: (() => { let n = 1000; return () => (n += 30000); })(),
  });
  return { heap, dbg, sent, timers, wc };
}

describe('a measuring window', () => {
  it('collects garbage, samples live objects only, then reads, detaches and returns numbers and names', async () => {
    const f = fake();
    const b = await f.heap.begin(7, ['Alpha', 'Beta']);
    expect(b.ok).toBe(true);
    expect(f.dbg.attaches).toEqual(['1.3']);
    expect(f.dbg.attached).toBe(true);
    expect(f.sent.map(s => s[0])).toEqual(['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage', 'HeapProfiler.startSampling']);
    expect(f.sent[2][1]).toEqual({ samplingInterval: 32768, includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false });
    const r = await f.heap.end(7, true);
    expect(f.dbg.attached).toBe(false);
    expect(f.dbg.detaches).toBe(1);
    expect(f.timers[0].cleared).toBe(true);
    expect(r.plugins).toEqual([{ name: 'Alpha', kb: 27, selfKB: 22 }, { name: 'Beta', kb: 3, selfKB: 3 }]);
    expect(r.coreKB).toBe(7);
    expect(r.otherKB).toBe(11);
    expect(r.totalKB).toBe(48);
    expect(r.map.status).toBe('ok');
    expect(r.heap.beforeMB).toBeGreaterThan(100);
    expect(r.heap.afterMB).toBeGreaterThan(r.heap.beforeMB);
    expect(r.windowMs).toBeGreaterThan(0);
    // only numbers and plugin names: nothing like a function name or a url comes back
    expect(JSON.stringify(r)).not.toMatch(/discord\.com|render|emit|helper/);
  });

  it('sends only the five read-only commands, never a pause, breakpoint, evaluation or enable', async () => {
    const f = fake();
    await f.heap.begin(7, []);
    await f.heap.end(7, true);
    await f.heap.usage(7);
    const used = new Set(f.sent.map(s => s[0]));
    for (const m of used) expect(H.ALLOWED.has(m), m).toBe(true);
    expect([...used].some(m => /Debugger\.|Runtime\.evaluate|\.enable|setBreakpoint|pause/i.test(m))).toBe(false);
    expect(H.ALLOWED.size).toBe(5);
  });

  it('refuses when DevTools (or anything) is attached, and does not touch that debugger', async () => {
    const f = fake({ attached: true });
    await expect(f.heap.begin(7, [])).rejects.toThrow(/already attached/);
    expect(f.dbg.detaches).toBe(0);
    expect(f.dbg.attaches).toEqual([]);
    await expect(f.heap.usage(7)).rejects.toThrow(/already attached/);
  });

  it('refuses while Discord is audible (a call) and for a page that is not the Discord panel', async () => {
    await expect(fake({ audible: true }).heap.begin(7, [])).rejects.toThrow(/playing sound/);
    await expect(fake({ discord: false }).heap.begin(7, [])).rejects.toThrow(/Only the Discord panel/);
    await expect(fake().heap.begin(8, [])).rejects.toThrow(/closed or is not loaded/);
    await expect(fake().heap.begin('7', [])).rejects.toThrow(/closed or is not loaded/);
  });

  it('refuses a second window while one runs, and ending with none running is an error', async () => {
    const f = fake();
    await f.heap.begin(7, []);
    await expect(f.heap.begin(7, [])).rejects.toThrow(/DevTools|already being measured|already attached/);
    await f.heap.end(7, false);
    await expect(f.heap.end(7, true)).rejects.toThrow(/No Discord measurement/);
  });

  it('detaches when a command fails while starting', async () => {
    const f = fake({ failOn: 'HeapProfiler.startSampling' });
    await expect(f.heap.begin(7, [])).rejects.toThrow(/boom/);
    expect(f.dbg.attached).toBe(false);
    expect(f.heap.active()).toBe(0);
  });

  it('detaches when reading the profile fails, and when a call starts before the end', async () => {
    const f = fake({ failOn: 'HeapProfiler.getSamplingProfile' });
    await f.heap.begin(7, []);
    await expect(f.heap.end(7, true)).rejects.toThrow(/boom/);
    expect(f.dbg.attached).toBe(false);
    const g = fake();
    await g.heap.begin(7, []);
    g.wc.isCurrentlyAudible = () => true;
    await expect(g.heap.end(7, true)).rejects.toThrow(/started playing sound/);
    expect(g.dbg.attached).toBe(false);
    expect(g.sent.map(s => s[0])).not.toContain('HeapProfiler.getSamplingProfile');
  });

  it('keep=false discards the profile without reading it', async () => {
    const f = fake();
    await f.heap.begin(7, []);
    const r = await f.heap.end(7, false);
    expect(r).toEqual({ ok: true, discarded: true });
    expect(f.sent.map(s => s[0])).not.toContain('HeapProfiler.getSamplingProfile');
    expect(f.dbg.attached).toBe(false);
  });

  it('ends an unattended window by itself after six minutes', async () => {
    const f = fake();
    await f.heap.begin(7, []);
    expect(f.timers[0].ms).toBe(6 * 60000);
    f.timers[0].fn();
    await new Promise(r => setTimeout(r, 0));
    expect(f.dbg.attached).toBe(false);
    expect(f.heap.active()).toBe(0);
  });

  it('forgets the window when the page goes away (DevTools detach event)', async () => {
    const f = fake();
    await f.heap.begin(7, []);
    f.dbg.detach();
    expect(f.heap.active()).toBe(0);
  });

  it('usage reads the heap once after a garbage collection and detaches', async () => {
    const f = fake();
    const u = await f.heap.usage(7);
    expect(f.sent.map(s => s[0])).toEqual(['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage']);
    expect(u.usedMB).toBeGreaterThan(100);
    expect(u.totalMB).toBe(150);
    expect(f.dbg.attached).toBe(false);
  });
});
