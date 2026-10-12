// Under a Windows contrast theme (forced colours) Settings' switches lost the
// knob's colour, so on and off looked alike (cat-themes TH7).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/css/app.css'), 'utf8');
const block = (() => {
  const i = css.indexOf('@media (forced-colors: active) {\n  .toggle-slider');
  const j = css.indexOf('@media (forced-colors: active) {\r\n  .toggle-slider');
  const at = i >= 0 ? i : j;
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('\n}', at));
})();

describe('Settings switches under forced colours', () => {
  it('draw themselves in system colours instead of letting them be dropped', () => {
    expect(block).toMatch(/\.toggle-slider \{ forced-color-adjust: none;[^}]*border: 1px solid ButtonText;/);
    expect(block).toMatch(/\.toggle-slider::before \{ background: ButtonText; \}/);
  });

  it('on is a Highlight track with a HighlightText knob, so it differs from off', () => {
    // !important: Settings' own on-track is a gradient that would win otherwise.
    expect(block).toMatch(/\.toggle input:checked \+ \.toggle-slider \{ background: Highlight !important;[^}]*box-shadow: none !important; \}/);
    expect(block).toMatch(/\.toggle input:checked \+ \.toggle-slider::before \{ background: HighlightText; \}/);
  });
});
