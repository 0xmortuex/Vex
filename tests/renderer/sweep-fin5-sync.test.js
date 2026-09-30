// @vitest-environment jsdom
//
// Vex Sync faults found live against the real worker (2026-09-29):
//   S1 joining with a recovery code wiped what the device already had;
//   S2 Sync Now pushed before pulling and 409'd when another device synced first;
//   S3 failed enrolments left ghost devices on the server;
//   S4 a wrong recovery code read "Could not restore sync data: OperationError";
//   S5 "N sync conflicts retained" toasted on every sync forever, and the
//      conflict winner was whichever sorted last as JSON, not the newer edit;
//   S6 a Sync Worker URL with a trailing slash produced "//auth/..." 404s;
//   S7 raw "Failed to fetch", silent sign-out on 401, one bad handed-off tab
//      losing all of them.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const Records = require('../../src/renderer/js/sync-records.js');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code, body = {}) => ({ ok: false, status: code, json: async () => body });

// A small in-memory stand-in for the worker's routes that matter here.
function fakeWorker() {
  const server = { blob: null, revision: 0, devices: [], calls: [], nextDevice: 1, pushStatus: null, pullStatus: null, drops: [] };
  window.VexNet = {
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const path = url.replace('https://sync.test', '');
      server.calls.push({ method, path });
      if (path === '/auth/verify-code') {
        const deviceId = 'dev' + (server.nextDevice++);
        server.devices.push({ deviceId });
        return ok({ sessionToken: 'tok-' + deviceId, deviceId, emailHash: 'hash', hasEncryptedData: !!server.blob });
      }
      if (path === '/sync/push') {
        if (server.pushStatus) { const s = server.pushStatus; server.pushStatus = null; return status(s); }
        const body = JSON.parse(opts.body);
        if (body.baseRevision !== server.revision) return status(409, { error: 'Sync conflict', revision: server.revision });
        server.blob = body.encryptedBlob; server.revision += 1;
        return ok({ revision: server.revision });
      }
      if (path === '/sync/pull') {
        if (server.pullStatus) return status(server.pullStatus);
        return ok(server.blob ? { encryptedBlob: server.blob, revision: server.revision } : { blob: null });
      }
      if (path === '/sync/devices' && method === 'GET') {
        return server.devicesStatus ? status(server.devicesStatus) : ok({ devices: server.devices });
      }
      const del = path.match(/^\/sync\/devices\/(\w+)$/);
      if (del && method === 'DELETE') { server.devices = server.devices.filter(d => d.deviceId !== del[1]); return ok({ ok: true }); }
      if (path === '/sync/drop' && method === 'GET') { const items = server.drops; server.drops = []; return ok({ items }); }
      return status(404);
    },
  };
  return server;
}

let toasts, stores, savedKeyHex;
function freshEngine() {
  vi.resetModules();
  stores = new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = {
    // Keep the key the engine saves so a test can encrypt as another device.
    syncSaveKey: async (hex) => { savedKeyHex = hex; }, syncSaveMeta: async () => {}, syncClearState: async () => {},
    syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32',
  };
  window.VexTabPolicy = { snapshot: (v) => v };
  window.VexSyncRecords = Records;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}

async function newKey() {
  const key = await window.SyncCrypto.generateKey();
  const hex = window.SyncCrypto.keyToHex(await window.SyncCrypto.exportKey(key));
  return { key, hex, code: window.SyncCrypto.formatRecoveryCode(hex) };
}
async function cloudDoc(server, key) {
  return window.SyncCrypto.decrypt(server.blob, key);
}
const bookmarkIds = () => JSON.parse(localStorage.getItem('vex.bookmarks') || '[]').map(b => b.id);

beforeEach(() => {
  localStorage.clear();
  toasts = [];
  window.showToast = (message, type) => toasts.push({ message, type });
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('S1: joining sync keeps what this device already had', () => {
  async function seedCloud(server, notes = [{ id: 'note-a0' }]) {
    freshEngine();
    const { key, code } = await newKey();
    // Device A's document: bookmark bm-a0, a note, and a tombstone for bm-gone.
    let doc = Records.capture(Records.empty(), Records.flatten({
      'preference:vex.bookmarks': [{ id: 'bm-a0', url: 'https://a.test/', title: 'A' }, { id: 'bm-gone', url: 'https://gone.test/', title: 'Gone' }],
      'preference:vex.notes': notes,
    }), 'devA');
    doc = Records.capture(doc, Records.flatten({
      'preference:vex.bookmarks': [{ id: 'bm-a0', url: 'https://a.test/', title: 'A' }],
      'preference:vex.notes': notes,
    }), 'devA');
    server.blob = await window.SyncCrypto.encrypt(doc, key);
    server.revision = 2;
    return { key, code };
  }

  it('merges the cloud into local data instead of replacing it, and uploads the local-only records', async () => {
    const server = fakeWorker();
    const { key, code } = await seedCloud(server);
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([
      { id: 'bm-b0', url: 'https://b.test/', title: 'B' },
      { id: 'bm-gone', url: 'https://gone.test/', title: 'Gone' },
    ]));
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'note-b0' }]));
    localStorage.setItem('vex.agentMode', 'dark');

    const res = await engine.enrollWithRecoveryCode('a@b.test', '123456', code);
    expect(res).toEqual({ ok: true });
    // Cloud records win and apply (bm-a0, notes); the cloud's tombstone still
    // removes bm-gone; bm-b0 and the theme only this device had are kept.
    expect(bookmarkIds().sort()).toEqual(['bm-a0', 'bm-b0']);
    expect(JSON.parse(localStorage.getItem('vex.notes')).map(n => n.id).sort()).toEqual(['note-a0', 'note-b0']);
    expect(localStorage.getItem('vex.agentMode')).toBe('dark');
    // ...and they reached the account, so device A gets them on its next pull.
    expect(server.revision).toBe(3);
    const values = Records.unflatten(Records.values(await cloudDoc(server, key)));
    expect(values['preference:vex.bookmarks'].map(b => b.id).sort()).toEqual(['bm-a0', 'bm-b0']);
    expect(values['preference:vex.agentMode']).toBe('dark');
    expect(values['preference:vex.notes'].map(n => n.id).sort()).toEqual(['note-a0', 'note-b0']);
    engine.signOut();
  });

  it('takes the cloud notes whole when an older Vex pushed them as one value', async () => {
    const server = fakeWorker();
    const { key, code } = await seedCloud(server, '[{"id":"note-a0"}]');
    const engine = freshEngine();
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'note-b0' }]));
    expect((await engine.enrollWithRecoveryCode('a@b.test', '123456', code)).ok).toBe(true);
    // Mixing the two shapes would let the item rows overwrite the value; the
    // cloud copy wins instead and nothing on the account is lost.
    expect(JSON.parse(localStorage.getItem('vex.notes')).map(n => n.id)).toEqual(['note-a0']);
    const values = Records.unflatten(Records.values(await cloudDoc(server, key)));
    expect(values['preference:vex.notes'].map(n => n.id)).toEqual(['note-a0']);
    engine.signOut();
  });

  it('reports a failed upload after a successful join instead of hiding it', async () => {
    const server = fakeWorker();
    const { code } = await seedCloud(server);
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ id: 'bm-b0', url: 'https://b.test/', title: 'B' }]));
    server.pushStatus = 500;
    const res = await engine.enrollWithRecoveryCode('a@b.test', '123456', code);
    expect(res.ok).toBe(true);
    expect(res.pushError).toMatch(/500/);
    expect(bookmarkIds().sort()).toEqual(['bm-a0', 'bm-b0']);
    engine.signOut();
  });
});

describe('S2: a push that 409s pulls, merges and retries once', () => {
  it('pushNow recovers from another device having synced first', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    localStorage.setItem('vex.agentMode', 'dark');
    await engine.verifyCode('a@b.test', '123456');
    expect(server.revision).toBe(1);
    // Another device pushed twice: the server is now ahead of this device.
    server.revision = 3;
    localStorage.setItem('vex.agentMode', 'light');
    const res = await engine.pushNow();
    expect(res.ok).toBe(true);
    expect(server.revision).toBe(4);
    // Each push and pull also reads the device list, to decide whether
    // shortcut tiles may sync (sync-engine.js checkTileGate).
    const paths = server.calls.map(c => c.path).filter(p => p !== '/sync/devices').slice(-3);
    expect(paths).toEqual(['/sync/push', '/sync/pull', '/sync/push']);
    engine.signOut();
  });

  it('Sync Now pulls before it pushes', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/sync-settings.js'), 'utf8');
    const handler = src.slice(src.indexOf("getElementById('btn-sync-now')?.addEventListener"));
    expect(handler.indexOf('SyncEngine.pullNow()')).toBeGreaterThan(-1);
    expect(handler.indexOf('SyncEngine.pullNow()')).toBeLessThan(handler.indexOf('SyncEngine.pushNow()'));
  });
});

describe('S3: failed enrolments do not leave ghost devices', () => {
  it('verifyCode on an account that already has data removes the device it registered', async () => {
    const server = fakeWorker();
    server.blob = 'something';
    const engine = freshEngine();
    await expect(engine.verifyCode('a@b.test', '123456')).rejects.toThrow(/recovery code/);
    expect(server.devices).toEqual([]);
    expect(server.calls.some(c => c.method === 'DELETE' && c.path === '/sync/devices/dev1')).toBe(true);
  });

  it('a join whose restore fails signs out on the server too', async () => {
    const server = fakeWorker();
    server.pullStatus = 500;
    const engine = freshEngine();
    const { code } = await newKey();
    await expect(engine.enrollWithRecoveryCode('a@b.test', '123456', code)).rejects.toThrow(/Could not restore sync data: Pull returned 500/);
    expect(server.devices).toEqual([]);
    expect(engine.isEnabled()).toBe(false);
  });
});

describe('S4: a wrong recovery code is said in words', () => {
  it('maps the AES-GCM OperationError to a plain message and leaves no ghost device', async () => {
    const server = fakeWorker();
    freshEngine();
    const right = await newKey();
    server.blob = await window.SyncCrypto.encrypt(Records.empty(), right.key);
    server.revision = 1;
    const engine = freshEngine();
    const wrong = await newKey();
    await expect(engine.enrollWithRecoveryCode('a@b.test', '123456', wrong.code))
      .rejects.toThrow('This recovery code doesn’t unlock this account’s data — check it and try again.');
    expect(server.devices).toEqual([]);
    expect(engine.isEnabled()).toBe(false);
  });
});

describe('S5: conflicts toast once, and the newer edit wins', () => {
  it('a new local edit settles the conflicts a record carried', () => {
    const base = Records.capture(Records.empty(), { a: 'x' }, 'A');
    const merged = Records.merge(Records.capture(base, { a: 'left' }, 'A'), Records.capture(base, { a: 'right' }, 'B'));
    expect(merged.records.a.conflicts).toHaveLength(2);
    const edited = Records.capture(merged, { a: 'settled' }, 'A');
    expect(edited.records.a.conflicts).toEqual([]);
    // Unchanged values keep what they carry.
    expect(Records.capture(merged, { a: merged.records.a.value }, 'A').records.a.conflicts).toHaveLength(2);
  });

  it('prefers the newer of two concurrent edits, whatever their text sorts as', () => {
    vi.useFakeTimers();
    const base = Records.capture(Records.empty(), { a: 'x' }, 'A');
    vi.setSystemTime(1000);
    const newerZ = Records.capture(base, { a: 'zzz older' }, 'A');
    vi.setSystemTime(2000);
    const newerA = Records.capture(base, { a: 'aaa newer' }, 'B');
    expect(Records.values(Records.merge(newerZ, newerA)).a).toBe('aaa newer');
    expect(Records.values(Records.merge(newerA, newerZ)).a).toBe('aaa newer');
    expect(Records.merge(newerZ, newerA)).toEqual(Records.merge(newerA, newerZ));
  });

  it('a deletion still wins a concurrent edit', () => {
    vi.useFakeTimers();
    const base = Records.capture(Records.empty(), { a: 'x' }, 'A');
    vi.setSystemTime(1000);
    const del = Records.capture(base, {}, 'A');
    vi.setSystemTime(2000);
    const edit = Records.capture(base, { a: 'later edit' }, 'B');
    expect(Records.values(Records.merge(del, edit))).toEqual({});
  });

  it('toasts only conflicts the pull just created, with the right grammar', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    localStorage.setItem('vex.agentMode', 'dark');
    await engine.verifyCode('a@b.test', '123456');
    // Build a concurrent edit of vex.agentMode from another device and put it in the cloud.
    const local = stores.get('sync-records');
    const themeKey = JSON.stringify(['preference:vex.agentMode', 'value']);
    const remote = structuredClone(local);
    remote.records[themeKey] = { ...remote.records[themeKey], value: 'light', clock: { ...remote.records[themeKey].clock, devX: 1 }, at: Date.now() + 1 };
    localStorage.setItem('vex.agentMode', 'blue'); // this device edits concurrently
    const realKey = await window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
    server.blob = await window.SyncCrypto.encrypt(remote, realKey);
    server.revision += 1;
    toasts = [];
    expect((await engine.pullNow()).ok).toBe(true);
    expect(toasts.map(t => t.message)).toEqual(['1 sync conflict retained in recovery data']);
    // The same cloud document again: nothing new, so no toast.
    toasts = [];
    expect((await engine.pullNow()).ok).toBe(true);
    expect(toasts).toEqual([]);
    engine.signOut();
  });
});

describe('S6: a trailing slash on the Sync Worker URL is ignored', () => {
  it('the getter and the setter strip it', () => {
    vi.resetModules();
    const { VexConfig } = require('../../src/renderer/js/vex-config.js');
    localStorage.setItem('vex.syncWorkerUrl', '  https://sync.example.workers.dev//  ');
    expect(VexConfig.syncWorkerUrl()).toBe('https://sync.example.workers.dev');
    VexConfig.setSyncWorkerUrl('https://other.test/ ');
    expect(localStorage.getItem('vex.syncWorkerUrl')).toBe('https://other.test');
  });
});

describe('S7: sync failures are said in words', () => {
  it('a 401 on push signs out with a toast that says why', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    server.pushStatus = 401;
    toasts = [];
    localStorage.setItem('vex.agentMode', 'x');
    const res = await engine.pushNow();
    expect(res).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(engine.isEnabled()).toBe(false);
    expect(toasts.some(t => /signed out of Vex Sync/.test(t.message) && t.type === 'error')).toBe(true);
  });

  it('a 401 on pull and on the device list does the same', async () => {
    for (const which of ['pull', 'devices']) {
      const server = fakeWorker();
      const engine = freshEngine();
      await engine.verifyCode('a@b.test', '123456');
      toasts = [];
      if (which === 'pull') { server.pullStatus = 401; await engine.pullNow(); }
      else { server.devicesStatus = 401; await expect(engine.listDevices()).rejects.toThrow(/no longer enrolled/); }
      expect(engine.isEnabled()).toBe(false);
      expect(toasts.some(t => /signed out of Vex Sync/.test(t.message))).toBe(true);
    }
  });

  it('one unreadable handed-off tab does not lose the others', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    const key = await window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
    const good = await window.SyncCrypto.encrypt({ url: 'https://good.test/', title: 'Good' }, key);
    const other = await newKey();
    const bad = await window.SyncCrypto.encrypt({ url: 'https://bad.test/', title: 'Bad' }, other.key);
    server.drops = [{ id: 1, encryptedBlob: bad }, { id: 2, encryptedBlob: good }];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const items = await engine.dropFetch();
    expect(items.map(i => i.url)).toEqual(['https://good.test/']);
    expect(spy).toHaveBeenCalled();
    engine.signOut();
  });

  it('Send to My Devices words an unreachable server like the rest of sync', () => {
    vi.resetModules();
    global.SyncEngine = { getState: () => ({ enabled: false }) };
    require('../../src/renderer/js/sync-settings.js');
    expect(window.SyncSettings.human('Failed to fetch')).toMatch(/Could not reach the sync server/);
    delete global.SyncEngine;
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/command.js'), 'utf8');
    expect(src).toMatch(/SyncSettings\.human\(err\.message \|\| 'Send failed'\)/);
  });
});
