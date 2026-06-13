// @vitest-environment jsdom
//
// Group color picker — regression cover for two fixes:
//   1. Right-click group → "Change color" → swatch updates group.color, and
//      does NOT leave an orphaned full-screen .context-menu-overlay behind
//      (that transparent z:999 overlay silently ate the next click and stacked
//      one per menu use — the "group menus feel broken / can't change color"
//      bug).
//   2. _themeGroupPalette() builds the swatch palette so it always returns a
//      usable set of colors (falls back to the fixed GROUP_COLORS when theme
//      tokens can't be read, e.g. under jsdom).
import { describe, it, expect, vi, beforeEach } from 'vitest';

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}
async function loadTabManager() { vi.resetModules(); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
function fakeTab(id, over = {}) { return { id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over }; }

beforeEach(() => {
  document.body.innerHTML = `<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><button id="btn-new-tab"></button>`;
});

describe('group change-color flow', () => {
  it('updates group.color when a swatch is clicked', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'Work', color: '#5b8def', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' }), fakeTab('t2', { groupId: 'grp_a' })];
    TM.rebuildAllTabs = vi.fn();

    const ev = { clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} };
    TM.showGroupContextMenu(ev, 'grp_a');

    const changeItem = [...document.querySelectorAll('.tab-group-context-menu .tab-context-item')]
      .find(i => i.dataset.action === 'change-color');
    expect(changeItem, 'change-color menu item exists').toBeTruthy();
    changeItem.click();

    const picker = document.querySelector('.group-color-picker-overlay');
    expect(picker, 'color picker overlay opened').toBeTruthy();

    const swatch = picker.querySelector('.group-color-swatch');
    expect(swatch, 'has swatches').toBeTruthy();
    const newColor = swatch.dataset.color;
    swatch.click();

    expect(TM.groups[0].color).toBe(newColor);
  });

  it('leaves no orphaned dismissal overlay after a menu action', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'Work', color: '#5b8def', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' }), fakeTab('t2', { groupId: 'grp_a' })];
    TM.rebuildAllTabs = vi.fn();

    const ev = { clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} };
    TM.showGroupContextMenu(ev, 'grp_a');
    const changeItem = [...document.querySelectorAll('.tab-group-context-menu .tab-context-item')]
      .find(i => i.dataset.action === 'change-color');
    changeItem.click();

    expect(document.querySelectorAll('.context-menu-overlay').length).toBe(0);
  });

  it('reopening a menu clears any stale overlay (no accumulation)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: 'Work', color: '#5b8def', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' }), fakeTab('t2', { groupId: 'grp_a' })];

    const ev = { clientX: 50, clientY: 50, preventDefault() {}, stopPropagation() {} };
    TM.showGroupContextMenu(ev, 'grp_a');
    TM.showGroupContextMenu(ev, 'grp_a');
    TM.showGroupContextMenu(ev, 'grp_a');
    // Each open attaches exactly one overlay; reopening must not stack them.
    expect(document.querySelectorAll('.context-menu-overlay').length).toBe(1);
  });
});

describe('_themeGroupPalette', () => {
  it('returns a non-empty list of distinct colors', async () => {
    installGlobals();
    const TM = await loadTabManager();
    const pal = TM._themeGroupPalette();
    expect(Array.isArray(pal)).toBe(true);
    expect(pal.length).toBeGreaterThanOrEqual(4);
    expect(new Set(pal).size).toBe(pal.length); // all distinct
    pal.forEach(c => expect(typeof c).toBe('string'));
  });

  it('a new group defaults to the first palette color', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.rebuildAllTabs = vi.fn(); TM.persistTabs = vi.fn();
    TM._promptInput = vi.fn(async () => 'Reading');
    const tab = fakeTab('t1');
    TM.tabs = [tab];
    await TM._newGroupFromTab(tab);
    const created = TM.groups[TM.groups.length - 1];
    expect(created.color).toBe(TM._themeGroupPalette()[0]);
  });
});
