// @vitest-environment jsdom
//
// The mobile tab model. It holds no views — the Android WebViews live in
// VexTabsPlugin — so what it has to get right is bookkeeping: which tab is
// active after a close, what a private tab is allowed to leave behind, and
// what comes back after the app is killed.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; },
  push: async (key, entry, cap = 500) => {
    const list = key in store ? store[key] : [];
    list.unshift(entry);
    if (list.length > cap) list.length = cap;
    store[key] = list;
    return list;
  }
};

let created = [];
let closed = [];
let activated = [];
let navigated = [];
let sequence = 0;
window.VexBridge = {
  createTab: vi.fn(async (url, opts) => { const id = 'n' + (++sequence); created.push({ id, url, opts }); return { id }; }),
  closeTab: vi.fn(async id => { closed.push(id); }),
  activateTab: vi.fn(async id => { activated.push(id); }),
  load: vi.fn(async (id, url) => { navigated.push({ id, url }); })
};

const { VexTabStore } = require('../../mobile/www/js/tabs.js');

async function reset() {
  for (const tab of VexTabStore.all()) await VexTabStore.close(tab.id);
  for (const key of Object.keys(store)) delete store[key];
  created = []; closed = []; activated = []; navigated = [];
}

beforeEach(reset);

describe('opening tabs', () => {
  it('creates a tab, makes it active and counts it', async () => {
    const tab = await VexTabStore.create('https://example.com/');
    expect(tab.url).toBe('https://example.com/');
    expect(VexTabStore.activeId()).toBe(tab.id);
    expect(VexTabStore.all()).toHaveLength(1);
    expect(activated).toEqual([tab.id]);
  });

  it('can open one in the background without stealing focus', async () => {
    const first = await VexTabStore.create('https://a.example/');
    await VexTabStore.create('https://b.example/', { background: true });
    expect(VexTabStore.activeId()).toBe(first.id);
    expect(VexTabStore.all()).toHaveLength(2);
  });

  it('keeps private tabs in their own list', async () => {
    await VexTabStore.create('https://a.example/');
    await VexTabStore.create('https://secret.example/', { incognito: true });
    expect(VexTabStore.normal()).toHaveLength(1);
    expect(VexTabStore.private()).toHaveLength(1);
    expect(VexTabStore.count(true)).toBe(1);
    expect(created[1].opts.incognito).toBe(true);
  });
});

describe('closing tabs', () => {
  it('hands focus to a neighbour and destroys the native view', async () => {
    const first = await VexTabStore.create('https://a.example/');
    const second = await VexTabStore.create('https://b.example/');
    await VexTabStore.close(second.id);
    expect(closed).toContain(second.id);
    expect(VexTabStore.activeId()).toBe(first.id);
  });

  it('remembers what was closed so it can be reopened', async () => {
    const tab = await VexTabStore.create('https://a.example/');
    await VexTabStore.close(tab.id);
    expect(store['vex.closedTabs'][0]).toMatchObject({ url: 'https://a.example/' });
  });

  it('never writes a private tab into the reopen list', async () => {
    const tab = await VexTabStore.create('https://secret.example/', { incognito: true });
    await VexTabStore.close(tab.id);
    expect(store['vex.closedTabs']).toBeUndefined();
  });

  it('closes a whole side without touching the other', async () => {
    await VexTabStore.create('https://a.example/');
    await VexTabStore.create('https://p1.example/', { incognito: true });
    await VexTabStore.create('https://p2.example/', { incognito: true });
    await VexTabStore.closeAll(true);
    expect(VexTabStore.private()).toHaveLength(0);
    expect(VexTabStore.normal()).toHaveLength(1);
  });
});

describe('the session', () => {
  it('saves only normal tabs, and which one was in front', async () => {
    const first = await VexTabStore.create('https://a.example/');
    await VexTabStore.create('https://secret.example/', { incognito: true });
    await VexTabStore.activate(first.id);
    VexTabStore.persist();
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(store['vex.openTabs']).toEqual([{ url: 'https://a.example/', title: '' }]);
    expect(store['vex.activeTabUrl']).toBe('https://a.example/');
  });

  it('brings the last session back and restores the front tab', async () => {
    store['vex.openTabs'] = [
      { url: 'https://a.example/', title: 'A' },
      { url: 'https://b.example/', title: 'B' }
    ];
    store['vex.activeTabUrl'] = 'https://b.example/';
    const count = await VexTabStore.restore();
    expect(count).toBe(2);
    expect(VexTabStore.all()).toHaveLength(2);
    expect(VexTabStore.active().url).toBe('https://b.example/');
  });

  it('restores nothing when there was nothing open', async () => {
    expect(await VexTabStore.restore()).toBe(0);
    expect(VexTabStore.all()).toHaveLength(0);
  });
});

describe('navigation', () => {
  it('marks the tab as loading and asks native to load', async () => {
    const tab = await VexTabStore.create('about:blank');
    await VexTabStore.navigate(tab.id, 'https://example.com/');
    expect(tab.pendingUrl).toBe('https://example.com/');
    expect(tab.loading).toBe(true);
    expect(navigated).toContainEqual({ id: tab.id, url: 'https://example.com/' });
  });

  it('tells anyone listening when a tab changes', async () => {
    const seen = vi.fn();
    const off = VexTabStore.onChange(seen);
    const tab = await VexTabStore.create('https://a.example/');
    seen.mockClear();
    VexTabStore.update(tab.id, { title: 'Hello' });
    expect(seen).toHaveBeenCalled();
    expect(VexTabStore.get(tab.id).title).toBe('Hello');
    off();
  });
});
