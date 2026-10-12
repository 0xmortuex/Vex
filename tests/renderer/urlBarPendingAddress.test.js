// @vitest-environment jsdom
//
// Typing an address and pressing Enter: the bar keeps showing that address
// while the page loads, as Chrome does. Blurring the bar re-synced it to the
// tab's old address, so the old site's address sat there until the new page
// arrived (found 2026-10-10). A load that is stopped or overtaken puts the
// bar back on the page still showing; one that fails keeps the address asked
// for, with the reason in a toast (as before).
import { beforeEach, describe, expect, it, vi } from 'vitest';

let TabManager, WebviewManager, page;

function fakePage() {
  const p = { calls: [], _attached: true, addEventListener() {} };
  p.loadURL = (url) => new Promise((resolve, reject) => { p.calls.push(url); p.resolve = resolve; p.reject = reject; });
  return p;
}

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<input id="url-input" placeholder="Search or enter URL...">';
  globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.SiteRoutes = undefined;
  window.showToast = vi.fn();
  if (!window.vex) window.vex = { getStartPageUrl: () => new Promise(() => {}) };
  await import('../../src/renderer/js/vex-utils.js');
  ({ TabManager } = await import('../../src/renderer/js/tabs.js'));
  ({ WebviewManager } = await import('../../src/renderer/js/webview.js'));
  globalThis.TabManager = TabManager;
  globalThis.WebviewManager = WebviewManager;
  TabManager.tabs = [{ id: 't1', url: 'https://old.example/', title: 'Old' }];
  TabManager.activeTabId = 't1';
  TabManager.persistTabs = vi.fn();
  TabManager.renderTabUpdate = vi.fn();
  page = fakePage();
  WebviewManager.webviews = new Map([['t1', page]]);
});

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

// What app.js does on Enter: navigate, then let go of the bar (the blur
// handler re-syncs it to the tab).
function typeAndEnter(url) {
  const input = document.getElementById('url-input');
  input.focus();
  input.value = url;
  WebviewManager.navigate(url);
  input.blur();
  TabManager.updateUrlBar(TabManager.getActiveTab());
  return input;
}

describe('address bar while a typed address loads', () => {
  it('keeps showing the address asked for, through the loading events', () => {
    const input = typeAndEnter('https://new.example/page');
    expect(page.calls).toEqual(['https://new.example/page']);
    expect(input.value).toBe('https://new.example/page');
    TabManager.updateTab('t1', { loading: true });   // did-start-loading
    expect(input.value).toBe('https://new.example/page');
  });

  it('follows the page once it arrives', async () => {
    const input = typeAndEnter('https://new.example/page');
    TabManager.updateTab('t1', { url: 'https://new.example/landed' });   // after a redirect
    page.resolve();
    await flush();
    TabManager.updateTab('t1', { loading: false });
    expect(input.value).toBe('https://new.example/landed');
  });

  it('goes back to the page still there when the load is stopped or overtaken', async () => {
    const input = typeAndEnter('https://new.example/file.zip');
    page.reject(new Error("ERR_ABORTED (-3) loading 'https://new.example/file.zip'"));
    await flush();
    expect(input.value).toBe('https://old.example/');
    TabManager.updateTab('t1', { loading: false });
    expect(input.value).toBe('https://old.example/');
  });

  it('a load stopped, or turned into a download (ERR_FAILED -2), goes back without a "Could not open"', async () => {
    const input = typeAndEnter('https://new.example/file.zip');
    TabManager.updateTab('t1', { loading: false });   // did-stop-loading, before the rejection
    page.reject(new Error("Error invoking remote method 'GUEST_VIEW_MANAGER_CALL': Error: ERR_FAILED (-2) loading 'https://new.example/file.zip'"));
    await flush();
    expect(input.value).toBe('https://old.example/');
    expect(TabManager.tabs[0].url).toBe('https://old.example/');
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('an overtaken load does not undo the newer address', async () => {
    const input = typeAndEnter('https://first.example/');
    const first = page.reject;
    typeAndEnter('https://second.example/');
    first(new Error('ERR_ABORTED (-3)'));
    await flush();
    expect(input.value).toBe('https://second.example/');
  });

  it('a failed load keeps the address asked for, and says why', async () => {
    const input = typeAndEnter('https://nowhere.invalid/');
    page.reject(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://nowhere.invalid/'"));
    await flush();
    expect(input.value).toBe('https://nowhere.invalid/');
    expect(TabManager.tabs[0]._typedUrl).toBeUndefined();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Could not open https://nowhere.invalid/'), 'error');
  });
});
