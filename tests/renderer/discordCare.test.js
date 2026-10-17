// @vitest-environment jsdom
//
// Discord memory care (Wave 6): a notice that stays until answered, a Discord-only automatic refresh, rest mode,
// Vencord off/on from the Discord button's menu, and the recommendations in the "Why is Discord big?" report.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');
const { AttentionInbox } = require('../../src/renderer/js/attention-inbox.js');
const { VexAttention } = require('../../src/renderer/js/vex-attention.js');
const { VexLedger } = require('../../src/renderer/js/vex-ledger.js');
globalThis.AttentionInbox = AttentionInbox;
globalThis.VexAttention = VexAttention;
globalThis.VexLedger = VexLedger;
globalThis.AttentionState = { get: () => ({ quiet: false }) };
globalThis.SleepConsent = { modeFor: () => 'ask' };

let sb, sizeKB, extensions;
function webview(id) {
  const el = document.createElement('webview');
  el.getWebContentsId = () => id;
  el.isCurrentlyAudible = () => false;
  el.reload = vi.fn();
  return el;
}
const NOW = 100 * 3600000;
const hiddenSince = (ms) => localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: NOW - ms }));

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  VexLedger._reset();
  VexAttention._seen.clear();
  window.PanelBadges = { counts: {} };
  document.body.innerHTML = '<div id="panel-discord"></div>';
  localStorage.setItem('vex.discordIdleSleepMin', '0');
  Object.assign(DiscordMemory, { _lastRefresh: 0, _raisedTo: 0, _history: [], _toldMB: 0, _quietUntil: 0, _lastMentionAt: 0, _vencord: null });
  sizeKB = 1638 * 1024;
  const panel = document.getElementById('panel-discord');
  const first = webview(11);
  panel.appendChild(first);
  let next = 12;
  sb = {
    panelWebviews: { discord: first }, activePanel: 'claude', sidePanel: null,
    isPanelCapturing: vi.fn(() => false),
    _discordInCall: vi.fn(async () => false),
    _createPanelWebview: vi.fn((name, el) => { const wv = webview(next++); el.appendChild(wv); sb.panelWebviews[name] = wv; return wv; }),
    checkDiscordThrottle: vi.fn(async () => ({})),
  };
  globalThis.SidebarManager = sb;
  extensions = [{ name: 'Vencord', folder: 'vencord-1', enabled: true, where: ['persist:discord'] }];
  window.vex = {
    tabMemory: vi.fn(async (ids) => ({ byId: { [ids[0]]: { memKB: sizeKB } } })),
    extensionsList: vi.fn(async () => extensions),
    extensionsSetEnabled: vi.fn(async (folder, on) => { extensions.find(e => e.folder === folder).enabled = on; return { ok: true }; }),
  };
  window.showToast = vi.fn();
  DiscordMemory._careWired = false;
  DiscordMemory._wireCare();
});

const press = (label) => [...document.querySelectorAll('#vex-discord-ask button')].find(b => b.textContent === label).click();
const labels = () => [...document.querySelectorAll('#vex-discord-ask button')].map(b => b.textContent);

describe('the choices', () => {
  it('start as on (the registry stages it off for an existing profile), with automatic refresh and rest off', () => {
    expect(DiscordMemory.care()).toMatchObject({ on: true, auto: false, rest: false, offered: 0, lastAuto: 0 });
    expect(DiscordMemory.restModeOn()).toBe(false);
    expect(DiscordMemory.autoOn()).toBe(false);
  });
  it('the registry switch turns the whole thing off, and nothing it saved is lost', () => {
    DiscordMemory.setAuto(true); DiscordMemory.setRest(true);
    DiscordMemory.setEnabled(false);
    expect(DiscordMemory.enabled()).toBe(false);
    expect(DiscordMemory.restModeOn()).toBe(false);
    expect(DiscordMemory.autoOn()).toBe(false);
    DiscordMemory.setEnabled(true);
    expect(DiscordMemory.autoOn()).toBe(true);
  });
  it('an unreadable record is an error, not a silent default', () => {
    localStorage.setItem('vex.discordCare', '{nope');
    expect(() => DiscordMemory.care()).toThrow(/not readable/);
  });
  it('turning rest mode on or off applies it at once', () => {
    DiscordMemory.setRest(true);
    expect(sb.checkDiscordThrottle).toHaveBeenCalled();
  });
});

describe('the notice that stays', () => {
  it('has three answers, no timer, and an Inbox row with the same button', async () => {
    vi.useFakeTimers();
    const r = await DiscordMemory.check(NOW);
    expect(r).toMatchObject({ action: 'asked', persistent: true });
    expect(labels()).toEqual(['Refresh Discord now', 'Turn on automatic refresh', 'Not now']);
    await vi.advanceTimersByTimeAsync(10 * 60000);
    expect(document.getElementById('vex-discord-ask')).not.toBe(null);
    const rows = AttentionInbox.list().filter(x => x.feature === 'discord-memory-care' && x.sub === 'over-limit');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toEqual({ label: 'Refresh Discord now', key: 'refresh' });
  });
  it('Refresh Discord now replaces the panel and clears the row', async () => {
    await DiscordMemory.check(NOW);
    press('Refresh Discord now');
    expect(sb._createPanelWebview).toHaveBeenCalledWith('discord', expect.anything());
    expect(document.getElementById('vex-discord-ask')).toBe(null);
    expect(AttentionInbox.list().filter(x => x.sub === 'over-limit')).toHaveLength(0);
  });
  it('Not now is quiet for one hour, not four, and it asks again after that', async () => {
    await DiscordMemory.check(NOW);
    press('Not now');
    expect((await DiscordMemory.check(NOW + 30 * 60000)).action).toBe('quiet');
    expect(DiscordMemory._quietUntil - Date.now()).toBeLessThanOrEqual(3600000);
    DiscordMemory._quietUntil = 0;
    expect((await DiscordMemory.check(NOW + 3700000)).action).toBe('asked');
  });
  it('Turn on automatic refresh saves that choice', async () => {
    await DiscordMemory.check(NOW);
    press('Turn on automatic refresh');
    expect(DiscordMemory.care().auto).toBe(true);
    expect(AttentionInbox.list().filter(x => x.sub === 'over-limit')).toHaveLength(0);
  });
  it('never during a call: it is not shown, and one on screen is taken away when a call starts', async () => {
    sb._discordInCall = vi.fn(async () => true);
    expect((await DiscordMemory.check(NOW)).action).toBe('waiting');
    expect(document.getElementById('vex-discord-ask')).toBe(null);
    sb._discordInCall = vi.fn(async () => false);
    await DiscordMemory.check(NOW);
    expect(document.getElementById('vex-discord-ask')).not.toBe(null);
    sb._discordInCall = vi.fn(async () => true);
    await DiscordMemory.check(NOW + 120000);
    expect(document.getElementById('vex-discord-ask')).toBe(null);
  });
  it('never while the microphone, camera or a screen share is in use', async () => {
    sb.isPanelCapturing = vi.fn(() => true);
    const r = await DiscordMemory.check(NOW);
    expect(r).toMatchObject({ action: 'waiting', why: expect.stringMatching(/microphone or camera/) });
  });
  it('with the care switch off it is the old 30 second bar', async () => {
    vi.useFakeTimers();
    DiscordMemory.setEnabled(false);
    await DiscordMemory.check(NOW);
    expect(labels()).toEqual(['Refresh', 'Later']);
    await vi.advanceTimersByTimeAsync(31000);
    expect(document.getElementById('vex-discord-ask')).toBe(null);
  });
  it('the Inbox button refreshes, but refuses in a call', async () => {
    await DiscordMemory.check(NOW);
    const row = AttentionInbox.list().find(x => x.sub === 'over-limit');
    sb._discordInCall = vi.fn(async () => true);
    await AttentionInbox.run(row.id);
    await vi.waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Not refreshed: You are in a call/), 'error'));
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
  });
});

describe('the automatic refresh of its own', () => {
  const on = () => DiscordMemory.setAuto(true);
  it('is offered once, in the Inbox, the first time the figure passes the limit', async () => {
    await DiscordMemory.check(NOW);
    const offers = () => AttentionInbox.list().filter(x => x.sub === 'offer-auto');
    expect(offers()).toHaveLength(1);
    expect(offers()[0].action.key).toBe('auto-on');
    expect(DiscordMemory.care().offered).toBe(NOW);
    AttentionInbox.remove(offers()[0].id);
    await DiscordMemory.check(NOW + 2 * 3600000);
    expect(offers()).toHaveLength(0);
  });
  it('the offer button turns it on', async () => {
    await DiscordMemory.check(NOW);
    const row = AttentionInbox.list().find(x => x.sub === 'offer-auto');
    await AttentionInbox.run(row.id);
    await vi.waitFor(() => expect(DiscordMemory.care().auto).toBe(true));
  });
  it('refreshes by itself when hidden, idle, quiet and over the limit, writes a ledger line, and does not depend on the sleep choice', async () => {
    on();
    hiddenSince(20 * 60000);
    const r = await DiscordMemory.check(NOW);
    expect(r.action).toBe('refreshed-auto');
    expect(sb._createPanelWebview).toHaveBeenCalledTimes(1);
    expect(DiscordMemory.care().lastAuto).toBe(NOW);
    const line = VexLedger.list()[0];
    expect(line.feature).toBe('discord-memory-care');
    expect(line.what).toMatch(/Refreshed Discord by itself/);
    expect(line.why).toMatch(/reconnects/);
    expect(line.stop).toEqual({ kind: 'discord-care-auto-off' });
    expect(document.getElementById('vex-discord-ask')).toBe(null);
  });
  it('the stop token in the ledger turns it off', async () => {
    on();
    await VexLedger.stopDoing(VexLedger.note({ feature: 'discord-memory-care', what: 'x', why: 'y', stop: { kind: 'discord-care-auto-off' } }).id);
    expect(DiscordMemory.care().auto).toBe(false);
  });
  it('at most once in six hours', async () => {
    on();
    hiddenSince(20 * 60000);
    await DiscordMemory.check(NOW);
    DiscordMemory._lastRefresh = 0;
    expect(await DiscordMemory.check(NOW + 5 * 3600000)).toMatchObject({ action: 'waiting', why: expect.stringMatching(/six hours/) });
    expect((await DiscordMemory.check(NOW + 6 * 3600000 + 1)).action).toBe('refreshed-auto');
  });
  it('not before it has been hidden ten minutes', async () => {
    on();
    hiddenSince(5 * 60000);
    expect(await DiscordMemory.check(NOW)).toMatchObject({ action: 'waiting', why: expect.stringMatching(/ten minutes/) });
  });
  it('not while an unread count shows, nor within half an hour of one', async () => {
    on();
    hiddenSince(60 * 60000);
    window.PanelBadges.counts = { discord: 3 };
    expect((await DiscordMemory.check(NOW)).action).toBe('waiting');
    window.PanelBadges.counts = { discord: 0 };
    DiscordMemory.noteUnread({ discord: 2 }, NOW - 10 * 60000);
    expect((await DiscordMemory.check(NOW)).action).toBe('waiting');
    expect((await DiscordMemory.check(NOW + 25 * 60000)).action).toBe('refreshed-auto');
  });
  it('never in a call, and never nags with a notice while it is on', async () => {
    on();
    hiddenSince(60 * 60000);
    sb._discordInCall = vi.fn(async () => true);
    expect((await DiscordMemory.check(NOW)).action).toBe('waiting');
    sb._discordInCall = vi.fn(async () => false);
    window.PanelBadges.counts = { discord: 1 };
    await DiscordMemory.check(NOW);
    expect(document.getElementById('vex-discord-ask')).toBe(null);
  });
  it('is not used when the care switch is off', async () => {
    on();
    DiscordMemory.setEnabled(false);
    hiddenSince(60 * 60000);
    expect((await DiscordMemory.check(NOW)).action).toBe('asked');
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
  });
});

describe('the limit cannot silently turn the check off', () => {
  it('an unset limit is the default, not Never', () => {
    expect(DiscordMemory.limitMB()).toBe(1000);
  });
  it('mergeOnce never turns an unset limit into 0, whatever the old settings say', () => {
    for (const notice of ['0', '800', '', null]) {
      localStorage.clear();
      if (notice != null) localStorage.setItem('vex.memoryNoticeMB', notice);
      DiscordMemory.mergeOnce();
      expect(DiscordMemory.limitMB()).toBeGreaterThan(0);
    }
  });
  it('mergeOnce keeps a saved Never as Never (a choice), and the report says so', async () => {
    localStorage.setItem('vex.discordMemoryLimitMB', '0');
    DiscordMemory.mergeOnce();
    expect(DiscordMemory.limitMB()).toBe(0);
    const text = DiscordMemory.buildReport(await reportData());
    expect(text).toMatch(/WARNING: the limit is set to Never/);
  });
  it('a limit of 2 GB is called out too', async () => {
    localStorage.setItem('vex.discordMemoryLimitMB', '2000');
    expect(DiscordMemory.buildReport(await reportData())).toMatch(/WARNING: the limit is 1\.95 GB|WARNING: the limit is 2\.00 GB/);
  });
});

async function reportData(page = {}) {
  window.vex.processes = vi.fn(async () => ({ processes: [{ pid: 99, memKB: 1638 * 1024, privKB: 1500 * 1024, cpu: 3, contents: [{ id: 11, kind: 'webview' }] }] }));
  window.vexGuestEval = vi.fn(async () => ({ heap: { used: 300 * 1048576, total: 400 * 1048576, limit: 4096 * 1048576 }, nodes: 52000, vencord: true,
    heavy: ['MessageLoggerEnhanced'], enabledPlugins: 40, spoofed: true, restFn: true, profiler: null, ...page }));
  globalThis.WebviewManager = { scriptsOffIn: () => false };
  return DiscordMemory.collect();
}

describe('Vencord off / on from the Discord button', () => {
  it('the menu label follows the installed extension', () => {
    expect(DiscordMemory.vencordMenuLabel({ installed: true, enabled: true })).toBe('Turn Vencord off');
    expect(DiscordMemory.vencordMenuLabel({ installed: true, enabled: false })).toBe('Turn Vencord on');
    expect(DiscordMemory.vencordMenuLabel({ installed: false })).toBe(null);
    expect(DiscordMemory.vencordMenuLabel(null)).toBe('Turn Vencord off or on');
  });
  it('reads the state from the vencord-* extension', async () => {
    expect(await DiscordMemory.vencordState()).toEqual({ installed: true, enabled: true, folder: 'vencord-1' });
    extensions[0].enabled = false;
    expect((await DiscordMemory.vencordState()).enabled).toBe(false);
    extensions.length = 0;
    expect((await DiscordMemory.vencordState()).installed).toBe(false);
  });
  it('turns it off through the same call as the Settings checkbox, reloads Discord, and says what is off', async () => {
    const msg = await DiscordMemory.toggleVencord();
    expect(window.vex.extensionsSetEnabled).toHaveBeenCalledWith('vencord-1', false);
    expect(msg).toMatch(/themes and plugins are off/);
    expect(sb._createPanelWebview).toHaveBeenCalledTimes(1);          // hidden: replaced without being shown
    expect(DiscordMemory._vencord.enabled).toBe(false);
  });
  it('turns it back on', async () => {
    extensions[0].enabled = false;
    const msg = await DiscordMemory.toggleVencord();
    expect(window.vex.extensionsSetEnabled).toHaveBeenCalledWith('vencord-1', true);
    expect(msg).toMatch(/Vencord is on/);
  });
  it('a Discord in front is reloaded, not replaced', async () => {
    sb.activePanel = 'discord';
    await DiscordMemory.toggleVencord();
    expect(sb.panelWebviews.discord.reload).toHaveBeenCalled();
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
  });
  it('refuses in a call and changes nothing', async () => {
    sb._discordInCall = vi.fn(async () => true);
    await expect(DiscordMemory.toggleVencord()).rejects.toThrow(/in a call/);
    expect(window.vex.extensionsSetEnabled).not.toHaveBeenCalled();
  });
  it('says so when Vencord is not installed, and when the switch fails', async () => {
    window.vex.extensionsSetEnabled = vi.fn(async () => ({ ok: false, error: 'Not found' }));
    await expect(DiscordMemory.toggleVencord()).rejects.toThrow(/Turning Vencord off failed: Not found/);
    extensions.length = 0;
    await expect(DiscordMemory.toggleVencord()).rejects.toThrow(/not installed/);
  });
  it('the sidebar menu offers it for the Discord button only', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/sidebar.js'), 'utf8');
    expect(src).toMatch(/DiscordMemory\.vencordMenuLabel\(DiscordMemory\._vencord\)/);
    expect(src).toMatch(/DiscordMemory\.toggleVencord\(\)/);
  });
  it('a measurement cut off with Vencord off turns it back on at the next start', async () => {
    DiscordMemory._careWired = false;
    extensions[0].enabled = false;
    DiscordMemory._saveCare({ abPending: 'vencord-1' });
    DiscordMemory._wireCare();
    await vi.waitFor(() => expect(DiscordMemory.care().abPending).toBe(''));
    expect(extensions[0].enabled).toBe(true);
  });
});

describe('the report', () => {
  it('shows Vencord on/off, the care state and the rest state', async () => {
    DiscordMemory.setRest(true);
    const text = DiscordMemory.buildReport(await reportData());
    expect(text).toMatch(/Vencord is ON \(the extension vencord-1\)/);
    expect(text).toMatch(/Rest mode: on/);
    extensions[0].enabled = false;
    expect(DiscordMemory.buildReport(await reportData({ vencord: false, heavy: [] }))).toMatch(/Vencord is OFF/);
  });
  it('puts Vencord first in the recommendations, then the heavy plugins, and says the saving is not measured', async () => {
    const text = DiscordMemory.buildReport(await reportData());
    const recs = DiscordMemory.recommendations(await reportData());
    expect(recs[0]).toMatch(/Vencord and its plugins are the first suspect/);
    expect(recs[1]).toMatch(/MessageLoggerEnhanced/);
    expect(text).toMatch(/NOT measured/);
  });
  it('lists the plugins by time when the profiler is there, and says how to get it when it is not', async () => {
    const rows = [{ name: 'MessageLoggerEnhanced', totalMs: 900, fluxCalls: 5000, worstEvent: 'MESSAGE_CREATE' }];
    const withP = DiscordMemory.buildReport(await reportData({ profiler: { seconds: 600, rows } }));
    expect(withP).toMatch(/MessageLoggerEnhanced: 900 ms, 5000 events, slowest on MESSAGE_CREATE/);
    expect(DiscordMemory.buildReport(await reportData())).toMatch(/Turn on the PluginProfiler plugin/);
  });
  it('recommends rest mode and automatic refresh only when they are off', async () => {
    const d = await reportData();
    expect(DiscordMemory.recommendations(d).join('\n')).toMatch(/rest mode/);
    expect(DiscordMemory.recommendations(d).join('\n')).toMatch(/Refresh Discord automatically/);
    DiscordMemory.setRest(true); DiscordMemory.setAuto(true);
    const d2 = await reportData();
    expect(DiscordMemory.recommendations(d2).join('\n')).not.toMatch(/rest mode/);
    expect(DiscordMemory.recommendations(d2).join('\n')).not.toMatch(/Refresh Discord automatically/);
  });
});
