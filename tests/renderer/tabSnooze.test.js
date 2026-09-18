// @vitest-environment jsdom
//
// A tab stays open because closing it loses it, so the strip fills with things
// that are not for today. Snoozing closes one and brings it back when you said;
// archiving takes a week-old tab out of the strip and lists it instead.
// Neither ever loses the address — that is the whole point.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { TabSnooze } = require('../../src/renderer/js/tab-snooze.js');

const NOW = new Date('2026-09-18T14:00:00').getTime();     // a Friday afternoon
let closed, opened;

beforeEach(() => {
  localStorage.clear();
  closed = []; opened = [];
  vi.useFakeTimers({ now: NOW });
  globalThis.TabManager = {
    tabs: [{ id: 't1', url: 'https://example.com/a', title: 'A page', lastViewedAt: NOW }],
    activeTabId: 't1',
    closeTab: vi.fn((id) => { closed.push(id); TabManager.tabs = TabManager.tabs.filter(t => t.id !== id); }),
    createTab: vi.fn((url, focus) => opened.push([url, focus])),
    isCapturing: () => false,
  };
  globalThis.VexProblems = { note: vi.fn() };
  window.showToast = vi.fn();
});
afterEach(() => { vi.useRealTimers(); delete TabSnooze._timer; delete TabSnooze._archiveTimer; });

describe('snoozing a tab', () => {
  it('closes it now and remembers when to bring it back', () => {
    const e = TabSnooze.snooze('t1', 'hour');
    expect(closed).toEqual(['t1']);
    expect(e.url).toBe('https://example.com/a');
    expect(e.at).toBe(NOW + 3600 * 1000);
    expect(TabSnooze.list()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(TabSnooze.KEY))[0].title).toBe('A page');   // survives a restart
  });

  it('understands the rough times people mean', () => {
    const at = (k) => new Date(TabSnooze.WHEN[k].at());
    expect(at('evening').getHours()).toBe(19);
    expect(at('evening').getDate()).toBe(18);                 // still today at 14:00
    expect(at('tomorrow').getDate()).toBe(19);
    expect(at('tomorrow').getHours()).toBe(9);
    expect(at('weekend').getDay()).toBe(6);                   // Saturday
    expect(at('monday').getDay()).toBe(1);
    expect(at('week').getTime()).toBe(NOW + 7 * 24 * 3600 * 1000);
  });

  it('"this evening" after 7pm means tomorrow evening, not a time in the past', () => {
    vi.setSystemTime(new Date('2026-09-18T21:00:00').getTime());
    const d = new Date(TabSnooze.WHEN.evening.at());
    expect(d.getDate()).toBe(19);
    expect(d.getHours()).toBe(19);
  });

  it('refuses what it cannot bring back, and keeps the tab open when it does', () => {
    expect(() => TabSnooze.snooze('gone', 'hour')).toThrow(/not open any more/);
    globalThis.TabManager.tabs = [{ id: 't2', url: 'vex://start', title: 'New Tab' }];
    expect(() => TabSnooze.snooze('t2', 'hour')).toThrow(/Only a web page/);
    expect(closed).toEqual([]);
  });

  it('brings it back when it is due, in the background, and says so', () => {
    TabSnooze.snooze('t1', 'hour');
    expect(TabSnooze.checkDue(NOW + 60 * 1000)).toEqual([]);      // not yet
    expect(opened).toEqual([]);
    const due = TabSnooze.checkDue(NOW + 3700 * 1000);
    expect(due).toHaveLength(1);
    expect(opened).toEqual([['https://example.com/a', false]]);
    expect(TabSnooze.list()).toEqual([]);
    expect(window.showToast).toHaveBeenCalledWith('Back as you asked: A page');
  });

  it('several at once are one notice', () => {
    TabSnooze._write(TabSnooze.KEY, [
      { id: 'a', url: 'https://a.example/', title: 'A', at: NOW - 1 },
      { id: 'b', url: 'https://b.example/', title: 'B', at: NOW - 1 },
    ]);
    TabSnooze.checkDue(NOW);
    expect(opened).toHaveLength(2);
    expect(window.showToast).toHaveBeenCalledWith('2 snoozed tabs are back');
  });

  it('can be woken or forgotten by hand', () => {
    const e = TabSnooze.snooze('t1', 'week');
    TabSnooze.wake(e.id);
    expect(opened).toEqual([['https://example.com/a', true]]);
    expect(TabSnooze.list()).toEqual([]);
    expect(() => TabSnooze.wake('nope')).toThrow(/no longer snoozed/);
  });
});

describe('archiving what nobody has looked at', () => {
  const old = (id, days) => ({ id, url: 'https://' + id + '.example/', title: id, lastViewedAt: NOW - days * 24 * 3600 * 1000 });

  it('takes week-old tabs out of the strip, keeping every address', () => {
    globalThis.TabManager.tabs = [
      { id: 'active', url: 'https://a.example/', lastViewedAt: NOW },
      old('stale', 9), old('fresh', 2),
      { ...old('pinned', 30), pinned: true },
    ];
    globalThis.TabManager.activeTabId = 'active';
    const moved = TabSnooze.archiveIdle(NOW);
    expect(moved.map(t => t.id)).toEqual(['stale']);
    expect(closed).toEqual(['stale']);
    expect(TabSnooze.archived()[0]).toMatchObject({ url: 'https://stale.example/', title: 'stale' });
    expect(window.showToast).toHaveBeenCalledWith('1 tab untouched for a week moved to the archive — nothing was lost');
  });

  it('never touches the active tab, a pinned one, or one making noise', () => {
    globalThis.TabManager.tabs = [
      { id: 'active', url: 'https://a.example/', lastViewedAt: NOW - 30 * 24 * 3600 * 1000 },
      { ...old('loud', 30), audible: true, muted: false },
      { ...old('recording', 30) },
    ];
    globalThis.TabManager.activeTabId = 'active';
    globalThis.TabManager.isCapturing = (t) => t.id === 'recording';
    expect(TabSnooze.archiveIdle(NOW)).toEqual([]);
    expect(closed).toEqual([]);
  });

  it('can be switched off, and puts one back on request', () => {
    localStorage.setItem('vex.autoArchive', 'off');
    globalThis.TabManager.tabs = [{ id: 'active' }, old('stale', 30)];
    globalThis.TabManager.activeTabId = 'active';
    expect(TabSnooze.archiveIdle(NOW)).toEqual([]);

    localStorage.removeItem('vex.autoArchive');
    TabSnooze.archiveIdle(NOW);
    const entry = TabSnooze.archived()[0];
    TabSnooze.restore(entry.id);
    expect(opened).toEqual([['https://stale.example/', true]]);
    expect(TabSnooze.archived()).toEqual([]);
    expect(() => TabSnooze.restore('nope')).toThrow(/not in the archive/);
  });

  it('the archive does not grow for ever', () => {
    TabSnooze._write(TabSnooze.ARCHIVE_KEY, Array.from({ length: TabSnooze.MAX_ARCHIVE }, (_, i) => ({ id: 'old' + i, url: 'https://x' + i + '.example/', title: 'x', at: 1 })));
    globalThis.TabManager.tabs = [{ id: 'active' }, old('stale', 30)];
    globalThis.TabManager.activeTabId = 'active';
    TabSnooze.archiveIdle(NOW);
    expect(TabSnooze.archived()).toHaveLength(TabSnooze.MAX_ARCHIVE);
    expect(TabSnooze.archived()[0].title).toBe('stale');            // newest kept
  });
});
