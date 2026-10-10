// @vitest-environment jsdom
//
// Address-bar suggestions include pages saved with Ctrl+D (vex.bookmarks).
// Only the New Tab tiles (vex.shortcuts) were read, so a real bookmark was
// never suggested (found 2026-10-10).
import { beforeEach, describe, expect, it } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { SmartSearchbar, rankSuggestions } = require('../../src/renderer/js/smart-searchbar.js');

beforeEach(() => {
  globalThis.isStartPage = () => false;
  globalThis.TabManager = { tabs: [] };
  localStorage.clear();
});

describe('address bar suggestions and bookmarks', () => {
  it('include a bookmark saved with Ctrl+D', () => {
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ id: 'b1', url: 'https://docs.example.org/guide', title: 'Example Guide', folder: '' }]));
    const hit = SmartSearchbar._gather().find(x => x.url === 'https://docs.example.org/guide');
    expect(hit).toEqual({ url: 'https://docs.example.org/guide', title: 'Example Guide', kind: 'bookmark' });
  });

  it('a bookmark that is also a New Tab tile and in history is one suggestion', () => {
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ id: 'b1', url: 'https://www.example.org/', title: 'Example' }]));
    localStorage.setItem('vex.shortcuts', JSON.stringify([{ name: 'Example', url: 'https://example.org' }]));
    localStorage.setItem('vex.history', JSON.stringify([{ url: 'http://example.org/', title: 'Example' }]));
    const ranked = rankSuggestions('exa', SmartSearchbar._gather());
    expect(ranked).toHaveLength(1);
    expect(ranked[0].kind).toBe('history');
  });
});
