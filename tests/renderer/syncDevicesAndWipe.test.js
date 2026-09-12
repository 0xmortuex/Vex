// @vitest-environment jsdom
//
// Sync's two "looks like success" faults:
//   * a device list that failed to load was drawn as "no devices";
//   * Wipe Cloud left a stale local revision, so every later push hit the
//     worker's baseRevision check and 409'd forever, and the next authenticated
//     call 401'd into a silent sign-out while the panel still said signed in.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');

let fetchCalls;
function stubServer(routes) {
  fetchCalls = [];
  window.VexNet = {
    fetch: async (url, opts = {}) => {
      fetchCalls.push({ url, method: opts.method || 'GET', body: opts.body });
      for (const [pattern, reply] of Object.entries(routes)) {
        if (url.includes(pattern)) return typeof reply === 'function' ? reply(opts) : reply;
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({ error: 'nope' }) });

let toasts;
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '';
  toasts = [];
  window.showToast = (message, type) => toasts.push({ message, type });
  window.vexConfirm = vi.fn(async () => true);
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
});
afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
describe('SyncEngine device calls report failure instead of swallowing it', () => {
  // Enrol against a stubbed worker so the engine is in its signed-in state.
  async function signedInEngine(routes) {
    stubServer({
      '/auth/verify-code': ok({ sessionToken: 'tok', deviceId: 'dev1', emailHash: 'hash', hasEncryptedData: false }),
      '/sync/push': ok({ revision: 7 }),
      ...routes,
    });
    window.vex = {
      syncSaveKey: async () => {}, syncSaveMeta: async () => {}, syncClearState: async () => {},
      syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32',
      loadData: async () => null, saveData: async () => true,
    };
    global.VexStorage = { load: async () => null, save: async () => true };
    global.window.VexSyncRecords = {
      empty: () => ({ schema: 2, records: {} }),
      flatten: (d) => d,
      capture: (doc) => doc,
      merge: (a) => a,
      values: (d) => d,
      unflatten: (d) => d,
    };
    require('../../src/renderer/js/sync-crypto.js');
    require('../../src/renderer/js/sync-engine.js');
    const engine = window.SyncEngine;
    await engine.verifyCode('a@b.test', '123456');
    return engine;
  }

  it('listDevices throws on a server error rather than returning an empty list', async () => {
    const engine = await signedInEngine({ '/sync/devices': fail(503) });
    await expect(engine.listDevices()).rejects.toThrow(/503/);
  });

  it('listDevices throws when the response is not a device list', async () => {
    const engine = await signedInEngine({ '/sync/devices': ok({ ok: true }) });
    await expect(engine.listDevices()).rejects.toThrow(/unexpected response/i);
  });

  it('listDevices still returns a genuinely empty list', async () => {
    const engine = await signedInEngine({ '/sync/devices': ok({ devices: [] }) });
    await expect(engine.listDevices()).resolves.toEqual([]);
  });

  it('removeDevice throws when the server refuses', async () => {
    const engine = await signedInEngine({ '/sync/devices/': fail(500) });
    await expect(engine.removeDevice('other')).rejects.toThrow(/500/);
  });

  it('wipe resets the revision and signs out, so pushes are not stuck at 409', async () => {
    const engine = await signedInEngine({ '/sync/all': ok({ ok: true }) });
    expect(engine.getState().enabled).toBe(true);

    const res = await engine.wipeAllCloudData();
    expect(res).toMatchObject({ ok: true, signedOut: true });
    // The server dropped the device registry along with the blob, so staying
    // "signed in" here was a lie the next request would have discovered.
    expect(engine.getState().enabled).toBe(false);
    expect(engine.isEnabled()).toBe(false);
  });

  it('a failed wipe says why and leaves the session alone', async () => {
    const engine = await signedInEngine({ '/sync/all': fail(500) });
    const res = await engine.wipeAllCloudData();
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/500/);
    expect(engine.getState().enabled).toBe(true);
  });

  it('syncs the per-site force-dark list that the rename left behind', async () => {
    require('../../src/renderer/js/sync-engine.js');
    // 'vex.forceDarkSites' is the retired global flag; the live per-site key is
    // 'vex.forceDarkHosts', and it was missing from SYNC_KEYS entirely.
    expect(window.SyncEngine.SYNC_KEYS).toContain('vex.forceDarkHosts');
  });
});

// ---------------------------------------------------------------------------
describe('Sync settings panel distinguishes "no devices" from "could not ask"', () => {
  // sync-settings.js reads the global lexical `SyncEngine` binding, so the stub
  // has to be installed before the module is evaluated.
  async function renderWith(listDevices) {
    vi.resetModules();
    global.SyncEngine = {
      getState: () => ({ enabled: true, email: 'a@b.test', deviceId: 'dev1', lastPushAt: null, lastPullAt: null }),
      listDevices,
    };
    require('../../src/renderer/js/sync-settings.js');
    const host = document.createElement('div');
    host.id = 'sync-panel-content';
    document.body.appendChild(host);
    await window.SyncSettings.renderSyncPanel(host);
    return host;
  }

  it('an empty account reads as empty', async () => {
    const host = await renderWith(async () => []);
    expect(host.querySelector('.sync-subsection h3').textContent).toContain('(0)');
    expect(host.querySelector('.device-list').textContent).toMatch(/No devices yet/);
    expect(host.querySelector('.sync-devices-error')).toBeNull();
  });

  it('a failure reads as a failure, with the reason and a retry', async () => {
    const host = await renderWith(async () => { throw new Error('Could not load your devices (server returned 503)'); });
    expect(host.querySelector('.sync-subsection h3').textContent).toContain('unavailable');
    const error = host.querySelector('.sync-devices-error');
    expect(error).toBeTruthy();
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toMatch(/503/);
    expect(host.querySelector('#btn-retry-devices')).toBeTruthy();
    expect(host.querySelector('.device-list').textContent).not.toMatch(/No devices yet/);
    delete global.SyncEngine;
  });

  it('lists real devices when the call succeeds', async () => {
    const host = await renderWith(async () => ([
      { deviceId: 'dev1', deviceName: 'This Laptop', createdAt: null, lastSeenAt: null },
      { deviceId: 'dev2', deviceName: 'Desktop', createdAt: null, lastSeenAt: null },
    ]));
    expect(host.querySelector('.sync-subsection h3').textContent).toContain('(2)');
    expect(host.querySelectorAll('.device-item')).toHaveLength(2);
    // Only the other device gets a Remove button.
    expect(host.querySelectorAll('[data-device-id]')).toHaveLength(1);
    delete global.SyncEngine;
  });
});
