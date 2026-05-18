// @vitest-environment jsdom
//
// Phase 4c — Tab Stacks: user interactions.
//
// Covers the 4c surface that 4a (data) and 4b (closed-state render) left
// unbuilt:
//   - Feature 1: convertGroupToStack — right-click group → "Convert to Stack"
//   - Feature 2: count badge visible collapsed, hidden expanded; chevron
//   - Feature 3: toggleStackExpanded — click header expands/collapses,
//                collapsed by default, member rows render indented
//   - Feature 4: clicking a member row inside an expanded stack switches
//   - Feature 5: stack-header context menu — "Close all tabs" / "Ungroup"
//
// Expansion state is deliberately ephemeral (in-memory _expandedStackIds),
// matching docs/PHASE-4-TAB-STACKS-PLAN.md §2 — it is NOT persisted.

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
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}

async function loadTabManager() {
  vi.resetModules();
  const mod = await import('../../src/renderer/js/tabs.js');
  return mod.TabManager;
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
  `;
});

// ===========================================================================
// Feature 1 — convertGroupToStack
// ===========================================================================
describe('convertGroupToStack', () => {
  it('converts a 2-tab group into a stack and removes the group', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'Work', color: '#5b8def', collapsed: false }];
    TM.tabs = [
      fakeTab('t1', { groupId: 'grp_a' }),
      fakeTab('t2', { groupId: 'grp_a' }),
    ];

    const stack = TM.convertGroupToStack('grp_a');

    expect(stack).not.toBeNull();
    expect(stack.id).toMatch(/^stk_/);
    expect(TM.stacks).toHaveLength(1);
    expect(TM.groups).toHaveLength(0);
  });

  it('the new stack inherits the group\'s name and color', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'Research', color: '#9b59b6', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' }), fakeTab('t2', { groupId: 'grp_a' })];

    const stack = TM.convertGroupToStack('grp_a');

    expect(stack.name).toBe('Research');
    expect(stack.color).toBe('#9b59b6');
  });

  it('moves every group tab into the stack (stackId set, groupId cleared)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'G', color: '#fff', collapsed: false }];
    TM.tabs = [
      fakeTab('t1', { groupId: 'grp_a' }),
      fakeTab('t2', { groupId: 'grp_a' }),
      fakeTab('t3', { groupId: 'grp_a' }),
    ];

    const stack = TM.convertGroupToStack('grp_a');

    for (const id of ['t1', 't2', 't3']) {
      const tab = TM.tabs.find(t => t.id === id);
      expect(tab.stackId).toBe(stack.id);
      expect(tab.groupId).toBeNull();
    }
  });

  it('rejects a group with fewer than 2 tabs (single-member stacks have no value)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'G', color: '#fff', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' })];

    expect(TM.convertGroupToStack('grp_a')).toBeNull();
    expect(TM.stacks).toHaveLength(0);
    // The group and its tab are left untouched on a rejected conversion.
    expect(TM.groups).toHaveLength(1);
    expect(TM.tabs[0].groupId).toBe('grp_a');
  });

  it('returns null for an unknown group id', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [];
    TM.tabs = [];
    expect(TM.convertGroupToStack('grp_nope')).toBeNull();
  });

  it('the new stack starts COLLAPSED (not in _expandedStackIds)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'G', color: '#fff', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' }), fakeTab('t2', { groupId: 'grp_a' })];

    const stack = TM.convertGroupToStack('grp_a');

    expect(TM._expandedStackIds.has(stack.id)).toBe(false);
  });

  it('persists the emptied groups list via saveGroups', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'G', color: '#fff', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' }), fakeTab('t2', { groupId: 'grp_a' })];

    TM.convertGroupToStack('grp_a');

    expect(globalThis.VexStorage.saveGroups).toHaveBeenCalledWith([]);
  });
});

// ===========================================================================
// Feature 3 — toggleStackExpanded
// ===========================================================================
describe('toggleStackExpanded', () => {
  it('expands a collapsed stack', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const s = TM.createStack(['t1', 't2']);

    TM.toggleStackExpanded(s.id);
    expect(TM._expandedStackIds.has(s.id)).toBe(true);
  });

  it('collapses an already-expanded stack', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const s = TM.createStack(['t1', 't2']);

    TM.toggleStackExpanded(s.id);   // expand
    TM.toggleStackExpanded(s.id);   // collapse
    expect(TM._expandedStackIds.has(s.id)).toBe(false);
  });

  it('is a no-op (no throw) for an unknown stack id', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [];
    expect(() => TM.toggleStackExpanded('stk_nope')).not.toThrow();
    expect(TM._expandedStackIds.has('stk_nope')).toBe(false);
  });
});

// ===========================================================================
// Feature 2 / 3 — render: chevron, count badge, member rows
// ===========================================================================
describe('renderStacks — expand/collapse rendering', () => {
  it('a collapsed stack renders the header only — no .in-stack member rows', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    TM.renderStacks();

    expect(document.querySelectorAll('.tab-item.tab-stack')).toHaveLength(1);
    expect(document.querySelectorAll('.tab-item.in-stack')).toHaveLength(0);
    expect(document.querySelector('.tab-item.tab-stack').classList.contains('expanded')).toBe(false);
  });

  it('an expanded stack renders one indented .in-stack row per member', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
      fakeTab('t3', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];
    TM._expandedStackIds.add('stk_a');

    TM.renderStacks();

    const header = document.querySelector('.tab-item.tab-stack');
    expect(header.classList.contains('expanded')).toBe(true);
    const members = document.querySelectorAll('.tab-item.in-stack');
    expect(members).toHaveLength(3);
    expect([...members].map(m => m.dataset.tabId)).toEqual(['t1', 't2', 't3']);
  });

  it('the header always carries a chevron', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1', { stackId: 'stk_a' }), fakeTab('t2', { stackId: 'stk_a' })];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    TM.renderStacks();
    expect(document.querySelector('.tab-item.tab-stack .tab-stack-chevron')).toBeTruthy();
  });

  it('member rows are tagged with --stack-color for the left accent', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1', { stackId: 'stk_a' }), fakeTab('t2', { stackId: 'stk_a' })];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#123456', topTabId: 't1' }];
    TM._expandedStackIds.add('stk_a');

    TM.renderStacks();
    const member = document.querySelector('.tab-item.in-stack');
    expect(member.style.getPropertyValue('--stack-color')).toBe('#123456');
  });
});

// ===========================================================================
// Feature 4 — clicking a member row inside an expanded stack switches to it
// ===========================================================================
describe('expanded stack — member click switches tab', () => {
  it('clicking an .in-stack member calls switchTab with that tab id', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];
    TM._expandedStackIds.add('stk_a');
    TM.rebuildAllTabs();

    const switchSpy = vi.spyOn(TM, 'switchTab').mockImplementation(() => {});
    const member = document.querySelector('.tab-item.in-stack[data-tab-id="t2"]');
    member.click();

    expect(switchSpy).toHaveBeenCalledWith('t2');
  });

  it('the clicked member stays inside the stack (does not promote to top-level)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];
    TM._expandedStackIds.add('stk_a');
    TM.rebuildAllTabs();
    vi.spyOn(TM, 'switchTab').mockImplementation(() => {});

    document.querySelector('.tab-item.in-stack[data-tab-id="t2"]').click();

    // stackId membership is unchanged by a switch.
    expect(TM.tabs.find(t => t.id === 't2').stackId).toBe('stk_a');
  });
});

// ===========================================================================
// Feature 5 — stack-header context menu
// ===========================================================================
describe('showStackContextMenu', () => {
  it('renders an "Ungroup" and a "Close all tabs" item', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const s = TM.createStack(['t1', 't2']);

    TM.showStackContextMenu({ clientX: 10, clientY: 10 }, s.id);

    const menu = document.querySelector('.tab-stack-context-menu');
    expect(menu).toBeTruthy();
    expect(menu.querySelector('[data-action="ungroup"]')).toBeTruthy();
    expect(menu.querySelector('[data-action="close-tabs"]')).toBeTruthy();
  });

  it('does not render a menu for an unknown stack id', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [];
    TM.showStackContextMenu({ clientX: 10, clientY: 10 }, 'stk_nope');
    expect(document.querySelector('.tab-stack-context-menu')).toBeNull();
  });
});

describe('_handleStackAction — ungroup', () => {
  it('converts the stack back into a regular group', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    const s = TM.createStack(['t1', 't2', 't3'], 'Reading', '#6fbf73');

    TM._handleStackAction('ungroup', s.id);

    expect(TM.stacks).toHaveLength(0);
    expect(TM.groups).toHaveLength(1);
    expect(TM.groups[0].name).toBe('Reading');
    expect(TM.groups[0].color).toBe('#6fbf73');
  });

  it('re-homes every member into the new group (groupId set, stackId cleared)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const s = TM.createStack(['t1', 't2']);

    TM._handleStackAction('ungroup', s.id);
    const groupId = TM.groups[0].id;

    for (const id of ['t1', 't2']) {
      const tab = TM.tabs.find(t => t.id === id);
      expect(tab.groupId).toBe(groupId);
      expect(tab.stackId).toBeNull();
    }
  });

  it('drops the stack from _expandedStackIds when ungrouped', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const s = TM.createStack(['t1', 't2']);
    TM._expandedStackIds.add(s.id);

    TM._handleStackAction('ungroup', s.id);
    expect(TM._expandedStackIds.has(s.id)).toBe(false);
  });
});

describe('_handleStackAction — close-tabs', () => {
  it('closes every tab in the stack and removes the stack', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    const s = TM.createStack(['t1', 't2', 't3']);

    TM._handleStackAction('close-tabs', s.id);

    expect(TM.stacks.find(x => x.id === s.id)).toBeUndefined();
    // None of the original member ids survive.
    for (const id of ['t1', 't2', 't3']) {
      expect(TM.tabs.find(t => t.id === id)).toBeUndefined();
    }
  });
});

// ===========================================================================
// Group context menu — "Convert to Stack" item
// ===========================================================================
describe('showGroupContextMenu — "Convert to Stack" item', () => {
  it('offers an enabled "Convert to Stack" item for a 2+ tab group', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'G', color: '#fff', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' }), fakeTab('t2', { groupId: 'grp_a' })];

    TM.showGroupContextMenu({ clientX: 5, clientY: 5 }, 'grp_a');

    const item = document.querySelector('.tab-group-context-menu [data-action="convert-to-stack"]');
    expect(item).toBeTruthy();
    expect(item.classList.contains('disabled')).toBe(false);
  });

  it('disables "Convert to Stack" for a group with only 1 tab', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'G', color: '#fff', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' })];

    TM.showGroupContextMenu({ clientX: 5, clientY: 5 }, 'grp_a');

    const item = document.querySelector('.tab-group-context-menu [data-action="convert-to-stack"]');
    expect(item).toBeTruthy();
    expect(item.classList.contains('disabled')).toBe(true);
  });
});

// ===========================================================================
// Integration — full create → collapse → expand → collapse flow
// ===========================================================================
describe('integration — create / collapse / expand flow', () => {
  it('convert a group, see it collapsed, expand it, collapse it again', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'Session', color: '#e8c45a', collapsed: false }];
    TM.tabs = [
      fakeTab('t1', { groupId: 'grp_a' }),
      fakeTab('t2', { groupId: 'grp_a' }),
      fakeTab('t3', { groupId: 'grp_a' }),
    ];

    // 1. Convert — renders collapsed (header only, no member rows).
    const stack = TM.convertGroupToStack('grp_a');
    expect(document.querySelectorAll('.tab-item.tab-stack')).toHaveLength(1);
    expect(document.querySelectorAll('.tab-item.in-stack')).toHaveLength(0);

    // 2. Expand — header gains .expanded, 3 member rows appear.
    TM.toggleStackExpanded(stack.id);
    let header = document.querySelector('.tab-item.tab-stack');
    expect(header.classList.contains('expanded')).toBe(true);
    expect(document.querySelectorAll('.tab-item.in-stack')).toHaveLength(3);

    // 3. Collapse — back to header only.
    TM.toggleStackExpanded(stack.id);
    header = document.querySelector('.tab-item.tab-stack');
    expect(header.classList.contains('expanded')).toBe(false);
    expect(document.querySelectorAll('.tab-item.in-stack')).toHaveLength(0);
  });
});
