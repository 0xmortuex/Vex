// @vitest-environment jsdom
//
// Themes, skins and the shield: the settings that change what the browser
// looks like and what a page can learn about the device. The theme tokens are
// generated from the desktop file, so what is tested here is the behaviour
// around them — what "auto" resolves to, that a skin becomes a real texture,
// and that a page's own colour is only used when it can be read against the
// theme.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexBridge = {
  setStatusBarStyle: vi.fn(async () => {}),
  setWindowBackground: vi.fn(async () => {}),
  setDocumentStartScript: vi.fn(async () => ({ atDocumentStart: true }))
};
window.VEX_THEMES = require('../../mobile/www/js/themes-data.js') && window.VEX_THEMES;

const { VexTheme } = require('../../mobile/www/js/theme.js');
const { VexShield } = require('../../mobile/www/js/shield.js');

let systemPrefersDark = false;
// A real MediaQueryList's `matches` is live — the browser updates it when the
// system changes. The mock has to be live too, or "follows the system" is
// tested against a value frozen at subscribe time.
window.matchMedia = query => ({
  get matches() { return /dark/.test(query) ? systemPrefersDark : false; },
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
});

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  systemPrefersDark = false;
  VexTheme.watchSystem();
  window.VexBridge.setStatusBarStyle.mockClear();
  window.VexBridge.setDocumentStartScript.mockClear();
});

describe('themes', () => {
  it('ships the same eight the desktop does', () => {
    const ids = VexTheme.themes().map(theme => theme.id);
    expect(ids).toEqual(['oxford', 'graphite', 'midnight', 'forest', 'ocean', 'dracula', 'nord', 'catppuccin']);
  });

  it('auto is Oxford by day and Midnight by night', () => {
    expect(VexTheme.resolvedId()).toBe('oxford');
    systemPrefersDark = true;
    expect(VexTheme.resolvedId()).toBe('midnight');
    expect(VexTheme.isDark()).toBe(true);
  });

  it('an explicit theme ignores the system', async () => {
    systemPrefersDark = true;
    await VexTheme.set('forest');
    expect(VexTheme.resolvedId()).toBe('forest');
    expect(document.documentElement.dataset.theme).toBe('forest');
  });

  it('falls back to auto when the stored theme no longer exists', async () => {
    store['vex.theme'] = 'a-theme-that-was-removed';
    expect(VexTheme.resolvedId()).toBe('oxford');
  });

  it('tells Android which colour the system bars are', async () => {
    await VexTheme.set('midnight');
    expect(window.VexBridge.setStatusBarStyle).toHaveBeenCalledWith(true, '#05050a');
  });
});

describe('skins', () => {
  it('none means no texture', () => {
    VexTheme.apply();
    expect(document.documentElement.style.getPropertyValue('--skin-texture')).toBe('none');
  });

  it('a skin becomes an inline SVG at the chosen strength', async () => {
    await VexTheme.setSkin('graph', 0.12);
    const texture = document.documentElement.style.getPropertyValue('--skin-texture');
    expect(texture).toContain('data:image/svg+xml');
    expect(decodeURIComponent(texture)).toContain('0.12');
  });

  it('draws in light ink on a dark theme', async () => {
    await VexTheme.set('midnight');
    await VexTheme.setSkin('dots', 0.08);
    expect(decodeURIComponent(document.documentElement.style.getPropertyValue('--skin-texture')))
      .toContain('255,255,255');
  });
});

describe('the page’s own colour', () => {
  it('is used when it reads against the theme', async () => {
    await VexTheme.set('oxford');
    expect(VexTheme.tintFromPage('#f5f5f5')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--page-tint')).toBe('#f5f5f5');
  });

  it('is dropped when it would swallow the toolbar icons', async () => {
    await VexTheme.set('oxford');
    expect(VexTheme.tintFromPage('#101010')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--page-tint')).toBe('');
  });

  it('expands a three-digit colour and refuses nonsense', async () => {
    await VexTheme.set('midnight');
    expect(VexTheme.tintFromPage('#123')).toBe(true);
    expect(VexTheme.tintFromPage('rebeccapurple')).toBe(false);
    expect(VexTheme.tintFromPage(null)).toBe(false);
  });
});

describe('the shield', () => {
  it('is standard unless told otherwise', () => {
    expect(VexShield.level()).toBe('standard');
  });

  it('injects nothing when it is off', () => {
    expect(VexShield.script('off')).toBe('');
  });

  it('nudges canvas, audio and WebGL at standard', () => {
    const source = VexShield.script('standard');
    expect(source).toContain('toDataURL');
    expect(source).toContain('getChannelData');
    expect(source).toContain('37445');
    expect(source).toContain('globalPrivacyControl');
    expect(source).not.toContain('hardwareConcurrency');
  });

  it('also flattens the hardware tells at strict', () => {
    const source = VexShield.script('strict');
    expect(source).toContain('hardwareConcurrency');
    expect(source).toContain('deviceMemory');
    expect(source).toContain('getBattery');
  });

  it('is valid JavaScript, not a string that only looks like it', () => {
    // A shim with a syntax error silently protects nothing.
    expect(() => new Function(VexShield.script('strict'))).not.toThrow();
  });

  it('hands the script to native and remembers whether it runs early', async () => {
    window.VexBridge.setDocumentStartScript.mockResolvedValueOnce({ atDocumentStart: false });
    const result = await VexShield.install();
    expect(window.VexBridge.setDocumentStartScript).toHaveBeenCalled();
    expect(result.early).toBe(false);
    expect(store['vex.shieldEarly']).toBe(false);
  });
});
