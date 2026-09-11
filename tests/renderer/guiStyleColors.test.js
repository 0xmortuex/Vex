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
    for (const a of ['data-gui-style', 'data-gui-family', 'data-gui-colors', 'style']) document.body.removeAttribute(a);
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

  describe('New Tab page palette', () => {
    // jsdom loads no stylesheets, so give body the look's resolved tokens inline.
    const setLookTokens = () => {
      const t = { '--b-page': '#ffffff', '--b-text': '#1f1f1f', '--b-text-dim': '#5f6368', '--b-accent': '#1a73e8', '--b-border': '#dadce0', '--b-url-bg': '#f1f3f4' };
      for (const [k, v] of Object.entries(t)) document.body.style.setProperty(k, v);
    };
    const fakeWebview = () => ({ executeJavaScript: vi.fn(async () => {}) });

    it('hands the page the look\'s palette in its own colours', async () => {
      const G = await loadGuiStyle();
      await G.set('chrome');
      setLookTokens();
      const wv = fakeWebview();
      await G.paintStartPage(wv);
      const js = wv.executeJavaScript.mock.calls[0][0];
      expect(js).toContain('vex-look-palette');
      expect(js).toContain('--vex-bg-base: #ffffff');
      expect(js).toContain('--vex-accent: #1a73e8');
      expect(js).toContain("setAttribute('data-look-palette'");
    });

    it('clears it in theme colours, so the colour theme shows through', async () => {
      const G = await loadGuiStyle();
      await G.set('chrome');
      setLookTokens();
      G.setColors('theme');
      const wv = fakeWebview();
      await G.paintStartPage(wv);
      const js = wv.executeJavaScript.mock.calls[0][0];
      expect(js).toContain("removeAttribute('data-look-palette')");
      expect(js).not.toContain('--vex-bg-base');
    });

    it('clears it under Classic', async () => {
      const G = await loadGuiStyle();
      await G.set('classic');
      const wv = fakeWebview();
      await G.paintStartPage(wv);
      expect(wv.executeJavaScript.mock.calls[0][0]).toContain("removeAttribute('data-look-palette')");
    });

    it('fails loudly if a look is missing a colour', async () => {
      const G = await loadGuiStyle();
      await G.set('chrome');
      expect(() => G.paintStartPage(fakeWebview())).toThrow(/defines no --b-page/);
    });
  });

  it('rejects an unknown colour mode instead of guessing', async () => {
    const G = await loadGuiStyle();
    expect(() => G.setColors('neon')).toThrow(/Unknown GUI colour mode/);
    expect(G.getColors()).toBe('look');
  });
});
