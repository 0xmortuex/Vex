// === Vex Theme Manager ===
//
// Multi-theme registry. The default and always-first theme is 'oxford' (warm
// cream editorial light). The classic graphite+amber glass look lives on as
// 'default'. Six more themes (midnight, forest, ocean, dracula, nord,
// catppuccin) were promoted from the old Theme Editor preset list.
//
// Ctrl+Shift+Y opens a visual picker (theme-picker.js) rather than blind
// cycling — see app.js. cycleTheme() is kept for programmatic/test use.
//
// applyTheme() sets `data-theme` on <html>; CSS variable overrides in
// theme-tokens.css cascade through every var(--vex-...) and legacy var(--...)
// reference. A 'theme-changed' CustomEvent fires on document so other modules
// (e.g. the picker's active-state) can react. Persisted via VexStorage under
// key 'theme', mirrored to localStorage('vex.theme') for the cross-origin
// vex://start page, which main.js also bakes in at serve time.

const ThemeManager = {
  DEFAULT_THEME: 'oxford',

  // Registry — order is the picker's display order. `preview` is the PNG under
  // assets/theme-previews/ shown on each picker card.
  THEMES: [
    { id: 'oxford',     label: 'Oxford Editorial', preview: 'oxford.png',     accent: '#1e3a5f' },
    { id: 'default',    label: 'Graphite',         preview: 'default.png',    accent: '#d4a574' },
    { id: 'midnight',   label: 'Midnight',         preview: 'midnight.png',   accent: '#6366f1' },
    { id: 'forest',     label: 'Forest',           preview: 'forest.png',     accent: '#4ade80' },
    { id: 'ocean',      label: 'Ocean',            preview: 'ocean.png',      accent: '#0ea5e9' },
    { id: 'dracula',    label: 'Dracula',          preview: 'dracula.png',    accent: '#bd93f9' },
    { id: 'nord',       label: 'Nord',             preview: 'nord.png',       accent: '#88c0d0' },
    { id: 'catppuccin', label: 'Catppuccin',       preview: 'catppuccin.png', accent: '#c9cbff' },
    // New in v2.15 — vivid palettes (no PNG; the picker draws an accent swatch).
    { id: 'sunset',     label: 'Sunset',           preview: 'sunset.png',     accent: '#ff7a59' },
    { id: 'rose',       label: 'Rosé',             preview: 'rose.png',       accent: '#ea9a97' },
    { id: 'matrix',     label: 'Matrix',           preview: 'matrix.png',     accent: '#22c55e' },
    { id: 'mocha',      label: 'Mocha',            preview: 'mocha.png',      accent: '#d2956a' },
    { id: 'solarized',  label: 'Solarized',        preview: 'solarized.png',  accent: '#268bd2' },
    { id: 'vaporwave',  label: 'Vaporwave',        preview: 'vaporwave.png',  accent: '#ff71ce' },
    { id: 'custom',     label: 'Custom Image',      preview: 'custom.png',     accent: '#8b8bff' },
  ],

  currentTheme: 'oxford',

  get availableThemes() {
    return this.THEMES.map(t => t.id);
  },

  // Old persisted values that should fall back to Oxford instead of erroring.
  _migrate(name) {
    if (name === 'blackops') return 'oxford';
    return name;
  },

  async init() {
    let saved = null;
    try {
      if (typeof VexStorage !== 'undefined' && VexStorage.load) {
        saved = await VexStorage.load('theme');
      }
    } catch (e) {
      console.warn('[ThemeManager] load failed:', e);
    }
    if (typeof saved === 'string') saved = this._migrate(saved);
    this.currentTheme = (typeof saved === 'string' && this.availableThemes.includes(saved))
      ? saved
      : this.DEFAULT_THEME;
    this.applyTheme(this.currentTheme, { persist: false });
  },

  applyTheme(themeName, opts) {
    opts = opts || {};
    themeName = this._migrate(themeName);
    if (!this.availableThemes.includes(themeName)) {
      console.warn(`[ThemeManager] Unknown theme: ${themeName}, falling back to ${this.DEFAULT_THEME}`);
      themeName = this.DEFAULT_THEME;
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
        const safe = themeName.replace(/[^a-z]/g, '');
        for (const wv of WebviewManager.webviews.values()) {
          let url;
          try { url = typeof wv.getURL === 'function' ? wv.getURL() : null; } catch { url = null; }
          if (!url) continue;
          // Match BOTH the canonical vex://start AND the file:// start.html that
          // get-start-page-url actually serves at runtime (the file:// page
          // bypasses the vex:// theme-baker, so it was being skipped here — the
          // reason live switches never recolored an open start page).
          const isStart = url.startsWith('vex://start')
            || (/^file:/i.test(url) && /\/renderer\/start\.html(?:[?#]|$)/i.test(url));
          if (!isStart) continue;
          // Instant recolor of the live doc...
          const js = `document.documentElement.setAttribute('data-theme','${safe}');`;
          try { wv.executeJavaScript(js).catch(() => {}); } catch {}
          // ...then reload so a refresh keeps the new theme. vex://start reloads
          // through its server-side baker; the file:// page must reload at a URL
          // carrying the new ?theme= (its only theme source).
          if (url.startsWith('vex://start')) {
            try { wv.reloadIgnoringCache?.(); } catch {}
          } else {
            let newUrl;
            try {
              const u = new URL(url);
              u.searchParams.set('theme', safe);
              newUrl = u.toString();
            } catch {
              newUrl = url.split('#')[0].split('?')[0] + `?theme=${safe}`;
            }
            try {
              if (typeof wv.loadURL === 'function') wv.loadURL(newUrl);
              else wv.src = newUrl;
            } catch {}
          }
        }
      }
    } catch {}

    document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: themeName } }));
  },

  // Store a user-uploaded image (data URL) for the Custom Image theme and push
  // it into the start-page webview(s) BEFORE applyTheme reloads them, so the
  // start page can read it from its own (separate-session) localStorage. Awaits
  // the guest writes to avoid a reload race.
  async setCustomImage(dataUrl) {
    try { dataUrl ? localStorage.setItem('vex.customThemeImage', dataUrl) : localStorage.removeItem('vex.customThemeImage'); } catch {}
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    const js = dataUrl
      ? `try{localStorage.setItem('vex.customThemeImage',${JSON.stringify(dataUrl)})}catch(e){}`
      : `try{localStorage.removeItem('vex.customThemeImage')}catch(e){}`;
    const jobs = [];
    for (const wv of WebviewManager.webviews.values()) {
      let url = ''; try { url = typeof wv.getURL === 'function' ? wv.getURL() : ''; } catch {}
      const isStart = url.startsWith('vex://start') || (/^file:/i.test(url) && /\/renderer\/start\.html(?:[?#]|$)/i.test(url));
      if (isStart) { try { jobs.push(wv.executeJavaScript(js).catch(() => {})); } catch {} }
    }
    try { await Promise.all(jobs); } catch {}
  },

  cycleTheme() {
    const ids = this.availableThemes;
    const idx = ids.indexOf(this.currentTheme);
    const next = ids[(idx + 1) % ids.length];
    this.applyTheme(next);
    return next;
  },

  getCurrentTheme() {
    return this.currentTheme;
  },

  getThemeMeta(id) {
    return this.THEMES.find(t => t.id === (id || this.currentTheme)) || this.THEMES[0];
  }
};

if (typeof window !== 'undefined') {
  window.ThemeManager = ThemeManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThemeManager };
}
