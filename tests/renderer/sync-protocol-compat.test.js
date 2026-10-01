// @vitest-environment jsdom
//
// The desktop follows docs/SYNC_PROTOCOL.md the way the mobile client must
// (v2.35.2):
// - §6 rule 1: records of a source it does not own (one the phone or a newer
//   Vex added, an unknown record kind) are carried byte-identical on every
//   push. Vex 2.35.1 and older marked them all deleted.
// - §6 rule 3: after a pull finds the account empty, the next push starts from
//   an empty document, not the stored copy of the lost one.
// - §5.4: joining keeps the account's bookmark when this device has the same
//   address under another id, instead of making a second one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');
const Contracts = require('../../src/renderer/js/data-contracts.js');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code, body = {}) => ({ ok: false, status: code, json: async () => body });

// Like the worker: a device joins the list on its first push or pull.
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

const accountKey = () => window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
const accountDoc = async (server, key) => window.SyncCrypto.decrypt(server.blob, key);
const accountValues = async (server, key) => Records.unflatten(Records.values(await accountDoc(server, key)));
const bookmark = (id, url) => ({ id, url, title: id, folder: '', at: 1767225600000 });
const bookmarks = () => JSON.parse(localStorage.getItem('vex.bookmarks') || '[]');
const sourceOf = (key) => JSON.parse(key)[0];

// The phone, built to §9.5: capture over the sources it owns, every other
// record copied verbatim from the document it pulled. `extra` adds records
// as they are (a record kind the desktop does not know).
async function phonePushes(server, key, device, owned, extra = {}) {
  const doc = await accountDoc(server, key);
  const mine = new Set(Object.keys(owned));
  const values = Object.fromEntries(Object.entries(Records.values(doc)).filter(([k]) => !mine.has(sourceOf(k))));
  const next = Records.capture(doc, { ...values, ...Records.flatten(owned) }, device);
  for (const k of Object.keys(next.records)) if (!mine.has(sourceOf(k))) next.records[k] = doc.records[k];
  Object.assign(next.records, extra);
  server.blob = await window.SyncCrypto.encrypt(Records.valid(next), key);
  server.revision += 1;
  if (!server.devices.some(d => d.deviceId === device)) server.devices.push({ deviceId: device });
}

// Every record of the given sources, in document order, as JSON text.
const recordsOf = (doc, test) => Object.entries(doc.records).filter(([k]) => test(sourceOf(k), k)).map(([k, r]) => [k, JSON.stringify(r)]);

const PHONE = 'devPhone';
const READING = 'preference:vex.readingList';   // a list only the phone knows
const FUTURE = 'storage:futureThing';            // a store key a newer Vex added
const unknownSource = (source) => source === READING || source === FUTURE;
const META_KEY = JSON.stringify(['preference:vex.bookmarks', 'meta', 'sortOrder']);   // an unknown record kind
const META = { clock: { [PHONE]: 3 }, deleted: false, value: { by: 'folder' }, at: 1767225600000, conflicts: [] };

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
});
afterEach(() => { vi.restoreAllMocks(); });

describe('sources the desktop does not own (§6 rule 1)', () => {
  it('survive every desktop push byte-identical, in the order they were pulled', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('bm1', 'https://a.test/')]));
    await engine.verifyCode('a@b.test', '123456');
    const key = await accountKey();
    await phonePushes(server, key, PHONE, {
      [READING]: [{ id: 'r1', url: 'https://read.test/1' }, { id: 'r2', url: 'https://read.test/2', note: 'x' }],
      [FUTURE]: { mode: 'compact', n: 2 },
      ['sync:device:' + PHONE]: { level: 1 },
    }, { [META_KEY]: META });
    // The phone deletes r2: its tombstone must travel unchanged too.
    await phonePushes(server, key, PHONE, { [READING]: [{ id: 'r1', url: 'https://read.test/1' }], ['sync:device:' + PHONE]: { level: 1 } });
    const pushed = await accountDoc(server, key);
    const theirs = recordsOf(pushed, (source, k) => unknownSource(source) || k === META_KEY);
    expect(theirs.length).toBe(6);
    expect(theirs.some(([, r]) => JSON.parse(r).deleted)).toBe(true);

    // The desktop edits what it owns, then pushes (409 → pull, merge → push) twice.
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('bm1', 'https://a.test/'), bookmark('bm2', 'https://b.test/')]));
    expect((await engine.pushNow()).ok).toBe(true);
    expect((await engine.pushNow()).ok).toBe(true);
    const after = await accountDoc(server, key);
    expect(recordsOf(after, (source, k) => unknownSource(source) || k === META_KEY)).toEqual(theirs);
    // The phone's marker too, and what the desktop owns still syncs.
    const phoneMarker = recordsOf(pushed, source => source === 'sync:device:' + PHONE);
    expect(recordsOf(after, source => source === 'sync:device:' + PHONE)).toEqual(phoneMarker);
    expect((await accountValues(server, key))['preference:vex.bookmarks'].map(b => b.id)).toEqual(['bm1', 'bm2']);
    // Nothing of them was applied here.
    expect(localStorage.getItem('vex.readingList')).toBeNull();
    expect(stores.has('futureThing')).toBe(false);
    engine.signOut();
  });

  it('deleting something the desktop owns still deletes it', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('bm1', 'https://a.test/'), bookmark('bm2', 'https://b.test/')]));
    localStorage.setItem('vex.agentMode', 'auto');
    await engine.verifyCode('a@b.test', '123456');
    const key = await accountKey();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('bm2', 'https://b.test/')]));
    localStorage.removeItem('vex.agentMode');
    expect((await engine.pushNow()).ok).toBe(true);
    const doc = await accountDoc(server, key);
    expect(doc.records[JSON.stringify(['preference:vex.bookmarks', 'item', 'bm1'])].deleted).toBe(true);
    expect(doc.records[JSON.stringify(['preference:vex.agentMode', 'value'])].deleted).toBe(true);
    expect((await accountValues(server, key))['preference:vex.bookmarks'].map(b => b.id)).toEqual(['bm2']);
    engine.signOut();
  });

  it('one that fails the desktop\'s checks does not stop it syncing, and is carried as it is', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    const key = await accountKey();
    // preference:vex.groups is checked when present but never written by the
    // desktop (its groups travel as storage:groups); an item row with no index
    // is refused when read. Neither is the desktop's to read.
    const badItem = { clock: { [PHONE]: 1 }, deleted: false, value: { item: 'no index' }, at: 1, conflicts: [] };
    await phonePushes(server, key, PHONE, { 'preference:vex.groups': 'not json', ['sync:device:' + PHONE]: { level: 1 } },
      { [JSON.stringify([READING, 'item', 'odd'])]: badItem });
    const theirs = recordsOf(await accountDoc(server, key), source => source === 'preference:vex.groups' || source === READING);
    expect((await engine.pullNow()).ok).toBe(true);
    localStorage.setItem('vex.agentMode', 'auto');
    expect((await engine.pushNow()).ok).toBe(true);
    expect(recordsOf(await accountDoc(server, key), source => source === 'preference:vex.groups' || source === READING)).toEqual(theirs);
    expect((await accountValues(server, key).catch(() => null))).toBeNull();   // still unreadable as a whole, as written
    engine.signOut();
  });

  it('what the desktop applies is still checked: an invalid bookmark stops the pull', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    const key = await accountKey();
    await phonePushes(server, key, PHONE, { 'preference:vex.bookmarks': [bookmark('bad', 'javascript:alert(1)')], ['sync:device:' + PHONE]: { level: 1 } });
    const pulled = await engine.pullNow();
    expect(pulled.ok).toBe(false);
    expect(pulled.reason).toMatch(/Invalid saved URL/);
    expect((await engine.pushNow()).ok).toBe(false);
    engine.signOut();
  });
});

describe('an empty account (§6 rule 3)', () => {
  it('a pull that finds it empty makes the next push start from nothing: no stale record comes back', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('bm1', 'https://a.test/'), bookmark('bm2', 'https://b.test/')]));
    await engine.verifyCode('a@b.test', '123456');
    const key = await accountKey();
    await phonePushes(server, key, PHONE, { [READING]: [{ id: 'r1', url: 'https://read.test/1' }], ['sync:device:' + PHONE]: { level: 1 } });
    expect((await engine.pullNow()).ok).toBe(true);
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('bm2', 'https://b.test/')]));
    // The blob is lost; the sessions survive.
    server.blob = null; server.revision = 0;
    const pulled = await engine.pullNow();
    expect(pulled).toEqual({ ok: true, empty: true });
    expect(stores.get('sync-records')).toEqual(Records.empty());
    expect((await engine.pushNow()).ok).toBe(true);
    expect(server.revision).toBe(1);
    const doc = await accountDoc(server, key);
    // Only this device's own data: nothing of the phone, no tombstone of bm1.
    expect(Object.keys(doc.records).filter(k => k.includes(PHONE) || k.includes('readingList'))).toEqual([]);
    expect(Object.values(doc.records).filter(r => r.deleted)).toEqual([]);
    expect((await accountValues(server, key))['preference:vex.bookmarks'].map(b => b.id)).toEqual(['bm2']);
    expect((await accountValues(server, key))['sync:device:dev1']).toEqual({ level: 1 });
    engine.signOut();
  });
});

describe('joining with a recovery code (§5.4)', () => {
  it('drops a local bookmark whose address the account already has, and keeps the local-only ones', async () => {
    const server = fakeWorker();
    const first = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('bmCloud', 'https://same.test/'), bookmark('bmGone', 'https://gone.test/')]));
    const { recoveryCode } = await first.verifyCode('a@b.test', '123456');
    // The account deletes bmGone: a tombstone's address no longer counts.
    localStorage.setItem('vex.bookmarks', JSON.stringify([bookmark('bmCloud', 'https://same.test/')]));
    expect((await first.pushNow()).ok).toBe(true);
    await first.signOut();
    localStorage.clear();
    const engine = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([
      bookmark('bmLocalDup', 'https://same.test/'), bookmark('bmLocal', 'https://local.test/'), bookmark('bmLocalGone', 'https://gone.test/'),
    ]));
    expect((await engine.enrollWithRecoveryCode('a@b.test', '123456', recoveryCode)).ok).toBe(true);
    expect(bookmarks().map(b => b.id).sort()).toEqual(['bmCloud', 'bmLocal', 'bmLocalGone']);
    const key = await accountKey();
    const doc = await accountDoc(server, key);
    expect(Object.keys(doc.records).some(k => k.includes('bmLocalDup'))).toBe(false);
    expect((await accountValues(server, key))['preference:vex.bookmarks'].map(b => b.id).sort()).toEqual(['bmCloud', 'bmLocal', 'bmLocalGone']);
    // A later round keeps it that way.
    expect((await engine.pullNow()).ok).toBe(true);
    expect((await engine.pushNow()).ok).toBe(true);
    expect(bookmarks().filter(b => b.url === 'https://same.test/').length).toBe(1);
    engine.signOut();
  });
});
