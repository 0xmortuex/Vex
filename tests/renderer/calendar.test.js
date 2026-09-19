// @vitest-environment jsdom
//
// Calendar: reminders and dated to-dos on the days they fall, with repeating
// reminders on every day they repeat.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
require('../../src/renderer/js/open-tasks.js');
const { Calendar } = require('../../src/renderer/js/calendar.js');

const at = (y, m, d, h = 9, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const SEP_FROM = at(2026, 9, 1, 0), SEP_TO = at(2026, 10, 1, 0);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
});

describe('the month grid', () => {
  it('whole weeks, starting on the locale first weekday', () => {
    const mon = Calendar.grid(2026, 8, 1);                 // September 2026, weeks from Monday
    expect(Calendar.dayKey(mon[0])).toBe('2026-08-31');
    expect(mon.length % 7).toBe(0);
    expect(Calendar.dayKey(mon[mon.length - 1])).toBe('2026-10-04');
    const sun = Calendar.grid(2026, 8, 0);                 // weeks from Sunday
    expect(Calendar.dayKey(sun[0])).toBe('2026-08-30');
    expect(sun[0].getDay()).toBe(0);
  });

  it('reads the first weekday from the locale', () => {
    const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language');
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    expect(Calendar.firstWeekday()).toBe(0);
    Object.defineProperty(navigator, 'language', { value: 'en-GB', configurable: true });
    expect(Calendar.firstWeekday()).toBe(1);
    delete navigator.language;
    if (d) Object.defineProperty(Navigator.prototype, 'language', d);
  });
});

describe('reminders on the calendar', () => {
  it('a one-off falls on its day', () => {
    expect(Calendar.occurrences({ at: at(2026, 9, 10) }, SEP_FROM, SEP_TO)).toEqual([at(2026, 9, 10)]);
    expect(Calendar.occurrences({ at: at(2026, 10, 10) }, SEP_FROM, SEP_TO)).toEqual([]);
  });

  it('a repeating one appears every time it will repeat', () => {
    expect(Calendar.occurrences({ at: at(2026, 9, 24), repeat: 'daily' }, SEP_FROM, SEP_TO)).toHaveLength(7);
    expect(Calendar.occurrences({ at: at(2026, 9, 1), repeat: 'weekly' }, SEP_FROM, SEP_TO).map(t => new Date(t).getDate())).toEqual([1, 8, 15, 22, 29]);
    const wd = Calendar.occurrences({ at: at(2026, 9, 25), repeat: 'weekdays' }, SEP_FROM, SEP_TO).map(t => new Date(t).getDate());
    expect(wd).toEqual([25, 28, 29, 30]);                 // Fri, then Mon–Wed
    const set = Calendar.occurrences({ at: at(2026, 9, 21), repeat: [1, 3] }, SEP_FROM, SEP_TO).map(t => new Date(t).getDate());
    expect(set).toEqual([21, 23, 28, 30]);                // Mondays and Wednesdays
  });

  it('a site reminder has no day', () => {
    expect(Calendar.occurrences({ site: 'github.com' }, SEP_FROM, SEP_TO)).toEqual([]);
  });

  it('alarms and timers stay on the clock', () => {
    const byDay = Calendar.collect({ reminders: [{ id: 'a', kind: 'alarm', message: 'Wake', at: at(2026, 9, 5), repeat: 'daily' }, { id: 'r', message: 'Dentist', at: at(2026, 9, 5, 14) }], tasks: [], from: SEP_FROM, to: SEP_TO });
    expect([...byDay.values()].flat().map(x => x.text)).toEqual(['Dentist']);
  });
});

describe('to-dos on the calendar', () => {
  it('dated to-dos fall on their day, without the date tag', () => {
    const tasks = window.OpenTasks.collect([{ id: 'n', title: 'Car', content: '- [ ] MOT @2026-09-12\n- [x] Tax @2026-09-12\n- [ ] Undated' }], { includeDone: true, now: new Date(2026, 8, 1) });
    const byDay = Calendar.collect({ reminders: [], tasks, from: SEP_FROM, to: SEP_TO });
    expect(byDay.get('2026-09-12').map(x => [x.text, x.done])).toEqual([['MOT', false], ['Tax', true]]);
    expect(byDay.size).toBe(1);
  });

  it('reminders come before to-dos, in time order', () => {
    const tasks = window.OpenTasks.collect([{ id: 'n', title: 'x', content: '- [ ] Pay @2026-09-12' }], { now: new Date(2026, 8, 1) });
    const byDay = Calendar.collect({ reminders: [{ id: 'b', message: 'Late', at: at(2026, 9, 12, 18) }, { id: 'a', message: 'Early', at: at(2026, 9, 12, 8) }], tasks, from: SEP_FROM, to: SEP_TO });
    expect(byDay.get('2026-09-12').map(x => x.text)).toEqual(['Early', 'Late', 'Pay']);
  });
});

describe('the sheet', () => {
  it('shows the month, and adding a reminder on a future day goes through the reminders API', async () => {
    const created = [];
    window.vex = { reminders: { list: async () => [], create: vi.fn(async (msg, when) => { created.push([msg, when]); return { id: 'x' }; }) } };
    await Calendar.open();
    const o = document.querySelector('.vex-calendar-overlay');
    expect(o.querySelectorAll('[data-day]').length % 7).toBe(0);
    // Pick a day in the future: tomorrow.
    const t = new Date(); t.setDate(t.getDate() + 1);
    const key = Calendar.dayKey(t);
    o.querySelector(`[data-day="${key}"]`) ? o.querySelector(`[data-day="${key}"]`).click() : o.querySelector('[data-next]').click();
    await new Promise(r => setTimeout(r, 0));
    if (!document.querySelector(`.vex-calendar-overlay [data-day="${key}"][aria-selected="true"]`)) document.querySelector(`.vex-calendar-overlay [data-day="${key}"]`).click();
    await new Promise(r => setTimeout(r, 0));
    const form = document.querySelector('.vex-calendar-overlay [data-remind]');
    form.querySelector('[data-text]').value = 'Call the bank';
    form.querySelector('[data-time]').value = '10:30';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(created).toEqual([['Call the bank', new Date(t.getFullYear(), t.getMonth(), t.getDate(), 10, 30).getTime()]]);
  });

  it('a past day cannot be given a reminder', async () => {
    window.vex = { reminders: { list: async () => [], create: vi.fn() } };
    await Calendar.open();
    document.querySelector('.vex-calendar-overlay [data-prev]').click();
    await new Promise(r => setTimeout(r, 0));
    const past = document.querySelector('.vex-calendar-overlay [data-day]');
    past.click();
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelector('.vex-calendar-overlay [data-remind]')).toBeNull();
  });
});
