// @vitest-environment jsdom
//
// The themes after the popular BetterDiscord themes (added 2026-09-29), and the
// registry rules every theme has to keep: a token block in the chrome CSS AND
// the start page, a place in the start page's VEX_THEMES list (or its
// ?theme= falls back to Oxford), an id the start-page recolor passes through
// unchanged, and readable text.
import { describe, it, expect, vi } from 'vitest';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, 'src', 'renderer', p), 'utf8');
const TOKENS_CSS = read('css/theme-tokens.css');
const EXTRA_CSS = read('css/theme-extra.css');
const START = read('start.html');

async function loadThemeManager() {
  vi.resetModules();
  return (await import('../../src/renderer/js/theme-manager.js')).ThemeManager;
}

// Standalone `[data-theme="x"] { ... }` blocks only, as property -> value.
function blocks(css) {
  const out = new Map();
  const re = /\[data-theme="([\w-]+)"\]\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const props = out.get(m[1]) || {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) props[d[1]] = d[2].trim().toLowerCase();
    out.set(m[1], props);
  }
  return out;
}
const CHROME = new Map([...blocks(TOKENS_CSS), ...blocks(EXTRA_CSS)]);
const PAGE = blocks(START);

const hex = (v) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v || '');
  if (!m) throw new Error(`not a 6-digit hex colour: ${v}`);
  return m[1].match(/../g).map(x => parseInt(x, 16) / 255);
};
const lum = (v) => hex(v).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe('theme registry', () => {
  it('every theme has a chrome token block, a start-page block and a VEX_THEMES entry', async () => {
    const TM = await loadThemeManager();
    const list = JSON.parse(START.match(/const VEX_THEMES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
    for (const id of TM.availableThemes) {
      expect(CHROME.has(id), `${id} in theme-tokens/theme-extra.css`).toBe(true);
      expect(PAGE.has(id), `${id} in start.html`).toBe(true);
      expect(list, `${id} in start.html VEX_THEMES`).toContain(id);
    }
  });

  it('ids are lowercase letters (a hyphen between words at most)', async () => {
    const TM = await loadThemeManager();
    for (const id of TM.availableThemes) expect(id).toMatch(/^[a-z]+(-[a-z]+)?$/);
  });

  it('a hyphenated id reaches the start page intact (firefox-light fell back to Oxford)', async () => {
    const exec = vi.fn(() => Promise.resolve());
    const load = vi.fn(() => Promise.resolve());
    globalThis.WebviewManager = { webviews: new Map([['t', {
      getURL: () => 'file:///C:/vex/src/renderer/start.html?theme=oxford', executeJavaScript: exec, loadURL: load,
    }]]) };
    const TM = await loadThemeManager();
    TM.applyTheme('firefox-light', { persist: false });
    expect(exec.mock.calls[0][0]).toContain("setAttribute('data-theme','firefox-light')");
    expect(load.mock.calls[0][0]).toContain('theme=firefox-light');
    delete globalThis.WebviewManager;
  });
});

describe('themes after the popular BetterDiscord themes', () => {
  const load = async () => (await loadThemeManager()).THEMES.filter(t => t.inspiredBy);

  it('there are 28 of them, each naming its source theme and carrying a mock palette', async () => {
    const themes = await load();
    expect(themes).toHaveLength(28);
    for (const t of themes) {
      expect(t.inspiredBy).toMatch(/ \(BetterDiscord\)$/);
      expect(t.label).not.toMatch(/discord|spotify|opera/i);
      expect(Object.keys(t.mock).sort()).toEqual(['acc', 'bg', 'side', 'surf', 'txt']);
      expect(t.accent).toBe(t.mock.acc);
    }
  });

  it('each defines every token an existing theme does, in the chrome and on the start page', async () => {
    // --on-primary is set only where white on the primary is below 4.5:1.
    const required = (k) => k !== '--on-primary';
    const chromeKeys = Object.keys(CHROME.get('lime')).filter(required).sort();
    const pageKeys = Object.keys(PAGE.get('lime')).filter(required).sort();
    for (const t of await load()) {
      const own = Object.keys(CHROME.get(t.id)).filter(k => k !== '--vex-hover-fill' && k !== '--vex-shadow-color' && required(k)).sort();
      expect(own, t.id).toEqual(chromeKeys);
      expect(Object.keys(PAGE.get(t.id)).filter(required).sort(), t.id).toEqual(pageKeys);
      for (const k of ['--vex-bg-base', '--vex-accent', '--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-border-strong']) {
        expect(PAGE.get(t.id)[k], `${t.id} ${k}`).toBe(CHROME.get(t.id)[k]);
      }
    }
  });

  it('light ones set their own hover and shadow tokens (the shared ones assume a dark theme)', async () => {
    for (const t of await load()) {
      const p = CHROME.get(t.id);
      const light = lum(p['--vex-bg-base']) > 0.4;
      expect(!!p['--vex-hover-fill'], `${t.id} hover token`).toBe(light);
    }
  });

  it('text is readable: body text >= 4.5:1, muted >= 3:1, accent >= 3:1 on every surface', async () => {
    for (const t of await load()) {
      const p = CHROME.get(t.id);
      const surfaces = ['--vex-bg-base', '--vex-bg-deep', '--vex-bg-elevated'].map(k => p[k]);
      for (const s of [...surfaces, p['--vex-glass-tab-active']]) {
        expect(contrast(p['--vex-text-primary'], s), `${t.id} text on ${s}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const s of surfaces) {
        expect(contrast(p['--vex-text-secondary'], s), `${t.id} secondary on ${s}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p['--vex-text-muted'], s), `${t.id} muted on ${s}`).toBeGreaterThanOrEqual(3);
        expect(contrast(p['--vex-accent'], s), `${t.id} accent on ${s}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('the picker card says which theme it is after', async () => {
    const TM = await loadThemeManager();
    globalThis.ThemeManager = TM;
    globalThis.VexIcons = { svg: () => '<svg></svg>' };
    vi.resetModules();
    const { ThemePicker } = await import('../../src/renderer/js/theme-picker.js');
    const card = ThemePicker._makeCard(TM.getThemeMeta('clearvision'), 'oxford');
    expect(card.title).toBe('Inspired by ClearVision (BetterDiscord)');
    expect(ThemePicker._makeCard(TM.getThemeMeta('lime'), 'oxford').title).toBe('');
  });
});

describe('text on the primary colour', () => {
  // About 55 themes had white on a light --primary, down to 1.3:1 (Cyberpunk),
  // on every primary button (2026-10-07). Each now names --on-primary where
  // white does not reach 4.5:1: white, or the theme's own dark background.
  it('reaches 4.5:1 in every theme, in the chrome and on the start page', () => {
    const low = [];
    for (const [id, p] of CHROME) {
      if (!p['--primary']) continue;
      const r = contrast(p['--on-primary'] || '#ffffff', p['--primary']);
      if (r < 4.5) low.push(`chrome ${id} ${r.toFixed(2)}`);
    }
    for (const [id, p] of PAGE) {
      if (!p['--vex-accent'] || !/^#[0-9a-f]{6}$/i.test(p['--vex-accent'])) continue;
      const r = contrast(p['--on-primary'] || '#ffffff', p['--vex-accent']);
      if (r < 4.5) low.push(`start page ${id} ${r.toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });

  it('the start page\'s primary buttons and the in-app dialog use it', () => {
    expect(START).not.toMatch(/background:\s*var\(--vex-accent\);\s*color:\s*#fff/);
    expect(read('css/vex-dialog.css')).toMatch(/\.vex-dialog-btn\.primary \{[^}]*color: var\(--on-primary, #fff\)/);
  });
});
