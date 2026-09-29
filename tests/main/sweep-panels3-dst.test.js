// A daily reminder or alarm at 02:30 moved to 03:30 for good after the spring
// clock change (found 2026-09-29): each step kept whatever hour the last one
// landed on, and the skipped hour lands on 03:30. The zone is forced to New
// York BEFORE the module is loaded — Istanbul has no DST and would pass.
process.env.TZ = 'America/New_York';

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createReminders, nextRepeat } = req('../../src/main/reminders.js');
const { JsonStore } = req('../../src/main/file-store.js');

const dirs = [];
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });

// 2026: New York springs forward on Sun 8 March, 02:00 -> 03:00.
const hm = (ms) => { const d = new Date(ms); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };

describe('a repeat through the spring clock change', () => {
  it('nextRepeat puts the time it was set for back after the skipped hour', () => {
    let at = new Date(2026, 2, 7, 2, 30).getTime();
    const seen = [];
    for (let i = 0; i < 3; i++) { at = nextRepeat(at, 'daily', at, '02:30'); seen.push(new Date(at).getDate() + ' ' + hm(at)); }
    expect(seen).toEqual(['8 3:30', '9 2:30', '10 2:30']);
  });

  it('weekly and alarm-day repeats do the same', () => {
    const at = new Date(2026, 2, 1, 2, 30).getTime();   // Sunday
    const a = nextRepeat(at, 'weekly', at, '02:30');
    expect(hm(nextRepeat(a, 'weekly', a, '02:30'))).toBe('2:30');
    const b = nextRepeat(at, [0], at, '02:30');
    expect(hm(nextRepeat(b, [0], b, '02:30'))).toBe('2:30');
  });

  it('a reminder that fires on the change day is back at 02:30 the day after', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-dst-')); dirs.push(dir);
    let t = new Date(2026, 2, 7, 1, 0).getTime();
    const timers = new Map(); let seq = 0;
    const r = createReminders({
      store: new JsonStore(dir), notifier: { show: async () => ({ ok: true }) }, osScheduler: null,
      now: () => t, setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; }, clearTimeout: (id) => timers.delete(id),
    });
    await r.init();
    const made = await r.create({ message: 'Night job', at: new Date(2026, 2, 7, 2, 30).getTime(), repeat: 'daily' });
    expect(made.time).toBe('02:30');
    const runTo = async (target) => {
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at; timers.delete(due[0]);
        await due[1].fn();
      }
      t = target;
    };
    await runTo(new Date(2026, 2, 9, 1, 0).getTime());   // past 7th 02:30 and 8th 03:30
    const [item] = await r.list();
    expect(new Date(item.at).getDate()).toBe(9);
    expect(hm(item.at)).toBe('2:30');
    r.stop?.();
  });
});

describe('the Calendar draws the same repeats', () => {
  it('occurrences keep 02:30 after the change', () => {
    globalThis.window = globalThis.window || {};
    const { Calendar } = req('../../src/renderer/js/calendar.js');
    const from = new Date(2026, 2, 7).getTime(), to = new Date(2026, 2, 11).getTime();
    const list = Calendar.occurrences({ at: new Date(2026, 2, 7, 2, 30).getTime(), repeat: 'daily', time: '02:30' }, from, to);
    expect(list.map(hm)).toEqual(['2:30', '3:30', '2:30', '2:30']);
  });
});
