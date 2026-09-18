// @vitest-environment jsdom
//
// The memory guard (TabManager._memorySweep) sleeps idle background tabs once
// the browser is over its memory ceiling.
//
// It never touched pinned tabs, so two pinned claude.ai tabs could hold 550 MB
// while the guard slept nothing: past the ceiling, unpinned idle tabs go first,
// then pinned ones not looked at for half an hour.
//
// And it compared ALL of Vex with the ceiling. Most of a heavy session is not
// in tabs (the Discord panel alone is ~1 GB), so with the default ceiling it
// was over for good: every tab was slept within 45 s of being left, with a
// "High memory" toast each time, and none of it could bring the total down.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let wcIds;
function installGlobals(totalMB, tabMB) {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  wcIds = new Map();
  const webviews = { get: (id) => { if (!wcIds.has(id)) wcIds.set(id, wcIds.size + 1); const wc = wcIds.get(id); return { getWebContentsId: () => wc }; } };
  globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  // Each tab in its own process, holding tabMB[tab id] (default 300 MB).
  const tabMemory = vi.fn(async (ids) => {
    const byId = {};
    for (const [tabId, wc] of wcIds) if (ids.includes(wc)) byId[wc] = { memKB: ((tabMB && tabMB[tabId]) ?? 300) * 1024, pid: (tabMB && tabMB['pid:' + tabId]) || 1000 + wc, shared: false };
    return { totalKB: totalMB * 1024, byId };
  });
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}), tabMemory };
  window.showToast = vi.fn();
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
const MIN = 60000;
function fakeTab(id, over = {}) { return { id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over }; }
function notes() { const out = []; document.addEventListener('vex:memory-event', (e) => out.push(e.detail.note)); return out; }

beforeEach(() => {
  document.body.innerHTML = `<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><button id="btn-new-tab"></button>`;
});

describe('the memory guard and pinned tabs', () => {
  it('sleeps unpinned idle tabs first, then pinned ones idle for over 30 minutes', async () => {
    installGlobals(2000);
    const TM = await loadTabManager();
    const now = Date.now();
    TM.tabs = [
      fakeTab('active', { lastViewedAt: now }),
      fakeTab('pinnedFresh', { pinned: true, lastViewedAt: now - 10 * MIN }),
      fakeTab('pinnedOld', { pinned: true, lastViewedAt: now - 45 * MIN }),
      fakeTab('loose', { lastViewedAt: now - 8 * MIN }),
      fakeTab('audible', { audible: true, muted: false, lastViewedAt: now - 60 * MIN }),
    ];
    TM.activeTabId = 'active';
    TM._memCeiling = 900;
    const slept = [];
    TM.sleepTab = vi.fn(async (id) => { slept.push(id); });
    await TM._memorySweep();
    expect(slept).toEqual(['loose', 'pinnedOld']);
    expect(window.showToast).toHaveBeenCalledWith('High memory — slept 2 idle tabs (1 pinned, idle over 30 min), about 600 MB');
  });

  it('does nothing under the ceiling', async () => {
    installGlobals(100);
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('a'), fakeTab('pinnedOld', { pinned: true, lastViewedAt: Date.now() - 60 * MIN })];
    TM.activeTabId = 'a';
    TM._memCeiling = 900;
    TM.sleepTab = vi.fn();
    await TM._memorySweep();
    expect(TM.sleepTab).not.toHaveBeenCalled();
  });
});

describe('the memory guard judges what tabs can actually give back', () => {
  it('a tab left under five minutes ago is not idle yet', async () => {
    installGlobals(2000);
    const TM = await loadTabManager();
    const now = Date.now();
    TM.tabs = [fakeTab('active', { lastViewedAt: now }), fakeTab('justLeft', { lastViewedAt: now - 1 * MIN }), fakeTab('old', { lastViewedAt: now - 20 * MIN })];
    TM.activeTabId = 'active';
    TM._memCeiling = 900;
    const slept = [];
    TM.sleepTab = vi.fn(async (id) => { slept.push(id); });
    await TM._memorySweep();
    expect(slept).toEqual(['old']);
  });

  it('when the memory is not in idle tabs, nothing is slept and nothing is toasted', async () => {
    installGlobals(2600, { a: 40, b: 50 });          // 2.6 GB of panels and GPU; the idle tabs hold 90 MB
    const TM = await loadTabManager();
    const seen = notes();
    TM.tabs = [fakeTab('active', { lastViewedAt: Date.now() }), fakeTab('a', { lastViewedAt: 1 }), fakeTab('b', { lastViewedAt: 2 })];
    TM.activeTabId = 'active';
    TM._memCeiling = 1200;
    TM.sleepTab = vi.fn();
    await TM._memorySweep();
    await TM._memorySweep();
    expect(TM.sleepTab).not.toHaveBeenCalled();
    expect(window.showToast).not.toHaveBeenCalled();
    expect(seen).toEqual(['Over the 1200 MB ceiling (2600 MB), but idle tabs hold only 90 MB — nothing slept. See Processes for where it is.']);   // said once, in the Memory panel
  });

  it('sleeps only as many as it takes to get under the ceiling, oldest first', async () => {
    installGlobals(1500, { a: 400, b: 400, c: 400 });   // 300 MB over: one 400 MB tab is enough
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('active', { lastViewedAt: Date.now() }), fakeTab('b', { lastViewedAt: 2 }), fakeTab('a', { lastViewedAt: 1 }), fakeTab('c', { lastViewedAt: 3 })];
    TM.activeTabId = 'active';
    TM._memCeiling = 1200;
    const slept = [];
    TM.sleepTab = vi.fn(async (id) => { slept.push(id); });
    await TM._memorySweep();
    expect(slept).toEqual(['a']);
    expect(window.showToast).toHaveBeenCalledWith('High memory — slept 1 idle tab, about 400 MB');
  });

  it('tabs sharing one renderer process count once', async () => {
    installGlobals(2000, { a: 100, b: 100, 'pid:a': 77, 'pid:b': 77 });   // one 100 MB process, not 200 MB
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('active', { lastViewedAt: Date.now() }), fakeTab('a', { lastViewedAt: 1 }), fakeTab('b', { lastViewedAt: 2 })];
    TM.activeTabId = 'active';
    TM._memCeiling = 900;
    TM.sleepTab = vi.fn();
    await TM._memorySweep();
    expect(TM.sleepTab).not.toHaveBeenCalled();            // 100 MB is under the 150 MB that would matter
  });

  it('toasts once in 30 minutes, then says everything it slept since', async () => {
    installGlobals(3000);
    const TM = await loadTabManager();
    const seen = notes();
    const mk = (n) => Array.from({ length: n }, (_, i) => fakeTab('t' + Math.random().toString(36).slice(2) + i, { lastViewedAt: 1 + i }));
    TM.activeTabId = 'active';
    TM._memCeiling = 900;
    TM.sleepTab = vi.fn(async (id) => { TM.tabs = TM.tabs.filter(t => t.id !== id); });
    TM.tabs = [fakeTab('active', { lastViewedAt: Date.now() }), ...mk(2)];
    await TM._memorySweep();
    TM.tabs = [fakeTab('active', { lastViewedAt: Date.now() }), ...mk(3)];
    await TM._memorySweep();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);                          // the Memory panel still hears about each
    TM._guardToastAt -= 31 * MIN;
    TM.tabs = [fakeTab('active', { lastViewedAt: Date.now() }), ...mk(1)];
    await TM._memorySweep();
    expect(window.showToast).toHaveBeenCalledTimes(2);
    expect(window.showToast).toHaveBeenLastCalledWith('High memory — slept 4 idle tabs, about 1200 MB');
  });
});
