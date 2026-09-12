// @vitest-environment jsdom
//
// Browsing history. The panel keeps the list in memory and saves it back to
// localStorage, which meant a visit recorded before the panel had ever been
// opened wrote a one-item array over everything saved before it — the whole
// history, gone on the first page of every session. These cover that, plus the
// placeholder titles, repeat visits, and the two entry shapes history has been
// written in (ISO `visitedAt` here, epoch `time` in the file store).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'vex.history';
// A fresh module each time: the panel hydrates from storage as it loads, and
// require() would otherwise hand back the previous test's in-memory list.
const MODULE = '../../src/renderer/js/history-panel.js';
const load = () => {
  vi.resetModules();
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE).HistoryPanel;
};
const stored = () => JSON.parse(localStorage.getItem(KEY) || '[]');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (s) => String(s == null ? '' : s);
});

describe('recording a visit', () => {
  it('keeps history the panel was never opened to load', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { id: 'old1', url: 'https://one.example/', title: 'One', visitedAt: new Date(Date.now() - 7200000).toISOString() },
      { id: 'old2', url: 'https://two.example/', title: 'Two', visitedAt: new Date(Date.now() - 3600000).toISOString() },
    ]));
    const H = load();                       // module loads; panel never opened
    H.addEntry('https://three.example/', 'Three');
    expect(stored().map(e => e.url)).toEqual([
      'https://three.example/', 'https://two.example/', 'https://one.example/',
    ]);
  });

  it('only records real web pages', () => {
    const H = load();
    for (const url of ['file:///c:/tmp/x.html', 'about:blank', 'vex://start', 'data:text/html,hi', '']) H.addEntry(url, 'No');
    expect(stored()).toEqual([]);
  });

  it('a repeat visit today moves the row up instead of duplicating it', () => {
    const H = load();
    H.addEntry('https://a.example/', 'A');
    H.addEntry('https://b.example/', 'B');
    H.addEntry('https://a.example/', 'A');
    expect(stored().map(e => e.url)).toEqual(['https://a.example/', 'https://b.example/']);
    expect(stored()[0].id).toBe(H.entries[0].id);
  });

  it('the same page on another day is its own row', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { id: 'yesterday', url: 'https://a.example/', title: 'A', visitedAt: new Date(Date.now() - 48 * 3600000).toISOString() },
    ]));
    const H = load();
    H.addEntry('https://a.example/', 'A');
    expect(stored()).toHaveLength(2);
  });
});

describe('titles', () => {
  it('replaces the placeholder once the page says its name', () => {
    const H = load();
    H.addEntry('https://a.example/', 'Loading...');
    expect(stored()[0].title).toBe('https://a.example/');   // URL until it is known
    H.updateTitle('https://a.example/', 'Example Domain');
    expect(stored()[0].title).toBe('Example Domain');
  });

  it('never overwrites a real title with a placeholder', () => {
    const H = load();
    H.addEntry('https://a.example/', 'Example Domain');
    H.updateTitle('https://a.example/', 'Loading…');
    H.addEntry('https://a.example/', 'https://a.example/');
    expect(stored()[0].title).toBe('Example Domain');
  });
});

describe('reading what was saved', () => {
  it('understands the file store\'s shape as well as its own', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { url: 'https://old.example/', title: 'From the file store', time: Date.parse('2026-09-11T10:00:00Z') },
    ]));
    const H = load();
    const entry = H.list()[0];
    expect(entry.visitedAt).toBe(new Date(Date.parse('2026-09-11T10:00:00Z')).toISOString());
    expect(H._when(entry).getTime()).toBe(Date.parse('2026-09-11T10:00:00Z'));
    expect(entry.id).toBeTruthy();
  });

  it('drops junk rather than rendering it', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { url: 'javascript:alert(1)', title: 'Bad' },
      { title: 'No URL at all' },
      null,
      { url: 'https://good.example/', title: 'Good' },
    ]));
    expect(load().list().map(e => e.url)).toEqual(['https://good.example/']);
  });

  it('only lets http(s) favicons reach the img tag', () => {
    const H = load();
    H.addEntry('https://a.example/', 'A', 'javascript:alert(1)');
    H.addEntry('https://b.example/', 'B', 'https://b.example/favicon.ico');
    expect(stored().find(e => e.url === 'https://a.example/').favicon).toBe('');
    expect(stored().find(e => e.url === 'https://b.example/').favicon).toBe('https://b.example/favicon.ico');
  });

  it('a corrupt store starts empty instead of throwing', () => {
    localStorage.setItem(KEY, '{not json');
    const H = load();
    expect(H.list()).toEqual([]);
    H.addEntry('https://a.example/', 'A');
    expect(stored()).toHaveLength(1);
  });
});

describe('the time filters', () => {
  it('count both entry shapes', () => {
    const now = Date.now();
    localStorage.setItem(KEY, JSON.stringify([
      { url: 'https://today.example/', title: 'Today', visitedAt: new Date(now - 1000).toISOString() },
      { url: 'https://lastweek.example/', title: 'Last week', time: now - 5 * 86400000 },
      { url: 'https://lastyear.example/', title: 'Last year', time: now - 400 * 86400000 },
    ]));
    const H = load();
    H.activeFilter = 'today';
    expect(H.getTimeFiltered().map(e => e.url)).toEqual(['https://today.example/']);
    H.activeFilter = 'week';
    expect(H.getTimeFiltered()).toHaveLength(2);
    H.activeFilter = 'all';
    expect(H.getTimeFiltered()).toHaveLength(3);
  });
});
