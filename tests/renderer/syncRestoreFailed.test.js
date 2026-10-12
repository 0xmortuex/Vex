// @vitest-environment jsdom
//
// A saved sign-in that cannot be used must be said, not shown as a quiet "Not
// signed in" (found 2026-10-09): Vex closed between saving the key and its
// details while signing in, or a saved sign-in Windows can no longer decrypt,
// left the device signed out with no word on the next start.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');

const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const META = { email: 'a@b.test', sessionToken: 'tok', deviceId: 'dev1', revision: 0 };
let calls;
function engine({ key = async () => KEY, meta = async () => META } = {}) {
  vi.resetModules();
  for (const f of ['sync-crypto.js', 'sync-engine.js']) delete require.cache[require.resolve('../../src/renderer/js/' + f)];
  window.VexTabPolicy = { isPrivateWindow: false, snapshot: (v) => v };
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
  window.VexSyncRecords = Records;
  window.vex = {
    syncSaveKey: async () => {}, syncSaveMeta: async () => {},
    syncClearState: vi.fn(async () => true),
    syncLoadKey: key, syncLoadMeta: meta,
    platform: 'win32',
  };
  calls = [];
  window.VexNet = { fetch: async (url, opts = {}) => { calls.push([opts.method || 'GET', url]); return { ok: true, status: 200, json: async () => ({ ok: true, items: [], devices: [] }) }; } };
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}
const errors = () => window.showToast.mock.calls.filter(c => c[1] === 'error').map(c => c[0]);

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('starting from a saved sign-in that cannot be used', () => {
  it('a sign-in cut short (key saved, details not) is cleared and said, and nothing is sent', async () => {
    const E = engine({ meta: async () => null });
    expect(await E.initFromDisk()).toBe(false);
    expect(window.vex.syncClearState).toHaveBeenCalledOnce();
    expect(errors()).toEqual(['Vex Sync’s last sign-in did not finish (Vex was closed during it), so this device is signed out. Sign in again in Settings › Vex Sync.']);
    expect(window.showToast.mock.calls[0][2]).toBe(15000);
    expect(E.isEnabled()).toBe(false);
    expect(E.getState().lastError).toMatch(/did not finish/);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(calls).toEqual([]);
  });

  it('Settings › Vex Sync still says why after the toast has gone', async () => {
    const E = engine({ meta: async () => null });
    await E.initFromDisk();
    for (const f of ['vex-icons.js', 'sync-settings.js']) delete require.cache[require.resolve('../../src/renderer/js/' + f)];
    const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
    globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
    require('../../src/renderer/js/sync-settings.js');
    const box = document.createElement('div');
    await window.SyncSettings.renderSyncPanel(box);
    expect(box.querySelector('.sync-restore-error[role="alert"]').textContent).toContain('last sign-in did not finish');
    expect(box.querySelector('#sync-email-input')).not.toBeNull();
  });

  it('details without a key are treated the same way', async () => {
    const E = engine({ key: async () => null });
    expect(await E.initFromDisk()).toBe(false);
    expect(window.vex.syncClearState).toHaveBeenCalledOnce();
    expect(errors()).toHaveLength(1);
  });

  it('a saved sign-in that cannot be read is said, with the reason, and is kept for another try', async () => {
    // The error as it really arrives over IPC (seen live, 2026-10-09).
    const E = engine({ meta: async () => { throw new Error("Error invoking remote method 'sync-load-meta': Error: Error while decrypting the ciphertext provided to safeStorage.decryptString."); } });
    expect(await E.initFromDisk()).toBe(false);
    expect(errors()).toEqual(['Vex Sync could not read this device’s saved sign-in (Windows could not decrypt it), so it is signed out. Sign in again in Settings › Vex Sync.']);
    expect(window.vex.syncClearState).not.toHaveBeenCalled();
    expect(E.isEnabled()).toBe(false);
  });

  it('a saved key that is not a key is said', async () => {
    const E = engine({ key: async () => 'not-hex' });
    expect(await E.initFromDisk()).toBe(false);
    expect(errors()[0]).toMatch(/^Vex Sync could not use this device’s saved key \(/);
    expect(E.isEnabled()).toBe(false);
  });

  it('no saved sign-in at all stays quiet', async () => {
    const E = engine({ key: async () => null, meta: async () => null });
    expect(await E.initFromDisk()).toBe(false);
    expect(window.showToast).not.toHaveBeenCalled();
    expect(window.vex.syncClearState).not.toHaveBeenCalled();
  });

  it('a whole saved sign-in still starts signed in, with no message', async () => {
    const E = engine();
    expect(await E.initFromDisk()).toBe(true);
    expect(errors()).toEqual([]);
    expect(E.isEnabled()).toBe(true);
    E.signOut(false).catch(() => {});
  });
});
