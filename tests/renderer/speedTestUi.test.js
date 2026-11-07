// @vitest-environment jsdom
// The speed test's window side (js/speed-test.js): the pure text parts and the order of the steps, with fakes for main.
import { describe, it, expect, vi, afterEach } from 'vitest';
const { VexSpeedTest: T } = require('../../src/renderer/js/speed-test.js');
const { VexDeviceCheck: D } = require('../../src/renderer/js/device-check.js');

afterEach(() => { vi.restoreAllMocks(); delete window.vex; delete window.vexAlert; delete globalThis.VexDeviceCheck; T._busy = false; });

describe('text parts', () => {
  it('formats the speed with one decimal under 100 and none above', () => {
    expect(T.formatMbps(8)).toBe('8.0');
    expect(T.formatMbps(94.26)).toBe('94.3');
    expect(T.formatMbps(250.4)).toBe('250');
    expect(() => T.formatMbps(NaN)).toThrow();
  });
  it('describes the speed in four steps', () => {
    expect(T.describe(1)).toMatch(/^Slow/);
    expect(T.describe(5)).toMatch(/^Fine/);
    expect(T.describe(20)).toMatch(/^Good/);
    expect(T.describe(80)).toMatch(/^Fast/);
  });
  it('writes the summary with latency, or says there was no answer', () => {
    expect(T.summary(94.26, 12.4).split('\n').slice(0, 2)).toEqual(['Download speed: 94.3 Mbps', 'Latency: 12 ms']);
    expect(T.summary(5, null)).toContain('Latency: no answer');
  });
});

describe('the shared latency reading', () => {
  it('takes the lowest baseline time, ignores services and failures, and throws on a failed check', () => {
    const res = { ok: true, results: [{ baseline: true, ms: 30 }, { baseline: true, ms: 12 }, { baseline: false, ms: 3 }, { baseline: true, ms: null }] };
    expect(D.lowestBaselineMs(res)).toBe(12);
    expect(D.lowestBaselineMs({ ok: true, results: [] })).toBeUndefined();
    expect(() => D.lowestBaselineMs({ ok: false, error: 'nope' })).toThrow('nope');
    expect(() => D.lowestBaselineMs(null)).toThrow();
  });
});

describe('run', () => {
  it('measures latency, then speed, then shows both in a dialog', async () => {
    const order = [];
    globalThis.VexDeviceCheck = D;
    window.vex = {
      netLatency: async () => { order.push('latency'); return { ok: true, results: [{ baseline: true, ms: 20 }] }; },
      speedTestRun: async () => { order.push('speed'); return { ok: true, mbps: 50, bytes: 9, ms: 1 }; },
    };
    window.vexAlert = vi.fn(async () => { order.push('dialog'); });
    const r = await T.run();
    expect(order).toEqual(['latency', 'speed', 'dialog']);
    expect(r).toEqual({ mbps: 50, latencyMs: 20 });
    expect(window.vexAlert.mock.calls[0][0].message).toContain('Download speed: 50.0 Mbps');
    expect(T._busy).toBe(false);
  });
  it('throws the reason from main when the test fails, and can be run again', async () => {
    globalThis.VexDeviceCheck = D;
    window.vex = { netLatency: async () => ({ ok: true, results: [] }), speedTestRun: async () => ({ ok: false, error: 'The speed test server answered 503' }) };
    await expect(T.run()).rejects.toThrow('503');
    expect(T._busy).toBe(false);
  });
  it('refuses to run in a window without the bridge', async () => {
    delete window.vex;
    await expect(T.run()).rejects.toThrow(/not available/);
  });
});
