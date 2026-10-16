// @vitest-environment jsdom
//
// T1-022: deadlines and promises found in text, each proposed as a reminder
// the user confirms (js/deadline-extractor.js). Fixed patterns, no AI.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let D;
// Wednesday 14 October 2026, 10:00.
const NOW = new Date(2026, 9, 14, 10, 0).getTime();
const when = (y, mo, d, h = 17) => new Date(y, mo, d, h, 0).getTime();

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  ({ VexDeadlines: D } = fresh(JS + 'deadline-extractor.js'));
});

const one = (text) => { const r = D.extract(text, NOW); expect(r, text).toHaveLength(1); return r[0]; };

describe('extract(): weekdays', () => {
  it('reads "by Friday" as the coming Friday at 17:00, reminding at 09:00 that morning', () => {
    const f = one('Please send the form by Friday.');
    expect(f.kind).toBe('deadline');
    expect(f.dueAt).toBe(when(2026, 9, 16));
    expect(f.remindAt).toBe(when(2026, 9, 16, 9));
    expect(f.sentence).toBe('Please send the form by Friday.');
  });
  it('reads "free until Thursday", "due Monday" and "before next Wednesday"', () => {
    expect(one('The trial is free until Thursday.').dueAt).toBe(when(2026, 9, 15));
    expect(one('Essay due Monday').dueAt).toBe(when(2026, 9, 19));
    expect(one('Reply before next Wednesday').dueAt).toBe(when(2026, 9, 21));
  });
  it('treats the same weekday as today, and "next" as a week on', () => {
    expect(one('Hand it in by Wednesday').dueAt).toBe(when(2026, 9, 14));
  });
});

describe('extract(): relative words and dates', () => {
  it('reads tomorrow, today and tonight', () => {
    expect(one('Due tomorrow, do not forget').dueAt).toBe(when(2026, 9, 15));
    expect(one('Submit by end of day').dueAt).toBe(when(2026, 9, 14));
    expect(one('Open until tonight').dueAt).toBe(when(2026, 9, 14, 21));
  });
  it('reads "registration closes 3 Nov" and "deadline is October 30th"', () => {
    const f = one('Registration closes 3 Nov for all delegates.');
    expect(f.dueAt).toBe(when(2026, 10, 3));
    expect(f.remindAt).toBe(when(2026, 10, 3, 9));
    expect(one('The deadline is October 30th').dueAt).toBe(when(2026, 9, 30));
  });
  it('rolls a month and day already past into next year, and honours an explicit year', () => {
    expect(one('Closes 2 Mar').dueAt).toBe(when(2027, 2, 2));
    expect(one('Closes 2 Mar 2028').dueAt).toBe(when(2028, 2, 2));
  });
  it('reads an ISO date and "due in 3 days"', () => {
    expect(one('Due on 2026-11-01').dueAt).toBe(when(2026, 10, 1));
    expect(one('Due in 3 days').dueAt).toBe(when(2026, 9, 17));
  });
  it('ignores a date without a deadline word, an impossible date and one in the past', () => {
    expect(D.extract('Published 12 Oct 2026 by the committee.', NOW)).toEqual([]);
    expect(D.extract('Closes 31 Feb', NOW)).toEqual([]);
    expect(D.extract('Due 2026-10-01', NOW)).toEqual([]);
    expect(D.extract('Nothing to see here.', NOW)).toEqual([]);
  });
});

describe('extract(): commitments', () => {
  it("finds \"I'll send it tomorrow\" and keeps the sentence", () => {
    const f = one("Thanks. I'll send the slides tomorrow.");
    expect(f.kind).toBe('commitment');
    expect(f.dueAt).toBe(when(2026, 9, 15));
    expect(f.sentence).toBe("I'll send the slides tomorrow.");
    expect(f.phrase.toLowerCase()).toContain('tomorrow');
  });
  it('finds "I will call you on Friday" and "I can do it next week"', () => {
    expect(one('I will call you on Friday').dueAt).toBe(when(2026, 9, 16));
    expect(one('I can do it next week').dueAt).toBe(when(2026, 9, 19));
  });
  it('gives one finding for a sentence that two patterns match', () => {
    expect(D.extract("I'll finish it by Friday.", NOW)).toHaveLength(1);
  });
});

describe('remindAt()', () => {
  it('is 09:00 on a later day, an hour before when due today, and null once too late', () => {
    expect(D.remindAt(when(2026, 9, 20), NOW)).toBe(when(2026, 9, 20, 9));
    expect(D.remindAt(when(2026, 9, 14), NOW)).toBe(when(2026, 9, 14, 16));
    expect(D.remindAt(NOW + 5 * 60000, NOW)).toBe(null);
    expect(D.remindAt(NOW - 1, NOW)).toBe(null);
    expect(D.remindAt(NaN, NOW)).toBe(null);
  });
});

describe('bounds', () => {
  it('keeps at most twenty findings and reads at most 60000 characters', () => {
    const many = Array.from({ length: 40 }, (_, i) => 'Send item ' + i + ' by Friday.').join(' ');
    expect(D.extract(many, NOW)).toHaveLength(20);
    expect(D.extract('x'.repeat(70000) + ' send by Friday.', NOW)).toEqual([]);
  });
});

describe('sources', () => {
  it('reads recent notes, and refuses an unreadable store', () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'a', title: 'Todo', content: 'Pay by Friday', updatedAt: new Date(NOW).toISOString() }]));
    expect(D.extract(D.fromNotes().text, NOW)).toHaveLength(1);
    localStorage.setItem('vex.notes', '{bad');
    expect(() => D.fromNotes()).toThrow(/notes could not be read/);
  });
  it('asks for a mail account before reading any subject', async () => {
    window.vex = { mail: { inbox: vi.fn() } };
    await expect(D.fromMail()).rejects.toThrow(/Choose a mail account/);
    expect(window.vex.mail.inbox).not.toHaveBeenCalled();
  });
});
