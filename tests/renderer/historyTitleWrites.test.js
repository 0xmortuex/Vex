// @vitest-environment jsdom
//
// Spotify, Discord and Gmail change their page titles all the time. Each
// change re-read, re-sorted and re-saved the whole history (about 16 ms at
// 5,000 entries), and each loading event saved the tab list again though
// nothing in it had changed (found 2026-10-09). Titles are now changed in
// memory and saved at most every 30 seconds, the list is read again only
// when something else replaced it, and the tab list is saved only when what
// is saved of it changed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const KEY = 'vex.history';
const MODULE = '../../src/renderer/js/history-panel.js';
const load = () => {
  vi.resetModules();
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE).HistoryPanel;
};
const stored = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const fullHistory = () => Array.from({ length: 5000 }, (_, i) => ({
  id: 'h' + i, url: 'https://site' + i + '.example/page', title: 'Page ' + i, favicon: '',
  visitedAt: new Date(Date.UTC(2026, 9, 9) - i * 60000).toISOString(),
}));

describe('history titles', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    document.body.innerHTML = '';
    window.escapeHtml = (s) => String(s == null ? '' : s);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('twenty title changes at the 5,000-entry cap save the list once, and never re-read it', () => {
    localStorage.setItem(KEY, JSON.stringify(fullHistory()));
    const H = load();
    const url = H.list()[0].url;
    const sets = vi.spyOn(Storage.prototype, 'setItem');
    const parse = vi.spyOn(JSON, 'parse');
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) H.updateTitle(url, (i % 2 ? '(1) ' : '') + 'Chat ' + i);
    const ms = performance.now() - t0;
    expect(sets.mock.calls.filter(c => c[0] === KEY)).toHaveLength(0);
    expect(parse).not.toHaveBeenCalled();
    vi.advanceTimersByTime(H.TITLE_SAVE_MS);
    console.log('[history] 20 title changes at 5,000 entries: ' + ms.toFixed(1) + ' ms in all, ' + sets.mock.calls.filter(c => c[0] === KEY).length + ' save(s)');
    expect(sets.mock.calls.filter(c => c[0] === KEY)).toHaveLength(1);
    expect(stored()[0].title).toBe('(1) Chat 19');
  });

  it('a list replaced meanwhile (a sync pull) is not written over by a waiting title', () => {
    const H = load();
    H.addEntry('https://a.example/', 'A');
    H.updateTitle('https://a.example/', 'A, renamed');
    // Sync brings a visit from another device.
    localStorage.setItem(KEY, JSON.stringify([...stored(), { id: 'remote', url: 'https://b.example/', title: 'From the phone', visitedAt: new Date(0).toISOString() }]));
    vi.advanceTimersByTime(H.TITLE_SAVE_MS);
    expect(stored().map(e => e.id)).toContain('remote');
    expect(H.list().map(e => e.url)).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('a waiting title is saved when the window closes', () => {
    const H = load();
    H.addEntry('https://a.example/', 'A');
    H.updateTitle('https://a.example/', 'A, renamed');
    H.flush();
    expect(stored()[0].title).toBe('A, renamed');
  });

  it('a title past 4,096 characters is cut, as a visit\'s is', () => {
    const H = load();
    H.addEntry('https://a.example/', 'A');
    H.updateTitle('https://a.example/', 'x'.repeat(5000));
    H.flush();
    expect(stored()[0].title).toBe('x'.repeat(4096));
  });

  it('a visit saves a waiting title with it', () => {
    const H = load();
    H.addEntry('https://a.example/', 'A');
    H.updateTitle('https://a.example/', 'A, renamed');
    H.addEntry('https://b.example/', 'B');
    expect(stored().map(e => e.title)).toEqual(['B', 'A, renamed']);
  });
});

describe('the tab list', () => {
  let TM, saveTabs;
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="tabs-list"></div><input id="url-input">';
    saveTabs = vi.fn(async () => true);
    globalThis.VexStorage = { saveTabs, saveGroups: vi.fn(async () => true), saveStacks: vi.fn(async () => true), load: vi.fn(async () => null), save: vi.fn(async () => true) };
    await import('../../src/renderer/js/vex-utils.js');
    await import('../../src/renderer/js/data-contracts.js');
    await import('../../src/renderer/js/tab-policy.js');
    TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
    TM.tabs = [{ id: 't1', url: 'https://open.spotify.com/', title: 'Spotify', partition: 'persist:main' }];
    TM.renderTabUpdate = vi.fn(); TM.updateUrlBar = vi.fn();
  });

  it('is saved when what is saved of it changes, not on every loading event; titles wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const settle = async () => { await TM._pendingPersist; await Promise.resolve(); };
    await TM.persistTabs();
    expect(saveTabs).toHaveBeenCalledTimes(1);
    // Loading starts and stops, twice: nothing saved changes.
    for (const loading of [true, false, true, false]) { TM.updateTab('t1', { loading }); await settle(); }
    expect(saveTabs).toHaveBeenCalledTimes(1);
    // The title changes every second: saved once, TITLES_SAVE_MS later.
    for (let i = 0; i < 20; i++) { TM.updateTab('t1', { title: 'Song ' + i + ' - Artist' }); await settle(); }
    expect(saveTabs).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TM.TITLES_SAVE_MS);
    await settle();
    expect(saveTabs).toHaveBeenCalledTimes(2);
    // Anything else (another address) is saved at once.
    TM.updateTab('t1', { title: 'Waiting title' }); await settle();
    TM.updateTab('t1', { url: 'https://open.spotify.com/album/1' }); await settle();
    expect(saveTabs).toHaveBeenCalledTimes(3);
    // So is a waiting title when the window closes.
    TM.updateTab('t1', { title: 'Last title' }); await settle();
    expect(saveTabs).toHaveBeenCalledTimes(3);
    await TM.persistTabs({ now: true });
    expect(saveTabs).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('is saved again after sync replaced it, even with the same tabs', async () => {
    await TM.persistTabs();
    TM._savedTabs = TM._savedShape = null;   // what applySyncedState does
    await TM.persistTabs();
    expect(saveTabs).toHaveBeenCalledTimes(2);
  });
});
