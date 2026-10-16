// @vitest-environment jsdom
// T2-013: exam countdown planner (js/exam-planner.js).
import { describe, it, expect, beforeEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let X;
const NOW = new Date(2026, 9, 16, 10, 0).getTime();
const day = (y, m, d, h = 0) => new Date(y, m - 1, d, h, 0).getTime();
beforeEach(() => {
  localStorage.clear();
  ({ VexExamPlanner: X } = fresh(JS + 'exam-planner.js'));
});

describe('the proposal', () => {
  const exam = (o = {}) => X.clean({ title: 'Midterm', course: 'Calc', date: day(2026, 11, 20), topics: [{ name: 'Integrals', hours: 4 }, { name: 'Series', hours: 2.5 }], ...o });
  it('proposes T-14, 7, 3 and 1 at 09:00 and a Focus OS goal sized by the topics', () => {
    const p = X.proposal(exam(), NOW);
    expect(p.reminders.map(r => r.daysBefore)).toEqual([14, 7, 3, 1]);
    expect(new Date(p.reminders[0].at).getHours()).toBe(9);
    expect(p.goal).toMatchObject({ title: 'Revise Calc: Midterm', estimateMin: 390, deadline: day(2026, 11, 20), remind: true });
  });
  it('leaves out the reminders that are already past', () => {
    const p = X.proposal(exam({ date: day(2026, 10, 20) }), NOW);
    expect(p.reminders.map(r => r.daysBefore)).toEqual([3, 1]);
  });
  it('says so when there is nothing to plan', () => {
    const p = X.proposal(exam({ date: day(2026, 10, 16, 8), hasTime: true, topics: [] }), NOW);
    expect(p.goal).toBeNull();
    expect(p.warnings.join(' ')).toMatch(/too close/);
  });
  it('uses an hour before a timed exam as the deadline', () => {
    expect(X.deadline(exam({ date: day(2026, 11, 20, 14), hasTime: true }))).toBe(day(2026, 11, 20, 13));
  });
});

describe('validation and the store', () => {
  it('refuses a missing title, date or bad hours', () => {
    expect(() => X.clean({ title: '', date: 1 })).toThrow(/title/);
    expect(() => X.clean({ title: 'x' })).toThrow(/date/);
    expect(() => X.clean({ title: 'x', date: 1, topics: [{ name: 'a', hours: 0 }] })).toThrow(/Hours/);
  });
  it('adds, lists in date order, updates and shows a countdown line', () => {
    X.add({ title: 'B', date: day(2026, 12, 1) });
    X.add({ title: 'A', date: day(2026, 10, 20), course: 'Phys' });
    expect(X.list().map(e => e.title)).toEqual(['A', 'B']);
    expect(X.briefLine(NOW)).toBe('Phys A: in 4 days');
    const id = X.list()[0].id;
    expect(X.update(id, { title: 'A2' }).title).toBe('A2');
    expect(X.dueItems(NOW)[0]).toMatchObject({ kind: 'event', text: 'Phys: A2', hasTime: false });
  });
  it('reports damaged storage instead of hiding it', () => {
    localStorage.setItem('vex.exams', '{nope');
    expect(() => X.list()).toThrow(/damaged/);
  });
});
