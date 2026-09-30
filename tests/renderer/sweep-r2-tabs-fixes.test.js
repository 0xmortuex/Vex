// @vitest-environment jsdom
//
// Renderer-side fixes from the r2 tabs sweep (2026-09-30):
//   * Ctrl+Shift+Z in Vex's own text boxes put the page to sleep instead of
//     redoing (app.js);
//   * Ctrl+Tab walked the internal tab list, not the strip, and stopped on
//     tabs hidden in a collapsed group (tabs.js cycleTab);
//   * a permanent, non-modal role="dialog" cookie banner kept Escape from
//     closing Peek (preload-webview.js);
//   * Vex's own reads of a JavaScript-off page filled the console (webview.js,
//     price-history.js);
//   * chrome.tabs.remove did not exist (the stand-ins; tabs.js finds the tab).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');
const flush = () => new Promise(r => setTimeout(r, 0));

describe('Ctrl+Shift+Z in Vex\'s own text boxes is redo', () => {
  const APP = read('src/renderer/js/app.js');
  const from = APP.indexOf('function vexOwnTextFocused(doc) {');
  const vexOwnTextFocused = new Function(APP.slice(from, APP.indexOf('\n}\n', from) + 3) + '; return vexOwnTextFocused;')();
  const focus = (html) => { document.body.innerHTML = html; const el = document.body.firstElementChild; el.tabIndex = 0; el.focus(); return el; };

  it('the address bar, a search box, a textarea and an editable note are Vex\'s text boxes', () => {
    for (const html of ['<input id="url-input">', '<input type="search">', '<textarea></textarea>']) {
      focus(html);
      expect(vexOwnTextFocused(document)).toBe(true);
    }
    const el = focus('<div contenteditable="true"></div>');
    Object.defineProperty(el, 'isContentEditable', { value: true });   // jsdom does not compute it
    expect(vexOwnTextFocused(document)).toBe(true);
  });

  it('a page (its <webview>), a button or a checkbox is not, so the tab still sleeps', () => {
    for (const html of ['<webview></webview>', '<button>x</button>', '<input type="checkbox">']) {
      focus(html);
      expect(vexOwnTextFocused(document)).toBe(false);
    }
    document.body.innerHTML = '';
    expect(vexOwnTextFocused(document)).toBe(false);
  });

  it('the sleep-current-tab handler redoes in a text box and sleeps otherwise', () => {
    const at = APP.indexOf('window.vex.onSleepCurrentTab?.(');
    const handler = APP.slice(at, APP.indexOf('});', at) + 3);
    expect(handler).toContain("if (vexOwnTextFocused(document)) { document.execCommand('redo'); return; }");
    expect(handler).toContain('TabManager.sleepActiveTab();');
  });
});

function tabGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = { webviews: new Map(), destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  globalThis.SplitScreen = undefined;
  globalThis.TabSnooze = undefined;
  window.vex = { getStartPageUrl: () => new Promise(() => {}), tabMemory: vi.fn(async () => ({ totalKB: 0, byId: {} })) };
  window.showToast = vi.fn();
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
const fakeTab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, pinned: false, groupId: null, stackId: null, ...over });

describe('Ctrl+Tab goes in the order the strip draws', () => {
  let TM;
  beforeEach(async () => {
    document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div>';
    document.body.dataset.tabLayout = 'horizontal';
    tabGlobals();
    TM = await loadTabManager();
    // Internal order differs from the strip: grouped tabs first in the list,
    // but the top strip draws loose tabs before groups.
    TM.tabs = [fakeTab('g1', { groupId: 'open' }), fakeTab('hid', { groupId: 'shut' }), fakeTab('a'), fakeTab('p', { pinned: true }), fakeTab('b'), fakeTab('g2', { groupId: 'open' })];
    TM.groups = [{ id: 'open', name: 'Open', collapsed: false }, { id: 'shut', name: 'Shut', collapsed: true }];
    TM.switchTab = vi.fn((id) => { TM.activeTabId = id; });
  });

  it('forwards and round the end, passing over a collapsed group\'s tabs', () => {
    expect(TM.displayOrder().map(t => t.id)).toEqual(['p', 'a', 'b', 'g1', 'g2', 'hid']);
    TM.activeTabId = 'p';
    const walk = [];
    for (let i = 0; i < 6; i++) walk.push(TM.cycleTab(1).id);
    expect(walk).toEqual(['a', 'b', 'g1', 'g2', 'p', 'a']);
  });

  it('backwards', () => {
    TM.activeTabId = 'p';
    expect([TM.cycleTab(-1).id, TM.cycleTab(-1).id, TM.cycleTab(-1).id]).toEqual(['g2', 'g1', 'b']);
  });

  it('a single visible tab goes nowhere', () => {
    TM.tabs = [fakeTab('only'), fakeTab('hid', { groupId: 'shut' })];
    TM.activeTabId = 'only';
    expect(TM.cycleTab(1)).toBeNull();
    expect(TM.switchTab).not.toHaveBeenCalled();
  });

  it('app.js hands both keys to it', () => {
    expect(read('src/renderer/js/app.js')).toContain('const cycleTab = (dir) => TabManager.cycleTab(dir);');
  });
});

describe('tabs.remove: the tab with that page', () => {
  let TM;
  beforeEach(async () => {
    document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div>';
    tabGlobals();
    TM = await loadTabManager();
    TM.tabs = [fakeTab('a'), fakeTab('b'), fakeTab('lazy')];
    WebviewManager.webviews.set('a', { getWebContentsId: () => 21 });
    WebviewManager.webviews.set('b', { getWebContentsId: () => 22 });
    TM.closeTab = vi.fn();
  });

  it('closes each tab named by its page id', () => {
    expect(TM.closeTabsByPageId([22, 21])).toBe(2);
    expect(TM.closeTab.mock.calls.map(c => c[0])).toEqual(['b', 'a']);
  });

  it('closes none when one id is not a tab of this window', () => {
    expect(TM.tabsByPageId([21, 99]).missing).toBe(99);
    expect(() => TM.closeTabsByPageId([21, 99])).toThrow('No tab with id: 99.');
    expect(TM.closeTab).not.toHaveBeenCalled();
  });
});

describe('the stand-ins give extensions tabs.remove', () => {
  const SRC = read('src/preload-webview.js');
  const START = SRC.indexOf('// === BEGIN vex-extension-stand-ins ===');
  const BLOCK = SRC.slice(START, SRC.indexOf('// === END vex-extension-stand-ins ==='));
  function standIns(closeTab, tabs = {}) {
    const chrome = { runtime: { id: 'x', getManifest: () => ({}), getURL: (p) => 'chrome-extension://x/' + p }, tabs };
    const ctx = vm.createContext({ setTimeout, Promise, Error, String, Object, Array, URL });
    vm.runInContext(BLOCK + '\nthis.run = vexExtensionStandIns;', ctx);
    ctx.run(chrome, null, null, closeTab);
    return chrome;
  }

  it('asks main to close the ids, one or a list, and answers undefined', async () => {
    const closeTab = vi.fn(async () => undefined);
    const c = standIns(closeTab);
    await expect(c.tabs.remove(5)).resolves.toBeUndefined();
    await new Promise(r => c.tabs.remove([6, 7], r));
    expect(closeTab.mock.calls.map(x => x[0])).toEqual([{ ids: [5] }, { ids: [6, 7] }]);
  });

  it('fails with Chrome\'s own words, not the IPC wrapping round them', async () => {
    const c = standIns(async () => { throw new Error("Error invoking remote method 'extensions:close-tab': Error: No tab with id: 9."); });
    await expect(c.tabs.remove(9)).rejects.toThrow(/^No tab with id: 9\.$/);
  });

  it('leaves a tabs.remove Electron has alone', () => {
    const own = () => 'native';
    expect(standIns(vi.fn(), { remove: own }).tabs.remove).toBe(own);
  });
});

describe('Escape and Peek over a page with a cookie banner', () => {
  const SRC = read('src/preload-webview.js');
  const start = SRC.indexOf('// === Escape the page left alone, told to the host ===');
  const block = SRC.slice(start, SRC.indexOf('})();', start) + 5);

  // The preload block over a real (jsdom) page. jsdom lays nothing out, so an
  // element counts as drawn unless it is [hidden].
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
  const PAGE = '<div id="cookie" role="dialog">We use cookies <button id="ok">OK</button></div><button id="open">Menu</button><div id="pop" role="dialog" hidden><button id="in">x</button></div>';
  beforeEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('a banner that was there all along does not keep Peek open', async () => {
    const t = load(PAGE);
    t.escape();
    await flush();
    expect(t.sendToHost).toHaveBeenCalledWith('vex-escape');
    const u = load(PAGE);
    u.click(document.getElementById('open'));   // a click elsewhere: the banner was there before it
    u.escape();
    await flush();
    expect(u.sendToHost).toHaveBeenCalledWith('vex-escape');
  });

  it('a popup opened by the last click keeps the Escape for the page', async () => {
    const t = load(PAGE);
    t.click(document.getElementById('open'));
    document.getElementById('pop').hidden = false;   // the page opens it
    t.escape();
    await flush();
    expect(t.sendToHost).not.toHaveBeenCalled();
  });

  it('a non-modal dialog counts when the focus or the last click is in it', async () => {
    const t = load(PAGE);
    document.getElementById('ok').focus();
    t.escape();
    const u = load(PAGE);
    u.click(document.getElementById('ok'));
    document.getElementById('ok').blur();
    u.escape();
    await flush();
    expect(t.sendToHost).not.toHaveBeenCalled();
    expect(u.sendToHost).not.toHaveBeenCalled();
  });

  it('a modal (aria-modal) or an alertdialog always counts', async () => {
    const t = load('<div role="dialog" aria-modal="true">Sign in</div>');
    t.escape();
    const u = load('<div role="alertdialog">Leave?</div>');
    u.escape();
    await flush();
    expect(t.sendToHost).not.toHaveBeenCalled();
    expect(u.sendToHost).not.toHaveBeenCalled();
  });
});

describe('no reads of a page whose JavaScript is off', () => {
  it('WebviewManager.scriptsOffIn: a webview built without JavaScript, or on such a site', () => {
    window.SiteRulesUI = { scriptsOff: (u) => /off\.example/.test(u) };
    const { WebviewManager: W } = require('../../src/renderer/js/webview.js');
    expect(W.scriptsOffIn({ _noScripts: true, getURL: () => 'https://on.example/' })).toBe(true);
    expect(W.scriptsOffIn({ getURL: () => 'https://off.example/' })).toBe(true);
    expect(W.scriptsOffIn({ getURL: () => 'https://on.example/' })).toBe(false);
    delete window.SiteRulesUI;
  });

  it('the page-background check is skipped there', () => {
    const src = read('src/renderer/js/webview.js');
    expect(src).toContain('if (!this.scriptsOffIn(webview)) try {\n        webview.executeJavaScript(`(() => {\n          const solid');
  });

  it('PriceHistory does not ask such a page for its price', async () => {
    vi.useFakeTimers();
    require('../../src/renderer/js/vex-utils.js');
    const { PriceHistory } = require('../../src/renderer/js/price-history.js');
    const listeners = {};
    const wv = { addEventListener: (ev, fn) => { listeners[ev] = fn; }, getURL: () => 'https://shop.example/item', isConnected: true };
    const guestEval = vi.spyOn(window, 'vexGuestEval').mockResolvedValue(null);
    vi.spyOn(window, 'vexGuestUrl').mockReturnValue('https://shop.example/item');
    globalThis.WebviewManager = { scriptsOffIn: () => true };
    PriceHistory.attach(wv);
    listeners['did-finish-load']();
    vi.advanceTimersByTime(PriceHistory.SETTLE_MS + 10);
    expect(guestEval).not.toHaveBeenCalled();
    globalThis.WebviewManager = { scriptsOffIn: () => false };
    listeners['did-finish-load']();
    vi.advanceTimersByTime(PriceHistory.SETTLE_MS + 10);
    expect(guestEval).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    delete globalThis.WebviewManager;
  });
});
