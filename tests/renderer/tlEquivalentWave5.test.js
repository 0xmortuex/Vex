// @vitest-environment jsdom
//
// T3-045, Wave 5: a tooltip with the lira price when the pointer rests on a price (opt-in), and last
// month's price from Price history when the page is tracked.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexTl: T, vexTlHoverLabel: label } = require('../../src/renderer/js/tl-equivalent.js');

const DATA = { rates: { USD: 41, EUR: 45 }, date: '2026-10-16', source: 'TCMB', old: false };
const DAY = 86400000;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  delete globalThis.PriceHistory; delete globalThis.WebviewManager; delete globalThis.TabManager; delete globalThis.VexTabPolicy;
  window.vexGuestEval = vi.fn(async () => true);
});

describe('the label for a price under the pointer', () => {
  it('converts a short price with the saved rate', () => {
    expect(label('$10', DATA)).toMatch(/^about .*410.* \(bank rate of /);
    expect(label('29,99 EUR', DATA)).toMatch(/^about /);
    expect(label('  € 1.299,90 ', DATA)).toMatch(/^about /);
  });
  it('says the rate is old, and that it is the person\'s own rate', () => {
    expect(label('$10', { ...DATA, old: true })).toMatch(/, old\)$/);
    expect(label('$10', { ...DATA, source: 'manual' })).toMatch(/your rate of /);
  });
  it('says nothing for text that is not just a price, a currency with no rate, or long text', () => {
    expect(label('Now only $10 today', DATA)).toBe('');
    expect(label('$10', { ...DATA, rates: { EUR: 45 } })).toBe('');
    expect(label('$' + '1'.repeat(60), DATA)).toBe('');
    expect(label('', DATA)).toBe('');
    expect(label('$10', null)).toBe('');
  });
  it('is self-contained so it can be sent to the page', () => {
    const src = label.toString();
    const copy = (0, eval)('(' + src + ')');
    expect(copy('$10', DATA)).toBe(label('$10', DATA));
  });
});

describe('the hover switch and the page script', () => {
  it('is off until switched on, and needs a saved rate', async () => {
    expect(T.hoverOn()).toBe(false);
    T.setHover(true);
    expect(T.hoverOn()).toBe(true);
    expect(T.hoverData()).toBeNull();
    const wv = { getURL: () => 'https://shop.example/p' };
    expect(await T.applyHover(wv)).toBe(false);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
  it('sends only the selling rates and the date to the page', async () => {
    T.setManual('USD', '41', new Date(2026, 9, 16));
    T.setHover(true);
    const wv = { getURL: () => 'https://shop.example/p' };
    expect(await T.applyHover(wv)).toBe(true);
    const code = window.vexGuestEval.mock.calls[0][1];
    expect(code).toContain('"USD":41');
    expect(code).toContain('mouseover');
    expect(code).toContain('"date":"2026-10-16"');
  });
  it('does not touch a page that is not a web page, or one the policy forbids', async () => {
    T.setManual('USD', '41', new Date(2026, 9, 16));
    expect(await T.applyHover({ getURL: () => 'file:///x' }, true)).toBe(false);
    globalThis.VexTabPolicy = { canReadWebview: () => false };
    expect(await T.applyHover({ getURL: () => 'https://shop.example/p' }, true)).toBe(false);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
  it('switching off clears the data on a page that had it', async () => {
    T.setManual('USD', '41', new Date(2026, 9, 16));
    const wv = { getURL: () => 'https://shop.example/p' };
    await T.applyHover(wv, true);
    await T.applyHover(wv, false);
    expect(window.vexGuestEval.mock.calls[1][1]).toContain('var D=null');
  });
  it('the script works in a page: it sets the title once', () => {
    const code = T.hoverScript(DATA);
    document.body.innerHTML = '<span id="p">$10</span><span id="q">hello</span>';
    (0, eval)(code);
    document.getElementById('p').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    document.getElementById('p').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    document.getElementById('q').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(document.getElementById('p').title).toMatch(/^about /);
    expect(document.getElementById('p').title.match(/about/g)).toHaveLength(1);
    expect(document.getElementById('q').title).toBe('');
  });
});

describe('last month\'s price', () => {
  const entry = (points, currency = 'USD') => ({ name: 'Thing', currency, points });
  const day = (offset, now) => { const d = new Date(now + offset * DAY); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const NOW = new Date(2026, 9, 16, 12).getTime();
  const install = (points) => {
    globalThis.PriceHistory = {
      keyOf: (u) => u,
      all: () => ({ 'https://shop.example/p': entry(points) }),
      dayKey: (d) => day(0, d.getTime()),
    };
  };
  it('finds the point from a month ago and the change since', () => {
    install([{ day: day(-40, NOW), cents: 10000 }, { day: day(-31, NOW), cents: 9000 }, { day: day(-5, NOW), cents: 10800 }, { day: day(0, NOW), cents: 10800 }]);
    const r = T.priceMonthAgo('https://shop.example/p', NOW);
    expect(r).toMatchObject({ cents: 9000, currency: 'USD', nowCents: 10800 });
    expect(r.change).toBeCloseTo(0.2, 5);
  });
  it('is null when the page has not been tracked for a month, or at all', () => {
    install([{ day: day(-10, NOW), cents: 10000 }, { day: day(0, NOW), cents: 10800 }]);
    expect(T.priceMonthAgo('https://shop.example/p', NOW)).toBeNull();
    expect(T.priceMonthAgo('https://other.example/', NOW)).toBeNull();
    delete globalThis.PriceHistory;
    expect(T.priceMonthAgo('https://shop.example/p', NOW)).toBeNull();
  });
  it('ignores a point older than 45 days as "a month ago"', () => {
    install([{ day: day(-60, NOW), cents: 5000 }, { day: day(0, NOW), cents: 10800 }]);
    expect(T.priceMonthAgo('https://shop.example/p', NOW)).toBeNull();
  });
  it('is on the card when tracked', () => {
    install([{ day: day(-31, Date.now()), cents: 9000 }, { day: day(0, Date.now()), cents: 10800 }]);
    globalThis.PriceHistory.format = (c, cur) => cur + ' ' + (c / 100).toFixed(2);
    globalThis.PriceHistory.keyOf = () => 'https://shop.example/p';
    globalThis.VexSettingsGroups = { button: () => document.createElement('button') };
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://shop.example/p' }) };
    T.setManual('USD', '41', new Date());
    T.showCard([{ amount: 108, currency: 'USD', raw: '$108' }]);
    expect(document.getElementById('vex-tl-card').textContent).toMatch(/A month ago this page showed USD 90\.00 .*\+20% since/);
  });
});
