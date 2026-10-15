// Distraction budget (js/distraction-budget.js): the pure parts, no DOM.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { DistractionBudget: B } = createRequire(import.meta.url)('../../src/renderer/js/distraction-budget.js');

describe('categoryOf', () => {
  it('matches a host and its subdomains', () => {
    expect(B.categoryOf('https://www.youtube.com/watch?v=1')).toBe('video');
    expect(B.categoryOf('https://old.reddit.com/r/x')).toBe('social');
    expect(B.categoryOf('https://notyoutube.com/')).toBe(null);
  });
  it('ignores non-web addresses', () => {
    expect(B.categoryOf('file:///C:/x.html')).toBe(null);
    expect(B.categoryOf('about:blank')).toBe(null);
  });
  it('lets the user\'s own sites win', () => {
    expect(B.categoryOf('https://example.org/a', { 'example.org': 'news' })).toBe('news');
    expect(B.categoryOf('https://youtube.com/', { 'youtube.com': 'games' })).toBe('games');
  });
});

describe('levelFor', () => {
  it('is ok with no limit, near at 80%, over at 100%', () => {
    expect(B.levelFor(99999, 0)).toBe('ok');
    expect(B.levelFor(47 * 60, 60)).toBe('ok');
    expect(B.levelFor(48 * 60, 60)).toBe('near');
    expect(B.levelFor(60 * 60, 60)).toBe('over');
  });
});

describe('counting', () => {
  it('adds per day and category, and prunes old days', () => {
    B._state = { enabled: true, limits: {}, modes: {}, custom: {}, days: {} };
    const now = new Date(2026, 9, 16, 12);
    B.add('video', 30, now); B.add('video', 15, now); B.add('news', 5, now);
    expect(B.secondsToday('video', now)).toBe(45);
    expect(B.secondsToday('news', now)).toBe(5);
    expect(B.secondsToday('video', new Date(2026, 9, 17))).toBe(0);
    const days = B.prune({ '2026-01-01': { video: 1 }, '2026-10-15': { video: 2 } }, now);
    expect(Object.keys(days)).toEqual(['2026-10-15']);
    B._state = null;
  });
  it('blocks only a category set to block, once it is over', () => {
    const now = new Date();
    B._state = { enabled: true, limits: { video: 10, news: 10 }, modes: { video: 'block' }, custom: {}, days: {} };
    B.add('video', 5 * 60, now); B.add('news', 20 * 60, now);
    expect(B.shouldBlock('https://youtube.com/')).toBe(null);          // under the limit
    B.add('video', 6 * 60, now);
    expect(B.shouldBlock('https://youtube.com/')).toBe('video');
    expect(B.shouldBlock('https://cnn.com/')).toBe(null);              // over, but only nudged
    B._state.enabled = false;
    expect(B.shouldBlock('https://youtube.com/')).toBe(null);
    B._state = null;
  });
});
