// @vitest-environment jsdom
//
// Phase 4b — vertical-sidebar stack rendering.
//
// Closed-state spec from docs/PHASE-4-TAB-STACKS-PLAN.md §3a:
//   - One <li class="tab-item tab-stack" data-stack-id="…"> per stack
//   - Contents reflect the TOP tab (favicon, title) plus a count badge
//   - Member tabs do NOT render as their own .tab-item (the stack header
//     represents them entirely in 4b)
//   - Click the header → switch to the topTabId tab
//   - Deck-of-cards stagger is CSS-only via ::before / ::after
//
// jsdom doesn't lay out pseudo-elements (no real paint), so this file
// covers DOM structure, attributes, click routing, and the
// "members are NOT rendered separately" invariant. The deck-of-cards
// visual is left for the user to verify by eye.

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
  // Same DOM shape Phase 4a's test file uses — covers init() path too.
  document.body.innerHTML = `
    <input id="url-input">
    <div id="tabs-list"></div>
    <div id="tab-groups-container"></div>
    <button id="btn-new-tab"></button>
  `;
});

// ===========================================================================
// renderStacks() — closed-state DOM structure
// ===========================================================================
describe('renderStacks() — closed-state structure', () => {
  it('produces one .tab-item.tab-stack element per stack', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { title: 'Hacker News', favicon: 'https://hn/fav.ico', stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
      fakeTab('t3', { stackId: 'stk_b' }),
      fakeTab('t4', { stackId: 'stk_b' }),
    ];
    TM.stacks = [
      { id: 'stk_a', name: 'Research', color: '#a855f7', topTabId: 't1' },
      { id: 'stk_b', name: 'PRs',      color: '#22c55e', topTabId: 't3' },
    ];

    TM.renderStacks();

    const headers = document.querySelectorAll('#tabs-list .tab-item.tab-stack');
    expect(headers).toHaveLength(2);
    expect(headers[0].dataset.stackId).toBe('stk_a');
    expect(headers[1].dataset.stackId).toBe('stk_b');
  });

  it('header shows the TOP tab\'s title and favicon', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { title: 'Hacker News', favicon: 'data:image/png;base64,XYZ', stackId: 'stk_a' }),
      fakeTab('t2', { title: 'Decoy other tab', stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    TM.renderStacks();

    const header = document.querySelector('.tab-item.tab-stack');
    expect(header.querySelector('.tab-title').textContent).toBe('Hacker News');
    expect(header.querySelector('.tab-favicon').src).toBe('data:image/png;base64,XYZ');
    // The decoy member's title must not leak into the header.
    expect(header.textContent).not.toContain('Decoy other tab');
  });

  it('falls back to a placeholder favicon when the top tab has none', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { title: 'No-favicon tab', favicon: null, stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];
    TM.renderStacks();

    const header = document.querySelector('.tab-item.tab-stack');
    expect(header.querySelector('.tab-favicon-placeholder')).toBeTruthy();
    expect(header.querySelector('.tab-favicon')).toBeNull();
  });

  it('shows a count badge with the correct member count', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
      fakeTab('t3', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    TM.renderStacks();
    const badge = document.querySelector('.tab-item.tab-stack .tab-stack-count');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('3');
  });

  it('exposes --stack-color as an inline CSS custom property from stack.color', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#9333ea', topTabId: 't1' }];

    TM.renderStacks();
    const header = document.querySelector('.tab-item.tab-stack');
    expect(header.style.getPropertyValue('--stack-color')).toBe('#9333ea');
  });

  it('escapes HTML in the top tab\'s title', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { title: '<script>alert(1)</script>', stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];

    TM.renderStacks();
    const header = document.querySelector('.tab-item.tab-stack .tab-title');
    expect(header.innerHTML).not.toContain('<script>');
    expect(header.textContent).toBe('<script>alert(1)</script>');
  });
});

// ===========================================================================
// Click handler
// ===========================================================================
describe('renderStacks() — click handler', () => {
  it('clicking the header switches to the topTabId tab', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];
    const switchSpy = vi.spyOn(TM, 'switchTab').mockImplementation(() => {});

    TM.renderStacks();
    const header = document.querySelector('.tab-item.tab-stack');
    header.click();

    expect(switchSpy).toHaveBeenCalledWith('t1');
    expect(switchSpy).toHaveBeenCalledTimes(1);
  });

  it('clicking does NOT toggle expansion (4b deliberately defers expand-on-click to 4c)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't1' }];
    vi.spyOn(TM, 'switchTab').mockImplementation(() => {});

    TM.renderStacks();
    const header = document.querySelector('.tab-item.tab-stack');
    header.click();
    header.click();

    expect(header.classList.contains('expanded')).toBe(false);
  });
});

// ===========================================================================
// Defensive: orphan / empty stacks
// ===========================================================================
describe('renderStacks() — defensive paths', () => {
  it('skips stacks whose member set is empty (no header element rendered)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = []; // nothing references the stack
    TM.stacks = [{ id: 'stk_orphan', name: 'O', color: '#a855f7', topTabId: 't_gone' }];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    TM.renderStacks();

    expect(document.querySelectorAll('.tab-item.tab-stack')).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('skips stacks whose topTabId points at a non-member', async () => {
    installGlobals();
    const TM = await loadTabManager();
    // The stack has 2 members, but its topTabId points at a tab that
    // exists in TabManager.tabs but is NOT in this stack. _fallbackTopTab
    // should normally repair this; if it doesn't, we silently skip.
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
      fakeTab('t_outsider'), // no stackId
    ];
    TM.stacks = [{ id: 'stk_a', name: 'R', color: '#a855f7', topTabId: 't_outsider' }];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    TM.renderStacks();

    expect(document.querySelectorAll('.tab-item.tab-stack')).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('renders multiple stacks independently with their own count and color', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
      fakeTab('t3', { stackId: 'stk_b' }),
      fakeTab('t4', { stackId: 'stk_b' }),
      fakeTab('t5', { stackId: 'stk_b' }),
    ];
    TM.stacks = [
      { id: 'stk_a', name: 'A', color: '#a855f7', topTabId: 't1' },
      { id: 'stk_b', name: 'B', color: '#22c55e', topTabId: 't3' },
    ];

    TM.renderStacks();
    const headers = document.querySelectorAll('.tab-item.tab-stack');
    expect(headers[0].querySelector('.tab-stack-count').textContent).toBe('2');
    expect(headers[1].querySelector('.tab-stack-count').textContent).toBe('3');
    expect(headers[0].style.getPropertyValue('--stack-color')).toBe('#a855f7');
    expect(headers[1].style.getPropertyValue('--stack-color')).toBe('#22c55e');
  });

  it('after disbandStack, the next render no longer emits that stack\'s header', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
      fakeTab('t3', { stackId: 'stk_b' }),
      fakeTab('t4', { stackId: 'stk_b' }),
    ];
    TM.stacks = [
      { id: 'stk_a', name: 'A', color: '#a855f7', topTabId: 't1' },
      { id: 'stk_b', name: 'B', color: '#22c55e', topTabId: 't3' },
    ];
    TM.renderStacks();
    expect(document.querySelectorAll('.tab-item.tab-stack')).toHaveLength(2);

    TM.disbandStack('stk_a');
    document.getElementById('tabs-list').innerHTML = ''; // simulate next rebuildAllTabs
    TM.renderStacks();

    const headers = document.querySelectorAll('.tab-item.tab-stack');
    expect(headers).toHaveLength(1);
    expect(headers[0].dataset.stackId).toBe('stk_b');
  });
});

// ===========================================================================
// Filter contract — stacked tabs do NOT render as their own .tab-item
// ===========================================================================
describe('renderTab — stacked tab filter (4b invariant)', () => {
  it('renderTab early-returns for tabs with stackId set', async () => {
    installGlobals();
    const TM = await loadTabManager();
    const tab = fakeTab('t1', { stackId: 'stk_a' });
    TM.tabs = [tab];
    TM.stacks = [{ id: 'stk_a', name: 'A', color: '#a855f7', topTabId: 't1' }];

    TM.renderTab(tab);

    // No .tab-item element should appear for the stacked tab.
    expect(document.querySelectorAll('.tab-item').length).toBe(0);
  });

  it('rebuildAllTabs filters stacked tabs out of the unpinned-tab loop', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),  // stacked
      fakeTab('t2', { stackId: 'stk_a' }),  // stacked
      fakeTab('t3'),                          // free, should render
    ];
    TM.stacks = [{ id: 'stk_a', name: 'A', color: '#a855f7', topTabId: 't1' }];

    TM.rebuildAllTabs();

    // After rebuildAllTabs:
    //   - t3 renders as its own .tab-item (NOT .tab-stack)
    //   - One stack header renders as .tab-item.tab-stack
    //   - t1 / t2 do NOT have their own .tab-item
    const all = document.querySelectorAll('.tab-item');
    const free = document.querySelectorAll('.tab-item:not(.tab-stack)');
    const stack = document.querySelectorAll('.tab-item.tab-stack');
    expect(all.length).toBe(2);    // 1 free + 1 stack header
    expect(free.length).toBe(1);
    expect(stack.length).toBe(1);
    expect(free[0].dataset.tabId).toBe('t3');
    expect(stack[0].dataset.stackId).toBe('stk_a');
  });

  it('rebuildAllTabs renders stack headers AFTER ungrouped tabs (visual hierarchy)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1'),                          // free, renders first
      fakeTab('t2', { stackId: 'stk_a' }),  // stacked
      fakeTab('t3', { stackId: 'stk_a' }),  // stacked
    ];
    TM.stacks = [{ id: 'stk_a', name: 'A', color: '#a855f7', topTabId: 't2' }];

    TM.rebuildAllTabs();

    // The order in #tabs-list should be: free tab(s) first, then stack header.
    const items = document.querySelectorAll('#tabs-list > .tab-item');
    expect(items[0].dataset.tabId).toBe('t1');
    expect(items[1].classList.contains('tab-stack')).toBe(true);
    expect(items[1].dataset.stackId).toBe('stk_a');
  });
});

// ===========================================================================
// Active-state contract — stack headers don't get .active
// ===========================================================================
describe('rebuildAllTabs — active-state contract', () => {
  it('stack header does NOT get .active even when a member tab is the active tab', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { stackId: 'stk_a' }),
      fakeTab('t2', { stackId: 'stk_a' }),
    ];
    TM.stacks = [{ id: 'stk_a', name: 'A', color: '#a855f7', topTabId: 't1' }];
    TM.activeTabId = 't1'; // member of the stack

    TM.rebuildAllTabs();
    const header = document.querySelector('.tab-item.tab-stack');
    // The active member is hidden from the strip; surfacing .active on the
    // stack header would lie about which tab the webview is showing — see
    // the comment in rebuildAllTabs explaining this contract.
    expect(header.classList.contains('active')).toBe(false);
  });
});
