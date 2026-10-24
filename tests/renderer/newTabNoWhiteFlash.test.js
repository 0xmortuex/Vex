// A new tab's page area was white for a moment before the New Tab page painted (150 ms and more in a real window with a dark theme,
// measured with a screencast on 2026-10-25). The webview of a start page stands in with the theme's own base colour until it paints.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/webview.js'), 'utf8').replace(/\r\n/g, '\n');

describe('the webview of a New Tab page', () => {
  it('is given the theme base colour as soon as it is made, before it has loaded anything', () => {
    const make = src.indexOf("const webview = document.createElement('webview');");
    const paint = src.indexOf("webview.style.background = 'var(--vex-bg-base)'");
    const load = src.indexOf("webview.setAttribute('src', tab.url);");
    expect(make).toBeGreaterThan(-1);
    expect(paint).toBeGreaterThan(load);          // the same step as the address is set, in the same task: no frame between them
    expect(src.slice(paint - 120, paint)).toContain('isStartPage(tab.url)');
  });

  it('uses a token every theme defines', () => {
    const tokens = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/css/theme-tokens.css'), 'utf8');
    expect(tokens).toContain('--vex-bg-base:');
  });
});
