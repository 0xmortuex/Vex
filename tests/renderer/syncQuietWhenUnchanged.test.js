// @vitest-environment jsdom
//
// Vex Sync uploaded the whole account (about 924 KB for the owner) every two
// minutes even when nothing had changed, about 28 MB an hour; every pull
// rewrote every store; and because the push and pull timers start together
// and a pull asked during a push returned "not ready", every other pull was
// dropped (found 2026-10-09). Now a push that would send what the server
// already has is not sent, a pull of the revision this device already has is
// not applied again, and pushes and pulls wait their turn instead of failing.
// Runs against an in-memory stand-in for the worker, never the real one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code, body = {}) => ({ ok: false, status: code, json: async () => body });

function fakeWorker() {
  const server = { blob: null, revision: 0, devices: [], nextDevice: 1, pushes: 0, pulls: 0, uploaded: 0, hold: null, log: [] };
  window.VexNet = {
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const path = url.replace('https://sync.test', '');
      server.log.push(path);
      if (path === '/auth/verify-code') {
        const deviceId = 'dev' + (server.nextDevice++);
        server.devices.push({ deviceId });
        return ok({ sessionToken: 'tok-' + deviceId, deviceId, emailHash: 'hash', hasEncryptedData: !!server.blob });
      }
      if (path === '/sync/push') {
        if (server.hold) await server.hold;
        server.pushes++; server.uploaded += opts.body.length;
        const body = JSON.parse(opts.body);
        if (body.baseRevision !== server.revision) return status(409, { error: 'Sync conflict', revision: server.revision });
        server.blob = body.encryptedBlob; server.revision += 1;
        return ok({ revision: server.revision });
      }
      if (path === '/sync/pull') {
        server.pulls++;
        return ok(server.blob ? { encryptedBlob: server.blob, revision: server.revision } : { blob: null });
      }
      if (path === '/sync/devices' && method === 'GET') return ok({ devices: server.devices });
      if (method === 'DELETE') return ok({ ok: true });
      return status(404);
    },
  };
  return server;
}

let stores, saves, savedKeyHex;
function freshEngine() {
  vi.resetModules();
  stores = new Map(); saves = [];
  global.VexStorage = {
    load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null),
    save: async (k, v) => { saves.push(k); stores.set(k, structuredClone(v)); return true; },
  };
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

const bookmarks = (list) => localStorage.setItem('vex.bookmarks', JSON.stringify(list));

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a push with nothing new', () => {
  it('is not sent; a change is', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    bookmarks(Array.from({ length: 300 }, (_, i) => ({ id: 'bm' + i, url: 'https://site' + i + '.example/', title: 'Site ' + i })));
    await engine.verifyCode('a@b.test', '123456');
    expect(server.pushes).toBe(1);
    const first = server.uploaded;
    // An hour of the two-minute timer with nothing changed.
    for (let i = 0; i < 30; i++) expect(await engine.pushNow()).toEqual({ ok: true, unchanged: true });
    console.log('[sync] 30 idle push rounds uploaded ' + (server.uploaded - first) + ' B (each would have been ' + first + ' B, ' + (first * 30) + ' B in all)');
    expect(server.pushes).toBe(1);
    // A real change goes up at once.
    bookmarks([{ id: 'new', url: 'https://new.example/', title: 'New' }]);
    expect((await engine.pushNow()).ok).toBe(true);
    expect(server.pushes).toBe(2);
    expect(server.revision).toBe(2);
    engine.signOut();
  });
});

describe('a pull of the revision this device already has', () => {
  it('is not applied again; one from another device is', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    bookmarks([{ id: 'a', url: 'https://a.example/', title: 'A' }]);
    await engine.verifyCode('a@b.test', '123456');
    const applied = vi.fn();
    window.addEventListener('vex-sync-data-applied', applied);
    saves = [];
    expect(await engine.pullNow()).toEqual({ ok: true, unchanged: true });
    expect(applied).not.toHaveBeenCalled();
    expect(saves).toEqual([]);
    // Another device pushes: this one takes its change.
    const key = await window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
    const doc = await window.SyncCrypto.decrypt(server.blob, key);
    const values = Records.unflatten(Records.values(doc));
    values['preference:vex.bookmarks'] = [...values['preference:vex.bookmarks'], { id: 'b', url: 'https://b.example/', title: 'B' }];
    server.blob = await window.SyncCrypto.encrypt(Records.capture(doc, Records.flatten(values), 'devB'), key);
    server.revision += 1;
    expect((await engine.pullNow()).ok).toBe(true);
    expect(applied).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('vex.bookmarks')).map(b => b.id)).toEqual(['a', 'b']);
    window.removeEventListener('vex-sync-data-applied', applied);
    engine.signOut();
  });
});

describe('a pull asked while a push runs', () => {
  it('waits for it instead of being dropped as "not ready"', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    bookmarks([{ id: 'a', url: 'https://a.example/', title: 'A' }]);
    let release;
    server.hold = new Promise(r => { release = r; });
    // What the two timers do when they fire together.
    const push = engine.pushNow();
    const pull = engine.pullNow();
    // A second pull asked meanwhile joins the waiting one.
    expect(engine.pullNow()).toBe(pull);
    await new Promise(r => setTimeout(r, 20));
    expect(server.log.filter(p => p === '/sync/pull')).toHaveLength(0);
    server.hold = null; release();
    expect((await push).ok).toBe(true);
    expect(await pull).toMatchObject({ ok: true });
    expect(server.pulls).toBe(1);
    expect(server.log.slice(-2)).toEqual(['/sync/push', '/sync/pull']);
    engine.signOut();
  });
});
