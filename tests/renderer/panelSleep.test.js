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
  // These test WHAT is slept, not whether Vex may sleep unattended: the
  // guard fails closed now, so say the user asked for it.
  globalThis.SleepConsent = {
    mode: () => 'auto', auto: () => true, never: () => false,
    ask: ({ run }) => { run(); return true; },
    offerAfterGame: () => false,
  };
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
    // Keep Discord awake can be turned off — here through the old list,
    // which is still read for anyone who set it before the card existed.
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

  it('the settings rows read the preferences and open the chooser', () => {
    document.body.insertAdjacentHTML('beforeend', '<input type="checkbox" id="setting-panel-autosleep"><div id="setting-panel-keepawake"></div>');
    SidebarManager._wirePanelSleepSettings();
    const auto = document.getElementById('setting-panel-autosleep');
    expect(auto.checked).toBe(true);
    // One row per web panel, each saying what it is set to. Discord and
    // WhatsApp never sleep by default, so a message can still notify — a
    // sleeping panel cannot.
    const rows = [...document.querySelectorAll('#setting-panel-keepawake button')];
    expect(rows.map(b => b.dataset.panel)).toEqual(expect.arrayContaining(['discord', 'whatsapp', 'claude', 'spotify']));
    const said = Object.fromEntries(rows.map(b => [b.dataset.panel, b.textContent]));
    expect(said.discord).toBe('Never sleeps');
    expect(said.claude).toBe('Sleeps when idle');
    auto.checked = false; auto.dispatchEvent(new Event('change'));
    expect(SidebarManager.panelSleepPrefs().enabled).toBe(false);
    // The row is the way in to the card.
    rows.find(b => b.dataset.panel === 'claude').click();
    expect(document.querySelector('.keepawake-ov .ka-title').textContent).toMatch(/Claude/);
  });
});

// The panel chooser: the same hour/custom/never a tab has had, plus the one
// only a panel can offer — awake for a call, asleep the rest of the day.
describe('how long a panel stays awake', () => {
  const card = () => document.querySelector('.keepawake-ov');
  const press = (text) => [...document.querySelectorAll('.keepawake-ov button')].find(b => b.textContent.includes(text)).click();

  it('reads the old yes/no list once, so nobody loses their choice', () => {
    expect(SidebarManager.keepAwakeFor('discord')).toEqual({ mode: 'always' });
    expect(SidebarManager.keepAwakeFor('claude')).toEqual({ mode: 'off' });
    localStorage.setItem('vex.panelSleepExempt', '["claude"]');
    expect(SidebarManager.keepAwakeFor('claude')).toEqual({ mode: 'always' });
    expect(SidebarManager.keepAwakeFor('discord')).toEqual({ mode: 'off' });
    // A choice made in the new card wins over the old list.
    SidebarManager.setKeepAwakeMode('claude', 'off');
    expect(SidebarManager.keptAwakeNow('claude')).toBe(false);
  });

  it('an hour keeps it awake for an hour and not a minute longer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    SidebarManager.showKeepAwakeChooser('claude');
    press('1 hour');
    expect(card()).toBe(null);
    expect(SidebarManager.keptAwakeNow('claude')).toBe(true);
    expect(SidebarManager.panelSleepPrefs().exempt).toContain('claude');
    expect(SidebarManager.keepAwakeLabel('claude')).toBe('Awake for 60 more minutes');
    vi.setSystemTime(1_000_000_000 + 3600_001);
    expect(SidebarManager.keptAwakeNow('claude')).toBe(false);
    expect(SidebarManager.panelSleepPrefs().exempt).not.toContain('claude');
    expect(SidebarManager.keepAwakeLabel('claude')).toBe('Sleeps when idle');
    vi.useRealTimers();
  });

  it('never sleeps until reverted, and the card offers the way back', () => {
    SidebarManager.showKeepAwakeChooser('claude');
    press('Never (until reverted)');
    expect(SidebarManager.keepAwakeLabel('claude')).toBe('Never sleeps');
    SidebarManager.showKeepAwakeChooser('claude');
    press('Let it sleep when idle again');
    expect(SidebarManager.keepAwakeFor('claude')).toEqual({ mode: 'off' });
  });

  it('custom asks for the hours', async () => {
    window.vexPrompt = vi.fn(async () => '2.5');
    SidebarManager.showKeepAwakeChooser('claude');
    press('Custom');
    await vi.waitFor(() => expect(SidebarManager.keptAwakeNow('claude')).toBe(true));
    expect(window.vexPrompt).toHaveBeenCalled();
    expect(SidebarManager.keepAwakeLabel('claude')).toBe('Awake for 3 more hours');
  });

  // The point of the whole thing: Discord holds 1.4 GB because 'kept awake'
  // meant all day. 'Only during a call' is not exempt at all — panelBusy
  // already refuses to sleep a panel on the microphone or making a sound.
  it('only during a call lets it sleep when it is quiet, and never mid-call', () => {
    fakeWebview('discord');
    SidebarManager.showKeepAwakeChooser('discord');
    press('Only while it is in a call');
    expect(SidebarManager.keepAwakeLabel('discord')).toBe('Awake during calls');
    expect(SidebarManager.panelSleepPrefs().exempt).not.toContain('discord');
    usage({});
    expect(SidebarManager.panelsDueToSleep(10_000_000)).toContain('discord');
    // On a call it is busy, so nothing sleeps it.
    SidebarManager.setPanelCapturing('discord', 'mic', true);
    expect(SidebarManager.panelsDueToSleep(10_000_000)).not.toContain('discord');
  });

  it('the memory notice offers it, at the moment the gigabyte is on screen', async () => {
    fakeWebview('discord', { wcId: 7 });
    window.vex.tabMemory = vi.fn(async () => ({ totalKB: 0, byId: { 7: { memKB: 1500 * 1024, pid: 1 } } }));
    await SidebarManager.checkDiscordMemory();
    document.querySelector('.dmb-calls').click();
    expect(SidebarManager.keepAwakeFor('discord')).toEqual({ mode: 'call' });
    expect(document.querySelector('.discord-mem-banner')).toBe(null);
  });

  it('the panel menu says what it is set to, and opens the card', () => {
    SidebarManager.showContextMenu({ clientX: 0, clientY: 0 }, 'discord');
    const item = [...document.querySelectorAll('.tab-context-item')].find(i => /Keep awake/.test(i.textContent));
    expect(item.textContent).toMatch(/Never sleeps/);
    item.click();
    expect(document.querySelector('.keepawake-ov .ka-title').textContent).toMatch(/Discord/);
  });

  it('setting one awake builds it again if it was asleep', () => {
    fakeWebview('claude');
    SidebarManager.sleepPanel('claude');
    expect(SidebarManager.panelWebviews.claude).toBeUndefined();
    SidebarManager.setKeepAwakeMode('claude', 'always');
    expect(SidebarManager.panelWebviews.claude).toBeTruthy();
    expect(SidebarManager.sleptPanels.claude).toBeUndefined();
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

  // Later used to silence only the toast: the strip came straight back on the
  // next minute's check, over the message box.
  it('Later keeps the notice away for four hours; Don\'t show again turns notices off', async () => {
    fakeWebview('discord', { wcId: 7 });
    window.vex.tabMemory = vi.fn(async () => ({ totalKB: 0, byId: { 7: { memKB: 1500 * 1024, pid: 1 } } }));
    await SidebarManager.checkDiscordMemory();
    document.querySelector('.dmb-later').click();
    expect(document.querySelector('.discord-mem-banner')).toBe(null);
    await SidebarManager.checkDiscordMemory();
    await SidebarManager.checkDiscordMemory();
    expect(document.querySelector('.discord-mem-banner')).toBe(null);
    SidebarManager._discordBannerSnoozedUntil = Date.now() - 1;
    await SidebarManager.checkDiscordMemory();
    expect(document.querySelector('.discord-mem-banner')).not.toBe(null);
    document.querySelector('.dmb-never').click();
    expect(localStorage.getItem('vex.memoryNoticeMB')).toBe('0');
    expect(await SidebarManager.checkDiscordMemory()).toEqual({ mb: 1500, over: false, off: true });
    expect(document.querySelector('.discord-mem-banner')).toBe(null);
  });

  it('the Settings select sets the shared ceiling for Discord and tabs', async () => {
    document.body.insertAdjacentHTML('beforeend', '<select id="setting-memory-notice"><option value=""></option><option value="0"></option><option value="2048"></option></select>');
    SidebarManager._wirePanelSleepSettings();
    const sel = document.getElementById('setting-memory-notice');
    expect(sel.value).toBe('');
    expect(SidebarManager.memoryNoticeCeiling(1024)).toBe(1024);
    sel.value = '2048'; sel.dispatchEvent(new Event('change'));
    expect(SidebarManager.memoryNoticeCeiling(1024)).toBe(2048);
    fakeWebview('discord', { wcId: 7 });
    window.vex.tabMemory = vi.fn(async () => ({ totalKB: 0, byId: { 7: { memKB: 1500 * 1024, pid: 1 } } }));
    expect((await SidebarManager.checkDiscordMemory()).over).toBe(false);
    sel.value = '0'; sel.dispatchEvent(new Event('change'));
    expect(SidebarManager.memoryNoticeCeiling(1024)).toBe(0);
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

// Discord is the one panel whose sleep is not a free win: asleep it cannot
// notify you. Vex asks before freeing its memory (js/discord-memory.js) — and
// this loop was the other way it got slept without a word, which is how
// someone could be asked, answer no, and watch it close anyway.
describe('the one panel that is asked about first', () => {
  beforeEach(() => { delete globalThis.DiscordMemory; });

  it('is skipped here while Vex is set to ask', () => {
    globalThis.DiscordMemory = { consent: () => 'ask' };
    expect(SidebarManager._asksBeforeSleeping('discord')).toBe(true);
    expect(SidebarManager._asksBeforeSleeping('claude')).toBe(false);
  });

  it('is slept here like any other panel once the user has said "always"', () => {
    globalThis.DiscordMemory = { consent: () => 'auto' };
    expect(SidebarManager._asksBeforeSleeping('discord')).toBe(false);
  });

  it('is left alone when the question cannot be asked at all', () => {
    expect(SidebarManager._asksBeforeSleeping('discord')).toBe(false);
    globalThis.DiscordMemory = { consent: () => { throw new Error('gone'); } };
    expect(SidebarManager._asksBeforeSleeping('discord')).toBe(false);
  });

  it('the timer honours it, sleeping the others and not Discord', () => {
    vi.useFakeTimers();
    globalThis.DiscordMemory = { consent: () => 'ask' };
    fakeWebview('claude'); fakeWebview('discord');
    usage({});
    localStorage.setItem('vex.panelKeepAwake', JSON.stringify({ discord: { mode: 'call' } }));
    SidebarManager.startPanelAutoSleep();
    vi.advanceTimersByTime(60000);
    expect(SidebarManager.panelWebviews.claude).toBeUndefined();   // slept
    expect(SidebarManager.panelWebviews.discord).toBeTruthy();     // asked about instead
    clearInterval(SidebarManager._panelSleepTimer);
    vi.useRealTimers();
  });
});
