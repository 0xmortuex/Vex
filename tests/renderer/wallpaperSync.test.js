// @vitest-environment jsdom
//
// Sync Vex to a wallpaper (js/wallpaper-sync.js): every wallpaper Vex draws has a palette whose
// text reads at 4.5:1 and whose accent reads at 3:1, on the light side and the dark side; one
// call applies it as a theme of the user's own, and Undo puts back exactly what was worn.
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
    DEFAULT_THEME: 'oxford', THEMES, currentTheme: 'oxford', applied: [],
    get availableThemes() { return THEMES.map(t => t.id); },
    getCurrentTheme() { return this.currentTheme; },
    applyTheme: vi.fn(function (id, opts) { if (!this.availableThemes.includes(id)) throw new Error('unknown theme ' + id); this.currentTheme = id; this.applied.push([id, opts]); }),
  };
  const St = {
    records: () => CustomThemes.list(),
    isEditing: () => false,
    record: (id) => CustomThemes.list().find(r => r.id === id) || null,
    colorsFromTheme: (id) => ({ ...(OWN[id] || OWN.oxford) }),
    _changed: vi.fn(() => {
      for (let i = THEMES.length - 1; i >= 0; i--) if (THEMES[i].user) THEMES.splice(i, 1);
      for (const r of CustomThemes.list()) THEMES.push({ id: r.id, user: true });
    }),
  };
  return { M, St };
}

// What the window really has on <body>: the tokens and a browser look's own colours, which Vex reads
// once (before the first switch) so that a part left off keeps exactly these.
function windowColours() {
  const st = document.body.style;
  st.cssText = '';
  const v = { '--vex-bg-base': '#faf6ee', '--vex-bg-elevated': '#ffffff', '--vex-text-primary': '#1f1c18', '--vex-text-secondary': '#453f36', '--vex-accent': '#1e3a5f',
    '--b-page': '#ffffff', '--b-toolbar': '#f9f9fb', '--b-text': '#15141a', '--b-text-dim': '#5b5b66', '--b-accent': '#0061e0', '--b-border': '#cfcfd8', '--b-frame': '#f0f0f4' };
  for (const [k, x] of Object.entries(v)) st.setProperty(k, x);
}

let M, St, gui;
beforeEach(() => {
  localStorage.clear();
  windowColours();
  ({ M, St } = fakeThemes());
  window.ThemeManager = globalThis.ThemeManager = M;
  window.ThemeStudio = globalThis.ThemeStudio = St;
  let colors = 'theme';
  gui = window.VexGuiStyle = { isBrowserLook: () => true, getColors: () => colors, setColors: vi.fn((c) => { colors = c; }) };
  window.VexWallpapers = { get: (id) => all.find(d => d.id === id) || null };
});

describe('every wallpaper has a readable sync palette', () => {
  it('covers all of them', () => { expect(all.length).toBe(74); });

  for (const light of [false, true]) {
    it(`${light ? 'light' : 'dark'} side: text 4.5:1, accent 3:1, nothing unresolved`, () => {
      const bad = [];
      for (const d of all) {
        const p = S.paletteForGenerated(d, light);
        if (p.unresolved.length) bad.push(`${d.id}: unresolved ${p.unresolved.map(x => x.key)}`);
        for (const c of CustomThemes.checks(p.colors)) if (c.ratio < 4.5) bad.push(`${d.id}: ${c.key} ${c.ratio}`);
        const dv = CustomThemes.derive(p.colors);
        for (const bg of [dv.surfaces.bg, dv.surfaces.surf, dv.surfaces.deep, dv.surfaces.tabActive]) {
          const r = CustomThemes.contrast(dv.colors.primary, bg);
          if (r < 3) bad.push(`${d.id}: accent on ${bg} ${r.toFixed(2)}`);
          const t = CustomThemes.contrast(dv.colors.text, bg);
          if (t < 4.5) bad.push(`${d.id}: text on ${bg} ${t.toFixed(2)}`);
          const m = CustomThemes.contrast(dv.colors.muted, bg);
          if (m < 4.5) bad.push(`${d.id}: muted on ${bg} ${m.toFixed(2)}`);
        }
        expect(CustomThemes.isLight(p.colors)).toBe(light);
      }
      expect(bad).toEqual([]);
    });
  }

  it('is the same palette every time, and the default side is the wallpaper\'s own', () => {
    for (const d of all) {
      expect(S.paletteForGenerated(d)).toEqual(S.paletteForGenerated(d));
      expect(S.paletteForGenerated(d).light).toBe(d.light);
    }
  });

  it("the palette follows the wallpaper: each of the 22 palettes gets its own accent", () => {
    const accents = new Set(all.map(d => S.paletteForGenerated(d).colors.primary));
    expect(accents.size).toBeGreaterThanOrEqual(20);
  });
});

describe('apply and undo', () => {
  it('apply saves one theme of the user\'s own, wears it, and remembers what was worn', async () => {
    M.currentTheme = 'firefox-dark';
    const rec = await S.apply('aurora-borealis');
    expect(rec.id).toBe(S.THEME_ID);
    expect(rec.name).toBe('Synced: Borealis');
    expect(CustomThemes.list().map(r => r.id)).toEqual([S.THEME_ID]);
    expect(M.getCurrentTheme()).toBe(S.THEME_ID);
    expect(gui.setColors).not.toHaveBeenCalled();   // the look's colour mode is never switched
    expect(S.state()).toMatchObject({ prevTheme: 'firefox-dark', wallpaper: 'aurora-borealis', rooted: true, lookMode: false });
  });

  it('syncing again replaces the theme and keeps the FIRST theme for Undo', async () => {
    M.currentTheme = 'firefox-dark';
    await S.apply('aurora-borealis');
    await S.apply('soft-sky');
    expect(CustomThemes.list().length).toBe(1);
    expect(CustomThemes.list()[0].name).toBe('Synced: Soft sky');
    expect(S.state().prevTheme).toBe('firefox-dark');
    expect(S.state().wallpaper).toBe('soft-sky');
  });

  it('undo puts back the theme and the look\'s colours, and removes the synced theme', async () => {
    M.currentTheme = 'firefox-dark';
    await S.apply('aurora-borealis');
    expect(await S.undo()).toBe(true);
    expect(M.getCurrentTheme()).toBe('firefox-dark');
    expect(gui.setColors).not.toHaveBeenCalled();
    expect(CustomThemes.list()).toEqual([]);
    expect(S.state()).toBeNull();
    expect(S.canUndo()).toBe(false);
  });

  it('undo with nothing synced does nothing', async () => {
    expect(await S.undo()).toBe(false);
    expect(M.applyTheme).not.toHaveBeenCalled();
  });

  it('undo after the user picked another theme keeps that pick and only removes the synced theme', async () => {
    await S.apply('aurora-borealis');
    M.currentTheme = 'oxford';
    M.applyTheme.mockClear();
    expect(await S.undo()).toBe(true);
    expect(M.applyTheme).not.toHaveBeenCalled();
    expect(CustomThemes.list()).toEqual([]);
  });

  it('applying or changing a wallpaper afterwards never touches the colours', async () => {
    await S.apply('aurora-borealis');
    const before = JSON.stringify(CustomThemes.list());
    M.applyTheme.mockClear();
    window.VexWallpapers.apply = () => {};
    expect(JSON.stringify(CustomThemes.list())).toBe(before);
    expect(M.applyTheme).not.toHaveBeenCalled();
  });

  it('refuses while the theme editor is open, and for an unknown wallpaper', async () => {
    St.isEditing = () => true;
    await expect(S.apply('aurora-borealis')).rejects.toThrow(/editor/);
    St.isEditing = () => false;
    await expect(S.apply('nope')).rejects.toThrow(/no wallpaper/);
    expect(S.state()).toBeNull();
  });

  it('a damaged saved state is an error, not a silent reset', () => {
    localStorage.setItem(S.KEY, '{oops');
    expect(() => S.state()).toThrow(/damaged/);
  });

  it('classic look (no browser look): the colours mode is left alone', async () => {
    window.VexGuiStyle = { isBrowserLook: () => false, getColors: () => 'theme', setColors: vi.fn() };
    await S.apply('aurora-borealis');
    expect(window.VexGuiStyle.setColors).not.toHaveBeenCalled();
    expect(S.state()).toMatchObject({ browser: false, lookMode: false });
  });
});

describe('own pictures and photos', () => {
  it('are read from the picture with ThemeFromImage and use its side', async () => {
    const summary = { n: 4, meanL: 0.3, clusters: [{ L: 0.3, a: 0, b: -0.1, C: 0.1, h: 265, weight: 0.7, hex: '#223366' }, { L: 0.5, a: 0.1, b: 0, C: 0.1, h: 30, weight: 0.3, hex: '#aa5522' }], lightest: '#ffffff', darkest: '#000000' };
    const sample = vi.spyOn(ThemeFromImage, 'sample').mockResolvedValue(summary);
    window.VexWallpapers = { get: () => ({ id: 'my-0123456789ab', title: 'Lake', source: 'mine' }), rasterFile: vi.fn(async () => ({})) };
    const p = await S.paletteFor('my-0123456789ab');
    expect(sample).toHaveBeenCalled();
    expect(p.light).toBe(false);
    expect(p.unresolved).toEqual([]);
    expect(CustomThemes.checks(p.colors).every(c => c.ratio >= 4.5)).toBe(true);
    sample.mockRestore();
  });
});
