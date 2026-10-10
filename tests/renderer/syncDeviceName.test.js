// @vitest-environment jsdom
//
// Every device was called "Windows-" and four letters in Settings › Vex Sync,
// and nothing could change it (found 2026-10-10). The name is now asked at
// sign-in, can be changed later, and travels encrypted in the device's marker.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');

let stores, keyHex;
function freshEngine() {
  vi.resetModules();
  stores = new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = { syncSaveKey: async (hex) => { keyHex = hex; }, syncSaveMeta: async () => {}, syncClearState: async () => {}, syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32' };
  window.VexTabPolicy = { snapshot: (v) => v };
  window.VexSyncRecords = Records;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}
const key = () => window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(keyHex));
async function accountValues(system, token) {
  const r = await system.call('GET', '/sync/pull', undefined, token);
  return Records.unflatten(Records.values(await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key())));
}

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });

describe('naming this device', () => {
  it('the name given at sign-in is the one listed, and a rename reaches the account', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    await engine.verifyCode('name@sync.test', (await engine.requestCode('name@sync.test')).devCode, 'Study PC');
    const { sessionToken: token, deviceId: id } = engine.getState();
    const devices = (await system.call('GET', '/sync/devices', undefined, token)).body.devices;
    expect(devices.find(d => d.deviceId === id).deviceName).toBe('Study PC');
    expect(engine.thisDeviceName()).toBe('Study PC');
    expect((await accountValues(system, token))['sync:device:' + id]).toMatchObject({ level: 2, name: 'Study PC' });

    await engine.renameDevice('  Kitchen\nlaptop ');
    expect(engine.thisDeviceName()).toBe('Kitchen laptop');
    expect((await accountValues(system, token))['sync:device:' + id].name).toBe('Kitchen laptop');
    expect(engine.nameOf(devices.find(d => d.deviceId === id))).toBe('Kitchen laptop');
    await expect(engine.renameDevice('   ')).rejects.toThrow('Give this device a name');
  });

  it('another device is shown by the name in its marker', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    await engine.verifyCode('other@sync.test', (await engine.requestCode('other@sync.test')).devCode, 'Desk');
    const other = await system.signIn('other@sync.test', 'Windows-7K2Q');
    const pulled = await system.call('GET', '/sync/pull', undefined, other.sessionToken);
    const doc = await window.SyncCrypto.decrypt(pulled.body.encryptedBlob, await key());
    const values = Records.unflatten(Records.values(doc));
    values['sync:device:' + other.deviceId] = { level: 2, revision: pulled.body.revision, name: 'Pixel 9' };
    await system.push(other.sessionToken, pulled.body.revision, await window.SyncCrypto.encrypt(Records.capture(doc, Records.flatten(values), other.deviceId), await key()));
    expect((await engine.pullNow()).ok).toBe(true);
    expect(engine.nameOf({ deviceId: other.deviceId, deviceName: 'Windows-7K2Q' })).toBe('Pixel 9');
  });
});
