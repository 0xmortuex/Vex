// @vitest-environment jsdom
// T3-053 (Wave 6): the plural helper, its Turkish rule, and the ratchet that keeps new hand-written endings out.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { VexPlural: P } = require('../../src/renderer/js/vex-plural.js');
const M = require('../../scripts/migrate-plural.js');
const ROOT = path.resolve(__dirname, '../..');

beforeEach(() => { localStorage.clear(); });

describe('English', () => {
  it('s and es keep the old rule exactly: anything that is not 1 is plural', () => {
    expect(P.s(1)).toBe('');
    for (const n of [0, 2, 5, 1.5, -1, NaN, undefined, '1']) expect(P.s(n)).toBe('s');
    expect(P.es(1)).toBe('');
    expect(P.es(2)).toBe('es');
  });
  it('en picks the word, with an irregular plural when given', () => {
    expect(P.en(1, 'tab')).toBe('tab');
    expect(P.en(3, 'tab')).toBe('tabs');
    expect(P.en(1, 'person', 'people')).toBe('person');
    expect(P.en(4, 'person', 'people')).toBe('people');
  });
});

describe('Turkish', () => {
  it('keeps the noun as written whatever the count: "3 sekme", never "3 sekmeler"', () => {
    for (const n of [0, 1, 2, 30]) expect(P.tr(n, 'sekme')).toBe('sekme');
  });
  it('count writes the number and the word by the interface language', () => {
    const forms = { en: ['tab', 'tabs'], tr: 'sekme' };
    expect(P.count(1, forms)).toBe('1 tab');
    expect(P.count(3, forms)).toBe('3 tabs');
    localStorage.setItem('vex.lang', 'tr');
    window.VexI18n = { locale: () => 'tr' };
    globalThis.VexI18n = window.VexI18n;
    expect(P.language()).toBe('tr');
    expect(P.count(1, forms)).toBe('1 sekme');
    expect(P.count(3, forms)).toBe('3 sekme');
    delete globalThis.VexI18n; delete window.VexI18n;
    expect(P.language()).toBe('en');
  });
  it('count with a string form, an explicit language, a missing form and a count that is not a number', () => {
    expect(P.count(2, { en: 'file', tr: 'dosya' }, 'en')).toBe('2 files');
    expect(P.count(2, { en: 'file', tr: 'dosya' }, 'tr')).toBe('2 dosya');
    expect(P.count(2, { en: ['match', 'matches'] }, 'tr')).toBe('2 matches');
    expect(() => P.count(2, { tr: 'dosya' }, 'en')).toThrow(/no form for the language en/);
    expect(() => P.count(NaN, { en: 'file' })).toThrow(/needs a count/);
    expect(() => P.count(2, null)).toThrow(/needs \{ en, tr \} forms/);
  });
});

describe('the migration', () => {
  it('rewrites the spellings it knows and leaves the others alone', () => {
    const cases = [
      ["'tab' + (n === 1 ? '' : 's')", "'tab' + VexPlural.s(n)"],
      ["'tab' + (list.length !== 1 ? 's' : '')", "'tab' + VexPlural.s(list.length)"],
      ["`${rows.length} match${rows.length === 1 ? '' : 'es'}`", "`${rows.length} match${VexPlural.es(rows.length)}`"],
      ["'x' + (st.items[0].n === 1 ? '' : 's')", "'x' + VexPlural.s(st.items[0].n)"],
      ["'x' + (getCount() === 1 ? '' : 's')", "'x' + VexPlural.s(getCount())"],
    ];
    for (const [from, to] of cases) {
      let out = from;
      for (const r of M._rules) out = out.replace(r.re, (...a) => r.to(...a));
      expect(out, from).toBe(to);
    }
    const keep = "foo(n === 1 ? '' : 's')";
    let out = keep;
    for (const r of M._rules) out = out.replace(r.re, (...a) => r.to(...a));
    expect(out).toBe(keep);                       // an argument is not a parenthesised ending
  });
});

describe('the ratchet', () => {
  it('no hand-written English plural ending is left in a file that loads VexPlural', () => {
    expect(M.countRaw(), 'run: node scripts/migrate-plural.js --write, then look at what it lists').toBe(0);
  });
  it('the files that run without the helper are named, not guessed', () => {
    const ex = M.excluded();
    expect(ex.has('vex-plural.js')).toBe(true);
    expect(ex.has('popup-chrome.js')).toBe(true);        // popup-chrome.html loads it alone
    expect(ex.has('typed-address.js')).toBe(true);       // start.html and the main process
    expect(ex.has('private-address.js')).toBe(true);     // required by main
  });
  it('index.html loads the helper before the modules that use it, and the test setup provides it', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    const at = html.indexOf('js/vex-plural.js');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(html.indexOf('js/tabs.js'));
    expect(globalThis.VexPlural).toBe(P);
  });
});
