// @vitest-environment jsdom
//
// Every saved key, changed or not, was its own persist-set, and each one
// rewrote the whole of vex-persist.json (1.3 MB), copied the old one to .bak
// and forced it to disk: four keys in one 300 ms batch wrote about 10 MB
// (found 2026-10-09). The renderer now sends a batch as one persist-apply,
// leaves out a value saved unchanged, and main writes the batch once. The
// per-key JSON stores (tabs.json and the rest) are not rewritten when the
// same data is saved again either.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createPreferenceStore } = req('../../src/main/storage.js');
const { JsonStore } = req('../../src/main/file-store.js');

// Counts what reaches the disk through fs.promises: bytes written, .bak copies
// and forced flushes, as the audit's measurement did.
function meter() {
  const m = { bytes: 0, copies: 0, syncs: 0 };
  const open = fs.promises.open, copy = fs.promises.copyFile;
  fs.promises.open = async (...a) => {
    const h = await open(...a);
    const wf = h.writeFile.bind(h), sy = h.sync.bind(h);
    h.writeFile = async (b) => { m.bytes += Buffer.byteLength(b); return wf(b); };
    h.sync = async () => { m.syncs++; return sy(); };
    return h;
  };
  fs.promises.copyFile = async (s, d) => { m.copies++; m.bytes += fs.statSync(s).size; return copy(s, d); };
  m.stop = () => { fs.promises.open = open; fs.promises.copyFile = copy; };
  return m;
}

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-batch-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the preference file (main)', () => {
  function bigFile() {
    const file = path.join(dir, 'vex-persist.json');
    const history = JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ id: 'h' + i, url: 'https://site' + i + '.example/', title: 'Page ' + i, visitedAt: new Date(1e12 + i).toISOString() })));
    fs.writeFileSync(file, JSON.stringify({ __vexPreferenceStore: 1, 'vex.history': history, 'vex.theme': 'dark', 'vex.zooms': '{}', 'vex.recentlyClosed': '[]' }));
    return file;
  }

  it('writes a batch of changed keys once, where one call per key wrote it once per key', async () => {
    const file = bigFile();
    const size = fs.statSync(file).size;
    const keys = [['vex.theme', 'light'], ['vex.zooms', '{"a":1}'], ['vex.recentlyClosed', '["x"]'], ['vex.new', '1']];

    const perKey = createPreferenceStore(file);
    let m = meter();
    try { for (const [k, v] of keys) await perKey.set(k, v + '-old'); } finally { m.stop(); }
    const before = { ...m };

    const batched = createPreferenceStore(file);
    m = meter();
    try { await batched.apply(keys); } finally { m.stop(); }
    console.log('[persist] 4 keys, file ' + size + ' B: one call per key ' + JSON.stringify({ bytes: before.bytes, copies: before.copies, syncs: before.syncs })
      + ' -> one batch ' + JSON.stringify({ bytes: m.bytes, copies: m.copies, syncs: m.syncs }));
    expect(before.syncs).toBe(4);
    expect(m.syncs).toBe(1);
    expect(m.copies).toBe(1);
    expect(m.bytes).toBeLessThan(size * 2.2);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved['vex.theme']).toBe('light');
    expect(saved['vex.new']).toBe('1');
  });

  it('writes nothing for a batch that changes nothing, and deletes with null', async () => {
    const file = bigFile();
    const store = createPreferenceStore(file);
    let m = meter();
    try { await store.apply([['vex.theme', 'dark'], ['vex.zooms', '{}'], ['vex.gone', null]]); } finally { m.stop(); }
    expect(m.syncs).toBe(0);
    m = meter();
    try { await store.apply([['vex.zooms', null]]); } finally { m.stop(); }
    expect(m.syncs).toBe(1);
    expect(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')), 'vex.zooms')).toBe(false);
  });
});

describe('the per-key JSON stores (main)', () => {
  it('a store saved with the same data is not written again', async () => {
    const store = new JsonStore(dir);
    const tabs = [{ id: 't1', url: 'https://example.org/', title: 'Example' }];
    await store.write('tabs', tabs);
    let m = meter();
    try { await store.write('tabs', structuredClone(tabs)); } finally { m.stop(); }
    expect(m.syncs).toBe(0);
    expect(m.copies).toBe(0);
    m = meter();
    try { await store.write('tabs', [...tabs, { id: 't2', url: 'https://example.com/', title: 'Other' }]); } finally { m.stop(); }
    expect(m.syncs).toBe(1);
    expect(await new JsonStore(dir).read('tabs')).toHaveLength(2);
  });
});

describe('the renderer side', () => {
  let storage;
  const calls = () => window.vex.persistApply.mock.calls.map(c => c[0]);
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    // Browser storage only: the previous test's shim would queue deletes.
    const originals = Storage.prototype[Symbol.for('vex.storage.originals')];
    (originals ? originals.clear : Storage.prototype.clear).call(localStorage);
    window.vex = { persistApply: vi.fn(async () => true), persistGetAll: vi.fn(async () => ({ __vexPreferenceStore: 1 })) };
    storage = (await import('../../src/renderer/js/storage.js?' + Math.random())).PersistentStorage;
    await storage.init();
    window.vex.persistApply.mockClear();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('sends a value saved unchanged nowhere', async () => {
    localStorage.setItem('vex.zooms', '{"a":1}');
    await vi.advanceTimersByTimeAsync(300);
    expect(calls()).toEqual([[['vex.zooms', '{"a":1}']]]);
    localStorage.setItem('vex.zooms', '{"a":1}');
    await vi.advanceTimersByTimeAsync(300);
    expect(calls()).toHaveLength(1);
  });

  it('saves 20 changed keys in one call, and 20 unchanged ones (a sync pull) in none', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => 'vex.k' + i);
    for (const k of keys) localStorage.setItem(k, 'v');
    await vi.advanceTimersByTimeAsync(300);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toHaveLength(20);
    for (const k of keys) localStorage.setItem(k, 'v');
    await vi.advanceTimersByTimeAsync(300);
    expect(calls()).toHaveLength(1);
  });

  it('a large batch is split so no one message is over the IPC limit', async () => {
    storage.APPLY_CHUNK_CHARS = 1000;
    localStorage.setItem('vex.a', 'x'.repeat(800));
    localStorage.setItem('vex.b', 'y'.repeat(800));
    await vi.advanceTimersByTimeAsync(300);
    expect(calls().map(c => c.map(([k]) => k))).toEqual([['vex.a'], ['vex.b']]);
  });

  it('a save that fails is tried again with the newest value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.vex.persistApply.mockRejectedValueOnce(new Error('disk busy'));
    localStorage.setItem('vex.a', '1');
    await expect(storage._flush()).rejects.toThrow('disk busy');
    // The value in browser storage did not change, but the file never got it.
    localStorage.setItem('vex.a', '1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls().at(-1)).toEqual([['vex.a', '1']]);
  });
});
