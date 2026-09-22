// @vitest-environment jsdom
//
// What the omnibox does with what you typed. The interesting line is the one
// between a host and a search: "news.ycombinator.com" has to navigate and
// "how to tie a knot" has to search, with no scheme on either.
import { describe, it, expect, beforeEach } from 'vitest';

const store = { 'vex.searchEngine': 'duckduckgo', 'vex.bookmarks': [], 'vex.history': [] };
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: (key, value) => { store[key] = value; }
};
const { VexSearch } = require('../../mobile/www/js/search.js');

beforeEach(() => {
  store['vex.searchEngine'] = 'duckduckgo';
  store['vex.bookmarks'] = [];
  store['vex.history'] = [];
});

describe('what you typed', () => {
  it('navigates to anything shaped like a host', () => {
    expect(VexSearch.toUrl('news.ycombinator.com')).toBe('https://news.ycombinator.com');
    expect(VexSearch.toUrl('example.co.uk/path?q=1')).toBe('https://example.co.uk/path?q=1');
    expect(VexSearch.toUrl('localhost:3000')).toBe('https://localhost:3000');
    expect(VexSearch.toUrl('192.168.1.10')).toBe('https://192.168.1.10');
  });

  it('keeps a scheme you gave it', () => {
    expect(VexSearch.toUrl('http://example.com')).toBe('http://example.com');
    expect(VexSearch.toUrl('about:blank')).toBe('about:blank');
    expect(VexSearch.toUrl('//example.com')).toBe('https://example.com');
  });

  it('searches anything else, through the chosen engine', () => {
    expect(VexSearch.toUrl('how to tie a knot'))
      .toBe('https://duckduckgo.com/?q=how%20to%20tie%20a%20knot');
    store['vex.searchEngine'] = 'brave';
    expect(VexSearch.toUrl('vex browser')).toBe('https://search.brave.com/search?q=vex%20browser');
    // A word with no dot is a search, not a hostname.
    expect(VexSearch.isSearch('vex')).toBe(true);
    expect(VexSearch.isSearch('vex.com')).toBe(false);
  });

  it('empties out safely', () => {
    expect(VexSearch.toUrl('')).toBe('');
    expect(VexSearch.toUrl('   ')).toBe('');
    expect(VexSearch.isSearch('')).toBe(false);
  });
});

describe('suggestions', () => {
  beforeEach(() => {
    store['vex.bookmarks'] = [{ url: 'https://claude.ai/', title: 'Claude' }];
    store['vex.history'] = [
      { url: 'https://developer.mozilla.org/', title: 'MDN Web Docs' },
      { url: 'https://claude.ai/', title: 'Claude' }
    ];
  });

  it('puts the search first, then bookmarks, then history', () => {
    const rows = VexSearch.suggest('cla');
    expect(rows[0].kind).toBe('search');
    expect(rows[1]).toMatchObject({ kind: 'bookmark', url: 'https://claude.ai/' });
    // The same URL is not offered twice because it is also in history.
    expect(rows.filter(row => row.url === 'https://claude.ai/')).toHaveLength(1);
  });

  it('matches on title as well as URL', () => {
    const rows = VexSearch.suggest('mdn');
    expect(rows.some(row => row.url === 'https://developer.mozilla.org/')).toBe(true);
  });

  it('caps what it returns', () => {
    store['vex.history'] = Array.from({ length: 40 }, (_, i) => ({ url: 'https://site' + i + '.example/', title: 'Site ' + i }));
    expect(VexSearch.suggest('site', 5).length).toBeLessThanOrEqual(5);
  });
});

describe('the address pill', () => {
  it('shows the host without the www', () => {
    expect(VexSearch.prettyHost('https://www.example.com/a/b?c=1')).toBe('example.com');
    expect(VexSearch.prettyHost('https://sub.example.com/')).toBe('sub.example.com');
    expect(VexSearch.prettyHost('not a url')).toBe('');
  });
});
