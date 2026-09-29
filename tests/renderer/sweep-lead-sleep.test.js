// @vitest-environment jsdom
//
// "Sleep Tab" (Ctrl+Shift+Z, Ctrl+K) means the tab in front, which sleepTab
// never touches, so it did nothing at all (found 2026-09-29).

import { describe, it, expect, vi, beforeEach } from 'vitest';

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  const webviews = new Map();
  globalThis.WebviewManager = {
    webviews,
    destroyWebview: vi.fn((id) => webviews.delete(id)),
    createWebview: vi.fn((tab) => {
      const el = document.createElement('div');
      el.setAudioMuted = vi.fn();
      el.isAudioMuted = () => false;
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
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}), tabMemory: vi.fn(async () => ({ totalKB: 0, byId: {} })) };
  window.showToast = vi.fn();
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
function fakeTab(id, over = {}) { return { id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over }; }

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div><button id="btn-new-tab"></button>`;
  document.body.dataset.tabLayout = 'horizontal';
  installGlobals();
});

describe('Sleep Tab on the tab in front', () => {
  it('moves to the tab beside it and puts it to sleep', async () => {
    const TabManager = await loadTabManager();
    TabManager.tabs = [fakeTab('a'), fakeTab('b'), fakeTab('c')];
    for (const t of TabManager.tabs) WebviewManager.createWebview(t);
    TabManager.activeTabId = 'b';
    TabManager.switchTab = vi.fn((id) => { TabManager.activeTabId = id; });
    TabManager.persistTabs = vi.fn();
    TabManager.render = vi.fn();
    TabManager.renderTabUpdate = vi.fn();
    expect(await TabManager.sleepActiveTab()).toBe(true);
    expect(TabManager.activeTabId).toBe('c');
    expect(TabManager.tabs.find(t => t.id === 'b').sleeping).toBe(true);
  });

  it('says why when there is no other tab to move to', async () => {
    const TabManager = await loadTabManager();
    TabManager.tabs = [fakeTab('only')];
    TabManager.activeTabId = 'only';
    expect(await TabManager.sleepActiveTab()).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/another tab/));
  });
});
