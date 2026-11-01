// The Vex mark in the toolbar (#vex-logo) paints itself from theme tokens, so it
// reads on every theme in the two looks that show it (Classic and Glass; the
// browser looks hide it). It had fixed amber and white at 28-52% opacity and
// washed out on light frames (about 1.3 to 2:1).
// Token maths only: var() / color-mix are not resolved here, so a real window is
// still the proof for how the final pixels land.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer', f), 'utf8');
const html = read('index.html');
const appCss = read('css/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
const logo = html.slice(html.indexOf('<span id="vex-logo">'), html.indexOf('</svg>', html.indexOf('<span id="vex-logo">')));

const rgb = (v) => { const c = T.hex(v); return c ? { r: c.r, g: c.g, b: c.b, a: c.a } : null; };
const solidOver = (v, under) => { const c = rgb(v); return c.a < 1 ? T.over(c, under) : { ...c, a: 1 }; };
const mix = (a, b, p) => ({ r: a.r * p + b.r * (1 - p), g: a.g * p + b.g * (1 - p), b: a.b * p + b.b * (1 - p), a: 1 });

// The opacities the stylesheet gives the shading halves.
const rule = (sel) => new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}').exec(appCss)[1];
const opacity = (body) => parseFloat(/fill-opacity:\s*([\d.]+)/.exec(body)[1]);
const SHADE1 = opacity(rule('#vex-logo .vex-logo-shade'));
const SHADE2 = opacity(rule('#vex-logo .vex-logo-shade-2'));

// Everything the mark paints, for one theme in one look: the frame behind it,
// the diamond, the shaded halves and the chevron.
function parts(frame, base, diamond) {
  return {
    frame,
    diamond,
    shade1: mix(base, diamond, SHADE1),
    shade2: mix(base, diamond, SHADE2),
    chevron: base,
  };
}

function classic(id) {
  const t = T.chromeTokens(id);
  const base = solidOver(t['--vex-bg-base'], { r: 0, g: 0, b: 0, a: 1 });
  return parts(solidOver(t['--vex-glass-strong'], base), base, solidOver(t['--vex-text-accent'], base));
}

// Glass: wordmark colour is the theme accent (lifted on a light theme) 45% over #eef0ff,
// on white-6% over a dark base tinted 12% with the accent.
function glass(id) {
  const t = T.chromeTokens(id);
  const src = rgb(t['--vex-accent'] || t['--primary']);
  if (!src) return null;
  const light = T.ThemeManager.isLight ? T.ThemeManager.isLight(id) : false;
  const accent = light ? mix(src, { r: 255, g: 255, b: 255, a: 1 }, 0.30) : src;
  const base = mix(src, { r: 7, g: 8, b: 15, a: 1 }, 0.12);
  const frame = T.over({ r: 255, g: 255, b: 255, a: 0.06 }, base);
  return parts(frame, base, mix(accent, { r: 238, g: 240, b: 255, a: 1 }, 0.45));
}

function audit(make) {
  const low = [];
  let worstMark = Infinity, worstChev = Infinity, n = 0;
  for (const id of T.IDS) {
    const p = make(id);
    if (!p) continue;
    n++;
    for (const k of ['diamond', 'shade1', 'shade2']) {
      const r = T.ratio(p[k], p.frame);
      worstMark = Math.min(worstMark, r);
      if (r < 3) low.push(`${id}: ${k} on frame = ${r.toFixed(2)}`);
      const c = T.ratio(p.chevron, p[k]);
      worstChev = Math.min(worstChev, c);
      if (c < 3) low.push(`${id}: chevron on ${k} = ${c.toFixed(2)}`);
    }
  }
  return { low, worstMark, worstChev, n };
}

describe('the toolbar mark reads on every theme and look', () => {
  it('Classic: diamond and its shading at 3:1 on the bar, chevron at 3:1 on the diamond', () => {
    const r = audit(classic);
    expect(r.n).toBeGreaterThanOrEqual(68);
    expect(r.low).toEqual([]);
  });

  it('Glass: the same, on the frosted bar', () => {
    const r = audit(glass);
    expect(r.n).toBeGreaterThanOrEqual(68);
    expect(r.low).toEqual([]);
  });
});

describe('the mark markup', () => {
  it('keeps no hard-coded brand colour or opacity in the SVG attributes', () => {
    expect(logo).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(logo).not.toMatch(/(?:fill|stroke)-opacity|stop-color|<linearGradient|url\(#/i);
  });

  it('drives every colour from the stylesheet, with no #d4a574 / #ffffff except as a var() fallback', () => {
    for (const cls of ['vex-logo-body', 'vex-logo-shade', 'vex-logo-chev']) {
      expect(logo).toContain(cls);
      expect(appCss).toContain('#vex-logo .' + cls);
    }
    const bare = appCss.replace(/var\([^()]*\)/g, '');
    const block = bare.split('\n').filter(l => l.includes('.vex-logo-')).join('\n');
    expect(block).not.toMatch(/#d4a574|#ffffff|#fff\b/i);
  });

  it('tells scripts/check-ui.js what the mark paints with: the diamond declares currentColor', () => {
    // check:ui reads an icon's paint from its fill/stroke attributes; with none it assumed the default black and
    // reported the logo as 1.1:1 on every dark theme (CI, 2026-11-01).
    expect(logo).toMatch(/class="vex-logo-body"[^>]*fill="currentColor"/);
    expect(logo).toMatch(/class="vex-logo-body"[^>]*stroke="currentColor"/);
  });

  it('keeps the silhouette: the diamond, two halves and the chevron path', () => {
    expect(logo).toContain('points="40,12 68,40 40,68 12,40"');
    expect(logo).toContain('points="40,12 68,40 40,40"');
    expect(logo).toContain('points="40,12 12,40 40,40"');
    expect(logo).toContain('d="M 26 38 L 40 56 L 54 38"');
  });
});
