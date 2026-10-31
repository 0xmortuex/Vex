// The setup wizard and the place-suggestion list are built from the legacy tokens (--bg, --surface, --border, --text,
// --primary). In the default (Graphite) theme those tokens are navy/indigo while the window is coloured from the amber
// --vex-* family, so the wizard looked like a different app on top of it (owner's screenshot, 2026-10-31).
// The real colours are checked in Chromium (scripts are throwaway); this pins the logic that keeps them in step.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../src/renderer');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('wizard colours follow the window', () => {
  const css = read('css/theme-tokens.css');
  const block = css.slice(css.indexOf('html[data-theme="default"] body:not([data-gui-style="glass"])'));
  const rule = block.slice(0, block.indexOf('}') + 1);

  it('the default theme maps the wizard and the suggestion list onto the window\'s own --vex-* colours', () => {
    expect(rule).toContain('#vex-onboarding');
    expect(rule).toContain('.vex-geo-suggest');
    for (const [token, source] of [['--bg', '--vex-bg-deep'], ['--surface', '--vex-bg-elevated'], ['--border', '--vex-border-medium'], ['--text', '--vex-text-primary'], ['--primary', '--vex-accent']]) {
      expect(rule).toMatch(new RegExp(token + ':\\s*var\\(' + source + '\\)'));
    }
  });

  it('leaves Glass and a browser look in its own palette alone', () => {
    expect(rule).toContain(':not([data-gui-style="glass"])');
    expect(rule).toContain('[data-gui-colors="theme"]');
    expect(rule).toContain(':not([data-gui-family="browser"])');
  });

  it('the wizard draws its card, select, input and buttons from tokens, never from fixed colours', () => {
    const ob = read('js/onboarding.js');
    const shell = ob.slice(ob.indexOf("overlay.id = 'vex-onboarding'"), ob.indexOf("this._renderBody(s.key"));
    expect(shell).toContain('background:var(--surface)');
    expect(shell).toMatch(/id="ob-back" style="[^"]*background:var\(--bg\)/);
    expect(shell).toMatch(/id="ob-next" style="[^"]*background:var\(--primary\)/);
    const weather = ob.slice(ob.indexOf('_renderWeather(body)'), ob.indexOf('_searchCity(q, body)'));
    expect(weather).toMatch(/id="ob-country" style="[^"]*background:var\(--bg\)[^"]*color:var\(--text\)/);
    expect(weather).not.toMatch(/id="ob-country" style="[^"]*#[0-9a-fA-F]{3,6}/);
  });
});
