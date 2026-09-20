// "every weekday at 8:30" → a schedule the engine runs. This is what the
// agent uses to set something up, so getting a time wrong here means
// something running at the wrong hour every day. It refuses rather than
// guesses.
import { describe, it, expect } from 'vitest';
const { ScheduleWords: W } = require('../../src/renderer/js/schedule-words.js');

describe('the time of day', () => {
  it('reads the ways people write one', () => {
    expect(W.time('at 8:30')).toBe('08:30');
    expect(W.time('at 9am')).toBe('09:00');
    expect(W.time('at 9 pm')).toBe('21:00');
    expect(W.time('at 12am')).toBe('00:00');
    expect(W.time('at 12pm')).toBe('12:00');
    expect(W.time('at 17.45')).toBe('17:45');
  });

  it('understands a time that is named rather than given', () => {
    expect(W.time('every morning')).toBe('09:00');
    expect(W.time('in the evening')).toBe('19:00');
    expect(W.time('at midnight')).toBe('00:00');
  });

  it('refuses something that is not a time', () => {
    expect(W.time('at 25:00')).toBe(null);
    expect(W.time('at 10:75')).toBe(null);
    expect(W.time('soon')).toBe(null);
  });
});

describe('the days', () => {
  it('weekdays, weekends and named days', () => {
    expect(W.days('every weekday')).toEqual([1, 2, 3, 4, 5]);
    expect(W.days('at the weekend')).toEqual([0, 6]);
    expect(W.days('on mondays and thursdays')).toEqual([1, 4]);
    expect(W.days('every day')).toBe(null);
  });
});

describe('how often', () => {
  it('every N minutes or hours', () => {
    expect(W.everyMinutes('every 30 minutes')).toBe(30);
    expect(W.everyMinutes('every 2 hours')).toBe(120);
    expect(W.everyMinutes('hourly')).toBe(60);
    expect(W.everyMinutes('every morning')).toBe(null);
  });
});

describe('the whole thing', () => {
  it('every morning at 9', () => {
    expect(W.parse('every morning at 9')).toEqual({ type: 'daily', time: '09:00' });
  });

  it('every weekday at 8:30', () => {
    expect(W.parse('every weekday at 8:30')).toEqual({ type: 'weekly', time: '08:30', daysOfWeek: [1, 2, 3, 4, 5] });
  });

  it('on the 1st at 10:00', () => {
    expect(W.parse('on the 1st at 10:00')).toEqual({ type: 'monthly', time: '10:00', dayOfMonth: 1 });
  });

  it('every 30 minutes', () => {
    expect(W.parse('every 30 minutes')).toEqual({ type: 'interval', intervalMinutes: 30 });
  });

  it('says what is missing rather than picking an hour', () => {
    expect(() => W.parse('every weekday')).toThrow(/does not say what time/);
    expect(() => W.parse('')).toThrow(/Say when/);
    expect(() => W.parse('sometimes')).toThrow(/what time/);
  });
});

describe('read back in words', () => {
  it('says what was set up', () => {
    expect(W.describe({ type: 'daily', time: '09:00' })).toBe('every day at 09:00');
    expect(W.describe({ type: 'weekly', time: '08:30', daysOfWeek: [1, 2, 3, 4, 5] })).toBe('every weekday at 08:30');
    expect(W.describe({ type: 'weekly', time: '20:00', daysOfWeek: [0] })).toBe('Sunday at 20:00');
    expect(W.describe({ type: 'interval', intervalMinutes: 30 })).toBe('every 30 minutes');
    expect(W.describe({ type: 'interval', intervalMinutes: 120 })).toBe('every 2 hours');
    expect(W.describe({ type: 'monthly', time: '10:00', dayOfMonth: 1 })).toBe('on the 1st at 10:00');
  });
});
