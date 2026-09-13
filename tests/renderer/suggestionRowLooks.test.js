// The URL-bar suggestion under the pointer (or picked with the arrow keys)
// could not be read in the Chrome look: css/gui-browser.css maps Vex's
// accent-dim fill AND accent text to the look's one accent colour, so the row
// was blue on blue. The browser looks must tint the row and keep the text.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '../../src/renderer/css/gui-browser.css'), 'utf8');

// The declarations of one selector, with comments and line breaks removed.
function declarations(selectorPart) {
  const re = new RegExp(selectorPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{([^}]*)\\}', 'g');
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)].map(m => m[1].replace(/\s+/g, ' ').trim());
}

describe('the highlighted suggestion in the browser looks', () => {
  it('still maps the accent-dim fill and accent text to the one accent (the trap)', () => {
    expect(css).toMatch(/--vex-accent-dim:\s*var\(--b-accent-ring\)/);
    expect(css).toMatch(/--vex-text-accent:\s*var\(--b-accent\)/);
    // …and Chrome's ring really is its accent, solid.
    expect(css).toMatch(/--b-accent:\s*#1a73e8;\s*--b-accent-ring:\s*#1a73e8/);
  });

  it('tints the hovered and the selected row with the toolbar hover fill, not the accent', () => {
    const hovered = declarations('body[data-gui-family="browser"] .sb-suggestion:hover');
    const selected = declarations('body[data-gui-family="browser"] .sb-suggestion.selected');
    expect(hovered.some(d => /background:\s*var\(--b-btn-hover\)/.test(d))).toBe(true);
    expect(selected.some(d => /background:\s*var\(--b-btn-hover\)/.test(d))).toBe(true);
  });

  it('keeps the row text in the ordinary text colour', () => {
    const hovered = declarations('body[data-gui-family="browser"] .sb-suggestion:hover .sb-title');
    const selected = declarations('body[data-gui-family="browser"] .sb-suggestion.selected .sb-title');
    expect(hovered.some(d => /color:\s*var\(--b-text\)/.test(d))).toBe(true);
    expect(selected.some(d => /color:\s*var\(--b-text\)/.test(d))).toBe(true);
  });
});
