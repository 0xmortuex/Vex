// @vitest-environment jsdom
// Search keywords of your own ("yt cats" style, js/search-shortcuts.js): the address template must be https and carry %s,
// when it is saved and again when it is used.
import { describe, it, expect, beforeEach } from 'vitest';

const { SearchShortcuts, resolveSearchShortcut } = require('../../src/renderer/js/search-shortcuts.js');

beforeEach(() => { localStorage.clear(); });

describe('saving a keyword', () => {
  it('accepts https with %s, and http only for this computer', () => {
    expect(SearchShortcuts.setUserKeyword('jira', 'https://my.jira/browse?q=%s')).toBe('jira');
    expect(SearchShortcuts.setUserKeyword('dev', 'http://localhost:3000/search?q=%s')).toBe('dev');
    expect(SearchShortcuts.setUserKeyword('loop', 'http://127.0.0.1/s?q=%s')).toBe('loop');
    expect(resolveSearchShortcut('jira PROJ 7')).toBe('https://my.jira/browse?q=PROJ%207');
    expect(resolveSearchShortcut('dev hello')).toBe('http://localhost:3000/search?q=hello');
  });
  it('refuses plain http to the internet, other schemes, a missing %s and spaces', () => {
    expect(() => SearchShortcuts.setUserKeyword('x', 'http://example.com/?q=%s')).toThrow(/https/);
    expect(() => SearchShortcuts.setUserKeyword('x', 'javascript:alert(1)//%s')).toThrow(/https/);
    expect(() => SearchShortcuts.setUserKeyword('x', 'https://example.com/?q=')).toThrow(/%s/);
    expect(() => SearchShortcuts.setUserKeyword('x', 'https://exa mple.com/?q=%s')).toThrow(/https/);
    expect(localStorage.getItem('vex.searchKeywords')).toBeNull();
  });
});

describe('using a keyword that arrived another way (a hand edit, sync)', () => {
  it('an unsafe saved address is ignored instead of followed', () => {
    localStorage.setItem('vex.searchKeywords', JSON.stringify({
      bad1: 'javascript:alert(1)//%s', bad2: 'http://example.com/?q=%s', bad3: 'data:text/html,%s', good: 'https://example.com/?q=%s',
    }));
    expect(resolveSearchShortcut('bad1 hello')).toBeNull();
    expect(resolveSearchShortcut('bad2 hello')).toBeNull();
    expect(resolveSearchShortcut('bad3 hello')).toBeNull();
    expect(resolveSearchShortcut('good hello')).toBe('https://example.com/?q=hello');
  });
  it('a built-in keyword still works when a bad one tried to take its name', () => {
    localStorage.setItem('vex.searchKeywords', JSON.stringify({ yt: 'javascript:alert(1)//%s' }));
    expect(resolveSearchShortcut('yt cats')).toBe('https://www.youtube.com/results?search_query=cats');
  });
});
