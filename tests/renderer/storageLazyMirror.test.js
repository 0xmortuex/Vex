// @vitest-environment jsdom
//
// Opening a sidebar panel stamps vex.panelUsage, and every stamp used to
// rewrite the whole preferences file and its .bak (up to 1.3 MB): twice per
// panel visit. The stamp is now readable at once but copied to the file at
// most every few minutes, and when Vex closes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let storage;
let flushRequested;
const writes = () => window.vex.persistApply.mock.calls.map(c => c[0]);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  // The native clear: the shim of an earlier test's module would queue deletes.
  const originals = Storage.prototype[Symbol.for('vex.storage.originals')];
  (originals ? originals.clear : Storage.prototype.clear).call(localStorage);
  flushRequested = null;
  window.vex = {
    persistApply: vi.fn(async () => true),
    persistGetAll: vi.fn(async () => ({})),
    flushStorage: vi.fn(async () => true),
    onFlushRequested: (cb) => { flushRequested = cb; },
  };
  storage = (await import('../../src/renderer/js/storage.js?lazy' + Math.random())).PersistentStorage;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('vex.panelUsage', () => {
  it('is readable the moment it is set, and sent to the file only after the lazy interval', async () => {
    for (let i = 0; i < 10; i++) localStorage.setItem('vex.panelUsage', JSON.stringify({ notes: i }));
    expect(JSON.parse(localStorage.getItem('vex.panelUsage'))).toEqual({ notes: 9 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(storage.LAZY_MIRROR_MS);
    await vi.advanceTimersByTimeAsync(300);
    expect(writes()).toEqual([[['vex.panelUsage', JSON.stringify({ notes: 9 })]]]);
  });

  it('is sent when Vex is asked to flush for closing', async () => {
    localStorage.setItem('vex.panelUsage', '{"notes":1}');
    expect(typeof flushRequested).toBe('function');
    const done = flushRequested();
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(writes()).toEqual([[['vex.panelUsage', '{"notes":1}']]]);
  });

  it('does not hold back any other key', async () => {
    localStorage.setItem('vex.panelUsage', '{"notes":1}');
    localStorage.setItem('vex.theme', 'oxford');
    await vi.advanceTimersByTimeAsync(300);
    expect(writes()).toEqual([[['vex.theme', 'oxford']]]);
  });

  it('a removal is still sent at once and nothing is resurrected afterwards', async () => {
    localStorage.setItem('vex.panelUsage', '{"notes":1}');
    localStorage.removeItem('vex.panelUsage');
    await vi.advanceTimersByTimeAsync(300);
    expect(writes()).toEqual([[['vex.panelUsage', null]]]);
    await vi.advanceTimersByTimeAsync(storage.LAZY_MIRROR_MS + 300);
    expect(writes()).toHaveLength(1);
  });
});
