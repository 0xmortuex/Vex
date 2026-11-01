// @vitest-environment node
//
// chrome.history, chrome.bookmarks and chrome.topSites: Electron has none, and Vex keeps both lists in its own saved settings. They are
// answered read-only, for an extension that names the permission, never from a container/Tor/proxy-route session.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const B = req('../../src/main/extension-browsing.js');
const SW_SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-extension-sw.js'), 'utf8');
const PAGE_SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');

const NOW = Date.parse('2026-11-01T12:00:00Z');
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();
const HISTORY = JSON.stringify([
  { id: 'h1', url: 'https://a.example/one', title: 'Alpha one', visitedAt: iso(1) },
  { id: 'h2', url: 'https://a.example/one', title: 'Alpha one', visitedAt: iso(30) },
  { id: 'h3', url: 'https://b.example/', title: 'Beta', visitedAt: iso(2) },
  { id: 'h4', url: 'https://secret.example/', title: 'Tor page', visitedAt: iso(1), ownSession: true },
  { id: 'h5', url: 'vex://settings', title: 'Settings', visitedAt: iso(1) },
  { id: 'h6', url: 'https://a.example/two', title: 'Alpha two', visitedAt: iso(3) },
  { id: 'h7', url: 'https://old.example/', title: 'Old', visitedAt: iso(500) },
]);
const BOOKMARKS = JSON.stringify([
  { id: 'bm1', url: 'https://a.example/', title: 'A', folder: '', at: 300 },
  { id: 'bm2', url: 'https://b.example/', title: 'B site', folder: 'Work', at: 200 },
  { id: 'bm3', url: 'https://c.example/', title: 'C', folder: 'Work', at: 100 },
  { id: 'bm4', url: 'https://tor.example/', title: 'Tor', folder: '', at: 400, ownSession: true },
]);

describe('history', () => {
  const entries = B.historyEntries(HISTORY);
  it('leaves out private-session visits and non-web pages', () => {
    expect(entries.map(e => e.id)).toEqual(['h1', 'h3', 'h6', 'h2', 'h7']);
  });
  it('searches the last 24 hours by default, one row per address, newest first', () => {
    const rows = B.historySearch(entries, {}, NOW);
    expect(rows.map(r => r.url)).toEqual(['https://a.example/one', 'https://b.example/', 'https://a.example/two']);
    expect(rows[0]).toMatchObject({ visitCount: 1, lastVisitTime: NOW - 3600000, typedCount: 0 });
  });
  it('counts all visits when the window is wider, matches every word and honours maxResults', () => {
    const wide = B.historySearch(entries, { text: '', startTime: 0 }, NOW);
    expect(wide.find(r => r.url === 'https://a.example/one').visitCount).toBe(2);
    expect(B.historySearch(entries, { text: 'alpha two', startTime: 0 }, NOW).map(r => r.url)).toEqual(['https://a.example/two']);
    expect(B.historySearch(entries, { text: 'EXAMPLE', startTime: 0, maxResults: 2 }, NOW)).toHaveLength(2);
    expect(B.historySearch(entries, { startTime: NOW - 4 * 3600000, endTime: NOW - 2.5 * 3600000 }, NOW).map(r => r.url)).toEqual(['https://a.example/two']);
  });
  it('getVisits lists each visit, and refuses a non-web address', () => {
    const v = B.historyVisits(entries, 'https://a.example/one');
    expect(v.map(x => x.visitTime)).toEqual([NOW - 3600000, NOW - 30 * 3600000]);
    expect(v[0]).toMatchObject({ referringVisitId: '0', transition: 'link' });
    expect(() => B.historyVisits(entries, 'vex://settings')).toThrow(/web address/);
  });
  it('an unreadable saved list is an error, not an empty history', () => {
    expect(() => B.historyEntries('{nope')).toThrow(/could not read your history/);
    expect(() => B.historyEntries('{"a":1}')).toThrow(/not a list/);
    expect(B.historyEntries(undefined)).toEqual([]);
  });
});

describe('topSites', () => {
  it('one address per site, most visited first', () => {
    const entries = B.historyEntries(HISTORY);
    expect(B.topSites(entries)).toEqual([
      { url: 'https://a.example/one', title: 'Alpha one' },
      { url: 'https://b.example/', title: 'Beta' },
      { url: 'https://old.example/', title: 'Old' },
    ]);
  });
});

describe('bookmarks', () => {
  const nodes = B.bookmarkNodes(BOOKMARKS);
  it('is a tree: Other bookmarks holds the folders and the unsorted bookmarks; a private-session bookmark is never in it', () => {
    const [root] = B.bookmarksSubTree(nodes, '0');
    expect(root.children.map(c => c.title)).toEqual(['Bookmarks bar', 'Other bookmarks']);
    const other = root.children[1];
    expect(other.children.map(c => c.title)).toEqual(['Work', 'A']);
    expect(other.children[0].children.map(c => c.id)).toEqual(['bm2', 'bm3']);
    expect(JSON.stringify(root)).not.toContain('tor.example');
  });
  it('get, getChildren, getRecent and search answer as Chrome does', () => {
    expect(B.bookmarksGet(nodes, 'bm2')[0]).toMatchObject({ id: 'bm2', parentId: 'f:Work', url: 'https://b.example/', title: 'B site' });
    expect(B.bookmarksGet(nodes, ['bm1', 'bm3']).map(n => n.id)).toEqual(['bm1', 'bm3']);
    expect(() => B.bookmarksGet(nodes, 'nope')).toThrow(/Can't find bookmark/);
    expect(B.bookmarksChildren(nodes, 'f:Work').map(n => n.id)).toEqual(['bm2', 'bm3']);
    expect(B.bookmarksChildren(nodes, 'bm1')).toEqual([]);
    expect(B.bookmarksRecent(nodes, 2).map(n => n.id)).toEqual(['bm1', 'bm2']);
    expect(() => B.bookmarksRecent(nodes, 0)).toThrow(/count/);
    expect(B.bookmarksSearch(nodes, 'site b').map(n => n.id)).toEqual(['bm2']);
    expect(B.bookmarksSearch(nodes, { url: 'https://c.example/' }).map(n => n.id)).toEqual(['bm3']);
    expect(() => B.bookmarksSearch(nodes, null)).toThrow(/needs a query/);
  });
});

function worker(manifest, src = SW_SRC) {
  const asked = [];
  const ipcRenderer = { invoke: (ch, r) => { asked.push(r); return Promise.resolve(r && r.op === 'history.search' ? [{ url: 'https://a.example/' }] : null); }, on: () => {} };
  const chrome = {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', getManifest: () => manifest, getURL: (p) => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/' + p },
    tabs: { query: async () => [], get: async () => null },
  };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL, console,
    require: () => ({ ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } }) });
  vm.runInContext(src, ctx);
  return { c: chrome, asked };
}

describe('the stand-ins', () => {
  it('exist only for the permission the manifest names', () => {
    const none = worker({ permissions: ['storage'] }).c;
    expect(none.history).toBeUndefined();
    expect(none.bookmarks).toBeUndefined();
    expect(none.topSites).toBeUndefined();
    const some = worker({ permissions: ['bookmarks'] }).c;
    expect(typeof some.bookmarks.getTree).toBe('function');
    expect(some.history).toBeUndefined();
  });
  it('ask main for the reading calls, and refuse every writing call in words', async () => {
    const w = worker({ permissions: ['history', 'bookmarks', 'topSites'] });
    expect(await w.c.history.search({ text: 'a' })).toEqual([{ url: 'https://a.example/' }]);
    await w.c.bookmarks.getRecent(5);
    await w.c.topSites.get();
    expect(w.asked.map(r => r.op)).toEqual(['history.search', 'bookmarks.getRecent', 'topSites.get']);
    expect(w.asked[0].args).toEqual({ query: { text: 'a' } });
    await expect(w.c.history.deleteAll()).rejects.toThrow(/does not let an extension delete your history/);
    await expect(w.c.history.addUrl({ url: 'https://a.example/' })).rejects.toThrow(/add to your history/);
    await expect(w.c.bookmarks.create({ title: 'x' })).rejects.toThrow(/add a bookmark/);
    await expect(w.c.bookmarks.remove('1')).rejects.toThrow(/remove a bookmark/);
    expect(w.asked).toHaveLength(3);
  });
  it('the extension page carries the same block', () => {
    const block = (s) => s.slice(s.indexOf('// chrome.history, chrome.bookmarks and chrome.topSites: the reading half'), s.indexOf("if (!c.offscreen && hasPerm('offscreen'))")).replace(/\r\n/g, '\n');
    expect(block(PAGE_SRC).length).toBeGreaterThan(500);
    expect(block(PAGE_SRC)).toBe(block(SW_SRC));
  });
});

describe('main.js', () => {
  it('checks the permission first, reads only the saved lists, and not while locked', () => {
    expect(MAIN).toMatch(/needPerm\(r\.op\.split\('\.'\)\[0\]\);\n\s+return _extBrowsingApi\(r\.op, args\);/);
    const fn = MAIN.slice(MAIN.indexOf('function _extBrowsingApi'), MAIN.indexOf('function _extBrowsingApi') + 1100);
    expect(fn).toMatch(/if \(_vexLocked\) throw/);
    expect(fn).toMatch(/saved\['vex\.history'\]/);
    expect(fn).toMatch(/saved\['vex\.bookmarks'\]/);
    expect(fn).not.toMatch(/writeFile|setItem|save\(/);
  });
});
