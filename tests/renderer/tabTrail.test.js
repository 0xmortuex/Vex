// How you got here: the chain of tabs that led to this one. The chain has to
// survive a closed tab in the middle, must never loop, and must not record a
// tab that came from nowhere.
import { describe, it, expect, beforeEach } from 'vitest';
const { TabTrail } = require('../../src/renderer/js/tab-trail.js');

const tab = (id, url, title) => ({ id, url, title });

beforeEach(() => {
  TabTrail.from.clear();
  globalThis.TabManager = { tabs: [], switchTab: () => {}, createTab: () => {} };
});

describe('what is recorded', () => {
  it('a tab opened from a page remembers that page', () => {
    const hop = TabTrail.record(tab(2, 'https://b.example/'), tab(1, 'https://a.example/', 'A'));
    expect(hop).toMatchObject({ id: 1, url: 'https://a.example/', title: 'A' });
  });

  it('a new empty tab, or one opened from a Vex page, records nothing', () => {
    expect(TabTrail.record(tab(2, 'file:///start.html'), tab(1, 'https://a.example/'))).toBe(null);
    expect(TabTrail.record(tab(2, 'https://b.example/'), tab(1, 'file:///start.html'))).toBe(null);
    expect(TabTrail.record(tab(2, 'https://b.example/'), null)).toBe(null);
    expect(TabTrail.from.size).toBe(0);
  });

  it('a tab cannot be its own opener', () => {
    expect(TabTrail.record(tab(1, 'https://a.example/'), tab(1, 'https://a.example/'))).toBe(null);
  });

  it('the oldest fall off rather than growing without end', () => {
    for (let i = 1; i <= TabTrail.MAX_KEPT + 5; i++) {
      TabTrail.record(tab(i + 1000, 'https://b.example/' + i), tab(i, 'https://a.example/' + i));
    }
    expect(TabTrail.from.size).toBeLessThanOrEqual(TabTrail.MAX_KEPT);
    expect(TabTrail.from.has(1001)).toBe(false);
  });
});

describe('the chain', () => {
  beforeEach(() => {
    TabTrail.record(tab(2, 'https://b.example/'), tab(1, 'https://a.example/', 'A'));
    TabTrail.record(tab(3, 'https://c.example/'), tab(2, 'https://b.example/', 'B'));
  });

  it('goes back through every hop, nearest first', () => {
    expect(TabTrail.chain(3).map(h => h.id)).toEqual([2, 1]);
  });

  it('still works when the tab in the middle was closed', () => {
    TabManager.tabs = [{ id: 3 }];
    const hops = TabTrail.chain(3);
    expect(hops).toHaveLength(2);
    expect(TabTrail.isOpen(hops[0].id)).toBe(false);
  });

  it('a tab that opened the tab that opened it does not loop forever', () => {
    TabTrail.record(tab(1, 'https://a.example/'), tab(3, 'https://c.example/', 'C'));
    const hops = TabTrail.chain(3);
    expect(hops.map(h => h.id)).toEqual([2, 1]);
  });

  it('a tab that came from nowhere has no chain', () => {
    expect(TabTrail.chain(9)).toEqual([]);
  });
});

describe('going back to a hop', () => {
  it('switches to the tab when it is still open', () => {
    let switched = null;
    TabManager.tabs = [{ id: 1 }];
    TabManager.switchTab = (id) => { switched = id; };
    expect(TabTrail.go({ id: 1, url: 'https://a.example/' })).toBe('switched');
    expect(switched).toBe(1);
  });

  it('opens the page again when the tab is gone', () => {
    let opened = null;
    TabManager.tabs = [];
    TabManager.createTab = (url) => { opened = url; };
    expect(TabTrail.go({ id: 1, url: 'https://a.example/' })).toBe('reopened');
    expect(opened).toBe('https://a.example/');
  });

  it('a hop with no title is named by its site', () => {
    expect(TabTrail.label({ url: 'https://www.example.com/x', title: 'Loading...' })).toBe('example.com');
    expect(TabTrail.label({ url: 'https://www.example.com/x', title: 'Real title' })).toBe('Real title');
  });
});
