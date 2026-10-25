// @vitest-environment jsdom
//
// Vex's own viewer for office documents and e-books, the page side (src/renderer/office-viewer): the words in two languages, the
// page's own markup (names for everything you press), the icons it uses, the colours it may paint with, and the small readers of
// data it owns (CSV).

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.join(__dirname, '..', '..', 'src', 'renderer', 'office-viewer');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const files = fs.readdirSync(DIR).filter((f) => /\.(js|html|css)$/.test(f));

// Every English sentence the page asks t() for, and every data-i18n* text of its markup.
function sentences() {
  const keys = new Set();
  const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  for (const f of files) {
    if (f === 'strings-tr.js' || f.endsWith('.css')) continue;
    const src = read(f);
    for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g)) keys.add(unescape(m[1]));
    for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\\n]|\\.)*)"/g)) keys.add(unescape(m[1]));
    if (f.endsWith('.html')) for (const m of src.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]*)"/g)) keys.add(m[1]);
  }
  return keys;
}
// Sentences that reach t() through a variable: the file kinds, the highlight colours and the words around them.
const VIA_VARIABLE = ['Word document', 'Word document (old format)', 'Excel workbook', 'Excel workbook (old format)', 'PowerPoint presentation', 'PowerPoint presentation (old format)',
  'Text document (OpenDocument)', 'Spreadsheet (OpenDocument)', 'Presentation (OpenDocument)', 'Rich Text document', 'E-book', 'Table (CSV)', 'yellow', 'green', 'blue', 'pink', 'document', 'Document'];

describe('the words, in two languages', () => {
  let TR, strings;
  beforeAll(async () => {
    TR = (await import('../../src/renderer/office-viewer/strings-tr.js')).TR;
    strings = await import('../../src/renderer/office-viewer/strings.js');
  });
  it('has Turkish for every sentence the code and the page ask for', () => {
    const missing = [...sentences(), ...VIA_VARIABLE].filter((k) => !Object.prototype.hasOwnProperty.call(TR, k));
    expect(missing).toEqual([]);
  });
  it('has no Turkish sentence that nothing asks for (a stale entry hides a renamed sentence)', () => {
    const asked = new Set([...sentences(), ...VIA_VARIABLE]);
    expect(Object.keys(TR).filter((k) => !asked.has(k))).toEqual([]);
  });
  it('keeps every {name} of a sentence in its Turkish', () => {
    const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const [en, tr] of Object.entries(TR)) expect(names(tr), en).toBe(names(en));
  });
  it('fills names in, and answers in the language the page was given', () => {
    expect(strings.t('Page {n} of {total}', { n: 3, total: 8 })).toBe('Page 3 of 8');
    strings.setLang('tr');
    expect(strings.t('Page {n} of {total}', { n: 3, total: 8 })).toBe('Sayfa 3 / 8');
    expect(strings.t('A sentence nobody translated')).toBe('A sentence nobody translated');
    strings.setLang('en');
    expect(strings.getLang()).toBe('en');
  });
  it('does not write English or Turkish with an emoji anywhere', () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    for (const f of files) expect(emoji.test(read(f)), f).toBe(false);
  });
});

describe('the page\'s markup', () => {
  let doc;
  beforeAll(() => { doc = new DOMParser().parseFromString(read('viewer.html'), 'text/html'); });
  it('names everything you can press, in both languages', () => {
    for (const b of doc.querySelectorAll('button')) {
      const named = b.textContent.trim() || b.hasAttribute('data-i18n-aria') || b.hasAttribute('aria-label') || b.querySelector('[data-i18n]');
      expect(named, b.id || b.outerHTML).toBeTruthy();
      if (b.hasAttribute('data-i18n-aria') || b.hasAttribute('data-i18n-title')) expect(b.hasAttribute('data-i18n-aria') || b.querySelector('[data-i18n]'), b.id).toBeTruthy();
    }
    for (const input of doc.querySelectorAll('input')) expect(input.hasAttribute('data-i18n-aria') || input.hasAttribute('aria-label'), input.id).toBe(true);
  });
  it('has the landmarks and live regions a reader needs', () => {
    expect(doc.querySelector('header[role="toolbar"]')).toBeTruthy();
    expect(doc.querySelector('main')).toBeTruthy();
    expect(doc.querySelector('aside[aria-label], aside[data-i18n-aria]')).toBeTruthy();
    expect(doc.querySelector('[role="status"][aria-live="polite"]')).toBeTruthy();
    expect(doc.querySelector('[role="search"]')).toBeTruthy();
    expect(doc.querySelector('a.od-skip')).toBeTruthy();
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    expect(doc.querySelector('meta[name="vex-persist"]')).toBeTruthy();
  });
  it('loads only its own files, in the order the page needs, with no inline script', () => {
    const srcs = [...doc.querySelectorAll('script')].map((s) => s.getAttribute('src'));
    expect(srcs).toEqual(['/icons.js', '/app/zipinfo.js', '/app/app.js']);
    for (const s of doc.querySelectorAll('script')) expect(s.textContent.trim()).toBe('');
    for (const l of doc.querySelectorAll('link[rel="stylesheet"]')) expect(l.getAttribute('href')).toMatch(/^\/(css|app)\//);
  });
  it('uses only icons that exist', () => {
    const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
    const used = new Set();
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/data-icon="([a-z0-9-]+)"/g)) used.add(m[1]);
      for (const m of src.matchAll(/\bicon\(\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/\bicon:\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((n) => !VexIcons.has(n))).toEqual([]);
  });
});

describe('the colours it may paint with', () => {
  it('uses the interface\'s tokens for its own chrome (the file\'s own paper, slides and cell fills are the exception)', () => {
    const css = read('viewer.css');
    const chrome = css.slice(0, css.indexOf('/* ---------- 7. text documents'));
    // a var() with a fallback may carry a colour; nothing else in the chrome may
    const stripped = chrome.replace(/var\(--[\w-]+,\s*[^()]*(?:\([^()]*\)[^()]*)*\)/g, 'var()').replace(/\/\*[\s\S]*?\*\//g, '');
    const literals = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0].toLowerCase()).filter((c) => !['#fff', '#000', '#111', '#111318', '#ffffff'].includes(c) && !/^rgba\(0, 0, 0/.test(c));
    expect(literals).toEqual([]);
  });
  it('keeps a11y.css the last stylesheet it could meet and links the theme tokens first', () => {
    const html = read('viewer.html');
    expect(html.indexOf('/css/theme-tokens.css')).toBeLessThan(html.indexOf('/app/viewer.css'));
    expect(html).not.toMatch(/a11y\.css/);
  });
  it('respects reduced motion', () => {
    expect(read('viewer.css')).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
  it('shows a focus ring on the focused element itself', () => {
    expect(read('viewer.css')).toMatch(/\.od :focus-visible \{ outline: 2px solid var\(--od-accent\)/);
  });
});

describe('a CSV read as a sheet', () => {
  let csv;
  beforeAll(async () => { csv = await import('../../src/renderer/office-viewer/csv.js'); });
  it('finds the delimiter and reads quotes, numbers and line breaks inside quotes', () => {
    const { sheet, delimiter } = csv.parseCsv('Ad;Not;Açıklama\r\nAda;93,5;"iyi; çok iyi"\r\nBeren;88;"iki\nsatır"\r\n');
    expect(delimiter).toBe(';');
    expect(sheet.maxRow).toBe(3);
    expect(sheet.maxCol).toBe(3);
    expect(sheet.rows[1][2][0]).toBe('iyi; çok iyi');
    expect(sheet.rows[2][1]).toEqual([88, 'n', 0]);
    expect(sheet.rows[2][2][0]).toBe('iki\nsatır');
    const comma = csv.parseCsv('a,b\n1,"he said ""hi"""\n');
    expect(comma.sheet.rows[1][1][0]).toBe('he said "hi"');
    expect(comma.sheet.rows[1][0]).toEqual([1, 'n', 0]);
  });
  it('keeps a number with a leading zero as text', () => {
    expect(csv.parseCsv('code\n007\n').sheet.rows[1][0][0]).toBe('007');
  });
});

describe('the sheet export', () => {
  it('quotes what must be quoted', async () => {
    const { toCsv, toTsv } = await import('../../src/renderer/office-viewer/sheet.js');
    expect(toCsv([['a', 'b,c', 'd"e'], ['', ' x', 'line\nbreak']])).toBe('a,"b,c","d""e"\r\n,\" x\",\"line\nbreak\"\r\n');
    expect(toCsv([['a;b', 'c']], ';')).toBe('"a;b";c\r\n');
    expect(toTsv([['a\tb', 'c\nd']])).toBe('a b\tc d');
  });
});
