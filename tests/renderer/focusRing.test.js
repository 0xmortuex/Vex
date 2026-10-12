// @vitest-environment jsdom
//
// The keyboard focus ring: the accent was the ring on every surface, 1.1:1 to 2.9:1
// against the Firefox look's toolbar, XP's caption and an active tab (WCAG 1.4.11
// asks 3:1). js/focus-ring.js picks a lighter or darker shade of the accent where
// it does not read; check:ui measured 335 of these before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const fresh = (p) => { const r = require.resolve(path.join(ROOT, p)); delete require.cache[r]; return require(r); };

describe('the focus ring colour', () => {
  const { VexFocusRing } = fresh('src/renderer/js/focus-ring.js');
  const rgb = (r, g, b) => ({ r, g, b, a: 1 });
  const parse = (css) => { const m = css.match(/\d+/g).map(Number); return rgb(m[0], m[1], m[2]); };

  it('keeps the accent where it already reads', () => {
    expect(VexFocusRing.pick(rgb(139, 92, 246), rgb(20, 20, 30))).toBeNull();
  });

  it('moves off the accent where it does not: the Firefox look toolbar (2.9:1), an active tab (1:1), XP caption (1.1:1)', () => {
    for (const [accent, bg] of [
      [rgb(157, 100, 223), rgb(221, 221, 222)],
      [rgb(157, 100, 223), rgb(157, 100, 223)],
      [rgb(49, 106, 197), rgb(11, 92, 220)],
      [rgb(0, 0, 128), rgb(0, 0, 128)],
      [rgb(34, 197, 94), rgb(0, 132, 27)],
      [rgb(30, 58, 95), rgb(16, 23, 37)],
    ]) {
      const css = VexFocusRing.pick(accent, bg);
      expect(css, JSON.stringify([accent, bg])).not.toBeNull();
      expect(VexFocusRing.contrast(parse(css), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('stays in the accent\'s hue when a lighter or darker shade is enough', () => {
    const css = VexFocusRing.pick(rgb(157, 100, 223), rgb(221, 221, 222));
    const c = parse(css);
    expect(c.b).toBeGreaterThan(c.g);        // still purple, not a black or white ring
  });

  it('falls to white or black on a surface no shade of the accent can clear', () => {
    const css = VexFocusRing.pick(rgb(128, 128, 128), rgb(128, 128, 128));
    expect(VexFocusRing.contrast(parse(css), rgb(128, 128, 128))).toBeGreaterThanOrEqual(3);
  });

  it('the High Contrast themes\' own 3px ring takes the picked colour too (it was a fixed #8ec5ff on a light toolbar: 1.7:1)', () => {
    const css = read('src/renderer/css/theme-extra.css');
    expect(css).toMatch(/outline: 3px solid var\(--vex-focus-ring, #0037a6\) !important;/);
    expect(css).toMatch(/outline: 3px solid var\(--vex-focus-ring, #8ec5ff\) !important;/);
  });

  it('a11y.css draws the ring from the picked colour, and index.html loads the module', () => {
    expect(read('src/renderer/css/a11y.css')).toMatch(/outline: 2px solid var\(--vex-focus-ring, var\(--primary, #7aa2ff\)\) !important;/);
    expect(read('src/renderer/index.html')).toMatch(/<script src="js\/focus-ring\.js"><\/script>/);
  });
});
