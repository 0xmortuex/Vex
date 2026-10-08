// @vitest-environment jsdom
//
// Item #5 (2026-10-08): themes that fill real gaps - AMOLED made true black,
// High Contrast Light, Evening (warm, dim, low blue light) and Windows 11's
// Mica as a light/dark pair. Each is held to its promise here: real readable
// numbers, the right side in Light and dark, and the same colours on the New
// Tab page as in the window.
import { describe, it, expect, vi } from 'vitest';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, 'src', 'renderer', p), 'utf8');
const EXTRA_CSS = read('css/theme-extra.css');
const START = read('start.html');

function blocks(css) {
  const out = new Map();
  for (const m of css.matchAll(/\[data-theme="([\w-]+)"\]\s*\{([^}]*)\}/g)) {
    const props = out.get(m[1]) || {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) props[d[1]] = d[2].trim().toLowerCase();
    out.set(m[1], props);
  }
  return out;
}
const CHROME = blocks(EXTRA_CSS);
const PAGE = blocks(START);

const rgb = (v) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v || '');
  if (!m) throw new Error(`not a 6-digit hex colour: ${v}`);
  return m[1].match(/../g).map(x => parseInt(x, 16));
};
const lum = (v) => rgb(v).map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

async function load() {
  vi.resetModules();
  const TM = (await import('../../src/renderer/js/theme-manager.js')).ThemeManager;
  globalThis.ThemeManager = TM;
  const TA = (await import('../../src/renderer/js/theme-auto.js')).ThemeAuto;
  return { TM, TA };
}

const NEW = ['contrast-light', 'evening', 'mica-light', 'mica-dark'];
const TEXT = ['--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent',
  '--vex-success', '--vex-danger', '--vex-warning', '--text', '--text-muted', '--success', '--danger', '--warning'];
const SURFACES = ['--vex-bg-base', '--vex-bg-deep', '--vex-bg-elevated', '--vex-glass-tab-active', '--vex-glass-input', '--bg', '--bg-2', '--surface', '--tab-active', '--tab-hover'];

describe('themes for a need', () => {
  it('are registered, with a chrome block, a New Tab block and a place in VEX_THEMES', async () => {
    const { TM } = await load();
    const list = JSON.parse(START.match(/const VEX_THEMES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
    for (const id of NEW) {
      expect(TM.availableThemes, id).toContain(id);
      expect(CHROME.has(id), id).toBe(true);
      expect(PAGE.has(id), id).toBe(true);
      expect(list, id).toContain(id);
      expect(TM.getThemeMeta(id).accent).toBe(CHROME.get(id)['--vex-accent']);
    }
  });

  it('every text colour reads at 4.5:1 or better on every surface of its theme', () => {
    const low = [];
    for (const id of [...NEW, 'amoled']) {
      const p = CHROME.get(id);
      for (const t of TEXT) for (const s of SURFACES) {
        if (!p[t] || !p[s]) continue;
        const r = contrast(p[t], p[s]);
        if (r < 4.5) low.push(`${id} ${t} ${p[t]} on ${s} ${p[s]} = ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('text on the primary colour, and on its hover colour, reads at 4.5:1', () => {
    for (const id of [...NEW, 'amoled']) {
      const p = CHROME.get(id);
      const on = p['--on-primary'] || '#ffffff';
      expect(contrast(on, p['--primary']), `${id} primary`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(on, p['--primary-hover']), `${id} primary hover`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the New Tab page wears the same colours as the window', () => {
    for (const id of [...NEW, 'amoled']) {
      const c = CHROME.get(id), pg = PAGE.get(id);
      for (const k of ['--vex-bg-base', '--vex-accent', '--vex-text-primary', '--vex-text-secondary', '--vex-text-muted',
        '--vex-border-subtle', '--vex-border-medium', '--vex-border-strong']) {
        expect(pg[k], `${id} ${k}`).toBe(c[k]);
      }
      expect(pg['--on-primary'] || '#ffffff', `${id} --on-primary`).toBe(c['--on-primary'] || '#ffffff');
    }
  });

  it('High Contrast Light: body text at 7:1 or more everywhere, real borders, a thick focus ring', () => {
    const p = CHROME.get('contrast-light');
    for (const t of ['--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent', '--text', '--text-muted', '--vex-accent'])
      for (const s of SURFACES) expect(contrast(p[t], p[s]), `${t} on ${s}`).toBeGreaterThanOrEqual(7);
    // Even the faintest border is a line you can see (WCAG non-text 3:1).
    for (const b of ['--vex-border-subtle', '--vex-border-medium', '--vex-border-strong', '--border'])
      expect(contrast(p[b], p['--vex-bg-base']), b).toBeGreaterThanOrEqual(4.5);
    expect(EXTRA_CSS).toMatch(/html\[data-theme="contrast-light"\] :focus-visible:not\(webview\) \{\s*outline: 3px solid #0037a6 !important;/);
    expect(contrast('#0037a6', '#ffffff')).toBeGreaterThanOrEqual(7);
  });

  it('Evening is warm and low in blue light: blue is the weakest channel in every colour', () => {
    const p = CHROME.get('evening');
    const cool = [];
    for (const [k, v] of Object.entries(p)) {
      const m = /^#[0-9a-f]{6}/.exec(v);
      if (!m) continue;
      const [r, g, b] = rgb(m[0]);
      if (!(b < r && b < g)) cool.push(`${k} ${v}`);
    }
    expect(cool).toEqual([]);
    // Dim, not glaring: the text is parchment, well short of white.
    expect(lum(p['--vex-text-primary'])).toBeLessThan(0.65);
  });

  it('AMOLED is true black: frame, page, panels, menus and dialogs are #000000', () => {
    const p = CHROME.get('amoled');
    for (const k of ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-strong', '--vex-glass-medium',
      '--vex-glass-light', '--vex-glass-input', '--bg', '--bg-2', '--sidebar', '--surface']) expect(p[k], k).toBe('#000000');
    for (const k of ['--vex-bg-base', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-input'])
      expect(PAGE.get('amoled')[k], `New Tab ${k}`).toBe('#000000');
    // With no lighter layer, a menu or dialog is told apart by its border.
    expect(contrast(p['--vex-border-medium'], '#000000')).toBeGreaterThanOrEqual(2);
  });

  it('Light and dark sorts each one onto the right side and lists it there', async () => {
    const { TM, TA } = await load();
    const side = (id) => TA.isLightTheme(TM.getThemeMeta(id));
    expect(side('contrast-light')).toBe(true);
    expect(side('mica-light')).toBe(true);
    expect(side('evening')).toBe(false);
    expect(side('mica-dark')).toBe(false);
    expect(side('amoled')).toBe(false);
    // The light ones carry their own hover and shadow (the shared ones are for dark).
    for (const id of ['contrast-light', 'mica-light']) expect(CHROME.get(id)['--vex-hover-fill'], id).toBeTruthy();
    for (const id of ['evening', 'mica-dark']) expect(CHROME.get(id)['--vex-hover-fill'], id).toBeUndefined();

    document.body.innerHTML = '<select id="setting-theme-auto-mode"><option value="off">Off</option><option value="system">System</option><option value="schedule">Schedule</option><option value="sun">Sun</option></select>'
      + '<select id="setting-theme-light"></select><select id="setting-theme-dark"></select>'
      + '<input id="setting-theme-dark-from"><input id="setting-theme-dark-to">';
    TA.wireSettings();
    const opts = (sel, group) => [...document.querySelector(`${sel} optgroup[label="${group}"]`).querySelectorAll('option')].map(o => o.value);
    for (const sel of ['#setting-theme-light', '#setting-theme-dark']) {
      expect(opts(sel, 'Light themes')).toEqual(expect.arrayContaining(['contrast-light', 'mica-light']));
      expect(opts(sel, 'Dark themes')).toEqual(expect.arrayContaining(['evening', 'mica-dark', 'amoled']));
    }
  });

  // The New Tab page's own text, measured live on 2026-10-08 against what it
  // is drawn on: the wordmark (a pale gradient at 85% opacity) read 2.0:1 to
  // 4.1:1, the search engine's letter 3.6:1, and Mica Dark's muted labels 4.2:1
  // where the accent glow is strongest. Each text colour the page uses is held
  // here against every surface it sits on, the glow composited in.
  describe('New Tab page text', () => {
    const MIN = (id) => (id === 'contrast-light' ? 7 : 4.5);
    const mix = (fg, bg, a) => '#' + rgb(fg).map((c, i) => Math.round(c * a + rgb(bg)[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
    const pageSurfaces = (p) => {
      const base = ['--vex-bg-base', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-input'].map(k => p[k]);
      // The two radial glows peak at the accent-glow colour over the page.
      const glow = /^#[0-9a-f]{8}$/.exec(p['--vex-accent-glow'] || '');
      const g = glow ? [mix(glow[0].slice(0, 7), p['--vex-bg-base'], parseInt(glow[0].slice(7), 16) / 255)] : [];
      return [...base, ...g];
    };
    const GLOWLESS = ['amoled', 'contrast-light'];

    it('body, secondary and muted text and the accent (links, wordmark, verse reference) read on every surface', () => {
      const low = [];
      for (const id of [...NEW, 'amoled']) {
        const p = PAGE.get(id);
        const surfaces = GLOWLESS.includes(id) ? pageSurfaces(p).slice(0, 5) : pageSurfaces(p);
        for (const t of ['--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-accent'])
          for (const s of surfaces) { const r = contrast(p[t], s); if (r < MIN(id)) low.push(`${id} ${t} on ${s} = ${r.toFixed(2)}`); }
      }
      expect(low).toEqual([]);
    });

    it('the wordmark is the solid accent at full strength, not the pale gradient', () => {
      const rule = /html:is\(([^)]*)\) \.vex-wordmark \{([^}]*)\}/.exec(START);
      expect(rule).toBeTruthy();
      for (const id of [...NEW, 'amoled']) expect(rule[1], id).toContain(`[data-theme="${id}"]`);
      expect(rule[2]).toMatch(/background: none;/);
      expect(rule[2]).toMatch(/-webkit-text-fill-color: var\(--vex-accent\);/);
      expect(rule[2]).toMatch(/opacity: 1;/);
    });

    it('the search engine\'s white letter reads on its deepened brand colour (7:1 and more)', () => {
      const look = /const ENGINE_LOOK = \{([\s\S]*?)\};/.exec(START)[1];
      const colours = [...look.matchAll(/color: '(#[0-9a-fA-F]{6})'/g)].map(m => m[1].toLowerCase());
      expect(colours.length).toBeGreaterThanOrEqual(6);
      const rule = /\) \.engine-glyph \{\s*background: color-mix\(in srgb, var\(--engine-color, #4285F4\) (\d+)%, #000000\);/.exec(START);
      expect(rule).toBeTruthy();
      const keep = Number(rule[1]) / 100;
      for (const c of colours) expect(contrast('#ffffff', mix(c, '#000000', keep)), c).toBeGreaterThanOrEqual(7);
      // The colour comes from --engine-color, so the rule above can reach it.
      expect(START).toContain("engineGlyph.style.setProperty('--engine-color', e.color)");
      expect(START).not.toMatch(/engineGlyph\.style\.background =/);
    });
  });

  it('the New Tab drops its accent glow under AMOLED and High Contrast Light', () => {
    expect(START).toMatch(/html:is\(\[data-theme="amoled"\], \[data-theme="contrast-light"\]\) body \{ background-image: none; \}/);
  });

  it('under Glass the New Tab lifts a dark accent so its text reads on the dark glass', () => {
    // High Contrast Light's #0037a6 was 1.6:1 there (2026-10-08).
    const glassBody = /html\[data-gui-style="glass"\] body \{([^}]*)\}/.exec(START)[1];
    expect(glassBody).toContain('--vex-accent: oklch(from var(--g-accent) max(l, 0.72) c h);');
    expect(glassBody).toContain('--on-primary: #07080f;');
    // The glass's own colour, from --g-accent, still the theme's own accent.
    expect(START).toMatch(/html\[data-gui-style="glass"\] \{[^}]*--g-accent: var\(--vex-accent, #8b8bf5\);/);
  });

  it('Mica Light and Mica Dark are each other\'s partner in Light and dark', async () => {
    const { TM, TA } = await load();
    expect(TA.defaultSlots('mica-light', TM.THEMES)).toEqual({ light: 'mica-light', dark: 'mica-dark' });
    expect(TA.defaultSlots('mica-dark', TM.THEMES)).toEqual({ light: 'mica-light', dark: 'mica-dark' });
    // The others start from Vex's defaults for the other side.
    expect(TA.defaultSlots('contrast-light', TM.THEMES)).toEqual({ light: 'contrast-light', dark: 'firefox-dark' });
    expect(TA.defaultSlots('evening', TM.THEMES)).toEqual({ light: 'oxford', dark: 'evening' });
  });
});
