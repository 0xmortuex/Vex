// @vitest-environment jsdom
//
// Workspace switching regressions, reproduced in the real app first.
//
// Before the fix, a switch A -> B -> A:
//   - lost every stack (saveCurrentState never stored ws.stacks, and the
//     lazily-recreated tabs always came back with stackId null)
//   - leaked A's stacks and expand state into B (closeAllTabs left
//     TabManager.stacks alone)
//   - left A's pinned chips on screen in B (the pinned row lives outside
//     #tabs-list, which was the only thing closeAllTabs cleared)
//   - rendered every group empty, because switchTo called renderGroups()
//     before any tab existed and renderGroups hides zero-tab groups

import { describe, it, expect, vi, beforeEach } from 'vitest';

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []),
    saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []),
    saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []),
    saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = {
    destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  globalThis.SplitScreen = undefined;
  globalThis.window.showToast = vi.fn();
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}

async function load() {
  vi.resetModules();
  installGlobals();
  await import('../../src/renderer/js/vex-utils.js');
  await import('../../src/renderer/js/tab-policy.js');
  const tabs = await import('../../src/renderer/js/tabs.js');
  globalThis.TabManager = tabs.TabManager;
  globalThis.START_URL = 'vex://start';
  const ws = await import('../../src/renderer/js/workspaces.js');
  globalThis.WorkspaceManager = ws.WorkspaceManager;
  return { TabManager: tabs.TabManager, WorkspaceManager: ws.WorkspaceManager };
}

function fakeTab(id, over = {}) {
  return {
    id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null,
    loading: false, pinned: false, unread: false, groupId: null, stackId: null, ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `
    <input id="url-input">
    <div id="tabs-sidebar"><div id="tabs-list"></div></div>
    <div id="tab-groups-container"></div>
    <button id="btn-new-tab"></button>
    <div id="workspace-loading" class="hidden"></div>
    <button id="workspace-btn"></button>
    <div id="workspace-dropdown"></div>
  `;
});

// Build workspace A's tab set: 1 pinned, a 2-tab group, a 2-tab stack, 1 loose.
function seed(TabManager) {
  TabManager.tabs = [
    fakeTab('a1'), fakeTab('a2'), fakeTab('a3'),
    fakeTab('a4'), fakeTab('a5'), fakeTab('a6'),
  ];
  TabManager.activeTabId = 'a6';
  TabManager.groups = [{ id: 'gA', name: 'Alpha', color: '#5b8def', collapsed: false }];
  TabManager._setTabGroup('a2', 'gA');
  TabManager._setTabGroup('a3', 'gA');
  TabManager.createStack(['a4', 'a5'], 'Beta', '#9b59b6');
  TabManager.pinTab('a1');
  TabManager.rebuildAllTabs();
}

const domShape = () => ({
  groups: document.querySelectorAll('.tab-group').length,
  groupTabs: document.querySelectorAll('.tab-group .tab-group-tabs .tab-item').length,
  stacks: document.querySelectorAll('#tabs-list .tab-stack').length,
  pinned: document.querySelectorAll('.pinned-tabs-container .pinned-tab').length,
});

describe('saveCurrentState', () => {
  it('stores the workspace stacks alongside its tabs and groups', async () => {
    const { TabManager, WorkspaceManager } = await load();
    WorkspaceManager.init();
    seed(TabManager);

    WorkspaceManager.saveCurrentState();

    const ws = WorkspaceManager.getActive();
    expect(ws.groups.map(g => g.id)).toEqual(['gA']);
    expect(ws.stacks).toHaveLength(1);
    expect(ws.stacks[0].name).toBe('Beta');
    expect(ws.tabs.filter(t => t.stackId)).toHaveLength(2);
    expect(ws.tabs.filter(t => t.pinned)).toHaveLength(1);
  });
});

describe('switchTo', () => {
  it('does not leak stacks, expand state or pinned chips into the next workspace', async () => {
    const { TabManager, WorkspaceManager } = await load();
    WorkspaceManager.init();
    seed(TabManager);
    TabManager._expandedStackIds.add(TabManager.stacks[0].id);

    const target = WorkspaceManager.addWorkspace('QA', '#22c55e');
    await WorkspaceManager.switchTo(target.id);

    expect(TabManager.stacks).toEqual([]);
    expect(TabManager._expandedStackIds.size).toBe(0);
    expect(TabManager.groups).toEqual([]);
    expect(domShape()).toEqual({ groups: 0, groupTabs: 0, stacks: 0, pinned: 0 });
  });

  it('restores pinned, grouped and stacked tabs on the way back', async () => {
    const { TabManager, WorkspaceManager } = await load();
    WorkspaceManager.init();
    seed(TabManager);
    const home = WorkspaceManager.activeId;

    const target = WorkspaceManager.addWorkspace('QA', '#22c55e');
    await WorkspaceManager.switchTo(target.id);
    await WorkspaceManager.switchTo(home);

    expect(TabManager.tabs).toHaveLength(6);
    expect(TabManager.tabs.filter(t => t.pinned)).toHaveLength(1);
    expect(TabManager.tabs.filter(t => t.groupId === 'gA')).toHaveLength(2);
    expect(TabManager.stacks).toHaveLength(1);
    expect(TabManager.tabs.filter(t => t.stackId === TabManager.stacks[0].id)).toHaveLength(2);
  });

  it('renders the restored groups, stack header and pinned row (not a flat list)', async () => {
    const { TabManager, WorkspaceManager } = await load();
    WorkspaceManager.init();
    seed(TabManager);
    const home = WorkspaceManager.activeId;

    const target = WorkspaceManager.addWorkspace('QA', '#22c55e');
    await WorkspaceManager.switchTo(target.id);
    await WorkspaceManager.switchTo(home);

    expect(domShape()).toEqual({ groups: 1, groupTabs: 2, stacks: 1, pinned: 1 });
    // The one loose tab is the only plain row left in the list.
    expect(document.querySelectorAll('#tabs-list > .tab-item:not(.tab-stack)')).toHaveLength(1);
  });

  it('repoints each restored stack top at a live member', async () => {
    const { TabManager, WorkspaceManager } = await load();
    WorkspaceManager.init();
    seed(TabManager);
    const home = WorkspaceManager.activeId;

    const target = WorkspaceManager.addWorkspace('QA', '#22c55e');
    await WorkspaceManager.switchTo(target.id);
    await WorkspaceManager.switchTo(home);

    const stack = TabManager.stacks[0];
    const top = TabManager.tabs.find(t => t.id === stack.topTabId);
    expect(top).toBeTruthy();
    expect(top.stackId).toBe(stack.id);
  });

  it('drops a saved stack whose members did not come back', async () => {
    const { TabManager, WorkspaceManager } = await load();
    WorkspaceManager.init();
    seed(TabManager);
    const home = WorkspaceManager.activeId;

    const target = WorkspaceManager.addWorkspace('QA', '#22c55e');
    await WorkspaceManager.switchTo(target.id);
    // Simulate members that can no longer be restored (e.g. an ephemeral
    // partition) while the saved stack record survives. Edited after the
    // switch away, since switchTo re-snapshots the workspace it leaves.
    const ws = WorkspaceManager.workspaces.find(w => w.id === home);
    expect(ws.stacks).toHaveLength(1);
    ws.tabs = ws.tabs.filter(t => !t.stackId);
    await WorkspaceManager.switchTo(home);

    expect(TabManager.stacks).toEqual([]);
    expect(document.querySelectorAll('#tabs-list .tab-stack')).toHaveLength(0);
  });
});
