// @vitest-environment jsdom
//
// A sentence is not hijacked by a one-letter or everyday-word keyword: "a good
// book to read" searched Amazon, "so what is love" Stack Overflow and "w
// hotels" Wikipedia (found 2026-10-10). Built-in keywords are asked for as in
// Firefox and Chrome: "@w hotels", or "w" and Tab in the address bar. Your own
// keywords and the few built-ins no sentence starts with still work bare.

import { describe, it, expect, beforeEach } from 'vitest';

const { resolveSearchShortcut, resolveKeywordSearch, SearchShortcuts } = require('../../src/renderer/js/search-shortcuts.js');

beforeEach(() => { localStorage.clear(); });

describe('everyday sentences go to the chosen engine', () => {
  for (const t of ['a good book to read', 'so what is love', 'x ray machine', 'r kelly songs', 'b vitamins', 'w hotels', 'maps of europe', 'img tag html', 'tr 808 drum machine', 'g force']) {
    it(`"${t}"`, () => { expect(resolveSearchShortcut(t)).toBe(null); });
  }
});

describe('keyword mode', () => {
  it('"@w hotels" and "@so what is love" use the keyword', () => {
    expect(resolveSearchShortcut('@w hotels')).toBe('https://en.wikipedia.org/w/index.php?search=hotels');
    expect(resolveKeywordSearch('@so what is love')).toEqual({ url: 'https://stackoverflow.com/search?q=what%20is%20love', name: 'Stack Overflow', query: 'what is love' });
  });
  it('the built-ins no sentence starts with work bare', () => {
    expect(resolveSearchShortcut('yt cats')).toBe('https://www.youtube.com/results?search_query=cats');
    expect(resolveSearchShortcut('npm left-pad')).toBe('https://www.npmjs.com/search?q=left-pad');
  });
  it('a keyword you added works bare, and over a built-in', () => {
    localStorage.setItem('vex.searchKeywords', JSON.stringify({ a: 'https://my.example/find?q=%s', jira: 'https://my.jira/browse?q=%s' }));
    expect(resolveSearchShortcut('jira PROJ-12')).toBe('https://my.jira/browse?q=PROJ-12');
    expect(resolveSearchShortcut('a good book')).toBe('https://my.example/find?q=good%20book');
  });
  it('an unknown @word is a search', () => {
    expect(resolveSearchShortcut('@nobody here')).toBe(null);
    expect(SearchShortcuts.keyword('@nobody')).toBe(null);
  });
});

describe('the keyword and Tab in the address bar', () => {
  let SmartSearchbar, input;
  beforeEach(() => {
    window.escapeHtml = (s) => String(s);
    window.SearchShortcuts = SearchShortcuts;
    globalThis.SearchShortcuts = SearchShortcuts;
    document.body.innerHTML = '<div id="url-bar-wrapper"><input id="url-input"></div>';
    input = document.getElementById('url-input');
    ({ SmartSearchbar } = require('../../src/renderer/js/smart-searchbar.js'));
    SmartSearchbar.init(input, {});
  });
  const tab = () => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    return { used: SmartSearchbar.handleKeydown(e), prevented: e.defaultPrevented };
  };

  it('"w" Tab becomes "@w " and keeps the focus', () => {
    input.value = 'w';
    expect(tab()).toEqual({ used: true, prevented: true });
    expect(input.value).toBe('@w ');
  });
  it('Tab after a word that is no keyword leaves the bar as Tab always did', () => {
    input.value = 'hello';
    expect(tab()).toEqual({ used: false, prevented: false });
    expect(input.value).toBe('hello');
  });
});
