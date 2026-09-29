// @vitest-environment jsdom
//
// The four styles after popular BetterDiscord themes (added 2026-09-29):
// Fluent (light and dark), Glossy, Neobrutal and Terminal. They are browser-
// family looks, so each one must be registered in gui-style.js, give every
// --b-* token the shared rules read (a missing one leaves a surface
// unpainted and makes the New Tab palette throw), be pickable in Settings and
// in the setup wizard, and shape the New Tab page.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../src/renderer');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const STYLES = ['fluent', 'fluent-dark', 'glossy', 'neobrutal', 'terminal'];

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
const { Onboarding } = require('../../src/renderer/js/onboarding.js');

// Every --b-* token a look block defines, keyed by look. Only blocks whose
// selector is body itself count (not a descendant rule, not theme mode).
function lookTokens(css) {
  const out = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!/^body(\[data-gui-style="[^"]+"\]|:is\((\s*\[data-gui-style="[^"]+"\],?)+\))$/.test(sel)) continue;
    const looks = [...sel.matchAll(/data-gui-style="([^"]+)"/g)].map((x) => x[1]);
    const vars = [...m[2].matchAll(/(--b-[a-z0-9-]+)\s*:/g)].map((x) => x[1]);
    for (const l of looks) { const set = (out[l] ||= new Set()); vars.forEach((v) => set.add(v)); }
  }
  return out;
}

describe('the styles are registered looks', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="top-bar"></div><div id="top-tab-bar"><div class="tab-bar-trailing"></div></div><div id="top-bar-right"></div>';
    for (const a of ['data-gui-style', 'data-gui-family', 'data-gui-colors', 'data-sb-side', 'data-sb-launcher']) document.body.removeAttribute(a);
    window.showToast = vi.fn();
  });

  it('each one is a browser-family look with its own sidebar', async () => {
    vi.resetModules();
    await import('../../src/renderer/js/gui-style.js');
    const G = window.VexGuiStyle;
    for (const s of STYLES) {
      expect(G.styles()).toContain(s);
      await G.set(s);
      expect(document.body.dataset.guiStyle).toBe(s);
      expect(document.body.dataset.guiFamily).toBe('browser');
      expect(G.isBrowserLook()).toBe(true);
      expect(['left', 'right']).toContain(document.body.dataset.sbSide);
      expect(['rail', 'toolbar']).toContain(document.body.dataset.sbLauncher);
    }
  });
});

describe('gui-browser.css gives each style the whole palette', () => {
  const css = read('css/gui-browser.css');
  const tokens = lookTokens(css);

  it('defines every token all the browser looks define', () => {
    // The tokens every existing look sets are the ones the shared rules read
    // without a fallback; optional ones (a tab separator...) vary.
    const browsers = ['chrome', 'chrome-dark', 'firefox', 'firefox-dark', 'safari', 'xp', 'win98'];
    const reference = new Set([...tokens.chrome].filter((v) => browsers.every((b) => tokens[b].has(v))));
    expect(reference && reference.size).toBeGreaterThan(30);
    for (const s of STYLES) {
      const missing = [...reference].filter((v) => !tokens[s] || !tokens[s].has(v));
      expect({ style: s, missing }).toEqual({ style: s, missing: [] });
    }
  });

  it('every token the styles read is defined for them', () => {
    // --b-* read by a style's own rules (var(--b-x) with no fallback).
    for (const s of STYLES) {
      const own = css.split('\n').filter((l) => l.includes(`data-gui-style="${s}"`) || (s.startsWith('fluent') && l.includes('data-gui-style="fluent-dark"')));
      const used = new Set(own.join('\n').match(/var\(--b-[a-z0-9-]+\)/g)?.map((v) => v.slice(4, -1)) || []);
      for (const v of used) expect({ style: s, v, ok: tokens[s].has(v) }).toEqual({ style: s, v, ok: true });
    }
  });

  it('has a theme-mode block for each style', () => {
    expect(css).toMatch(/body:is\(\[data-gui-style="fluent"\], \[data-gui-style="fluent-dark"\]\)\[data-gui-colors="theme"\]/);
    for (const s of ['glossy', 'neobrutal', 'terminal']) expect(css).toContain(`body[data-gui-style="${s}"][data-gui-colors="theme"]`);
  });

  it('Terminal numbers its tabs in brackets', () => {
    expect(css).toMatch(/data-gui-style="terminal"\] #top-tabs-list \{ counter-reset: vex-tab; \}/);
    expect(css).toMatch(/content: counter\(vex-tab\) ': '/);
  });
});

describe('the pickers and the New Tab page know the styles', () => {
  it('Settings › GUI Style lists them', () => {
    const html = read('index.html');
    for (const s of STYLES) expect(html).toContain(`<option value="${s}">`);
  });

  it('the setup wizard lists them as styles with their own colour choice', () => {
    const looks = Onboarding.LOOKS();
    for (const s of STYLES) {
      const l = looks.find((x) => x.id === s);
      expect(l && l.styled).toBe(true);
    }
    const body = document.createElement('div');
    localStorage.setItem('vex.guiStyle', 'terminal');
    window.VexGuiStyle = { get: () => 'terminal', getColors: () => 'look', set: vi.fn() };
    Onboarding._renderLook(body);
    for (const s of STYLES) expect(body.querySelector(`[data-look="${s}"]`)).not.toBeNull();
    // The colour row shows for a style, as for a browser look.
    expect(body.querySelector('#ob-look-colors').style.display).toBe('block');
  });

  it('start.html shapes the New Tab page for each', () => {
    const html = read('start.html');
    expect(html).toContain('html[data-look^="fluent"] .search-bar');
    for (const s of ['glossy', 'neobrutal', 'terminal']) expect(html).toContain(`html[data-look="${s}"] .search-bar`);
  });
});
