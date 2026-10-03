// @vitest-environment jsdom
//
// The window's half of importing from another browser (js/browser-import.js):
// the counts shown first are the counts the import makes, what Vex already has
// is skipped, bookmarks land under "Imported from <Browser>" with their
// folders, and undo takes back exactly what was added and nothing else.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
const { BrowserImport } = require('../../src/renderer/js/browser-import.js');

const when = (e) => new Date(e.visitedAt || 0);
function stubs({ bookmarks = [], history = [], max = 5000 } = {}) {
  globalThis.Bookmarks = { items: bookmarks.slice(), save: vi.fn() };
  globalThis.HistoryPanel = {
    entries: history.slice(), MAX_ENTRIES: max,
    _hydrate() { return this.entries; },
    _when: when,
    save() { if (this.entries.length > this.MAX_ENTRIES) this.entries.length = this.MAX_ENTRIES; },
    _refreshIfOpen: vi.fn(),
  };
}

const data = () => ({
  browser: 'chrome', browserName: 'Chrome', profile: { id: 'Default', name: 'Person 1' },
  bookmarks: [
    { url: 'https://news.example/', title: 'News', path: ['Bookmarks bar'], addedAt: '2026-01-01T00:00:00.000Z' },
    { url: 'https://docs.example/', title: 'Docs', path: ['Bookmarks bar', 'Work'], addedAt: null },
    { url: 'https://mine.example/', title: 'Mine', path: ['Other bookmarks'] },
    { url: 'https://news.example/', title: 'News again', path: ['Other bookmarks'] },
  ],
  history: {
    total: 10,
    items: [
      { url: 'https://c.example/', title: 'C', visitedAt: '2026-09-03T00:00:00.000Z' },
      { url: 'https://seen.example/', title: 'Seen', visitedAt: '2026-09-02T00:00:00.000Z' },
      { url: 'https://a.example/', title: 'A', visitedAt: '2026-08-01T00:00:00.000Z' },
    ],
  },
});

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  stubs({
    bookmarks: [{ id: 'bm_own', url: 'https://mine.example/', title: 'Mine', folder: '', at: 1 }],
    history: [{ id: 'h_own', url: 'https://seen.example/', title: 'Seen', visitedAt: '2026-09-04T00:00:00.000Z' }],
  });
});

describe('before importing', () => {
  it('counts what is new, and what Vex already has', () => {
    const p = BrowserImport.plan(data(), { bookmarks: Bookmarks.items, history: HistoryPanel.entries });
    expect(p.bookmarks.map(b => b.url)).toEqual(['https://news.example/', 'https://docs.example/']);
    expect(p.bookmarkDupes).toBe(2);   // mine.example is in Vex; news.example twice in the source
    expect(p.history.map(h => h.url)).toEqual(['https://c.example/', 'https://a.example/']);
    expect(p.historyDupes).toBe(1);
    expect(p.historyTotal).toBe(10);
  });
});

describe('importing', () => {
  it('adds bookmarks under "Imported from Chrome" with their folders, after the person\'s own', () => {
    const r = BrowserImport.apply(data());
    expect(r.bookmarkIds).toHaveLength(2);
    expect(Bookmarks.items[0].id).toBe('bm_own');
    expect(Bookmarks.items.slice(1).map(b => [b.url, b.folder])).toEqual([
      ['https://news.example/', 'Imported from Chrome / Bookmarks bar'],
      ['https://docs.example/', 'Imported from Chrome / Bookmarks bar / Work'],
    ]);
    expect(Bookmarks.items[1].at).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(Bookmarks.save).toHaveBeenCalled();
  });

  it('adds history in date order among the visits already there', () => {
    const r = BrowserImport.apply(data());
    expect(r.historyIds).toHaveLength(2);
    expect(HistoryPanel.entries.map(h => h.url)).toEqual(['https://seen.example/', 'https://c.example/', 'https://a.example/']);
    expect(HistoryPanel.entries[0].id).toBe('h_own');
  });

  it('says how many older visits did not fit under the history cap', () => {
    stubs({ history: [{ id: 'h_own', url: 'https://seen.example/', visitedAt: '2026-09-04T00:00:00.000Z' }], max: 2 });
    const r = BrowserImport.apply(data());
    expect(r.historyIds).toHaveLength(1);
    expect(r.historyDropped).toBe(1);
    expect(HistoryPanel.entries.map(h => h.url)).toEqual(['https://seen.example/', 'https://c.example/']);
  });

  it('can take only bookmarks, or only history', () => {
    const r = BrowserImport.apply(data(), { bookmarks: false, history: true });
    expect(r.bookmarkIds).toEqual([]);
    expect(Bookmarks.items).toHaveLength(1);
    expect(r.historyIds).toHaveLength(2);
  });

  it('importing the same profile twice adds nothing the second time', () => {
    BrowserImport.apply(data());
    const again = BrowserImport.apply(data());
    expect(again.bookmarkIds).toEqual([]);
    expect(again.historyIds).toEqual([]);
  });
});

describe('undo', () => {
  it('removes exactly what the import added, keeping the person\'s own and what came since', () => {
    BrowserImport.apply(data());
    Bookmarks.items.push({ id: 'bm_later', url: 'https://later.example/' });
    HistoryPanel.entries.unshift({ id: 'h_later', url: 'https://later.example/', visitedAt: '2026-09-05T00:00:00.000Z' });
    const done = BrowserImport.undo();
    expect(done).toEqual({ bookmarks: 2, history: 2 });
    expect(Bookmarks.items.map(b => b.id)).toEqual(['bm_own', 'bm_later']);
    expect(HistoryPanel.entries.map(h => h.id)).toEqual(['h_later', 'h_own']);
    expect(localStorage.getItem(BrowserImport.LAST_KEY)).toBeNull();
  });

  it('with nothing imported, undo does nothing', () => {
    expect(BrowserImport.undo()).toEqual({ bookmarks: 0, history: 0 });
    expect(Bookmarks.items).toHaveLength(1);
  });

  it('a passwords import is undone by deleting just the logins it added', async () => {
    window.vex = {
      browserImportPasswordsCsv: vi.fn(async () => ({ file: 'pw.csv', rows: 3, added: [{ host: 'a.test', username: 'me' }, { host: 'b.test', username: 'you' }], duplicates: 1, noUsername: 0, notWeb: 0 })),
      vaultDelete: vi.fn(async () => ({ ok: true })),
    };
    const r = await BrowserImport.importPasswords();
    expect(r.added).toHaveLength(2);
    // Only hosts and usernames are remembered for undo — never a password.
    expect(localStorage.getItem(BrowserImport.LAST_LOGINS_KEY)).not.toMatch(/password/i);
    const done = await BrowserImport.undoPasswords();
    expect(done).toEqual({ removed: 2, failed: 0 });
    expect(window.vex.vaultDelete.mock.calls.map(c => c[0])).toEqual([{ host: 'a.test', username: 'me' }, { host: 'b.test', username: 'you' }]);
    expect(localStorage.getItem(BrowserImport.LAST_LOGINS_KEY)).toBeNull();
  });

  it('a cancelled file picker remembers nothing', async () => {
    window.vex = { browserImportPasswordsCsv: vi.fn(async () => ({ canceled: true })) };
    expect(await BrowserImport.importPasswords()).toBeNull();
    expect(localStorage.getItem(BrowserImport.LAST_LOGINS_KEY)).toBeNull();
  });
});

describe('the import screen', () => {
  it('lists the browsers found, checks a profile, and shows the counts before importing', async () => {
    window.vex = {
      browserImportSources: vi.fn(async () => [{ id: 'firefox', name: 'Firefox', profiles: [{ id: 'Profiles/x', name: 'default-release' }] }]),
      browserImportRead: vi.fn(async () => data()),
    };
    await BrowserImport.open();
    const m = document.getElementById('vex-browser-import');
    expect([...m.querySelectorAll('#bi-browser option')].map(o => o.textContent)).toEqual(['Firefox']);
    expect(m.querySelector('#bi-pw-browser').value).toBe('firefox');
    expect(m.querySelector('#bi-pw-steps').textContent).toMatch(/about:logins/);
    m.querySelector('#bi-look').click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vex.browserImportRead).toHaveBeenCalledWith('firefox', 'Profiles/x');
    expect(m.querySelector('#bi-bm-count').textContent).toMatch(/^2 bookmarks to add \(2 are already in Vex\)/);
    expect(m.querySelector('#bi-hist-count').textContent).toMatch(/2 pages from history to add — the latest 3 of 10 \(1 is already in Vex\)/);
    m.querySelector('#bi-go').click();
    expect(m.querySelector('#bi-msg').textContent).toMatch(/Added 2 bookmarks and 2 visits from Chrome/);
    expect(m.querySelector('#bi-undo-row').hidden).toBe(false);
  });

  it('says so when no other browser is on the PC', async () => {
    window.vex = { browserImportSources: vi.fn(async () => []) };
    await BrowserImport.open();
    expect(document.querySelector('#bi-msg').textContent).toMatch(/No Chrome, Edge, Brave or Firefox profile/);
    expect(document.querySelector('#bi-look').disabled).toBe(true);
  });
});
