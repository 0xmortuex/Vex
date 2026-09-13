// @vitest-environment jsdom
//
// Quick reminder: paste the task, say when.
//
// The parser is the part that can silently ruin the feature — a reminder that
// lands at the wrong hour is worse than one that refuses to be set — so it is a
// pure function of (text, now) and every case below pins a fixed clock.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexQuickReminder } = require('../../src/renderer/js/quick-reminder.js');
globalThis.VexQuickReminder = VexQuickReminder;

// Sunday 13 September 2026, 14:30 local.
const NOW = new Date(2026, 8, 13, 14, 30, 0, 0);
const at = (text, now = NOW) => VexQuickReminder.parseWhen(text, now);
const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('reading "in ..."', () => {
  it('handles minutes, hours, days and weeks', () => {
    expect(at('in 30 minutes').getTime()).toBe(new Date(2026, 8, 13, 15, 0).getTime());
    expect(at('in 2 hours').getTime()).toBe(new Date(2026, 8, 13, 16, 30).getTime());
    expect(at('in 3 days').getTime()).toBe(new Date(2026, 8, 16, 14, 30).getTime());
    expect(at('in 1 week').getTime()).toBe(new Date(2026, 8, 20, 14, 30).getTime());
  });

  it('accepts the short forms', () => {
    expect(at('in 45m').getTime()).toBe(new Date(2026, 8, 13, 15, 15).getTime());
    expect(at('in 2h').getTime()).toBe(at('in 2 hours').getTime());
    expect(at('in 1d').getTime()).toBe(at('in 1 day').getTime());
  });

  it('rejects a unit it does not know rather than guessing', () => {
    expect(() => at('in 5 fortnights')).toThrow(/not a length of time/i);
  });
});

describe('reading a day', () => {
  it('understands today and tomorrow', () => {
    expect(ymd(at('tomorrow'))).toBe('2026-09-14');
    expect(hhmm(at('tomorrow'))).toBe('09:00');          // the stated default
    expect(ymd(at('tomorrow 9am'))).toBe('2026-09-14');
    expect(hhmm(at('tomorrow 9am'))).toBe('09:00');
    expect(hhmm(at('today 6pm'))).toBe('18:00');
  });

  it('puts tonight at 8pm', () => {
    expect(hhmm(at('tonight'))).toBe('20:00');
    expect(ymd(at('tonight'))).toBe('2026-09-13');
  });

  it('reads a weekday as the next one still to come', () => {
    // NOW is a Sunday.
    expect(ymd(at('friday'))).toBe('2026-09-18');
    expect(ymd(at('monday'))).toBe('2026-09-14');
    expect(ymd(at('fri 17:00'))).toBe('2026-09-18');
    expect(hhmm(at('fri 17:00'))).toBe('17:00');
  });

  it('treats "next friday" and "friday" the same', () => {
    expect(at('next friday').getTime()).toBe(at('friday').getTime());
  });

  it('rolls to next week when today\'s slot has gone', () => {
    // NOW is Sunday 14:30, so Sunday 09:00 has been and gone: next Sunday.
    expect(ymd(at('sunday 9am'))).toBe('2026-09-20');
    // But an hour still ahead today stays today.
    expect(ymd(at('sunday 6pm'))).toBe('2026-09-13');
    // A different weekday just takes the next one.
    expect(ymd(at('wednesday 9am'))).toBe('2026-09-16');
  });

  it('takes an explicit date', () => {
    expect(ymd(at('2026-09-20 14:00'))).toBe('2026-09-20');
    expect(hhmm(at('2026-09-20 14:00'))).toBe('14:00');
    expect(hhmm(at('2026-09-20'))).toBe('09:00');
  });

  it('refuses a date that does not exist', () => {
    expect(() => at('2026-02-30')).toThrow(/not a real date/i);
  });
});

describe('reading a bare time', () => {
  it('means today when it is still ahead', () => {
    expect(ymd(at('6pm'))).toBe('2026-09-13');
    expect(hhmm(at('6pm'))).toBe('18:00');
  });

  it('means tomorrow when it has passed', () => {
    expect(ymd(at('9am'))).toBe('2026-09-14');
    expect(hhmm(at('9am'))).toBe('09:00');
  });

  it('handles both clocks and the named hours', () => {
    expect(hhmm(at('17:45'))).toBe('17:45');
    expect(hhmm(at('5:45pm'))).toBe('17:45');
    expect(hhmm(at('noon'))).toBe('12:00');
    expect(hhmm(at('midnight'))).toBe('00:00');
    expect(hhmm(at('12am'))).toBe('00:00');
    expect(hhmm(at('12pm'))).toBe('12:00');
  });

  it('ignores a leading "at" and a "remind me"', () => {
    expect(at('at 6pm').getTime()).toBe(at('6pm').getTime());
    expect(at('remind me tomorrow 9am').getTime()).toBe(at('tomorrow 9am').getTime());
  });

  it('refuses an impossible time', () => {
    expect(() => at('25:00')).toThrow(/no 25 o'clock/i);
    expect(() => at('10:75')).toThrow(/no minute 75/i);
    expect(() => at('13pm')).toThrow(/1 to 12/i);
  });
});

describe('refusing rather than guessing', () => {
  it('says so when it cannot read the text at all', () => {
    expect(() => at('sometime soonish')).toThrow(/could not read/i);
    expect(() => at('')).toThrow(/say when/i);
  });

  it('will not set a reminder in the past', () => {
    expect(() => at('2020-01-01')).toThrow(/already passed/i);
  });

  it('will not set one under a minute away, because it stores minutes', () => {
    expect(() => at('in 30 seconds')).toThrow(/not a length of time|at least a minute/i);
  });

  it('survives a DST boundary without drifting an hour', () => {
    // "tomorrow 9am" is 9am whatever the clocks do overnight. Built from
    // wall-clock fields, so this holds in any zone the test runs in.
    const eveBeforeChange = new Date(2026, 9, 24, 22, 0);
    const when = VexQuickReminder.parseWhen('tomorrow 9am', eveBeforeChange);
    expect(hhmm(when)).toBe('09:00');
    expect(ymd(when)).toBe('2026-10-25');
  });
});

describe('describing what it read back', () => {
  it('names the day in words a person would use', () => {
    expect(VexQuickReminder.describe(at('in 2 hours'), NOW)).toMatch(/^Today at 16:30/);
    expect(VexQuickReminder.describe(at('tomorrow 9am'), NOW)).toMatch(/^Tomorrow at 09:00/);
    expect(VexQuickReminder.describe(at('friday 17:00'), NOW)).toMatch(/^Friday at 17:00/);
    expect(VexQuickReminder.describe(at('in 3 weeks'), NOW)).toMatch(/^4 Oct at 14:30/);
  });

  it('says how far away it is', () => {
    expect(VexQuickReminder.describe(at('in 30 minutes'), NOW)).toContain('30 minutes from now');
    expect(VexQuickReminder.describe(at('in 2 hours'), NOW)).toContain('2 hours from now');
  });
});

describe('creating the task', () => {
  let created;
  beforeEach(() => {
    created = [];
    globalThis.Scheduler = { createTask: vi.fn(t => { created.push(t); return { id: 'task_1', ...t }; }) };
    global.window.Scheduler = globalThis.Scheduler;
    global.window.showToast = vi.fn();
  });

  it('writes a one-off reminder the existing Scheduler owns', () => {
    VexQuickReminder.create('Email the landlord about the boiler', at('tomorrow 9am'));
    expect(created).toHaveLength(1);
    const t = created[0];
    expect(t.schedule).toMatchObject({ type: 'once', date: '2026-09-14', time: '09:00' });
    expect(t.action).toEqual({ type: 'reminder', message: 'Email the landlord about the boiler' });
  });

  it('names the task from the first line, so the notification has a title', () => {
    VexQuickReminder.create('Call the dentist\nask about the referral', at('tomorrow'));
    expect(created[0].name).toBe('Call the dentist');
  });

  it('shortens a very long first line rather than using it whole', () => {
    VexQuickReminder.create('x'.repeat(200), at('tomorrow'));
    expect(created[0].name.length).toBeLessThanOrEqual(60);
    expect(created[0].name.endsWith('…')).toBe(true);
  });

  it('catches up a reminder missed while Vex was closed', () => {
    VexQuickReminder.create('Something', at('tomorrow'));
    expect(created[0].catchUp).toBe(true);
    expect(created[0].catchUpWindowMin).toBeGreaterThan(60);
  });

  it('refuses an empty message instead of setting a blank reminder', () => {
    expect(() => VexQuickReminder.create('   ', at('tomorrow'))).toThrow(/write what/i);
    expect(created).toHaveLength(0);
  });

  it('says so when the scheduler is not there', () => {
    delete globalThis.Scheduler; delete global.window.Scheduler;
    expect(() => VexQuickReminder.create('x', at('tomorrow'))).toThrow(/scheduler is not available/i);
  });
});

describe('the dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.Scheduler = { createTask: vi.fn(t => ({ id: 't', ...t })) };
    global.window.Scheduler = globalThis.Scheduler;
    global.window.showToast = vi.fn();
  });

  it('opens with both fields and the quick choices', () => {
    VexQuickReminder.open();
    expect(document.getElementById('qr-text')).toBeTruthy();
    expect(document.getElementById('qr-when')).toBeTruthy();
    expect(document.querySelectorAll('.qr-chip').length).toBeGreaterThan(2);
  });

  it('pre-fills the task when text was selected', () => {
    VexQuickReminder.open('Write the report');
    expect(document.getElementById('qr-text').value).toBe('Write the report');
  });

  it('shows what it understood as you type', () => {
    VexQuickReminder.open();
    const when = document.getElementById('qr-when');
    when.value = 'in 2 hours';
    when.dispatchEvent(new Event('input'));
    const preview = document.getElementById('qr-preview');
    expect(preview.textContent).toMatch(/at \d{2}:\d{2}/);
    expect(preview.className).toContain('qr-ok');
  });

  it('shows the reason when it cannot read the time', () => {
    VexQuickReminder.open();
    const when = document.getElementById('qr-when');
    when.value = 'whenever';
    when.dispatchEvent(new Event('input'));
    const preview = document.getElementById('qr-preview');
    expect(preview.textContent).toMatch(/could not read/i);
    expect(preview.className).toContain('qr-bad');
  });

  it('a chip fills the when box', () => {
    VexQuickReminder.open();
    document.querySelector('.qr-chip').click();
    expect(document.getElementById('qr-when').value).toBeTruthy();
  });

  it('saves and closes', () => {
    VexQuickReminder.open('Pay the invoice');
    document.getElementById('qr-when').value = 'tomorrow 9am';
    document.getElementById('qr-save').click();
    expect(globalThis.Scheduler.createTask).toHaveBeenCalled();
    expect(document.getElementById('vex-quick-reminder')).toBe(null);
  });

  it('will not save without a message, and stays open to say so', () => {
    VexQuickReminder.open();
    document.getElementById('qr-when').value = 'tomorrow';
    document.getElementById('qr-save').click();
    expect(globalThis.Scheduler.createTask).not.toHaveBeenCalled();
    expect(document.getElementById('vex-quick-reminder')).toBeTruthy();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/write what/i), 'error');
  });

  it('will not save an unreadable time, and stays open', () => {
    VexQuickReminder.open('Something');
    document.getElementById('qr-when').value = 'later maybe';
    document.getElementById('qr-save').click();
    expect(globalThis.Scheduler.createTask).not.toHaveBeenCalled();
    expect(document.getElementById('vex-quick-reminder')).toBeTruthy();
  });

  it('replaces an already-open dialog rather than stacking them', () => {
    VexQuickReminder.open();
    VexQuickReminder.open();
    expect(document.querySelectorAll('#vex-quick-reminder').length).toBe(1);
  });
});
