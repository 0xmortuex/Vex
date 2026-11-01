// @vitest-environment jsdom
//
// The moon on a tab: a sleeping tab and a tab restored from the last session
// that has not been opened yet (the Memory panel calls both "asleep") both wear
// it, and on the strip it is a badge on the icon that survives the narrowest
// tab. Owner: "Sleep icon on tabs doesn't show" (2026-11-01).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

async function load() {
  vi.resetModules();
  globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
  globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  await import('../../src/renderer/js/vex-utils.js');
  const { TabManager } = await import('../../src/renderer/js/tabs.js');
  globalThis.TabManager = TabManager;
  await import('../../src/renderer/js/horizontal-tabs.js');
  return { TM: TabManager, HT: globalThis.HorizontalTabs };
}
const tab = (id, over) => ({ id, url: 'https://' + id + '.example/', title: 'Tab ' + id, favicon: null, pinned: false, groupId: null, stackId: null, ...over });

beforeEach(() => {
  document.body.innerHTML = '<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><div id="top-tab-bar"><div id="top-tabs-list"></div></div>';
  document.body.dataset.tabLayout = 'horizontal';
});

describe('the moon on the top strip', () => {
  it('shows on a sleeping tab and on a tab that is not loaded yet, not on a running one', async () => {
    const { TM, HT } = await load();
    TM.tabs = [tab('run'), tab('zzz', { sleeping: true }), tab('lazy', { _lazy: true })];
    TM.activeTabId = 'run';
    HT.render();
    const q = (id) => document.querySelector(`#top-tabs-list .top-tab[data-tab-id="${id}"]`);
    expect(q('run').querySelector('.sleep-indicator')).toBeNull();
    expect(q('zzz').querySelector('.sleep-indicator')).not.toBeNull();
    expect(q('zzz').querySelector('.sleep-indicator.not-loaded')).toBeNull();
    expect(q('lazy').querySelector('.sleep-indicator.not-loaded')).not.toBeNull();
    expect(q('lazy').classList.contains('not-loaded')).toBe(true);
  });

  it('shows on a tab inside an open group too', async () => {
    const { TM, HT } = await load();
    TM.groups = [{ id: 'g', name: 'G', color: '#6366f1', collapsed: false }];
    TM.tabs = [tab('a'), tab('b', { groupId: 'g', sleeping: true }), tab('c', { groupId: 'g', _lazy: true })];
    TM.activeTabId = 'a';
    HT.render();
    expect(document.querySelectorAll('#top-tabs-list .top-tab .sleep-indicator').length).toBe(2);
  });
});

describe('a folded group', () => {
  it('says how many of its hidden tabs are asleep', async () => {
    const { TM, HT } = await load();
    TM.groups = [{ id: 'g', name: 'G', color: '#6366f1', collapsed: true }, { id: 'h', name: 'H', color: '#6366f1', collapsed: true }, { id: 'k', name: 'K', color: '#6366f1', collapsed: true }];
    TM.tabs = [tab('a'), tab('b', { groupId: 'g', sleeping: true }), tab('c', { groupId: 'g' }), tab('d', { groupId: 'h', _lazy: true }), tab('e', { groupId: 'k' })];
    TM.activeTabId = 'a';
    HT.render();
    const marks = [...document.querySelectorAll('#top-tabs-list .top-group-label')].map(l => l.querySelector('.top-group-asleep'));
    expect(marks[0].textContent).toBe('1');
    expect(marks[0].classList.contains('all')).toBe(false);
    expect(marks[1].classList.contains('all')).toBe(true);
    expect(marks[2]).toBeNull();
  });
});

describe('the moon on the vertical tabs', () => {
  it('is built and kept in step for sleeping and not-loaded tabs', async () => {
    const { TM } = await load();
    const t = tab('v', { _lazy: true });
    TM.tabs = [t];
    TM.activeTabId = 'other';
    const el = TM._createTabElement(t);
    document.body.appendChild(el);
    expect(el.querySelector('.sleep-indicator.not-loaded')).not.toBeNull();
    t._lazy = false; t.sleeping = true;
    TM.renderTabUpdate(t);
    expect(el.querySelector('.sleep-indicator')).not.toBeNull();
    expect(el.querySelector('.sleep-indicator.not-loaded')).toBeNull();
    t.sleeping = false;
    TM.renderTabUpdate(t);
    expect(el.querySelector('.sleep-indicator')).toBeNull();
  });
});

describe('the strip CSS', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/horizontal-tabs.css'), 'utf8');
  it('keeps every tab at 72px or more and never hides the title', () => {
    expect(css).toMatch(/\.top-tab:not\(\.pinned\)\s*\{\s*min-width:\s*72px/);
    expect(css).not.toMatch(/\.top-tab\.narrow \.tab-title\s*\{\s*display:\s*none/);
    expect(css).not.toMatch(/min-width:\s*28px/);
  });
  it('draws the moon as a badge on the icon corner, out of the row', () => {
    expect(css).toMatch(/\.top-tab \.sleep-indicator\s*\{[^}]*position:\s*absolute/);
  });
});
