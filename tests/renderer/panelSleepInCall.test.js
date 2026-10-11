// @vitest-environment jsdom
//
// Sleeping a panel that is in a call hangs up the call. It used to be allowed
// from the panel's menu, the Memory panel and "Why is Vex slow", and it left
// the capture state set for ever: the microphone badge stayed on the icon, and
// the panel counted as "in a call" so no memory limit ever applied again.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');

function fakeWebview(name, { audible = false } = {}) {
  const wv = document.createElement('webview');
  wv.isCurrentlyAudible = () => audible;
  wv.getWebContentsId = () => 100;
  wv.reload = vi.fn();
  document.getElementById('panel-' + name).appendChild(wv);
  SidebarManager.panelWebviews[name] = wv;
  return wv;
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="icon-sidebar">
      <button class="sidebar-icon" data-panel="discord" title="Discord"></button>
      <button class="sidebar-icon" data-panel="claude" title="Claude"></button>
    </div>
    <div id="panels-container">
      <div class="panel" id="panel-discord"></div>
      <div class="panel" id="panel-claude"></div>
    </div>`;
  localStorage.clear();
  SidebarManager.activePanel = null;
  SidebarManager.sidePanel = null;
  SidebarManager.panelWebviews = {};
  SidebarManager.sleptPanels = {};
  SidebarManager.panelCapture = {};
  window.showToast = vi.fn();
  window.vex = {};
  globalThis.SidebarManager = SidebarManager;
});

describe('a panel in a call', () => {
  it('is refused, with the reason', () => {
    fakeWebview('discord');
    SidebarManager.setPanelCapturing('discord', 'mic', true);
    expect(() => SidebarManager.sleepPanel('discord')).toThrow(/Discord is in use — it is using the microphone/);
    expect(SidebarManager.panelWebviews.discord).toBeTruthy();
  });

  it('is refused while it is making a sound', () => {
    fakeWebview('claude', { audible: true });
    expect(() => SidebarManager.sleepPanel('claude')).toThrow(/making a sound/);
  });

  it('sleeps when the user said yes, and the call state goes with it', () => {
    fakeWebview('discord');
    SidebarManager.setPanelCapturing('discord', 'mic', true);
    SidebarManager.setPanelCapturing('discord', 'screen', true);
    const icon = document.querySelector('.sidebar-icon[data-panel="discord"]');
    icon.insertAdjacentHTML('beforeend', '<span class="icon-badge discord-call"></span>');
    const events = [];
    document.addEventListener('vex:media-capture', (e) => events.push(e.detail));
    SidebarManager.sleepPanel('discord', { evenIfBusy: true });
    expect(SidebarManager.panelWebviews.discord).toBeUndefined();
    expect(SidebarManager.isPanelCapturing('discord')).toBe(false);
    expect(SidebarManager.panelBusy('discord')).toBe('');
    expect(icon.querySelector('.icon-badge.capture')).toBe(null);
    expect(icon.querySelector('.icon-badge.discord-call')).toBe(null);
    expect(events.filter(e => !e.active).map(e => e.kind).sort()).toEqual(['mic', 'screen']);
  });

  it("the panel menu asks first, and a no leaves the call alone", async () => {
    fakeWebview('discord');
    SidebarManager.setPanelCapturing('discord', 'mic', true);
    window.vexConfirm = vi.fn(async () => false);
    globalThis.TabManager = { _clampMenuToViewport: vi.fn(), _attachMenuDismissal: vi.fn() };
    SidebarManager.showContextMenu({ preventDefault() {}, clientX: 1, clientY: 1 }, 'discord');
    const item = [...document.querySelectorAll('.tab-context-menu *')].find(n => /^Sleep panel/.test(n.textContent.trim()));
    expect(item).toBeTruthy();
    item.click();
    await vi.waitFor(() => expect(window.vexConfirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(SidebarManager.panelWebviews.discord).toBeTruthy();
    window.vexConfirm = vi.fn(async () => true);
    SidebarManager.showContextMenu({ preventDefault() {}, clientX: 1, clientY: 1 }, 'discord');
    [...document.querySelectorAll('.tab-context-menu *')].filter(n => /^Sleep panel/.test(n.textContent.trim())).pop().click();
    await vi.waitFor(() => expect(SidebarManager.panelWebviews.discord).toBeUndefined());
  });

  it('switching Discord to a tab in a call is refused and not saved', () => {
    fakeWebview('discord');
    SidebarManager.setPanelCapturing('discord', 'mic', true);
    expect(() => DiscordMemory.setMode('tab')).toThrow(/after the call/);
    expect(DiscordMemory.mode()).toBe('panel');
    expect(SidebarManager.panelWebviews.discord).toBeTruthy();
  });
});
