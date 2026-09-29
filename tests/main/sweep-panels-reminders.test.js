// Panels sweep (2026-09-29): a hold per caller. Ending a focus session inside
// a meeting used to clear the meeting's hold as well.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createReminders } = req('../../src/main/reminders.js');
const { JsonStore } = req('../../src/main/file-store.js');

const dirs = [];
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });

function fakeTime(start) {
  let t = start; const timers = new Map(); let seq = 0;
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at; timers.delete(due[0]);
        await due[1].fn();
        await new Promise(r => setImmediate(r));
      }
      t = target;
    },
  };
}

const T0 = new Date(2026, 8, 13, 14, 30).getTime();

async function make() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-sweep-rem-')); dirs.push(dir);
  const time = fakeTime(T0); const shown = [];
  const r = createReminders({
    store: new JsonStore(dir), notifier: { show: async (o) => { shown.push(o); return { ok: true }; } },
    osScheduler: { supported: true, register: async () => 'next', unregister: async () => 'removed' },
    now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, onFired: () => {},
  });
  await r.init();
  return { r, time, shown };
}

describe('holds per caller', () => {
  it('ending focus inside a meeting keeps the meeting hold', async () => {
    const { r, time, shown } = await make();
    await r.create({ message: 'later', at: T0 + 2 * 60000 });
    expect(r.hold(T0 + 60 * 60000, 'meeting')).toBe(T0 + 60 * 60000);
    r.hold(T0 + 25 * 60000, 'focus');
    await time.advance(5 * 60000);
    expect(r.hold(0, 'focus')).toBe(T0 + 60 * 60000);   // the meeting still holds
    await r.flush();
    expect(shown).toHaveLength(0);
    expect(r.hold(0, 'meeting')).toBe(0);
    await r.flush();
    expect(shown).toHaveLength(1);
  });

  it('the effective hold is the latest one still running', async () => {
    const { r } = await make();
    r.hold(T0 + 10 * 60000, 'focus');
    expect(r.hold(T0 + 5 * 60000, 'meeting')).toBe(T0 + 10 * 60000);
    expect(r.hold(0, 'focus')).toBe(T0 + 5 * 60000);
  });

  it('a caller that says nothing is the focus session, as before', async () => {
    const { r } = await make();
    r.hold(T0 + 10 * 60000);
    expect(r.hold(0, 'focus')).toBe(0);
  });
});
