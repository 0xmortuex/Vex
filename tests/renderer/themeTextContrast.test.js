// Every built-in theme's text reads at 4.5:1 (WCAG AA) on every surface it is
// drawn on, in the window and on the New Tab page. ~40 of 72 themes had muted
// text under it (Graphite 2.77, Noctis Viola 3.69, Nord 3.96), and some their
// accent text (Wine, Android Beige), danger (Nord 2.11) or the text on a
// hovered primary button (Ruby 2.69, Neutron 2.70) — cat-themes TH9.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

const rgb = (h) => { const c = T.hex(h); return [c.r, c.g, c.b]; };
const hx = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));
// A token as the opaque colour it paints: an rgba over the theme's base.
function solid(v, under) {
  const c = T.hex(v);
  if (!c) return null;
  if (c.a >= 1) return hx([c.r, c.g, c.b]);
  return under ? hx(mix([c.r, c.g, c.b], rgb(under), c.a)) : null;
}
const VEX_SURFACES = ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light'];
const LEGACY_SURFACES = ['--bg', '--surface', '--bg-2', '--sidebar'];
const START_SURFACES = ['--vex-bg-base', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light'];

function check(tokens, texts, surfaces, min, where) {
  const base = solid(tokens['--vex-bg-base']);
  const low = [];
  for (const x of texts) {
    const fg = solid(tokens[x], base);
    if (!fg) continue;
    for (const s of surfaces) {
      const bg = solid(tokens[s], base);
      if (!bg) continue;
      const r = T.ratio(fg, bg);
      if (r < min) low.push(`${where}: ${x} ${tokens[x]} on ${s} ${tokens[s]} = ${r.toFixed(2)}`);
    }
  }
  return low;
}

describe('theme text contrast (all built-in themes)', () => {
  it('covers every theme', () => {
    expect(T.IDS.length).toBeGreaterThanOrEqual(68);
  });

  it('window: text, muted, accent text, danger and success read at 4.5:1', () => {
    const low = [];
    for (const id of T.IDS) {
      const t = T.chromeTokens(id);
      low.push(...check(t, ['--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent', '--vex-danger', '--vex-success'], VEX_SURFACES, 4.5, id));
      low.push(...check(t, ['--text', '--text-muted', '--danger', '--success'], LEGACY_SURFACES, 4.5, id));
    }
    expect(low).toEqual([]);
  });

  it('window: the text on a primary button reads at 4.5:1, hovered too', () => {
    const low = [];
    for (const id of T.IDS) {
      const t = T.chromeTokens(id);
      const on = t['--on-primary'];
      expect(on, id).toBeTruthy();
      for (const k of ['--primary', '--primary-hover']) {
        const c = solid(t[k]);
        if (c && T.ratio(on, c) < 4.5) low.push(`${id}: --on-primary ${on} on ${k} ${t[k]} = ${T.ratio(on, c).toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('New Tab page: the same text reads at 4.5:1 on its own surfaces', () => {
    const low = [];
    for (const id of T.IDS) low.push(...check(T.startTokens(id), ['--vex-text-primary', '--vex-text-secondary', '--vex-text-muted'], START_SURFACES, 4.5, 'New Tab ' + id));
    expect(low).toEqual([]);
  });

  it('New Tab page wears the window\'s text colours', () => {
    const drift = [];
    for (const id of T.IDS) {
      const c = T.chromeTokens(id), s = T.startTokens(id);
      for (const k of ['--vex-text-primary', '--vex-text-secondary', '--vex-text-muted']) {
        if (c[k] && s[k] && c[k].toLowerCase() !== s[k].toLowerCase()) drift.push(`${id}: ${k} window ${c[k]} vs New Tab ${s[k]}`);
      }
    }
    expect(drift).toEqual([]);
  });
});
