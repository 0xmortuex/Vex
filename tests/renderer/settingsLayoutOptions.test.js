// @vitest-environment jsdom
//
// Settings layout (the owner, 2026-10-12: "give more layout options for the
// settings because of how it looks right now"): columns (automatic, one, two,
// three), the category menu (chips across the top, or a list down the left
// side), and density (comfortable or compact). Per device, never synced,
// applied at once, and Reset to Defaults brings back the layout Settings had.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const css = read('src/renderer/css/settings-redesign.css');

const PANEL = `
  <div class="panel" id="panel-settings">
    <div class="settings-content">
      <h2>Settings</h2>
      <div class="setting-group" id="s-general"><label class="setting-label">General</label></div>
      <div class="setting-group" id="s-appearance"><label class="setting-label">Appearance</label><div id="settings-layout-setting"></div></div>
      <div class="setting-group" id="s-ai"><label class="setting-label">AI Backend</label></div>
      <div class="setting-group" id="s-about"><label class="setting-label">About</label></div>
    </div>
  </div>`;

const setup = ({ panelWidth = 1920, rootWidth = 1868 } = {}) => {
  document.body.innerHTML = PANEL;
  SettingsUI._layoutWatched = null; SettingsUI._sizeObserver = null; SettingsUI._blockObserver = null; SettingsUI._contentObserver = null; SettingsUI._observed = null;
  const panel = document.getElementById('panel-settings');
  const root = panel.querySelector('.settings-content');
  Object.defineProperty(panel, 'clientWidth', { configurable: true, get: () => panelWidth });
  // The list on the left takes 232px of the scroll area.
  Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => (panel.dataset.setNav === 'side' ? rootWidth - 232 : rootWidth) });
  SettingsUI.enhance();
  return { panel, root };
};

beforeEach(() => { localStorage.clear(); });

describe('the choices', () => {
  it('are one full-width column, the list on the left and comfortable until changed (the default since 2026-10-21)', () => {
    expect(SettingsUI.layoutPrefs()).toEqual({ columns: 'wide', nav: 'side', density: 'comfortable' });
  });

  it('keep each saved choice, and ignore one that is not a choice', () => {
    localStorage.setItem('vex.settingsLayout', JSON.stringify({ columns: '3', nav: 'sideways', density: 'compact' }));
    expect(SettingsUI.layoutPrefs()).toEqual({ columns: '3', nav: 'side', density: 'compact' });
  });

  it('refuse a name or value that does not exist, out loud', () => {
    expect(() => SettingsUI.setLayoutPref('rows', '2')).toThrow(/no Settings layout choice/);
    expect(() => SettingsUI.setLayoutPref('columns', '4')).toThrow(/not one of the columns choices/);
    expect(localStorage.getItem('vex.settingsLayout')).toBeNull();
  });

  it('stay on this device: the key is not one sync sends', () => {
    const sync = read('src/renderer/js/sync-engine.js');
    const list = sync.match(/const SYNC_KEYS = \[([\s\S]*?)\];/)[1];
    expect(list).not.toMatch(/settingsLayout/);
  });

  it('go back to the defaults on Reset to Defaults, on screen at once', () => {
    const app = read('src/renderer/js/app.js');
    const keys = app.match(/const SETTINGS_PREF_KEYS = \[([\s\S]*?)\];/)[1];
    expect(keys).toMatch(/'vex\.settingsLayout'/);
    const reset = app.slice(app.indexOf("getElementById('setting-reset')"));
    expect(reset.slice(0, reset.indexOf('saveSettings'))).toMatch(/SettingsUI\.applyLayoutPrefs\(\)/);
  });

  it('put the text size, density and font back on screen at once too, not after a restart', () => {
    const app = read('src/renderer/js/app.js');
    const reset = app.slice(app.indexOf("getElementById('setting-reset')"));
    expect(reset.slice(0, reset.indexOf('saveSettings'))).toMatch(/VexFonts\.reset\(\)/);
    // And that call really does undo what the keys held.
    const { VexFonts } = require('../../src/renderer/js/fonts.js');
    VexFonts.setSize('larger');
    VexFonts.setDensity('cosy');
    expect(document.documentElement.getAttribute('data-vex-scale')).toBe('larger');
    VexFonts.reset();
    expect(document.documentElement.getAttribute('data-vex-scale')).toBeNull();
    expect(document.documentElement.getAttribute('data-vex-density')).toBeNull();
  });
});

describe('columns', () => {
  it('automatic keeps its breakpoints', () => {
    expect(SettingsUI.columnsFor(1228)).toBe(1);
    expect(SettingsUI.columnsFor(1868)).toBe(2);
    expect(SettingsUI.columnsFor(2508)).toBe(3);
    expect(SettingsUI.columnsFor(1868, 'auto')).toBe(2);
  });

  it('one column is one column on any screen', () => {
    expect(SettingsUI.columnsFor(2508, '1')).toBe(1);
  });

  it('three columns on a 1920 screen, maximized or full screen', () => {
    expect(SettingsUI.columnsFor(1868, '3')).toBe(3);
    expect(SettingsUI.columnsFor(1912, '3')).toBe(3);
    expect(SettingsUI.columnsFor(1868 - 232, '3')).toBe(3);   // beside the list on the left
  });

  it('a forced count falls back to fewer when columns would be under 480px', () => {
    const min = SettingsUI.COL_MIN_CHOSEN, gap = SettingsUI.COL_GAP, side = 2 * SettingsUI.COL_SIDE;
    expect(SettingsUI.columnsFor(3 * min + 2 * gap + side, '3')).toBe(3);
    expect(SettingsUI.columnsFor(3 * min + 2 * gap + side - 1, '3')).toBe(2);
    expect(SettingsUI.columnsFor(2 * min + gap + side - 1, '3')).toBe(1);
    expect(SettingsUI.columnsFor(2 * min + gap + side - 1, '2')).toBe(1);
  });
});

describe('Settings › Appearance › Settings layout, and the button beside the search box', () => {
  it('has the three choices in both places, the button next to the search box', () => {
    const { panel } = setup();
    const row = panel.querySelector('.set-search-row');
    expect(row.querySelector('.set-search')).toBeTruthy();
    const btn = row.querySelector('.set-layout-btn');
    expect(btn.getAttribute('aria-label')).toBe('Settings layout');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.querySelector('svg')).toBeTruthy();                  // an icon, no emoji
    const pop = row.querySelector('.set-layout-pop');
    expect(pop.hidden).toBe(true);
    expect([...pop.querySelectorAll('select')].map(s => s.dataset.setLayout)).toEqual(['columns', 'nav', 'density']);
    const host = document.getElementById('settings-layout-setting');
    expect([...host.querySelectorAll('select')].map(s => s.dataset.setLayout)).toEqual(['columns', 'nav', 'density']);
    expect(host.textContent).toMatch(/Settings layout/);
    btn.click();
    expect(pop.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(pop.querySelector('select'));
    pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pop.hidden).toBe(true);
    expect(document.activeElement).toBe(btn);
  });

  it('applies a choice at once, and every box shows it', () => {
    const { panel } = setup();
    const pick = (sel, v) => { sel.value = v; sel.dispatchEvent(new Event('change')); };
    const [cols, nav, dens] = document.getElementById('settings-layout-setting').querySelectorAll('select');
    pick(dens, 'compact');
    expect(panel.dataset.setDensity).toBe('compact');
    expect(panel.querySelector('.set-layout-pop select[data-set-layout="density"]').value).toBe('compact');
    pick(nav, 'side');
    expect(panel.dataset.setNav).toBe('side');
    pick(cols, '3');
    expect(panel.dataset.setCols).toBe('3');
    expect(JSON.parse(localStorage.getItem('vex.settingsLayout'))).toEqual({ columns: '3', nav: 'side', density: 'compact' });
    pick(cols, '1');
    expect(panel.dataset.setCols).toBeUndefined();
    pick(dens, 'comfortable');
    expect(panel.dataset.setDensity).toBeUndefined();
  });

  it('says so when the window is too narrow for the choice', () => {
    const { panel } = setup({ panelWidth: 1400, rootWidth: 1348 });
    SettingsUI.setLayoutPref('columns', '3');
    expect(panel.dataset.setCols).toBe('2');
    const notes = [...panel.querySelectorAll('[data-set-layout-note="columns"]')];
    expect(notes.length).toBe(2);
    for (const n of notes) { expect(n.hidden).toBe(false); expect(n.textContent).toBe('Three columns need a wider window, so Settings shows two.'); }
    SettingsUI.setLayoutPref('columns', 'auto');
    for (const n of notes) expect(n.hidden).toBe(true);
  });

  it('keeps the list on the left only where it fits, and says so', () => {
    const { panel } = setup({ panelWidth: 800, rootWidth: 748 });
    SettingsUI.setLayoutPref('nav', 'side');
    expect(panel.dataset.setNav).toBeUndefined();
    const note = panel.querySelector('#settings-layout-setting [data-set-layout-note="nav"]');
    expect(note.textContent).toBe('This window is too narrow for the list, so the chips are shown.');
    expect(SettingsUI.navFor(SettingsUI.SIDE_MIN, 'side')).toBe('side');
    expect(SettingsUI.navFor(SettingsUI.SIDE_MIN - 1, 'side')).toBe('chips');
    expect(SettingsUI.navFor(3000, 'chips')).toBe('chips');
  });

  it('is in Turkish when Vex is', () => {
    const tr = VexI18nUI.TABLE.tr;
    const english = [
      'Settings layout', 'Settings categories', 'Back to the default layout',
      ...Object.values(SettingsUI.LAYOUT_LABELS).flat(),
      ...Object.values(SettingsUI.LAYOUT_CHOICES).flat().map(([, label]) => label),
      'Three columns need a wider window, so Settings shows two.',
      'Three columns need a wider window, so Settings shows one.',
      'Two columns need a wider window, so Settings shows one.',
      'This window is too narrow for the list, so the chips are shown.',
    ];
    for (const s of english) expect(tr[s], s).toBeTruthy();
  });
});

describe('the list down the left side', () => {
  it('is a navigation landmark, marks the category in view, and moves with the arrow keys', () => {
    const { panel, root } = setup();
    SettingsUI.setLayoutPref('nav', 'side');
    const nav = panel.querySelector('.set-nav');
    expect(nav.getAttribute('role')).toBe('navigation');
    expect(nav.getAttribute('aria-label')).toBe('Settings categories');
    // Rects: About is scrolled to the top, General above it out of view.
    const tops = { 's-general': -400, 's-appearance': -200, 's-ai': -40, 's-about': 300 };
    root.getBoundingClientRect = () => ({ top: 0, bottom: 900, left: 0, right: 1600 });
    for (const el of root.children) {
      el.getClientRects = () => [{}];
      const t = tops[el.id];
      el.getBoundingClientRect = () => (t === undefined ? { top: -900, bottom: -880, left: 0 } : { top: t, bottom: t + 180, left: 0 });
    }
    expect(SettingsUI._markCurrent(root)).toBe('AI');
    const chips = [...nav.querySelectorAll('.set-nav-chip')];
    for (const c of chips) c.getClientRects = () => [{}];
    expect(chips.filter(c => c.getAttribute('aria-current') === 'true').map(c => c.textContent)).toEqual(['AI']);
    chips[0].focus();
    nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(chips[1]);
    nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(chips[chips.length - 1]);
    nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(chips[0]);
  });

  it('is one stop for Tab (the marked entry), not one for every entry; the chips across the top keep theirs', () => {
    const { panel, root } = setup();
    const nav = panel.querySelector('.set-nav');
    const chips = () => [...nav.querySelectorAll('.set-nav-chip')];
    SettingsUI.setLayoutPref('nav', 'chips');
    for (const c of chips()) c.getClientRects = () => [{}];
    SettingsUI._markCurrent(root);
    expect(chips().every(c => !c.hasAttribute('tabindex'))).toBe(true);   // chips: untouched
    SettingsUI.setLayoutPref('nav', 'side');
    for (const c of chips()) c.getClientRects = () => [{}];
    SettingsUI._rove(panel);
    expect(chips().filter(c => c.tabIndex === 0).length).toBe(1);
    expect(chips().filter(c => c.tabIndex === -1).length).toBe(chips().length - 1);
    // An arrow key hands the stop to the entry it moved to.
    chips()[0].focus();
    nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(chips()[1].tabIndex).toBe(0);
    expect(chips().filter(c => c.tabIndex === 0).length).toBe(1);
    // Back to chips: every entry is a stop again.
    SettingsUI.setLayoutPref('nav', 'chips');
    expect(chips().every(c => !c.hasAttribute('tabindex'))).toBe(true);
  });

  it('marks the section the user was taken to, not the one beside it that began higher and runs on (two columns)', () => {
    const { root } = setup();
    root.getBoundingClientRect = () => ({ top: 0, bottom: 900, left: 0, right: 1600 });
    // The line a scrolled-to section starts on: under the toolbar.
    const line = parseFloat(root.style.scrollPaddingTop) || 0;
    const place = (tops) => {
      for (const el of root.children) {
        el.getClientRects = () => [{}];
        const p = tops[el.id];
        el.getBoundingClientRect = () => (p === undefined ? { top: -900, bottom: -880, left: 0 } : { top: line + p[0], bottom: line + p[0] + 400, left: p[1] });
      }
    };
    // General is long and began 300px above; Appearance starts at the top of the other column.
    place({ 's-general': [-300, 0], 's-appearance': [0, 800] });
    expect(SettingsUI._markCurrent(root)).toBe('Appearance');
    // Two start level (the first row): the leftmost, unless a chip asked for the other.
    place({ 's-ai': [0, 0], 's-appearance': [0, 800] });
    expect(SettingsUI._markCurrent(root)).toBe('AI');
    SettingsUI._wanted = { key: 'Appearance', until: Date.now() + 3000 };
    expect(SettingsUI._markCurrent(root)).toBe('Appearance');
    SettingsUI._wanted = null;
  });

  it('puts the toolbar beside the scroll area: no padding for a toolbar over it', () => {
    const { panel, root } = setup();
    SettingsUI._syncPad(root);
    SettingsUI.setLayoutPref('nav', 'side');
    expect(panel.dataset.setNav).toBe('side');
    expect(root.style.paddingTop).toBe('');
    expect(css).toMatch(/#panel-settings\[data-set-nav="side"\] \{ flex-direction: row; \}/);
    expect(css).toMatch(/#panel-settings\[data-set-nav="side"\] \.set-nav-chip\[aria-current="true"\]/);
  });
});

describe('the layout button\'s "Back to the default layout"', () => {
  it('is off while the layout is the default, and puts all three choices back at once', () => {
    const { panel } = setup();
    const btn = panel.querySelector('.set-layout-pop .set-layout-reset');
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    SettingsUI.setLayoutPref('columns', '3');
    SettingsUI.setLayoutPref('nav', 'chips');
    SettingsUI.setLayoutPref('density', 'compact');
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(localStorage.getItem('vex.settingsLayout')).toBeNull();
    expect(SettingsUI.layoutPrefs()).toEqual({ columns: 'wide', nav: 'side', density: 'comfortable' });
    expect(panel.dataset.setNav).toBe('side');
    expect(panel.dataset.setDensity).toBeUndefined();
    expect(btn.disabled).toBe(true);
    for (const sel of panel.querySelectorAll('.set-layout-pop select')) expect(sel.value).toBe(SettingsUI.LAYOUT_DEFAULTS[sel.dataset.setLayout]);
  });
});

describe('a deep link', () => {
  it('works with a search still in the box: the search is cleared, not left hiding the section linked to', () => {
    const { root, panel } = setup();
    const box = panel.querySelector('.set-search');
    box.value = 'zzzzqq';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    const about = document.getElementById('s-about');
    expect(about.style.display).toBe('none');
    const realRaf = globalThis.requestAnimationFrame;
    const realScroll = Element.prototype.scrollIntoView;
    globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
    Element.prototype.scrollIntoView = function () { this.dataset.scrolledTo = '1'; };
    try {
      SettingsUI.openSection('s-about');
    } finally {
      globalThis.requestAnimationFrame = realRaf;
      Element.prototype.scrollIntoView = realScroll;
    }
    expect(box.value).toBe('');
    expect(about.style.display).toBe('');
    expect(about.dataset.scrolledTo).toBe('1');
    expect(root.querySelector('.set-empty').style.display).toBe('none');
  });
});

describe('compact', () => {
  const compact = css.split('\n').filter(l => /data-set-density="compact"/.test(l)).join('\n')
    + css.slice(css.indexOf('#panel-settings[data-set-density="compact"] .settings-content .setting-group {'));
  it('packs tighter without making the text smaller', () => {
    expect(compact).toMatch(/padding/);
    expect(compact).not.toMatch(/font-size/);
  });
  it('gives a 22px switch a 26px hit area', () => {
    expect(css).toMatch(/\[data-set-density="compact"\] \.settings-content \.toggle::after \{[^}]*inset: -2px/);
  });
});

describe('One column, full width', () => {
  it('is a choice, asks for one column whatever the width, and marks the panel wide', () => {
    expect(SettingsUI.LAYOUT_CHOICES.columns.map(([v]) => v)).toContain('wide');
    expect(SettingsUI.columnsFor(2400, 'wide')).toBe(1);
    expect(SettingsUI.columnsFor(900, 'wide')).toBe(1);
    const css = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/css/settings-redesign.css'), 'utf8');
    expect(css).toMatch(/#panel-settings\[data-set-wide\] \.settings-content > \* \{ max-width: none;/);
    // The centred 780px column is the side padding on .settings-content; the wide choice has to replace it.
    expect(css).toMatch(/#panel-settings\[data-set-wide\] \.settings-content \{ padding-left: 32px; padding-right: 32px; \}/);
  });
});
