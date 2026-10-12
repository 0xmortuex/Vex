// @vitest-environment jsdom
//
// A change to something synced waited for the next two-minute round, and a
// change made just before closing Vex waited for the next start (found
// 2026-10-10). It now goes up about 5 seconds after it is made, and once more
// as the window closes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');

let stores, keyHex;
function freshEngine() {
  vi.resetModules();
  stores = new Map();
  global.PersistentStorage = { onChange: null, _flush: async () => {} };
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = { syncSaveKey: async (hex) => { keyHex = hex; }, syncSaveMeta: async () => {}, syncClearState: async () => {}, syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32' };
  window.VexTabPolicy = { snapshot: (v) => v };
  window.VexSyncRecords = Records;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}
const key = () => window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(keyHex));
const bookmarks = list => localStorage.setItem('vex.bookmarks', JSON.stringify(list.map(id => ({ id, url: 'https://' + id + '.test/', title: id, folder: '' }))));
async function accountBookmarks(system, token) {
  const r = await system.call('GET', '/sync/pull', undefined, token);
  const values = Records.unflatten(Records.values(await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key())));
  return (values['preference:vex.bookmarks'] || []).map(b => b.id);
}
// What the storage shim does on every write (js/storage.js).
const write = (key, value) => { localStorage.setItem(key, value); PersistentStorage.onChange?.(key); };

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });
afterEach(() => { vi.useRealTimers(); });

describe('a synced change goes up about 5 seconds after it is made', () => {
  it('one upload for several quick changes, none for a setting that does not sync', async () => {
    const { system, calls } = workerStandIn();
    const engine = freshEngine();
    bookmarks(['a']);
    await engine.verifyCode('soon@sync.test', (await engine.requestCode('soon@sync.test')).devCode);
    const token = engine.getState().sessionToken;
    const pushes = () => calls.filter(c => c.path === '/sync/push').length;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = pushes();
    write('vex.lockIdleMin', '5');
    await vi.advanceTimersByTimeAsync(6000);
    expect(pushes()).toBe(before);

    bookmarks(['a', 'b']); PersistentStorage.onChange('vex.bookmarks');
    await vi.advanceTimersByTimeAsync(2000);
    bookmarks(['a', 'b', 'c']); PersistentStorage.onChange('vex.bookmarks');
    await vi.advanceTimersByTimeAsync(4900);
    expect(pushes()).toBe(before);
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(pushes()).toBe(before + 1));
    vi.useRealTimers();
    await vi.waitFor(async () => expect(await accountBookmarks(system, token)).toEqual(['a', 'b', 'c']));
  });

  it('what a pull writes is not sent back', async () => {
    const { system, calls } = workerStandIn();
    const engine = freshEngine();
    bookmarks(['a']);
    await engine.verifyCode('back@sync.test', (await engine.requestCode('back@sync.test')).devCode);
    // Another device adds a bookmark.
    const other = await system.signIn('back@sync.test', 'B');
    const pulled = await system.call('GET', '/sync/pull', undefined, other.sessionToken);
    const doc = await window.SyncCrypto.decrypt(pulled.body.encryptedBlob, await key());
    const values = Records.unflatten(Records.values(doc));
    values['preference:vex.bookmarks'] = [...values['preference:vex.bookmarks'], { id: 'z', url: 'https://z.test/', title: 'z', folder: '' }];
    await system.push(other.sessionToken, pulled.body.revision, await window.SyncCrypto.encrypt(Records.capture(doc, Records.flatten(values), other.deviceId), await key()));
    // The pull's writes go through the storage shim.
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { real.call(this, k, v); if (this === localStorage) PersistentStorage.onChange?.(k); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect((await engine.pullNow()).ok).toBe(true);
    spy.mockRestore();
    const after = calls.filter(c => c.path === '/sync/push').length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls.filter(c => c.path === '/sync/push').length).toBe(after);
  });
});

describe('closing the window', () => {
  it('uploads what changed a moment ago', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    bookmarks(['a']);
    await engine.verifyCode('close@sync.test', (await engine.requestCode('close@sync.test')).devCode);
    write('vex.bookmarks', JSON.stringify([{ id: 'a', url: 'https://a.test/', title: 'a', folder: '' }, { id: 'late', url: 'https://late.test/', title: 'late', folder: '' }]));
    expect((await engine.pushBeforeClose()).ok).toBe(true);
    expect(await accountBookmarks(system, engine.getState().sessionToken)).toEqual(['a', 'late']);
  });

  it('does not keep the window open more than a few seconds when the server does not answer', async () => {
    workerStandIn();
    const engine = freshEngine();
    await engine.verifyCode('slow@sync.test', (await engine.requestCode('slow@sync.test')).devCode);
    const fetch = window.VexNet.fetch;
    window.VexNet.fetch = (url, opts) => (new URL(url).pathname === '/sync/push' ? new Promise(() => {}) : fetch(url, opts));
    bookmarks(['b']);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const closing = engine.pushBeforeClose();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await closing).toEqual({ ok: false, reason: 'still uploading when the window closed' });
  });

  it('the storage flush before closing asks for it, after everything is saved', async () => {
    let flush = null;
    window.vex = { onFlushRequested: (cb) => { flush = cb; }, persistApply: vi.fn(async () => true), flushStorage: vi.fn(async () => true) };
    vi.resetModules();
    const { PersistentStorage: shim } = await import('../../src/renderer/js/storage.js?' + Math.random());
    const seen = [];
    shim.onChange = key => seen.push(key);
    localStorage.setItem('vex.zooms', '{"a":2}');
    expect(seen).toContain('vex.zooms');
    const order = [];
    window.vex.flushStorage.mockImplementation(async () => { order.push('saved'); return true; });
    window.SyncEngine = global.SyncEngine = { pushBeforeClose: vi.fn(async () => { order.push('pushed'); return { ok: true }; }) };
    await flush();
    expect(order).toEqual(['saved', 'pushed']);
  });
});
