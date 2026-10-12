// @vitest-environment jsdom
//
// Audit SY3 (2026-10-10): the email code alone is enough to sign a device in
// to a sync account, and nothing told the other devices. The worker protocol
// is not changed here (that is the owner's decision); what this device can do
// is notice a device it has not seen on the account before and say so.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');
const Contracts = require('../../src/renderer/js/data-contracts.js');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code, body = {}) => ({ ok: false, status: code, json: async () => body });

// Like the worker: a device joins the list on its first push or pull.
function fakeWorker() {
  const server = { blob: null, revision: 0, devices: [], nextDevice: 1, sessions: {} };
  const register = (token) => { const id = server.sessions[token]; if (id && !server.devices.some(d => d.deviceId === id)) server.devices.push({ deviceId: id, deviceName: 'This PC' }); };
  window.VexNet = {
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const path = url.replace('https://sync.test', '');
      const token = String(opts.headers?.Authorization || '').replace('Bearer ', '');
      if (path === '/auth/verify-code') {
        const deviceId = 'dev' + (server.nextDevice++);
        server.sessions['tok-' + deviceId] = deviceId;
        return ok({ sessionToken: 'tok-' + deviceId, deviceId, emailHash: 'hash', hasEncryptedData: !!server.blob });
      }
      if (path === '/sync/push') {
        const body = JSON.parse(opts.body);
        if (body.baseRevision !== server.revision) return status(409, { revision: server.revision });
        server.blob = body.encryptedBlob; server.revision += 1; register(token);
        return ok({ revision: server.revision });
      }
      if (path === '/sync/pull') { register(token); return ok(server.blob ? { encryptedBlob: server.blob, revision: server.revision } : { blob: null }); }
      if (path === '/sync/devices' && method === 'GET') {
        if (!server.devices.some(d => d.deviceId === server.sessions[token])) return status(403, { error: 'This device has not synced yet' });
        return ok({ devices: server.devices });
      }
      if (method === 'DELETE') return ok({ ok: true });
      return status(404);
    },
  };
  return server;
}

let stores;
function freshEngine() {
  vi.resetModules();
  stores = stores || new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = {
    syncSaveKey: async () => {}, syncSaveMeta: async () => {}, syncClearState: async () => {},
    syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32',
    notify: vi.fn(async () => ({ ok: true })),
  };
  window.VexTabPolicy = { snapshot: (v) => v };
  window.VexSyncRecords = Records;
  window.VexDataContracts = Contracts;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}

beforeEach(() => {
  localStorage.clear();
  stores = null;
  window.showToast = vi.fn();
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a new device on the sync account', () => {
  it('is said once, by name, on the desktop and in the window; the devices there when this one signed in are not', async () => {
    const server = fakeWorker();
    // A device that was already on the account when this one joined.
    server.devices.push({ deviceId: 'devOld', deviceName: 'Laptop' });
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    await engine.pushNow();
    expect(window.vex.notify).not.toHaveBeenCalled();
    expect(stores.get('sync-known-devices')).toEqual({ self: 'dev1', ids: ['devOld', 'dev1'] });
    // Someone with the email code signs in a device of their own.
    server.devices.push({ deviceId: 'devX', deviceName: 'DESKTOP-EVIL' });
    expect((await engine.pushNow()).ok).toBe(true);
    expect(window.vex.notify).toHaveBeenCalledTimes(1);
    expect(window.vex.notify).toHaveBeenCalledWith('A new device signed in to Vex Sync', expect.stringMatching(/^DESKTOP-EVIL signed in to your sync account\. If that was not you, remove it in Settings › Sync/));
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/^DESKTOP-EVIL signed in/), 'info', 15000);
    // Not again on the next round.
    expect((await engine.pushNow()).ok).toBe(true);
    expect(window.vex.notify).toHaveBeenCalledTimes(1);
    engine.signOut();
    await new Promise(r => setTimeout(r, 10));
    expect(stores.get('sync-known-devices')).toBeNull();
  });

  it('a device removed and another added is said; one only removed is not', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    await engine.pushNow();
    server.devices.push({ deviceId: 'devA', deviceName: 'Phone' });
    await engine.pushNow();
    expect(window.vex.notify).toHaveBeenCalledTimes(1);
    server.devices = server.devices.filter(d => d.deviceId !== 'devA');
    await engine.pushNow();
    expect(window.vex.notify).toHaveBeenCalledTimes(1);
    expect(stores.get('sync-known-devices').ids).toEqual(['dev1']);
    engine.signOut();
  });
});
