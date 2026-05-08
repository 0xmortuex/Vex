// === Vex Theme Manager ===
//
// Two themes: 'default' (existing graphite + amber glassmorphism, no behavior
// change) and 'blackops' (gold-on-black CIA aesthetic, no glass, no rounding).
// Toggle via Ctrl+Shift+Y (registered through ShortcutsRegistry as 'toggle-theme'
// — Ctrl+Shift+T is reserved for "Reopen Closed Tab" by the browser convention
// and is intercepted by main.js + ShortcutsRegistry before reaching us).
// Persisted via VexStorage under key 'theme'.
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

    // Mirror to localStorage so same-origin documents can read the current
    // theme. The vex://start page is cross-origin so it relies on the main
    // process protocol handler injecting data-theme into the served HTML;
    // for already-loaded vex://start webviews we push live via the
    // executeJavaScript broadcast below.
    try { localStorage.setItem('vex.theme', themeName); } catch {}

    try {
      if (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) {
        for (const wv of WebviewManager.webviews.values()) {
          let url;
          try { url = typeof wv.getURL === 'function' ? wv.getURL() : null; } catch { url = null; }
          if (!url || !url.startsWith('vex://start')) continue;
          // Two-pronged update for live vex://start tabs:
          //  1. setAttribute via executeJavaScript — flips the active doc
          //     immediately if the page is already loaded.
          //  2. reloadIgnoringCache — forces the protocol handler to re-run
          //     with the new theme baked into the served HTML, defeating
          //     any Chromium webview cache on the persist:main partition.
          //     This was the cause of the round 1/2/3 typography ghost.
          const js = themeName === 'blackops'
            ? "document.documentElement.setAttribute('data-theme','blackops');"
            : "document.documentElement.removeAttribute('data-theme');";
          try { wv.executeJavaScript(js).catch(() => {}); } catch {}
          try { wv.reloadIgnoringCache?.(); } catch {}
        }
      }
    } catch {}

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
