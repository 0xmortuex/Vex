// Theme packs and their designs stay readable: the token pairs a pack's colours and its design put on screen are checked at WCAG levels
// (4.5:1 text, 3:1 icons and indicators) for every pack, and the stylesheets are checked for the things a token test cannot see.
// The real-Chromium measurements (every theme and pack, Firefox and Classic) are in the commit message of the readability change.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

const src = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer', f), 'utf8');
const { VexThemePacks } = require('../../src/renderer/js/theme-packs.js');
const PACKS = VexThemePacks.PACKS;
const DESIGNS = VexThemePacks.DESIGNS;

const rgb = (v) => { const c = T.hex(v); return c ? { r: c.r, g: c.g, b: c.b, a: c.a } : null; };
const mix = (a, b, p) => ({ r: a.r * p + b.r * (1 - p), g: a.g * p + b.g * (1 - p), b: a.b * p + b.b * (1 - p), a: 1 });
const BLACK = { r: 0, g: 0, b: 0, a: 1 }, WHITE = { r: 255, g: 255, b: 255, a: 1 };

describe('theme pack contrast', () => {
  it('reads the packs and designs from the module', () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(8);
    expect(DESIGNS.length).toBeGreaterThanOrEqual(10);
  });

  it('every pack: muted text (also the placeholder colour) reads at 4.5:1 on the surfaces inputs sit on', () => {
    const low = [];
    for (const p of PACKS) {
      const t = T.chromeTokens(p.colours);
      const base = rgb(t['--vex-bg-base']);
      for (const s of ['--surface', '--bg', '--vex-glass-strong', '--vex-glass-input']) {
        const bg = rgb(t[s]); if (!bg) continue;
        const under = bg.a < 1 ? T.over(bg, base) : bg;
        const r = T.ratio(rgb(t['--text-muted']), under);
        if (r < 4.5) low.push(`${p.id}/${p.colours}: --text-muted on ${s} = ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('every pack: the accent (underline, outline surface, active marks) reads at 3:1 on the surface and the page', () => {
    const low = [];
    for (const p of PACKS) {
      const t = T.chromeTokens(p.colours);
      for (const s of ['--surface', '--bg']) {
        const r = T.ratio(rgb(t['--primary']), rgb(t[s]));
        if (r < 3) low.push(`${p.id}/${p.colours}: --primary on ${s} = ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('every pack: the text colour on a glass panel (88% surface over the worst page behind it) reads at 4.5:1', () => {
    const low = [];
    for (const p of PACKS.filter(x => DESIGNS.find(d => d.id === x.design)?.surface === 'glass')) {
      const t = T.chromeTokens(p.colours);
      for (const behind of [BLACK, WHITE]) {
        const bg = mix(rgb(t['--surface']), behind, 0.88);
        const r = T.ratio(rgb(t['--text']), bg);
        if (r < 4.5) low.push(`${p.id}/${p.colours}: --text on glass over ${behind.r ? 'white' : 'black'} = ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('every pack: the text on a Soft active tab (16% accent tint) reads at 4.5:1', () => {
    const low = [];
    for (const p of PACKS) {
      const t = T.chromeTokens(p.colours);
      const tint = mix(rgb(t['--primary']), rgb(t['--surface']), 0.16);
      const r = T.ratio(rgb(t['--text']), tint);
      if (r < 4.5) low.push(`${p.id}/${p.colours}: --text on soft active tab = ${r.toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });
});

describe('the stylesheets', () => {
  const css = src('css/theme-packs.css').replace(/\/\*[\s\S]*?\*\//g, '');
  it('a design never sets a fixed text or background colour (only theme tokens, so every theme stays readable)', () => {
    const designPart = css.slice(0, css.indexOf('.vpk-backdrop'));
    const bad = [...designPart.matchAll(/(^|[;{\s])(color|background|background-color)\s*:\s*([^;}]+)/g)].map(m => m[3].trim())
      .filter(v => /#[0-9a-f]{3,8}\b|rgba?\(|hsl/i.test(v));
    expect(bad).toEqual([]);
  });

  it('the placeholder takes the theme\'s muted text colour, at full strength', () => {
    expect(css).toMatch(/::placeholder\s*\{\s*color:\s*var\(--text-muted[^;]*;\s*opacity:\s*1/);
  });

  it('accent TEXT uses the readable accent token, not the raw accent (the logo, the Notes tab, the all-features button)', () => {
    expect(src('css/app.css')).toMatch(/#vex-logo\s*\{[^}]*color:\s*var\(--vex-text-accent/);
    expect(src('css/notes-panel.css')).toMatch(/\.notes-section-tab\.active\s*\{[^}]*color:\s*color-mix\([^;]*--vex-text-accent/);
    expect(src('css/simple-mode.css')).toMatch(/#btn-all-features svg\s*\{\s*color:\s*var\(--vex-text-accent/);
  });

  it('muted notes text and counters are not dimmed a second time with opacity', () => {
    const notes = src('css/notes-panel.css');
    expect(notes).not.toMatch(/\.notes-list-empty \.hint\s*\{[^}]*opacity/);
    expect(notes).not.toMatch(/\.notes-count\s*\{[^}]*opacity/);
  });
});
