// js/smart-search.js: the search shared by Ctrl+K and Settings. Every word must be found, a word matches whole, as a start, as an ending away, or
// with one slip; both languages are searched at once (an English word finds a Turkish text and the other way round); synonyms; where it was found counts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const { VexTrLemma } = require('../../src/renderer/js/turkish-lemma.js');
globalThis.VexTr = VexTr;
globalThis.VexTrLemma = VexTrLemma;
const { VexSmartSearch: S } = require('../../src/renderer/js/smart-search.js');

// A few phrases of the translation table, as js/i18n-ui.js has them (English -> Turkish).
const TABLE = {
  'Check for Updates': 'Güncellemeleri Denetle',
  'Privacy Hardening': 'Gizlilik Sıkılaştırma',
  'Downloads': 'İndirilenler',
  'Bookmarks': 'Yer İmleri',
  'Dark Mode for Websites': 'Web Siteleri için Karanlık Mod',
  'Sounds': 'Sesler',
  'New Tab': 'Yeni Sekme',
};
beforeEach(() => { globalThis.VexI18nUI = { TABLE: { tr: TABLE } }; S._wordCache.clear(); S._rev = null; });
afterEach(() => { delete globalThis.VexI18nUI; });

const rank = (q, things) => things.map(t => ({ n: t.name, s: S.score(q, t) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.n);

describe('words and folding', () => {
  it('folds case, the Turkish I and the accents, and splits on anything that is not a letter or a digit', () => {
    expect(S.words('İstanbul Güncelle-me, IPv6 7z')).toEqual(['istanbul', 'guncelle', 'me', 'ipv6', '7z']);
  });
  it('drops filler words from a query of several words, but searches a query that is only filler as typed', () => {
    expect(S.parse('how to update the browser').tokens.map(t => t.raw)).toEqual(['update', 'browser']);
    expect(S.parse('to the').tokens.map(t => t.raw)).toEqual(['to', 'the']);
    expect(S.parse('   ')).toBe(null);
  });
});

describe('how a word fits a word', () => {
  it('whole, start, an ending away, inside, and one slip of the keys', () => {
    expect(S.fit('update', 'update')).toBe(1);
    expect(S.fit('upd', 'update')).toBeGreaterThan(0.8);
    expect(S.fit('updates', 'update')).toBeGreaterThan(0.7);
    expect(S.fit('date', 'update')).toBe(0.5);
    expect(S.fit('privcy', 'privacy')).toBeGreaterThan(0);        // a letter missing
    expect(S.fit('privaycy', 'privacy')).toBeGreaterThan(0);      // a letter added
    expect(S.fit('pirvacy', 'privacy')).toBeGreaterThan(0);       // two swapped
    expect(S.fit('setting', 'download')).toBe(0);
  });
  it('a short word is not found inside other words', () => {
    expect(S.fit('ate', 'update')).toBe(0);
    expect(S.fit('in', 'privacy')).toBe(0);
  });
});

describe('both languages', () => {
  it('reads the translation table both ways', () => {
    expect(S.otherLanguage('Downloads')).toBe('İndirilenler');
    expect(S.otherLanguage('İndirilenler')).toBe('Downloads');
    expect(S.otherLanguage('indirilenler')).toBe('Downloads');      // folded
    expect(S.otherLanguage('Not in the table')).toBe('');
  });
  it('a Turkish word finds the English-named thing, and an English word finds the thing drawn in Turkish', () => {
    expect(S.score('indirilenler', { name: 'Downloads' })).toBeGreaterThan(90);
    expect(S.score('downloads', { name: 'İndirilenler' })).toBeGreaterThan(90);
    expect(S.score('yer imleri', { name: 'Bookmarks' })).toBeGreaterThan(90);
    expect(S.score('karanlık mod', { name: 'Dark Mode for Websites' })).toBeGreaterThan(70);
  });
  it('works without the table too (the English alone)', () => {
    delete globalThis.VexI18nUI; S._wordCache.clear();
    expect(S.score('downloads', { name: 'Downloads' })).toBeGreaterThan(90);
    expect(S.otherLanguage('Downloads')).toBe('');
  });
});

describe('synonyms and endings', () => {
  it('the same thing under another word, in either language', () => {
    expect(S.score('upgrade', { name: 'Check for Updates' })).toBeGreaterThan(80);
    expect(S.score('güncelleme', { name: 'Check for Updates' })).toBeGreaterThan(80);
    expect(S.score('gizlilik', { name: 'Privacy Hardening' })).toBeGreaterThan(80);
    expect(S.score('privacy', { name: 'Gizlilik Sıkılaştırma' })).toBeGreaterThan(80);
    expect(S.score('night', { name: 'Dark Mode for Websites' })).toBeGreaterThan(70);
  });
  it('a Turkish word with endings finds its stem, an English plural its singular', () => {
    expect(S.score('güncellemeleri', { name: 'Update' })).toBeGreaterThan(70);
    expect(S.score('bookmarks', { name: 'Bookmark' })).toBeGreaterThan(70);
    expect(S.score('settings', { name: 'Setting' })).toBeGreaterThan(70);
  });
  it('a synonym ranks a little below the word itself', () => {
    expect(S.score('update', { name: 'Update' })).toBeGreaterThan(S.score('upgrade', { name: 'Update' }));
  });
});

describe('every word counts', () => {
  const things = [
    { name: 'Privacy Hardening', keywords: 'fingerprint webrtc', hint: 'HTTPS-Only mode' },
    { name: 'Fingerprint Test', keywords: '', hint: '' },
    { name: 'Downloads', keywords: '', hint: '' },
  ];
  it('finds what has all the words, in any order, and nothing that lacks one', () => {
    expect(rank('privacy fingerprint', things)).toEqual(['Privacy Hardening']);
    expect(rank('fingerprint privacy', things)).toEqual(['Privacy Hardening']);
    expect(rank('fingerprint', things)).toEqual(expect.arrayContaining(['Privacy Hardening', 'Fingerprint Test']));
    expect(rank('fingerprint downloads', things)).toEqual([]);
  });
  it('nothing found is 0, not a weak match', () => {
    expect(S.score('xyzzyq', { name: 'Downloads', keywords: 'folder', hint: 'where files go' })).toBe(0);
  });
});

describe('where it was found counts', () => {
  it('the name above the keywords above the description', () => {
    const inName = S.score('update', { name: 'Update', keywords: '', hint: '' });
    const inKeywords = S.score('update', { name: 'About', keywords: 'update version', hint: '' });
    const inHint = S.score('update', { name: 'About', keywords: '', hint: 'tells you about an update' });
    expect(inName).toBeGreaterThan(inKeywords);
    expect(inKeywords).toBeGreaterThan(inHint);
    expect(inHint).toBeGreaterThan(0);
  });
  it('"update" finds the update setting before a section that only mentions the word (the Settings bug of 2026-10-26)', () => {
    const things = [
      { name: 'Privacy Hardening', keywords: 'fingerprint webrtc', hint: 'Applies to pages you open after toggling. Updates itself.' },
      { name: 'About Vex', keywords: 'update updates version check for updates changelog', hint: '' },
      { name: 'Check for Updates', keywords: '', hint: '' },
    ];
    expect(rank('update', things)).toEqual(['Check for Updates', 'About Vex', 'Privacy Hardening']);
    expect(rank('güncelleme', things)[0]).toBe('Check for Updates');
  });
});

describe('speed', () => {
  it('scores two thousand commands in well under a second', () => {
    const words = ['open', 'close', 'tab', 'window', 'settings', 'download', 'history', 'bookmark', 'privacy', 'sound', 'page', 'search'];
    const items = [];
    for (let i = 0; i < 2000; i++) items.push({ name: words[i % 12] + ' ' + words[(i * 7) % 12] + ' ' + i, keywords: '', hint: words[(i * 5) % 12] + ' ' + words[(i * 3) % 12] });
    const t0 = performance.now();
    for (const it of items) S.score('privacy setings', it);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
