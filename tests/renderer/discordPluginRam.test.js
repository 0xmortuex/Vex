// @vitest-environment jsdom
//
// Which Vencord plugin costs how many MB (js/discord-plugin-ram.js): the pure numbers and words, the page-side code
// (run for real in a vm against a fake Vencord), the allocation window against a fake main process, and the
// one-plugin-at-a-time state machine, above all that EVERY plugin is put back.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const vm = require('vm');
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');
const { DiscordMeasure } = require('../../src/renderer/js/discord-measure.js');
const { DiscordPluginRam: R } = require('../../src/renderer/js/discord-plugin-ram.js');
const { VexSettingsGroups } = require('../../src/renderer/js/vex-settings-groups.js');
globalThis.VexSettingsGroups = VexSettingsGroups;
globalThis.DiscordPluginRam = R;
globalThis.DiscordMeasure = DiscordMeasure;

const ROWS = [
  { name: 'MessageLoggerEnhanced', enabled: true, canDisable: true, reason: '' },
  { name: 'Zeta', enabled: true, canDisable: true, reason: '' },
  { name: 'Alpha', enabled: true, canDisable: true, reason: '' },
  { name: 'WhoReacted', enabled: true, canDisable: true, reason: '' },
  { name: 'Off', enabled: false, canDisable: true, reason: '' },
  { name: 'CommandsAPI', enabled: true, canDisable: false, reason: 'these plugins need it: Alpha' },
];

beforeEach(() => {
  localStorage.clear();
  R.last = { fast: null, slow: null, profiler: null };
  R._busy = false; R._restoreJob = null;
  document.body.innerHTML = '<div id="panel-discord"></div>';
});

describe('plan and estimate', () => {
  it('puts the heavy plugins first, then the rest by name, capped, and says what is skipped', () => {
    const p = R.planOrder(ROWS, { heavy: DiscordMemory.HEAVY_PLUGINS, max: 3 });
    expect(p.ordered).toEqual(['MessageLoggerEnhanced', 'WhoReacted', 'Alpha', 'Zeta']);
    expect(p.chosen).toEqual(['MessageLoggerEnhanced', 'WhoReacted', 'Alpha']);
    expect(p.skipped).toEqual([{ name: 'CommandsAPI', reason: 'these plugins need it: Alpha' }]);
    expect(R.planOrder(ROWS, { max: 999 }).cap).toBe(R.MAX_LIMIT);
    expect(R.planOrder(ROWS, { max: 0 }).cap).toBe(R.MAX_DEFAULT);
  });
  it('estimates (n + 2 baselines) x (reload + 3 min + 2 gaps)', () => {
    expect(R.estimateMinutes(6)).toBe(40);
    expect(R.estimateMinutes(1)).toBe(15);
    expect(R.estimateMinutes(3, { settleMs: 0, samples: 1, gapMs: 0, reloadMs: 60000 })).toBe(5);
  });
});

describe('summarize: delta, noise, verdict', () => {
  // baselines: heap 400, 402, 398 and 404, 396, 400 (spread 8); process 1000 +- 6
  const slow = {
    baselines: [{ heap: [400, 402, 398], ws: [1000, 1004, 996] }, { heap: [404, 396, 400], ws: [1002, 998, 1000] }],
    plugins: [
      { name: 'Big', heap: [340, 342, 338], ws: [900, 902, 898] },       // 60 MB heap, 100 MB process
      { name: 'Small', heap: [398, 399, 397], ws: [998, 999, 997] },     // 2 / 2: inside the noise
      { name: 'HeapOnly', heap: [380, 381, 379], ws: [1001, 1000, 999] },// heap 20, process 0
      { name: 'Wild', heap: [300, 400, 350], ws: [1000, 1000, 1000] },   // a wide spread hides a 50 MB delta
      { name: 'Odd', heap: [440, 441, 439], ws: [1060, 1061, 1059] },    // bigger with it OFF
    ],
  };
  const s = R.summarize(slow);
  const by = (n) => s.rows.find(r => r.name === n);
  it('a real difference is reported with its +/- and in MB', () => {
    expect(by('Big')).toMatchObject({ heapDelta: 60, wsDelta: 100, heapNoise: 8, wsNoise: 8, sig: true, wsSig: true });
    expect(by('Big').verdict).toBe('about 100 MB of process memory');
  });
  it('a difference smaller than the noise is "within noise (< x MB)"', () => {
    expect(by('Small').sig).toBe(false);
    expect(by('Small').verdict).toBe('within noise (< 8 MB)');
    expect(by('Wild').verdict).toBe('within noise (< 100 MB)');
  });
  it('a heap-only difference says so and keeps the process verdict', () => {
    expect(by('HeapOnly').verdict).toBe('about 20 MB of JavaScript heap; process memory within noise (< 8 MB)');
  });
  it('a plugin that looks bigger when OFF is called drift, not a negative cost', () => {
    expect(by('Odd').verdict).toMatch(/LESS with the plugin on, by 60 MB \(page drift/);
  });
  it('shows the drift between the two baselines', () => {
    expect(s.drift).toEqual({ heap: 0, ws: 0 });
    const d = R.summarize({ baselines: [{ heap: [400], ws: [1000] }, { heap: [430], ws: [1010] }], plugins: [] });
    expect(d.drift).toEqual({ heap: 30, ws: 10 });
    expect(R.summarize({ baselines: [], plugins: [] }).rows).toEqual([]);
  });
});

describe('the table and the section text', () => {
  const fast = { at: 1, windowMs: 60000, windowSec: 60, heap: { beforeMB: 380, afterMB: 410, totalMB: 500 }, map: { status: 'ok', why: '' },
    plugins: [{ name: 'Alpha', kb: 30720, selfKB: 20480 }, { name: 'Big', kb: 5120, selfKB: 1024 }, { name: 'Tiny', kb: 100, selfKB: 100 }], coreKB: 2048, otherKB: 102400, totalKB: 140388 };
  const slow = { at: 2, partial: false, skipped: [{ name: 'CommandsAPI', reason: 'x' }],
    baselines: [{ heap: [400, 400, 400], ws: [1000, 1000, 1000] }, { heap: [400, 400, 400], ws: [1000, 1000, 1000] }],
    plugins: [{ name: 'Big', heap: [340, 340, 340], ws: [900, 900, 900] }, { name: 'Alpha', heap: [399, 399, 399], ws: [999, 999, 999] }] };
  it('sorts by cost and merges both methods and the old time score', () => {
    const rows = R.tableRows({ fast, slow }, { rows: [{ name: 'Big', totalMs: 1234.4 }, { name: 'NotMeasured', totalMs: 5 }] });
    expect(rows.map(r => r.name)).toEqual(['Big', 'Alpha', 'Tiny']);   // Big: 100 MB by the test beats Alpha's 30 MB by allocation
    expect(rows[1]).toMatchObject({ allocMB: 30, selfMB: 20 });
    expect(rows[0]).toMatchObject({ allocMB: 5, timeMs: 1234 });
    expect(rows[0].slow.wsDelta).toBe(100);
  });
  it('writes the table, the unattributed rows, the old score label and the limits', () => {
    const t = R.sectionText({ fast, slow }, { rows: [{ name: 'Big', totalMs: 1234 }] });
    expect(t).toMatch(/^Plugin memory \(/);
    expect(t).toMatch(/plugin\s+by allocation\s+one at a time: heap \/ process\s+\+\/- \(heap \/ process\)\s+verdict\s+time score \(old\)/);
    expect(t).toMatch(/Alpha\s+30 MB/);
    expect(t).toMatch(/Big\s+5 MB\s+60 \/ 100 MB\s+±0 \/ ±0\s+about 100 MB of process memory\s+1234 ms/);
    expect(t).toMatch(/Vencord core \(not a plugin\)\s+2 MB/);
    expect(t).toMatch(/Discord itself \/ unattributed\s+100 MB/);
    expect(t).toMatch(/Not tested \(cannot be turned off\): CommandsAPI/);
    expect(t).toMatch(/Native memory \(images, emoji, video\) is NOT attributed per plugin/);
    expect(t).toMatch(/JavaScript heap is only part of the process/);
    expect(t).toMatch(/Noise is tens of MB/);
    expect(t).toMatch(/Patches stay in Discord until it reloads/);
    expect(t).toMatch(/time score \(old\)": the PluginProfiler/);
  });
  it('before any measurement it says how to start, with the limits', () => {
    const t = R.sectionText({ fast: null, slow: null }, null);
    expect(t).toMatch(/Not measured yet/);
    expect(t).toMatch(/Measure plugin memory/);
    expect(t).toMatch(/NOT attributed per plugin/);
  });
  it('warns when the line map is missing or stale', () => {
    const t = R.sectionText({ fast: { ...fast, map: { status: 'stale', why: 'the plugin line map was made for a different Vencord.js' } }, slow: null }, null);
    expect(t).toMatch(/WARNING: no usable plugin line map/);
  });
});

describe('the code that runs inside Discord', () => {
  const run = (code, window) => vm.runInNewContext(code, { window, Vencord: window.Vencord }, { timeout: 2000 });
  const settingsWindow = () => {
    const plugins = { A: { enabled: true }, B: { enabled: false }, MessageLogger: { enabled: true }, Odd: {} };
    return { Vencord: { Settings: { plugins } }, plugins };
  };
  it('without the plugin API it lists Vencord’s own settings and switches them', () => {
    const w = settingsWindow();
    const got = run(R.LIST_CODE, w);
    expect(got.via).toBe('settings');
    expect(got.rows.map(r => r.name).sort()).toEqual(['A', 'B', 'MessageLogger']);
    expect(got.rows.find(r => r.name === 'A')).toMatchObject({ enabled: true, canDisable: null });
    expect(run(R.setCode('MessageLogger', false), w)).toMatchObject({ name: 'MessageLogger', enabled: false });
    expect(w.plugins.MessageLogger.enabled).toBe(false);
    expect(run(R.setCode('MessageLogger', true), w).enabled).toBe(true);
    expect(() => run(R.setCode('Nope', false), w)).toThrow(/no saved settings for Nope/);
  });
  it('with the plugin API it uses the API (which can refuse)', () => {
    const calls = [];
    const w = { Vencord: {}, VexPluginRam: {
      list: () => [{ name: 'X', enabled: true, canDisable: true, reason: '', requiresRestart: true, extra: 'ignored' }],
      setEnabled: (n, on) => { calls.push([n, on]); if (n === 'Core') throw new Error('Core cannot be turned off'); return { name: n, enabled: on }; } } };
    const got = run(R.LIST_CODE, w);
    expect(got).toEqual({ via: 'api', rows: [{ name: 'X', enabled: true, canDisable: true, reason: '', requiresRestart: true }] });
    expect(run(R.setCode('X', false), w).enabled).toBe(false);
    expect(() => run(R.setCode('Core', false), w)).toThrow(/cannot be turned off/);
    expect(calls).toEqual([['X', false], ['Core', false]]);
  });
  it('a name cannot break out of the code', () => {
    const w = settingsWindow();
    w.plugins['x"); window.hacked=1; ("'] = { enabled: true };
    run(R.setCode('x"); window.hacked=1; ("', false), w);
    expect(w.hacked).toBeUndefined();
    expect(w.plugins['x"); window.hacked=1; ("'].enabled).toBe(false);
  });
  it('no Vencord at all is null', () => {
    expect(run(R.LIST_CODE, { Vencord: undefined })).toBeNull();
  });
});

describe('listPlugins offers only the heavy plugins without the plugin API', () => {
  it('marks them by the heavy list and explains the others', async () => {
    DiscordMemory.webview = () => ({});
    window.vexGuestEval = vi.fn(async () => ({ via: 'settings', rows: [{ name: 'WhoReacted', enabled: true, canDisable: null }, { name: 'Other', enabled: true, canDisable: null }] }));
    const r = await R.listPlugins();
    expect(r.via).toBe('settings');
    expect(r.rows.find(x => x.name === 'WhoReacted').canDisable).toBe(true);
    const o = r.rows.find(x => x.name === 'Other');
    expect(o.canDisable).toBe(false);
    expect(o.reason).toMatch(/VexPluginRam/);
  });
  it('says plainly when Vencord is not running', async () => {
    DiscordMemory.webview = () => ({});
    window.vexGuestEval = vi.fn(async () => null);
    await expect(R.listPlugins()).rejects.toThrow(/Vencord is not running/);
  });
});

// ---- method 1 against a fake main process ----------------------------------------------------------------------------------
describe('measureFast', () => {
  let calls, why, endResult, cancelAt;
  beforeEach(() => {
    calls = []; why = null; cancelAt = null;
    endResult = { ok: true, windowMs: 60000, heap: { beforeMB: 380, afterMB: 410, totalMB: 500 }, map: { status: 'ok', why: '' }, plugins: [{ name: 'Alpha', kb: 2048, selfKB: 1024 }], coreKB: 1, otherKB: 2, totalKB: 2051 };
    window.vex = {
      discordHeapBegin: vi.fn(async (id, names) => { calls.push(['begin', id, names]); return { ok: true }; }),
      discordHeapEnd: vi.fn(async (id, keep) => { calls.push(['end', id, keep]); return keep ? endResult : { ok: true, discarded: true }; }),
    };
    DiscordMemory.webview = () => ({ getWebContentsId: () => 11 });
    DiscordMemory.reasonToWait = vi.fn(async () => why);
    window.vexGuestEval = vi.fn(async () => ({ via: 'api', rows: [{ name: 'Alpha', enabled: true }, { name: 'Beta', enabled: false }] }));
  });
  const clock = () => { let t = 0; return { now: () => t, wait: async (ms) => { t += ms; } }; };

  it('begins with the plugin names, waits the window out, ends keeping the profile, and stores the result', async () => {
    const c = clock();
    const r = await R.measureFast({ windowSec: 15, ...c });
    expect(calls).toEqual([['begin', 11, ['Alpha', 'Beta']], ['end', 11, true]]);
    expect(r.plugins[0].name).toBe('Alpha');
    expect(R.last.fast.windowSec).toBe(15);
    expect(c.now()).toBeGreaterThanOrEqual(15000);
  });
  it('refuses a window that is not one of the choices, and while Discord is open or in a call', async () => {
    await expect(R.measureFast({ windowSec: 7 })).rejects.toThrow(/one of 15, 30, 60, 120/);
    why = 'You are in a call';
    await expect(R.measureFast({ windowSec: 15 })).rejects.toThrow(/Not measured: You are in a call/);
    expect(calls).toEqual([]);
  });
  it('a call starting during the window drops the profile (end with keep=false) and says so', async () => {
    const c = clock();
    DiscordMemory.reasonToWait = vi.fn(async () => (c.now() >= 5000 ? 'You are in a call' : null));
    await expect(R.measureFast({ windowSec: 60, ...c })).rejects.toThrow(/Stopped: You are in a call\. Nothing was kept/);
    expect(calls[calls.length - 1]).toEqual(['end', 11, false]);
    expect(R.last.fast).toBeNull();
  });
  it('Stop drops the profile too', async () => {
    const c = clock();
    await expect(R.measureFast({ windowSec: 60, ...c, isCancelled: () => c.now() >= 5000 })).rejects.toThrow(/Stopped\. Nothing was kept/);
    expect(calls[calls.length - 1]).toEqual(['end', 11, false]);
  });
  it('a refusal from main (DevTools attached) surfaces and nothing is left running', async () => {
    window.vex.discordHeapBegin = vi.fn(async () => { throw new Error('DevTools (or another tool) is already attached to Discord'); });
    await expect(R.measureFast({ windowSec: 15, ...clock() })).rejects.toThrow(/DevTools/);
    expect(window.vex.discordHeapEnd).not.toHaveBeenCalled();
  });
});

// ---- method 2: the state machine --------------------------------------------------------------------------------------------
describe('runOneAtATime', () => {
  const CFG = { settleMs: 20000, samples: 3, gapMs: 30000, maxInUseMs: 90000 };
  function harness(over = {}) {
    const log = [];
    const state = { off: new Set(), persisted: [], guardWhy: null, cancelled: false, sampleFor: (off) => ({ heapMB: 400 - (off ? 40 : 0), wsMB: 1000 - (off ? 90 : 0) }) };
    let loadedOff = null;
    const deps = {
      setEnabled: vi.fn(async (name, on) => { log.push(['set', name, on]); if (over.setFails && over.setFails(name, on)) throw new Error('cannot switch ' + name); if (on) state.off.delete(name); else state.off.add(name); }),
      reload: vi.fn(async () => { log.push(['reload', [...state.off]]); loadedOff = [...state.off][0] || null; if (over.reloadFails && over.reloadFails()) throw new Error('reload failed'); }),
      sample: vi.fn(async () => { log.push(['sample', loadedOff]); if (over.sampleFails && over.sampleFails(loadedOff)) throw new Error('heap unreadable'); return state.sampleFor(loadedOff); }),
      wait: vi.fn(async () => {}),
      guard: vi.fn(async () => state.guardWhy),
      isCancelled: () => (over.cancelWhen ? over.cancelWhen(log) : state.cancelled),
      persist: vi.fn((names) => { log.push(['persist', names]); state.persisted = names; }),
      say: vi.fn(),
    };
    return { deps, log, state };
  }
  const plan = { chosen: ['A', 'B'], skipped: [{ name: 'API', reason: 'x' }] };

  it('baseline, each plugin off one at a time, back on, a second baseline; the numbers are the measured ones', async () => {
    const h = harness();
    const st = await R.runOneAtATime(h.deps, plan, CFG);
    expect(st.error).toBeNull();
    expect(st.partial).toBe(false);
    expect(st.baselines.length).toBe(2);
    expect(st.plugins.map(p => p.name)).toEqual(['A', 'B']);
    expect(st.plugins[0].heap).toEqual([360, 360, 360]);
    expect(st.baselines[0].ws).toEqual([1000, 1000, 1000]);
    const sum = R.summarize(st);
    expect(sum.rows[0]).toMatchObject({ name: 'A', heapDelta: 40, wsDelta: 90, sig: true });
    expect(st.skipped).toEqual(plan.skipped);
    // everything is on again, nothing is recorded as pending, and the last thing done was the baseline (no extra reload)
    expect(h.state.off.size).toBe(0);
    expect(h.state.persisted).toEqual([]);
    expect(h.log.filter(e => e[0] === 'reload').length).toBe(4);
  });

  it('writes the plugin down BEFORE switching it off, and only one is ever off', async () => {
    const h = harness();
    await R.runOneAtATime(h.deps, plan, CFG);
    const seq = h.log.filter(e => e[0] === 'persist' || e[0] === 'set').map(e => e[0] === 'persist' ? 'persist:' + e[1].join(',') : 'set:' + e[1] + ':' + e[2]);
    expect(seq).toEqual(['persist:A', 'set:A:false', 'set:A:true', 'persist:', 'persist:B', 'set:B:false', 'set:B:true', 'persist:', 'persist:']);
    for (const e of h.log) if (e[0] === 'reload') expect(e[1].length).toBeLessThanOrEqual(1);
  });

  it('the page is reloaded after the plugin is off and before it is read', async () => {
    const h = harness();
    await R.runOneAtATime(h.deps, { chosen: ['A'], skipped: [] }, CFG);
    const i = h.log.findIndex(e => e[0] === 'set' && e[2] === false);
    expect(h.log[i + 1]).toEqual(['reload', ['A']]);
    expect(h.log[i + 2][0]).toBe('sample');
    expect(h.log[i + 2][1]).toBe('A');
  });

  it('an error in the middle still puts the plugin back and reloads Discord with everything on', async () => {
    const h = harness({ sampleFails: (off) => off === 'B' });
    const st = await R.runOneAtATime(h.deps, plan, CFG);
    expect(st.error.message).toMatch(/heap unreadable/);
    expect(st.partial).toBe(true);
    expect(st.plugins.map(p => p.name)).toEqual(['A']);
    expect(h.state.off.size).toBe(0);
    expect(h.state.persisted).toEqual([]);
    const last = h.log[h.log.length - 1];
    expect(last).toEqual(['reload', []]);
  });

  it('Stop (or closing the window) in the middle restores and reloads, with the partial result kept', async () => {
    const h = harness({ cancelWhen: (log) => log.filter(e => e[0] === 'sample').length >= 5 });
    const st = await R.runOneAtATime(h.deps, plan, CFG);
    expect(st.partial).toBe(true);
    expect(st.error).toBeNull();
    expect(h.state.off.size).toBe(0);
    expect(h.state.persisted).toEqual([]);
    expect(h.log[h.log.length - 1]).toEqual(['reload', []]);
  });

  it('cancelled before the first step changes nothing', async () => {
    const h = harness({ cancelWhen: () => true });
    const st = await R.runOneAtATime(h.deps, plan, CFG);
    expect(st.partial).toBe(true);
    expect(h.log.filter(e => e[0] === 'set')).toEqual([]);
    expect(h.log.filter(e => e[0] === 'reload')).toEqual([]);
  });

  it('a plugin that cannot be switched back on stays recorded for the next start, and Discord is not reloaded over it', async () => {
    const h = harness({ setFails: (name, on) => name === 'A' && on === true });
    const st = await R.runOneAtATime(h.deps, plan, CFG);
    expect(st.restoreError.message).toMatch(/cannot switch A/);
    expect(h.state.persisted).toEqual(['A']);
    expect(h.state.off.has('A')).toBe(true);
    expect(h.log.filter(e => e[0] === 'reload').length).toBe(2);
  });

  it('a switch-off that fails is an error, and the name written down is taken off the record', async () => {
    const h = harness({ setFails: (name, on) => name === 'A' && on === false });
    const st = await R.runOneAtATime(h.deps, plan, CFG);
    expect(st.error.message).toMatch(/cannot switch A/);
    expect(h.state.persisted).toEqual([]);
    expect(h.state.off.size).toBe(0);
  });

  it('waits while Discord is open or in a call, and gives up (with a restore) after too long', async () => {
    const h = harness();
    h.state.guardWhy = 'You are in a call';
    const st = await R.runOneAtATime(h.deps, plan, CFG);
    expect(st.error.message).toMatch(/Stopped: You are in a call for too long/);
    expect(h.log.filter(e => e[0] === 'set')).toEqual([]);
    expect(h.deps.say).toHaveBeenCalledWith('Waiting: You are in a call');
    // a call that ends lets the run go on
    const g = harness();
    let n = 0;
    g.deps.guard = vi.fn(async () => (n++ < 2 ? 'Discord is open' : null));
    const ok = await R.runOneAtATime(g.deps, { chosen: ['A'], skipped: [] }, CFG);
    expect(ok.error).toBeNull();
    expect(ok.plugins.length).toBe(1);
  });

  it('a failed reload is an error and still restores', async () => {
    let calls = 0;
    const h = harness({ reloadFails: () => ++calls === 2 });
    const st = await R.runOneAtATime(h.deps, plan, CFG);
    expect(st.error.message).toMatch(/reload failed/);
    expect(h.state.off.size).toBe(0);
    expect(h.state.persisted).toEqual([]);
  });
});

// ---- put back at the next start ---------------------------------------------------------------------------------------------
describe('pending restore', () => {
  beforeEach(() => {
    window.showToast = vi.fn();
    DiscordMemory.refresh = vi.fn();
    DiscordMemory.reasonToWait = vi.fn(async () => null);
  });
  it('care() keeps a clean list of names', () => {
    expect(DiscordMemory.care().pluginPending).toEqual([]);
    localStorage.setItem('vex.discordCare', JSON.stringify({ pluginPending: ['A', 5, 'B', 'x'.repeat(65)] }));
    expect(DiscordMemory.care().pluginPending).toEqual(['A', 'B']);
    DiscordMemory._saveCare({ auto: true });
    expect(DiscordMemory.care().pluginPending).toEqual(['A', 'B']);
  });
  it('switches them back on, clears the record, and reloads Discord only when that costs nothing', async () => {
    localStorage.setItem('vex.discordCare', JSON.stringify({ pluginPending: ['A', 'B'] }));
    const set = [];
    DiscordMemory.webview = () => ({});
    window.vexGuestEval = vi.fn(async (wv, code) => { set.push(code); return { enabled: true }; });
    expect(await R.restorePending()).toBe(true);
    expect(set.length).toBe(2);
    expect(set[0]).toContain('"A"');
    expect(DiscordMemory.care().pluginPending).toEqual([]);
    expect(DiscordMemory.refresh).toHaveBeenCalledTimes(1);
    DiscordMemory.reasonToWait = vi.fn(async () => 'You are in a call');
    localStorage.setItem('vex.discordCare', JSON.stringify({ pluginPending: ['A'] }));
    await R.restorePending();
    expect(DiscordMemory.refresh).toHaveBeenCalledTimes(1);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Reload Discord/));
  });
  it('waits (false) while Discord is not loaded, and keeps the record when switching fails', async () => {
    localStorage.setItem('vex.discordCare', JSON.stringify({ pluginPending: ['A'] }));
    DiscordMemory.webview = () => null;
    expect(await R.restorePending()).toBe(false);
    DiscordMemory.webview = () => ({});
    window.vexGuestEval = vi.fn(async () => { throw new Error('Vencord has no saved settings for A'); });
    await expect(R.restorePending()).rejects.toThrow(/no saved settings/);
    expect(DiscordMemory.care().pluginPending).toEqual(['A']);
  });
  it('watchPending starts a background job only when something is pending, and the job stops itself when done', async () => {
    const jobs = [];
    globalThis.VexJobs = { every: vi.fn((name, ms, fn, opts) => { const j = { name, ms, fn, opts, stopped: false, stop() { j.stopped = true; } }; jobs.push(j); return j; }) };
    expect(R.watchPending()).toBe(false);
    localStorage.setItem('vex.discordCare', JSON.stringify({ pluginPending: ['A'] }));
    DiscordMemory.webview = () => ({});
    window.vexGuestEval = vi.fn(async () => ({ enabled: true }));
    expect(R.watchPending()).toBe(true);
    expect(jobs[0]).toMatchObject({ name: 'Discord plugin restore', ms: 20000, opts: { when: 'background', feature: 'discord-memory-care' } });
    await jobs[0].fn();
    expect(jobs[0].stopped).toBe(true);
    expect(DiscordMemory.care().pluginPending).toEqual([]);
  });
});

// ---- the report and the window ----------------------------------------------------------------------------------------------
describe('in the "Why is Discord big?" report and the measure window', () => {
  it('buildReport adds the Plugin memory section when there are results', () => {
    const d = { problems: [], mode: 'panel', pid: 1, wsMB: 1500, privMB: 1400, sharedWith: 0, cpu: 1, heap: { usedMB: 500, totalMB: 600, limitMB: 4000 }, domNodes: 100, plugins: { heavy: [], enabled: 10 },
      spoofed: false, keepAwake: null, throttled: null, lite: true, extensions: [], limit: null, vencord: null, profiler: null, care: null, restFn: null,
      pluginRam: { fast: { at: 1, windowMs: 60000, windowSec: 60, heap: { beforeMB: 1, afterMB: 2, totalMB: 3 }, map: { status: 'ok' }, plugins: [{ name: 'Alpha', kb: 3072, selfKB: 1 }], coreKB: 0, otherKB: 0, totalKB: 3072 }, slow: null, profiler: { rows: [{ name: 'Alpha', totalMs: 99 }] } } };
    const t = DiscordMemory.buildReport(d);
    expect(t).toMatch(/Plugin memory \(what each Vencord plugin costs/);
    expect(t).toMatch(/Alpha\s+3 MB/);
    expect(t).toMatch(/99 ms/);
    d.pluginRam = null;
    expect(DiscordMemory.buildReport(d)).not.toMatch(/Plugin memory \(/);
  });

  it('collect() reads the plugin results for the report', async () => {
    DiscordMemory.webview = () => null;
    const d = await DiscordMemory.collect();
    expect(d.pluginRam).toBeNull();                       // no Discord: nothing to measure, and no throw
  });

  it('the Settings buttons and the Ctrl+K command exist', () => {
    const fs = require('fs'), path = require('path');
    const mem = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/discord-memory.js'), 'utf8');
    expect(mem).toMatch(/data-plugin-ram>Measure plugin memory</);
    expect(mem).toMatch(/data-plugin-ram-one>One at a time\.\.\.</);
    const cmd = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/command.js'), 'utf8');
    expect(cmd).toMatch(/id: 'discord-plugin-ram'/);
    const html = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8');
    expect(html.indexOf('js/discord-plugin-ram.js')).toBeGreaterThan(html.indexOf('js/discord-measure.js'));
  });

  it('DiscordMeasure.open({ plugins: true }) picks, confirms with a time estimate, runs, and puts every plugin back', async () => {
    const state = { enabled: { MessageLoggerEnhanced: true, WhoReacted: true, Alpha: true } };
    const wv = { getWebContentsId: () => 11, isCurrentlyAudible: () => false };
    DiscordMemory.webview = () => wv;
    DiscordMemory.reasonToWait = vi.fn(async () => null);
    DiscordMemory.refresh = vi.fn();
    DiscordMemory.sizeMB = vi.fn(async () => 1000);
    window.showToast = vi.fn();
    window.vex = { discordHeapUsage: vi.fn(async () => ({ usedMB: 400, totalMB: 500 })) };
    window.vexGuestEval = vi.fn(async (w, code) => {
      if (code === R.LIST_CODE) return { via: 'api', rows: Object.keys(state.enabled).map(n => ({ name: n, enabled: state.enabled[n], canDisable: true, reason: '' })) };
      const m = /\)\(("[^"]+"), (true|false)\)$/.exec(code);
      if (m) { state.enabled[JSON.parse(m[1])] = m[2] === 'true'; return { name: JSON.parse(m[1]), enabled: m[2] === 'true' }; }
      return true;                                         // the "Vencord is loaded" probe
    });
    window.vexConfirm = vi.fn(async () => true);
    // no real waiting
    R._wait = () => Promise.resolve();
    const origRun = R.runOneAtATime.bind(R);
    R.runOneAtATime = (deps, plan, cfg) => origRun(deps, plan, { ...cfg, settleMs: 0, gapMs: 0 });
    const p = DiscordMeasure.open({ plugins: true });
    await vi.waitFor(() => expect(document.querySelector('#vex-discord-measure input[type=checkbox]')).not.toBeNull());
    const boxes = [...document.querySelectorAll('#vex-discord-measure input[type=checkbox]')];
    expect(boxes.map(b => b.value)).toEqual(['MessageLoggerEnhanced', 'WhoReacted', 'Alpha']);   // heavy first
    boxes[2].checked = false;
    boxes[2].dispatchEvent(new Event('change'));
    const go = [...document.querySelectorAll('#vex-discord-measure button')].find(b => b.textContent === 'Continue');
    go.click();
    const results = await p;
    R.runOneAtATime = origRun;
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/about 20 minutes \(4 fresh Discord pages/);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/put back/);
    expect(state.enabled).toEqual({ MessageLoggerEnhanced: true, WhoReacted: true, Alpha: true });
    expect(DiscordMemory.care().pluginPending).toEqual([]);
    expect(R.last.slow.plugins.map(x => x.name)).toEqual(['MessageLoggerEnhanced', 'WhoReacted']);
    expect(results.join('\n')).toMatch(/Plugin memory \(/);
  });
});
