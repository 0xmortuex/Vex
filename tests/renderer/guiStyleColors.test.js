// @vitest-environment jsdom
//
// Browser-look colour mode (gui-style.js). A browser look shows either its own
// palette or the active colour theme's, via body[data-gui-colors]. Picking a
// theme while a browser look shows its own colours switches it to the theme's —
// but only a real pick: ThemeManager's startup restore (userChoice:false) and
// picks made under Classic/Glass leave the choice alone.

import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadGuiStyle() {
  vi.resetModules();
  await import('../../src/renderer/js/gui-style.js');
  return window.VexGuiStyle;
}

const pickTheme = (userChoice) =>
  document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: 'matrix', userChoice } }));

describe('VexGuiStyle colour mode', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="top-bar"></div><div id="top-tab-bar"><div class="tab-bar-trailing"></div></div><div id="top-bar-right"></div>';
    for (const a of ['data-gui-style', 'data-gui-family', 'data-gui-colors']) document.body.removeAttribute(a);
    window.showToast = vi.fn();
  });

  it('defaults to the look\'s own colours and marks browser looks as a family', async () => {
    const G = await loadGuiStyle();
    expect(G.getColors()).toBe('look');
    expect(document.body.dataset.guiColors).toBe('look');
    await G.set('xp');
    expect(document.body.dataset.guiFamily).toBe('browser');
    expect(G.isBrowserLook()).toBe(true);
    await G.set('glass');
    expect(document.body.dataset.guiFamily).toBeUndefined();
    expect(G.isBrowserLook()).toBe(false);
  });

  it('restores a saved colour mode on load', async () => {
    localStorage.setItem('vex.guiColors', 'theme');
    const G = await loadGuiStyle();
    expect(G.getColors()).toBe('theme');
    expect(document.body.dataset.guiColors).toBe('theme');
  });

  it('a theme pick under a browser look switches it to the theme colours', async () => {
    const G = await loadGuiStyle();
    await G.set('chrome');
    pickTheme(true);
    expect(G.getColors()).toBe('theme');
    expect(document.body.dataset.guiColors).toBe('theme');
    expect(localStorage.getItem('vex.guiColors')).toBe('theme');
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });

  it('the startup theme restore does not switch the colours', async () => {
    const G = await loadGuiStyle();
    await G.set('chrome');
    pickTheme(false);
    expect(G.getColors()).toBe('look');
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('a theme pick under Classic leaves the colour mode alone', async () => {
    const G = await loadGuiStyle();
    await G.set('classic');
    pickTheme(true);
    expect(G.getColors()).toBe('look');
  });

  it('rejects an unknown colour mode instead of guessing', async () => {
    const G = await loadGuiStyle();
    expect(() => G.setColors('neon')).toThrow(/Unknown GUI colour mode/);
    expect(G.getColors()).toBe('look');
  });
});
