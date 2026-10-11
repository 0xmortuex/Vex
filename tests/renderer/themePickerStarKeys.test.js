// @vitest-environment jsdom
//
// The theme picker's favourite star took no focus and no key: favourites could
// only be made with a mouse (cat-themes hunch, confirmed).
import { describe, it, expect, vi } from 'vitest';

describe('theme picker favourite star', () => {
  it('is focusable, says whether it is on, and Enter or Space stars the theme with focus kept on it', async () => {
    vi.resetModules();
    localStorage.clear();
    require('../../src/renderer/js/vex-icons.js');
    globalThis.VexIcons = window.VexIcons;
    window.showToast = vi.fn();
    const { ThemeManager } = require('../../src/renderer/js/theme-manager.js');
    globalThis.ThemeManager = ThemeManager;
    const { ThemePicker } = require('../../src/renderer/js/theme-picker.js');
    ThemePicker.open();
    try {
      const starOf = (id) => document.querySelector(`.vtp-card[data-theme="${id}"] .vtp-star`);
      const star = starOf('nord');
      expect(star.tabIndex).toBe(0);
      expect(star.getAttribute('aria-pressed')).toBe('false');
      star.focus();
      star.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(ThemeManager.isFavorite('nord')).toBe(true);
      expect(document.activeElement).toBe(starOf('nord'));
      expect(starOf('nord').getAttribute('aria-pressed')).toBe('true');
      // the theme was starred, not put on
      expect(ThemeManager.getCurrentTheme()).not.toBe('nord');
      starOf('nord').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      expect(ThemeManager.isFavorite('nord')).toBe(false);
    } finally { ThemePicker.close(); }
  }, 60000);
});
