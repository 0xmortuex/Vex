// @vitest-environment jsdom
//
// Tabs hidden from the strip (in a collapsed group, or a folded stack) are not
// "the next tab": closing the tab in front put one of them in front with
// nothing on screen showing it, Ctrl+9 and Ctrl+2 could pick one, and the
// next/previous-tab gestures walked the internal list (found 2026-10-10).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');
require('../../src/renderer/js/tab-policy.js');

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
    createWebview: vi.fn((tab) => { webviews.set(tab.id, document.createElement('div')); }),
    showWebview: vi.fn(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  for (const k of ['HorizontalTabs', 'TabGrouper', 'SplitScreen', 'DuplicateTabs', 'SiteRoutes', 'TabTrail']) globalThis[k] = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  window.showToast = vi.fn();
}
async function load() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });
const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

let TM;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div><button id="btn-new-tab"></button>';
  document.body.dataset.tabLayout = 'horizontal';
  installGlobals();
  TM = await load();
  globalThis.TabManager = TM;
  TM.persistTabs = vi.fn();
});

describe('closing the tab in front', () => {
  it('puts the tab beside it on screen in front, never one in a collapsed group', () => {
    document.body.dataset.tabLayout = 'vertical';   // the side list draws groups first
    TM.groups = [{ id: 'g', name: 'G', color: '#aaa', collapsed: true }];
    TM.tabs = [tab('home'), tab('g1', { groupId: 'g' }), tab('g2', { groupId: 'g' }), tab('l1'), tab('l2')];
    TM.activeTabId = 'home';
    TM.closeTab('home');
    expect(TM.activeTabId).toBe('l1');
  });

  it('passes over a folded stack', () => {
    TM.stacks = [{ id: 's', name: 'S', color: '#aaa', topTabId: 's1' }];
    TM.tabs = [tab('a'), tab('b'), tab('s1', { stackId: 's' }), tab('s2', { stackId: 's' }), tab('s3', { stackId: 's' })];
    TM.activeTabId = 'b';
    TM.closeTab('b');
    expect(TM.activeTabId).toBe('a');
  });

  it('goes to the right on the strip, which is not list order', () => {
    // The top strip draws loose tabs before groups: x, then group G's g1.
    TM.groups = [{ id: 'G', name: 'G', color: '#aaa' }];
    TM.tabs = [tab('g1', { groupId: 'G' }), tab('x'), tab('y')];
    TM.activeTabId = 'y';
    TM.closeTab('y');
    expect(TM.activeTabId).toBe('g1');
  });
});

describe('Ctrl+1..9 count the tabs on screen', () => {
  it('Ctrl+9 goes to the last tab drawn, not a member of a folded stack', () => {
    TM.tabs = [tab('a'), tab('b'), tab('s1', { stackId: 's' }), tab('s2', { stackId: 's' })];
    TM.stacks = [{ id: 's', name: 'S', color: '#aaa', topTabId: 's1' }];
    expect(TM.shownOrder().map(t => t.id)).toEqual(['a', 'b']);
    TM._expandedStackIds.add('s');
    expect(TM.shownOrder().map(t => t.id)).toEqual(['a', 'b', 's1', 's2']);
  });

  it('Ctrl+2 does not land inside a collapsed group', () => {
    document.body.dataset.tabLayout = 'vertical';
    TM.groups = [{ id: 'g', name: 'G', color: '#aaa', collapsed: true }];
    TM.tabs = [tab('a'), tab('g1', { groupId: 'g' }), tab('b')];
    expect(TM.shownOrder().map(t => t.id)).toEqual(['a', 'b']);
  });

  it('the Ctrl+number handler reads shownOrder', () => {
    const body = read('renderer/js/app.js').match(/const jumpToTab = \(n\) => \{([\s\S]*?)\n  \};/)[1];
    expect(body).toMatch(/TabManager\.shownOrder\(\)/);
    expect(body).not.toMatch(/displayOrder/);
  });
});

describe('Ctrl+Tab passes over a folded stack', () => {
  it('cycles only through tabs drawn', () => {
    TM.tabs = [tab('a'), tab('s1', { stackId: 's' }), tab('s2', { stackId: 's' }), tab('b')];
    TM.stacks = [{ id: 's', name: 'S', color: '#aaa', topTabId: 's1' }];
    TM.activeTabId = 'b';
    TM.cycleTab(1);
    expect(TM.activeTabId).toBe('a');
    TM.cycleTab(1);
    expect(TM.activeTabId).toBe('b');
  });
});

describe('next/previous-tab gestures', () => {
  it('walk the strip as Ctrl+Tab does', async () => {
    const { MouseGestures } = await import('../../src/renderer/js/gestures.js');
    document.body.dataset.tabLayout = 'vertical';
    TM.groups = [{ id: 'g', name: 'G', color: '#aaa', collapsed: true }];
    TM.tabs = [tab('l1'), tab('g1', { groupId: 'g' }), tab('l2')];
    TM.activeTabId = 'l1';
    MouseGestures.run('RD', {});
    expect(TM.activeTabId).toBe('l2');
    MouseGestures.run('LD', {});
    expect(TM.activeTabId).toBe('l1');
  });
});
