// @vitest-environment jsdom
//
// Vex's tab groups, for an extension (TabManager.extGroupOp, 2026-10-28): chrome.tabGroups, tabs.group and tabs.ungroup. The Claude extension
// groups the tabs it works in, names the group and colours it; Vex's own groups are what answers, so the person sees them in the tab strip.
import { describe, it, expect, vi, beforeEach } from 'vitest';

function installGlobals(pageIds) {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  const webviews = new Map(Object.entries(pageIds).map(([tabId, page]) => [tabId, { getWebContentsId: () => page }]));
  globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews, getActiveWebview: () => null };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });

let TM;
beforeEach(async () => {
  document.body.innerHTML = '<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><button id="btn-new-tab"></button>';
  installGlobals({ t1: 101, t2: 102, t3: 103 });
  TM = await loadTabManager();
  TM.tabs = [tab('t1'), tab('t2'), tab('t3')];
  TM.groups = [];
  TM.rebuildAllTabs = vi.fn();
  TM.persistTabs = vi.fn();
});

describe('group numbers', () => {
  it('a group gets a number the first time an extension sees it, and keeps it', () => {
    TM.groups = [{ id: 'grp_a', name: 'A', color: '#5b8def', collapsed: false }, { id: 'grp_b', name: 'B', color: '#e8685a', collapsed: false }];
    expect(TM.extGroupNumber(TM.groups[0])).toBe(1);
    expect(TM.extGroupNumber(TM.groups[1])).toBe(2);
    expect(TM.extGroupNumber(TM.groups[0])).toBe(1);
  });
  it('removing an earlier group does not renumber the later one (the old layout used the place in a list)', () => {
    TM.groups = [{ id: 'grp_a', name: 'A', color: '#5b8def', collapsed: false }, { id: 'grp_b', name: 'B', color: '#e8685a', collapsed: false }];
    TM.tabs[0].groupId = 'grp_a'; TM.tabs[1].groupId = 'grp_b';
    const before = TM.extensionTabLayout().find(x => x.page === 102).groupId;
    TM.groups = TM.groups.filter(g => g.id !== 'grp_a');
    expect(TM.extensionTabLayout().find(x => x.page === 102).groupId).toBe(before);
    expect(before).toBe(2);
  });
  it('a tab in no group is -1', () => {
    expect(TM.extensionTabLayout().map(x => x.groupId)).toEqual([-1, -1, -1]);
  });
  it('a new group is numbered after the highest there is', () => {
    TM.groups = [{ id: 'grp_a', name: 'A', color: '#111111', collapsed: false, extNum: 7 }];
    const n = TM.extGroupOp('tabs.group', { tabIds: [101] });
    expect(n).toBe(8);
  });
});

describe('tabs.group', () => {
  it('makes a new group of the tabs, answers with its number, and Vex really has the group', () => {
    const n = TM.extGroupOp('tabs.group', { tabIds: [101, 102] });
    expect(n).toBe(1);
    expect(TM.groups.length).toBe(1);
    expect(TM.tabs.filter(t => t.groupId === TM.groups[0].id).map(t => t.id)).toEqual(['t1', 't2']);
    expect(VexStorage.saveGroups).toHaveBeenCalled();
    expect(TM.rebuildAllTabs).toHaveBeenCalled();
    expect(TM.persistTabs).toHaveBeenCalled();
  });
  it('adds to a group it was told about, by number', () => {
    const n = TM.extGroupOp('tabs.group', { tabIds: [101] });
    expect(TM.extGroupOp('tabs.group', { tabIds: [103], groupId: n })).toBe(n);
    expect(TM.tabs.filter(t => t.groupId === TM.groups[0].id).map(t => t.id)).toEqual(['t1', 't3']);
    expect(TM.groups.length).toBe(1);
  });
  it('unpins a pinned tab it groups (a pinned tab stayed in the pinned row and the group was never drawn)', () => {
    TM.tabs[0].pinned = true;
    TM.extGroupOp('tabs.group', { tabIds: [101] });
    expect(TM.tabs[0].pinned).toBe(false);
  });
  it('fails in Chrome\'s words for a group or a tab that is not there, before changing anything', () => {
    expect(() => TM.extGroupOp('tabs.group', { tabIds: [101], groupId: 9 })).toThrow('No group with id: 9.');
    expect(() => TM.extGroupOp('tabs.group', { tabIds: [101, 999] })).toThrow('No tab with id: 999.');
    expect(() => TM.extGroupOp('tabs.group', { tabIds: [] })).toThrow('takes a tab id');
    expect(TM.groups).toEqual([]);
    expect(TM.tabs.every(t => t.groupId === null)).toBe(true);
  });
});

describe('tabs.ungroup', () => {
  it('takes the tabs out, and a group left with no tab is gone', () => {
    const n = TM.extGroupOp('tabs.group', { tabIds: [101, 102] });
    TM.extGroupOp('tabs.ungroup', { tabIds: [101] });
    expect(TM.tabs[0].groupId).toBeNull();
    expect(TM.groups.length).toBe(1);
    TM.extGroupOp('tabs.ungroup', { tabIds: [102] });
    expect(TM.groups).toEqual([]);
    expect(() => TM.extGroupOp('tabGroups.get', { groupId: n })).toThrow(`No group with id: ${n}.`);
  });
  it('a tab that is not there fails, and nothing changes', () => {
    TM.extGroupOp('tabs.group', { tabIds: [101] });
    expect(() => TM.extGroupOp('tabs.ungroup', { tabIds: [101, 555] })).toThrow('No tab with id: 555.');
    expect(TM.tabs[0].groupId).not.toBeNull();
  });
});

describe('tabGroups', () => {
  it('get answers the title, colour name and collapsed state', () => {
    const n = TM.extGroupOp('tabs.group', { tabIds: [101] });
    expect(TM.extGroupOp('tabGroups.get', { groupId: n })).toEqual({ id: n, windowId: 0, title: '', color: expect.any(String), collapsed: false });
  });
  it('update sets the title, one of Chrome\'s colours and collapsed, saves, and answers with the group', () => {
    const n = TM.extGroupOp('tabs.group', { tabIds: [101] });
    const g = TM.extGroupOp('tabGroups.update', { groupId: n, props: { title: 'Claude', color: 'orange', collapsed: true } });
    expect(g).toEqual({ id: n, windowId: 0, title: 'Claude', color: 'orange', collapsed: true });
    expect(TM.groups[0]).toMatchObject({ name: 'Claude', color: '#f59e0b', collapsed: true, extColor: 'orange' });
    expect(VexStorage.saveGroups).toHaveBeenLastCalledWith(TM.groups);
  });
  it('a title is cut to what Vex shows, and a colour that is not one of the nine is refused in words', () => {
    const n = TM.extGroupOp('tabs.group', { tabIds: [101] });
    expect(TM.extGroupOp('tabGroups.update', { groupId: n, props: { title: 'x'.repeat(200) } }).title.length).toBe(60);
    expect(() => TM.extGroupOp('tabGroups.update', { groupId: n, props: { color: 'teal' } })).toThrow(/Value must be one of: grey, blue, red, yellow, green, pink, purple, cyan, orange/);
  });
  it('the colour of a group made by hand is told as the nearest of Chrome\'s names', () => {
    TM.groups = [{ id: 'grp_h', name: 'Mine', color: '#e8685a', collapsed: false }, { id: 'grp_v', name: 'Themed', color: 'var(--vex-accent)', collapsed: false }];
    expect(TM._extGroupInfo(TM.groups[0]).color).toBe('red');
    expect(TM._extGroupInfo(TM.groups[1]).color).toBe('blue');
    expect(TM._extColorName('#6fbf73')).toBe('green');
    expect(TM._extColorName('#9aa0a6')).toBe('grey');
  });
  it('query filters by title, colour and collapsed', () => {
    const a = TM.extGroupOp('tabs.group', { tabIds: [101] });
    const b = TM.extGroupOp('tabs.group', { tabIds: [102] });
    TM.extGroupOp('tabGroups.update', { groupId: a, props: { title: 'Work', color: 'red' } });
    TM.extGroupOp('tabGroups.update', { groupId: b, props: { title: 'Play', color: 'green', collapsed: true } });
    expect(TM.extGroupOp('tabGroups.query', { query: {} }).length).toBe(2);
    expect(TM.extGroupOp('tabGroups.query', { query: { title: 'Work' } }).map(g => g.id)).toEqual([a]);
    expect(TM.extGroupOp('tabGroups.query', { query: { color: 'green' } }).map(g => g.id)).toEqual([b]);
    expect(TM.extGroupOp('tabGroups.query', { query: { collapsed: true } }).map(g => g.id)).toEqual([b]);
  });
  it('a group it was never told about is "No group with id", as in Chrome', () => {
    TM.groups = [{ id: 'grp_a', name: 'A', color: '#111111', collapsed: false }];
    expect(() => TM.extGroupOp('tabGroups.get', { groupId: 1 })).toThrow('No group with id: 1.');
    expect(() => TM.extGroupOp('tabGroups.update', { groupId: 1, props: { title: 'x' } })).toThrow('No group with id: 1.');
  });
  it('move answers with the group (Vex orders groups by their tabs), and an unknown operation is refused', () => {
    const n = TM.extGroupOp('tabs.group', { tabIds: [101] });
    expect(TM.extGroupOp('tabGroups.move', { groupId: n, props: { index: 0 } }).id).toBe(n);
    expect(() => TM.extGroupOp('tabGroups.destroy', {})).toThrow('Vex does not know tabGroups.destroy');
  });
});
