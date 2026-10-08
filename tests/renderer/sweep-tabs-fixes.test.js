// @vitest-environment jsdom
//
// Tab fixes from the 2026-09-29 sweep: gestures that named a missing method or
// hit the duplicate guard, "Close Tabs to the Right" in list order rather than
// screen order, split panes slept as if hidden, a mute on an unloaded tab that
// went nowhere, snoozed tabs coming back twice, an archiver that ignored its
// Off switch, and sessions that loaded every page at once.

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

describe('mouse gestures', () => {
  it('↓← reopens the last closed tab, and ↑← makes a real copy', async () => {
    const { MouseGestures } = await import('../../src/renderer/js/gestures.js');
    const tab = fakeTab('a', { groupId: 'g1' });
    globalThis.TabManager = { getActiveTab: () => tab, reopenLastClosed: vi.fn(), createTab: vi.fn(), tabs: [tab] };
    MouseGestures.run('DL', {});
    expect(TabManager.reopenLastClosed).toHaveBeenCalledTimes(1);
    MouseGestures.run('UL', {});
    const [url, activate, groupId, opts] = TabManager.createTab.mock.calls[0];
    expect([url, activate, groupId]).toEqual(['https://a.example/', true, 'g1']);
    expect(opts.allowDuplicate).toBe(true);
    delete globalThis.TabManager;
  });
});

describe('Close Tabs to the Right follows the screen', () => {
  it('a tab pinned to the front has the others to its right', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('a'), fakeTab('b'), fakeTab('c', { pinned: true })];
    TM.groups = []; TM.stacks = [];
    TM.activeTabId = 'c';
    const closed = [];
    // They close together, with one Undo (closeTabsWithUndo).
    TM.closeTabsWithUndo = (ids) => closed.push(...ids);
    TM.closeTabsToTheRight('c');
    expect(closed).toEqual(['a', 'b']);
  });

  it('top strip draws loose tabs before groups; the sidebar draws groups first', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('g', { groupId: 'G' }), fakeTab('l')];
    TM.groups = [{ id: 'G', name: 'G' }]; TM.stacks = [];
    expect(TM.displayOrder().map(t => t.id)).toEqual(['l', 'g']);
    document.body.dataset.tabLayout = 'vertical';
    expect(TM.displayOrder().map(t => t.id)).toEqual(['g', 'l']);
  });
});

describe('split-screen panes are on screen', () => {
  it('Sleep idle and a plain sleepTab spare every visible pane', async () => {
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('a'), fakeTab('b'), fakeTab('c')];
    TM.activeTabId = 'a';
    for (const t of TM.tabs) WebviewManager.createWebview(t);
    globalThis.SplitScreen = { active: true, panes: ['a', 'b'] };
    await TM.sleepAllInactive();
    expect(TM.tabs.map(t => !!t.sleeping)).toEqual([false, false, true]);
    await TM.sleepTab('b');
    expect(TM.tabs[1].sleeping).toBeFalsy();
  });
});

describe('muting a tab with no page', () => {
  it('is remembered, and put on the page when it is made', async () => {
    const TM = await loadTabManager();
    TM.renderTabUpdate = vi.fn();
    TM.tabs = [fakeTab('a'), fakeTab('b', { _lazy: true })];
    TM.activeTabId = 'a';
    TM.toggleMuteTab('b');
    expect(TM.tabs[1].muted).toBe(true);
    expect(window.showToast).toHaveBeenCalledWith('Tab muted');
    TM._materializeTab(TM.tabs[1]);
    const wv = WebviewManager.webviews.get('b');
    wv.dispatchEvent(new Event('dom-ready'));
    expect(wv.setAudioMuted).toHaveBeenCalledWith(true);
  });
});

describe('a snoozed tab reopened by hand', () => {
  it('drops its snooze, so it does not come back a second time', async () => {
    const TM = await loadTabManager();
    const { TabSnooze } = await import('../../src/renderer/js/tab-snooze.js');
    globalThis.TabSnooze = TabSnooze;
    localStorage.setItem(TabSnooze.KEY, JSON.stringify([{ id: 'sn1', url: 'https://x.example/', title: 'X', at: Date.now() + 1000 }]));
    localStorage.setItem('vex.recentlyClosed', JSON.stringify([{ url: 'https://x.example/', title: 'X' }]));
    TM.createTab = vi.fn();
    TM.reopenLastClosed();
    expect(TM.createTab).toHaveBeenCalledTimes(1);
    expect(TabSnooze.list()).toEqual([]);
  });

  it('checkDue does not open a page that is already open', async () => {
    const { TabSnooze } = await import('../../src/renderer/js/tab-snooze.js');
    globalThis.TabManager = { tabs: [fakeTab('x', { url: 'https://x.example/' })], createTab: vi.fn() };
    localStorage.setItem(TabSnooze.KEY, JSON.stringify([
      { id: 'sn1', url: 'https://x.example/', title: 'X', at: 1 },
      { id: 'sn2', url: 'https://y.example/', title: 'Y', at: 1 },
    ]));
    const back = TabSnooze.checkDue(10);
    expect(back.map(e => e.id)).toEqual(['sn2']);
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
    expect(TabSnooze.list()).toEqual([]);
    delete globalThis.TabManager;
  });

  it('archiving follows the Library setting, and does nothing when it is Off', async () => {
    const { TabSnooze } = await import('../../src/renderer/js/tab-snooze.js');
    const now = Date.now();
    globalThis.TabManager = { tabs: [fakeTab('old', { lastViewedAt: now - 8 * 86400000 })], activeTabId: 'other', closeTab: vi.fn() };
    globalThis.TabArchiver = { days: () => 0 };
    expect(TabSnooze.archiveIdle(now)).toEqual([]);
    globalThis.TabArchiver = { days: () => 14 };
    expect(TabSnooze.archiveIdle(now)).toEqual([]);
    globalThis.TabArchiver = { days: () => 7 };
    expect(TabSnooze.archiveIdle(now).map(t => t.id)).toEqual(['old']);
    delete globalThis.TabManager; delete globalThis.TabArchiver;
  });
});

describe('restoring a session', () => {
  it('makes lazy tabs, so only the one switched to loads', async () => {
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
    SessionManager.sessions = [{ id: 's1', name: 'S', tabs: [{ url: 'https://a.example/', title: 'A' }, { url: 'https://b.example/', title: 'B', pinned: true }], activeTabIndex: 1 }];
    await SessionManager.restoreSession('s1', false);
    expect(TabManager.createTab).not.toHaveBeenCalled();
    expect(made.map(t => t.title)).toEqual(['A', 'B']);
    expect(made[1].pinned).toBe(true);
    expect(TabManager.switchTab).toHaveBeenCalledWith('t1');
    delete globalThis.TabManager; delete window.VexTabPolicy;
  });
});
