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
    { id: 'solarized',  label: 'Solarized',   preview: 'solarized.png',  accent: '#3a9be0', mock: { bg: '#00252e', side: '#002b36', surf: '#073642', txt: '#b3bfbf', acc: '#3a9be0' } },
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
    // The colours the Firefox look paints the chrome with, as themes, so the
    // rest of Vex can match it instead of pulling in a different palette.
    // Light is the first light theme here.
    { id: 'firefox-light', label: 'Firefox Light', preview: 'firefox-light.png', accent: '#0061e0', mock: { bg: '#f9f9fb', side: '#f0f0f4', surf: '#ffffff', txt: '#15141a', acc: '#0061e0' } },
    { id: 'firefox-dark',  label: 'Firefox Dark',  preview: 'firefox-dark.png',  accent: '#00ddff', mock: { bg: '#1c1b22', side: '#18171e', surf: '#2b2a33', txt: '#fbfbfe', acc: '#00ddff' } },
    // Themes for a need rather than a mood (item #5): black on white for low
    // vision, a warm dim one for reading at night, and Windows 11's Mica as a
    // light/dark pair (theme-auto.js pairs them). The true-black OLED theme is
    // AMOLED, below.
    { id: 'contrast-light', label: 'High Contrast Light', accent: '#0037a6', mock: { bg: '#ffffff', side: '#f0f0f0', surf: '#ffffff', txt: '#000000', acc: '#0037a6' } },
    { id: 'evening',        label: 'Evening',             accent: '#d48a3a', mock: { bg: '#18120c', side: '#120d08', surf: '#221a12', txt: '#dfc9a3', acc: '#d48a3a' } },
    { id: 'mica-light',     label: 'Mica Light',          accent: '#005fb8', mock: { bg: '#f3f3f3', side: '#eaeef4', surf: '#fbfbfb', txt: '#1a1a1a', acc: '#005fb8' } },
    { id: 'mica-dark',      label: 'Mica Dark',           accent: '#60cdff', mock: { bg: '#202020', side: '#1b1d22', surf: '#2b2b2b', txt: '#ffffff', acc: '#60cdff' } },
    // After the popular BetterDiscord themes: each one's own colour scheme,
    // named without product brands. inspiredBy is the picker card's tooltip.
    { id: 'clearvision',  label: 'ClearVision',    accent: '#2780e6', inspiredBy: 'ClearVision (BetterDiscord)', mock: { bg: '#15181e', side: '#101217', surf: '#1d2129', txt: '#d8d8db', acc: '#2780e6' } },
    { id: 'darkmatter',   label: 'Dark Matter',    accent: '#25ace8', inspiredBy: 'Dark Matter (BetterDiscord)', mock: { bg: '#161921', side: '#101218', surf: '#1d2029', txt: '#e4e6eb', acc: '#25ace8' } },
    { id: 'duskplus',     label: 'Dusk Plus',      accent: '#d147a3', inspiredBy: 'Discord+ (BetterDiscord)', mock: { bg: '#1c1219', side: '#160e13', surf: '#281b23', txt: '#e7ebef', acc: '#d147a3' } },
    { id: 'darkplus',     label: 'Dark Plus',      accent: '#bb86fc', inspiredBy: 'Dark+ (BetterDiscord)', mock: { bg: '#212121', side: '#1a1a1a', surf: '#302f2f', txt: '#e6e6e6', acc: '#bb86fc' } },
    { id: 'terminal',     label: 'Terminal Green', accent: '#4aef98', inspiredBy: 'Fallout 4 Terminal (BetterDiscord)', mock: { bg: '#000900', side: '#000500', surf: '#061a0c', txt: '#4aef98', acc: '#4aef98' } },
    { id: 'amoled',       label: 'AMOLED',         accent: '#5865f2', inspiredBy: 'AMOLED-Cord (BetterDiscord)', mock: { bg: '#000000', side: '#000000', surf: '#000000', txt: '#f2f3f5', acc: '#5865f2' } },
    { id: 'recordgreen',  label: 'Record Green',   accent: '#1db954', inspiredBy: 'Spotify Discord (BetterDiscord)', mock: { bg: '#121212', side: '#000000', surf: '#1a1a1a', txt: '#d9d9d9', acc: '#1db954' } },
    { id: 'darkneon',     label: 'Dark Neon',      accent: '#04d9ff', inspiredBy: 'Dark Neon (BetterDiscord)', mock: { bg: '#000000', side: '#000000', surf: '#07111a', txt: '#c5c8c6', acc: '#04d9ff' } },
    { id: 'deepmidnight', label: 'Deep Midnight',  accent: '#46aec5', inspiredBy: 'midnight by refact0r (BetterDiscord)', mock: { bg: '#16181d', side: '#111317', surf: '#1c1f26', txt: '#edf0f8', acc: '#46aec5' } },
    { id: 'softx',        label: 'SoftX',          accent: '#00e6a8', inspiredBy: 'SoftX (BetterDiscord)', mock: { bg: '#1a1a1a', side: '#131313', surf: '#222222', txt: '#e8e8e8', acc: '#00e6a8' } },
    { id: 'neutron',      label: 'Neutron',        accent: '#7a5ae6', inspiredBy: 'Neutron (BetterDiscord)', mock: { bg: '#0f0c1a', side: '#0a0812', surf: '#18132b', txt: '#e6e1f5', acc: '#7a5ae6' } },
    { id: 'nocturnal',    label: 'Nocturnal',      accent: '#2f86dc', inspiredBy: 'Nocturnal (BetterDiscord)', mock: { bg: '#12171d', side: '#0e1217', surf: '#1e2731', txt: '#dde6ef', acc: '#2f86dc' } },
    { id: 'tokyonight',   label: 'Tokyo Night',    accent: '#7aa2f7', inspiredBy: 'Tokyo Night (BetterDiscord)', mock: { bg: '#1a1b26', side: '#16161e', surf: '#1f2030', txt: '#c0caf5', acc: '#7aa2f7' } },
    { id: 'material',     label: 'Material',       accent: '#6682e5', inspiredBy: 'MaterialDiscord (BetterDiscord)', mock: { bg: '#161922', side: '#101219', surf: '#1e212f', txt: '#dbdde6', acc: '#6682e5' } },
    { id: 'androidbeige', label: 'Android Beige',  accent: '#57544a', inspiredBy: 'NieR: Automata - YoRHa Menu UI (BetterDiscord)', mock: { bg: '#dad4bb', side: '#cdc7ad', surf: '#e4dfca', txt: '#3a3831', acc: '#57544a' } },
    { id: 'kaleidoscope', label: 'Kaleidoscope',   accent: '#d129ff', inspiredBy: 'kaleidoscope (BetterDiscord)', mock: { bg: '#010b1e', side: '#00050f', surf: '#031028', txt: '#dcddde', acc: '#d129ff' } },
    { id: 'codedark',     label: 'Code Dark',      accent: '#4a86c5', inspiredBy: 'Discord Dark (BetterDiscord)', mock: { bg: '#1a1a1a', side: '#141414', surf: '#222222', txt: '#e0e0e0', acc: '#4a86c5' } },
    { id: 'synthesis',    label: 'Synthesis',      accent: '#ffa500', inspiredBy: 'Synthesis (BetterDiscord)', mock: { bg: '#140624', side: '#0e041a', surf: '#1f0c36', txt: '#ffffff', acc: '#ffa500' } },
    { id: 'virtualred',   label: 'Virtual Red',    accent: '#ff0000', inspiredBy: 'Virtual Boy (BetterDiscord)', mock: { bg: '#000000', side: '#000000', surf: '#120000', txt: '#ff1a1a', acc: '#ff0000' } },
    { id: 'paperred',     label: 'Paper Red',      accent: '#d40000', inspiredBy: 'piOS, light mode (BetterDiscord)', mock: { bg: '#ffffff', side: '#f2f2f2', surf: '#ffffff', txt: '#000000', acc: '#d40000' } },
    { id: 'noctisviola',  label: 'Noctis Viola',   accent: '#bf8ef1', inspiredBy: 'Noctis Viola (BetterDiscord)', mock: { bg: '#30243d', side: '#2b2136', surf: '#3d2e4d', txt: '#ccbfd9', acc: '#bf8ef1' } },
    { id: 'wildberry',    label: 'Wildberry',      accent: '#f40174', inspiredBy: 'Wildberry (BetterDiscord)', mock: { bg: '#170027', side: '#10001c', surf: '#25003f', txt: '#f3e6ff', acc: '#f40174' } },
    { id: 'gxred',        label: 'GX Red',         accent: '#de4364', inspiredBy: 'OperaGX Theme (BetterDiscord)', mock: { bg: '#121019', side: '#08050e', surf: '#1b1824', txt: '#eeeff0', acc: '#de4364' } },
    { id: 'gruvbox',      label: 'Gruvbox',        accent: '#83a598', inspiredBy: 'Gruvbox Sharp (BetterDiscord)', mock: { bg: '#282828', side: '#1d2021', surf: '#32302f', txt: '#ebdbb2', acc: '#83a598' } },
    { id: 'rosynight',    label: 'RosyNight',      accent: '#fc8686', inspiredBy: 'RosyNight (BetterDiscord)', mock: { bg: '#181818', side: '#121212', surf: '#212121', txt: '#f3dcdc', acc: '#fc8686' } },
    { id: 'azurite',      label: 'Azurite',        accent: '#24cc89', inspiredBy: 'Azurite (BetterDiscord)', mock: { bg: '#040429', side: '#020220', surf: '#121236', txt: '#e2e6ff', acc: '#24cc89' } },
    { id: 'neptune',      label: 'Neptune',        accent: '#228bd1', inspiredBy: 'Neptune (BetterDiscord)', mock: { bg: '#1a2035', side: '#141a2c', surf: '#222a43', txt: '#e2e8f5', acc: '#228bd1' } },
    { id: 'ezlight',      label: 'EzLight',        accent: '#735f1c', inspiredBy: 'EzLight (BetterDiscord)', mock: { bg: '#d0cec9', side: '#c9c6c0', surf: '#dfddda', txt: '#232221', acc: '#735f1c' } },
    // Your own themes (js/theme-studio.js) are added after these, with
    // `user: true`. The old Custom Image theme became one of them.
  ],

  currentTheme: 'oxford',

  get availableThemes() {
    return this.THEMES.map(t => t.id);
  },

  // Old persisted values that should fall back to Oxford instead of erroring.
  _migrate(name) {
    if (name === 'blackops') return 'oxford';
    // The Custom Image theme is now a theme of your own (js/theme-studio.js);
    // a 'custom' that arrives later (sync from an older Vex) means that one.
    if (name === 'custom') {
      let id = null;
      try { id = localStorage.getItem('vex.customImageThemeId'); } catch {}
      return id || this.DEFAULT_THEME;
    }
    return name;
  },

  async init() {
    // The old Custom Image theme becomes a theme of your own, once, before the
    // saved theme is read (it may be 'custom').
    if (typeof ThemeStudio !== 'undefined') {
      try { await ThemeStudio.migrateLegacy(); }
      catch (e) { console.error('[ThemeManager] moving the Custom Image theme failed:', e); }
    }
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
    // Light and dark (js/theme-auto.js): when it is on, the first paint already
    // wears the theme for right now, not the one saved when Vex last closed.
    if (typeof ThemeAuto !== 'undefined') {
      try {
        const auto = await ThemeAuto.bootTheme();
        if (auto) this.currentTheme = auto;
      } catch (e) {
        console.error('[ThemeManager] light/dark at start-up failed, keeping the saved theme:', e);
      }
    }
    this.applyTheme(this.currentTheme, { persist: false });
    if (typeof ThemeAuto !== 'undefined') {
      ThemeAuto.start().catch(e => console.error('[ThemeAuto] start failed:', e));
    }
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
        // Hyphens pass: stripping them sent 'firefoxlight' to the start page,
        // which knows no such theme and fell back to Oxford (found 2026-09-29).
        const safe = themeName.replace(/[^a-z-]/g, '');
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
          if (url.startsWith('vex://start')) {
            // Instant recolor of the live doc, then a reload through the
            // server-side baker so a refresh keeps the new theme.
            const js = `document.documentElement.setAttribute('data-theme','${safe}');`;
            try { wv.executeJavaScript(js).catch(() => {}); } catch {}
            try { wv.reloadIgnoringCache?.(); } catch {}
          } else {
            // The file:// page takes its theme from ?theme= (its only theme
            // source). It is recoloured in place (applyStartTheme also paints
            // the Custom Image wallpaper) and its address rewritten with
            // replaceState, so a refresh keeps the theme without reloading the
            // page — a reload flashed the whole New Tab on every switch, and
            // Light and dark switches by itself (js/theme-auto.js).
            try {
              wv.executeJavaScript(this.startPageThemeJs(safe)).catch(err => console.error('[ThemeManager] New Tab recolour failed:', err && err.message));
            } catch (err) {
              // A New Tab whose page has not loaded yet: its dom-ready handler
              // (webview.js) gives it the current theme when it does.
              if (!/dom-ready|attached/i.test(String(err && err.message))) console.error('[ThemeManager] New Tab recolour failed:', err && err.message);
            }
          }
        }
      }
    } catch {}

    // userChoice: someone picked this theme, as opposed to the startup restore
    // (persist:false) or Light and dark switching by itself (auto:true) —
    // gui-style.js and theme-auto.js follow only real picks.
    const detail = { theme: themeName, userChoice: opts.persist !== false && !opts.auto };
    if (opts.auto) detail.auto = true;
    document.dispatchEvent(new CustomEvent('theme-changed', { detail }));
  },

  // The script that brings a file:// New Tab page to `theme` without a reload:
  // recolour it (applyStartTheme is start.html's own, and paints the Custom
  // Image wallpaper too) and rewrite its ?theme= so a refresh keeps it. Does
  // nothing when the page already wears it. `theme` is a checked theme id.
  //
  // A theme of your own (js/theme-studio.js) also carries its colours, as ?tc=
  // (the page derives every token from them with js/theme-custom.js, the same
  // way this window does). `preview` is the editor's: { colors, image } while
  // you edit, image undefined = the saved one, null = none.
  startPageThemeJs(theme, preview) {
    const id = String(theme).replace(/[^a-z-]/g, '');
    // A New Tab that loads while you edit that theme shows the edit.
    if (!preview && typeof ThemeStudio !== 'undefined') preview = ThemeStudio.previewOf(id) || undefined;
    let tc = '';
    if (typeof CustomThemes !== 'undefined' && CustomThemes.ID_RE.test(id)) {
      const colors = (preview && preview.colors) || (typeof ThemeStudio !== 'undefined' ? ThemeStudio.colorsOf(id) : null);
      if (colors) tc = CustomThemes.toQuery(colors);
    }
    const img = preview && preview.image !== undefined ? preview.image : undefined;
    const force = !!preview;
    const args = 't' + (tc || img !== undefined ? ', tc' : '') + (img !== undefined ? ', ' + JSON.stringify(img) : '');
    return `(() => {
      const t = ${JSON.stringify(id)}, tc = ${JSON.stringify(tc)};
      const q = new URL(location.href).searchParams;
      if (!${force} && document.documentElement.getAttribute('data-theme') === t && q.get('theme') === t && (q.get('tc') || '') === tc) return;
      if (typeof applyStartTheme === 'function') applyStartTheme(${args});
      else document.documentElement.setAttribute('data-theme', t);
      const u = new URL(location.href);
      u.searchParams.set('theme', t);
      if (tc) u.searchParams.set('tc', tc); else u.searchParams.delete('tc');
      history.replaceState(history.state, '', u.toString());
    })()`;
  },

  // Recolour every open New Tab page with `theme` (and the editor's preview).
  paintStartPages(theme, preview) {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    for (const wv of WebviewManager.webviews.values()) {
      let url = '';
      try { url = typeof wv.getURL === 'function' ? wv.getURL() : ''; } catch { continue; }
      if (!(/^file:/i.test(url) && /\/renderer\/start\.html(?:[?#]|$)/i.test(url))) continue;
      wv.executeJavaScript(this.startPageThemeJs(theme, preview)).catch(err => console.error('[ThemeManager] New Tab recolour failed:', err && err.message));
    }
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
