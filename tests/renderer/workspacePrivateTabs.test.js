// @vitest-environment jsdom
//
// Switching workspace while private or Tor tabs are open (owner, 2026-10-11).
// Since v18.59.3 a switch kept them open with no word; it now asks:
// "Close them this time", "Keep them open" or "Always close them". The last
// is remembered (vex.workspacePrivateTabs = 'close') until Settings › General
// › Workspaces puts it back to "Ask each time". Closing goes through
// TabManager.closeTab, as the close button does, so the page is destroyed and
// main ends its in-memory session (session-security.js trackGuest).
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
      el.remove = vi.fn(); el.setAudioMuted = vi.fn(); el.getWebContentsId = () => 900 + webviews.size;
      webviews.set(tab.id, el);
    }),
    showWebview: vi.fn(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  for (const k of ['HorizontalTabs', 'TabGrouper', 'SplitScreen', 'DuplicateTabs', 'SiteRoutes', 'TabTrail', 'TabSnooze']) globalThis[k] = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}), tabClosed: vi.fn() };
  globalThis.START_URL = 'vex://start';
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  window.showToast = vi.fn();
}
const tab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over });
const uid = (n) => `tab-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let TM, WM;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="tab-groups-container"></div><div id="tabs-list"></div><button id="btn-new-tab"></button>';
  document.body.dataset.tabLayout = 'vertical';
  installGlobals();
  vi.resetModules();
  await import('../../src/renderer/js/vex-utils.js');
  TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
  globalThis.TabManager = TM;
  TM.persistTabs = vi.fn(async () => true);
  WM = (await import('../../src/renderer/js/workspaces.js')).WorkspaceManager;
  WM.workspaces = [{ id: 'a', name: 'A', tabs: [] }, { id: 'b', name: 'B', tabs: [] }];
  WM.activeId = 'a';
  TM.tabs = [tab(uid(1)), tab('priv', { partition: 'private-1' }), tab('tor', { partition: 'tor-1' })];
  TM.activeTabId = uid(1);
  for (const t of TM.tabs) WebviewManager.createWebview(t);
});

// The answer the dialog gives: 'close' (OK), 'keep' (Cancel) or 'always'
// (the third button: closes as a cancel, then runs its action).
const answer = (choice) => {
  window.vexConfirm = vi.fn(async (o) => {
    if (choice === 'always') { o.extra.run(); return false; }
    return choice === 'close';
  });
};
const ephemeralOpen = () => TM.tabs.filter(t => t.id === 'priv' || t.id === 'tor').map(t => t.id);

describe('switching workspace with private and Tor tabs open', () => {
  it('asks, with the three choices, and Keep them open keeps them', async () => {
    answer('keep');
    await WM.switchTo('b');
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    const o = window.vexConfirm.mock.calls[0][0];
    expect(o.okLabel).toBe('Close them this time');
    expect(o.cancelLabel).toBe('Keep them open');
    expect(o.extra.label).toBe('Always close them');
    expect(o.message).toMatch(/^2 private or Tor tabs are open/);
    expect(WM.activeId).toBe('b');
    expect(ephemeralOpen()).toEqual(['priv', 'tor']);
    expect(WebviewManager.webviews.has('tor')).toBe(true);
    expect(localStorage.getItem('vex.workspacePrivateTabs')).toBeNull();
  });

  it('Close them this time closes them as the close button does (page destroyed, main told), once', async () => {
    answer('close');
    await WM.switchTo('b');
    expect(WM.activeId).toBe('b');
    expect(ephemeralOpen()).toEqual([]);
    expect(WebviewManager.destroyWebview).toHaveBeenCalledWith('priv');
    expect(WebviewManager.destroyWebview).toHaveBeenCalledWith('tor');
    expect(window.vex.tabClosed).toHaveBeenCalledTimes(2);
    // Nothing written down for a private tab, and the choice is not kept.
    expect(localStorage.getItem('vex.recentlyClosed')).toBeNull();
    expect(localStorage.getItem('vex.workspacePrivateTabs')).toBeNull();
    // Next time it asks again.
    TM.tabs.push(tab('tor2', { partition: 'tor-2' }));
    answer('keep');
    await WM.switchTo('a');
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(TM.tabs.some(t => t.id === 'tor2')).toBe(true);
  });

  it('Always close them closes them and no longer asks, until the setting goes back to Ask', async () => {
    answer('always');
    await WM.switchTo('b');
    expect(ephemeralOpen()).toEqual([]);
    expect(localStorage.getItem('vex.workspacePrivateTabs')).toBe('close');
    expect(WM.ephemeralChoice()).toBe('close');

    TM.tabs.push(tab('tor2', { partition: 'tor-2' }));
    answer('keep');
    await WM.switchTo('a');
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(TM.tabs.some(t => t.id === 'tor2')).toBe(false);

    WM.setEphemeralChoice('ask');
    expect(localStorage.getItem('vex.workspacePrivateTabs')).toBeNull();
    TM.tabs.push(tab('tor3', { partition: 'tor-3' }));
    await WM.switchTo('b');
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(TM.tabs.some(t => t.id === 'tor3')).toBe(true);
  });

  it('does not ask when no private or Tor tab is open', async () => {
    TM.tabs = [tab(uid(1))];
    answer('close');
    await WM.switchTo('b');
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(WM.activeId).toBe('b');
  });

  it('refuses an unknown choice', () => {
    expect(() => WM.setEphemeralChoice('sometimes')).toThrow(/Unknown choice/);
  });

  it('the question is a Vex dialog: three buttons, Keep focused first, Escape keeps them', async () => {
    window.VexI18n = undefined;
    require('../../src/renderer/js/vex-dialog.js');
    const switching = WM.switchTo('b');
    await Promise.resolve();
    const dialog = document.querySelector('.vex-dialog');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labels = [...dialog.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toEqual(['Always close them', 'Keep them open', 'Close them this time']);
    expect(document.activeElement.textContent).toBe('Keep them open');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await switching;
    expect(ephemeralOpen()).toEqual(['priv', 'tor']);
    expect(WM.activeId).toBe('b');
  });

  it('Reset to Defaults clears the remembered choice (it is on the reset list)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    expect(src).toMatch(/'vex\.workspacePrivateTabs'/);
  });
});
