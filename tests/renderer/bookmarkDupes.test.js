// @vitest-environment jsdom
// Duplicate bookmarks (js/bookmark-dupes.js): same page after ignoring a fragment, a trailing slash and utm_ tags.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');
const { VexBookmarkDupes: D } = require('../../src/renderer/js/bookmark-dupes.js');

const bm = (id, url, extra = {}) => ({ id, url, title: id, folder: '', at: 1000, ...extra });

describe('normalize', () => {
  it('ignores a fragment, a trailing slash and utm_ parameters, and nothing else', () => {
    const a = D.normalize('https://Example.com/post/?utm_source=x&id=7#top');
    expect(a).toBe('https://example.com/post?id=7');
    expect(D.normalize('https://example.com/post?id=7')).toBe(a);
    expect(D.normalize('https://example.com')).toBe('https://example.com/');
    expect(D.normalize('https://example.com/')).toBe('https://example.com/');
    expect(D.normalize('https://example.com/post?id=8')).not.toBe(a);
    expect(D.normalize('http://example.com/post?id=7')).not.toBe(a);
    expect(D.normalize('https://example.com/post/other?id=7')).not.toBe(a);
    expect(D.normalize('https://example.com/p?UTM_Medium=a&fbclid=1')).toBe('https://example.com/p?fbclid=1');
  });
  it('is empty for anything that is not a web address', () => {
    expect(D.normalize('javascript:alert(1)')).toBe('');
    expect(D.normalize('not a url')).toBe('');
    expect(D.normalize(null)).toBe('');
  });
});

describe('groups', () => {
  const items = [
    bm('a', 'https://example.com/post/', { at: 3000 }),
    bm('b', 'https://example.com/post#intro', { at: 1000 }),
    bm('c', 'https://example.com/post?utm_campaign=z', { at: 2000, folder: 'Read' }),
    bm('d', 'https://example.com/other'),
    bm('e', 'https://other.example/', { at: 500 }),
    bm('f', 'https://other.example', { at: 500, folder: 'Docs' }),
    { url: 'https://example.com/post' },                       // no id: left alone
  ];
  it('lists only pages saved more than once, the earliest saved as the one to keep', () => {
    const g = D.groups(items);
    expect(g.map(x => x.key)).toEqual(['https://example.com/post', 'https://other.example/']);
    expect(g[0].keep.id).toBe('b');
    expect(g[0].items.map(x => x.id).sort()).toEqual(['a', 'b', 'c']);
  });
  it('a bookmark in a folder wins a tie on the date', () => {
    expect(D.groups(items)[1].keep.id).toBe('f');
  });
  it('Merge removes every copy except the one kept', () => {
    expect(D.mergeIds(D.groups(items)).sort()).toEqual(['a', 'c', 'e']);
  });
  it('nothing to list when there are no duplicates', () => {
    expect(D.groups([bm('x', 'https://a.example/'), bm('y', 'https://b.example/')])).toEqual([]);
    expect(D.groups(null)).toEqual([]);
  });
});

describe('removing', () => {
  beforeEach(() => { delete globalThis.Bookmarks; });
  it('goes through the bookmark list removal, by id, so Undo comes with it', () => {
    globalThis.Bookmarks = { remove: vi.fn((match) => [bm('a', 'u'), bm('b', 'v'), bm('c', 'w')].filter(match).length) };
    expect(D.removeIds(['a', 'c'])).toBe(2);
    expect(D.removeIds([])).toBe(0);
    expect(globalThis.Bookmarks.remove).toHaveBeenCalledTimes(1);
  });
  it('says so when bookmarks are not there', () => {
    expect(() => D.removeIds(['a'])).toThrow(/not available/);
  });
});

describe('wiring', () => {
  it('is a late module with a Ctrl+K command and no start-up script tag', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toMatch(/src: 'js\/bookmark-dupes\.js'/);
    expect(read('src/renderer/js/command.js')).toMatch(/\{ id: 'bookmark-dupes', label: 'Find Duplicate Bookmarks'/);
    expect(read('src/renderer/index.html')).not.toMatch(/bookmark-dupes\.js/);
  });
});
