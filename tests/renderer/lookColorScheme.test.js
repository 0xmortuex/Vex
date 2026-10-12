// @vitest-environment jsdom
//
// A browser look in its own colours (Settings › GUI Style, "Browser look
// colours: the look's own") is light or dark whatever the colour theme is, but
// the window's color-scheme and Website appearance followed the theme: the
// Firefox dark look over Oxford had light dropdowns and told websites "light",
// and Firefox picked while Nord was on had dark dropdowns on a white window and
// told websites "dark" (release check, 2026-10-11). The look decides there.
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./themeTokens.js');

const browserCss = fs.readFileSync(path.join(T.ROOT, 'src/renderer/css/gui-browser.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const lum = (h) => {
  const c = T.hex(h);
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
};
// Every look's own toolbar colour, from its palette block.
const looks = {};
for (const m of browserCss.matchAll(/^body\[data-gui-style="([a-z0-9-]+)"\] \{([^}]*)\}/gm)) {
  const t = /--b-toolbar:\s*(#[0-9a-f]{3,6})\b/i.exec(m[2]);
  if (t) looks[m[1]] = lum(t[1]) < 0.2 ? 'dark' : 'light';
}
const darkLooks = Object.keys(looks).filter(k => looks[k] === 'dark').sort();
const listIn = (src, re) => { const m = re.exec(src); return m ? [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map(x => x[1]).sort() : null; };

describe('a browser look in its own colours wears its own light or dark', () => {
  it('found every look\'s palette', () => {
    expect(Object.keys(looks).length).toBeGreaterThanOrEqual(12);
    expect(darkLooks).toEqual(['chrome-dark', 'firefox-dark', 'fluent-dark', 'terminal']);
  });

  it('the window: light for a light look, dark for a dark one, over the theme\'s', () => {
    expect(T.tokensCss).toMatch(/html:has\(> body\[data-gui-family="browser"\]:not\(\[data-gui-colors="theme"\]\)\) \{ color-scheme: light; \}/);
    expect(listIn(T.tokensCss, /html:has\(> body\[data-gui-family="browser"\]:not\(\[data-gui-colors="theme"\]\):is\(([^)]*)\)\) \{ color-scheme: dark; \}/)).toEqual(darkLooks);
  });

  it('the New Tab page, which is handed the look\'s palette, the same', () => {
    expect(T.startStyle).toMatch(/html\[data-look-palette\] \{ color-scheme: light; \}/);
    expect(listIn(T.startStyle, /html\[data-look-palette\]:is\(([^)]*)\) \{ color-scheme: dark; \}/)).toEqual(darkLooks);
    // after the theme's own rule, so it wins
    expect(T.startStyle.indexOf('html[data-look-palette] { color-scheme')).toBeGreaterThan(T.startStyle.indexOf('[data-gui-style="glass"]) { color-scheme: dark; }'));
  });

  it('Website appearance follows a change of the look\'s colours too', async () => {
    vi.resetModules();
    localStorage.clear();
    const sent = [];
    window.vex = { setWebsiteAppearance: vi.fn(async (s) => { sent.push(s); return { ok: true, source: s }; }) };
    let scheme = 'light';
    window.getComputedStyle = () => ({ colorScheme: scheme });
    const { WebsiteAppearance } = await import('../../src/renderer/js/appearance-prefs.js');
    await WebsiteAppearance.apply();
    scheme = 'dark';
    window.dispatchEvent(new CustomEvent('vex:gui-colors', { detail: { mode: 'look' } }));
    await Promise.resolve();
    expect(sent).toEqual(['light', 'dark']);
  });
});
