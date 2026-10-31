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
  it('says not ok when the text cannot read even on the page colour alone (nothing to fix with a scrim)', () => {
    const r = P.neededScrim({ inks: [[120, 120, 120]], extremes: [white, black], scrim: [130, 130, 130] });
    expect(r.ok).toBe(false);
    expect(r.alpha).toBe(1);
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
