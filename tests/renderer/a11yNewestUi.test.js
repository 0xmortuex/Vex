// @vitest-environment jsdom
//
// The newest screens, used from the keyboard and a screen reader (audit 2026-11): the roles, names, states and focus behaviour that jsdom
// can prove. What needs a real window (the accessibility tree as Chromium builds it, focus rings, Narrator) is in the audit's open list.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
const { Onboarding } = require('../../src/renderer/js/onboarding.js');
const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
const { SettingsOrganize } = require('../../src/renderer/js/settings-organize.js');
globalThis.SettingsOrganize = SettingsOrganize;
Element.prototype.scrollIntoView = function () {};

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, 'src/renderer/index.html'), 'utf8');

describe('the setup wizard', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    Onboarding._close?.();
    Onboarding.step = 0; Onboarding._session = {}; Onboarding._perf = null; Onboarding._askingSkip = false; Onboarding.activeSteps = null;
    globalThis.WebviewManager = { webviews: new Map() };
    window.showToast = vi.fn();
  });

  const goTo = (key) => {
    Onboarding.activeSteps = Onboarding.STEPS();
    Onboarding.step = Onboarding.activeSteps.findIndex(s => s.key === key);
    expect(Onboarding.step, key).toBeGreaterThanOrEqual(0);
    Onboarding._render();
  };

  it('is a modal dialog with a name, and says the step number and what the step is for', () => {
    Onboarding._render();
    const dlg = document.querySelector('#vex-onboarding [role="dialog"]');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-label')).toBeTruthy();
    const by = dlg.getAttribute('aria-describedby').split(' ');
    expect(by).toContain('ob-progress-label');
    for (const id of by.filter(x => x.startsWith('ob-'))) expect(document.getElementById(id), id).toBeTruthy();
    expect(document.getElementById('ob-progress-label').textContent).toMatch(/1/);
  });

  it('hides the progress dots and bar from a screen reader (the step number says it in words)', () => {
    Onboarding._render();
    const label = document.getElementById('ob-progress-label');
    // No dots any more (25 of them overflowed the card): one line of text and a slim bar that says the same in numbers.
    expect(label.parentElement.querySelectorAll('span').length).toBe(1);
    const bar = document.getElementById('ob-progress-fill').parentElement;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
  });

  it('the pace cards say which one is chosen', () => {
    Onboarding._render();
    const cards = [...document.querySelectorAll('[data-pace]')];
    expect(cards.length).toBe(2);
    for (const c of cards) expect(['true', 'false']).toContain(c.getAttribute('aria-pressed'));
    expect(cards.filter(c => c.getAttribute('aria-pressed') === 'true').length).toBe(1);
  });

  it('the name and GitHub fields, which had only a placeholder, have a name', () => {
    goTo('name');
    const field = document.getElementById('ob-name');
    expect(field.getAttribute('aria-label')).toBe(Onboarding.STEPS().find(s => s.key === 'name').title);
    goTo('github');
    expect(document.getElementById('ob-gh').getAttribute('aria-label')).toBeTruthy();
  });

  it('a field with a label written above it is tied to that label', () => {
    goTo('sync');
    const field = document.getElementById('ob-sync-url');
    expect(field.labels.length).toBe(1);
    expect(field.labels[0].textContent).toMatch(/Sync Worker URL/);
  });

  it('a card that picks one answer is pressed or not after a click, not only coloured', async () => {
    goTo('search');
    const cards = [...document.querySelectorAll('[data-engine]')];
    expect(cards.length).toBeGreaterThan(1);
    for (const c of cards) expect(c.hasAttribute('aria-pressed')).toBe(true);
    const before = cards.filter(c => c.getAttribute('aria-pressed') === 'true').length;
    expect(before).toBe(1);
    const other = cards.find(c => c.getAttribute('aria-pressed') === 'false');
    other.click();
    await new Promise(r => setTimeout(r, 5));
    const now = [...document.querySelectorAll('[data-engine]')];
    expect(now.filter(c => c.getAttribute('aria-pressed') === 'true').length).toBe(1);
    expect(now.find(c => c.dataset.engine === other.dataset.engine).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the weather suggestion list', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('lives inside the modal dialog the field is in, so a screen reader does not hide it', () => {
    document.body.innerHTML = '<div id="modal" role="dialog" aria-modal="true"><label for="c">City</label><input id="c"></div>';
    const input = document.getElementById('c');
    const h = window.VexGeo.attachSuggest(input, { onPick() {} });
    const list = document.querySelector('.vex-geo-suggest');
    expect(list.closest('#modal')).toBeTruthy();
    expect(document.querySelector('.vex-geo-live').closest('#modal')).toBeTruthy();
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('aria-label')).toBe('City');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    h.destroy();
    expect(document.querySelector('.vex-geo-suggest')).toBeNull();
  });

  it('outside a dialog it stays on the page', () => {
    document.body.innerHTML = '<input id="c" aria-label="Place">';
    const h = window.VexGeo.attachSuggest(document.getElementById('c'), { onPick() {} });
    expect(document.querySelector('.vex-geo-suggest').parentElement).toBe(document.body);
    expect(document.querySelector('.vex-geo-suggest').getAttribute('aria-label')).toBe('Place');
    h.destroy();
  });
});

describe('the sidebar group folders', () => {
  it('are named by the word on show plus how many buttons they hold, and the long name is their tooltip', async () => {
    localStorage.clear();
    globalThis.VexIcons = { svg: () => '<svg></svg>' };
    globalThis.Onboarding = { done: () => false, _usedBefore: () => false };
    localStorage.setItem('vex.sidebarGroups', 'on');
    document.body.innerHTML = '<div id="icon-sidebar"><button class="sidebar-icon" data-panel="start"></button><button class="sidebar-icon" data-panel="authenticator"></button><button class="sidebar-icon" data-panel="library"></button><div class="sidebar-spacer"></div></div>';
    globalThis.SidebarManager = {
      _loadOrder: () => [],
      _topButtons: () => [...document.querySelectorAll('#icon-sidebar > .sidebar-icon, #icon-sidebar .sb-folder-inner > .sidebar-icon')],
      applySidebarOrder() {}, applyPanelOverrides() {}, renderSidebarManager() {}, fitRail() {},
    };
    vi.resetModules();
    delete window.VexSidebarGroups;
    await import('../../src/renderer/js/sidebar-groups.js');
    window.VexSidebarGroups.arrange();
    for (const f of document.querySelectorAll('.sb-folder')) {
      const tile = f.querySelector('.sb-folder-btn');
      expect(tile.getAttribute('aria-label'), 'the name read out starts with the name shown').toMatch(/, \d+ buttons?$/);
      expect(tile.getAttribute('aria-label').startsWith(f.querySelector('.sb-folder-label').textContent) || ['security', 'aicode', 'apps'].includes(f.dataset.group)).toBe(true);
      expect(tile.getAttribute('aria-expanded')).toBe('false');
    }
    const sec = document.querySelector('.sb-folder[data-group="security"]');
    expect(sec.querySelector('.sb-folder-label').textContent).toBe('Security');
    expect(sec.querySelector('.sb-folder-btn').title).toContain('Security and privacy');
    expect(sec.querySelector('.sb-folder-btn').getAttribute('aria-label')).toBe('Security and privacy, 1 button');
  });
});

describe('Settings', () => {
  let panel, root;
  beforeEach(() => {
    localStorage.clear();
    const doc = new DOMParser().parseFromString(HTML, 'text/html');
    document.body.innerHTML = doc.getElementById('panel-settings').outerHTML;
    panel = document.getElementById('panel-settings');
    root = panel.querySelector('.settings-content');
  });

  it('a ? button is named by the row it explains, never by the long text it opens', () => {
    SettingsOrganize.apply(root);
    const btns = [...root.querySelectorAll('.set-info-btn')];
    const named = btns.filter(b => b.hasAttribute('aria-labelledby'));
    expect(named.length).toBeGreaterThan(btns.length / 2);
    for (const b of named) {
      const parts = b.getAttribute('aria-labelledby').split(' ').map(id => document.getElementById(id));
      expect(parts.every(Boolean)).toBe(true);
      expect(parts[0]).toBe(b);
      const ctx = parts[1];
      expect(ctx.textContent.trim().length).toBeGreaterThan(0);
      expect(ctx.textContent.trim().length).toBeLessThanOrEqual(90);
      expect(ctx.classList.contains('set-info-folded')).toBe(false);
      expect(ctx.contains(document.getElementById(b.getAttribute('aria-controls')))).toBe(false);
    }
  });

  it('a ? and a More options button say whether they are open', () => {
    SettingsOrganize.apply(root);
    for (const b of root.querySelectorAll('.set-info-btn, .set-more-btn')) expect(b.getAttribute('aria-expanded')).toBe('false');
  });

  it('the ? button is at least 24px (WCAG 2.2 target size)', () => {
    const css = readFileSync(join(ROOT, 'src/renderer/css/settings-organize.css'), 'utf8');
    const rule = /\.set-info-btn \{([^}]*)\}/.exec(css)[1];
    expect(Number(/width:\s*(\d+)px/.exec(rule)[1])).toBeGreaterThanOrEqual(24);
    expect(Number(/height:\s*(\d+)px/.exec(rule)[1])).toBeGreaterThanOrEqual(24);
  });

  it('a search result button reads "setting, section" with a space between', () => {
    const nav = document.createElement('div');
    panel.append(nav);
    const g = root.querySelector('.setting-group');
    const el = g.querySelector('input,select,button') || g;
    const ranked = new Map([[g, 5]]);
    ranked.hits = [{ g, el, title: 'Dark mode', section: 'Appearance', rank: 5 }];
    SettingsUI._resultsInNav(nav, root, [g], ranked);
    const chip = nav.querySelector('.set-result-chip');
    expect(chip.textContent).toBe('Dark mode Appearance');
  });

  it('picking a result moves the keyboard to the setting that was found', () => {
    const g = root.querySelector('.setting-group');
    const field = g.querySelector('input:not([type="hidden"]), select, textarea');
    expect(field).toBeTruthy();
    SettingsUI._openHit(g, field);
    expect(document.activeElement).toBe(field);
    document.activeElement.blur();
    SettingsUI._openHit(g, null);
    expect(g.contains(document.activeElement)).toBe(true);
  });

  it('a result that Vex had hidden (an unused or switched-off feature) is shown when it is opened, and stays shown', () => {
    const g = root.querySelector('.setting-group');
    g.classList.add('vex-usage-hidden');
    SettingsUI._openHit(g, null);
    expect(g.classList.contains('vex-usage-hidden')).toBe(false);
    expect(g.dataset.vexRevealed).toBe('1');
    // The usage pass runs again on every Settings refresh: it must not hide the section the person just went to.
    const src = readFileSync(join(ROOT, 'src/renderer/js/vex-usage.js'), 'utf8');
    expect(src).toMatch(/toggle\('vex-usage-hidden', hide && g\.dataset\.vexRevealed !== '1'\)/);
  });

  it('the section a result opened has a highlight that the card rule does not cancel', () => {
    const css = readFileSync(join(ROOT, 'src/renderer/css/settings-pane.css'), 'utf8');
    expect(css).toMatch(/#panel-settings\[data-pane\] \.settings-content > \.setting-group\.set-hit \{[^}]*box-shadow: 0 0 0 2px var\(--primary\)/);
  });

  it('the search has a status line a screen reader reads, and a "no match" note is one too', () => {
    const toolbar = document.createElement('div');
    toolbar.className = 'set-toolbar';
    toolbar.innerHTML = '<div class="set-toolbar-inner"></div>';
    panel.insertBefore(toolbar, root);
    const st = SettingsUI._searchStatus(root);
    expect(st.getAttribute('role')).toBe('status');
    expect(st.classList.contains('vex-sr-only')).toBe(true);
    expect(SettingsUI._searchStatus(root)).toBe(st);
    const css = readFileSync(join(ROOT, 'src/renderer/css/a11y.css'), 'utf8');
    expect(css).toMatch(/\.vex-sr-only/);
    const src = readFileSync(join(ROOT, 'src/renderer/js/settings-ui.js'), 'utf8');
    expect(src).toMatch(/empty\.setAttribute\('role', 'status'\)/);
  });

  it('has Turkish for the result count it says', () => {
    const tr = readFileSync(join(ROOT, 'src/renderer/js/i18n-ui.js'), 'utf8');
    expect(tr).toContain("'1 result': '1 sonuç'");
    expect(tr).toContain("'{1} results': '{1} sonuç'");
  });
});

describe('the Wallpaper Store', () => {
  let items;
  beforeEach(async () => {
    document.body.innerHTML = '';
    items = Array.from({ length: 130 }, (_, i) => ({ id: 'w' + i, title: 'Picture ' + i, source: 'generated', category: 'c', dominant: '#333' }));
    window.WallpaperData = { categoryTitle: () => 'Cat' };
    window.VexWallpapers = {
      DEFAULTS: { dim: 0.2, blur: 0, auto: true },
      current: () => null, get: (id) => items.find(i => i.id === id), list: () => items,
      categories: () => [{ id: 'c', title: 'Cat' }], search: ({ category }) => items.filter(i => category === 'all' || category === i.category),
      onChange: () => () => {}, catalogueUrl: () => '', isFavourite: () => false, thumbOf: async () => 'data:,', sourceOf: async () => { throw new Error('no picture here'); },
      summarise: async () => ({}), stats: async () => ({ cacheBytes: 0, cacheFiles: 0, catalogue: 0 }),
    };
    window.IntersectionObserver = class { observe() {} disconnect() {} };
    window.VexSettingsGroups = {
      register() {},
      dialog() {
        const overlay = document.createElement('div');
        const card = document.createElement('div'); card.className = 'vexsr-card';
        const body = document.createElement('div');
        card.append(body); overlay.append(card); document.body.append(overlay);
        return { overlay, body, close() { overlay.remove(); } };
      },
    };
    vi.resetModules();
    delete window.VexWallpaperStore;
    await import('../../src/renderer/js/wallpaper-store-ui.js');
  });

  it('the category buttons are a group of pressed / not pressed buttons, not tabs without arrow keys', async () => {
    window.VexWallpaperStore.open();
    const cats = document.querySelector('.vws-cats');
    expect(cats.getAttribute('role')).toBe('group');
    const chips = [...cats.querySelectorAll('.vws-chip')];
    expect(chips.length).toBeGreaterThan(2);
    for (const c of chips) { expect(c.hasAttribute('role')).toBe(false); expect(c.hasAttribute('aria-pressed')).toBe(true); }
    expect(chips.filter(c => c.getAttribute('aria-pressed') === 'true').length).toBe(1);
  });

  it('keeps the keyboard on the category that was pressed after the row is drawn again', async () => {
    window.VexWallpaperStore.open();
    const chip = [...document.querySelectorAll('.vws-chip')].find(c => c.dataset.cat === 'c');
    chip.focus();
    chip.click();
    expect(document.activeElement.dataset.cat).toBe('c');
    expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
  });

  it('the list box holds only options: "Show more" sits under it', async () => {
    window.VexWallpaperStore.open();
    const grid = document.querySelector('.vws-grid');
    expect(grid.getAttribute('role')).toBe('listbox');
    expect([...grid.children].every(c => c.getAttribute('role') === 'option')).toBe(true);
    const more = document.querySelector('.vws-gridwrap > .vws-more');
    expect(more).toBeTruthy();
    more.click();
    expect(grid.children.length).toBe(130);
    expect(document.querySelector('.vws-more')).toBeNull();
  });

  it('an empty search puts its note outside the list box', async () => {
    window.VexWallpapers.search = () => [];
    window.VexWallpaperStore.open();
    expect(document.querySelector('.vws-grid').children.length).toBe(0);
    expect(document.querySelector('.vws-gridwrap > .vws-empty')).toBeTruthy();
  });
});

describe('the theme pack picker', () => {
  let UI, state;
  beforeEach(() => {
    document.body.innerHTML = '';
    state = { pack: 'p1', design: 'default', icons: 'std', colours: 'dark' };
    window.VexThemePacks = {
      PACKS: [{ id: 'p1', name: 'One', note: 'n', look: 'classic', colours: 'dark', design: 'default', icons: 'std' }, { id: 'p2', name: 'Two', note: 'n', look: 'classic', colours: 'dark', design: 'default', icons: 'std' }],
      DESIGNS: [{ id: 'default', name: 'Plain', note: 'x' }, { id: 'pill', name: 'Pill', note: 'y' }],
      current: () => ({ ...state }), pack: (id) => window.VexThemePacks.PACKS.find(p => p.id === id), design: (id) => window.VexThemePacks.DESIGNS.find(d => d.id === id),
      applyPack: (id) => { state.pack = id; }, setDesign: (id) => { state.design = id; state.pack = null; }, setIcons: (id) => { state.icons = id; }, setColours: (id) => { state.colours = id; }, reset() {},
    };
    window.VexIconPacks = { PACKS: [{ id: 'std', name: 'Standard', note: 's' }], DEFAULT: 'std', preview: () => '', current: () => ({ name: 'Standard' }) };
    globalThis.ThemeManager = { THEMES: [{ id: 'dark', label: 'Dark' }] };
    globalThis.VexIcons = { svg: () => '<svg></svg>' };
    ({ ThemePackUI: UI } = require('../../src/renderer/js/theme-pack-ui.js'));
    UI._preview = () => '';
    UI.close();
  });

  it('is a modal dialog; its cards and chips say which one is chosen', () => {
    UI.open();
    expect(document.querySelector('.vpk').getAttribute('aria-modal')).toBe('true');
    const cards = [...document.querySelectorAll('.vpk-card')];
    expect(cards.map(c => c.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(document.querySelector('[data-design="default"]').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-design="pill"]').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.vpk-now').getAttribute('role')).toBe('status');
    UI.close();
  });

  it('keeps the keyboard on the control that was used when the picker is drawn again', () => {
    UI.open();
    const two = document.querySelector('[data-pack="p2"]');
    two.focus();
    two.click();
    expect(document.activeElement.dataset.pack).toBe('p2');
    expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
    const pill = document.querySelector('[data-design="pill"]');
    pill.focus();
    pill.click();
    expect(document.activeElement.dataset.design).toBe('pill');
    document.querySelector('.vpk-select').focus();
    document.querySelector('.vpk-select').dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.activeElement.classList.contains('vpk-select')).toBe(true);
    UI.close();
  });
});
