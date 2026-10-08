// @vitest-environment jsdom
//
// A private window never syncs (found 2026-10-08): its Settings could sign it
// in afresh, which registered a device named after it, pulled the account's
// bookmarks into the window and pushed from it. Main already refuses it the
// saved sign-in; these hand it one anyway, to prove the engine itself stays off.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const Records = require('../../src/renderer/js/sync-records.js');

const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
let calls;
function engine(privateWindow) {
  vi.resetModules();
  for (const f of ['sync-crypto.js', 'sync-engine.js', 'sync-settings.js']) delete require.cache[require.resolve('../../src/renderer/js/' + f)];
  window.VexTabPolicy = { isPrivateWindow: privateWindow, snapshot: (v) => v };
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
  window.VexSyncRecords = Records;
  window.vex = {
    syncSaveKey: async () => {}, syncSaveMeta: async () => {}, syncClearState: async () => {},
    syncLoadKey: async () => KEY,
    syncLoadMeta: async () => ({ email: 'a@b.test', sessionToken: 'tok', deviceId: 'dev1', revision: 0 }),
    platform: 'win32',
  };
  calls = [];
  window.VexNet = { fetch: async (url, opts = {}) => { calls.push([opts.method || 'GET', url]); return { ok: true, status: 200, json: async () => ({ ok: true, devCode: '123456', sessionToken: 't', deviceId: 'd', hasEncryptedData: true, items: [], devices: [] }) }; } };
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('a private window never syncs', () => {
  it('does not take up the saved sign-in, and sends nothing on its timers', async () => {
    const E = engine(true);
    expect(await E.initFromDisk()).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(calls).toEqual([]);
    expect(E.isEnabled()).toBe(false);
    expect(E.offInThisWindow()).toBe('Sync is off in private windows');
  });

  it('cannot be signed in from its Settings, and pulls, pushes and checks the mailbox not at all', async () => {
    const E = engine(true);
    await expect(E.requestCode('a@b.test')).rejects.toThrow('Sync is off in private windows');
    await expect(E.verifyCode('a@b.test', '123456', 'X')).rejects.toThrow('Sync is off in private windows');
    await expect(E.enrollWithRecoveryCode('a@b.test', '123456', KEY, 'X')).rejects.toThrow('Sync is off in private windows');
    expect(await E.pullNow()).toEqual({ ok: false, reason: 'Sync is off in private windows' });
    expect(await E.pushNow()).toEqual({ ok: false, reason: 'Sync is off in private windows' });
    expect(await E.dropFetch()).toEqual([]);
    await expect(E.dropSend('https://a.test/', 'A')).rejects.toThrow('Sync is off in private windows');
    await expect(E.listDevices()).rejects.toThrow('Sync is off in private windows');
    await expect(E.removeDevice('ab')).rejects.toThrow('Sync is off in private windows');
    expect(await E.wipeAllCloudData()).toEqual({ ok: false, reason: 'Sync is off in private windows' });
    expect(calls).toEqual([]);
    expect(E.isEnabled()).toBe(false);
  });

  it('its Settings say so instead of offering the sign-in', async () => {
    engine(true);
    require('../../src/renderer/js/sync-settings.js');
    const box = document.createElement('div');
    await window.SyncSettings.renderSyncPanel(box);
    expect(box.textContent).toContain('Sync is off in private windows');
    expect(box.querySelector('input, button')).toBeNull();
  });

  it('a normal window still starts from the saved sign-in', async () => {
    const E = engine(false);
    expect(await E.initFromDisk()).toBe(true);
    expect(E.offInThisWindow()).toBe('');
    E.signOut(false).catch(() => {});
  });
});
