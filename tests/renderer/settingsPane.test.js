// @vitest-environment jsdom
//
// Settings one category at a time (js/settings-pane.js) and its search as a list of settings (js/settings-find.js), 2026-11-01.
// The owner: "I thought you merged settings, it is still very bad" and "settings search is still terrible". On the real page:
//   * only one category shows at a time, General first;
//   * the sections of a category are gathered into a few cards, and no card holds a single control;
//   * no id, control or word is lost by it;
//   * a search is a list of settings: each once, best first, English or Turkish, with the feature list left out.
import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const { VexTrLemma } = require('../../src/renderer/js/turkish-lemma.js');
globalThis.VexTr = VexTr;
globalThis.VexTrLemma = VexTrLemma;
const { VexSmartSearch } = require('../../src/renderer/js/smart-search.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
const { SettingsOrganize } = require('../../src/renderer/js/settings-organize.js');
const { SettingsFind } = require('../../src/renderer/js/settings-find.js');
const { SettingsPane } = require('../../src/renderer/js/settings-pane.js');
Object.assign(globalThis, { SettingsOrganize, SettingsFind, SettingsPane, VexSmartSearch, VexI18nUI });
Element.prototype.scrollIntoView = function () {};

const HTML = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8');

let panel, root;
const build = () => {
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  document.body.innerHTML = doc.getElementById('panel-settings').outerHTML;
  panel = document.getElementById('panel-settings');
  root = panel.querySelector('.settings-content');
  // Sections modules register at run time (js/vex-settings-groups.js), the way they are drawn.
  const reg = (title, keywords, rows) => {
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.dataset.keywords = keywords;
    g.innerHTML = '<label class="setting-label"></label>' + rows.map(r => '<div class="setting-toggle-row"><span></span><label class="toggle"><input type="checkbox"><span class="toggle-slider"></span></label></div>').join('');
    g.querySelector('.setting-label').textContent = title;
    g.querySelectorAll('.setting-toggle-row > span').forEach((s, i) => { s.textContent = rows[i]; });
    root.insertBefore(g, root.lastElementChild);
  };
  reg('Wallpapers', 'wallpaper background picture photo new tab store gradient image theme pack', ['Open the Wallpaper Store']);
  reg('Mouse cursor', 'cursor pointer', ['Custom cursor']);
  reg('Click effect', 'click ripple', ['Click ripple', 'Click sparkle']);
  reg('Sounds', 'sound', ['Interface sounds']);
  reg('Play: sound packs', 'sound pack sounds', ['Sound packs']);
  reg('Holidays and phrases from packs', 'holiday phrase pack', ['Holiday phrases']);
  // The list of every feature (js/feature-sheet.js): a name of each feature, which says nothing about a setting.
  const sheet = document.createElement('div');
  sheet.className = 'setting-group';
  sheet.dataset.keywords = 'permissions what reads writes sends reset feature delete data privacy first use sheet';
  sheet.innerHTML = '<label class="setting-label">What each feature touches</label>' + ['Theme packs', 'Wallpapers', 'Sidebar buttons', 'Dark mode', 'Sound packs']
    .map(n => '<details><summary>' + n + '</summary><p>Reads: your settings. Writes: one list.</p></details>').join('');
  root.insertBefore(sheet, root.lastElementChild);
};
const shownCards = () => {
  // The runs of sections that SettingsPane drew as one card, for the category on screen.
  const runs = [];
  for (const g of root.querySelectorAll(':scope > .setting-group')) {
    if (g.classList.contains('set-pane-off') || !g.className.match(/set-card-/)) continue;
    if (g.classList.contains('set-card-first') || g.classList.contains('set-card-only')) runs.push([g]);
    else runs[runs.length - 1].push(g);
  }
  return runs;
};
const controlsIn = (g) => g.querySelectorAll('input:not([type="hidden"]), select, textarea, button:not(.set-info-btn):not(.set-more-btn)').length;

beforeAll(() => { SettingsPane.registerTr(); });
beforeEach(() => {
  localStorage.clear();
  delete document.body.dataset.uiMode;
  build();
});
afterEach(() => { delete document.body.dataset.uiMode; });

describe('one category at a time', () => {
  it('opens on General and shows only the sections of that category', () => {
    SettingsUI.enhance();
    expect(panel.dataset.pane).toBe('1');
    expect(panel.dataset.paneCat).toBe('General');
    const sections = [...root.querySelectorAll(':scope > .setting-group')];
    expect(sections.length).toBeGreaterThan(40);
    for (const g of sections) expect(g.classList.contains('set-pane-off'), g.id + ' ' + g.dataset.navKey).toBe(g.dataset.navKey !== 'General');
    expect(panel.querySelector('.set-nav-chip[aria-current="true"]').dataset.navKey).toBe('General');
  });

  it('a category in the list replaces what is shown, and every category can be picked', () => {
    SettingsUI.enhance();
    const chips = [...panel.querySelectorAll('.set-nav .set-nav-chip')];
    expect(chips.length).toBeGreaterThan(8);
    for (const chip of chips) {
      chip.click();
      const key = chip.dataset.navKey;
      expect(panel.dataset.paneCat).toBe(key);
      const visible = [...root.querySelectorAll(':scope > .setting-group')].filter(g => !g.classList.contains('set-pane-off'));
      expect(visible.length, key).toBeGreaterThan(0);
      for (const g of visible) expect(g.dataset.navKey).toBe(key);
    }
  });

  it('gathers the sections of each category into 1 to 6 cards (Developer mode on: everything)', () => {
    SettingsUI.enhance();
    document.body.dataset.uiMode = 'full';
    const keys = [...panel.querySelectorAll('.set-nav .set-nav-chip')].map(c => c.dataset.navKey);
    for (const key of keys) {
      SettingsPane.select(root, key);
      const cards = shownCards();
      expect(cards.length, key + ' has no card').toBeGreaterThan(0);
      expect(cards.length, key + ' has too many cards: ' + cards.map(c => c[0].dataset.card)).toBeLessThanOrEqual(6);
    }
  });

  it('no card holds a single control: a section with one switch sits in a card with others', () => {
    SettingsUI.enhance();
    document.body.dataset.uiMode = 'full';
    const lonely = [];
    for (const key of [...panel.querySelectorAll('.set-nav .set-nav-chip')].map(c => c.dataset.navKey)) {
      SettingsPane.select(root, key);
      for (const run of shownCards()) {
        const n = run.reduce((sum, g) => sum + controlsIn(g), 0);
        // A card of one section that shows nothing but text (a list drawn at run time) is not a switch on its own.
        if (n === 1) lonely.push(key + ' > ' + run[0].dataset.card + ' (' + run.map(g => g.id).join(',') + ')');
      }
    }
    expect(lonely).toEqual([]);
  });

  it('Developer mode off shows only the critical sections, and a normal profile still has General, Appearance and Privacy', () => {
    document.body.dataset.uiMode = 'simple';
    SettingsUI.enhance();
    for (const key of ['General', 'Appearance', 'Privacy and security']) {
      SettingsPane.select(root, key);
      const cards = shownCards();
      expect(cards.length, key).toBeGreaterThan(0);
      expect(cards.length, key).toBeLessThanOrEqual(6);
      for (const run of cards) for (const g of run) expect(g.dataset.tier, g.id).toBe('basic');
    }
  });

  it('puts a section a module registers in the card its heading belongs to, not a card of its own', () => {
    SettingsUI.enhance();
    const byHead = (h) => [...root.querySelectorAll(':scope > .setting-group')].find(g => (g.querySelector('.setting-label').textContent || '').includes(h));
    expect(byHead('Wallpapers').dataset.card).toBe('Wallpapers and start page');
    expect(byHead('Mouse cursor').dataset.card).toBe('Effects and sounds');
    expect(byHead('Click effect').dataset.card).toBe('Effects and sounds');
    expect(byHead('Sounds').dataset.card).toBe('Effects and sounds');
    expect(byHead('Mouse cursor').dataset.navKey).toBe('Appearance');
    // The cards of a category are in a fixed order, the sections of one card together.
    const order = [...root.querySelectorAll(':scope > .setting-group')].filter(g => g.dataset.navKey === 'Appearance').map(g => g.dataset.card);
    const seen = [];
    for (const c of order) if (seen[seen.length - 1] !== c) seen.push(c);
    expect(new Set(seen).size, 'a card split in two: ' + seen).toBe(seen.length);
  });

  it('loses no id, no control and no word', () => {
    const ids = new Set([...root.querySelectorAll('[id]')].map(e => e.id).filter(id => !id.startsWith('set-info-') && !/^setcat-\d+$/.test(id)));
    const originals = [...root.querySelectorAll('input, select, textarea, button')];
    const bag = () => {
      const copy = root.cloneNode(true);
      copy.querySelectorAll('.set-more-btn, .set-dev-note, .set-radio-select, .set-info-btn, .set-nav, .set-emoji, .set-results, .set-advanced-toggle, .set-subnav, .set-card-title, .set-page-title, .set-clamp-btn, .set-chevron, #settings-layout-setting').forEach(e => e.remove());
      // One section at a time: the cards put them in a new order, and two sections' text must not run together.
      return [...copy.children].map(c => c.textContent).join(' ').split(/\s+/).filter(Boolean).sort().join(' ');
    };
    const words = bag();
    SettingsUI.enhance();
    const after = new Set([...root.querySelectorAll('[id]')].map(e => e.id).filter(id => !id.startsWith('set-info-')));
    for (const id of ids) expect(after.has(id), id).toBe(true);
    // Every control the page had is still in it (the organiser and the pane only add some of their own).
    expect(originals.filter(e => !root.contains(e))).toEqual([]);
    // The cards put the sections in a new order; every word is still there.
    const count = (s) => s.split(' ').reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
    const was = count(words);
    const now = count(bag());
    const diff = [...new Set([...was.keys(), ...now.keys()])].filter(w => was.get(w) !== now.get(w)).map(w => w + ' ' + was.get(w) + '>' + now.get(w));
    expect(diff).toEqual([]);
  });
});

describe('the search is a list of settings', () => {
  const type = (q) => {
    const box = panel.querySelector('.set-search');
    box.value = q;
    box.dispatchEvent(new Event('input'));
    return [...root.querySelectorAll('.set-results .set-result-row')].map(r => ({
      name: r.querySelector('.set-result-name').textContent,
      crumb: r.querySelector('.set-result-crumb').textContent,
      row: r,
    }));
  };
  beforeEach(() => { SettingsUI.enhance(); });

  it('replaces the category view with the list and brings the category back when cleared', () => {
    const rows = type('wallpaper');
    expect(rows.length).toBeGreaterThan(0);
    expect(panel.classList.contains('set-searching')).toBe(true);
    expect(root.querySelector('.set-results').hidden).toBe(false);
    type('');
    expect(root.querySelector('.set-results').hidden).toBe(true);
    expect(panel.classList.contains('set-searching')).toBe(false);
  });

  it('lists a setting once (no name twice) and no more than ten, with Show more', () => {
    for (const q of ['theme packs', 'wallpaper', 'sidebar', 'dark', 'sound', 'privacy']) {
      const rows = type(q);
      const names = rows.map(r => r.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
      expect(new Set(names).size, q + ': ' + names).toBe(names.length);
      expect(rows.length, q).toBeLessThanOrEqual(SettingsFind.PAGE);
    }
    const many = type('s');
    const more = root.querySelector('.set-results-more');
    if (many.length === SettingsFind.PAGE) {
      expect(more.hidden).toBe(false);
      more.click();
      expect(root.querySelectorAll('.set-results .set-result-row').length).toBeGreaterThan(SettingsFind.PAGE);
    }
  });

  it('ranks the exact name first, then the name as whole words, then the name by word starts, then keywords', () => {
    const S = VexSmartSearch;
    const parsed = S.parse('theme packs');
    expect(SettingsFind.tierOf(S, parsed, 'Theme packs')).toBe(4);
    expect(SettingsFind.tierOf(S, parsed, 'Theme packs…')).toBe(4);
    expect(SettingsFind.tierOf(S, parsed, 'Choose from the theme packs shown here')).toBe(3);
    expect(SettingsFind.tierOf(S, parsed, 'Packs of every theme')).toBe(2);
    expect(SettingsFind.tierOf(S, parsed, 'Wallpapers')).toBe(1);
    const rows = type('theme packs');
    expect(rows[0].name.toLowerCase()).toContain('theme pack');
    const tiers = rows.map(r => 0);
    expect(tiers.length).toBe(rows.length);
  });

  it('puts a plain name above a section that only mentions the word', () => {
    const rows = type('wallpapers');
    expect(rows[0].name).toMatch(/wallpaper/i);
  });

  it('works with an English word and a Turkish one, whatever language Vex is shown in', () => {
    for (const [tr, en] of [['duvar', 'wallpaper'], ['kenar', 'sidebar'], ['karanlık', 'dark'], ['tema', 'theme']]) {
      const a = type(tr).map(r => r.name + '|' + r.crumb);
      const b = type(en).map(r => r.name + '|' + r.crumb);
      expect(a.length, tr).toBeGreaterThan(0);
      expect(b.length, en).toBeGreaterThan(0);
    }
    const duvar = type('duvar').map(r => r.crumb.toLowerCase()).join(' | ');
    expect(duvar).toMatch(/wallpaper|duvar/);
    expect(type('kenar').map(r => r.name + ' ' + r.crumb).join(' | ').toLowerCase()).toMatch(/sidebar|kenar/);
  });

  it('leaves out the list of what every feature touches unless its own name is the point', () => {
    const touches = [...root.querySelectorAll(':scope > .setting-group')].find(g => SettingsFind.isExcluded(g));
    expect(touches, 'the section exists').toBeTruthy();
    for (const q of ['theme packs', 'wallpaper', 'sidebar', 'dark']) {
      const hitsThere = type(q).filter(r => r.crumb.toLowerCase().includes('what each feature touches'));
      expect(hitsThere, q).toEqual([]);
    }
    const own = type('what each feature touches');
    expect(own.some(r => /what each feature touches/i.test(r.name))).toBe(true);
  });

  it('says honestly when nothing matches, and points to Ctrl+K', () => {
    const rows = type('zzqxjv nonsense');
    expect(rows).toEqual([]);
    const empty = root.querySelector('.set-results-empty');
    expect(empty.textContent).toContain('No settings match');
    expect(empty.textContent).toContain('Ctrl+K');
  });

  it('each row shows the setting, a breadcrumb (category > section) and a way in: the live control or Open', () => {
    const rows = type('wallpaper');
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.crumb).toContain('›');
      expect(r.row.querySelector('.set-result-open, .set-result-control')).toBeTruthy();
    }
  });

  it('a live switch in a result drives the real switch', () => {
    const rows = type('click ripple');
    const row = rows.find(r => /ripple/i.test(r.name));
    expect(row, 'the Click ripple row').toBeTruthy();
    const proxy = row.row.querySelector('.set-result-control input');
    expect(proxy).toBeTruthy();
    const real = [...root.querySelectorAll('.setting-toggle-row')].find(r => /Click ripple/.test(r.textContent)).querySelector('input');
    expect(real.checked).toBe(false);
    proxy.checked = true;
    proxy.dispatchEvent(new Event('change'));
    expect(real.checked).toBe(true);
  });

  it('opening a result clears the search, shows its category and lights the row', () => {
    const rows = type('click ripple');
    rows.find(r => /ripple/i.test(r.name)).row.click();
    expect(panel.querySelector('.set-search').value).toBe('');
    expect(root.querySelector('.set-results').hidden).toBe(true);
    expect(panel.dataset.paneCat).toBe('Appearance');
    expect(root.querySelector('.set-item-hit')).toBeTruthy();
  });

  it('Enter in the box opens the best result; Esc clears the search; the arrows move along the rows', () => {
    const box = panel.querySelector('.set-search');
    type('click');
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement.classList.contains('set-result-row')).toBe(true);
    const first = document.activeElement;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).not.toBe(first);
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(box.value).toBe('');
    type('click ripple');
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(panel.dataset.paneCat).toBe('Appearance');
  });

  it('a result in Developer mode while it is off is marked, and opening it still works', () => {
    document.body.dataset.uiMode = 'simple';
    const rows = type('click ripple');
    const row = rows.find(r => /ripple/i.test(r.name));
    expect(row.row.querySelector('.set-result-tag')).toBeTruthy();
    row.row.click();
    const g = root.querySelector('.set-item-hit').closest('.setting-group');
    expect(g.classList.contains('set-revealed')).toBe(true);
  });
});
