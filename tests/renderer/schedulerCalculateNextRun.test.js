import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Scheduler from '../../src/renderer/js/scheduler.js';

// Lock the system clock so date math is deterministic.
// Anchor: Sunday 2026-02-15 14:30:00 local time.
//   - getDay() === 0 (Sunday)
//   - February → exposes the dayOfMonth=31 overflow case
//   - 14:30 → 09:00 daily is "past", 18:00 daily is "future"
const FIXED_NOW = new Date(2026, 1, 15, 14, 30, 0, 0);

describe('Scheduler.calculateNextRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('frequency: "once"', () => {
    it('returns null if runCount > 0 (already fired)', () => {
      const t = { frequency: 'once', runCount: 1, time: '09:00', startDate: '2030-01-01' };
      expect(Scheduler.calculateNextRun(t)).toBeNull();
    });

    it('returns the configured date when startDate is in the future', () => {
      const t = { frequency: 'once', runCount: 0, time: '10:00', startDate: '2030-06-15' };
      const r = Scheduler.calculateNextRun(t);
      expect(r).toBeInstanceOf(Date);
      expect(r.getFullYear()).toBe(2030);
      expect(r.getMonth()).toBe(5); // June
      expect(r.getDate()).toBe(15);
      expect(r.getHours()).toBe(10);
      expect(r.getMinutes()).toBe(0);
    });

    it('returns null if startDate is in the past relative to now', () => {
      const t = { frequency: 'once', runCount: 0, time: '09:00', startDate: '2026-01-01' };
      expect(Scheduler.calculateNextRun(t)).toBeNull();
    });

    it('returns null if startDate is today but the time is already past', () => {
      // FIXED_NOW is 14:30 — 09:00 today is in the past
      const t = { frequency: 'once', runCount: 0, time: '09:00', startDate: '2026-02-15' };
      expect(Scheduler.calculateNextRun(t)).toBeNull();
    });

    it('returns today at the given time if it is still in the future today', () => {
      const t = { frequency: 'once', runCount: 0, time: '18:00', startDate: '2026-02-15' };
      const r = Scheduler.calculateNextRun(t);
      expect(r).toBeInstanceOf(Date);
      expect(r.getHours()).toBe(18);
      expect(r.getDate()).toBe(15);
    });

    it('falls back to time "09:00" when task.time is missing', () => {
      const t = { frequency: 'once', runCount: 0, startDate: '2030-01-01' };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getHours()).toBe(9);
      expect(r.getMinutes()).toBe(0);
    });
  });

  describe('frequency: "daily"', () => {
    it('schedules tomorrow when today\'s time is already past', () => {
      // 14:30 now, target 09:00 → must roll to tomorrow
      const t = { frequency: 'daily', time: '09:00' };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getDate()).toBe(16);
      expect(r.getHours()).toBe(9);
      expect(r.getMinutes()).toBe(0);
    });

    it('schedules today when target time is still in the future', () => {
      const t = { frequency: 'daily', time: '18:00' };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getDate()).toBe(15);
      expect(r.getHours()).toBe(18);
    });

    it('rolls into next month when today is the last day and time is past', () => {
      // Anchor end-of-Feb scenario: now = Feb 28 23:00 → 22:00 daily must roll
      vi.setSystemTime(new Date(2026, 1, 28, 23, 0, 0));
      const t = { frequency: 'daily', time: '22:00' };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getMonth()).toBe(2); // March (0-indexed)
      expect(r.getDate()).toBe(1);
      expect(r.getHours()).toBe(22);
    });
  });

  describe('frequency: "weekly"', () => {
    it('returns null when daysOfWeek is empty', () => {
      const t = { frequency: 'weekly', time: '10:00', daysOfWeek: [] };
      expect(Scheduler.calculateNextRun(t)).toBeNull();
    });

    it('finds the next matching weekday', () => {
      // FIXED_NOW = Sunday(0) 14:30. daysOfWeek [1,3,5] = Mon/Wed/Fri.
      // Next match should be Monday 2026-02-16.
      const t = { frequency: 'weekly', time: '10:00', daysOfWeek: [1, 3, 5] };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getDay()).toBe(1);
      expect(r.getDate()).toBe(16);
      expect(r.getHours()).toBe(10);
    });

    it('matches today if today is one of the days AND time is still in the future', () => {
      // FIXED_NOW Sunday 14:30. daysOfWeek [0]. time 18:00 → today (Sun) at 18:00.
      const t = { frequency: 'weekly', time: '18:00', daysOfWeek: [0] };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getDay()).toBe(0);
      expect(r.getDate()).toBe(15);
      expect(r.getHours()).toBe(18);
    });

    it('skips today if today matches but time has already passed', () => {
      // FIXED_NOW Sunday 14:30. daysOfWeek [0,1]. time 09:00 → today is past, next Monday.
      const t = { frequency: 'weekly', time: '09:00', daysOfWeek: [0, 1] };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getDay()).toBe(1);
      expect(r.getDate()).toBe(16);
    });

    it('wraps around to the next week when no day this week matches', () => {
      // FIXED_NOW Sunday 14:30. daysOfWeek [0] only, time already past → next Sunday.
      const t = { frequency: 'weekly', time: '09:00', daysOfWeek: [0] };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getDay()).toBe(0);
      expect(r.getDate()).toBe(22);
    });
  });

  describe('frequency: "monthly"', () => {
    it('schedules the next dayOfMonth when current month\'s day is past', () => {
      // FIXED_NOW Feb 15. dayOfMonth=10 → Feb 10 is past, roll to Mar 10.
      const t = { frequency: 'monthly', time: '09:00', dayOfMonth: 10 };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getMonth()).toBe(2); // March
      expect(r.getDate()).toBe(10);
    });

    it('schedules this month\'s dayOfMonth when it is still upcoming', () => {
      const t = { frequency: 'monthly', time: '09:00', dayOfMonth: 25 };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getMonth()).toBe(1); // February
      expect(r.getDate()).toBe(25);
    });

    it('falls back to dayOfMonth=1 when not specified', () => {
      // Day 1 is past for Feb 15 → roll to March 1
      const t = { frequency: 'monthly', time: '09:00' };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getMonth()).toBe(2);
      expect(r.getDate()).toBe(1);
    });

    // Document current Date-overflow behavior on dayOfMonth=31 in a short
    // month. This is what the gap report flagged. Test locks in the
    // observed value so future "fixes" surface explicitly. Pinned as todo
    // separately for the user-intent question.
    it('dayOfMonth=31 in February overflows into next month (Date semantics)', () => {
      // FIXED_NOW Feb 15. dayOfMonth=31 → setDate(31) on Feb overflows by
      // (31 - 28) = 3 days, landing on March 3 of the same year (2026).
      // March 3 > Feb 15 so the "if past" branch does NOT roll forward.
      const t = { frequency: 'monthly', time: '09:00', dayOfMonth: 31 };
      const r = Scheduler.calculateNextRun(t);
      expect(r.getMonth()).toBe(2); // March (overflow target)
      expect(r.getDate()).toBe(3);
      expect(r.getFullYear()).toBe(2026);
    });

    it.todo(
      'monthly dayOfMonth=31 in a short month: confirm expected user-intent behavior. ' +
      'Current code overflows to e.g. March 3 — user may expect "skip months that lack day 31" ' +
      'or "use last day of month". Decision pending; see scheduler.js:105-110.'
    );
  });

  describe('frequency: "custom" / cron', () => {
    it('delegates to _parseCronNext for custom cron strings', () => {
      const t = { frequency: 'custom', customCron: '* * * * *', time: '09:00' };
      const r = Scheduler.calculateNextRun(t);
      // "* * * * *" should fire at the next minute boundary.
      expect(r).toBeInstanceOf(Date);
      expect(r.getTime()).toBeGreaterThan(FIXED_NOW.getTime());
    });

    it('returns null when frequency is "custom" but customCron is missing', () => {
      const t = { frequency: 'custom', time: '09:00' };
      expect(Scheduler.calculateNextRun(t)).toBeNull();
    });
  });

  describe('unknown frequency', () => {
    it('returns null for an unrecognized frequency value', () => {
      const t = { frequency: 'fortnightly', time: '09:00' };
      expect(Scheduler.calculateNextRun(t)).toBeNull();
    });
  });
});
