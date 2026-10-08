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
    expect(store['vex.openTabs']).toEqual([{
      url: 'https://a.example/', title: '', icon: '', scrollY: 0, lastActiveAt: expect.any(Number)
    }]);
    expect(store['vex.activeTabUrl']).toBe('https://a.example/');
  });

  it('remembers when each tab was last in front, so a stale tab stays stale', async () => {
    // "Close tabs you have not opened in a month" measures from lastActiveAt.
    // If that does not survive the restart, every restored tab looks like it
    // was opened a moment ago and the setting can never fire once.
    window.VexBridge.restoreScroll = vi.fn(async () => {});
    const old = Date.now() - 40 * 86400000;
    store['vex.openTabs'] = [
      { url: 'https://stale.example/', title: 'Stale', lastActiveAt: old },
      { url: 'https://fresh.example/', title: 'Fresh' }
    ];
    store['vex.activeTabUrl'] = 'https://fresh.example/';
    await VexTabStore.restore();
    const stale = VexTabStore.all().find(tab => tab.url === 'https://stale.example/');
    expect(stale.lastActiveAt).toBe(old);
    // The one you were last looking at counts as opened now.
    expect(VexTabStore.active().lastActiveAt).toBeGreaterThan(old);

    // And it goes back out the way it came in.
    VexTabStore.persist();
    await new Promise(resolve => setTimeout(resolve, 500));
    const saved = store['vex.openTabs'].find(entry => entry.url === 'https://stale.example/');
    expect(saved.lastActiveAt).toBe(old);
  });

  it('brings the last session back, with the front tab and where it was scrolled', async () => {
    window.VexBridge.restoreScroll = vi.fn(async () => {});
    store['vex.openTabs'] = [
      { url: 'https://a.example/', title: 'A', scrollY: 640 },
      { url: 'https://b.example/', title: 'B' }
    ];
    store['vex.activeTabUrl'] = 'https://b.example/';
    const count = await VexTabStore.restore();
    expect(count).toBe(2);
    expect(VexTabStore.all()).toHaveLength(2);
    expect(VexTabStore.active().url).toBe('https://b.example/');

    // Where you were on the page is part of where you were — once the page is
    // there. Restoring it before would scroll the blank document a lazy tab
    // starts on.
    const a = VexTabStore.all().find(tab => tab.url === 'https://a.example/');
    expect(window.VexBridge.restoreScroll).not.toHaveBeenCalled();
    await VexTabStore.activate(a.id);
    expect(window.VexBridge.restoreScroll).toHaveBeenCalledWith(a.id, 640);
  });

  it('loads only the tab in front; the rest wait until they are opened', async () => {
    // Thirty tabs left open used to mean thirty page loads on every cold start.
    store['vex.openTabs'] = [
      { url: 'https://a.example/', title: 'A' },
      { url: 'https://b.example/', title: 'B' },
      { url: 'https://c.example/', title: 'C' }
    ];
    store['vex.activeTabUrl'] = 'https://b.example/';
    await VexTabStore.restore();

    // Every native tab started blank, and only B was sent anywhere.
    expect(created.map(entry => entry.url)).toEqual(['about:blank', 'about:blank', 'about:blank']);
    expect(navigated.map(entry => entry.url)).toEqual(['https://b.example/']);

    // The others still know where they are, for the switcher and for the next launch.
    const c = VexTabStore.all().find(tab => tab.url === 'https://c.example/');
    expect(c.lazy).toBe(true);
    expect(c.title).toBe('C');

    // Opening one is what loads it.
    await VexTabStore.activate(c.id);
    expect(navigated.map(entry => entry.url)).toEqual(['https://b.example/', 'https://c.example/']);
    expect(VexTabStore.get(c.id).lazy).toBe(false);
  });

  it('does not let a lazy tab take the blank page’s address or title', () => {
    // Its WebView is showing about:blank, and every event it raises says so.
    return VexTabStore.create('https://d.example/', { background: true, lazy: true, title: 'D' }).then(tab => {
      VexTabStore.update(tab.id, { url: 'about:blank', title: '', loading: false, canGoBack: false });
      expect(VexTabStore.get(tab.id)).toMatchObject({ url: 'https://d.example/', title: 'D', lazy: true });
    });
  });

  it('a new tab is never lazy, and neither is a blank one', async () => {
    const fresh = await VexTabStore.create('https://e.example/');
    expect(fresh.lazy).toBeFalsy();
    const blank = await VexTabStore.create('about:blank', { lazy: true, background: true });
    expect(blank.lazy).toBeFalsy();
  });

  it('restores nothing when there was nothing open', async () => {
    expect(await VexTabStore.restore()).toBe(0);
    expect(VexTabStore.all()).toHaveLength(0);
  });
});

describe('sleeping', () => {
  it('a tab is awake when it is made, and waking is part of activating', async () => {
    const first = await VexTabStore.create('https://a.example/');
    const second = await VexTabStore.create('https://b.example/');
    expect(first.asleep).toBe(false);

    // What app.js's sleep pass does to a tab it has put to sleep.
    VexTabStore.update(first.id, { asleep: true });
    expect(VexTabStore.get(first.id).asleep).toBe(true);
    expect(VexTabStore.get(second.id).asleep).toBe(false);

    await VexTabStore.activate(first.id);
    expect(VexTabStore.get(first.id).asleep).toBe(false);
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
