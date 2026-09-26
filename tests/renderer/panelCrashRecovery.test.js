// @vitest-environment jsdom
//
// "discord and claude keeps closing while i play another game". Nothing in Vex
// slept them: Windows takes memory from the biggest processes it can find when
// a game wants it, and the Discord panel is the biggest thing Vex has. The
// crash log showed it plainly — discord.com/channels/@me "killed (exit
// -1073741510)" beside the audio service. Tabs have always healed themselves
// from that; panels stayed blank until they were opened by hand. Now they come
// back: at once if you are looking at one, after the game if you are not.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

const killed = (wv) => wv.dispatchEvent(new Event('render-process-gone'));

function openPanel(name) {
  const el = document.getElementById('panel-' + name);
  const wv = SidebarManager._createPanelWebview(name, el);
  wv.loadURL = vi.fn(() => Promise.resolve());
  wv.getURL = () => SidebarManager.panelConfigs[name].url;
  return wv;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div id="icon-sidebar">
      <button class="sidebar-icon" data-panel="discord" title="Discord"></button>
      <button class="sidebar-icon" data-panel="claude" title="Claude"></button>
    </div>
    <div id="panels-container">
      <div class="panel" id="panel-discord"></div>
      <div class="panel" id="panel-claude"></div>
    </div>`;
  SidebarManager.panelWebviews = {};
  SidebarManager.activePanel = null;
  SidebarManager.sidePanel = null;
  delete globalThis.GameMode;
  window.showToast = vi.fn();
});
afterEach(() => vi.useRealTimers());

describe('a panel whose renderer Windows killed', () => {
  it('is loaded again while you are looking at it', () => {
    SidebarManager.activePanel = 'discord';
    const wv = openPanel('discord');
    killed(wv);
    expect(wv.loadURL).not.toHaveBeenCalled();     // not in the same tick
    vi.advanceTimersByTime(500);
    expect(wv.loadURL).toHaveBeenCalledWith(SidebarManager.panelConfigs.discord.url);
  });

  it('comes back where you were, not at the front page', () => {
    SidebarManager.activePanel = 'discord';
    const wv = openPanel('discord');
    wv.getURL = () => 'https://discord.com/channels/111/222';
    wv.dispatchEvent(new Event('did-navigate'));
    killed(wv);
    vi.advanceTimersByTime(500);
    expect(wv.loadURL).toHaveBeenCalledWith('https://discord.com/channels/111/222');
  });

  it('is left alone while the game still needs the memory', () => {
    globalThis.GameMode = { gaming: true };
    const wv = openPanel('discord');                // hidden: no activePanel
    killed(wv);
    vi.advanceTimersByTime(120000);
    expect(wv.loadURL).not.toHaveBeenCalled();
    // …and comes back when the game ends.
    const back = SidebarManager.recoverCrashedPanels();
    expect(back).toEqual(['Discord']);
    expect(wv.loadURL).toHaveBeenCalledTimes(1);
  });

  it('is loaded again the moment you open it', () => {
    globalThis.GameMode = { gaming: true };
    const wv = openPanel('claude');
    killed(wv);
    vi.advanceTimersByTime(120000);
    expect(wv.loadURL).not.toHaveBeenCalled();
    SidebarManager._preparePanel('claude', document.getElementById('panel-claude'));
    expect(wv.loadURL).toHaveBeenCalledTimes(1);
  });

  it('is brought back on its own when no game is running', () => {
    const wv = openPanel('claude');                 // hidden, no game
    killed(wv);
    vi.advanceTimersByTime(4000);
    expect(wv.loadURL).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after four goes and says so once', () => {
    SidebarManager.activePanel = 'discord';
    const wv = openPanel('discord');
    for (let i = 0; i < 5; i++) { killed(wv); vi.advanceTimersByTime(10000); }
    expect(wv.loadURL).toHaveBeenCalledTimes(4);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(String(window.showToast.mock.calls[0][0])).toMatch(/not enough memory/);
  });

  it('leaves a panel that was put to sleep asleep', () => {
    const wv = openPanel('discord');
    killed(wv);
    // sleepPanel takes the element out of the DOM and off panelWebviews.
    wv.remove();
    delete SidebarManager.panelWebviews.discord;
    vi.advanceTimersByTime(120000);
    expect(wv.loadURL).not.toHaveBeenCalled();
    expect(SidebarManager.recoverCrashedPanels()).toEqual([]);
  });

  it('does nothing to a panel that is fine', () => {
    const wv = openPanel('claude');
    expect(SidebarManager.recoverPanel('claude')).toBe(false);
    expect(SidebarManager.recoverCrashedPanels()).toEqual([]);
    expect(wv.loadURL).not.toHaveBeenCalled();
  });
});
