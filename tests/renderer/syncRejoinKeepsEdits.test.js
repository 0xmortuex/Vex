// @vitest-environment jsdom
//
// Turning a kind of data back on in Settings › Vex Sync › Choose what to sync
// joined it with the account's records winning, so a bookmark this device
// renamed while the kind was off silently took the account's title again on
// every device (found 2026-10-11 in a two-device probe). The account's
// version stays in use, and this device's is kept in Sync conflicts to pick;
// a copy that only fell behind while off is not a change and makes no conflict.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
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
const bm = (id, title = id) => ({ id, url: 'https://' + id + '.test/', title, folder: '' });
const local = k => JSON.parse(localStorage.getItem(k) || 'null');
const titles = list => Object.fromEntries(list.map(b => [b.id, b.title]));

async function otherDevice(system, email) {
  const session = await system.signIn(email, 'B');
  return async (change) => {
    const r = await system.call('GET', '/sync/pull', undefined, session.sessionToken);
    const doc = await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key());
    const values = Records.unflatten(Records.values(doc));
    values['sync:device:' + session.deviceId] = { level: 2, revision: r.body.revision };
    change(values);
    const p = await system.provenPush(session, keyHex, r.body.revision, await window.SyncCrypto.encrypt(Records.capture(doc, Records.flatten(values), session.deviceId), await key()));
    if (p.status !== 200) throw new Error('push ' + p.status);
  };
}
async function account(system, token) {
  const r = await system.call('GET', '/sync/pull', undefined, token);
  return Records.unflatten(Records.values(await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key())));
}

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });

describe('turning a kind back on keeps what this device changed while it was off', () => {
  it('a rename made while off is kept in Sync conflicts; a copy that only fell behind takes the account\'s', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bm('stale'), bm('shared')]));
    await engine.verifyCode('rejoin@sync.test', (await engine.requestCode('rejoin@sync.test')).devCode);
    const token = engine.getState().sessionToken;
    await engine.setTypeSynced('bookmarks', false);
    // Another device renames both.
    const b = await otherDevice(system, 'rejoin@sync.test');
    await b(v => { v['preference:vex.bookmarks'] = [bm('stale', 'stale renamed by B'), bm('shared', 'shared renamed by B')]; });
    expect((await engine.pullNow()).ok).toBe(true);
    // This device renames one of them while bookmarks are off.
    localStorage.setItem('vex.bookmarks', JSON.stringify([bm('stale'), bm('shared', 'shared renamed here')]));
    window.showToast.mockClear();

    expect((await engine.setTypeSynced('bookmarks', true)).ok).toBe(true);

    // The account's versions are in use...
    expect(titles(local('vex.bookmarks'))).toEqual({ stale: 'stale renamed by B', shared: 'shared renamed by B' });
    // ...and this device's rename is not lost: it waits in Sync conflicts.
    const conflicts = engine.conflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].versions.map(v => [v.text, v.current])).toEqual([['shared renamed by B', true], ['shared renamed here', false]]);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Sync conflicts'));
    // Picking it puts it back here and in the account.
    expect((await engine.resolveConflict(conflicts[0].key, 1)).ok).toBe(true);
    expect(titles(local('vex.bookmarks')).shared).toBe('shared renamed here');
    expect(titles((await account(system, token))['preference:vex.bookmarks'])).toEqual({ stale: 'stale renamed by B', shared: 'shared renamed here' });
    expect(engine.conflicts()).toHaveLength(0);
  });

  it('another device takes the kept record as it is, so both show the same version in use', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bm('shared')]));
    await engine.verifyCode('same@sync.test', (await engine.requestCode('same@sync.test')).devCode);
    const token = engine.getState().sessionToken;
    await engine.setTypeSynced('bookmarks', false);
    const b = await otherDevice(system, 'same@sync.test');
    await b(v => { v['preference:vex.bookmarks'] = [bm('shared', 'by B')]; });
    expect((await engine.pullNow()).ok).toBe(true);
    localStorage.setItem('vex.bookmarks', JSON.stringify([bm('shared', 'here')]));
    expect((await engine.setTypeSynced('bookmarks', true)).ok).toBe(true);
    // The other device's view of the account: the account's version in use.
    expect(titles((await account(system, token))['preference:vex.bookmarks'])).toEqual({ shared: 'by B' });
    expect(titles(local('vex.bookmarks'))).toEqual({ shared: 'by B' });
  });
});
