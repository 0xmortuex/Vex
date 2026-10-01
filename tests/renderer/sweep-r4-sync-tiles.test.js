// @vitest-environment jsdom
//
// Shortcut tiles (localStorage 'vex.shortcuts') never synced: preferenceKeys()
// dropped the key because the unused storage key 'shortcuts' has the same name
// (found 2026-09-30). Vex 2.34.2 and older mark every record they do not know
// as deleted on each push, so tiles now sync only while every device on the
// account has written a marker saying it understands them; until then each
// device keeps its own tiles and leaves the account's tile records alone.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');
const Contracts = require('../../src/renderer/js/data-contracts.js');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code, body = {}) => ({ ok: false, status: code, json: async () => body });
const TILES = 'preference:vex.shortcuts';

// Like the worker: a device joins the list on its first push or pull, and has
// no device list (403) before that.
function fakeWorker() {
  const server = { blob: null, revision: 0, devices: [], nextDevice: 1, sessions: {} };
  const register = (token) => { const id = server.sessions[token]; if (id && !server.devices.some(d => d.deviceId === id)) server.devices.push({ deviceId: id }); };
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
  window.VexDataContracts = Contracts;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}

const tile = (name) => ({ name, url: 'https://' + name + '.test' });
const tiles = () => JSON.parse(localStorage.getItem('vex.shortcuts') || 'null');
const names = (list) => (list || []).map(t => t.name).sort();
const setTiles = (list) => localStorage.setItem('vex.shortcuts', JSON.stringify(list));
const accountKey = () => window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
const accountDoc = async (server, key) => window.SyncCrypto.decrypt(server.blob, key);
const accountValues = async (server, key) => Records.unflatten(Records.values(await accountDoc(server, key)));

// Another device uploads: take the account's document, change it the way that
// device would, and push it under its own clock entry.
async function otherDevicePushes(server, key, device, change) {
  const doc = await accountDoc(server, key);
  const values = Records.unflatten(Records.values(doc));
  change(values);
  server.blob = await window.SyncCrypto.encrypt(Records.capture(doc, Records.flatten(values), device), key);
  server.revision += 1;
  if (!server.devices.some(d => d.deviceId === device)) server.devices.push({ deviceId: device });
}
// A current Vex: writes its marker and its tiles.
const newDevice = (server, key, device, change) => otherDevicePushes(server, key, device, v => { v['sync:device:' + device] = { level: 1 }; change?.(v); });
// Vex 2.34.2: sends only the sources it knows, so everything else it finds in
// the account (tiles, markers) is marked deleted.
const oldDevice = (server, key, device) => otherDevicePushes(server, key, device, v => {
  for (const source of Object.keys(v)) if (source === TILES || source.startsWith('sync:device:')) delete v[source];
});

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
});
afterEach(() => { vi.restoreAllMocks(); });

describe('shortcut tiles sync when every device understands them', () => {
  it('a lone device uploads its tiles, with ids from their addresses, after its first sync', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    setTiles([tile('a'), tile('b'), tile('a')]);
    await engine.verifyCode('a@b.test', '123456');
    const key = await accountKey();
    // The first upload happens before the server lists the device: tiles wait.
    expect((await accountValues(server, key))[TILES]).toBeUndefined();
    expect((await accountValues(server, key))['sync:device:dev1']).toEqual({ level: 1 });
    expect((await engine.pushNow()).ok).toBe(true);
    const cloud = (await accountValues(server, key))[TILES];
    expect(cloud.map(t => t.name)).toEqual(['a', 'b', 'a']);
    // Same address twice (Duplicate) is two tiles, not one overwriting the other.
    expect(new Set(cloud.map(t => t.id)).size).toBe(3);
    expect(cloud[2].id).toBe(cloud[0].id + '-2');
    // The ids stay in the account; the tiles saved here are unchanged.
    expect(tiles()).toEqual([tile('a'), tile('b'), tile('a')]);
    expect(engine.tileSyncState()).toEqual({ open: true, waitingOn: [] });
    engine.signOut();
  });

  it('two current devices merge their tiles both ways, and a removal travels', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    setTiles([tile('a')]);
    await engine.verifyCode('a@b.test', '123456');
    await engine.pushNow();
    const key = await accountKey();
    await newDevice(server, key, 'devB', v => { v[TILES] = [...v[TILES], { ...tile('b'), id: 'tile-b' }]; });
    setTiles([tile('a'), tile('c')]);
    expect((await engine.pushNow()).ok).toBe(true);   // 409 → pull, merge → push
    expect(names(tiles())).toEqual(['a', 'b', 'c']);
    expect(names((await accountValues(server, key))[TILES])).toEqual(['a', 'b', 'c']);
    // The other device removes "a".
    await newDevice(server, key, 'devB', v => { v[TILES] = v[TILES].filter(t => t.name !== 'a'); });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(names(tiles())).toEqual(['b', 'c']);
    // And this one removes "b".
    setTiles(tiles().filter(t => t.name !== 'b'));
    expect((await engine.pushNow()).ok).toBe(true);
    expect(names((await accountValues(server, key))[TILES])).toEqual(['c']);
    expect(window.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/conflict/));
    engine.signOut();
  });

  it('joining with a recovery code keeps this device\'s tiles and takes the account\'s', async () => {
    const server = fakeWorker();
    const first = freshEngine();
    setTiles([tile('cloud')]);
    const { recoveryCode } = await first.verifyCode('a@b.test', '123456');
    await first.pushNow();
    // The first device stays on the account, signed in (not signed out).
    localStorage.clear();
    const engine = freshEngine();
    setTiles([tile('local'), { name: 'Mail', url: 'mailto:me@b.test' }]);
    expect((await engine.enrollWithRecoveryCode('a@b.test', '123456', recoveryCode)).ok).toBe(true);
    expect(names(tiles())).toEqual(['Mail', 'cloud', 'local']);
    const key = await accountKey();
    // A tile every device would refuse (mailto:) stays here only.
    expect(names((await accountValues(server, key))[TILES])).toEqual(['cloud', 'local']);
    expect((await engine.pullNow()).ok).toBe(true);
    expect(names(tiles())).toEqual(['Mail', 'cloud', 'local']);
    engine.signOut();
  });

  it('a device with no tiles of its own takes the account\'s', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    await engine.pushNow();
    expect(tiles()).toBeNull();
    const key = await accountKey();
    await newDevice(server, key, 'devB', v => { v[TILES] = [{ ...tile('b'), id: 'tile-b' }]; });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(names(tiles())).toEqual(['b']);
    engine.signOut();
  });
});

describe('an older Vex on the account', () => {
  it('while it is listed, tiles stay on each device and nothing is lost when it pushes', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    setTiles([tile('a'), tile('b')]);
    await engine.verifyCode('a@b.test', '123456');
    const key = await accountKey();
    // An older device is on the account before tiles ever synced.
    await oldDevice(server, key, 'devOld');
    expect((await engine.pullNow()).ok).toBe(true);
    expect((await engine.pushNow()).ok).toBe(true);
    expect((await accountValues(server, key))[TILES]).toBeUndefined();
    expect(engine.tileSyncState()).toEqual({ open: false, waitingOn: ['devOld'] });
    expect(names(tiles())).toEqual(['a', 'b']);
    engine.signOut();
  });

  it('an older device joining later shuts the gate: its deletions never reach this device\'s tiles, and they come back once it leaves', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    setTiles([tile('a'), tile('b')]);
    await engine.verifyCode('a@b.test', '123456');
    await engine.pushNow();
    const key = await accountKey();
    expect(names((await accountValues(server, key))[TILES])).toEqual(['a', 'b']);
    // Vex 2.34.2 joins and pushes: it marks the tiles (and markers) deleted.
    await oldDevice(server, key, 'devOld');
    expect((await accountValues(server, key))[TILES]).toBeUndefined();
    expect((await engine.pullNow()).ok).toBe(true);
    expect(names(tiles())).toEqual(['a', 'b']);
    // The pull found this device's marker deleted and pushes it back (r7).
    await vi.waitFor(async () => expect((await accountValues(server, key))['sync:device:dev1']).toEqual({ level: 1 }));
    expect((await accountValues(server, key))[TILES]).toBeUndefined();
    // A tile added meanwhile stays here, and this device leaves the account's
    // tile records exactly as it found them.
    setTiles([...tiles(), tile('c')]);
    const before = Object.entries((await accountDoc(server, key)).records).filter(([k]) => k.includes('vex.shortcuts'));
    expect((await engine.pushNow()).ok).toBe(true);
    const after = Object.entries((await accountDoc(server, key)).records).filter(([k]) => k.includes('vex.shortcuts'));
    expect(after).toEqual(before);
    expect(names(tiles())).toEqual(['a', 'b', 'c']);
    // The older device is removed: the next sync adds this device's tiles back.
    server.devices = server.devices.filter(d => d.deviceId !== 'devOld');
    expect((await engine.pushNow()).ok).toBe(true);
    expect(names((await accountValues(server, key))[TILES])).toEqual(['a', 'b', 'c']);
    expect(names(tiles())).toEqual(['a', 'b', 'c']);
    engine.signOut();
  });

  // r7 (2026-09-30): after an older Vex's push wiped the markers, a current
  // device that had only pulled since was named as the one tiles wait on,
  // until its own next push up to two minutes later.
  it('a current device puts back the marker an older Vex wiped as soon as its pull sees it gone', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    await engine.pushNow();
    const key = await accountKey();
    await newDevice(server, key, 'devB');
    await oldDevice(server, key, 'devOld');
    expect((await accountValues(server, key))['sync:device:dev1']).toBeUndefined();
    const pushes = server.revision;
    expect((await engine.pullNow()).ok).toBe(true);
    await vi.waitFor(async () => expect((await accountValues(server, key))['sync:device:dev1']).toEqual({ level: 1 }));
    expect(server.revision).toBe(pushes + 1);
    // What devB would see once devOld is gone: only devB itself has yet to sync.
    const doc = await accountDoc(server, key);
    expect(doc.records[JSON.stringify(['sync:device:dev1', 'value'])].deleted).toBe(false);
    expect(doc.records[JSON.stringify(['sync:device:devB', 'value'])].deleted).toBe(true);
    // A pull that finds the marker in place pushes nothing.
    expect((await engine.pullNow()).ok).toBe(true);
    await new Promise(r => setTimeout(r, 20));
    expect(server.revision).toBe(pushes + 1);
    engine.signOut();
  });

  it('what a current device uploads is still readable by an older Vex', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    setTiles([tile('a'), { name: 'Local file', url: 'file:///C:/x.html' }]);
    await engine.verifyCode('a@b.test', '123456');
    await engine.pushNow();
    const key = await accountKey();
    const doc = await accountDoc(server, key);
    // What 2.34.2's applySyncData runs on everything it pulls.
    expect(() => Contracts.sources(Records.unflatten(Records.values(Records.valid(doc))))).not.toThrow();
    engine.signOut();
  });
});
