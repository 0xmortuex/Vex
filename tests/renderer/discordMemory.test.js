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
  // The refresh on its own: idle sleep (tested below) would otherwise act first.
  localStorage.setItem('vex.discordIdleSleepMin', '0');
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
  it('is 1 GB unless changed, and only takes the offered values', () => {
    expect(DiscordMemory.limitMB()).toBe(1000);
    DiscordMemory.setLimitMB('700');
    expect(DiscordMemory.limitMB()).toBe(700);
    expect(() => DiscordMemory.setLimitMB(123)).toThrow(/one of/);
    localStorage.setItem(DiscordMemory.KEY, 'nonsense');
    expect(DiscordMemory.limitMB()).toBe(1000);
  });

  it('off means nothing is measured or refreshed', async () => {
    DiscordMemory.setLimitMB(0);
    expect(await DiscordMemory.check()).toEqual({ action: 'off' });
    expect(window.vex.tabMemory).not.toHaveBeenCalled();
  });
});

describe('refreshing', () => {
  it('over the limit, hidden and quiet: a fresh Discord replaces it, still hidden', async () => {
    DiscordMemory.setConsent('auto');
    const r = await DiscordMemory.check();
    expect(r).toMatchObject({ action: 'refreshed', mb: 2150, limit: 1000 });
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
    DiscordMemory.setConsent('auto');
    const t = Date.now();
    await DiscordMemory.check(t);
    const again = await DiscordMemory.check(t + 10 * 60000);
    expect(again).toMatchObject({ action: 'waiting', why: 'Refreshed recently' });
    expect((await DiscordMemory.check(t + 31 * 60000)).action).toBe('refreshed');
  });

  it('a fresh Discord already near the limit raises the limit once, instead of refreshing for ever', async () => {
    DiscordMemory.setConsent('auto');
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
    const sel = document.querySelector('#discord-memory-setting [data-limit]');
    expect([...sel.options].map(o => o.textContent)).toEqual(['Never', '700 MB', '1 GB', '1.5 GB', '2 GB']);
    expect(sel.value).toBe('1000');
    sel.value = '700'; sel.dispatchEvent(new Event('change'));
    expect(DiscordMemory.limitMB()).toBe(700);
  });
});

describe('asleep when idle', () => {
  const MIN = 60000;
  beforeEach(() => {
    localStorage.setItem('vex.discordIdleSleepMin', '15');
    sb.sleepPanel = vi.fn((name) => { delete sb.panelWebviews[name]; });
  });

  it('hidden and not in a call for 15 minutes: it sleeps', async () => {
    DiscordMemory.setConsent('auto');
    localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: Date.now() - 16 * MIN }));
    expect(await DiscordMemory.check()).toEqual({ action: 'slept' });
    expect(sb.sleepPanel).toHaveBeenCalledWith('discord');
  });

  it('not yet 15 minutes, or in a call, or open: it stays awake', async () => {
    localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: Date.now() - 5 * MIN }));
    await DiscordMemory.check();
    localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: Date.now() - 60 * MIN }));
    sb._discordInCall = vi.fn(async () => true);
    await DiscordMemory.check();
    sb._discordInCall = vi.fn(async () => false);
    sb.activePanel = 'discord';
    await DiscordMemory.check();
    expect(sb.sleepPanel).not.toHaveBeenCalled();
  });

  it('"Never" keeps it awake', async () => {
    localStorage.setItem('vex.discordIdleSleepMin', '0');
    localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: 0 }));
    await DiscordMemory.check();
    expect(sb.sleepPanel).not.toHaveBeenCalled();
  });
});

describe('the limit, lowered once', () => {
  it('a limit left at the old 1.5 GB becomes 1 GB once; a choice after that is kept', () => {
    localStorage.setItem(DiscordMemory.KEY, '1500');
    window.vex.setDiscordLite = vi.fn(async () => true);
    DiscordMemory.start();
    expect(DiscordMemory.limitMB()).toBe(1000);
    DiscordMemory.setLimitMB(1500);
    DiscordMemory.start();
    expect(DiscordMemory.limitMB()).toBe(1500);
    clearInterval(DiscordMemory._timer);
  });
});

describe('Discord as a tab', () => {
  beforeEach(() => {
    globalThis.TabManager = { tabs: [], switchTab: vi.fn(), createTab: vi.fn() };
    globalThis.WebviewManager = { webviews: new Map() };
    sb.sleepPanel = vi.fn((name) => { delete sb.panelWebviews[name]; });
    sb.hideActivePanel = vi.fn();
    sb.closeBeside = vi.fn();
  });

  it('switching to a tab frees the panel at once', () => {
    DiscordMemory.setMode('tab');
    expect(DiscordMemory.mode()).toBe('tab');
    expect(sb.sleepPanel).toHaveBeenCalledWith('discord');
  });

  it('opens one Discord tab in the same session as the panel, and goes back to it after', () => {
    DiscordMemory.openTab();
    expect(TabManager.createTab).toHaveBeenCalledWith('https://discord.com/app', true, null, { partition: 'persist:discord' });
    TabManager.tabs.push({ id: 7, url: 'https://discord.com/channels/1/2', partition: 'persist:discord' });
    DiscordMemory.openTab();
    expect(TabManager.switchTab).toHaveBeenCalledWith(7);
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
  });

  it('a discord.com tab in another session is not "the" Discord tab', () => {
    TabManager.tabs.push({ id: 3, url: 'https://discord.com/app', partition: 'persist:main' });
    expect(DiscordMemory.discordTab()).toBeNull();
  });

  it('hotkeys and the call badge reach the tab when there is no panel', () => {
    delete sb.panelWebviews.discord;
    const wv = { id: 'tab-wv' };
    TabManager.tabs.push({ id: 7, url: 'https://discord.com/app', partition: 'persist:discord' });
    WebviewManager.webviews.set(7, wv);
    expect(DiscordMemory.webview()).toBe(wv);
  });
});

describe('the heaviest plugins', () => {
  it('turns them off through Vencord and reloads Discord', async () => {
    const wv = sb.panelWebviews.discord;
    wv.reload = vi.fn();
    window.Vencord = { Settings: { plugins: { MessageLoggerEnhanced: { enabled: true }, MessageLogger: { enabled: false }, WhoReacted: { enabled: true }, Other: { enabled: true } } } };
    window.vexGuestEval = vi.fn(async (_wv, code) => (0, eval)(code));
    expect(await DiscordMemory.turnOffHeavyPlugins()).toEqual(['MessageLoggerEnhanced', 'WhoReacted']);
    expect(window.Vencord.Settings.plugins.Other.enabled).toBe(true);
    expect(wv.reload).toHaveBeenCalled();
    delete window.Vencord;
  });

  it('says so when Vencord is not there', async () => {
    window.vexGuestEval = vi.fn(async (_wv, code) => (0, eval)(code));
    await expect(DiscordMemory.turnOffHeavyPlugins()).rejects.toThrow(/Vencord is not running/);
  });
});

// Vex used to sleep and refresh Discord on a timer, silently. That is a
// decision about someone's messages made without them: asleep, Discord cannot
// notify you until you open it again. It asks now, and an unanswered question
// is a no.
describe('asking before it frees Discord\u2019s memory', () => {
  beforeEach(() => {
    DiscordMemory._quietUntil = 0;
    document.getElementById('vex-discord-ask')?.remove();
    // The outer harness leaves idle sleep off so the refresh can be tested on
    // its own; both questions are asked here, so both paths need their stub.
    sb.sleepPanel = vi.fn();
  });

  const press = (label) => {
    const bar = document.getElementById('vex-discord-ask');
    const b = [...bar.querySelectorAll('button')].find(x => x.textContent === label);
    if (!b) throw new Error('no button called ' + label + ' \u2014 has: ' + [...bar.querySelectorAll('button')].map(x => x.textContent));
    b.click();
  };

  it('asks by default, and touches nothing until it is answered', async () => {
    expect(DiscordMemory.consent()).toBe('ask');
    const r = await DiscordMemory.check();
    expect(r.action).toBe('asked');
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
    expect(sb.sleepPanel).not.toHaveBeenCalled();
    expect(document.getElementById('vex-discord-ask')).not.toBeNull();
  });

  it('yes does the thing that was described', async () => {
    await DiscordMemory.check();
    press('Refresh it');
    expect(sb._createPanelWebview).toHaveBeenCalledWith('discord', document.getElementById('panel-discord'));
    expect(document.getElementById('vex-discord-ask')).toBe(null);
  });

  // The whole complaint: asked, and then done anyway.
  it('"Not now" leaves Discord alone, and is not asked again for hours', async () => {
    await DiscordMemory.check();
    press('Not now');
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
    expect(sb.sleepPanel).not.toHaveBeenCalled();
    const again = await DiscordMemory.check();
    expect(again.action).toBe('quiet');
    expect(document.getElementById('vex-discord-ask')).toBe(null);
    // And after the quiet time, it may ask once more.
    DiscordMemory._quietUntil = Date.now() - 1;
    expect((await DiscordMemory.check()).action).toBe('asked');
  });

  it('ignoring it is a no: the notice goes and Discord is untouched', async () => {
    vi.useFakeTimers();
    await DiscordMemory.check();
    await vi.advanceTimersByTimeAsync(31000);
    expect(document.getElementById('vex-discord-ask')).toBe(null);
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
    expect(sb.sleepPanel).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('one question at a time, however often the watch runs', async () => {
    await DiscordMemory.check();
    await DiscordMemory.check();
    await DiscordMemory.check();
    expect(document.querySelectorAll('#vex-discord-ask')).toHaveLength(1);
  });

  it('"Always" does it and stops asking; "never" stops it happening at all', async () => {
    await DiscordMemory.check();
    press('Always');
    expect(DiscordMemory.consent()).toBe('auto');
    expect(sb._createPanelWebview).toHaveBeenCalled();
    DiscordMemory.setConsent('never');
    expect((await DiscordMemory.check()).action).toBe('off');
    expect(() => DiscordMemory.setConsent('sideways')).toThrow(/ask, do it automatically, or never/);
  });

  it('asks about sleeping too, saying what sleeping costs', async () => {
    localStorage.setItem('vex.discordIdleSleepMin', '15');
    localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: Date.now() - 60 * 60000 }));
    const r = await DiscordMemory.check();
    expect(r).toMatchObject({ action: 'asked', what: 'sleep' });
    const said = document.getElementById('vex-discord-ask').textContent;
    expect(said).toMatch(/cannot notify you/);
    press('Let it sleep');
    expect(sb.sleepPanel).toHaveBeenCalledWith('discord');
  });
});
