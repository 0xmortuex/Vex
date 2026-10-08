// @vitest-environment jsdom
//
// Item #3 (2026-10-08): a theme from a picture or the Windows wallpaper
// (js/theme-from-image.js on top of js/theme-custom.js). jsdom decodes no
// pictures, so the pixels are made here; the decoding, the toning of the
// picture and the clicks were driven in the live app (see the item #3 report).
import { describe, it, expect, beforeAll } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

let C, T;
beforeAll(async () => {
  await import('../../src/renderer/js/theme-custom.js');
  C = window.CustomThemes;
  T = (await import('../../src/renderer/js/theme-from-image.js')).ThemeFromImage;
});

// w × h RGBA pixels from fn(x 0..1, y 0..1) -> [r, g, b, a?].
function picture(fn, w = 96, h = 54) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, al = 255] = fn(x / w, y / h);
    const p = (y * w + x) * 4;
    a[p] = r; a[p + 1] = g; a[p + 2] = b; a[p + 3] = al;
  }
  return a;
}
const DARK_LAKE = (x, y) => (Math.hypot(x - 0.7, y - 0.3) < 0.08 ? [255, 160, 70] : y < 0.55 ? [11 + 17 * y, 23 + 30 * y, 48 + 40 * y] : [8, 14, 26]);
const PASTEL = (x) => [[249, 198, 211], [200, 230, 245], [217, 242, 208], [251, 246, 238]][Math.floor(x * 4)];
const SATURATED = (x, y) => (y > 0.62 && (y * 50 | 0) % 3 === 0 ? [125, 255, 0] : [255 * (1 - x), 229 * x * x, 168 + 87 * x]);

describe('OKLab in CustomThemes (one colour engine)', () => {
  it('goes there and back without drift', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#8b8bff', '#123456', '#fbf6ee', '#7dff00']) {
      const [L, Ch, h] = C.toOklch(hex);
      const back = C.rgb(C.fromOklch(L, Ch, h));
      C.rgb(hex).forEach((v, i) => expect(Math.abs(v - back[i])).toBeLessThanOrEqual(1));
    }
  });
  it('a colour sRGB cannot show keeps its lightness and hue and loses chroma', () => {
    const hex = C.fromOklch(0.8, 0.4, 145);
    expect(C.normHex(hex)).toBe(hex);
    const [L, , h] = C.toOklch(hex);
    expect(L).toBeCloseTo(0.8, 2);
    expect(Math.abs(h - 145)).toBeLessThan(3);
  });
});

describe('the picture’s colours', () => {
  it('groups them, heaviest first, and finds the lightest and darkest pixel', () => {
    const s = T.summarize(picture(PASTEL));
    expect(s.n).toBe(96 * 54);
    expect(s.clusters.length).toBe(4);           // four flat colours, four groups
    expect(s.clusters.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 5);
    expect(s.clusters.map(c => c.hex).sort()).toEqual(['#c8e6f5', '#d9f2d0', '#f9c6d3', '#fbf6ee']);
    expect(s.lightest).toBe('#fbf6ee');
    expect(s.darkest).toBe('#f9c6d3');
  });
  it('is the same every time for the same picture', () => {
    const a = T.summarize(picture(SATURATED)), b = T.summarize(picture(SATURATED));
    expect(a.clusters.map(c => c.hex)).toEqual(b.clusters.map(c => c.hex));
    expect(T.palettes(a)).toEqual(T.palettes(b));
  });
  it('leaves out see-through pixels, and refuses a picture that is all see-through', () => {
    const half = T.summarize(picture((x) => (x < 0.5 ? [255, 0, 0, 0] : [0, 0, 255])));
    expect(half.clusters.length).toBe(1);
    expect(half.clusters[0].hex).toBe('#0000ff');
    expect(() => T.summarize(picture(() => [10, 10, 10, 0]))).toThrow(/see-through/);
  });
  it('copes with a picture of one colour', () => {
    const s = T.summarize(picture(() => [40, 90, 160]));
    expect(s.clusters).toHaveLength(1);
    expect(T.palettes(s)).toHaveLength(3);
  });
});

describe('palettes', () => {
  const bad = (colors) => C.checks(colors).filter(x => !x.ok);

  it('a dark picture gives a dark theme tinted by it; the vivid one takes its brightest colour as the accent', () => {
    const [calm, vivid, flip] = T.palettes(T.summarize(picture(DARK_LAKE)));
    expect(calm).toMatchObject({ id: 'calm', label: 'Calm', light: false });
    expect(C.isLight(calm.colors)).toBe(false);
    // Navy, like the lake.
    const [, , hb] = C.rgb(calm.colors.background);
    expect(hb).toBeGreaterThan(C.rgb(calm.colors.background)[0]);
    // The orange moon is only 2% of the picture, but the most saturated colour.
    const [, , accH] = C.toOklch(vivid.colors.primary);
    expect(accH).toBeGreaterThan(30);
    expect(accH).toBeLessThan(90);
    expect(flip).toMatchObject({ id: 'flip', label: 'Light', light: true });
    expect(C.isLight(flip.colors)).toBe(true);
  });

  it('a pastel picture gives a light theme, with Dark offered', () => {
    const [calm, vivid, flip] = T.palettes(T.summarize(picture(PASTEL)));
    expect(C.isLight(calm.colors)).toBe(true);
    expect(C.isLight(vivid.colors)).toBe(true);
    expect(flip).toMatchObject({ label: 'Dark', light: false });
    expect(C.isLight(flip.colors)).toBe(false);
  });

  it('a light theme does not take a yellow accent (dark yellow is olive) while another colour is near (found live)', () => {
    // Cream, with pink, blue and a stronger yellow than either.
    const s = T.summarize(picture((x) => [[251, 246, 238], [249, 198, 211], [200, 230, 245], [253, 225, 160]][Math.floor(x * 4)]));
    const [calm, , flip] = T.palettes(s);
    expect(calm.light).toBe(true);
    const h = C.toOklch(calm.colors.primary)[2];
    expect(h > 65 && h < 115).toBe(false);
    // On a dark theme a yellow accent is gold, and allowed.
    expect(flip.light).toBe(false);
  });

  it('a soft pastel picture (no strongly coloured part) takes its strongest tint, not the cream’s olive (found live)', () => {
    // The live test picture's groups: mostly cream, faint pink, blue, yellow, green.
    const groups = [['#f8f2ea', 48], ['#f4e7ea', 18], ['#e3ecf0', 9], ['#fbedcd', 9], ['#f2d8e5', 8], ['#e9f2df', 8]];
    const strip = groups.flatMap(([hex, n]) => Array(n).fill(C.rgb(hex)));
    const s = T.summarize(picture((x) => strip[Math.floor(x * strip.length)], 100, 4), { k: 6 });
    const [calm, vivid] = T.palettes(s);
    expect(calm.light).toBe(true);
    for (const o of [calm, vivid]) {
      const h = C.toOklch(o.colors.primary)[2];
      expect(h > 65 && h < 115).toBe(false);
    }
  });

  it('a grey picture still has a quiet accent, never a grey one', () => {
    const [calm] = T.palettes(T.summarize(picture((x) => [128 + 60 * x, 128 + 60 * x, 128 + 60 * x])));
    expect(C.toOklch(calm.colors.primary)[1]).toBeGreaterThan(0.04);
  });

  it('every text colour of every palette reads at 4.5:1 — the three test pictures and 150 random ones', () => {
    const pics = [picture(DARK_LAKE), picture(PASTEL), picture(SATURATED)];
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 150; i++) {
      const cols = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => [rnd() * 255, rnd() * 255, rnd() * 255]);
      pics.push(picture((x, y) => cols[Math.floor((x * 7 + y * 3) * cols.length) % cols.length], 24, 16));
    }
    for (const p of pics) {
      for (const o of T.palettes(T.summarize(p))) {
        expect(o.unresolved).toEqual([]);
        expect(bad(o.colors)).toEqual([]);
        for (const k of C.COLOR_KEYS) expect(C.normHex(o.colors[k])).toBe(o.colors[k]);
      }
    }
  });
});

describe('the New Tab picture stays readable', () => {
  // What start.html shows: the picture, our tint, then its own scrim.
  const shown = (pixel, colors, tint) => C.mix(C.mix(pixel, colors.background, tint), colors.background, T.NEWTAB_SCRIM);

  it('uses the scrim start.html really draws', () => {
    const start = fs.readFileSync(path.join(ROOT, 'src/renderer/start.html'), 'utf8');
    expect(start).toContain(`',${T.NEWTAB_SCRIM}), rgba(`);
  });

  it('tones the picture just enough for text and muted text over its most contrary pixel', () => {
    for (const fn of [DARK_LAKE, PASTEL, SATURATED]) {
      const s = T.summarize(picture(fn));
      for (const o of T.palettes(s)) {
        const t = T.pictureTint(o.colors, s);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
        for (const px of [s.lightest, s.darkest]) {
          const under = shown(px, o.colors, t);
          expect(C.contrast(o.colors.text, under)).toBeGreaterThanOrEqual(4.5);
          expect(C.contrast(o.colors.muted, under)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('leaves a picture alone when the scrim is enough', () => {
    const s = T.summarize(picture(PASTEL));
    expect(T.pictureTint(T.palettes(s)[0].colors, s)).toBe(0);
  });
});

describe('files', () => {
  const head = (...bytes) => Uint8Array.from([...bytes, ...new Array(16).fill(0)].slice(0, 16));
  it('knows a picture by its first bytes, not its name', () => {
    expect(T.sniff(head(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
    expect(T.sniff(head(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(T.sniff(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    expect(T.sniff(head(0x42, 0x4d))).toBe('image/bmp');
    expect(T.sniff(head(0x47, 0x49, 0x46, 0x38))).toBe(null);   // GIF
    expect(T.sniff(new Uint8Array(3))).toBe(null);
  });

  const fake = (bytes, { type = '', size = bytes.length } = {}) => ({ size, type, slice: () => ({ arrayBuffer: async () => Uint8Array.from(bytes).buffer }) });

  it('takes PNG, JPEG and WebP; refuses others, BMP unless it is the wallpaper, and anything too big', async () => {
    const png = fake(head(0x89, 0x50, 0x4e, 0x47), { type: 'image/png' });
    expect(await T.checkFile(png)).toBe(png);
    await expect(T.checkFile(fake(head(0x47, 0x49, 0x46, 0x38), { type: 'image/gif' }))).rejects.toThrow('PNG, JPEG and WebP');
    await expect(T.checkFile(fake(Array.from(new TextEncoder().encode('<svg xmlns="x"/>')), { type: 'image/png' }))).rejects.toThrow('PNG, JPEG and WebP');
    const bmp = fake(head(0x42, 0x4d), { type: 'image/bmp' });
    await expect(T.checkFile(bmp)).rejects.toThrow('PNG, JPEG and WebP');
    expect(await T.checkFile(bmp, { allowBmp: true })).toBe(bmp);
    await expect(T.checkFile(fake(head(0xff, 0xd8, 0xff), { type: 'image/jpeg', size: 31 * 1024 * 1024 }))).rejects.toThrow(/too big \(31 MB; 30 MB at most\)/);
    await expect(T.checkFile(null)).rejects.toThrow('No picture');
  });

  it('names a theme after the file', () => {
    expect(T.nameFor('dark-lake_2.jpg')).toBe('Dark lake 2');
    expect(T.nameFor('.png')).toBe('From a picture');
    expect(T.nameFor('x'.repeat(80) + '.webp')).toHaveLength(C.NAME_MAX);
  });

  it('reads the wallpaper answer, and says plainly when there is none', async () => {
    window.vex = { readWallpaper: async () => ({ ok: false, reason: 'solid', message: 'Your desktop background is a solid colour, not a picture. Choose a picture instead.' }) };
    await expect(T.wallpaper()).rejects.toThrow('solid colour');
    window.vex = { readWallpaper: async () => ({ ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgo=', note: 'Your wallpaper is a slideshow, so Vex used the picture showing now.' }) };
    const w = await T.wallpaper();
    expect(w.blob.type).toBe('image/png');
    expect(w.blob.size).toBe(8);
    expect(w.note).toMatch(/slideshow/);
    window.vex = { readWallpaper: async () => ({ ok: true, dataUrl: 'data:text/html;base64,PGI+' }) };
    await expect(T.wallpaper()).rejects.toThrow('a form Vex does not read');
    window.vex = {};
    await expect(T.wallpaper()).rejects.toThrow('cannot be read from here');
    delete window.vex;
  });
});
