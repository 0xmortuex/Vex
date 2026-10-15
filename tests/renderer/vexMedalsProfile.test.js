// @vitest-environment jsdom
// The profile page and its Settings group render, filter, and keep the
// Unlock all medals switch honest.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
const path = require('path');
const JS = path.join(__dirname, '..', '..', 'src', 'renderer', 'js');
let V;

beforeAll(() => {
  window.showToast = vi.fn();
  window.VexIcons = require(path.join(JS, 'vex-icons.js')).VexIcons;
  window.VexFeatures = require(path.join(JS, 'feature-catalog.js')).VexFeatures;
  document.body.innerHTML = '<div id="host"><div id="settings-ainews"></div></div>';
  require(path.join(JS, 'vex-medals.js'));
  V = window.VexMedals;
  require(path.join(JS, 'vex-medals-catalog.js'));
  require(path.join(JS, 'vex-medals-profile.js'));
});

beforeEach(() => {
  localStorage.clear();
  V._reset({ wipe: true });
  window.VexProfile.close();
  window.showToast.mockClear();
});

describe('profile page', () => {
  it('injects one Settings group with a clearly labelled switch, off by default', () => {
    const box = document.getElementById('setting-unlock-all-medals');
    expect(document.querySelectorAll('#settings-medals').length).toBe(1);
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
    expect(box.getAttribute('aria-label')).toBe('Unlock all medals');
  });

  it('renders locked silhouettes, a level and the honest line', () => {
    V.award('first-note', { silent: true });
    window.VexProfile.open();
    const root = document.querySelector('.vm-profile');
    expect(root.querySelector('[role="dialog"]') || root.getAttribute('role')).toBeTruthy();
    expect(root.querySelectorAll('.vm-card').length).toBe(V.list().length);
    expect(root.querySelectorAll('.vm-locked').length).toBe(V.list().length - 1);
    expect(root.textContent).toContain('1 earned for real');
    expect(root.textContent).toContain('Level 1');
    expect(root.textContent).toContain('Export as image');
  });

  it('tier filter narrows the shelf', () => {
    window.VexProfile.open();
    document.querySelector('[data-tier="platinum"]').click();
    const n = V.list().filter(m => m.tier === 'platinum').length;
    expect(document.querySelectorAll('.vm-profile .vm-card').length).toBe(n);
    document.querySelector('[data-tier="all"]').click();
  });

  it('the switch shows everything, says how many are real, and toasts once', () => {
    V.award('first-note', { silent: true });
    V.award('meet-your-profile', { silent: true });
    const awards = [];
    document.addEventListener('vex:medal-awarded', (e) => awards.push(e.detail.id));
    const box = document.getElementById('setting-unlock-all-medals');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    window.VexProfile.open();
    const root = document.querySelector('.vm-profile');
    expect(root.querySelectorAll('.vm-locked').length).toBe(0);
    expect(root.textContent).toContain('2 earned for real');
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(awards).toEqual([]);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(V.has('first-note')).toBe(true);
    expect(root.querySelectorAll('.vm-locked').length).toBe(V.list().length - 2);
  });

  it('exports a self-contained SVG with no external references', () => {
    V.setUnlockAll(true);
    const { svg } = window.VexProfile.exportSvg();
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toMatch(/xlink:href|<image/);
    expect(svg).toContain('earned for real');
  });
});
