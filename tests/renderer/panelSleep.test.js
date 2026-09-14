// @vitest-environment jsdom
//
// Web panels give their process back. A hidden panel kept its <webview> for
// good — Claude, Spotify, GitHub… 150–350 MB each after one open. Sleeping
// drops the webview (showPanel makes a fresh one next time); hidden panels
// sleep after the idle time; Discord is kept awake by default; a panel playing
// audio never sleeps. Discord past its ceiling gets a notice with Reload.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

function fakeWebview(name, { audible = false, wcId = 100 } = {}) {
  const wv = document.createElement('webview');
  wv.isCurrentlyAudible = () => audible;
  wv.getWebContentsId = () => wcId;
  wv.reload = vi.fn();
  document.getElementById('panel-' + name).appendChild(wv);
  const nav = document.createElement('div');
  nav.className = 'panel-navbar'; nav.dataset.panel = name;
  document.getElementById('panel-' + name).appendChild(nav);
  SidebarManager.panelWebviews[name] = wv;
  return wv;
}

const usage = (o) => localStorage.setItem('vex.panelUsage', JSON.stringify(o));

beforeEach(() => {
  document.body.innerHTML = `
    <div id="icon-sidebar">
      <button class="sidebar-icon" data-panel="claude" title="Claude AI"></button>
      <button class="sidebar-icon" data-panel="spotify" title="Spotify"></button>
      <button class="sidebar-icon" data-panel="discord" title="Discord"></button>
      <button class="sidebar-icon" data-panel="notes" title="Notes"></button>
    </div>
    <div id="content-area">
      <div id="panels-container">
        <div class="panel" id="panel-claude"></div>
        <div class="panel" id="panel-spotify"></div>
        <div class="panel" id="panel-discord"></div>
        <div class="panel" id="panel-notes"></div>
      </div>
      <div id="webviews-container"></div>
    </div>`;
  localStorage.clear();
  SidebarManager.activePanel = null;
  SidebarManager.sidePanel = null;
  SidebarManager.panelWebviews = {};
  SidebarManager.sleptPanels = {};
  SidebarManager.panelCapture = {};
  SidebarManager._discordWarnedAt = 0;
  globalThis.NotesPanel = { init: vi.fn() };
  globalThis.TabManager = { activeTabId: null, _clampMenuToViewport: vi.fn(), _attachMenuDismissal: vi.fn() };
  globalThis.WebviewManager = { showWebview: vi.fn() };
  window.showToast = vi.fn();
  window.vex = {};
});

describe('sleeping a panel', () => {
  it('drops its webview and nav strip, and says so', () => {
    fakeWebview('claude');
    const seen = [];
    document.addEventListener('vex:panel-slept', (e) => seen.push(e.detail.panel), { once: true });
    SidebarManager.sleepPanel('claude');
    expect(document.querySelector('#panel-claude webview')).toBe(null);
    expect(document.querySelector('.panel-navbar[data-panel="claude"]')).toBe(null);
    expect(SidebarManager.panelWebviews.claude).toBeUndefined();
    expect(seen).toEqual(['claude']);
    expect(SidebarManager.sleptPanels.claude).toBeGreaterThan(0);
  });

  it('refuses a panel that is open, or not loaded', () => {
    expect(() => SidebarManager.sleepPanel('claude')).toThrow(/not loaded/);
    fakeWebview('claude');
    SidebarManager.activePanel = 'claude';
    expect(() => SidebarManager.sleepPanel('claude')).toThrow(/open/);
    SidebarManager.activePanel = 'notes';
    SidebarManager.sidePanel = 'claude';
    expect(() => SidebarManager.sleepPanel('claude')).toThrow(/open/);
  });

  it('knows which panels are web panels', () => {
    expect(SidebarManager.isWebPanel('claude')).toBe(true);
    expect(SidebarManager.isWebPanel('notes')).toBe(false);
    expect(SidebarManager.isWebPanel('settings')).toBe(false);
  });

  it('the icon menu offers Sleep for a loaded hidden web panel only', () => {
    const labels = (name) => {
      SidebarManager.showContextMenu({ clientX: 0, clientY: 0 }, name);
      const items = [...document.querySelectorAll('.tab-context-menu .tab-context-item')].map(i => i.textContent);
      document.querySelectorAll('.tab-context-menu').forEach(m => m.remove());
      return items;
    };
    expect(labels('claude').some(l => /Sleep panel/.test(l))).toBe(false);
    fakeWebview('claude');
    expect(labels('claude').some(l => /Sleep panel/.test(l))).toBe(true);
    SidebarManager.activePanel = 'claude';
    expect(labels('claude').some(l => /Sleep panel/.test(l))).toBe(false);
  });
});

describe('which hidden panels are due', () => {
  it('after the idle time, counted from when the panel was last in front', () => {
    fakeWebview('claude'); fakeWebview('spotify');
    const now = 10_000_000;
    usage({ claude: now - 31 * 60000, spotify: now - 5 * 60000 });
    expect(SidebarManager.panelsDueToSleep(now)).toEqual(['claude']);
  });

  it('never the open ones, Discord by default, or anything audible', () => {
    fakeWebview('claude'); fakeWebview('spotify', { audible: true }); fakeWebview('discord');
    const now = 10_000_000;
    usage({});                                   // never stamped → long idle
    SidebarManager.activePanel = 'claude';
    expect(SidebarManager.panelsDueToSleep(now)).toEqual([]);
    SidebarManager.activePanel = null;
    expect(SidebarManager.panelsDueToSleep(now)).toEqual(['claude']);
    // Keep Discord awake can be turned off.
    localStorage.setItem('vex.panelSleepExempt', '[]');
    expect(SidebarManager.panelsDueToSleep(now)).toEqual(['claude', 'discord']);
  });

  it('honours the switch, and Memory Saver shortens the wait to 10 minutes', () => {
    fakeWebview('claude');
    const now = 10_000_000;
    usage({ claude: now - 15 * 60000 });
    expect(SidebarManager.panelsDueToSleep(now)).toEqual([]);
    localStorage.setItem('vex.memorySaver', '1');
    expect(SidebarManager.panelSleepPrefs().minutes).toBe(10);
    expect(SidebarManager.panelsDueToSleep(now)).toEqual(['claude']);
    localStorage.setItem('vex.panelAutoSleep', '0');
    expect(SidebarManager.panelsDueToSleep(now)).toEqual([]);
  });

  it('leaving a panel stamps it, so the clock starts then', () => {
    SidebarManager.showPanel('notes');
    const before = JSON.parse(localStorage.getItem('vex.panelUsage')).notes;
    expect(before).toBeGreaterThan(0);
    vi.useFakeTimers();
    vi.setSystemTime(before + 60000);
    SidebarManager.hideActivePanel();
    expect(JSON.parse(localStorage.getItem('vex.panelUsage')).notes).toBe(before + 60000);
    vi.useRealTimers();
  });

  it('the settings switches read and write the preferences', () => {
    document.body.insertAdjacentHTML('beforeend', '<input type="checkbox" id="setting-panel-autosleep"><input type="checkbox" id="setting-panel-keep-discord">');
    SidebarManager._wirePanelSleepSettings();
    const auto = document.getElementById('setting-panel-autosleep');
    const keep = document.getElementById('setting-panel-keep-discord');
    expect(auto.checked).toBe(true);
    expect(keep.checked).toBe(true);
    auto.checked = false; auto.dispatchEvent(new Event('change'));
    keep.checked = false; keep.dispatchEvent(new Event('change'));
    expect(SidebarManager.panelSleepPrefs()).toMatchObject({ enabled: false, exempt: [] });
  });
});

describe('the Discord memory watch', () => {
  it('shows a notice with Reload past the ceiling, and a toast at most every 30 minutes', async () => {
    const wv = fakeWebview('discord', { wcId: 7 });
    window.vex.tabMemory = vi.fn(async () => ({ totalKB: 0, byId: { 7: { memKB: 1500 * 1024, pid: 1 } } }));
    expect(await SidebarManager.checkDiscordMemory()).toEqual({ mb: 1500, over: true });
    const banner = document.querySelector('#panel-discord .discord-mem-banner');
    expect(banner.textContent).toMatch(/1\.5 GB/);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    await SidebarManager.checkDiscordMemory();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.discord-mem-banner').length).toBe(1);
    banner.querySelector('.dmb-reload').click();
    expect(wv.reload).toHaveBeenCalled();
    expect(document.querySelector('.discord-mem-banner')).toBe(null);
  });

  it('is quiet under the ceiling, and takes the notice down again', async () => {
    fakeWebview('discord', { wcId: 7 });
    let kb = 1500 * 1024;
    window.vex.tabMemory = vi.fn(async () => ({ totalKB: 0, byId: { 7: { memKB: kb, pid: 1 } } }));
    await SidebarManager.checkDiscordMemory();
    expect(document.querySelector('.discord-mem-banner')).not.toBe(null);
    kb = 600 * 1024;
    expect(await SidebarManager.checkDiscordMemory()).toEqual({ mb: 600, over: false });
    expect(document.querySelector('.discord-mem-banner')).toBe(null);
  });

  it('does nothing without a Discord panel or the bridge', async () => {
    expect(await SidebarManager.checkDiscordMemory()).toBe(null);
    fakeWebview('discord');
    expect(await SidebarManager.checkDiscordMemory()).toBe(null);
  });
});

// Discord's webview runs unthrottled so a hidden panel reconnects instantly —
// and burned ~35% of a core all day. Hidden two minutes with no call, it rests.
describe('Discord rests when hidden and not in a call', () => {
  const NOW = 10_000_000;
  function discordWebview(over) {
    const wv = fakeWebview('discord', { wcId: 7, ...over });
    wv.executeJavaScript = vi.fn(async () => over && over.disconnectButton ? true : false);
    window.vex.setBackgroundThrottling = vi.fn(async () => ({ ok: true }));
    SidebarManager._discordThrottled = false;
    return wv;
  }

  it('throttles after two minutes hidden with no call, and unthrottles when shown', async () => {
    discordWebview();
    usage({ discord: NOW - 3 * 60000 });
    expect(await SidebarManager.checkDiscordThrottle(NOW)).toEqual({ visible: false, inCall: false, throttled: true });
    expect(window.vex.setBackgroundThrottling).toHaveBeenCalledWith(7, true);
    SidebarManager.activePanel = 'discord';
    expect(await SidebarManager.checkDiscordThrottle(NOW)).toEqual({ visible: true, inCall: null, throttled: false });
    expect(window.vex.setBackgroundThrottling).toHaveBeenLastCalledWith(7, false);
  });

  it('waits the two minutes, and does not repeat an IPC it has already made', async () => {
    discordWebview();
    usage({ discord: NOW - 60000 });
    expect(await SidebarManager.checkDiscordThrottle(NOW)).toEqual({ visible: false, inCall: null, throttled: false });
    expect(window.vex.setBackgroundThrottling).not.toHaveBeenCalled();
    usage({ discord: NOW - 5 * 60000 });
    await SidebarManager.checkDiscordThrottle(NOW);
    await SidebarManager.checkDiscordThrottle(NOW);
    expect(window.vex.setBackgroundThrottling).toHaveBeenCalledTimes(1);
  });

  it('a call keeps it awake: microphone in use, audible, or the Disconnect button in its page', async () => {
    usage({ discord: NOW - 10 * 60000 });
    discordWebview({ audible: true });
    expect((await SidebarManager.checkDiscordThrottle(NOW)).inCall).toBe(true);
    SidebarManager.panelWebviews = {};
    discordWebview({ disconnectButton: true });
    expect((await SidebarManager.checkDiscordThrottle(NOW)).inCall).toBe(true);
    SidebarManager.panelWebviews = {};
    discordWebview();
    SidebarManager.setPanelCapturing('discord', 'mic', true);
    expect((await SidebarManager.checkDiscordThrottle(NOW)).inCall).toBe(true);
    expect(window.vex.setBackgroundThrottling).not.toHaveBeenCalledWith(7, true);
    SidebarManager.setPanelCapturing('discord', 'mic', false);
  });

  it('can be switched off in Settings', async () => {
    discordWebview();
    usage({ discord: NOW - 10 * 60000 });
    localStorage.setItem('vex.discordRestHidden', '0');
    expect((await SidebarManager.checkDiscordThrottle(NOW)).throttled).toBe(false);
  });
});

describe('microphone and camera in a panel', () => {
  it('shows a badge on the icon and keeps the panel from sleeping', () => {
    fakeWebview('claude');
    usage({});
    SidebarManager.setPanelCapturing('claude', 'mic', true);
    const badge = document.querySelector('.sidebar-icon[data-panel="claude"] .icon-badge.capture');
    expect(badge.title).toBe('Using the microphone');
    expect(SidebarManager.isPanelCapturing('claude')).toBe(true);
    expect(SidebarManager.panelsDueToSleep(10_000_000)).toEqual([]);
    expect(SidebarManager.sleepHiddenPanels()).toEqual([]);
    SidebarManager.setPanelCapturing('claude', 'camera', true);
    expect(document.querySelector('.sidebar-icon[data-panel="claude"] .icon-badge.capture').title).toBe('Using the camera and microphone');
    SidebarManager.setPanelCapturing('claude', 'mic', false);
    SidebarManager.setPanelCapturing('claude', 'camera', false);
    expect(document.querySelector('.icon-badge.capture')).toBe(null);
    expect(SidebarManager.panelsDueToSleep(10_000_000)).toEqual(['claude']);
  });
});

describe('Free memory now: hidden panels', () => {
  it('sleeps every hidden panel that may sleep, idle or not', () => {
    fakeWebview('claude'); fakeWebview('spotify', { audible: true }); fakeWebview('discord');
    usage({ claude: Date.now() });                 // just used — still goes: this is "now"
    SidebarManager.activePanel = 'notes';
    expect(SidebarManager.sleepHiddenPanels()).toEqual(['claude']);
    expect(document.querySelector('#panel-claude webview')).toBe(null);
    expect(document.querySelector('#panel-discord webview')).not.toBe(null);   // kept awake
    expect(document.querySelector('#panel-spotify webview')).not.toBe(null);   // playing
  });
});
