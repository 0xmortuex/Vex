// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
// readlater.js resolves window.CollectionStore, which index.html loads first.
import '../../src/renderer/js/collection-store.js';

let TM, SM, WM, snapshots;
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '<div id="tabs-list"></div><div id="tab-groups-container"></div><input id="url-input"><button id="btn-new-tab"></button>';
  window.vex = {};
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), loadGroups: vi.fn(async () => []), loadStacks: vi.fn(async () => []),
    saveTabs: vi.fn(async () => true), saveGroups: vi.fn(async () => true), saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = { webviews: new Map(), createWebview: vi.fn(), destroyWebview: vi.fn(), showWebview: vi.fn() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.START_URL = 'vex://start';
  await import('../../src/renderer/js/vex-utils.js');
  await import('../../src/renderer/js/tab-policy.js');
  TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
  globalThis.TabManager = TM;
  SM = (await import('../../src/renderer/js/sessions.js')).SessionManager;
  WM = (await import('../../src/renderer/js/workspaces.js')).WorkspaceManager;
  globalThis.WorkspaceManager = WM;
  snapshots = (await import('../../src/renderer/js/workspace-snapshots.js')).WorkspaceSnapshots;
});

function seedTabs() {
  return [null, 'tor-secret', 'otr-secret', 'persist:container-work'].map((partition, i) => ({
    id: `t${i}`, url: `https://example.org/${i}`, title: `Page ${i}`, partition, groupId: null,
  }));
}

describe('private tab persistence boundaries', () => {
  it('uses the same complete tab snapshot across saved sessions and workspaces', () => {
    TM.tabs = [{ ...seedTabs()[3], pinned: true, favicon: 'https://example.org/icon.png', stackId: 'stack', keepAwakeUntil: 12345 }];
    TM.activeTabId = 't3';
    WM.workspaces = [{ id: 'a' }]; WM.activeId = 'a';
    const session = SM.saveCurrentSession('Shared metadata');
    WM.saveCurrentState();
    const expected = window.VexTabPolicy.snapshot(TM.tabs);
    expect(session.tabs).toEqual(expected);
    expect(WM.getActive().tabs).toEqual(expected);
    expect(snapshots._currentTabs()).toEqual(expected);
  });

  it('excludes all tab snapshots in private windows even when a tab lacks a partition', async () => {
    window.history.replaceState({}, '', '/?private=true&partition=private-test');
    vi.resetModules();
    await import('../../src/renderer/js/tab-policy.js');
    TM.tabs = seedTabs();
    WM.workspaces = [{ id: 'a' }]; WM.activeId = 'a';
    expect(SM.saveCurrentSession('Private').tabs).toEqual([]);
    WM.saveCurrentState();
    expect(WM.getActive().tabs).toEqual([]);
    expect(snapshots._currentTabs()).toEqual([]);
  });
  it('auto-archive skips ephemeral tabs and keeps container identity', async () => {
    const { TabArchiver } = await import('../../src/renderer/js/readlater.js');
    TM.tabs = seedTabs().map(t => ({ ...t, _lastActive: Date.now() - 3 * 86400000 }));
    TM.activeTabId = 't0';
    TabArchiver.setDays(1); TabArchiver.sweep();
    expect(TabArchiver.list()).toHaveLength(1);
    expect(TabArchiver.list()[0].partition).toBe('persist:container-work');
    expect(TM.tabs.map(t => t.id)).toEqual(['t0', 't1', 't2']);
  });
  it('archives the shared metadata and skips private windows without explicit tab partitions', async () => {
    const { TabArchiver } = await import('../../src/renderer/js/readlater.js');
    TM.tabs = [{ ...seedTabs()[3], favicon: 'https://example.org/icon.png', scrollPosition: { x: 1, y: 24 }, keepAwakeUntil: 123, _lastActive: Date.now() - 3 * 86400000 }];
    TM.activeTabId = 'other';
    TabArchiver.setDays(1); TabArchiver.sweep();
    expect(TabArchiver.list()[0]).toMatchObject({ favicon: 'https://example.org/icon.png', scrollPosition: { x: 1, y: 24 }, keepAwakeUntil: 123 });
    const previous = TabArchiver.list();
    window.history.replaceState({}, '', '/?private=true&partition=private-test');
    vi.resetModules(); await import('../../src/renderer/js/tab-policy.js');
    TM.tabs = [{ ...seedTabs()[0], _lastActive: Date.now() - 3 * 86400000 }];
    TabArchiver.sweep();
    expect(TabArchiver.list()).toEqual(previous);
    expect(TM.tabs).toHaveLength(1);
  });
  it('reopens a closed tab with pinned, scroll and container metadata', () => {
    const record = { ...seedTabs()[3], pinned: true, scrollPosition: { x: 0, y: 99 }, groupId: 'removed-group' };
    localStorage.setItem('vex.recentlyClosed', JSON.stringify([record]));
    const create = vi.spyOn(TM, 'createTab').mockReturnValue({});
    TM.reopenLastClosed();
    expect(create).toHaveBeenCalledWith(record.url, true, null, record);
  });
  it('excludes ephemeral tabs from sessions, workspaces and automatic snapshots', () => {
    TM.tabs = seedTabs(); TM.activeTabId = 't3';
    const session = SM.saveCurrentSession('Test');
    WM.workspaces = [{ id: 'a' }]; WM.activeId = 'a'; WM.saveCurrentState();
    const snap = snapshots._currentTabs();
    for (const tabs of [session.tabs, WM.getActive().tabs, snap]) {
      expect(tabs.map(t => t.url)).toEqual(['https://example.org/0', 'https://example.org/3']);
      expect(tabs[1].partition).toBe('persist:container-work');
    }
    expect(session.activeTabIndex).toBe(1);
    expect(WM.getActive().activeTabIndex).toBe(1);
  });

  it('does not put closed Tor or off-the-record URLs in localStorage', () => {
    TM.tabs = seedTabs(); TM.activeTabId = 't0';
    TM.closeTab('t1'); TM.closeTab('t2');
    expect(localStorage.getItem('vex.recentlyClosed')).toBeNull();
  });

  it('reopens a container in its original partition', () => {
    TM.tabs = seedTabs(); TM.activeTabId = 't0';
    TM.closeTab('t3'); TM.reopenLastClosed();
    expect(TM.getActiveTab().partition).toBe('persist:container-work');
  });

  it('restores persisted partitions and the chosen stack top after IDs change', async () => {
    VexStorage.loadTabs.mockResolvedValue([
      { id: 'old1', url: 'https://a.test', stackId: 's', partition: 'persist:container-work' },
      { id: 'old2', url: 'https://b.test', stackId: 's', sleeping: true, partition: 'persist:container-other' },
    ]);
    VexStorage.loadStacks.mockResolvedValue([{ id: 's', topTabId: 'old2', name: 'Stack' }]);
    await TM.init();
    expect(TM.tabs.find(t => t.url === 'https://a.test').partition).toBe('persist:container-work');
    const top = TM.tabs.find(t => t.url === 'https://b.test');
    expect(top.partition).toBe('persist:container-other');
    expect(TM.stacks[0].topTabId).toBe(top.id);
  });
});

describe('session and workspace restoration', () => {
  it('applies synced tabs without discarding private tabs or retaining deleted public tabs', () => {
    TM.tabs = seedTabs(); TM.activeTabId = 't3';
    const keep = TM.tabs[3];
    TM.applySyncedState([{ ...keep, title: 'Synced title' }, { id: 'remote', url: 'https://remote.test', partition: 'persist:work' }], [], []);
    expect(TM.tabs.map(tab => tab.id)).toEqual(['t3', 'remote', 't1', 't2']);
    expect(TM.tabs[0].title).toBe('Synced title');
    expect(TM.getActiveTab().id).toBe('t3');
    expect(WebviewManager.destroyWebview).toHaveBeenCalledWith('t0');
  });
  it('uses stable globally unique IDs across restart', async () => {
    const created = TM.createTab('https://stable.test');
    VexStorage.loadTabs.mockResolvedValue([{ ...created }]);
    TM.tabs = []; await TM.init();
    expect(TM.tabs.find(tab => tab.url === 'https://stable.test').id).toBe(created.id);
    expect(TM.createTab('https://other.test').id).not.toBe(created.id);
  });
  it('skips unsafe legacy session records without shifting the selected tab', async () => {
    TM.createTab('https://existing.test');
    SM.sessions = [{ id: 's', name: 'Legacy', activeTabIndex: 2, tabs: [
      { url: 'javascript:alert(1)' },
      { url: 'https://first.test' },
      { url: 'https://selected.test', pinned: true, keepAwakeUntil: 12345 },
      { url: 'https://private.test', partition: 'otr-old' },
    ] }];
    await SM.restoreSession('s', false);
    expect(TM.tabs.map(t => t.url)).toEqual(['https://existing.test', 'https://first.test', 'https://selected.test']);
    expect(TM.getActiveTab()).toMatchObject({ url: 'https://selected.test', pinned: true, keepAwakeUntil: 12345 });
  });
  it('does not replace a remote start.html URL with the built-in Home page', () => {
    const tab = TM.createTab('https://example.org/start.html');
    expect(tab.url).toBe('https://example.org/start.html');
    TM.closeTab(tab.id);
    expect(JSON.parse(localStorage.getItem('vex.recentlyClosed'))[0].url).toBe('https://example.org/start.html');
  });
  it('activates a restored tab when merging into existing tabs', async () => {
    TM.createTab('https://existing.test');
    SM.sessions = [{ id: 's', name: 'Saved', tabs: [{ url: 'https://restored.test', partition: 'persist:container-work' }], activeTabIndex: 0 }];
    await SM.restoreSession('s', false);
    expect(TM.getActiveTab().url).toBe('https://restored.test');
    expect(TM.getActiveTab().partition).toBe('persist:container-work');
  });

  it('restoring an empty session leaves a usable Home tab', async () => {
    TM.createTab('https://existing.test');
    SM.sessions = [{ id: 's', name: 'Empty', tabs: [], groups: [] }];
    await SM.restoreSession('s');
    expect(TM.tabs).toHaveLength(1);
    expect(TM.getActiveTab()).toBeTruthy();
  });

  it('deleting the active workspace preserves the next workspace tabs and pins', async () => {
    TM.createTab('https://old.test');
    WM.activeId = 'a';
    WM.workspaces = [{ id: 'a', name: 'Old' }, { id: 'b', name: 'Keep', tabs: [{ url: 'https://keep.test', pinned: true, partition: 'persist:container-work' }] }];
    await WM.deleteWorkspace('a');
    expect(WM.workspaces.map(w => w.id)).toEqual(['b']);
    expect(TM.getActiveTab()).toMatchObject({ url: 'https://keep.test', pinned: true, partition: 'persist:container-work' });
  });

  it('saved session groups do not change when live groups are renamed', () => {
    TM.groups = [{ id: 'g', name: 'Original' }];
    const saved = SM.saveCurrentSession('Test');
    TM.groups[0].name = 'Renamed';
    expect(saved.groups[0].name).toBe('Original');
  });

  it('snapshot restore focuses the created tab by ID and restores pins', () => {
    TM.createTab('https://old.test');
    snapshots._save({ [WM.activeId]: [{ ts: 1, tabs: [{ url: 'https://snap.test', pinned: true, partition: 'persist:container-work' }] }] });
    snapshots.restore(1);
    expect(TM.getActiveTab()).toMatchObject({ url: 'https://snap.test', pinned: true, partition: 'persist:container-work' });
  });
});

describe('structured storage', () => {
  it('preserves both history entries when page loads finish concurrently', async () => {
    let saved = [];
    window.vex.loadData = vi.fn(async () => structuredClone(saved));
    window.vex.saveData = vi.fn(async (_key, value) => { saved = structuredClone(value); return true; });
    const { VexStorage: storage } = await import('../../src/renderer/js/storage.js');
    await Promise.all([storage.addHistory({ url: 'https://a.test' }), storage.addHistory({ url: 'https://b.test' })]);
    expect(saved.map(e => e.url).sort()).toEqual(['https://a.test', 'https://b.test']);
  });

  it('saves container metadata but not ephemeral tabs', async () => {
    window.vex.saveData = vi.fn(async () => true);
    const { VexStorage: storage } = await import('../../src/renderer/js/storage.js');
    await storage.saveTabs(seedTabs());
    const saved = window.vex.saveData.mock.calls[0][1];
    expect(saved).toHaveLength(2);
    expect(saved[1].partition).toBe('persist:container-work');
  });
});
