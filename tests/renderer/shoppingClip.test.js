// @vitest-environment jsdom
//
// Shopping comparison clip: a product page read from its JSON-LD, meta tags or
// text into a small table; side by side; CSV.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
const { VexShoppingClip: S } = require('../../src/renderer/js/shopping-clip.js');

const ld = (o) => JSON.stringify(o);
const page = (over = {}) => ({ url: 'https://shop.test/kettle?utm_source=x', canonical: '', title: 'Kettle | Shop', ld: [], meta: {}, text: '', ...over });
const readPage = (html) => { document.documentElement.innerHTML = html; return (0, eval)(S.READ_SCRIPT); };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
});

describe('prices', () => {
  it('reads both ways of writing a number, and refuses what is not one', () => {
    expect(S.toCents('39.99')).toBe(3999);
    expect(S.toCents('1,299.00')).toBe(129900);
    expect(S.toCents('1.299,00')).toBe(129900);
    expect(S.toCents('12,50')).toBe(1250);
    expect(S.toCents('1,299')).toBe(129900);
    expect(S.toCents('£ 45')).toBe(4500);
    for (const bad of ['', 'free', '0', null, 'n/a']) expect(S.toCents(bad), String(bad)).toBeNull();
  });
});

describe('reading a product page', () => {
  it('JSON-LD: name, offer, rating, brand, inside @graph and with lists', () => {
    const r = S.parse(page({ ld: [ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['Product'], name: ' Kettle  Pro ', brand: { name: 'Acme' },
      offers: [{ '@type': 'Offer', price: '39.99', priceCurrency: 'GBP' }], aggregateRating: { ratingValue: '4.6', reviewCount: '1280' } }] })] }));
    expect(r).toMatchObject({ name: 'Kettle Pro', cents: 3999, currency: 'GBP', rating: 4.6, ratingCount: 1280, brand: 'Acme', source: 'json-ld' });
  });

  it('scales a rating out of 10 to 5, and drops one that makes no sense', () => {
    const base = { '@type': 'Product', name: 'A', offers: { price: 10, priceCurrency: 'USD' } };
    expect(S.parse(page({ ld: [ld({ ...base, aggregateRating: { ratingValue: 8, bestRating: 10 } })] })).rating).toBe(4);
    expect(S.parse(page({ ld: [ld({ ...base, aggregateRating: { ratingValue: 9 } })] })).rating).toBeNull();
  });

  it('falls back to product meta tags, then to the words on the page, and says which', () => {
    const meta = S.parse(page({ meta: { title: 'Mug', price: '12.50', currency: 'usd' } }));
    expect(meta).toMatchObject({ name: 'Mug', cents: 1250, source: 'meta' });
    const text = S.parse(page({ title: 'Lamp', text: 'Great lamp. Now £29.99 — rated 4.3 out of 5 by buyers' }));
    expect(text).toMatchObject({ name: 'Lamp', cents: 2999, currency: 'GBP', rating: 4.3, source: 'text' });
  });

  it('a page with a product but no price keeps what it has; a blog post is nothing', () => {
    const r = S.parse(page({ ld: [ld({ '@type': 'Product', name: 'Chair', aggregateRating: { ratingValue: 4 } })] }));
    expect(r).toMatchObject({ name: 'Chair', cents: null, rating: 4 });
    expect(S.parse(page({ ld: ['{nope', ld({ '@type': 'Article' })], title: '' }))).toBeNull();
  });

  it('the page-side script returns only plain data', () => {
    const p = readPage(`<head><title>Kettle</title><meta property="og:title" content="Kettle X"><meta property="product:price:amount" content="19.00"><script type="application/ld+json">${ld({ '@type': 'Product', name: 'K', offers: { price: 19, priceCurrency: 'EUR' } })}</script></head><body>Hello $19.00</body>`);
    expect(p.ld).toHaveLength(1);
    expect(p.meta).toMatchObject({ title: 'Kettle X', price: '19.00' });
    expect(S.parse(p)).toMatchObject({ cents: 1900, currency: 'EUR' });
  });
});

describe('the table', () => {
  const parsed = { name: 'Kettle', cents: 3999, currency: 'GBP', rating: 4.5, ratingCount: 10, brand: '', source: 'json-ld' };

  it('the same product again updates the row and keeps its notes', () => {
    const a = S.add(parsed, 'https://shop.test/kettle?utm_source=x');
    S.setNotes(a.id, 'wanted in white');
    const b = S.add({ ...parsed, cents: 3499 }, 'https://shop.test/kettle');
    expect(b.id).toBe(a.id);
    expect(S.all()).toHaveLength(1);
    expect(S.all()[0]).toMatchObject({ cents: 3499, notes: 'wanted in white', host: 'shop.test', url: 'https://shop.test/kettle' });
  });

  it('refuses a page with nothing, and a stored list that cannot be read', () => {
    expect(() => S.add(null, 'https://shop.test/')).toThrow(/no product/);
    localStorage.setItem('vex.shoppingClips', '{x');
    expect(() => S.all()).toThrow(/could not be read/);
  });

  it('marks the cheapest and the best rated only when there are two to compare', () => {
    expect(S.best([{ cents: 100, rating: 4 }])).toEqual({ price: null, rating: null });
    expect(S.best([{ cents: 300, rating: 3 }, { cents: 200, rating: 4.5 }, { cents: null, rating: null }])).toEqual({ price: 200, rating: 4.5 });
  });

  it('exports CSV with quoting, and a cell that starts like a formula is text', () => {
    S.add({ ...parsed, name: '=HYPERLINK("http://x","Kettle, big")' }, 'https://shop.test/a');
    const row = S.all()[0];
    S.setNotes(row.id, 'line1\nline2 "quoted"');
    const csv = S.toCsv(S.all());
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Name,Price,Currency,Rating (of 5),Reviews,Store,Link,Notes,Saved');
    expect(csv).toContain('"\'=HYPERLINK(""http://x"",""Kettle, big"")"');
    expect(csv).toContain('"line1\nline2 ""quoted"""');
    expect(csv).toContain(',39.99,GBP,4.5,10,shop.test,https://shop.test/a,');
  });

  it('shows the products side by side, edits notes, removes one', () => {
    S.add(parsed, 'https://shop.test/a');
    S.add({ ...parsed, name: 'Other kettle', cents: 2999, rating: 4 }, 'https://other.test/b');
    const body = S.open();
    const heads = [...body.querySelectorAll('thead th')].map(t => t.textContent.trim()).filter(Boolean);
    expect(heads.length).toBe(2);
    expect(body.textContent).toMatch(/lowest/);
    const t = body.querySelector('textarea');
    t.value = 'check the lid';
    t.dispatchEvent(new Event('change'));
    expect(S.all().map(c => c.notes)).toContain('check the lid');
    body.querySelector('[data-del]').click();
    expect(S.all()).toHaveLength(1);
    document.querySelector('.vex-shop-overlay').remove();
  });
});

describe('private tabs', () => {
  it('are refused before anything is read', async () => {
    globalThis.WebviewManager = { getActiveWebview: () => ({}), scriptsOffIn: () => false };
    window.VexTabPolicy = { canReadWebview: () => false };
    window.vexGuestEval = vi.fn();
    await expect(S.clipActive()).rejects.toThrow(/private or Tor/);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
    delete globalThis.WebviewManager;
    delete window.VexTabPolicy;
  });
});
