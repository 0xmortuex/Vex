// === Vex Theme Manager ===
//
// Two themes: 'default' (existing graphite + amber glassmorphism, no behavior
// change) and 'blackops' (gold-on-black CIA aesthetic, no glass, no rounding).
// Toggle via Ctrl+Shift+T. Persisted via VexStorage under key 'theme'.
//
// applyTheme() sets `data-theme` on <html>; CSS variable overrides in
// theme-tokens.css cascade through every existing var(--vex-...) reference.
// A 'theme-changed' CustomEvent fires on document so blackops decorations
// (status bar, watermark) can react.

const ThemeManager = {
  currentTheme: 'default',
  availableThemes: ['default', 'blackops'],

  async init() {
    let saved = null;
    try {
      if (typeof VexStorage !== 'undefined' && VexStorage.load) {
        saved = await VexStorage.load('theme');
      }
    } catch (e) {
      console.warn('[ThemeManager] load failed:', e);
    }
    this.currentTheme = (typeof saved === 'string' && this.availableThemes.includes(saved))
      ? saved
      : 'default';
    this.applyTheme(this.currentTheme, { persist: false });
  },

  applyTheme(themeName, opts) {
    opts = opts || {};
    if (!this.availableThemes.includes(themeName)) {
      console.warn(`[ThemeManager] Unknown theme: ${themeName}, falling back to default`);
      themeName = 'default';
    }

    document.documentElement.setAttribute('data-theme', themeName);
    this.currentTheme = themeName;

    if (opts.persist !== false) {
      try {
        if (typeof VexStorage !== 'undefined' && VexStorage.save) {
          VexStorage.save('theme', themeName);
        }
      } catch (e) {
        console.warn('[ThemeManager] save failed:', e);
      }
    }

    document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: themeName } }));
  },

  cycleTheme() {
    const idx = this.availableThemes.indexOf(this.currentTheme);
    const next = this.availableThemes[(idx + 1) % this.availableThemes.length];
    this.applyTheme(next);
    return next;
  },

  getCurrentTheme() {
    return this.currentTheme;
  }
};

if (typeof window !== 'undefined') {
  window.ThemeManager = ThemeManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThemeManager };
}
