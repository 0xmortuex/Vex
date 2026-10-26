// @vitest-environment jsdom
//
// Settings search (SettingsUI._filter and friends), 2026-10-26: "update" opened Privacy Hardening before the section about Vex's updates, because the
// search kept the sections in their own order and matched any section that held the word. Now sections are ranked (name, keywords, labels, the rest),
// the best comes first, the list on the left holds the results, and an English word finds a section drawn in Turkish (and the other way round).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const { VexTrLemma } = require('../../src/renderer/js/turkish-lemma.js');
globalThis.VexTr = VexTr;
globalThis.VexTrLemma = VexTrLemma;
const { VexSmartSearch } = require('../../src/renderer/js/smart-search.js');
const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');

const TABLE = { 'Privacy Hardening': 'Gizlilik Sıkılaştırma', 'About Vex': 'Vex Hakkında', 'Downloads': 'İndirilenler', 'Fingerprint protection': 'Parmak izi koruması' };

// A group the way Settings draws it, with the keywords enhance() gives it.
function group(heading, body, { shown, keywords } = {}) {
  const g = document.createElement('div');
  g.className = 'setting-group';
  const label = document.createElement('label');
  label.className = 'setting-label';
  label.textContent = shown || heading;
  if (shown) label.dataset.i18nText = heading;     // what the translator leaves on a heading it translated
  g.appendChild(label);
  const rows = document.createElement('div');
  rows.innerHTML = body;
  g.appendChild(rows);
  g.dataset.keywords = (heading + ' ' + SettingsUI.keywordsFor(heading.toLowerCase()) + ' ' + (keywords || '')).toLowerCase();
  return g;
}
function build(groups) {
  const panel = document.createElement('div');
  const root = document.createElement('div');
  root.className = 'settings-content';
  const nav = document.createElement('div');
  nav.className = 'set-nav';
  const chip = document.createElement('button');
  chip.className = 'set-nav-chip';
  chip.textContent = 'General';
  nav.appendChild(chip);
  panel.appendChild(nav);
  panel.appendChild(root);
  groups.forEach((g, i) => { g.dataset.ord = String(i); root.appendChild(g); });
  document.body.innerHTML = '';
  document.body.appendChild(panel);
  return { panel, root, nav };
}
const heads = (root) => Array.from(root.querySelectorAll('.setting-group')).filter(g => g.style.display !== 'none').map(g => g.querySelector('.setting-label').dataset.i18nText || g.querySelector('.setting-label').textContent);

beforeEach(() => {
  globalThis.VexSmartSearch = VexSmartSearch;
  globalThis.VexI18nUI = { TABLE: { tr: TABLE }, english: (el) => (el.dataset.i18nText != null ? el.dataset.i18nText : el.textContent) };
  VexSmartSearch._wordCache.clear(); VexSmartSearch._rev = null;
  SettingsUI._searchIndex = new WeakMap();
  Element.prototype.scrollIntoView = function () { this.dataset.scrolled = '1'; };
});
afterEach(() => { delete globalThis.VexSmartSearch; delete globalThis.VexI18nUI; });

const sample = () => [
  group('Privacy Hardening', '<div class="setting-toggle-row"><span>Fingerprint protection</span></div><p>Applies to pages you open after toggling. Updates are never sent.</p>'),
  group('Downloads', '<div class="setting-toggle-row"><span>Ask where to save</span></div><p>Where files you download are kept.</p>'),
  group('About Vex', '<div class="setting-toggle-row"><span>Check for updates</span></div><p>Vex updates itself and tells you what it changed.</p>'),
];

describe('ranking', () => {
  it('"update" puts the section about Vex\'s updates first, not the first section that mentions the word', () => {
    const { root } = build(sample());
    SettingsUI._filter(root, 'update');
    expect(heads(root)[0]).toBe('About Vex');
  });
  it('the results are in the order of fit, and sections that do not fit are hidden', () => {
    const { root } = build(sample());
    SettingsUI._filter(root, 'download');
    expect(heads(root)).toEqual(['Downloads']);
  });
  it('the order comes back when the search is cleared', () => {
    const { root } = build(sample());
    SettingsUI._filter(root, 'update');
    SettingsUI._filter(root, '');
    expect(Array.from(root.querySelectorAll('.setting-group')).map(g => g.dataset.ord)).toEqual(['0', '1', '2']);
    expect(heads(root)).toEqual(['Privacy Hardening', 'Downloads', 'About Vex']);
  });
  it('whatever sits between the sections stays where it is', () => {
    const groups = sample();
    const { root } = build(groups);
    const row = document.createElement('div');
    row.className = 'set-subnav';
    root.insertBefore(row, groups[2]);
    const before = Array.from(root.children).indexOf(row);
    SettingsUI._filter(root, 'update');
    expect(Array.from(root.children).indexOf(row)).toBe(before);
    SettingsUI._filter(root, '');
    expect(Array.from(root.children).indexOf(row)).toBe(before);
  });
});

describe('English and Turkish', () => {
  it('an English word finds a section drawn in Turkish, and a Turkish word finds it too', () => {
    const turkish = [
      group('Privacy Hardening', '<div class="setting-toggle-row"><span>Parmak izi koruması</span></div>', { shown: 'Gizlilik Sıkılaştırma' }),
      group('Downloads', '<p>Dosyalarınız burada tutulur.</p>', { shown: 'İndirilenler' }),
      group('About Vex', '<p>Vex kendini günceller.</p>', { shown: 'Vex Hakkında' }),
    ];
    const { root } = build(turkish);
    SettingsUI._filter(root, 'privacy');
    expect(heads(root)).toEqual(['Privacy Hardening']);
    SettingsUI._filter(root, 'gizlilik');
    expect(heads(root)).toEqual(['Privacy Hardening']);
    SettingsUI._filter(root, 'update');
    expect(heads(root)[0]).toBe('About Vex');
    SettingsUI._filter(root, 'güncelleme');
    expect(heads(root)[0]).toBe('About Vex');
    SettingsUI._filter(root, 'indirilenler');
    expect(heads(root)).toEqual(['Downloads']);
    SettingsUI._filter(root, 'fingerprint');
    expect(heads(root)).toEqual(['Privacy Hardening']);
  });
  it('a typing slip and a plural still find it', () => {
    const { root } = build(sample());
    SettingsUI._filter(root, 'privcy');
    expect(heads(root)).toEqual(['Privacy Hardening']);
    SettingsUI._filter(root, 'downloads');
    expect(heads(root)).toEqual(['Downloads']);
  });
  it('a query the search does not understand (an address) still finds the section whose text holds it', () => {
    const groups = sample();
    groups.push(group('Privacy & Security', '<select><option>Cloudflare (1.1.1.1)</option></select>'));
    const { root } = build(groups);
    SettingsUI._filter(root, '1.1.1.1');
    expect(heads(root)).toEqual(['Privacy & Security']);
  });
});

describe('the list on the left', () => {
  it('holds the results, best first, while something is searched for, and the categories come back', () => {
    const { root, nav } = build(sample());
    SettingsUI._filter(root, 'update');
    expect(nav.dataset.results).toBe('1');
    const names = Array.from(nav.querySelectorAll('.set-result-chip')).map(b => b.textContent);
    expect(names[0]).toBe('About Vex');
    expect(nav.style.display).toBe('');
    SettingsUI._filter(root, '');
    expect(nav.dataset.results).toBeUndefined();
    expect(Array.from(nav.children).map(b => b.textContent)).toEqual(['General']);
  });
  it('is empty and hidden when nothing fits, and the empty note says so', () => {
    const { root, nav } = build(sample());
    SettingsUI._filter(root, 'xyzzyq');
    expect(nav.style.display).toBe('none');
    expect(root.querySelector('.set-empty').textContent).toContain('xyzzyq');
  });
  it('a result takes you to its section and marks it for a moment', () => {
    const { root, nav } = build(sample());
    SettingsUI._filter(root, 'update');
    nav.querySelector('.set-result-chip').click();
    const about = Array.from(root.querySelectorAll('.setting-group')).find(g => g.querySelector('.setting-label').textContent === 'About Vex');
    expect(about.dataset.scrolled).toBe('1');
    expect(about.classList.contains('set-hit')).toBe(true);
  });
});
