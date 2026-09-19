// @vitest-environment jsdom
//
// A pile of saved links, read one at a time: the oldest unread replaces the
// page in the tab you are on, and says how many are left.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../src/renderer/js/collection-store.js';

let navigated, created, active;
beforeEach(() => {
  localStorage.clear();
  navigated = []; created = [];
  active = { id: 't1', url: 'https://reading.example/article' };
  globalThis.TabManager = { getActiveTab: () => active, createTab: (u) => created.push(u) };
  globalThis.WebviewManager = { navigate: (u) => navigated.push(u) };
  window.showToast = vi.fn();
});

describe('Next from Read Later', () => {
  it('opens the oldest unread in this tab, marks it read, and says what is left', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    localStorage.setItem('vex.readLater', JSON.stringify([
      { id: 'c', url: 'https://c.test', read: false },          // newest first, as add() stores them
      { id: 'b', url: 'https://b.test', read: true },
      { id: 'a', url: 'https://a.test', read: false },
    ]));
    ReadLater.init();
    expect(ReadLater.next().id).toBe('a');
    expect(navigated).toEqual(['https://a.test']);
    expect(window.showToast).toHaveBeenLastCalledWith('1 more to read — Ctrl+K › Next from Read Later');
    expect(ReadLater.next().id).toBe('c');
    expect(window.showToast).toHaveBeenLastCalledWith('That was the last one');
    expect(ReadLater.next()).toBeNull();
    expect(window.showToast).toHaveBeenLastCalledWith('Nothing left in Read Later');
  });

  it('from a new tab page it opens a tab rather than replacing nothing', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    localStorage.setItem('vex.readLater', JSON.stringify([{ id: 'a', url: 'https://a.test', read: false }]));
    ReadLater.init();
    active = { id: 't1', url: 'file:///start.html' };
    ReadLater.next();
    expect(created).toEqual(['https://a.test']);
    expect(navigated).toEqual([]);
  });
});

describe('how old a saved link is, and how long it takes to read', () => {
  it('measures the page once, in the background, and keeps the minutes', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    localStorage.setItem('vex.readLater', JSON.stringify([{ id: 'a', url: 'https://a.test', title: 'https://a.test', at: Date.now(), read: false }]));
    ReadLater.init();
    globalThis.AgentTools = { readUrl: vi.fn(async () => ({ title: 'A long read', text: 'word '.repeat(660) })) };
    expect(await ReadLater.measure('a')).toBe(3);                 // 660 words at 220 a minute
    expect(ReadLater.items[0].title).toBe('A long read');
    expect(await ReadLater.measure('a')).toBeNull();              // measured once
    expect(AgentTools.readUrl).toHaveBeenCalledTimes(1);
  });

  it('a page that cannot be read is recorded, and the link stays', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    localStorage.setItem('vex.readLater', JSON.stringify([{ id: 'a', url: 'https://a.test', at: Date.now(), read: false }]));
    ReadLater.init();
    window.VexProblems = { note: vi.fn() };
    globalThis.AgentTools = { readUrl: vi.fn(async () => { throw new Error('refused'); }) };
    expect(await ReadLater.measure('a')).toBeNull();
    expect(window.VexProblems.note).toHaveBeenCalled();
    expect(ReadLater.items).toHaveLength(1);
  });

  it('says how long ago it was saved, and which are over a month old', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    const now = Date.now(), day = 24 * 3600 * 1000;
    localStorage.setItem('vex.readLater', JSON.stringify([
      { id: 'new', url: 'https://n.test', at: now - day, read: false },
      { id: 'old', url: 'https://o.test', at: now - 40 * day, read: false },
      { id: 'done', url: 'https://d.test', at: now - 90 * day, read: true },
    ]));
    ReadLater.init();
    expect(ReadLater.describeAge(now - day, now)).toBe('yesterday');
    expect(ReadLater.describeAge(now - 12 * day, now)).toBe('12 days ago');
    expect(ReadLater.describeAge(now - 40 * day, now)).toBe('a month ago');
    expect(ReadLater.old(now).map(i => i.id)).toEqual(['old']);    // read ones are not nagged about
  });
});
