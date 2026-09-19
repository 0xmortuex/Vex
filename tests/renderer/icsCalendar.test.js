// @vitest-environment jsdom
//
// Calendars you subscribe to by their iCal address: parsed, repeats expanded,
// moved and cancelled occurrences honoured, and a rule Vex cannot expand
// shown once and said — never guessed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { IcsCalendar: C } = require('../../src/renderer/js/ics-calendar.js');

const ics = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const day = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

beforeEach(() => { C._noted.clear(); window.VexProblems = { note: vi.fn() }; });

describe('reading an iCal calendar', () => {
  it('times in UTC, in a named zone, all-day, and folded, escaped text', () => {
    const [a, b, c] = C.parse(ics(
      ['UID:1', 'DTSTART:20260921T130000Z', 'DTEND:20260921T140000Z', 'SUMMARY:Standup\\, team', 'LOCATION:Room 4'],
      ['UID:2', 'DTSTART;TZID=America/New_York:20260921T090000', 'DTEND;TZID=America/New_York:20260921T100000', 'SUMMARY:Very long title that', ' continues on the next line'],
      ['UID:3', 'DTSTART;VALUE=DATE:20260922', 'DTEND;VALUE=DATE:20260923', 'SUMMARY:Holiday'],
    ));
    expect(a).toMatchObject({ start: Date.UTC(2026, 8, 21, 13), end: Date.UTC(2026, 8, 21, 14), summary: 'Standup, team', location: 'Room 4', allDay: false });
    expect(b.start).toBe(Date.UTC(2026, 8, 21, 13));          // 09:00 New York (EDT, -4) is 13:00 UTC
    expect(b.summary).toBe('Very long title thatcontinues on the next line');
    expect(c).toMatchObject({ start: day(2026, 9, 22), end: day(2026, 9, 23), allDay: true });
  });

  it('a clock change is honoured: 09:00 New York in December is 14:00 UTC', () => {
    const [e] = C.parse(ics(['DTSTART;TZID=America/New_York:20261221T090000', 'SUMMARY:x']));
    expect(e.start).toBe(Date.UTC(2026, 11, 21, 14));
  });

  it('a zone this computer does not know is read as local time, and said once', () => {
    const [e] = C.parse(ics(['DTSTART;TZID=W. Europe Standard Time:20260921T090000', 'SUMMARY:x']));
    expect(e.start).toBe(day(2026, 9, 21, 9));
    expect(window.VexProblems.note).toHaveBeenCalledWith('Calendar', expect.stringMatching(/Unknown time zone "W\. Europe Standard Time"/));
  });

  it('cancelled events are left out', () => {
    expect(C.parse(ics(['DTSTART:20260921T130000Z', 'STATUS:CANCELLED', 'SUMMARY:x']))).toEqual([]);
  });
});

describe('repeats', () => {
  const week = [day(2026, 9, 21), day(2026, 10, 5)];
  it('weekly on set days, with an exception', () => {
    const [e] = C.parse(ics([`DTSTART:20260921T090000`, 'DTEND:20260921T093000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE:20260923T090000', 'SUMMARY:Gym']));
    const got = C.expand(e, ...week).map(o => new Date(o.start).getDate());
    expect(got).toEqual([21, 28, 30]);                      // Mon 21, (Wed 23 skipped), Mon 28, Wed 30
  });

  it('daily with a count, and every other day', () => {
    const [a] = C.parse(ics(['DTSTART:20260921T080000', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:a']));
    expect(C.expand(a, ...week).map(o => new Date(o.start).getDate())).toEqual([21, 22, 23]);
    const [b] = C.parse(ics(['DTSTART:20260921T080000', 'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20260926T235959Z', 'SUMMARY:b']));
    expect(C.expand(b, ...week).map(o => new Date(o.start).getDate())).toEqual([21, 23, 25]);
  });

  it('monthly and yearly keep the date', () => {
    const [m] = C.parse(ics(['DTSTART:20260115T100000', 'RRULE:FREQ=MONTHLY', 'SUMMARY:rent']));
    expect(C.expand(m, day(2026, 9, 1), day(2026, 11, 1)).map(o => new Date(o.start).getMonth() + 1)).toEqual([9, 10]);
    const [y] = C.parse(ics(['DTSTART;VALUE=DATE:20100923', 'RRULE:FREQ=YEARLY', 'SUMMARY:birthday']));
    expect(C.expand(y, ...week).map(o => new Date(o.start).getFullYear())).toEqual([2026]);
  });

  it('a rule it cannot expand is shown once and said, not guessed', () => {
    const [e] = C.parse(ics(['DTSTART:20260921T090000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:Board']));
    expect(C.expand(e, ...week)).toHaveLength(1);
    expect(window.VexProblems.note).toHaveBeenCalledWith('Calendar', expect.stringMatching(/cannot expand \("Board"/));
  });

  it('a moved occurrence replaces the one it moved', () => {
    localStorage.setItem(C.KEY, JSON.stringify([{ url: 'https://c.example/a.ics', name: 'Work' }]));
    C._events.set('https://c.example/a.ics', C.parse(ics(
      ['UID:s', 'DTSTART:20260921T090000', 'DTEND:20260921T100000', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Sync'],
      ['UID:s', 'RECURRENCE-ID:20260922T090000', 'DTSTART:20260922T150000', 'DTEND:20260922T160000', 'SUMMARY:Sync (moved)'],
    )));
    const got = C.between(...week).map(o => [new Date(o.start).getDate(), new Date(o.start).getHours(), o.summary, o.calendar]);
    expect(got).toEqual([[21, 9, 'Sync', 'Work'], [22, 15, 'Sync (moved)', 'Work'], [23, 9, 'Sync', 'Work']]);
  });
});

describe('subscribing', () => {
  it('takes webcal:// and https:// addresses, not anything else, and not twice', () => {
    localStorage.clear();
    expect(C.add('webcal://c.example/x.ics', 'Home')).toBe('https://c.example/x.ics');
    expect(() => C.add('https://c.example/x.ics')).toThrow('already added');
    expect(() => C.add('calendar please')).toThrow(/iCal address/);
  });

  it('a calendar that cannot be read says why', async () => {
    localStorage.setItem(C.KEY, JSON.stringify([{ url: 'https://c.example/gone.ics', name: 'Old' }]));
    window.vex = { calendarFetch: vi.fn(async () => ({ ok: false, error: 'the address no longer exists (404)' })) };
    await C.refresh();
    expect(C.errors()).toEqual([{ name: 'Old', error: 'the address no longer exists (404)' }]);
  });
});
