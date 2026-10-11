// @vitest-environment jsdom
//
// Saved sessions and workspace switches (found 2026-10-10):
//  - opening a session closed every open tab, with no word, no Undo and
//    nothing in Recently Closed. It now opens beside them; "Replace my tabs"
//    closes them with Undo, and deleting a session has Undo too;
//  - a session lost its stacks, and its groups were drawn before their tabs
//    existed, so the side list showed them loose;
//  - a workspace switch woke every sleeping tab's record into an unloaded one,
//    dropped its back list, left kept-awake tabs unloaded, and closed private
//    and Tor tabs for good.
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
  globalThis.WebviewManager = {
    webviews,
    destroyWebview: vi.fn((id) => webviews.delete(id)),
    createWebview: vi.fn((tab) => { const el = document.createElement('div'); el.remove = vi.fn(); el.setAudioMuted = vi.fn(); webviews.set(tab.id, el); }),
    showWebview: vi.fn(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  for (const k of ['HorizontalTabs', 'TabGrouper', 'SplitScreen', 'DuplicateTabs', 'SiteRoutes', 'TabTrail', 'TabSnooze']) globalThis[k] = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  globalThis.START_URL = 'vex://start';
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  // The toast's Undo, run by hand.
  globalThis.offers = [];
  window.VexUndo = { offer: vi.fn((o) => { offers.push(o); return {}; }) };
  window.showToast = vi.fn();
}
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });
const uid = (n) => `tab-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const names = () => TM.tabs.map(t => t.url.replace(/^https:\/\/|\.example\/$/g, ''));

let TM, SM, WM;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div><button id="btn-new-tab"></button><div id="sessions-overlay"></div>';
  document.body.dataset.tabLayout = 'vertical';
  installGlobals();
  vi.resetModules();
  await import('../../src/renderer/js/vex-utils.js');
  TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
  globalThis.TabManager = TM;
  TM.persistTabs = vi.fn(async () => true);
  SM = (await import('../../src/renderer/js/sessions.js')).SessionManager;
  WM = (await import('../../src/renderer/js/workspaces.js')).WorkspaceManager;
  TM.tabs = [tab('mine1'), tab('mine2')];
  TM.activeTabId = 'mine2';
  SM.sessions = [{ id: 's', name: 'Reading', createdAt: new Date().toISOString(), activeTabIndex: 1, groups: [], tabs: [
    window.VexTabPolicy.serialize(tab('r1')), window.VexTabPolicy.serialize(tab('r2')),
  ] }];
});

describe('opening a saved session', () => {
  it('adds its tabs beside the ones open', async () => {
    await SM.restoreSession('s');
    expect(names()).toEqual(['mine1', 'mine2', 'r1', 'r2']);
    expect(TM.getActiveTab().url).toBe('https://r2.example/');
  });

  it('"Replace my tabs" closes them with Undo, into Recently Closed, and Undo takes the session away again', async () => {
    await SM.restoreSession('s', true);
    expect(names()).toEqual(['r1', 'r2']);
    const closed = JSON.parse(localStorage.getItem('vex.recentlyClosed')).map(e => e.url);
    expect(closed).toEqual(expect.arrayContaining(['https://mine1.example/', 'https://mine2.example/']));
    expect(offers).toHaveLength(1);
    expect(offers[0].message).toMatch(/Replaced 2 tabs with “Reading”/);
    offers[0].undo();
    expect(names()).toEqual(['mine1', 'mine2']);
    expect(TM.activeTabId).toBe('mine2');
  });

  it('"Replace my tabs" leaves private and Tor tabs open', async () => {
    TM.tabs.push(tab('tor', { partition: 'tor-1' }));
    await SM.restoreSession('s', true);
    expect(names()).toEqual(['tor', 'r1', 'r2']);
  });

  it('the list has an Open and a Replace button', () => {
    SM.buildUI();
    const item = document.querySelector('.session-item');
    expect(item.querySelector('.sess-restore')).toBeTruthy();
    expect(item.querySelector('.sess-replace')).toBeTruthy();
  });

  it('deleting a session can be undone', () => {
    SM.sessions.push({ id: 't', name: 'Other', createdAt: new Date().toISOString(), tabs: [] });
    SM.deleteSession('s');
    expect(SM.sessions.map(s => s.id)).toEqual(['t']);
    expect(offers[0].message).toMatch(/Deleted the session “Reading”/);
    offers[0].undo();
    expect(SM.sessions.map(s => s.id)).toEqual(['s', 't']);
  });
});

describe('what a session tab keeps (moved here from the 2026-09-29 sweep tests)', () => {
  it('only the tab switched to loads; pin and note kept; kept-awake tabs load at once', async () => {
    const later = Date.now() + 3600000;
    SM.sessions = [{ id: 's1', name: 'S', activeTabIndex: 0, tabs: [
      { url: 'https://active.example/', title: 'Active', keepAwakeUntil: later },
      { url: 'https://awake.example/', title: 'Awake', keepAwakeUntil: later },
      { url: 'https://asleep.example/', title: 'Asleep', pinned: true, note: 'read the second half' },
    ] }];
    WebviewManager.createWebview.mockClear();
    await SM.restoreSession('s1');
    const byTitle = (title) => TM.tabs.find(t => t.title === title);
    expect(WebviewManager.createWebview.mock.calls.map(c => c[0].title).sort()).toEqual(['Active', 'Awake']);
    expect(byTitle('Asleep')._lazy).toBe(true);
    expect(byTitle('Asleep').pinned).toBe(true);
    expect(byTitle('Asleep').note).toBe('read the second half');
    expect(byTitle('Awake').note).toBe('');
    expect(TM.activeTabId).toBe(byTitle('Active').id);
  });
});

describe('a session keeps its stacks and groups', () => {
  it('saves and brings back a stack, with its top tab', async () => {
    TM.tabs = [tab(uid(1), { stackId: 'st' }), tab(uid(2), { stackId: 'st' }), tab('x')];
    TM.stacks = [{ id: 'st', name: 'Research', color: '#aaa', topTabId: uid(2) }];
    TM.activeTabId = 'x';
    const saved = SM.saveCurrentSession('With a stack');
    expect(saved.stacks).toEqual([{ id: 'st', name: 'Research', color: '#aaa', topTabId: uid(2) }]);
    TM.tabs = [tab('y')]; TM.stacks = []; TM.activeTabId = 'y';
    await SM.restoreSession(saved.id);
    const members = TM.tabs.filter(t => t.stackId);
    expect(members).toHaveLength(2);
    expect(TM.stacks).toHaveLength(1);
    expect(TM.stacks[0].topTabId).toBe(members[1].id);
  });

  it('draws a restored group with its tabs in it in the side list', async () => {
    SM.sessions[0].groups = [{ id: 'g', name: 'G', color: '#aaa' }];
    SM.sessions[0].tabs[0].groupId = 'g';
    await SM.restoreSession('s');
    const body = document.querySelector('.tab-group[data-group-id="g"] .tab-group-tabs');
    expect(body).toBeTruthy();
    expect(body.querySelectorAll('.tab-item').length).toBe(1);
  });
});

describe('a workspace switch keeps each tab as it was', () => {
  beforeEach(() => {
    WM.workspaces = [{ id: 'a', name: 'A', tabs: [] }, { id: 'b', name: 'B', tabs: [] }];
    WM.activeId = 'a';
  });

  it('a sleeping tab comes back asleep, with its scroll place and back list', async () => {
    const history = { entries: [{ url: 'https://z.example/1' }, { url: 'https://z.example/2' }], index: 1 };
    TM.tabs = [tab(uid(1)), tab(uid(2), { url: 'https://z.example/2', sleeping: true, originalUrl: 'https://z.example/2', scrollPosition: { x: 0, y: 500 }, history })];
    TM.activeTabId = uid(1);
    await WM.switchTo('b');
    await WM.switchTo('a');
    const z = TM.tabs.find(t => t.id === uid(2));
    expect(z.sleeping).toBe(true);
    expect(z.scrollPosition).toEqual({ x: 0, y: 500 });
    expect(z.history).toEqual(history);
  });

  it('a kept-awake tab is loaded again at once', async () => {
    TM.tabs = [tab(uid(1)), tab(uid(2), { keepAwakeUntil: Number.MAX_SAFE_INTEGER })];
    TM.activeTabId = uid(1);
    await WM.switchTo('b');
    await WM.switchTo('a');
    const awake = TM.tabs.find(t => t.id === uid(2));
    expect(awake._lazy).toBe(false);
    expect(WebviewManager.webviews.has(uid(2))).toBe(true);
  });

  it('private and Tor tabs stay open', async () => {
    // "Keep them open" (tests/renderer/workspacePrivateTabs.test.js has the rest).
    window.vexConfirm = vi.fn(async () => false);
    TM.tabs = [tab(uid(1)), tab('tor', { partition: 'tor-1' })];
    TM.activeTabId = uid(1);
    WebviewManager.createWebview(TM.tabs[1]);
    await WM.switchTo('b');
    expect(TM.tabs.some(t => t.id === 'tor')).toBe(true);
    expect(WebviewManager.webviews.has('tor')).toBe(true);
  });
});
