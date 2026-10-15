// @vitest-environment jsdom
//
// VexJobs records how long each job held the interface thread, for the tuning
// advisor (js/tuning-advisor-ui.js): the synchronous part only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { VexJobs } = require('../../src/renderer/js/jobs.js');

beforeEach(() => {
  VexJobs._jobs.clear();
  globalThis.GameMode = { gaming: false };
  window.VexProblems = { note: vi.fn() };
});
afterEach(() => { clearTimeout(VexJobs._tick); VexJobs._tick = null; });

describe('VexJobs timings', () => {
  it('counts the time a job ran for, per job, with a span since it was registered', () => {
    VexJobs.every('busy', 1000, () => { const end = performance.now() + 15; while (performance.now() < end) { /* hold the thread */ } });
    VexJobs.every('idle', 1000, () => {});
    const t0 = Date.now();
    VexJobs.tick(t0 + 1001);
    const t = Object.fromEntries(VexJobs.timings(t0 + 2000).map(x => [x.name, x]));
    expect(t.busy.runs).toBe(1);
    expect(t.busy.totalMs).toBeGreaterThanOrEqual(14);
    expect(t.busy.maxMs).toBe(t.busy.totalMs);
    expect(t.idle.totalMs).toBeLessThan(5);
    expect(t.busy.spanMs).toBeGreaterThan(1500);
  });

  it('does not count what an async job awaits', async () => {
    VexJobs.every('net', 1000, () => new Promise(r => setTimeout(r, 60)));
    VexJobs.tick(Date.now() + 1001);
    await new Promise(r => setTimeout(r, 80));
    expect(VexJobs.timings().find(x => x.name === 'net').totalMs).toBeLessThan(20);
  });
});
