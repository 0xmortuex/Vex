// @vitest-environment jsdom
//
// Tabs opened from a link go next to the tab they came from (1b0cfc6), but
// three other ways of opening one still put it at the far right (2026-10-10):
// Duplicate, "Open as tab" in Peek, and a link in a side panel. As in Chrome:
// a copy goes right after its original, in its group, with its Back and
// Forward list; a peeked page goes next to the tab it was peeked from; a link
// in a panel goes next to the tab in front. + and Ctrl+T still add at the end.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');
require('../../src/renderer/js/tab-policy.js');

const NAMED_PAGES = { one: 101, two: 102, three: 103, four: 104 };
const pageIdOf = (tabId) => NAMED_PAGES[tabId] || 200 + Number(String(tabId).replace(/\D/g, '') || 0);
function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  const webviews = new Map();
  globalThis.WebviewManager = {
    webviews,
    made: [],
    destroyWebview: vi.fn((id) => webviews.delete(id)),
    createWebview: vi.fn((tab) => {
      WebviewManager.made.push({ id: tab.id, history: tab.history });
      const el = document.createElement('div');
      el.getWebContentsId = () => pageIdOf(tab.id);
      webviews.set(tab.id, el);
    }),
    showWebview: vi.fn(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  globalThis.SplitScreen = undefined;
  globalThis.DuplicateTabs = undefined;
  globalThis.SiteRoutes = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  window.showToast = vi.fn();
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });
const web = (n) => ({ url: `https://two.example/${n}`, title: `Page ${n}` });

let TM;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="sidebar-wrap"><div id="tab-groups-container"></div><div id="tabs-list"></div></div><button id="btn-new-tab"></button>';
  document.body.dataset.tabLayout = 'horizontal';
  installGlobals();
  TM = await loadTabManager();
  globalThis.TabManager = TM;
  TM.persistTabs = vi.fn();
  TM.tabs = [tab('one'), tab('two'), tab('three'), tab('four')];
  TM.tabs.forEach(t => WebviewManager.createWebview(t));
  WebviewManager.made = [];
  TM.activeTabId = 'one';
});
const name = (t) => t.id.startsWith('tab-') ? t.url.replace(/^https:\/\/|\.example\/.*$/g, '') + '*' : t.id;
const order = () => TM.displayOrder().map(name);
const read = (f) => fs.readFileSync(path.resolve('src', f), 'utf8');

describe('Duplicate', () => {
  it('goes right after the original and is put in front', () => {
    TM.activeTabId = 'two';
    const copy = TM.duplicateTab(TM.tabs[1]);
    expect(order()).toEqual(['one', 'two', 'two*', 'three', 'four']);
    expect(TM.activeTabId).toBe(copy.id);
  });

  it('right after it even after links it opened, as Chrome does', () => {
    TM.activeTabId = 'two';
    TM.createTab('https://a.example/', false, null, { openerTabId: 'two' });
    TM.createTab('https://b.example/', false, null, { openerTabId: 'two' });
    TM.duplicateTab(TM.tabs.find(t => t.id === 'two'));
    expect(order()).toEqual(['one', 'two', 'two*', 'a*', 'b*', 'three', 'four']);
  });

  it('in the same group, right after the original', () => {
    TM.groups = [{ id: 'g1', name: 'G', color: '#aaa' }];
    TM.tabs = [tab('one'), tab('two', { groupId: 'g1' }), tab('three', { groupId: 'g1' }), tab('four')];
    const copy = TM.duplicateTab(TM.tabs[1]);
    expect(copy.groupId).toBe('g1');
    expect(order()).toEqual(['one', 'four', 'two', 'two*', 'three']);
  });

  it('a pinned tab\'s copy is pinned, right after it', () => {
    TM.tabs = [tab('p1', { pinned: true }), tab('p2', { pinned: true }), tab('one'), tab('two')];
    const copy = TM.duplicateTab(TM.tabs[0]);
    expect(copy.pinned).toBe(true);
    expect(order()).toEqual(['p1', 'p1*', 'p2', 'one', 'two']);
  });

  it('keeps the original\'s Back and Forward list', () => {
    const list = { entries: [web(1), web(2), web(3)], index: 1 };
    TM.tabs[1].history = list;
    const copy = TM.duplicateTab(TM.tabs[1]);
    expect(WebviewManager.made.find(m => m.id === copy.id).history).toEqual(list);
  });

  it('is a real copy even with "switch to a page already open" on', () => {
    globalThis.DuplicateTabs = { match: (tabs, url) => tabs.find(t => t.url === url), announce: vi.fn() };
    const copy = TM.duplicateTab(TM.tabs[1]);
    expect(copy.id).not.toBe('two');
    expect(TM.tabs).toHaveLength(5);
  });

  it('a tab that is no longer there is an error, not a silent no-op', () => {
    expect(() => TM.duplicateTab(null)).toThrow();
  });

  it('every way to duplicate goes through it: the tab menu, Ctrl+K, the page menu, the gesture', () => {
    expect(read('renderer/js/tabs.js')).toMatch(/label: 'Duplicate', action: \(\) => this\.duplicateTab\(tab\)/);
    expect(read('renderer/js/command.js')).toMatch(/id: 'duplicatetab'[^\n]*TabManager\.duplicateTab\(t\)/);
    expect(read('renderer/js/webview.js')).toMatch(/label: 'Duplicate Tab'[^\n]*TabManager\.duplicateTab\(t\)/);
    expect(read('renderer/js/gestures.js')).toMatch(/'UL': [^\n]*TabManager\.duplicateTab\(t\)/);
    for (const f of ['renderer/js/tabs.js', 'renderer/js/command.js', 'renderer/js/webview.js', 'renderer/js/gestures.js']) {
      expect(read(f)).not.toMatch(/serialize\((t|tab)\) \|\| (t|tab)\), allowDuplicate: true/);
    }
  });
});

describe('a link in a side panel', () => {
  const panelPage = () => {
    const wv = document.createElement('webview');
    wv.getWebContentsId = () => 900;
    document.body.appendChild(wv);
  };

  it('a web panel\'s page (Discord, a sidebar site) counts the tab in front as its opener', () => {
    panelPage();
    TM.activeTabId = 'two';
    expect(TM.openerForPage(900).id).toBe('two');
    expect(TM.openerForPage(pageIdOf('three')).id).toBe('three');   // a tab's own page is itself
    expect(TM.openerForPage(555)).toBeNull();                         // not a page of this window
  });

  it('opens next to the tab in front, in its group, in the order clicked', () => {
    TM.groups = [{ id: 'g1', name: 'G', color: '#aaa' }];
    TM.tabs[1].groupId = 'g1';
    TM.activeTabId = 'two';
    const a = TM.createTabBesideActive('https://a.example/', false);
    TM.createTabBesideActive('https://b.example/', false);
    expect(a.groupId).toBe('g1');
    expect(order()).toEqual(['one', 'three', 'four', 'two', 'a*', 'b*']);
  });

  it('the window takes a panel page\'s link as next to the tab in front', () => {
    const app = read('renderer/js/app.js');
    expect(app).toContain('TabManager.openerForPage(data.opener)');
    expect(app).toContain('openerTabId: linked ? linked.id : null');
  });

  it('the AI panel and notes open their links beside the tab in front', () => {
    const ai = read('renderer/js/ai-panel.js');
    expect(ai).toMatch(/a\.vex-md-link[\s\S]{0,200}TabManager\.createTabBesideActive\(a\.href, true\)/);
    expect(ai).toMatch(/for \(const u of links\.slice\(0, 5\)\) TabManager\.createTabBesideActive\(u, false\)/);
    const notes = read('renderer/js/notes-panel.js');
    expect(notes).toMatch(/TabManager\.createTabBesideActive\(src\.dataset\.sourceUrl, true\)/);
    expect(notes).toMatch(/TabManager\.createTabBesideActive\(a\.href, true\)/);
  });

  it('"Open Link in New Tab" in a panel\'s page counts the tab in front', () => {
    expect(read('renderer/js/webview.js')).toMatch(/label: 'Open Link in New Tab',[\s\S]{0,400}const from = isTab \? TabManager\.tabs\.find\(t => t\.id === webview\.dataset\.tabId\) : TabManager\.getActiveTab\(\);/);
  });
});

describe('Peek "Open as tab"', () => {
  async function loadPeek() { return (await import('../../src/renderer/js/peek.js')).VexPeek; }

  it('goes next to the tab the link was peeked from, in its group', async () => {
    const VexPeek = await loadPeek();
    TM.groups = [{ id: 'g1', name: 'G', color: '#aaa' }];
    TM.tabs[2].groupId = 'g1';
    TM.activeTabId = 'one';
    VexPeek.open('https://peeked.example/', 'persist:main', pageIdOf('three'));
    VexPeek.promote();
    const made = TM.tabs.find(t => t.url === 'https://peeked.example/');
    expect(made.groupId).toBe('g1');
    expect(order()).toEqual(['one', 'two', 'four', 'three', 'peeked*']);
  });

  it('peeked from a panel or the command (no tab of its own), next to the tab in front', async () => {
    const VexPeek = await loadPeek();
    TM.activeTabId = 'two';
    VexPeek.open('https://peeked.example/');
    VexPeek.promote();
    expect(order()).toEqual(['one', 'two', 'peeked*', 'three', 'four']);
  });

  it('main names the page Peek was opened from, for the overlay and the sign-in popup\'s bar', () => {
    const main = read('main.js');
    expect(main).toMatch(/send\('peek:open', \{ url, partition: openerPartition, opener: contents\.id \}\)/);
    expect(main).toMatch(/action === 'open-as-tab'[\s\S]{0,700}opener: win\._vexOpenerPageId/);
    expect(read('renderer/js/peek.js')).toContain('this.open(data.url, data.partition, data.opener)');
  });
});

describe('a tab from nowhere still goes at the end', () => {
  it('+ / Ctrl+T, another app\'s link', () => {
    TM.createTab('https://new.example/', false);
    expect(order()).toEqual(['one', 'two', 'three', 'four', 'new*']);
  });
});
