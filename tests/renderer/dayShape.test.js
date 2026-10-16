// @vitest-environment jsdom
//
// T2-037: the busy bar, the largest free gap and the week load (js/day-shape.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const day = (d) => new Date(2026, 9, d).getTime();
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(14, 8);

let S;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexDayShape: S } = fresh(JS + 'day-shape.js'));
});

describe('segments()', () => {
  it('clips to 07:00-24:00 and merges what touches or overlaps', () => {
    const segs = S.segments([
      { start: at(14, 6), end: at(14, 8) },          // starts before the window
      { start: at(14, 8), end: at(14, 9) },          // touches
      { start: at(14, 10), end: at(14, 11) },
      { start: at(14, 10, 30), end: at(14, 12) },    // overlaps
      { start: at(14, 23), end: at(15, 2) },         // runs past midnight
    ], day(14));
    expect(segs).toEqual([
      { start: at(14, 7), end: at(14, 9) },
      { start: at(14, 10), end: at(14, 12) },
      { start: at(14, 23), end: day(15) },
    ]);
    expect(S.busyMinutes(segs)).toBe(2 * 60 + 2 * 60 + 60);
  });
  it('ignores items with no length or no numbers', () => {
    expect(S.segments([{ start: 5, end: 5 }, null, { start: 'x', end: 2 }], day(14))).toEqual([]);
  });
});

describe('largestGap()', () => {
  it('names the longest free stretch of the day', () => {
    const s = S.segments([{ start: at(14, 9), end: at(14, 10) }, { start: at(14, 13), end: at(14, 14) }], day(14));
    const g = S.largestGap(s, day(14));
    expect(g).toMatchObject({ start: at(14, 14), end: day(15) });
    expect(g.minutes).toBe(10 * 60);
  });
  it('only looks forward from now on today', () => {
    const s = S.segments([{ start: at(14, 15), end: at(14, 16) }], day(14));
    const g = S.largestGap(s, day(14), at(14, 12));
    expect(g.start).toBe(at(14, 16));
    expect(S.largestGap([{ start: at(14, 7), end: day(15) }], day(14))).toBe(null);
  });
});

describe('bar() and level()', () => {
  it('draws one character per hour', () => {
    const s = S.segments([{ start: at(14, 9), end: at(14, 10, 30) }], day(14));
    expect(S.bar(s, day(14))).toBe('..##' + '.'.repeat(13));
    expect(S.bar(s, day(14))).toHaveLength(17);
  });
  it('grades the load', () => {
    expect([60, 200, 400, 480].map(m => S.level(m).key)).toEqual(['light', 'steady', 'heavy', 'crushed']);
  });
});

describe('week()', () => {
  it('reads the stores, grades each of seven days and counts dated tasks into the load', async () => {
    const src = {
      events: () => [
        { start: at(16, 9), end: at(16, 17) },               // Friday, 8 h
        { start: at(14, 9), end: at(14, 10), allDay: false },
        { start: at(15, 0), end: at(15, 23, 59), allDay: true },   // all-day: not a busy stretch
      ],
      reminders: async () => [{ id: 'r', at: at(14, 12), message: 'x' }, { id: 'f', at: at(14, 13), firedAt: 1, message: 'old' }],
      occurrences: (r, from, to) => (r.at >= from && r.at < to ? [r.at] : []),
      blocks: () => [{ state: 'planned', start: at(14, 15), end: at(14, 16) }, { state: 'skipped', start: at(14, 17), end: at(14, 18) }],
      tasks: () => [{ due: day(14) }, { due: day(14) }],
    };
    const w = await S.week(NOW, src);
    expect(w.days).toHaveLength(7);
    const today = w.days[0];
    expect(today.busy).toBe(60 + 15 + 60);                   // event + reminder + planned block
    expect(today.tasks).toBe(2);
    expect(today.load).toBe(today.busy + 60);
    expect(w.days[2].level.key).toBe('crushed');             // Friday
    expect(w.days[1].busy).toBe(0);
    expect(w.errors).toEqual([]);
  });
  it('names a store that cannot be read and still answers from the others', async () => {
    const src = { events: () => { throw new Error('feed down'); }, reminders: async () => [], occurrences: () => [], blocks: () => [], tasks: () => [] };
    const w = await S.week(NOW, src);
    expect(w.errors).toEqual(['calendar: feed down']);
    expect(w.days).toHaveLength(7);
  });
});

describe('brief module', () => {
  it('says what the day looks like in plain text', async () => {
    const m = S.briefModule();
    expect(m.id).toBe('day-shape');
    S._src = () => ({ events: () => [{ start: Date.now() + 1, end: Date.now() + 3600000 }], reminders: async () => [], occurrences: () => [], blocks: () => [], tasks: () => [] });
    const out = await m.build();
    expect(out.lines[0].text).toMatch(/^07 [.#]{17} 24$/);
    expect(out.lines[1].text).toBe('This week');
  });
});
