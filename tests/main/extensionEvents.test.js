// @vitest-environment node
//
// Electron fired none of chrome.tabs.onUpdated, onActivated, onCreated,
// onRemoved or webRequest.onCompleted for an extension (found 2026-10-10).
// The stand-ins tell main what an extension listens to; main tells it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { createExtensionEvents, filterTakes, requestDetails } = req('../../src/main/extension-events.js');
const { matchPattern } = req('../../src/renderer/js/ext-menu-model.js');
const SW_SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-extension-sw.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const TABS = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/tabs.js'), 'utf8').replace(/\r\n/g, '\n');

function worker(manifest) {
  const asked = []; const listeners = [];
  const ipcRenderer = {
    invoke: (ch, r) => { asked.push([ch, r]); return Promise.resolve(null); },
    on: (ch, fn) => { if (ch === 'extensions:event') listeners.push(fn); },
  };
  const chrome = {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', getManifest: () => manifest, getURL: (p) => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/' + p },
    tabs: { query: async () => [], get: async () => null, onUpdated: { addListener() {} }, onActivated: { addListener() {} } },
    webRequest: { onCompleted: { addListener() {} } },
  };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL, console,
    require: () => ({ ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } }) });
  vm.runInContext(SW_SRC, ctx);
  return { c: chrome, asked, emit: (msg) => listeners.forEach(fn => fn({}, msg)) };
}

describe('the stand-ins', () => {
  it('a tabs listener tells main, and hears what main sends', async () => {
    const w = worker({ permissions: ['tabs'] });
    const heard = [];
    w.c.tabs.onUpdated.addListener((id, change) => heard.push([id, change]));
    w.c.tabs.onActivated.addListener((info) => heard.push(info));
    await Promise.resolve();
    expect(w.asked.filter(a => a[1] && a[1].op === 'events.listen').map(a => a[1].args.type)).toEqual(['tabs.onUpdated', 'tabs.onActivated']);
    w.emit({ type: 'tabs.onUpdated', args: [4, { status: 'complete' }, { id: 4 }] });
    w.emit({ type: 'tabs.onActivated', args: [{ tabId: 4, windowId: 1 }] });
    expect(heard).toEqual([[4, { status: 'complete' }], { tabId: 4, windowId: 1 }]);
  });
  it('each webRequest listener is its own event, with its filter', async () => {
    const w = worker({ permissions: ['webRequest'] });
    const a = [], b = [];
    w.c.webRequest.onCompleted.addListener((d) => a.push(d.url), { urls: ['https://a.example/*'] });
    w.c.webRequest.onCompleted.addListener((d) => b.push(d.url), { urls: ['<all_urls>'] });
    await Promise.resolve();
    const told = w.asked.filter(x => x[1] && x[1].op === 'events.listen').map(x => x[1].args);
    expect(told).toEqual([{ type: 'webRequest.onCompleted#1', filter: { urls: ['https://a.example/*'] } }, { type: 'webRequest.onCompleted#2', filter: { urls: ['<all_urls>'] } }]);
    w.emit({ type: 'webRequest.onCompleted#2', args: [{ url: 'https://b.example/' }] });
    expect([a, b]).toEqual([[], ['https://b.example/']]);
  });
});

describe('main', () => {
  it('tells only the extensions listening in that session', () => {
    const e = createExtensionEvents();
    e.listen('persist:main|aaaa', 'tabs.onUpdated');
    e.listen('persist:container-work|bbbb', 'tabs.onUpdated');
    e.listen('persist:main|cccc', 'webRequest.onCompleted#3', { urls: ['<all_urls>'] });
    expect(e.listeners('persist:main', 'tabs.onUpdated')).toEqual([{ extId: 'aaaa', type: 'tabs.onUpdated', filter: null }]);
    expect(e.listeners('persist:main', 'webRequest.onCompleted')).toEqual([{ extId: 'cccc', type: 'webRequest.onCompleted#3', filter: { urls: ['<all_urls>'] } }]);
    expect(() => e.listen('persist:main|aaaa', 'history.onVisited')).toThrow(/cannot tell/);
  });
  it('a request filter is checked as Chrome does', () => {
    const d = { id: 9, url: 'https://a.example/x.js', method: 'GET', webContentsId: 4, resourceType: 'script', timestamp: 1, statusCode: 200 };
    expect(filterTakes({ urls: ['https://a.example/*'] }, d, matchPattern)).toBe(true);
    expect(filterTakes({ urls: ['https://a.example/*'], types: ['image'] }, d, matchPattern)).toBe(false);
    expect(filterTakes({ urls: ['https://b.example/*'] }, d, matchPattern)).toBe(false);
    expect(filterTakes({ urls: ['<all_urls>'], tabId: 5 }, d, matchPattern)).toBe(false);
    expect(requestDetails(d)).toMatchObject({ requestId: '9', url: d.url, tabId: 4, type: 'script', statusCode: 200, frameId: -1 });
  });
  it('fires tab events from the page, the tab in front from the window, and requests from onCompleted', () => {
    expect(MAIN).toMatch(/contents\.on\('did-stop-loading', \(\) => updated\(\{ status: 'complete' \}\)\)/);
    expect(MAIN).toMatch(/_extEmit\(page\.session, 'tabs\.onActivated'/);
    expect(MAIN).toMatch(/_extRequestCompleted\(ses, details\);/);
    expect(MAIN).toMatch(/if \(!perms\.includes\('webRequest'\) \|\| !_extHostAllowed\(ext, details\.url\)\) return null;/);
    expect(TABS).toMatch(/window\.vex\.tabActivated\(page\)/);
  });
});
