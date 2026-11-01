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

let M, gui;
beforeEach(() => {
  localStorage.clear();
  document.head.querySelectorAll('#' + S.STYLE_ID).forEach(n => n.remove());
  ({ M } = (() => { const f = fakeThemes(); window.ThemeManager = globalThis.ThemeManager = f.M; window.ThemeStudio = globalThis.ThemeStudio = f.St; return f; })());
  let colors = 'look';
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

describe('switches: live, saved per wallpaper, undone exactly', () => {
  const style = () => document.getElementById(S.STYLE_ID);
  const wpOf = (id) => CustomThemes.complete(S.paletteForGenerated(all.find(d => d.id === id)).colors);

  it('nothing is on for a wallpaper that was never matched, and nothing changes by itself', () => {
    expect(S.areasFor('aurora-borealis')).toEqual([]);
    expect(S.state()).toBeNull();
    expect(CustomThemes.list()).toEqual([]);
    expect(style()).toBeNull();
  });

  it('the first switch applies at once: only that area is painted, the rest keeps your theme', async () => {
    await S.setAreas('aurora-borealis', ['tabs']);
    expect(S.areasFor('aurora-borealis')).toEqual(['tabs']);
    expect(M.getCurrentTheme()).toBe(S.THEME_ID);
    expect(CustomThemes.list()[0].colors).toEqual(CustomThemes.complete(OWN.oxford));
    const css = style().textContent;
    expect(css).toContain('html body #top-tab-bar');
    expect(css).toContain('#tabs-sidebar');
    expect(css).not.toContain('#top-bar');
    expect(css).not.toContain('#icon-sidebar');
    expect(css).toContain('--vex-bg-base: ' + wpOf('aurora-borealis').background);
    expect(css).not.toContain('--vex-bg-base: ' + CustomThemes.complete(OWN.oxford).background);
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

  it('Everything else and Accent change the theme itself, not an area', async () => {
    await S.setAreas('aurora-borealis', ['rest']);
    const wp = wpOf('aurora-borealis');
    let rec = CustomThemes.list()[0];
    expect(rec.colors.background).toBe(wp.background);
    expect(rec.colors.primary).not.toBe(wp.primary);
    expect(style()).toBeNull();
    await S.setAreas('aurora-borealis', ['rest', 'accent']);
    rec = CustomThemes.list()[0];
    expect(rec.colors).toEqual(wp);
  });

  it('a browser look\'s own colours are switched to the theme\'s while an area is matched', async () => {
    await S.setAreas('aurora-borealis', ['tabs']);
    expect(gui.setColors).toHaveBeenCalledWith('theme');
  });

  it('the New Tab follows its own switch', async () => {
    M.currentTheme = 'firefox-dark';
    expect(S.newTabOverride('firefox-dark')).toBeNull();
    await S.setAreas('aurora-borealis', ['tabs']);
    expect(S.newTabOverride(S.THEME_ID)).toEqual({ id: 'firefox-dark', colors: null });
    await S.setAreas('aurora-borealis', ['tabs', 'newtab']);
    const o = S.newTabOverride(S.THEME_ID);
    expect(o.id).toBe(S.THEME_ID);
    expect(o.colors.background).toBe(wpOf('aurora-borealis').background);
    expect(S.newTabOverride('oxford')).toBeNull();
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

  it('another theme picked afterwards removes the areas; wearing the synced theme again brings them back', async () => {
    await S.setAreas('aurora-borealis', ['tabs']);
    M.currentTheme = 'paper';
    S.render();
    expect(style()).toBeNull();
    M.currentTheme = S.THEME_ID;
    S.render();
    expect(style()).not.toBeNull();
  });

  it('all switches off is Undo: the old theme, the look\'s colours, no style, nothing saved', async () => {
    M.currentTheme = 'firefox-dark';
    await S.setAreas('aurora-borealis', ['tabs', 'toolbar', 'rest']);
    await S.setAreas('aurora-borealis', []);
    expect(M.getCurrentTheme()).toBe('firefox-dark');
    expect(gui.getColors()).toBe('look');
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
    expect(CustomThemes.list()[0].colors).toEqual(CustomThemes.complete(OWN.paper));
  });

  it('choosing a wallpaper never changes the colours; only the switches do', async () => {
    await S.setAreas('aurora-borealis', ['tabs']);
    const before = localStorage.getItem(S.KEY) + style().textContent;
    window.VexWallpapers.apply = () => {};
    window.VexWallpapers.apply('soft-sky');
    expect(localStorage.getItem(S.KEY) + style().textContent).toBe(before);
  });

  it('the CSS only carries checked colours and known tokens', async () => {
    await S.setAreas('aurora-borealis', ['tabs', 'toolbar', 'sidebar']);
    const css = style().textContent;
    expect(css).not.toMatch(/url\(|expression|javascript|@import/i);
    for (const m of css.matchAll(/^\s+(--[a-z0-9-]+): (.+);$/gm)) expect(m[2]).toMatch(/^(#[0-9a-f]{6}(?:[0-9a-f]{2})?|rgba\(.+\)|blur\(0px\)|\d+px|var\(.+\)|color-mix\(.+\)|transparent)$/);
  });

  it('refuses an unknown area, and an empty list for apply', async () => {
    await expect(S.setAreas('aurora-borealis', ['footer'])).rejects.toThrow(/Not an area/);
    await expect(S.apply('aurora-borealis', [])).rejects.toThrow(/at least one/);
    expect(S.state()).toBeNull();
  });
});
