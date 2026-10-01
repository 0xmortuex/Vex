// Subscribed calendars (found 2026-09-29): a repeating New York meeting seen
// from Istanbul was an hour off from March to November, because repeats were
// stepped in the viewer's clock; BYMONTHDAY and BYMONTH were ignored; and a
// quoted ':' in a parameter cut the property value short. The zone is forced
// before the module loads so the answer does not depend on the machine.
process.env.TZ = 'Europe/Istanbul';

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
globalThis.window = globalThis.window || {};
const { IcsCalendar: C } = req('../../src/renderer/js/ics-calendar.js');

const ics = (rrule, start, extra = '') => 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:T\r\n' + start + '\r\n'
  + (rrule ? 'RRULE:' + rrule + '\r\n' : '') + extra + 'END:VEVENT\r\nEND:VCALENDAR';
const starts = (text, from, to) => C.expand(C.parse(text)[0], from, to).map(o => o.start);

beforeEach(() => { C._noted.clear(); });

describe('repeats keep the event\'s own clock', () => {
  it('a weekly 09:00 New York meeting is 09:00 New York in winter and in summer', () => {
    const text = ics('FREQ=WEEKLY', 'DTSTART;TZID=America/New_York:20260105T090000');
    expect(starts(text, Date.UTC(2026, 0, 12), Date.UTC(2026, 0, 13))).toEqual([C._zoned(2026, 1, 12, 9, 0, 0, 'America/New_York')]);
    expect(starts(text, Date.UTC(2026, 6, 6), Date.UTC(2026, 6, 7))).toEqual([C._zoned(2026, 7, 6, 9, 0, 0, 'America/New_York')]);
  });

  it('a UTC event stays on UTC', () => {
    const text = ics('FREQ=DAILY', 'DTSTART:20260101T080000Z');
    expect(starts(text, Date.UTC(2026, 6, 1), Date.UTC(2026, 6, 2))).toEqual([Date.UTC(2026, 6, 1, 8)]);
  });

  it('an EXDATE in the event\'s zone still takes its occurrence out', () => {
    const text = ics('FREQ=WEEKLY;COUNT=3', 'DTSTART;TZID=Europe/Paris:20260105T090000', 'EXDATE;TZID=Europe/Paris:20260112T090000\r\n');
    expect(starts(text, Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)).length).toBe(2);
  });
});

describe('BYMONTHDAY and BYMONTH', () => {
  it('a monthly repeat on another day of the month than the first', () => {
    const got = starts(ics('FREQ=MONTHLY;BYMONTHDAY=15', 'DTSTART:20260101T100000'), Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 30));
    expect(got.map(t => new Date(t).getDate())).toEqual([15, 15, 15, 15]);
  });

  it('a yearly repeat in the months BYMONTH names', () => {
    const got = starts(ics('FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=4', 'DTSTART:20260104T100000'), Date.UTC(2026, 0, 1), Date.UTC(2027, 11, 31));
    expect(got.map(t => new Date(t).getMonth() + '/' + new Date(t).getDate())).toEqual(['0/4', '6/4', '0/4', '6/4']);
  });

  it('BYMONTH limits a daily repeat to those months', () => {
    const got = starts(ics('FREQ=DAILY;BYMONTH=3', 'DTSTART:20260227T100000'), Date.UTC(2026, 1, 26), Date.UTC(2026, 2, 3));
    expect(got.map(t => new Date(t).getMonth())).toEqual([2, 2]);
  });

  it('what it cannot expand is shown once, not wrongly', () => {
    const got = starts(ics('FREQ=MONTHLY;BYMONTHDAY=-1', 'DTSTART:20260131T100000'), Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31));
    expect(got.length).toBe(1);
  });
});

describe('a quoted colon in a parameter', () => {
  it('does not cut the value short', () => {
    const ev = C.parse(ics(null, 'DTSTART:20260101T090000Z', 'LOCATION;ALTREP="http://x.example/r":Room 5\r\n'))[0];
    expect(ev.location).toBe('Room 5');
  });
});

describe('a once-task made without a date', () => {
  it('is dated today where the user is, not in UTC', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 1, 30));   // 01:30 in Istanbul is still the 28th in UTC
    try {
      const Scheduler = req('../../src/renderer/js/scheduler.js');
      expect(Scheduler._normalizeSchedule({ type: 'once' }).date).toBe('2026-09-29');
    } finally { vi.useRealTimers(); }
  });
});
