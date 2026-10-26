// @vitest-environment jsdom
//
// Ctrl+K with the smarter search (js/smart-search.js), 2026-10-26: every word of the query, synonyms, plurals, one slip of the keys, and both
// languages (a Turkish person types either and gets the same results). The tiers that were there (an exact name, the start of a word...) stay first.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const { VexTrLemma } = require('../../src/renderer/js/turkish-lemma.js');
globalThis.VexTr = VexTr;
globalThis.VexTrLemma = VexTrLemma;
const { VexSmartSearch } = require('../../src/renderer/js/smart-search.js');
const { CommandBar } = require('../../src/renderer/js/command.js');

const TABLE = { 'Check for Updates': 'Güncellemeleri Denetle', 'Dark Mode': 'Karanlık Mod', 'Bookmarks': 'Yer İmleri', 'Download Manager': 'İndirme Yöneticisi', 'New Tab': 'Yeni Sekme' };
const cmd = (label, hint = '') => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label, hint, icon: 'plus', action() {} });

beforeEach(() => {
  globalThis.VexSmartSearch = VexSmartSearch;
  globalThis.VexI18nUI = { TABLE: { tr: TABLE } };
  VexSmartSearch._wordCache.clear(); VexSmartSearch._rev = null;
});
afterEach(() => { delete globalThis.VexSmartSearch; delete globalThis.VexI18nUI; delete globalThis.VexFeatures; delete globalThis.Toolbox; });

describe('commands', () => {
  it('the tiers that were there still decide an exact name and the start of a name', () => {
    const c = cmd('Check for Updates', 'See whether a newer Vex is out');
    expect(CommandBar._scoreCommand('check for updates', c)).toBe(100);
    expect(CommandBar._scoreCommand('check', c)).toBe(100);
    expect(CommandBar._scoreCommand('updates', c)).toBe(85);
  });
  it('a Turkish word finds the English-named command, and the Turkish name of a command is found by its English words', () => {
    const c = cmd('Check for Updates', '');
    expect(CommandBar._scoreCommand('güncelleme', c)).toBeGreaterThan(55);
    expect(CommandBar._scoreCommand('guncellemeleri denetle', c)).toBeGreaterThan(55);
    const d = cmd('Dark Mode');
    expect(CommandBar._scoreCommand('karanlık mod', d)).toBeGreaterThan(55);
    expect(CommandBar._scoreCommand('yer imleri', cmd('Bookmarks'))).toBeGreaterThan(55);
  });
  it('a synonym, a plural and a slip of the keys find it, below an exact name', () => {
    const c = cmd('Check for Updates');
    const exact = CommandBar._scoreCommand('check', c);
    for (const q of ['upgrade', 'updating', 'chek updates']) {
      const s = CommandBar._scoreCommand(q, c);
      expect(s).toBeGreaterThan(36);
      expect(s).toBeLessThan(exact);
    }
    expect(CommandBar._scoreCommand('bookmrks', cmd('Bookmarks'))).toBeGreaterThan(36);
  });
  it('every word must be found: a command that lacks one is not offered for it', () => {
    expect(CommandBar._scoreCommand('dark downloads', cmd('Dark Mode'))).toBe(0);
    expect(CommandBar._scoreCommand('xyzzyq', cmd('Dark Mode', 'turns it dark'))).toBe(0);
  });
  it('without the module the scoring is what it was', () => {
    delete globalThis.VexSmartSearch;
    const c = cmd('Check for Updates');
    expect(CommandBar._scoreCommand('güncelleme', c)).toBe(0);
    expect(CommandBar._scoreCommand('check', c)).toBe(100);
  });
});

describe('tools and features', () => {
  it('a tool is found by the other language\'s word for what it does', () => {
    const tool = { id: 'compress', name: 'Image Compressor', desc: 'Make a picture smaller', keywords: ['resim', 'küçült'], family: 'media' };
    globalThis.Toolbox = {
      all: () => [tool], _matches: () => false, iconMarkup: () => '', _familyLabel: () => 'Media', openTool() {},
    };
    const r = CommandBar._toolResults('küçültme', true);
    expect(r.length).toBe(1);
    expect(r[0].score).toBeGreaterThan(40);
  });
  it('a tool whose keywords are one string, not a list, is searched without failing (the real app threw "join is not a function" and dropped every tool result)', () => {
    const tool = { id: 'x', name: 'Image Compressor', desc: 'Make a picture smaller', keywords: 'resim küçült', family: 'media' };
    globalThis.Toolbox = { all: () => [tool], _matches: () => false, iconMarkup: () => '', _familyLabel: () => 'Media', openTool() {} };
    expect(() => CommandBar._toolResults('küçültme', true)).not.toThrow();
    expect(CommandBar._toolResults('küçültme', true).length).toBe(1);
  });
  it('one word typed searches the features under its synonyms too', () => {
    const seen = [];
    const features = { update: { id: 'update', name: 'Updates', phrases: 'update', what: 'Vex updates itself.' }, other: { id: 'other', name: 'Other', phrases: 'other', what: '' } };
    globalThis.VexFeatures = {
      search: (q) => { seen.push(q); return q === 'update' ? [features.update] : []; },
      nameOf: (f) => f.name, iconOf: () => 'refresh',
    };
    const out = CommandBar._featureResults('güncelleme', []);
    expect(seen).toContain('güncelleme');
    expect(seen).toContain('update');
    expect(out.map(r => r.id)).toEqual(['feature:update']);
  });
});

describe('speed', () => {
  it('scores two thousand commands for one query in well under a second, with the translations in play', () => {
    const items = [];
    const words = ['open', 'close', 'tab', 'window', 'settings', 'download', 'history', 'bookmark', 'privacy', 'sound', 'page', 'search'];
    for (let i = 0; i < 2000; i++) items.push(cmd(words[i % 12] + ' ' + words[(i * 7) % 12] + ' ' + i, words[(i * 5) % 12] + ' ' + words[(i * 3) % 12]));
    const t0 = performance.now();
    for (const c of items) CommandBar._scoreCommand('privacy setings', c);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
