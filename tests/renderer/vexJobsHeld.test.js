// @vitest-environment jsdom
//
// Held jobs used to count when VexJobs chose its next wake-up, so through a
// whole game (or with Vex minimised) the one timer still fired every second
// just to hold the zoom indicator again. A held job waits for resume(), which
// the end of a game and the window showing again both call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { VexJobs } = require('../../src/renderer/js/jobs.js');

let hidden;
beforeEach(() => {
  vi.useFakeTimers();
  VexJobs._jobs.clear();
  if (VexJobs._tick) clearTimeout(VexJobs._tick);
  VexJobs._tick = null;
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  globalThis.GameMode = { gaming: false };
  window.VexProblems = { note: vi.fn() };
});
afterEach(() => { if (VexJobs._tick) clearTimeout(VexJobs._tick); VexJobs._tick = null; vi.useRealTimers(); });

describe('while gaming or hidden', () => {
  it('does not wake Vex every second during a game just to hold UI jobs', () => {
    GameMode.gaming = true;
    const fn = vi.fn();
    VexJobs.every('Zoom indicator', 1000, fn);
    VexJobs.every('Site icon', 1500, fn);
    const spy = vi.spyOn(VexJobs, 'tick');
    vi.advanceTimersByTime(30000);
    expect(fn).not.toHaveBeenCalled();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('stops waking once Vex is hidden, after at most one held tick', () => {
    const fn = vi.fn();
    VexJobs.every('ui', 1000, fn);
    hidden = true;
    const spy = vi.spyOn(VexJobs, 'tick');
    vi.advanceTimersByTime(60000);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a held job runs once when the game ends, and the timer starts again', () => {
    GameMode.gaming = true;
    const fn = vi.fn();
    VexJobs.every('ui', 1000, fn);
    vi.advanceTimersByTime(10000);
    expect(fn).not.toHaveBeenCalled();
    GameMode.gaming = false;
    VexJobs.resume();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a job that fell due while held but was never ticked still runs on resume', () => {
    hidden = true;
    const fn = vi.fn();
    VexJobs.every('ui', 1000, fn);      // armed nothing: held from the start
    expect(VexJobs._tick).toBe(null);
    vi.advanceTimersByTime(5000);
    hidden = false;
    VexJobs.resume();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('background jobs keep their timer while Vex is only hidden', () => {
    hidden = true;
    const fn = vi.fn();
    VexJobs.every('bg', 1000, fn, { when: 'background' });
    VexJobs.every('ui', 1000, vi.fn());
    vi.advanceTimersByTime(3500);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
