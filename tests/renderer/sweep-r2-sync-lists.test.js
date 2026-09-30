// @vitest-environment jsdom
//
// Synced settings that hold lists — tools, scheduled tasks, personas,
// reminders, force-dark sites — were one value each, so when two devices
// changed the same list between syncs (or one joined), one device's whole
// list replaced the other's (found 2026-09-30). They now merge item by item,
// as bookmarks and notes do; a copy an older Vex sends whole still wins whole.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code, body = {}) => ({ ok: false, status: code, json: async () => body });

function fakeWorker() {
  const server = { blob: null, revision: 0, devices: [], nextDevice: 1 };
  window.VexNet = {
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const path = url.replace('https://sync.test', '');
      if (path === '/auth/verify-code') {
        const deviceId = 'dev' + (server.nextDevice++);
        return ok({ sessionToken: 'tok-' + deviceId, deviceId, emailHash: 'hash', hasEncryptedData: !!server.blob });
      }
      if (path === '/sync/push') {
        const body = JSON.parse(opts.body);
        if (body.baseRevision !== server.revision) return status(409, { revision: server.revision });
        server.blob = body.encryptedBlob; server.revision += 1;
        return ok({ revision: server.revision });
      }
      if (path === '/sync/pull') return ok(server.blob ? { encryptedBlob: server.blob, revision: server.revision } : { blob: null });
      if (method === 'DELETE') return ok({ ok: true });
      return status(404);
    },
  };
  return server;
}

let stores, savedKeyHex;
function freshEngine() {
  vi.resetModules();
  stores = new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = {
    syncSaveKey: async (hex) => { savedKeyHex = hex; }, syncSaveMeta: async () => {}, syncClearState: async () => {},
    syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32',
  };
  window.VexTabPolicy = { snapshot: (v) => v };
  window.VexSyncRecords = Records;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}

const LISTS = {
  'vex.tools': (n) => ({ id: 'tool_' + n, name: 'Tool ' + n, url: 'https://' + n + '.test/', desc: '', svg: '' }),
  'vex.schedules': (n) => ({ id: 'task_' + n, v: 2, name: 'Task ' + n, enabled: true }),
  'vex.personas': (n) => ({ id: 'persona_' + n, name: 'Persona ' + n, systemPrompt: 'Be ' + n }),
  'vex.reminders': (n) => ({ id: 'rem_' + n, message: 'Reminder ' + n, at: 1000 }),
  'vex.forceDarkHosts': (n) => n + '.test',
};
const read = (key) => JSON.parse(localStorage.getItem(key) || 'null');
const idOf = (item) => (typeof item === 'string' ? item : item.id);

// Stand in for another device: take the account's document, change it the way
// that device would, and upload it (clock entries under its own id).
async function otherDevicePushes(server, key, change, device = 'devB') {
  const doc = await window.SyncCrypto.decrypt(server.blob, key);
  const values = Records.unflatten(Records.values(doc));
  change(values);
  const next = Records.capture(doc, Records.flatten(values), device);
  server.blob = await window.SyncCrypto.encrypt(next, key);
  server.revision += 1;
}
async function accountValues(server, key) {
  return Records.unflatten(Records.values(await window.SyncCrypto.decrypt(server.blob, key)));
}

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
});
afterEach(() => { vi.restoreAllMocks(); });

describe.each(Object.keys(LISTS))('%s', (listKey) => {
  const make = LISTS[listKey];

  it('two devices adding to it between syncs keep both additions', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    localStorage.setItem(listKey, JSON.stringify([make('one')]));
    await engine.verifyCode('a@b.test', '123456');
    const key = await window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
    // The other device adds "two"; this one adds "three" before it has pulled.
    await otherDevicePushes(server, key, v => { v['preference:' + listKey] = [...v['preference:' + listKey], make('two')]; });
    localStorage.setItem(listKey, JSON.stringify([make('one'), make('three')]));
    expect((await engine.pushNow()).ok).toBe(true);   // 409 → pull, merge → push
    expect(read(listKey).map(idOf).sort()).toEqual([make('one'), make('three'), make('two')].map(idOf).sort());
    const cloud = await accountValues(server, key);
    expect(cloud['preference:' + listKey].map(idOf).sort()).toEqual([make('one'), make('three'), make('two')].map(idOf).sort());
    engine.signOut();
  });

  it('a removal on one device and an addition on the other both stand', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    localStorage.setItem(listKey, JSON.stringify([make('one'), make('two')]));
    await engine.verifyCode('a@b.test', '123456');
    const key = await window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
    await otherDevicePushes(server, key, v => { v['preference:' + listKey] = v['preference:' + listKey].filter(x => idOf(x) !== idOf(make('one'))); });
    localStorage.setItem(listKey, JSON.stringify([make('one'), make('two'), make('three')]));
    expect((await engine.pushNow()).ok).toBe(true);
    expect(read(listKey).map(idOf).sort()).toEqual([make('three'), make('two')].map(idOf).sort());
    engine.signOut();
  });

  it('joining with a recovery code keeps this device\'s items and takes the account\'s', async () => {
    const server = fakeWorker();
    const first = freshEngine();
    localStorage.setItem(listKey, JSON.stringify([make('cloud')]));
    const { recoveryCode } = await first.verifyCode('a@b.test', '123456');
    await first.signOut();
    localStorage.clear();
    const engine = freshEngine();
    localStorage.setItem(listKey, JSON.stringify([make('local')]));
    expect((await engine.enrollWithRecoveryCode('a@b.test', '123456', recoveryCode)).ok).toBe(true);
    expect(read(listKey).map(idOf).sort()).toEqual([make('cloud'), make('local')].map(idOf).sort());
    engine.signOut();
  });

  it('an account an older Vex wrote whole is taken whole when joining', async () => {
    const server = fakeWorker();
    freshEngine();
    const key = await window.SyncCrypto.generateKey();
    const hex = window.SyncCrypto.keyToHex(await window.SyncCrypto.exportKey(key));
    // The older Vex keeps the list as its raw string.
    const doc = Records.capture(Records.empty(), Records.flatten({ ['preference:' + listKey]: JSON.stringify([make('old')]) }), 'devOld');
    server.blob = await window.SyncCrypto.encrypt(doc, key); server.revision = 1;
    const engine = freshEngine();
    localStorage.setItem(listKey, JSON.stringify([make('local')]));
    expect((await engine.enrollWithRecoveryCode('a@b.test', '123456', window.SyncCrypto.formatRecoveryCode(hex))).ok).toBe(true);
    expect(read(listKey).map(idOf)).toEqual([idOf(make('old'))]);
    engine.signOut();
  });

  it('an older Vex writing it whole while this device adds an item: the older copy wins whole, nothing is mixed', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    localStorage.setItem(listKey, JSON.stringify([make('one')]));
    await engine.verifyCode('a@b.test', '123456');
    const key = await window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
    // The older device keeps the list as one string and adds "two".
    await otherDevicePushes(server, key, v => { v['preference:' + listKey] = JSON.stringify([make('one'), make('two')]); }, 'devOld');
    localStorage.setItem(listKey, JSON.stringify([make('one'), make('three')]));
    expect((await engine.pushNow()).ok).toBe(true);
    // Its item rows used to replace the older device's list: ['three'] only.
    expect(read(listKey).map(idOf)).toEqual([make('one'), make('two')].map(idOf));
    engine.signOut();
  });
});

describe('what cannot be synced as a list', () => {
  it('a stored value that is not a list stops the upload with a clear error on the device that has it', async () => {
    fakeWorker();
    const engine = freshEngine();
    localStorage.setItem('vex.personas', '{"not":"a list"}');
    await expect(engine.verifyCode('a@b.test', '123456')).rejects.toThrow(/Invalid personas data/);
  });
});
