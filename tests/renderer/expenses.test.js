// @vitest-environment jsdom
//
// Expenses: a local log, in whole cents, with a month view and CSV export.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
const { Expenses } = require('../../src/renderer/js/expenses.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
});

describe('amounts', () => {
  it('reads the ways people write money', () => {
    expect(Expenses.parseAmount('12.50')).toBe(1250);
    expect(Expenses.parseAmount('12,50')).toBe(1250);
    expect(Expenses.parseAmount('12.5')).toBe(1250);
    expect(Expenses.parseAmount('12')).toBe(1200);
    expect(Expenses.parseAmount('£12', 'GBP')).toBe(1200);
    expect(Expenses.parseAmount('12 €', 'EUR')).toBe(1200);
    expect(Expenses.parseAmount('12.50 usd', 'USD')).toBe(1250);
    expect(Expenses.parseAmount('$3', 'USD')).toBe(300);
    expect(Expenses.parseAmount('1,234.56')).toBe(123456);
    expect(Expenses.parseAmount('1.234,56')).toBe(123456);
    expect(Expenses.parseAmount('1,234')).toBe(123400);
    expect(Expenses.parseAmount('.99')).toBe(99);
  });

  it('refuses what is not an amount', () => {
    for (const bad of ['', 'lunch', '-5', '0', '0.00', '12.', '1.2345', '1,23,4.5.6', '1,23,4.56', '1.234.5', '1,234,5'])  expect(() => Expenses.parseAmount(bad), bad).toThrow();
    expect(() => Expenses.parseAmount('999999999999')).toThrow(/too large/);
  });

  it('an amount in another currency is refused, not relabelled', () => {
    expect(() => Expenses.parseAmount('£45', 'USD')).toThrow(/not in USD/);
    expect(() => Expenses.parseAmount('45 EUR', 'GBP')).toThrow(/not in GBP/);
  });

  it('adds up exactly — no floating point drift', () => {
    for (let i = 0; i < 30; i++) Expenses.add({ amount: '0.10', day: '2026-09-01' });
    expect(Expenses.month(Expenses.list(), '2026-09').total).toBe(300);
  });

  it('formats in the chosen currency', () => {
    expect(Expenses.format(123456, 'USD')).toMatch(/1,?234\.56/);
    expect(Expenses.format(1200, 'JPY')).toMatch(/12(?![.,]\d)/);
    Expenses.setCurrency('EUR');
    expect(Expenses.currency()).toBe('EUR');
    expect(() => Expenses.setCurrency('XXX')).toThrow(/Not a currency/);
  });
});

describe('the log', () => {
  it('adds with a default category and today', () => {
    const e = Expenses.add({ amount: '4.20', note: '  Coffee   beans ' });
    expect(e).toMatchObject({ cents: 420, category: 'Other', note: 'Coffee beans', day: Expenses.dayKey(new Date()) });
    expect(() => Expenses.add({ amount: '1', day: 'yesterday' })).toThrow(/Not a day/);
  });

  it('a month: its total, its categories by size, newest first', () => {
    Expenses.add({ amount: '10', category: 'Food', day: '2026-09-02' });
    Expenses.add({ amount: '30', category: 'Bills', day: '2026-09-05' });
    Expenses.add({ amount: '10', category: 'Food', day: '2026-09-09' });
    Expenses.add({ amount: '99', category: 'Food', day: '2026-08-30' });
    const m = Expenses.month(Expenses.list(), '2026-09');
    expect(m.total).toBe(5000);
    expect(m.categories).toEqual([{ name: 'Bills', cents: 3000, share: 0.6 }, { name: 'Food', cents: 2000, share: 0.4 }]);
    expect(m.items.map(e => e.day)).toEqual(['2026-09-09', '2026-09-05', '2026-09-02']);
  });

  it('months step across years', () => {
    expect(Expenses.shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(Expenses.shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('removes one', () => {
    const e = Expenses.add({ amount: '1' });
    expect(Expenses.remove(e.id).cents).toBe(100);
    expect(() => Expenses.remove(e.id)).toThrow(/gone/);
  });

  it('unreadable saved expenses are an error, never silently replaced', () => {
    localStorage.setItem('vex.expenses', 'nope{');
    expect(() => Expenses.add({ amount: '1' })).toThrow(/could not be read/);
    expect(localStorage.getItem('vex.expenses')).toBe('nope{');
  });
});

describe('CSV', () => {
  it('oldest first, quoted where needed, and safe to open in a spreadsheet', () => {
    Expenses.add({ amount: '2', note: 'Tea, milk', day: '2026-09-02' });
    Expenses.add({ amount: '1', note: '=HYPERLINK("x")', day: '2026-09-01' });
    const csv = Expenses.toCsv(Expenses.list(), 'GBP').split('\r\n');
    expect(csv[0]).toBe('Date,Amount,Currency,Category,Note');
    expect(csv[1]).toBe('2026-09-01,1.00,GBP,Other,"\'=HYPERLINK(""x"")"');
    expect(csv[2]).toBe('2026-09-02,2.00,GBP,Other,"Tea, milk"');
  });
});

describe('the sheet', () => {
  it('adds from the form and shows the month total and breakdown', () => {
    Expenses.setCurrency('USD');
    Expenses.open();
    const o = () => document.querySelector('.vex-expenses-overlay');
    o().querySelector('[data-amount]').value = '12.50';
    o().querySelector('[data-category]').value = 'Food';
    o().querySelector('[data-note]').value = 'Lunch';
    o().querySelector('[data-add]').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(o().querySelector('[data-total]').textContent).toMatch(/12\.50/);
    expect(o().textContent).toContain('Lunch');
    expect(o().textContent).toMatch(/Food.*100%/s);
  });

  it('a bad amount is said, not saved', () => {
    Expenses.open();
    const o = document.querySelector('.vex-expenses-overlay');
    o.querySelector('[data-amount]').value = 'lunch';
    o.querySelector('[data-add]').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/amount/), 'error');
    expect(Expenses.list()).toEqual([]);
  });

  it('cannot step into a future month', () => {
    Expenses.open();
    const next = document.querySelector('.vex-expenses-overlay [data-next]');
    expect(next.disabled).toBe(true);
  });
});

describe('the day box', () => {
  it('always starts at today, even after logging something in an earlier month', () => {
    Expenses.open();
    const o = () => document.querySelector('.vex-expenses-overlay');
    const f = () => o().querySelector('[data-add]');
    f().querySelector('[data-amount]').value = '20';
    f().querySelector('[data-day]').value = '2026-01-15';
    f().dispatchEvent(new Event('submit', { cancelable: true }));
    expect(o().textContent).toContain('January 2026');                 // shows where it went
    f().querySelector('[data-amount]').value = '5';
    f().dispatchEvent(new Event('submit', { cancelable: true }));
    expect(Expenses.list().map(e => e.day)).toEqual(['2026-01-15', Expenses.dayKey(new Date())]);
  });
});
