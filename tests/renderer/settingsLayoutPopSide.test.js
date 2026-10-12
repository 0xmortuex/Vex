// Found 2026-10-12 by opening the Settings layout button with "A list down the
// left side" chosen: the box is anchored to the right edge of a button that sits
// in the 232px list column, so it ran 37px off the window's left side and its
// labels (Columns, Category menu, Density) were cut off. Measured in a real
// window: the box's left was -37px. It now opens towards the settings.
import { describe, it, expect } from 'vitest';

const fs = require('fs'), path = require('path');
const CSS = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/settings-redesign.css'), 'utf8');

describe('the Settings layout box with the category list on the left', () => {
  it('is anchored to its left edge, after the rule that anchors it right', () => {
    const base = CSS.indexOf('.set-layout-pop {');
    const side = CSS.indexOf('#panel-settings[data-set-nav="side"] .set-layout-pop');
    expect(base).toBeGreaterThan(0);
    expect(side).toBeGreaterThan(base);
    const rule = CSS.slice(side, CSS.indexOf('}', side));
    expect(rule).toMatch(/left:\s*0/);
    expect(rule).toMatch(/right:\s*auto/);
  });
});
