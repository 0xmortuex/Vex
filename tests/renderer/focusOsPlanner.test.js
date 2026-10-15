// Focus OS planner: the pure maths. Blocks are only ever proposed into time
// that is really free, and a block changes state in exactly one place.
import { describe, it, expect } from 'vitest';

const { FocusOSPlanner: P } = require('../../src/renderer/js/focus-os-planner.js');

const MIN = 60000;
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();     // October 2026; the 19th is a Monday
const MON = 19;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const inDaily = (b, from, to) => P.dailyIntervals(b.start - 86400000, b.end + 86400000, { from, to }).some(i => overlaps(i, b));

describe('clock helpers', () => {
  it('parses HH:MM and refuses anything else', () => {
    expect(P.parseHM('09:30')).toBe(570);
    expect(P.parseHM('9:05')).toBe(545);
    expect(P.parseHM('24:00')).toBeNull();
    expect(P.parseHM('noon')).toBeNull();
    expect(() => P._needHM('noon', 'Start')).toThrow(/Start must look like/);
  });

  it('expands a daily window that crosses midnight', () => {
    const w = P.dailyIntervals(at(MON, 0), at(MON + 1, 12), { from: '22:00', to: '07:00' });
    expect(w).toEqual([
      { start: at(MON, 0), end: at(MON, 7) },
      { start: at(MON, 22), end: at(MON + 1, 7) },
    ]);
  });

  it('treats equal start and end as no window', () => {
    expect(P.dailyIntervals(at(MON, 0), at(MON + 3, 0), { from: '08:00', to: '08:00' })).toEqual([]);
  });
});

describe('intervals', () => {
  it('merges overlapping and touching intervals and drops empty ones', () => {
    expect(P.mergeIntervals([{ start: 5, end: 9 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 8, end: 8 }, { start: 7, end: 10 }]))
      .toEqual([{ start: 1, end: 4 }, { start: 5, end: 10 }]);
  });

  it('subtracts cuts from a base', () => {
    expect(P.subtract([{ start: 0, end: 100 }], [{ start: 10, end: 20 }, { start: 15, end: 30 }, { start: 90, end: 120 }]))
      .toEqual([{ start: 0, end: 10 }, { start: 30, end: 90 }]);
    expect(P.subtract([{ start: 0, end: 10 }], [{ start: -5, end: 50 }])).toEqual([]);
  });

  it('ignores all-day events and gives an endless event half an hour', () => {
    const b = P.busyFromEvents([{ allDay: true, start: at(MON, 0), end: at(MON + 1, 0) }, { start: at(MON, 10) }, { start: at(MON, 14), end: at(MON, 15) }]);
    expect(b).toEqual([{ start: at(MON, 10), end: at(MON, 10, 30) }, { start: at(MON, 14), end: at(MON, 15) }]);
  });
});

describe('free windows', () => {
  const base = { from: at(MON, 8), to: at(MON, 20), workFrom: '09:00', workTo: '18:00', bufferMin: 0 };

  it('is the work day when nothing is in it', () => {
    expect(P.freeWindows(base)).toEqual([{ start: at(MON, 9), end: at(MON, 18) }]);
  });

  it('cuts events with the buffer around them', () => {
    const w = P.freeWindows({ ...base, bufferMin: 5, busy: [{ start: at(MON, 10), end: at(MON, 11) }] });
    expect(w).toEqual([{ start: at(MON, 9), end: at(MON, 9, 55) }, { start: at(MON, 11, 5), end: at(MON, 18) }]);
  });

  it('keeps meals, quiet hours and the wind-down clear', () => {
    const w = P.freeWindows({ ...base, blocked: [{ from: '12:00', to: '13:00' }, { from: '17:00', to: '07:00' }] });
    expect(w).toEqual([{ start: at(MON, 9), end: at(MON, 12) }, { start: at(MON, 13), end: at(MON, 17) }]);
  });

  it('is empty when the span is empty', () => {
    expect(P.freeWindows({ ...base, from: at(MON, 12), to: at(MON, 12) })).toEqual([]);
  });

  it('throws on a work day it cannot read', () => {
    expect(() => P.freeWindows({ ...base, workFrom: 'early' })).toThrow(/must look like/);
  });
});

describe('planning blocks', () => {
  const base = { now: at(MON, 8, 3), deadline: at(MON + 4, 18), goalId: 'g1', workFrom: '09:00', workTo: '18:00', bufferMin: 5, blockMin: 50, breakMin: 10, maxPerDay: 3 };

  it('places exactly the remaining effort inside the deadline', () => {
    const r = P.planBlocks({ ...base, remainingMin: 300 });
    expect(r.feasible).toBe(true);
    expect(r.plannedMin).toBe(300);
    expect(r.shortfallMin).toBe(0);
    expect(r.blocks.reduce((s, b) => s + (b.end - b.start) / MIN, 0)).toBe(300);
    for (const b of r.blocks) { expect(b.end).toBeLessThanOrEqual(base.deadline); expect(b.start).toBeGreaterThanOrEqual(at(MON, 9)); }
  });

  it('never overlaps an event, quiet hours, a meal or the wind-down', () => {
    const busy = [{ start: at(MON, 9), end: at(MON, 10, 30) }, { start: at(MON + 1, 9), end: at(MON + 1, 12) }];
    const blocked = [{ from: '12:00', to: '13:00' }, { from: '21:00', to: '08:00' }, { from: '16:30', to: '18:30' }];
    const r = P.planBlocks({ ...base, remainingMin: 600, maxPerDay: 6, busy, blocked });
    expect(r.blocks.length).toBeGreaterThan(0);
    for (const b of r.blocks) {
      for (const e of busy) expect(overlaps(b, e)).toBe(false);
      for (const w of blocked) expect(inDaily(b, w.from, w.to)).toBe(false);
    }
    // blocks do not overlap each other either
    for (let i = 1; i < r.blocks.length; i++) expect(r.blocks[i].start).toBeGreaterThanOrEqual(r.blocks[i - 1].end);
  });

  it('keeps clear of blocks already planned, but not of skipped ones', () => {
    const kept = { start: at(MON, 9), end: at(MON, 12), goalId: 'other', state: 'planned' };
    const gone = { start: at(MON, 13), end: at(MON, 14), goalId: 'other', state: 'skipped' };
    const r = P.planBlocks({ ...base, now: at(MON, 8), remainingMin: 50, existing: [kept, gone], bufferMin: 0, blocked: [] });
    expect(r.blocks[0].start).toBe(at(MON, 12));
    const r2 = P.planBlocks({ ...base, now: at(MON, 12, 30), remainingMin: 50, existing: [gone], bufferMin: 0, blocked: [] });
    expect(r2.blocks[0].start).toBe(at(MON, 12, 30));
  });

  it('caps blocks per day for the goal, counting ones already planned', () => {
    const existing = [{ start: at(MON, 9), end: at(MON, 9, 50), goalId: 'g1', state: 'planned' }];
    const r = P.planBlocks({ ...base, now: at(MON, 8), remainingMin: 400, maxPerDay: 2, existing, bufferMin: 0, blocked: [] });
    const onMonday = r.blocks.filter(b => new Date(b.start).getDate() === MON).length;
    expect(onMonday).toBe(1);                       // one already there, cap is two
    const perDay = {};
    for (const b of r.blocks) { const k = P.dayKey(b.start); perDay[k] = (perDay[k] || 0) + 1; }
    expect(Math.max(...Object.values(perDay))).toBeLessThanOrEqual(2);
  });

  it('reports the shortfall instead of squeezing blocks past the deadline', () => {
    const r = P.planBlocks({ ...base, now: at(MON + 4, 15), remainingMin: 300 });
    expect(r.feasible).toBe(false);
    expect(r.reason).toBe('not-enough-room');
    expect(r.plannedMin + r.shortfallMin).toBe(300);
    for (const b of r.blocks) expect(b.end).toBeLessThanOrEqual(base.deadline);
  });

  it('says plainly when the deadline has passed or nothing is left', () => {
    expect(P.planBlocks({ ...base, now: at(MON + 5, 9), remainingMin: 60 }).reason).toBe('deadline-passed');
    const none = P.planBlocks({ ...base, remainingMin: 0 });
    expect(none.reason).toBe('nothing-left');
    expect(none.blocks).toEqual([]);
  });

  it('starts no earlier than the next five minutes', () => {
    const r = P.planBlocks({ ...base, now: at(MON, 10, 2), remainingMin: 25, bufferMin: 0, blocked: [] });
    expect(r.blocks[0].start).toBe(at(MON, 10, 5));
  });

  it('throws without a clock', () => {
    expect(() => P.planBlocks({ remainingMin: 30 })).toThrow(/now and a deadline/);
  });
});

describe('state transitions', () => {
  const b = { id: 'b', goalId: 'g', start: at(MON, 9), end: at(MON, 10), state: 'proposed' };

  it('walks proposed -> planned -> active -> done', () => {
    const p = P.transition(b, 'confirm');
    const a = P.transition(p, 'start', at(MON, 9));
    const d = P.transition(a, 'finish', at(MON, 9, 40));
    expect([p.state, a.state, d.state]).toEqual(['planned', 'active', 'done']);
    expect(a.startedAt).toBe(at(MON, 9));
    expect(d.endedAt).toBe(at(MON, 9, 40));
    expect(b.state).toBe('proposed');               // the input is never changed
  });

  it('refuses moves that are not allowed', () => {
    expect(() => P.transition(b, 'start')).toThrow(/cannot be started/);
    expect(() => P.transition({ ...b, state: 'done' }, 'skip')).toThrow();
    expect(() => P.transition({ ...b, state: 'planned' }, 'finish')).toThrow();
    expect(() => P.transition(b, 'explode')).toThrow(/Unknown block action/);
    expect(P.canTransition({ ...b, state: 'planned' }, 'start')).toBe(true);
    expect(P.canTransition({ ...b, state: 'done' }, 'restore')).toBe(false);
  });

  it('keeps a skipped block, and lets it be put back', () => {
    const s = P.transition({ ...b, state: 'planned' }, 'skip', at(MON, 8));
    expect(s.state).toBe('skipped');
    const r = P.transition(s, 'restore');
    expect(r.state).toBe('planned');
    expect(r.endedAt).toBeUndefined();
  });

  it('lets time pass quietly: untouched planned blocks become skipped', () => {
    const blocks = [{ ...b, state: 'planned' }, { ...b, id: 'late', start: at(MON, 15), end: at(MON, 16), state: 'planned' }, { ...b, id: 'on', state: 'active' }];
    const gone = P.lapse(blocks, at(MON, 12));
    expect(gone.map(x => x.id)).toEqual(['b']);
    expect(gone[0].state).toBe('skipped');
    expect(gone[0].lapsed).toBe(true);
  });
});

describe('progress counts, never penalties', () => {
  const day = (h, state, extra) => ({ id: 'x' + h, goalId: 'g', start: at(MON, h), end: at(MON, h, 50), state, ...extra });

  it('says "2 of 5 blocks done" and leaves skipped blocks out of the total', () => {
    const blocks = [day(9, 'done'), day(10, 'done'), day(11, 'planned'), day(13, 'planned'), day(14, 'active'), day(15, 'skipped'), day(16, 'proposed')];
    const d = P.dayProgress(blocks, at(MON, 12));
    expect(d.text).toBe('2 of 5 blocks done');
    expect(d.fraction).toBeCloseTo(0.4);
  });

  it('has a calm line for an empty day', () => {
    expect(P.dayProgress([], at(MON, 12)).text).toBe('No blocks today');
    expect(P.dayProgress([day(9, 'done')], at(MON, 12)).text).toBe('1 of 1 block done');
  });

  it('counts a goal by the minutes actually done', () => {
    const goal = { id: 'g', estimateMin: 120 };
    const blocks = [day(9, 'done', { startedAt: at(MON, 9), endedAt: at(MON, 9, 45) }), day(10, 'done'), day(11, 'skipped'), { ...day(13, 'done'), goalId: 'other' }];
    const p = P.goalProgress(goal, blocks);
    expect(p.doneMin).toBe(45 + 50);
    expect(p.remainingMin).toBe(25);
    expect(p.fraction).toBeCloseTo(95 / 120);
  });

  it('summarises the week in plain numbers', () => {
    const goals = [{ id: 'g', title: 'Ship it', status: 'done', completedAt: at(MON + 2, 12) }];
    const blocks = [day(9, 'done'), { ...day(9, 'done'), id: 'y', start: at(MON + 1, 9), end: at(MON + 1, 9, 50) }, day(11, 'skipped'), { ...day(9, 'done'), id: 'old', start: at(MON - 20, 9), end: at(MON - 20, 9, 50) }];
    const w = P.weekSummary(goals, blocks, at(MON + 2, 17));
    expect(w.blocksDone).toBe(2);
    expect(w.blocksSkipped).toBe(1);
    expect(w.minutesDone).toBe(100);
    expect(w.goalsDone).toEqual(['Ship it']);
    expect(w.perGoal[0]).toEqual({ goalId: 'g', title: 'Ship it', minutes: 100 });
  });
});

describe('auto-start is opt-in', () => {
  const goals = [{ id: 'on', status: 'active', autoStart: true }, { id: 'off', status: 'active', autoStart: false }, { id: 'done', status: 'done', autoStart: true }];
  const blk = (id, goalId, state = 'planned') => ({ id, goalId, start: at(MON, 9), end: at(MON, 9, 50), state });

  it('only picks a block of a goal that turned it on, and only just after its start', () => {
    expect(P.dueForAutoStart(goals, [blk('a', 'off')], at(MON, 9, 1))).toBeNull();
    expect(P.dueForAutoStart(goals, [blk('a', 'done')], at(MON, 9, 1))).toBeNull();
    expect(P.dueForAutoStart(goals, [blk('a', 'on')], at(MON, 9, 1)).id).toBe('a');
    expect(P.dueForAutoStart(goals, [blk('a', 'on')], at(MON, 9, 30))).toBeNull();     // past the grace period
    expect(P.dueForAutoStart(goals, [blk('a', 'on')], at(MON, 8, 59))).toBeNull();     // not yet
  });

  it('never starts a second block while one is running', () => {
    expect(P.dueForAutoStart(goals, [blk('a', 'on'), blk('r', 'off', 'active')], at(MON, 9, 1))).toBeNull();
  });
});

describe('goal sentences', () => {
  const now = at(16, 10);                           // Friday the 16th
  it('reads "by Friday, 6 hours"', () => {
    const p = P.parseGoalText('ship the release by Friday, 6 hours', at(MON, 10));
    expect(p.title).toBe('ship the release');
    expect(p.estimateMin).toBe(360);
    expect(new Date(p.deadlineDay).getDay()).toBe(5);
    expect(new Date(p.deadlineDay).getDate()).toBe(23);
  });
  it('reads tomorrow, a date and "in 3 days"', () => {
    expect(P.parseGoalText('write the report by tomorrow', now).deadlineDay).toBe(at(17, 0));
    expect(P.parseGoalText('taxes by 2026-11-02 for 90 minutes', now)).toMatchObject({ title: 'taxes', deadlineDay: new Date(2026, 10, 2).getTime(), estimateMin: 90 });
    expect(P.parseGoalText('review PRs in 3 days', now)).toMatchObject({ title: 'review PRs', deadlineDay: at(19, 0) });
  });
  it('says "by Friday" on a Friday means today', () => {
    expect(P.parseGoalText('finish by friday', now).deadlineDay).toBe(at(16, 0));
  });
  it('leaves what it cannot read empty instead of guessing', () => {
    const p = P.parseGoalText('think about the roadmap', now);
    expect(p).toEqual({ title: 'think about the roadmap', deadlineDay: null, estimateMin: null });
  });
  it('turns a day into the end of the work day', () => {
    expect(P.deadlineAt(at(MON, 0), '17:30')).toBe(at(MON, 17, 30));
    expect(() => P.deadlineAt(at(MON, 0), 'late')).toThrow();
  });
});
