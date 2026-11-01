// @vitest-environment jsdom
//
// Match Vex to a wallpaper, area by area (js/wallpaper-sync.js): every wallpaper, mixed with a
// theme of the user's own in every combination of the six switches, still reads (text 4.5:1,
// accent 3:1, text on the accent 4.5:1) on the background each area really has; the switches are
// live, saved per wallpaper, and Undo puts back exactly what was worn.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const { CustomThemes } = require(JS + 'theme-custom.js');
globalThis.CustomThemes = window.CustomThemes = CustomThemes;
const { ThemeFromImage } = require(JS + 'theme-from-image.js');
globalThis.ThemeFromImage = window.ThemeFromImage = ThemeFromImage;
require(JS + 'wallpaper-generators.js');
const { WallpaperData } = require(JS + 'wallpaper-data.js');
const { VexWallpaperSync: S } = require(JS + 'wallpaper-sync.js');

const all = WallpaperData.generated();

// Themes of the user's own to mix with: two dark, one light, each readable by itself.
const OWN = {
  oxford: { background: '#14161d', surface: '#1e222c', text: '#e8eaf0', muted: '#a3a9b8', primary: '#7aa2f7', success: '#34d399', warning: '#fbbf24', danger: '#f87171', border: '#343a49' },
  'firefox-dark': { background: '#1c1b22', surface: '#2b2a33', text: '#fbfbfe', muted: '#b5b4be', primary: '#00ddff', success: '#34d399', warning: '#fbbf24', danger: '#f87171', border: '#4a4a55' },
  paper: { background: '#f6f1e7', surface: '#ffffff', text: '#1f1c18', muted: '#5c564c', primary: '#1e3a5f', success: '#0e700e', warning: '#8a5300', danger: '#c42b1c', border: '#d8d0c0' },
};

function fakeThemes() {
  const THEMES = [{ id: 'oxford' }, { id: 'firefox-dark' }, { id: 'paper' }];
  const M = {
    DEFAULT_THEME: 'oxford', THEMES, currentTheme: 'oxford',
    get availableThemes() { return THEMES.map(t => t.id); },
    getCurrentTheme() { return this.currentTheme; },
    applyTheme: vi.fn(function (id) {
      if (!this.availableThemes.includes(id)) throw new Error('unknown theme ' + id);
      this.currentTheme = id;
    }),
  };
  const St = {
    records: () => CustomThemes.list(),
    record: (id) => CustomThemes.list().find(r => r.id === id) || null,
    colorsFromTheme: (id) => ({ ...(OWN[id] || OWN.oxford) }),
    isEditing: () => false,
    _changed: vi.fn(() => {
      for (let i = THEMES.length - 1; i >= 0; i--) if (THEMES[i].user) THEMES.splice(i, 1);
      for (const r of CustomThemes.list()) THEMES.push({ id: r.id, user: true });
    }),
  };
  return { M, St };
}

// What the window really has on <body>: Vex reads it once, before the first switch, so that a part left
// off keeps exactly these values (and so every contrast number is against what is on screen).
const WINDOW = { '--vex-bg-base': '#faf6ee', '--vex-bg-elevated': '#ffffff', '--vex-text-primary': '#1f1c18', '--vex-text-secondary': '#453f36', '--vex-accent': '#1e3a5f', '--vex-hover-fill': 'rgba(31, 28, 24, 0.06)' };
const LOOK = { '--b-page': '#ffffff', '--b-toolbar': '#f9f9fb', '--b-text': '#15141a', '--b-text-dim': '#5b5b66', '--b-accent': '#0061e0', '--b-border': '#cfcfd8', '--b-frame': '#f0f0f4', '--b-tab-active': '#ffffff', '--b-surface-deep': 'color-mix(in srgb, #f9f9fb 94%, #15141a)' };
function windowColours(look) {
  const st = document.body.style;
  st.cssText = '';
  for (const [k, v] of Object.entries(look ? { ...WINDOW, ...LOOK } : WINDOW)) st.setProperty(k, v);
}

let M, gui;
beforeEach(() => {
  localStorage.clear();
  windowColours(false);
  document.head.querySelectorAll('#' + S.STYLE_ID).forEach(n => n.remove());
  ({ M } = (() => { const f = fakeThemes(); window.ThemeManager = globalThis.ThemeManager = f.M; window.ThemeStudio = globalThis.ThemeStudio = f.St; return f; })());
  let colors = 'theme';
  gui = window.VexGuiStyle = { isBrowserLook: () => true, getColors: () => colors, setColors: vi.fn((c) => { colors = c; }) };
  window.VexWallpapers = { get: (id) => all.find(d => d.id === id) || null };
});

const IDS = S.AREA_IDS;
const subsets = [];
for (let m = 0; m < (1 << IDS.length); m++) subsets.push(IDS.filter((_, i) => m & (1 << i)));

// A set of nine colours as an area really draws it: text and muted text 4.5:1, the accent 4.5:1 as
// text and 3:1 as an icon or border, and the text on the accent 4.5:1, on every surface it sits on.
function problems(label, c) {
  const bad = [];
  for (const k of CustomThemes.checks(c)) if (['text', 'muted', 'primary', 'onPrimary'].includes(k.key) && k.ratio < 4.5) bad.push(`${label}: ${k.key} ${k.ratio}`);
  const dv = CustomThemes.derive(c);
  for (const bg of [dv.surfaces.bg, dv.surfaces.surf, dv.surfaces.deep, dv.surfaces.tabActive]) {
    if (CustomThemes.contrast(dv.colors.primary, bg) < 3) bad.push(`${label}: accent on ${bg}`);
    if (CustomThemes.contrast(dv.colors.text, bg) < 4.5) bad.push(`${label}: text on ${bg}`);
  }
  return bad;
}

describe('compose: every wallpaper, every combination of areas, still readable', () => {
  it('the themes of your own are readable by themselves (so the test is fair)', () => {
    for (const [id, c] of Object.entries(OWN)) expect(problems(id, CustomThemes.complete(c))).toEqual([]);
  });

  it('there are 6 areas and 64 combinations', () => {
    expect(IDS).toEqual(['newtab', 'tabs', 'toolbar', 'sidebar', 'accent', 'rest']);
    expect(subsets.length).toBe(64);
  });

  for (const own of Object.keys(OWN)) {
    it(`mixed with ${own}: all 74 wallpapers x all 64 combinations`, () => {
      const bad = [];
      const mine = CustomThemes.complete(OWN[own]);
      for (const d of all) {
        const wpRaw = S.paletteForGenerated(d).colors;
        const wp = CustomThemes.complete(wpRaw);
        for (const set of subsets) {
          const mix = S.compose(OWN[own], wpRaw, set);
          const tag = `${d.id}/${set.join('+') || 'none'}`;
          bad.push(...problems(tag + ' root', mix.root), ...problems(tag + ' newtab', mix.newtab));
          for (const [a, c] of Object.entries(mix.areas)) bad.push(...problems(tag + ' ' + a, c));
          // an area that is off keeps your own colours; one that is on has the wallpaper's
          for (const a of ['tabs', 'toolbar', 'sidebar']) {
            if (Boolean(mix.areas[a]) !== set.includes(a)) bad.push(tag + ' ' + a + ' presence');
            if (mix.areas[a] && mix.areas[a].background !== wp.background) bad.push(tag + ' ' + a + ' background is not the wallpaper\'s');
          }
          const accentOn = set.includes('accent');
          if (set.includes('rest') ? mix.root.background !== wp.background : mix.root.background !== mine.background) bad.push(tag + ' root background');
          if (set.includes('newtab') ? mix.newtab.background !== wp.background : mix.newtab.background !== mine.background) bad.push(tag + ' New Tab background');
          if (!accentOn && !set.includes('rest') && mix.root.primary !== mine.primary) bad.push(tag + ' root accent moved with the accent switch off');
          if (accentOn && set.includes('rest') && mix.root.primary !== wp.primary) bad.push(tag + ' root accent is not the wallpaper\'s');
          // with everything off the window is exactly your theme
          if (!set.length && JSON.stringify(mix.root) !== JSON.stringify(mine)) bad.push(tag + ' root changed with nothing on');
        }
      }
      expect(bad).toEqual([]);
    }, 240000);
  }

  it('a photo palette mixes the same way', () => {
    const wp = CustomThemes.fixContrast(CustomThemes.complete({ background: '#2a1f3d', surface: '#3a2d52', text: '#f4efff', muted: '#c4b8dd', primary: '#c78bff', success: '#34d399', warning: '#fbbf24', danger: '#f87171', border: '#4e3f6c' })).colors;
    for (const set of subsets) {
      const mix = S.compose(OWN.paper, wp, set);
      expect(problems('photo/' + set.join('+'), mix.root)).toEqual([]);
      for (const c of Object.values(mix.areas)) expect(problems('photo-area', c)).toEqual([]);
    }
  });

  it('refuses an area that does not exist', () => {
    expect(() => S.compose(OWN.oxford, OWN.paper, ['tabs', 'footer'])).toThrow(/Not an area/);
  });
});

describe('switches: live, saved per wallpaper, undone exactly (a look that wears the theme\'s colours)', () => {
  const style = () => document.getElementById(S.STYLE_ID);
  const wpOf = (id) => CustomThemes.complete(S.paletteForGenerated(all.find(d => d.id === id)).colors);

  it('nothing is on for a wallpaper that was never matched, and nothing changes by itself', () => {
    expect(S.areasFor('aurora-borealis')).toEqual([]);
    expect(S.state()).toBeNull();
    expect(CustomThemes.list()).toEqual([]);
    expect(style()).toBeNull();
  });

  it('the first switch applies at once: only that area is painted, the theme itself is not touched', async () => {
    await S.setAreas('aurora-borealis', ['tabs']);
    expect(S.areasFor('aurora-borealis')).toEqual(['tabs']);
    expect(M.applyTheme).not.toHaveBeenCalled();
    expect(M.getCurrentTheme()).toBe('oxford');
    expect(CustomThemes.list()).toEqual([]);
    expect(S.state()).toMatchObject({ rooted: false, lookMode: false, prevTheme: 'oxford' });
    const css = style().textContent;
    expect(css).toContain('html body #top-tab-bar');
    expect(css).toContain('#tabs-sidebar');
    expect(css).not.toContain('#top-bar');
    expect(css).not.toContain('#icon-sidebar');
    expect(css).toContain('--vex-bg-base: ' + wpOf('aurora-borealis').background);
    expect(css).not.toContain('--vex-bg-base: ' + CustomThemes.complete(OWN.oxford).background);
    // an area is matched with its own text colour: it never borrows the one of the window around it
    expect(css).toMatch(/color: var\(--vex-text-primary\);/);
    expect(gui.setColors).not.toHaveBeenCalled();
  });

  it('each further switch is live: toolbar and sidebar join, and one turned off leaves again', async () => {
    await S.setAreas('aurora-borealis', ['tabs']);
    await S.setAreas('aurora-borealis', ['tabs', 'toolbar', 'sidebar']);
    let css = style().textContent;
    expect(css).toContain('#top-bar');
    expect(css).toContain('#panels-container');
    await S.setAreas('aurora-borealis', ['toolbar']);
    css = style().textContent;
    expect(css).toContain('#top-bar');
    expect(css).not.toContain('#top-tab-bar');
    expect(S.state().areas).toEqual(['toolbar']);
  });

  it('Everything else is the theme itself; the areas that are off keep exactly what they had', async () => {
    await S.setAreas('aurora-borealis', ['rest']);
    const wp = wpOf('aurora-borealis');
    const rec = CustomThemes.list()[0];
    expect(rec.colors.background).toBe(wp.background);
    expect(rec.colors.primary).not.toBe(wp.primary);
    expect(M.getCurrentTheme()).toBe(S.THEME_ID);
    expect(S.state().rooted).toBe(true);
    // every area that is off is written back with the values it had before
    const css = style().textContent;
    for (const sel of ['#top-tab-bar', '#top-bar', '#icon-sidebar']) expect(css).toContain('html body ' + sel);
    expect(css).toContain('--vex-bg-base: #faf6ee;');
    expect(css).toContain('--vex-text-primary: #1f1c18;');
    expect(css).not.toContain('--vex-bg-base: ' + wp.background);
  });

  it('Accent on its own is painted on <body> and moves no other colour', async () => {
    await S.setAreas('aurora-borealis', ['accent']);
    expect(M.applyTheme).not.toHaveBeenCalled();
    expect(CustomThemes.list()).toEqual([]);
    const css = style().textContent;
    expect(css).toContain('html body:not([data-gui-family="browser"])');
    expect(css).toMatch(/--vex-accent: #[0-9a-f]{6};/);
    expect(css).toContain('--b-accent: var(--vex-accent);');
    expect(css).not.toContain('--vex-bg-base');
    expect(css).not.toContain('--vex-text-primary:');
  });

  it('Everything else with Accent is the whole palette of the wallpaper; every kept area wears its accent', async () => {
    await S.setAreas('aurora-borealis', ['rest', 'accent']);
    const wp = wpOf('aurora-borealis');
    expect(CustomThemes.list()[0].colors).toEqual(wp);
    const css = style().textContent;
    expect(css).toContain('--vex-accent: ' + wp.primary + ';');
    expect(css).toContain('--vex-bg-base: #faf6ee;');   // the kept areas keep their background...
  });

  it('turning Everything else off puts the theme worn before back', async () => {
    await S.setAreas('aurora-borealis', ['rest', 'tabs']);
    expect(M.getCurrentTheme()).toBe(S.THEME_ID);
    await S.setAreas('aurora-borealis', ['tabs']);
    expect(M.getCurrentTheme()).toBe('oxford');
    expect(M.applyTheme).toHaveBeenLastCalledWith('oxford', { auto: true });
    expect(CustomThemes.list()).toEqual([]);
    expect(style().textContent).toContain('#top-tab-bar');
  });

  it('the New Tab follows its own switch', async () => {
    M.currentTheme = 'firefox-dark';
    expect(S.newTabOverride('firefox-dark')).toBeNull();
    await S.setAreas('aurora-borealis', ['tabs']);
    expect(S.newTabOverride('firefox-dark')).toBeNull();               // not matched: the page is left alone
    expect(S.newTabWorn()).toBe(false);
    await S.setAreas('aurora-borealis', ['tabs', 'newtab']);
    const o = S.newTabOverride('firefox-dark');
    expect(o.id).toBe(S.THEME_ID);
    expect(o.colors.background).toBe(wpOf('aurora-borealis').background);
    expect(S.newTabWorn()).toBe(true);
    expect(S.newTabOverride('oxford')).toBeNull();
    await S.setAreas('aurora-borealis', ['tabs', 'rest']);              // the theme is worn, the page is not matched
    expect(S.newTabOverride(S.THEME_ID)).toEqual({ id: 'firefox-dark', colors: null });
  });

  it('Match everything turns every area on', async () => {
    await S.apply('aurora-borealis');
    expect(S.areasFor('aurora-borealis')).toEqual(S.AREA_IDS);
    expect(style().textContent).toContain('#top-bar');
    expect(CustomThemes.list()[0].colors).toEqual(wpOf('aurora-borealis'));
  });

  it('is saved per wallpaper, in the key owned by the wallpaper feature', async () => {
    await S.setAreas('aurora-borealis', ['tabs', 'accent']);
    expect(JSON.parse(localStorage.getItem(S.PREFS_KEY))).toEqual({ 'aurora-borealis': ['tabs', 'accent'] });
    await S.setAreas('soft-sky', ['toolbar']);
    expect(JSON.parse(localStorage.getItem(S.PREFS_KEY))).toEqual({ 'aurora-borealis': ['tabs', 'accent'], 'soft-sky': ['toolbar'] });
    expect(S.areasFor('soft-sky')).toEqual(['toolbar']);
    expect(S.areasFor('aurora-borealis')).toEqual(['tabs', 'accent']);   // remembered, not applied
    expect(S.state().wallpaper).toBe('soft-sky');
    expect(S.PREFS_KEY).toBe('vex.wallpaper.sync.areas');
  });

  it('survives a restart: the saved state paints the areas again', async () => {
    await S.setAreas('aurora-borealis', ['sidebar']);
    style().remove();
    S.render();
    expect(style().textContent).toContain('#icon-sidebar');
  });

  it('another theme picked afterwards removes the areas; wearing the theme again brings them back', async () => {
    await S.setAreas('aurora-borealis', ['tabs']);
    M.currentTheme = 'paper';
    S.render();
    expect(style()).toBeNull();
    M.currentTheme = 'oxford';
    S.render();
    expect(style()).not.toBeNull();
    // with Everything else on it is the synced theme that has to be worn
    await S.setAreas('aurora-borealis', ['tabs', 'rest']);
    M.currentTheme = 'paper';
    S.render();
    expect(style()).toBeNull();
    M.currentTheme = S.THEME_ID;
    S.render();
    expect(style()).not.toBeNull();
  });

  it('all switches off is Undo: the old theme, no style, nothing saved', async () => {
    M.currentTheme = 'firefox-dark';
    await S.setAreas('aurora-borealis', ['tabs', 'toolbar', 'rest']);
    await S.setAreas('aurora-borealis', []);
    expect(M.getCurrentTheme()).toBe('firefox-dark');
    expect(gui.setColors).not.toHaveBeenCalled();
    expect(CustomThemes.list()).toEqual([]);
    expect(style()).toBeNull();
    expect(S.state()).toBeNull();
    expect(S.areasFor('aurora-borealis')).toEqual([]);
    expect(localStorage.getItem(S.PREFS_KEY)).toBeNull();
  });

  it('Undo after several switches restores the theme worn before the FIRST one', async () => {
    M.currentTheme = 'paper';
    await S.setAreas('aurora-borealis', ['tabs']);
    await S.setAreas('aurora-borealis', ['tabs', 'rest']);
    await S.setAreas('soft-sky', ['accent']);
    expect(S.state().prevTheme).toBe('paper');
    expect(await S.undo()).toBe(true);
    expect(M.getCurrentTheme()).toBe('paper');
    expect(style()).toBeNull();
    expect(CustomThemes.list()).toEqual([]);
  });

  it('a switch after you picked another theme starts from that theme, not the old one', async () => {
    M.currentTheme = 'oxford';
    await S.setAreas('aurora-borealis', ['rest']);
    M.currentTheme = 'paper';
    await S.setAreas('aurora-borealis', ['tabs']);
    expect(S.state().prevTheme).toBe('paper');
    expect(S.state().own).toEqual(CustomThemes.complete(OWN.paper));
    expect(CustomThemes.list()).toEqual([]);    // the old synced theme is gone, nothing is worn
  });

  it('choosing a wallpaper never changes the colours; only the switches do', async () => {
    await S.setAreas('aurora-borealis', ['tabs']);
    const before = localStorage.getItem(S.KEY) + style().textContent;
    window.VexWallpapers.apply = () => {};
    window.VexWallpapers.apply('soft-sky');
    expect(localStorage.getItem(S.KEY) + style().textContent).toBe(before);
  });

  it('the CSS only carries checked colours and known tokens', async () => {
    await S.setAreas('aurora-borealis', ['tabs', 'toolbar', 'sidebar', 'rest', 'accent']);
    const css = style().textContent;
    expect(css).not.toMatch(/url\(|expression|javascript|@import/i);
    for (const m of css.matchAll(/^\s+(--[a-z0-9-]+): (.+);$/gm)) expect(m[2]).toMatch(/^(#[0-9a-f]{6}(?:[0-9a-f]{2})?|rgba\(.+\)|blur\(0px\)|\d+px|var\(.+\)|color-mix\(.+\)|transparent|initial)$/);
  });

  it('Glass is dark whatever the colours: a light wallpaper is matched with its dark side there', async () => {
    document.body.dataset.guiStyle = 'glass';
    try {
      await S.setAreas('soft-sky', ['tabs']);
      const css = document.getElementById(S.STYLE_ID).textContent;
      const dark = CustomThemes.complete(S.paletteForGenerated(all.find(d => d.id === 'soft-sky'), false).colors);
      expect(CustomThemes.isLight(dark)).toBe(false);
      expect(css).toContain('--vex-bg-base: ' + dark.background);
    } finally { delete document.body.dataset.guiStyle; }
  });

  it('refuses an unknown area, and an empty list for apply', async () => {
    await expect(S.setAreas('aurora-borealis', ['footer'])).rejects.toThrow(/Not an area/);
    await expect(S.apply('aurora-borealis', [])).rejects.toThrow(/at least one/);
    expect(S.state()).toBeNull();
  });

  it('refuses, in words, when the window has nothing to keep (so a part left off would change)', async () => {
    document.body.style.cssText = '';
    await expect(S.setAreas('aurora-borealis', ['tabs'])).rejects.toThrow(/does not define --vex-bg-base/);
    expect(S.state()).toBeNull();
  });
});

describe('a browser look in its own colours (Firefox grey, Chrome white...): its colour mode is never switched', () => {
  const style = () => document.getElementById(S.STYLE_ID);
  const wpOf = (id) => CustomThemes.complete(S.paletteForGenerated(all.find(d => d.id === id)).colors);
  beforeEach(() => { gui.getColors = () => 'look'; windowColours(true); });

  it('one area changes only that area: the theme and the look stay as they are', async () => {
    M.currentTheme = 'firefox-dark';
    await S.setAreas('aurora-borealis', ['tabs']);
    expect(gui.setColors).not.toHaveBeenCalled();
    expect(M.applyTheme).not.toHaveBeenCalled();
    expect(CustomThemes.list()).toEqual([]);
    expect(S.state()).toMatchObject({ lookMode: true, browser: true, rooted: false });
    const css = style().textContent;
    expect(css).toContain('html body[data-gui-family="browser"]');        // the look's own variables are redrawn from the tokens
    expect(css).toContain('--b-toolbar: var(--vex-bg-elevated);');
    expect(css).not.toContain('[data-gui-colors="theme"]');               // it works in the look's own colours too
    expect(css).not.toContain('#top-bar');
  });

  it('Everything else is painted on <body> (out-ranking the look\'s own bridge); the other areas keep the look\'s values', async () => {
    await S.setAreas('aurora-borealis', ['rest']);
    expect(M.applyTheme).not.toHaveBeenCalled();
    expect(S.state()).toMatchObject({ rooted: false, lookMode: true });
    const css = style().textContent;
    expect(css).toContain('html body[data-gui-family="browser"][data-gui-style] {');
    expect(css).toContain('--vex-bg-base: ' + wpOf('aurora-borealis').background);
    // the kept areas: the look's real values, and nothing of the look's it does not define left to inherit
    expect(css).toContain('--b-toolbar: #f9f9fb;');
    expect(css).toContain('--b-frame: #f0f0f4;');
    expect(css).toContain('--b-strip-fg: initial;');
    for (const sel of ['#top-tab-bar', '#top-bar', '#icon-sidebar']) expect(css).toContain('html body ' + sel);
  });

  it('Accent on its own repaints only the accent, in the look\'s variables too', async () => {
    await S.setAreas('aurora-borealis', ['accent']);
    const css = style().textContent;
    expect(css).toContain('--b-accent: var(--vex-accent);');
    expect(css).toContain('--b-on-accent: ');
    expect(css).not.toContain('--vex-bg-base');
  });

  it('the New Tab: matched = the wallpaper\'s colours (and no look palette over them); not matched = untouched', async () => {
    await S.setAreas('aurora-borealis', ['rest', 'tabs']);
    expect(S.newTabOverride('oxford')).toBeNull();
    expect(S.newTabWorn()).toBe(false);
    await S.setAreas('aurora-borealis', ['rest', 'tabs', 'newtab']);
    expect(S.newTabOverride('oxford').id).toBe(S.THEME_ID);
    expect(S.newTabWorn()).toBe(true);
  });

  it('Undo has no look to restore: it takes the sheet away and leaves the theme and colour mode alone', async () => {
    await S.setAreas('aurora-borealis', ['tabs', 'rest']);
    expect(await S.undo()).toBe(true);
    expect(style()).toBeNull();
    expect(M.applyTheme).not.toHaveBeenCalled();
    expect(gui.setColors).not.toHaveBeenCalled();
    expect(S.state()).toBeNull();
  });

  it('works out the readability against the look\'s real colours, not the theme that happens to be picked', async () => {
    await S.setAreas('aurora-borealis', ['accent']);
    const css = style().textContent;
    // the accent made readable on the look's white: never the pale wallpaper accent that fails there
    const accent = /--vex-accent: (#[0-9a-f]{6});/.exec(css)[1];
    expect(CustomThemes.contrast(accent, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('refuses, in words, a look whose colours are not plain colours', async () => {
    document.body.style.setProperty('--b-accent', 'color-mix(in srgb, red 50%, blue)');
    await expect(S.setAreas('aurora-borealis', ['tabs'])).rejects.toThrow(/not a plain colour/);
    document.body.style.removeProperty('--b-toolbar');
    await expect(S.setAreas('aurora-borealis', ['tabs'])).rejects.toThrow(/does not define --b-toolbar|not a plain colour/);
  });
});

describe('the areas against the real window and the real css', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../../src/renderer');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const html = new DOMParser().parseFromString(read('index.html'), 'text/html');

  it('every selector of an area is an element of the real window (or is built by the look at start-up)', () => {
    const built = read('js/gui-style.js');
    for (const a of S.AREAS.filter(x => x.selector)) {
      for (const sel of a.selector.split(',').map(x => x.trim())) {
        const id = sel.replace(/^#/, '');
        const found = html.querySelector(sel) || built.includes("'" + id + "'") || built.includes('"' + id + '"') || built.includes('id = ' + "'" + id + "'");
        expect(Boolean(found), a.id + ': ' + sel).toBe(true);
      }
    }
  });

  it('the three areas cover the rail, the panels (Settings, Notes...) and the AI panel', () => {
    const css = S.AREAS.filter(a => a.selector).map(a => a.selector).join(' ');
    for (const sel of ['#top-tab-bar', '#tabs-sidebar', '#top-bar', '#gui-shortcuts-bar', '#icon-sidebar', '#panels-container', '#ai-panel']) expect(css).toContain(sel);
    expect(html.querySelector('#panels-container #panel-settings, #panels-container [id^="panel-settings"]') || html.querySelector('#panels-container')).not.toBeNull();
  });

  it('the --b-* set an area redraws is exactly what css/gui-browser.css section 6 draws from the theme', () => {
    const css = read('css/gui-browser.css').replace(/\r\n/g, '\n');
    const i = css.indexOf('body[data-gui-family="browser"][data-gui-colors="theme"] {');
    expect(i).toBeGreaterThan(0);
    const block = css.slice(i, css.indexOf('\n}', i));
    const theirs = new Map();
    for (const m of block.matchAll(/(--b-[a-z0-9-]+): ([^;]+);/g)) theirs.set(m[1], m[2].trim());
    const ours = new Map(S.BROWSER_LINES.map(x => [x.slice(0, x.indexOf(':')), x.slice(x.indexOf(':') + 2)]));
    for (const [k, v] of ours) expect(theirs.get(k), k).toBe(v);
  });

  it('every look variable it keeps is one gui-browser.css or gui-glass.css really defines', () => {
    const css = read('css/gui-browser.css') + read('css/gui-glass.css');
    for (const n of S.LOOK_VARS.concat(S.LOOK_EXTRA)) expect(css.includes(n + ':'), n).toBe(true);
  });

  it('the tokens the icon rail reads (and the group buttons that join it) are all redeclared by the side bar area', () => {
    const colourTokens = (file) => {
      if (!fs.existsSync(path.join(root, file))) return [];
      return Array.from(new Set(Array.from(read(file).matchAll(/var\((--[a-z0-9-]+)/g)).map(m => m[1])))
        .filter(n => /^--(vex-|primary$|text$|text-muted$|bg$|border$|surface$)/.test(n) && !/^--vex-(radius|blur)/.test(n));
    };
    const kept = S.keepNames();
    const missing = [];
    for (const f of ['css/sidebar.css', 'css/sidebar-groups.css', 'css/sidebar-visibility.css']) for (const n of colourTokens(f)) if (!kept.includes(n)) missing.push(f + ' ' + n);
    expect(missing).toEqual([]);
    // the same set is what a matched side bar is painted with
    const c = S.areaCss('#icon-sidebar', CustomThemes.complete(OWN.paper));
    for (const n of ['--vex-text-primary', '--vex-text-secondary', '--vex-hover-fill', '--vex-accent', '--vex-accent-dim', '--vex-bg-base', '--vex-glass-tab-inactive', '--vex-border-subtle', '--vex-danger', '--primary', '--text']) expect(c, n).toContain(n + ':');
    // the browser looks' rail variables: text, hover fill, menu surface, dim text
    for (const n of ['--b-text', '--b-btn-hover', '--b-menu', '--b-text-dim']) expect(c, n).toContain(n + ':');
    expect(S.LOOK_EXTRA).toContain('--b-rail-active');
  });
});
