// @vitest-environment jsdom
//
// One timer for Vex's periodic work: 'ui' jobs wait while Vex is hidden or a
// game runs, 'background' jobs only while a game runs, and a held job is owed
// one run, which it gets as soon as the reason goes away.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { VexJobs } = require('../../src/renderer/js/jobs.js');

let hidden;
beforeEach(() => {
  VexJobs._jobs.clear();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  globalThis.GameMode = { gaming: false };
  window.VexProblems = { note: vi.fn() };
});
afterEach(() => { clearInterval(VexJobs._tick); VexJobs._tick = null; });

describe('VexJobs', () => {
  it('runs a job when it is due, not before', () => {
    const fn = vi.fn();
    VexJobs.every('a', 5000, fn);
    const t0 = Date.now();
    VexJobs.tick(t0 + 4000); expect(fn).not.toHaveBeenCalled();
    VexJobs.tick(t0 + 5001); expect(fn).toHaveBeenCalledTimes(1);
  });

  it('holds a ui job while hidden and runs it once when Vex is shown again', () => {
    const fn = vi.fn();
    VexJobs.every('ui', 1000, fn);
    hidden = true;
    const t0 = Date.now();
    VexJobs.tick(t0 + 1500); VexJobs.tick(t0 + 3000); VexJobs.tick(t0 + 4500);
    expect(fn).not.toHaveBeenCalled();
    hidden = false;
    VexJobs.resume();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(VexJobs.lines()[0]).toContain('held back');
  });

  it('keeps a background job running while hidden, but holds it during a game', () => {
    const fn = vi.fn();
    VexJobs.every('bg', 1000, fn, { when: 'background' });
    hidden = true;
    const t0 = Date.now();
    VexJobs.tick(t0 + 1500); expect(fn).toHaveBeenCalledTimes(1);
    GameMode.gaming = true;
    VexJobs.tick(t0 + 3000); expect(fn).toHaveBeenCalledTimes(1);
    VexJobs.resume(); expect(fn).toHaveBeenCalledTimes(1);   // still gaming
    GameMode.gaming = false;
    VexJobs.resume(); expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not start a second run while the last async one is still going, and reports failures', async () => {
    let finish;
    const fn = vi.fn(() => new Promise((_, reject) => { finish = reject; }));
    VexJobs.every('slow', 1000, fn);
    const t0 = Date.now();
    VexJobs.tick(t0 + 1500); VexJobs.tick(t0 + 3000);
    expect(fn).toHaveBeenCalledTimes(1);
    finish(new Error('boom'));
    await Promise.resolve(); await Promise.resolve();
    expect(window.VexProblems.note).toHaveBeenCalledWith('Background job', 'slow failed', expect.any(Error));
    VexJobs.tick(t0 + 4500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('refuses a job it cannot run', () => {
    expect(() => VexJobs.every('x', 1000)).toThrow('has no function');
    expect(() => VexJobs.every('x', 0, () => {})).toThrow('needs an interval');
    expect(() => VexJobs.every('x', 1000, () => {}, { when: 'sometimes' })).toThrow('unknown kind');
  });
});
