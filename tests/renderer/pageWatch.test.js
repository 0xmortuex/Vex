// @vitest-environment jsdom
//
// Auto-refresh reloads a page on a timer, which is half the job: you still have
// to look at it. "Tell me when the price drops" meant leaving a tab open and
// remembering to check. A watch reads the page quietly, compares it with what
// was there before, and speaks only when it is different.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const { PageWatch } = require('../../src/renderer/js/page-watch.js');

let page;
beforeEach(() => {
  localStorage.clear();
  page = { text: 'The price is £1,299.99 today', body: '<html><body><span class="price">£1,299.99</span></body></html>' };
  globalThis.AgentTools = {
    readUrl: vi.fn(async () => ({ url: 'https://shop.example/item', title: 'An item', text: page.text })),
    _get: vi.fn(async () => ({ ok: true, status: 200, body: page.body })),
  };
  globalThis.VexProblems = { note: vi.fn() };
  window.showToast = vi.fn();
  window.vex = { notify: vi.fn() };
});

describe('reading a number the way a person does', () => {
  it('handles thousands separators, currency and text around it', () => {
    expect(PageWatch.firstNumber('£1,299.99')).toBe(1299.99);
    expect(PageWatch.firstNumber('Now $89')).toBe(89);
    expect(PageWatch.firstNumber('4 of 12 left')).toBe(4);
    expect(PageWatch.firstNumber('1 299,50 kr')).toBe(1299.50);
    expect(PageWatch.firstNumber('-5 degrees')).toBe(-5);
    expect(PageWatch.firstNumber('sold out')).toBe(null);
    expect(PageWatch.firstNumber('')).toBe(null);
  });
});

describe('deciding whether to speak', () => {
  const w = (over = {}) => ({ kind: 'number', direction: 'any', target: null, lastValue: 100, ...over });

  it('the first look sets the baseline and says nothing', () => {
    expect(PageWatch.judge(w({ lastValue: null }), 90)).toMatchObject({ changed: false, why: 'first look' });
  });

  it('a number that moved, in the direction asked for', () => {
    expect(PageWatch.judge(w(), 90)).toMatchObject({ changed: true, why: 'went down from 100 to 90' });
    expect(PageWatch.judge(w({ direction: 'down' }), 90).changed).toBe(true);
    expect(PageWatch.judge(w({ direction: 'down' }), 110).changed).toBe(false);
    expect(PageWatch.judge(w({ direction: 'up' }), 110).changed).toBe(true);
    expect(PageWatch.judge(w(), 100).changed).toBe(false);
  });

  it('a figure to cross, which is what "tell me when it is under 300" means', () => {
    expect(PageWatch.judge(w({ direction: 'below', target: 300, lastValue: 400 }), 250)).toMatchObject({ changed: true, why: 'is 250, at or below 300' });
    expect(PageWatch.judge(w({ direction: 'below', target: 300, lastValue: 400 }), 350).changed).toBe(false);
    expect(PageWatch.judge(w({ direction: 'above', target: 300, lastValue: 100 }), 300)).toMatchObject({ changed: true });
  });

  it('text changes on the words, ignoring whitespace', () => {
    const t = { kind: 'text', lastValue: 'Tickets are not on sale' };
    expect(PageWatch.judge(t, 'Tickets  are not   on sale\n').changed).toBe(false);
    expect(PageWatch.judge(t, 'Tickets are ON SALE').changed).toBe(true);
  });
});

describe('a watch, end to end', () => {
  it('the first check is quiet, the second speaks, and the value is kept', async () => {
    const watch = PageWatch.add({ url: 'https://shop.example/item', title: 'An item', kind: 'number', direction: 'down' });
    expect(await PageWatch.checkOne(watch.id)).toMatchObject({ ok: true, changed: false });
    expect(window.showToast).not.toHaveBeenCalled();
    expect(PageWatch.list()[0].lastValue).toBe(1299.99);

    page.text = 'The price is £999.00 today';
    expect(await PageWatch.checkOne(watch.id)).toMatchObject({ ok: true, changed: true, from: 1299.99, to: 999 });
    expect(window.showToast).toHaveBeenCalledWith('An item went down from 1299.99 to 999', 'info', 8000);
    // And a desktop notification, because the point is that you are elsewhere.
    expect(window.vex.notify).toHaveBeenCalledWith('Vex — a page changed', 'An item went down from 1299.99 to 999');
  });

  it('a selector narrows it to one part of the page', async () => {
    const watch = PageWatch.add({ url: 'https://shop.example/item', title: 'An item', selector: '.price', kind: 'number' });
    await PageWatch.checkOne(watch.id);
    expect(PageWatch.list()[0].lastValue).toBe(1299.99);
    expect(AgentTools._get).toHaveBeenCalled();

    page.body = '<html><body><span class="price">£899</span></body></html>';
    expect(await PageWatch.checkOne(watch.id)).toMatchObject({ changed: true, to: 899 });
  });

  it('a selector that stops matching is reported, not treated as a change', async () => {
    const watch = PageWatch.add({ url: 'https://shop.example/item', title: 'An item', selector: '.price' });
    await PageWatch.checkOne(watch.id);
    page.body = '<html><body>the layout changed</body></html>';
    const r = await PageWatch.checkOne(watch.id);
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/Nothing on that page matches "\.price"/);
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('a page that keeps failing says so once, not on every check', async () => {
    const watch = PageWatch.add({ url: 'https://shop.example/item', title: 'An item' });
    globalThis.AgentTools.readUrl = vi.fn(async () => { throw new Error('HTTP 503'); });
    for (let i = 0; i < 7; i++) await PageWatch.checkOne(watch.id);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast).toHaveBeenCalledWith('Cannot check "An item" — HTTP 503', 'error');
    expect(VexProblems.note).toHaveBeenCalledWith('Page watch', 'Gave up checking https://shop.example/item', expect.any(Error));
  });

  it('a page with no number at all is reported rather than counted as a change', async () => {
    const watch = PageWatch.add({ url: 'https://shop.example/item', title: 'An item', kind: 'number' });
    page.text = 'currently unavailable';
    expect(await PageWatch.checkOne(watch.id)).toEqual({ ok: false, error: 'no number found on that page' });
  });

  it('refuses what it cannot watch, and will not watch the same thing twice', () => {
    expect(() => PageWatch.add({ url: 'vex://start' })).toThrow(/Only a web page/);
    PageWatch.add({ url: 'https://a.example/', title: 'A' });
    expect(() => PageWatch.add({ url: 'https://a.example/', title: 'A' })).toThrow(/already being watched/);
    // …but the same page watched through a different selector is a different watch.
    expect(() => PageWatch.add({ url: 'https://a.example/', title: 'A', selector: '.x' })).not.toThrow();
  });

  it('only checks what is due, and survives a restart', async () => {
    const watch = PageWatch.add({ url: 'https://shop.example/item', title: 'An item', kind: 'number', every: 60000 });
    await PageWatch.checkOne(watch.id);
    expect(await PageWatch.checkDue(Date.now())).toEqual([]);
    const later = Date.now() + 61000;
    expect((await PageWatch.checkDue(later))).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(PageWatch.KEY))[0].lastValue).toBe(1299.99);
  });
});

describe('in plain words', () => {
  it('reads what to watch for', () => {
    expect(PageWatch.parseWhen('drops under $300')).toEqual({ kind: 'number', direction: 'below', target: 300 });
    expect(PageWatch.parseWhen('the price is below £1,299.50')).toEqual({ kind: 'number', direction: 'below', target: 1299.5 });
    expect(PageWatch.parseWhen('goes above 50')).toEqual({ kind: 'number', direction: 'above', target: 50 });
    expect(PageWatch.parseWhen('it goes down')).toMatchObject({ direction: 'down' });
    expect(PageWatch.parseWhen('rises')).toMatchObject({ direction: 'up' });
    expect(PageWatch.parseWhen('is back in stock')).toEqual({ kind: 'text', direction: 'any', target: null });
    expect(() => PageWatch.parseWhen('whenever')).toThrow(/Say what to watch for/);
  });
});
