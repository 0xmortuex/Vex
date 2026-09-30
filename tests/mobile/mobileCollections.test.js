// @vitest-environment jsdom
//
// Bookmarks, the reading list, sessions, the start page's tiles and tab
// groups. Three of these travel to the desktop, so what is pinned down here is
// mostly shape: a session the phone saves has to be a session the PC can open,
// and a bookmark has to keep the folder-as-a-name form the desktop writes.
import { describe, it, expect, beforeEach } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexSearch = { prettyHost: url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } } };

const { VexCollections } = require('../../mobile/www/js/collections.js');
const { bookmarks, reading, sessions, quick, groups } = VexCollections;

beforeEach(() => { for (const key of Object.keys(store)) delete store[key]; });

describe('bookmarks', () => {
  it('saves the desktop’s record shape', async () => {
    const entry = await bookmarks.add({ url: 'https://example.com/', title: 'Example', folder: 'Work' });
    expect(entry).toMatchObject({ url: 'https://example.com/', title: 'Example', folder: 'Work' });
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.at).toBe('number');
    expect(bookmarks.has('https://example.com/')).toBe(true);
  });

  it('does not save the same page twice', async () => {
    await bookmarks.add({ url: 'https://example.com/', title: 'One' });
    await bookmarks.add({ url: 'https://example.com/', title: 'Two' });
    expect(bookmarks.all()).toHaveLength(1);
  });

  it('groups by folder, unsorted first', async () => {
    await bookmarks.add({ url: 'https://a.example/', title: 'A' });
    await bookmarks.add({ url: 'https://b.example/', title: 'B', folder: 'Work' });
    await bookmarks.add({ url: 'https://c.example/', title: 'C', folder: 'Admin' });
    expect(bookmarks.grouped().map(([folder]) => folder)).toEqual(['', 'Admin', 'Work']);
  });

  it('keeps the bookmarks when a folder goes', async () => {
    await bookmarks.addFolder('Work');
    await bookmarks.add({ url: 'https://b.example/', title: 'B', folder: 'Work' });
    await bookmarks.removeFolder('Work');
    expect(bookmarks.all()).toHaveLength(1);
    expect(bookmarks.all()[0].folder).toBe('');
  });

  it('exports a file every browser can import', async () => {
    await bookmarks.add({ url: 'https://example.com/', title: 'Example & co', folder: 'Work' });
    const html = bookmarks.exportHtml();
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain('<H3>Work</H3>');
    expect(html).toContain('Example &amp; co');
  });

  it('imports one back, folders and all, without duplicating', async () => {
    const html = '<DL><DT><H3>Reading</H3><DL>'
      + '<DT><A HREF="https://a.example/">A</A>'
      + '<DT><A HREF="https://b.example/">B</A></DL></DL>';
    expect(await bookmarks.importHtml(html)).toBe(2);
    expect(await bookmarks.importHtml(html)).toBe(0);
    expect(bookmarks.all().map(entry => entry.folder)).toEqual(['Reading', 'Reading']);
  });

  it('ignores javascript: bookmarklets in an imported file', async () => {
    await bookmarks.importHtml('<DT><A HREF="javascript:alert(1)">Bad</A>');
    expect(bookmarks.all()).toHaveLength(0);
  });
});

describe('the reading list', () => {
  it('tracks what is still unread', async () => {
    await reading.add({ url: 'https://a.example/', title: 'A' });
    await reading.add({ url: 'https://b.example/', title: 'B' });
    await reading.markRead('https://a.example/');
    expect(reading.unread().map(entry => entry.url)).toEqual(['https://b.example/']);
    expect(reading.all()).toHaveLength(2);
  });

  it('will not add the same page twice', async () => {
    await reading.add({ url: 'https://a.example/', title: 'A' });
    expect(await reading.add({ url: 'https://a.example/', title: 'A again' })).toBe(null);
  });
});

describe('sessions', () => {
  const tabs = [
    { url: 'https://a.example/', title: 'A', incognito: false },
    { url: 'https://secret.example/', title: 'S', incognito: true },
    { url: 'about:blank', title: '', incognito: false }
  ];

  it('saves the shape the desktop restores from', async () => {
    const session = await sessions.save('Monday', tabs);
    expect(session).toMatchObject({ name: 'Monday', groups: [], activeTabIndex: 0 });
    expect(typeof session.createdAt).toBe('string');
    expect(session.tabs).toEqual([{ url: 'https://a.example/', title: 'A', partition: 'persist:main' }]);
  });

  it('never collects a private tab, and says so when there is nothing else', async () => {
    await expect(sessions.save('Private only', [tabs[1]])).rejects.toThrow(/private tab is never collected/);
  });
});

describe('the start page’s tiles', () => {
  it('is history-driven until you pin one', async () => {
    expect(quick.pinned()).toBe(false);
    await quick.add({ url: 'https://a.example/', title: 'A' });
    expect(quick.pinned()).toBe(true);
  });

  it('reorders', async () => {
    await quick.add({ url: 'https://a.example/' });
    await quick.add({ url: 'https://b.example/' });
    await quick.move('https://b.example/', -1);
    expect(quick.all().map(entry => entry.url)).toEqual(['https://b.example/', 'https://a.example/']);
  });

  it('will not move past the ends', async () => {
    await quick.add({ url: 'https://a.example/' });
    await quick.move('https://a.example/', -1);
    expect(quick.all()).toHaveLength(1);
  });
});

describe('tab groups', () => {
  it('keeps a tab in exactly one group', async () => {
    await groups.create('Work', ['t1']);
    const play = await groups.create('Play', []);
    // Moving is one call: adding takes the tab out of wherever it was.
    await groups.addTab(play.id, 't1');
    expect(groups.of('t1').id).toBe(play.id);
    expect(groups.all().filter(group => group.tabIds.includes('t1'))).toHaveLength(1);
  });

  it('leaves an emptied group behind, so you can move a tab back into it', async () => {
    const work = await groups.create('Work', ['t1']);
    await groups.removeTab('t1');
    expect(groups.all().map(group => group.id)).toEqual([work.id]);
    await groups.addTab(work.id, 't1');
    expect(groups.of('t1').id).toBe(work.id);
  });

  it('prunes groups whose tabs are all closed', async () => {
    await groups.create('Work', ['t1', 't2']);
    await groups.create('Gone', ['t9']);
    await groups.prune(['t1', 't2']);
    expect(groups.all().map(group => group.name)).toEqual(['Work']);
  });
});
