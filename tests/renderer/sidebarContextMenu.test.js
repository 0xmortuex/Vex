// @vitest-environment jsdom
//
// End-to-end integration test for the sidebar right-click context menu.
// The unit test (sidebarRefresh.test.js) covers makeRefreshAction in isolation;
// this test exercises the full flow through the real SidebarManager and a real
// jsdom DOM:
//   right-click sidebar icon → context menu DOM appears → click "Refresh" item
//     → wv.reload() fires and the panel is shown if it wasn't already active.
//
// This is the regression coverage for the original bug — right-click ▸ Refresh
// silently no-op'd because the panel wasn't visible. Unit tests don't catch
// listener-wiring bugs; this one does.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provide globals SidebarManager.init/showContextMenu touch BEFORE require so
// the module sees them. These mirror what the renderer provides via <script>
// tags in production.
function installGlobals() {
  globalThis.TabManager = {
    tabs: [],
    activeTabId: null,
    createTab: vi.fn(),
    switchTab: vi.fn(),
    _clampMenuToViewport: vi.fn(),
    _attachMenuDismissal: vi.fn(),
  };
  globalThis.WebviewManager = { showWebview: vi.fn() };
  // Custom panels' init() are referenced inside showPanel — guard with empty
  // stubs so a stray showPanel('claude') (which is not in customPanels) won't
  // accidentally reach into them.
  for (const name of ['CUSAPanel','RobloxPanel','GitHubPanel','NotesPanel','DownloadsPanel','HistoryPanel','MemoryPanel','SchedulesPanel','ShortcutsPanel','ThemeEditor','SyncSettings','AISettings','PersonasSettings','ShortcutEditor','ExtensionsSettings','PermissionsSettings','LocationSettings']) {
    globalThis[name] = { init: vi.fn(), render: vi.fn(), renderPanel: vi.fn(), renderSyncPanel: vi.fn(), renderAISettings: vi.fn() };
  }
  globalThis.isStartPage = () => false;
  globalThis.START_URL = 'vex://start';
  // window.vexDevTools is read in showContextMenu's "Open DevTools" item but
  // we won't click that item in this test — leaving it undefined exercises
  // the wv.openDevTools fallback path implicitly.
  if (!globalThis.window.vexDevTools) globalThis.window.vexDevTools = undefined;
}

function buildDOM() {
  document.body.innerHTML = `
    <div id="webviews-container"></div>
    <div id="panels-container">
      <div id="panel-claude" class="panel"></div>
    </div>
    <button class="sidebar-icon" data-panel="claude"></button>
  `;
}

describe('sidebar context menu (jsdom integration)', () => {
  let SidebarManager;
  let fakeWebview;

  beforeEach(async () => {
    // Reset module cache so each test gets a fresh SidebarManager (its
    // activePanel/panelWebviews are mutable module state).
    vi.resetModules();
    document.body.innerHTML = '';
    installGlobals();
    buildDOM();
    ({ SidebarManager } = await import('../../src/renderer/js/sidebar.js'));
    fakeWebview = { reload: vi.fn(), openDevTools: vi.fn(), getWebContentsId: vi.fn(() => 42) };
  });

  it('right-click on a sidebar icon opens a menu with Refresh + DevTools', () => {
    SidebarManager.init();
    const icon = document.querySelector('.sidebar-icon[data-panel="claude"]');

    icon.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));

    const menu = document.querySelector('.tab-context-menu');
    expect(menu).not.toBeNull();
    const labels = [...menu.querySelectorAll('.tab-context-item')].map(el => el.textContent);
    expect(labels).toEqual(['Refresh', 'Open DevTools']);
  });

  it('clicking Refresh on an inactive panel shows the panel AND reloads the webview', () => {
    SidebarManager.init();
    // Pre-populate a webview so the makeRefreshAction "wv exists" branch fires.
    SidebarManager.panelWebviews.claude = fakeWebview;
    SidebarManager.activePanel = null; // not currently shown

    const showPanelSpy = vi.spyOn(SidebarManager, 'showPanel');

    document.querySelector('.sidebar-icon[data-panel="claude"]')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));

    const refreshItem = [...document.querySelectorAll('.tab-context-item')]
      .find(el => el.textContent === 'Refresh');
    expect(refreshItem).toBeTruthy();

    refreshItem.click();

    // Both behaviours are required to fix the original bug — showPanel without
    // reload leaves stale content; reload without showPanel hides the refresh
    // from the user.
    expect(showPanelSpy).toHaveBeenCalledWith('claude');
    expect(fakeWebview.reload).toHaveBeenCalledTimes(1);

    // Menu dismisses itself after a click.
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('clicking Refresh on the already-active panel reloads but does NOT re-show', () => {
    SidebarManager.init();
    SidebarManager.panelWebviews.claude = fakeWebview;
    SidebarManager.activePanel = 'claude'; // already visible

    const showPanelSpy = vi.spyOn(SidebarManager, 'showPanel');

    document.querySelector('.sidebar-icon[data-panel="claude"]')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    [...document.querySelectorAll('.tab-context-item')]
      .find(el => el.textContent === 'Refresh').click();

    expect(showPanelSpy).not.toHaveBeenCalled();
    expect(fakeWebview.reload).toHaveBeenCalledTimes(1);
  });

  it('right-click on a custom panel (settings) does NOT open the menu', () => {
    document.body.innerHTML += `<button class="sidebar-icon" data-panel="settings"></button>`;
    SidebarManager.init();

    document.querySelector('.sidebar-icon[data-panel="settings"]')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('right-click on the Start (house) icon does NOT open the menu', () => {
    document.body.innerHTML += `<button class="sidebar-icon" data-panel="start"></button>`;
    SidebarManager.init();

    document.querySelector('.sidebar-icon[data-panel="start"]')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('opening a second context menu replaces the first (no stacking)', () => {
    SidebarManager.init();
    const icon = document.querySelector('.sidebar-icon[data-panel="claude"]');

    icon.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    icon.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }));

    expect(document.querySelectorAll('.tab-context-menu').length).toBe(1);
  });
});
