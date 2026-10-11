// @vitest-environment jsdom
//
// Saved passwords and authenticator (2FA) accounts sync between devices when
// turned on in Settings › Vex Sync › Choose what to sync: off by default,
// asked again before they are turned on, end-to-end encrypted, merged login
// by login, and nothing synced while Vex is locked.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const Records = require('../../src/renderer/js/sync-records.js');
const { createSyncSecrets } = require('../../src/main/sync-secrets.js');

const PASSWORD = 'correct horse battery staple';
const SECRET = 'JBSWY3DPEHPK3PXP';
const login = (over = {}) => ({ host: 'example.com', username: 'alice@example.com', password: PASSWORD, updatedAt: '2026-10-01T10:00:00.000Z', ...over });
const account = (over = {}) => ({ id: 'uuid-1', label: 'alice', issuer: 'GitHub', secret: SECRET, algorithm: 'sha1', digits: 6, period: 30, created: '2026-10-01T10:00:00.000Z', ...over });

// What main holds on one device, behind the same functions main.js wires.
function mainProcess(held, keyOf) {
  const store = kind => ({ load: () => structuredClone(held[kind]), save: async (list) => { held[kind] = structuredClone(list); } });
  const secrets = createSyncSecrets({ readKeyHex: async () => keyOf(), isLocked: () => !!held.locked, stores: { passwords: store('passwords'), authenticator: { ...store('authenticator'), validate: () => {} } } });
  return secrets;
}

let stores, keyHex, here, recheck, locked;
function freshEngine() {
  vi.resetModules();
  stores = new Map();
  here = { passwords: [], authenticator: [] };
  const secrets = mainProcess(here, () => keyHex);
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = {
    syncSaveKey: async (hex) => { keyHex = hex; }, syncSaveMeta: async () => {}, syncClearState: async () => {}, syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32',
    syncSecretsSeal: vi.fn((kinds) => secrets.sealKinds(kinds)),
    syncSecretsApply: vi.fn((lists) => secrets.applyKinds(lists)),
    syncSecretsDescribe: (items) => secrets.describe(items),
    syncSecretsPutBack: (request) => secrets.putBack(request),
  };
  locked = false;
  recheck = vi.fn(async () => true);
  window.VexLock = { locked: () => locked, recheck };
  window.VexTabPolicy = { snapshot: (v) => v };
  window.VexSyncRecords = Records;
  // vi.resetModules() leaves require's own cache: without this every test
  // would reuse the first test's engine and its record document.
  for (const file of ['sync-crypto.js', 'sync-engine.js']) delete require.cache[require.resolve('../../src/renderer/js/' + file)];
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}
const key = () => window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(keyHex));

// Another Vex on the account, with its own main process, built on the real
// pieces: it pulls, applies the account's sealed lists to its own store,
// makes its change, seals again and pushes.
async function otherDevice(system, email) {
  const session = await system.signIn(email, 'B');
  const held = { passwords: [], authenticator: [] };
  const secrets = mainProcess(held, () => keyHex);
  const sync = async (change = () => {}) => {
    const r = await system.call('GET', '/sync/pull', undefined, session.sessionToken);
    const doc = await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key());
    const values = Records.unflatten(Records.values(doc));
    await secrets.sealKinds(['passwords', 'authenticator']);
    await secrets.applyKinds({ passwords: values['secret:passwords'] || [], authenticator: values['secret:authenticator'] || [] });
    change(held);
    const sealed = await secrets.sealKinds(['passwords', 'authenticator']);
    values['secret:passwords'] = sealed.passwords;
    values['secret:authenticator'] = sealed.authenticator;
    values['sync:device:' + session.deviceId] = { level: 2, revision: r.body.revision };
    const flat = Records.flatten(values);
    for (const k of Object.keys(flat)) { const [source, kind] = JSON.parse(k); if (kind === 'item' && source.startsWith('secret:')) flat[k] = { index: 0, item: flat[k].item }; }
    const p = await system.provenPush(session, keyHex, r.body.revision, await window.SyncCrypto.encrypt(Records.capture(doc, flat, session.deviceId), await key()));
    if (p.status !== 200) throw new Error('push ' + p.status);
  };
  return { held, sync };
}
async function accountDoc(system, token) {
  const r = await system.call('GET', '/sync/pull', undefined, token);
  return window.SyncCrypto.decrypt(r.body.encryptedBlob, await key());
}

// Signs in, records every uploaded body, and turns the kinds on.
async function signedIn(email, { on = ['passwords', 'authenticator'] } = {}) {
  const { system } = workerStandIn();
  const engine = freshEngine();
  const uploads = [];
  const fetch = window.VexNet.fetch;
  window.VexNet.fetch = async (url, opts = {}) => { if (opts.body) uploads.push(String(opts.body)); return fetch(url, opts); };
  here.passwords = [login()];
  here.authenticator = [account()];
  await engine.verifyCode(email, (await engine.requestCode(email)).devCode);
  for (const id of on) expect((await engine.setTypeSynced(id, true)).ok).toBe(true);
  return { system, engine, uploads, token: engine.getState().sessionToken };
}

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });

describe('passwords and authenticator in Vex Sync', () => {
  it('are off by default: nothing of them is read or sent', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    here.passwords = [login()];
    await engine.verifyCode('off@sync.test', (await engine.requestCode('off@sync.test')).devCode);
    const types = engine.syncTypes();
    expect(types.find(t => t.id === 'passwords').on).toBe(false);
    expect(types.find(t => t.id === 'authenticator').on).toBe(false);
    expect((await engine.pushNow()).ok).toBe(true);
    expect(window.vex.syncSecretsSeal).not.toHaveBeenCalled();
    const doc = await accountDoc(system, engine.getState().sessionToken);
    expect(Object.keys(doc.records).some(k => k.includes('secret:'))).toBe(false);
  });

  it('asks again (the Vex PIN if set) before turning one on, and stays off when that is declined', async () => {
    workerStandIn();
    const engine = freshEngine();
    await engine.verifyCode('ask@sync.test', (await engine.requestCode('ask@sync.test')).devCode);
    recheck.mockResolvedValueOnce(false);
    expect(await engine.setTypeSynced('passwords', true)).toEqual({ ok: false, canceled: true });
    expect(engine.syncTypes().find(t => t.id === 'passwords').on).toBe(false);
    expect(recheck).toHaveBeenCalledTimes(1);
    expect((await engine.setTypeSynced('passwords', true)).ok).toBe(true);
    expect(engine.syncTypes().find(t => t.id === 'passwords').on).toBe(true);
    // Turning it off asks nothing; on again asks again.
    await engine.setTypeSynced('passwords', false);
    expect(engine.syncTypes().find(t => t.id === 'passwords').on).toBe(false);
    expect(recheck).toHaveBeenCalledTimes(2);
  });

  it('upload no password, username, site or 2FA secret in readable form, even inside the encrypted document', async () => {
    const { system, uploads, token } = await signedIn('enc@sync.test');
    const doc = await accountDoc(system, token);
    expect(Object.keys(doc.records).filter(k => k.startsWith('["secret:passwords","item"')).length).toBe(1);
    const inside = JSON.stringify(doc) + JSON.stringify([...stores.values()]);
    for (const plain of [PASSWORD, 'alice@example.com', 'example.com', SECRET, 'GitHub']) {
      expect(inside).not.toContain(plain);
      for (const body of uploads) expect(body).not.toContain(plain);
    }
  });

  it('a login and a 2FA account added on one device arrive on the other, and changes go back', async () => {
    const { system, engine } = await signedIn('two@sync.test');
    const b = await otherDevice(system, 'two@sync.test');
    await b.sync();
    expect(b.held.passwords).toEqual([login()]);
    expect(b.held.authenticator).toEqual([account()]);
    // B changes the password and adds an account; this device gets both.
    await b.sync(h => {
      h.passwords[0] = login({ password: 'changed on B', updatedAt: '2026-10-05T00:00:00.000Z' });
      h.authenticator.push(account({ id: 'uuid-2', label: 'bob', issuer: 'Discord', secret: 'MZXW6YTBOI' }));
    });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(here.passwords.map(e => e.password)).toEqual(['changed on B']);
    expect(here.authenticator.map(e => e.issuer).sort()).toEqual(['Discord', 'GitHub']);
    // The "Never save" list travels with the passwords.
    localStorage.setItem('vex.pwNever', JSON.stringify(['bank.test']));
    expect((await engine.pushNow()).ok).toBe(true);
    const doc = await accountDoc(system, engine.getState().sessionToken);
    expect(Records.unflatten(Records.values(doc))['preference:vex.pwNever']).toEqual(['bank.test']);
  });

  it('a deletion is a tombstone that removes the login on the other device', async () => {
    const { system, engine } = await signedIn('del@sync.test');
    const b = await otherDevice(system, 'del@sync.test');
    await b.sync(h => { h.passwords.push(login({ host: 'second.test' })); });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(here.passwords.map(e => e.host).sort()).toEqual(['example.com', 'second.test']);
    // Deleted here: the account keeps a deleted record, and B removes it.
    here.passwords = here.passwords.filter(e => e.host !== 'second.test');
    expect((await engine.pushNow()).ok).toBe(true);
    const doc = await accountDoc(system, engine.getState().sessionToken);
    const items = Object.entries(doc.records).filter(([k]) => k.startsWith('["secret:passwords","item"'));
    expect(items.filter(([, r]) => r.deleted)).toHaveLength(1);
    await b.sync();
    expect(b.held.passwords.map(e => e.host)).toEqual(['example.com']);
  });

  it('two devices changing one login: the newer change wins, the other is kept in Sync conflicts and can be put back', async () => {
    const { system, engine } = await signedIn('conf@sync.test');
    const b = await otherDevice(system, 'conf@sync.test');
    await b.sync();
    // Changed here first (older), then on B (newer), before either synced.
    here.passwords = [login({ password: 'older, from here', updatedAt: '2026-10-02T00:00:00.000Z' })];
    await b.sync(h => { h.passwords[0] = login({ password: 'newer, from B', updatedAt: new Date().toISOString() }); });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(here.passwords.map(e => e.password)).toEqual(['newer, from B']);
    const [c] = engine.conflicts();
    expect(c.what).toBe('Passwords › alice@example.com on example.com');
    expect(c.versions).toHaveLength(2);
    expect(JSON.stringify(engine.conflicts())).not.toContain('from B');
    const older = c.versions.findIndex(v => !v.current);
    expect((await engine.resolveConflict(c.key, older)).ok).toBe(true);
    expect(here.passwords.map(e => e.password)).toEqual(['older, from here']);
    expect(engine.conflicts()).toEqual([]);
    await b.sync();
    expect(b.held.passwords.map(e => e.password)).toEqual(['older, from here']);
  });

  it('turning it on joins: the same login on both devices is one, the newer password wins and nothing is deleted', async () => {
    const { system, engine } = await signedIn('join@sync.test', { on: [] });
    const b = await otherDevice(system, 'join@sync.test');
    await b.sync(h => { h.passwords = [login({ password: 'newer on B', updatedAt: '2026-10-09T00:00:00.000Z' }), login({ host: 'only-b.test' })]; });
    expect((await engine.setTypeSynced('passwords', true)).ok).toBe(true);
    expect(here.passwords.map(e => [e.host, e.password]).sort()).toEqual([['example.com', 'newer on B'], ['only-b.test', PASSWORD]]);
    await b.sync();
    expect(b.held.passwords).toHaveLength(2);
  });

  it('nothing syncs while Vex is locked; what changed goes up after unlocking', async () => {
    const { system, engine, uploads, token } = await signedIn('lock@sync.test');
    locked = true;
    here.locked = true;
    const before = uploads.length;
    here.passwords = [login({ password: 'saved before the lock', updatedAt: '2026-10-07T00:00:00.000Z' })];
    expect(await engine.pushNow()).toMatchObject({ ok: false, locked: true });
    expect(await engine.pullNow()).toMatchObject({ ok: false, locked: true });
    expect(uploads.length).toBe(before);
    locked = false;
    here.locked = false;
    window.dispatchEvent(new CustomEvent('vex-unlocked'));
    const b = await otherDevice(system, 'lock@sync.test');
    await vi.waitFor(async () => {
      const values = Records.unflatten(Records.values(await accountDoc(system, token)));
      expect(values['secret:passwords'][0].t).toBe(Date.parse('2026-10-07T00:00:00.000Z'));
    });
    await b.sync();
    expect(b.held.passwords.map(e => e.password)).toEqual(['saved before the lock']);
  });
});
