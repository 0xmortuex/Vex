// @vitest-environment jsdom
//
// Tab fixes from the second 2026-09-29 sweep: window controls that a narrow
// window pushed off screen, the sidebar's pinned row drawn below the groups,
// Sleep Tab blanking or skipping a split pane, a side list that never scrolled
// to the tab in front, "Move to group" on a pinned tab doing nothing, a
// collapsed group taking the active tab with it, private tabs "snoozed" and
// private windows "saved", and tab notes lost by a session restore.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
const menuLabels = () => [...document.querySelectorAll('.tab-context-menu > *')].map(e => e.textContent.trim()).filter(Boolean);
const clickMenu = (label) => [...document.querySelectorAll('.tab-context-menu > *')].find(e => e.textContent.trim() === label).click();

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `<input id="url-input"><div id="tabs-sidebar"><div id="tab-groups-container"></div><div id="tabs-list"></div></div><button id="btn-new-tab"></button>`;
  document.body.dataset.tabLayout = 'vertical';
  installGlobals();
});
afterEach(() => { delete window.VexTabPolicy; });

describe('window controls stay on screen', () => {
  it('live on the top bar itself in Classic, the tab strip in Glass, the right cluster in Safari', async () => {
    document.body.innerHTML = '<div id="top-bar"><div id="top-bar-right"></div><div id="window-controls"></div></div><div id="top-tab-bar"><div class="tab-bar-trailing"></div></div>';
    vi.resetModules();
    await import('../../src/renderer/js/gui-style.js');
    const G = window.VexGuiStyle;
    const parent = () => document.getElementById('window-controls').parentElement;
    await G.set('glass');
    expect(parent().className).toBe('tab-bar-trailing');
    await G.set('safari');
    expect(parent().id).toBe('top-bar-right');
    await G.set('classic');
    expect(parent().id).toBe('top-bar');
  });
});

describe('the sidebar draws pinned tabs first, as displayOrder counts them', () => {
  it('puts the pinned row above the groups', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('g', { groupId: 'G' }), fakeTab('p', { pinned: true }), fakeTab('l')];
    TM.groups = [{ id: 'G', name: 'G', color: '#f00', collapsed: false }]; TM.stacks = [];
    TM.activeTabId = 'l';
    TM.rebuildAllTabs();
    const kids = [...document.getElementById('tabs-sidebar').children].map(e => e.id || e.className);
    expect(kids).toEqual(['pinned-tabs-container', 'tab-groups-container', 'tabs-list']);
    expect(TM.displayOrder()[0].id).toBe('p');
  });
});

describe('Sleep Tab and split view', () => {
  it('the tab menu does not offer to sleep a tab showing in a split pane', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('a'), fakeTab('b'), fakeTab('c')];
    TM.groups = []; TM.stacks = [];
    TM.activeTabId = 'a';
    globalThis.SplitScreen = { active: true, panes: ['a', 'b'] };
    TM.showContextMenu({ clientX: 10, clientY: 10 }, TM.tabs[1]);
    expect(menuLabels()).not.toContain('Sleep Tab');
    TM.showContextMenu({ clientX: 10, clientY: 10 }, TM.tabs[2]);
    expect(menuLabels()).toContain('Sleep Tab');
  });

  it('Sleep Tab on the tab in front refuses in split view instead of switching panes', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('a'), fakeTab('b'), fakeTab('c')];
    TM.groups = []; TM.stacks = [];
    TM.activeTabId = 'a';
    globalThis.SplitScreen = { active: true, panes: ['a', 'b'] };
    TM.switchTab = vi.fn();
    expect(await TM.sleepActiveTab()).toBe(false);
    expect(TM.switchTab).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('This tab is on screen in split view — close the split first');
  });
});

describe('the side list scrolls to the tab in front', () => {
  it('scrolls only the list that holds it', async () => {
    const TM = await loadTabManager();
    const list = document.getElementById('tabs-list');
    list.style.overflowY = 'auto';
    const el = document.createElement('div');
    el.className = 'tab-item'; el.dataset.tabId = 'far';
    list.appendChild(el);
    let top = 0;
    Object.defineProperty(list, 'scrollHeight', { value: 2000 });
    Object.defineProperty(list, 'clientHeight', { value: 100 });
    Object.defineProperty(list, 'scrollTop', { get: () => top, set: (v) => { top = v; } });
    list.getBoundingClientRect = () => ({ top: 50, bottom: 150 });
    el.getBoundingClientRect = () => ({ top: 900, bottom: 930 });
    el.getClientRects = () => [{}];
    TM.activeTabId = 'far';
    TM._revealActiveInSidebar();
    expect(top).toBe(780);
    document.body.dataset.tabLayout = 'horizontal';
    top = 0;
    TM._revealActiveInSidebar();
    expect(top).toBe(0);
  });

  it('switching tabs and rebuilding the list both reveal it', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('a'), fakeTab('b')];
    TM.groups = []; TM.stacks = [];
    TM.activeTabId = 'a';
    const spy = vi.spyOn(TM, '_revealActiveInSidebar');
    TM.rebuildAllTabs();
    TM.switchTab('b');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('grouping a pinned tab', () => {
  it('"Move to" unpins it so it shows in the group', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('p', { pinned: true }), fakeTab('g', { groupId: 'G' })];
    TM.groups = [{ id: 'G', name: 'Work', color: '#f00', collapsed: false }]; TM.stacks = [];
    TM.activeTabId = 'g';
    TM.showContextMenu({ clientX: 10, clientY: 10 }, TM.tabs[0]);
    clickMenu('Move to Work');
    expect(TM.tabs[0]).toMatchObject({ pinned: false, groupId: 'G' });
  });

  it('"Add to new group" unpins it too', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('p', { pinned: true }), fakeTab('l')];
    TM.groups = []; TM.stacks = [];
    TM.activeTabId = 'l';
    TM._promptInput = vi.fn(async () => 'Reading');
    await TM._newGroupFromTab(TM.tabs[0]);
    expect(TM.tabs[0].pinned).toBe(false);
    expect(TM.tabs[0].groupId).toBe(TM.groups[0].id);
  });
});

describe('collapsing the group of the tab in front', () => {
  it('moves to the next tab on screen outside it', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('g1', { groupId: 'G' }), fakeTab('g2', { groupId: 'G' }), fakeTab('l')];
    TM.groups = [{ id: 'G', name: 'G', color: '#f00', collapsed: false }]; TM.stacks = [];
    TM.activeTabId = 'g1';
    TM.rebuildAllTabs();
    TM.switchTab = vi.fn();
    document.querySelector('.tab-group-header').click();
    expect(TM.groups[0].collapsed).toBe(true);
    expect(TM.switchTab).toHaveBeenCalledWith('l');
  });

  it('goes back to the tab before it when nothing follows (top strip order)', async () => {
    const TM = await loadTabManager();
    document.body.dataset.tabLayout = 'horizontal';
    TM.tabs = [fakeTab('g1', { groupId: 'G' }), fakeTab('l')];
    TM.groups = [{ id: 'G', name: 'G', collapsed: false }]; TM.stacks = [];
    TM.activeTabId = 'g1';
    TM.switchTab = vi.fn();
    TM._leaveGroupBeforeCollapse('G');
    expect(TM.switchTab).toHaveBeenCalledWith('l');
  });

  it('opens a new tab when every tab is in the group, and leaves other groups alone', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('g1', { groupId: 'G' }), fakeTab('h', { groupId: 'H' })];
    TM.groups = [{ id: 'G', name: 'G', collapsed: false }, { id: 'H', name: 'H', collapsed: true }]; TM.stacks = [];
    TM.activeTabId = 'g1';
    TM.switchTab = vi.fn(); TM.createTab = vi.fn();
    TM._leaveGroupBeforeCollapse('G');
    expect(TM.switchTab).not.toHaveBeenCalled();
    expect(TM.createTab).toHaveBeenCalledTimes(1);
    TM.activeTabId = 'h';
    TM._leaveGroupBeforeCollapse('G');
    expect(TM.createTab).toHaveBeenCalledTimes(1);
  });
});

describe('a private window keeps nothing', () => {
  it('snoozing a private tab refuses and leaves it open', async () => {
    const { TabSnooze } = await import('../../src/renderer/js/tab-snooze.js');
    const tab = fakeTab('x', { partition: 'private-1' });
    globalThis.TabManager = { tabs: [tab], closeTab: vi.fn() };
    window.VexTabPolicy = { canPersist: () => false };
    expect(TabSnooze.canSnooze(tab)).toBe(false);
    expect(() => TabSnooze.snooze('x', 'hour')).toThrow(/private tab cannot be snoozed/);
    expect(TabManager.closeTab).not.toHaveBeenCalled();
    expect(TabSnooze.list()).toEqual([]);
    window.VexTabPolicy = { canPersist: () => true };
    expect(TabSnooze.canSnooze(tab)).toBe(true);
    delete globalThis.TabManager;
  });

  it('the snooze rows are not in a private tab\'s menu', async () => {
    const TM = await loadTabManager();
    const { TabSnooze } = await import('../../src/renderer/js/tab-snooze.js');
    globalThis.TabSnooze = TabSnooze;
    window.VexTabPolicy = { canPersist: () => false };
    TM.tabs = [fakeTab('a'), fakeTab('b')];
    TM.groups = []; TM.stacks = [];
    TM.activeTabId = 'a';
    TM.showContextMenu({ clientX: 10, clientY: 10 }, TM.tabs[1]);
    expect(menuLabels().some(l => /Snooze/.test(l))).toBe(false);
  });

  it('saving a session in a private window says so instead of saving nothing', async () => {
    const { SessionManager } = await import('../../src/renderer/js/sessions.js');
    globalThis.TabManager = { tabs: [fakeTab('a')], groups: [], activeTabId: 'a' };
    window.VexTabPolicy = { isPrivateWindow: true, snapshot: () => [] };
    SessionManager.sessions = [];
    SessionManager.renderList = vi.fn();
    expect(() => SessionManager.saveCurrentSession('S')).toThrow(/private window is never saved/);
    expect(SessionManager.sessions).toEqual([]);
    expect(window.showToast).not.toHaveBeenCalled();
    delete globalThis.TabManager;
  });
});

describe('restoring a session', () => {
  it('keeps each tab\'s note', async () => {
    const { SessionManager } = await import('../../src/renderer/js/sessions.js');
    const made = [];
    globalThis.TabManager = {
      tabs: [], groups: [],
      createTab: vi.fn(),
      createLazyTab: vi.fn((url, groupId, title, opts) => { const t = { id: 't' + made.length, url, title, ...opts, _lazy: true }; made.push(t); TabManager.tabs.push(t); return t; }),
      _persistableFavicon: (f) => f || null,
      renderTabUpdate: vi.fn(), switchTab: vi.fn(), persistTabs: vi.fn(async () => {}),
      _isKeptAwake: () => false, _materializeTab: vi.fn(),
    };
    window.VexTabPolicy = { canRestore: () => true };
    SessionManager.hideOverlay = vi.fn();
    SessionManager.sessions = [{ id: 's1', name: 'S', tabs: [{ url: 'https://a.example/', title: 'A', note: 'read the second half' }, { url: 'https://b.example/', title: 'B' }], activeTabIndex: 0 }];
    await SessionManager.restoreSession('s1', false);
    expect(made[0].note).toBe('read the second half');
    expect(made[1].note).toBeUndefined();
    delete globalThis.TabManager;
  });
});
