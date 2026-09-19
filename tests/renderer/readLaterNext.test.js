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
