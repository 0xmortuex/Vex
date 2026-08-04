import { describe, it, expect } from 'vitest';
import { matches } from '../../src/ext-host/api.js';

// chrome.tabs.query filtering. The extension leans on url patterns to find the
// claude.ai tab and on {active:true} to find the page it should act on, so a
// wrong answer here sends it after the wrong tab.
const tab = (over = {}) => ({
  id: 1, index: 0, windowId: 1, active: false, url: 'https://example.com/page',
  title: 'Example', status: 'complete', pinned: false, audible: false, ...over,
});

describe('chrome.tabs.query matching', () => {
  it('matches everything when the query is empty', () => {
    expect(matches(tab(), {})).toBe(true);
    expect(matches(tab(), undefined)).toBe(true);
    expect(matches(tab(), null)).toBe(true);
  });

  it('filters on active', () => {
    expect(matches(tab({ active: true }), { active: true })).toBe(true);
    expect(matches(tab({ active: false }), { active: true })).toBe(false);
    expect(matches(tab({ active: false }), { active: false })).toBe(true);
  });

  it('filters on status, pinned and audible', () => {
    expect(matches(tab({ status: 'loading' }), { status: 'loading' })).toBe(true);
    expect(matches(tab({ status: 'complete' }), { status: 'loading' })).toBe(false);
    expect(matches(tab({ pinned: true }), { pinned: true })).toBe(true);
    expect(matches(tab({ pinned: false }), { pinned: true })).toBe(false);
    expect(matches(tab({ audible: true }), { audible: true })).toBe(true);
  });

  it('matches an exact url', () => {
    expect(matches(tab(), { url: 'https://example.com/page' })).toBe(true);
    expect(matches(tab(), { url: 'https://other.com/page' })).toBe(false);
  });

  it('matches wildcard url patterns', () => {
    expect(matches(tab(), { url: 'https://example.com/*' })).toBe(true);
    expect(matches(tab(), { url: '*://example.com/*' })).toBe(true);
    expect(matches(tab({ url: 'https://claude.ai/chat/abc' }), { url: 'https://claude.ai/*' })).toBe(true);
    expect(matches(tab({ url: 'https://claude.ai/chat/abc' }), { url: 'https://example.com/*' })).toBe(false);
  });

  it('accepts an array of url patterns and matches if any one does', () => {
    expect(matches(tab({ url: 'https://claude.ai/x' }), { url: ['https://example.com/*', 'https://claude.ai/*'] })).toBe(true);
    expect(matches(tab({ url: 'https://nope.com/x' }), { url: ['https://example.com/*', 'https://claude.ai/*'] })).toBe(false);
  });

  it('does not let regex metacharacters in a pattern match loosely', () => {
    // A naive implementation turns '.' into "any char" and matches the wrong host.
    expect(matches(tab({ url: 'https://exampleXcom/page' }), { url: 'https://example.com/*' })).toBe(false);
  });

  it('matches title patterns', () => {
    expect(matches(tab({ title: 'Example Domain' }), { title: 'Example*' })).toBe(true);
    expect(matches(tab({ title: 'Other' }), { title: 'Example*' })).toBe(false);
  });

  it('combines predicates with AND', () => {
    const t = tab({ active: true, url: 'https://claude.ai/x' });
    expect(matches(t, { active: true, url: 'https://claude.ai/*' })).toBe(true);
    expect(matches(t, { active: false, url: 'https://claude.ai/*' })).toBe(false);
    expect(matches(t, { active: true, url: 'https://example.com/*' })).toBe(false);
  });

  it('ignores single-window query fields rather than filtering everything out', () => {
    // Vex is single-window; currentWindow/lastFocusedWindow are always true.
    expect(matches(tab(), { currentWindow: true })).toBe(true);
    expect(matches(tab(), { lastFocusedWindow: true })).toBe(true);
  });
});
