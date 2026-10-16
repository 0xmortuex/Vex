// @vitest-environment jsdom
//
// js/game-timers.js (T3-046): reset and season timers the person types in.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexGameTimers } = require('../../src/renderer/js/game-timers.js');

// Wednesday 14 October 2026, 10:30 UTC.
const NOW = Date.UTC(2026, 9, 14, 10, 30);
let reminders;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  reminders = [];
  window.vex = { reminders: {
    create: vi.fn(async (message, at, extra) => { const r = { id: 'r' + (reminders.length + 1), message, at, ...(extra || {}) }; reminders.push(r); return r; }),
    list: vi.fn(async () => reminders.slice()),
    delete: vi.fn(async (id) => { reminders = reminders.filter(r => r.id !== id); }),
  } };
});

describe('when a timer happens', () => {
  it('finds the next daily reset on the UTC clock', () => {
    const t = VexGameTimers.clean({ name: 'Daily reset', kind: 'daily', time: '00:00', tz: 'utc' });
    expect(VexGameTimers.next(t, NOW)).toBe(Date.UTC(2026, 9, 15, 0, 0));
    const later = VexGameTimers.clean({ name: 'x', kind: 'daily', time: '18:00', tz: 'utc' });
    expect(VexGameTimers.next(later, NOW)).toBe(Date.UTC(2026, 9, 14, 18, 0));
  });
  it('finds the next weekly reset, today if it is still ahead', () => {
    const tue = VexGameTimers.clean({ name: 'Weekly', kind: 'weekly', dow: 2, time: '00:00', tz: 'utc' });
    expect(VexGameTimers.next(tue, NOW)).toBe(Date.UTC(2026, 9, 20, 0, 0));      // next Tuesday
    const wed = VexGameTimers.clean({ name: 'Weekly', kind: 'weekly', dow: 3, time: '12:00', tz: 'utc' });
    expect(VexGameTimers.next(wed, NOW)).toBe(Date.UTC(2026, 9, 14, 12, 0));      // today
    const wedPast = VexGameTimers.clean({ name: 'Weekly', kind: 'weekly', dow: 3, time: '09:00', tz: 'utc' });
    expect(VexGameTimers.next(wedPast, NOW)).toBe(Date.UTC(2026, 9, 21, 9, 0));   // a week on
  });
  it('counts down a one-off season end and says when it has passed', () => {
    const t = VexGameTimers.clean({ name: 'Season ends', kind: 'once', at: NOW + 3 * 86400000 + 4 * 3600000 });
    expect(VexGameTimers.line(t, NOW)).toBe('Season ends in 3 d 4 h');
    expect(VexGameTimers.next(t, NOW + 10 * 86400000)).toBeNull();
    expect(VexGameTimers.line(t, NOW + 10 * 86400000)).toBe('Season ends has passed');
  });
  it('reads a local-clock timer on the local clock', () => {
    const t = VexGameTimers.clean({ name: 'Mine', kind: 'daily', time: '08:15', tz: 'local' });
    const n = new Date(VexGameTimers.next(t, NOW));
    expect([n.getHours(), n.getMinutes()]).toEqual([8, 15]);
  });
});

describe('what is accepted', () => {
  it('refuses an unnamed timer, a bad time, a bad weekday and a bad lead', () => {
    expect(() => VexGameTimers.clean({ name: ' ', kind: 'daily', time: '00:00' })).toThrow(/Name the timer/);
    expect(() => VexGameTimers.clean({ name: 'a', kind: 'daily', time: '25:00' })).toThrow(/HH:MM/);
    expect(() => VexGameTimers.clean({ name: 'a', kind: 'weekly', time: '01:00', dow: 9 })).toThrow(/day of the week/);
    expect(() => VexGameTimers.clean({ name: 'a', kind: 'monthly' })).toThrow(/daily, weekly or one-off/);
    expect(() => VexGameTimers.clean({ name: 'a', kind: 'daily', time: '01:00', lead: -5 })).toThrow(/lead/);
  });
  it('keeps at most 24 timers', () => {
    for (let i = 0; i < 24; i++) VexGameTimers.add({ name: 't' + i, kind: 'daily', time: '00:00' });
    expect(() => VexGameTimers.add({ name: 'one more', kind: 'daily', time: '00:00' })).toThrow(/as many timers/);
  });
  it('throws, rather than starting again, when the saved list is damaged', () => {
    localStorage.setItem('vex.gameTimers', '{broken');
    expect(() => VexGameTimers.list()).toThrow(/not readable/);
  });
});

describe('where it shows', () => {
  it('puts the soonest three timers on the New Tab and none when switched off', () => {
    for (const [n, time] of [['A', '12:00'], ['B', '11:00'], ['C', '13:00'], ['D', '14:00']]) VexGameTimers.add({ name: n, kind: 'daily', time, tz: 'utc' });
    const lines = VexGameTimers.widgetLines(NOW);
    expect(lines).toEqual(['B in 30 min', 'A in 1 h 30 min', 'C in 2 h 30 min']);
    VexGameTimers.setEnabled(false);
    expect(VexGameTimers.widgetLines(NOW)).toEqual([]);
  });
  it('leaves a timer off the New Tab when asked, and a finished one-off never shows', () => {
    VexGameTimers.add({ name: 'Hidden', kind: 'daily', time: '12:00', showNewTab: false });
    VexGameTimers.add({ name: 'Over', kind: 'once', at: NOW - 1000 });
    expect(VexGameTimers.widgetLines(NOW)).toEqual([]);
  });
  it('gives the calendar weekly and one-off timers, not the daily one', () => {
    VexGameTimers.add({ name: 'Daily', kind: 'daily', time: '00:00', tz: 'utc' });
    VexGameTimers.add({ name: 'Weekly', kind: 'weekly', dow: 2, time: '00:00', tz: 'utc' });
    VexGameTimers.add({ name: 'Season', kind: 'once', at: Date.UTC(2026, 10, 20) });
    const ev = VexGameTimers.calendarEvents(Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 30));
    expect(ev.map(e => e.summary).filter(s => s === 'Daily')).toEqual([]);
    expect(ev.filter(e => e.summary === 'Weekly').length).toBe(8);   // capped at eight a window
    expect(ev.filter(e => e.summary === 'Season')).toHaveLength(1);
    expect(ev.every(e => e.calendar === 'Reset timers')).toBe(true);
  });
});

describe('the reminder', () => {
  it('makes a real repeating reminder before a daily reset and removes it with the timer', async () => {
    const t = VexGameTimers.add({ name: 'Daily reset', kind: 'daily', time: '00:00', tz: 'utc', lead: 30 });
    const saved = await VexGameTimers.remind(t, NOW);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].at).toBe(Date.UTC(2026, 9, 14, 23, 30));
    expect(reminders[0].repeat).toBe('daily');
    expect(saved.reminderId).toBe('r1');
    await VexGameTimers.remove(t.id);
    expect(reminders).toHaveLength(0);
    expect(VexGameTimers.list()).toEqual([]);
  });
  it('does not make a reminder for a lead of zero or one that would already have passed', async () => {
    const none = VexGameTimers.add({ name: 'None', kind: 'daily', time: '00:00' });
    await VexGameTimers.remind(none, NOW);
    const soon = VexGameTimers.add({ name: 'Soon', kind: 'once', at: NOW + 10 * 60000, lead: 60 });
    await VexGameTimers.remind(soon, NOW);
    expect(reminders).toHaveLength(0);
  });
  it('re-aligns a repeating reminder that drifted by an hour (daylight saving) and leaves a good one', async () => {
    const t = VexGameTimers.add({ name: 'Daily reset', kind: 'daily', time: '00:00', tz: 'utc', lead: 30 });
    await VexGameTimers.remind(t, NOW);
    expect(await VexGameTimers.syncReminders(NOW)).toBe(0);
    reminders[0].at += 3600000;
    expect(await VexGameTimers.syncReminders(NOW)).toBe(1);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].at).toBe(Date.UTC(2026, 9, 14, 23, 30));
  });
  it('says so when reminders are not available', async () => {
    delete window.vex;
    const t = VexGameTimers.add({ name: 'x', kind: 'daily', time: '00:00', lead: 10 });
    await expect(VexGameTimers.remind(t, NOW)).rejects.toThrow(/Reminders are not available/);
  });
});
