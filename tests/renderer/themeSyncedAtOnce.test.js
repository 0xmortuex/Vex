// @vitest-environment jsdom
//
// TH12 (found 2026-10-10): a theme that arrived from another device, or with
// a restored backup, was worn only from the next start. It is worn as soon as
// it arrives, unless Light and dark or the theme editor decides the theme.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let stored;
async function load() {
  vi.resetModules();
  stored = new Map();
  globalThis.VexStorage = {
    load: vi.fn(async (k) => stored.get(k)),
    save: vi.fn(async (k, v) => { stored.set(k, v); }),
  };
  delete globalThis.ThemeStudio; delete globalThis.ThemeAuto;
  localStorage.clear();
  const { ThemeManager } = await import('../../src/renderer/js/theme-manager.js');
  ThemeManager.applyTheme('oxford', { persist: false });
  return ThemeManager;
}

beforeEach(() => { document.documentElement.removeAttribute('data-theme'); });

describe('a synced or restored theme is worn at once', () => {
  it('a sync that brought another theme applies it, without saving it again', async () => {
    const TM = await load();
    stored.set('theme', 'nord');
    window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));
    await vi.waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('nord'));
    expect(TM.currentTheme).toBe('nord');
    expect(VexStorage.save).not.toHaveBeenCalled();
  });

  it('a restored backup applies its theme and saves it as the theme', async () => {
    const TM = await load();
    localStorage.setItem('vex.theme', 'dracula');
    expect(await TM.applySynced('backup')).toBe('dracula');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dracula');
    expect(stored.get('theme')).toBe('dracula');
  });

  it('leaves the theme to Light and dark when it is on', async () => {
    const TM = await load();
    globalThis.ThemeAuto = { isOn: () => true, evaluate: vi.fn() };
    stored.set('theme', 'nord');
    expect(await TM.applySynced()).toBeNull();
    expect(ThemeAuto.evaluate).toHaveBeenCalledWith({ force: true });
    expect(TM.currentTheme).toBe('oxford');
  });

  it('leaves the theme editor\'s preview on screen', async () => {
    const TM = await load();
    globalThis.ThemeStudio = { isEditing: () => true };
    stored.set('theme', 'nord');
    expect(await TM.applySynced()).toBeNull();
    expect(TM.currentTheme).toBe('oxford');
  });

  it('does nothing when the theme did not change or is unknown', async () => {
    const TM = await load();
    stored.set('theme', 'oxford');
    expect(await TM.applySynced()).toBeNull();
    stored.set('theme', 'no-such-theme');
    expect(await TM.applySynced()).toBeNull();
    expect(TM.currentTheme).toBe('oxford');
  });
});
