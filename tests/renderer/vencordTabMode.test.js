// @vitest-environment jsdom
//
// With Discord set to open as a tab, "Install my Vencord build" (and Install /
// Update Vencord) only switched to the Discord tab: the page there kept
// running the previous build, so the new plugins never showed. The tab is now
// opened fresh. Nothing is downloaded here: the installs are stubs.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');

let tabs, nextId;
beforeEach(() => {
  document.body.innerHTML = `
    <button class="sidebar-icon" data-panel="discord" title="Discord"></button>
    <div id="panels-container"><div class="panel" id="panel-discord"></div></div>`;
  localStorage.clear();
  localStorage.setItem('vex.discordMode', 'tab');
  tabs = [{ id: 5, url: 'https://discord.com/channels/1/2', partition: 'persist:discord' }];
  nextId = 6;
  globalThis.TabManager = {
    tabs,
    switchTab: vi.fn(),
    createTab: vi.fn((url, active, _x, opts) => { tabs.push({ id: nextId++, url, partition: opts.partition }); }),
    closeTab: vi.fn((id) => { const i = tabs.findIndex(t => t.id === id); if (i >= 0) tabs.splice(i, 1); }),
    _clampMenuToViewport: vi.fn(), _attachMenuDismissal: vi.fn(),
  };
  globalThis.WebviewManager = { webviews: new Map(), showWebview: vi.fn() };
  window.DiscordMemory = DiscordMemory;
  SidebarManager.panelWebviews = {};
  SidebarManager.activePanel = null;
  SidebarManager.sidePanel = null;
  window.showToast = vi.fn();
});

function clickMenu(label) {
  SidebarManager.showContextMenu({ preventDefault() {}, clientX: 1, clientY: 1 }, 'discord');
  const item = [...document.querySelectorAll('.tab-context-menu *')].find(n => n.textContent.trim().startsWith(label));
  if (!item) throw new Error('no menu item ' + label);
  item.click();
}

describe('Vencord with Discord as a tab', () => {
  it('"Install my Vencord build" opens the Discord tab fresh', async () => {
    window.vex = { installVencordLocal: vi.fn(async () => ({ ok: true, version: '1.2.3' })) };
    clickMenu('Install my Vencord build');
    await vi.waitFor(() => expect(TabManager.closeTab).toHaveBeenCalledWith(5));
    expect(TabManager.createTab).toHaveBeenCalledWith('https://discord.com/app', true, null, { partition: 'persist:discord' });
    expect(TabManager.switchTab).not.toHaveBeenCalled();
  });

  it('"Install / Update Vencord" does the same', async () => {
    window.vex = { installVencord: vi.fn(async () => ({ ok: true, version: '1.2.3' })) };
    clickMenu('Install / Update Vencord');
    await vi.waitFor(() => expect(TabManager.closeTab).toHaveBeenCalledWith(5));
    expect(tabs.map(t => t.id)).toEqual([6]);
  });

  it('with no Discord tab open, one is opened', () => {
    tabs.length = 0;
    expect(SidebarManager._reopenDiscordTab()).toBe(true);
    expect(TabManager.closeTab).not.toHaveBeenCalled();
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
  });

  it('as a panel, the tab path is not taken', () => {
    localStorage.setItem('vex.discordMode', 'panel');
    expect(SidebarManager._reopenDiscordTab()).toBe(false);
    expect(TabManager.closeTab).not.toHaveBeenCalled();
  });
});
