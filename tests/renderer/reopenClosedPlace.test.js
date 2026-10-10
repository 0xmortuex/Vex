// @vitest-environment jsdom
//
// Reopen Closed Tab (Ctrl+Shift+T) put the tab at the far end, and outside its
// group when the group had gone with it (found 2026-10-10). In a private
// window it had nothing to reopen at all, since nothing there is written down.
import { describe, it, expect, vi, beforeEach } from 'vitest';

window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');

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
    createWebview: vi.fn((tab) => { webviews.set(tab.id, document.createElement('div')); }),
    showWebview: vi.fn(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  for (const k of ['HorizontalTabs', 'TabGrouper', 'SplitScreen', 'DuplicateTabs', 'SiteRoutes', 'TabTrail', 'TabSnooze']) globalThis[k] = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  window.showToast = vi.fn();
}
async function load(search = '') {
  vi.resetModules();
  window.history.replaceState(null, '', '/index.html' + search);
  delete window.VexTabPolicy;
  await import('../../src/renderer/js/tab-policy.js');
  await import('../../src/renderer/js/vex-utils.js');
  const TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
  globalThis.TabManager = TM;
  TM.persistTabs = vi.fn();
  return TM;
}
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });
const urls = (TM) => TM.tabs.map(t => t.url.replace(/^https:\/\/|\.example\/$/g, ''));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div><button id="btn-new-tab"></button>';
  document.body.dataset.tabLayout = 'horizontal';
  installGlobals();
});

describe('Reopen Closed Tab', () => {
  it('puts the tab back where it was', async () => {
    const TM = await load();
    TM.tabs = [tab('a'), tab('b'), tab('c'), tab('d')];
    TM.activeTabId = 'a';
    TM.closeTab('b');
    TM.reopenLastClosed();
    expect(urls(TM)).toEqual(['a', 'b', 'c', 'd']);
    expect(TM.getActiveTab().url).toBe('https://b.example/');
  });

  it('makes its group again, as it was, when the group went with it', async () => {
    const TM = await load();
    TM.groups = [{ id: 'g', name: 'Shopping', color: '#e8685a', collapsed: false }];
    TM.tabs = [tab('a'), tab('s', { groupId: 'g' }), tab('c')];
    TM.activeTabId = 'a';
    TM.closeTab('s');
    expect(TM.groups).toEqual([]);   // its last tab: the group went with it
    TM.reopenLastClosed();
    const back = TM.getActiveTab();
    expect(back.groupId).toBe('g');
    expect(TM.groups).toEqual([{ id: 'g', name: 'Shopping', color: '#e8685a', collapsed: false }]);
    expect(urls(TM)).toEqual(['a', 's', 'c']);
  });

  it('opens a collapsed group it goes back into, so the tab is seen', async () => {
    const TM = await load();
    TM.groups = [{ id: 'g', name: 'G', color: '#aaa', collapsed: false }];
    TM.tabs = [tab('a'), tab('g1', { groupId: 'g' }), tab('g2', { groupId: 'g' })];
    TM.activeTabId = 'a';
    TM.closeTab('g2');
    TM.groups[0].collapsed = true;
    TM.reopenLastClosed();
    expect(TM.getActiveTab().groupId).toBe('g');
    expect(TM.groups[0].collapsed).toBe(false);
  });

  it('works in a private window, from memory only', async () => {
    const TM = await load('?private=true&partition=otr-123');
    expect(window.VexTabPolicy.isPrivateWindow).toBe(true);
    TM.tabs = [tab('a', { partition: 'otr-123' }), tab('b', { partition: 'otr-123' }), tab('c', { partition: 'otr-123' })];
    TM.activeTabId = 'a';
    TM.closeTab('b');
    expect(localStorage.getItem('vex.recentlyClosed')).toBeNull();
    TM.reopenLastClosed();
    expect(urls(TM)).toEqual(['a', 'b', 'c']);
    expect(TM.getActiveTab().partition).toBe('otr-123');
  });
});
