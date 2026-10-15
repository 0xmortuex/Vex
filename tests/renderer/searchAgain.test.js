// @vitest-environment jsdom
//
// "You searched this on ...": the same search found in local history, with the
// page that was opened from it. History only; never a private tab.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { VexSearchAgain } = require('../../src/renderer/js/search-again.js');

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const DAY = 86400000;
const row = (url, ago, title = url) => ({ url, title, visitedAt: new Date(NOW - ago).toISOString() });

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  VexSearchAgain._shown.clear();
  delete globalThis.HistoryPanel;
  delete window.VexTabPolicy;
});

describe('reading the words off a results page', () => {
  it('knows the common engines and the sites that search', () => {
    const q = (u) => VexSearchAgain.queryOf(u);
    expect(q('https://www.google.com/search?q=Best+kettle+2026&hl=en')).toBe('best kettle 2026');
    expect(q('https://www.bing.com/search?q=kettle')).toBe('kettle');
    expect(q('https://duckduckgo.com/?q=kettle%20descale&ia=web')).toBe('kettle descale');
    expect(q('https://www.youtube.com/results?search_query=lofi')).toBe('lofi');
    expect(q('https://en.wikipedia.org/w/index.php?search=Kettle')).toBe('kettle');
    expect(q('https://www.amazon.co.uk/s?k=kettle')).toBe('kettle');
    expect(q('https://github.com/search?q=vitest&type=repositories')).toBe('vitest');
  });

  it('is not fooled by other pages, other schemes or one-letter words', () => {
    const q = (u) => VexSearchAgain.queryOf(u);
    expect(q('https://www.google.com/maps?q=kettle')).toBe('');
    expect(q('https://example.com/page?q=kettle')).toBe('');
    expect(q('https://www.google.com/search?q=a')).toBe('');
    expect(q('file:///c:/search?q=kettle')).toBe('');
    expect(q('not a url')).toBe('');
  });

  it('reads the user\u2019s own engine by the address they gave it', () => {
    const t = 'https://search.example.org/find?term=%s';
    expect(VexSearchAgain.queryOf('https://search.example.org/find?term=Tea+pot', t)).toBe('tea pot');
    expect(VexSearchAgain.queryOf('https://search.example.org/find?term=Tea', '')).toBe('');
  });
});

describe('finding an earlier search', () => {
  const history = [
    row('https://www.google.com/search?q=best+kettle', 0),                                   // this one, just opened
    row('https://www.google.com/search?q=best+kettle', 9 * DAY, 'best kettle - Google'),
    row('https://www.which.co.uk/reviews/kettles', 9 * DAY - 4 * 60000, 'Best kettles - Which?'),
    row('https://news.example/other', 9 * DAY - 10 * 60000, 'Something else'),
    row('https://www.google.com/search?q=something+else', 20 * DAY),
  ];

  it('says when, and which page was opened from it', () => {
    const f = VexSearchAgain.find(history, { query: 'Best kettle', now: NOW });
    expect(f.query).toBe('best kettle');
    expect(Date.parse(f.at)).toBe(NOW - 9 * DAY);
    expect(f.opened).toEqual({ url: 'https://www.which.co.uk/reviews/kettles', title: 'Best kettles - Which?' });
    expect(f.count).toBe(1);
    expect(VexSearchAgain.describe(f, NOW)).toMatch(/^You searched this on .*2026.* \u2014 you opened \u201CBest kettles - Which\?\u201D$/);
  });

  it('does not count the search that has just opened, and finds nothing for a new search', () => {
    expect(VexSearchAgain.find([history[0]], { query: 'best kettle', now: NOW })).toBeNull();
    expect(VexSearchAgain.find(history, { query: 'brand new words', now: NOW })).toBeNull();
  });

  it('says so when nothing was opened afterwards, and "yesterday" for yesterday', () => {
    const only = [row('https://www.google.com/search?q=teapot', DAY, 'teapot')];
    const f = VexSearchAgain.find(only, { query: 'teapot', now: NOW });
    expect(f.opened).toBeNull();
    expect(VexSearchAgain.describe(f, NOW)).toBe('You searched this yesterday');
  });

  it('ignores a page opened long after, another search, and the search site itself', () => {
    const rows = [
      row('https://www.google.com/search?q=teapot', 5 * DAY),
      row('https://www.google.com/search?q=teapot+glass', 5 * DAY - 60000),
      row('https://www.google.com/preferences', 5 * DAY - 90000),
      row('https://shop.test/teapot', 5 * DAY - 3 * 3600000),
    ];
    expect(VexSearchAgain.find(rows, { query: 'teapot', now: NOW }).opened).toBeNull();
  });

  it('only looks back as far as the user asked', () => {
    const f = VexSearchAgain.find(history, { query: 'best kettle', now: NOW, days: 7 });
    expect(f).toBeNull();
  });
});

describe('on a results page', () => {
  it('tells once per tab, reads only History, and respects the setting', () => {
    globalThis.HistoryPanel = { list: () => [row('https://www.google.com/search?q=best+kettle', 9 * DAY), row('https://www.which.co.uk/k', 9 * DAY - 120000, 'Which kettle')] };
    const url = 'https://www.google.com/search?q=best+kettle&start=10';
    const a = VexSearchAgain.check(url, 'tab-1', NOW);
    expect(a.opened.title).toBe('Which kettle');
    expect(VexSearchAgain.check(url, 'tab-1', NOW + 1000)).toBeNull();          // said already
    expect(VexSearchAgain.check(url, 'tab-2', NOW + 1000)).not.toBeNull();      // another tab
    expect(VexSearchAgain.check('https://example.com/', 'tab-3', NOW)).toBeNull();
    VexSearchAgain.savePrefs({ enabled: false });
    expect(VexSearchAgain.check(url, 'tab-4', NOW)).toBeNull();
  });

  it('offers the page and the old search as links', () => {
    globalThis.TabManager = { createTab: vi.fn() };
    VexSearchAgain.say({ query: 'q', at: new Date(NOW - 2 * DAY).toISOString(), url: 'https://www.google.com/search?q=q', opened: { url: 'https://a.test/', title: 'A' } });
    const [, , , opts] = window.showToast.mock.calls.at(-1);
    expect(opts.actions.map(a => a.label)).toEqual(['Open it', 'Show that search']);
    opts.actions[0].run();
    expect(TabManager.createTab).toHaveBeenCalledWith('https://a.test/', true);
    delete globalThis.TabManager;
  });

  it('a private or Tor tab is not looked at', async () => {
    vi.useFakeTimers();
    try {
      globalThis.HistoryPanel = { list: () => [row('https://www.google.com/search?q=best+kettle', 9 * DAY)] };
      window.VexTabPolicy = { canReadWebview: () => false };
      const listeners = {};
      const wv = { addEventListener: (ev, fn) => { listeners[ev] = fn; }, getAttribute: () => 'tor-1' };
      VexSearchAgain.attach(wv, 'tab-9');
      listeners['did-navigate']({ url: 'https://www.google.com/search?q=best+kettle', isMainFrame: true });
      await vi.advanceTimersByTimeAsync(2000);
      expect(window.showToast).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
