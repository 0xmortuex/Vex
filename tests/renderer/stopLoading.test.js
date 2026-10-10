// @vitest-environment jsdom
//
// Stopping a page that is loading. There was no Stop button and Esc did
// nothing: the Reload button stayed Reload through every load (found
// 2026-10-10). Now Reload turns into Stop (an X) while the active tab
// loads, Esc in the page stops it, and Esc in the address bar first undoes
// what was typed, then stops. A typed address still loading gives way to
// the page still showing, as in Chrome.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const RELOAD_SVG = '<svg class="reload-arrow"></svg>';
let TabManager, WebviewManager, page;

function fakePage() {
  const p = { calls: [], stops: 0, _attached: true, addEventListener() {} };
  p.loadURL = (url) => new Promise((resolve, reject) => { p.calls.push(url); p.resolve = resolve; p.reject = reject; });
  p.stop = () => { p.stops++; };
  return p;
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('the Reload button while a page loads', () => {
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<input id="url-input" placeholder="Search or enter URL...">'
      + `<button id="btn-reload" class="nav-btn" title="Reload (Ctrl+R)">${RELOAD_SVG}</button>`;
    globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
    globalThis.SidebarManager = { hideActivePanel: vi.fn() };
    window.showToast = vi.fn();
    if (!window.vex) window.vex = { getStartPageUrl: () => new Promise(() => {}) };
    await import('../../src/renderer/js/vex-icons.js');
    await import('../../src/renderer/js/vex-utils.js');
    ({ TabManager } = await import('../../src/renderer/js/tabs.js'));
    ({ WebviewManager } = await import('../../src/renderer/js/webview.js'));
    globalThis.TabManager = TabManager;
    globalThis.WebviewManager = WebviewManager;
    TabManager.tabs = [
      { id: 't1', url: 'https://old.example/', title: 'Old' },
      { id: 't2', url: 'https://other.example/', title: 'Other' },
    ];
    TabManager.activeTabId = 't1';
    TabManager.persistTabs = vi.fn();
    TabManager.renderTabUpdate = vi.fn();
    page = fakePage();
    WebviewManager.webviews = new Map([['t1', page], ['t2', fakePage()]]);
  });

  const btn = () => document.getElementById('btn-reload');

  it('turns into Stop (an X, not an emoji) while the active tab loads, and back after', () => {
    TabManager.updateTab('t1', { loading: true });
    expect(btn().dataset.state).toBe('stop');
    expect(btn().title).toMatch(/Stop/);
    expect(btn().querySelector('svg.vex-icon path').getAttribute('d')).toBe('M6 6l12 12M18 6 6 18');   // VexIcons 'x'
    TabManager.updateTab('t1', { loading: false });
    expect(btn().dataset.state).toBe('reload');
    expect(btn().title).toBe('Reload (Ctrl+R)');
    expect(btn().innerHTML).toBe(RELOAD_SVG);
  });

  it('follows the active tab only', () => {
    TabManager.updateTab('t2', { loading: true });        // a background tab
    expect(btn().dataset.state || 'reload').toBe('reload');
    TabManager.updateTab('t1', { loading: true });
    expect(btn().dataset.state).toBe('stop');
    // Switching to a tab that is not loading (switchTab ends in updateUrlBar).
    TabManager.activeTabId = 't2';
    TabManager.tabs[1].loading = false;
    TabManager.updateUrlBar(TabManager.tabs[1]);
    expect(btn().dataset.state).toBe('reload');
  });

  it('stopping a typed address puts the bar back on the page still showing, with no "Could not open"', async () => {
    const input = document.getElementById('url-input');
    WebviewManager.navigate('https://new.example/slow');
    TabManager.updateTab('t1', { loading: true });
    expect(input.value).toBe('https://new.example/slow');
    expect(WebviewManager.stop()).toBe(true);
    expect(page.stops).toBe(1);
    expect(input.value).toBe('https://old.example/');
    page.reject(new Error("ERR_ABORTED (-3) loading 'https://new.example/slow'"));
    await flush();
    TabManager.updateTab('t1', { loading: false });       // did-stop-loading
    expect(input.value).toBe('https://old.example/');
    expect(TabManager.tabs[0].url).toBe('https://old.example/');
    expect(window.showToast).not.toHaveBeenCalled();
    expect(btn().dataset.state).toBe('reload');
  });

  it('the address bar knows what it would show (Esc compares against it)', () => {
    expect(TabManager.urlBarText(TabManager.tabs[0])).toBe('https://old.example/');
    TabManager.tabs[0]._typedUrl = 'https://new.example/';
    expect(TabManager.urlBarText(TabManager.tabs[0])).toBe('https://new.example/');
    expect(TabManager.urlBarText({ url: 'vex://start' })).toBe('');
  });
});

describe('Esc in a page that is loading', () => {
  let tab, wv;
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="webviews-container"></div><input id="url-input">';
    window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');
    require('../../src/renderer/js/vex-utils.js');
    const { WebviewManager: WM } = require('../../src/renderer/js/webview.js');
    WebviewManager = WM;
    tab = { id: 't1', url: 'https://slow.example/', title: '', partition: 'persist:main' };
    WM.webviews.clear();
    globalThis.isStartPage = () => false;
    globalThis.TabManager = {
      tabs: [tab], activeTabId: 't1',
      updateTab: vi.fn((id, patch) => Object.assign(tab, patch)),
      updateUrlBar: vi.fn(),
      renderTabUpdate: vi.fn(), windowMayAsk: () => true,
    };
    globalThis.HistoryPanel = { addEntry: vi.fn(), updateTitle: vi.fn(), entries: [] };
    WM.createWebview(tab);
    wv = WM.webviews.get('t1');
    wv.stop = vi.fn();
  });
  const escapeFromPage = () => { const e = new Event('ipc-message'); e.channel = 'vex-escape'; e.args = []; wv.dispatchEvent(e); };

  it('an Escape the page left alone stops it', () => {
    tab.loading = true;
    tab._typedUrl = 'https://slow.example/next';
    escapeFromPage();
    expect(wv.stop).toHaveBeenCalledTimes(1);
    expect(tab._typedUrl).toBeUndefined();
    expect(globalThis.TabManager.updateUrlBar).toHaveBeenCalledWith(tab);
  });

  it('a page that is not loading keeps its Escape to itself', () => {
    tab.loading = false;
    escapeFromPage();
    expect(wv.stop).not.toHaveBeenCalled();
  });
});

// app.js wiring: the button stops in its Stop state, and Esc in the address
// bar undoes an edit first, then stops a load, then lets go of the bar.
describe('app.js wiring', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
  it('the button reads its own state', () => {
    expect(SRC).toMatch(/btn-reload'\)\.addEventListener\('click', \(e\) => \{\s*if \(e\.currentTarget\.dataset\.state === 'stop'\) WebviewManager\.stop\(\);\s*else WebviewManager\.reload\(\);/);
  });
  it('Esc in the address bar: undo, then stop, then blur', () => {
    const esc = SRC.slice(SRC.indexOf("} else if (e.key === 'Escape') {"), SRC.indexOf("urlInput.addEventListener('focus'"));
    const undo = esc.indexOf('urlInput.value !== TabManager.urlBarText(tab)');
    const stop = esc.indexOf('WebviewManager.stop()');
    const blur = esc.indexOf('urlInput.blur()');
    expect(undo).toBeGreaterThan(0);
    expect(stop).toBeGreaterThan(undo);
    expect(blur).toBeGreaterThan(stop);
  });
});
