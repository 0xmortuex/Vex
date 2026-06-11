// @vitest-environment jsdom
//
// Phase 4a — Tab Stacks: data model + persistence + invariants.
// This test file exercises ONLY the data layer (no UI render). The plan
// (docs/PHASE-4-TAB-STACKS-PLAN.md) requires ≥20 invariant tests; we land
// here at 26 covering:
//   - createStack validation + happy path
//   - mutual exclusion (group ↔ stack) at the helper level + via operations
//   - addTabToStack / removeTabFromStack / setStackTop / disbandStack
//   - auto-disband at <2 members
//   - top-tab fallback when topTabId is removed
//   - close-tab routing through removeTabFromStack
//   - persistence: roundtrip, missing-stacks-field migration, orphan prune,
//     stale topTabId fallback on init.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// === jsdom + global stubs ===
//
// tabs.js references many globals (WebviewManager, SidebarManager, VexStorage,
// HorizontalTabs, isStartPage). All references are inside method bodies, so
// just defining the const TabManager doesn't fire any of them — but each test
// that calls a method needs the relevant globals stubbed first. We use a
// fresh module load per test (vi.resetModules) so TabManager state resets
// cleanly.

function installGlobals(savedTabs = [], savedGroups = [], savedStacks = []) {
  globalThis.VexStorage = {
    loadTabs:   vi.fn(async () => savedTabs),
    saveTabs:   vi.fn(async () => true),
    loadGroups: vi.fn(async () => savedGroups),
    saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => savedStacks),
    saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  // tabs.js touches window.vex?.getStartPageUrl at module-load — make it
  // return a never-resolving promise so the optional chain doesn't crash.
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}

async function loadTabManager() {
  vi.resetModules();
  const mod = await import('../../src/renderer/js/tabs.js');
  return mod.TabManager;
}

beforeEach(() => {
  // Minimum DOM init() and switchTab() touch. #url-input is read by
  // updateUrlBar; #panels-container / #webviews-container are read by
  // SidebarManager.hideActivePanel (we stub that, so they're optional).
  document.body.innerHTML = `
    <input id="url-input">
    <div id="tabs-list"></div>
    <div id="tab-groups-container"></div>
    <button id="btn-new-tab"></button>
  `;
});

// === Helpers to build minimal valid tabs without going through createTab ===
function fakeTab(id, over = {}) {
  return {
    id,
    url: `https://${id}.example/`,
    title: id,
    favicon: null,
    loading: false,
    pinned: false,
    unread: false,
    groupId: null,
    stackId: null,
    ...over,
  };
}

// ============================================================================
// 1. Mutual-exclusion helpers (_setTabGroup / _setTabStack)
// ============================================================================
describe('_setTabGroup / _setTabStack — mutual exclusion at the primitive level', () => {
  it('_setTabGroup sets groupId, leaves stackId null when stackId was already null', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1')];
    TM._setTabGroup('t1', 'grp_a');
    expect(TM.tabs[0].groupId).toBe('grp_a');
    expect(TM.tabs[0].stackId).toBeNull();
  });

  it('_setTabGroup CLEARS stackId when assigning a non-null groupId', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1', { stackId: 'stk_a' })];
    TM._setTabGroup('t1', 'grp_a');
    expect(TM.tabs[0].groupId).toBe('grp_a');
    expect(TM.tabs[0].stackId).toBeNull();
  });

  it('_setTabGroup with null does NOT touch stackId (clearing group ≠ clearing stack)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a', stackId: null })];
    TM._setTabGroup('t1', null);
    expect(TM.tabs[0].groupId).toBeNull();
    expect(TM.tabs[0].stackId).toBeNull();
  });

  it('_setTabStack CLEARS groupId when assigning a non-null stackId', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' })];
    TM._setTabStack('t1', 'stk_a');
    expect(TM.tabs[0].groupId).toBeNull();
    expect(TM.tabs[0].stackId).toBe('stk_a');
  });

  it('crossover: group → stack → group flips both fields atomically', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1')];

    TM._setTabGroup('t1', 'grp_A');
    expect(TM.tabs[0]).toMatchObject({ groupId: 'grp_A', stackId: null });

    TM._setTabStack('t1', 'stk_S');
    // The contract pinned in the user's prompt: setting a stack must zero out
    // any prior groupId so a tab is never simultaneously in both.
    expect(TM.tabs[0]).toMatchObject({ groupId: null, stackId: 'stk_S' });

    TM._setTabGroup('t1', 'grp_B');
    expect(TM.tabs[0]).toMatchObject({ groupId: 'grp_B', stackId: null });
  });

  it('helpers are no-ops on unknown tab id (return null, do not throw)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [];
    expect(TM._setTabGroup('nope', 'grp_a')).toBeNull();
    expect(TM._setTabStack('nope', 'stk_a')).toBeNull();
  });
});

// ============================================================================
// 2. createStack — validation + happy path
// ============================================================================
describe('createStack', () => {
  it('happy path: 2 tabs → both have stackId set, stack stored', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];

    const stack = TM.createStack(['t1', 't2'], 'Research', '#a855f7');

    expect(stack).not.toBeNull();
    expect(stack.id).toMatch(/^stk_/);
    expect(stack.name).toBe('Research');
    expect(stack.color).toBe('#a855f7');
    expect(stack.topTabId).toBe('t1'); // first member is default top
    expect(TM.stacks).toHaveLength(1);
    expect(TM.stacks[0].id).toBe(stack.id);
    expect(TM.tabs.find(t => t.id === 't1').stackId).toBe(stack.id);
    expect(TM.tabs.find(t => t.id === 't2').stackId).toBe(stack.id);
  });

  it('rejects fewer than 2 tabs (single-member stacks have no value — Section 7)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1')];
    expect(TM.createStack(['t1'])).toBeNull();
    expect(TM.createStack([])).toBeNull();
    expect(TM.createStack()).toBeNull();
    expect(TM.stacks).toHaveLength(0);
  });

  it('clears any existing groupId on input tabs (mutual exclusion)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { groupId: 'grp_old' }),
      fakeTab('t2', { groupId: 'grp_other' }),
    ];

    const stack = TM.createStack(['t1', 't2']);

    expect(TM.tabs[0].groupId).toBeNull();
    expect(TM.tabs[1].groupId).toBeNull();
    expect(TM.tabs[0].stackId).toBe(stack.id);
    expect(TM.tabs[1].stackId).toBe(stack.id);
  });

  it('refuses to include pinned tabs (Section 2 invariant 4)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1', { pinned: true }), fakeTab('t2')];
    expect(TM.createStack(['t1', 't2'])).toBeNull();
    expect(TM.stacks).toHaveLength(0);
    // The non-pinned tab is NOT modified on a failed create.
    expect(TM.tabs[1].stackId).toBeNull();
  });

  it('persists via saveStacks + saveTabs', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    TM.persistTabs = vi.fn();   // skip the real persist path's renderer hops

    TM.createStack(['t1', 't2']);

    expect(globalThis.VexStorage.saveStacks).toHaveBeenCalledWith(TM.stacks);
    expect(TM.persistTabs).toHaveBeenCalled();
  });
});

// ============================================================================
// 3. addTabToStack
// ============================================================================
describe('addTabToStack', () => {
  it('adds a free tab to an existing stack and clears any groupId', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3', { groupId: 'grp_x' })];
    const s = TM.createStack(['t1', 't2']);

    expect(TM.addTabToStack('t3', s.id)).toBe(true);
    expect(TM.tabs.find(t => t.id === 't3').stackId).toBe(s.id);
    expect(TM.tabs.find(t => t.id === 't3').groupId).toBeNull();
  });

  it('returns false when the stack id is unknown', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1')];
    expect(TM.addTabToStack('t1', 'stk_does_not_exist')).toBe(false);
    expect(TM.tabs[0].stackId).toBeNull();
  });

  it('refuses pinned tabs', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3', { pinned: true })];
    const s = TM.createStack(['t1', 't2']);
    expect(TM.addTabToStack('t3', s.id)).toBe(false);
    expect(TM.tabs.find(t => t.id === 't3').stackId).toBeNull();
  });

  it('is idempotent for tabs already in the stack', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const s = TM.createStack(['t1', 't2']);
    expect(TM.addTabToStack('t1', s.id)).toBe(true);
    expect(TM.tabs.find(t => t.id === 't1').stackId).toBe(s.id);
  });
});

// ============================================================================
// 4. removeTabFromStack — auto-disband + top-tab fallback
// ============================================================================
describe('removeTabFromStack', () => {
  it('clears stackId on the removed tab', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    const s = TM.createStack(['t1', 't2', 't3']);

    expect(TM.removeTabFromStack('t1')).toBe(true);
    expect(TM.tabs.find(t => t.id === 't1').stackId).toBeNull();
    // Stack still alive — has 2 members left.
    expect(TM.stacks.find(x => x.id === s.id)).toBeTruthy();
  });

  it('auto-disbands when count drops to 1 — orphan member has stackId cleared', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const s = TM.createStack(['t1', 't2']);

    TM.removeTabFromStack('t1');

    expect(TM.stacks.find(x => x.id === s.id)).toBeUndefined();
    // The lone remaining member is freed too — auto-disband sweeps it.
    expect(TM.tabs.find(t => t.id === 't2').stackId).toBeNull();
  });

  it('falls back to a remaining member when the topTabId is removed', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    const s = TM.createStack(['t1', 't2', 't3']);
    expect(s.topTabId).toBe('t1');

    TM.removeTabFromStack('t1'); // remove the top
    const stillAlive = TM.stacks.find(x => x.id === s.id);
    expect(stillAlive).toBeTruthy();
    // Top fell back to a remaining live member with stackId === s.id.
    expect(['t2', 't3']).toContain(stillAlive.topTabId);
    expect(TM.tabs.find(t => t.id === stillAlive.topTabId).stackId).toBe(s.id);
  });

  it('returns false when the tab was not in any stack', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1')];
    expect(TM.removeTabFromStack('t1')).toBe(false);
  });
});

// ============================================================================
// 5. setStackTop / disbandStack
// ============================================================================
describe('setStackTop', () => {
  it('promotes a valid member', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    const s = TM.createStack(['t1', 't2', 't3']);

    expect(TM.setStackTop(s.id, 't2')).toBe(true);
    expect(TM.stacks.find(x => x.id === s.id).topTabId).toBe('t2');
  });

  it('refuses a tab that is not a member', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    const s = TM.createStack(['t1', 't2']); // t3 is NOT a member
    expect(TM.setStackTop(s.id, 't3')).toBe(false);
    expect(TM.stacks.find(x => x.id === s.id).topTabId).toBe('t1');
  });
});

describe('disbandStack', () => {
  it('clears stackId on every member and removes the stack object', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    const s = TM.createStack(['t1', 't2', 't3']);

    TM.disbandStack(s.id);

    expect(TM.stacks.find(x => x.id === s.id)).toBeUndefined();
    for (const id of ['t1', 't2', 't3']) {
      expect(TM.tabs.find(t => t.id === id).stackId).toBeNull();
    }
  });
});

// ============================================================================
// 6. closeTab integration — closing a stack member is routed through
// removeTabFromStack BEFORE the splice, so auto-disband sees the right
// member set.
// ============================================================================
describe('closeTab → removeTabFromStack routing', () => {
  it('closing the last-but-one member auto-disbands and frees the orphan', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const s = TM.createStack(['t1', 't2']);

    // closeTab uses persistTabs / WebviewManager — those are stubbed, so the
    // close path doesn't blow up on missing DOM.
    TM.closeTab('t1');

    expect(TM.stacks.find(x => x.id === s.id)).toBeUndefined();
    expect(TM.tabs).toHaveLength(1);
    expect(TM.tabs[0].id).toBe('t2');
    expect(TM.tabs[0].stackId).toBeNull();
  });

  it('closing the topTab member when ≥3 members exist falls back to a live member', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    const s = TM.createStack(['t1', 't2', 't3']);

    TM.closeTab('t1');

    const stillAlive = TM.stacks.find(x => x.id === s.id);
    expect(stillAlive).toBeTruthy();
    expect(['t2', 't3']).toContain(stillAlive.topTabId);
    expect(TM.tabs.find(t => t.id === stillAlive.topTabId).stackId).toBe(s.id);
  });
});

// ============================================================================
// 7. Persistence — saveStacks / loadStacks contract + migration
// ============================================================================
describe('persistence — saveStacks / loadStacks roundtrip', () => {
  it('saveStacks → loadStacks returns the array unchanged', async () => {
    // Test the real VexStorage thin layer end-to-end through window.vex.
    // We mock window.vex.saveData / loadData with an in-memory store.
    const store = {};
    globalThis.window.vex = {
      saveData: vi.fn(async (k, v) => { store[k] = v; }),
      loadData: vi.fn(async (k) => store[k] ?? null),
      getStartPageUrl: () => new Promise(() => {}),
    };
    vi.resetModules();
    const { VexStorage } = await import('../../src/renderer/js/storage.js');
    expect(typeof VexStorage.saveStacks).toBe('function');

    const stacks = [
      { id: 'stk_a', name: 'Research', color: '#a855f7', topTabId: 't1' },
      { id: 'stk_b', name: 'PR review', color: '#22c55e', topTabId: 't5' },
    ];
    await VexStorage.saveStacks(stacks);
    const loaded = await VexStorage.loadStacks();
    expect(loaded).toEqual(stacks);
  });

  it('loadStacks returns [] when no save exists (migration from pre-4a saves)', async () => {
    const store = {};
    globalThis.window.vex = {
      saveData: vi.fn(async (k, v) => { store[k] = v; }),
      loadData: vi.fn(async (k) => store[k] ?? null),
      getStartPageUrl: () => new Promise(() => {}),
    };
    vi.resetModules();
    const { VexStorage } = await import('../../src/renderer/js/storage.js');
    const loaded = await VexStorage.loadStacks();
    expect(loaded).toEqual([]);
  });

  it('init prunes stacks whose member set is empty after tab load', async () => {
    // Saved tabs: t1 belongs to stk_alive, no tab references stk_dead.
    installGlobals(
      [{ id: 't1', url: 'https://x', title: 'x', pinned: false, groupId: null, stackId: 'stk_alive', sleeping: true, originalUrl: null, scrollPosition: null }],
      [],
      [
        { id: 'stk_alive', name: 'Live', color: '#fff', topTabId: 't1' },
        { id: 'stk_dead',  name: 'Dead', color: '#000', topTabId: 'tX' },
      ],
    );
    const TM = await loadTabManager();
    // Avoid the createTab branch — feed the sleeping path which doesn't need
    // a DOM tabs-list mount.
    await TM.init();

    expect(TM.stacks.map(s => s.id)).toEqual(['stk_alive']);
    expect(globalThis.VexStorage.saveStacks).toHaveBeenCalled();
  });

  it('init repairs topTabId when it points to a removed tab', async () => {
    // stk_alive lists topTabId 'tGone' (no longer exists). Two real members
    // remain (t1, t2). Init should fall back to one of them.
    installGlobals(
      [
        { id: 't1', url: 'https://x', title: 'x', pinned: false, groupId: null, stackId: 'stk_alive', sleeping: true, originalUrl: null, scrollPosition: null },
        { id: 't2', url: 'https://y', title: 'y', pinned: false, groupId: null, stackId: 'stk_alive', sleeping: true, originalUrl: null, scrollPosition: null },
      ],
      [],
      [{ id: 'stk_alive', name: 'A', color: '#fff', topTabId: 'tGone' }],
    );
    const TM = await loadTabManager();
    await TM.init();

    const s = TM.stacks.find(x => x.id === 'stk_alive');
    expect(s).toBeTruthy();
    expect(['t1', 't2']).toContain(s.topTabId);
  });

  it('saveTabs serialization includes stackId field', async () => {
    const store = {};
    globalThis.window.vex = {
      saveData: vi.fn(async (k, v) => { store[k] = v; }),
      loadData: vi.fn(async () => null),
      getStartPageUrl: () => new Promise(() => {}),
    };
    vi.resetModules();
    const { VexStorage } = await import('../../src/renderer/js/storage.js');

    await VexStorage.saveTabs([
      { id: 't1', url: 'https://x', title: 'X', pinned: false, groupId: null, stackId: 'stk_a' },
    ]);
    expect(store.tabs).toEqual([
      { id: 't1', url: 'https://x', title: 'X', pinned: false, groupId: null, stackId: 'stk_a', sleeping: false, originalUrl: null, scrollPosition: null },
    ]);
  });

  it('saveTabs migrates pre-4a tabs (no stackId field) to stackId: null', async () => {
    const store = {};
    globalThis.window.vex = {
      saveData: vi.fn(async (k, v) => { store[k] = v; }),
      loadData: vi.fn(async () => null),
      getStartPageUrl: () => new Promise(() => {}),
    };
    vi.resetModules();
    const { VexStorage } = await import('../../src/renderer/js/storage.js');

    await VexStorage.saveTabs([
      { id: 't1', url: 'https://x', title: 'X', pinned: false, groupId: null }, // no stackId
    ]);
    expect(store.tabs[0].stackId).toBeNull();
  });
});
