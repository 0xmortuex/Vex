// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let storage;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear(); sessionStorage.clear();
  window.vex = { persistSet: vi.fn(async () => true), persistDelete: vi.fn(async () => true), persistGetAll: vi.fn(async () => ({})) };
  storage = (await import('../../src/renderer/js/storage.js')).PersistentStorage;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('mirrors real Storage writes and removals through IPC', async () => {
  localStorage.setItem('vex.name', 'Ada');
  await vi.advanceTimersByTimeAsync(300);
  expect(window.vex.persistSet).toHaveBeenCalledWith('vex.name', 'Ada');
  localStorage.removeItem('vex.name');
  await vi.advanceTimersByTimeAsync(300);
  expect(window.vex.persistDelete).toHaveBeenCalledWith('vex.name');
  expect(localStorage.getItem('setItem')).toBeNull();
});

it('mirrors clear while leaving sessionStorage and unrelated keys out of disk storage', async () => {
  localStorage.setItem('vex.name', 'Ada'); localStorage.setItem('other', 'x');
  sessionStorage.setItem('vex.session', 'temporary');
  await vi.advanceTimersByTimeAsync(300);
  expect(window.vex.persistSet.mock.calls).toEqual([['vex.name', 'Ada']]);
  localStorage.clear();
  await vi.advanceTimersByTimeAsync(300);
  expect(window.vex.persistDelete.mock.calls).toEqual([['vex.name']]);
});

it('hydrates values from the authoritative disk mirror', async () => {
  window.vex.persistGetAll.mockResolvedValue({ 'vex.name': 'Restored' });
  await storage.init();
  expect(localStorage.getItem('vex.name')).toBe('Restored');
});

it('does not resurrect deleted preferences from a stale Chromium copy', async () => {
  // A stale value predating this launch has no pending write.
  localStorage.setItem('vex.deleted', 'old');
  await storage._flush();
  window.vex.persistSet.mockClear();
  window.vex.persistGetAll.mockResolvedValue({ __vexPreferenceStore: 1 });
  await storage.init();
  expect(localStorage.getItem('vex.deleted')).toBeNull();
  expect(window.vex.persistSet).not.toHaveBeenCalled();
  expect(localStorage.getItem('__vexPreferenceStore')).toBeNull();
});

it('preserves new writes arriving during hydration', async () => {
  let resolve;
  window.vex.persistGetAll.mockImplementation(() => new Promise(r => { resolve = r; }));
  const initialized = storage.init();
  localStorage.setItem('vex.name', 'New');
  resolve({ 'vex.name': 'Old', __vexPreferenceStore: 1 });
  await initialized;
  expect(localStorage.getItem('vex.name')).toBe('New');
  expect(window.vex.persistSet).toHaveBeenCalledWith('vex.name', 'New');
});

it('keeps overlapping disk batches in order when an IPC call stalls', async () => {
  let release;
  window.vex.persistSet.mockImplementationOnce(() => new Promise(r => { release = r; }));
  localStorage.setItem('vex.a', 'old'); localStorage.setItem('vex.b', 'old');
  const first = storage._flush();
  await Promise.resolve();
  localStorage.setItem('vex.b', 'new');
  const second = storage._flush();
  await Promise.resolve();
  expect(window.vex.persistSet.mock.calls).toEqual([['vex.a', 'old']]);
  release(true);
  await Promise.all([first, second]);
  expect(window.vex.persistSet.mock.calls).toEqual([['vex.a', 'old'], ['vex.b', 'old'], ['vex.b', 'new']]);
});

it('rejects non-hex recovery keys rather than silently converting invalid bytes to zero', async () => {
  await import('../../src/renderer/js/sync-crypto.js');
  expect(() => window.SyncCrypto.hexToKey('z'.repeat(64))).toThrow();
  expect(() => window.SyncCrypto.hexToKey(null)).toThrow('Invalid recovery code');
  expect(window.SyncCrypto.hexToKey('ab'.repeat(32))).toEqual(new Uint8Array(32).fill(171));
});
