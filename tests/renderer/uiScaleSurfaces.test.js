// @vitest-environment jsdom
//
// Larger and Largest left many surfaces at their normal size: the shortcuts
// bar (the rule named #gui-shortcuts, which does not exist), toasts, the find
// bar, the theme and font pickers, the keys sheet, the toolbar's overflow menu
// and the New Tab page (cat-themes TH5).
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
const { VexFonts } = require('../../src/renderer/js/fonts.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const scaleCss = read('src/renderer/css/ui-scale.css').replace(/\/\*[\s\S]*?\*\//g, '');
const zoomed = (() => {
  const m = /([^{}]+)\{\s*zoom: var\(--vex-ui-scale\);\s*\}/.exec(scaleCss);
  return m[1].split(',').map(s => s.trim().replace(/^html\[data-vex-scale\]\s+/, ''));
})();

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-vex-scale');
  document.documentElement.style.cssText = '';
  delete globalThis.WebviewManager;
});

describe('Larger and Largest reach every surface of the window', () => {
  it('the shortcuts bar is named by its real id', () => {
    expect(read('src/renderer/js/gui-style.js')).toMatch(/bar.id = 'gui-shortcuts-bar';/);
    expect(zoomed).toContain('#gui-shortcuts-bar');
    expect(zoomed).not.toContain('#gui-shortcuts');
  });

  it('toasts, find bar, the docked panel header, pickers, keys sheet and overflow menu grow', () => {
    for (const sel of ['.toast-item', '#find-bar', '#look-sb-head', '.vex-theme-picker', '.vexfont', '.vexkeys', '.tb-overflow-menu > *']) expect(zoomed).toContain(sel);
  });

  it('the boxes placed from JS keep their place: only their content is zoomed', () => {
    expect(zoomed).not.toContain('#toast-container');
    expect(zoomed).not.toContain('.tb-overflow-menu');
  });
});

describe('...and the New Tab page', () => {
  it('a size is pushed into every open New Tab, and taken back at Normal', () => {
    const ran = [];
    globalThis.WebviewManager = { webviews: new Map([[1, { getURL: () => 'file:///x/src/renderer/start.html?theme=oxford', executeJavaScript: (js) => { ran.push(js); return Promise.resolve(); } }]]) };
    VexFonts.setSize('largest');
    expect(ran.length).toBe(1);
    // run the pushed script against this document, as the page would
    new Function(ran[0])();
    expect(document.documentElement.style.getPropertyValue('--vex-ui-scale')).toBe('1.5');
    expect(document.documentElement.hasAttribute('data-vex-scale')).toBe(true);
    expect(localStorage.getItem('vex.uiScale')).toBe('1.5');
    ran.length = 0;
    VexFonts.setSize('normal');
    new Function(ran[0])();
    expect(document.documentElement.hasAttribute('data-vex-scale')).toBe(false);
    expect(localStorage.getItem('vex.uiScale')).toBeNull();
  });

  it('the page reads its copy before first paint and zooms its blocks', () => {
    const html = read('src/renderer/start.html');
    expect(html).toMatch(/localStorage\.getItem\('vex\.uiScale'\)/);
    expect(html).toMatch(/html\[data-vex-scale\] body > \* \{ zoom: var\(--vex-ui-scale, 1\); \}/);
  });
});
