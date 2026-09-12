// @vitest-environment jsdom
//
// Vertical-sidebar drag and drop.
//
// Before this, setupDragDrop was wired to #tabs-list only. Group bodies live in
// a separate subtree (#tab-groups-container), so a grouped tab could not be
// dragged at all and nothing could be dropped into a group — the "drag between
// groups" TODO at the top of tabs.js. Drops also did not adopt the target's
// section, so a tab dropped inside a group jumped straight back out on the
// next render.

import { describe, it, expect, vi, beforeEach } from 'vitest';

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = {
    destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  globalThis.SplitScreen = undefined;
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}

async function loadTabManager() {
  vi.resetModules();
  installGlobals();
  await import('../../src/renderer/js/vex-utils.js');
  const mod = await import('../../src/renderer/js/tabs.js');
  return mod.TabManager;
}

function fakeTab(id, over = {}) {
  return {
    id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null,
    loading: false, pinned: false, unread: false, groupId: null, stackId: null, ...over,
  };
}

// Minimal DataTransfer stand-in — jsdom has no drag payload.
function dt(id) {
  const store = { 'text/plain': id };
  return { setData: (k, v) => { store[k] = v; }, getData: (k) => store[k] || '', effectAllowed: '', dropEffect: '' };
}
function drag(targetEl, type, draggedId) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  ev.dataTransfer = dt(draggedId);
  targetEl.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  document.body.innerHTML = `
    <input id="url-input">
    <div id="tabs-list"></div>
    <div id="tab-groups-container"></div>
    <button id="btn-new-tab"></button>
  `;
});

async function mount() {
  const TM = await loadTabManager();
  TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3'), fakeTab('t4')];
  TM.activeTabId = 't1';
  TM.groups = [{ id: 'g1', name: 'Docs', color: '#fff', collapsed: false }];
  TM._setTabGroup('t3', 'g1');
  TM.rebuildAllTabs();
  TM.setupDragDrop();
  return TM;
}

const row = (id) => document.querySelector(`.tab-item[data-tab-id="${id}"]`);
const header = (gid) => document.querySelector(`.tab-group[data-group-id="${gid}"] .tab-group-header`);

describe('moveTabNextTo', () => {
  it('reorders within the loose list, landing the tab on the target slot', async () => {
    const TM = await mount();
    expect(TM.moveTabNextTo('t1', 't4')).toBe(true);
    expect(TM.tabs.map(t => t.id)).toEqual(['t2', 't3', 't1', 't4']);
  });

  it('lands on the target slot when dragging the other way too', async () => {
    const TM = await mount();
    expect(TM.moveTabNextTo('t4', 't1')).toBe(true);
    expect(TM.tabs.map(t => t.id)).toEqual(['t4', 't1', 't2', 't3']);
  });

  it('adopts the target group so the tab stays where it was dropped', async () => {
    const TM = await mount();
    TM.moveTabNextTo('t2', 't3');
    expect(TM.tabs.find(t => t.id === 't2').groupId).toBe('g1');
  });

  it('adopts the target pinned state', async () => {
    const TM = await mount();
    TM.pinTab('t4');
    TM.moveTabNextTo('t2', 't4');
    expect(TM.tabs.find(t => t.id === 't2').pinned).toBe(true);
  });

  it('pulls a dragged tab out of its stack', async () => {
    const TM = await mount();
    TM.createStack(['t1', 't2'], 'S', '#fff');
    TM.moveTabNextTo('t1', 't4');
    expect(TM.tabs.find(t => t.id === 't1').stackId).toBeNull();
    expect(TM.stacks).toHaveLength(0); // auto-disbanded below 2 members
  });

  it('refuses a stacked tab as a drop target', async () => {
    const TM = await mount();
    TM.createStack(['t1', 't2'], 'S', '#fff');
    expect(TM.moveTabNextTo('t4', 't1')).toBe(false);
  });

  it('refuses unknown ids and self-drops', async () => {
    const TM = await mount();
    expect(TM.moveTabNextTo('t1', 't1')).toBe(false);
    expect(TM.moveTabNextTo('ghost', 't1')).toBe(false);
    expect(TM.moveTabNextTo('t1', 'ghost')).toBe(false);
  });
});

describe('moveTabToGroup', () => {
  it('moves a loose tab into a group', async () => {
    const TM = await mount();
    expect(TM.moveTabToGroup('t2', 'g1')).toBe(true);
    expect(TM.tabs.find(t => t.id === 't2').groupId).toBe('g1');
  });

  it('moves a grouped tab back out', async () => {
    const TM = await mount();
    expect(TM.moveTabToGroup('t3', null)).toBe(true);
    expect(TM.tabs.find(t => t.id === 't3').groupId).toBeNull();
  });

  it('unpins, because a pinned tab has no place in a group body', async () => {
    const TM = await mount();
    TM.pinTab('t2');
    TM.moveTabToGroup('t2', 'g1');
    expect(TM.tabs.find(t => t.id === 't2').pinned).toBe(false);
  });

  it('pulls the tab out of a stack first', async () => {
    const TM = await mount();
    TM.createStack(['t1', 't2'], 'S', '#fff');
    TM.moveTabToGroup('t1', 'g1');
    expect(TM.tabs.find(t => t.id === 't1').stackId).toBeNull();
    expect(TM.tabs.find(t => t.id === 't1').groupId).toBe('g1');
  });

  it('refuses an unknown group', async () => {
    const TM = await mount();
    expect(TM.moveTabToGroup('t2', 'nope')).toBe(false);
    expect(TM.tabs.find(t => t.id === 't2').groupId).toBeNull();
  });

  it('is a no-op when nothing would change', async () => {
    const TM = await mount();
    expect(TM.moveTabToGroup('t3', 'g1')).toBe(false);
  });
});

describe('drag events', () => {
  it('starts a drag from a grouped row (which lives outside #tabs-list)', async () => {
    await mount();
    const el = row('t3');
    expect(el.closest('#tab-groups-container')).toBeTruthy();
    drag(el, 'dragstart', 't3');
    expect(el.classList.contains('dragging')).toBe(true);
  });

  it('drops a loose tab onto a group header and it joins the group', async () => {
    const TM = await mount();
    drag(row('t2'), 'dragstart', 't2');
    drag(header('g1'), 'drop', 't2');

    expect(TM.tabs.find(t => t.id === 't2').groupId).toBe('g1');
    expect(document.querySelectorAll('.tab-group[data-group-id="g1"] .tab-item')).toHaveLength(2);
  });

  it('drops a grouped tab onto empty list space and it leaves the group', async () => {
    const TM = await mount();
    drag(row('t3'), 'dragstart', 't3');
    drag(document.getElementById('tabs-list'), 'drop', 't3');

    expect(TM.tabs.find(t => t.id === 't3').groupId).toBeNull();
    expect(document.querySelectorAll('#tabs-list .tab-item[data-tab-id="t3"]')).toHaveLength(1);
  });

  it('drops onto a grouped row and joins that group', async () => {
    const TM = await mount();
    drag(row('t2'), 'dragstart', 't2');
    drag(row('t3'), 'drop', 't2');
    expect(TM.tabs.find(t => t.id === 't2').groupId).toBe('g1');
  });

  it('marks the hovered group header while dragging over it', async () => {
    await mount();
    drag(header('g1'), 'dragover', 't2');
    expect(header('g1').classList.contains('group-drag-over')).toBe(true);
  });

  it('clears every drag marker on dragend', async () => {
    await mount();
    drag(header('g1'), 'dragover', 't2');
    drag(row('t2'), 'dragstart', 't2');
    drag(row('t2'), 'dragend', 't2');
    expect(document.querySelectorAll('.drag-over, .group-drag-over, .dragging')).toHaveLength(0);
  });

  it('refuses to start a drag from a stack header (it carries no tab id)', async () => {
    const TM = await mount();
    TM.createStack(['t1', 't2'], 'S', '#fff');
    TM.rebuildAllTabs();
    const stackEl = document.querySelector('#tabs-list .tab-stack');
    expect(stackEl.dataset.tabId).toBeUndefined();
    drag(stackEl, 'dragstart', '');
    expect(stackEl.classList.contains('dragging')).toBe(false);
  });
});
