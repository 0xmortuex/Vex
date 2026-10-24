// @vitest-environment jsdom
//
// Closing the only tab in a window closes the window, as in every other browser. It used to open a new tab in its place, so there was never a
// way to close the window with Ctrl+W or the tab's X (asked for 2026-10-25).
import { describe, it, expect, vi, beforeEach } from 'vitest';

window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');
require('../../src/renderer/js/tab-policy.js');

const tab = (id) => ({ id, url: `https://${id}.example/`, title: id, favicon: null, loading: false, pinned: false, groupId: null, stackId: null });

let TM, closeWindow;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="top-tabs-list"></div><div id="tabs-list"></div>';
  globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
  globalThis.WebviewManager = { webviews: new Map(), destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  for (const k of ['TabGrouper', 'SplitScreen', 'DuplicateTabs', 'SiteRoutes', 'TabTrail', 'CloseProtect']) globalThis[k] = undefined;
  closeWindow = vi.fn();
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}), close: closeWindow };
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  window.showToast = vi.fn();
  Element.prototype.scrollIntoView = function () {};
  vi.resetModules();
  await import('../../src/renderer/js/vex-utils.js');
  TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
  globalThis.TabManager = TM;
  TM.persistTabs = vi.fn();
  TM.closeTab = vi.fn((id) => { TM.tabs = TM.tabs.filter(t => t.id !== id); });
});

describe('closing a tab by hand (Ctrl+W, the X, a middle click)', () => {
  it('closes the window when it was the only tab', async () => {
    TM.tabs = [tab('a')];
    TM.activeTabId = 'a';
    await expect(TM.requestClose('a')).resolves.toBe(true);
    expect(TM.closeTab).toHaveBeenCalledWith('a');
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('leaves the window alone while other tabs remain', async () => {
    TM.tabs = [tab('a'), tab('b')];
    TM.activeTabId = 'a';
    await TM.requestClose('a');
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('does not close the window when the person said no to the "close it anyway?" question', async () => {
    TM.tabs = [tab('a')];
    globalThis.CloseProtect = { close: vi.fn(async () => false) };
    await expect(TM.requestClose('a')).resolves.toBe(false);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('closes the window after the question was answered yes', async () => {
    TM.tabs = [tab('a')];
    globalThis.CloseProtect = { close: vi.fn(async (id) => { TM.closeTab(id); return true; }) };
    await TM.requestClose('a');
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('programmatic and bulk closes still never close the window (closeTab, closeTabsWithUndo...)', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/tabs.js'), 'utf8');
    const close = src.slice(src.indexOf('\n  closeTab(id) {'), src.indexOf('\n  closeTab(id) {') + 6000);
    expect(close).not.toContain('closeWindowAfterLastTab');
  });
});
