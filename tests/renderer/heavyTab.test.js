// @vitest-environment jsdom
//
// Heavy-tab notice (TabManager.checkHeavyTabs): a tab past its memory
// ceiling gets a one-line notice with Reload when it is in front — like the
// Discord panel's. Never automatic, never while recording or playing, and
// Later is half an hour of quiet for that tab.

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
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
function fakeTab(id, over = {}) { return { id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over }; }
function fakeWebview(id, wcId) { const wv = { getWebContentsId: () => wcId, reload: vi.fn() }; WebviewManager.webviews.set(id, wv); return wv; }
const memory = (mbById) => vi.fn(async () => ({ totalKB: 0, byId: Object.fromEntries(Object.entries(mbById).map(([k, mb]) => [k, { memKB: mb * 1024, pid: 1 }])) }));

beforeEach(() => {
  document.body.innerHTML = `<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><button id="btn-new-tab"></button><div id="webviews-container"></div>`;
  localStorage.clear();
});

describe('the heavy-tab notice', () => {
  it('marks tabs over the ceiling and shows the notice for the one in front', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('big'), fakeTab('small')];
    TM.activeTabId = 'big';
    fakeWebview('big', 1); fakeWebview('small', 2);
    window.vex.tabMemory = memory({ 1: 1200, 2: 150 });
    const heavy = await TM.checkHeavyTabs();
    expect(heavy.map(t => t.id)).toEqual(['big']);
    const banner = document.querySelector('#webviews-container .tab-mem-banner');
    expect(banner.textContent).toMatch(/1\.2 GB/);
    // Switching to the light tab takes the notice away; back again, it returns.
    TM.switchTab('small');
    expect(document.querySelector('.tab-mem-banner')).toBe(null);
    TM.switchTab('big');
    expect(document.querySelector('.tab-mem-banner')).not.toBe(null);
  });

  it('Reload reloads that tab; Later keeps quiet for half an hour', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('big')];
    TM.activeTabId = 'big';
    const wv = fakeWebview('big', 1);
    window.vex.tabMemory = memory({ 1: 900 });
    await TM.checkHeavyTabs();
    document.querySelector('.tmb-later').click();
    expect(document.querySelector('.tab-mem-banner')).toBe(null);
    await TM.checkHeavyTabs();
    expect(document.querySelector('.tab-mem-banner')).toBe(null);   // still quiet
    TM.tabs[0]._heavySnoozedAt = Date.now() - 31 * 60000;
    await TM.checkHeavyTabs();
    expect(document.querySelector('.tab-mem-banner')).not.toBe(null);
    document.querySelector('.tmb-reload').click();
    expect(wv.reload).toHaveBeenCalled();
    expect(document.querySelector('.tab-mem-banner')).toBe(null);
  });

  it('stays silent while the tab records or plays, and honours the ceiling setting', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('big', { audible: true, muted: false })];
    TM.activeTabId = 'big';
    fakeWebview('big', 1);
    window.vex.tabMemory = memory({ 1: 900 });
    await TM.checkHeavyTabs();
    expect(document.querySelector('.tab-mem-banner')).toBe(null);
    TM.tabs[0].audible = false;
    localStorage.setItem('vex.tabMemoryWarnMB', '1000');
    expect((await TM.checkHeavyTabs()).length).toBe(0);
    localStorage.setItem('vex.tabMemoryWarnMB', '500');
    expect((await TM.checkHeavyTabs()).length).toBe(1);
  });
});
