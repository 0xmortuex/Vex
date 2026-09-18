// @vitest-environment jsdom
//
// Microphone / camera in use on a tab. The guest preload wraps getUserMedia
// and reports 'vex-media-capture' to the host (webview.js relays it to
// TabManager.setCapturing): a badge on the tab, never slept meanwhile, and
// nothing about it written to the saved session.

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

beforeEach(() => {
  document.body.innerHTML = `<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><button id="btn-new-tab"></button>`;
});

describe('a tab using the microphone or camera', () => {
  it('gets a badge, loses it when the track stops, and is kept awake meanwhile', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('a'), fakeTab('b')];
    TM.activeTabId = 'b';
    TM.rebuildAllTabs();
    TM.setCapturing('a', 'mic', true);
    let el = document.querySelector('.tab-item[data-tab-id="a"]');
    expect(el.querySelectorAll('.tab-capture').length).toBe(1);
    expect(el.querySelector('.tab-capture').title).toBe('Using the microphone');
    expect(TM.isCapturing(TM.tabs[0])).toBe(true);
    expect(TM._isKeptAwake(TM.tabs[0])).toBe(true);

    TM.setCapturing('a', 'camera', true);
    el = document.querySelector('.tab-item[data-tab-id="a"]');
    expect([...el.querySelectorAll('.tab-capture')].map(n => n.title)).toEqual(['Using the camera', 'Using the microphone']);

    TM.setCapturing('a', 'mic', false);
    TM.setCapturing('a', 'camera', false);
    el = document.querySelector('.tab-item[data-tab-id="a"]');
    expect(el.querySelectorAll('.tab-capture').length).toBe(0);
    expect(TM._isKeptAwake(TM.tabs[0])).toBe(false);
  });

  it('never reaches the saved session, and ignores nonsense', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('a')];
    TM.rebuildAllTabs();
    TM.setCapturing('a', 'mic', true);
    expect(JSON.parse(JSON.stringify(TM.tabs[0])).capturing).toBeUndefined();
    expect(Object.keys(TM.tabs[0])).not.toContain('capturing');
    TM.setCapturing('a', 'speaker', true);
    TM.setCapturing('nope', 'mic', true);
    expect(TM.isCapturing(TM.tabs[0])).toBe(true);
    expect(TM.tabs[0].capturing).toEqual({ mic: true });
  });

  it('the memory guard skips a recording tab', async () => {
    installGlobals();
    const wcs = { rec: 1, idle: 2 };
    globalThis.WebviewManager.webviews = { get: (id) => (wcs[id] ? { getWebContentsId: () => wcs[id] } : undefined) };
    globalThis.window.vex.tabMemory = vi.fn(async (ids) => ({ totalKB: 2000 * 1024, byId: Object.fromEntries(ids.map(wc => [wc, { memKB: 300 * 1024, pid: 100 + wc }])) }));
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('active', { lastViewedAt: Date.now() }), fakeTab('rec', { lastViewedAt: 1 }), fakeTab('idle', { lastViewedAt: 2 })];
    TM.activeTabId = 'active';
    TM._memCeiling = 900;
    TM.setCapturing('rec', 'mic', true);
    const slept = [];
    TM.sleepTab = vi.fn(async (id) => { slept.push(id); });
    await TM._memorySweep();
    expect(slept).toEqual(['idle']);
  });
});
