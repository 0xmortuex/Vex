// Glass is a dark frosted look. With a LIGHT colour theme (Oxford, Firefox
// Light, Paper Red ...) it kept that theme's dark navy/red/green inks, which
// sat at 1.1-3.1:1 on the dark glass, and its muted grey was 3.0:1 over
// Cyberpunk's yellow-tinted glass (cat-themes TH1). Glass now lifts a light
// theme's accent and status colours, and its muted text reads everywhere.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

const glass = fs.readFileSync(path.join(T.ROOT, 'src/renderer/css/gui-glass.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (sel) => {
  const i = glass.indexOf(sel + ' {');
  if (i < 0) throw new Error('no block ' + sel);
  return glass.slice(i, glass.indexOf('}', i));
};
const base = block('body[data-gui-style="glass"]');
const light = block('html[data-scheme="light"] body[data-gui-style="glass"]');
const tok = (src, k) => { const m = new RegExp('(?:^|[;\\s])' + k + ':\\s*([^;]+);').exec(src); if (!m) throw new Error('no ' + k); return m[1].trim(); };

const rgb = (h) => { const c = T.hex(h); return [c.r, c.g, c.b]; };
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));
const toHex = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
// "color-mix(in srgb, var(--g-accent) 12%, #07080f)" -> the colour for accent A
const evalMix = (expr, A) => {
  const m = /color-mix\(in srgb, var\(--g-(?:accent|src-accent)\) (\d+)%, (#[0-9a-f]{6})\)/i.exec(expr);
  if (!m) throw new Error('not a glass mix: ' + expr);
  return toHex(mix(rgb(A), rgb(m[2]), Number(m[1]) / 100));
};
// Every surface Glass paints text on, for a theme whose accent is A: the
// tinted bases, then the frosted white layers (up to the active tab's 20%,
// which holds only the tab title: callers drop every 4th entry for other text).
function surfaces(A) {
  const out = [];
  for (const k of ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--surface', '--bg']) {
    const s = rgb(evalMix(tok(base, k), A));
    for (const ov of [0, 0.06, 0.10, 0.20]) out.push(toHex(mix([255, 255, 255], s, ov)));
  }
  return out;
}
const accentOf = (id) => {
  const a = T.chromeTokens(id)['--vex-accent'];
  if (!T.hex(a) || T.hex(a).a < 1) return null;
  return a;
};
const LIGHT = T.IDS.filter(id => T.ThemeManager.isLight(id));

describe('Glass with a light theme', () => {
  it('knows the light themes', () => {
    expect(LIGHT).toEqual(expect.arrayContaining(['oxford', 'firefox-light', 'contrast-light', 'mica-light', 'paperred', 'ezlight', 'androidbeige']));
    expect(LIGHT).not.toContain('firefox-dark');
    expect(() => T.ThemeManager.isLight('no-such-theme')).toThrow(/unknown theme/);
  });

  it('agrees with Light and dark on which themes are light', () => {
    const { ThemeAuto } = require(path.join(T.ROOT, 'src/renderer/js/theme-auto.js'));
    for (const t of T.ThemeManager.THEMES) expect([t.id, T.ThemeManager.isLight(t.id)]).toEqual([t.id, ThemeAuto.isLightTheme(t)]);
  });

  it('applyTheme marks the page light or dark', () => {
    const attrs = {};
    global.document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, dispatchEvent() {} };
    global.localStorage = { setItem() {}, getItem() { return null; } };
    try {
      T.ThemeManager.applyTheme('paperred', { persist: false });
      expect(attrs['data-scheme']).toBe('light');
      T.ThemeManager.applyTheme('firefox-dark', { persist: false });
      expect(attrs['data-scheme']).toBe('dark');
    } finally { delete global.document; delete global.localStorage; }
  });

  it('lifts the accent, link and status colours to 4.5:1 on every Glass surface', () => {
    const pct = /color-mix\(in srgb, var\(--g-src-accent\) (\d+)%, #ffffff\)/.exec(tok(light, '--g-lift'));
    expect(pct).not.toBeNull();
    const low = [];
    for (const id of LIGHT) {
      const A = accentOf(id); if (!A) continue;
      const lift = toHex(mix(rgb(A), [255, 255, 255], Number(pct[1]) / 100));
      const inks = { '--vex-text-accent': lift, '--vex-danger': tok(light, '--vex-danger'), '--danger': tok(light, '--danger'), '--success': tok(light, '--success'), '--vex-success': tok(light, '--vex-success'), '--warning': tok(light, '--warning') };
      for (const s of surfaces(A).filter((_, i) => i % 4 !== 3)) for (const [k, ink] of Object.entries(inks)) {
        const r = T.ratio(ink, s);
        if (r < 4.5) low.push(`${id}: ${k} ${ink} on ${s} = ${r.toFixed(2)}`);
      }
      const on = tok(light, '--on-primary');
      const r = T.ratio(on, lift);
      if (r < 4.5) low.push(`${id}: --on-primary ${on} on the lifted accent ${lift} = ${r.toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });

  it('keeps the light theme\'s accent as the glow\'s hue (no var() cycle)', () => {
    expect(tok(base, '--g-accent')).toBe('var(--g-src-accent)');
    expect(glass).toMatch(/html \{ --g-src-accent: var\(--vex-accent/);
  });
});

describe('Glass muted text', () => {
  it('reads at 4.5:1 on every Glass surface of every theme', () => {
    const muted = tok(base, '--vex-text-muted');
    const low = [];
    for (const id of T.IDS) {
      const A = accentOf(id); if (!A) continue;
      for (const s of surfaces(A).filter((_, i) => i % 4 !== 3)) { // the 20% active tab holds a title, not muted text
        const r = T.ratio(muted, s);
        if (r < 4.5) low.push(`${id}: ${muted} on ${s} = ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });
});
