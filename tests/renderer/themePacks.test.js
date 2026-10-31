// @vitest-environment jsdom
//
// Theme packs (js/theme-packs.js) and icon packs (js/icon-packs.js): the data model is consistent (every pack names a design, an icon pack,
// a colour theme and fonts that exist), every icon exists in every icon pack, and applying / resetting a pack puts things back.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer', f), 'utf8');
const run = (src, ret) => new Function(src + '\n;return ' + ret + ';')();

let Icons, Packs, Themes, FONTS;

function load() {
  document.documentElement.removeAttribute('data-icon-pack');
  for (const a of ATTRS) document.documentElement.removeAttribute(a);
  localStorage.clear();
  window.VexIcons = undefined;
  Icons = run(read('js/vex-icons.js'), 'VexIcons');
  window.VexIcons = Icons;
  delete window.VexIconPacks; delete window.VexThemePacks;
  run(read('js/icon-packs.js'), '0');
  run(read('js/theme-packs.js'), '0');
  Packs = window.VexThemePacks;
}
const ATTRS = ['data-pk-tabs', 'data-pk-bar', 'data-pk-surface', 'data-pk-density'];

beforeEach(() => {
  Themes = run(read('js/theme-manager.js'), 'ThemeManager');
  FONTS = run(read('js/fonts.js').replace(/^const VexFonts/m, 'var VexFonts'), 'VexFonts').FONTS;
  load();
});

describe('icon packs', () => {
  it('has at least four packs, with distinct ids and a name and note each', () => {
    const P = window.VexIconPacks.PACKS;
    expect(P.length).toBeGreaterThanOrEqual(4);
    expect(new Set(P.map(p => p.id)).size).toBe(P.length);
    for (const p of P) { expect(p.name).toBeTruthy(); expect(p.note).toBeTruthy(); }
  });

  it('draws every VexIcons name in every pack, as an svg with something to draw', () => {
    for (const pack of window.VexIconPacks.PACKS) {
      window.VexIconPacks.set(pack.id);
      for (const name of Icons.names()) {
        const svg = Icons.svg(name, { size: 20 });
        expect(svg, `${pack.id}/${name}`).toMatch(/^<svg /);
        expect(svg, `${pack.id}/${name}`).toMatch(/<(path|circle|rect|ellipse|line|polyline|polygon)/);
        expect(svg).toContain(`data-vex-icon="${name}"`);
        expect(svg).toContain('width="20" height="20" viewBox="0 0 24 24"');
      }
    }
  });

  it('redraws only icons that exist (a typo in a pack would be a silent default)', () => {
    for (const pack of window.VexIconPacks.PACKS) {
      for (const name of Object.keys(pack.glyphs || {})) expect(Icons.has(name), `${pack.id} draws "${name}"`).toBe(true);
    }
  });

  it('draws every pixel icon on a 12 by 12 grid', () => {
    const px = window.VexIconPacks.get('pixel').glyphs;
    expect(Object.keys(px).length).toBeGreaterThanOrEqual(12);
    for (const [name, markup] of Object.entries(px)) {
      const d = /d="([^"]+)"/.exec(markup)[1];
      for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v2h-\d+z/g)) {
        expect(+m[1] + +m[3], name).toBeLessThanOrEqual(24);
        expect(+m[2] + 2, name).toBeLessThanOrEqual(24);
      }
      expect(d.length, name).toBeGreaterThan(10);
    }
  });

  it('keeps the default drawing under the default pack, byte for byte, apart from the tag', () => {
    const before = Icons.icons.home;
    expect(Icons.svg('home')).toContain(before);
  });

  it('refuses an unknown pack and saves nothing', () => {
    expect(() => window.VexIconPacks.set('nope')).toThrow(/no icon pack called "nope"/);
    expect(localStorage.getItem('vex.iconPack')).toBeNull();
  });

  it('repaints icons already on the page, and puts the attribute on <html>', () => {
    document.body.innerHTML = '<span id="a">' + Icons.svg('home') + '</span>';
    const outline = document.querySelector('#a svg').innerHTML;
    window.VexIconPacks.set('solid');
    expect(document.documentElement.getAttribute('data-icon-pack')).toBe('solid');
    expect(document.querySelector('#a svg').innerHTML).not.toBe(outline);
    expect(document.querySelector('#a svg').innerHTML).toContain('fill="currentColor"');
    expect(localStorage.getItem('vex.iconPack')).toBe('solid');
    window.VexIconPacks.set('outline');
    expect(document.documentElement.hasAttribute('data-icon-pack')).toBe(false);
    expect(document.querySelector('#a svg').innerHTML).toBe(outline);
    expect(localStorage.getItem('vex.iconPack')).toBeNull();
  });

  it('wears the saved pack from the first icon drawn', () => {
    localStorage.setItem('vex.iconPack', 'pixel');
    load2();
    expect(Icons.svg('check')).toContain('crispEdges');
  });

  function load2() {
    localStorage.setItem('vex.iconPack', 'pixel');
    window.VexIcons = undefined;
    Icons = run(read('js/vex-icons.js'), 'VexIcons');
    window.VexIcons = Icons;
    run(read('js/icon-packs.js'), '0');
  }

  it('has a rule in the stylesheet for every pack that is only a style', () => {
    const css = read('css/icon-packs.css');
    for (const p of window.VexIconPacks.PACKS) if (p.id !== 'outline') expect(css).toContain(`data-icon-pack="${p.id}"`);
  });
});

describe('theme packs', () => {
  it('registers 8 to 12 packs that are not recolours of each other', () => {
    expect(Packs.PACKS.length).toBeGreaterThanOrEqual(8);
    expect(Packs.PACKS.length).toBeLessThanOrEqual(12);
    expect(new Set(Packs.PACKS.map(p => p.id)).size).toBe(Packs.PACKS.length);
    // No two packs share a design, nor an icon pack together with a colour theme.
    expect(new Set(Packs.PACKS.map(p => p.design)).size).toBe(Packs.PACKS.length);
    expect(new Set(Packs.PACKS.map(p => p.colours)).size).toBe(Packs.PACKS.length);
  });

  it('names a design, an icon pack, a colour theme, fonts and a look that all exist', () => {
    const looks = ['classic', 'glass', 'chrome', 'chrome-dark', 'firefox', 'firefox-dark', 'safari', 'xp', 'win98', 'fluent', 'fluent-dark', 'glossy', 'neobrutal', 'terminal'];
    const themeIds = Themes.THEMES.map(t => t.id);
    const fontIds = FONTS.map(f => f.id);
    for (const p of Packs.PACKS) {
      expect(Packs.design(p.design), p.id).toBeTruthy();
      expect(window.VexIconPacks.get(p.icons), p.id).toBeTruthy();
      expect(themeIds, p.id).toContain(p.colours);
      expect(looks, p.id).toContain(p.look);
      if (p.fonts) { expect(fontIds).toContain(p.fonts.ui); if (p.fonts.mono) expect(fontIds).toContain(p.fonts.mono); }
      expect(p.wallpaper === null || typeof p.wallpaper.id === 'string', p.id).toBe(true);
      expect(p.name && p.note, p.id).toBeTruthy();
    }
  });

  it('gives every design value a rule in the stylesheet', () => {
    const css = read('css/theme-packs.css');
    for (const d of Packs.DESIGNS) {
      for (const [axis, attr] of Object.entries(Packs.AXES)) {
        if (d[axis] && d[axis] !== 'default') expect(css, `${d.id} ${axis}=${d[axis]}`).toContain(`${attr}="${d[axis]}"`);
      }
    }
  });

  it('names skins that exist in js/skins.js', () => {
    const S = run(read('js/skins.js'), 'VexSkins');
    for (const d of Packs.DESIGNS) {
      if (!d.skin) continue;
      if (d.skin.pattern) expect(S.PATTERNS.map(x => x.id), d.id).toContain(d.skin.pattern);
      if (d.skin.shape) expect(S.SHAPES.map(x => x.id), d.id).toContain(d.skin.shape);
      if (d.skin.glow) expect(S.GLOWS.map(x => x.id), d.id).toContain(d.skin.glow);
      if (d.skin.strength) expect(S.STRENGTHS.map(x => x.id), d.id).toContain(d.skin.strength);
    }
  });

  it('carries the design attributes in the early-look snapshot', () => {
    const src = read('js/early-look.js');
    for (const a of [...ATTRS, 'data-icon-pack']) expect(src).toContain(`'${a}'`);
  });

  describe('applying', () => {
    let skin, font, applied;
    beforeEach(() => {
      applied = [];
      const S = run(read('js/skins.js'), 'VexSkins');
      window.VexSkins = S;
      skin = S;
      const F = { _f: 'default', _m: 'jetbrains', current() { return { id: this._f }; }, currentMono() { return { id: this._m }; },
        set(id) { this._f = id; }, setMono(id) { this._m = id; } };
      window.VexFonts = F; font = F;
      window.ThemeManager = { availableThemes: Themes.THEMES.map(t => t.id), getCurrentTheme: () => 'oxford', applyTheme: (id) => applied.push(id) };
    });

    it('applies the colours, design, icons and fonts of a pack, and saves it', () => {
      const p = Packs.pack('arcade');
      Packs.applyPack('arcade');
      expect(applied).toEqual([p.colours]);
      expect(document.documentElement.getAttribute('data-pk-tabs')).toBe('block');
      expect(document.documentElement.getAttribute('data-pk-surface')).toBe('paper');
      expect(document.documentElement.getAttribute('data-icon-pack')).toBe('pixel');
      expect(skin.shape().id).toBe('heavy');
      expect(font._f).toBe('cascadia');
      expect(Packs.current().pack).toBe('arcade');
      expect(JSON.parse(localStorage.getItem('vex.themePack')).design).toBe('slab');
    });

    it('does not touch the look', () => {
      document.body.dataset.guiStyle = 'firefox';
      window.VexGuiStyle = { set() { throw new Error('a pack must not change the look'); } };
      for (const p of Packs.PACKS) Packs.applyPack(p.id);
      expect(document.body.dataset.guiStyle).toBe('firefox');
    });

    it('calls the wallpaper store when a pack names a wallpaper and the store exists', () => {
      const calls = [];
      window.VexWallpapers = { apply: (id) => calls.push(id) };
      const p = Packs.pack('frost');
      p.wallpaper = { id: 'dunes' };
      Packs.applyPack('frost');
      p.wallpaper = null;
      expect(calls).toEqual(['dunes']);
      Packs.applyPack('frost');
      expect(calls).toEqual(['dunes']);
      delete window.VexWallpapers;
    });

    it('picking one part makes the pack custom and leaves the others', () => {
      Packs.applyPack('arcade');
      Packs.setDesign('folio');
      expect(Packs.current().pack).toBeNull();
      expect(Packs.current().design).toBe('folio');
      expect(document.documentElement.getAttribute('data-icon-pack')).toBe('pixel');
      Packs.setIcons('bold');
      expect(document.documentElement.getAttribute('data-icon-pack')).toBe('bold');
      Packs.setColours('nord');
      expect(applied.at(-1)).toBe('nord');
    });

    it('reset gives back the skin and fonts the person had, and removes every attribute and the saved key', () => {
      skin.set('shape', 'round'); skin.set('pattern', 'dots'); font._f = 'times';
      Packs.applyPack('arcade');
      expect(skin.shape().id).toBe('heavy');
      Packs.reset();
      expect(skin.shape().id).toBe('round');
      expect(skin.pattern().id).toBe('dots');
      expect(font._f).toBe('times');
      for (const a of [...ATTRS, 'data-icon-pack']) expect(document.documentElement.hasAttribute(a)).toBe(false);
      expect(localStorage.getItem('vex.themePack')).toBeNull();
      expect(localStorage.getItem('vex.iconPack')).toBeNull();
    });

    it('refuses an unknown pack, design, icon pack or colour, with a message', () => {
      expect(() => Packs.applyPack('x')).toThrow(/no theme pack called "x"/);
      expect(() => Packs.setDesign('x')).toThrow(/no design called "x"/);
      expect(() => Packs.setIcons('x')).toThrow(/no icon pack called "x"/);
      expect(() => Packs.setColours('x')).toThrow(/no colour theme called "x"/);
    });

    it('puts the saved design back at start-up', () => {
      Packs.applyPack('frost');
      for (const a of ATTRS) document.documentElement.removeAttribute(a);
      Packs.apply();
      expect(document.documentElement.getAttribute('data-pk-surface')).toBe('glass');
      expect(document.documentElement.getAttribute('data-pk-bar')).toBe('float');
    });
  });
});
