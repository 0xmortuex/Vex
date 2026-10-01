// @vitest-environment jsdom
//
// Fixes of 2026-09-30 (r5), window side:
//   * the New Tab page's grid (its own storage, 'vex.shortcuts' there) synced
//     nowhere; the page hands it to the window as vex.startTiles, which syncs
//     behind the same every-device gate as the shortcut tiles, and the synced
//     grid is handed back to the open New Tab pages;
//   * a private window said nothing when a Tor or proxy site rule did not
//     apply there;
//   * a container tab's page was told persist:main's permission decisions;
//   * a closed tab's JavaScript-off back list was kept by main for half an hour.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');
const Contracts = require('../../src/renderer/js/data-contracts.js');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code, body = {}) => ({ ok: false, status: code, json: async () => body });
const GRID = 'preference:vex.startTiles';
const BAR = 'preference:vex.shortcuts';

// Like the worker (see sweep-r4-sync-tiles.test.js).
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

const tile = (name) => ({ name, url: 'https://' + name + '.test' });
const grid = () => JSON.parse(localStorage.getItem('vex.startTiles') || 'null');
const names = (list) => (list || []).map(t => t.name).sort();
const setGrid = (list) => localStorage.setItem('vex.startTiles', JSON.stringify(list));
const accountKey = () => window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
const accountDoc = async (server, key) => window.SyncCrypto.decrypt(server.blob, key);
const accountValues = async (server, key) => Records.unflatten(Records.values(await accountDoc(server, key)));
async function otherDevicePushes(server, key, device, change) {
  const doc = await accountDoc(server, key);
  const values = Records.unflatten(Records.values(doc));
  change(values);
  server.blob = await window.SyncCrypto.encrypt(Records.capture(doc, Records.flatten(values), device), key);
  server.revision += 1;
  if (!server.devices.some(d => d.deviceId === device)) server.devices.push({ deviceId: device });
}
const newDevice = (server, key, device, change) => otherDevicePushes(server, key, device, v => { v['sync:device:' + device] = { level: 1 }; change?.(v); });
// Vex 2.34.2: everything it does not know is marked deleted.
const oldDevice = (server, key, device) => otherDevicePushes(server, key, device, v => {
  for (const source of Object.keys(v)) if (source === BAR || source === GRID || source.startsWith('sync:device:')) delete v[source];
});

describe('the New Tab grid syncs as a list of its own', () => {
  beforeEach(() => {
    localStorage.clear();
    window.showToast = vi.fn();
    window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
    global.WebviewManager = { pushStartTiles: vi.fn() };
  });
  afterEach(() => { vi.restoreAllMocks(); delete global.WebviewManager; });

  it('uploads once every device understands it, item by item, apart from the Glass bar', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    setGrid([tile('a'), tile('b')]);
    localStorage.setItem('vex.shortcuts', JSON.stringify([tile('bar')]));
    await engine.verifyCode('a@b.test', '123456');
    const key = await accountKey();
    expect((await accountValues(server, key))[GRID]).toBeUndefined();   // not listed yet: waits
    expect((await engine.pushNow()).ok).toBe(true);
    const values = await accountValues(server, key);
    expect(names(values[GRID])).toEqual(['a', 'b']);
    expect(values[GRID].every(t => /^tile-/.test(t.id))).toBe(true);
    expect(names(values[BAR])).toEqual(['bar']);
    expect(grid()).toEqual([tile('a'), tile('b')]);                     // ids stay in the account
    engine.signOut();
  });

  it('an addition and a removal on another device arrive, and the open New Tab pages are handed the grid', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    setGrid([tile('a')]);
    await engine.verifyCode('a@b.test', '123456');
    await engine.pushNow();
    const key = await accountKey();
    await newDevice(server, key, 'devB', v => { v[GRID] = [...v[GRID], { ...tile('b'), id: 'tile-b' }]; });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(names(grid())).toEqual(['a', 'b']);
    expect(WebviewManager.pushStartTiles).toHaveBeenCalled();
    await newDevice(server, key, 'devB', v => { v[GRID] = v[GRID].filter(t => t.name !== 'a'); });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(names(grid())).toEqual(['b']);
    engine.signOut();
  });

  it('joining keeps this device\'s grid and takes the account\'s: the first merge deletes nothing', async () => {
    const server = fakeWorker();
    const first = freshEngine();
    setGrid([tile('cloud')]);
    const { recoveryCode } = await first.verifyCode('a@b.test', '123456');
    await first.pushNow();
    localStorage.clear();
    const engine = freshEngine();
    setGrid([tile('local')]);
    expect((await engine.enrollWithRecoveryCode('a@b.test', '123456', recoveryCode)).ok).toBe(true);
    expect(names(grid())).toEqual(['cloud', 'local']);
    const key = await accountKey();
    expect(names((await accountValues(server, key))[GRID])).toEqual(['cloud', 'local']);
    engine.signOut();
  });

  it('with an older Vex on the account the grid stays here, and the account\'s grid records are left alone', async () => {
    const server = fakeWorker();
    const engine = freshEngine();
    setGrid([tile('a'), tile('b')]);
    await engine.verifyCode('a@b.test', '123456');
    await engine.pushNow();
    const key = await accountKey();
    await oldDevice(server, key, 'devOld');
    expect((await engine.pullNow()).ok).toBe(true);
    // The older device's push took this device's marker away; the pull puts
    // it back with a push of its own right after. Wait for that, or the push
    // below can land while it runs (seen as a flake under load).
    const own = Object.values(server.sessions)[0];
    await vi.waitFor(async () => expect((await accountValues(server, key))['sync:device:' + own]).toEqual({ level: 1 }));
    expect(names(grid())).toEqual(['a', 'b']);
    setGrid([...grid(), tile('c')]);
    const before = Object.entries((await accountDoc(server, key)).records).filter(([k]) => k.includes('vex.startTiles'));
    expect((await engine.pushNow()).ok).toBe(true);
    const after = Object.entries((await accountDoc(server, key)).records).filter(([k]) => k.includes('vex.startTiles'));
    expect(after).toEqual(before);
    expect(names(grid())).toEqual(['a', 'b', 'c']);
    expect(engine.tileSyncState()).toEqual({ open: false, waitingOn: ['devOld'] });
    // Gone again: the grid goes back up, nothing lost.
    server.devices = server.devices.filter(d => d.deviceId !== 'devOld');
    expect((await engine.pushNow()).ok).toBe(true);
    expect(names((await accountValues(server, key))[GRID])).toEqual(['a', 'b', 'c']);
    engine.signOut();
  });

  it('what arrives is checked like the shortcut tiles', () => {
    expect(() => Contracts.sources({ [GRID]: [{ name: 'x', url: 'javascript:alert(1)' }] })).toThrow('Invalid saved URL');
    expect(() => Contracts.sources({ [GRID]: [{ name: 'x', url: 'https://x.test' }] })).not.toThrow();
  });
});

describe('the window keeps the New Tab grid and hands it back', () => {
  const START = 'file:///C:/vex/src/renderer/start.html';
  let W;
  const page = (url = START) => ({ getURL: () => url, executeJavaScript: vi.fn(() => Promise.resolve(true)) });
  const handed = (wv) => wv.executeJavaScript.mock.calls.map(c => JSON.parse(c[0].match(/__vexSetStartTiles\((.*)\) : false$/)[1]));
  beforeEach(async () => {
    localStorage.clear();
    window.showToast = vi.fn();
    vi.resetModules();
    W = (await import('../../src/renderer/js/webview.js')).WebviewManager;
    W.webviews = new Map();
  });

  it('the first page to open gives the window its saved grid, and is marked handed over', () => {
    const a = page();
    W.webviews.set('t1', a);
    W.saveStartTiles({ type: 'start-tiles', loading: true, handed: false, tiles: [tile('a')] }, a);
    expect(JSON.parse(localStorage.getItem('vex.startTiles'))).toEqual([tile('a')]);
    expect(handed(a)).toEqual([[tile('a')]]);
  });

  it('a page that never changed its built-in tiles takes nothing to the window', () => {
    const a = page();
    W.webviews.set('t1', a);
    W.saveStartTiles({ type: 'start-tiles', loading: true, handed: false, tiles: null }, a);
    expect(localStorage.getItem('vex.startTiles')).toBeNull();
    expect(a.executeJavaScript).not.toHaveBeenCalled();
  });

  it('a page not yet handed over adds its own tiles to the window\'s grid; one handed over just shows it', () => {
    setGrid([tile('synced'), tile('both')]);
    const a = page(), b = page();
    W.webviews.set('t1', a); W.webviews.set('t2', b);
    W.saveStartTiles({ type: 'start-tiles', loading: true, handed: false, tiles: [tile('both'), tile('mine')] }, a);
    expect(names(grid())).toEqual(['both', 'mine', 'synced']);
    W.saveStartTiles({ type: 'start-tiles', loading: true, handed: true, tiles: [tile('stale')] }, b);
    expect(names(grid())).toEqual(['both', 'mine', 'synced']);
    expect(names(handed(b).at(-1))).toEqual(['both', 'mine', 'synced']);
  });

  it('a change is kept and handed to the other open New Tab pages only; other pages are never touched', () => {
    const a = page(), b = page(), site = page('https://evil.example/renderer/start.html');
    W.webviews.set('t1', a); W.webviews.set('t2', b); W.webviews.set('t3', site);
    W.saveStartTiles({ type: 'start-tiles', tiles: [tile('x'), tile('y')] }, a);
    expect(grid()).toEqual([tile('x'), tile('y')]);
    expect(a.executeJavaScript).not.toHaveBeenCalled();
    expect(handed(b)).toEqual([[tile('x'), tile('y')]]);
    expect(site.executeJavaScript).not.toHaveBeenCalled();
  });

  it('an unreadable grid from a page is refused and said', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    W.saveStartTiles({ type: 'start-tiles', tiles: [{ url: 5 }] }, page());
    expect(localStorage.getItem('vex.startTiles')).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('New Tab tiles could not be saved'), 'error');
    err.mockRestore();
  });

  it('start.html hands its grid over on every save and on opening, and takes the window\'s back', () => {
    const src = require('node:fs').readFileSync(require('node:path').resolve('src/renderer/start.html'), 'utf8');
    expect(src).toContain("console.log('VEX_CMD:' + JSON.stringify({ type: 'start-tiles', tiles: shortcuts }));");
    expect(src).toContain("type: 'start-tiles', loading: true, handed:");
    expect(src).toContain('window.__vexSetStartTiles = (list) => {');
    const wv = require('node:fs').readFileSync(require('node:path').resolve('src/renderer/js/webview.js'), 'utf8');
    expect(wv).toContain("} else if (cmd.type === 'start-tiles') {");
  });
});

describe('a private window and the site rules', () => {
  let S;
  beforeEach(async () => {
    localStorage.clear();
    window.showToast = vi.fn();
    window.VexTabPolicy = { isPrivateWindow: true };
    window.vex = { siteRoutesRoutedHosts: vi.fn(async () => [{ host: 'torproject.org', mode: 'tor' }, { host: 'p.example', mode: 'proxy' }]) };
    vi.resetModules();
    S = (await import('../../src/renderer/js/site-routes.js')).SiteRoutes;
  });
  afterEach(() => { delete window.VexTabPolicy; document.getElementById('vex-site-routes')?.remove(); });
  const settle = () => new Promise(r => setTimeout(r, 0));

  it('says once that a Tor rule does not apply here', async () => {
    S.applyTo({ url: 'https://other.example/' });
    await settle();
    expect(window.showToast).not.toHaveBeenCalled();
    S.applyTo({ url: 'https://check.torproject.org/' });
    await settle();
    expect(window.showToast).toHaveBeenCalledWith('Site rules don’t apply in private windows — this page opens privately, not through Tor');
    S.applyTo({ url: 'https://p.example/' });
    await settle();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.vex.siteRoutesRoutedHosts).toHaveBeenCalledTimes(1);
  });

  it('a proxy rule is named as a proxy; a failed ask is logged and asked again', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.vex.siteRoutesRoutedHosts.mockRejectedValueOnce(new Error('main window closed'));
    S.applyTo({ url: 'https://p.example/' });
    await settle();
    expect(err).toHaveBeenCalled();
    S.applyTo({ url: 'https://p.example/' });
    await settle();
    expect(window.showToast).toHaveBeenCalledWith('Site rules don’t apply in private windows — this page opens privately, not through your proxy');
    err.mockRestore();
  });

  it('a normal window never asks', async () => {
    window.VexTabPolicy = { isPrivateWindow: false };
    S.applyTo({ url: 'https://check.torproject.org/' });
    await settle();
    expect(window.vex.siteRoutesRoutedHosts).not.toHaveBeenCalled();
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('the Site rules screen says it', () => {
    window.VexIcons = { svg: () => '<svg></svg>' };
    const m = S.open();
    expect(m.querySelector('.vexsr-note').textContent).toContain('Rules don’t apply in private windows');
  });
});

describe('what a tab\'s page is told it may ask', () => {
  it('is asked of main for that page, not persist:main\'s list', async () => {
    vi.resetModules();
    const W = (await import('../../src/renderer/js/webview.js')).WebviewManager;
    window.SiteRulesUI = undefined;
    window.vex = { permissionsList: vi.fn(async () => ({ 'https://maps.example::geolocation': 'allow' })), permissionsListForPage: vi.fn(async () => ({ 'https://maps.example::geolocation': 'deny' })) };
    const wv = { getURL: () => 'https://maps.example/', getWebContentsId: () => 42, executeJavaScript: vi.fn(async () => true) };
    expect(await W._letSitesAsk(wv)).toBe(true);
    expect(window.vex.permissionsListForPage).toHaveBeenCalledWith(42);
    expect(window.vex.permissionsList).not.toHaveBeenCalled();
    expect(wv.executeJavaScript.mock.calls[0][0]).toContain('"geolocation":"denied"');
  });
});

describe('closing a tab tells main', () => {
  it('names the tab\'s page and the one it was still to be built from', async () => {
    document.body.innerHTML = '<input id="url-input"><div id="tabs-list"></div>';
    const webviews = new Map();
    globalThis.WebviewManager = { webviews, destroyWebview: vi.fn((id) => webviews.delete(id)), createWebview: vi.fn(), showWebview: vi.fn() };
    globalThis.VexStorage = { saveTabs: vi.fn(async () => true), saveGroups: vi.fn(async () => true), saveStacks: vi.fn(async () => true) };
    globalThis.SidebarManager = { hideActivePanel: vi.fn() };
    window.vex = { tabClosed: vi.fn(), getStartPageUrl: () => new Promise(() => {}) };
    delete window.VexTabPolicy;
    vi.resetModules();
    await import('../../src/renderer/js/vex-utils.js');
    const TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
    TM.tabs = [{ id: 'a', url: 'https://a.example/', _historyFrom: 31 }, { id: 'b', url: 'https://b.example/' }, { id: 'c', url: 'https://c.example/' }];
    TM.groups = []; TM.stacks = []; TM.activeTabId = 'b';
    TM.persistTabs = vi.fn();
    webviews.set('a', { getWebContentsId: () => 30 });
    webviews.set('b', { getWebContentsId: () => { throw new Error('not attached'); } });
    TM.closeTab('a');
    expect(window.vex.tabClosed).toHaveBeenCalledWith([30, 31]);
    window.vex.tabClosed.mockClear();
    TM.closeTab('b');                 // never attached, nothing waiting: nothing to say
    expect(window.vex.tabClosed).not.toHaveBeenCalled();
    delete globalThis.WebviewManager;
  });
});
