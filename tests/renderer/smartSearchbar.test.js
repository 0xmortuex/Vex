// Unit tests for the Smart Searchbar pure ranking helpers. These mirror the
// tabGrouperDomain.test.js pattern: import the hoisted pure functions and
// assert on plain arrays — no DOM, no storage, no network.
import { describe, it, expect } from 'vitest';
import { rankSuggestions, _normalizeUrl, _scoreMatch, parseGoogleSuggest } from '../../src/renderer/js/smart-searchbar.js';

describe('_normalizeUrl', () => {
  it('strips protocol', () => {
    expect(_normalizeUrl('https://example.com')).toBe('example.com');
    expect(_normalizeUrl('http://example.com')).toBe('example.com');
  });
  it('strips leading www.', () => {
    expect(_normalizeUrl('https://www.example.com')).toBe('example.com');
  });
  it('strips trailing slashes', () => {
    expect(_normalizeUrl('https://example.com/')).toBe('example.com');
    expect(_normalizeUrl('https://example.com/path/')).toBe('example.com/path');
  });
  it('lowercases', () => {
    expect(_normalizeUrl('https://EXAMPLE.com/Path')).toBe('example.com/path');
  });
  it('makes equivalent URLs compare equal (dedup key)', () => {
    expect(_normalizeUrl('https://www.github.com/')).toBe(_normalizeUrl('http://github.com'));
  });
  it('handles null/empty', () => {
    expect(_normalizeUrl(null)).toBe('');
    expect(_normalizeUrl('')).toBe('');
  });
});

describe('_scoreMatch', () => {
  it('returns 0 for empty query', () => {
    expect(_scoreMatch('', { url: 'https://x.com', title: 'X' })).toBe(0);
  });
  it('ranks url exact-prefix highest', () => {
    const s = _scoreMatch('git', { url: 'https://github.com', title: 'unrelated' });
    expect(s).toBe(100);
  });
  it('ranks title prefix above word-boundary prefix above substring', () => {
    const titlePrefix = _scoreMatch('cal', { url: 'https://x.com', title: 'Calendar' });
    const wordPrefix  = _scoreMatch('cal', { url: 'https://x.com', title: 'Google Calendar' });
    const substring   = _scoreMatch('end', { url: 'https://x.com', title: 'Calendar' });
    expect(titlePrefix).toBeGreaterThan(wordPrefix);
    expect(wordPrefix).toBeGreaterThan(substring);
  });
  it('is case-insensitive', () => {
    expect(_scoreMatch('GIT', { url: 'https://github.com', title: 'GitHub' })).toBe(100);
  });
  it('matches inside the url path on a word boundary', () => {
    expect(_scoreMatch('pulls', { url: 'https://github.com/pulls', title: 'PRs' })).toBeGreaterThan(0);
  });
  it('returns 0 when nothing matches', () => {
    expect(_scoreMatch('zzz', { url: 'https://github.com', title: 'GitHub' })).toBe(0);
  });
});

describe('rankSuggestions', () => {
  const items = [
    { url: 'https://calendar.google.com', title: 'Google Calendar', kind: 'history' },
    { url: 'https://github.com/pulls',     title: 'Pull Requests',   kind: 'tab' },
    { url: 'https://news.ycombinator.com', title: 'Hacker News',     kind: 'bookmark' },
    { url: 'https://calculator.net',       title: 'Calculator',      kind: 'history' },
  ];

  it('returns [] for empty query', () => {
    expect(rankSuggestions('', items)).toEqual([]);
    expect(rankSuggestions('   ', items)).toEqual([]);
  });

  it('returns [] for non-array items', () => {
    expect(rankSuggestions('cal', null)).toEqual([]);
  });

  it('orders exact/prefix matches before substring matches', () => {
    const res = rankSuggestions('cal', items);
    // "Calculator" (title prefix) + "Google Calendar" (word prefix) +
    // "calendar.google.com" (url prefix) all match; pure substring losers rank lower.
    expect(res.length).toBeGreaterThanOrEqual(2);
    // url-prefix (score 100: calendar.google.com) should sort to the top.
    expect(res[0].url).toBe('https://calendar.google.com');
  });

  it('is case-insensitive', () => {
    const res = rankSuggestions('CAL', items);
    expect(res.some(r => r.title === 'Calculator')).toBe(true);
  });

  it('matches against the url as well as the title', () => {
    const res = rankSuggestions('pulls', items);
    expect(res[0].url).toBe('https://github.com/pulls');
  });

  it('dedups by normalized URL, keeping the higher score', () => {
    const dup = [
      { url: 'https://github.com/',     title: 'GitHub Home', kind: 'history' },
      { url: 'http://www.github.com',   title: 'GitHub',      kind: 'tab' },
    ];
    const res = rankSuggestions('github', dup);
    expect(res.length).toBe(1);
  });

  it('on a score tie, prefers tab > history > bookmark', () => {
    const tie = [
      { url: 'https://github.com', title: 'GitHub', kind: 'bookmark' },
      { url: 'https://github.io',  title: 'GitHub', kind: 'tab' },
    ];
    // Different URLs (no dedup); both score 100 on "github" title/url prefix.
    const res = rankSuggestions('github', tie);
    expect(res[0].kind).toBe('tab');
  });

  it('caps results at the requested limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      url: `https://cal${i}.example.com`, title: `Cal ${i}`, kind: 'history'
    }));
    expect(rankSuggestions('cal', many, 8).length).toBe(8);
  });

  it('excludes non-matching items entirely', () => {
    const res = rankSuggestions('xyzzy', items);
    expect(res).toEqual([]);
  });
});

describe('parseGoogleSuggest', () => {
  it('extracts predictions from a valid Google Suggest response', () => {
    const raw = JSON.stringify(['cal', ['calvin klein', 'calculator', 'call of duty']]);
    expect(parseGoogleSuggest(raw)).toEqual(['calvin klein', 'calculator', 'call of duty']);
  });

  it('handles the real firefox-client shape with trailing metadata arrays', () => {
    const raw = JSON.stringify(['cal', ['calendar', 'calculator'], [], { 'google:suggesttype': ['QUERY'] }]);
    expect(parseGoogleSuggest(raw)).toEqual(['calendar', 'calculator']);
  });

  it('returns [] for an empty predictions array', () => {
    expect(parseGoogleSuggest(JSON.stringify(['cal', []]))).toEqual([]);
  });

  // === Discrimination: junk / empty / malformed / HTML must all yield [] ===
  it('returns [] for an empty string', () => {
    expect(parseGoogleSuggest('')).toEqual([]);
  });

  it('returns [] for non-JSON junk', () => {
    expect(parseGoogleSuggest('not json at all')).toEqual([]);
  });

  it('returns [] for an HTML error page', () => {
    expect(parseGoogleSuggest('<!DOCTYPE html><html><body>429 Too Many Requests</body></html>')).toEqual([]);
  });

  it('returns [] when the top-level value is not an array', () => {
    expect(parseGoogleSuggest(JSON.stringify({ query: 'cal', suggestions: ['x'] }))).toEqual([]);
  });

  it('returns [] when index [1] is missing', () => {
    expect(parseGoogleSuggest(JSON.stringify(['cal']))).toEqual([]);
  });

  it('returns [] when index [1] is not an array', () => {
    expect(parseGoogleSuggest(JSON.stringify(['cal', 'calculator']))).toEqual([]);
  });

  it('returns [] for a JSON null', () => {
    expect(parseGoogleSuggest('null')).toEqual([]);
  });

  it('returns [] for a bare empty array', () => {
    expect(parseGoogleSuggest('[]')).toEqual([]);
  });

  it('filters out non-string entries inside the predictions array', () => {
    const raw = JSON.stringify(['cal', ['calculator', 42, null, 'calendar', { x: 1 }]]);
    expect(parseGoogleSuggest(raw)).toEqual(['calculator', 'calendar']);
  });
});

