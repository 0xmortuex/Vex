// @vitest-environment jsdom
// AI news panel (js/ai-news-ui.js): when a story came out, the date range
// filter, the sorts, day headings, remembered filters, Clear filters and
// Show more. The engine is a small stub: only what the panel reads.
import { describe, it, expect, beforeEach } from 'vitest';

let ITEMS = [];
globalThis.AINews = {
  TOPICS: [{ id: 'llm', label: 'Model releases' }],
  list: () => ITEMS,
  topicsOf: (it) => it.topics || [],
  prefs: () => ({ enabled: true, channels: { badge: true } }),
  status: () => ({ text: 'ok', level: 'ok' }),
  markSeen() {},
  unseenCount: () => 0,
  markAllRead() {},
};
const { AINewsUI } = require('../../src/renderer/js/ai-news-ui.js');

const NOW = new Date(2026, 9, 15, 15, 0, 0).getTime();   // Oct 15 2026, 3 PM local
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
const IT = (id, o = {}) => ({
  id, title: 'Story ' + id, url: 'https://x.test/' + id, cluster: id, source: 'Src', kind: 'other',
  importance: 10, summary: '', topics: [], read: false, breaking: false,
  publishedAt: NOW - H, firstSeenAt: NOW - H, ...o,
});

describe('relative age', () => {
  const age = (ms) => AINewsUI.relativeAge(NOW - ms, NOW);
  it('uses just now, minutes, hours, yesterday, days, months', () => {
    expect(age(0)).toBe('just now');
    expect(age(59 * S)).toBe('just now');
    expect(age(60 * S)).toBe('1 minute ago');
    expect(age(12 * M)).toBe('12 minutes ago');
    expect(age(59 * M)).toBe('59 minutes ago');
    expect(age(60 * M)).toBe('1 hour ago');
    expect(age(3 * H)).toBe('3 hours ago');
    expect(age(23 * H)).toBe('23 hours ago');
    expect(AINewsUI.relativeAge(new Date(2026, 9, 14, 9, 0).getTime(), NOW)).toBe('yesterday');
    expect(AINewsUI.relativeAge(new Date(2026, 9, 14, 0, 5).getTime(), NOW)).toBe('yesterday');
    expect(AINewsUI.relativeAge(new Date(2026, 9, 9, 15, 0).getTime(), NOW)).toBe('6 days ago');
    expect(AINewsUI.relativeAge(new Date(2026, 8, 5, 15, 0).getTime(), NOW)).toBe('1 month ago');
  });
  it('a time in the future (clock skew) or garbage reads just now', () => {
    expect(AINewsUI.relativeAge(NOW + 5 * M, NOW)).toBe('just now');
    expect(AINewsUI.relativeAge(NaN, NOW)).toBe('just now');
  });
});

describe('what a card says about time', () => {
  it('relative age plus the absolute local time, full date in the title', () => {
    const w = AINewsUI.whenOf(IT('a', { publishedAt: NOW - 3 * H }), NOW);
    expect(w.text.startsWith('3 hours ago · ')).toBe(true);
    expect(w.text).toMatch(/Oct/);
    expect(w.title).toMatch(/2026/);
  });
  it('an unknown date says first seen, from firstSeenAt', () => {
    const w = AINewsUI.whenOf(IT('a', { publishedAt: 0, firstSeenAt: NOW - 2 * H }), NOW);
    expect(w.text).toBe('date unknown, first seen 2 hours ago');
    expect(w.title).toMatch(/^First seen: /);
  });
});

describe('date range', () => {
  const at = (ms) => IT('i' + ms, { publishedAt: NOW - ms, firstSeenAt: NOW - ms });
  const ids = (range, items) => AINewsUI.filterItems(items, { date: range }, NOW).map(i => i.id);
  it('keeps what is inside each range, boundary included', () => {
    const items = [at(0), at(H), at(H + 1), at(24 * H), at(24 * H + 1), at(72 * H), at(72 * H + 1), at(7 * D), at(7 * D + 1), at(14 * D), at(14 * D + 1)];
    const want = (...ms) => ms.map(m => 'i' + m);
    expect(ids('any', items).length).toBe(items.length);
    expect(ids('1h', items)).toEqual(want(0, H));
    expect(ids('24h', items)).toEqual(want(0, H, H + 1, 24 * H));
    expect(ids('3d', items)).toEqual(want(0, H, H + 1, 24 * H, 24 * H + 1, 72 * H));
    expect(ids('7d', items)).toEqual(want(0, H, H + 1, 24 * H, 24 * H + 1, 72 * H, 72 * H + 1, 7 * D));
    expect(ids('14d', items)).toEqual(want(0, H, H + 1, 24 * H, 24 * H + 1, 72 * H, 72 * H + 1, 7 * D, 7 * D + 1, 14 * D));
  });
  it('today starts at local midnight', () => {
    const midnight = new Date(2026, 9, 15, 0, 0, 0).getTime();
    const items = [IT('in', { publishedAt: midnight }), IT('out', { publishedAt: midnight - 1 })];
    expect(ids('today', items)).toEqual(['in']);
  });
  it('falls back to firstSeenAt when there is no publishedAt', () => {
    const items = [IT('seen', { publishedAt: 0, firstSeenAt: NOW - 30 * M }), IT('old', { publishedAt: 0, firstSeenAt: NOW - 5 * H })];
    expect(ids('1h', items)).toEqual(['seen']);
  });
});

describe('sorts and day headings', () => {
  const items = [
    IT('old-imp', { publishedAt: NOW - 3 * D, importance: 90, read: true }),
    IT('new-low', { publishedAt: NOW - 1 * H, importance: 10, read: true }),
    IT('mid-unread', { publishedAt: NOW - 5 * H, importance: 50, read: false }),
    IT('old-unread', { publishedAt: NOW - 2 * D, importance: 20, read: false }),
  ];
  const flat = (days) => days.flatMap(d => d.groups.map(g => g.main.id));
  it('newest first, grouped by day with headings', () => {
    const days = AINewsUI.arrange(items, 'newest');
    expect(flat(days)).toEqual(['new-low', 'mid-unread', 'old-unread', 'old-imp']);
    expect(days.every(d => d.key != null)).toBe(true);
  });
  it('most important first, one section without headings', () => {
    const days = AINewsUI.arrange(items, 'important');
    expect(days.length).toBe(1);
    expect(days[0].key).toBeNull();
    expect(flat(days)).toEqual(['old-imp', 'mid-unread', 'old-unread', 'new-low']);
  });
  it('unread first, then newest', () => {
    expect(flat(AINewsUI.arrange(items, 'unread'))).toEqual(['mid-unread', 'old-unread', 'new-low', 'old-imp']);
  });
  it('day labels say Today and Yesterday, then weekday and date', () => {
    const now = Date.now();
    expect(AINewsUI._dayLabel(now)).toBe('Today');
    expect(AINewsUI._dayLabel(now - D)).toBe('Yesterday');
    expect(AINewsUI._dayLabel(now - 3 * D)).not.toMatch(/^(Today|Yesterday)$/);
  });
});
describe('summary line', () => {
  it('counts shown of all and names the newest and oldest', () => {
    const shown = [IT('a', { publishedAt: NOW - H }), IT('b', { publishedAt: NOW - 2 * D })];
    const s = AINewsUI.summaryText(shown, 300, NOW);
    expect(s.startsWith('Showing 2 of 300 stories · newest ')).toBe(true);
    expect(s).toContain(' · oldest ');
    expect(AINewsUI.summaryText([shown[0]], 1, NOW).startsWith('Showing 1 of 1 story')).toBe(true);
  });
});

describe('the panel', () => {
  beforeEach(() => {
    document.body.textContent = '';
    document.getElementById('ain-panel')?.remove();
    AINewsUI.clearFilters();
    const t = Date.now();
    ITEMS = [
      IT('a', { title: 'Alpha model', publishedAt: t - 5 * M, firstSeenAt: t - 5 * M, topics: ['llm'], source: 'S1' }),
      IT('b', { title: 'Beta paper', publishedAt: t - 10 * D, firstSeenAt: t - 10 * D, source: 'S2' }),
      IT('c', { title: 'Gamma', publishedAt: 0, firstSeenAt: t - 2 * H, source: 'S1' }),
    ];
  });
  const titles = () => [...document.querySelectorAll('.ain-link')].map(a => a.textContent);

  it('shows the age on every card and the date unknown wording', () => {
    AINewsUI.openPanel();
    const times = [...document.querySelectorAll('.ain-when')].map(e => e.textContent);
    expect(times.length).toBe(3);
    expect(times.some(x => x.startsWith('5 minutes ago · '))).toBe(true);
    expect(times).toContain('date unknown, first seen 2 hours ago');
    expect(document.getElementById('ain-summary').textContent).toMatch(/^Showing 3 of 3 stories/);
    expect(document.getElementById('ain-clear').hidden).toBe(true);
    expect(document.querySelectorAll('.ain-day').length).toBeGreaterThan(0);
  });

  it('the new selects are labelled and filter; Clear filters shows only when a filter is set', () => {
    AINewsUI.openPanel();
    const sels = [...document.querySelectorAll('.ain-filters select')];
    const date = sels.find(s => s.getAttribute('aria-label') === 'Date');
    const sort = sels.find(s => s.getAttribute('aria-label') === 'Sort by');
    expect(date && sort).toBeTruthy();
    date.value = '24h'; date.dispatchEvent(new Event('change'));
    expect(titles().sort()).toEqual(['Alpha model', 'Gamma']);
    expect(document.getElementById('ain-clear').hidden).toBe(false);
    expect(document.getElementById('ain-summary').textContent).toMatch(/^Showing 2 of 3 stories/);
    sort.value = 'important'; sort.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('.ain-day').length).toBe(0);
  });

  it('keeps the filters when the panel is opened again, and Clear filters resets them', () => {
    AINewsUI.openPanel();
    const date = [...document.querySelectorAll('.ain-filters select')].find(s => s.getAttribute('aria-label') === 'Date');
    date.value = '1h'; date.dispatchEvent(new Event('change'));
    const search = document.querySelector('.ain-filters input[type=search]');
    search.value = 'alpha'; search.dispatchEvent(new Event('input'));
    document.getElementById('ain-panel').remove();

    AINewsUI.openPanel();
    expect(document.querySelector('.ain-filters input[type=search]').value).toBe('alpha');
    const date2 = [...document.querySelectorAll('.ain-filters select')].find(s => s.getAttribute('aria-label') === 'Date');
    expect(date2.value).toBe('1h');
    expect(titles()).toEqual(['Alpha model']);

    document.getElementById('ain-clear').click();
    expect(titles().length).toBe(3);
    expect(date2.value).toBe('any');
    expect(document.querySelector('.ain-filters input[type=search]').value).toBe('');
    expect(document.getElementById('ain-clear').hidden).toBe(true);
  });

  it('draws at most 100 cards and Show more adds the next page', () => {
    const t = Date.now();
    ITEMS = Array.from({ length: 230 }, (_, i) => IT('n' + i, { publishedAt: t - i * M, firstSeenAt: t - i * M }));
    AINewsUI.openPanel();
    expect(document.querySelectorAll('.ain-row').length).toBe(100);
    const more = document.querySelector('.ain-more');
    expect(more.textContent).toBe('Show more (130)');
    more.click();
    expect(document.querySelectorAll('.ain-row').length).toBe(200);
    document.querySelector('.ain-more').click();
    expect(document.querySelectorAll('.ain-row').length).toBe(230);
    expect(document.querySelector('.ain-more')).toBeNull();
  });
});
