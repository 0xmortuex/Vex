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

// "Vex is your default browser" was #22c55e on white, 2.2:1 (check-up
// leftover, 2026-10-08). Success text now comes from the theme's --success,
// and every theme's --success reads at 4.5:1 on its own backgrounds.
describe('success-green text', () => {
  const extra = fs.readFileSync(path.join(dir, 'theme-extra.css'), 'utf8');
  const themes = {};
  for (const src of [tokens, extra]) {
    for (const m of src.matchAll(/(:root|\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g)) {
      const vars = themes[m[2] || 'root'] || (themes[m[2] || 'root'] = {});
      for (const v of m[3].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) vars[v[1]] = v[2];
    }
  }

  it('every theme\'s --success reads at 4.5:1 on its --bg and --surface', () => {
    const low = [];
    for (const [name, vars] of Object.entries(themes)) {
      const get = (k) => vars[k] || themes.root[k];
      const success = get('--success');
      if (!success) continue;
      for (const bg of ['--bg', '--surface']) {
        if (get(bg) && ratio(success, get(bg)) < 4.5) low.push(`${name}: ${success} on ${bg} ${get(bg)} = ${ratio(success, get(bg)).toFixed(2)}`);
      }
    }
    expect(Object.keys(themes).length).toBeGreaterThan(40);
    expect(low).toEqual([]);
  });

  it('no renderer file paints a fixed success green as text', () => {
    const root = path.resolve(__dirname, '../../src/renderer');
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['vendor', 'lib', 'node_modules'].includes(e.name)) walk(p); } else if (/\.(js|css|html)$/.test(e.name) && !/^theme-(tokens|extra)\.css$/.test(e.name)) files.push(p); } };
    walk(root);
    const res = [
      /(^|[^-\w])color:\s*#(?:22c55e|34d399|4ade80)\b/i,             // CSS and inline styles
      /\.style\.color\s*=\s*[^;]*'#(?:22c55e|34d399|4ade80)'/i,       // el.style.color = ...
      /color:\$\{[^}]*'#(?:22c55e|34d399|4ade80)'/i,                  // color:${ok ? '#..' : ..}
    ];
    // The patterns themselves must catch what they are for.
    expect(res[0].test('.x { color: #22c55e; }')).toBe(true);
    expect(res[1].test("el.style.color = ok ? '#22c55e' : 'red';")).toBe(true);
    expect(res[2].test("color:${on ? '#34d399' : 'x'}")).toBe(true);
    const offenders = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (res.some(re => re.test(line))) offenders.push(path.relative(root, f) + ':' + (i + 1));
      });
    }
    expect(offenders).toEqual([]);
  });
});
