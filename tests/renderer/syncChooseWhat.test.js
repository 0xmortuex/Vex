// @vitest-environment jsdom
//
// Vex Sync synced everything or nothing: there was no way to keep, say,
// history or AI memory on one computer (found 2026-10-10). Settings › Vex
// Sync › Choose what to sync now leaves a kind of data out on this device:
// neither sent nor applied, the account's copy carried as it came, and
// turning it back on joins it without deleting what other devices added.
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
const bm = id => ({ id, url: 'https://' + id + '.test/', title: id, folder: '' });
const local = k => JSON.parse(localStorage.getItem(k) || 'null');

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
    return Records.unflatten(Records.values(Records.capture(doc, Records.flatten(values), session.deviceId)));
  };
}
async function account(system, token) {
  const r = await system.call('GET', '/sync/pull', undefined, token);
  return Records.unflatten(Records.values(await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key())));
}

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });

describe('choose what to sync', () => {
  it('a kind turned off is neither sent nor applied, and the account keeps it as it was', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bm('a')]));
    localStorage.setItem('vex.aiMemory', 'remember A');
    await engine.verifyCode('off@sync.test', (await engine.requestCode('off@sync.test')).devCode);
    const token = engine.getState().sessionToken;
    expect(await engine.setTypeSynced('bookmarks', false)).toEqual({ ok: true });
    expect(engine.syncTypes().find(t => t.id === 'bookmarks').on).toBe(false);
    // A local change is not sent...
    localStorage.setItem('vex.bookmarks', JSON.stringify([bm('a'), bm('mine')]));
    localStorage.setItem('vex.aiMemory', 'remember A2');
    expect((await engine.pushNow()).ok).toBe(true);
    let cloud = await account(system, token);
    expect(cloud['preference:vex.bookmarks'].map(b => b.id)).toEqual(['a']);
    expect(cloud['preference:vex.aiMemory']).toBe('remember A2');
    // ...and another device's change is not applied.
    const b = await otherDevice(system, 'off@sync.test');
    await b(v => { v['preference:vex.bookmarks'] = [bm('a'), bm('theirs')]; });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(local('vex.bookmarks').map(x => x.id)).toEqual(['a', 'mine']);
    expect((await engine.pushNow()).ok).toBe(true);
    cloud = await account(system, token);
    expect(cloud['preference:vex.bookmarks'].map(x => x.id)).toEqual(['a', 'theirs']);
  });

  it('turning it back on joins both sides: nothing either side added is lost', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bm('a')]));
    await engine.verifyCode('on@sync.test', (await engine.requestCode('on@sync.test')).devCode);
    const token = engine.getState().sessionToken;
    await engine.setTypeSynced('bookmarks', false);
    const b = await otherDevice(system, 'on@sync.test');
    await b(v => { v['preference:vex.bookmarks'] = [bm('a'), bm('theirs')]; });
    // This device syncs meanwhile, carrying the other device's bookmark it
    // does not apply.
    expect((await engine.pullNow()).ok).toBe(true);
    localStorage.setItem('vex.bookmarks', JSON.stringify([bm('a'), bm('mine')]));
    expect((await engine.setTypeSynced('bookmarks', true)).ok).toBe(true);
    expect(local('vex.bookmarks').map(x => x.id).sort()).toEqual(['a', 'mine', 'theirs']);
    expect((await account(system, token))['preference:vex.bookmarks'].map(x => x.id).sort()).toEqual(['a', 'mine', 'theirs']);
    expect(localStorage.getItem('vex.syncRejoin')).toBeNull();
    // From then on it syncs as before: a deletion travels.
    localStorage.setItem('vex.bookmarks', JSON.stringify([bm('a'), bm('mine')]));
    expect((await engine.pushNow()).ok).toBe(true);
    expect((await account(system, token))['preference:vex.bookmarks'].map(x => x.id).sort()).toEqual(['a', 'mine']);
  });

  it('the Sync panel lists every kind with a switch', async () => {
    workerStandIn();
    const engine = freshEngine();
    await engine.verifyCode('panel@sync.test', (await engine.requestCode('panel@sync.test')).devCode);
    require('../../src/renderer/js/sync-settings.js');
    document.body.innerHTML = '<div id="sync-panel-content"></div>';
    const host = document.getElementById('sync-panel-content');
    await window.SyncSettings.renderSyncPanel(host);
    const boxes = [...host.querySelectorAll('[data-sync-type]')];
    expect(boxes.map(b => b.dataset.syncType)).toEqual(['bookmarks', 'history', 'tabs', 'notes', 'shortcuts', 'reminders', 'ai', 'look', 'passwords', 'authenticator', 'passkeys', 'liveTabs', 'readingQueue', 'settings']);
    // Passwords, authenticator codes, passkeys, Live tabs and the reading queue stay off until turned on (syncSecrets.test.js, liveSessionSync.test.js).
    expect(boxes.filter(b => !b.checked).map(b => b.dataset.syncType)).toEqual(['passwords', 'authenticator', 'passkeys', 'liveTabs', 'readingQueue']);
    const history = boxes.find(b => b.dataset.syncType === 'history');
    history.checked = false;
    history.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(engine.syncTypes().find(t => t.id === 'history').on).toBe(false));
  });
});
