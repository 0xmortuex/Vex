// The panel picker (a native <select> with <optgroup> headings) and every other select popup must set their own
// option / optgroup colours; the colours themselves need a real window.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const css = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer/css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('select popup colours', () => {
  it('the sidebar picker colours options and optgroup headings from the look tokens', () => {
    const s = css('sidebar-groups.css');
    expect(s).toMatch(/#look-sb-picker :is\(option, optgroup\) \{[^}]*background-color: var\(--b-menu\)[^}]*color: var\(--b-text\)/);
    expect(s).toMatch(/#look-sb-picker optgroup \{[^}]*color:/);
    expect(s).toMatch(/#look-sb-picker option:checked/);
    expect(s).toMatch(/#look-sb-picker \{ color-scheme: inherit; \}/);
  });
  it('every select in the app gets a theme-token option/optgroup surface, and color-scheme follows the theme', () => {
    const t = css('theme-tokens.css');
    expect(t).toMatch(/select option, select optgroup \{[^}]*background-color: var\(--surface[^}]*color: var\(--text/);
    expect(t).toMatch(/html\[data-scheme="dark"\][^{]*\{ color-scheme: dark; \}/);
    expect(t).toMatch(/:root \{ color-scheme: light; \}/);
  });
});
