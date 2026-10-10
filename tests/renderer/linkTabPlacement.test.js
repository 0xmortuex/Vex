// @vitest-environment jsdom
//
// A tab opened from a link (a click on a target=_blank link, a middle-click,
// window.open, "Open Link in New Tab") went to the far right instead of next to
// the tab it came from (audit B8, 2026-10-10). As in Chrome and Firefox it now
// goes after its opener, and after the tabs that opener opened before it while
// it stayed in front; + and Ctrl+T still add at the end.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  const webviews = new Map();
  globalThis.WebviewManager = {
    webviews,
    destroyWebview: vi.fn((id) => webviews.delete(id)),
    createWebview: vi.fn((tab) => { const el = document.createElement('div'); el.getWebContentsId = () => 100 + Number(String(tab.id).replace(/\D/g, '') || 0); webviews.set(tab.id, el); }),
    showWebview: vi.fn(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  globalThis.SplitScreen = undefined;
  globalThis.DuplicateTabs = undefined;
  globalThis.SiteRoutes = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  window.showToast = vi.fn();
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });

let TM;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="sidebar-wrap"><div id="tab-groups-container"></div><div id="tabs-list"></div></div><button id="btn-new-tab"></button>';
  document.body.dataset.tabLayout = 'horizontal';
  installGlobals();
  TM = await loadTabManager();
  TM.persistTabs = vi.fn();
  TM.tabs = [tab('one'), tab('two'), tab('three'), tab('four')];
  TM.activeTabId = 'one';
});
const order = () => TM.displayOrder().map(t => t.id.startsWith('tab-') ? t.url.replace(/^https:\/\/|\.example\/$/g, '') : t.id);
const link = (from, name, activate = false) => TM.createTab(`https://${name}.example/`, activate, TM.tabs.find(t => t.id === from)?.groupId || null, { openerTabId: from });

describe('a tab from a link opens next to its opener', () => {
  it('right after it, not at the far end', () => {
    link('one', 'a');
    expect(order()).toEqual(['one', 'a', 'two', 'three', 'four']);
  });

  it('several in a row from the same tab keep their order after it', () => {
    link('one', 'a'); link('one', 'b'); link('one', 'c');
    expect(order()).toEqual(['one', 'a', 'b', 'c', 'two', 'three', 'four']);
  });

  it('going to another tab and back starts again right after the opener', () => {
    link('one', 'a');
    TM.switchTab('three'); TM.switchTab('one');
    link('one', 'b');
    expect(order()).toEqual(['one', 'b', 'a', 'two', 'three', 'four']);
  });

  it('opened in front, the next link from the new tab goes after it', () => {
    const a = link('two', 'a', true);
    expect(TM.activeTabId).toBe(a.id);
    link(a.id, 'b');
    expect(order()).toEqual(['one', 'two', 'a', 'b', 'three', 'four']);
  });

  it('inside the opener\'s group, after it', () => {
    TM.groups = [{ id: 'g1', name: 'G', color: '#aaa' }];
    TM.tabs = [tab('one'), tab('two', { groupId: 'g1' }), tab('three', { groupId: 'g1' }), tab('four')];
    const a = link('two', 'a');
    expect(a.groupId).toBe('g1');
    expect(order()).toEqual(['one', 'four', 'two', 'a', 'three']);   // the top strip draws loose tabs, then groups
  });

  it('from a pinned tab, first among the loose tabs, never among the pinned', () => {
    TM.tabs = [tab('one'), tab('p1', { pinned: true }), tab('two'), tab('p2', { pinned: true })];
    const a = link('p1', 'a');
    expect(a.pinned).toBe(false);
    expect(order()).toEqual(['p1', 'p2', 'a', 'one', 'two']);
    link('p1', 'b');
    expect(order()).toEqual(['p1', 'p2', 'a', 'b', 'one', 'two']);
  });

  it('from a tab in a stack, at the end, never inside the stack', () => {
    TM.stacks = [{ id: 's1', name: 'S', topTabId: 'two' }];
    TM.tabs = [tab('one'), tab('two', { stackId: 's1' }), tab('three', { stackId: 's1' }), tab('four')];
    const a = link('two', 'a');
    expect(a.stackId).toBeNull();
    expect(TM.tabs.at(-1).id).toBe(a.id);
  });

  it('the sidebar draws it in place too', () => {
    document.body.dataset.tabLayout = 'vertical';
    TM.rebuildAllTabs();
    link('one', 'a');
    const drawn = [...document.querySelectorAll('#tabs-list .tab-item')].map(el => TM.tabs.find(t => t.id === el.dataset.tabId).url);
    expect(drawn).toEqual(['https://one.example/', 'https://a.example/', 'https://two.example/', 'https://three.example/', 'https://four.example/']);
  });
});

describe('a tab from nowhere still goes at the end', () => {
  it('+ / Ctrl+T, another app\'s link, an extension', () => {
    TM.createTab('https://new.example/', false);
    TM.createTab('https://other.example/', false, null, { openerTabId: 'gone' });
    expect(order()).toEqual(['one', 'two', 'three', 'four', 'new', 'other']);
  });
});

describe('wiring', () => {
  const read = (f) => fs.readFileSync(path.resolve('src', f), 'utf8');
  it('main names the page a link was in; the window finds its tab', () => {
    expect(read('main.js')).toMatch(/send\('tab:create-from-external', \{[\s\S]{0,600}opener: contents\.id,/);
    const app = read('renderer/js/app.js');
    expect(app).toContain('TabManager.tabsByPageId([data.opener]).tabs[0]');
    expect(app).toContain('openerTabId: linked ? linked.id : null');
    expect(read('renderer/js/webview.js')).toMatch(/label: 'Open Link in New Tab',[\s\S]{0,400}openerTabId: from \? from\.id : null/);
  });
});
