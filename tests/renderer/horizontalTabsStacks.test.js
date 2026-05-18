// @vitest-environment jsdom
//
// Regression — Phase 4c bug (commit 1312a7f): convertGroupToStack must
// produce a stack that actually RENDERS on the default (horizontal) layout.
//
// The data conversion was always correct, but horizontal-tabs.js render()
// was stack-blind: it had no stack-rendering loop and didn't filter stackId
// tabs out of the loose-tab pass. On the default layout, converting a group
// therefore deleted the group and dumped its tabs back into the strip as
// loose tabs — "the group ungroups but no stack appears".
//
// These tests load the real TabManager AND the real HorizontalTabs renderer.

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

// Loads the real TabManager and wires it as the global HorizontalTabs reads.
async function loadModules() {
  vi.resetModules();
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

beforeEach(() => {
  document.body.innerHTML = `
    <input id="url-input">
    <div id="tabs-list"></div>
    <div id="tab-groups-container"></div>
    <button id="btn-new-tab"></button>
    <div id="top-tab-bar"><div id="top-tabs-list"></div></div>
    <button id="btn-new-tab-top"></button>
  `;
  // HorizontalTabs.render() no-ops unless the body is in horizontal layout.
  document.body.dataset.tabLayout = 'horizontal';
});

// ===========================================================================
// The two named regression tests
// ===========================================================================
describe('convertGroupToStack — regression', () => {
  it('produces a renderable stack (horizontal bar shows a .top-stack chip)', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.groups = [{ id: 'grp_a', name: 'Work', color: '#5b8def', collapsed: false }];
    TM.tabs = [
      fakeTab('t1', { groupId: 'grp_a' }),
      fakeTab('t2', { groupId: 'grp_a' }),
    ];

    const stack = TM.convertGroupToStack('grp_a');
    expect(stack).not.toBeNull();

    HT.render();

    const chips = document.querySelectorAll('#top-tabs-list .top-tab.top-stack');
    expect(chips).toHaveLength(1);
    expect(chips[0].dataset.stackId).toBe(stack.id);
  });

  it('removes the underlying group after conversion (no group label remains)', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.groups = [{ id: 'grp_a', name: 'Work', color: '#5b8def', collapsed: false }];
    TM.tabs = [
      fakeTab('t1', { groupId: 'grp_a' }),
      fakeTab('t2', { groupId: 'grp_a' }),
    ];

    TM.convertGroupToStack('grp_a');
    expect(TM.groups).toHaveLength(0);

    HT.render();
    expect(document.querySelectorAll('#top-tabs-list .top-group-label')).toHaveLength(0);
  });
});

// ===========================================================================
// Horizontal stack rendering — the actual fix surface
// ===========================================================================
describe('HorizontalTabs.render — stacks', () => {
  it('a collapsed stack\'s members do NOT leak in as loose top-tabs', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    HT.render();

    // The exact bug: member tabs rendered as their own loose top-tabs.
    expect(document.querySelector('#top-tabs-list .top-tab[data-tab-id="t1"]')).toBeNull();
    expect(document.querySelector('#top-tabs-list .top-tab[data-tab-id="t2"]')).toBeNull();
    // Represented instead by exactly one stack chip.
    expect(document.querySelectorAll('#top-tabs-list .top-tab.top-stack')).toHaveLength(1);
  });

  it('the stack chip shows the member count', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
      fakeTab('t3', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    HT.render();
    const badge = document.querySelector('#top-tabs-list .top-tab.top-stack .top-stack-count');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('3');
  });

  it('the chip reflects the TOP tab\'s title', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [
      fakeTab('t1', { title: 'Hacker News', stackId: 'stk_a' }),
      fakeTab('t2', { title: 'Decoy', stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    HT.render();
    const chip = document.querySelector('#top-tabs-list .top-tab.top-stack');
    expect(chip.querySelector('.tab-title').textContent).toBe('Hacker News');
  });

  it('an expanded stack renders its members inline as .top-tab.in-stack', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];
    TM._expandedStackIds.add('stk_a');

    HT.render();

    const members = document.querySelectorAll('#top-tabs-list .top-tab.in-stack');
    expect(members).toHaveLength(2);
    expect([...members].map(m => m.dataset.tabId).sort()).toEqual(['t1', 't2']);
    // The chip itself carries the .expanded marker class.
    expect(document.querySelector('.top-tab.top-stack').classList.contains('expanded')).toBe(true);
  });

  it('clicking the chip toggles expansion', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [fakeTab('t1', { stackId: 'stk_a' }), fakeTab('t2', { stackId: 'stk_a' })];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    HT.render();
    const spy = vi.spyOn(TM, 'toggleStackExpanded').mockImplementation(() => {});
    document.querySelector('.top-tab.top-stack').click();

    expect(spy).toHaveBeenCalledWith('stk_a');
  });

  it('right-clicking the chip opens the stack context menu', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = [fakeTab('t1', { stackId: 'stk_a' }), fakeTab('t2', { stackId: 'stk_a' })];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    HT.render();
    const spy = vi.spyOn(TM, 'showStackContextMenu').mockImplementation(() => {});
    document.querySelector('.top-tab.top-stack')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(spy).toHaveBeenCalled();
  });

  it('skips a stack whose member set is empty (no chip, no crash)', async () => {
    installGlobals();
    const { TM, HT } = await loadModules();
    TM.tabs = []; // nothing references the stack
    TM.stacks = [{ id: 'stk_orphan', name: 'O', color: '#a855f7', topTabId: 't_gone' }];

    expect(() => HT.render()).not.toThrow();
    expect(document.querySelectorAll('#top-tabs-list .top-tab.top-stack')).toHaveLength(0);
  });
});
