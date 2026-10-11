// check:ui judged only the chrome's bands (tab strip, toolbar, sidebar), so
// Settings, menus, dialogs, pickers and the New Tab page could fail contrast
// while it said clean (cat-themes). It now opens each of them, in the Firefox
// look and Glass, for every theme on --full — and what it found is fixed.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('check:ui surfaces', () => {
  const src = read('scripts/check-ui.js');

  it('opens every surface the audit named, in the Firefox look and Glass', () => {
    expect(src).toMatch(/const SURFACE_STYLES = \['firefox', 'glass'\];/);
    for (const name of ['Settings', 'History', 'Downloads', 'the command bar', 'a dialog', 'a toast', 'the tab menu', 'the theme picker', 'the font picker', 'the keys sheet']) {
      expect(src).toContain(`name: '${name}'`);
    }
    expect(src).toContain('"the New Tab page", "body"');
    // the themes it sweeps are the run's: the sample, or all of them on --full
    expect(src).toMatch(/scanSurfaces\(cdp, port, EXCEPTIONS, surfaceStyles, themes, findings, summaries\)/);
  });

  it('a surface that judged nothing is a harness failure, not a pass', () => {
    expect(src).toMatch(/if \(!res\.roots \|\| !res\.judged\) throw new Error\('judged no text in '/);
    expect(src).toMatch(/if \(!res\.judged\) throw new Error\('judged no text on the New Tab page/);
  });
});

describe('what it found', () => {
  it('History\'s chosen filter and search mode are text-coloured on the accent wash (3.1:1 in Solarized)', () => {
    const css = read('src/renderer/css/history-panel.css');
    expect(css).toMatch(/\.history-filter\.active \{[^}]*color: var\(--vex-text-primary\);/);
    expect(css).toMatch(/\.search-mode\.active \{[^}]*color: var\(--vex-text-primary\);/);
  });

  it('Downloads\' header links use the accent made for text (4.3:1 in Solarized)', () => {
    expect(read('src/renderer/css/downloads-panel.css')).toMatch(/\.downloads-actions \.btn-link \{[^}]*color: var\(--vex-text-accent\);/);
  });

  it('Glass with a light theme tints its accent fills from the lifted accent (Oxford\'s pale fill was 1.1:1)', () => {
    const glass = read('src/renderer/css/gui-glass.css');
    expect(glass).toMatch(/html\[data-scheme="light"\] body\[data-gui-style="glass"\] \{[^}]*--vex-accent-dim: color-mix\(in srgb, var\(--g-lift\) 22%, transparent\);/);
  });
});
