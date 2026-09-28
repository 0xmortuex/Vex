// === Vex Mobile — how Vex looks ===
//
// The desktop app's identity is that you can change everything about it: eight
// themes, nineteen skins over them, a font for the interface. A phone cannot
// carry the toolbar editor, but it can carry that: the same themes (generated
// from the desktop token file by scripts/sync-themes.mjs), a useful subset of
// the skins, and the same type choices.
//
// Three separate settings, because they are separate decisions:
//   vex.theme     — 'auto' or a theme id from themes-data.js
//   vex.skin      — texture id + strength + corner + shadow
//   vex.font      — the interface typeface
//
// "Auto" is not one theme: it is Oxford by day and Midnight by night, which is
// what the desktop does when it follows the system.

const VexTheme = (() => {
  const AUTO_LIGHT = 'oxford';
  const AUTO_DARK = 'midnight';

  // Textures are drawn in the theme's own ink (currentColor via a mask-like
  // SVG), so a skin never fights the palette it sits on.
  const SKINS = {
    none: { label: 'None', svg: null },
    dots: {
      label: 'Dots',
      svg: size => `<circle cx="${size / 2}" cy="${size / 2}" r="1.1" fill="INK"/>`,
      size: 14
    },
    graph: {
      label: 'Graph paper',
      svg: size => `<path d="M0 0H${size}M0 0V${size}" stroke="INK" stroke-width="1" fill="none"/>`,
      size: 18
    },
    honeycomb: {
      label: 'Honeycomb',
      svg: () => '<path d="M14 0L21 4v8l-7 4-7-4V4z" fill="none" stroke="INK" stroke-width="1"/>',
      size: 28
    },
    diagonal: {
      label: 'Hatch',
      svg: size => `<path d="M0 ${size}L${size} 0" stroke="INK" stroke-width="1"/>`,
      size: 10
    },
    grain: {
      label: 'Grain',
      svg: () => '<circle cx="3" cy="5" r=".7" fill="INK"/><circle cx="11" cy="2" r=".6" fill="INK"/>'
        + '<circle cx="7" cy="12" r=".8" fill="INK"/><circle cx="15" cy="9" r=".5" fill="INK"/>',
      size: 18
    },
    contours: {
      label: 'Contours',
      svg: () => '<path d="M0 20c10-12 22-12 32 0" fill="none" stroke="INK" stroke-width="1"/>'
        + '<path d="M0 30c10-12 22-12 32 0" fill="none" stroke="INK" stroke-width="1"/>',
      size: 32
    }
  };

  const FONTS = {
    system: { label: 'System', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    spectral: { label: 'Spectral', stack: '"Spectral", Georgia, serif' },
    outfit: { label: 'Outfit', stack: '"Outfit", system-ui, sans-serif' },
    grotesk: { label: 'Space Grotesk', stack: '"Space Grotesk", system-ui, sans-serif' },
    serif: { label: 'Serif', stack: 'Georgia, "Noto Serif", serif' }
  };

  const CORNERS = { soft: '14px', round: '22px', sharp: '4px', square: '0px' };
  const SHADOWS = { soft: '0 6px 20px', flat: '0 0 0', deep: '0 14px 40px', lifted: '0 10px 28px' };

  let systemDark = null;

  function themes() {
    return window.VEX_THEMES || [];
  }

  function resolvedId() {
    const preference = VexStore.get('vex.theme', 'auto');
    if (preference !== 'auto' && themes().some(theme => theme.id === preference)) return preference;
    return systemDark && systemDark.matches ? AUTO_DARK : AUTO_LIGHT;
  }

  function current() {
    const id = resolvedId();
    return themes().find(theme => theme.id === id) || { id, dark: true, accent: '#888', bg: '#111' };
  }

  function texture(skinId, strength) {
    const skin = SKINS[skinId];
    if (!skin || !skin.svg) return 'none';
    const size = skin.size || 16;
    // The ink is the theme's text colour at the chosen strength, resolved now
    // rather than at paint time: a data: URL cannot see CSS variables.
    const ink = current().dark ? '255,255,255' : '0,0,0';
    const body = skin.svg(size).replace(/INK/g, `rgba(${ink},${strength})`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  return {
    SKINS, FONTS, CORNERS, SHADOWS,

    themes,
    resolvedId,
    current,
    isDark() { return !!current().dark; },

    // Everything that decides how the chrome looks, applied in one pass so a
    // change never leaves half the UI on the old theme.
    apply() {
      const theme = current();
      const root = document.documentElement;
      root.dataset.theme = theme.id;

      const font = FONTS[VexStore.get('vex.font', 'system')] || FONTS.system;
      root.style.setProperty('--font-ui', font.stack);

      const skin = VexStore.get('vex.skin', 'none');
      const strength = Number(VexStore.get('vex.skinStrength', 0.05)) || 0.05;
      root.style.setProperty('--skin-texture', texture(skin, strength));
      root.style.setProperty('--radius', CORNERS[VexStore.get('vex.corner', 'soft')] || CORNERS.soft);
      root.style.setProperty('--elevation', SHADOWS[VexStore.get('vex.shadow', 'soft')] || SHADOWS.soft);

      // The status bar and the window background belong to Android, and both
      // have to move with the theme or the top of the screen stays last
      // theme's colour.
      if (window.VexBridge) {
        VexBridge.setStatusBarStyle(theme.dark, theme.bg);
        VexBridge.setWindowBackground(theme.bg, theme.dark);
      }
      return theme;
    },

    async set(id) {
      await VexStore.set('vex.theme', id);
      return this.apply();
    },

    async setSkin(id, strength) {
      await VexStore.set('vex.skin', id);
      if (strength != null) await VexStore.set('vex.skinStrength', strength);
      return this.apply();
    },

    async setFont(id) {
      await VexStore.set('vex.font', id);
      return this.apply();
    },

    // Follow the system while the preference is 'auto'.
    watchSystem() {
      systemDark = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (VexStore.get('vex.theme', 'auto') === 'auto') this.apply(); };
      if (systemDark.addEventListener) systemDark.addEventListener('change', onChange);
      else if (systemDark.addListener) systemDark.addListener(onChange);
    },

    // A page's own <meta name="theme-color"> tints the toolbar, the way phone
    // browsers do it — but only when it is readable against the chrome's text,
    // otherwise a site's black bar swallows the icons on a light theme.
    tintFromPage(color) {
      const root = document.documentElement;
      if (!color || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
        root.style.removeProperty('--page-tint');
        return false;
      }
      const hex = color.length === 4
        ? '#' + [...color.slice(1)].map(char => char + char).join('')
        : color;
      const value = parseInt(hex.slice(1), 16);
      const luminance = (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
      const themeDark = this.isDark();
      // Keep the tint only if it sits on the same side of the light/dark line
      // as the theme; otherwise the toolbar icons stop being visible.
      if (themeDark !== (luminance < 0.5)) {
        root.style.removeProperty('--page-tint');
        return false;
      }
      root.style.setProperty('--page-tint', hex);
      return true;
    }
  };
})();

if (typeof window !== 'undefined') window.VexTheme = VexTheme;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTheme };
