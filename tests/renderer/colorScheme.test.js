// Nothing declared a color-scheme, so a dark theme still got Chromium's light
// scrollbars, selects and date/time pickers, in the window and on the New Tab
// page (cat-themes TH4). Both now follow the theme's light or dark.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

describe('color-scheme follows the theme', () => {
  it('the window: light by default, dark when ThemeManager marks a dark theme or Glass is on', () => {
    expect(T.tokensCss).toMatch(/:root \{ color-scheme: light; \}/);
    expect(T.tokensCss).toMatch(/html\[data-scheme="dark"\], html:has\(> body\[data-gui-style="glass"\]\) \{ color-scheme: dark; \}/);
  });

  it('the New Tab page does the same, and tints its scrollbar from the theme', () => {
    expect(T.startStyle).toMatch(/html \{ color-scheme: light; scrollbar-color: [^}]*var\(--vex-text-muted\)/);
    expect(T.startStyle).toMatch(/html:is\(\[data-scheme="dark"\], \[data-gui-style="glass"\]\) \{ color-scheme: dark; \}/);
    expect(T.startHtml).toMatch(/html\.setAttribute\('data-scheme', \(own \? CustomThemes\.isLight\(own\) : VEX_LIGHT_THEMES\.includes\(t\)\) \? 'light' : 'dark'\);/);
  });

  it('the New Tab\'s list of light themes is the window\'s', () => {
    const list = JSON.parse(T.startHtml.match(/const VEX_LIGHT_THEMES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
    expect(list.sort()).toEqual(T.IDS.filter(id => T.ThemeManager.isLight(id)).sort());
  });
});
