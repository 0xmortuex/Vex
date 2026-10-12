// The chrome.* stand-ins, as the 2026-09-29 extension sweep left them:
//  * Stylus's popup maps over webNavigation.getAllFrames, and null threw;
//  * Stylus's popup asks its service worker for the active tab, which heard []
//    because only a popup's own pages asked main which tab it was over;
//  * tabs.create does not exist in Electron and runtime.openOptionsPage fails,
//    so a popup's Manage / Options / Report-a-bug buttons did nothing.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/' + f), 'utf8').replace(/\r\n/g, '\n');
const SW_SRC = read('preload-extension-sw.js');
const PAGE_SRC = read('preload-webview.js');
const OWN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

const EXAMPLE = { id: 5, active: false, url: 'https://example.com/' };
function fakeChrome({ manifest = {}, tabs = [EXAMPLE], extraTabs = {} } = {}) {
  return {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', getManifest: () => manifest, getURL: (p) => OWN + p },
    tabs: {
      query: (q) => Promise.resolve(tabs.filter(t => q.active == null || t.active === q.active)),
      get: (id) => { const t = tabs.find(x => x.id === id); return t ? Promise.resolve(t) : Promise.reject(new Error('No tab with id: ' + id)); },
      ...extraTabs,
    },
  };
}

// The service-worker preload, with main's two answers stubbed.
function worker(chrome, { over = null, front = { ids: [], current: null } } = {}) {
  const calls = [];
  // extensions:open-tab answers with the tab main made (sweep fin4, 2026-09-29).
  const ipcRenderer = { invoke: (ch, ...args) => { calls.push([ch, ...args]); return Promise.resolve(ch === 'extensions:popup-tab' ? over : ch === 'extensions:active-tabs' ? front : { id: 5, url: args[0].url, active: args[0].active }); } };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL,
    require: (m) => {
      if (m !== 'electron') throw new Error('only electron');
      return { ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } };
    } });
  vm.runInContext(SW_SRC, ctx);
  return { c: chrome, calls };
}

describe('webNavigation: the top frame is the tab', () => {
  const nav = { permissions: ['webNavigation', 'tabs'] };
  it('getAllFrames answers the tab as frame 0, and getFrame for frame 0 only', async () => {
    const { c } = worker(fakeChrome({ manifest: nav }));
    const frames = await c.webNavigation.getAllFrames({ tabId: 5 });
    expect(frames).toEqual([{ frameId: 0, parentFrameId: -1, processId: -1, url: 'https://example.com/', errorOccurred: false }]);
    expect(frames.map(f => f.url).length).toBe(1);
    expect((await c.webNavigation.getFrame({ tabId: 5, frameId: 0 })).url).toBe('https://example.com/');
    expect(await c.webNavigation.getFrame({ tabId: 5, frameId: 3 })).toBeNull();
  });

  it('a tab that does not exist has no frames, as in Chrome; callbacks work too', async () => {
    const { c } = worker(fakeChrome({ manifest: nav }));
    expect(await c.webNavigation.getAllFrames({ tabId: 99 })).toBeNull();
    await new Promise((resolve) => c.webNavigation.getAllFrames({ tabId: 5 }, (f) => { expect(f[0].frameId).toBe(0); resolve(); }));
  });
});

describe('the active tab, asked by the service worker while the popup is open', () => {
  it('is the tab the popup was opened over, though the worker itself saw none', async () => {
    const { c, calls } = worker(fakeChrome(), { over: { popup: 9, tab: 5 } });
    const tabs = await c.tabs.query({ active: true, currentWindow: true });
    expect(tabs.map(t => [t.id, t.active])).toEqual([[5, true]]);
    expect(calls.filter(c => c[0] === 'extensions:popup-tab')).toEqual([['extensions:popup-tab']]);
  });

  it('with no popup open, Electron’s answer stands', async () => {
    const { c } = worker(fakeChrome(), { over: null });
    expect(await c.tabs.query({ active: true })).toEqual([]);
  });

  it('a question that also filters by address is not rewritten', async () => {
    const { c, calls } = worker(fakeChrome(), { over: { popup: 9, tab: 5 } });
    expect(await c.tabs.query({ active: true, url: 'https://other.example/*' })).toEqual([]);
    expect(calls.filter(c => c[0] === 'extensions:popup-tab')).toEqual([]);
  });

  it('the tab under the popup is not listed twice', async () => {
    const both = [{ id: 5, active: true, url: 'https://example.com/' }, { id: 9, active: true, url: OWN + 'popup.html' }];
    const { c } = worker(fakeChrome({ tabs: both }), { over: { popup: 9, tab: 5 } });
    expect((await c.tabs.query({ active: true })).map(t => t.id)).toEqual([5]);
  });
});

describe('tabs.create and runtime.openOptionsPage open a Vex tab through main', () => {
  it('tabs.create sends the full address; a relative one is the extension’s own page', async () => {
    const { c, calls } = worker(fakeChrome());
    expect(await c.tabs.create({ url: 'https://github.com/x' })).toMatchObject({ id: 5, active: true, pendingUrl: 'https://github.com/x' });
    await c.tabs.create({ url: 'manage.html', active: false });
    expect(calls.filter(c => c[0] === 'extensions:open-tab')).toEqual([
      ['extensions:open-tab', { url: 'https://github.com/x', active: true }],
      ['extensions:open-tab', { url: OWN + 'manage.html', active: false }],
    ]);
    await expect(c.tabs.create({})).rejects.toThrow('only with an address');
  });

  it('a real tabs.create is never replaced', () => {
    const create = () => 'native';
    const { c } = worker(fakeChrome({ extraTabs: { create } }));
    expect(c.tabs.create).toBe(create);
  });

  it('openOptionsPage opens the manifest’s options page, or says there is none', async () => {
    const a = worker(fakeChrome({ manifest: { options_ui: { page: 'options/index.html' } } }));
    await a.c.runtime.openOptionsPage();
    expect(a.calls).toEqual([['extensions:open-tab', { url: OWN + 'options/index.html', active: true }]]);
    const b = worker(fakeChrome({ manifest: { options_page: 'opts.html', options_ui: { page: 'other.html' } } }));
    await new Promise((resolve) => b.c.runtime.openOptionsPage(resolve));
    expect(b.calls[0][1].url).toBe(OWN + 'opts.html');
    await expect(worker(fakeChrome()).c.runtime.openOptionsPage()).rejects.toThrow('no options page');
  });
});

describe('extension pages get the same two channels', () => {
  it('the page preload hands the stand-ins both main calls', () => {
    expect(PAGE_SRC).toContain("ipcRenderer.invoke('extensions:open-tab', request)");
    expect(PAGE_SRC).toContain('args: [null, __vexAskPopupTab, __vexOpenTab, __vexCloseTab, __vexAskActiveTabs, __vexExtApi, __vexOnExtEvent]');
    expect(PAGE_SRC).toContain('vexExtensionStandIns(window.chrome, __vexAskPopupTab, __vexOpenTab, __vexCloseTab, __vexAskActiveTabs, __vexExtApi, __vexOnExtEvent)');
  });
});
