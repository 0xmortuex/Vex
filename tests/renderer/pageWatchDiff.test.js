// @vitest-environment jsdom
//
// Page Watcher: the rules for what "this page changed" means. A page that
// prints the time, an advert that rotates and a cookie banner must not wake
// anyone; a price, a version or a new paragraph must.

import { describe, it, expect } from 'vitest';
const { PageWatchDiff: D } = require('../../src/renderer/js/page-watch-diff.js');
const { AgentTools } = require('../../src/renderer/js/agent-tools.js');

const page = ({ price = '$299.00', stock = 'In stock', clock = '14:05:12', ago = '5 minutes ago', ad = 'Buy a VPN now', notes = [] } = {}) => `<!doctype html>
<html><head><title>GPU Shop</title><style>.x{color:red}</style><script>var t=Date.now()</script></head>
<body>
<nav><a href="/">Home</a><a href="/cart">Cart</a></nav>
<div class="cookie-banner">We use cookies to improve your experience</div>
<main><article>
  <h1>Graphics card 9000</h1>
  <p class="price">${price}</p>
  <p class="stock">${stock}</p>
  <p>Local time ${clock}. Updated ${ago}.</p>
  <ul>${notes.map(n => '<li>' + n + '</li>').join('')}</ul>
  <p>This card has 16 GB of memory, a quiet fan and a three year warranty. It ships worldwide from our warehouse
     within two working days and can be returned within thirty days of delivery if it is unused and boxed.</p>
  <p>Specifications: boost clock 2.5 GHz, 3 DisplayPort outputs, one HDMI output. Power draw is 220 W under typical
     gaming load and the card needs two eight pin connectors from the power supply.</p>
</article></main>
<aside class="ad">${ad}</aside>
<footer>Copyright Shop</footer></body></html>`;

const lines = (html, opts) => D.normalizeText(AgentTools.htmlToText(html).text, opts);

describe('normalising a page', () => {
  it('keeps the words and drops scripts, nav, adverts, clock times and relative times', () => {
    const l = lines(page());
    expect(l).toContain('Graphics card 9000');
    expect(l).toContain('$299.00');
    expect(l).toContain('In stock');
    expect(l.join('\n')).not.toMatch(/14:05|minutes ago|Date\.now|Buy a VPN|Home|Copyright/);
  });

  it('a page that only prints a new time and a new advert is the same page', () => {
    const a = lines(page({ clock: '14:05:12', ago: '5 minutes ago', ad: 'Buy a VPN now' }));
    const b = lines(page({ clock: '14:31:40', ago: '31 minutes ago', ad: 'Try our new soda' }));
    expect(D.fingerprint(a)).toBe(D.fingerprint(b));
    expect(D.change(a, b).significant).toBe(false);
  });

  it('removes cookie-banner and furniture lines', () => {
    const l = D.normalizeText('Skip to content\nWe use cookies to make this site better\nAccept all cookies\nReal line\nAdvertisement');
    expect(l).toEqual(['Real line']);
  });

  it('collapses whitespace and non-breaking spaces and caps a line', () => {
    expect(D.normalizeText('  a  b \t c  \n\n  ')).toEqual(['a b c']);
    expect(D.normalizeText('x'.repeat(1000))[0]).toHaveLength(D.LIMITS.lineChars);
  });

  it('high sensitivity keeps clock times so a ticking page is reported', () => {
    const a = lines(page({ clock: '14:05:12' }), { steady: false });
    const b = lines(page({ clock: '14:31:40' }), { steady: false });
    expect(D.change(a, b, { sensitivity: 'high' }).significant).toBe(true);
  });
});

describe('the difference', () => {
  it('finds a changed price and says what it was and is', () => {
    const a = lines(page({ price: '$299.00' }));
    const b = lines(page({ price: '$249.00' }));
    const ch = D.change(a, b);
    expect(ch.significant).toBe(true);
    expect(ch.removed).toEqual(['$299.00']);
    expect(ch.added).toEqual(['$249.00']);
    const s = D.summarize(ch);
    expect(s.headline).toBe('1 line changed');
    expect(s.text).toContain('- $299.00');
    expect(s.text).toContain('+ $249.00');
  });

  it('finds added lines and removed lines apart', () => {
    const a = lines(page({ notes: ['Fan curve fixed'] }));
    const b = lines(page({ notes: ['Fan curve fixed', 'Driver 551.23 released', 'Stock replenished'] }));
    const ch = D.change(a, b);
    expect(ch.added).toEqual(['Driver 551.23 released', 'Stock replenished']);
    expect(ch.removed).toEqual([]);
    expect(D.summarize(ch).headline).toBe('2 lines added');
    const back = D.change(b, a);
    expect(D.summarize(back).headline).toBe('2 lines removed');
  });

  it('a change at the very bottom of a long page is seen by the fingerprint', () => {
    const long = Array.from({ length: 800 }, (_, i) => 'Paragraph number ' + i + ' about nothing at all');
    const a = [...long, 'In stock'];
    const b = [...long, 'Sold out'];
    expect(D.fingerprint(a)).not.toBe(D.fingerprint(b));
    expect(D.lineDiff(a, b)).toEqual({ added: ['Sold out'], removed: ['In stock'] });
  });

  it('low sensitivity ignores a single reworded line but not a rewrite', () => {
    const a = ['one', 'two', 'three', 'four'];
    expect(D.change(a, ['one', 'TWO', 'three', 'four'], { sensitivity: 'low' }).significant).toBe(false);
    expect(D.change(a, ['one', 'a', 'b', 'c'], { sensitivity: 'low' }).significant).toBe(true);
    expect(D.change(a, ['one', 'TWO', 'three', 'four'], { sensitivity: 'normal' }).significant).toBe(true);
  });

  it('is empty for identical input and for moved-nothing', () => {
    expect(D.lineDiff(['a', 'b'], ['a', 'b'])).toEqual({ added: [], removed: [] });
    expect(D.change([], []).significant).toBe(false);
  });

  it('copes with a very large middle without hanging (count-based fallback)', () => {
    const a = Array.from({ length: 3000 }, (_, i) => 'a' + i);
    const b = Array.from({ length: 3000 }, (_, i) => 'b' + i);
    const t = Date.now();
    const d = D.lineDiff(a, b);
    expect(d.added).toHaveLength(3000);
    expect(d.removed).toHaveLength(3000);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('summary is bounded: a few lines and "and n more"', () => {
    const s = D.summarize({ added: Array.from({ length: 20 }, (_, i) => 'line ' + i), removed: [] }, { maxLines: 3 });
    expect(s.items).toHaveLength(3);
    expect(s.more).toBe(17);
    expect(s.text).toMatch(/and 17 more/);
  });
});

describe('a number, a price or a version out of text', () => {
  it('presets', () => {
    expect(D.extract('Now only $1,299.99 today', D.PRESETS.price.pattern)).toBe('$1,299.99');
    expect(D.extract('Driver version 551.23 (WHQL)', D.PRESETS.version.pattern)).toBe('551.23');
    expect(D.extract('Release v2.14.0-beta.2 is out', D.PRESETS.version.pattern)).toBe('2.14.0-beta.2');
    expect(D.extract('4 of 12 left', D.PRESETS.number.pattern)).toBe('4');
  });

  it('a custom pattern, its first group, and a miss', () => {
    expect(D.extract('Build #4821 passed', 'build #(\\d+)')).toBe('4821');
    expect(D.extract('nothing here', 'build #(\\d+)')).toBe(null);
  });

  it('a bad or empty pattern says so', () => {
    expect(() => D.compile('(')).toThrow(/not valid/);
    expect(() => D.compile('  ')).toThrow(/Give a pattern/);
    expect(() => D.compile('x'.repeat(201))).toThrow(/too long/);
  });
});

describe('history is bounded', () => {
  const snap = (n, text = 'x') => ({ at: n, text, hash: 'h' + n });

  it('keeps the newest 20 per watch', () => {
    const store = {};
    for (let i = 0; i < 30; i++) D.pushSnapshot(store, 'w1', snap(i));
    expect(store.w1).toHaveLength(20);
    expect(store.w1[0].at).toBe(10);
    expect(store.w1.at(-1).at).toBe(29);
  });

  it('does not store an unchanged snapshot twice', () => {
    const store = {};
    D.pushSnapshot(store, 'w1', { at: 1, text: 'a', hash: 'same' });
    D.pushSnapshot(store, 'w1', { at: 2, text: 'a', hash: 'same' });
    expect(store.w1).toHaveLength(1);
  });

  it('cuts one snapshot at its cap and says it was cut', () => {
    const store = {};
    D.pushSnapshot(store, 'w1', { at: 1, text: 'y'.repeat(50000), hash: 'big' });
    expect(store.w1[0].text).toHaveLength(D.LIMITS.snapChars);
    expect(store.w1[0].truncated).toBe(true);
  });

  it('past the total cap, the oldest of any watch go but never a watch newest', () => {
    const limits = { perWatch: 20, snapChars: 1000, totalChars: 3000 };
    const store = {};
    for (let i = 0; i < 6; i++) D.pushSnapshot(store, 'a', { at: i, text: 'a'.repeat(1000), hash: 'a' + i }, limits);
    D.pushSnapshot(store, 'b', { at: 100, text: 'b'.repeat(1000), hash: 'b0' }, limits);
    expect(D.sizeOf(store)).toBeLessThanOrEqual(3000);
    expect(store.b).toHaveLength(1);
    expect(store.a.at(-1).at).toBe(5);
    expect(store.a.length).toBe(2);
  });
});
