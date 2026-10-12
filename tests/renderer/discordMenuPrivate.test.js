// @vitest-environment jsdom
//
// The Discord panel's right-click menu offers the block bypass (Auto-configure,
// Turn bypass off, Bypass settings). Main refuses discord:set-bypass-mode from
// a private window, and js/discord-bypass.js is loaded in every window — so a
// private window's Discord menu offered all three and each one failed (found in
// the v19.1.7 check: "This operation is unavailable in a private window", and
// Auto-configure ended on "Couldn't get through").

import { describe, it, expect, vi, beforeEach } from 'vitest';

function installGlobals() {
  globalThis.TabManager = { tabs: [], activeTabId: null, createTab: vi.fn(), switchTab: vi.fn(), _clampMenuToViewport: vi.fn(), _attachMenuDismissal: vi.fn() };
  globalThis.WebviewManager = { showWebview: vi.fn() };
  globalThis.VexJobs = { every: vi.fn(() => ({ stop: vi.fn() })) };
  globalThis.isStartPage = () => false;
  globalThis.START_URL = 'vex://start';
  window.DiscordBypass = { choice: () => ({ mode: 'light' }), replay: vi.fn(async () => null), label: () => 'Light' };
}

function menuLabels() {
  document.querySelector('.sidebar-icon[data-panel="discord"]')
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
  const menu = document.querySelector('.tab-context-menu');
  return menu ? [...menu.querySelectorAll('.tab-context-item')].map(el => el.textContent) : [];
}

describe('Discord panel menu: the bypass', () => {
  let SidebarManager;
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = `<div id="webviews-container"></div><div id="panels-container"><div id="panel-discord" class="panel"></div></div><button class="sidebar-icon" data-panel="discord"></button>`;
    installGlobals();
    ({ SidebarManager } = await import('../../src/renderer/js/sidebar.js'));
  });

  it('offers the bypass items in the main window', () => {
    window.VexTabPolicy = { isPrivateWindow: false };
    SidebarManager.init();
    const labels = menuLabels();
    expect(labels).toContain('Auto-configure bypass');
    expect(labels).toContain('Turn bypass off (use Zapret)');
    expect(labels).toContain('Bypass settings…');
  });

  it('leaves them out of a private window, where main refuses them', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    SidebarManager.init();
    const labels = menuLabels();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some(l => /bypass/i.test(l))).toBe(false);
  });
});
