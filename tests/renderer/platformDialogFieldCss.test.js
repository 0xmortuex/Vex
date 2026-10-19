// Fields inside platform dialogs (VexSettingsGroups.dialog bodies, used by Chores, Timezone helper, Moderator kit,
// Writing desk, Reset timers...) were the browser's own unstyled boxes, because Settings styles the same classes only
// under .settings-content. css/vex-platform.css now styles them. jsdom cannot compute styles, so this guards the rule
// being there and what it leaves alone; the computed values were read back in real Chromium (see the commit message).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/renderer/css/vex-platform.css', 'utf8');

describe('dialog fields get the Settings look', () => {
  it('styles text boxes, numbers, times, dropdowns and text areas inside .vex-platform-body', () => {
    const m = css.match(/\.vex-platform-body :is\(([^)]*)\) \{/);
    expect(m, 'the field rule').toBeTruthy();
    for (const sel of ['input.set-input', 'input[type="text"]', 'input[type="number"]', 'input[type="time"]', 'select', 'textarea']) expect(m[1]).toContain(sel);
  });
  it('leaves checkboxes, ranges and buttons alone', () => {
    const m = css.match(/\.vex-platform-body :is\(([^)]*)\) \{/);
    for (const sel of ['checkbox', 'range', 'radio', 'button']) expect(m[1]).not.toContain(sel);
  });
  it('uses the theme variables, so every look can restyle it', () => {
    const block = css.slice(css.indexOf('/* Fields inside platform dialogs'));
    for (const v of ['var(--bg', 'var(--border)', 'var(--text)', 'var(--primary)', 'var(--radius)']) expect(block).toContain(v);
  });
  it('gives keyboard focus a visible ring', () => {
    expect(css).toMatch(/\.vex-platform-body :is\([^)]*\):focus \{[^}]*box-shadow/);
  });
});
