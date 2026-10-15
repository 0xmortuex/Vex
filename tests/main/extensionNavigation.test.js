// @vitest-environment node
//
// chrome.webNavigation and chrome.cookies.onChanged never fired for an
// extension (audit D7). Main now tells them from the page's navigation events
// and the session's cookie jar; these tests pin the payload shapes, the url
// filter, the permission gating and that no private page is ever announced.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const ev = req('../../src/main/extension-events.js');
const { toChrome, allowsHost } = req('../../src/main/extension-cookies.js');
const { matchPattern } = req('../../src/renderer/js/ext-menu-model.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main.js');

describe('urlFilterTakes (Chrome UrlFilter)', () => {
  const U = 'https://www.example.com:8443/a/b.html?x=1&y=2#frag';
  it('no filter takes everything; any filter of the list may take it', () => {
    expect(ev.urlFilterTakes(undefined, U)).toBe(true);
    expect(ev.urlFilterTakes({ url: [] }, U)).toBe(true);
    expect(ev.urlFilterTakes({ url: [{ hostEquals: 'nope.test' }, { hostSuffix: '.example.com' }] }, U)).toBe(true);
    expect(ev.urlFilterTakes({ url: [{ hostEquals: 'nope.test' }] }, U)).toBe(false);
  });
  it('all conditions of one filter must hold', () => {
    expect(ev.urlFilterTakes({ url: [{ hostContains: 'example', pathPrefix: '/a/', schemes: ['https'], ports: [[8000, 9000]] }] }, U)).toBe(true);
    expect(ev.urlFilterTakes({ url: [{ hostContains: 'example', schemes: ['http'] }] }, U)).toBe(false);
    expect(ev.urlFilterTakes({ url: [{ queryContains: 'y=2', pathSuffix: '.html' }] }, U)).toBe(true);
    expect(ev.urlFilterTakes({ url: [{ urlMatches: '^https://www\\.example\\.com' }] }, U)).toBe(true);
    expect(ev.urlFilterTakes({ url: [{ originAndPathMatches: '^https://www\\.example\\.com:8443/a/' }] }, U)).toBe(true);
    expect(ev.urlFilterTakes({ url: [{ ports: [443] }] }, 'https://a.test/')).toBe(true);
  });
});

describe('navigation payloads', () => {
  const top = { frameTreeNodeId: 1, parent: null, processId: 7 };
  const sub = { frameTreeNodeId: 9, parent: top, processId: 7 };
  const deep = { frameTreeNodeId: 12, parent: sub, processId: 7 };
  it('the top frame is 0 with parent -1; a child of the top has parent 0; deeper ones name their parent', () => {
    expect(ev.frameIds(top, true)).toEqual({ frameId: 0, parentFrameId: -1 });
    expect(ev.frameIds(sub, false)).toEqual({ frameId: 9, parentFrameId: 0 });
    expect(ev.frameIds(deep, false)).toEqual({ frameId: 12, parentFrameId: 9 });
    expect(ev.frameIds(null, false)).toBe(null);
  });
  it('carries the fields Chrome documents for each event', () => {
    const base = { tabId: 5, url: 'https://a.test/', frame: top, isMainFrame: true, processId: 7, timeStamp: 100 };
    const before = ev.navigationDetails('onBeforeNavigate', base);
    expect(before).toEqual({ tabId: 5, url: 'https://a.test/', processId: 7, frameId: 0, parentFrameId: -1, timeStamp: 100, documentLifecycle: 'active', frameType: 'outermost_frame' });
    const committed = ev.navigationDetails('onCommitted', base);
    expect(committed.transitionType).toBe('link');
    expect(committed.transitionQualifiers).toEqual([]);
    expect(ev.navigationDetails('onCompleted', base).transitionType).toBeUndefined();
    expect(ev.navigationDetails('onErrorOccurred', { ...base, error: 'net::ERR_NAME_NOT_RESOLVED' }).error).toBe('net::ERR_NAME_NOT_RESOLVED');
    const s = ev.navigationDetails('onCompleted', { ...base, frame: sub, isMainFrame: false });
    expect([s.frameId, s.parentFrameId, s.frameType]).toEqual([9, 0, 'sub_frame']);
    expect(ev.navigationDetails('onCompleted', { ...base, frame: null, isMainFrame: false })).toBe(null);
    for (const k of ['onHistoryStateUpdated', 'onReferenceFragmentUpdated']) expect(ev.navigationDetails(k, base).transitionType).toBe('link');
    expect(() => ev.navigationDetails('onNope', base)).toThrow();
  });
  it('announces web pages only', () => {
    expect(ev.navigableUrl('https://a.test/')).toBe(true);
    expect(ev.navigableUrl('http://a.test/')).toBe(true);
    for (const u of ['file:///C:/x', 'about:blank', 'chrome-extension://abc/p.html', 'vex://settings', '']) expect(ev.navigableUrl(u)).toBe(false);
  });
});

describe('private pages are never announced', () => {
  it('Tor, in-memory, burner and off-the-record sessions are private; the default and persist: ones are not', () => {
    expect(ev.isPrivateSession({ partition: '', persistent: true })).toBe(false);
    expect(ev.isPrivateSession({ partition: 'persist:container-work', persistent: true })).toBe(false);
    expect(ev.isPrivateSession({ partition: 'persist:route-tor', persistent: true })).toBe(true);
    expect(ev.isPrivateSession({ partition: 'persist:x', persistent: true, tor: true })).toBe(true);
    expect(ev.isPrivateSession({ partition: 'tor-abc', persistent: false })).toBe(true);
    expect(ev.isPrivateSession({ partition: 'burner-1', persistent: true })).toBe(true);
    expect(ev.isPrivateSession({ partition: 'persist:x', persistent: false })).toBe(true);
  });
  it('main checks it before every navigation event and never watches a non-persistent cookie jar', () => {
    expect(MAIN).toMatch(/function _extNavEmit\(contents, event, info\) \{\n\s+if \(contents\.isDestroyed\(\) \|\| !_extEventsMod\.navigableUrl\(info\.url\) \|\| _extPageIsPrivate\(contents\)\) return;/);
    expect(MAIN).toMatch(/function _extPageIsPrivate[\s\S]{0,300}host\.privatePartition[\s\S]{0,300}__vexTor/);
    expect(MAIN).toMatch(/function _watchSessionCookies\(ses\) \{\n\s+if \(_watchedCookieSessions\.has\(ses\) \|\| ses\.__vexTor\) return;\n\s+if \(typeof ses\.isPersistent === 'function' && !ses\.isPersistent\(\)\) return;/);
    expect(MAIN).toMatch(/case 'webNavigation\.getFrame': case 'webNavigation\.getAllFrames': \{\n\s+needPerm\('webNavigation'\);[\s\S]{0,200}_extPageIsPrivate\(page\)/);
  });
  it('an error page is an error, once, and not a finished load', () => {
    expect(MAIN.match(/contents\.on\('did-fail(-provisional)?-load'/g)).toEqual(["contents.on('did-fail-load'"]);
    expect(MAIN).toMatch(/failedFrames\.add\(keyOf\(frame, isMain\)\);/);
    expect(MAIN).toMatch(/failedFrames\.has\(0\)\) return;/);
    expect(MAIN).toMatch(/'net::' \+ named/);
  });
  it('listening needs the permission', () => {
    expect(MAIN).toMatch(/if \(\/\^webNavigation\\\.\/\.test\(type\)\) needPerm\('webNavigation'\);/);
    expect(MAIN).toMatch(/if \(\/\^cookies\\\.\/\.test\(type\)\) needPerm\('cookies'\);/);
    expect(MAIN).toMatch(/if \(!\(\(ext\.manifest && ext\.manifest\.permissions\) \|\| \[\]\)\.includes\('webNavigation'\)\) return null;/);
  });
});

describe('listening', () => {
  it('webNavigation listeners are numbered like webRequest ones, each with its own filter', () => {
    const e = ev.createExtensionEvents();
    e.listen('p|x', 'webNavigation.onCommitted#1', { url: [{ hostEquals: 'a.test' }] });
    e.listen('p|x', 'webNavigation.onCommitted#2', { url: [{ hostEquals: 'b.test' }] });
    e.listen('p|y', 'cookies.onChanged', null);
    expect(e.listeners('p', 'webNavigation.onCommitted').map(l => l.type).sort()).toEqual(['webNavigation.onCommitted#1', 'webNavigation.onCommitted#2']);
    expect(e.listeners('p', 'cookies.onChanged')).toHaveLength(1);
    expect(() => e.listen('p|x', 'cookies.onChanged#1', null)).toThrow();
    expect(() => e.listen('p|x', 'webNavigation.onNope', null)).toThrow();
  });
});

describe('cookies.onChanged', () => {
  const cookie = { name: 'sid', value: 'v', domain: '.example.com', hostOnly: false, path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax' };
  it('is { removed, cookie, cause } with Chrome\'s cause names', () => {
    const c = ev.cookieChange(cookie, 'expired-overwrite', true, toChrome);
    expect(c).toEqual({ removed: true, cookie: toChrome(cookie), cause: 'expired_overwrite' });
    expect(c.cookie.storeId).toBe('0');
    expect(ev.cookieChange(cookie, 'explicit', false, toChrome).removed).toBe(false);
    expect(ev.cookieChange(cookie, 'overwrite', true, toChrome).cause).toBe('overwrite');
  });
  it('an extension is told only for sites it has host permission for', () => {
    const m = { permissions: ['cookies'], host_permissions: ['https://*.example.com/*'] };
    expect(allowsHost(m, '.example.com', matchPattern)).toBe(true);
    expect(allowsHost(m, '.other.test', matchPattern)).toBe(false);
  });
});

// The stand-ins, run as the extension's service worker sees them.
function worker(src, manifest) {
  const asked = []; const listeners = [];
  const ipcRenderer = {
    invoke: (ch, r) => { asked.push([ch, r]); return Promise.resolve(null); },
    on: (ch, fn) => { if (ch === 'extensions:event') listeners.push(fn); },
  };
  const chrome = {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', getManifest: () => manifest, getURL: (p) => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/' + p },
    tabs: { query: async () => [], get: async () => null, onUpdated: { addListener() {} } },
  };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL, console,
    require: () => ({ ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } }) });
  vm.runInContext(src, ctx);
  return { c: chrome, asked, emit: (msg) => listeners.forEach(fn => fn({}, msg)) };
}

describe('the stand-ins', () => {
  const SW = fs.readFileSync(path.join(__dirname, '../../src/preload-extension-sw.js'), 'utf8');
  it('a webNavigation listener tells main its filter and hears the event', async () => {
    const w = worker(SW, { permissions: ['webNavigation'] });
    const heard = [];
    const filter = { url: [{ hostSuffix: 'example.com' }] };
    w.c.webNavigation.onCommitted.addListener((d) => heard.push(d.url), filter);
    w.c.webNavigation.onCompleted.addListener((d) => heard.push('done ' + d.url));
    await Promise.resolve();
    const told = w.asked.filter(a => a[1] && a[1].op === 'events.listen').map(a => a[1].args);
    expect(told).toEqual([{ type: 'webNavigation.onCommitted#1', filter }, { type: 'webNavigation.onCompleted#2', filter: {} }]);
    w.emit({ type: 'webNavigation.onCommitted#1', args: [{ url: 'https://www.example.com/' }] });
    w.emit({ type: 'webNavigation.onCompleted#2', args: [{ url: 'https://www.example.com/' }] });
    expect(heard).toEqual(['https://www.example.com/', 'done https://www.example.com/']);
  });
  it('getFrame and getAllFrames ask main', async () => {
    const w = worker(SW, { permissions: ['webNavigation'] });
    await w.c.webNavigation.getAllFrames({ tabId: 3 });
    await w.c.webNavigation.getFrame({ tabId: 3, frameId: 9 });
    const ops = w.asked.map(a => [a[1].op, a[1].args]);
    expect(ops).toEqual([['webNavigation.getAllFrames', { tabId: 3 }], ['webNavigation.getFrame', { tabId: 3, frameId: 9 }]]);
  });
  it('cookies.onChanged tells main and hears main', async () => {
    const w = worker(SW, { permissions: ['cookies'], host_permissions: ['https://*.example.com/*'] });
    const heard = [];
    w.c.cookies.onChanged.addListener((d) => heard.push(d));
    await Promise.resolve();
    expect(w.asked.filter(a => a[1] && a[1].op === 'events.listen').map(a => a[1].args.type)).toEqual(['cookies.onChanged']);
    w.emit({ type: 'cookies.onChanged', args: [{ removed: false, cookie: { name: 'a' }, cause: 'explicit' }] });
    expect(heard).toEqual([{ removed: false, cookie: { name: 'a' }, cause: 'explicit' }]);
  });
  it('the page-side stand-ins are the same', () => {
    const wv = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');
    const sw = SW.replace(/\r\n/g, '\n');
    for (const needle of ["requestEvent('webNavigation.' + name)", "mainHubEvent('cookies.onChanged')", "api('webNavigation.getAllFrames'"]) {
      expect(sw).toContain(needle);
      expect(wv).toContain(needle);
    }
  });
});
