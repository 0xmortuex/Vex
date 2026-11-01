// The sidebar folders (css/sidebar-groups.css) take every colour from the rail's tokens: the tile's edge, the open folder's background,
// the glyph and the name. This computes, for every built-in theme and every palette colour a group can take, what the stylesheet paints:
//   tile edge on the rail      >= 3:1  (a control's boundary, WCAG 1.4.11)
//   glyph on the tile          >= 4.5:1
//   name on the rail           >= 4.5:1, and on the open folder's background >= 4.5:1
// The numbers in the formulas are read FROM the stylesheet, so a later edit of the mix amounts is measured, not assumed.
// A real window (Firefox look, Classic, Glass, the wallpaper match) is measured with getComputedStyle in Chromium, not here.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/sidebar-groups.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const pct = (re) => { const m = re.exec(css); if (!m) throw new Error('not found in the stylesheet: ' + re); return Number(m[1]) / 100; };
const EDGE = pct(/#icon-sidebar \.sb-folder > \.sb-folder-btn\.sidebar-icon \{[^}]*border: 1px solid color-mix\(in srgb, var\(--sbf-fg\) (\d+)%/);
const FILL = pct(/#icon-sidebar \.sb-folder > \.sb-folder-btn\.sidebar-icon \{[^}]*background: color-mix\(in srgb, var\(--sbf-tint\) (\d+)%/);
const TILE_OPEN = pct(/#icon-sidebar \.sb-folder\.open > \.sb-folder-btn\.sidebar-icon \{ background: color-mix\(in srgb, var\(--sbf-tint\) (\d+)%/);
const TILE_HOVER = pct(/#icon-sidebar \.sb-folder > \.sb-folder-btn\.sidebar-icon:hover \{ background: color-mix\(in srgb, var\(--sbf-tint\) (\d+)%/);
const OPEN = pct(/#icon-sidebar \.sb-folder\.open \{[^}]*background: color-mix\(in srgb, var\(--sbf-tint\) (\d+)%/);

const mix = (a, b, p) => ({ r: a.r * p + b.r * (1 - p), g: a.g * p + b.g * (1 - p), b: a.b * p + b.b * (1 - p), a: 1 });
function solid(v, under) {
  const c = T.hex(v);
  if (!c) return null;
  return c.a >= 1 ? c : T.over(c, under);
}

describe('sidebar folders: contrast in every theme', () => {
  it('reads the mix amounts from the stylesheet', () => {
    expect(EDGE).toBeGreaterThanOrEqual(0.5);
    expect(FILL).toBeGreaterThan(0);
    expect(OPEN).toBeGreaterThan(0);
  });

  it('keeps the tile edge at 3:1 and the glyph and name at 4.5:1 for every theme and palette colour', () => {
    const low = [];
    let checked = 0;
    for (const id of T.IDS) {
      const t = T.chromeTokens(id);
      const base = T.hex(t['--vex-bg-base']);
      const rail = solid(t['--vex-glass-strong'], base);
      const text = solid(t['--vex-text-primary'], rail);
      const accent = solid(t['--vex-accent'], rail);
      const tints = {
        neutral: text, accent,
        accent2: mix(accent, text, 0.55),
        success: solid(t['--vex-success'] || t['--success'], rail),
        warning: solid(t['--vex-warning'] || t['--warning'], rail),
        danger: solid(t['--vex-danger'] || t['--danger'], rail),
      };
      for (const [name, tint] of Object.entries(tints)) {
        if (!tint) { low.push(`${id}/${name}: no token`); continue; }
        const edge = mix(text, rail, EDGE);
        const tile = mix(tint, rail, FILL);
        const open = mix(tint, rail, OPEN);
        const checks = [
          ['edge on rail', T.ratio(edge, rail), 3],
          ['glyph on tile', T.ratio(text, tile), 4.5],
          ['glyph on the open tile', T.ratio(text, mix(tint, open, TILE_OPEN)), 4.5],
          ['glyph on the hovered tile', T.ratio(text, mix(tint, rail, TILE_HOVER)), 4.5],
          ['name on rail', T.ratio(text, rail), 4.5],
          ['name on open folder', T.ratio(text, open), 4.5],
        ];
        for (const [what, r, min] of checks) { checked++; if (r < min) low.push(`${id}/${name}: ${what} ${r.toFixed(2)} < ${min}`); }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(low, low.slice(0, 25).join('\n')).toEqual([]);
  });
});
