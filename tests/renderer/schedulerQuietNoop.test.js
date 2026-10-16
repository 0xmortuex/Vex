// @vitest-environment jsdom
//
// T3-097: a scheduled run that finds nothing to do is silent, not logged, and after 10 in a row the
// task is offered to be turned off (js/scheduler.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Scheduler from '../../src/renderer/js/scheduler.js';

let tabs, suggest;
beforeEach(() => {
  localStorage.clear();
  Scheduler._queue.length = 0; Scheduler._running.clear(); Scheduler._controllers.clear(); Scheduler._draining = false;
  window.showToast = vi.fn();
  tabs = [{ id: 'a', url: 'x' }];
  globalThis.TabManager = { tabs, sleepAllInactive: vi.fn(async () => { tabs.forEach((t, i) => { if (i > 0) t.sleeping = true; }); }) };
  suggest = vi.fn(() => true);
  globalThis.VexAttention = { suggest };
});
afterEach(() => { delete globalThis.TabManager; delete globalThis.VexAttention; vi.restoreAllMocks(); });

const make = () => Scheduler.createTask({ name: 'Free some memory', schedule: { type: 'interval', everyMinutes: 60 }, action: { type: 'sleepTabs' } });
const runScheduled = async (t) => { await Scheduler._execute(Scheduler.getTask(t.id), Date.now(), false); };

describe('quiet no-op schedules', () => {
  it('a scheduled run that slept nothing shows no toast and leaves no history line', async () => {
    const t = make();
    await runScheduled(t);
    expect(window.showToast).not.toHaveBeenCalled();
    expect(Scheduler.getHistory()).toEqual([]);
    const after = Scheduler.getTask(t.id);
    expect(after.runCount).toBe(1);
    expect(after.noopStreak).toBe(1);
    expect(after.lastRunResult).toBe('success');
  });

  it('a scheduled run that did something is announced and logged, and resets the streak', async () => {
    const t = make();
    await runScheduled(t);
    tabs.push({ id: 'b', url: 'y' });
    await runScheduled(t);
    expect(window.showToast.mock.calls.map(c => c[0]).join('|')).toMatch(/Scheduled: Free some memory — Put 1 tab to sleep/);
    expect(Scheduler.getHistory()).toHaveLength(1);
    expect(Scheduler.getTask(t.id).noopStreak).toBe(0);
  });

  it('a run you start yourself is always announced and logged', async () => {
    const t = make();
    const run = await Scheduler.runTask(t, true);
    expect(run.summary).toBe('Put 0 tabs to sleep');
    expect(Scheduler.getHistory()).toHaveLength(1);
    expect(window.showToast).toHaveBeenCalledWith('Running: Free some memory');
  });

  it('offers to turn the task off at the tenth no-op in a row, once', async () => {
    const t = make();
    for (let i = 0; i < 12; i++) await runScheduled(t);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'scheduler-noop', id: t.id, action: { key: 'off:' + t.id } });
    expect(suggest.mock.calls[0][0].title).toMatch(/10 times in a row/);
  });

  it('the inbox button turns the task off', () => {
    const t = make();
    let handler;
    globalThis.AttentionInbox = { handle: (f, fn) => { handler = fn; } };
    Scheduler._noopWired = false;
    Scheduler._wireNoop();
    handler('off:' + t.id);
    expect(Scheduler.getTask(t.id).enabled).toBe(false);
    expect(() => handler('off:missing')).toThrow(/gone/);
    delete globalThis.AttentionInbox;
  });

  it('other kinds of task keep announcing themselves', async () => {
    const t = Scheduler.createTask({ name: 'Remind', schedule: { type: 'interval', everyMinutes: 60 }, action: { type: 'reminder', message: 'hi' } });
    window.vex = { notify: vi.fn(async () => {}) };
    await runScheduled(t);
    expect(window.showToast.mock.calls.some(c => /Scheduled: Remind/.test(c[0]))).toBe(true);
    expect(Scheduler.getHistory()).toHaveLength(1);
  });
});
