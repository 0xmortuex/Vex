// @vitest-environment jsdom
//
// Settings search against the REAL Settings page (index.html), 2026-11-01: "theme packs" listed Play: sound packs, Holidays and phrases, Command Chains
// ... and did not find the "Theme packs..." button. A result has to hold every typed word in a name, a title or the keywords; whole phrases and exact
// words come first; the single setting is the result, not only its section; fuzzy matching only when there are few results.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const path = require('path');
const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const { VexTrLemma } = require('../../src/renderer/js/turkish-lemma.js');
globalThis.VexTr = VexTr;
globalThis.VexTrLemma = VexTrLemma;
const { VexSmartSearch } = require('../../src/renderer/js/smart-search.js');
const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');

let groups;
const fold = (s) => VexSmartSearch.fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

beforeAll(() => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const content = doc.querySelector('#panel-settings .settings-content');
  expect(content).toBeTruthy();
  const root = document.createElement('div');
  root.className = 'settings-content';
  for (const el of Array.from(content.children)) root.appendChild(document.importNode(el, true));
  // The sections modules register at run time (js/vex-settings-groups.js), the way they are drawn.
  const reg = (title, keywords, row) => {
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.dataset.keywords = keywords;
    g.innerHTML = '<label class="setting-label"></label><div class="setting-toggle-row"><span></span></div>';
    g.querySelector('span').textContent = row;
    g.querySelector('.setting-label').textContent = title;
    root.appendChild(g);
  };
  reg('Wallpapers', 'wallpaper background picture photo new tab store gradient image theme pack', 'Open the Wallpaper Store');
  reg('Play: sound packs', 'sound pack sounds', 'Sound packs');
  reg('Holidays and phrases from packs', 'holiday phrase pack', 'Holiday phrases');
  document.body.innerHTML = '';
  document.body.appendChild(root);
  groups = Array.from(root.querySelectorAll('.setting-group'));
  groups.forEach((g, i) => {
    const label = g.querySelector('.setting-label');
    const own = g.dataset.keywords || '';
    const text = (label ? label.textContent : '').trim().toLowerCase();
    g.dataset.keywords = (text + ' ' + SettingsUI.keywordsFor(text) + ' ' + own).trim();
    g.dataset.ord = String(i);
  });
});
beforeEach(() => {
  globalThis.VexSmartSearch = VexSmartSearch;
  globalThis.VexI18nUI = { TABLE: { tr: {} }, english: (el) => (el.dataset.i18nText != null ? el.dataset.i18nText : el.textContent) };
  VexSmartSearch._wordCache.clear(); VexSmartSearch._rev = null;
});
afterEach(() => { delete globalThis.VexSmartSearch; delete globalThis.VexI18nUI; });

const search = (q) => SettingsUI._rankGroups(groups, q).hits;
const titles = (q, n = 5) => search(q).slice(0, n).map(h => h.title.toLowerCase());

describe('Settings search on the real page', () => {
  it('"theme packs" finds the Theme packs button first, and nothing about sound packs above it', () => {
    const hits = search('theme packs');
    expect(hits[0].title.toLowerCase()).toContain('theme packs');
    expect(hits[0].el).toBeTruthy();
    expect(hits[0].el.id).toBe('setting-open-theme-packs');
    for (const h of hits.slice(0, 5)) expect(fold(h.title + ' ' + h.g.dataset.keywords)).toMatch(/pack/);
  });
  it('every typed word has to be there: "theme packs" does not list sections that only hold "packs" or only "theme"', () => {
    const names = new Set(search('theme packs').map(h => h.section.toLowerCase()));
    expect(names.has('command chains')).toBe(false);
    expect(names.has('mouse gesture editor')).toBe(false);
    expect(names.has('developer desk')).toBe(false);
    expect(names.has('video watch-later')).toBe(false);
  });
  it('"wallpaper" finds Wallpapers', () => {
    expect(titles('wallpaper', 3)).toContain('wallpapers');
  });
  it('"sidebar" finds the sidebar settings', () => {
    const t = titles('sidebar', 4);
    expect(t.some(x => x.includes('show the sidebar'))).toBe(true);
    expect(t.some(x => x.includes('group the sidebar buttons'))).toBe(true);
  });
  it('"group the sidebar buttons" finds that switch first', () => {
    expect(titles('group the sidebar buttons', 1)[0]).toContain('group the sidebar buttons');
  });
  it('"dark" finds something about dark mode in the top results', () => {
    const hits = search('dark').slice(0, 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(h => /dark|appearance|theme/i.test(h.title + ' ' + h.g.dataset.keywords))).toBe(true);
  });
  it('"weather" finds the weather location setting', () => {
    expect(titles('weather', 3).some(x => x.includes('weather'))).toBe(true);
  });
  it('"game performance preset" finds the game settings', () => {
    expect(search('game performance preset').length).toBeGreaterThan(0);
  });
  it('a nonsense word finds nothing', () => {
    expect(search('qzxvwk')).toEqual([]);
    expect(search('theme zzqqxx')).toEqual([]);
  });
  it('a Turkish word still finds the English setting', () => {
    const t = titles('kenar çubuğu', 6);
    expect(t.length).toBeGreaterThan(0);
  });
  it('searching a setting by its exact label finds it in the top 3 (every label of the page)', () => {
    const missing = [];
    let checked = 0;
    const seen = new Set();
    for (const g of groups) {
      const idx = SettingsUI._indexOf(g, VexSmartSearch);
      for (const it of idx.items) {
        const wordsN = VexSmartSearch.words(it.title).length;
        // A one-letter or one-symbol label cannot be searched for, and a label of only stop words is searched as typed anyway.
        if (it.title.length < 3 || !wordsN) continue;
        if (seen.has(it.fold)) continue;
        seen.add(it.fold);
        checked++;
        const top = search(it.title).slice(0, 3).map(h => fold(h.title));
        if (!top.includes(fold(it.title))) missing.push(it.title + '  ->  ' + top.join(' | '));
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(missing).toEqual([]);
  });
});
