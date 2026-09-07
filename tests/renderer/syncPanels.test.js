// @vitest-environment jsdom
import { expect, it } from 'vitest';
// bookmarks.js resolves window.CollectionStore, which index.html loads first.
import '../../src/renderer/js/collection-store.js';

it('updates cached bookmarks when sync replaces persistent data', async () => {
  const { Bookmarks } = await import('../../src/renderer/js/bookmarks.js');
  Bookmarks.items = [{ id: 'old', url: 'https://old.test' }];
  const received = [{ id: 'new', url: 'https://new.test', title: 'New' }];
  localStorage.setItem('vex.bookmarks', JSON.stringify(received));
  window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));
  expect(Bookmarks.items).toEqual(received);
  Bookmarks.save();
  expect(JSON.parse(localStorage.getItem('vex.bookmarks'))).toEqual(received);
});
