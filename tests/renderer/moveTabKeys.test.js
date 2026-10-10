// @vitest-environment jsdom
//
// Ctrl+Shift+PageUp / Ctrl+Shift+PageDown move the tab in front one place
// left or right on the strip, as in Chrome and Firefox; dragging was the only
// way (found 2026-10-10). They are registry keys, so they can be moved, and
// they work with a page focused (main passes them up as the key itself).
import { describe, it, expect, vi, beforeEach } from 'vitest';

window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');
require('../../src/renderer/js/tab-policy.js');
const { shortcutFor } = require('../../src/main/guest-shortcuts.js');

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = { webviews: new Map(), destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  for (const k of ['HorizontalTabs', 'TabGrouper', 'SplitScreen', 'DuplicateTabs', 'SiteRoutes', 'TabTrail']) globalThis[k] = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  window.showToast = vi.fn();
}
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });

let TM;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div><button id="btn-new-tab"></button>';
  document.body.dataset.tabLayout = 'horizontal';
  installGlobals();
  vi.resetModules();
  await import('../../src/renderer/js/vex-utils.js');
  TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
  globalThis.TabManager = TM;
  TM.persistTabs = vi.fn();
});
const order = () => TM.displayOrder().map(t => t.id);

describe('moving a tab with the keyboard', () => {
  it('goes one place right, then left, along the strip', () => {
    TM.tabs = [tab('a'), tab('b'), tab('c')];
    expect(TM.moveTab('a', 1)).toBe(true);
    expect(order()).toEqual(['b', 'a', 'c']);
    expect(TM.moveTab('a', 1)).toBe(true);
    expect(order()).toEqual(['b', 'c', 'a']);
    expect(TM.moveTab('a', 1)).toBe(false);   // the end of the row
    expect(TM.moveTab('a', -1)).toBe(true);
    expect(order()).toEqual(['b', 'a', 'c']);
    expect(TM.persistTabs).toHaveBeenCalled();
  });

  it('moves by what is on screen, within the tab\'s own row', () => {
    // The strip draws loose tabs, then group G; the list has them mixed.
    TM.groups = [{ id: 'G', name: 'G', color: '#aaa' }];
    TM.tabs = [tab('g1', { groupId: 'G' }), tab('x'), tab('g2', { groupId: 'G' }), tab('y')];
    expect(order()).toEqual(['x', 'y', 'g1', 'g2']);
    TM.moveTab('g2', -1);
    expect(order()).toEqual(['x', 'y', 'g2', 'g1']);
    expect(TM.moveTab('g2', -1)).toBe(false);   // first of its group: stays in it
    TM.moveTab('x', 1);
    expect(order()).toEqual(['y', 'x', 'g2', 'g1']);
    expect(TM.tabs.find(t => t.id === 'x').groupId).toBeNull();
  });
});

describe('the keys', () => {
  let ShortcutsRegistry, wanted;
  beforeEach(() => {
    ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');
    window.vex.setGuestShortcutKeys = (combos) => { wanted = new Set(combos); };
    ShortcutsRegistry.resetAll();
  });

  it('are Ctrl+Shift+PageUp and Ctrl+Shift+PageDown, rebindable, and unclaimed by anything else', () => {
    const all = ShortcutsRegistry.getAllShortcuts();
    for (const [id, combo] of [['move-tab-left', 'Ctrl+Shift+PageUp'], ['move-tab-right', 'Ctrl+Shift+PageDown']]) {
      expect(all[id].current).toBe(combo);
      expect(Object.entries(all).filter(([, d]) => d.current === combo).map(([o]) => o)).toEqual([id]);
    }
  });

  it('run from Vex and from a page', () => {
    const ran = [];
    ShortcutsRegistry.register('move-tab-left', () => ran.push('left'));
    ShortcutsRegistry.register('move-tab-right', () => ran.push('right'));
    ShortcutsRegistry.init();
    ShortcutsRegistry._tellMain();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    const hit = shortcutFor({ type: 'keyDown', key: 'PageUp', control: true, shift: true, alt: false, meta: false }, { wanted });
    expect(hit && hit.channel).toBe('guest-shortcut');
    const c = hit.args[0];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: c.key, ctrlKey: c.ctrl, shiftKey: c.shift, altKey: c.alt, bubbles: true, cancelable: true }));
    expect(ran).toEqual(['right', 'left']);
  });

  it('app.js moves the tab in front', () => {
    const src = require('node:fs').readFileSync(require('node:path').resolve('src/renderer/js/app.js'), 'utf8');
    expect(src).toMatch(/register\('move-tab-left',[^\n]*TabManager\.moveTab\(t\.id, -1\)/);
    expect(src).toMatch(/register\('move-tab-right',[^\n]*TabManager\.moveTab\(t\.id, 1\)/);
  });
});
