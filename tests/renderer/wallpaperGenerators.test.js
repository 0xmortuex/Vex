// @vitest-environment jsdom
//
// The wallpapers Vex draws itself (js/wallpaper-generators.js, js/wallpaper-data.js):
// the same id always gives the same picture, there are enough of them, and each is a
// small, well-formed SVG that uses nothing from outside.
import { describe, it, expect, vi, afterEach } from 'vitest';

const { WallpaperGenerators: G } = require('../../src/renderer/js/wallpaper-generators.js');
require('../../src/renderer/js/wallpaper-materials.js');
require('../../src/renderer/js/wallpaper-patterns.js');
require('../../src/renderer/js/wallpaper-nature.js');
const { WallpaperData: D } = require('../../src/renderer/js/wallpaper-data.js');
const { MATERIAL_ROWS } = require('../../src/renderer/js/wallpaper-materials-data.js');

afterEach(() => vi.restoreAllMocks());

describe('the built-in wallpapers', () => {
  const list = D.generated();

  it('are at least 60, in about ten groups or more', () => {
    expect(list.length).toBeGreaterThanOrEqual(60);
    expect(new Set(list.map(w => w.category)).size).toBeGreaterThanOrEqual(10);
  });
  it('have unique ids and unique names, and every group has some', () => {
    expect(new Set(list.map(w => w.id)).size).toBe(list.length);
    expect(new Set(list.map(w => w.title)).size).toBe(list.length);
    for (const c of D.CATEGORIES) expect(list.some(w => w.category === c.id), c.id).toBe(true);
  });
  it('are made by Vex, with no author to credit and no licence to keep', () => {
    expect(list.every(w => w.source === 'generated' && w.author === 'Vex' && w.licence === 'Made by Vex')).toBe(true);
  });
  it('cover every kind of picture the generator knows', () => {
    const used = new Set(list.map(w => w.kind));
    expect(G.KINDS.filter(k => !used.has(k))).toEqual([]);
  });
  it('include light ones for a light theme', () => {
    expect(list.filter(w => w.light).length).toBeGreaterThanOrEqual(6);
    expect(list.filter(w => !w.light).length).toBeGreaterThan(40);
  });
});

describe('the pictures', () => {
  const list = D.generated();

  it('are the same every time for the same id (no clock, no Math.random)', () => {
    const rand = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random was used'); });
    const first = list.map(w => G.svg(w));
    const second = list.map(w => G.svg(w));
    expect(second).toEqual(first);
    expect(rand).not.toHaveBeenCalled();
  });
  it('differ from one another', () => {
    expect(new Set(list.map(w => G.svg(w))).size).toBe(list.length);
  });
  it('change when the id changes, with everything else the same', () => {
    const w = list[0];
    expect(G.svg({ ...w, id: w.id + '-x' })).not.toBe(G.svg(w));
  });
  it('are well-formed SVG of a few KB that load nothing from outside', () => {
    const parser = new DOMParser();
    for (const w of list) {
      const svg = G.svg(w);
      expect(svg.length, w.id).toBeLessThan(40 * 1024);
      const dom = parser.parseFromString(svg, 'image/svg+xml');
      expect(dom.getElementsByTagName('parsererror').length, w.id).toBe(0);
      expect(dom.documentElement.getAttribute('viewBox')).toBe('0 0 1600 900');
      expect(svg.replace(' xmlns="http://www.w3.org/2000/svg"', ''), w.id).not.toMatch(/https?:|<image|<script|href=|xlink|javascript/i);
    }
  });
  it('become a data: URL the page can paint', () => {
    const url = G.dataUrl(G.svg(list[0]));
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).not.toMatch(/[()'"<>\s]/);
    expect(decodeURIComponent(url.split(',')[1])).toBe(G.svg(list[0]));
  });
});

// The materials, tiles, botanical prints, sky and maps (js/wallpaper-materials-data.js and the three kind files).
describe('the material wallpapers', () => {
  const ids = new Set(MATERIAL_ROWS.map(r => r[0]));
  const mine = D.generated().filter(w => ids.has(w.id));
  const NEW_GROUPS = ['marble', 'wood', 'fabric', 'paper', 'stone', 'metal', 'sky', 'tiles', 'botanical', 'maps'];

  it('are at least 200, in ten new groups that each hold at least 5', () => {
    expect(mine.length).toBeGreaterThanOrEqual(200);
    for (const g of NEW_GROUPS) {
      expect(D.CATEGORIES.some(c => c.id === g), g).toBe(true);
      expect(mine.filter(w => w.category === g).length, g).toBeGreaterThanOrEqual(5);
    }
    expect(mine.every(w => NEW_GROUPS.includes(w.category))).toBe(true);
  });
  it('have ids and names that are not used by the older wallpapers, and every id is a safe slug', () => {
    const older = D.generated().filter(w => !ids.has(w.id));
    const names = new Set(older.map(w => w.title)), taken = new Set(older.map(w => w.id));
    for (const w of mine) {
      expect(names.has(w.title), w.title).toBe(false);
      expect(taken.has(w.id), w.id).toBe(false);
      expect(w.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
  it('use every new kind of picture, and each new kind is used by at least two wallpapers', () => {
    const used = {};
    for (const w of mine) used[w.kind] = (used[w.kind] || 0) + 1;
    const added = G.KINDS.filter(k => !['mesh', 'linear', 'radial', 'horizon', 'waves', 'mountains', 'lowpoly', 'tiles', 'dots', 'grid', 'rings', 'topo', 'stars', 'grain', 'solid', 'bokeh'].includes(k));
    expect(added.length).toBeGreaterThanOrEqual(35);
    for (const k of added) expect(used[k] || 0, k).toBeGreaterThanOrEqual(2);
  });
  it('are drawn in a few milliseconds each (the browser does the heavy work, at the size of the screen)', () => {
    const t0 = Date.now();
    for (const w of mine) G.svg(w);
    const per = (Date.now() - t0) / mine.length;
    expect(per).toBeLessThan(15);
  });
  it('light ones list their colours lightest first and dark ones darkest first (what "Match Vex to this wallpaper" reads)', () => {
    for (const w of mine) {
      const first = G.luminance(w.colors[0]), last = G.luminance(w.colors[4]);
      if (w.light) expect(first, w.id).toBeGreaterThanOrEqual(last);
      else expect(first, w.id).toBeLessThanOrEqual(last);
    }
  });
  it('a wallpaper added after the list was read is in the next read, and a repeated id, group or palette is refused', () => {
    const before = D.generated().length;
    const row = ['zz-test', 'Zz test', 'zz', 'solid', 'zzpal', 1];
    D.extend({ categories: [{ id: 'zz', title: 'Zz' }], palettes: { zzpal: ['#000000', '#111111', '#222222', '#333333', '#444444'] }, rows: [row] });
    expect(D.generated().length).toBe(before + 1);
    expect(() => D.extend({ rows: [row] })).toThrow(/already exists/);
    expect(() => D.extend({ categories: [{ id: 'zz', title: 'Zz' }] })).toThrow(/already exists/);
    expect(() => D.extend({ palettes: { zzpal: [] } })).toThrow(/already exists/);
  });
  it('the kinds refuse a mode they do not know', () => {
    const c = ['#000000', '#222222', '#444444', '#888888', '#eeeeee'];
    for (const kind of ['wood', 'paper', 'stone', 'metal']) expect(() => G.svg({ id: 'x-' + kind, kind, seed: 1, colors: c, opts: { mode: 'nope' } }), kind).toThrow(/Unknown/);
    expect(() => G.svg({ id: 'x-leaf', kind: 'leaves', seed: 1, colors: c, opts: { leaf: 'nope' } })).toThrow(/Unknown leaf/);
  });
  it('a kind cannot be added twice', () => {
    expect(() => G.extend({ marble() { return ''; } })).toThrow(/already exists/);
  });
});

describe('the generator refuses bad input', () => {
  const ok = { id: 'x-1', kind: 'mesh', seed: 1, colors: ['#000000', '#111111', '#222222', '#333333', '#444444'] };
  it('an unknown kind', () => expect(() => G.svg({ ...ok, kind: 'nope' })).toThrow(/Unknown wallpaper kind/));
  it('a missing id', () => expect(() => G.svg({ ...ok, id: '' })).toThrow(/id/));
  it('the wrong number of colours', () => expect(() => G.svg({ ...ok, colors: ['#000000'] })).toThrow(/five colours/));
  it('a colour that is not #rrggbb (nothing odd can be written into the SVG)', () => {
    expect(() => G.svg({ ...ok, colors: ['red', '#111111', '#222222', '#333333', '#444444'] })).toThrow(/#rrggbb/);
    expect(() => G.svg({ ...ok, colors: ['#000000"/><script>', '#111111', '#222222', '#333333', '#444444'] })).toThrow(/#rrggbb/);
  });
});
