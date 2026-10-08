// @vitest-environment jsdom
//
// The actions that used to ask "Are you sure?" and now happen at once with
// Undo (js/vex-undo.js): Undo puts back exactly what was there, in its place.
import { beforeEach, describe, expect, it, vi } from 'vitest';

let offers;
function toastsWithUndo() {
  offers = [];
  window.showToast = vi.fn((message, type, duration, opts) => {
    if (opts) offers.push({ message, opts });
    return { dismiss() {} };
  });
}
const undoLast = async () => { offers.at(-1).opts.action.run(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.vexConfirm = vi.fn(async () => true);
  globalThis.vexConfirm = window.vexConfirm;
  toastsWithUndo();
});

describe('tab groups: Close tabs and Delete group', () => {
  async function loadTabs() {
    vi.resetModules();
    globalThis.VexStorage = {
      saveTabs: vi.fn(async () => true), saveGroups: vi.fn(async () => true), saveStacks: vi.fn(async () => true),
      loadTabs: vi.fn(async () => []), loadGroups: vi.fn(async () => []), loadStacks: vi.fn(async () => []),
    };
    globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map() };
    globalThis.SidebarManager = { hideActivePanel: vi.fn() };
    globalThis.HorizontalTabs = undefined;
    globalThis.TabGrouper = undefined;
    window.vex = { getStartPageUrl: () => new Promise(() => {}) };
    document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div>';
    await import('../../src/renderer/js/vex-utils.js');
    await import('../../src/renderer/js/tab-policy.js');
    await import('../../src/renderer/js/vex-undo.js');
    const TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
    const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, unread: false, groupId: null, stackId: null, ...over });
    TM.groups = [
      { id: 'g0', name: 'Other', color: '#111', collapsed: false },
      { id: 'g1', name: 'Work', color: 'var(--vex-accent)', collapsed: true },
    ];
    TM.stacks = [];
    TM.tabs = [tab('p', { pinned: true }), tab('a', { groupId: 'g1' }), tab('x', { groupId: 'g0' }), tab('b', { groupId: 'g1', note: 'remember', muted: true }), tab('c')];
    TM.activeTabId = 'a';
    return TM;
  }
  const snapshot = (TM) => JSON.stringify({ tabs: TM.tabs.map(t => [t.id, t.url, t.pinned, t.groupId, t.stackId, t.note || '', !!t.muted]), groups: TM.groups, active: TM.activeTabId });

  for (const action of ['close-tabs', 'delete']) {
    it(`${action}: at once, then Undo restores tabs, order, group look and the tab in front`, async () => {
      const TM = await loadTabs();
      const before = snapshot(TM);
      await TM._handleGroupAction(action, 'g1');
      expect(window.vexConfirm).not.toHaveBeenCalled();
      expect(TM.tabs.map(t => t.id)).toEqual(['p', 'x', 'c']);
      expect(TM.groups.map(g => g.id)).toEqual(['g0']);
      expect(TM.activeTabId).not.toBe('a');
      expect(JSON.parse(localStorage.getItem('vex.recentlyClosed')).map(e => e.id)).toEqual(['b', 'a']);
      expect(offers.at(-1).message).toMatch(/Work/);

      await undoLast();
      expect(snapshot(TM)).toBe(before);
      // Open again, so not "recently closed" any more.
      expect(JSON.parse(localStorage.getItem('vex.recentlyClosed'))).toEqual([]);
    });
  }

  it('closing every tab makes a New Tab, and Undo takes it away again', async () => {
    const TM = await loadTabs();
    TM.tabs = TM.tabs.filter(t => t.groupId === 'g1');
    const before = snapshot(TM);
    await TM._handleGroupAction('close-tabs', 'g1');
    expect(TM.tabs).toHaveLength(1);
    await undoLast();
    expect(snapshot(TM)).toBe(before);
  });

  it('Close Others: Undo brings every other tab back where it was', async () => {
    const TM = await loadTabs();
    const before = snapshot(TM);
    TM.activeTabId = 'c';
    const beforeActive = snapshot(TM);
    TM.closeOtherTabs('x');
    expect(TM.tabs.map(t => t.id)).toEqual(['p', 'x']);
    expect(TM.activeTabId).toBe('x');
    await undoLast();
    // The tab that was in front before Close Others is in front again.
    expect(snapshot(TM)).toBe(beforeActive);
    expect(JSON.parse(snapshot(TM)).tabs).toEqual(JSON.parse(before).tabs);
  });

  it('a Tor or private tab cannot come back, and the toast says so', async () => {
    const TM = await loadTabs();
    TM.tabs.find(t => t.id === 'b').partition = 'tor-1';
    await TM._handleGroupAction('close-tabs', 'g1');
    expect(offers.at(-1).message).toMatch(/1 private or Tor tab cannot come back/);
    await undoLast();
    expect(TM.tabs.map(t => t.id)).toEqual(['p', 'a', 'x', 'c']);
  });
});

describe('bookmarks', () => {
  it('a removed bookmark comes back in its folder and its place, not at the top', async () => {
    require('../../src/renderer/js/collection-store.js');
    require('../../src/renderer/js/vex-undo.js');
    window.VexJobs = { every: () => 0 };
    const { Bookmarks } = require('../../src/renderer/js/bookmarks.js');
    const list = [
      { id: 'b1', url: 'https://one.test/', title: 'One', folder: 'A', at: 1 },
      { id: 'b2', url: 'https://two.test/', title: 'Two', folder: 'B', at: 2 },
      { id: 'b3', url: 'https://three.test/', title: 'Three', folder: 'A', at: 3 },
    ];
    localStorage.setItem('vex.bookmarks', JSON.stringify(list));
    Bookmarks.init();
    Bookmarks.remove(b => b.id === 'b2');
    expect(JSON.parse(localStorage.getItem('vex.bookmarks')).map(b => b.id)).toEqual(['b1', 'b3']);
    expect(offers.at(-1).message).toBe('Removed “Two” from bookmarks');
    await undoLast();
    expect(JSON.parse(localStorage.getItem('vex.bookmarks'))).toEqual(list);
    expect(Bookmarks.items).toEqual(list);
  });
});

describe('scheduled tasks', () => {
  it('a deleted task and cleared run history come back as they were', async () => {
    require('../../src/renderer/js/vex-undo.js');
    const Scheduler = require('../../src/renderer/js/scheduler.js');
    const tasks = [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }, { id: 't3', name: 'Three' }];
    localStorage.setItem(Scheduler.STORAGE_KEY, JSON.stringify(tasks));
    const keep = Scheduler.getAllTasks();
    const removed = Scheduler.deleteTask('t2');
    expect(Scheduler.getAllTasks().map(t => t.id)).toEqual(['t1', 't3']);
    Scheduler.restoreTask(removed);
    expect(Scheduler.getAllTasks()).toEqual(keep);

    localStorage.setItem(Scheduler.HISTORY_KEY, JSON.stringify([{ id: 'r2' }, { id: 'r1' }]));
    const runs = Scheduler.clearHistory();
    localStorage.setItem(Scheduler.HISTORY_KEY, JSON.stringify([{ id: 'r3' }]));   // ran since
    Scheduler.restoreHistory(runs);
    expect(Scheduler.getHistory().map(r => r.id)).toEqual(['r3', 'r2', 'r1']);
  });
});

describe('personas', () => {
  it('a deleted default persona comes back in its place and as the default', () => {
    const { PersonasManager } = require('../../src/renderer/js/personas-manager.js');
    localStorage.setItem('vex.personas', JSON.stringify([{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }, { id: 'p3', name: 'Three' }]));
    PersonasManager.init();
    PersonasManager.setDefault('p2');
    const token = PersonasManager.removeForUndo('p2');
    expect(JSON.parse(localStorage.getItem('vex.personas')).map(p => p.id)).toEqual(['p1', 'p3']);
    PersonasManager.restore(token);
    expect(JSON.parse(localStorage.getItem('vex.personas')).map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(JSON.parse(localStorage.getItem('vex.activePersona'))).toBe('p2');
  });
});

describe('shortcuts', () => {
  it('Reset all keeps the custom bindings for Undo', () => {
    window.vex = { setGuestShortcuts: vi.fn() };
    const ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');
    localStorage.setItem('vex.userShortcuts', JSON.stringify({ 'new-tab': 'Ctrl+Alt+N' }));
    const before = ShortcutsRegistry.customBindings();
    ShortcutsRegistry.resetAll();
    expect(JSON.parse(localStorage.getItem('vex.userShortcuts'))).toEqual({});
    ShortcutsRegistry.restoreBindings(before);
    expect(JSON.parse(localStorage.getItem('vex.userShortcuts'))).toEqual(before);
  });
});
