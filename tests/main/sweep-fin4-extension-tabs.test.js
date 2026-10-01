// @vitest-environment node
//
// chrome.tabs.create answered undefined (found 2026-09-29): main only told the
// interface to open a tab and never heard which one it made, so an extension
// had no id to update the tab by. Now the interface answers with the page's
// webContents id (the id Electron's tabs.get/update use), main resolves the
// extension's call with it, and no answer in 10 s is an error, not a hang.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const { validate } = require('../../src/main/ipc-schemas.js');

const read = (f) => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main.js');
const APP = read('src/renderer/js/app.js');
const SW_SRC = read('src/preload-extension-sw.js');
const between = (src, from, to) => { const i = src.indexOf(from); expect(i).toBeGreaterThan(-1); return src.slice(i, src.indexOf(to, i) + to.length); };
const OWN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

afterEach(() => vi.useRealTimers());

// main.js cannot load outside Electron: its request/answer code runs here
// against a fake window and ipcMain.
function mainSide() {
  const code = between(MAIN, 'const _extTabRequests = new Map();', '\n  return created;\n}\n');
  const listeners = {}, sent = [];
  const ctx = vm.createContext({
    URL, Promise, console: { warn: () => {}, error: () => {} },
    setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a),
    ipcMain: { on: (ch, fn) => { listeners[ch] = fn; } },
    mainWindow: { isDestroyed: () => false, webContents: { send: (ch, payload) => sent.push([ch, payload]) } },
    _partitionNameOf: () => 'persist:main', _extPopupWindow: null, _extPopupOver: null,
  });
  vm.runInContext(code + '\nthis.open = _openTabForExtension;', ctx);
  const answer = (reply, sender = ctx.mainWindow.webContents) => listeners['tab:created-for-extension']({ sender }, reply);
  return { open: ctx.open, sent, answer };
}

describe('main: tabs.create waits for the tab the interface made', () => {
  it('sends a request id and resolves with the tab named in the answer', async () => {
    const m = mainSide();
    const p = m.open(OWN + 'popup.html', {}, { url: 'https://example.com/', active: false });
    expect(m.sent).toHaveLength(1);
    const [channel, request] = m.sent[0];
    expect(channel).toBe('tab:create-from-external');
    expect(request).toMatchObject({ url: 'https://example.com/', background: true });
    expect(typeof request.requestId).toBe('string');
    m.answer({ id: request.requestId, ok: true, tabId: 42, url: 'https://example.com/', active: false });
    await expect(p).resolves.toEqual({ id: 42, url: 'https://example.com/', active: false });
  });

  it('a failure from the interface rejects with its reason', async () => {
    const m = mainSide();
    const p = m.open(OWN + 'popup.html', {}, { url: 'https://example.com/' });
    m.answer({ id: m.sent[0][1].requestId, ok: false, error: 'The new tab has no page' });
    await expect(p).rejects.toThrow('The new tab has no page');
  });

  it('an answer from another window is not taken', async () => {
    vi.useFakeTimers();
    const m = mainSide();
    const p = m.open(OWN + 'popup.html', {}, { url: 'https://example.com/' });
    const settled = vi.fn();
    p.then(settled, settled);
    m.answer({ id: m.sent[0][1].requestId, ok: true, tabId: 9 }, { other: true });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10000);
    await expect(p).rejects.toThrow('did not say which tab');
  });

  it('no answer in 10 s rejects instead of hanging', async () => {
    vi.useFakeTimers();
    const m = mainSide();
    const p = m.open(OWN + 'popup.html', {}, { url: 'https://example.com/' });
    const check = expect(p).rejects.toThrow('Vex did not say which tab it opened');
    vi.advanceTimersByTime(10000);
    await check;
  });

  it('still refuses what it refused before, without sending anything', () => {
    const m = mainSide();
    expect(() => m.open('https://evil.example/', {}, { url: 'https://example.com/' })).toThrow('Only an extension page');
    expect(() => m.open(OWN + 'popup.html', {}, { url: 'file:///C:/' })).toThrow('not file:');
    expect(m.sent).toHaveLength(0);
  });

  it('a popup link catches a late failure too', () => {
    const handler = between(MAIN, 'win.webContents.setWindowOpenHandler(', "return { action: 'deny' };");
    expect(handler).toMatch(/_openTabForExtension\([^;]*\)\.catch\(notOpened\)/);
  });

  it('the answer channel has a payload contract', () => {
    expect(() => validate('tab:created-for-extension', [{ id: 'ext-tab-1', ok: true, tabId: 4, url: 'https://example.com/', active: false }])).not.toThrow();
    expect(() => validate('tab:created-for-extension', [{ id: 'ext-tab-1', ok: false, error: 'no' }])).not.toThrow();
    expect(() => validate('tab:created-for-extension', [{ id: 'ext-tab-1', ok: true, tabId: -1 }])).toThrow();
    expect(() => validate('tab:created-for-extension', [{ id: 42, ok: true }])).toThrow();
  });
});

// The interface's half (app.js), run against fake tabs and webviews.
function appSide({ created, webContentsId, activeTabId = 't1' }) {
  const code = between(APP, 'function answerExtensionTab(requestId, created) {', '\n  }\n');
  const said = [];
  const handlers = {};
  const wv = {
    id: webContentsId,
    getWebContentsId() { if (this.id == null) throw new Error('not attached'); return this.id; },
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
    removeEventListener: (ev) => { delete handlers[ev]; },
  };
  const tab = { id: 't1', url: 'https://example.com/' };
  const ctx = vm.createContext({
    Number,
    window: { vex: { tabCreatedForExtension: (p) => said.push(p) } },
    TabManager: { tabs: [tab], activeTabId },
    WebviewManager: { webviews: new Map([['t1', wv]]) },
  });
  vm.runInContext(code, ctx);
  ctx.answerExtensionTab('ext-tab-1', created === undefined ? tab : created);
  return { said, wv, handlers };
}

describe('app.js: the interface says which tab it made', () => {
  it('answers at once when the page is attached', () => {
    const { said } = appSide({ webContentsId: 17 });
    expect(said).toEqual([{ id: 'ext-tab-1', ok: true, tabId: 17, url: 'https://example.com/', active: true }]);
  });

  it('a background page not attached yet is answered when it attaches', () => {
    const r = appSide({ webContentsId: null, activeTabId: 'other' });
    expect(r.said).toEqual([]);
    r.wv.id = 23;
    r.handlers['did-attach']();
    expect(r.said).toEqual([{ id: 'ext-tab-1', ok: true, tabId: 23, url: 'https://example.com/', active: false }]);
    expect(r.handlers).toEqual({});
  });

  it('an open tab it went to instead (createTab gave its id) is the answer', () => {
    const { said } = appSide({ created: 't1', webContentsId: 8 });
    expect(said[0]).toMatchObject({ ok: true, tabId: 8 });
  });

  it('a tab with no page is an error', () => {
    const { said } = appSide({ created: 'missing', webContentsId: 8 });
    expect(said).toEqual([{ id: 'ext-tab-1', ok: false, error: 'The new tab has no page' }]);
  });

  it('the handler passes the request id on, and a failed createTab answers too', () => {
    const handler = between(APP, 'window.vex?.onTabCreateFromExternal?.((data) => {', '\n  });\n');
    expect(handler).toMatch(/if \(data\.requestId\) answerExtensionTab\(data\.requestId, created\)/);
    expect(handler).toMatch(/tabCreatedForExtension\(\{ id: data\.requestId, ok: false, error: err\.message \}\)/);
  });
});

// The stand-in's half: the extension gets a Tab, described by Electron's
// tabs.get where it knows the page.
function worker(chrome, answer) {
  const calls = [];
  const ipcRenderer = { invoke: (ch, ...args) => { calls.push([ch, ...args]); return Promise.resolve(ch === 'extensions:open-tab' ? answer(args[0]) : ch === 'extensions:active-tabs' ? { ids: [], current: null } : null); } };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL,
    require: (m) => {
      if (m !== 'electron') throw new Error('only electron');
      return { ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } };
    } });
  vm.runInContext(SW_SRC, ctx);
  return { c: chrome, calls };
}
function fakeChrome(known, manifest = {}) {
  return {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', getManifest: () => manifest, getURL: (p) => OWN + p },
    tabs: { query: () => Promise.resolve([]), get: (id) => Promise.resolve(known[id] || null) },
  };
}

describe('stand-in: tabs.create resolves a Tab', () => {
  const made = (req) => ({ id: 4, url: req.url, active: req.active });

  it('Electron’s view of the page, with the address it is going to and whether it is in front', async () => {
    const { c } = worker(fakeChrome({ 4: { id: 4, windowId: 0, index: 0, url: '', active: false, title: '' } }), made);
    const tab = await c.tabs.create({ url: 'https://example.com/', active: false });
    expect(tab).toEqual({ id: 4, windowId: 0, index: 0, url: 'https://example.com/', pendingUrl: 'https://example.com/', active: false, highlighted: false, selected: false, title: '' });
  });

  it('the callback form gets the same Tab', async () => {
    const { c } = worker(fakeChrome({}), made);
    const tab = await new Promise((resolve) => c.tabs.create({ url: 'manage.html' }, resolve));
    expect(tab).toEqual({ id: 4, index: 0, windowId: 0, url: OWN + 'manage.html', pendingUrl: OWN + 'manage.html', active: true });
  });

  it('main’s refusal reaches the extension', async () => {
    const { c } = worker(fakeChrome({}), () => Promise.reject(new Error('not file:')));
    await expect(c.tabs.create({ url: 'file:///C:/' })).rejects.toThrow('not file:');
  });

  it('openOptionsPage still answers nothing', async () => {
    const { c } = worker(fakeChrome({}, { options_page: 'opts.html' }), made);
    expect(await c.runtime.openOptionsPage()).toBeUndefined();
  });
});
