// @vitest-environment jsdom
//
// "Measure over 10 minutes" and "Measure with Vencord, then without": memory only, ends by itself, and Vencord is
// always turned back on.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');
const { DiscordMeasure } = require('../../src/renderer/js/discord-measure.js');
const { VexSettingsGroups } = require('../../src/renderer/js/vex-settings-groups.js');
globalThis.VexSettingsGroups = VexSettingsGroups;

let ticks, stops, sb, ws, extensions, confirmAnswers, sizeNow;
const sampleOf = (at, wsMB, heapMB) => ({ at, wsMB, heapMB });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="panel-discord"></div>';
  ticks = []; stops = 0; ws = 11; sizeNow = 1500;
  DiscordMeasure._run = null;
  globalThis.VexJobs = { every: vi.fn((name, ms, fn, opts) => { const rec = { name, ms, fn, opts, live: true }; ticks.push(rec); return { stop: () => { rec.live = false; stops++; } }; }) };
  Object.assign(DiscordMemory, { _lastRefresh: 0, _quietUntil: 0, _toldMB: 0, _vencord: null, _history: [] });
  const mk = (id) => { const e = document.createElement('webview'); e.getWebContentsId = () => id; e.isCurrentlyAudible = () => false; e.reload = vi.fn(); return e; };
  const first = mk(11);
  document.getElementById('panel-discord').appendChild(first);
  let next = 12;
  sb = { panelWebviews: { discord: first }, activePanel: 'claude', sidePanel: null, isPanelCapturing: () => false, _discordInCall: async () => false,
    _createPanelWebview: vi.fn((n, el) => { const w = mk(next++); el.appendChild(w); sb.panelWebviews[n] = w; ws = next - 1; return w; }) };
  globalThis.SidebarManager = sb;
  extensions = [{ name: 'Vencord', folder: 'vencord-1', enabled: true, where: ['persist:discord'] }];
  window.vex = {
    tabMemory: vi.fn(async (ids) => ({ byId: { [ids[0]]: { memKB: sizeNow * 1024 } } })),
    extensionsList: vi.fn(async () => extensions),
    extensionsSetEnabled: vi.fn(async (f, on) => { extensions[0].enabled = on; return { ok: true }; }),
  };
  window.vexGuestEval = vi.fn(async () => 400 * 1048576);
  globalThis.WebviewManager = { scriptsOffIn: () => false };
  window.showToast = vi.fn();
  confirmAnswers = [true, true];
  window.vexConfirm = vi.fn(async () => confirmAnswers.shift());
});

// Runs the live job's tick again and again until `p` has settled (or `max` rounds).
async function drive(p, max = 400, between = () => {}) {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < max && !done; i++) {
    await new Promise(r => setTimeout(r, 0));
    const t = ticks[ticks.length - 1];
    if (t && t.live) { between(i); await t.fn(); }
    await new Promise(r => setTimeout(r, 0));
  }
  return done;
}

describe('the numbers and the words', () => {
  it('stats and the trend, with a verdict', () => {
    const t0 = 0;
    const flat = [0, 1, 2, 3].map(i => sampleOf(t0 + i * 30000, 1500 + i, 400));
    expect(DiscordMeasure.stats(flat, 'wsMB')).toMatchObject({ n: 4, first: 1500, last: 1503, delta: 3, min: 1500, max: 1503 });
    const text = DiscordMeasure.trendText('Discord, now', flat);
    expect(text).toMatch(/4 samples over 2 minutes/);
    expect(text).toMatch(/Process memory: 1500 -> 1503 MB \(\+3\)/);
    expect(text).toMatch(/JavaScript heap in use: 400 -> 400 MB/);
    expect(text).toMatch(/stayed flat/);
    const growing = [0, 1, 2].map(i => sampleOf(i * 30000, 1000 + i * 200, 300));
    expect(DiscordMeasure.trendText('x', growing)).toMatch(/It grew while hidden/);
  });
  it('no samples is said, not hidden', () => {
    expect(DiscordMeasure.trendText('Discord, now', [])).toMatch(/no sample could be taken/);
  });
  it('the difference is with minus without, for the process and the heap', () => {
    const a = [sampleOf(0, 1600, 500), sampleOf(30000, 1600, 500)];
    const b = [sampleOf(0, 900, 200), sampleOf(30000, 900, 200)];
    const text = DiscordMeasure.compare(a, b);
    expect(text).toMatch(/1600 MB with, 900 MB without = \+700 MB \(78%/);
    expect(text).toMatch(/JavaScript heap: 500 MB with, 200 MB without = \+300 MB/);
    expect(text).toMatch(/not page age/);
    expect(DiscordMeasure.compare([], b)).toMatch(/cannot be compared/);
  });
});

describe('measuring for ten minutes', () => {
  it('takes 20 samples at 30 s on a VexJobs job that stops itself, and changes nothing', async () => {
    const p = DiscordMeasure.open({ ab: false });
    expect(await drive(p)).toBe(true);
    const results = await p;
    expect(ticks[0]).toMatchObject({ name: 'Discord measure', ms: 30000, opts: { when: 'background', feature: 'discord-memory-care' } });
    expect(results[0]).toMatch(/20 samples/);
    expect(stops).toBe(1);
    expect(window.vex.extensionsSetEnabled).not.toHaveBeenCalled();
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
  });
  it('skips a sample while Discord is open, and says why', async () => {
    const seen = [];
    const p = DiscordMeasure.open({ ab: false });
    await drive(p, 6, (i) => { sb.activePanel = i === 1 ? 'discord' : 'claude'; seen.push(document.querySelector('#vex-discord-measure .vex-platform-note').textContent); });
    expect(seen.join('|')).toMatch(/skipped a sample \(Discord is open\)/);
    sb.activePanel = 'claude';
    await drive(p);
    expect((await p)[0]).toMatch(/samples/);
  });
  it('closing the window stops it', async () => {
    const p = DiscordMeasure.open({ ab: false });
    await drive(p, 3);
    document.getElementById('vex-discord-measure').remove();
    expect(await drive(p, 10)).toBe(true);
    expect(stops).toBe(1);
  });
  it('asks before loading an asleep Discord, and a no ends quietly with nothing opened or loaded', async () => {
    sb.panelWebviews = {};
    window.vexConfirm = vi.fn(async () => false);
    sb._createPanelWebview = vi.fn();
    await expect(DiscordMeasure.open({ ab: false })).resolves.toBeUndefined();
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/asleep/);
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
    expect(document.getElementById('vex-discord-measure')).toBeNull();
  });
  it('a yes that cannot be carried out is said plainly', async () => {
    sb.panelWebviews = {};
    delete sb._createPanelWebview;
    window.vexConfirm = vi.fn(async () => true);
    await expect(DiscordMeasure.open({ ab: false })).rejects.toThrow(/cannot be loaded in the background/);
  });
});

describe('with Vencord, then without', () => {
  const runAB = async (between) => { const p = DiscordMeasure.open({ ab: true }); await drive(p, 600, between); return p; };
  it('reloads, samples, asks again, turns Vencord off, reloads, samples, and turns it back on', async () => {
    const order = [];
    window.vex.extensionsSetEnabled = vi.fn(async (f, on) => { order.push(on ? 'on' : 'off'); extensions[0].enabled = on; return { ok: true }; });
    const results = await runAB(() => { sizeNow = extensions[0].enabled ? 1600 : 900; });
    expect(order).toEqual(['off', 'on']);
    expect(window.vexConfirm).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatch(/With Vencord/);
    expect(results[1]).toMatch(/Without Vencord/);
    expect(results[2]).toMatch(/1600 MB with, 900 MB without = \+700 MB/);
    expect(extensions[0].enabled).toBe(true);
    expect(DiscordMemory.care().abPending).toBe('');
    expect(sb._createPanelWebview.mock.calls.length).toBeGreaterThanOrEqual(3);   // with, without, and back
  });
  it('the second question answered no leaves Vencord on and changes nothing', async () => {
    confirmAnswers = [true, false];
    await runAB();
    expect(window.vex.extensionsSetEnabled).not.toHaveBeenCalled();
    expect(extensions[0].enabled).toBe(true);
  });
  it('closing the window while Vencord is off turns it back on', async () => {
    let off = false;
    window.vex.extensionsSetEnabled = vi.fn(async (f, on) => { extensions[0].enabled = on; if (!on) off = true; return { ok: true }; });
    const p = DiscordMeasure.open({ ab: true });
    let closed = false;
    await drive(p, 600, () => { if (off && !closed) { closed = true; expect(DiscordMemory.care().abPending).toBe('vencord-1'); document.getElementById('vex-discord-measure').remove(); } });
    await p;
    expect(closed).toBe(true);
    expect(extensions[0].enabled).toBe(true);
    expect(DiscordMemory.care().abPending).toBe('');
  });
  it('if turning it back on fails, the pending record stays so the next start retries', async () => {
    window.vex.extensionsSetEnabled = vi.fn(async (f, on) => { if (on) return { ok: false, error: 'Not found' }; extensions[0].enabled = false; return { ok: true }; });
    await runAB();
    expect(DiscordMemory.care().abPending).toBe('vencord-1');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Vencord could not be turned back on/), 'error');
  });
  it('needs Vencord installed and on', async () => {
    extensions[0].enabled = false;
    await runAB();
    expect(window.vexConfirm).not.toHaveBeenCalled();
  });
  it('the first question answered no changes nothing', async () => {
    confirmAnswers = [false];
    await runAB();
    expect(sb._createPanelWebview).not.toHaveBeenCalled();
    expect(window.vex.extensionsSetEnabled).not.toHaveBeenCalled();
  });
});

describe('hide and keep running', () => {
  const button = (root, text) => [...root.querySelectorAll('button')].find(b => b.textContent === text);
  const windowEl = () => document.getElementById('vex-discord-measure');

  it('hides the window, keeps the measurement going, shows the progress in a small bar, and Show brings the window back', async () => {
    const p = DiscordMeasure.open({ ab: false });
    await drive(p, 3);
    const w = windowEl();
    button(w, 'Hide and keep running').click();
    expect(w.style.display).toBe('none');
    expect(w.isConnected).toBe(true);                                  // hidden, not closed: closing stops the run
    const chip = document.getElementById('vex-measure-chip');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toMatch(/Measuring|sample|Starting/i);
    expect(DiscordMeasure._run.cancelled).toBe(false);
    await drive(p, 6);
    expect(stops).toBe(0);                                             // still running
    button(chip, 'Show').click();
    expect(w.style.display).toBe('');
    expect(document.getElementById('vex-measure-chip')).toBeNull();
    expect(await drive(p, 600)).toBe(true);                            // and it still finishes by itself
    expect(DiscordMeasure._run.cancelled).toBe(false);
  });

  it('the bar follows the progress while the window is hidden', async () => {
    const p = DiscordMeasure.open({ ab: false });
    await drive(p, 3);
    button(windowEl(), 'Hide and keep running').click();
    const chip = document.getElementById('vex-measure-chip');
    await drive(p, 40);
    DiscordMeasure._run.say('Reading 3 of 3');
    expect(chip.textContent).toContain('Reading 3 of 3');
    expect(chip.title).toBe('Reading 3 of 3');
    button(chip, 'Stop').click();
    await drive(p, 600);
  });

  it('Stop in the bar stops the measurement', async () => {
    const p = DiscordMeasure.open({ ab: false });
    await drive(p, 3);
    button(windowEl(), 'Hide and keep running').click();
    button(document.getElementById('vex-measure-chip'), 'Stop').click();
    expect(DiscordMeasure._run.cancelled).toBe(true);
    expect(await drive(p, 600)).toBe(true);
    expect(DiscordMeasure._run.finished).toBe(true);
    expect(document.getElementById('vex-measure-chip')).toBeNull();
  });

  it('a measurement that finishes while hidden says so and offers the result', async () => {
    const p = DiscordMeasure.open({ ab: false });
    await drive(p, 3);
    button(windowEl(), 'Hide and keep running').click();
    expect(await drive(p, 800)).toBe(true);
    expect(document.getElementById('vex-measure-chip')).toBeNull();
    const call = window.showToast.mock.calls.find(c => /measurement (finished|stopped)/.test(c[0]));
    expect(call, 'a toast').toBeTruthy();
    expect(call[3].action.label).toBe('Show the result');
    expect(windowEl().style.display).toBe('none');                     // still hidden until asked
    call[3].action.run();
    expect(windowEl().style.display).toBe('');
  });

  it('a measurement that finishes while the window is showing says nothing extra', async () => {
    const p = DiscordMeasure.open({ ab: false });
    expect(await drive(p, 800)).toBe(true);
    expect(window.showToast.mock.calls.some(c => /measurement (finished|stopped)/.test(c[0]))).toBe(false);
  });

  it('closing the window while it is hidden still stops the run and removes the bar', async () => {
    const p = DiscordMeasure.open({ ab: false });
    await drive(p, 3);
    button(windowEl(), 'Hide and keep running').click();
    windowEl().remove();
    expect(await drive(p, 20)).toBe(true);
    expect(stops).toBe(1);
    expect(document.getElementById('vex-measure-chip')).toBeNull();
  });
});
