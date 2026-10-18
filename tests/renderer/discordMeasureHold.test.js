// @vitest-environment jsdom
//
// "When I close a call and leave the Discord screen it closes by itself, and I can't test which Vencord plugin costs how
// many MB." The memory tools need Discord loaded and hidden for minutes, but the idle sleep and the automatic refresh both
// act on a hidden, idle Discord, and an asleep Discord just gave "Discord is not loaded". Now:
//   * while a measurement (or its window) is open, Discord is held: no idle sleep, no automatic refresh, and the sidebar's
//     own sleepers see it as busy;
//   * an asleep Discord is loaded in the background after a yes, and a no ends quietly;
//   * the person's own sleep and keep-awake settings are not changed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.VexJobs ??= { every: (_n, ms, fn) => { const id = setInterval(fn, ms); return { stop: () => clearInterval(id) }; } };
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');
const { SleepConsent } = require('../../src/renderer/js/sleep-consent.js');
const { DiscordPluginRam: R } = require('../../src/renderer/js/discord-plugin-ram.js');
const { DiscordMeasure } = require('../../src/renderer/js/discord-measure.js');
const { VexSettingsGroups } = require('../../src/renderer/js/vex-settings-groups.js');
globalThis.SleepConsent = SleepConsent;
globalThis.DiscordPluginRam = R;
globalThis.DiscordMeasure = DiscordMeasure;
globalThis.VexSettingsGroups = VexSettingsGroups;
globalThis.DiscordMemory = DiscordMemory;

const MIN = 60000;
let sb;
function webview(id) {
  const el = document.createElement('webview');
  el.getWebContentsId = () => id;
  el.isCurrentlyAudible = () => false;
  return el;
}
beforeEach(() => {
  localStorage.clear();
  SleepConsent.set('auto');
  SleepConsent._quiet = {};
  localStorage.setItem('vex.discordIdleSleepMin', '15');
  localStorage.setItem('vex.discordCare', JSON.stringify({ on: false }));
  localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: Date.now() - 60 * MIN }));   // hidden for an hour
  document.body.innerHTML = '<div id="panel-discord"></div>';
  R._busy = false; R._windowOpen = false; DiscordMeasure._run = null;
  const first = webview(11);
  document.getElementById('panel-discord').appendChild(first);
  sb = {
    panelWebviews: { discord: first }, activePanel: 'claude', sidePanel: null,
    isPanelCapturing: vi.fn(() => false), _discordInCall: vi.fn(async () => false),
    sleepPanel: vi.fn((name) => { delete sb.panelWebviews[name]; }),
    keptAwakeNow: vi.fn(() => false),                                  // "Awake during calls": it may sleep when idle
    _createPanelWebview: vi.fn((name, el) => { const wv = webview(12); el.appendChild(wv); sb.panelWebviews[name] = wv; return wv; }),
  };
  globalThis.SidebarManager = sb;
  window.vex = { tabMemory: vi.fn(async (ids) => ({ byId: { [ids[0]]: { memKB: 500 * 1024 } } })) };
  window.showToast = vi.fn();
});

describe('what holds Discord', () => {
  it('nothing while idle; the plugin tool running, its window being open, or the 10-minute measurement', () => {
    expect(DiscordMemory.measurementHold()).toBe('');
    R._windowOpen = true;
    expect(DiscordMemory.measurementHold()).toMatch(/plugin memory window is open/);
    R._windowOpen = false; R._busy = true;
    expect(DiscordMemory.measurementHold()).toMatch(/plugin memory/);
    R._busy = false;
    DiscordMeasure._run = { finished: false };
    expect(DiscordMemory.measurementHold()).toMatch(/measurement is running/);
    DiscordMeasure._run = { finished: true };
    expect(DiscordMemory.measurementHold()).toBe('');
  });
});

describe('the idle sleep and the automatic refresh', () => {
  it('without a measurement a hidden, idle Discord that may sleep does sleep (the behaviour that was reported)', async () => {
    expect(await DiscordMemory.check()).toEqual({ action: 'slept' });
    expect(sb.sleepPanel).toHaveBeenCalledWith('discord');
  });
  it('while the plugin window is open Discord is not slept', async () => {
    R._windowOpen = true;
    const r = await DiscordMemory.check();
    expect(r.action).toBe('holding');
    expect(sb.sleepPanel).not.toHaveBeenCalled();
    expect(sb.panelWebviews.discord).toBeTruthy();
  });
  it('while a measurement runs it is not refreshed either, even over the limit with automatic refresh on', async () => {
    localStorage.setItem('vex.discordCare', JSON.stringify({ on: true, auto: true }));
    window.vex.tabMemory = vi.fn(async (ids) => ({ byId: { [ids[0]]: { memKB: 3000 * 1024 } } }));
    R._busy = true;
    const r = await DiscordMemory.check();
    expect(r.action).toBe('holding');
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
  });
  it('as soon as the measurement ends the normal rules apply again', async () => {
    R._busy = true;
    expect((await DiscordMemory.check()).action).toBe('holding');
    R._busy = false;
    expect((await DiscordMemory.check()).action).toBe('slept');
  });
  it('does not change the person’s keep-awake or sleep choices', async () => {
    const before = JSON.stringify({ ...localStorage });
    R._windowOpen = true;
    await DiscordMemory.check();
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
});

describe('the sidebar’s own sleepers', () => {
  it('see a held Discord as busy, and only Discord', () => {
    const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
    SidebarManager.panelCapture = {}; SidebarManager.panelWebviews = {};
    expect(SidebarManager.panelBusy('discord')).toBe('');
    R._busy = true;
    expect(SidebarManager.panelBusy('discord')).toMatch(/plugin memory/);
    expect(SidebarManager.panelBusy('whatsapp')).toBe('');
    R._busy = false;
    expect(SidebarManager.panelBusy('discord')).toBe('');
  });
});

describe('an asleep Discord', () => {
  beforeEach(() => { delete sb.panelWebviews.discord; document.getElementById('panel-discord').textContent = ''; });

  it('is loaded in the background after a yes, and the tool carries on', async () => {
    window.vexConfirm = vi.fn(async () => true);
    const p = DiscordMemory.ensureLoaded();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/asleep.*hidden.*normal sleep settings/);
    expect(sb._createPanelWebview).toHaveBeenCalledWith('discord', document.getElementById('panel-discord'));
    sb.panelWebviews.discord.dispatchEvent(new Event('did-finish-load'));
    const wv = await p;
    expect(wv).toBe(sb.panelWebviews.discord);
    expect(sb.activePanel).toBe('claude');                              // never brought to the front
  });
  it('a no loads nothing and returns null (the tool just stops)', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect(await DiscordMemory.ensureLoaded()).toBeNull();
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
  });
  it('a Discord that is already loaded is used without asking', async () => {
    sb.panelWebviews.discord = webview(21);
    window.vexConfirm = vi.fn();
    expect(await DiscordMemory.ensureLoaded()).toBe(sb.panelWebviews.discord);
    expect(window.vexConfirm).not.toHaveBeenCalled();
  });
  it('a page that fails to load, or never finishes, is reported', async () => {
    const failing = DiscordMemory.loadHidden({ timeoutMs: 5000 });
    await new Promise(r => setTimeout(r, 0));
    const e = new Event('did-fail-load'); e.errorDescription = 'ERR_INTERNET_DISCONNECTED';
    sb.panelWebviews.discord.dispatchEvent(e);
    await expect(failing).rejects.toThrow(/could not load: ERR_INTERNET_DISCONNECTED/);
    delete sb.panelWebviews.discord;
    await expect(DiscordMemory.loadHidden({ timeoutMs: 20 })).rejects.toThrow(/did not finish loading/);
  });
  it('says so, instead of loading anything, when Discord opens as a tab', async () => {
    localStorage.setItem(DiscordMemory.MODE_KEY, 'tab');
    await expect(DiscordMemory.loadHidden()).rejects.toThrow(/opens as a tab|open as a tab/);
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
  });
});

describe('both measuring tools use it instead of refusing', () => {
  it('the plugin window and the 10-minute window no longer throw "Discord is not loaded"', () => {
    const fs = require('fs');
    const path = require('path');
    for (const f of ['discord-plugin-ram.js', 'discord-measure.js']) {
      const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js', f), 'utf8');
      expect(src, f).toMatch(/if \(!\(await DiscordMemory\.ensureLoaded\(\)\)\) return;/);
    }
  });
});

describe('telling a Discord page that is not ready yet that it is hidden', () => {
  const NOT_READY = 'The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.';
  const load = () => {
    const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
    window.VexProblems = { note: vi.fn() };
    return SidebarManager;
  };
  it('is not a problem: it waits for dom-ready, then tells the page once', async () => {
    const S = load();
    const wv = document.createElement('webview');
    let ready = false;
    wv.send = vi.fn(() => { if (!ready) throw new Error(NOT_READY); });
    S.panelWebviews = { discord: wv };
    const realCheck = S.checkDiscordThrottle;
    S.checkDiscordThrottle = vi.fn(async () => {});
    S._tellDiscordHidden(wv, true);
    S._tellDiscordHidden(wv, true);                                    // a second look before ready must not pile up
    expect(window.VexProblems.note).not.toHaveBeenCalled();
    ready = true;
    wv.dispatchEvent(new Event('dom-ready'));
    expect(S.checkDiscordThrottle).toHaveBeenCalledTimes(1);
    wv.dispatchEvent(new Event('dom-ready'));
    expect(S.checkDiscordThrottle).toHaveBeenCalledTimes(1);           // once only
    S.checkDiscordThrottle = realCheck;                                 // the sidebar object is shared with the other tests
  });
  it('a real failure is still reported', () => {
    const S = load();
    const wv = document.createElement('webview');
    wv.send = vi.fn(() => { throw new Error('the page crashed'); });
    S._tellDiscordHidden(wv, true);
    expect(window.VexProblems.note).toHaveBeenCalledWith('Discord rest', 'Could not tell the page it is hidden', expect.any(Error));
  });
});

describe('the end of a plugin memory window', () => {
  let wvStub;
  beforeEach(() => {
    wvStub = { getWebContentsId: () => 11 };
    DiscordMemory.webview = () => wvStub;
    DiscordMemory.reasonToWait = vi.fn(async () => null);
    window.vexGuestEval = vi.fn(async () => ({ via: 'api', rows: [{ name: 'Alpha', enabled: true }] }));
  });
  const clock = () => { let t = 0; return { now: () => t, wait: async (ms) => { t += ms; } }; };

  it('says what it is doing once the window is over, instead of sitting at "0 s left"', async () => {
    window.vex = { discordHeapBegin: vi.fn(async () => ({ ok: true })), discordHeapEnd: vi.fn(async () => ({ ok: true, plugins: [], heap: {}, map: {} })) };
    const said = [];
    await R.measureFast({ windowSec: 15, ...clock(), say: (t) => said.push(t) });
    expect(said[said.length - 1]).toMatch(/window is over\. Collecting memory and reading the profile/);
  });
  it('gives up with a plain message when Discord never hands the profile over, and drops the window', async () => {
    const ended = [];
    window.vex = {
      discordHeapBegin: vi.fn(async () => ({ ok: true })),
      discordHeapEnd: vi.fn((id, keep) => { ended.push(keep); return keep ? new Promise(() => {}) : Promise.resolve({ ok: true, discarded: true }); }),
    };
    R.last = { fast: null, slow: null, profiler: null };
    const old = R.END_WAIT_MS; R.END_WAIT_MS = 30;
    try {
      await expect(R.measureFast({ windowSec: 15, ...clock() })).rejects.toThrow(/did not hand over the profile in 0 seconds, so nothing was kept/);
    } finally { R.END_WAIT_MS = old; }
    expect(ended).toEqual([true, false]);                              // asked for it, then threw the window away
    expect(R.last.fast).toBeNull();
  });
});

describe('a held Discord is not background-throttled', () => {
  it('is treated as in sight by the throttle check, and a Discord that is not held still is throttled when hidden and idle', async () => {
    const { SidebarManager: S } = require('../../src/renderer/js/sidebar.js');
    const wv = document.createElement('webview');
    wv.getWebContentsId = () => 11; wv.send = vi.fn();
    S.panelWebviews = { discord: wv }; S.panelCapture = {}; S.activePanel = 'claude'; S.sidePanel = null;
    S._discordThrottled = undefined; S._discordResting = false;
    S._discordInCall = vi.fn(async () => false);
    S.discordRestPrefs = () => ({ enabled: true, afterMs: 0 });
    window.vex = { setBackgroundThrottling: vi.fn(async () => {}) };
    localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: 0 }));
    const calls = () => window.vex.setBackgroundThrottling.mock.calls.map(c => c[1]);
    R._windowOpen = true;
    const held = await S.checkDiscordThrottle();
    expect(held.visible).toBe(true);
    expect(calls()).not.toContain(true);
    R._windowOpen = false; S._discordThrottled = undefined;
    const free = await S.checkDiscordThrottle();
    expect(free.visible).toBe(false);
    expect(calls()).toContain(true);
  });
});

describe('closing a window main has already closed', () => {
  it('is not reported as a problem (main ends its own window when the end fails), but a real failure still is', async () => {
    window.VexProblems = { note: vi.fn() };
    window.vex = { discordHeapEnd: vi.fn(async () => { throw new Error("Error invoking remote method 'discord:heap-end': Error: No Discord measurement is running"); }) };
    await R._endQuietly(11);
    expect(window.VexProblems.note).not.toHaveBeenCalled();
    window.vex.discordHeapEnd = vi.fn(async () => { throw new Error('the page crashed'); });
    await R._endQuietly(11);
    expect(window.VexProblems.note).toHaveBeenCalledTimes(1);
  });
});
