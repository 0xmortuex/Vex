// @vitest-environment jsdom
//
// Price history: the price a product page publishes, noted locally, one point
// a day; never guessed, never from a private tab.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
const { PriceHistory } = require('../../src/renderer/js/price-history.js');

const readPage = (html) => { document.head.innerHTML = ''; document.body.innerHTML = ''; document.documentElement.innerHTML = html; return (0, eval)(PriceHistory.READ_SCRIPT); };
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
});

describe('reading the price a page publishes', () => {
  it('a Product with an Offer', () => {
    expect(readPage(ld({ '@type': 'Product', name: 'Kettle', offers: { '@type': 'Offer', price: '39.99', priceCurrency: 'GBP' } })))
      .toMatchObject({ name: 'Kettle', price: '39.99', currency: 'GBP' });
  });

  it('inside @graph, with offers as a list, and a lowPrice range', () => {
    expect(readPage(ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': ['Product', 'Thing'], name: 'Desk', offers: [{ '@type': 'AggregateOffer', lowPrice: 120, priceCurrency: 'EUR' }] }] })))
      .toMatchObject({ name: 'Desk', price: '120', currency: 'EUR' });
  });

  it('skips broken JSON and non-products, and falls back to product:price tags', () => {
    const html = '<script type="application/ld+json">{nope</script>' + ld({ '@type': 'Organization' })
      + '<meta property="product:price:amount" content="12.50"><meta property="product:price:currency" content="USD"><meta property="og:title" content="Mug">';
    expect(readPage(html)).toMatchObject({ name: 'Mug', price: '12.50', currency: 'USD' });
  });

  it('a page with no price says nothing', () => {
    expect(readPage('<h1>Blog post</h1>')).toBeNull();
  });
});

describe('prices and addresses', () => {
  it('only clean numbers become prices', () => {
    expect(PriceHistory.toCents('39.99')).toBe(3999);
    expect(PriceHistory.toCents(120)).toBe(12000);
    expect(PriceHistory.toCents('0.5')).toBe(50);
    for (const bad of ['1,299.00', '12,50', '£12', '', '0', 'free', '-5']) expect(PriceHistory.toCents(bad), bad).toBeNull();
  });

  it('the same product under tracking tags is one product', () => {
    expect(PriceHistory.keyOf('https://shop.test/p/1?utm_source=x&colour=red&gclid=y#reviews')).toBe('https://shop.test/p/1?colour=red');
  });

  it('uses the canonical address on the same site only', () => {
    expect(PriceHistory.keyOf('https://shop.test/p/1?session=9', 'https://shop.test/p/1')).toBe('https://shop.test/p/1');
    expect(PriceHistory.keyOf('https://shop.test/p/1', 'https://elsewhere.test/p/1')).toBe('https://shop.test/p/1');
  });
});

describe('the record', () => {
  const day = (d) => new Date(2026, 8, d, 12);

  it('one point per day — the latest price seen that day', () => {
    PriceHistory.record({ url: 'https://shop.test/k', name: 'Kettle', price: '40.00', currency: 'GBP' }, day(1));
    PriceHistory.record({ url: 'https://shop.test/k', price: '38.00', currency: 'GBP' }, day(1));
    PriceHistory.record({ url: 'https://shop.test/k', price: '35.00', currency: 'GBP' }, day(5));
    const e = PriceHistory.all()['https://shop.test/k'];
    expect(e.points).toEqual([{ day: '2026-09-01', cents: 3800 }, { day: '2026-09-05', cents: 3500 }]);
    expect(e.name).toBe('Kettle');
    const s = PriceHistory.summary(e);
    expect(s).toMatchObject({ isLowest: true, changes: 1 });
    expect(s.low.cents).toBe(3500);
  });

  it('a price it cannot read is not recorded', () => {
    expect(PriceHistory.record({ url: 'https://shop.test/k', price: '1,299.00', currency: 'USD' })).toBeNull();
    expect(PriceHistory.all()).toEqual({});
  });

  it('a switch of currency starts a new line instead of mixing them', () => {
    PriceHistory.record({ url: 'https://shop.test/k', price: '40', currency: 'GBP' }, day(1));
    PriceHistory.record({ url: 'https://shop.test/k', price: '47', currency: 'EUR' }, day(2));
    const e = PriceHistory.all()['https://shop.test/k'];
    expect(e.currency).toBe('EUR');
    expect(e.points).toEqual([{ day: '2026-09-02', cents: 4700 }]);
  });

  it('keeps the products looked at most recently', () => {
    const max = PriceHistory.MAX_PRODUCTS;
    PriceHistory.MAX_PRODUCTS = 3;
    for (let i = 0; i < 5; i++) PriceHistory.record({ url: 'https://shop.test/' + i, price: '1', currency: 'USD' }, new Date(2026, 8, 1, 12, i));
    expect(Object.keys(PriceHistory.all()).sort()).toEqual(['https://shop.test/2', 'https://shop.test/3', 'https://shop.test/4']);
    PriceHistory.MAX_PRODUCTS = max;
  });

  it('unreadable saved history is an error, never silently replaced', () => {
    localStorage.setItem('vex.priceHistory', '{x');
    expect(() => PriceHistory.record({ url: 'https://shop.test/k', price: '1', currency: 'USD' })).toThrow(/could not be read/);
    expect(localStorage.getItem('vex.priceHistory')).toBe('{x');
  });
});

describe('reading tabs', () => {
  function fakeWebview(url, answer) {
    const handlers = {};
    return { handlers, getURL: () => url, addEventListener: (ev, fn) => { handlers[ev] = fn; } };
  }

  it('notes the price after a product page loads', async () => {
    vi.useFakeTimers();
    window.VexTabPolicy = { canReadWebview: () => true };
    window.vexGuestEval = vi.fn(async () => ({ name: 'Kettle', price: '40', currency: 'GBP', canonical: '' }));
    const wv = fakeWebview('https://shop.test/k');
    PriceHistory.attach(wv);
    wv.handlers['did-finish-load']();
    await vi.advanceTimersByTimeAsync(PriceHistory.SETTLE_MS + 10);
    expect(Object.keys(PriceHistory.all())).toEqual(['https://shop.test/k']);
    vi.useRealTimers();
  });

  it('never reads a private tab, and not when switched off', async () => {
    vi.useFakeTimers();
    window.vexGuestEval = vi.fn(async () => ({ price: '1' }));
    window.VexTabPolicy = { canReadWebview: () => false };
    const wv = fakeWebview('https://shop.test/k');
    PriceHistory.attach(wv);
    wv.handlers['did-finish-load']();
    window.VexTabPolicy = { canReadWebview: () => true };
    PriceHistory.setEnabled(false);
    wv.handlers['did-finish-load']();
    await vi.advanceTimersByTimeAsync(PriceHistory.SETTLE_MS + 10);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('the sheet', () => {
  it('shows this page’s history and the lowest price seen', () => {
    PriceHistory.record({ url: 'https://shop.test/k', name: 'Kettle', price: '40', currency: 'GBP' }, new Date(2026, 8, 1, 12));
    PriceHistory.record({ url: 'https://shop.test/k', price: '35', currency: 'GBP' }, new Date(2026, 8, 3, 12));
    PriceHistory.record({ url: 'https://shop.test/m', name: 'Mug', price: '9', currency: 'GBP' }, new Date(2026, 8, 2, 12));
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://shop.test/k?utm_source=mail' }) };
    PriceHistory.open();
    const o = document.querySelector('.vex-prices-overlay');
    expect(o.textContent).toContain('Kettle');
    expect(o.textContent).toMatch(/Lowest seen\s*£35\.00/);
    expect(o.textContent).toContain('lowest price you have seen here');
    expect(o.querySelector('svg polyline')).not.toBeNull();
    expect(o.textContent).toContain('Mug');
  });
});
