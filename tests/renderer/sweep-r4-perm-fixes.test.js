// @vitest-environment jsdom
//
// Page-side fixes from the r4 permissions sweep (2026-09-30):
//   * a non-modal cookie banner put up by a late consent script, seconds after
//     the last click, counted as the page's own popup, so Escape did not close
//     Peek (preload-webview.js);
//   * chrome.tabs.query/get said which tab is active by the focus, which Vex's
//     own bar takes; the stand-ins now ask main which tab is in front.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');

describe('Escape and Peek: only a dialog the person opened keeps the key', () => {
  const SRC = read('src/preload-webview.js');
  const start = SRC.indexOf('// === Escape the page left alone, told to the host ===');
  const block = SRC.slice(start, SRC.indexOf('})();', start) + 5);

  function load(html) {
    document.body.innerHTML = html;
    const sendToHost = vi.fn();
    const listeners = { keydown: [], pointerdown: [] };
    const win = {
      addEventListener: (t, fn, cap) => { if (listeners[t]) listeners[t].push({ fn, cap }); },
      getComputedStyle: (el) => ({ visibility: 'visible', display: el.hidden ? 'none' : 'block' }),
    };
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function () { return this.closest('[hidden]') ? [] : [{}]; });
    new Function('require', 'window', 'document', block)(() => ({ ipcRenderer: { sendToHost } }), win, document);
    const fire = (type, e) => {
      listeners[type].filter(l => l.cap).forEach(l => l.fn(e));
      listeners[type].filter(l => !l.cap).forEach(l => l.fn(e));
    };
    const escape = () => fire('keydown', { isTrusted: true, key: 'Escape', repeat: false, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
    const click = (target) => fire('pointerdown', { isTrusted: true, target });
    return { sendToHost, escape, click };
  }
  const PAGE = '<button id="open">Menu</button><div id="pop" role="dialog" hidden><button id="in">x</button></div><div id="late" role="dialog" hidden>We use cookies</div>';
  beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); document.body.innerHTML = ''; });
  afterEach(() => vi.useRealTimers());

  it('a banner a late script puts up seconds after the click does not keep Peek open', () => {
    const t = load(PAGE);
    t.click(document.getElementById('open'));
    vi.advanceTimersByTime(3000);
    document.getElementById('late').hidden = false;   // the consent script, late
    t.escape();
    vi.advanceTimersByTime(0);
    expect(t.sendToHost).toHaveBeenCalledWith('vex-escape');
  });

  it('nor one that comes up after the second is over, before Escape', () => {
    const t = load(PAGE);
    t.click(document.getElementById('open'));
    vi.advanceTimersByTime(1500);
    document.getElementById('late').hidden = false;
    vi.advanceTimersByTime(500);
    t.escape();
    vi.advanceTimersByTime(0);
    expect(t.sendToHost).toHaveBeenCalledWith('vex-escape');
  });

  it('a popup the click opened keeps the Escape, however long after', () => {
    const t = load(PAGE);
    t.click(document.getElementById('open'));
    vi.advanceTimersByTime(200);
    document.getElementById('pop').hidden = false;    // the page opens it
    vi.advanceTimersByTime(10000);
    t.escape();
    vi.advanceTimersByTime(0);
    expect(t.sendToHost).not.toHaveBeenCalled();
  });

  it('a late banner with the focus in it still counts', () => {
    const t = load('<div id="late" role="dialog" hidden><button id="ok">OK</button></div>');
    vi.advanceTimersByTime(5000);
    document.getElementById('late').hidden = false;
    document.getElementById('ok').focus();
    t.escape();
    vi.advanceTimersByTime(0);
    expect(t.sendToHost).not.toHaveBeenCalled();
  });
});

describe('the stand-ins: which tab is active is what main says is in front', () => {
  const SRC = read('src/preload-webview.js');
  const BLOCK = SRC.slice(SRC.indexOf('// === BEGIN vex-extension-stand-ins ==='), SRC.indexOf('// === END vex-extension-stand-ins ==='));
  // Electron's own answers: every tab active, as with Vex's bar focused.
  const TABS = [{ id: 4, active: true, url: 'https://a.example/' }, { id: 7, active: true, url: 'https://b.example/' }, { id: 9, active: true, url: 'https://c.example/' }];
  function standIns(front, { tabs = TABS } = {}) {
    const lastError = { value: undefined };
    const chrome = {
      runtime: { id: 'x', getManifest: () => ({}), getURL: (p) => 'chrome-extension://x/' + p },
      tabs: {
        query: vi.fn((q) => Promise.resolve(tabs.filter(t => q.active == null || t.active === q.active))),
        get: (id, cb) => {
          const t = tabs.find(x => x.id === id);
          if (typeof cb === 'function') { setTimeout(() => { lastError.value = t ? undefined : { message: 'No tab with id: ' + id + '.' }; cb(t); lastError.value = undefined; }, 0); return undefined; }
          return t ? Promise.resolve(t) : Promise.reject(new Error('No tab with id: ' + id + '.'));
        },
      },
    };
    const native = chrome.tabs.query;
    const askActiveTabs = vi.fn(async () => front);
    const ctx = vm.createContext({ setTimeout, Promise, Error, String, Object, Array, URL });
    vm.runInContext(BLOCK + '\nthis.run = vexExtensionStandIns;', ctx);
    ctx.run(chrome, null, null, null, askActiveTabs);
    return { c: chrome, askActiveTabs, native, lastError };
  }
  const FRONT = { ids: [7, 9], current: 9 };   // two Vex windows; the second used last

  it('every tab says whether it is in front', async () => {
    const { c } = standIns(FRONT);
    expect((await c.tabs.query({})).map(t => [t.id, t.active, t.highlighted])).toEqual([[4, false, false], [7, true, true], [9, true, true]]);
    expect((await c.tabs.query({ active: false })).map(t => t.id)).toEqual([4]);
  });

  it('{active: true} is the tab in front of each window; with currentWindow or lastFocusedWindow, the one window used last', async () => {
    const { c, native } = standIns(FRONT);
    expect((await c.tabs.query({ active: true })).map(t => t.id)).toEqual([7, 9]);
    expect((await c.tabs.query({ active: true, currentWindow: true })).map(t => t.id)).toEqual([9]);
    await new Promise((resolve) => c.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => { expect(tabs.map(t => t.id)).toEqual([9]); resolve(); }));
    // Electron is asked without the keys it answers wrongly.
    expect(native.mock.calls.every(([q]) => !('active' in q) && !('currentWindow' in q) && !('lastFocusedWindow' in q))).toBe(true);
  });

  it('other filters still go to Electron', async () => {
    const { c, native } = standIns(FRONT);
    await c.tabs.query({ active: true, url: 'https://b.example/*' });
    expect(native).toHaveBeenLastCalledWith({ url: 'https://b.example/*' });
  });

  it('tabs.get says so too; a tab that is not there fails as Electron says, with the callback as well', async () => {
    const { c, lastError } = standIns(FRONT);
    expect((await c.tabs.get(4)).active).toBe(false);
    expect((await c.tabs.get(7)).active).toBe(true);
    await expect(c.tabs.get(99)).rejects.toThrow('No tab with id: 99.');
    const seen = await new Promise((resolve) => c.tabs.get(99, (tab) => resolve({ tab, error: lastError.value })));
    expect(seen).toEqual({ tab: undefined, error: { message: 'No tab with id: 99.' } });
    const tab = await new Promise((resolve) => c.tabs.get(9, resolve));
    expect([tab.id, tab.active]).toEqual([9, true]);
  });

  it('with no Vex tab in front, none is active', async () => {
    const { c } = standIns({ ids: [], current: null });
    expect(await c.tabs.query({ active: true, currentWindow: true })).toEqual([]);
  });
});
