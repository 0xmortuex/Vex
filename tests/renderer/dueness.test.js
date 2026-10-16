// @vitest-environment jsdom
//
// T1-001: one ranked "what is due" list over reminders, @dated tasks, calendar
// events and scheduled tasks (js/dueness.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let D;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  ({ VexDueness: D } = fresh(JS + 'dueness.js'));
});

// Wednesday 14 October 2026, 14:00 local.
const NOW = new Date(2026, 9, 14, 14, 0, 0).getTime();
const at = (d, h = 0, m = 0) => new Date(2026, 9, d, h, m, 0).getTime();

describe('reason()', () => {
  it('calls a timed item in the past overdue, with how long', () => {
    expect(D.reason({ at: at(14, 12), hasTime: true }, NOW)).toMatchObject({ group: 0, key: 'overdue', label: 'Overdue 2 h' });
    expect(D.reason({ at: at(11, 9), hasTime: true }, NOW).label).toBe('Overdue 3 days');
  });

  it('keeps a date-only task due today until the day is over', () => {
    expect(D.reason({ at: at(14), hasTime: false }, NOW)).toMatchObject({ group: 1, key: 'today', label: 'Due today' });
    expect(D.reason({ at: at(13), hasTime: false }, NOW)).toMatchObject({ group: 0, key: 'overdue' });
  });

  it('shows the time for a timed item today and a weekday later in the week', () => {
    expect(D.reason({ at: at(14, 18, 30), hasTime: true }, NOW)).toMatchObject({ group: 1, key: 'today-time', label: 'Today 18:30' });
    expect(D.reason({ at: at(15, 9), hasTime: true }, NOW)).toMatchObject({ group: 2, label: 'Tomorrow 09:00' });
    const r = D.reason({ at: at(17), hasTime: false }, NOW);
    expect(r.group).toBe(2);
    expect(r.label).not.toMatch(/Tomorrow/);
  });

  it('is null beyond the week and for a missing time', () => {
    expect(D.reason({ at: at(30), hasTime: false }, NOW)).toBe(null);
    expect(D.reason({ text: 'x' }, NOW)).toBe(null);
    expect(D.reason(null, NOW)).toBe(null);
  });
});

describe('rank()', () => {
  const item = (kind, text, a, hasTime = true) => ({ id: kind + text, kind, text, at: a, hasTime });

  it('puts overdue first, then today (timed before untimed), then the week', () => {
    const rows = D.rank([
      item('event', 'Friday sync', at(16, 10)),
      item('task', 'File taxes', at(14), false),
      item('reminder', 'Call mum', at(14, 16)),
      item('reminder', 'Late thing', at(13, 9)),
      item('schedule', 'Backup', at(14, 15)),
    ], NOW);
    expect(rows.map(r => r.text)).toEqual(['Late thing', 'Backup', 'Call mum', 'File taxes', 'Friday sync']);
  });

  it('drops items beyond the week, empty text and exact duplicates, and honours the limit', () => {
    const rows = D.rank([
      item('reminder', 'A', at(14, 16)), item('reminder', 'A', at(14, 16)), item('reminder', '  ', at(14, 17)),
      item('reminder', 'Far', at(28, 9)), item('task', 'B', at(15), false),
    ], NOW, { limit: 5 });
    expect(rows.map(r => r.text)).toEqual(['A', 'B']);
    expect(D.rank([item('reminder', 'A', at(14, 16)), item('reminder', 'B', at(14, 17))], NOW, { limit: 1 })).toHaveLength(1);
  });

  it('breaks a tie by kind: reminder, task, event, schedule', () => {
    const t = at(14, 16);
    const rows = D.rank([item('schedule', 'S', t), item('event', 'E', t), item('task', 'T', t), item('reminder', 'R', t)], NOW);
    expect(rows.map(r => r.kind)).toEqual(['reminder', 'task', 'event', 'schedule']);
  });

  it('does not change what it was given', () => {
    const input = [item('reminder', 'A', at(14, 16))];
    D.rank(input, NOW);
    expect(input[0].reason).toBeUndefined();
  });
});

describe('collect()', () => {
  const src = (over = {}) => ({
    reminders: async () => [
      { id: 'r1', message: 'Pay rent', at: at(14, 17), firedAt: null },
      { id: 'r2', message: 'Already rang', at: at(14, 9), firedAt: at(14, 9) },
      { id: 'r3', message: 'Weekly review', at: at(14, 18), kind: 'review' },
      { id: 'r4', message: 'On a site', site: 'example.com' },
    ],
    tasks: async () => [
      { noteId: 'n1', index: 0, text: 'Send CV @2026-10-14', done: false, due: at(14), noteTitle: 'Jobs' },
      { noteId: 'n1', index: 1, text: 'Undated', done: false, due: null },
      { noteId: 'n1', index: 2, text: 'Done one @2026-10-14', done: true, due: at(14) },
    ],
    events: async () => [
      { summary: 'Lecture', start: at(15, 10), end: at(15, 11), allDay: false, location: 'Hall 2', calendar: 'Uni' },
      { summary: 'Over already', start: at(14, 9), end: at(14, 10), allDay: false },
      { summary: 'Holiday', start: at(16), end: at(17), allDay: true },
    ],
    schedule: async () => [{ id: 's1', name: 'Nightly backup', at: at(14, 23) }],
    ...over,
  });

  it('reads all four stores, skips fired, review, undated and finished entries, and strips @dates', async () => {
    const { items, errors } = await D.collect(NOW, src());
    expect(errors).toEqual([]);
    expect(items.map(i => i.text).sort()).toEqual(['Holiday', 'Lecture', 'Nightly backup', 'Pay rent', 'Send CV'].sort());
    expect(items.find(i => i.text === 'Holiday').hasTime).toBe(false);
    expect(items.find(i => i.text === 'Send CV').hasTime).toBe(false);
  });

  it('names a store that cannot be read and still answers with the others', async () => {
    const { items, errors } = await D.collect(NOW, src({ reminders: async () => { throw new Error('boom'); } }));
    expect(errors).toEqual(['reminders: boom']);
    expect(items.length).toBe(4);
  });

  it('top() ranks what collect() found and reports how many there are in all', async () => {
    const r = await D.top(2, NOW, src());
    expect(r.rows).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(r.rows.map(x => x.text)).toEqual(['Pay rent', 'Nightly backup']);   // today's timed items come before the untimed task
  });
});

describe('the brief section', () => {
  it('answers null when switched off, and a bounded display payload otherwise', async () => {
    const sec = D.section();
    expect(sec.id).toBe('dueness');
    D.setEnabled(false);
    expect(await sec.build({ now: NOW })).toBe(null);
    D.setEnabled(true);
    expect(D.enabled()).toBe(true);
  });

  it('is on unless the switch says off', () => {
    expect(D.enabled()).toBe(true);
    localStorage.setItem(D.PREF, 'off');
    expect(D.enabled()).toBe(false);
  });
});
