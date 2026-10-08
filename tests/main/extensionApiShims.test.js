// The chrome.* stand-ins Vex gives extensions (2026-09-27/28). Electron has no
// chrome.permissions, browserAction or contextMenus, and every
// chrome.storage.sync call fails. Dark Reader crashed on the first three while
// starting and left every site under its crude fallback coat; uBlock stopped
// at contextMenus; Return YouTube Dislike's service worker could not record a
// vote. Pages get them from preload-webview.js, service workers get the sync
// one from preload-extension-sw.js.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { createExtensionUi } = createRequire(import.meta.url)('../../src/main/extension-ui.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A Windows checkout may turn one file's line endings into CRLF and not the
// other's (git treats preload-webview.js as binary), so compare them as LF.
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/' + f), 'utf8').replace(/\r\n/g, '\n');
const PAGE_SRC = read('preload-webview.js');
const SW_SRC = read('preload-extension-sw.js');
const START = PAGE_SRC.indexOf('// === BEGIN vex-extension-stand-ins ===');
const END = PAGE_SRC.indexOf("(function () {\n  'use strict';\n  var ipcRenderer;");
const PAGE_SHIMS = PAGE_SRC.slice(START, END);
const KEY = '__vexStorageSync';
const tick = () => new Promise(r => setTimeout(r, 5));
const END_MARK = '// === END vex-storage-sync-shim ===';
const block = (src) => src.slice(src.indexOf('// === BEGIN vex-storage-sync-shim ==='), src.indexOf(END_MARK) + END_MARK.length);

// One extension's storage.local, shared by all its contexts (worker, pages),
// with onChanged fired in every one of them, the way Chrome does it.
function extension() {
  const data = {};
  const buses = [];
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const fire = (changes) => setTimeout(() => buses.forEach(bus => bus.slice().forEach(fn => fn(copy(changes), 'local'))), 0);
  function chrome({ manifest = {}, runtimeId = 'ext-id', extra = {} } = {}) {
    const bus = [];
    buses.push(bus);
    const local = {
      get(keys, cb) {
        const out = {};
        const want = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        for (const k of want) if (k in data) out[k] = copy(data[k]);
        setTimeout(() => cb(out), 0);
      },
      set(items, cb) {
        const ch = {};
        for (const [k, v] of Object.entries(items)) { ch[k] = { newValue: copy(v) }; if (k in data) ch[k].oldValue = copy(data[k]); data[k] = copy(v); }
        fire(ch);
        setTimeout(() => cb && cb(), 0);
      },
      clear(cb) {
        const ch = {};
        for (const k of Object.keys(data)) { ch[k] = { oldValue: data[k] }; delete data[k]; }
        fire(ch);
        setTimeout(() => cb && cb(), 0);
      },
    };
    return {
      runtime: { id: runtimeId, getManifest: () => manifest },
      storage: { local, sync: { native: true }, onChanged: { addListener: fn => bus.push(fn), removeListener: fn => { const i = bus.indexOf(fn); if (i >= 0) bus.splice(i, 1); } } },
      tabs: {}, alarms: {},
      ...extra,
    };
  }
  return { data, chrome };
}

function localStore(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) };
}

// An extension page: the page preload's shims, as it runs them.
function page(chrome, { protocol = 'chrome-extension:', localStorage = localStore(), ipcRenderer = null } = {}) {
  const require = (m) => { if (m !== 'electron' || !ipcRenderer) throw new Error('no ' + m); return { ipcRenderer }; };
  const ctx = vm.createContext({ window: { chrome, localStorage }, location: { protocol }, require, setTimeout, Promise, JSON, Object, Array, String, console });
  vm.runInContext(PAGE_SHIMS, ctx);
  return chrome;
}

// An extension service worker: the worker preload, with executeInMainWorld
// running the function in the worker's own world.
function worker(chrome, { ipcRenderer = null } = {}) {
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, console,
    require: (m) => { if (m !== 'electron') throw new Error('only electron'); return { ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } }; } });
  vm.runInContext(SW_SRC, ctx);
  return chrome;
}

// Main's side of extensions:api (main.js _extApi) for one extension, on the
// real keeper of menu items and badges (src/main/extension-ui.js), and its
// events back (extensions:event). A failure comes back the way Electron
// wraps one.
function fakeMain({ commands = [] } = {}) {
  const ui = createExtensionUi();
  const asked = [];
  const listeners = [];
  const answer = (req) => {
    const a = req.args || {};
    switch (req.op) {
      case 'menus.create': return ui.menusCreate('persist:main', 'ext', a.props);
      case 'menus.update': return ui.menusUpdate('persist:main', 'ext', a.id, a.props);
      case 'menus.remove': return ui.menusRemove('persist:main', 'ext', a.id);
      case 'menus.removeAll': return ui.menusRemoveAll('persist:main', 'ext');
      case 'action.set': return ui.actionSet('persist:main', 'ext', a.prop, a.value, a.tabId == null ? null : a.tabId);
      case 'action.get': return ui.actionGet('persist:main', 'ext', a.prop, a.tabId == null ? null : a.tabId, { title: 'Own title' });
      case 'commands.getAll': return commands;
      default: throw new Error('Vex does not know ' + req.op);
    }
  };
  const ipcRenderer = {
    invoke: (ch, req) => {
      asked.push([ch, req]);
      if (ch !== 'extensions:api') return Promise.resolve(null);
      try { return Promise.resolve(answer(req)); }
      catch (err) { return Promise.reject(new Error(`Error invoking remote method 'extensions:api': Error: ${err.message}`)); }
    },
    on: (ch, fn) => { if (ch === 'extensions:event') listeners.push(fn); },
  };
  return { ui, asked, ipcRenderer, listeners, emit: (msg) => listeners.forEach(fn => fn({}, msg)) };
}

const STAND_INS_END = '// === END vex-extension-stand-ins ===';
const standIns = (src) => src.slice(src.indexOf('// === BEGIN vex-extension-stand-ins ==='), src.indexOf(STAND_INS_END) + STAND_INS_END.length);

describe('the sync stand-in is one function in two places', () => {
  it('the page preload and the worker preload carry the same copy', () => {
    expect(block(PAGE_SRC).length).toBeGreaterThan(1000);
    expect(block(SW_SRC)).toBe(block(PAGE_SRC));
  });

  it('and so do the other stand-ins', () => {
    expect(standIns(PAGE_SRC).length).toBeGreaterThan(1000);
    expect(standIns(SW_SRC)).toBe(standIns(PAGE_SRC));
  });
});

// A popup, an options page and a service worker never got the stand-ins: they
// were put into the preload's own world, which only a background page shares.
// Stylus's and Violentmonkey's workers died on start while Vex showed them
// "On", and Stylus's popup drew nothing (2026-09-29).
describe('every extension context gets the stand-ins', () => {
  it("a service worker: Stylus's permissions.contains and Violentmonkey's isAllowedIncognitoAccess", async () => {
    const sw = worker(extension().chrome({ manifest: { permissions: ['storage', 'tabs'] } }), { ipcRenderer: fakeMain().ipcRenderer });
    expect(await sw.permissions.contains({ permissions: ['tabs'] })).toBe(true);
    await new Promise((resolve) => sw.extension.isAllowedIncognitoAccess((v) => { expect(v).toBe(false); resolve(); }));
    expect(sw.extension.inIncognitoContext).toBe(false);
    expect(await sw.commands.getAll()).toEqual([]);
  });

  it('an isolated page (a popup, an options page) gets them in its own world', () => {
    const pageChrome = extension().chrome({ manifest: { permissions: ['storage'] }, extra: { tabs: {} } });
    const ran = [];
    const ctx = vm.createContext({
      window: { chrome: {} }, location: { protocol: 'chrome-extension:' }, process: { contextIsolated: true },
      setTimeout, Promise, JSON, Object, Array, String, console,
      require: (m) => { if (m !== 'electron') throw new Error('only electron'); return { ipcRenderer: { invoke: () => Promise.resolve(null) } }; },
    });
    // The preload's own world has an empty chrome; the page's world is pageChrome.
    ctx.__vexCBStub = { executeInMainWorld: ({ func, args = [] }) => { ran.push(func.name); const a = args.slice(); if (a[0] == null) a[0] = pageChrome; return func.apply(null, a); } };
    vm.runInContext(PAGE_SHIMS.replace(/__vexCB\./g, '__vexCBStub.'), ctx);
    expect(ran).toEqual(['vexExtensionStandIns', 'vexStorageSyncShim']);
    expect(typeof pageChrome.permissions.contains).toBe('function');
    expect(pageChrome.storage.__vexSync).toBe(true);
    expect(typeof pageChrome.tabs.getCurrent).toBe('function');
  });

  it('a popup asking for its own tab hears undefined, as in Chrome', async () => {
    const c = page(extension().chrome({ extra: { tabs: {} } }));
    expect(await c.tabs.getCurrent()).toBeUndefined();
  });
});

describe('chrome.storage.sync, kept on this machine', () => {
  it("a worker's write is a page's read, and both hear about it as a sync change", async () => {
    const ext = extension();
    const sw = worker(ext.chrome());
    const pg = page(ext.chrome());
    const heard = [], syncHeard = [];
    pg.storage.onChanged.addListener((ch, area) => heard.push([area, ch]));
    sw.storage.sync.onChanged.addListener((ch) => syncHeard.push(ch));
    await sw.storage.sync.set({ vote: 'dislike', n: 2 });
    expect(await pg.storage.sync.get('vote')).toEqual({ vote: 'dislike' });
    expect(await pg.storage.sync.get({ n: 0, missing: 'default' })).toEqual({ n: 2, missing: 'default' });
    await tick();
    expect(heard).toEqual([['sync', { vote: { newValue: 'dislike' }, n: { newValue: 2 } }]]);
    expect(syncHeard).toEqual([{ vote: { newValue: 'dislike' }, n: { newValue: 2 } }]);
    await pg.storage.sync.remove('n');
    await tick();
    expect(await sw.storage.sync.get(null)).toEqual({ vote: 'dislike' });
    expect(heard[1]).toEqual(['sync', { n: { oldValue: 2 } }]);
    await new Promise(r => sw.storage.sync.get(null, (all) => { expect(all).toEqual({ vote: 'dislike' }); r(); }));
  });

  it('two quick writes both land', async () => {
    const pg = page(extension().chrome());
    pg.storage.sync.set({ a: 1 });
    await pg.storage.sync.set({ b: 2 });
    expect(await pg.storage.sync.get(null)).toEqual({ a: 1, b: 2 });
  });

  it('the reserved entry stays out of the extension’s own local storage', async () => {
    const ext = extension();
    const pg = page(ext.chrome());
    const localHeard = [];
    pg.storage.onChanged.addListener((ch, area) => area === 'local' && localHeard.push(ch));
    await pg.storage.sync.set({ theme: 'dark' });
    await new Promise(r => pg.storage.local.set({ mine: 1 }, r));
    expect(ext.data[KEY]).toEqual({ theme: 'dark' });
    expect(await pg.storage.local.get(null)).toEqual({ mine: 1 });
    await tick();
    expect(localHeard).toEqual([{ mine: { newValue: 1 } }]);
    await pg.storage.local.clear();
    expect(await pg.storage.local.get(null)).toEqual({});
    expect(await pg.storage.sync.get(null)).toEqual({ theme: 'dark' });
  });

  it('settings saved by v2.33.2–2.33.5 in the page are moved over once', async () => {
    const ext = extension();
    const ls = localStore({ 'vex.storage.sync:theme': JSON.stringify({ mode: 1 }), 'vex.storage.sync:kept': '"new"', unrelated: 'x' });
    const sw = worker(ext.chrome());
    await sw.storage.sync.set({ kept: 'already here' });
    const pg = page(ext.chrome(), { localStorage: ls });
    await tick(); await tick();
    expect(await pg.storage.sync.get(null)).toEqual({ theme: { mode: 1 }, kept: 'already here' });
    expect(ls.has('vex.storage.sync:theme')).toBe(false);
    expect(ls.has('unrelated')).toBe(true);
  });

  it("a website's service worker and ordinary pages are left alone", () => {
    const site = worker(extension().chrome({ runtimeId: null }));
    expect(site.storage.sync).toEqual({ native: true });
    const web = page(extension().chrome(), { protocol: 'https:' });
    expect(web.storage.sync).toEqual({ native: true });
  });
});

describe('chrome.permissions, browserAction and contextMenus for extension pages', () => {
  it('chrome.permissions reports what the manifest grants and Vex provides, and grants nothing new', async () => {
    const c = page(extension().chrome({ manifest: { permissions: ['storage', 'tabs', 'contextMenus', 'alarms', 'unlimitedStorage', '<all_urls>'] } }));
    expect(await c.permissions.contains({ permissions: ['tabs', 'alarms'] })).toBe(true);
    expect(await c.permissions.contains({ permissions: ['unlimitedStorage'] })).toBe(true);
    // Granted in the manifest, but only a do-nothing stand-in exists for it.
    expect(await c.permissions.contains({ origins: ['https://example.com/*'] })).toBe(true);
    expect(await c.permissions.request({ permissions: ['history'] })).toBe(false);
    expect(await c.permissions.remove({ permissions: ['tabs'] })).toBe(false);
    // The line Dark Reader crashed on.
    expect(typeof c.permissions.onRemoved.addListener).toBe('function');
    await new Promise((resolve) => c.permissions.contains({ permissions: ['tabs'] }, (v) => { expect(v).toBe(true); resolve(); }));
  });

  it('contextMenus exists only for an extension that asked, and its items reach main', async () => {
    const main = fakeMain();
    const withIt = page(extension().chrome({ manifest: { permissions: ['contextMenus', 'storage'] } }), { ipcRenderer: main.ipcRenderer });
    expect(withIt.contextMenus.create({ id: 'block', title: 'Block element', contexts: ['page', 'link'] })).toBe('block');
    expect(withIt.contextMenus.create({ id: 'sub', parentId: 'block', title: 'Just this one' })).toBe('sub');
    await tick();
    expect(main.ui.snapshot().menus['persist:main'].ext.map(i => [i.id, i.parentId])).toEqual([['block', null], ['sub', 'block']]);
    await withIt.contextMenus.update('block', { title: 'Hide element' });
    expect(main.ui.snapshot().menus['persist:main'].ext[0].title).toBe('Hide element');
    // Main's refusal, in its own words.
    await expect(withIt.contextMenus.update('nope', { title: 'x' })).rejects.toThrow(/^Cannot find menu item with id nope$/);
    expect(await withIt.contextMenus.removeAll()).toBeUndefined();
    expect(main.ui.snapshot().menus).toEqual({});
    expect(withIt.contextMenus.ContextType.SELECTION).toBe('selection');
    expect(page(extension().chrome({ manifest: { permissions: ['storage'] } })).contextMenus).toBeUndefined();
  });

  it('a click reaches onClicked and the item\'s own onclick, with the info and the tab', async () => {
    const main = fakeMain();
    const c = page(extension().chrome({ manifest: { permissions: ['contextMenus'] } }), { ipcRenderer: main.ipcRenderer });
    const heard = [], own = [];
    c.contextMenus.onClicked.addListener((info, tab) => heard.push([info.menuItemId, info.selectionText, tab.id]));
    c.contextMenus.create({ id: 'look', title: 'Look up "%s"', contexts: ['selection'], onclick: (info) => own.push(info.menuItemId) });
    c.contextMenus.create({ id: 'other', title: 'Other' });
    await tick();
    // Functions never cross to main.
    expect(main.asked.find(([, r]) => r && r.op === 'menus.create').at(1).args.props.onclick).toBeUndefined();
    main.emit({ type: 'menus.onClicked', args: [{ menuItemId: 'look', selectionText: 'word' }, { id: 7 }] });
    main.emit({ type: 'menus.onClicked', args: [{ menuItemId: 'other' }, { id: 7 }] });
    expect(heard).toEqual([['look', 'word', 7], ['other', undefined, 7]]);
    expect(own).toEqual(['look']);
    expect(c.contextMenus.onClicked.hasListeners()).toBe(true);
  });

  it('a refused create with a callback is an unchecked lastError: said, and the callback still runs', async () => {
    const main = fakeMain();
    const c = page(extension().chrome({ manifest: { permissions: ['contextMenus'] } }), { ipcRenderer: main.ipcRenderer });
    const said = [];
    const orig = console.error;
    console.error = (m) => said.push(String(m));
    try {
      c.contextMenus.create({ id: 'a', title: 'A' });
      await new Promise((resolve) => c.contextMenus.create({ id: 'a', title: 'A again' }, resolve));
    } finally { console.error = orig; }
    expect(said.join('\n')).toMatch(/Unchecked runtime\.lastError \(contextMenus\.create\): Cannot create item with duplicate id a/);
  });

  it('the toolbar badge and title are kept by main, for every tab or for one', async () => {
    const main = fakeMain();
    const mv2 = page(extension().chrome({ manifest: { name: 'X', browser_action: {} } }), { ipcRenderer: main.ipcRenderer });
    expect(await mv2.browserAction.setBadgeText({ text: '12' })).toBeUndefined();
    await mv2.browserAction.setBadgeText({ text: '3', tabId: 5 });
    expect(await mv2.browserAction.getBadgeText({})).toBe('12');
    expect(await mv2.browserAction.getBadgeText({ tabId: 5 })).toBe('3');
    await mv2.browserAction.setBadgeBackgroundColor({ color: '#00ff00' });
    expect(await mv2.browserAction.getBadgeBackgroundColor({})).toEqual([0, 255, 0, 255]);
    await expect(mv2.browserAction.setBadgeBackgroundColor({ color: 'not-a-colour' })).rejects.toThrow(/not a colour/);
    await new Promise((resolve) => mv2.browserAction.getTitle({}, (t) => { expect(t).toBe('Own title'); resolve(); }));
    expect(mv2.action).toBeUndefined();
    const mv3 = page(extension().chrome({ manifest: { action: {} } }), { ipcRenderer: main.ipcRenderer });
    expect(typeof mv3.action.setIcon).toBe('function');
    expect(mv3.browserAction).toBeUndefined();
    const clicks = [];
    mv3.action.onClicked.addListener((tab) => clicks.push(tab.id));
    main.emit({ type: 'action.onClicked', args: [{ id: 9 }] });
    expect(clicks).toEqual([9]);
  });

  it('a real API is never replaced', () => {
    const real = { contains: () => 'native' };
    expect(page(extension().chrome({ extra: { permissions: real } })).permissions).toBe(real);
  });
});

describe('what Dark Reader needs to fill its popup', () => {
  // Electron 42 gives a service worker a chrome.action of its own that keeps a
  // badge nobody can see, and never fires runtime.onInstalled (2026-10-08).
  it('a service worker\'s own chrome.action is taken over, and main\'s onInstalled reaches its listener', async () => {
    const main = fakeMain();
    const nativeSet = () => Promise.resolve('native');
    const nativeInstalled = [];
    const sw = worker(extension().chrome({
      manifest: { action: {}, permissions: ['contextMenus'] },
      extra: { action: { setBadgeText: nativeSet, setIcon: nativeSet, onClicked: { addListener() {} } },
        runtime: { id: 'ext-id', getManifest: () => ({ action: {}, permissions: ['contextMenus'] }), onInstalled: { addListener: (fn) => nativeInstalled.push(fn), removeListener() {} } } },
    }), { ipcRenderer: main.ipcRenderer });
    await sw.action.setBadgeText({ text: '5' });
    expect(main.ui.actionGet('persist:main', 'ext', 'text', null)).toBe('5');
    expect(sw.action.setIcon).toBe(nativeSet); // what Vex does not draw stays Electron's
    const heard = [];
    sw.runtime.onInstalled.addListener((d) => heard.push(d.reason));
    expect(nativeInstalled.length).toBe(1);
    main.emit({ type: 'runtime.onInstalled', args: [{ reason: 'install' }] });
    expect(heard).toEqual(['install']);
  });

  it('commands lists the shortcuts as main has bound them, onCommand hears them, and file access is allowed', async () => {
    const rows = [{ name: 'addSite', description: 'Toggle current site', shortcut: 'Alt+Shift+A' }, { name: 'toggle', description: '', shortcut: '' }];
    const main = fakeMain({ commands: rows });
    const c = page(extension().chrome({ manifest: { commands: { addSite: { description: 'Toggle current site' }, toggle: {} } } }), { ipcRenderer: main.ipcRenderer });
    expect(await c.commands.getAll()).toEqual(rows);
    const heard = [];
    c.commands.onCommand.addListener((name, tab) => heard.push([name, tab && tab.id]));
    main.emit({ type: 'commands.onCommand', args: ['addSite', { id: 4 }] });
    expect(heard).toEqual([['addSite', 4]]);
    // Dark Reader asks with a callback.
    await new Promise((resolve) => c.extension.isAllowedFileSchemeAccess((v) => { expect(v).toBe(true); resolve(); }));
  });

  it('keeps a real chrome.extension and its other members', () => {
    const extension_ = { getURL: () => 'x' };
    const c = page(extension().chrome({ extra: { extension: extension_ } }));
    expect(c.extension).toBe(extension_);
    expect(c.extension.getURL()).toBe('x');
  });
});

describe('the active tab under a toolbar popup', () => {
  const OWN = 'chrome-extension://ext-id/';
  const popupTab = { id: 6, active: true, url: OWN + 'ui/popup/index.html' };
  const pageTab = { id: 5, active: false, url: 'https://docs.google.com/document/d/1' };
  // front: the pages main says are in front (extensions:active-tabs).
  function setup(over, front = { ids: [5], current: 5 }) {
    const asked = [];
    const tabs = {
      query: (q) => Promise.resolve([popupTab, pageTab].filter(t => q.active == null || t.active === q.active)),
      get: (id) => Promise.resolve([popupTab, pageTab].find(t => t.id === id)),
    };
    const ipcRenderer = { invoke: (ch) => { asked.push(ch); return Promise.resolve(ch === 'extensions:active-tabs' ? front : over); } };
    const c = page(extension().chrome({ extra: { tabs, runtime: { id: 'ext-id', getManifest: () => ({}), getURL: (p) => OWN + p } } }), { ipcRenderer });
    return { c, asked };
  }

  it('answers the tab the popup was opened over, not the popup', async () => {
    const { c, asked } = setup({ popup: 6, tab: 5 });
    const [tab] = await c.tabs.query({ active: true, lastFocusedWindow: true });
    expect(tab.url).toBe(pageTab.url);
    expect(tab.active).toBe(true);
    expect(asked.filter(ch => ch === 'extensions:popup-tab')).toEqual(['extensions:popup-tab']);
    // Dark Reader asks with a callback.
    await new Promise((resolve) => c.tabs.query({ active: true }, (tabs) => { expect(tabs.map(t => t.id)).toEqual([5]); resolve(); }));
  });

  it('a question that is not for the active tab is not taken to the popup', async () => {
    const { c, asked } = setup({ popup: 6, tab: 5 });
    expect((await c.tabs.query({})).map(t => [t.id, t.active])).toEqual([[6, false], [5, true]]);
    expect((await c.tabs.query({ active: false })).map(t => t.id)).toEqual([6]);
    expect(asked).not.toContain('extensions:popup-tab');
  });

  it('with no popup of its own open, the answer is the tab main says is in front', async () => {
    const { c } = setup(null);
    expect((await c.tabs.query({ active: true })).map(t => t.id)).toEqual([5]);
  });

  it('a popup opened with no tab under it is simply left out', async () => {
    const { c } = setup({ popup: 6, tab: null }, { ids: [], current: null });
    expect(await c.tabs.query({ active: true })).toEqual([]);
  });
});
