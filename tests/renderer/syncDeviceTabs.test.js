// @vitest-environment jsdom
//
// SY1 (found 2026-10-10, live-tabs.mjs): open tabs were one list shared by
// every computer, and each pull applied it to the open tabs: the tab you were
// typing in was sent to another address, or closed, because another computer
// had changed or closed "the same" tab. Now each device sends its own open
// tabs, a pull never touches an open tab, and the others' tabs are listed
// under History › Tabs from other devices, as in Chrome.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const Records = require('../../src/renderer/js/sync-records.js');
const Contracts = require('../../src/renderer/js/data-contracts.js');

let stores, keyHex;
function freshEngine() {
  vi.resetModules();
  stores = new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = { syncSaveKey: async (hex) => { keyHex = hex; }, syncSaveMeta: async () => {}, syncClearState: async () => {}, syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32' };
  window.VexDataContracts = Contracts;
  require('../../src/renderer/js/tab-policy.js');
  window.VexSyncRecords = Records;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}
const key = () => window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(keyHex));

function openTabs(list) {
  const tabs = list.map((t, i) => ({ id: 't' + i, title: t.title || t.url, ...t }));
  global.TabManager = window.TabManager = {
    tabs, activeTabId: 't0',
    persistTabs: vi.fn(async () => true),
    createTab: vi.fn(),
  };
  return tabs;
}

async function otherDevice(system, email, name, level = 2) {
  const session = await system.signIn(email, name);
  return {
    id: session.deviceId,
    async sync(change) {
      const r = await system.call('GET', '/sync/pull', undefined, session.sessionToken);
      const doc = await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key());
      const values = Records.unflatten(Records.values(doc));
      values['sync:device:' + session.deviceId] = level >= 2 ? { level, revision: r.body.revision } : { level };
      change(values);
      const next = Records.capture(doc, Records.flatten(values), session.deviceId);
      const p = await system.push(session.sessionToken, r.body.revision, await window.SyncCrypto.encrypt(next, await key()));
      if (p.status !== 200) throw new Error('push ' + p.status);
    },
  };
}

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });

describe('open tabs from other devices', () => {
  it('each device sends its own open web pages; private tabs and other addresses stay home', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    openTabs([
      { url: 'https://work.test/doc', title: 'Doc' },
      { url: 'https://secret.test/', partition: 'otr-1' },
      { url: 'file:///C:/notes.txt' },
      { url: 'https://news.test/', sleeping: true },
    ]);
    await engine.verifyCode('tabs@sync.test', (await engine.requestCode('tabs@sync.test')).devCode, 'Desk A');
    const pulled = await system.call('GET', '/sync/pull', undefined, engine.getState().sessionToken);
    const values = Records.unflatten(Records.values(await window.SyncCrypto.decrypt(pulled.body.encryptedBlob, await key())));
    expect(values['sync:tabs:' + engine.getState().deviceId]).toEqual({ tabs: [
      { url: 'https://work.test/doc', title: 'Doc' },
      { url: 'https://news.test/', title: 'https://news.test/' },
    ] });
    // The shared list is no longer written.
    expect(values['storage:tabs']).toBeUndefined();
  });

  it('a pull never changes or closes an open tab, and lists the other device\'s tabs by its name', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    const tabs = openTabs([{ url: 'https://example.com/?from=A', title: 'Typing here' }]);
    const before = JSON.stringify(tabs);
    await engine.verifyCode('pull@sync.test', (await engine.requestCode('pull@sync.test')).devCode, 'Desk A');
    const b = await otherDevice(system, 'pull@sync.test', 'Laptop B', 1);
    // B is an older desktop: it sends the shared list, with A's tab navigated
    // elsewhere and a tab of its own. It also sends its own list.
    await b.sync(v => {
      v['storage:tabs'] = [{ id: 't0', url: 'https://example.com/?from=B', title: 'Moved' }, { id: 'b1', url: 'https://b.test/', title: 'B only' }];
      v['sync:tabs:' + b.id] = { tabs: [{ url: 'https://b.test/', title: 'B only' }] };
    });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(JSON.stringify(TabManager.tabs)).toBe(before);
    expect(engine.otherDeviceTabs()).toEqual([{ deviceId: b.id, name: 'Laptop B', tabs: [{ url: 'https://b.test/', title: 'B only' }], at: expect.any(Number) }]);
    // B "closes" A's tab in the shared list: still nothing happens here.
    await b.sync(v => { v['storage:tabs'] = []; });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(JSON.stringify(TabManager.tabs)).toBe(before);
    // And the older device's shared list is carried as it came (it leaves the
    // account once every device is at level 2, syncGrowth.test.js).
    expect((await engine.pushNow()).ok).toBe(true);
    const pulled = await system.call('GET', '/sync/pull', undefined, engine.getState().sessionToken);
    const doc = await window.SyncCrypto.decrypt(pulled.body.encryptedBlob, await key());
    expect(Records.unflatten(Records.values(doc))['storage:tabs']).toEqual([]);
  });

  it('History › Tabs from other devices opens one in a new tab', async () => {
    const { system } = workerStandIn();
    const engine = freshEngine();
    openTabs([{ url: 'https://a.test/' }]);
    await engine.verifyCode('panel@sync.test', (await engine.requestCode('panel@sync.test')).devCode, 'Desk A');
    const b = await otherDevice(system, 'panel@sync.test', 'Laptop B');
    await b.sync(v => { v['sync:tabs:' + b.id] = { tabs: [{ url: 'https://read.test/later', title: 'Read later' }] }; });
    expect((await engine.pullNow()).ok).toBe(true);
    document.body.innerHTML = '<div class="panel" id="panel-history"></div>';
    window.SidebarManager = global.SidebarManager = { hideActivePanel: vi.fn() };
    window.VexConfig.aiWorkerUrl = () => '';
    const { HistoryPanel } = require('../../src/renderer/js/history-panel.js');
    HistoryPanel.init();
    const box = document.getElementById('history-devices');
    expect(box.hidden).toBe(false);
    expect(box.querySelector('.history-device-name').textContent).toBe('Laptop B');
    const row = box.querySelector('.history-device-tab');
    expect(row.textContent).toContain('Read later');
    row.click();
    expect(TabManager.createTab).toHaveBeenCalledWith('https://read.test/later', true);
  });
});
