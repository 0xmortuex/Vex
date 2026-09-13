// Main-process reminders: the timer, the store, the toast and the OS task.
//
// Everything is injected — a fake clock, fake timers, a fake notifier and a
// fake OS scheduler — so every case is deterministic and none of it touches
// Windows. The properties that matter: fires on time, fires once, survives a
// restart, reports a refused toast instead of losing it, and tells the caller
// when the OS task could not be made.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createReminders, CHECK_MS, MIN_LEAD_MS } = req('../../src/main/reminders.js');
const { JsonStore } = req('../../src/main/file-store.js');

const dirs = [];
async function tmpdir() { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-rem-')); dirs.push(d); return d; }
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });

// A controllable clock and timer set. Advancing the clock runs any timers due.
function fakeTime(start) {
  let t = start;
  const timers = new Map(); let seq = 0;
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at; timers.delete(due[0]);
        await due[1].fn();
        // let any chained promises settle before the next timer
        await new Promise(r => setImmediate(r));
      }
      t = target;
    },
  };
}

function fakeNotifier({ fail } = {}) {
  const shown = [];
  return {
    shown,
    show: async (o) => { if (fail) throw new Error(fail); shown.push(o); return { ok: true }; },
  };
}

function fakeOs({ supported = true, failRegister = null } = {}) {
  const calls = { register: [], unregister: [] };
  return {
    calls, supported,
    register: async (id, at) => { calls.register.push([id, at]); if (failRegister) throw new Error(failRegister); return 'next-run'; },
    unregister: async (id) => { calls.unregister.push(id); return 'removed'; },
  };
}

const T0 = new Date(2026, 8, 13, 14, 30).getTime();

async function make(opts = {}) {
  const dir = opts.dir || await tmpdir();
  const time = opts.time || fakeTime(T0);
  const notifier = opts.notifier || fakeNotifier();
  const osS = opts.os === null ? undefined : (opts.os || fakeOs());
  const fired = [];
  const r = createReminders({
    store: new JsonStore(dir), notifier, osScheduler: osS,
    now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    onFired: (p) => fired.push(p),
  });
  await r.init();
  return { r, dir, time, notifier, os: osS, fired };
}

describe('creating', () => {
  it('stores a reminder to the minute and registers the OS task', async () => {
    const { r, os, dir } = await make();
    const at = T0 + 2 * 3600 * 1000 + 45 * 1000; // two hours and 45 seconds
    const made = await r.create({ message: 'Call the dentist', at });
    expect(made.at).toBe(T0 + 2 * 3600 * 1000);            // seconds dropped
    expect(made.os).toEqual({ scheduled: true, error: null });
    expect(os.calls.register).toHaveLength(1);
    expect(os.calls.register[0][0]).toBe(made.id);
    expect(os.calls.register[0][1].getTime()).toBe(made.at);
    // On disk, not just in memory.
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'reminders.json'), 'utf8'));
    expect(raw.data).toHaveLength(1);
    expect(raw.data[0].message).toBe('Call the dentist');
  });

  it('refuses an empty message, a non-time, and anything under a minute away', async () => {
    const { r } = await make();
    await expect(r.create({ message: '  ', at: T0 + 3600000 })).rejects.toThrow(/write what/i);
    await expect(r.create({ message: 'x', at: 'soon' })).rejects.toThrow(/not a real time/i);
    await expect(r.create({ message: 'x', at: T0 + MIN_LEAD_MS - 1 })).rejects.toThrow(/at least a minute/i);
    expect(await r.list()).toEqual([]);
  });

  it('keeps the reminder and reports it when the OS task cannot be made', async () => {
    const { r } = await make({ os: fakeOs({ failRegister: 'Access is denied' }) });
    const made = await r.create({ message: 'x', at: T0 + 3600000 });
    expect(made.os).toEqual({ scheduled: false, error: 'Access is denied' });
    expect((await r.list())[0].os.error).toBe('Access is denied');
  });

  it('says plainly when the platform cannot wake Vex', async () => {
    const { r } = await make({ os: fakeOs({ supported: false }) });
    const made = await r.create({ message: 'x', at: T0 + 3600000 });
    expect(made.os.scheduled).toBe(false);
    expect(made.os.error).toMatch(/only windows/i);
  });
});

describe('firing', () => {
  it('fires at the minute, once, and removes the OS task', async () => {
    const { r, time, notifier, os, fired } = await make();
    const at = T0 + 30 * 60 * 1000;
    const made = await r.create({ message: 'Stand up', at });

    await time.advance(29 * 60 * 1000);
    expect(notifier.shown).toHaveLength(0);

    await time.advance(60 * 1000);
    expect(notifier.shown).toHaveLength(1);
    expect(notifier.shown[0]).toMatchObject({ title: 'Reminder', body: 'Stand up', tag: made.id });
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ id: made.id, delivered: 'toast', late: false, error: null });
    expect(os.calls.unregister).toEqual([made.id]);

    // Another hour of ticking must not show it again.
    await time.advance(60 * 60 * 1000);
    expect(notifier.shown).toHaveLength(1);
    expect((await r.list())[0].firedAt).toBe(at);
  });

  it('fires several in order when they fall due together', async () => {
    const { r, time, notifier } = await make();
    await r.create({ message: 'second', at: T0 + 10 * 60000 });
    await r.create({ message: 'first', at: T0 + 5 * 60000 });
    await time.advance(15 * 60000);
    expect(notifier.shown.map(s => s.body)).toEqual(['first', 'second']);
  });

  it('records a refused toast and reports it, rather than retrying forever or losing it', async () => {
    const { r, time, notifier, fired } = await make({ notifier: fakeNotifier({ fail: 'Windows refused the notification: toasts are off' }) });
    const made = await r.create({ message: 'x', at: T0 + 2 * 60000 });
    await time.advance(3 * 60000);
    expect(notifier.shown).toHaveLength(0);
    const [item] = await r.list();
    expect(item.firedAt).toBe(made.at);
    expect(item.delivered).toBe('failed');
    expect(item.error).toMatch(/toasts are off/);
    expect(fired[0]).toMatchObject({ delivered: 'failed', error: expect.stringMatching(/toasts are off/) });
    // And it stays fired: no second attempt.
    await time.advance(60 * 60000);
    expect(fired).toHaveLength(1);
  });
});

describe('a restart', () => {
  it('fires what fell due while Vex was closed, marked late with the time it was due', async () => {
    const dir = await tmpdir();
    const first = await make({ dir });
    await first.r.create({ message: 'Take the bins out', at: T0 + 10 * 60000 });
    first.r.stop();

    // Vex comes back an hour later.
    const later = fakeTime(T0 + 70 * 60000);
    const second = await make({ dir, time: later });
    expect(second.notifier.shown).toHaveLength(1);
    expect(second.notifier.shown[0].body).toBe('Due 14:40 — Take the bins out');
    expect(second.fired[0].late).toBe(true);
  });

  it('does not fire again what already fired before the restart', async () => {
    const dir = await tmpdir();
    const first = await make({ dir });
    await first.r.create({ message: 'x', at: T0 + 2 * 60000 });
    await first.time.advance(3 * 60000);
    expect(first.notifier.shown).toHaveLength(1);
    first.r.stop();

    const second = await make({ dir, time: fakeTime(T0 + 10 * 60000) });
    expect(second.notifier.shown).toHaveLength(0);
  });

  it('re-arms the timer for reminders still ahead', async () => {
    const dir = await tmpdir();
    const first = await make({ dir });
    await first.r.create({ message: 'x', at: T0 + 3 * 3600000 });
    first.r.stop();

    const later = fakeTime(T0 + 3600000);
    const second = await make({ dir, time: later });
    expect(second.time.pending()).toBe(1);
    await later.advance(2 * 3600000);
    expect(second.notifier.shown).toHaveLength(1);
  });

  it('forgets fired reminders after a week, keeps recent ones for the list', async () => {
    const dir = await tmpdir();
    const first = await make({ dir });
    await first.r.create({ message: 'old', at: T0 + 60000 });
    await first.time.advance(2 * 60000);
    first.r.stop();

    const second = await make({ dir, time: fakeTime(T0 + 8 * 24 * 3600000) });
    expect(await second.r.list()).toEqual([]);
  });
});

describe('deleting', () => {
  it('removes the reminder and its OS task', async () => {
    const { r, os, time, notifier } = await make();
    const made = await r.create({ message: 'x', at: T0 + 5 * 60000 });
    expect(await r.delete(made.id)).toEqual({ ok: true, osError: null });
    expect(os.calls.unregister).toEqual([made.id]);
    expect(await r.list()).toEqual([]);
    await time.advance(10 * 60000);
    expect(notifier.shown).toHaveLength(0);
  });

  it('says so when the reminder is already gone', async () => {
    const { r } = await make();
    await expect(r.delete('nope')).rejects.toThrow(/no longer exists/i);
  });
});

describe('the safety net', () => {
  it('never waits longer than one check interval, so a clock jump is caught', async () => {
    const { r, time, notifier } = await make();
    await r.create({ message: 'x', at: T0 + 6 * 3600000 });
    // A timer aimed six hours out is capped at CHECK_MS and re-armed each time.
    expect(time.pending()).toBe(1);
    await time.advance(CHECK_MS);
    expect(time.pending()).toBe(1);
    expect(notifier.shown).toHaveLength(0);
    // Still exact at the end: fires on the minute it was set for.
    await time.advance(6 * 3600000 - CHECK_MS);
    expect(notifier.shown).toHaveLength(1);
  });
});
