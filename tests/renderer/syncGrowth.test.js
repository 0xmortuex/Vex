// @vitest-environment jsdom
//
// SY2 (found 2026-10-10): the sync document only ever grew. A deleted record
// stayed in it for ever, a 5,000-visit history alone was a 3.8 MB upload
// against the server's 4 MiB limit, sources no Vex reads any more were
// carried for ever, and the server's "Request too large" was shown as "Push
// returned 413". Run against the real worker with in-memory storage.
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

// Another device on the account, driven by hand through the real worker.
async function otherDevice(system, email, name) {
  const session = await system.signIn(email, name);
  const pull = async () => {
    const r = await system.call('GET', '/sync/pull', undefined, session.sessionToken);
    return { revision: r.body.revision, doc: await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key()) };
  };
  return {
    id: session.deviceId,
    pull,
    // Pull, change the values as that device would, push under its own clock.
    async sync({ level = 2, change } = {}) {
      const { revision, doc } = await pull();
      const values = Records.unflatten(Records.values(doc));
      values['sync:device:' + session.deviceId] = level >= 2 ? { level, revision } : { level };
      change?.(values, doc);
      const next = Records.capture(doc, Records.flatten(values), session.deviceId);
      const r = await system.provenPush(session, keyHex, revision, await window.SyncCrypto.encrypt(next, await key()));
      if (r.status !== 200) throw new Error('push ' + r.status);
      return next;
    },
  };
}
const accountDoc = async (system, token) => {
  const r = await system.call('GET', '/sync/pull', undefined, token);
  return window.SyncCrypto.decrypt(r.body.encryptedBlob, await key());
};
const bookmark = id => ({ id, url: 'https://' + id + '.test/', title: id, folder: '' });
const bmKey = id => JSON.stringify(['preference:vex.bookmarks', 'item', id]);

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });

describe('deleted records are cleared out of the account once every device has synced past them', () => {
  async function setUp(email) {
    const { system } = workerStandIn();
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('keep'), bookmark('gone')]));
    await engine.verifyCode(email, (await engine.requestCode(email)).devCode, 'Desk A');
    const token = engine.getState().sessionToken;
    return { system, engine, token };
  }

  it('with every device at level 2 the deleted bookmark leaves the account, and nobody brings it back', async () => {
    const { system, engine, token } = await setUp('compact@sync.test');
    const b = await otherDevice(system, 'compact@sync.test', 'Laptop B');
    await b.sync();
    // A deletes a bookmark: a deleted record goes up.
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('keep')]));
    expect((await engine.pullNow()).ok).toBe(true);
    expect((await engine.pushNow()).ok).toBe(true);
    expect((await accountDoc(system, token)).records[bmKey('gone')].deleted).toBe(true);
    // B syncs past it (its marker says the revision it synced).
    await b.sync();
    // A's next round clears it away.
    expect((await engine.pullNow()).ok).toBe(true);
    expect((await engine.pushNow()).ok).toBe(true);
    const doc = await accountDoc(system, token);
    expect(doc.records[bmKey('gone')]).toBeUndefined();
    expect(doc.records[bmKey('keep')].deleted).toBe(false);
    // A later round does not put it back.
    await b.sync();
    expect((await engine.pullNow()).ok).toBe(true);
    expect((await engine.pushNow()).ok).toBe(true);
    expect((await accountDoc(system, token)).records[bmKey('gone')]).toBeUndefined();
    expect(engine.cleanupState()).toEqual({ open: true, waitingOn: [] });
  });

  it('a device the account no longer holds a deleted record for drops its own copy instead of pushing it back', async () => {
    const { system, engine, token } = await setUp('drop@sync.test');
    const b = await otherDevice(system, 'drop@sync.test', 'Laptop B');
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('keep')]));
    expect((await engine.pullNow()).ok).toBe(true);
    expect((await engine.pushNow()).ok).toBe(true);
    // Another level-2 device clears the deleted record away.
    await b.sync({ change: (values, doc) => { delete doc.records[bmKey('gone')]; } });
    const cleared = await accountDoc(system, token);
    expect(cleared.records[bmKey('gone')]).toBeUndefined();
    // A pulls, adds a bookmark and pushes: the deleted record does not return.
    expect((await engine.pullNow()).ok).toBe(true);
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('keep'), bookmark('new')]));
    expect((await engine.pushNow()).ok).toBe(true);
    const doc = await accountDoc(system, token);
    expect(doc.records[bmKey('gone')]).toBeUndefined();
    expect(doc.records[bmKey('new')].deleted).toBe(false);
  });

  it('waits while a device at level 1 (an older Vex, or the phone) is on the account', async () => {
    const { system, engine, token } = await setUp('older@sync.test');
    const phone = await otherDevice(system, 'older@sync.test', 'Phone');
    await phone.sync({ level: 1 });
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('keep')]));
    expect((await engine.pullNow()).ok).toBe(true);
    expect((await engine.pushNow()).ok).toBe(true);
    await phone.sync({ level: 1 });
    expect((await engine.pullNow()).ok).toBe(true);
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('keep'), bookmark('more')]));
    expect((await engine.pushNow()).ok).toBe(true);
    expect((await accountDoc(system, token)).records[bmKey('gone')].deleted).toBe(true);
    expect(engine.cleanupState()).toEqual({ open: false, waitingOn: [phone.id] });
  });

  it('retired sources (the old 500-visit storage:history) leave the account only once every device is at level 2', async () => {
    const { system, engine, token } = await setUp('retired@sync.test');
    const old = await otherDevice(system, 'retired@sync.test', 'Old desk');
    const HIST = JSON.stringify(['storage:history', 'type']);
    await old.sync({ level: 1, change: v => { v['storage:history'] = [{ url: 'https://old.test/', title: 'Old', time: 5 }]; } });
    expect((await engine.pullNow()).ok).toBe(true);
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('keep')]));
    expect((await engine.pushNow()).ok).toBe(true);
    expect((await accountDoc(system, token)).records[HIST]).toBeDefined();
    // The old desktop is updated.
    await old.sync({ level: 2 });
    expect((await engine.pullNow()).ok).toBe(true);
    expect((await engine.pushNow()).ok).toBe(true);
    const doc = await accountDoc(system, token);
    expect(Object.keys(doc.records).filter(k => JSON.parse(k)[0] === 'storage:history')).toEqual([]);
  });
});

describe('only recent history syncs', () => {
  const visit = (n, daysAgo) => ({ id: 'h_' + n, url: 'https://v' + n + '.test/', title: 'V' + n, favicon: '', visitedAt: new Date(Date.now() - daysAgo * 86400000 - n * 1000).toISOString(), indexed: false });

  it('sends the newest 1,000 visits, none older than 90 days, and keeps the older ones on the device', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    // 1,200 visits from the last week, 300 from half a year ago.
    const history = [...Array.from({ length: 1200 }, (_, i) => visit(i, 1)), ...Array.from({ length: 300 }, (_, i) => visit(2000 + i, 180))];
    localStorage.setItem('vex.history', JSON.stringify(history));
    await engine.verifyCode('hist@sync.test', (await engine.requestCode('hist@sync.test')).devCode);
    const doc = await accountDoc(system, engine.getState().sessionToken);
    const synced = Records.unflatten(Records.values(doc))['preference:vex.history'];
    expect(synced).toHaveLength(1000);
    expect(synced.map(v => v.id)).toEqual(history.slice(0, 1000).map(v => v.id));
    // A pull leaves the visits that do not sync where they are.
    expect((await engine.pullNow()).ok).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.history'))).toHaveLength(1500);
  });

  it('a Clear History on another device clears this device\'s older visits too', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    localStorage.setItem('vex.history', JSON.stringify([visit(1, 1), visit(2, 200)]));
    await engine.verifyCode('clear@sync.test', (await engine.requestCode('clear@sync.test')).devCode);
    const b = await otherDevice(system, 'clear@sync.test', 'Laptop B');
    await b.sync({ change: v => { v['preference:vex.history'] = []; v['preference:vex.historyClearedAt'] = new Date().toISOString(); } });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.history'))).toEqual([]);
  });
});

describe('an upload the server finds too large', () => {
  it('says so in words instead of "Push returned 413"', async () => {
    workerStandIn();
    const engine = freshEngine();
    await engine.verifyCode('big@sync.test', (await engine.requestCode('big@sync.test')).devCode);
    // 3.5 MB of notes: 4.7 MB once encrypted and written as text.
    localStorage.setItem('vex.notes', JSON.stringify(Array.from({ length: 35 }, (_, i) => ({ id: 'n' + i, content: String(i).padEnd(100000, 'x') }))));
    const r = await engine.pushNow();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too big for the sync server \(over 4 MB\)/);
  });
});
