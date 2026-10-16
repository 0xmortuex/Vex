// @vitest-environment jsdom
//
// js/essentials.js (T3-014): a tab made essential survives a workspace switch,
// is not saved into any workspace, and is refused where it would be lost.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;

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
  globalThis.SplitScreen = undefined;
  globalThis.window.showToast = vi.fn();
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}

async function load() {
  vi.resetModules();
  installGlobals();
  await import('../../src/renderer/js/vex-utils.js');
  await import('../../src/renderer/js/data-contracts.js');
  await import('../../src/renderer/js/tab-policy.js');
  const tabs = await import('../../src/renderer/js/tabs.js');
  globalThis.TabManager = tabs.TabManager;
  globalThis.START_URL = 'vex://start';
  const ws = await import('../../src/renderer/js/workspaces.js');
  globalThis.WorkspaceManager = ws.WorkspaceManager;
  const pick = await import('../../src/renderer/js/pick-list.js');
  globalThis.VexPickList = pick.VexPickList;
  const ess = await import('../../src/renderer/js/essentials.js');
  globalThis.VexEssentials = ess.VexEssentials;
  return { TabManager: tabs.TabManager, WorkspaceManager: ws.WorkspaceManager, VexEssentials: ess.VexEssentials };
}

const fakeTab = (id, over = {}) => ({
  id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null,
  loading: false, pinned: false, unread: false, groupId: null, stackId: null, ...over,
});

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `
    <input id="url-input">
    <div id="tabs-sidebar"><div id="tabs-list"></div></div>
    <div id="tab-groups-container"></div>
    <button id="btn-new-tab"></button>
    <div id="workspace-loading" class="hidden"></div>
    <button id="workspace-btn"></button>
    <div id="workspace-dropdown"></div>`;
});

describe('making a tab essential', () => {
  it('flags it, pins it and takes it out of every workspace that had saved it', async () => {
    const { TabManager, WorkspaceManager, VexEssentials } = await load();
    WorkspaceManager.init();
    TabManager.tabs = [fakeTab('mail'), fakeTab('docs')];
    TabManager.activeTabId = 'docs';
    WorkspaceManager.workspaces[1].tabs = [{ id: 'mail', url: 'https://mail.example/' }, { id: 'other', url: 'https://o.example/' }];

    VexEssentials.make('mail');

    const mail = TabManager.tabs.find(t => t.id === 'mail');
    expect(mail.essential).toBe(true);
    expect(mail.pinned).toBe(true);
    expect(WorkspaceManager.workspaces[1].tabs.map(t => t.id)).toEqual(['other']);
    expect(VexEssentials.list().map(t => t.id)).toEqual(['mail']);
  });

  it('refuses, with a reason, a private tab, the New Tab page and a page that is not on the web', async () => {
    const { TabManager, VexEssentials } = await load();
    TabManager.tabs = [fakeTab('p', { partition: 'otr-123' }), fakeTab('s', { url: 'file:///start.html' }), fakeTab('v', { url: 'vex://settings' })];
    expect(() => VexEssentials.make('p')).toThrow(/private|Tor|temporary/i);
    expect(() => VexEssentials.make('v')).toThrow(/web page/);
    expect(() => VexEssentials.make('nope')).toThrow(/gone/);
    expect(TabManager.tabs.some(t => t.essential)).toBe(false);
  });

  it('is refused while switched off, and its menu rows go', async () => {
    const { TabManager, VexEssentials } = await load();
    TabManager.tabs = [fakeTab('mail')];
    VexEssentials.setEnabled(false);
    expect(() => VexEssentials.make('mail')).toThrow(/switched off/);
    expect(VexEssentials.menuItems(TabManager.tabs[0])).toEqual([]);
    VexEssentials.setEnabled(true);
    expect(VexEssentials.menuItems(TabManager.tabs[0]).map(i => i.label)).toEqual(['Make essential (in every workspace)']);
  });

  it('offers to remove an essential tab, which stays pinned', async () => {
    const { TabManager, VexEssentials } = await load();
    TabManager.tabs = [fakeTab('mail')];
    VexEssentials.make('mail');
    expect(VexEssentials.menuItems(TabManager.tabs[0]).map(i => i.label)).toEqual(['Remove from essentials']);
    VexEssentials.remove('mail');
    expect(TabManager.tabs[0].essential).toBe(false);
    expect(TabManager.tabs[0].pinned).toBe(true);
  });
});

describe('through a workspace switch', () => {
  it('stays open, is not saved into the workspace, and is not duplicated on the way back', async () => {
    const { TabManager, WorkspaceManager, VexEssentials } = await load();
    WorkspaceManager.init();
    TabManager.tabs = [fakeTab('mail'), fakeTab('a1'), fakeTab('a2')];
    TabManager.activeTabId = 'a1';
    VexEssentials.make('mail');
    const home = WorkspaceManager.activeId;

    WorkspaceManager.saveCurrentState();
    expect(WorkspaceManager.getActive().tabs.map(t => t.id).sort()).toEqual(['a1', 'a2']);

    const target = WorkspaceManager.addWorkspace('QA', '#22c55e');
    await WorkspaceManager.switchTo(target.id);
    const mailThere = TabManager.tabs.filter(t => t.essential);
    expect(mailThere).toHaveLength(1);
    expect(mailThere[0].id).toBe('mail');
    expect(TabManager.tabs.some(t => t.id === 'a1')).toBe(false);

    await WorkspaceManager.switchTo(home);
    expect(TabManager.tabs.filter(t => t.essential)).toHaveLength(1);
    expect(TabManager.tabs.map(t => t.url).sort()).toEqual(['https://a1.example/', 'https://a2.example/', 'https://mail.example/']);
  });

  it('is an ordinary tab again when the feature is off', async () => {
    const { TabManager, WorkspaceManager, VexEssentials } = await load();
    WorkspaceManager.init();
    TabManager.tabs = [fakeTab('mail'), fakeTab('a1')];
    TabManager.activeTabId = 'a1';
    VexEssentials.make('mail');
    VexEssentials.setEnabled(false);
    const target = WorkspaceManager.addWorkspace('QA', '#22c55e');
    await WorkspaceManager.switchTo(target.id);
    expect(TabManager.tabs.some(t => t.id === 'mail')).toBe(false);
  });
});

describe('kept with the tab', () => {
  it('is saved by the session policy and comes back on a restored record', async () => {
    const { TabManager } = await load();
    const saved = window.VexTabPolicy.serialize({ id: 'x', url: 'https://x.example/', essential: true, homeUrl: 'https://x.example/home', pinned: true });
    expect(saved).toMatchObject({ essential: true, homeUrl: 'https://x.example/home' });
    expect(window.VexTabPolicy.serialize({ id: 'y', url: 'https://y.example/' })).not.toHaveProperty('essential');
    const record = TabManager._savedTabRecord(saved, 'tab-1');
    expect(record.essential).toBe(true);
    expect(record.homeUrl).toBe('https://x.example/home');
  });
});

describe('the picker', () => {
  it('lists the essential tabs, narrows by typing, and goes to the one picked', async () => {
    const { TabManager, VexEssentials } = await load();
    TabManager.tabs = [fakeTab('mail', { title: 'Mail' }), fakeTab('cal', { title: 'Calendar' }), fakeTab('x')];
    TabManager.switchTab = vi.fn();
    VexEssentials.make('mail'); VexEssentials.make('cal');
    expect(VexEssentials.openPicker()).toBe(true);
    const rows = () => [...document.querySelectorAll('#vex-pick-list .tt-title')].map(e => e.textContent);
    expect(rows()).toEqual(['Mail', 'Calendar']);
    const input = document.querySelector('#vex-pick-list input');
    input.value = 'cal'; input.dispatchEvent(new Event('input'));
    expect(rows()).toEqual(['Calendar']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(TabManager.switchTab).toHaveBeenCalledWith('cal');
    expect(document.getElementById('vex-pick-list')).toBe(null);
  });

  it('says there are none yet instead of opening an empty list', async () => {
    const { TabManager, VexEssentials } = await load();
    TabManager.tabs = [fakeTab('x')];
    expect(VexEssentials.openPicker()).toBe(false);
    expect(window.showToast).toHaveBeenCalled();
    expect(document.getElementById('vex-pick-list')).toBe(null);
  });
});
