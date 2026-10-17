// @vitest-environment jsdom
// T3-034 (Wave 6): the large public-domain English list, "I know the first 1,000 / 3,000 words", and the harmony-aware
// Turkish ending rules (js/turkish-lemma.js) that the reading aids use on top of the flat suffix list.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const JS = '../../src/renderer/js/';
const ROOT = path.resolve(__dirname, '../..');
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let R, L, LISTS;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  globalThis.VexReadingAidsData = fresh(JS + 'reading-aids-data.js').VexReadingAidsData;
  LISTS = globalThis.VexReadingAidsLists = fresh(JS + 'reading-aids-lists.js').VexReadingAidsLists;
  L = globalThis.VexTrLemma = fresh(JS + 'turkish-lemma.js').VexTrLemma;
  ({ VexReadingAids: R } = fresh(JS + 'reading-aids.js'));
  R.setEnabled(true);
});

describe('the large English list', () => {
  it('has about three thousand plain lower-case words, the commonest first, and no name or archaic form', () => {
    expect(LISTS.EN.length).toBeGreaterThan(2900);
    expect(LISTS.EN.slice(0, 8)).toEqual(['the', 'and', 'to', 'of', 'a', 'i', 'in', 'he']);
    expect(LISTS.EN.every(w => /^[a-z]+$/.test(w))).toBe(true);
    expect(new Set(LISTS.EN).size).toBe(LISTS.EN.length);
    for (const w of ['thou', 'hath', 'mr', 'mrs', 'elizabeth', 'holmes', 'darcy']) expect(LISTS.EN, w).not.toContain(w);
    for (const w of ['house', 'water', 'because', 'internet', 'computer']) expect(LISTS.EN, w).toContain(w);
  });
  it('names its source and ships under a notice that says so', () => {
    const head = fs.readFileSync(path.join(ROOT, 'src/renderer/js/reading-aids-lists.js'), 'utf8').slice(0, 700);
    expect(head).toMatch(/public-domain books from Project Gutenberg/);
    expect(fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toMatch(/English common-word list[\s\S]{0,400}public domain/);
  });
  it('the build script is deterministic about what counts as a name and a word', () => {
    const B = require('../../scripts/build-wordlists.js');
    const w = B.words('*** START OF THE PROJECT GUTENBERG EBOOK X ***\nIt was a fine day. Then Darcy said "the door is open" and Anna ran. CHAPTER ONE\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nlicence text');
    expect(w).toEqual(expect.arrayContaining(['it', 'then', 'said', 'the', 'door']));
    expect(w).not.toContain('darcy');
    expect(w).not.toContain('anna');
    expect(w).not.toContain('chapter');
    expect(w).not.toContain('licence');
    expect(() => B.build(path.join(ROOT, 'tests'))).toThrow(/Need at least 20 books/);
  });
});

describe('adopting the commonest words', () => {
  it('the starter list is still the default', () => {
    const n = R.adoptCommon('en');
    expect(n).toBe(new Set(VexReadingAidsData.COMMON.en.map(w => R.lower(w, 'en'))).size);
  });
  it('the first 1,000 and the first 3,000 add that many, and a later click only adds', () => {
    expect(R.adoptCommon('en', 1000)).toBe(1000);
    expect(R.knownCount('en')).toBe(1000);
    const n3 = R.adoptCommon('en', 3000);
    expect(n3).toBe(3000);
    expect(R.knownSet('en').has('house')).toBe(true);
  });
  it('refuses a level that does not exist and Turkish, with a plain sentence', () => {
    expect(() => R.adoptCommon('en', 500)).toThrow(/1000 or 3000 English words/);
    expect(() => R.adoptCommon('tr', 1000)).toThrow(/no larger list for tr/);
  });
  it('is not loaded: an error, not an empty adoption', () => {
    delete globalThis.VexReadingAidsLists;
    expect(() => R.adoptCommon('en', 1000)).toThrow(/not loaded/);
  });
});

describe('Turkish endings by rule', () => {
  const CASES = {
    evlerinden: 'ev', kitapları: 'kitap', kitabı: 'kitap', okuyorum: 'okumak', gelmiyorlar: 'gelmek', arabalarımızdan: 'araba', çocuğa: 'çocuk',
    burnu: 'burun', güzellik: 'güzel', öğrenciler: 'öğrenci', gideceğim: 'gitmek', yapmışlar: 'yapmak', bakıyor: 'bakmak', okullarda: 'okul',
    insanlar: 'insan', yazdı: 'yazmak', gözümden: 'göz', arkadaşım: 'arkadaş', eve: 'ev', evde: 'ev', masayı: 'masa', suyun: 'su', sevdiğim: 'sevmek',
    çalışıyorsun: 'çalışmak', evimizdeki: 'ev', yaşıyoruz: 'yaşamak', annemin: 'anne', ağzı: 'ağız', şehirlerde: 'şehir', gelecek: 'gelmek',
    bilgisayarlar: 'bilgisayar', kalemler: 'kalem', dostluk: 'dost', kitapçıdan: 'kitap',
  };
  it.each(Object.entries(CASES))('%s comes from %s', (word, lemma) => {
    const c = L.candidates(word);
    expect(c[0]).toBe(word);
    expect(c, word).toContain(lemma);
  });
  it('only strips an ending that fits the vowels and the d/t rule', () => {
    expect(L.fits('ev', 'lar')).toBe(false);           // front vowel wants -ler
    expect(L.fits('ev', 'ler')).toBe(true);
    expect(L.fits('kitap', 'da')).toBe(false);         // after a hard consonant it is -ta
    expect(L.fits('kitap', 'ta')).toBe(true);
    expect(L.fits('okul', 'un')).toBe(true);
    expect(L.fits('okul', 'ün')).toBe(false);
    expect(L.candidates('evlar')).not.toContain('ev'); // -lar after a front-vowel stem is not an ending
  });
  it('is bounded and total: empty and odd input give a list, never an error', () => {
    expect(L.candidates('')).toEqual([]);
    expect(L.candidates('a')).toEqual(['a']);
    expect(L.candidates('çok uzun bir kelimelerinizdekilerinkinden'.replace(/ /g, '')).length).toBeLessThanOrEqual(60);
  });
  it('the reading aids look a word up through it: an inflected Turkish word finds its dictionary entry', () => {
    R.setEnabled(true);
    const hit = R.lookup('arkadaşlarımızdan', 'tr');
    expect(hit).toMatchObject({ lemma: 'arkadaş' });
    expect(hit.exact).toBe(false);
  });
});
