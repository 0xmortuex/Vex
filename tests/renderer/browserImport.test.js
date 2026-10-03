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

const firefox = () => ({
  browser: 'firefox', browserName: 'Firefox', profile: { id: 'Profiles/x', name: 'default-release' },
  bookmarks: [{ url: 'https://fox.example/', title: 'Fox', path: ['Bookmarks toolbar'] }],
  history: { total: 1, items: [{ url: 'https://fox-visit.example/', title: 'FV', visitedAt: '2026-09-01T00:00:00.000Z' }] },
});

describe('undo', () => {
  it('removes exactly what the import added, keeping the person\'s own and what came since', () => {
    BrowserImport.apply(data());
    Bookmarks.items.push({ id: 'bm_later', url: 'https://later.example/' });
    HistoryPanel.entries.unshift({ id: 'h_later', url: 'https://later.example/', visitedAt: '2026-09-05T00:00:00.000Z' });
    const [only] = BrowserImport.imports();
    const done = BrowserImport.undo(only.id);
    expect(done).toEqual({ bookmarks: 2, history: 2, kept: 0 });
    expect(Bookmarks.items.map(b => b.id)).toEqual(['bm_own', 'bm_later']);
    expect(HistoryPanel.entries.map(h => h.id)).toEqual(['h_later', 'h_own']);
    expect(BrowserImport.imports()).toEqual([]);
  });

  // The bug: importing Chrome and then Firefox left the Chrome import
  // impossible to undo.
  it('keeps an undo for every import, and undoes an older one on its own', () => {
    const chrome = BrowserImport.apply(data());
    const fox = BrowserImport.apply(firefox());
    const list = BrowserImport.imports();
    expect(list.map(r => r.browserName)).toEqual(['Firefox', 'Chrome']);
    expect(list.map(r => r.id)).toEqual([fox.id, chrome.id]);
    expect(BrowserImport.undo(chrome.id)).toEqual({ bookmarks: 2, history: 2, kept: 0 });
    expect(Bookmarks.items.map(b => b.url)).toEqual(['https://mine.example/', 'https://fox.example/']);
    expect(HistoryPanel.entries.map(h => h.url)).toEqual(['https://seen.example/', 'https://fox-visit.example/']);
    expect(BrowserImport.imports().map(r => r.browserName)).toEqual(['Firefox']);
  });

  it('describes each import by browser, kind, date and counts', () => {
    const r = BrowserImport.apply(data());
    const [entry] = BrowserImport.imports();
    const text = BrowserImport.describeImport(entry);
    expect(text).toMatch(/^Bookmarks and history from Chrome \(Person 1\) · /);
    expect(text).toContain(new Date(r.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    expect(text).toMatch(/· 2 bookmarks, 2 visits$/);
    BrowserImport.apply(firefox(), { bookmarks: false });
    expect(BrowserImport.describeImport(BrowserImport.imports()[0])).toMatch(/^History from Firefox \(default-release\) · .* · 1 visit$/);
  });

  it('leaves a bookmark changed since, and a page visited again since, where they are', () => {
    BrowserImport.apply(data());
    Bookmarks.items.find(b => b.url === 'https://news.example/').title = 'Renamed';
    HistoryPanel.entries.find(h => h.url === 'https://c.example/').visitedAt = '2026-10-01T00:00:00.000Z';
    const done = BrowserImport.undo(BrowserImport.imports()[0].id);
    expect(done).toEqual({ bookmarks: 1, history: 1, kept: 2 });
    expect(Bookmarks.items.map(b => b.title)).toEqual(['Mine', 'Renamed']);
    expect(HistoryPanel.entries.map(h => h.url)).toContain('https://c.example/');
  });

  it('remembers the last ten, newest first', () => {
    for (let i = 0; i < 12; i++) {
      BrowserImport.apply({ browserName: 'B' + i, profile: { name: 'p' }, bookmarks: [{ url: 'https://n' + i + '.example/', title: 'n', path: [] }], history: { total: 0, items: [] } });
    }
    const list = BrowserImport.imports();
    expect(list).toHaveLength(BrowserImport.KEEP);
    expect(list[0].browserName).toBe('B11');
    expect(list[9].browserName).toBe('B2');
  });

  it('forgets an import whose items have all been deleted since', () => {
    BrowserImport.apply(firefox());
    Bookmarks.items = Bookmarks.items.filter(b => b.url !== 'https://fox.example/');
    HistoryPanel.entries = HistoryPanel.entries.filter(h => h.url !== 'https://fox-visit.example/');
    BrowserImport.apply(data());
    expect(BrowserImport.imports().map(r => r.browserName)).toEqual(['Chrome']);
  });

  it('an import no longer in the list says so', () => {
    expect(() => BrowserImport.undo('imp_gone')).toThrow(/no longer in the list/);
    expect(Bookmarks.items).toHaveLength(1);
  });

  it('a corrupt saved list is an error, not an empty list', () => {
    localStorage.setItem(BrowserImport.IMPORTS_KEY, '{nope');
    expect(() => BrowserImport.imports()).toThrow(/could not be read/);
  });

  it('moves the single record an older Vex kept into the list, undone by id as before', () => {
    BrowserImport.apply(data());
    // What an older Vex saved: the latest import only, ids only.
    const ids = Bookmarks.items.slice(1).map(b => b.id);
    localStorage.removeItem(BrowserImport.IMPORTS_KEY);
    localStorage.setItem(BrowserImport.LAST_KEY, JSON.stringify({ at: 5, browserName: 'Edge', bookmarkIds: ids, historyIds: [] }));
    const [legacy] = BrowserImport.imports();
    expect(legacy.browserName).toBe('Edge');
    expect(localStorage.getItem(BrowserImport.LAST_KEY)).toBeNull();
    Bookmarks.items[1].title = 'Renamed';   // an old record cannot tell, so goes by id
    expect(BrowserImport.undo(legacy.id)).toEqual({ bookmarks: 2, history: 0, kept: 0 });
  });
});

describe('undoing a passwords import', () => {
  const T = '2026-10-03T10:00:00.000Z';
  const added = [{ host: 'a.test', username: 'me', updatedAt: T }, { host: 'b.test', username: 'you', updatedAt: T }];

  it('deletes just the logins it added, and remembers no password', async () => {
    window.vex = {
      browserImportPasswordsCsv: vi.fn(async () => ({ file: 'pw.csv', rows: 3, added, duplicates: 1, noUsername: 0, notWeb: 0 })),
      vaultList: vi.fn(async () => [...added, { host: 'own.test', username: 'me', updatedAt: T }]),
      vaultDelete: vi.fn(async () => ({ ok: true })),
    };
    const r = await BrowserImport.importPasswords({ browserName: 'Chrome' });
    expect(r.added).toHaveLength(2);
    expect(localStorage.getItem(BrowserImport.LOGIN_IMPORTS_KEY)).not.toMatch(/password/i);
    const [entry] = BrowserImport.loginImports();
    expect(BrowserImport.describeLoginImport(entry)).toMatch(/^Passwords from Chrome \(pw\.csv\) · .* · 2 logins$/);
    const done = await BrowserImport.undoPasswords(entry.id);
    expect(done).toEqual({ removed: 2, failed: 0, kept: 0 });
    expect(window.vex.vaultDelete.mock.calls.map(c => c[0])).toEqual([{ host: 'a.test', username: 'me' }, { host: 'b.test', username: 'you' }]);
    expect(BrowserImport.loginImports()).toEqual([]);
  });

  it('keeps a login changed since, skips one deleted since, and each import has its own undo', async () => {
    let n = 0;
    window.vex = {
      browserImportPasswordsCsv: vi.fn(async () => (n++ === 0
        ? { file: 'chrome.csv', added: [added[0]] }
        : { file: 'firefox.csv', added: [added[1], { host: 'c.test', username: 'x', updatedAt: T }] })),
      vaultList: vi.fn(async () => [{ host: 'a.test', username: 'me', updatedAt: T }, { host: 'b.test', username: 'you', updatedAt: '2026-10-04T00:00:00.000Z' }]),
      vaultDelete: vi.fn(async () => ({ ok: true })),
    };
    await BrowserImport.importPasswords({ browserName: 'Chrome' });
    await BrowserImport.importPasswords({ browserName: 'Firefox' });
    const [fox, chrome] = BrowserImport.loginImports();
    expect([fox.file, chrome.file]).toEqual(['firefox.csv', 'chrome.csv']);
    expect(await BrowserImport.undoPasswords(fox.id)).toEqual({ removed: 0, failed: 0, kept: 1 });
    expect(await BrowserImport.undoPasswords(chrome.id)).toEqual({ removed: 1, failed: 0, kept: 0 });
    expect(window.vex.vaultDelete.mock.calls.map(c => c[0])).toEqual([{ host: 'a.test', username: 'me' }]);
  });

  it('a login that could not be deleted stays for another try', async () => {
    window.vex = {
      browserImportPasswordsCsv: vi.fn(async () => ({ file: 'pw.csv', added })),
      vaultList: vi.fn(async () => added),
      vaultDelete: vi.fn(async (q) => ({ ok: q.host === 'a.test' })),
    };
    await BrowserImport.importPasswords();
    const [entry] = BrowserImport.loginImports();
    expect(await BrowserImport.undoPasswords(entry.id)).toEqual({ removed: 1, failed: 1, kept: 0 });
    expect(BrowserImport.loginImports()[0].logins.map(l => l.host)).toEqual(['b.test']);
  });

  it('a cancelled file picker remembers nothing', async () => {
    window.vex = { browserImportPasswordsCsv: vi.fn(async () => ({ canceled: true })) };
    expect(await BrowserImport.importPasswords()).toBeNull();
    expect(BrowserImport.loginImports()).toEqual([]);
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
    expect(m.querySelector('#bi-imports').hidden).toBe(false);
    expect(m.querySelectorAll('#bi-imports-rows .bi-import')).toHaveLength(1);
  });

  it('lists every import with its own Undo, which asks first and takes back only that one', async () => {
    BrowserImport.apply(data());
    BrowserImport.apply(firefox());
    globalThis.vexConfirm = vi.fn(async () => true);
    window.vex = { browserImportSources: vi.fn(async () => []) };
    await BrowserImport.open();
    const m = document.getElementById('vex-browser-import');
    const rows = [...m.querySelectorAll('#bi-imports-rows .bi-import')];
    expect(rows.map(r => r.querySelector('span').textContent.split(' · ')[0])).toEqual(['Bookmarks and history from Firefox (default-release)', 'Bookmarks and history from Chrome (Person 1)']);
    expect(rows[1].querySelector('button svg')).not.toBeNull();   // a VexIcons glyph, not an emoji
    rows[1].querySelector('button').click();
    await new Promise(r => setTimeout(r, 0));
    expect(globalThis.vexConfirm).toHaveBeenCalledTimes(1);
    expect(globalThis.vexConfirm.mock.calls[0][0].message).toMatch(/Chrome/);
    expect(m.querySelector('#bi-msg').textContent).toBe('Removed 2 bookmarks and 2 visits.');
    expect([...m.querySelectorAll('#bi-imports-rows .bi-import span')].map(s => s.textContent)).toEqual([expect.stringMatching(/from Firefox/)]);
    expect(Bookmarks.items.map(b => b.url)).toEqual(['https://mine.example/', 'https://fox.example/']);
    delete globalThis.vexConfirm;
  });

  it('says so when no other browser is on the PC', async () => {
    window.vex = { browserImportSources: vi.fn(async () => []) };
    await BrowserImport.open();
    expect(document.querySelector('#bi-msg').textContent).toMatch(/No Chrome, Edge, Brave or Firefox profile/);
    expect(document.querySelector('#bi-look').disabled).toBe(true);
  });
});
