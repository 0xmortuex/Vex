// One refused entry fails the whole preferences save, so the error has to say which list and which entry.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const contracts = require('../../src/renderer/js/data-contracts.js');

describe('a refused saved list names the list and the entry', () => {
  it('says which bookmark is not a web address', () => {
    expect(() => contracts.storage('bookmarks', [{ id: 'a', url: 'https://ok.test' }, { id: 'b', url: 'vex://start' }]))
      .toThrow('Invalid saved URL (bookmarks, entry 2)');
  });
  it('says which shortcut has an address that cannot be saved', () => {
    expect(() => contracts.storage('shortcuts', [{ id: 'a', url: 'https://my site' }])).toThrow('Invalid saved URL (shortcuts, entry 1)');
  });
  it('says which history entry has text that is too long', () => {
    expect(() => contracts.storage('history', [{ id: 'a', url: 'https://x.test', title: 't'.repeat(5000) }])).toThrow('Invalid record text (history, entry 1)');
  });
  it('still accepts a good list', () => {
    expect(() => contracts.storage('bookmarks', [{ id: 'a', url: 'https://ok.test', title: 'Fine' }])).not.toThrow();
  });
});
