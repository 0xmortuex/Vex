// Dracula's primary buttons were white on #bd93f9, 2.4:1 (walkthrough M3,
// 2026-10-07). Text on a --primary fill now comes from --on-primary: white by
// default, Dracula's own background in Dracula.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.resolve(__dirname, '../../src/renderer/css');
const tokens = fs.readFileSync(path.join(dir, 'theme-tokens.css'), 'utf8');

const lum = (hex) => {
  const h = hex.replace('#', '');
  const v = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('text on a primary fill', () => {
  it('Dracula reads at 4.5:1 or better', () => {
    const block = /\[data-theme="dracula"\]\s*\{([^}]*)\}/.exec(tokens)[1];
    const primary = /--primary:\s*(#[0-9a-f]{6})/i.exec(block)[1];
    const hover = /--primary-hover:\s*(#[0-9a-f]{6})/i.exec(block)[1];
    const on = /--on-primary:\s*(#[0-9a-f]{6})/i.exec(block)[1];
    expect(ratio(primary, on)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hover, on)).toBeGreaterThanOrEqual(4.5);
  });

  it('the default stays white', () => {
    expect(tokens).toMatch(/:root \{[^}]*--on-primary: #ffffff;/);
  });

  it('no stylesheet paints a fixed white on var(--primary) any more', () => {
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.css') && f !== 'vex-dialog.css')) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        if (/background(-color)?:\s*var\(--primary\)/.test(m[2]) && /(^|[;{\s])color:\s*(#fff\b|#ffffff\b|white\b)/i.test(m[2])) offenders.push(f + ': ' + m[1].trim().slice(-60));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('JS-built primary buttons (inline style) are covered by one rule', () => {
    expect(tokens).toContain('[style*="background:var(--primary);color:#fff"]');
  });
});
