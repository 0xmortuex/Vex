// @vitest-environment jsdom
//
// One browser across devices, end to end through the real sync worker source
// (local stand-in, tests/renderer/syncWorkerStandIn.js; no network): what each
// device sends, what a private tab never does, opt-in categories, the Devices
// view from the account's document, and addressed handoff.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const Records = require('../../src/renderer/js/sync-records.js');
const Contracts = require('../../src/renderer/js/data-contracts.js');
const Live = require('../../src/renderer/js/live-session.js');

let stores, keyHex;
function freshEngine() {
  vi.resetModules();
  stores = new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = { syncSaveKey: async (hex) => { keyHex = hex; }, syncSaveMeta: async () => {}, syncClearState: async () => {}, syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32' };
  window.VexDataContracts = Contracts;
  require('../../src/renderer/js/tab-policy.js');
  window.VexSyncRecords = Records;
  window.VexLiveSession = Live;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}
const key = () => window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(keyHex));

function openTabs(list, activeTabId = 't0') {
  const tabs = list.map((t, i) => ({ id: 't' + i, title: t.title || t.url, ...t }));
  global.TabManager = window.TabManager = { tabs, groups: [{ id: 'g1', name: 'Research' }], activeTabId, persistTabs: vi.fn(async () => true), createTab: vi.fn() };
  return tabs;
}
async function cloudValues(system, engine) {
  const r = await system.call('GET', '/sync/pull', undefined, engine.getState().sessionToken);
  return Records.unflatten(Records.values(await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key())));
}
async function otherDevice(system, email, name) {
  const session = await system.signIn(email, name);
  return {
    id: session.deviceId, session,
    async sync(change) {
      const r = await system.call('GET', '/sync/pull', undefined, session.sessionToken);
      const doc = await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key());
      const values = Records.unflatten(Records.values(doc));
      values['sync:device:' + session.deviceId] = { level: 2, revision: r.body.revision };
      change(values);
      const next = Records.capture(doc, Records.flatten(values), session.deviceId);
      const p = await system.provenPush(session, keyHex, r.body.revision, await window.SyncCrypto.encrypt(next, await key()));
      if (p.status !== 200) throw new Error('push ' + p.status);
    },
  };
}
async function signIn(engine, email, name) {
  await engine.verifyCode(email, (await engine.requestCode(email)).devCode, name);
}

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });

describe('open tabs: what is sent', () => {
  const SECRETS = [
    { url: 'https://work.test/doc', title: 'Doc', pinned: true, groupId: 'g1', favicon: 'https://work.test/f.ico', scrollPosition: { x: 0, y: 2600 } },
    { url: 'https://hidden.test/', partition: 'otr-1' },
    { url: 'https://onion.test/', partition: 'tor-2' },
    { url: 'https://routed.test/', partition: 'persist:route-abc' },
    { url: 'https://mail.google.com/mail/u/0/' },
    { url: 'https://x.test/cb?token=abc123' },
    { url: 'https://news.test/story', title: 'Story' },
  ];

  it('without Live tabs: version 1 shape, and a routed or sensitive tab is still not in it', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    openTabs(SECRETS);
    await signIn(engine, 'v1@live.test', 'Desk A');
    const values = await cloudValues(system, engine);
    expect(values['sync:tabs:' + engine.getState().deviceId]).toEqual({ tabs: [
      { url: 'https://work.test/doc', title: 'Doc' },
      { url: 'https://news.test/story', title: 'Story' },
    ] });
    expect(engine.syncTypes().find(t => t.id === 'liveTabs').on).toBe(false);
    expect(engine.syncTypes().find(t => t.id === 'readingQueue').on).toBe(false);
  });

  it('with Live tabs on: version 2 carries icon, group, pinned, scroll and last use, and still nothing private', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    openTabs(SECRETS);
    await signIn(engine, 'v2@live.test', 'Desk A');
    expect((await engine.setTypeSynced('liveTabs', true)).ok).toBe(true);
    const value = (await cloudValues(system, engine))['sync:tabs:' + engine.getState().deviceId];
    expect(value.v).toBe(2);
    expect(value.tabs.map(t => t.url)).toEqual(['https://work.test/doc', 'https://news.test/story']);
    expect(value.tabs[0]).toMatchObject({ title: 'Doc', p: 1, g: 'Research', fav: 'https://work.test/f.ico', s: 2500 });
    expect(value.active).toBe('t0');
    expect(JSON.stringify(value)).not.toMatch(/hidden\.test|onion\.test|routed\.test|mail\.google|token=/);
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(Live.LIMITS.MAX_BYTES);
  });

  it('a closed tab leaves a tombstone, and an unchanged device does not churn the document', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    const tabs = openTabs([{ url: 'https://a.test/' }, { url: 'https://b.test/' }]);
    await signIn(engine, 'tomb@live.test', 'Desk A');
    await engine.setTypeSynced('liveTabs', true);
    const id = engine.getState().deviceId;
    const before = (await cloudValues(system, engine))['sync:tabs:' + id];
    expect(before.tabs.length).toBe(2);
    expect((await engine.pushNow()).ok).toBe(true);
    const same = (await cloudValues(system, engine))['sync:tabs:' + id];
    expect(JSON.stringify(same)).toBe(JSON.stringify(before));
    tabs.pop(); // b.test closed
    expect((await engine.pushNow()).ok).toBe(true);
    const after = (await cloudValues(system, engine))['sync:tabs:' + id];
    expect(after.tabs.map(t => t.url)).toEqual(['https://a.test/']);
    expect(after.closed.map(t => t.id)).toEqual(['t1']);
    expect(Live.hlcCompare(after.hlc, before.hlc)).toBe(1);
  });
});

describe('the Devices view from the account', () => {
  it('lists every device with its tabs, the phone and a version 1 desktop included', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    openTabs([{ url: 'https://a.test/' }]);
    await signIn(engine, 'view@live.test', 'Desk A');
    await engine.setTypeSynced('liveTabs', true);
    const laptop = await otherDevice(system, 'view@live.test', 'Laptop B');
    const phone = await otherDevice(system, 'view@live.test', 'Pixel 9');
    const now = Date.now();
    await laptop.sync(v => {
      v['sync:tabs:' + laptop.id] = Live.buildSnapshot([{ id: 'x1', url: 'https://l.test/read', title: 'Read', pinned: true, favicon: 'https://l.test/i.png' }], { now: now - 120000, node: laptop.id, activeId: 'x1' });
    });
    await phone.sync(v => { v['sync:tabs:' + phone.id] = { tabs: [{ url: 'https://p.test/', title: 'Phone tab' }] }; });
    expect((await engine.pullNow()).ok).toBe(true);
    const view = engine.devicesView(now);
    expect(view.map(d => d.name).sort()).toEqual(['Desk A', 'Laptop B', 'Pixel 9']);
    expect(view[0].self).toBe(true);
    const l = view.find(d => d.name === 'Laptop B');
    expect(l.tabs[0]).toMatchObject({ url: 'https://l.test/read', pinned: true, favicon: 'https://l.test/i.png', active: true });
    expect(view.find(d => d.name === 'Pixel 9')).toMatchObject({ kind: 'phone', tabCount: 1 });
    const offer = Live.continueWhereLeftOff(view, { now: now + 15 * 60000, selfLastActive: now - 3600000 });
    expect(offer.device.name).toBe('Laptop B');
    // The device list is the account's: a removed device is gone from the view.
    await system.call('DELETE', '/sync/devices/' + phone.id, undefined, engine.getState().sessionToken);
    await engine.listDevices();
    expect((await engine.pullNow()).ok).toBe(true);
    expect(engine.devicesView(now).some(d => d.name === 'Pixel 9')).toBe(false);
  });
});

describe('reading queue', () => {
  const queue = [
    { id: 'rl1', url: 'https://blog.test/a', title: 'A', at: 1, read: false },
    { id: 'rl2', url: 'https://blog.test/private', title: 'B', at: 2, read: false, ownSession: true },
  ];
  it('is off until chosen, then travels without the item that has a session of its own, which stays', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    openTabs([{ url: 'https://a.test/' }]);
    localStorage.setItem('vex.readLater', JSON.stringify(queue));
    await signIn(engine, 'rq@live.test', 'Desk A');
    expect((await cloudValues(system, engine))['preference:vex.readLater']).toBeUndefined();
    expect((await engine.setTypeSynced('readingQueue', true)).ok).toBe(true);
    expect((await cloudValues(system, engine))['preference:vex.readLater'].map(i => i.id)).toEqual(['rl1']);
    // Another device adds one; a pull brings it and keeps the local own-session item.
    const b = await otherDevice(system, 'rq@live.test', 'Laptop B');
    await b.sync(v => { v['preference:vex.readLater'] = [...v['preference:vex.readLater'], { id: 'rlB', url: 'https://b.test/x', title: 'From B', at: 3, read: false }]; });
    expect((await engine.pullNow()).ok).toBe(true);
    const local = JSON.parse(localStorage.getItem('vex.readLater'));
    expect(local.map(i => i.id).sort()).toEqual(['rl1', 'rl2', 'rlB']);
    expect((await engine.pushNow()).ok).toBe(true);
    expect((await cloudValues(system, engine))['preference:vex.readLater'].map(i => i.id).sort()).toEqual(['rl1', 'rlB']);
  });
});

describe('addressed handoff', () => {
  const send = async (system, from, payload) => system.call('POST', '/sync/drop', { encryptedBlob: await window.SyncCrypto.encrypt(payload, await key()) }, from.session.sessionToken);
  const take = async (system, who) => {
    const r = await system.call('GET', '/sync/drop', undefined, who.session.sessionToken);
    return Promise.all(r.body.items.map(async i => ({ ...(await window.SyncCrypto.decrypt(i.encryptedBlob, await key())), from: i.fromDeviceId })));
  };

  it('dropSend carries the address inside the encrypted payload', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    openTabs([{ url: 'https://a.test/' }]);
    await signIn(engine, 'drop@live.test', 'Desk A');
    const b = await otherDevice(system, 'drop@live.test', 'Laptop B');
    await b.sync(() => {});
    await engine.dropSend('https://t.test/x', 'X', { to: b.id });
    await expect(engine.dropSend('https://t.test/x', 'X', { to: 'not-a-device' })).rejects.toThrow(/Unknown device/);
    const items = await take(system, b);
    expect(items).toMatchObject([{ url: 'https://t.test/x', title: 'X', to: b.id }]);
  });

  it('a device the item is not for hands it on instead of opening it, up to four hops', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    openTabs([{ url: 'https://a.test/' }]);
    await signIn(engine, 'fwd@live.test', 'Desk A');
    const b = await otherDevice(system, 'fwd@live.test', 'Laptop B');
    const c = await otherDevice(system, 'fwd@live.test', 'Tablet C');
    await b.sync(() => {});
    await c.sync(() => {});
    window.VexConfig = { ...window.VexConfig, syncWorkerUrl: () => 'http://localhost' };
    global.SyncEngine = engine;
    vi.resetModules();
    window.VexTabPolicy = { isPrivateWindow: false };
    const { Handoff } = require('../../src/renderer/js/handoff.js');
    Handoff.pushAll = () => 0;
    await send(system, b, { url: 'https://for-c.test/', title: 'For C', to: c.id });
    const got = await Handoff.receive();
    expect(got).toEqual([]);                                   // not for this device: nothing opened or shown
    expect(Handoff.inbox()).toEqual([]);
    const forwarded = await take(system, c);
    expect(forwarded).toMatchObject([{ url: 'https://for-c.test/', title: 'For C', to: c.id, hop: 1 }]);
    // Unaddressed items still arrive here.
    await send(system, b, { url: 'https://for-anyone.test/', title: 'Anyone' });
    const mine = await Handoff.receive();
    expect(mine.map(i => i.url)).toEqual(['https://for-anyone.test/']);
    // The fifth hop is dropped, not forwarded.
    await send(system, b, { url: 'https://loop.test/', title: 'Loop', to: c.id, hop: 4 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await Handoff.receive();
    expect(await take(system, c)).toEqual([]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('dropped a tab addressed to another device'));
  });
});
