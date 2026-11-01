// @vitest-environment node
//
// chrome.webRequest used to tell an extension only about finished requests.
// Wappalyzer, Privacy Badger, Ghostery and the like also listen before a
// request, to its headers and to its errors. Vex now tells them (observing
// only: nothing a listener answers changes a request).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { createExtensionEvents, requestDetails, headerList, filterTakes } = req('../../src/main/extension-events.js');
const { matchPattern } = req('../../src/renderer/js/ext-menu-model.js');
const SW_SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-extension-sw.js'), 'utf8');
const PAGE_SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');

const EVENTS = ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred'];

function worker(manifest, src = SW_SRC) {
  const asked = [];
  const ipcRenderer = { invoke: (ch, r) => { asked.push([ch, r]); return Promise.resolve(null); }, on: () => {} };
  const chrome = {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', getManifest: () => manifest, getURL: (p) => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/' + p },
    tabs: { query: async () => [], get: async () => null },
    webRequest: { onBeforeRequest: { addListener() {} } },
  };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL, console,
    require: () => ({ ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } }) });
  vm.runInContext(src, ctx);
  return { c: chrome, told: () => asked.filter(x => x[1] && x[1].op === 'events.listen').map(x => x[1].args) };
}

describe('the webRequest stand-in', () => {
  it('the extension page carries the very same stand-in (it cannot be run here; the block itself is compared)', () => {
    const block = (s) => s.slice(s.indexOf('// Observing only: a listener is told'), s.indexOf("takeOver(c.webRequest, seen, 'webRequest');"));
    expect(block(PAGE_SRC).length).toBeGreaterThan(200);
    expect(block(PAGE_SRC).replace(/\r\n/g, '\n')).toBe(block(SW_SRC).replace(/\r\n/g, '\n'));
    expect(PAGE_SRC).toContain("addListener: function (fn, filter, spec) {");
  });
  for (const [label, src] of [['service worker', SW_SRC]]) {
    it(`${label}: every observable event exists and tells main its filter and extraInfoSpec`, async () => {
      const w = worker({ permissions: ['webRequest', '<all_urls>'] }, src);
      for (const name of EVENTS) expect(typeof w.c.webRequest[name].addListener).toBe('function');
      w.c.webRequest.onBeforeSendHeaders.addListener(() => {}, { urls: ['<all_urls>'] }, ['requestHeaders', 'blocking']);
      w.c.webRequest.onBeforeRequest.addListener(() => {}, { urls: ['https://a.example/*'] });
      await Promise.resolve();
      expect(w.told()).toEqual([
        { type: 'webRequest.onBeforeSendHeaders#1', filter: { urls: ['<all_urls>'] }, spec: ['requestHeaders', 'blocking'] },
        { type: 'webRequest.onBeforeRequest#2', filter: { urls: ['https://a.example/*'] } },
      ]);
    });
    it(`${label}: without the webRequest permission nothing is taken over`, () => {
      const w = worker({ permissions: ['storage'] }, src);
      expect(w.c.webRequest.onHeadersReceived).toBeUndefined();
    });
  }
});

describe('main: who hears what', () => {
  it('knows the new events, counts listeners and remembers the extraInfoSpec', () => {
    const e = createExtensionEvents();
    expect(e.anyone('webRequest.onBeforeRequest')).toBe(false);
    e.listen('persist:main|aaaa', 'webRequest.onBeforeRequest#1', { urls: ['<all_urls>'] }, ['requestHeaders', 3, 'extraHeaders']);
    e.listen('persist:main|aaaa', 'webRequest.onBeforeRequest#1', { urls: ['<all_urls>'] }, ['requestHeaders']);   // same listener again: counted once
    expect(e.anyone('webRequest.onBeforeRequest')).toBe(true);
    expect(e.anyone('webRequest.onSendHeaders')).toBe(false);
    expect(e.listeners('persist:main', 'webRequest.onBeforeRequest')).toEqual([
      { extId: 'aaaa', type: 'webRequest.onBeforeRequest#1', filter: { urls: ['<all_urls>'] }, spec: ['requestHeaders'] }]);
    e.forget('persist:main|aaaa');
    expect(e.anyone('webRequest.onBeforeRequest')).toBe(false);
    expect(() => e.listen('persist:main|aaaa', 'webRequest.onAuthRequired#1', {})).toThrow(/cannot tell/);
  });

  it('gives headers only to a listener that asked, and cookies only with extraHeaders', () => {
    const d = { id: 3, url: 'https://a.example/', method: 'GET', webContentsId: 7, resourceType: 'mainFrame', timestamp: 5,
      requestHeaders: { Accept: '*/*', Cookie: 'sid=1' }, responseHeaders: { 'content-type': ['text/html'], 'set-cookie': ['a=1', 'b=2'] } };
    expect(requestDetails(d)).not.toHaveProperty('requestHeaders');
    expect(requestDetails(d, [])).not.toHaveProperty('responseHeaders');
    expect(requestDetails(d, ['requestHeaders']).requestHeaders).toEqual([{ name: 'Accept', value: '*/*' }]);
    expect(requestDetails(d, ['requestHeaders', 'extraHeaders']).requestHeaders).toEqual([{ name: 'Accept', value: '*/*' }, { name: 'Cookie', value: 'sid=1' }]);
    expect(requestDetails(d, ['responseHeaders']).responseHeaders).toEqual([{ name: 'content-type', value: 'text/html' }]);
    expect(requestDetails(d, ['responseHeaders', 'extraHeaders']).responseHeaders.map(h => h.value)).toEqual(['text/html', 'a=1', 'b=2']);
    expect(headerList(null, true)).toEqual([]);
  });

  it('a redirect says where to, and the filter still applies', () => {
    const d = { id: 4, url: 'http://a.example/', redirectURL: 'https://a.example/', method: 'GET', webContentsId: 7, resourceType: 'script', timestamp: 1 };
    expect(requestDetails(d).redirectUrl).toBe('https://a.example/');
    expect(filterTakes({ urls: ['http://a.example/*'], types: ['script'] }, d, matchPattern)).toBe(true);
    expect(filterTakes({ urls: ['http://a.example/*'], types: ['image'] }, d, matchPattern)).toBe(false);
  });
});

describe('main.js wiring', () => {
  it('tells listeners from the one listener each event has, and never lets one change a request', () => {
    expect(MAIN).toMatch(/if \(!\(answer && answer\.cancel\)\) _extRequestSeen\(ses, 'onBeforeRequest', details\);\n\s+callback\(answer\);/);
    expect(MAIN).toMatch(/_extRequestSeen\(ses, 'onBeforeSendHeaders', sent\);/);
    expect(MAIN).toMatch(/_extRequestSeen\(ses, 'onSendHeaders', sent\);/);
    expect(MAIN).toMatch(/ses\.webRequest\.onResponseStarted\(/);
    expect(MAIN).toMatch(/_extRequestSeen\(ses, 'onHeadersReceived', details\);/);
    expect(MAIN).toMatch(/ses\.webRequest\.onBeforeRedirect\(/);
    expect(MAIN).toMatch(/_extRequestSeen\(ses, 'onErrorOccurred', details\);/);
    // The permission, the host permission and the filter are all checked before an extension is told.
    const body = MAIN.slice(MAIN.indexOf('function _extRequestSeen'), MAIN.indexOf('function _extRequestSeen') + 700);
    expect(body).toMatch(/perms\.includes\('webRequest'\) \|\| !_extHostAllowed\(ext, details\.url\)/);
    expect(body).toMatch(/filterTakes\(l\.filter, details/);
    expect(body).toMatch(/requestDetails\(details, l\.spec\)/);
  });
  it('registers each of those webRequest events only once in the whole app', () => {
    for (const ev of ['onResponseStarted', 'onBeforeRedirect', 'onSendHeaders']) {
      expect((MAIN.match(new RegExp('webRequest\\.' + ev + '\\(', 'g')) || []).length).toBeLessThanOrEqual(1);
    }
  });
});
