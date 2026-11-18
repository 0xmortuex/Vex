// @vitest-environment jsdom
//
// Discord memory care (Wave 6): a notice that stays until answered, and a Discord-only automatic refresh.
// Rest mode, Vencord off/on and the "Why is Discord big?" report are gone: Discord is a plain page in Vex.

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
  it('start as on (the registry stages it off for an existing profile), with automatic refresh off', () => {
    expect(DiscordMemory.care()).toEqual({ on: true, auto: false, offered: 0, lastAuto: 0 });
    expect(DiscordMemory.autoOn()).toBe(false);
  });
  it('a record saved by an older Vex (rest mode, an unfinished Vencord measurement) is read without those', () => {
    localStorage.setItem('vex.discordCare', JSON.stringify({ on: true, auto: true, rest: true, abPending: 'vencord-1', pluginPending: ['MessageLogger'] }));
    expect(DiscordMemory.care()).toEqual({ on: true, auto: true, offered: 0, lastAuto: 0 });
    for (const gone of ['restModeOn', 'setRest', 'lite', 'setLite', 'turnOffHeavyPlugins', 'vencordState', 'setVencord', 'toggleVencord', 'collect', 'buildReport', 'showWhyBig', 'measurementHold']) expect(DiscordMemory[gone]).toBeUndefined();
  });
  it('the registry switch turns the whole thing off, and nothing it saved is lost', () => {
    DiscordMemory.setAuto(true);
    DiscordMemory.setEnabled(false);
    expect(DiscordMemory.enabled()).toBe(false);
    expect(DiscordMemory.autoOn()).toBe(false);
    DiscordMemory.setEnabled(true);
    expect(DiscordMemory.autoOn()).toBe(true);
  });
  it('an unreadable record is an error, not a silent default', () => {
    localStorage.setItem('vex.discordCare', '{nope');
    expect(() => DiscordMemory.care()).toThrow(/not readable/);
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
  it('mergeOnce keeps a saved Never as Never (a choice)', () => {
    localStorage.setItem('vex.discordMemoryLimitMB', '0');
    DiscordMemory.mergeOnce();
    expect(DiscordMemory.limitMB()).toBe(0);
  });
});

describe('nothing runs in Discord\'s page', () => {
  it('the memory module has no page script, stylesheet or extension switch', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/discord-memory.js'), 'utf8');
    expect(src).not.toMatch(/vexGuestEval|executeJavaScript|insertCSS|extensionsSetEnabled|window\.Vencord|setDiscordLite/);
  });
});

