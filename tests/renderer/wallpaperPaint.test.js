// @vitest-environment jsdom
//
// The readability maths shared by the window and the New Tab (js/wallpaper-paint.js).
import { describe, it, expect } from 'vitest';

const { WallpaperPaint: P } = require('../../src/renderer/js/wallpaper-paint.js');

describe('contrast', () => {
  it('is the WCAG ratio', () => {
    expect(P.contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(P.contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    expect(P.contrast([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1);
  });
});

describe('neededScrim', () => {
  const white = [255, 255, 255], black = [0, 0, 0], page = [10, 12, 20];
  it('is 0 when the text already reads over the picture', () => {
    const r = P.neededScrim({ inks: [white], extremes: [black, [30, 30, 40]], scrim: page });
    expect(r).toMatchObject({ alpha: 0, ok: true });
  });
  it('is raised until light text reads over a white picture, and no higher than needed', () => {
    const r = P.neededScrim({ inks: [[238, 240, 255], [148, 153, 196]], extremes: [white, black], scrim: page });
    expect(r.ok).toBe(true);
    expect(r.alpha).toBeGreaterThan(0.4);
    expect(r.worst).toBeGreaterThanOrEqual(P.AIM);
    const below = P.worstContrast([[238, 240, 255], [148, 153, 196]], [white, black], page, r.alpha - 0.01);
    expect(below).toBeLessThan(P.AIM);
  });
  it('works for dark text on a light page over a black picture too', () => {
    const r = P.neededScrim({ inks: [[40, 40, 50]], extremes: [white, black], scrim: [250, 247, 242] });
    expect(r.ok).toBe(true);
    expect(P.worstContrast([[40, 40, 50]], [white, black], [250, 247, 242], r.alpha)).toBeGreaterThanOrEqual(P.AIM);
  });
  it('asks no more of a text colour than it gives on the page itself (a 4.6:1 muted text is not asked for 4.7 over a picture)', () => {
    const page = [255, 255, 255], muted = [118, 118, 118];
    const own = P.contrast(muted, page);
    expect(own).toBeGreaterThan(4.4); expect(own).toBeLessThan(4.7);
    const r = P.neededScrim({ inks: [muted], extremes: [[200, 220, 255], [240, 249, 255]], scrim: page });
    expect(r.alpha).toBeLessThan(1);
    expect(r.ok).toBe(true);
    const full = P.neededScrim({ inks: [muted], extremes: [black], scrim: page });
    expect(P.worstContrast([muted], [black], page, full.alpha)).toBeGreaterThanOrEqual(own - 0.03 - 0.001);
  });
  it('a text colour that does not read on the page itself holds the wallpaper only to "no worse than the page"', () => {
    const r = P.neededScrim({ inks: [[120, 120, 120]], extremes: [white, black], scrim: [130, 130, 130] });
    expect(r.alpha).toBeLessThanOrEqual(1);
    expect(P.worstContrast([[120, 120, 120]], [white, black], [130, 130, 130], r.alpha)).toBeGreaterThanOrEqual(P.contrast([120, 120, 120], [130, 130, 130]) - 0.04);
  });
  it('refuses missing input', () => {
    expect(() => P.neededScrim({ inks: [], extremes: [white], scrim: page })).toThrow(/text colours/);
    expect(() => P.neededScrim({ inks: [white], extremes: [], scrim: page })).toThrow(/lightest and darkest/);
  });
});

describe('paint refuses what it was not given a checked picture for', () => {
  it.each(['https://example.com/x.png', 'javascript:alert(1)', 'data:text/html,<b>', 'data:image/gif;base64,AAAA', '', null])('%j', (src) => {
    expect(() => P.paint({ src, lightest: '#ffffff', darkest: '#000000' })).toThrow(/checked picture/);
  });
  it('and a dim or blur out of range', () => {
    const src = 'data:image/svg+xml;charset=utf-8,%3Csvg%3E';
    expect(() => P.paint({ src, lightest: '#ffffff', darkest: '#000000', dim: 2 })).toThrow(/dim/);
    expect(() => P.paint({ src, lightest: '#ffffff', darkest: '#000000', blur: -1 })).toThrow(/blur/);
  });
});
