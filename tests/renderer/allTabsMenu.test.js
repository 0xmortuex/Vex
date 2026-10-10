// @vitest-environment jsdom
//
// "List all tabs" (as Firefox has at the end of its tab strip): a button with
// every open tab in a menu, hidden ones too, usable from the keyboard. Vex had
// no way to find a tab on a crowded strip but scrolling it (found 2026-10-10).
import { describe, it, expect, vi, beforeEach } from 'vitest';

window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');
require('../../src/renderer/js/tab-policy.js');

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  const webviews = new Map();
  globalThis.WebviewManager = { webviews, destroyWebview: vi.fn(), createWebview: vi.fn((t) => webviews.set(t.id, document.createElement('div'))), showWebview: vi.fn() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  for (const k of ['TabGrouper', 'SplitScreen', 'DuplicateTabs', 'SiteRoutes', 'TabTrail']) globalThis[k] = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  window.showToast = vi.fn();
  Element.prototype.scrollIntoView = function () {};   // jsdom has none
}
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const menu = () => document.getElementById('all-tabs-menu');

let TM, btn;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = `
    <input id="url-input">
    <div id="top-tab-bar"><div id="top-tabs-list"></div><div class="tab-bar-trailing">
      <button id="btn-new-tab-top"></button>
      <button id="btn-list-all-tabs" aria-haspopup="menu" aria-expanded="false"></button>
    </div></div>
    <div id="tab-groups-container"></div><div id="tabs-list"></div><button id="btn-new-tab"></button>`;
  document.body.dataset.tabLayout = 'horizontal';
  installGlobals();
  vi.resetModules();
  await import('../../src/renderer/js/vex-utils.js');
  TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
  globalThis.TabManager = TM;
  TM.persistTabs = vi.fn();
  delete window.HorizontalTabs;
  await import('../../src/renderer/js/horizontal-tabs.js');
  globalThis.HorizontalTabs = window.HorizontalTabs;
  TM.groups = [{ id: 'g', name: 'Shopping', color: '#e8685a', collapsed: true }];
  TM.tabs = [tab('a'), tab('b'), tab('g1', { groupId: 'g' })];
  TM.activeTabId = 'b';
  HorizontalTabs.init();
  btn = document.getElementById('btn-list-all-tabs');
});

describe('List all tabs', () => {
  it('lists every tab in strip order, hidden ones too, the one in front marked', () => {
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const rows = [...menu().querySelectorAll('[role=menuitem]')];
    expect(rows.map(r => r.textContent)).toEqual(['Tab a', 'Tab b', 'Tab g1']);
    expect(rows[1].getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(rows[1]);
  });

  it('works from the keyboard: Down opens, arrows move, Enter goes there and opens its group', () => {
    key(btn, 'ArrowDown');
    expect(menu()).toBeTruthy();
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement.textContent).toBe('Tab g1');
    key(document.activeElement, 'Enter');
    expect(menu()).toBeNull();
    expect(TM.activeTabId).toBe('g1');
    expect(TM.groups[0].collapsed).toBe(false);
  });

  it('Escape closes it and gives the focus back to the button', () => {
    btn.click();
    key(document.activeElement, 'Escape');
    expect(menu()).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });

  it('a click on a row goes to that tab; a click outside closes it', () => {
    btn.click();
    menu().querySelector('[data-tab-id="a"]').click();
    expect(TM.activeTabId).toBe('a');
    btn.click();
    document.querySelector('.context-menu-overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu()).toBeNull();
    expect(document.querySelector('.context-menu-overlay')).toBeNull();
  });

  it('is on the strip in the page', () => {
    const html = require('node:fs').readFileSync(require('node:path').resolve('src/renderer/index.html'), 'utf8');
    expect(html).toMatch(/<div class="tab-bar-trailing">[\s\S]{0,400}id="btn-list-all-tabs"[^>]*aria-label="List all tabs"[^>]*aria-haspopup="menu"/);
  });
});
