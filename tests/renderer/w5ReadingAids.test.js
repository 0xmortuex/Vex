// @vitest-environment jsdom
// T3-034: learner reading aids. Lemma and gloss from local word lists, saved vocabulary (the study-entry store),
// grey-out of known words, English and Turkish, off by default, nothing sent anywhere.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let R, S;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  globalThis.VexReadingAidsData = fresh(JS + 'reading-aids-data.js').VexReadingAidsData;
  ({ VexReadingAids: R } = fresh(JS + 'reading-aids.js'));
  ({ VexStudyEntry: S } = fresh(JS + 'study-entry.js'));
  globalThis.VexStudyEntry = S;
});

describe('off by default', () => {
  it('does nothing until switched on', async () => {
    expect(R.enabled()).toBe(false);
    expect(() => R.markKnown('house', 'en')).toThrow(/switched off/);
    expect(() => R.adoptCommon('en')).toThrow(/switched off/);
    await expect(R.markUpPage()).rejects.toThrow(/switched off/);
    R.setEnabled(true);
    expect(R.enabled()).toBe(true);
  });
});

describe('dictionary forms', () => {
  it('finds English forms by rule, the word itself first', () => {
    expect(R.candidates('Studies', 'en')).toEqual(expect.arrayContaining(['studies', 'study']));
    expect(R.candidates('stopped', 'en')).toEqual(expect.arrayContaining(['stop']));
    expect(R.candidates('making', 'en')).toEqual(expect.arrayContaining(['make']));
    expect(R.candidates('was', 'en')).toContain('be');
    expect(R.candidates('children', 'en')[0]).toBe('children');
    expect(R.candidates("teacher's", 'en')).toContain('teacher');
  });
  it('finds Turkish stems by stripping suffixes, with consonant softening, in Turkish lower case', () => {
    expect(R.candidates('Kitabı', 'tr')).toEqual(expect.arrayContaining(['kitabı', 'kitab', 'kitap']));
    expect(R.candidates('okullarda', 'tr')).toContain('okul');
    expect(R.candidates('ISIK', 'tr')[0]).toBe('ısık');
    expect(R.candidates('', 'tr')).toEqual([]);
  });
});

describe('glosses', () => {
  it('looks up the starter list in both directions, saying when the form was reduced', () => {
    expect(R.lookup('avoids', 'en')).toMatchObject({ lemma: 'avoid', gloss: 'kaçınmak', exact: false, source: 'starter list' });
    expect(R.lookup('avoid', 'en').exact).toBe(true);
    expect(R.lookup('okullarda', 'tr')).toMatchObject({ lemma: 'okul', gloss: 'school', exact: false });
    expect(R.lookup('zzzz', 'en')).toBe(null);
    expect(R.lookup('house', 'fr')).toBe(null);
  });
  it('reads your own list (comma, semicolon, tab or quoted) and it wins over the starter', () => {
    R.setEnabled(true);
    expect(R.parseList('word,gloss\nrun,"koşmak, kaçmak"\nbirds;kuşlar;bird\nfoo\tbar')).toEqual([['run', 'koşmak, kaçmak', ''], ['birds', 'kuşlar', 'bird'], ['foo', 'bar', '']]);
    R.importList('avoid,kendi anlamım', 'en');
    expect(R.lookup('avoid', 'en')).toMatchObject({ gloss: 'kendi anlamım', source: 'your list' });
    expect(R.userLists().en).toHaveLength(1);
    R.clearLists('en');
    expect(R.lookup('avoid', 'en').source).toBe('starter list');
  });
  it('refuses a bad list with the line named', () => {
    expect(() => R.parseList('justoneword')).toThrow(/needs a word and a gloss/);
    expect(() => R.parseList('\n# only a comment')).toThrow(/no entries/);
    expect(() => R.parseList('x,' + 'y'.repeat(300))).toThrow(/too long/);
    R.setEnabled(true);
    expect(() => R.importList('a,b', 'fr')).toThrow(/English or Turkish/);
  });
});

describe('known words', () => {
  beforeEach(() => R.setEnabled(true));
  it('marks a word and its dictionary form, and recognises inflected forms later', () => {
    R.markKnown('Avoiding', 'en');
    const known = R.knownSet('en');
    expect(known.has('avoiding')).toBe(true);
    expect(R.isKnown('avoids', 'en', known)).toBe(true);
    expect(R.isKnown('benefit', 'en', known)).toBe(false);
    expect(R.unmarkKnown('avoiding', 'en')).toBe(true);
    expect(R.isKnown('avoiding', 'en')).toBe(false);
  });
  it('adopts the common words of one language only', () => {
    const n = R.adoptCommon('en');
    expect(n).toBeGreaterThan(100);
    expect(R.isKnown('the', 'en')).toBe(true);
    expect(R.isKnown('because', 'en')).toBe(true);
    expect(R.knownCount('tr')).toBe(0);
    R.adoptCommon('tr');
    expect(R.isKnown('çünkü', 'tr')).toBe(true);
  });
  it('refuses a phrase and reports damaged storage instead of replacing it', () => {
    expect(() => R.markKnown('two words', 'en')).toThrow(/one word/);
    localStorage.setItem(R.KNOWN_KEY, '{nope');
    expect(() => R.knownSet('en')).toThrow(/damaged/);
    expect(localStorage.getItem(R.KNOWN_KEY)).toBe('{nope');
  });
  it('exports the list sorted', () => {
    R.markKnown('zebra', 'en'); R.markKnown('apple', 'en');
    expect(R.exportKnown('en').split('\n')).toEqual(['apple', 'zebra']);
  });
});

describe('language and the plan for a page', () => {
  it('trusts the page language, else decides from the letters', () => {
    expect(R.detectLang('tr-TR', '')).toBe('tr');
    expect(R.detectLang('en', '')).toBe('en');
    expect(R.detectLang('', 'Bugün çok güzel bir gün ve ışık her yerde, şimdi çocuklar okula gidiyor çünkü hava güzel')).toBe('tr');
    expect(R.detectLang('', 'The quick brown fox and the dog went to the park and it was a good day for all of us in the sun')).toBe('en');
    expect(R.detectLang('de', 'Das ist ein kurzer deutscher Satz.')).toBe('');
  });
  it('plans what to grey and what to explain', () => {
    R.setEnabled(true);
    R.markKnown('benefit', 'en');
    const plan = R.plan(['benefit', 'benefits', 'avoid', 'cat'], 'en', { known: R.knownSet('en'), prefs: { grey: true, hover: true, markNew: false } });
    expect(plan.known).toEqual(['benefit', 'benefits']);
    expect(plan.gloss.avoid).toBe('kaçınmak');
    expect(plan.gloss.benefits).toBe('benefit: fayda');
    expect(plan.gloss.cat).toBeUndefined();
    const none = R.plan(['avoid'], 'en', { known: new Set(), prefs: { grey: false, hover: false, markNew: false } });
    expect(none.gloss).toEqual({});
  });
});

describe('the page scripts never send anything', () => {
  it('are plain scripts with no network, storage or eval', () => {
    for (const code of [R.collectScript(100), R.markScript(['the'], { cat: 'kedi' }, { grey: true, hover: true, markNew: true })]) {
      expect(() => new Function(code)).not.toThrow();
      for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'eval(', 'localStorage', 'document.cookie', 'innerHTML', 'import(']) expect(code.includes(bad), bad).toBe(false);
    }
  });
  it('the module itself has no network call', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/reading-aids.js'), 'utf8').replace(/\/\/.*$/gm, '');
    for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'AIRouter', 'Ollama']) expect(src.includes(bad), bad).toBe(false);
  });
  it('the collect script reads words and marks nothing', () => {
    document.body.innerHTML = '<p>The cat sat. <b>Avoid</b> the dog.</p><script>var secret = 1;</script><textarea>hidden words</textarea>';
    const out = new Function('return ' + R.collectScript(100))();
    expect(out.words).toEqual(expect.arrayContaining(['the', 'cat', 'sat', 'avoid', 'dog']));
    expect(out.words).not.toContain('secret');
    expect(out.words).not.toContain('hidden');
    expect(document.body.innerHTML).toContain('<b>Avoid</b>');
  });
});

describe('marking up a page', () => {
  const tab = { id: 't', url: 'https://news.example.com/a' };
  beforeEach(() => {
    R.setEnabled(true);
    globalThis.TabManager = { getActiveTab: () => tab };
    globalThis.WebviewManager = { getActiveWebview: () => ({}) };
    window.VexTabPolicy = { canRestore: () => true };
  });
  it('collects the words, builds the plan locally, and sends the marks to the page', async () => {
    R.markKnown('the', 'en');
    const calls = [];
    window.vexGuestEval = vi.fn(async (wv, code) => {
      calls.push(code);
      if (calls.length === 1) return { lang: 'en', words: ['the', 'avoid', 'cat'], sample: '' };
      return { known: 4, marked: 0, glossed: 1 };
    });
    const r = await R.markUpPage();
    expect(r).toMatchObject({ lang: 'en', known: 4, glossed: 1, words: 3 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('["the"]');
    expect(calls[1]).toContain('"avoid":"kaçınmak"');
  });
  it('says so for a page in another language, a private tab and a non-web page', async () => {
    window.vexGuestEval = vi.fn(async () => ({ lang: 'de', words: ['das'], sample: 'Das ist ein kurzer Satz.' }));
    await expect(R.markUpPage()).rejects.toThrow(/English and Turkish/);
    window.VexTabPolicy = { canRestore: () => false };
    await expect(R.markUpPage()).rejects.toThrow(/private, Tor or routed/);
    window.VexTabPolicy = { canRestore: () => true };
    tab.url = 'file:///x.html';
    await expect(R.markUpPage()).rejects.toThrow(/web pages/);
    tab.url = 'https://news.example.com/a';
  });
  it('shows the page-side marks (the highlight API) without changing the page markup', () => {
    const set = vi.fn();
    globalThis.Highlight = class { constructor() { this.items = []; } add(r) { this.items.push(r); } };
    globalThis.CSS = { highlights: { set, delete: vi.fn() } };
    document.body.innerHTML = '<p>The cat sat on the mat</p>';
    const before = document.body.innerHTML;
    const res = new Function('return ' + R.markScript(['the', 'sat'], { cat: 'kedi' }, { grey: true, hover: false, markNew: true }))();
    expect(res).toMatchObject({ known: 3, marked: 1, glossed: 1 });
    expect(set).toHaveBeenCalledWith('vex-ra-known', expect.any(Object));
    expect(document.body.innerHTML).toBe(before);
    expect(typeof window.__vexRaClear).toBe('function');
    window.__vexRaClear();
    expect(document.querySelector('[data-vex-ra]')).toBe(null);
    delete globalThis.Highlight; delete globalThis.CSS;
  });
});

describe('saved vocabulary is the study-entry store', () => {
  it('keeps lang, lemma and gloss on the word and puts them on the FlashMind card', () => {
    const r = S.addWord({ word: 'avoiding', sentence: 'He kept avoiding the question.', url: 'https://x.test/a', title: 'T', lang: 'en', lemma: 'avoid', gloss: 'kaçınmak' });
    expect(r.entry).toMatchObject({ word: 'avoiding', lang: 'en', lemma: 'avoid', gloss: 'kaçınmak' });
    const plain = S.addWord({ word: 'dog', sentence: 'The dog barked.' });
    expect(plain.entry.gloss).toBeUndefined();
    const cards = S.vocabCards(S.vocab(), 'English');
    expect(cards[0].back.startsWith('avoid: kaçınmak\nHe kept avoiding')).toBe(true);
    expect(cards[1].back.startsWith('The dog barked.')).toBe(true);
  });
  it('saves the selected word with its gloss through the shared store', async () => {
    const R2 = R;
    R2.setEnabled(true);
    globalThis.TabManager = { getActiveTab: () => ({ id: 't', url: 'https://news.example.com/a', title: 'News' }) };
    globalThis.WebviewManager = { getActiveWebview: () => ({}) };
    window.VexTabPolicy = { canRestore: () => true };
    window.vexGuestEval = vi.fn(async () => ({ word: 'avoids', context: 'She always avoids the crowd. It is quiet there.' }));
    const out = await R2.saveSelectedWord();
    expect(out.added).toBe(true);
    expect(S.vocab()[0]).toMatchObject({ word: 'avoids', lemma: 'avoid', gloss: 'kaçınmak', lang: 'en' });
  });
});
