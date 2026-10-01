// @vitest-environment jsdom
//
// The speaker on a tab in the top strip (the Firefox and Chrome looks) only
// switched to the tab; in the vertical tabs, and in Chrome and Firefox, it
// mutes (found by a use-it-daily sweep, 2026-09-28).
import { describe, it, expect, vi, beforeEach } from 'vitest';

async function load() {
  vi.resetModules();
  globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
  globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  await import('../../src/renderer/js/vex-utils.js');
  const { TabManager } = await import('../../src/renderer/js/tabs.js');
  globalThis.TabManager = TabManager;
  await import('../../src/renderer/js/horizontal-tabs.js');
  return { TM: TabManager, HT: globalThis.HorizontalTabs };
}
const tab = (id, over) => ({ id, url: 'https://' + id + '.example/', title: 'Tab ' + id, favicon: null, pinned: false, groupId: null, stackId: null, ...over });

beforeEach(() => {
  document.body.innerHTML = '<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><div id="top-tab-bar"><div id="top-tabs-list"></div></div>';
  document.body.dataset.tabLayout = 'horizontal';
});

describe('the speaker on a top-strip tab', () => {
  it('mutes the tab instead of switching to it, and unmutes it again', async () => {
    const { TM, HT } = await load();
    TM.tabs = [tab('a'), tab('b', { audible: true })];
    TM.activeTabId = 'a';
    const mute = vi.spyOn(TM, 'toggleMuteTab').mockImplementation((id) => { const t = TM.tabs.find(x => x.id === id); t.muted = !t.muted; HT.render(); });
    const sw = vi.spyOn(TM, 'switchTab').mockImplementation(() => {});
    HT.render();
    const speaker = () => document.querySelector('#top-tabs-list .top-tab[data-tab-id="b"] .audio-indicator');
    expect(speaker().getAttribute('title')).toBe('Playing audio — click to mute');
    speaker().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mute).toHaveBeenCalledWith('b');
    expect(sw).not.toHaveBeenCalled();
    expect(speaker().classList.contains('muted')).toBe(true);
    speaker().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mute).toHaveBeenCalledTimes(2);
    // Anywhere else on the tab still switches to it.
    document.querySelector('#top-tabs-list .top-tab[data-tab-id="b"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sw).toHaveBeenCalledWith('b');
  });
});
