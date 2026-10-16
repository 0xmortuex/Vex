// T2-028: scripts/check-a11y-gate.js, the accessibility checks that need no running app.
import { describe, it, expect } from 'vitest';

const G = require('../../scripts/check-a11y-gate.js');

describe('colour', () => {
  it('measures contrast the WCAG way', () => {
    expect(G.contrast(G.parseHex('#000'), G.parseHex('#fff'))).toBeCloseTo(21, 1);
    expect(G.contrast(G.parseHex('#777777'), G.parseHex('#ffffff'))).toBeCloseTo(4.48, 1);
    expect(G.parseHex('rgba(0,0,0,.5)')).toBe(null);
  });
  it('reads theme blocks and flags a pair under 4.5', () => {
    const css = ':root { --vex-text-primary: #111; --vex-bg-base: #fff; }\n[data-theme="dim"] { --vex-text-primary: #888; --vex-bg-base: #999999; --vex-text-muted: #777; --vex-bg-deep: #fff; }';
    const found = G.contrastFindings(G.themeTokens([css]));
    expect(found.map(f => f.key)).toEqual(['dim|text-primary|bg-base', 'dim|text-primary|bg-deep', 'dim|text-muted|bg-base', 'dim|text-muted|bg-deep']);
  });
  it('a listed pair may not get worse and an unlisted one may not fail', () => {
    const found = [{ key: 'a|text-muted|bg-base', theme: 'a', fg: 'text-muted', bg: 'bg-base', ratio: 3.9, min: 4.5 }];
    expect(G.applyBaseline(found, { 'a|text-muted|bg-base': 3.9 }).bad).toEqual([]);
    expect(G.applyBaseline(found, { 'a|text-muted|bg-base': 4.2 }).bad[0].message).toMatch(/got worse/);
    expect(G.applyBaseline(found, {}).bad[0].message).toMatch(/not in the baseline/);
    expect(G.applyBaseline([], { 'a|text-muted|bg-base': 3.9 }).improved).toEqual(['a|text-muted|bg-base']);
  });
});

describe('structure rules', () => {
  it('a11y.css must be the last sheet', () => {
    expect(G.sheetOrder('<link rel="stylesheet" href="css/a.css"><link rel="stylesheet" href="css/a11y.css">')).toEqual([]);
    expect(G.sheetOrder('<link rel="stylesheet" href="css/a11y.css"><link rel="stylesheet" href="css/late.css">')[0].message).toMatch(/last style sheet/);
  });
  it('needs a reduced-motion rule that shortens animations and transitions on every element', () => {
    const ok = '@media (prefers-reduced-motion: reduce) {\n  *,\n  *::before {\n    animation-duration: 0.01ms !important;\n    transition-duration: 0.01ms !important;\n  }\n}';
    expect(G.motionRule(ok)).toEqual([]);
    expect(G.motionRule('body{}').map(f => f.message)[0]).toMatch(/no prefers-reduced-motion/);
    expect(G.motionRule(ok.replace('transition-duration: 0.01ms !important;', '')).map(f => f.message).join()).toMatch(/transitions/);
  });
  it('needs a focus outline with !important and flags a sheet that removes it', () => {
    expect(G.focusRule(':focus-visible { outline: 2px solid red !important; }')).toEqual([]);
    expect(G.focusRule(':focus-visible { outline: 2px solid red; }')).toHaveLength(1);
    expect(G.focusRemovals('look.css', 'button:focus-visible { outline: none !important; }')).toHaveLength(1);
    expect(G.focusRemovals('look.css', 'button:focus-visible { outline: none; }')).toEqual([]);
    expect(G.focusRemovals('look.css', 'body #url-input:focus-visible { outline: none !important; }')).toEqual([]);
  });
  it('a look may not force motion back on with !important', () => {
    expect(G.lookMotion('g.css', '@media (prefers-reduced-motion: no-preference) {\n a { animation-duration: 1s !important; }\n}')).toHaveLength(1);
    expect(G.lookMotion('g.css', 'a { animation-duration: 1s; }')).toEqual([]);
  });
});

describe('the real sheets', () => {
  it('pass across the three looks and every theme, against the baseline', () => {
    const r = G.run();
    expect(r.findings).toEqual([]);
    expect(r.looks.sort()).toEqual(['classic', 'firefox', 'glass']);
    expect(r.themes).toBeGreaterThan(30);
  });
});
