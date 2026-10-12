// @vitest-environment jsdom
//
// Sleeping a tab, reopening a closed one and restoring tabs at start lost the
// tab's Back/Forward list (audit B4, 2026-10-10). The window side: the list is
// read off the page after each navigation, kept and saved with the tab, and
// handed to main whenever the tab's page is made again. The main side is in
// tests/main/tabBackListKept.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';

window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');
require('../../src/renderer/js/tab-policy.js');

const web = (n) => ({ url: `https://site.example/${n}`, title: `Page ${n}` });
const LIST = { entries: [web(1), web(2), web(3)], index: 1 };

describe('the saved tab keeps its list where asked, and nowhere else', () => {
  const policy = window.VexTabPolicy;
  const tab = { id: 'tab-1', url: web(2).url, title: 'Page 2', history: LIST };
  it('the saved session, the recently closed list and Undo ask for it', () => {
    expect(policy.serialize(tab, { history: true }).history).toEqual(LIST);
    expect(policy.snapshot([tab], { history: true })[0].history).toEqual(LIST);
  });
  it('sync, saved sessions and workspaces do not', () => {
    expect('history' in policy.serialize(tab)).toBe(false);
    expect('history' in policy.snapshot([tab])[0]).toBe(false);
  });
  it('a tab with no list, or a malformed one, saves no field at all', () => {
    expect('history' in policy.serialize({ ...tab, history: null }, { history: true })).toBe(false);
    expect('history' in policy.serialize({ ...tab, history: { entries: [web(1)], index: 0 } }, { history: true })).toBe(false);
    expect('history' in policy.serialize({ ...tab, history: { entries: [web(1), web(2)], index: 5 } }, { history: true })).toBe(false);
  });
  it('is small: at most a dozen pages, about 2 KB for ordinary news addresses', () => {
    const pages = Array.from({ length: 12 }, (_, n) => ({
      url: `https://www.example-news.com/world/2026/10/10/a-fairly-long-article-slug-number-${n}?ref=home`,
      title: `A fairly ordinary article headline about something, number ${n}`,
    }));
    const bytes = JSON.stringify(policy.serialize({ ...tab, history: { entries: pages, index: 11 } }, { history: true })).length
      - JSON.stringify(policy.serialize(tab)).length;
    expect(bytes).toBeLessThan(2200);
  });
  it('passes the saved-tab contract main checks it with', () => {
    const { assertTabs } = require('../../src/main/contracts.js');
    const saved = policy.snapshot([tab], { history: true });
    expect(() => window.VexDataContracts.storage('tabs', saved)).not.toThrow();
    expect(() => assertTabs(saved)).not.toThrow();
  });
});

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
      el.setAudioMuted = vi.fn(); el.isAudioMuted = () => false;
      el.executeJavaScript = vi.fn(async () => null);
      el.getWebContentsId = () => 1;
      el.remove = vi.fn();
      webviews.set(tab.id, el);
    }),
    showWebview: vi.fn(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  globalThis.SplitScreen = undefined;
  globalThis.TabSnooze = undefined;
  globalThis.DuplicateTabs = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}), tabMemory: vi.fn(async () => ({ totalKB: 0, byId: {} })), tabClosed: vi.fn() };
  window.showToast = vi.fn();
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }

describe('every way a tab\'s page is made again hands over its list', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div><button id="btn-new-tab"></button>';
    document.body.dataset.tabLayout = 'horizontal';
    installGlobals();
  });

  it('sleep and wake', async () => {
    const TM = await loadTabManager();
    TM.persistTabs = vi.fn();
    TM.tabs = [{ id: 'a', url: web(2).url, title: 'A', history: LIST }, { id: 'b', url: web(9).url, title: 'B' }];
    TM.tabs.forEach(t => WebviewManager.createWebview(t));
    TM.activeTabId = 'b';
    await TM.sleepTab('a', true);
    expect(TM.tabs[0].sleeping).toBe(true);
    expect(window.VexTabPolicy.serialize(TM.tabs[0], { history: true }).history).toEqual(LIST);   // saved while asleep
    TM.wakeTab('a');
    expect(WebviewManager.made.at(-1)).toEqual({ id: 'a', history: LIST });
  });

  it('close and reopen (Ctrl+Shift+T)', async () => {
    const TM = await loadTabManager();
    TM.persistTabs = vi.fn();
    TM.tabs = [{ id: 'a', url: web(2).url, title: 'A', history: LIST, partition: 'persist:main' }, { id: 'b', url: web(9).url, title: 'B' }];
    TM.tabs.forEach(t => WebviewManager.createWebview(t));
    TM.activeTabId = 'b';
    TM.closeTab('a');
    expect(JSON.parse(localStorage.getItem('vex.recentlyClosed'))[0].history).toEqual(LIST);
    const tab = TM.reopenLastClosed() ?? TM.tabs.find(t => t.url === web(2).url);
    expect(tab.history).toEqual(LIST);
    expect(WebviewManager.made.at(-1).history).toEqual(LIST);
  });

  it('restore at start, awake or asleep; a tab saved before lists were kept restores as before', async () => {
    const TM = await loadTabManager();
    const lazy = TM._savedTabRecord({ id: 'a', url: web(2).url, title: 'A', history: LIST }, 'a');
    const asleep = TM._savedTabRecord({ id: 'b', url: web(2).url, title: 'B', sleeping: true, history: LIST }, 'b');
    const old = TM._savedTabRecord({ id: 'c', url: web(7).url, title: 'C' }, 'c');
    expect(lazy.history).toEqual(LIST);
    expect(asleep.history).toEqual(LIST);
    expect(old.history).toBeNull();
    expect(old.url).toBe(web(7).url);
    expect(old._lazy).toBe(true);
  });
});

describe('the webview side', () => {
  let WebviewManager, tab, carried, asked;
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="webviews-container"></div><input id="url-input">';
    require('../../src/renderer/js/vex-utils.js');
    ({ WebviewManager } = require('../../src/renderer/js/webview.js'));
    WebviewManager.webviews.clear();
    tab = { id: 't1', url: web(2).url, title: 'Page 2', partition: 'persist:main', history: LIST };
    carried = [];
    asked = [];
    globalThis.isStartPage = () => false;
    globalThis.TabManager = { tabs: [tab], activeTabId: 't1', updateTab: vi.fn(), renderTabUpdate: vi.fn(), windowMayAsk: () => true, persistTabs: vi.fn() };
    globalThis.VexStorage = { addHistory: vi.fn(async () => true) };
    window.vex = {
      carryTabHistory: vi.fn((token, partition, list) => carried.push({ token, partition, list })),
      tabHistory: vi.fn(async (id) => { asked.push(id); return { entries: [web(2), web(4)], index: 1 }; }),
    };
  });

  it('a page made for a tab with a list carries it to main and names it', () => {
    WebviewManager.createWebview(tab);
    const wv = WebviewManager.webviews.get('t1');
    expect(carried).toHaveLength(1);
    expect(carried[0].partition).toBe('persist:main');
    expect(carried[0].list).toEqual(LIST);
    expect(wv.getAttribute('webpreferences')).toContain(',vexHistoryFrom=' + carried[0].token);
    expect(carried[0].token).toMatch(/^c\d+$/);
  });

  it('a JavaScript-off tab built again still names its old page instead', () => {
    tab._historyFrom = 42;
    WebviewManager.createWebview(tab);
    expect(carried).toHaveLength(0);
    expect(WebviewManager.webviews.get('t1').getAttribute('webpreferences')).toContain(',vexHistoryFrom=42');
  });

  it('after a navigation the tab keeps the list main reads off the page', async () => {
    tab.history = null;
    WebviewManager.createWebview(tab);
    const wv = WebviewManager.webviews.get('t1');
    wv.getWebContentsId = () => 77;
    const e = new Event('did-navigate'); e.url = web(4).url;
    wv.dispatchEvent(e);
    await new Promise(r => setTimeout(r, 0));
    expect(asked).toEqual([77]);
    expect(tab.history).toEqual({ entries: [web(2), web(4)], index: 1 });
    expect(TabManager.persistTabs).toHaveBeenCalled();
  });

  it('a list that arrives after the tab slept is not kept over the one it slept with', async () => {
    WebviewManager.createWebview(tab);
    const wv = WebviewManager.webviews.get('t1');
    wv.getWebContentsId = () => 77;
    const e = new Event('did-navigate-in-page'); e.url = web(2).url + '#x'; e.isMainFrame = true;
    wv.dispatchEvent(e);
    WebviewManager.webviews.delete('t1');   // slept
    await new Promise(r => setTimeout(r, 0));
    expect(tab.history).toEqual(LIST);
  });
});
