// High Contrast Light had no dark partner: someone who needs high contrast and
// a dark screen (light sensitivity, night) had to settle for AMOLED at 4.5:1
// (cat-themes gaps). High Contrast Dark is white on black at 7:1 or more.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');
const { ThemeAuto } = require('../../src/renderer/js/theme-auto.js');

const SURFACES = ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-tab-active', '--vex-glass-input', '--bg', '--bg-2', '--surface', '--tab-active', '--tab-hover'];
const TEXT = ['--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent', '--vex-accent', '--text', '--text-muted', '--vex-success', '--vex-danger', '--vex-warning', '--danger', '--success', '--warning'];

describe('High Contrast Dark', () => {
  const p = T.chromeTokens('contrast-dark');
  const page = T.startTokens('contrast-dark');

  it('is a registered dark theme, on the New Tab too', () => {
    expect(T.IDS).toContain('contrast-dark');
    expect(T.ThemeManager.isLight('contrast-dark')).toBe(false);
    expect(T.ThemeManager.getThemeMeta('contrast-dark').accent).toBe(p['--vex-accent']);
    const list = JSON.parse(T.startHtml.match(/const VEX_THEMES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
    expect(list).toContain('contrast-dark');
  });

  it('every text colour reads at 7:1 or more on every surface, in the window and on the New Tab', () => {
    const low = [];
    for (const t of TEXT) for (const s of SURFACES) {
      const r = T.ratio(p[t], p[s]);
      if (r < 7) low.push(`${t} ${p[t]} on ${s} ${p[s]} = ${r.toFixed(2)}`);
    }
    for (const t of ['--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-accent'])
      for (const s of ['--vex-bg-base', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-input']) {
        const r = T.ratio(page[t], page[s]);
        if (r < 7) low.push(`New Tab ${t} on ${s} = ${r.toFixed(2)}`);
      }
    expect(low).toEqual([]);
  });

  it('buttons read at 7:1, every border is a visible line, and the focus ring is thick', () => {
    expect(T.ratio(p['--on-primary'], p['--primary'])).toBeGreaterThanOrEqual(7);
    expect(T.ratio(p['--on-primary'], p['--primary-hover'])).toBeGreaterThanOrEqual(7);
    for (const b of ['--vex-border-subtle', '--vex-border-medium', '--vex-border-strong', '--border']) expect(T.ratio(p[b], p['--vex-bg-elevated']), b).toBeGreaterThanOrEqual(4.5);
    expect(T.tokensCss).toMatch(/html\[data-theme="contrast-dark"\] :focus-visible:not\(webview\) \{\s*outline: 3px solid #8ec5ff !important;/);
  });

  it('pairs with High Contrast Light in Light and dark', () => {
    expect(ThemeAuto.defaultSlots('contrast-dark', T.ThemeManager.THEMES)).toEqual({ light: 'contrast-light', dark: 'contrast-dark' });
  });
});
