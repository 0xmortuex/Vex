// @vitest-environment jsdom
//
// Auto-refresh reloads a page on a timer, which is half the job: you still have
// to look at it. "Tell me when the price drops" meant leaving a tab open and
// remembering to check. A watch reads the page quietly, compares it with what
// was there before, and speaks only when it is different.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    expect(r.error).toMatch(/The part you watched is gone from this page.*"\.price"/);
    expect(r.partGone).toBe(true);
    // Said once, as a gone part, not as a change of the page.
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/part you watched is gone/), 'error', 8000);
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
    const watch = PageWatch.add({ url: 'https://shop.example/item', title: 'An item', kind: 'number', every: 5 * 60000 });
    await PageWatch.checkOne(watch.id);
    expect(await PageWatch.checkDue(Date.now())).toEqual([]);
    const later = Date.now() + 5 * 60000 + 1000;
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

describe('one watcher, not two (RD6)', () => {
  it('moves the old "Watch This Page" list into this one, once, and drops the old key', () => {
    localStorage.setItem(PageWatch.KEY, JSON.stringify([{ id: 'w_have', url: 'https://have.example/', title: 'Have', selector: '', every: 900000 }]));
    localStorage.setItem('vex.watches', JSON.stringify([
      { id: 'w1', url: 'https://stock.example/item', title: 'Stock', intervalMin: 60, lastHash: 1, changed: true, changedAt: 1234 },
      { id: 'w2', url: 'https://have.example/', title: 'Have (old)', intervalMin: 30 },
      { id: 'w3', url: 'file:///c:/x', title: 'Not a site' },
    ]));
    expect(PageWatch.migrateLegacy()).toBe(1);
    const list = PageWatch.list();
    expect(list.map(w => w.url)).toEqual(['https://have.example/', 'https://stock.example/item']);
    expect(list[1]).toMatchObject({ title: 'Stock', kind: 'text', every: 3600000, lastChangedAt: 1234, lastValue: null });
    expect(localStorage.getItem('vex.watches')).toBeNull();
    expect(PageWatch.migrateLegacy()).toBe(0);
    expect(PageWatch.list()).toHaveLength(2);
  });

  it('"Watch This Page" in Ctrl+K adds a PageWatch watch and takes its first look through the routing check', async () => {
    globalThis.TabManager = { mayAskSiteForIcon: () => false, getActiveTab: () => ({ url: 'https://tor-routed.example/', title: 'Routed' }), tabs: [], activeTabId: null };
    const w = await PageWatch.watchPage('https://tor-routed.example/', 'Routed');
    expect(PageWatch.list().map(x => x.id)).toEqual([w.id]);
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/first look failed: .*Tor, a proxy or a container/), 'error');
    delete globalThis.TabManager;
  });

  it('a page whose only change is "updated 3 minutes ago" or a clock time is not news', () => {
    const w = { kind: 'text', lastValue: 'Status: all good. Updated 2 minutes ago at 10:41 AM' };
    expect(PageWatch.judge(w, 'Status: all good. Updated 7 minutes ago at 10:46 AM').changed).toBe(false);
    expect(PageWatch.judge(w, 'Status: outage. Updated 7 minutes ago at 10:46 AM').changed).toBe(true);
  });

  it('the Watched Pages list shows a change until it is opened', () => {
    localStorage.setItem(PageWatch.KEY, JSON.stringify([{ id: 'w1', url: 'https://a.example/', title: 'A', every: 900000, lastChangedAt: 5 }]));
    window.escapeHtml = (s) => String(s);
    globalThis.TabManager = { createTab: vi.fn() };
    PageWatch.showManager();
    expect(document.querySelector('#vex-watches [data-id="w1"]').textContent).toContain('changed');
    document.querySelector('#vex-watches [data-open]').click();
    expect(TabManager.createTab).toHaveBeenCalledWith('https://a.example/', true);
    expect(PageWatch.isUnseen(PageWatch.list()[0])).toBe(false);
    expect(document.getElementById('vex-watches')).toBeNull();
    delete globalThis.TabManager;
  });
});

// Found in the v19.1.7 check: an old "Watch This Page" on the router moved
// over without the mark a home-network watch needs, so every check was refused.
describe('an old watch on the home network, moved over', () => {
  it('is still checked from this computer', async () => {
    localStorage.setItem('vex.watches', JSON.stringify([{ id: 'w1', url: 'http://192.168.1.1/status', title: 'Router', intervalMin: 30 }]));
    expect(PageWatch.migrateLegacy()).toBe(1);
    const w = PageWatch.list()[0];
    expect(w).toMatchObject({ url: 'http://192.168.1.1/status', local: true, byUser: true });
    window.vex.apiRequest = vi.fn(async () => ({ ok: true, status: 200, headers: { 'content-type': 'text/plain' }, body: 'WAN up' }));
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true });
    expect(window.vex.apiRequest).toHaveBeenCalled();
  });
});

// Found in the v19.1.7 check: a page open in a Tor or container tab is not a
// site rule, so the check at each look let it through and Vex polled it from
// your real connection.
describe('a page open in a tab of its own session', () => {
  const tabs = (partition) => {
    globalThis.TabManager = {
      tabs: [{ id: 't1', url: 'https://news.example/', title: 'News', partition }], activeTabId: 't1',
      windowMayAsk: (p) => !p || p === 'persist:main',
      mayAskSiteForIcon: () => true,
    };
  };
  afterEach(() => { delete globalThis.TabManager; });

  it('"Watch This Page" in a Tor tab is refused and nothing is fetched', async () => {
    tabs('tor:abc');
    expect(await PageWatch.watchPage('https://news.example/', 'News', { partition: 'tor:abc' })).toBeNull();
    expect(PageWatch.list()).toEqual([]);
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/real connection/), 'error');
  });

  it('"Tell me when this page changes" in a container tab is refused', () => {
    tabs('persist:container-work');
    expect(() => PageWatch.watchCurrent('changes', { byUser: true })).toThrow(/real connection/);
    expect(PageWatch.list()).toEqual([]);
  });

  it('an ordinary tab is watched as before', async () => {
    tabs('persist:main');
    const r = PageWatch.watchCurrent('changes', { byUser: true });
    expect(r.watch.url).toBe('https://news.example/');
  });
});

// Found in the v19.1.7 check: "Watch This Page" compared only the first 4000
// characters of a page, so "Out of stock" turning into "In stock" at the
// bottom of a long product page was never seen.
describe('a whole-page watch sees all of the page', () => {
  const filler = Array.from({ length: 80 }, (_, i) => 'Paragraph ' + (i + 1) + ': the quick brown fox jumps over the lazy dog again.').join('\n');
  beforeEach(() => {
    // As the real one: the text is cut at maxText (12000 unless asked).
    globalThis.AgentTools.readUrl = vi.fn(async (url, { maxText = 12000 } = {}) => ({ url, title: 'Shop', text: page.text.slice(0, maxText) }));
  });

  it('a change after the first 4000 characters is a change', async () => {
    page.text = 'Widget\nUpdated 3 minutes ago at 10:03\n' + filler + '\nOut of stock';
    expect(page.text.length).toBeGreaterThan(4000);
    const watch = PageWatch.add({ url: 'https://shop.example/item', title: 'Widget' });
    expect(await PageWatch.checkOne(watch.id)).toMatchObject({ ok: true, changed: false });
    page.text = page.text.replace('Out of stock', 'In stock — order now');
    expect(await PageWatch.checkOne(watch.id)).toMatchObject({ ok: true, changed: true });
    expect(window.showToast).toHaveBeenCalledWith('Widget changed', 'info', 8000);
  });

  it('a change past 12000 characters is seen too, and only the steady words count', async () => {
    page.text = 'Updated 3 minutes ago at 10:03\n' + filler + filler + filler + '\nOut of stock';
    expect(page.text.length).toBeGreaterThan(12000);
    const watch = PageWatch.add({ url: 'https://shop.example/item', title: 'Widget' });
    await PageWatch.checkOne(watch.id);
    page.text = page.text.replace('Updated 3 minutes ago at 10:03', 'Updated 9 minutes ago at 10:09');
    expect(await PageWatch.checkOne(watch.id)).toMatchObject({ changed: false });
    page.text = page.text.replace('Out of stock', 'In stock');
    expect(await PageWatch.checkOne(watch.id)).toMatchObject({ changed: true });
    expect(String(PageWatch.list()[0].lastValue).length).toBeLessThan(300);   // not the whole page in localStorage
  });

  it('a watch saved before (plain text) takes a new baseline once, without a false alarm', async () => {
    page.text = 'Widget\n' + filler;
    localStorage.setItem(PageWatch.KEY, JSON.stringify([{ id: 'w_old', url: 'https://shop.example/item', title: 'Widget', selector: '', kind: 'text', direction: 'any', every: 900000, lastValue: page.text.slice(0, 4000), lastCheckedAt: 1 }]));
    expect(await PageWatch.checkOne('w_old')).toMatchObject({ ok: true, changed: false, why: 'first look' });
    expect(await PageWatch.checkOne('w_old')).toMatchObject({ ok: true, changed: false, why: 'no change' });
    expect(window.showToast).not.toHaveBeenCalled();
  });
});
