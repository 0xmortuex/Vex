// Next/previous-occurrence maths for the scheduler, pinned across the two
// places naive date arithmetic breaks: DST transitions and month ends.
//
// The timezone is forced to America/New_York BEFORE the module under test is
// imported, because the developer machine (Europe/Istanbul) has had no DST
// since 2016 and would silently pass every DST assertion.
process.env.TZ = 'America/New_York';

import { describe, it, expect } from 'vitest';
import Scheduler from '../../src/renderer/js/scheduler.js';

// 2026 US transitions: spring forward Sun 8 Mar (02:00 -> 03:00),
//                      fall back    Sun 1 Nov (02:00 -> 01:00).
const at = (y, m, d, h = 0, min = 0) => new Date(y, m, d, h, min, 0, 0).getTime();
const iso = ms => new Date(ms).toString();

const task = (schedule, extra = {}) => ({ v: 2, enabled: true, schedule: { ...schedule }, action: { type: 'reminder', message: 'x' }, ...extra });

describe('daily schedules across DST', () => {
  it('keeps 09:00 wall-clock over the spring-forward boundary', () => {
    const t = task({ type: 'daily', time: '09:00' });
    const from = at(2026, 2, 7, 9, 0);              // Sat 7 Mar 09:00 exactly
    const next = Scheduler.nextOccurrence(t, from); // Sun 8 Mar (the 23-hour day)
    const d = new Date(next);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([8, 9, 0]);
    // 23 real hours, not 24: adding 86400000 would have landed on 10:00.
    expect(next - from).toBe(23 * 3600000);
    expect(next).not.toBe(from + 86400000);
  });

  it('keeps 09:00 wall-clock over the fall-back boundary', () => {
    const t = task({ type: 'daily', time: '09:00' });
    const from = at(2026, 9, 31, 9, 0);             // Sat 31 Oct 09:00 exactly
    const next = Scheduler.nextOccurrence(t, from); // Sun 1 Nov (the 25-hour day)
    const d = new Date(next);
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([10, 1, 9, 0]);
    // 25 real hours, not 24: adding 86400000 would have landed on 08:00.
    expect(next - from).toBe(25 * 3600000);
    expect(next).not.toBe(from + 86400000);
  });

  it('does not drift over a week of DST-crossing days', () => {
    const t = task({ type: 'daily', time: '07:15' });
    let cursor = at(2026, 2, 5, 0, 0);
    for (let i = 0; i < 7; i++) {
      cursor = Scheduler.nextOccurrence(t, cursor);
      const d = new Date(cursor);
      expect([d.getHours(), d.getMinutes()], iso(cursor)).toEqual([7, 15]);
    }
  });

  it('normalises a wall-clock time that does not exist on the spring-forward day', () => {
    // 02:30 never happens on 8 Mar 2026 in New York.
    const t = task({ type: 'daily', time: '02:30' });
    const next = Scheduler.nextOccurrence(t, at(2026, 2, 7, 12, 0));
    const d = new Date(next);
    expect(d.getDate()).toBe(8);
    expect(d.getHours()).toBe(3);   // pushed forward, never skipped or thrown
    expect(d.getMinutes()).toBe(30);
  });
});

describe('interval schedules', () => {
  it('steps by real elapsed time, not wall clock, across a DST jump', () => {
    const anchor = at(2026, 2, 8, 0, 0);           // midnight before the jump
    const t = task({ type: 'interval', everyMinutes: 60, anchor });
    const next = Scheduler.nextOccurrence(t, anchor + 30 * 60000);
    expect(next).toBe(anchor + 3600000);
    const d = new Date(next);
    expect(d.getHours()).toBe(1);
    // Two more hours of real time lands at 04:00 local (02:00 was skipped).
    expect(new Date(Scheduler.nextOccurrence(t, anchor + 150 * 60000)).getHours()).toBe(4);
  });

  it('is anchored, so a poll landing mid-step does not shift the grid', () => {
    const anchor = at(2026, 5, 1, 9, 0);
    const t = task({ type: 'interval', everyMinutes: 15, anchor });
    expect(Scheduler.nextOccurrence(t, anchor + 1)).toBe(anchor + 15 * 60000);
    expect(Scheduler.nextOccurrence(t, anchor + 14 * 60000 + 59999)).toBe(anchor + 15 * 60000);
    expect(Scheduler.nextOccurrence(t, anchor + 15 * 60000)).toBe(anchor + 30 * 60000);
    expect(Scheduler.prevOccurrence(t, anchor + 44 * 60000)).toBe(anchor + 30 * 60000);
  });

  it('returns the anchor itself as the first run when asked from before it', () => {
    const anchor = at(2026, 5, 1, 9, 0);
    const t = task({ type: 'interval', everyMinutes: 30, anchor });
    expect(Scheduler.nextOccurrence(t, anchor - 60000)).toBe(anchor);
    expect(Scheduler.prevOccurrence(t, anchor - 60000)).toBeNull();
  });
});

describe('monthly schedules at month ends', () => {
  it('clamps the 31st to the last day of every short month', () => {
    const t = task({ type: 'monthly', time: '08:00', dayOfMonth: 31 });
    const expected = [
      [2026, 0, 31], [2026, 1, 28], [2026, 2, 31], [2026, 3, 30],
      [2026, 4, 31], [2026, 5, 30], [2026, 6, 31],
    ];
    let cursor = at(2026, 0, 1);
    for (const [y, m, d] of expected) {
      cursor = Scheduler.nextOccurrence(t, cursor);
      const got = new Date(cursor);
      expect([got.getFullYear(), got.getMonth(), got.getDate()], iso(cursor)).toEqual([y, m, d]);
      expect(got.getHours()).toBe(8);
    }
  });

  it('clamps the 29th to 28 Feb in a common year and keeps 29 Feb in a leap year', () => {
    const t = task({ type: 'monthly', time: '08:00', dayOfMonth: 29 });
    expect(new Date(Scheduler.nextOccurrence(t, at(2026, 1, 1))).getDate()).toBe(28); // 2026: common
    expect(new Date(Scheduler.nextOccurrence(t, at(2028, 1, 1))).getDate()).toBe(29); // 2028: leap
  });

  it('never skips a month, which is what the old setDate() overflow did', () => {
    // The old engine turned "monthly on the 31st" in February into 3 March,
    // so March's own 31st was then in the past and the task fell a month behind.
    const t = task({ type: 'monthly', time: '08:00', dayOfMonth: 31 });
    const months = new Set();
    let cursor = at(2026, 0, 1);
    for (let i = 0; i < 12; i++) {
      cursor = Scheduler.nextOccurrence(t, cursor);
      months.add(new Date(cursor).getMonth());
    }
    expect(months.size).toBe(12);
  });

  it('supports "last day of the month"', () => {
    const t = task({ type: 'monthly', time: '23:30', dayOfMonth: 'last' });
    const feb = new Date(Scheduler.nextOccurrence(t, at(2026, 1, 1)));
    expect([feb.getMonth(), feb.getDate()]).toEqual([1, 28]);
    const apr = new Date(Scheduler.nextOccurrence(t, at(2026, 3, 1)));
    expect([apr.getMonth(), apr.getDate()]).toEqual([3, 30]);
  });

  it('walks backwards over month ends too', () => {
    const t = task({ type: 'monthly', time: '08:00', dayOfMonth: 31 });
    const prev = new Date(Scheduler.prevOccurrence(t, at(2026, 2, 1, 12, 0)));
    expect([prev.getMonth(), prev.getDate()]).toEqual([1, 28]);
  });
});

describe('weekly schedules', () => {
  it('finds every selected weekday in order without drifting through DST', () => {
    const t = task({ type: 'weekly', time: '06:45', daysOfWeek: [1, 4] }); // Mon + Thu
    let cursor = at(2026, 2, 2, 0, 0);   // Mon 2 Mar
    const seen = [];
    for (let i = 0; i < 6; i++) {
      cursor = Scheduler.nextOccurrence(t, cursor);
      const d = new Date(cursor);
      seen.push([d.getMonth(), d.getDate(), d.getDay(), d.getHours(), d.getMinutes()]);
    }
    expect(seen).toEqual([
      [2, 2, 1, 6, 45], [2, 5, 4, 6, 45], [2, 9, 1, 6, 45],
      [2, 12, 4, 6, 45], [2, 16, 1, 6, 45], [2, 19, 4, 6, 45],
    ]);
  });

  it('returns null when no day is selected instead of guessing one', () => {
    expect(Scheduler.nextOccurrence(task({ type: 'weekly', time: '09:00', daysOfWeek: [] }), Date.now())).toBeNull();
    expect(Scheduler.prevOccurrence(task({ type: 'weekly', time: '09:00', daysOfWeek: [] }), Date.now())).toBeNull();
  });
});

describe('one-off schedules', () => {
  it('fires once and then reports nothing', () => {
    const t = task({ type: 'once', date: '2026-07-04', time: '12:00' });
    expect(new Date(Scheduler.nextOccurrence(t, at(2026, 6, 1))).getDate()).toBe(4);
    expect(Scheduler.nextOccurrence({ ...t, runCount: 1 }, at(2026, 6, 1))).toBeNull();
    expect(Scheduler.nextOccurrence(t, at(2026, 6, 5))).toBeNull();
  });

  it('reports the past occurrence so a missed one-off can still be caught up', () => {
    const t = task({ type: 'once', date: '2026-07-04', time: '12:00' });
    expect(Scheduler.prevOccurrence(t, at(2026, 6, 4, 13, 0))).toBe(at(2026, 6, 4, 12, 0));
    expect(Scheduler.prevOccurrence(t, at(2026, 6, 4, 11, 0))).toBeNull();
  });
});

describe('cron expressions', () => {
  const next = (expr, from) => Scheduler.nextOccurrence(task({ type: 'cron', cron: expr }), from);

  it('handles steps, ranges and lists', () => {
    const f = Scheduler.parseCron('*/15 9-17 * * mon-fri');
    expect(f.minute).toEqual([0, 15, 30, 45]);
    expect(f.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...f.dow].sort()).toEqual([1, 2, 3, 4, 5]);
    const d = new Date(next('*/15 9-17 * * mon-fri', at(2026, 5, 1, 9, 7)));  // Mon 1 Jun
    expect([d.getHours(), d.getMinutes()]).toEqual([9, 15]);
  });

  it('rejects malformed expressions instead of half-running them', () => {
    for (const bad of ['', '* * * *', '61 * * * *', '* 25 * * *', '* * 0 * *', '* * * 13 *', 'a b c d e', '*/0 * * * *', '5-2 * * * *']) {
      expect(Scheduler.parseCron(bad), bad).toBeNull();
    }
    expect(next('not a cron', Date.now())).toBeNull();
  });

  it('uses Vixie day semantics: restricted dom OR dow', () => {
    // "1st of the month, or any Monday"
    const expr = '0 6 1 * mon';
    const d1 = new Date(next(expr, at(2026, 5, 1, 7, 0)));   // Mon 1 Jun 06:00 already gone
    expect(d1.getDate()).toBe(8);                            // next Monday
    const d2 = new Date(next(expr, at(2026, 5, 30, 7, 0)));  // Tue 30 Jun
    expect([d2.getMonth(), d2.getDate()]).toEqual([6, 1]);   // 1 Jul, not a Monday
  });

  it('reaches a yearly expression the old 7-day scan could never find', () => {
    const d = new Date(next('0 0 1 1 *', at(2026, 5, 15)));
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 0, 1]);
  });

  it('computes the previous occurrence symmetrically', () => {
    const t = task({ type: 'cron', cron: '30 8 * * 1-5' });
    const prev = new Date(Scheduler.prevOccurrence(t, at(2026, 5, 6, 12, 0)));  // Sat 6 Jun
    expect([prev.getMonth(), prev.getDate(), prev.getHours(), prev.getMinutes()]).toEqual([5, 5, 8, 30]);
  });

  it('keeps the wall-clock hour across a DST jump', () => {
    const t = task({ type: 'cron', cron: '0 9 * * *' });
    const d = new Date(Scheduler.nextOccurrence(t, at(2026, 2, 7, 12, 0)));
    expect([d.getDate(), d.getHours()]).toEqual([8, 9]);
  });

  it('accepts 7 as Sunday', () => {
    expect([...Scheduler.parseCron('0 0 * * 7').dow]).toEqual([0]);
  });
});

describe('unknown schedule types stay inert', () => {
  it('never invents a schedule for a type it cannot read', () => {
    const t = { frequency: 'fortnightly', time: '09:00' };
    expect(Scheduler.nextOccurrence(t, Date.now())).toBeNull();
    expect(Scheduler.prevOccurrence(t, Date.now())).toBeNull();
    expect(Scheduler.describeNextRun({ ...t, enabled: true })).toBe('Not scheduled');
  });
});

describe('plain-English descriptions', () => {
  it('describes each schedule type the way a person would say it', () => {
    expect(Scheduler.describeSchedule(task({ type: 'interval', everyMinutes: 45 }))).toBe('Every 45 minutes');
    expect(Scheduler.describeSchedule(task({ type: 'interval', everyMinutes: 120 }))).toBe('Every 2 hours');
    expect(Scheduler.describeSchedule(task({ type: 'daily', time: '09:00' }))).toBe('Every day at 09:00');
    expect(Scheduler.describeSchedule(task({ type: 'weekly', time: '09:00', daysOfWeek: [1, 2, 3, 4, 5] }))).toBe('Every weekday at 09:00');
    expect(Scheduler.describeSchedule(task({ type: 'weekly', time: '09:00', daysOfWeek: [0, 6] }))).toBe('Every weekend day at 09:00');
    expect(Scheduler.describeSchedule(task({ type: 'monthly', time: '09:00', dayOfMonth: 3 }))).toBe('Monthly on the 3rd at 09:00');
    expect(Scheduler.describeSchedule(task({ type: 'monthly', time: '09:00', dayOfMonth: 'last' }))).toBe('Monthly on the last day at 09:00');
    expect(Scheduler.describeSchedule(task({ type: 'once', date: '2026-07-04', time: '12:00' }))).toBe('Once on 4 Jul 2026 at 12:00');
  });

  it('describes the next run relative to now', () => {
    const now = at(2026, 5, 1, 14, 0);   // Mon 1 Jun, 14:00
    expect(Scheduler.describeNextRun(task({ type: 'daily', time: '14:30' }), now)).toBe('in 30 minutes');
    expect(Scheduler.describeNextRun(task({ type: 'daily', time: '18:00' }), now)).toBe('today at 18:00');
    expect(Scheduler.describeNextRun(task({ type: 'daily', time: '09:00' }), now)).toBe('tomorrow at 09:00');
    expect(Scheduler.describeNextRun(task({ type: 'weekly', time: '09:00', daysOfWeek: [4] }), now)).toBe('Thu at 09:00');
    expect(Scheduler.describeNextRun(task({ type: 'monthly', time: '09:00', dayOfMonth: 20 }), now)).toBe('20 Jun at 09:00');
    expect(Scheduler.describeNextRun(task({ type: 'daily', time: '09:00' }, { enabled: false }), now)).toBe('Paused');
  });
});
