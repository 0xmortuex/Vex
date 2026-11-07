// Windows contrast themes (forced-colors: active) and prefers-contrast: more.
//
// scripts/check-ui.js --contrast opens the window, Settings, the command bar and the site panel in real Chromium with the media
// feature emulated (Emulation.setEmulatedMedia) and measures computed styles. Measured on the profile this was built on (Oxford
// theme, Firefox / Glass / Classic looks), before the rules in css/a11y.css:
//   forced-colors  : 3 / 39 / 4 findings  (a Glass body gradient and a toast's sheen kept under the system text colour)
//   prefers-contrast: 38 / 7 / 35 findings (muted text at 4.9 to 6:1, address and command inputs with no edge, letter chips at 4.6:1)
// and 0 / 0 / 0 for both afterwards. (Solarized: its own text is 6.9:1, so a few lines stay under 7:1; not fixable by muted -> text.)
// The real-browser run is the proof; these keep the script and the rules from being quietly removed.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('check:ui --contrast', () => {
  const src = read('scripts/check-ui.js');

  it('is a flag, runs both emulations through CDP, and names the four surfaces', () => {
    expect(src).toMatch(/--contrast/);
    expect(src).toMatch(/const CONTRAST = flags\.has\('--contrast'\)/);
    expect(src).toMatch(/name: 'forced-colors', value: 'active'/);
    expect(src).toMatch(/name: 'prefers-contrast', value: 'more'/);
    expect(src).toMatch(/Emulation\.setEmulatedMedia/);
    for (const name of ['the window', 'Settings', 'the command bar', 'the site panel']) expect(src).toContain(`name: '${name}', sel:`);
  });

  it('puts the emulation back, and reports a surface that judged nothing as a harness failure', () => {
    expect(src).toMatch(/finally \{\s*await cdp\.send\('Emulation\.setEmulatedMedia', \{ features: \[\] \}\);/);
    expect(src).toMatch(/did not open under ' \+ m\.colors/);
    expect(src).toMatch(/emulation did not reach the page/);
  });

  it('the in-page audit library still parses, and exports contrastScan', () => {
    const m = /const PAGE_LIB = `([\s\S]*?)\n`;/.exec(src);
    expect(m).not.toBeNull();
    // the template literal's own escapes are what the browser sees: evaluate them the way the script does
    const lib = new Function('return `' + m[1] + '`')();
    expect(() => new vm.Script(lib)).not.toThrow();
    expect(lib).toMatch(/contrastScan: contrastScan/);
    for (const check of ['forced-colors-text', 'forced-colors-image-behind-text', 'contrast-more-text', 'no-visible-boundary', 'control-vanishes', 'focus-ring-vanishes', 'selected-looks-unselected']) {
      expect(lib).toContain("'" + check + "'");
    }
  });

  it('is accepted on the command line', () => {
    expect(src).toMatch(/\^--\(full\|json\|keep-open\|contrast\|sweep/);
  });
});

describe('css/a11y.css (the last sheet)', () => {
  const css = read('src/renderer/css/a11y.css');
  const block = (query) => {
    const i = css.indexOf('@media (' + query + ')');
    expect(i, query).toBeGreaterThan(-1);
    let depth = 0, j = css.indexOf('{', i);
    const start = j;
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break; }
    return css.slice(start, j);
  };

  it('forced colours: no background picture under the system text colour (Glass included), no backdrop blur', () => {
    const b = block('forced-colors: active');
    expect(b).toMatch(/html body\[data-gui-style\]/);
    expect(b).toMatch(/background-image: none !important/);
    expect(b).toMatch(/backdrop-filter: none !important/);
  });

  it('more contrast: muted text becomes text, fields and their boxes get an edge, letter chips go black and white', () => {
    const b = block('prefers-contrast: more');
    expect(b).toMatch(/--text-muted: var\(--text\) !important/);
    expect(b).toMatch(/--vex-text-muted: var\(--text\) !important/);
    expect(b).toMatch(/border: 1px solid var\(--text\) !important/);
    expect(b).toMatch(/#url-bar,\s*#command-input-wrapper/);
    expect(b).toMatch(/\.gsc \.ic:not\(\.has-img\) \{ background: #000 !important; color: #fff !important/);
  });

  it('is still the last stylesheet of the window', () => {
    const html = read('src/renderer/index.html');
    const links = [...html.matchAll(/<link rel="stylesheet" href="css\/([^"]+)">/g)].map(m => m[1]);
    expect(links[links.length - 1]).toBe('a11y.css');
  });
});
