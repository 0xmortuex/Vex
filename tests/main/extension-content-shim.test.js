// @vitest-environment node
//
// Material Icons for GitHub did nothing in Vex (found 2026-10-04):
//  * its content script read its settings with chrome.storage.sync, which
//    Electron fails everywhere, and Vex's stand-in for it reached extension
//    pages and service workers but never a content script: the page said
//    data-material-icons-extension-status="error" and no icon changed;
//  * its toolbar popup read the tab under it with tabs.query, which Vex
//    answers with tabs.get, and Electron's tabs.get leaves out the address of
//    a tab an extension has neither "tabs" nor a host permission for. Chrome
//    grants an "activeTab" extension that tab when its button is clicked. The
//    popup failed on new URL('') and said "Not Supported" on GitHub.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ext = createRequire(import.meta.url)('../../src/main/extensions.js');
const read = (f) => fs.readFileSync(path.resolve('src', f), 'utf8').replace(/\r\n/g, '\n');
const SW_SRC = read('preload-extension-sw.js');
const PAGE_SRC = read('preload-webview.js');
const MAIN = read('main.js');
const between = (from, to) => MAIN.slice(MAIN.indexOf(from), MAIN.indexOf(to, MAIN.indexOf(from)));
const tick = () => new Promise(r => setTimeout(r, 10));

describe('which content scripts get the storage.sync shim', () => {
  const SHIM = ext.CONTENT_SHIM_FILE;

  it('is listed first in an entry that runs scripts in the extension’s own world', () => {
    const m = { permissions: ['storage', 'activeTab'], content_scripts: [{ matches: ['*://github.com/*'], js: ['./main.js'], css: ['a.css'], run_at: 'document_start' }] };
    const plan = ext.withContentShim(m);
    expect(plan.uses).toBe(true);
    expect(plan.manifest.content_scripts).toEqual([{ matches: ['*://github.com/*'], js: [SHIM, './main.js'], css: ['a.css'], run_at: 'document_start' }]);
    // The manifest given is not changed in place.
    expect(m.content_scripts[0].js).toEqual(['./main.js']);
  });

  it('leaves the page’s own world, css-only entries and extensions that keep no storage alone', () => {
    const m = { permissions: ['storage'], content_scripts: [
      { matches: ['<all_urls>'], js: ['inject/proxy.js'], world: 'MAIN' },
      { matches: ['<all_urls>'], css: ['only.css'] },
      { matches: ['<all_urls>'], js: ['inject/index.js'] },
    ] };
    const out = ext.withContentShim(m).manifest.content_scripts;
    expect(out[0]).toBe(m.content_scripts[0]);
    expect(out[1]).toBe(m.content_scripts[1]);
    expect(out[2].js).toEqual([SHIM, 'inject/index.js']);
    expect(ext.withContentShim({ permissions: ['tabs'], content_scripts: [{ js: ['a.js'] }] })).toEqual({ uses: false, manifest: null });
    expect(ext.withContentShim({ permissions: ['storage'] })).toEqual({ uses: false, manifest: null });
    expect(ext.withContentShim({ permissions: ['storage'], content_scripts: [{ js: ['a.js'], world: 'MAIN' }] })).toEqual({ uses: false, manifest: null });
  });

  it('is not added twice, and is moved to the front if something put it later', () => {
    expect(ext.withContentShim({ permissions: ['storage'], content_scripts: [{ js: [SHIM, 'a.js'] }] })).toEqual({ uses: true, manifest: null });
    expect(ext.withContentShim({ permissions: ['storage'], content_scripts: [{ js: ['a.js', './' + SHIM] }] }).manifest.content_scripts[0].js).toEqual([SHIM, 'a.js']);
  });
});

describe('the shim file', () => {
  it('is the preloads’ own vexStorageSyncShim, then a call to it', () => {
    const src = ext.contentShimSource(SW_SRC);
    expect(src).toBe(ext.contentShimSource(PAGE_SRC));
    expect(src).toContain('function vexStorageSyncShim(c)');
    expect(src.trim().split('\n').pop()).toBe("vexStorageSyncShim(typeof chrome !== 'undefined' ? chrome : null);");
    expect(() => vm.runInNewContext(src, {})).not.toThrow(); // no chrome: a no-op
    expect(() => ext.contentShimSource('no block here')).toThrow(/vex-storage-sync-shim/);
  });

  // Two worlds of one extension sharing storage.local, as Chrome does.
  function storageArea() {
    const data = {}, buses = [];
    const copy = (v) => JSON.parse(JSON.stringify(v));
    const world = () => {
      const bus = [];
      buses.push(bus);
      return {
        runtime: { id: 'bggfcpfjbdkhfhfmkjpbhnkhnpjjeomc', getManifest: () => ({}) },
        storage: {
          local: {
            get(keys, cb) { const want = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys); const out = {}; for (const k of want) if (k in data) out[k] = copy(data[k]); setTimeout(() => cb(out), 0); },
            set(items, cb) { const ch = {}; for (const [k, v] of Object.entries(items)) { ch[k] = { newValue: copy(v) }; if (k in data) ch[k].oldValue = copy(data[k]); data[k] = copy(v); } setTimeout(() => buses.forEach(b => b.slice().forEach(fn => fn(copy(ch), 'local'))), 0); setTimeout(() => cb && cb(), 0); },
          },
          // Electron's: every call fails.
          sync: { get: () => Promise.reject(new Error('"sync" is not available in this instance of Chrome')) },
          onChanged: { addListener: fn => bus.push(fn), removeListener: fn => { const i = bus.indexOf(fn); if (i >= 0) bus.splice(i, 1); } },
        },
      };
    };
    return { data, world };
  }

  it('gives a content script the sync its popup writes, and tells it of changes as "sync"', async () => {
    const src = ext.contentShimSource(SW_SRC);
    const area = storageArea();
    const popup = area.world();
    const content = area.world();
    vm.runInNewContext(src, { chrome: popup, setTimeout, Promise, JSON, Object, Array, String });
    vm.runInNewContext(src, { chrome: content, setTimeout, Promise, JSON, Object, Array, String });
    const heard = [];
    content.storage.onChanged.addListener((changes, areaName) => heard.push([areaName, changes]));
    await popup.storage.sync.set({ 'github.com:iconSize': 'lg' });
    expect(await content.storage.sync.get({ 'github.com:iconSize': null, 'default:iconSize': 'md' })).toEqual({ 'github.com:iconSize': 'lg', 'default:iconSize': 'md' });
    await tick();
    expect(heard).toEqual([['sync', { 'github.com:iconSize': { newValue: 'lg' } }]]);
    // The reserved entry stays out of the content script's own local reads.
    expect(await new Promise(r => content.storage.local.get(null, r))).toEqual({});
  });
});

// The service-worker preload with main's answers stubbed (the page preload
// carries the same block; a test holds them identical).
function worker(tabs, { over = null, front = { ids: [5], current: 5 } } = {}) {
  const chrome = { runtime: { id: 'bggfcpfjbdkhfhfmkjpbhnkhnpjjeomc', getManifest: () => ({ permissions: ['activeTab', 'storage'] }), getURL: (p) => 'chrome-extension://bggfcpfjbdkhfhfmkjpbhnkhnpjjeomc/' + p }, tabs };
  const ipcRenderer = { invoke: (ch) => Promise.resolve(ch === 'extensions:popup-tab' ? over : ch === 'extensions:active-tabs' ? front : null) };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL,
    require: (m) => {
      if (m !== 'electron') throw new Error('only electron');
      return { ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } };
    } });
  vm.runInContext(SW_SRC, ctx);
  return chrome;
}

describe('the tab under the popup, for an extension with "activeTab"', () => {
  // What Electron's tabs.get answers without "tabs" or a host permission.
  const scrubbed = { id: 5, active: false, index: 0, windowId: 0 };
  const other = { id: 7, active: false, index: 1, windowId: 0 };
  const electronTabs = () => ({
    query: () => Promise.resolve([scrubbed, other]),
    get: (id, cb) => {
      const t = [scrubbed, other].find(x => x.id === id);
      if (typeof cb === 'function') { setTimeout(() => cb(t), 0); return undefined; }
      return t ? Promise.resolve(t) : Promise.reject(new Error('No tab with id: ' + id));
    },
  });
  const grant = { popup: 9, tab: 5, url: 'https://github.com/0xmortuex/Vex', title: 'GitHub - 0xmortuex/Vex', favIconUrl: 'https://github.githubassets.com/favicons/favicon.svg' };

  it('carries its address, title and icon, as Chrome’s grant does', async () => {
    const c = worker(electronTabs(), { over: grant });
    const [tab] = await c.tabs.query({ active: true, currentWindow: true });
    expect(tab).toMatchObject({ id: 5, active: true, url: grant.url, title: grant.title, favIconUrl: grant.favIconUrl });
    expect(new URL(tab.url).host).toBe('github.com');
    expect(await c.tabs.get(5)).toMatchObject({ url: grant.url, title: grant.title });
    await new Promise((resolve) => c.tabs.get(5, (t) => { expect(t.url).toBe(grant.url); resolve(); }));
  });

  it('only that tab, and nothing Electron already said is replaced', async () => {
    const c = worker(electronTabs(), { over: grant });
    expect((await c.tabs.get(7)).url).toBeUndefined();
    const own = worker({ query: () => Promise.resolve([{ ...scrubbed, url: 'https://github.com/x' }]), get: () => Promise.resolve({ ...scrubbed, url: 'https://github.com/x' }) }, { over: grant });
    expect((await own.tabs.get(5)).url).toBe('https://github.com/x');
  });

  it('with no grant (no "activeTab", or no popup open) Electron’s answer stands', async () => {
    const c = worker(electronTabs(), { over: { popup: 9, tab: 5 } });
    expect((await c.tabs.query({ active: true, currentWindow: true }))[0].url).toBeUndefined();
    const none = worker(electronTabs(), { over: null });
    expect((await none.tabs.get(5)).url).toBeUndefined();
  });
});

describe('main.js', () => {
  it('writes the shim into an extension before loading it into any session', () => {
    const load = between('async function _loadExtensionEverywhere', '\n}\n');
    expect(load.indexOf('_prepareContentShim(extPath)')).toBeGreaterThan(0);
    expect(load.indexOf('_prepareContentShim(extPath)')).toBeLessThan(load.indexOf('loadExtension(extPath'));
    const prep = between('function _prepareContentShim', '\n}\n');
    expect(prep).toMatch(/extHelpers\.withContentShim\(manifest\)/);
    expect(prep).toMatch(/contentShimSource\(fs\.readFileSync\(path\.join\(__dirname, 'preload-extension-sw\.js'\)/);
  });

  it('grants the tab under the popup only to an "activeTab" extension, and only while it stays on that site', () => {
    const open = between("ipcMain.handle('extensions:open-popup'", '\n});\n');
    expect(open).toMatch(/permissions\.includes\('activeTab'\)/);
    expect(open).toMatch(/grant: activeTab && under != null \? _originOf\(tabUnder\.getURL\(\)\) : null/);
    const ask = between('async function _popupTabFor', '\n}\n');
    expect(ask).toMatch(/_originOf\(page\.getURL\(\)\) !== over\.grant\) return answer/);
    expect(ask.indexOf("startsWith(`chrome-extension://${over.extId}/`)")).toBeLessThan(ask.indexOf('answer.url'));
  });
});
