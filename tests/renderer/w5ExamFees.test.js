// @vitest-environment jsdom
// T2-085: the fee cutoff and the late window on a typed or imported date. Vex still ships no dates of its own.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let E, reminders;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  globalThis.VexLifeKit = fresh(JS + 'life-kit.js').VexLifeKit;
  reminders = [];
  window.vex = { reminders: { create: vi.fn(async (message, at) => { const id = 'r' + (reminders.length + 1); reminders.push({ id, message, at }); return { id }; }), delete: vi.fn(async () => ({})) } };
  window.vexConfirm = vi.fn(async () => true);
  window.VexProblems = { note: vi.fn() };
  E = globalThis.ExamCalendar = window.ExamCalendar = fresh(JS + 'exam-calendar.js').ExamCalendar;
});

describe('fields', () => {
  it('keeps the fee day and the late window, checked', () => {
    const it1 = E.clean({ title: 'YKS', day: '2027-02-02', endDay: '2027-02-08', feeDay: '2027-01-20', lateStart: '2027-02-09', lateEnd: '2027-02-12' });
    expect(it1).toMatchObject({ feeDay: '2027-01-20', lateStart: '2027-02-09', lateEnd: '2027-02-12' });
    expect(E.clean({ title: 'x', day: '2027-02-02' })).toMatchObject({ feeDay: '', lateStart: '', lateEnd: '' });
    expect(E.clean({ title: 'x', day: '2027-02-02', lateStart: '2027-02-09' }).lateEnd).toBe('2027-02-09');
    expect(() => E.clean({ title: 'x', day: '2027-02-02', feeDay: '20.01.2027' })).toThrow(/fee cutoff day/);
    expect(() => E.clean({ title: 'x', day: '2027-02-02', lateEnd: '2027-02-12' })).toThrow(/first late day/);
    expect(() => E.clean({ title: 'x', day: '2027-02-02', lateStart: '2027-02-12', lateEnd: '2027-02-09' })).toThrow(/before the first/);
  });
  it('ships no dates by itself', () => {
    expect(E.all()).toEqual([]);
    expect(E.sorted()).toEqual([]);
  });
});

describe('reading them from a description', () => {
  it('picks out ISO and day-first dates, and nothing it has to guess', () => {
    expect(E.datesFromText('Fee until 2027-01-20. Late application 10.02.2027 - 15.02.2027')).toEqual({ feeDay: '2027-01-20', lateStart: '2027-02-10', lateEnd: '2027-02-15' });
    expect(E.datesFromText('Harç son gün 20/01/2027')).toMatchObject({ feeDay: '2027-01-20' });
    expect(E.datesFromText('Late registration 2027-02-10')).toEqual({ feeDay: '', lateStart: '2027-02-10', lateEnd: '' });
    expect(E.datesFromText('Fee 2027-13-45')).toEqual({ feeDay: '', lateStart: '', lateEnd: '' });
    expect(E.datesFromText('Bring your ID')).toEqual({ feeDay: '', lateStart: '', lateEnd: '' });
  });
  it('an imported event carries them', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:z', 'SUMMARY:Registration', 'DTSTART;VALUE=DATE:20270202', 'DESCRIPTION:Fee until 2027-01-20. Late application 2027-02-09 to 2027-02-12', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    expect(E.parseIcs(ics)[0]).toMatchObject({ feeDay: '2027-01-20', lateStart: '2027-02-09', lateEnd: '2027-02-12' });
  });
});

describe('reminders', () => {
  it('also remind about the fee cutoff and the late window, only for mornings still ahead', async () => {
    const now = new Date(2027, 0, 10, 10).getTime();
    await E.add({ title: 'YKS', kind: 'application', body: 'osym', day: '2027-02-02', feeDay: '2027-01-20', lateStart: '2027-02-09', lateEnd: '2027-02-12' }, { now });
    const msgs = reminders.map(r => r.message);
    expect(msgs.some(m => /normal fee ends/.test(m))).toBe(true);
    expect(msgs.some(m => /late window opens/.test(m))).toBe(true);
    expect(msgs.some(m => /late window closes/.test(m))).toBe(true);
    expect(reminders.every(r => r.at > now)).toBe(true);
  });
});
