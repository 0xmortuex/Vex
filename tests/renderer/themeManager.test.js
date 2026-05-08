// @vitest-environment jsdom
//
// Vex theme system — ThemeManager covers theme persistence (default ↔ blackops),
// data-theme attribute application, cycle behavior, and the 'theme-changed'
// CustomEvent. The actual CSS token swap is jsdom-untestable (no real paint),
// so these cases assert the contract: applyTheme sets the attr, persists via
// VexStorage, and emits the event that decoration modules listen for.

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
  // theme-manager.js attaches to window and exports via module.exports.
  const mod = await import('../../src/renderer/js/theme-manager.js');
  return mod.ThemeManager;
}

describe('ThemeManager', () => {
  beforeEach(() => {
    installGlobals();
  });

  it('init() defaults to "default" when no value is persisted', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('default');
    expect(document.documentElement.getAttribute('data-theme')).toBe('default');
  });

  it('init() restores a previously persisted theme', async () => {
    storedValue = 'blackops';
    const TM = await loadThemeManager();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('blackops');
    expect(document.documentElement.getAttribute('data-theme')).toBe('blackops');
  });

  it('init() falls back to "default" when persisted value is unknown', async () => {
    storedValue = 'matrix-rain';
    const TM = await loadThemeManager();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('default');
    expect(document.documentElement.getAttribute('data-theme')).toBe('default');
  });

  it('applyTheme("blackops") sets data-theme="blackops" on documentElement', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    TM.applyTheme('blackops');
    expect(document.documentElement.getAttribute('data-theme')).toBe('blackops');
    expect(TM.getCurrentTheme()).toBe('blackops');
  });

  it('applyTheme persists the chosen theme to VexStorage', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    TM.applyTheme('blackops');
    expect(VexStorage.save).toHaveBeenCalledWith('theme', 'blackops');
    expect(storedValue).toBe('blackops');
  });

  it('applyTheme with an unknown name falls back to "default"', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    TM.applyTheme('totally-fake-theme');
    expect(TM.getCurrentTheme()).toBe('default');
    expect(document.documentElement.getAttribute('data-theme')).toBe('default');
  });

  it('cycleTheme rotates default → blackops → default', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('default');

    expect(TM.cycleTheme()).toBe('blackops');
    expect(TM.getCurrentTheme()).toBe('blackops');

    expect(TM.cycleTheme()).toBe('default');
    expect(TM.getCurrentTheme()).toBe('default');
  });

  it('applyTheme dispatches "theme-changed" CustomEvent with detail.theme', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    const handler = vi.fn();
    document.addEventListener('theme-changed', handler);
    TM.applyTheme('blackops');
    expect(handler).toHaveBeenCalled();
    const evt = handler.mock.calls[0][0];
    expect(evt.detail).toEqual({ theme: 'blackops' });
    document.removeEventListener('theme-changed', handler);
  });

  it('applyTheme mirrors theme to localStorage("vex.theme")', async () => {
    const TM = await loadThemeManager();
    await TM.init();
    TM.applyTheme('blackops');
    expect(localStorage.getItem('vex.theme')).toBe('blackops');
    TM.applyTheme('default');
    expect(localStorage.getItem('vex.theme')).toBe('default');
  });

  it('applyTheme broadcasts to vex://start webviews via executeJavaScript', async () => {
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
    TM.applyTheme('blackops');
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0][0]).toContain("setAttribute('data-theme','blackops')");
    expect(otherExec).not.toHaveBeenCalled();
    delete globalThis.WebviewManager;
  });
});
