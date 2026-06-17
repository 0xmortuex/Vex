import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveSearchShortcut } from '../../src/renderer/js/search-shortcuts.js';

// resolveSearchShortcut turns a non-URL address-bar query into a site-specific
// search URL (keyword engine or DDG bang), or null to fall back to the default
// engine. Pure — no DOM needed (localStorage is optional).

describe('resolveSearchShortcut — keyword engines', () => {
  it('"yt cats" → YouTube search for cats', () => {
    expect(resolveSearchShortcut('yt cats')).toBe('https://www.youtube.com/results?search_query=cats');
  });
  it('"gh vex browser" → GitHub repo search (query encoded)', () => {
    expect(resolveSearchShortcut('gh vex browser')).toBe('https://github.com/search?q=vex%20browser&type=repositories');
  });
  it('"w albert einstein" → Wikipedia', () => {
    expect(resolveSearchShortcut('w albert einstein')).toBe('https://en.wikipedia.org/w/index.php?search=albert%20einstein');
  });
  it('keyword match is case-insensitive ("YT cats")', () => {
    expect(resolveSearchShortcut('YT cats')).toBe('https://www.youtube.com/results?search_query=cats');
  });
  it('encodes special characters in the query', () => {
    expect(resolveSearchShortcut('a c++ book')).toBe('https://www.amazon.com/s?k=c%2B%2B%20book');
  });
});

describe('resolveSearchShortcut — DuckDuckGo bangs', () => {
  it('leading bang "!w einstein" → DuckDuckGo', () => {
    expect(resolveSearchShortcut('!w einstein')).toBe('https://duckduckgo.com/?q=!w%20einstein');
  });
  it('trailing bang "einstein !w" → DuckDuckGo', () => {
    expect(resolveSearchShortcut('einstein !w')).toBe('https://duckduckgo.com/?q=einstein%20!w');
  });
  it('a lone bang "!gh" → DuckDuckGo', () => {
    expect(resolveSearchShortcut('!gh')).toBe('https://duckduckgo.com/?q=!gh');
  });
});

describe('resolveSearchShortcut — no match → null (default engine)', () => {
  it('a plain multi-word query with an unknown first word', () => {
    expect(resolveSearchShortcut('how to bake bread')).toBe(null);
  });
  it('a known keyword with NO query (just "yt")', () => {
    expect(resolveSearchShortcut('yt')).toBe(null);
  });
  it('a known keyword with only whitespace after it', () => {
    expect(resolveSearchShortcut('yt   ')).toBe(null);
  });
  it('an exclamation that is not a bang token ("hello! world")', () => {
    // "!" must start a token; "hello!" does not trigger a bang.
    expect(resolveSearchShortcut('hello! world')).toBe(null);
  });
  it('empty / null', () => {
    expect(resolveSearchShortcut('')).toBe(null);
    expect(resolveSearchShortcut(null)).toBe(null);
  });
});

describe('resolveSearchShortcut — user-defined keywords (localStorage)', () => {
  beforeEach(() => {
    globalThis.localStorage = {
      _d: { 'vex.searchKeywords': JSON.stringify({ jira: 'https://my.jira/browse?q=%s', yt: 'https://override/%s' }) },
      getItem(k) { return this._d[k] ?? null; },
      setItem(k, v) { this._d[k] = String(v); },
    };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('a user keyword resolves', () => {
    expect(resolveSearchShortcut('jira PROJ-12')).toBe('https://my.jira/browse?q=PROJ-12');
  });
  it('a user keyword overrides a built-in', () => {
    expect(resolveSearchShortcut('yt cats')).toBe('https://override/cats');
  });
});
