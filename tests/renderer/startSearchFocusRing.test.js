// The New Tab search pill must show ONE focus ring (on the rounded pill), never the generic
// square outline on the bare <input> inside it (owner report: a white rectangle inside the pill).
// The look is proved in real Chromium (scripts in the task notes); this guards the CSS text.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'start.html'), 'utf8').replace(/\r\n/g, '\n');

describe('start page search pill focus ring', () => {
  it('takes the outline off the bare input, even over the generic !important ring', () => {
    expect(css).toMatch(/\.search-bar input:focus-visible\s*\{\s*outline:\s*none\s*!important;\s*\}/);
  });

  it('draws the ring on the pill while the input is focus-visible', () => {
    const m = css.match(/\.search-bar:has\(input:focus-visible\)\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/outline:\s*2px solid var\(--vex-accent/);
  });

  it('keeps the generic keyboard ring for everything else', () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--vex-accent[^}]*!important/);
  });
});
