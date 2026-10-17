// @vitest-environment jsdom
//
// T3-108: the open-tab text search names its candidates through the shared search index. It must answer
// exactly what a full scan answers, scan everything when the index cannot be trusted, and keep level
// with tabs that open, close and lose their text.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const { VexSearchIndex } = require('../../src/renderer/js/search-index.js');
const { TabContentIndex } = require('../../src/renderer/js/tab-content-index.js');

const PAGES = {
  1: 'Your refund for the bicycle has been approved. Istanbul is where the shop is.',
  2: 'Recipes: lentil soup, ISTANBUL street food, and a note on refunds policy.',
  3: 'Nothing here about money. Only gardening, tomatoes and the weather.',
  4: 'The word is STRICT here but strict only in lower case elsewhere. İstanbul with a dotted capital.',
};

function load() {
  for (const [id, text] of Object.entries(PAGES)) {
    TabContentIndex._byTab.set(Number(id), { url: 'https://p' + id + '.test/', title: 'P' + id, words: new Set(), at: Number(id), text });
    TabContentIndex._syncOne(Number(id));
  }
}
const ids = (r) => r.map(x => x.tabId).sort();

beforeEach(() => {
  globalThis.VexTr = VexTr;
  globalThis.VexSearchIndex = VexSearchIndex;
  VexSearchIndex._shared = null;
  TabContentIndex.clear();
});

describe('same answers as a full scan', () => {
  const queries = ['refund', 'Istanbul', 'istanbul', '"STRICT"', '"strict"', 'ome', 'to', 'tomatoes and', 'zzz nothing'];
  it.each(queries)('%s', (q) => {
    load();
    const withIndex = TabContentIndex.searchText(q);
    const idx = globalThis.VexSearchIndex;
    delete globalThis.VexSearchIndex;
    const scanned = TabContentIndex.searchText(q);
    globalThis.VexSearchIndex = idx;
    expect(withIndex).toEqual(scanned);
  });

  it('really narrows: a word on one page checks only that page', () => {
    load();
    const ids2 = TabContentIndex._candidateIds('tomatoes');
    expect([...ids2]).toEqual(['3']);
  });
});

describe('staying level with the tabs', () => {
  it('a closed tab leaves the index, and its words are no longer found', () => {
    load();
    expect(ids(TabContentIndex.searchText('tomatoes'))).toEqual([3]);
    TabContentIndex.forget(3);
    expect(TabContentIndex.searchText('tomatoes')).toEqual([]);
    expect(VexSearchIndex.shared().count(TabContentIndex.INDEX_SOURCE)).toBe(3);
  });

  it('a tab whose text was trimmed away drops out of the index', () => {
    load();
    TabContentIndex.MAX_TEXT_CHARS = 150;
    TabContentIndex._trimText();
    const left = TabContentIndex._textual().length;
    expect(left).toBeLessThan(4);
    expect(VexSearchIndex.shared().count(TabContentIndex.INDEX_SOURCE)).toBe(left);
    TabContentIndex.MAX_TEXT_CHARS = 6000000;
  });

  it('when the index disagrees with the tabs it is rebuilt once, never trusted blindly', () => {
    TabContentIndex._byTab.set(7, { url: 'https://x.test/', title: 'X', words: new Set(), at: 1, text: 'only the scan knows this sentence' });
    // never synced: the index is empty while a tab has text
    expect(ids(TabContentIndex.searchText('scan knows'))).toEqual([7]);
    expect(VexSearchIndex.shared().count(TabContentIndex.INDEX_SOURCE)).toBe(1);
  });

  it('with no index loaded it scans everything, as before', () => {
    load();
    delete globalThis.VexSearchIndex;
    expect(ids(TabContentIndex.searchText('refund'))).toEqual([1, 2]);
  });

  it('text past the usual 20 000 letters is still found', () => {
    const long = 'a '.repeat(15000) + 'needleword' + ' b'.repeat(100);
    TabContentIndex._byTab.set(9, { url: 'https://l.test/', title: 'L', words: new Set(), at: 1, text: long });
    TabContentIndex._syncOne(9);
    expect(ids(TabContentIndex.searchText('needleword'))).toEqual([9]);
  });
});
