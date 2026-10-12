// @vitest-environment jsdom
//
// "Error: The WebView must be attached to the DOM and the dom-ready event
// emitted before this method can be called." — eight times in the owner's
// problem log as an uncaught error (detail isolated_bundle:2, Electron's own
// <webview> code), the last on 2026-09-21. Every <webview> method throws that,
// synchronously, while the element has no page attached: before its first
// attach, and again once it has been removed.
//
// The logged ones were price history reading a page 2.5 s after it loaded,
// when the tab could have been closed or slept by then; fixed in 575acaf
// (vexGuestUrl), and none since. The same throw was still reachable from
// three places that act on a tab whose page is only being made: the zoom
// keys, the speaker button and the hover preview. They now check the
// webview's own did-attach mark (webview._attached, set in createWebview).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');
const { PriceHistory } = require('../../src/renderer/js/price-history.js');

const ATTACH = 'The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.';

// A <webview> as Electron makes it: every method throws until it is attached.
function fakeWebview(url = 'https://example.org/') {
  const handlers = {};
  const wv = {
    handlers, live: false, _attached: undefined, muted: false, zoom: 1,
    addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    fire(ev) { for (const fn of handlers[ev] || []) fn({}); },
    attach() { this.live = true; this._attached = true; this.fire('did-attach'); },
    detach() { this.live = false; },
  };
  const guarded = (name, fn) => { wv[name] = (...args) => { if (!wv.live) throw new Error(ATTACH); return fn(...args); }; };
  guarded('getURL', () => url);
  guarded('isLoading', () => false);
  guarded('getZoomFactor', () => wv.zoom);
  guarded('setZoomFactor', z => { wv.zoom = z; });
  guarded('isAudioMuted', () => wv.muted);
  guarded('setAudioMuted', m => { wv.muted = m; });
  guarded('capturePage', () => Promise.resolve({ isEmpty: () => false, resize() { return this; }, toDataURL: () => 'data:image/png;base64,X' }));
  return wv;
}

describe('price history, the case in the log (fixed in 575acaf)', () => {
  afterEach(() => vi.useRealTimers());
  it('does not throw when the page is gone by the time it is read', async () => {
    vi.useFakeTimers();
    localStorage.clear();
    window.VexTabPolicy = { canReadWebview: () => true };
    const read = vi.spyOn(window, 'vexGuestEval');
    const wv = fakeWebview('https://shop.test/kettle');
    wv.attach();
    PriceHistory.attach(wv);
    wv.fire('did-finish-load');
    wv.detach();                        // closed or slept within 2.5 s
    await vi.advanceTimersByTimeAsync(PriceHistory.SETTLE_MS + 10);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
});

describe('zoom keys on a page still being made', () => {
  let wv;
  beforeEach(() => {
    localStorage.clear();
    wv = fakeWebview();
    WebviewManager.webviews.clear();
    WebviewManager.webviews.set('t1', wv);
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1', partition: 'persist:main' }] };
  });

  it('does nothing before the page is attached, instead of throwing', () => {
    expect(() => WebviewManager.zoomIn()).not.toThrow();
    expect(() => WebviewManager.zoomOut()).not.toThrow();
    expect(() => WebviewManager.zoomReset()).not.toThrow();
    expect(wv.zoom).toBe(1);
  });

  it('zooms once it is there', () => {
    wv.attach();
    WebviewManager.zoomIn();
    expect(wv.zoom).toBeCloseTo(1.1);
    WebviewManager.zoomReset();
    expect(wv.zoom).toBe(1);
  });
});

describe('the speaker button on a page still being made', () => {
  let TabManager, wv, tab;
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><button id="btn-new-tab"></button>';
    globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
    wv = fakeWebview();
    globalThis.WebviewManager = { webviews: new Map([['t1', wv]]), createWebview: vi.fn(), destroyWebview: vi.fn(), showWebview: vi.fn() };
    globalThis.SidebarManager = { hideActivePanel: vi.fn() };
    window.vex = {};
    await import('../../src/renderer/js/vex-utils.js');
    TabManager = (await import('../../src/renderer/js/tabs.js')).TabManager;
    tab = { id: 't1', url: 'https://example.org/', title: 'Example', muted: false };
    TabManager.tabs = [tab];
    TabManager.activeTabId = 't1';
    TabManager.renderTabUpdate = vi.fn();
  });

  it('records the choice and puts it on the page at dom-ready, instead of throwing', () => {
    expect(() => TabManager.toggleMuteTab('t1')).not.toThrow();
    expect(tab.muted).toBe(true);
    wv.attach();
    wv.fire('dom-ready');
    expect(wv.muted).toBe(true);
  });

  it('follows an unmute made before the page was there', () => {
    TabManager.toggleMuteTab('t1');
    TabManager.toggleMuteTab('t1');
    expect(tab.muted).toBe(false);
    wv.attach();
    wv.fire('dom-ready');
    expect(wv.muted).toBe(false);
  });

  it('mutes a page that is there straight away', () => {
    wv.attach();
    TabManager.toggleMuteTab('t1');
    expect(wv.muted).toBe(true);
    expect(tab.muted).toBe(true);
  });
});

describe('the hover preview of a tab opened a moment ago', () => {
  let TabPreview, HOVER_DELAY_MS, wv;
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="tabs-sidebar"><ul id="tabs-list"><li class="tab-item" data-tab-id="t1"></li></ul></div>';
    wv = fakeWebview();
    globalThis.TabManager = { tabs: [{ id: 't1', title: 'Example', url: 'https://example.org/' }] };
    globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
    ({ TabPreview, HOVER_DELAY_MS } = await import('../../src/renderer/js/tab-preview.js'));
    TabPreview.init();
  });
  afterEach(() => vi.useRealTimers());

  it('shows the popup without a picture, instead of throwing out of its timer', async () => {
    const capture = vi.spyOn(wv, 'capturePage');
    document.querySelector('.tab-item').dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS + 5);
    expect(capture).not.toHaveBeenCalled();
    expect(document.getElementById('tab-preview').classList.contains('visible')).toBe(true);
  });
});
