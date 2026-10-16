// @vitest-environment jsdom
//
// T2-004: Recall's index is bounded by size, page count and how long pages are
// kept; the limits are visible; no second copy (.bak) is written.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

const { RecallIndex } = require('../../src/main/recall-index.js');
const { StorageCeilings } = require('../../src/renderer/js/storage-ceilings.js');

const DAY = 86400000;
const page = (n, at, len = 100) => ({ url: 'https://a.com/' + n, title: 'T' + n, text: 'word '.repeat(len / 5), at });

describe('retention', () => {
  it('drops pages last read longer ago than the retention, at load and on put', () => {
    const now = Date.now();
    const idx = new RecallIndex([page(1, now - 100 * DAY), page(2, now - 10 * DAY)], { retainMs: 90 * DAY });
    expect(idx.records.map(r => r.url)).toEqual(['https://a.com/2']);
    idx.put(page(3, now));
    expect(idx.size).toBe(2);
  });
  it('keeps everything when the retention is 0', () => {
    const idx = new RecallIndex([page(1, 1)], { retainMs: 0 });
    expect(idx.size).toBe(1);
  });
});

describe('setLimits', () => {
  it('applies a smaller size cap now, oldest first, and reports how many went', () => {
    const now = Date.now();
    const recs = Array.from({ length: 10 }, (_, i) => page(i, now - i * 1000, 2000));
    const idx = new RecallIndex(recs, { maxBytes: 1e9 });
    const dropped = idx.setLimits({ maxBytes: 5000 });
    expect(dropped).toBeGreaterThan(0);
    expect(idx.bytes).toBeLessThanOrEqual(5000 + 2100);
    expect(idx.records[0].url).toBe('https://a.com/0');
  });
  it('applies a page cap and a shorter retention', () => {
    const now = Date.now();
    const idx = new RecallIndex([page(1, now), page(2, now - 5 * DAY), page(3, now - 20 * DAY)], {});
    expect(idx.setLimits({ maxRecords: 2 })).toBe(1);
    expect(idx.setLimits({ retainMs: 2 * DAY })).toBe(1);
    expect(idx.size).toBe(1);
  });
  it('refuses nonsense', () => {
    const idx = new RecallIndex([], {});
    expect(() => idx.setLimits({ maxRecords: 0 })).toThrow(/maxRecords/);
    expect(() => idx.setLimits({ maxBytes: 5 })).toThrow(/maxBytes/);
    expect(() => idx.setLimits({ retainMs: -1 })).toThrow(/retainMs/);
  });
  it('shows the limits in the numbers', () => {
    const s = new RecallIndex([], { maxBytes: 1234567, retainMs: 90 * DAY }).stats();
    expect(s).toMatchObject({ maxBytes: 1234567, retainMs: 90 * DAY });
  });
});

describe('main writes no second copy', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');
  it('the recall writer asks for no .bak and removes an old one', () => {
    const at = main.indexOf('const _recallWriter = createRecallWriter');
    const block = main.slice(at, at + 900);
    expect(block).toMatch(/atomicWrite\(RECALL_FILE\(\), bytes, \{ backup: false \}\)/);
    expect(block).toMatch(/rm\(RECALL_FILE\(\) \+ '\.bak'/);
  });
  it('the defaults are 12 MB, 3000 pages and 90 days', () => {
    expect(main).toMatch(/RECALL_LIMITS = \{ maxBytes: 12 \* 1024 \* 1024, maxRecords: 3000, retainMs: 90 \* 24 \* 3600 \* 1000 \}/);
  });
});

describe('StorageCeilings', () => {
  beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); window.VexProblems = { note: vi.fn() }; });

  it('saves limits inside the ranges and refuses outside them', () => {
    expect(StorageCeilings.limits()).toEqual({ days: 90, maxMB: 12, maxPages: 3000 });
    expect(StorageCeilings.setLimits({ days: 30, maxMB: 6 })).toEqual({ days: 30, maxMB: 6, maxPages: 3000 });
    expect(() => StorageCeilings.setLimits({ days: 1 })).toThrow(/days kept/);
    expect(() => StorageCeilings.setLimits({ maxMB: 500 })).toThrow(/size/);
    expect(() => StorageCeilings.setLimits({ maxPages: 150.5 })).toThrow(/whole numbers/);
  });
  it('raises damaged saved limits', () => {
    localStorage.setItem('vex.storage.recallLimits', '{x');
    expect(() => StorageCeilings.limits()).toThrow(/could not be read/);
  });
  it('sends them to main', async () => {
    window.vex = { recallLimits: vi.fn(async () => ({ dropped: 2 })) };
    StorageCeilings.setLimits({ days: 30 });
    await StorageCeilings.sendLimits();
    expect(window.vex.recallLimits).toHaveBeenCalledWith({ days: 30, maxMB: 12, maxPages: 3000 });
    window.vex = {};
    await expect(StorageCeilings.sendLimits()).rejects.toThrow(/cannot be applied/);
  });
  it('counts what a feature keeps against its budget, prefix keys included, biggest first', () => {
    globalThis.VexRegistry = { all: () => [
      { id: 'a', title: 'A', storageKeys: ['vex.a'], budget: { storageKB: 1 } },
      { id: 'b', title: 'B', storageKeys: ['vex.b.'], budget: { storageKB: 512 } },
      { id: 'c', title: 'C', storageKeys: ['vex.c'], budget: { storageKB: 512 } },
    ] };
    localStorage.setItem('vex.a', 'x'.repeat(3000));
    localStorage.setItem('vex.b.one', 'y'.repeat(100));
    localStorage.setItem('vex.b.two', 'y'.repeat(100));
    const u = StorageCeilings.usage();
    expect(u.map(r => r.id)).toEqual(['a', 'b']);
    expect(u[0].over).toBe(true);
    expect(u[1].over).toBe(false);
    expect(u[1].bytes).toBe('vex.b.one'.length + 100 + 'vex.b.two'.length + 100);
  });
});
