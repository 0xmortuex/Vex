// Two highlighted surfaces read badly in every theme (cat-themes):
// TH3 the command bar's selected row kept its muted hint (2.0-3.75:1 on the
//     accent wash); TH8 Settings' category chips painted fixed colours as text
//     and marks (1.1-2.5:1 on light themes).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

const rgb = (h) => { const c = T.hex(h); return [c.r, c.g, c.b]; };
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));
const hx = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const opaque = (v) => { const c = T.hex(v); return c && c.a === 1; };
const read = (f) => fs.readFileSync(path.join(T.ROOT, f), 'utf8');

describe('command bar: the highlighted row', () => {
  const css = read('src/renderer/css/command.css');
  it('moves the hint and shortcut toward the title colour', () => {
    expect(css).toMatch(/\.command-result\.selected :is\(\.command-result-hint, \.command-result-shortcut\) \{\s*color: color-mix\(in srgb, var\(--vex-text-primary\) 80%, var\(--vex-text-muted\)\);/);
    expect(css).toMatch(/background: color-mix\(in srgb, var\(--vex-accent\) 16%, var\(--vex-bg-elevated, var\(--surface\)\)\);/);
  });

  it('the hint reads at 4.5:1 on the accent wash in every theme', () => {
    const low = [];
    let judged = 0;
    for (const id of T.IDS) {
      const t = T.chromeTokens(id);
      const under = opaque(t['--vex-bg-elevated']) ? t['--vex-bg-elevated'] : t['--surface'];
      if (![under, t['--vex-accent'], t['--vex-text-primary'], t['--vex-text-muted']].every(opaque)) continue;
      const wash = hx(mix(rgb(t['--vex-accent']), rgb(under), 0.16));
      const hint = hx(mix(rgb(t['--vex-text-primary']), rgb(t['--vex-text-muted']), 0.8));
      judged++;
      const r = T.ratio(hint, wash);
      if (r < 4.5) low.push(`${id}: ${hint} on ${wash} = ${r.toFixed(2)}`);
    }
    expect(judged).toBeGreaterThan(60);
    expect(low).toEqual([]);
  });
});

describe('Settings category chips', () => {
  const css = read('src/renderer/css/settings-redesign.css');
  const ui = read('src/renderer/js/settings-ui.js');
  const colours = [...new Set([...ui.matchAll(/color: '(#[0-9a-f]{6})'/g)].map(m => m[1]))];

  it('marks mix the category colour 40% into the text; a hovered chip\'s name is the text colour', () => {
    expect(css).toMatch(/\.set-nav-chip \.set-cat-icon \{[^}]*color: color-mix\(in srgb, var\(--chip-color, var\(--primary\)\) 40%, var\(--text\)\);/);
    expect(css).toMatch(/\.set-nav-chip:hover \{\s*color: var\(--text\);/);
    expect(css).toMatch(/\.set-emoji \{[^}]*color: color-mix\(in srgb, var\(--cat-color, var\(--primary\)\) 40%, var\(--text\)\);/);
    expect(css).not.toMatch(/(^|[^-])color: var\(--(chip|cat)-color/m);
  });

  it('every mark reads at 3:1 and every hovered name at 4.5:1, in every theme', () => {
    expect(colours.length).toBeGreaterThan(20);
    const low = [];
    for (const id of T.IDS) {
      const t = T.chromeTokens(id);
      if (!opaque(t['--surface']) || !opaque(t['--text'])) continue;
      for (const c of colours) {
        const mark = hx(mix(rgb(c), rgb(t['--text']), 0.4));
        for (const [bg, p] of [[t['--surface'], 0], [t['--surface'], 0.12], [t['--surface'], 0.18]]) {
          const under = hx(mix(rgb(c), rgb(bg), p));
          if (T.ratio(mark, under) < 3) low.push(`${id}: mark ${mark} (${c}) on ${under} = ${T.ratio(mark, under).toFixed(2)}`);
        }
        const hover = hx(mix(rgb(c), rgb(t['--surface']), 0.12));
        if (T.ratio(t['--text'], hover) < 4.5) low.push(`${id}: name ${t['--text']} on ${hover}`);
      }
    }
    expect(low).toEqual([]);
  });
});
