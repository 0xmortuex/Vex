// Double-click a word for its meaning. It has to stay off until asked for,
// look a word up once rather than on every double-click, keep the card on
// screen, and never put the dictionary's text into the page as markup.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { Dictionary } = require('../../src/renderer/js/dictionary.js');

const store = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  Dictionary._cache.clear();
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  globalThis.window = {
    vex: { dictLookup: vi.fn(async (w) => ({ ok: true, word: w, phonetic: '', meanings: [{ part: 'noun', def: 'a thing', example: '' }] })) },
    showToast: vi.fn(),
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    innerWidth: 1400,
    innerHeight: 900,
  };
  // Enough of a document for close() to have something to look in.
  globalThis.document = { querySelector: () => null };
});

describe('switching it on', () => {
  it('is off until asked for', () => {
    expect(Dictionary.enabled()).toBe(false);
    expect(Dictionary.toggle()).toBe(true);
    expect(Dictionary.enabled()).toBe(true);
    expect(Dictionary.toggle()).toBe(false);
  });
});

describe('looking a word up', () => {
  it('asks the dictionary once per word, however often it is clicked', async () => {
    await Dictionary.lookup('ontology');
    await Dictionary.lookup('Ontology');
    await Dictionary.lookup('ontology');
    expect(window.vex.dictLookup).toHaveBeenCalledTimes(1);
  });

  it('remembers a word the dictionary does not have, so it is not asked twice', async () => {
    window.vex.dictLookup = vi.fn(async () => ({ ok: false, notFound: true, error: 'No entry' }));
    await Dictionary.lookup('blorp');
    await Dictionary.lookup('blorp');
    expect(window.vex.dictLookup).toHaveBeenCalledTimes(1);
  });

  it('does not remember more words than it said it would', async () => {
    for (let i = 0; i < Dictionary.MAX_CACHE + 10; i++) await Dictionary.lookup('word' + i);
    expect(Dictionary._cache.size).toBeLessThanOrEqual(Dictionary.MAX_CACHE);
  });
});

describe('where the card goes', () => {
  const rect = { left: 60, top: 100 };
  it('beside the word when there is room', () => {
    expect(Dictionary.place(100, 200, rect)).toEqual({ left: 172, top: 316 });
  });

  it('never off the right edge', () => {
    const at = Dictionary.place(1300, 200, rect, { w: 320, h: 200 }, { w: 1400, h: 900 });
    expect(at.left + 320).toBeLessThanOrEqual(1400);
  });

  it('above the word when there is no room below', () => {
    const at = Dictionary.place(100, 800, rect, { w: 320, h: 200 }, { w: 1400, h: 900 });
    expect(at.top).toBeLessThan(900 - 200);
    expect(at.top).toBeGreaterThanOrEqual(8);
  });
});

describe('what the card shows', () => {
  const card = () => ({ innerHTML: '' });

  it('the word, how it sounds, and what it means', () => {
    const c = card();
    Dictionary.render(c, { ok: true, word: 'ontology', phonetic: '/ɒnˈtɒlədʒi/', meanings: [{ part: 'noun', def: 'the study of being', example: 'a book on ontology' }] }, 'ontology');
    expect(c.innerHTML).toContain('ontology');
    expect(c.innerHTML).toContain('the study of being');
    expect(c.innerHTML).toContain('a book on ontology');
  });

  it('says plainly when there was no answer', () => {
    const c = card();
    Dictionary.render(c, { ok: false, error: 'No entry for "blorp"' }, 'blorp');
    expect(c.innerHTML).toContain('No entry');
  });

  it('puts the dictionary’s text in as text, escaped', () => {
    const c = card();
    Dictionary.render(c, { ok: true, word: '<img src=x onerror=alert(1)>', phonetic: '', meanings: [] }, 'x');
    expect(c.innerHTML).not.toContain('<img');
    expect(c.innerHTML).toContain('&lt;img');
  });
});
