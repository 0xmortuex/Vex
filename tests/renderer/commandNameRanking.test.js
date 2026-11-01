// @vitest-environment jsdom
//
// Ctrl+K ranking, 2026-11-01 (owner: "why is Ayarlar not at the top"): with the Turkish window, "ayar" listed five other things above the Settings
// command, because its label is English ("Settings") and only the loose synonym tier knew "ayar" meant it. A command named what was typed, in either
// language, now comes first: exact name > name starts with it > a word of the name starts with it > the rest; history only settles ties.
// Uses the real command list (CommandBar.commands) and the real Turkish table.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const { VexTrLemma } = require('../../src/renderer/js/turkish-lemma.js');
globalThis.VexTr = VexTr;
globalThis.VexTrLemma = VexTrLemma;
const { VexSmartSearch } = require('../../src/renderer/js/smart-search.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { CommandBar } = require('../../src/renderer/js/command.js');

const TR = VexI18nUI.TABLE.tr;
const order = (q) => CommandBar._rankCommands(q, true).map(e => e.c.id);
const labelOf = (id) => CommandBar.commands.find(c => c.id === id).label;

beforeEach(() => {
  globalThis.VexSmartSearch = VexSmartSearch;
  globalThis.VexI18nUI = VexI18nUI;
  VexSmartSearch._wordCache.clear(); VexSmartSearch._rev = null;
  localStorage.clear();
});
afterEach(() => { delete globalThis.VexSmartSearch; delete globalThis.VexI18nUI; });

describe('the command named what you typed is first, in either language', () => {
  // [query, the command that is named so]
  const cases = [
    ['ayar', 'settings'], ['ayarlar', 'settings'], ['settings', 'settings'], ['set', 'settings'],
    ['indir', 'downloads'], ['indirilenler', 'downloads'], ['downloads', 'downloads'],
    ['gecmis', 'history'], ['geçmiş', 'history'], ['history', 'history'],
    ['yer imi', 'bookmarks'], ['bookmarks', 'bookmarks'],
    ['not', 'notes'], ['notes', 'notes'], ['notlar', 'notes'],
  ];
  for (const [q, id] of cases) {
    it(`"${q}" lists ${id} first`, () => {
      const real = CommandBar.commands.find(c => c.id === id);
      // The test is about the real list; if a command is renamed the case must be revisited, not skipped.
      expect(real, id).toBeTruthy();
      const got = order(q);
      expect(got[0], `${q} -> ${got.slice(0, 5).map(labelOf).join(' | ')}`).toBe(id);
    });
  }

  it('"tema" and "theme" list a command with the word in its name first', () => {
    for (const q of ['tema', 'theme']) {
      const got = order(q);
      expect(CommandBar.commands.find(c => c.id === got[0]).label, q + ' -> ' + got.slice(0, 5).map(labelOf).join(' | ')).toMatch(/Theme/);
    }
  });

  it('the Settings command beats a command with "settings" later in its name', () => {
    const got = order('ayar');
    expect(got.indexOf('settings')).toBe(0);
  });
});

describe('tiers', () => {
  const mk = (id, label) => ({ id, label, hint: '', icon: 'plus', action() {} });
  it('an exact name beats a longer name that starts with it, and a start beats a later word', () => {
    CommandBar.commands.push(mk('zz-a', 'Wombat'), mk('zz-b', 'Wombat Tools'), mk('zz-c', 'Big Wombat'));
    try {
      expect(order('wombat').slice(0, 3)).toEqual(['zz-a', 'zz-b', 'zz-c']);
    } finally { CommandBar.commands.splice(-3, 3); }
  });

  it('history settles a tie inside a tier but never lifts a command over a better tier', () => {
    CommandBar.commands.push(mk('zz-d', 'Wombat Tools'), mk('zz-e', 'Big Wombat Zone'));
    try {
      localStorage.setItem(CommandBar.USAGE_KEY, JSON.stringify({ 'zz-e': { n: 50, at: Date.now() } }));
      expect(order('wombat').slice(0, 2)).toEqual(['zz-d', 'zz-e']);
    } finally { CommandBar.commands.splice(-2, 2); }
  });

  it('a used command in the same tier wins a tie of equal names', () => {
    CommandBar.commands.push(mk('zz-g', 'Wombat Aaaa'), mk('zz-h', 'Wombat Bbbb'));
    try {
      localStorage.setItem(CommandBar.USAGE_KEY, JSON.stringify({ 'zz-h': { n: 3, at: Date.now() } }));
      expect(order('wombat').slice(0, 2)).toEqual(['zz-h', 'zz-g']);
    } finally { CommandBar.commands.splice(-2, 2); }
  });
});

describe('"Why this order" is translated', () => {
  const settings = () => CommandBar.commands.find(c => c.id === 'settings');
  it('English stays as it was', () => {
    expect(CommandBar._whyOrder(settings(), 'ayar')).toBe('Why this order: its name starts with what you typed');
    expect(CommandBar._whyOrder(settings(), 'settings')).toBe('Why this order: its name is what you typed');
  });
  it('is Turkish in the Turkish window, every piece', () => {
    localStorage.setItem('vex.lang', 'tr');
    expect(VexI18nUI.locale()).toBe('tr');
    const now = Date.now();
    localStorage.setItem(CommandBar.USAGE_KEY, JSON.stringify({ settings: { n: 3, at: now } }));
    const why = CommandBar._whyOrder(settings(), 'ayarlar', now);
    expect(why).toBe('Bu sıranın nedeni: adı tam olarak yazdığınız şey; 3 kez kullanıldı, son kullanım bugün (4 ekliyor)');
    expect(why).not.toMatch(/Why this order|typed|used/);
    expect(CommandBar._whyOrder({ id: 'x', label: 'x' }, 'a')).toBe('');
    const stray = CommandBar._whyOrder(CommandBar.commands.find(c => c.id === 'history'), 'zzzz');
    expect(stray).toBe('Bu sıranın nedeni: addan değil, bir kısayol sözcüğünden ya da başka bir listeden geldi');
  });
});
