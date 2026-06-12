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
    // New themes — captured PNG previews (scripts/capture-theme-previews.js); the
    // `mock` palette is the live CSS fallback if a PNG ever fails to load.
    { id: 'sunset',     label: 'Sunset',      preview: 'sunset.png',     accent: '#ff7a59', mock: { bg: '#1b1115', side: '#221318', surf: '#2a1a20', txt: '#f3d9cf', acc: '#ff7a59' } },
    { id: 'rose',       label: 'Rosé',        preview: 'rose.png',       accent: '#ea9a97', mock: { bg: '#1f1d2e', side: '#232136', surf: '#2a273f', txt: '#e0def4', acc: '#ea9a97' } },
    { id: 'matrix',     label: 'Matrix',      preview: 'matrix.png',     accent: '#22c55e', mock: { bg: '#050807', side: '#081009', surf: '#0c130d', txt: '#b8f0c0', acc: '#22c55e' } },
    { id: 'mocha',      label: 'Mocha',       preview: 'mocha.png',      accent: '#d2956a', mock: { bg: '#1c1714', side: '#221c19', surf: '#2a2320', txt: '#ecdfd6', acc: '#d2956a' } },
    { id: 'solarized',  label: 'Solarized',   preview: 'solarized.png',  accent: '#268bd2', mock: { bg: '#00252e', side: '#002b36', surf: '#073642', txt: '#93a1a1', acc: '#268bd2' } },
    { id: 'vaporwave',  label: 'Vaporwave',   preview: 'vaporwave.png',  accent: '#ff71ce', mock: { bg: '#1a0f2e', side: '#1f1233', surf: '#271640', txt: '#f0e6ff', acc: '#ff71ce' } },
    { id: 'aurora',     label: 'Aurora',      preview: 'aurora.png',     accent: '#34d399', mock: { bg: '#0a1612', side: '#0d1f18', surf: '#102a22', txt: '#c8f0e0', acc: '#34d399' } },
    { id: 'crimson',    label: 'Crimson',     preview: 'crimson.png',    accent: '#ef4444', mock: { bg: '#160a0c', side: '#1e0d10', surf: '#2a1015', txt: '#f0d0d4', acc: '#ef4444' } },
    { id: 'gold',       label: 'Gold',        preview: 'gold.png',       accent: '#d4af37', mock: { bg: '#12100a', side: '#1a160e', surf: '#221d12', txt: '#ecdfb8', acc: '#d4af37' } },
    { id: 'sakura',     label: 'Sakura',      preview: 'sakura.png',     accent: '#f9a8d4', mock: { bg: '#1a0f14', side: '#22131a', surf: '#2a1820', txt: '#f0d8e4', acc: '#f9a8d4' } },
    { id: 'cyberpunk',  label: 'Cyberpunk',   preview: 'cyberpunk.png',  accent: '#fde047', mock: { bg: '#0a0a12', side: '#0f0f18', surf: '#15151f', txt: '#e8e8f0', acc: '#fde047' } },
    { id: 'monochrome', label: 'Monochrome',  preview: 'monochrome.png', accent: '#d4d4d4', mock: { bg: '#0d0d0d', side: '#141414', surf: '#1f1f1f', txt: '#e5e5e5', acc: '#d4d4d4' } },
    { id: 'slate',      label: 'Slate',       preview: 'slate.png',      accent: '#94a3b8', mock: { bg: '#0f141a', side: '#141a22', surf: '#1a222c', txt: '#cbd5e1', acc: '#94a3b8' } },
    { id: 'emerald',    label: 'Emerald',     preview: 'emerald.png',    accent: '#10b981', mock: { bg: '#07150f', side: '#0a1c13', surf: '#0e2419', txt: '#c0f0d8', acc: '#10b981' } },
    { id: 'amethyst',   label: 'Amethyst',    preview: 'amethyst.png',   accent: '#a855f7', mock: { bg: '#140e1f', side: '#1a1228', surf: '#211733', txt: '#e2d4f5', acc: '#a855f7' } },
    { id: 'volcano',    label: 'Volcano',     preview: 'volcano.png',    accent: '#f97316', mock: { bg: '#160c08', side: '#1d1009', surf: '#261610', txt: '#f0d8c8', acc: '#f97316' } },
    { id: 'sapphire',   label: 'Sapphire',    preview: 'sapphire.png',   accent: '#3b82f6', mock: { bg: '#0a0f1f', side: '#0e1528', surf: '#131c33', txt: '#cdd9f0', acc: '#3b82f6' } },
    { id: 'honey',      label: 'Honey',       preview: 'honey.png',      accent: '#f59e0b', mock: { bg: '#161106', side: '#1d1609', surf: '#261d0c', txt: '#f0e2c0', acc: '#f59e0b' } },
    { id: 'mint',       label: 'Mint',        preview: 'mint.png',       accent: '#2dd4bf', mock: { bg: '#0a1614', side: '#0d1d1a', surf: '#122624', txt: '#c8f0ea', acc: '#2dd4bf' } },
    { id: 'obsidian',   label: 'Obsidian',    preview: 'obsidian.png',   accent: '#94a3b8', mock: { bg: '#08090b', side: '#0e1013', surf: '#141619', txt: '#d8dde5', acc: '#94a3b8' } },
    { id: 'ruby',       label: 'Ruby',        preview: 'ruby.png',       accent: '#e11d48', mock: { bg: '#170a0f', side: '#1f0d13', surf: '#2a1018', txt: '#f0cdd6', acc: '#e11d48' } },
    { id: 'lime',       label: 'Lime',        preview: 'lime.png',       accent: '#84cc16', mock: { bg: '#0f1505', side: '#14200a', surf: '#1c2610', txt: '#dcecc0', acc: '#84cc16' } },
    { id: 'bronze',     label: 'Bronze',      preview: 'bronze.png',     accent: '#c0824a', mock: { bg: '#15100a', side: '#1c1509', surf: '#251c10', txt: '#ecdcc8', acc: '#c0824a' } },
    { id: 'plum',       label: 'Plum',        preview: 'plum.png',       accent: '#c026d3', mock: { bg: '#150a17', side: '#1d0d20', surf: '#261029', txt: '#f0d4f5', acc: '#c026d3' } },
    { id: 'arctic',     label: 'Arctic',      preview: 'arctic.png',     accent: '#38bdf8', mock: { bg: '#0a1118', side: '#0d1822', surf: '#122230', txt: '#d0e4f0', acc: '#38bdf8' } },
    { id: 'wine',       label: 'Wine',        preview: 'wine.png',       accent: '#be123c', mock: { bg: '#14080c', side: '#1d0a11', surf: '#260e16', txt: '#f0cdd4', acc: '#be123c' } },
    { id: 'custom',     label: 'Custom Image', preview: 'custom.png',    accent: '#8b8bff', mock: { bg: '#0e0e12', side: '#141419', surf: '#1a1a22', txt: '#e6e6f0', acc: '#8b8bff' }, upload: true },
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

  // --- Favorite themes (starred in the picker) ---
  FAV_KEY: 'vex.favThemes',
  getFavorites() {
    try { const a = JSON.parse(localStorage.getItem(this.FAV_KEY) || '[]'); return Array.isArray(a) ? a.filter(id => this.availableThemes.includes(id)) : []; }
    catch { return []; }
  },
  isFavorite(id) { return this.getFavorites().includes(id); },
  toggleFavorite(id) {
    let f = this.getFavorites();
    if (f.includes(id)) f = f.filter(x => x !== id); else f.push(id);
    try { localStorage.setItem(this.FAV_KEY, JSON.stringify(f)); } catch {}
    return f.includes(id);
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
