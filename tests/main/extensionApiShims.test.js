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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A Windows checkout may turn one file's line endings into CRLF and not the
// other's (git treats preload-webview.js as binary), so compare them as LF.
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/' + f), 'utf8').replace(/\r\n/g, '\n');
const PAGE_SRC = read('preload-webview.js');
const SW_SRC = read('preload-extension-sw.js');
const START = PAGE_SRC.indexOf('// === chrome.permissions for extensions ===');
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
function worker(chrome) {
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String,
    require: (m) => { if (m !== 'electron') throw new Error('only electron'); return { contextBridge: { executeInMainWorld: ({ func }) => vm.runInContext('(' + func.toString() + ')()', ctx) } }; } });
  vm.runInContext(SW_SRC, ctx);
  return chrome;
}

describe('the sync stand-in is one function in two places', () => {
  it('the page preload and the worker preload carry the same copy', () => {
    expect(block(PAGE_SRC).length).toBeGreaterThan(1000);
    expect(block(SW_SRC)).toBe(block(PAGE_SRC));
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

  it('contextMenus exists only for an extension that asked, and adds nothing', async () => {
    const withIt = page(extension().chrome({ manifest: { permissions: ['contextMenus', 'storage'] } }));
    expect(withIt.contextMenus.create({ id: 'block', title: 'Block element' })).toBe('block');
    expect(await withIt.contextMenus.removeAll()).toBeUndefined();
    expect(typeof withIt.contextMenus.onClicked.addListener).toBe('function');
    expect(page(extension().chrome({ manifest: { permissions: ['storage'] } })).contextMenus).toBeUndefined();
  });

  it('browserAction or action, whichever the manifest declares, accepts calls and changes nothing', async () => {
    const mv2 = page(extension().chrome({ manifest: { name: 'X', browser_action: {} } }));
    expect(await mv2.browserAction.setBadgeText({ text: '1' })).toBeUndefined();
    expect(await mv2.browserAction.getBadgeText({})).toBe('');
    expect(mv2.action).toBeUndefined();
    const mv3 = page(extension().chrome({ manifest: { action: {} } }));
    expect(typeof mv3.action.setIcon).toBe('function');
    expect(mv3.browserAction).toBeUndefined();
  });

  it('a real API is never replaced', () => {
    const real = { contains: () => 'native' };
    expect(page(extension().chrome({ extra: { permissions: real } })).permissions).toBe(real);
  });
});

describe('what Dark Reader needs to fill its popup', () => {
  it('commands lists the manifest shortcuts with no key, and file access is allowed', async () => {
    const c = page(extension().chrome({ manifest: { commands: { addSite: { description: 'Toggle current site' }, toggle: {} } } }));
    expect(await c.commands.getAll()).toEqual([
      { name: 'addSite', description: 'Toggle current site', shortcut: '' },
      { name: 'toggle', description: '', shortcut: '' },
    ]);
    expect(typeof c.commands.onCommand.addListener).toBe('function');
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
  function setup(over) {
    const asked = [];
    const tabs = {
      query: (q) => Promise.resolve([popupTab, pageTab].filter(t => q.active == null || t.active === q.active)),
      get: (id) => Promise.resolve([popupTab, pageTab].find(t => t.id === id)),
    };
    const ipcRenderer = { invoke: (ch) => { asked.push(ch); return Promise.resolve(over); } };
    const c = page(extension().chrome({ extra: { tabs, runtime: { id: 'ext-id', getManifest: () => ({}), getURL: (p) => OWN + p } } }), { ipcRenderer });
    return { c, asked };
  }

  it('answers the tab the popup was opened over, not the popup', async () => {
    const { c, asked } = setup({ popup: 6, tab: 5 });
    const [tab] = await c.tabs.query({ active: true, lastFocusedWindow: true });
    expect(tab.url).toBe(pageTab.url);
    expect(tab.active).toBe(true);
    expect(asked).toEqual(['extensions:popup-tab']);
    // Dark Reader asks with a callback.
    await new Promise((resolve) => c.tabs.query({ active: true }, (tabs) => { expect(tabs.map(t => t.id)).toEqual([5]); resolve(); }));
  });

  it('leaves every other question alone, and does not ask main', async () => {
    const { c, asked } = setup({ popup: 6, tab: 5 });
    expect((await c.tabs.query({})).map(t => t.id)).toEqual([6, 5]);
    expect((await c.tabs.query({ active: false })).map(t => t.id)).toEqual([5]);
    expect(asked).toEqual([]);
  });

  it('with no popup of its own open, the answer is what Electron said', async () => {
    const { c } = setup(null);
    expect((await c.tabs.query({ active: true })).map(t => t.id)).toEqual([6]);
  });

  it('a popup opened with no tab under it is simply left out', async () => {
    const { c } = setup({ popup: 6, tab: null });
    expect(await c.tabs.query({ active: true })).toEqual([]);
  });
});
