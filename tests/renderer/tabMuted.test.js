// @vitest-environment jsdom
//
// A muted tab came back unmuted after a restart, a workspace switch, a saved
// session or Reopen Closed Tab: what is saved of a tab had no `muted` (found
// 2026-10-10). Undo after closing several tabs already carried its own copy.
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
    createWebview: vi.fn((tab) => {
      const el = document.createElement('div');
      el.setAudioMuted = vi.fn();
      el.remove = vi.fn();
      webviews.set(tab.id, el);
    }),
    showWebview: vi.fn(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  for (const k of ['HorizontalTabs', 'TabGrouper', 'SplitScreen', 'DuplicateTabs', 'SiteRoutes', 'TabTrail', 'TabSnooze']) globalThis[k] = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  globalThis.START_URL = 'vex://start';
  window.showToast = vi.fn();
}
async function load() {
  vi.resetModules();
  await import('../../src/renderer/js/vex-utils.js');
  const TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
  globalThis.TabManager = TM;
  return TM;
}
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });
// The page of a tab is muted once it is ready (dom-ready).
function pageMuted(id) {
  const wv = WebviewManager.webviews.get(id);
  wv.dispatchEvent(new Event('dom-ready'));
  return wv.setAudioMuted.mock.calls.some(c => c[0] === true);
}

let TM;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div><button id="btn-new-tab"></button><div id="sessions-overlay"></div>';
  document.body.dataset.tabLayout = 'horizontal';
  installGlobals();
  TM = await load();
  TM.persistTabs = vi.fn(async () => true);
});

describe('a muted tab stays muted', () => {
  it('in what is saved of it', () => {
    expect(window.VexTabPolicy.serialize(tab('m', { muted: true })).muted).toBe(true);
    expect(window.VexTabPolicy.serialize(tab('u')).muted).toBe(false);
  });

  it('after a restart', async () => {
    const saved = window.VexTabPolicy.serialize(tab('tab-00000000-0000-4000-8000-000000000001', { muted: true }));
    VexStorage.loadTabs.mockResolvedValue([saved]);
    await TM.init();
    const t = TM.tabs.find(x => x.id === saved.id);
    expect(t.muted).toBe(true);
    TM.switchTab(t.id);
    expect(pageMuted(t.id)).toBe(true);
  });

  it('after Reopen Closed Tab', () => {
    TM.tabs = [tab('a'), tab('m', { muted: true })];
    TM.activeTabId = 'a';
    TM.closeTab('m');
    TM.reopenLastClosed();
    const back = TM.getActiveTab();
    expect(back.url).toBe('https://m.example/');
    expect(back.muted).toBe(true);
    expect(pageMuted(back.id)).toBe(true);
  });

  it('after a workspace switch there and back', async () => {
    const { WorkspaceManager: WM } = await import('../../src/renderer/js/workspaces.js');
    WM.workspaces = [{ id: 'a', name: 'A', tabs: [] }, { id: 'b', name: 'B', tabs: [] }];
    WM.activeId = 'a';
    TM.tabs = [tab('x'), tab('m', { muted: true })];
    TM.activeTabId = 'x';
    await WM.switchTo('b');
    await WM.switchTo('a');
    expect(TM.tabs.find(t => t.url === 'https://m.example/').muted).toBe(true);
  });

  it('after opening a saved session', async () => {
    const { SessionManager: SM } = await import('../../src/renderer/js/sessions.js');
    SM.sessions = [{ id: 's', name: 'S', tabs: [window.VexTabPolicy.serialize(tab('m', { muted: true }))], activeTabIndex: -1 }];
    TM.tabs = [tab('x')]; TM.activeTabId = 'x';
    await SM.restoreSession('s', false);
    expect(TM.tabs.find(t => t.url === 'https://m.example/').muted).toBe(true);
  });
});
