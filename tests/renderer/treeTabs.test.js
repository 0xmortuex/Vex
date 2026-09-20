// @vitest-environment jsdom
//
// Tabs indented under the tab they came from. The indent has to mean what it
// looks like: a parent that is closed, in another group, or BELOW the tab in
// the list is not something to sit under, and a loop must not run forever.
import { describe, it, expect, beforeEach } from 'vitest';
const { TreeTabs: T } = require('../../src/renderer/js/tree-tabs.js');

const store = {};
const tab = (id, groupId = null) => ({ id, groupId, url: 'https://e.example/' + id, title: 'Tab ' + id });

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  document.body.innerHTML = '<div id="tabs-list"></div>';
  document.body.dataset.tabLayout = 'vertical';
  window.showToast = () => {};
});

const trailOf = (pairs) => new Map(pairs.map(([child, parent]) => [child, { id: parent }]));

describe('how deep a tab sits', () => {
  const tabs = [tab(1), tab(2), tab(3), tab(4)];

  it('one level per hop back to the tab that opened it', () => {
    const trail = trailOf([[2, 1], [3, 2], [4, 3]]);
    expect(T.depth(1, { tabs, trail })).toBe(0);
    expect(T.depth(2, { tabs, trail })).toBe(1);
    expect(T.depth(3, { tabs, trail })).toBe(2);
    expect(T.depth(4, { tabs, trail })).toBe(3);
  });

  it('never deeper than the strip has room for', () => {
    const many = Array.from({ length: 10 }, (_, i) => tab(i + 1));
    const trail = trailOf(many.slice(1).map((t, i) => [t.id, many[i].id]));
    expect(T.depth(10, { tabs: many, trail })).toBe(T.MAX_DEPTH);
  });

  it('a parent that has been closed is not indented under', () => {
    expect(T.depth(3, { tabs: [tab(1), tab(3)], trail: trailOf([[3, 2], [2, 1]]) })).toBe(0);
  });

  it('a parent in another group is not above it on screen', () => {
    const grouped = [tab(1, 'g1'), tab(2, 'g2')];
    expect(T.depth(2, { tabs: grouped, trail: trailOf([[2, 1]]) })).toBe(0);
  });

  it('a parent that sits below the tab is not a parent to look at', () => {
    const reordered = [tab(2), tab(1)];
    expect(T.depth(2, { tabs: reordered, trail: trailOf([[2, 1]]) })).toBe(0);
  });

  it('a loop does not go round forever', () => {
    const trail = trailOf([[2, 1], [1, 2]]);
    expect(T.depth(2, { tabs: [tab(1), tab(2)], trail })).toBe(1);
  });

  it('no trail at all is a flat list', () => {
    expect(T.depth(2, { tabs, trail: null })).toBe(0);
  });
});

describe('painting the strip', () => {
  beforeEach(() => {
    document.getElementById('tabs-list').innerHTML =
      '<div class="tab-item" data-tab-id="1"></div><div class="tab-item" data-tab-id="2"></div>';
    globalThis.TabManager = { tabs: [tab('1'), tab('2')] };
    globalThis.TabTrail = { from: new Map([['2', { id: '1' }]]) };
  });

  it('indents the child when it is switched on', () => {
    T.setEnabled(true);
    expect(T.apply()).toBe(1);
    const child = document.querySelector('[data-tab-id="2"]');
    expect(child.getAttribute('data-depth')).toBe('1');
    expect(child.style.marginLeft).toBe(T.STEP + 'px');
    expect(document.body.classList.contains('tree-tabs')).toBe(true);
  });

  it('switching it off takes every indent away again', () => {
    T.setEnabled(true);
    T.apply();
    T.setEnabled(false);
    const child = document.querySelector('[data-tab-id="2"]');
    expect(child.style.marginLeft).toBe('');
    expect(child.hasAttribute('data-depth')).toBe(false);
    expect(document.body.classList.contains('tree-tabs')).toBe(false);
  });

  it('does nothing at all when the tabs are along the top', () => {
    T.setEnabled(true);
    document.body.dataset.tabLayout = 'horizontal';
    expect(T.apply()).toBe(0);
    expect(document.querySelector('[data-tab-id="2"]').style.marginLeft).toBe('');
  });

  it('is off until it is asked for', () => {
    expect(T.enabled()).toBe(false);
    expect(T.toggle()).toBe(true);
    expect(T.toggle()).toBe(false);
  });
});
