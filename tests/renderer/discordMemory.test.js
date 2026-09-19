// @vitest-environment jsdom
//
// Discord kept awake all day grows (2.15 GB measured on the user's machine).
// Past a limit Vex swaps in a fresh one — only when that costs nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');

let sb, sizeKB;
function webview(id) {
  const el = document.createElement('webview');
  el.getWebContentsId = () => id;
  el.isCurrentlyAudible = () => false;
  return el;
}
beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  document.body.innerHTML = '<div id="panel-discord"></div>';
  DiscordMemory._lastRefresh = 0;
  DiscordMemory._raisedTo = 0;
  DiscordMemory._history = [];
  sizeKB = 2150 * 1024;
  const panel = document.getElementById('panel-discord');
  const first = webview(11);
  panel.appendChild(first);
  panel.insertAdjacentHTML('beforeend', '<div class="discord-mem-banner">Discord is using 2.1 GB</div>');
  let next = 12;
  sb = {
    panelWebviews: { discord: first },
    activePanel: 'claude', sidePanel: null,
    isPanelCapturing: vi.fn(() => false),
    _discordInCall: vi.fn(async () => false),
    _createPanelWebview: vi.fn((name, el) => { const wv = webview(next++); el.appendChild(wv); sb.panelWebviews[name] = wv; return wv; }),
  };
  globalThis.SidebarManager = sb;
  window.vex = { tabMemory: vi.fn(async (ids) => ({ byId: { [ids[0]]: { memKB: sizeKB } } })) };
  window.showToast = vi.fn();
});

describe('the limit', () => {
  it('is 1.5 GB unless changed, and only takes the offered values', () => {
    expect(DiscordMemory.limitMB()).toBe(1500);
    DiscordMemory.setLimitMB('700');
    expect(DiscordMemory.limitMB()).toBe(700);
    expect(() => DiscordMemory.setLimitMB(123)).toThrow(/one of/);
    localStorage.setItem(DiscordMemory.KEY, 'nonsense');
    expect(DiscordMemory.limitMB()).toBe(1500);
  });

  it('off means nothing is measured or refreshed', async () => {
    DiscordMemory.setLimitMB(0);
    expect(await DiscordMemory.check()).toEqual({ action: 'off' });
    expect(window.vex.tabMemory).not.toHaveBeenCalled();
  });
});

describe('refreshing', () => {
  it('over the limit, hidden and quiet: a fresh Discord replaces it, still hidden', async () => {
    const r = await DiscordMemory.check();
    expect(r).toMatchObject({ action: 'refreshed', mb: 2150, limit: 1500 });
    expect(sb._createPanelWebview).toHaveBeenCalledWith('discord', document.getElementById('panel-discord'));
    expect(sb.panelWebviews.discord.getWebContentsId()).toBe(12);
    expect(document.querySelectorAll('#panel-discord webview')).toHaveLength(1);   // the old one is gone
    expect(sb.activePanel).toBe('claude');                                         // nothing was shown
    expect(document.querySelector('.discord-mem-banner')).toBe(null);             // its number was stale
  });

  it('under the limit, nothing happens', async () => {
    sizeKB = 900 * 1024;
    expect((await DiscordMemory.check()).action).toBe('fine');
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
  });

  for (const [what, setup, why] of [
    ['open', () => { sb.activePanel = 'discord'; }, /open/],
    ['beside another panel', () => { sb.sidePanel = 'discord'; }, /open/],
    ['on the mic or camera', () => { sb.isPanelCapturing = () => true; }, /microphone or camera/],
    ['playing sound', () => { sb.panelWebviews.discord.isCurrentlyAudible = () => true; }, /playing sound/],
    ['in a call', () => { sb._discordInCall = async () => true; }, /in a call/],
  ]) {
    it('never while Discord is ' + what, async () => {
      setup();
      const r = await DiscordMemory.check();
      expect(r.action).toBe('waiting');
      expect(r.why).toMatch(why);
      expect(sb._createPanelWebview).not.toHaveBeenCalled();
    });
  }

  it('at most once every 30 minutes', async () => {
    const t = Date.now();
    await DiscordMemory.check(t);
    const again = await DiscordMemory.check(t + 10 * 60000);
    expect(again).toMatchObject({ action: 'waiting', why: 'Refreshed recently' });
    expect((await DiscordMemory.check(t + 31 * 60000)).action).toBe('refreshed');
  });

  it('a fresh Discord already near the limit raises the limit once, instead of refreshing for ever', async () => {
    vi.useFakeTimers();
    DiscordMemory.setLimitMB(700);
    await DiscordMemory.check();
    sizeKB = 680 * 1024;                           // the fresh one is already 680 MB
    await vi.advanceTimersByTimeAsync(DiscordMemory.SETTLE_MS + 10);
    expect(DiscordMemory.effectiveLimitMB()).toBe(1100);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/fresh Discord already uses 680 MB.*1100 MB/));
    expect(DiscordMemory._history[0]).toMatchObject({ beforeMB: 2150, afterMB: 680 });
  });

  it('unknown size is left alone', async () => {
    window.vex.tabMemory = vi.fn(async () => ({ byId: {} }));
    expect((await DiscordMemory.check()).action).toBe('unknown');
  });
});

describe('the setting', () => {
  it('offers Never through 2 GB and saves the choice', () => {
    document.body.innerHTML = '<div id="discord-memory-setting"></div>';
    DiscordMemory.renderSetting();
    const sel = document.querySelector('#discord-memory-setting select');
    expect([...sel.options].map(o => o.textContent)).toEqual(['Never', '700 MB', '1 GB', '1.5 GB', '2 GB']);
    expect(sel.value).toBe('1500');
    sel.value = '1000'; sel.dispatchEvent(new Event('change'));
    expect(DiscordMemory.limitMB()).toBe(1000);
  });
});
