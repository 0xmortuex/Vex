// The New Tab search box's engine letter was white on the engine's own colour:
// 3.6:1 on Google's blue, 3.3:1 on Brave's orange (cat-themes TH11).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

describe('New Tab engine letter', () => {
  it('sits on the engine colour deepened 20% toward black', () => {
    expect(T.startStyle).toMatch(/\.engine-glyph \{[^}]*color: #fff; background: color-mix\(in srgb, var\(--engine-color, #4285F4\) 80%, #000000\);/);
  });

  it('reads at 4.5:1 for every engine', () => {
    const list = [...T.startHtml.matchAll(/^\s+(\w+):\s+\{ glyph: '\w', color: '(#[0-9a-fA-F]{6})' \}/gm)].map(m => [m[1], m[2]]);
    expect(list.length).toBeGreaterThanOrEqual(6);
    for (const [name, c] of list) {
      const x = T.hex(c);
      const deep = '#' + [x.r, x.g, x.b].map(v => Math.round(v * 0.8).toString(16).padStart(2, '0')).join('');
      expect([name, T.ratio('#ffffff', deep) >= 4.5]).toEqual([name, true]);
    }
  });
});
