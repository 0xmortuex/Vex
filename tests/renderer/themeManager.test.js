// @vitest-environment jsdom
//
// Vex theme system — ThemeManager covers the multi-theme registry (oxford is
// the default; default + 6 promoted presets round out the set), data-theme
// attribute application, persistence via VexStorage, the blackops→oxford
// migration for stale saved values, cycle behavior, and the 'theme-changed'
// CustomEvent. The CSS token swap is jsdom-untestable (no real paint), so these
// cases assert the contract that the picker and start page depend on.

import { describe, it, expect, beforeEach, vi } from 'vitest';

let storedValue = undefined;

function installGlobals() {
  storedValue = undefined;
  globalThis.VexStorage = {
    load: vi.fn(async (key) => (key === 'theme' ? storedValue : undefined)),
    save: vi.fn(async (key, value) => { if (key === 'theme') storedValue = value; }),
  };
  document.documentElement.removeAttribute('data-theme');
}

async function loadThemeManager() {
  vi.resetModules();
  const mod = await import('../../src/renderer/js/theme-manager.js');
  return mod.ThemeManager;
}

describe('ThemeManager', () => {
  beforeEach(() => {
    installGlobals();
  });

  it('exposes the expected themes, oxford first', async () => {
    const TM = await loadThemeManager();
    expect(TM.availableThemes).toEqual([
      'oxford', 'default', 'midnight', 'forest', 'ocean', 'dracula', 'nord', 'catppuccin',
      'sunset', 'rose', 'matrix', 'mocha', 'solarized', 'vaporwave',
      'aurora', 'crimson', 'gold', 'sakura', 'cyberpunk', 'monochrome',
      'slate', 'emerald', 'amethyst', 'volcano', 'sapphire', 'honey', 'mint', 'obsidian', 'custom'
    ]);
    expect(TM.DEFAULT_THEME).toBe('oxford');
  });

  it('init() defaults to "oxford" when no value is persisted', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('oxford');
    expect(document.documentElement.getAttribute('data-theme')).toBe('oxford');
  });

  it('init() restores a previously persisted theme', async () => {
    storedValue = 'dracula';
    const TM = await loadThemeManager();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('dracula');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dracula');
  });

  it('init() migrates a stale "blackops" value to oxford', async () => {
    storedValue = 'blackops';
    const TM = await loadThemeManager();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('oxford');
    expect(document.documentElement.getAttribute('data-theme')).toBe('oxford');
  });

  it('init() falls back to "oxford" when persisted value is unknown', async () => {
    storedValue = 'matrix-rain';
    const TM = await loadThemeManager();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('oxford');
    expect(document.documentElement.getAttribute('data-theme')).toBe('oxford');
  });

  it('applyTheme(name) sets data-theme on documentElement', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    TM.applyTheme('nord');
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord');
    expect(TM.getCurrentTheme()).toBe('nord');
  });

  it('applyTheme persists the chosen theme to VexStorage', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    TM.applyTheme('forest');
    expect(VexStorage.save).toHaveBeenCalledWith('theme', 'forest');
    expect(storedValue).toBe('forest');
  });

  it('applyTheme with an unknown name falls back to "oxford"', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    TM.applyTheme('totally-fake-theme');
    expect(TM.getCurrentTheme()).toBe('oxford');
    expect(document.documentElement.getAttribute('data-theme')).toBe('oxford');
  });

  it('applyTheme("blackops") migrates to oxford rather than erroring', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    TM.applyTheme('blackops');
    expect(TM.getCurrentTheme()).toBe('oxford');
  });

  it('cycleTheme rotates through all themes and wraps around', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('oxford');
    const ids = TM.availableThemes;
    const seen = [];
    for (let i = 0; i < ids.length - 1; i++) seen.push(TM.cycleTheme());
    // Cycles through every non-oxford theme in registry order…
    expect(seen).toEqual(ids.slice(1));
    // …then one more wraps back to oxford.
    expect(TM.cycleTheme()).toBe('oxford');
  });

  it('applyTheme dispatches "theme-changed" CustomEvent with detail.theme', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    const handler = vi.fn();
    document.addEventListener('theme-changed', handler);
    TM.applyTheme('ocean');
    expect(handler).toHaveBeenCalled();
    const evt = handler.mock.calls[0][0];
    expect(evt.detail).toEqual({ theme: 'ocean' });
    document.removeEventListener('theme-changed', handler);
  });

  it('applyTheme mirrors theme to localStorage("vex.theme")', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    TM.applyTheme('midnight');
    expect(localStorage.getItem('vex.theme')).toBe('midnight');
    TM.applyTheme('oxford');
    expect(localStorage.getItem('vex.theme')).toBe('oxford');
  });

  it('getThemeMeta returns the registry entry with a label and preview', async () => {
    const TM = await loadThemeManager();
    const meta = TM.getThemeMeta('oxford');
    expect(meta.label).toBe('Oxford Editorial');
    expect(meta.preview).toBe('oxford.png');
  });

  it('applyTheme broadcasts the active theme to vex://start webviews via executeJavaScript', async () => {
    const exec = vi.fn(() => Promise.resolve());
    const otherExec = vi.fn(() => Promise.resolve());
    globalThis.WebviewManager = {
      webviews: new Map([
        ['t1', { getURL: () => 'vex://start', executeJavaScript: exec }],
        ['t2', { getURL: () => 'https://example.com', executeJavaScript: otherExec }],
      ]),
    };
    const TM = await loadThemeManager();
    await TM.init();
    exec.mockClear();
    otherExec.mockClear();
    TM.applyTheme('catppuccin');
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0][0]).toContain("setAttribute('data-theme','catppuccin')");
    expect(otherExec).not.toHaveBeenCalled();
    delete globalThis.WebviewManager;
  });
});
