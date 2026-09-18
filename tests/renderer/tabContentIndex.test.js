// @vitest-environment jsdom
//
// Ctrl+K found a tab by its title, which is fine until you have thirty and the
// one you want is called "Order confirmation" while what you remember is the
// word "refund". The words were right there on the page and nothing looked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const { TabContentIndex } = require('../../src/renderer/js/tab-content-index.js');

const guest = (text) => ({ getURL: () => 'https://shop.example/order/1', isLoading: () => false });

beforeEach(() => {
  TabContentIndex.clear();
  delete TabContentIndex._watching;
  delete window.VexTabPolicy;
  window.vexGuestEval = vi.fn(async () => 'Your refund has been approved and will reach your account in five days. Order 8891.');
});

describe('what is remembered from a page', () => {
  it('keeps the words that describe it and drops the furniture', () => {
    const words = TabContentIndex.keywords('The cookies policy — accept our privacy terms. Refund approved for your order.');
    expect([...words]).toContain('refund');
    expect([...words]).toContain('approved');
    for (const noise of ['the', 'our', 'your', 'accept', 'privacy', 'terms', 'cookies']) {
      expect([...words], noise).not.toContain(noise);
    }
  });

  it('keeps prices and short numbers, drops long identifiers', () => {
    const words = TabContentIndex.keywords('Total £299 order 1234567890123 ref abc');
    expect([...words]).toContain('£299');
    expect([...words]).toContain('abc');
    expect([...words]).not.toContain('1234567890123');
  });

  it('never grows without bound', () => {
    const many = Array.from({ length: 5000 }, (_, i) => 'word' + i).join(' ');
    expect(TabContentIndex.keywords(many).size).toBeLessThanOrEqual(TabContentIndex.MAX_WORDS);
  });
});

describe('finding a tab by its words', () => {
  const index = async () => {
    await TabContentIndex.index('t1', guest(), { id: 't1', url: 'https://shop.example/order/1', title: 'Order confirmation' });
  };

  it('finds the tab whose page says it, not its title', async () => {
    await index();
    expect(TabContentIndex.search('refund').map(h => h.tabId)).toEqual(['t1']);
    expect(TabContentIndex.search('refund approved').map(h => h.tabId)).toEqual(['t1']);
    expect(TabContentIndex.search('bicycle')).toEqual([]);
  });

  it('matches a word the user half-remembers', async () => {
    await index();
    expect(TabContentIndex.search('refun').map(h => h.tabId)).toEqual(['t1']);
  });

  it('every word must be there, not just one of them', async () => {
    await index();
    expect(TabContentIndex.search('refund bicycle')).toEqual([]);
  });

  it('a very short query is ignored rather than matching everything', async () => {
    await index();
    expect(TabContentIndex.search('a')).toEqual([]);
    expect(TabContentIndex.search('')).toEqual([]);
  });

  it('a closed tab is forgotten', async () => {
    await index();
    TabContentIndex.forget('t1');
    expect(TabContentIndex.search('refund')).toEqual([]);
    expect(TabContentIndex.size()).toBe(0);
  });
});

describe('what it refuses to read', () => {
  it('a private tab is never touched', async () => {
    window.VexTabPolicy = { canReadWebview: () => false };
    expect(await TabContentIndex.index('t1', guest(), { id: 't1', url: 'https://secret.example/', title: 'x' })).toBe(null);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });

  it('a page that is not a web page', async () => {
    expect(await TabContentIndex.index('t1', guest(), { id: 't1', url: 'vex://start', title: 'New Tab' })).toBe(null);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });

  it('a page that will not answer is simply not indexed — it is still findable by title', async () => {
    window.vexGuestEval = vi.fn(async () => { throw new Error('guest gone'); });
    expect(await TabContentIndex.index('t1', guest(), { id: 't1', url: 'https://a.example/', title: 'A' })).toBe(null);
    expect(TabContentIndex.size()).toBe(0);
  });

  it('nothing is written to disk', async () => {
    localStorage.clear();
    await TabContentIndex.index('t1', guest(), { id: 't1', url: 'https://a.example/', title: 'A' });
    expect(localStorage.length).toBe(0);
  });
});
