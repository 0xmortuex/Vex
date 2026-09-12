// @vitest-environment jsdom
//
// Settings › Tab Layout vs Settings › GUI Style.
//
// Glass and the seven browser looks put the tabs on top themselves. The Tab
// Layout picker predates them and wrote body[data-tab-layout] unconditionally,
// so two things broke:
//   - picking "Vertical" under Glass put the top tab strip AND the vertical rail
//     on screen at the same time, with nothing to say why;
//   - at boot app.js re-applied the stored 'vertical' over the horizontal layout
//     gui-style.js had just forced, so the same mess came back after a restart.
// The rule now lives in SettingsUI.resolveTabLayout, and app.js locks the picker
// while a top-layout style is active.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { SettingsUI } = await import('../../src/renderer/js/settings-ui.js');

const TOP_LAYOUT_STYLES = ['glass', 'chrome', 'chrome-dark', 'firefox', 'firefox-dark', 'safari', 'xp', 'win98'];

describe('SettingsUI.resolveTabLayout', () => {
  it('honours the stored choice under Classic', () => {
    expect(SettingsUI.resolveTabLayout('vertical', undefined)).toBe('vertical');
    expect(SettingsUI.resolveTabLayout('horizontal', undefined)).toBe('horizontal');
    expect(SettingsUI.resolveTabLayout('', undefined)).toBe('horizontal');
  });

  it('forces horizontal under every style that owns the layout', () => {
    for (const style of TOP_LAYOUT_STYLES) {
      expect(SettingsUI.resolveTabLayout('vertical', style)).toBe('horizontal');
    }
  });

  it('does not overwrite the stored choice — it only resolves it', () => {
    // Switching back to Classic has to bring "vertical" back, so the caller must
    // keep storing what the user picked.
    expect(SettingsUI.resolveTabLayout('vertical', 'glass')).toBe('horizontal');
    expect(SettingsUI.resolveTabLayout('vertical', undefined)).toBe('vertical');
  });
});

describe('gui-style.js keeps the contract resolveTabLayout relies on', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="top-bar"></div><div id="top-tab-bar"><div class="tab-bar-trailing"></div></div><div id="top-bar-right"></div>';
    for (const a of ['data-gui-style', 'data-gui-family', 'data-gui-colors', 'data-tab-layout']) document.body.removeAttribute(a);
    window.showToast = vi.fn();
  });

  it('marks every tabs-on-top style with body[data-gui-style] and clears it for Classic', async () => {
    vi.resetModules();
    await import('../../src/renderer/js/gui-style.js');
    const G = window.VexGuiStyle;
    expect(G.styles().sort()).toEqual(['classic', ...TOP_LAYOUT_STYLES].sort());
    for (const style of TOP_LAYOUT_STYLES) {
      await G.set(style);
      expect(document.body.dataset.guiStyle).toBe(style);
      expect(SettingsUI.resolveTabLayout('vertical', document.body.dataset.guiStyle)).toBe('horizontal');
    }
    await G.set('classic');
    expect(document.body.dataset.guiStyle).toBeUndefined();
    expect(SettingsUI.resolveTabLayout('vertical', document.body.dataset.guiStyle)).toBe('vertical');
  });
});
