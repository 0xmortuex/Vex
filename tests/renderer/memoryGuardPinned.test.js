// @vitest-environment jsdom
//
// The memory guard (TabManager._memorySweep) sleeps idle background tabs once
// the browser is over its memory ceiling. It never touched pinned tabs, so
// two pinned claude.ai tabs could hold 550 MB while the guard slept nothing.
// Past the ceiling, unpinned idle tabs go first; then pinned ones not looked
// at for half an hour.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}), appMetrics: vi.fn(async () => [{ memKB: 2000 * 1024 }]) };
  window.showToast = vi.fn();
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
const MIN = 60000;
function fakeTab(id, over = {}) { return { id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over }; }

beforeEach(() => {
  document.body.innerHTML = `<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><button id="btn-new-tab"></button>`;
});

describe('the memory guard and pinned tabs', () => {
  it('sleeps unpinned idle tabs first, then pinned ones idle for over 30 minutes', async () => {
    installGlobals();
    const TM = await loadTabManager();
    const now = Date.now();
    TM.tabs = [
      fakeTab('active', { lastViewedAt: now }),
      fakeTab('pinnedFresh', { pinned: true, lastViewedAt: now - 5 * MIN }),
      fakeTab('pinnedOld', { pinned: true, lastViewedAt: now - 45 * MIN }),
      fakeTab('loose', { lastViewedAt: now - 2 * MIN }),
      fakeTab('audible', { audible: true, muted: false, lastViewedAt: now - 60 * MIN }),
    ];
    TM.activeTabId = 'active';
    TM._memCeiling = 900;
    const slept = [];
    TM.sleepTab = vi.fn(async (id) => { slept.push(id); });
    await TM._memorySweep();
    expect(slept).toEqual(['loose', 'pinnedOld']);
    expect(window.showToast).toHaveBeenCalledWith('High memory — slept 2 idle tabs (1 pinned, idle over 30 min)');
  });

  it('does nothing under the ceiling', async () => {
    installGlobals();
    globalThis.window.vex.appMetrics = vi.fn(async () => [{ memKB: 100 * 1024 }]);
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('a'), fakeTab('pinnedOld', { pinned: true, lastViewedAt: Date.now() - 60 * MIN })];
    TM.activeTabId = 'a';
    TM._memCeiling = 900;
    TM.sleepTab = vi.fn();
    await TM._memorySweep();
    expect(TM.sleepTab).not.toHaveBeenCalled();
  });
});
