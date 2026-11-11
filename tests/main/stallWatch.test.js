// Audit A9: nothing watched the main process. src/main/stall-watch.js writes a stall of over two seconds,
// with the last IPC channel, to the crash log: rate-limited, and quiet right after a sleep.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { createStallWatch, noteIpc, lastIpc, noteIpcRun, slowestRun, forgetRuns, featureOf, SLOW_RUN_MS } = require('../../src/main/stall-watch.js');

function rig(extra = {}) {
  let t = 1_000_000;
  const state = { maxNs: 0, resets: 0, enabled: false, timers: [] };
  const hist = { get max() { return state.maxNs; }, reset() { state.resets++; state.maxNs = 0; }, enable() { state.enabled = true; }, disable() { state.enabled = false; } };
  const added = [];
  const w = createStallWatch({
    perf: { monitorEventLoopDelay: (o) => { state.opts = o; return hist; } },
    crashLog: { add: (k, d) => { added.push([k, d]); return true; } },
    now: () => t, setTimer: (fn, ms) => { state.timers.push(ms); return { unref() { state.unref = true; } }; }, clearTimer: () => {}, log: () => {}, ...extra,
  });
  return { w, state, added, stall: (ms) => { state.maxNs = ms * 1e6; }, advance: (ms) => { t += ms; } };
}

describe('stall watch', () => {
  it('writes a stall over two seconds with the last IPC channel and its feature', () => {
    const r = rig();
    r.w.start();
    noteIpc('settings:save', 1_000_000);
    r.advance(1500);
    r.stall(2600);
    expect(r.w.check()).toBe(true);
    expect(r.added).toHaveLength(1);
    expect(r.added[0][0]).toBe('Main process stalled');
    expect(r.added[0][1]).toMatch(/about 2\.6 s/);
    expect(r.added[0][1]).toMatch(/last IPC "settings:save" 2 s ago/);
    expect(r.added[0][1]).toMatch(/feature settings/);
  });
  it('writes nothing for a short delay, and resets the histogram each look', () => {
    const r = rig();
    r.w.start();
    r.stall(1200);
    expect(r.w.check()).toBe(false);
    expect(r.state.resets).toBe(1);
    expect(r.added).toEqual([]);
  });
  it('is cheap: a coarse sample, a slow check, both unref\'d, nothing until started', () => {
    const r = rig();
    expect(r.state.enabled).toBe(false);
    r.w.start();
    expect(r.state.opts.resolution).toBeGreaterThanOrEqual(50);
    expect(r.state.timers[0]).toBeGreaterThanOrEqual(1000);
    expect(r.state.unref).toBe(true);
    r.w.stop();
    expect(r.state.enabled).toBe(false);
  });
  it('a stall storm writes one line a minute and says how many it held back', () => {
    const r = rig();
    r.w.start();
    for (let i = 0; i < 5; i++) { r.stall(3000); r.w.check(); r.advance(2000); }
    expect(r.added).toHaveLength(1);
    r.advance(60000);
    r.stall(3000); r.w.check();
    expect(r.added).toHaveLength(2);
    expect(r.added[1][1]).toMatch(/4 more stalls not written/);
  });
  it('writes at most ten a session', () => {
    const r = rig();
    r.w.start();
    for (let i = 0; i < 30; i++) { r.stall(3000); r.w.check(); r.advance(61000); }
    expect(r.added).toHaveLength(10);
  });
  it('a stall right after resuming from sleep is the machine, not Vex', () => {
    const r = rig();
    r.w.start();
    r.w.markResumed();
    r.advance(5000);
    r.stall(40000);
    expect(r.w.check()).toBe(false);
    expect(r.added).toEqual([]);
    r.advance(40000);
    r.stall(3000);
    expect(r.w.check()).toBe(true);
  });
  it('uses an active feature when one is known', () => {
    const r = rig({ activeFeature: () => 'downloads' });
    r.w.start(); r.stall(2500); r.w.check();
    expect(r.added[0][1]).toMatch(/feature downloads/);
  });
  it('needs perf_hooks and a crash log', () => {
    expect(() => createStallWatch({ crashLog: { add() {} } })).toThrow();
    expect(() => createStallWatch({ perf: { monitorEventLoopDelay() {} } })).toThrow();
  });
  it('names the feature from the channel and records no payload', () => {
    expect(featureOf('tab-memory:read')).toBe('tab-memory');
    expect(featureOf('storage-save')).toBe('storage-save');
    noteIpc('a:b');
    expect(Object.keys(lastIpc()).sort()).toEqual(['at', 'channel']);
  });
});

// Found 2026-11-11: "last IPC" is only the last message handled before a freeze. Four lines in a real crash log
// named persist-apply, whose handler takes 10 ms. The handlers are timed, and a line names the one that held the
// event loop longest when it held it for a quarter of a second or more.
describe('naming the handler that held the event loop', () => {
  it('a stall line names the handler that ran longest, ahead of the last IPC, and takes its feature', () => {
    forgetRuns();
    const r = rig();
    r.w.start();
    noteIpcRun('journal:diff', 3100, 1_000_500);
    noteIpcRun('tabs:favicon', 400, 1_000_600);
    noteIpc('persist-apply', 1_001_000);
    r.advance(3500);
    r.stall(3300);
    expect(r.w.check()).toBe(true);
    expect(r.added[0][1]).toBe('blocked for about 3.3 s; the handler of "journal:diff" ran for 3.1 s without a pause; last IPC "persist-apply" 3 s ago; feature journal');
  });
  it('says nothing about handlers when none was slow, and forgets a slow one that belonged to no stall', () => {
    forgetRuns();
    const r = rig();
    r.w.start();
    noteIpcRun('tabs:favicon', SLOW_RUN_MS - 1);
    expect(slowestRun().channel).toBe('');
    noteIpcRun('vault:list', 900);
    expect(slowestRun()).toMatchObject({ channel: 'vault:list', ms: 900 });
    r.stall(1200);                       // under the threshold: no stall
    expect(r.w.check()).toBe(false);
    expect(slowestRun().channel).toBe('');
    noteIpc('settings:save', 1_000_000);
    r.stall(2400);
    expect(r.w.check()).toBe(true);
    expect(r.added[0][1]).not.toMatch(/handler of/);
  });
  it('the IPC policy times both kinds of handler, and a handler that throws is still timed', async () => {
    forgetRuns();
    const { installIpcPolicy } = require('../../src/main/ipc-policy.js');
    const handlers = new Map(), listeners = new Map();
    const ipcMain = { handle: (c, f) => handlers.set(c, f), on: (c, f) => listeners.set(c, f) };
    installIpcPolicy(ipcMain, { isUiFrame: () => true, owner: () => ({ id: 1 }), isAuxiliary: () => false, ownsTarget: () => true });
    const burn = (ms) => { const until = Date.now() + ms; while (Date.now() < until) { /* hold the event loop */ } };
    ipcMain.handle('journal:stats', async () => { burn(SLOW_RUN_MS + 30); await null; return 'ok'; });
    const event = { sender: {}, senderFrame: { url: 'file:///index.html' } };
    expect(await handlers.get('journal:stats')(event)).toBe('ok');
    expect(slowestRun().channel).toBe('journal:stats');
    expect(slowestRun().ms).toBeGreaterThanOrEqual(SLOW_RUN_MS);
    forgetRuns();
    ipcMain.handle('journal:forget', () => { burn(SLOW_RUN_MS + 30); throw new Error('boom'); });
    await expect(handlers.get('journal:forget')(event)).rejects.toThrow('boom');
    expect(slowestRun().channel).toBe('journal:forget');
  });
});

describe('wiring', () => {
  it('the IPC policy notes every handled channel and main starts the watch after ready', () => {
    const pol = fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    expect((pol.match(/noteIpc\(channel\)/g) || []).length).toBe(2);
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toMatch(/createStallWatch\(\{ perf: require\('perf_hooks'\), crashLog: _crashLog/);
    expect(main).toMatch(/_stallWatch\.start\(\)/);
  });
});
