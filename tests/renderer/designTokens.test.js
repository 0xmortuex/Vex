import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// css/design-tokens.css is the one place the spacing, type, elevation and motion scale lives.
// Rendering is checked in real Chromium (scripts, not here); this only guards the wiring: every
// scale token a sheet reads is defined, and the file sits in the right place in the cascade.
const RENDERER = path.resolve(__dirname, '../../src/renderer');
const CSS = path.join(RENDERER, 'css');
const read = (p) => fs.readFileSync(p, 'utf8');
const SCALE = /--vex-(?:space|fs|fw|lh|elev|dur|ease|icon)-[a-z0-9-]+|--vex-radius-(?:xl|pill)/g;

describe('design tokens', () => {
  const tokensCss = read(path.join(CSS, 'design-tokens.css'));
  const defined = new Set([...tokensCss.matchAll(/^\s*(--vex-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

  it('defines the scale', () => {
    for (const name of ['--vex-space-1', '--vex-space-4', '--vex-fs-base', '--vex-elev-1', '--vex-elev-4', '--vex-dur-fast', '--vex-ease-out', '--vex-icon-stroke', '--vex-radius-xl']) {
      expect(defined.has(name), name).toBe(true);
    }
  });

  it('every scale token a stylesheet or page reads is defined', () => {
    const files = fs.readdirSync(CSS).filter((f) => f.endsWith('.css')).map((f) => path.join(CSS, f));
    files.push(path.join(RENDERER, 'index.html'), path.join(RENDERER, 'start.html'));
    const missing = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/var\(\s*(--vex-[a-z0-9-]+)/g)) {
        if (SCALE.test(m[1]) && !defined.has(m[1])) missing.push(path.basename(f) + ' ' + m[1]);
        SCALE.lastIndex = 0;
      }
    }
    expect(missing).toEqual([]);
  });

  it('elevation reads the theme shadow colour, never a fixed black', () => {
    const elev = [...tokensCss.matchAll(/--vex-elev-\d:([^;]+);/g)].map((m) => m[1]);
    expect(elev).toHaveLength(4);
    for (const e of elev) {
      expect(e).toContain('--vex-shadow-color');
      expect(e).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.[4-9]/);
    }
  });

  it('index.html loads it after the feature sheets, before the looks, and a11y.css stays last', () => {
    const links = [...read(path.join(RENDERER, 'index.html')).matchAll(/<link rel="stylesheet" href="css\/([^"]+)">/g)].map((m) => m[1]);
    expect(links.at(-1)).toBe('a11y.css');
    expect(links.indexOf('design-tokens.css')).toBeGreaterThan(links.indexOf('app.css'));
    expect(links.indexOf('design-tokens.css')).toBeLessThan(links.indexOf('gui-browser.css'));
  });

  it('start.html loads it', () => {
    expect(read(path.join(RENDERER, 'start.html'))).toContain('href="css/design-tokens.css"');
  });

  it('new motion is behind prefers-reduced-motion: no-preference', () => {
    const idx = tokensCss.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(idx).toBeGreaterThan(-1);
    expect(tokensCss.slice(idx)).toContain('transition-property');
    expect(tokensCss.slice(0, idx)).not.toMatch(/\btransition\s*:|\banimation\s*:/);
  });
});
