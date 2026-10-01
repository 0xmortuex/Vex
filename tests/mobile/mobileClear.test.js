// @vitest-environment jsdom
//
// Clearing browsing data. The thing worth pinning down is that nothing clears
// anything it was not asked to: an all-or-nothing clear is easy to get right and
// is not what this offers.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};

const cleared = [];
window.VexDB = {
  clear: vi.fn(async name => { cleared.push('db:' + name); }),
  count: vi.fn(async name => (name === 'downloads' ? 4 : 0))
};
window.VexBridge = { clearData: vi.fn(async options => { cleared.push('native:' + Object.keys(options).sort().join('+')); }) };
window.VexHistory = {
  clear: vi.fn(async () => { cleared.push('history+recall'); }),
  clearVisits: vi.fn(async () => { cleared.push('history'); }),
  clearPageText: vi.fn(async () => { cleared.push('recall'); }),
  stats: vi.fn(async () => ({ visits: 1200, pages: 300, saved: 7 }))
};
let tabs = [{ id: 't1' }, { id: 't2' }];
window.VexTabStore = {
  normal: () => tabs,
  closeAll: vi.fn(async () => { cleared.push('tabs'); tabs = []; }),
  all: () => tabs,
  create: vi.fn(async url => { tabs.push({ id: 'fresh', url }); return tabs.at(-1); })
};

const { VexClear } = require('../../mobile/www/js/clear.js');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  cleared.length = 0;
  tabs = [{ id: 't1' }, { id: 't2' }];
  for (const fn of [window.VexDB.clear, window.VexBridge.clearData, window.VexHistory.clear,
    window.VexHistory.clearVisits, window.VexHistory.clearPageText, window.VexTabStore.closeAll]) fn.mockClear();
});

describe('what is ticked', () => {
  it('starts on the three most people mean, and nothing unrecoverable', () => {
    const picked = VexClear.chosen();
    expect(picked.cookies).toBe(true);
    expect(picked.cache).toBe(true);
    expect(picked.history).toBe(true);
    expect(picked.recall).toBe(false);
    expect(picked.saved).toBe(false);
    expect(picked.tabs).toBe(false);
  });

  it('remembers a change, and keeps the shape whatever is stored', async () => {
    await VexClear.setChosen('saved', true);
    expect(VexClear.chosen().saved).toBe(true);
    // A preference someone has edited by hand, or an older version's shape.
    store['vex.clearItems'] = 'nonsense';
    expect(VexClear.chosen().cookies).toBe(true);
    store['vex.clearItems'] = { cookies: 'yes' };
    expect(VexClear.chosen().cookies).toBe(false);     // only true means true
  });

  it('says what would go, without listing eight things', async () => {
    expect(VexClear.describe()).toBe('cookies and site data, cached files, history');
    for (const id of ['recall', 'saved', 'downloads']) await VexClear.setChosen(id, true);
    expect(VexClear.describe()).toBe('6 things');
    store['vex.clearItems'] = {};
    expect(VexClear.describe()).toBe('Nothing is ticked');
  });
});

describe('clearing', () => {
  it('clears exactly what was asked for', async () => {
    const done = await VexClear.run({ cache: true });
    expect(done).toEqual(['cache']);
    expect(window.VexBridge.clearData).toHaveBeenCalledWith({ cache: true });
    expect(window.VexHistory.clear).not.toHaveBeenCalled();
    expect(window.VexDB.clear).not.toHaveBeenCalled();
  });

  it('takes cookies to mean site storage as well', async () => {
    await VexClear.run({ cookies: true });
    expect(window.VexBridge.clearData).toHaveBeenCalledWith({ cookies: true, storage: true });
  });

  it('can take history without Recall, and Recall without history', async () => {
    await VexClear.run({ history: true });
    expect(window.VexHistory.clearVisits).toHaveBeenCalled();
    expect(window.VexHistory.clearPageText).not.toHaveBeenCalled();

    window.VexHistory.clearVisits.mockClear();
    await VexClear.run({ recall: true });
    expect(window.VexHistory.clearPageText).toHaveBeenCalled();
    expect(window.VexHistory.clearVisits).not.toHaveBeenCalled();

    window.VexHistory.clearPageText.mockClear();
    await VexClear.run({ history: true, recall: true });
    expect(window.VexHistory.clear).toHaveBeenCalled();
  });

  it('takes the saved document with the saved page', async () => {
    await VexClear.run({ saved: true });
    expect(cleared).toEqual(['db:pages', 'db:pagehtml']);
  });

  it('closes the tabs last, so a fresh one is not opened into old cookies', async () => {
    const done = await VexClear.run({ cookies: true, tabs: true });
    expect(done).toEqual(['cookies', 'tabs']);
    expect(cleared[0]).toBe('native:cookies+storage');
    expect(cleared.at(-1)).toBe('tabs');
    expect(window.VexTabStore.closeAll).toHaveBeenCalledTimes(2);   // normal and private
  });

  it('leaves one tab open, because a browser with none is a blank shell', async () => {
    await VexClear.run({ tabs: true });
    expect(window.VexTabStore.create).toHaveBeenCalledWith('about:blank');
    expect(tabs.length).toBe(1);
  });
});

describe('on the way out', () => {
  it('does nothing unless it was switched on', async () => {
    expect(await VexClear.onLeaving()).toEqual([]);
    expect(window.VexBridge.clearData).not.toHaveBeenCalled();
  });

  it('clears the ticked list, and never the open tabs', async () => {
    store['vex.clearOnExit'] = true;
    await VexClear.setChosen('tabs', true);
    const done = await VexClear.onLeaving();
    expect(done).toContain('cookies');
    expect(done).not.toContain('tabs');
    expect(window.VexTabStore.closeAll).not.toHaveBeenCalled();
  });

  it('does nothing when nothing is ticked, switched on or not', async () => {
    store['vex.clearOnExit'] = true;
    store['vex.clearItems'] = {};
    expect(await VexClear.onLeaving()).toEqual([]);
    expect(window.VexBridge.clearData).not.toHaveBeenCalled();
  });
});

describe('what there is to clear', () => {
  it('counts each kind, for putting beside the labels', async () => {
    store['vex.closedTabs'] = [{ url: 'a' }, { url: 'b' }];
    const counts = await VexClear.counts();
    expect(counts).toEqual({ visits: 1200, pages: 300, saved: 7, downloads: 4, closed: 2, tabs: 2 });
  });
});
