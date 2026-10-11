// @vitest-environment jsdom
//
// Settings › Appearance › Reduce motion stilled the window but not the New Tab
// page, a document of its own: with Windows' animations on, its search bar,
// shortcut cards and buttons still moved (21 of them; release check,
// 2026-10-11). The switch reaches it now, on load and when it changes, with a
// copy in the page's own storage read before first paint.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let RM, ran;
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  document.documentElement.removeAttribute('data-reduce-motion');
  document.body.innerHTML = '<input type="checkbox" id="setting-reduce-motion">';
  window.vex = { setWebsiteAppearance: vi.fn(async (s) => ({ ok: true, source: s })) };
  require('../../src/renderer/js/start-page-trust.js');
  ran = [];
  const page = (url) => ({ getURL: () => url, executeJavaScript: (js) => { ran.push([url, js]); return Promise.resolve(true); } });
  globalThis.WebviewManager = { webviews: new Map([[1, page('vex://start')], [2, page('https://example.com/renderer/start.html')]]) };
  RM = (await import('../../src/renderer/js/appearance-prefs.js')).ReduceMotion;
});

describe('Reduce motion reaches the New Tab page', () => {
  it('turning it on or off is pushed to every open New Tab, and only there', () => {
    RM.set(true);
    expect(ran.map(r => r[0])).toEqual(['vex://start']);
    new Function(ran[0][1])();
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(true);
    expect(localStorage.getItem('vex.reduceMotion')).toBe('1');
    ran.length = 0;
    RM.set(false);
    new Function(ran[0][1])();
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(false);
    expect(localStorage.getItem('vex.reduceMotion')).toBeNull();
  });

  it('a New Tab that loads is handed it too', () => {
    expect(read('src/renderer/js/webview.js')).toMatch(/window\.ReduceMotion\?\.paintStartPage\(webview\)/);
  });

  it('the page reads its copy before first paint and stills itself under it', () => {
    const html = read('src/renderer/start.html');
    expect(html).toMatch(/localStorage\.getItem\('vex\.reduceMotion'\) === '1'/);
    expect(html).toMatch(/html\[data-reduce-motion\] \*,\s*html\[data-reduce-motion\] \*::before,\s*html\[data-reduce-motion\] \*::after \{\s*animation-duration: 0\.01ms !important;[^}]*transition-duration: 0\.01ms !important;/);
  });
});
