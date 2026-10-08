// === Your own colour themes: the colour maths, the stored form and the file ===
//
// Shared by Vex's window (js/theme-studio.js: the editor, Settings, the picker)
// and the New Tab page (start.html loads this file too), so both derive the
// same tokens from the same few colours. Nothing here touches the DOM.
//
// A theme is nine colours (docs/THEME_FORMAT.md):
//   background surface text muted primary success warning danger border
// Only the first four and primary are needed; the rest are derived. Every other
// token Vex's CSS uses (deep panels, the active tab, hover colours, the text on
// the accent, the New Tab's glass) is worked out from them here.
//
// Nothing from a file or a synced record ever reaches CSS as text: colours are
// parsed into '#rrggbb' and the CSS is written from those, every value checked
// again on the way out.

const CustomThemes = (function (root) {
  const COLOR_KEYS = ['background', 'surface', 'text', 'muted', 'primary', 'success', 'warning', 'danger', 'border'];
  const REQUIRED = ['background', 'surface', 'text', 'primary'];
  const ID_RE = /^user-[a-z]{4,24}$/;
  const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

  const CustomThemes = {
    KEY: 'vex.customThemes',
    FORMAT: 'vex-theme',
    VERSION: 1,
    COLOR_KEYS,
    REQUIRED,
    ID_RE,
    NAME_MAX: 40,
    // The whole file, and the background image inside it (a data: URL).
    FILE_MAX: 2 * 1024 * 1024,
    IMAGE_MAX: 1500000,
    // The same bar the theme tests hold every built-in theme to.
    MIN_CONTRAST: 4.5,
    LABELS: {
      background: 'Background', surface: 'Surface', text: 'Text', muted: 'Muted text', primary: 'Accent',
      success: 'Success', warning: 'Warning', danger: 'Danger', border: 'Borders',
    },

    // --- colour maths ------------------------------------------------------

    // '#rgb' or '#rrggbb' (any case) -> '#rrggbb', else null.
    normHex(v) {
      if (typeof v !== 'string') return null;
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
      if (!m) return null;
      const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
      return '#' + h.toLowerCase();
    },
    rgb(hex) {
      const h = this.normHex(hex);
      if (!h) throw new Error('Not a colour: ' + hex);
      return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    },
    hex(r, g, b) {
      return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    },
    // `t` of b over a (0 = a, 1 = b), in sRGB like color-mix.
    mix(a, b, t) {
      const x = this.rgb(a), y = this.rgb(b);
      return this.hex(...x.map((v, i) => v + (y[i] - v) * t));
    },
    luminance(hex) {
      const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const [r, g, b] = this.rgb(hex);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    },
    contrast(a, b) {
      const x = this.luminance(a), y = this.luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    },
    toHsl(hex) {
      const [r, g, b] = this.rgb(hex).map(v => v / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
      if (max === min) return [0, 0, l];
      const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return [h / 6, s, l];
    },
    fromHsl(h, s, l) {
      if (s === 0) return this.hex(l * 255, l * 255, l * 255);
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
      return this.hex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
    },
    // The rule Light and dark (theme-auto.js) sorts every theme by.
    isLight(colors) { return this.luminance(colors.background) > 0.4; },

    // --- from a few colours to every token -----------------------------------

    // The nine colours, the missing optional ones derived from the others.
    complete(colors) {
      const c = {};
      for (const k of REQUIRED) {
        const v = this.normHex(colors && colors[k]);
        if (!v) throw new Error(`The theme needs a ${this.LABELS[k].toLowerCase()} colour`);
        c[k] = v;
      }
      const light = this.luminance(c.background) > 0.4;
      const def = {
        muted: this.mix(c.text, c.background, 0.35),
        border: this.mix(c.background, c.text, light ? 0.18 : 0.16),
        success: light ? '#0e700e' : '#34d399',
        warning: light ? '#8a5300' : '#fbbf24',
        danger: light ? '#c42b1c' : '#f87171',
      };
      for (const k of Object.keys(def)) c[k] = this.normHex(colors && colors[k]) || def[k];
      return c;
    },

    // Every token, for the window and for the New Tab page.
    derive(colors) {
      const c = this.complete(colors);
      const light = this.isLight(c);
      const bg = c.background, surf = c.surface;
      const deep = light ? this.mix(bg, c.text, 0.04) : this.mix(bg, surf, 0.45);
      const tabActive = light ? this.mix(surf, '#ffffff', 0.6) : this.mix(surf, c.text, 0.08);
      const tabHover = light ? this.mix(bg, c.text, 0.06) : surf;
      const input = light ? this.mix(surf, '#ffffff', 0.6) : bg;
      const hover = light ? this.mix(c.primary, '#000000', 0.18) : this.mix(c.primary, '#ffffff', 0.25);
      const dangerHover = light ? this.mix(c.danger, '#000000', 0.18) : this.mix(c.danger, '#ffffff', 0.25);
      const onPrimary = this.onPrimary(c.primary, hover, bg);
      const dimA = light ? '26' : '38', glowA = light ? '1f' : '2e';
      const borderSubtle = this.mix(c.border, bg, 0.35), borderStrong = this.mix(c.border, c.text, 0.35);
      const secondary = this.mix(c.text, c.muted, 0.5);
      const chrome = {
        '--vex-bg-base': bg, '--vex-bg-elevated': surf, '--vex-bg-deep': deep,
        '--vex-glass-strong': deep, '--vex-glass-medium': deep, '--vex-glass-light': surf,
        '--vex-glass-tab-active': tabActive, '--vex-glass-tab-inactive': deep, '--vex-glass-input': input,
        '--vex-border-subtle': borderSubtle, '--vex-border-medium': c.border, '--vex-border-strong': borderStrong,
        '--vex-border-accent': c.primary, '--vex-border-accent-strong': c.primary,
        '--vex-accent': c.primary, '--vex-accent-dim': c.primary + dimA, '--vex-accent-glow': c.primary + glowA,
        '--vex-text-primary': c.text, '--vex-text-secondary': secondary, '--vex-text-muted': c.muted,
        '--vex-text-accent': hover, '--vex-success': c.success, '--vex-danger': c.danger, '--vex-danger-hover': dangerHover, '--vex-warning': c.warning,
        '--bg': bg, '--bg-2': deep, '--sidebar': light ? deep : bg, '--surface': surf,
        '--border': c.border, '--text': c.text, '--text-muted': c.muted,
        '--primary': c.primary, '--primary-hover': hover, '--accent': hover,
        '--on-primary': onPrimary,
        '--tab-active': tabActive, '--tab-hover': tabHover,
        '--danger': c.danger, '--success': c.success, '--warning': c.warning,
      };
      if (light) {
        const [r, g, b] = this.rgb(c.text);
        chrome['--vex-hover-fill'] = `rgba(${r}, ${g}, ${b}, 0.06)`;
        chrome['--vex-shadow-color'] = `rgba(${r}, ${g}, ${b}, 0.14)`;
      }
      const page = {
        '--vex-bg-base': bg, '--vex-glass-strong': surf, '--vex-glass-medium': deep,
        '--vex-glass-light': surf, '--vex-glass-input': input,
        '--vex-border-subtle': borderSubtle, '--vex-border-medium': c.border, '--vex-border-strong': borderStrong,
        '--vex-border-accent': c.primary, '--vex-border-accent-strong': c.primary,
        '--vex-accent': c.primary, '--vex-accent-dim': c.primary + dimA, '--vex-accent-glow': c.primary + glowA,
        '--on-primary': onPrimary,
        '--vex-text-primary': c.text, '--vex-text-secondary': secondary, '--vex-text-muted': c.muted,
        '--vex-blur-medium': 'blur(0px)', '--vex-blur-light': 'blur(0px)',
        '--vex-radius-sm': '6px', '--vex-radius-md': '8px', '--vex-radius-lg': '12px',
      };
      // The New Tab's accent glow at its strongest, over the page.
      const glow = this.mix(bg, c.primary, parseInt(glowA, 16) / 255);
      return { colors: c, light, chrome, page, surfaces: { bg, surf, deep, tabActive, glow, hover, onPrimary } };
    },

    // The text colour on the accent (and its hover): white where white reads
    // on both, else whichever of the page colour, white and black reads best.
    onPrimary(primary, hover, bg) {
      const worst = (ink) => Math.min(this.contrast(ink, primary), this.contrast(ink, hover));
      if (worst('#ffffff') >= this.MIN_CONTRAST) return '#ffffff';
      let best = '#ffffff';
      for (const ink of [bg, '#000000']) if (worst(ink) > worst(best)) best = ink;
      return best;
    },

    // --- contrast ------------------------------------------------------------

    // Each text colour against what it is drawn on: the worst one, and whether
    // it reaches 4.5:1.
    checks(colors) {
      const d = this.derive(colors);
      const c = d.colors, s = d.surfaces;
      const named = { [s.bg]: 'the background', [s.surf]: 'the surface', [s.deep]: 'the side panels', [s.tabActive]: 'the active tab', [s.glow]: 'the New Tab glow', [c.primary]: 'the accent', [s.hover]: 'the accent (hover)' };
      const list = [
        { key: 'text', label: 'Text', fg: c.text, on: [s.bg, s.surf, s.deep, s.tabActive, s.glow] },
        { key: 'muted', label: 'Muted text', fg: c.muted, on: [s.bg, s.surf, s.deep, s.glow] },
        { key: 'primary', label: 'Accent as text (links)', fg: c.primary, on: [s.bg, s.surf, s.deep] },
        { key: 'onPrimary', label: 'Text on the accent', fg: s.onPrimary, on: [c.primary, s.hover] },
        { key: 'success', label: 'Success', fg: c.success, on: [s.bg, s.surf, s.deep] },
        { key: 'warning', label: 'Warning', fg: c.warning, on: [s.bg, s.surf, s.deep] },
        { key: 'danger', label: 'Danger', fg: c.danger, on: [s.bg, s.surf, s.deep] },
      ];
      return list.map(x => {
        let worst = Infinity, against = x.on[0];
        for (const bg of x.on) { const r = this.contrast(x.fg, bg); if (r < worst) { worst = r; against = bg; } }
        return { key: x.key, label: x.label, fg: x.fg, against, againstName: named[against] || against, ratio: Math.round(worst * 100) / 100, ok: worst >= this.MIN_CONTRAST };
      });
    },

    // Nudge the lightness of every colour that fails (the accent for "Text on
    // the accent") until it reaches 4.5:1, the least change first. The
    // background, surface and borders are never moved. Returns the colours and
    // the checks still failing (none, unless no lightness could do it).
    fixContrast(colors) {
      let c = this.complete(colors);
      const failing = () => this.checks(c).filter(x => !x.ok);
      for (let round = 0; round < 3 && failing().length; round++) {
        for (const f of failing()) {
          const key = f.key === 'onPrimary' ? 'primary' : f.key;
          const passes = (cand) => this.checks(cand).filter(x => (key === 'primary' ? (x.key === 'primary' || x.key === 'onPrimary') : x.key === key)).every(x => x.ok);
          const [h, s, l] = this.toHsl(c[key]);
          let found = null;
          for (let step = 1; step <= 200 && !found; step++) {
            for (const dir of [-1, 1]) {
              const nl = l + dir * step * 0.005;
              if (nl < 0 || nl > 1) continue;
              const cand = { ...c, [key]: this.fromHsl(h, s, nl) };
              if (passes(cand)) { found = cand; break; }
            }
          }
          if (found) c = found;
        }
      }
      return { colors: c, unresolved: failing() };
    },

    // --- CSS (written only from checked values) ------------------------------

    _cssValue(v) {
      if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(v) || /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.\d{1,2}\)$/.test(v) || /^blur\(0px\)$/.test(v) || /^\d{1,2}px$/.test(v)) return v;
      throw new Error('Refusing a theme value: ' + v);
    },
    _block(id, tokens) {
      if (!ID_RE.test(id)) throw new Error('Not a custom theme id: ' + id);
      const body = Object.entries(tokens).map(([k, v]) => {
        if (!/^--[a-z0-9-]+$/.test(k)) throw new Error('Refusing a theme token: ' + k);
        return `  ${k}: ${this._cssValue(v)};`;
      }).join('\n');
      return `[data-theme="${id}"] {\n${body}\n}`;
    },
    css(id, colors) { return this._block(id, this.derive(colors).chrome); },
    pageCss(id, colors) { return this._block(id, this.derive(colors).page); },

    // The colours as the New Tab page's ?tc= (54 hex digits, COLOR_KEYS order).
    toQuery(colors) {
      const c = this.complete(colors);
      return COLOR_KEYS.map(k => c[k].slice(1)).join('');
    },
    fromQuery(q) {
      if (typeof q !== 'string' || !/^[0-9a-f]{54}$/i.test(q)) return null;
      const out = {};
      COLOR_KEYS.forEach((k, i) => { out[k] = '#' + q.slice(i * 6, i * 6 + 6).toLowerCase(); });
      return out;
    },

    // --- the stored list (localStorage, synced item by item by id) -----------

    cleanName(name) {
      if (typeof name !== 'string') throw new Error('The theme needs a name');
      const n = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
      if (!n) throw new Error('The theme needs a name');
      if (n.length > this.NAME_MAX) throw new Error(`A theme name is ${this.NAME_MAX} characters at most`);
      return n;
    },
    validateRecord(r) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('Not a theme');
      for (const k of Object.keys(r)) if (!['id', 'name', 'colors', 'base', 'updated'].includes(k)) throw new Error('Unknown field in a theme: ' + k);
      if (typeof r.id !== 'string' || !ID_RE.test(r.id)) throw new Error('Bad theme id');
      const colors = this._colorsStrict(r.colors, COLOR_KEYS);
      const out = { id: r.id, name: this.cleanName(r.name), colors };
      if (r.base != null) {
        if (typeof r.base !== 'string' || !/^[a-z]+(?:-[a-z]+)*$/.test(r.base) || r.base.length > 40) throw new Error('Bad base theme');
        out.base = r.base;
      }
      if (r.updated != null) {
        if (!Number.isSafeInteger(r.updated) || r.updated < 0) throw new Error('Bad time');
        out.updated = r.updated;
      }
      return out;
    },
    // Exactly the colour keys allowed, `need` all present, each a hex colour.
    _colorsStrict(colors, need) {
      if (!colors || typeof colors !== 'object' || Array.isArray(colors)) throw new Error('The theme has no colours');
      for (const k of Object.keys(colors)) if (!COLOR_KEYS.includes(k)) throw new Error('Unknown colour in the theme: ' + String(k).slice(0, 40));
      const out = {};
      for (const k of need) if (!(k in colors)) throw new Error(`The theme has no ${this.LABELS[k].toLowerCase()} colour`);
      for (const [k, v] of Object.entries(colors)) {
        const h = this.normHex(v);
        if (!h) throw new Error(`${this.LABELS[k]} is not a colour like #1a2b3c`);
        out[k] = h;
      }
      return out;
    },
    // The saved themes. A record that fails the checks (a hand-edited or
    // damaged one) is left out and said so in the console, not dropped from
    // storage: the next save writes only good ones.
    list(storage) {
      const st = storage || root.localStorage;
      let raw;
      try { raw = JSON.parse(st.getItem(this.KEY) || '[]'); }
      catch (err) { console.error('[CustomThemes] stored list unreadable:', err.message); return []; }
      if (!Array.isArray(raw)) { console.error('[CustomThemes] stored list is not a list'); return []; }
      const out = [], seen = new Set();
      for (const r of raw) {
        try {
          const v = this.validateRecord(r);
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          out.push(v);
        } catch (err) { console.error('[CustomThemes] skipping a saved theme:', err.message); }
      }
      return out;
    },
    saveList(list, storage) {
      const st = storage || root.localStorage;
      st.setItem(this.KEY, JSON.stringify(list.map(r => this.validateRecord(r))));
    },
    newId(taken) {
      const has = new Set(taken || []);
      for (let i = 0; i < 50; i++) {
        let s = 'user-';
        const bytes = new Uint8Array(10);
        root.crypto.getRandomValues(bytes);
        for (const b of bytes) s += String.fromCharCode(97 + (b % 26));
        if (!has.has(s)) return s;
      }
      throw new Error('Could not make a theme id');
    },

    // --- the file (.vextheme) -------------------------------------------------

    toFile(record, image) {
      const r = this.validateRecord(record);
      const out = { format: this.FORMAT, version: this.VERSION, name: r.name, colors: r.colors };
      if (image != null) {
        this.checkImage(image);
        out.image = image;
      }
      return JSON.stringify(out, null, 2);
    },
    checkImage(image) {
      if (typeof image !== 'string' || !IMAGE_RE.test(image)) throw new Error('The background image must be a PNG, JPEG or WebP picture');
      if (image.length > this.IMAGE_MAX) throw new Error(`The background image is too big (${Math.round(image.length / 1024)} KB, ${Math.round(this.IMAGE_MAX / 1024)} KB at most)`);
      return image;
    },
    // A file's text -> { name, colors (all nine), image|null }. Throws, with a
    // reason a person can read, on anything that is not exactly a theme.
    parseFile(text) {
      if (typeof text !== 'string') throw new Error('Not a theme file');
      if (text.length > this.FILE_MAX) throw new Error('That file is too big to be a theme');
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('That file is not a Vex theme (it is not JSON)'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('That file is not a Vex theme');
      for (const k of Object.keys(data)) if (!['format', 'version', 'name', 'colors', 'image'].includes(k)) throw new Error('That file has something a theme does not: ' + String(k).slice(0, 40));
      if (data.format !== this.FORMAT) throw new Error('That file is not a Vex theme');
      if (!Number.isInteger(data.version) || data.version < 1) throw new Error('That theme file has no version');
      if (data.version > this.VERSION) throw new Error('That theme was made by a newer Vex — update Vex to open it');
      const colors = this.complete(this._colorsStrict(data.colors, REQUIRED));
      const image = data.image == null ? null : this.checkImage(data.image);
      return { name: this.cleanName(data.name), colors, image };
    },
  };

  return CustomThemes;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof window !== 'undefined') window.CustomThemes = CustomThemes;
if (typeof module !== 'undefined' && module.exports) module.exports = { CustomThemes };
