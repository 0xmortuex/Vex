// The New Tab's verse reference ("Surah Al-Israa · 17:1") was in the raw
// accent: 3.1:1 in Wine, 3.9:1 in EzLight, 4.1:1 in Ruby, Plum and Neutron
// (check:ui surfaces, full sweep). It is the accent mixed toward the page's
// text colour now: still the theme's hue, readable in every theme.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

const rgb = (h) => { const c = T.hex(h); return [c.r, c.g, c.b]; };
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));
const hx = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

describe('New Tab verse reference', () => {
  const m = /\.quran-ref \{[^}]*color: color-mix\(in srgb, var\(--vex-accent\) (\d+)%, var\(--vex-text-primary\)\);/.exec(T.startStyle);

  it('is the accent mixed toward the text colour', () => {
    expect(m).not.toBeNull();
  });

  it('reads at 4.5:1 on the page and its accent glow, in every theme', () => {
    const p = Number(m[1]) / 100;
    const low = [];
    for (const id of T.IDS) {
      const t = T.startTokens(id);
      const acc = T.hex(t['--vex-accent']), txt = T.hex(t['--vex-text-primary']), base = T.hex(t['--vex-bg-base']);
      if (!acc || !txt || !base || acc.a < 1 || base.a < 1) continue;
      const ink = hx(mix(rgb(t['--vex-accent']), rgb(t['--vex-text-primary']), p));
      const under = [t['--vex-bg-base']];
      const glow = T.hex(t['--vex-accent-glow']);
      if (glow && glow.a < 1) under.push(hx(mix([glow.r, glow.g, glow.b], rgb(t['--vex-bg-base']), glow.a)));
      for (const u of under) {
        const r = T.ratio(ink, u);
        if (r < 4.5) low.push(`${id}: ${ink} on ${u} = ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });
});
