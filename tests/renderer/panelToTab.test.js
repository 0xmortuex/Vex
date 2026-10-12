// @vitest-environment jsdom
//
// "add an option next to Roblox Hub saying that it can open the current tab
// as a tab (website), so people who need links or IDs would find it easier"
// (owner, 2026-10-12). A web panel's page — the one it is showing now, not the
// one it started on — opens as a tab beside the one in front, in the panel's
// own session so the sign-in comes with it; or its address is copied. Offered
// on the panel's bar, the sidebar icon's right-click menu, and Ctrl+K.

import { describe, it, expect, vi, beforeEach } from 'vitest';

function installGlobals() {
  globalThis.TabManager = {
    tabs: [{ id: 't1', url: 'https://example.com/', groupId: 'g1' }],
    activeTabId: 't1',
    getActiveTab: vi.fn(() => globalThis.TabManager.tabs[0]),
    createTab: vi.fn(() => ({ id: 't2' })),
    switchTab: vi.fn(),
    _clampMenuToViewport: vi.fn(),
    _attachMenuDismissal: vi.fn(),
  };
  globalThis.WebviewManager = { showWebview: vi.fn() };
  globalThis.VexJobs = { every: vi.fn(() => ({ stop: vi.fn() })) };
  globalThis.isStartPage = () => false;
  globalThis.START_URL = 'vex://start';
  window.showToast = vi.fn();
}

function buildDOM() {
  document.body.innerHTML = `
    <div id="webviews-container"></div>
    <div id="panels-container">
      <div id="panel-roblox" class="panel"></div>
      <div id="panel-claude" class="panel"></div>
      <div id="panel-notes" class="panel"></div>
    </div>
    <button class="sidebar-icon" data-panel="roblox" title="Roblox Hub"></button>
    <button class="sidebar-icon" data-panel="claude" title="Claude"></button>
    <button class="sidebar-icon" data-panel="notes" title="Notes"></button>
  `;
}

// A panel's <webview> after you have clicked around inside it.
function fakeWebview(url) {
  const wv = document.createElement('div');
  wv.getURL = vi.fn(() => url);
  return wv;
}

let SidebarManager, PanelToTab, VexI18nUI;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  installGlobals();
  buildDOM();
  ({ SidebarManager } = await import('../../src/renderer/js/sidebar.js'));
  globalThis.SidebarManager = SidebarManager;
  await import('../../src/renderer/js/vex-icons.js');
  ({ VexI18nUI } = await import('../../src/renderer/js/i18n-ui.js'));
  globalThis.VexI18nUI = VexI18nUI;
  ({ PanelToTab } = await import('../../src/renderer/js/panel-to-tab.js'));
  globalThis.PanelToTab = PanelToTab;
});

describe('opening a web panel\'s page as a tab', () => {
  it('opens the page the panel is showing now, in the panel\'s session, next to the active tab', () => {
    SidebarManager.panelWebviews.roblox = fakeWebview('https://www.roblox.com/games/12345/name');
    PanelToTab.openInTab('roblox');
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
    const [url, activate, groupId, opts] = TabManager.createTab.mock.calls[0];
    expect(url).toBe('https://www.roblox.com/games/12345/name');
    expect(activate).toBe(true);
    expect(groupId).toBe('g1');
    expect(opts).toMatchObject({ partition: 'persist:roblox', openerTabId: 't1', rightAfterOpener: true });
  });

  it('uses the address kept from the last navigation when the page is between loads', () => {
    const wv = fakeWebview('about:blank');
    wv.dataset.liveUrl = 'https://discord.com/channels/1/2';
    SidebarManager.panelWebviews.discord = wv;
    PanelToTab.openInTab('discord');
    expect(TabManager.createTab.mock.calls[0][0]).toBe('https://discord.com/channels/1/2');
    expect(TabManager.createTab.mock.calls[0][3].partition).toBe('persist:discord');
  });

  it('a panel that is not loaded opens its own link', () => {
    PanelToTab.openInTab('spotify');
    expect(TabManager.createTab.mock.calls[0][0]).toBe('https://open.spotify.com/');
    expect(TabManager.createTab.mock.calls[0][3].partition).toBe('persist:spotify');
  });

  it('a pinned site opens in the ordinary tab session', () => {
    SidebarManager.panelConfigs.site_abc = { url: 'https://news.example/', partition: 'persist:main' };
    SidebarManager.panelWebviews.site_abc = fakeWebview('https://news.example/story/7');
    PanelToTab.openInTab('site_abc');
    expect(TabManager.createTab.mock.calls[0][0]).toBe('https://news.example/story/7');
    expect(TabManager.createTab.mock.calls[0][3].partition).toBe('persist:main');
  });

  it('refuses a panel that is not a web page, and a page that is not a website', () => {
    expect(() => PanelToTab.openInTab('notes')).toThrow(/does not show a web page/);
    SidebarManager.panelWebviews.claude = fakeWebview('chrome-error://chromewebdata/');
    expect(() => PanelToTab.openInTab('claude')).toThrow(/no page to open/);
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });

  it('a failure is said in a toast, not thrown at the button', () => {
    PanelToTab.run('open', 'notes');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/does not show a web page/), 'error');
  });
});

describe('copying the page link', () => {
  it('copies the live address and says so', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    SidebarManager.panelWebviews.roblox = fakeWebview('https://www.roblox.com/users/99/profile');
    await PanelToTab.copyLink('roblox');
    expect(writeText).toHaveBeenCalledWith('https://www.roblox.com/users/99/profile');
    expect(window.showToast).toHaveBeenCalledWith('Page link copied: https://www.roblox.com/users/99/profile');
  });
});

describe('the button on the panel\'s bar', () => {
  it('every web panel\'s bar has an "Open in a tab" button that opens the live page', () => {
    const panelEl = document.getElementById('panel-roblox');
    const wv = fakeWebview('https://www.roblox.com/games/12345/name');
    wv.canGoBack = () => false; wv.canGoForward = () => false;
    panelEl.appendChild(wv);
    SidebarManager.panelWebviews.roblox = wv;
    SidebarManager._addPanelNav(panelEl, wv, 'roblox');
    const btn = document.querySelector('.panel-navbar[data-panel="roblox"] .pnav-tab');
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.title).toBe('Open in a tab');
    expect(btn.getAttribute('aria-label')).toBe('Open in a tab');
    expect(btn.querySelector('svg')).toBeTruthy();
    btn.click();
    expect(TabManager.createTab.mock.calls[0][0]).toBe('https://www.roblox.com/games/12345/name');
    expect(TabManager.createTab.mock.calls[0][3].partition).toBe('persist:roblox');
  });

  it('is in Turkish when Vex is', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    const nav = document.createElement('div');
    const btn = PanelToTab.decorateNav(nav, 'roblox');
    expect(btn.title).toBe('Sekmede aç');
    expect(btn.getAttribute('aria-label')).toBe('Sekmede aç');
  });
});

describe('the sidebar icon\'s right-click menu', () => {
  const labels = () => [...document.querySelectorAll('.tab-context-menu .tab-context-item')].map(el => el.textContent);

  it('a web panel offers Open in a tab and Copy page link first', () => {
    SidebarManager.init();
    document.querySelector('.sidebar-icon[data-panel="roblox"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(labels().slice(0, 2)).toEqual(['Open in a tab', 'Copy page link']);
  });

  it('clicking it opens the tab', () => {
    SidebarManager.init();
    SidebarManager.panelWebviews.claude = fakeWebview('https://claude.ai/chat/abc');
    document.querySelector('.sidebar-icon[data-panel="claude"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    [...document.querySelectorAll('.tab-context-item')].find(el => el.textContent === 'Open in a tab').click();
    expect(TabManager.createTab.mock.calls[0][0]).toBe('https://claude.ai/chat/abc');
    expect(TabManager.createTab.mock.calls[0][3].partition).toBe('persist:claude');
  });

  it('a Vex panel (Notes) does not offer them', () => {
    SidebarManager.init();
    document.querySelector('.sidebar-icon[data-panel="notes"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(labels()).not.toContain('Open in a tab');
    expect(labels()).not.toContain('Copy page link');
  });

  it('the menu items are in Turkish when Vex is', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    SidebarManager.init();
    document.querySelector('.sidebar-icon[data-panel="roblox"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(labels().slice(0, 2)).toEqual(['Sekmede aç', 'Sayfa bağlantısını kopyala']);
  });
});

describe('Ctrl+K', () => {
  it('has "Open Roblox Hub page in a tab", and the generic one only while a web panel is open', async () => {
    const { CommandBar } = await import('../../src/renderer/js/command.js');
    const roblox = CommandBar.commands.find(c => c.id === 'roblox-page-tab');
    const generic = CommandBar.commands.find(c => c.id === 'panel-page-tab');
    expect(roblox && roblox.label).toBe('Open Roblox Hub page in a tab');
    expect(generic && generic.label).toBe('Open side panel page in a tab');
    expect(CommandBar._shown(roblox)).toBe(true);
    SidebarManager.activePanel = 'notes';
    expect(CommandBar._shown(generic)).toBe(false);
    SidebarManager.activePanel = 'claude';
    expect(CommandBar._shown(generic)).toBe(true);
    SidebarManager.panelWebviews.claude = fakeWebview('https://claude.ai/chat/xyz');
    generic.action();
    expect(TabManager.createTab.mock.calls[0][0]).toBe('https://claude.ai/chat/xyz');
    roblox.action();
    expect(TabManager.createTab.mock.calls[1][0]).toBe('https://www.roblox.com/');
    expect(TabManager.createTab.mock.calls[1][3].partition).toBe('persist:roblox');
  });

  it('the commands are in Turkish when Vex is', async () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    const { CommandBar } = await import('../../src/renderer/js/command.js');
    expect(CommandBar.commands.find(c => c.id === 'roblox-page-tab').label).toBe('Roblox Hub sayfasını sekmede aç');
    expect(CommandBar.commands.find(c => c.id === 'panel-page-tab').label).toBe('Yan paneldeki sayfayı sekmede aç');
  });
});

describe('it is loaded in the window', () => {
  it('index.html loads js/panel-to-tab.js after sidebar.js and before command.js', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const html = readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
    const at = (f) => html.indexOf('<script src="js/' + f + '"></script>');
    expect(at('panel-to-tab.js')).toBeGreaterThan(at('sidebar.js'));
    expect(at('panel-to-tab.js')).toBeLessThan(at('command.js'));
    expect(at('sidebar.js')).toBeGreaterThan(-1);
  });
});
