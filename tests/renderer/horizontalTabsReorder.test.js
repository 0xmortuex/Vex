// @vitest-environment jsdom
//
// Drag-to-reorder on the horizontal tab bar. The DnD event plumbing is thin
// delegation; the behavior lives in HorizontalTabs.reorderTab(draggedId,
// targetId, after), which these tests exercise against the real TabManager.
// jsdom can't simulate native drag geometry (getBoundingClientRect is all
// zeros), so pointer-math targeting isn't simulated here — only the reorder
// semantics and the draggable rendering.

import { describe, it, expect, vi, beforeEach } from 'vitest';

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs:   vi.fn(async () => []),
    saveTabs:   vi.fn(async () => true),
    loadGroups: vi.fn(async () => []),
    saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []),
    saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.TabGrouper = undefined;
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}

async function loadModules() {
  vi.resetModules();
  await import('../../src/renderer/js/vex-utils.js');
  const tabsMod = await import('../../src/renderer/js/tabs.js');
  globalThis.TabManager = tabsMod.TabManager;
  await import('../../src/renderer/js/horizontal-tabs.js');
  return { TM: tabsMod.TabManager, HT: globalThis.HorizontalTabs };
}

function fakeTab(id, over = {}) {
  return {
    id,
    url: `https://${id}.example/`,
    title: `Tab ${id}`,
    favicon: null,
    loading: false,
    pinned: false,
    unread: false,
    groupId: null,
    stackId: null,
    ...over,
  };
}

const order = (TM) => TM.tabs.map(t => t.id);

beforeEach(() => {
  document.body.innerHTML = `
    <input id="url-input">
    <div id="tabs-list"></div>
    <div id="tab-groups-container"></div>
    <button id="btn-new-tab"></button>
    <div id="top-tab-bar"><div id="top-tabs-list"></div></div>
    <button id="btn-new-tab-top"></button>
  `;
  document.body.dataset.tabLayout = 'horizontal';
});

describe('HorizontalTabs.render — draggable tabs', () => {
  it('renders every tab draggable; stack chips are not', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [
      fakeTab('t1'),
      fakeTab('t2', { stackId: 'stk_a' }),
      fakeTab('t3', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't2' }];

    HT.render();

    expect(document.querySelector('.top-tab[data-tab-id="t1"]').draggable).toBe(true);
    expect(document.querySelector('.top-tab.top-stack').draggable).toBe(false);
  });
});

describe('HorizontalTabs.reorderTab', () => {
  it('moves the dragged tab before the target', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];

    expect(HT.reorderTab('t3', 't1', false)).toBe(true);
    expect(order(TM)).toEqual(['t3', 't1', 't2']);
  });

  it('moves the dragged tab after the target and persists', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    const persist = vi.spyOn(TM, 'persistTabs').mockImplementation(async () => {});

    expect(HT.reorderTab('t1', 't3', true)).toBe(true);
    expect(order(TM)).toEqual(['t2', 't3', 't1']);
    expect(persist).toHaveBeenCalled();
  });

  it('reflects the new order in the rendered strip', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];

    HT.reorderTab('t3', 't2', false);
    HT.render();

    const ids = [...document.querySelectorAll('#top-tabs-list .top-tab[data-tab-id]')]
      .map(el => el.dataset.tabId);
    expect(ids).toEqual(['t1', 't3', 't2']);
  });

  it('dropping next to a grouped tab joins that group', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.groups = [{ id: 'grp_a', name: 'Work', color: '#5b8def', collapsed: false }];
    TM.tabs = [fakeTab('t1'), fakeTab('t2', { groupId: 'grp_a' }), fakeTab('t3', { groupId: 'grp_a' })];

    HT.reorderTab('t1', 't2', true);

    expect(TM.tabs.find(t => t.id === 't1').groupId).toBe('grp_a');
    expect(order(TM)).toEqual(['t2', 't1', 't3']);
  });

  it('dropping next to an ungrouped tab leaves the group', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.groups = [{ id: 'grp_a', name: 'Work', color: '#5b8def', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' }), fakeTab('t2', { groupId: 'grp_a' }), fakeTab('t3')];

    HT.reorderTab('t1', 't3', false);

    expect(TM.tabs.find(t => t.id === 't1').groupId).toBeNull();
  });

  it('dropping next to a pinned tab adopts pinned; and vice versa', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [fakeTab('t1', { pinned: true }), fakeTab('t2', { pinned: true }), fakeTab('t3')];

    HT.reorderTab('t3', 't1', true);
    expect(TM.tabs.find(t => t.id === 't3').pinned).toBe(true);

    HT.reorderTab('t3', 't2', false);
    // t2 was unpinned? No — t2 is pinned; drop next to still-pinned t2 keeps it pinned.
    expect(TM.tabs.find(t => t.id === 't3').pinned).toBe(true);

    HT.reorderTab('t1', 't3', true);
    // t1 dropped next to... t3 is pinned now, so t1 stays pinned too.
    expect(TM.tabs.find(t => t.id === 't1').pinned).toBe(true);
  });

  it('unpinning by drop: dragging a pinned tab next to a loose tab unpins it', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [fakeTab('t1', { pinned: true }), fakeTab('t2'), fakeTab('t3')];

    HT.reorderTab('t1', 't3', true);
    expect(TM.tabs.find(t => t.id === 't1').pinned).toBe(false);
    expect(order(TM)).toEqual(['t2', 't3', 't1']);
  });

  it('dragging a member out of a stack routes through removeTabFromStack', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
      fakeTab('t3', { stackId: 'stk_a' }),
      fakeTab('t4'),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];
    const spy = vi.spyOn(TM, 'removeTabFromStack');

    expect(HT.reorderTab('t1', 't4', true)).toBe(true);

    expect(spy).toHaveBeenCalledWith('t1');
    const t1 = TM.tabs.find(t => t.id === 't1');
    expect(t1.stackId).toBeNull();
    expect(order(TM)).toEqual(['t2', 't3', 't4', 't1']);
    // Stack survives with 2 members and a reassigned top.
    expect(TM.stacks).toHaveLength(1);
    expect(['t2', 't3']).toContain(TM.stacks[0].topTabId);
  });

  it('refuses a drop targeting an in-stack tab (stack joining is not a drop)', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [fakeTab('t1'), fakeTab('t2', { stackId: 'stk_a' }), fakeTab('t3', { stackId: 'stk_a' })];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't2' }];

    expect(HT.reorderTab('t1', 't2', true)).toBe(false);
    expect(order(TM)).toEqual(['t1', 't2', 't3']);
    expect(TM.tabs.find(t => t.id === 't1').stackId).toBeNull();
  });

  it('no-ops on self-drop and unknown ids', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];

    expect(HT.reorderTab('t1', 't1', true)).toBe(false);
    expect(HT.reorderTab('ghost', 't1', true)).toBe(false);
    expect(HT.reorderTab('t1', 'ghost', true)).toBe(false);
    expect(order(TM)).toEqual(['t1', 't2']);
  });
});
