// @vitest-environment node
//
// The New Tab's text sits on plates (js/wallpaper-paint.js), not under a shade over the whole picture: for every
// wallpaper Vex draws, drawn for real (sharp turns each SVG into 1280 x 720 pixels, the size the store measures),
// the shade is 35% or less, and every ink on its plate reads at 4.5:1 over the picture's worst places, in the dark
// glass and in the light glass, for a dark, a mid and a pale accent.
import { describe, it, expect, beforeAll } from 'vitest';

const sharp = require('sharp');
const { WallpaperPaint: P } = require('../../src/renderer/js/wallpaper-paint.js');
const { WallpaperGenerators: G } = require('../../src/renderer/js/wallpaper-generators.js');
require('../../src/renderer/js/wallpaper-materials.js');
require('../../src/renderer/js/wallpaper-patterns.js');
require('../../src/renderer/js/wallpaper-nature.js');
const { WallpaperData: D } = require('../../src/renderer/js/wallpaper-data.js');
const { MATERIAL_ROWS } = require('../../src/renderer/js/wallpaper-materials-data.js');

const W = 1280, H = 720;
const ACCENTS = { navy: [30, 58, 95], gold: [212, 165, 116], pale: [240, 240, 255], black: [0, 0, 0] };

// The SVGs are 1600 x 900; asking for 72 * 0.8 dpi draws them at 1280 x 720 straight away (cheaper than drawing and shrinking).
async function rasterOf(svg) {
  const r = await sharp(Buffer.from(svg), { density: 72 * W / 1600 }).resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  return new Uint8ClampedArray(r);
}
function solid(fn) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x, y), i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  return d;
}

describe('every wallpaper Vex draws', () => {
  const list = D.generated();
  const rows = [];
  beforeAll(async () => {
    for (const w of list) {
      const s = P.summarisePixels(await rasterOf(G.svg(w)), W, H);
      rows.push({ id: w.id, summary: s, light: w.light });
    }
  }, 900000);

  it('has a number for every wallpaper', () => {
    expect(rows.length).toBe(list.length);
    expect(rows.length).toBeGreaterThanOrEqual(270);
  });

  it('calls a wallpaper light only if it is not dark, and dark only if it is not pale (what "Match Vex to this wallpaper" starts from)', () => {
    const own = new Set(MATERIAL_ROWS.map(r => r[0]));
    const wrong = rows.filter(r => own.has(r.id) && (r.light ? r.summary.meanY < 0.3 : r.summary.meanY > 0.4)).map(r => r.id + ' ' + r.summary.meanY.toFixed(2));
    expect(wrong).toEqual([]);
  });

  it('shows at least 70% of the picture (shade 30% or less) with the glass the page picks by itself, at 4.5:1 or better', () => {
    const failures = [];
    for (const { id, summary } of rows) {
      for (const [name, accent] of Object.entries(ACCENTS)) {
        const p = P.plan({ summary, accent });
        if (!(p.shade <= 0.3 && p.worst >= P.AA && p.ok)) failures.push(id + '/' + name + ': shade ' + p.shade + ', worst ' + p.worst.toFixed(2) + ', scheme ' + p.scheme);
      }
    }
    expect(failures).toEqual([]);
  });

  it('is within 35% shade and 4.5:1 in BOTH the dark glass and the light glass', () => {
    const failures = [];
    for (const { id, summary } of rows) {
      for (const scheme of ['dark', 'light']) {
        for (const [name, accent] of Object.entries(ACCENTS)) {
          const p = P.plan({ summary, accent, scheme });
          if (!(p.shade <= P.SHADE_MAX && p.worst >= P.AA)) failures.push(id + '/' + scheme + '/' + name + ': shade ' + p.shade + ', worst ' + p.worst.toFixed(2));
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('picks the dark glass for a dark picture and the light glass for a pale one', () => {
    // Only the clear cases: a mid-tone picture (wood, kraft paper, sand) can go either way, and the planner takes the glass that needs the lighter plate.
    for (const { id, summary } of rows) {
      if (summary.meanY > 0.3 && summary.meanY <= 0.5) continue;
      const p = P.plan({ summary, accent: ACCENTS.navy });
      expect(p.scheme, id).toBe(summary.meanY > 0.5 ? 'light' : 'dark');
    }
  });

  it('keeps the plates light: no more than 80% for the pictures it draws, and the shade zero', () => {
    for (const { id, summary } of rows) {
      const p = P.plan({ summary, accent: ACCENTS.navy });
      expect(p.plateAlpha, id).toBeLessThanOrEqual(0.8);
      expect(p.shade, id).toBe(0);
    }
  });
});

describe('the plan', () => {
  const summaryOf = (fn) => P.summarisePixels(solid(fn), W, H);

  it('a picture that is half white and half black still reads: the plate gets as strong as it may, and the shade stays under its cap', () => {
    const s = summaryOf((x) => (x < W / 2 ? 255 : 0));
    for (const scheme of ['dark', 'light']) {
      const p = P.plan({ summary: s, accent: ACCENTS.navy, scheme });
      expect(p.shade).toBeLessThanOrEqual(P.SHADE_MAX);
      expect(p.worst).toBeGreaterThanOrEqual(P.AA);
    }
  });
  it('the shade is a last resort: it stays 0 while a plate of 92% or less is enough', () => {
    const p = P.plan({ summary: summaryOf((x) => (x < W / 2 ? 255 : 0)), accent: ACCENTS.navy, scheme: 'dark' });
    expect(p.shade).toBe(0);
    expect(p.plateAlpha).toBeLessThanOrEqual(P.PLATE_MAX);
  });
  it('a stripe finer than the plate\'s blur does not force a heavy plate (the blur averages it)', () => {
    const fine = summaryOf((x) => (Math.floor(x / 4) % 2 ? 255 : 0));
    const p = P.plan({ summary: fine, accent: ACCENTS.navy });
    expect(p.plateAlpha).toBeLessThanOrEqual(0.7);
  });
  it('Dim is kept (the shade is never below it) and can only help', () => {
    const s = summaryOf(() => 90);
    expect(P.plan({ summary: s, accent: ACCENTS.navy, dim: 0.2 }).shade).toBeGreaterThanOrEqual(0.2);
  });
  it('without "Keep text readable" the plate is fixed and the person\'s dim alone is the shade, and the real contrast is still reported', () => {
    const p = P.plan({ summary: summaryOf((x) => (x < W / 2 ? 255 : 0)), accent: ACCENTS.navy, auto: false, dim: 0.1, scheme: 'dark' });
    expect(p.shade).toBeCloseTo(0.1, 5);
    expect(p.plateAlpha).toBe(0.6);
    expect(typeof p.worst).toBe('number');
  });
  it('lifts a dark accent on the dark glass until it reads, and darkens a pale one on the light glass', () => {
    const s = summaryOf(() => 40);
    const dark = P.plan({ summary: s, accent: ACCENTS.navy, scheme: 'dark' });
    expect(P.contrast(dark.accent, dark.plate)).toBeGreaterThanOrEqual(P.AA);
    const light = P.plan({ summary: summaryOf(() => 220), accent: ACCENTS.pale, scheme: 'light' });
    expect(P.contrast(light.accent, light.plate)).toBeGreaterThanOrEqual(P.AA);
  });
  it('refuses a summary without the picture\'s colours, and an unknown scheme', () => {
    expect(() => P.plan({ summary: null })).toThrow(/lightest and darkest/);
    expect(() => P.plan({ summary: summaryOf(() => 10), scheme: 'blue' })).toThrow(/Unknown scheme/);
  });
  it('summarisePixels refuses pixels that are not w x h', () => {
    expect(() => P.summarisePixels(new Uint8ClampedArray(12), 10, 10)).toThrow(/RGBA/);
  });
});

describe('the CSS of the plates', () => {
  const p = P.plan({ summary: P.summarisePixels(solid(() => 30), W, H), accent: ACCENTS.navy });
  const css = P.plateCss(p);
  it('puts a blurred translucent plate behind every block of the New Tab and sets the ink on those blocks only', () => {
    for (const sel of ['.greeting-section', '.search-bar', '.shortcuts-section', '.recent-section', '.weather-section', '.brief-section']) expect(css).toContain(sel);
    expect(css).toMatch(/backdrop-filter: blur\(16px\)/);
    expect(css).toContain('--vex-text-primary');
    expect(css).not.toMatch(/(^|\n)html\[data-wallpaper\]\[data-wallpaper\]\[data-wallpaper\] \{/);   // nothing set on the whole page
  });
});
