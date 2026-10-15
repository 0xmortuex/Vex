// @vitest-environment jsdom
//
// js/web-taming.js: the decisions that must not be wrong — which tabs count as
// the same page, which one stays, what is an article address, that the price
// chart is drawn from history, that highlights land in one "Highlights" note,
// and that no AI feature quietly falls back to a cloud model.
import { describe, it, expect, beforeEach } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let M;
beforeEach(() => {
  localStorage.clear();
  globalThis.DuplicateTabs = fresh('../../src/renderer/js/duplicate-tabs.js').DuplicateTabs;
  M = fresh('../../src/renderer/js/web-taming.js');
});

describe('TabDedupe', () => {
  const tab = (id, url, partition, pinned) => ({ id, url, partition, pinned });
  it('groups the same page in the same container only', () => {
    const g = M.TabDedupe.groups([
      tab(1, 'https://a.com/x#top'), tab(2, 'https://a.com/x/'.replace(/\/$/, '')),
      tab(3, 'https://a.com/x', 'persist:work'), tab(4, 'https://b.com/'),
    ]);
    expect(g.length).toBe(1);
    expect(g[0].map(t => t.id)).toEqual([1, 2]);
  });
  it('never merges pinned tabs', () => {
    expect(M.TabDedupe.groups([tab(1, 'https://a.com/x'), tab(2, 'https://a.com/x', null, true)])).toEqual([]);
  });
  it('keeps the tab in front, else the one scrolled furthest', () => {
    const g = [tab(1, 'u'), tab(2, 'u'), tab(3, 'u')];
    expect(M.TabDedupe.keeper(g, 2, new Map()).id).toBe(2);
    expect(M.TabDedupe.keeper(g, 99, new Map([[1, 10], [3, 900]])).id).toBe(3);
  });
});

describe('ReaderFirst', () => {
  it('opens articles, not front pages or sections', () => {
    const r = M.ReaderFirst;
    expect(r.looksLikeArticle('https://news.example/')).toBe(false);
    expect(r.looksLikeArticle('https://news.example/world')).toBe(false);
    expect(r.looksLikeArticle('https://news.example/world/2026/oct/16/something')).toBe(true);
    expect(r.looksLikeArticle('https://news.example/a-long-headline-slug')).toBe(true);
    expect(r.looksLikeArticle('ftp://news.example/a/b')).toBe(false);
  });
  it('is opt-in and matches subdomains', () => {
    const l = M.ReaderFirst.list;
    expect(l.matches('https://www.bbc.com/news/x-y')).toBe(false);
    l.add('bbc.com');
    expect(l.matches('https://www.bbc.com/news/x-y')).toBe(true);
    expect(l.matches('https://notbbc.com/news/x-y')).toBe(false);
    l.setOn(false);
    expect(l.matches('https://www.bbc.com/news/x-y')).toBe(false);
  });
  it('refuses something that is not a site', () => {
    expect(() => M.ReaderFirst.list.add('not a site')).toThrow();
  });
});

describe('PriceStock chart', () => {
  it('draws a step line through the recorded prices', () => {
    const svg = M.PriceStock.chartSvg([{ at: 1000, v: 20 }, { at: 2000, v: 15 }, { at: 3000, v: 18 }]);
    expect(svg).toContain('<svg');
    expect((svg.match(/<circle/g) || []).length).toBe(3);
    expect(svg).toContain('aria-label="Price history, from 20 to 18"');
  });
});

describe('HighlightNotes', () => {
  it('puts every highlight in one note with its address', () => {
    expect(M.HighlightNotes.add({ text: 'first', url: 'https://a.com/p', title: 'A' })).toBe(true);
    expect(M.HighlightNotes.add({ text: 'second', url: 'https://b.com/q', title: 'B' })).toBe(true);
    const notes = JSON.parse(localStorage.getItem('vex.notes'));
    expect(notes.length).toBe(1);
    expect(notes[0].title).toBe('Highlights');
    expect(notes[0].content).toContain('(https://b.com/q)');
    expect(notes[0].content.indexOf('second')).toBeLessThan(notes[0].content.indexOf('first'));
  });
  it('writes nothing when switched off', () => {
    localStorage.setItem('vex.highlightsToNotes', 'off');
    expect(M.HighlightNotes.add({ text: 'x', url: 'https://a.com' })).toBe(false);
    expect(localStorage.getItem('vex.notes')).toBe(null);
  });
});

describe('local AI only', () => {
  it('says there is no local model instead of sending the page anywhere', async () => {
    await expect(M.WebTaming.askLocal('hi')).rejects.toThrow(/local model/);
  });
});
