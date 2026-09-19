// @vitest-environment jsdom
//
// Habits: a name and the days you did it, with streaks that forgive an
// unticked today.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
const { Habits } = require('../../src/renderer/js/habits.js');

const NOW = new Date(2026, 8, 19, 10, 0);    // Sat 19 Sep 2026
const h = (done) => ({ id: 'x', name: 'Walk', done });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
});

describe('days and streaks', () => {
  it('uses local calendar days', () => {
    expect(Habits.dayKey(new Date(2026, 0, 5, 23, 50))).toBe('2026-01-05');
  });

  it('counts the days in a row up to today', () => {
    expect(Habits.streak(h(['2026-09-17', '2026-09-18', '2026-09-19']), NOW)).toBe(3);
  });

  it('an unticked today does not break the streak yet', () => {
    expect(Habits.streak(h(['2026-09-17', '2026-09-18']), NOW)).toBe(2);
  });

  it('a whole missed day does', () => {
    expect(Habits.streak(h(['2026-09-16', '2026-09-17']), NOW)).toBe(0);
    expect(Habits.streak(h(['2026-09-15', '2026-09-17', '2026-09-18', '2026-09-19']), NOW)).toBe(3);
  });

  it('runs across a month end', () => {
    expect(Habits.streak(h(['2026-08-31', '2026-09-01']), new Date(2026, 8, 1, 9))).toBe(2);
  });

  it('best is the longest run ever', () => {
    expect(Habits.best(h(['2026-01-01', '2026-01-02', '2026-01-03', '2026-02-01', '2026-02-28', '2026-03-01']))).toBe(3);
    expect(Habits.best(h([]))).toBe(0);
  });

  it('the tickable days are today and the six before, oldest first', () => {
    const d = Habits.days(NOW).map(x => Habits.dayKey(x));
    expect(d).toEqual(['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']);
  });
});

describe('adding, ticking, removing', () => {
  it('adds a habit and refuses empty, duplicate or overlong names', () => {
    Habits.add('  Read   20 pages ');
    expect(Habits.list().map(x => x.name)).toEqual(['Read 20 pages']);
    expect(() => Habits.add(' ')).toThrow(/name/);
    expect(() => Habits.add('read 20 PAGES')).toThrow(/already/);
    expect(() => Habits.add('x'.repeat(81))).toThrow(/too long/);
  });

  it('ticks and unticks inside the window only', () => {
    const { id } = Habits.add('Walk');
    expect(Habits.toggle(id, '2026-09-19', NOW)).toBe(true);
    expect(Habits.toggle(id, '2026-09-13', NOW)).toBe(true);
    expect(Habits.list()[0].done).toEqual(['2026-09-13', '2026-09-19']);
    expect(Habits.toggle(id, '2026-09-19', NOW)).toBe(false);
    expect(Habits.list()[0].done).toEqual(['2026-09-13']);
    expect(() => Habits.toggle(id, '2026-09-20', NOW)).toThrow(/not happened/);
    expect(() => Habits.toggle(id, '2026-09-12', NOW)).toThrow(/last 7 days/);
    expect(() => Habits.toggle(id, 'soon', NOW)).toThrow(/Not a day/);
    expect(() => Habits.toggle('gone', '2026-09-19', NOW)).toThrow(/gone/);
  });

  it('removes one', () => {
    const { id } = Habits.add('Walk');
    Habits.remove(id);
    expect(Habits.list()).toEqual([]);
    expect(() => Habits.remove(id)).toThrow(/gone/);
  });

  it('unreadable saved habits are an error, never silently replaced', () => {
    localStorage.setItem('vex.habits', '{not json');
    expect(() => Habits.list()).toThrow(/could not be read/);
    expect(() => Habits.add('Walk')).toThrow(/could not be read/);
    expect(localStorage.getItem('vex.habits')).toBe('{not json');
  });
});

describe('the sheet', () => {
  it('adds from the box, ticks today, and shows the streak', () => {
    Habits.open();
    const o = () => document.querySelector('.vex-habits-overlay');
    expect(o().textContent).toContain('No habits yet');
    o().querySelector('[data-new]').value = 'Walk';
    o().querySelector('[data-add]').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(o().textContent).toContain('Walk');
    expect(o().textContent).toContain('0 days');
    const today = Habits.dayKey(new Date());
    const box = o().querySelector(`input[data-day="${today}"]`);
    box.checked = true; box.dispatchEvent(new Event('change'));
    expect(Habits.list()[0].done).toEqual([today]);
    expect(o().textContent).toContain('1 day');
    expect(o().querySelectorAll('tbody input[type=checkbox]')).toHaveLength(7);
  });

  it('removing asks first, and a no keeps it', async () => {
    Habits.add('Walk');
    window.vexConfirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    Habits.open();
    const btn = () => document.querySelector('.vex-habits-overlay [data-remove]');
    btn().click();
    await Promise.resolve(); await Promise.resolve();
    expect(Habits.list()).toHaveLength(1);
    btn().click();
    await Promise.resolve(); await Promise.resolve();
    expect(Habits.list()).toHaveLength(0);
    expect(window.vexConfirm).toHaveBeenCalledTimes(2);
  });
});
