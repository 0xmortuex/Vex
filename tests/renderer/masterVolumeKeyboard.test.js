// @vitest-environment jsdom
//
// Found 2026-10-12 by opening Master Volume from Ctrl+K and using only the
// keyboard: the slider had no name for a screen reader, and was not focused, so
// the arrow keys did nothing until the focus had been Tabbed to it through the
// whole window; closing it dropped the focus on the page instead of where it
// had been.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/site-volume.js');
const { MasterVolume } = require('../../src/renderer/js/master-volume.js');
// Wave 6: the periodic work these modules start goes through VexJobs (T0-020); a stand-in that never ticks.
globalThis.VexJobs = globalThis.VexJobs || { every: () => ({ stop() {} }), stop() {} };

const tick = () => new Promise(r => setTimeout(r, 5));

describe('Master Volume from the keyboard', () => {
  beforeEach(() => {
    MasterVolume.close();
    document.body.innerHTML = '<button id="before">toolbar</button>';
    localStorage.clear();
    window.vexGuestEvalFrames = vi.fn(async () => ({ results: [] }));
  });

  it('names the box and the slider, and puts the focus on the slider', () => {
    document.getElementById('before').focus();
    MasterVolume.show();
    const pop = document.querySelector('.mastervol-pop');
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(pop.getAttribute('aria-label')).toBe('Master Volume');
    const slider = pop.querySelector('.mastervol-slider');
    expect(slider.getAttribute('aria-label')).toBeTruthy();
    expect(slider.getAttribute('aria-valuetext')).toBe('100%');
    expect(document.activeElement).toBe(slider);
    slider.value = 250;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(slider.getAttribute('aria-valuetext')).toBe('250%');
    MasterVolume.close();
  });

  it('Escape closes it and gives the focus back to what had it', async () => {
    const before = document.getElementById('before');
    before.focus();
    MasterVolume.show();
    await tick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.mastervol-pop')).toBeNull();
    expect(document.activeElement).toBe(before);
  });
});
