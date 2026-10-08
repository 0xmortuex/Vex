// === A Chrome Web Store theme, as one of your own themes ====================
//
// Install a Chrome theme (Add to Vex on its Web Store page, its link or id in
// Settings › Appearance › Chrome theme…, or its .crx file) and Vex makes it a
// theme of your own: the same nine colours, the same contrast fixing, the same
// New Tab picture storage and the same .vextheme file as any other
// (js/theme-custom.js, js/theme-studio.js). It is never loaded as an
// extension, and it is deleted like any theme of yours.
//
// The main process has already checked the package's signatures and read only
// its theme (src/main/chrome-theme.js): colours as numbers, tints as numbers,
// two fixed words for the New Tab picture's placement, and the pictures as
// checked PNG/JPEG/WebP data. Nothing here reaches CSS except colours written
// by CustomThemes from '#rrggbb' values.
//
// How Chrome's colours become Vex's (convert):
//   frame (or the colour of its frame picture)   -> background
//   toolbar (or the colour of its toolbar picture) -> surface
//   the text colour that reads best on both      -> text
//   accent: the New Tab link colour, an opaque button colour, the New Tab
//           picture's own colour, the tinted toolbar buttons, the frame's
//           hue, or Chrome's blue, the first that is there
//   the New Tab picture (or a big frame picture) -> the theme's New Tab picture
// Then the background and toolbar are moved only as far as text must have to
// read on them, and CustomThemes.fixContrast takes every text colour to 4.5:1.

const ChromeTheme = (function (root) {
  const ct = () => {
    if (!root.CustomThemes) throw new Error('CustomThemes (js/theme-custom.js) is not loaded');
    return root.CustomThemes;
  };
  // Chrome's own frame colour, which the "frame" tint shifts when a theme
  // gives no frame colour, and its toolbar icon grey, which "buttons" shifts.
  const DEFAULT_FRAME = '#dee1e6';
  const ICON_GREY = '#5f6368';
  // A frame picture this big is a picture, not a strip: it can be the New Tab's.
  const FRAME_AS_PICTURE = { width: 800, height: 400 };

  const T = {
    DEFAULT_FRAME,
    ICON_GREY,

    // [r, g, b, a] (main's clean form) -> '#rrggbb', laid over `under` when
    // it is see-through. null for no colour.
    hexOf(c, under = '#ffffff') {
      if (!Array.isArray(c) || c.length !== 4) return null;
      const C = ct();
      const hex = C.hex(c[0], c[1], c[2]);
      return c[3] >= 1 ? hex : C.mix(under, hex, c[3]);
    },

    // Chrome's tint ([hue, saturation, lightness], each -1 = leave alone,
    // 0.5 = no change for saturation and lightness), as
    // ui/gfx/color_utils.cc HSLShift does it.
    shift(hex, tint) {
      const C = ct();
      if (!Array.isArray(tint) || tint.length !== 3) return hex;
      const [th, ts, tl] = tint;
      let [h, s, l] = C.toHsl(hex);
      if (th >= 0) h = th;
      if (ts >= 0 && ts !== 0.5) s = ts < 0.5 ? s * ts * 2 : s + (1 - s) * (ts - 0.5) * 2;
      let [r, g, b] = C.rgb(C.fromHsl(h, Math.max(0, Math.min(1, s)), l));
      if (tl >= 0 && tl !== 0.5) {
        const f = tl < 0.5 ? (v) => v * tl * 2 : (v) => v + (255 - v) * (tl - 0.5) * 2;
        [r, g, b] = [f(r), f(g), f(b)];
      }
      return C.hex(r, g, b);
    },

    // Move a colour's lightness (keeping hue and saturation) until ok(colour).
    _nudge(hex, dir, ok) {
      const C = ct();
      if (ok(hex)) return hex;
      const [h, s, l] = C.toHsl(hex);
      for (let step = 1; step <= 200; step++) {
        const nl = Math.max(0, Math.min(1, l + dir * step * 0.005));
        const cand = C.fromHsl(h, s, nl);
        if (ok(cand)) return cand;
        if (nl === 0 || nl === 1) return cand;
      }
      return hex;
    },

    // The theme's own accent from its New Tab picture, when it has one
    // (js/theme-from-image.js, the Calm palette's accent).
    _pictureAccent(summary, light) {
      if (!summary || !root.ThemeFromImage) return null;
      const p = root.ThemeFromImage.palette(summary, { light, style: 'calm' });
      return p.colors.primary;
    },

    // Chrome's theme -> { colors (all nine, contrast fixed), mapped (before any
    // fixing), changed (keys Vex moved), unresolved, light }.
    //   input.colors / input.tints: main's clean form
    //   input.frameImage / input.toolbarImage: the main colour of those pictures
    //   input.pictureSummary: ThemeFromImage.sample() of the New Tab picture
    convert(input) {
      const C = ct();
      const colors = (input && input.colors) || {};
      const tints = (input && input.tints) || {};
      const background = input.frameImage || this.hexOf(colors.frame) || this.shift(DEFAULT_FRAME, tints.frame);
      const toolbar = input.toolbarImage || this.hexOf(colors.toolbar, background);
      // Light or dark: Vex has one answer, Chrome a frame (the tab strip) and
      // a toolbar and New Tab that may disagree (a dark tab strip over a
      // light toolbar is Chrome's own classic look). The New Tab colour
      // decides (unless a picture covers it), else the toolbar, else the frame.
      const ntp = input.pictureSummary ? null : this.hexOf(colors.ntp_background);
      const light = C.luminance(ntp || toolbar || background) > 0.4;
      const surface = toolbar || (light ? C.mix(background, '#ffffff', 0.6) : C.mix(background, '#ffffff', 0.08));
      // The side decided, and room for text: a light theme's background and
      // toolbar light enough for dark text, a dark one's dark enough for
      // light text. Each keeps its hue.
      const bg2 = light ? this._nudge(background, 1, (c) => C.luminance(c) >= 0.42) : this._nudge(background, -1, (c) => C.luminance(c) <= 0.1);
      const surf2 = light ? this._nudge(surface, 1, (c) => C.luminance(c) >= 0.4)
        : this._nudge(surface, -1, (c) => C.luminance(c) <= 0.13);

      // The text: the theme's text colour that reads best on both.
      const worstOn = (ink) => Math.min(C.contrast(ink, bg2), C.contrast(ink, surf2));
      const texts = ['bookmark_text', 'toolbar_text', 'tab_text', 'omnibox_text', 'ntp_text', 'tab_background_text']
        .map(k => this.hexOf(colors[k], surface)).filter(Boolean);
      const text = texts.length ? texts.reduce((best, c) => (worstOn(c) > worstOn(best) ? c : best)) : (light ? '#202124' : '#e8eaed');

      // The accent: the first the theme really has.
      const distinct = (c) => C.contrast(c, bg2) >= 1.5 && C.contrast(c, surf2) >= 1.5;
      const link = this.hexOf(colors.ntp_link, background);
      const button = colors.button_background && colors.button_background[3] >= 0.5 ? this.hexOf(colors.button_background, surface) : null;
      const tinted = tints.buttons ? this.shift(ICON_GREY, tints.buttons) : null;
      const [, bgC, bgH] = C.toOklch(background);
      const fromPicture = input.pictureSummary ? this._pictureAccent(input.pictureSummary, light) : null;
      let primary, accentFrom;
      // A link colour that is only the text colour again is no accent.
      const far = (a, b) => { const x = C.rgbToOklab(...C.rgb(a)), y = C.rgbToOklab(...C.rgb(b)); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) >= 0.08; };
      if (link && far(link, text) && distinct(link)) { primary = link; accentFrom = 'link'; }
      else if (button && distinct(button)) { primary = button; accentFrom = 'button'; }
      else if (fromPicture) { primary = fromPicture; accentFrom = 'picture'; }
      else if (tinted && tinted !== ICON_GREY && distinct(tinted)) { primary = tinted; accentFrom = 'buttons'; }
      else if (bgC >= 0.03) { primary = C.fromOklch(light ? 0.5 : 0.74, Math.min(0.16, Math.max(0.08, bgC * 2)), bgH); accentFrom = 'frame'; }
      else { primary = light ? '#1a73e8' : '#8ab4f8'; accentFrom = 'default'; }

      const mapped = { background, surface, text, primary };
      // Again until nothing fails: a moved accent moves the New Tab glow the
      // text is measured on, which can undo the text's fix by a hair.
      const fix = (b, s) => {
        let f = C.fixContrast({ background: b, surface: s, text, primary });
        for (let i = 0; i < 4 && f.unresolved.length; i++) f = C.fixContrast(f.colors);
        return f;
      };
      // A background and toolbar only just on their side can leave the
      // accent nowhere to go but white or black (the New Tab's accent glow is
      // made of the accent itself). So a few steps further to their side are
      // tried as well, and the one that changes the theme least wins: how far
      // each colour moved (OKLab). The frame colour counts most, the accent
      // counts double when it is the theme's own (not one Vex picked for it),
      // and muted text (Vex's own, not the theme's) only may not end up the
      // same as the text.
      const dist = (a, b) => { const x = C.rgbToOklab(...C.rgb(a)), y = C.rgbToOklab(...C.rgb(b)); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
      const accentWeight = ['link', 'button', 'picture'].includes(accentFrom) ? 2 : 0.5;
      const cost = (f) => 1.5 * dist(f.colors.background, background) + dist(f.colors.surface, surface) + dist(f.colors.text, text)
        + accentWeight * dist(f.colors.primary, primary) + (dist(f.colors.muted, f.colors.text) < 0.06 ? 0.05 : 0);
      let fixed = null;
      for (let step = 0; step <= 8; step++) {
        const b = step === 0 ? bg2 : light ? this._nudge(bg2, 1, (c) => C.luminance(c) >= 0.42 + step * 0.06) : this._nudge(bg2, -1, (c) => C.luminance(c) <= 0.1 - step * 0.012);
        const s = step === 0 ? surf2 : light ? this._nudge(surf2, 1, (c) => C.luminance(c) >= 0.4 + step * 0.06) : this._nudge(surf2, -1, (c) => C.luminance(c) <= 0.13 - step * 0.015);
        const f = fix(b, s);
        if (!fixed || (f.unresolved.length < fixed.unresolved.length) || (f.unresolved.length === fixed.unresolved.length && cost(f) < cost(fixed))) fixed = f;
      }
      const changed = Object.keys(mapped).filter(k => fixed.colors[k] !== mapped[k]);
      // A muted colour Vex worked out itself is not "changed".
      return { colors: fixed.colors, mapped, changed, unresolved: fixed.unresolved, light: C.isLight(fixed.colors), accentFrom };
    },

    // --- in the window -----------------------------------------------------------

    _blob(dataUrl) {
      const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
      if (!m) throw new Error('A picture in the theme came in a form Vex does not read');
      const bin = root.atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: m[1] });
    },

    // A picture laid over the colour Chrome draws it on (a frame picture over
    // the frame colour, the New Tab picture over the New Tab colour), as a
    // PNG of its own size: see-through parts show that colour, as in Chrome.
    async _flatten(img, under) {
      const C = ct();
      let bmp;
      try { bmp = await root.createImageBitmap(this._blob(img.dataUrl)); }
      catch (err) { throw new Error('A picture in the theme could not be read — it may be damaged', { cause: err }); }
      try {
        const cv = new root.OffscreenCanvas(bmp.width, bmp.height);
        const x = cv.getContext('2d');
        x.fillStyle = C.normHex(under);
        x.fillRect(0, 0, bmp.width, bmp.height);
        x.drawImage(bmp, 0, 0);
        return await cv.convertToBlob({ type: 'image/png' });
      } finally {
        bmp.close();
      }
    },

    // The colour a picture (over its colour) mostly is.
    async _mainColor(img, under) {
      const s = await root.ThemeFromImage.sample(await this._flatten(img, under));
      return s.clusters[0].hex;
    },

    // main's theme -> { name, colors, image (data: URL or null), changed, light, picture }.
    async prepare(theme) {
      if (!theme || typeof theme !== 'object') throw new Error('Vex got no theme to add');
      const C = ct();
      const imgs = theme.images || {};
      const colors = theme.colors || {};
      const frameUnder = this.hexOf(colors.frame) || this.shift(DEFAULT_FRAME, (theme.tints || {}).frame);
      const frameImage = imgs.frame ? await this._mainColor(imgs.frame, frameUnder) : null;
      const toolbarImage = imgs.toolbar ? await this._mainColor(imgs.toolbar, this.hexOf(colors.toolbar, frameImage || frameUnder) || '#ffffff') : null;
      const big = imgs.frame && imgs.frame.width >= FRAME_AS_PICTURE.width && imgs.frame.height >= FRAME_AS_PICTURE.height;
      const picture = imgs.ntp_background ? { from: 'ntp', img: imgs.ntp_background, under: this.hexOf(colors.ntp_background) || '#ffffff' }
        : (big ? { from: 'frame', img: imgs.frame, under: frameUnder } : null);
      let summary = null, blob = null;
      if (picture) {
        blob = await this._flatten(picture.img, picture.under);
        summary = await root.ThemeFromImage.sample(blob);
      }
      const out = this.convert({ colors: theme.colors, tints: theme.tints, frameImage, toolbarImage, pictureSummary: summary });
      let image = null;
      if (picture) {
        // Item #4's picture rules: made to fit (ThemeStudio._fitImage), then
        // toned towards the background just enough that the New Tab's text
        // reads over it (ThemeFromImage.bake).
        const raw = await root.ThemeStudio._fitImage(blob);
        image = await root.ThemeFromImage.bake(raw, out.colors, summary);
      }
      const name = C.cleanName(String(theme.name || 'Chrome theme').slice(0, C.NAME_MAX));
      return { name, colors: out.colors, image, changed: out.changed, unresolved: out.unresolved, light: out.light, picture: picture ? picture.from : null };
    },

    // The dialog's body, every word escaped and every colour a checked hex.
    dialogHtml(p, made) {
      const esc = (s) => root.escapeHtml(String(s == null ? '' : s));
      const icon = (name) => (typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size: 14 }) : '');
      const C = ct();
      const from = p.source === 'developer'
        ? `${icon('warning')}<span>A theme its maker signed themselves${p.file ? ` (${esc(p.file)})` : ''}, <strong>not from the Chrome Web Store</strong>. Its signature checks out.</span>`
        : `${icon('shield')}<span>From the Chrome Web Store${p.file ? ` (${esc(p.file)})` : ''}. Its signatures, the maker's and the store's, check out.</span>`;
      const chips = ['background', 'surface', 'text', 'primary']
        .map(k => `<span class="vct-chip" title="${esc(C.LABELS[k])}" style="background:${C.normHex(made.colors[k])}"></span>`).join('');
      const lines = [
        `<div class="vex-ws-source">${from}</div>`,
        `<div class="vct-preview"><span class="vct-chips">${chips}</span>${made.image ? `<img class="vct-pic" alt="Its New Tab picture" src="${made.image}">` : ''}</div>`,
        `<div class="vex-ws-line">${icon('palette')}<span>A ${made.light ? 'light' : 'dark'} theme${made.picture ? ', with its picture behind the New Tab page' : ''}. It joins your themes, so Light and dark can use it.</span></div>`,
        `<div class="vex-ws-line">${icon('check')}<span>Nothing in it runs: Vex takes only its colours and pictures.</span></div>`,
      ];
      if (made.changed.length) lines.push(`<div class="vex-ws-line">${icon('info')}<span>${this._changedWords(made.changed)}</span></div>`);
      return lines.join('');
    },

    _changedWords(changed) {
      const C = ct();
      const names = changed.map(k => C.LABELS[k].toLowerCase());
      const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
      return `Vex made its ${list} ${changed.length > 1 ? 'colours' : 'colour'} a little lighter or darker so all text reads at 4.5:1.`;
    },

    // A preview from main (the Web Store, or a picked .crx). Returns
    //   'added' | 'cancelled' | 'refused' | 'extension' (the caller goes on
    //   with the extension dialog) | null (not a theme at all).
    async offer(p) {
      if (!p || !p.isTheme) return null;
      if (p.themeRefused) {
        if (p.asExtension) {
          const yes = await root.vexConfirm({
            title: `“${p.name}” is more than a theme`,
            message: p.themeRefused + ' It is an extension too, and can be installed as one; Vex shows what it can do first.',
            okLabel: 'Install as an extension',
          });
          return yes ? 'extension' : 'cancelled';
        }
        await root.vexAlert({ title: `Vex cannot add ${p.name}`, message: p.themeRefused });
        return 'refused';
      }
      const made = await this.prepare(p.theme);
      const yes = await root.vexConfirm({ title: `Add the theme “${made.name}”?`, html: this.dialogHtml(p, made), okLabel: 'Add to Vex' });
      if (!yes) return 'cancelled';
      const rec = await root.ThemeStudio.addTheme({ name: made.name, colors: made.colors, image: made.image });
      const note = made.changed.length ? ' ' + this._changedWords(made.changed) : '';
      root.showToast?.(`Added the theme “${rec.name}” and switched to it.${note}`, 'success', made.changed.length ? 7000 : 3000);
      return 'added';
    },

    // Settings › Appearance › Chrome theme…: a store link or id, or a .crx.
    async ask() {
      if (typeof VexWebStore === 'undefined') throw new Error('Adding Chrome themes is not available in this window');
      const input = await root.vexPrompt({
        title: 'Add a Chrome theme',
        message: 'Paste the theme’s Chrome Web Store link or its id. Vex downloads it from Google, checks its signatures, and adds its colours and pictures to your themes.',
        placeholder: 'https://chromewebstore.google.com/detail/…',
        okLabel: 'Add',
        extra: { label: 'From a .crx file…', run: () => this.pickFile().catch(err => root.showToast?.(err.message, 'error')) },
      });
      if (input == null) return null;
      if (!input.trim()) { root.showToast?.('Paste a Chrome Web Store link or a theme id first', 'info'); return null; }
      return VexWebStore.install(input.trim());
    },

    async pickFile() {
      if (!root.vex || typeof root.vex.extensionsInstallZip !== 'function') throw new Error('Picking a file is not available in this window');
      const p = await root.vex.extensionsInstallZip();
      if (!p || p.cancelled) return null;
      if (!p.ok) { root.showToast?.('Could not add it: ' + (p.error || 'unknown'), 'error'); return null; }
      const r = await this.offer(p);
      if (r === null) {
        root.showToast?.(`“${p.name}” is an extension, not a theme. Settings › Extensions installs it.`, 'info', 5000);
      } else if (r === 'extension') {
        return this.installPickedAsExtension(p);
      }
      return r;
    },

    // The normal extension path for a picked package: the same dialog as any
    // extension (what it can read and do), then main installs that package.
    async installPickedAsExtension(p) {
      if (p.refuse) { await root.vexAlert({ title: `Vex cannot install ${p.name}`, message: p.refuse }); return 'refused'; }
      const yes = await root.vexConfirm({ title: `${p.installed ? 'Update' : 'Add'} "${p.name}"?`, html: VexWebStore.dialogHtml(p), okLabel: p.installed ? 'Update' : 'Add to Vex' });
      if (!yes) return 'cancelled';
      const r = await root.vex.extensionsInstallPicked(p.token);
      if (!r || !r.ok) { root.showToast?.('Install failed: ' + ((r && r.error) || 'unknown'), 'error'); return 'failed'; }
      root.showToast?.(`Installed ${r.name} v${r.version}`, 'success');
      root.dispatchEvent(new CustomEvent('vex-extensions-changed', { detail: { folder: r.folder } }));
      return 'extension';
    },
  };
  return T;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof window !== 'undefined') {
  window.ChromeTheme = ChromeTheme;
  const wire = () => {
    const b = document.getElementById('setting-theme-chrome');
    if (!b || b.dataset.wired) return;
    b.dataset.wired = '1';
    b.addEventListener('click', () => ChromeTheme.ask().catch(err => window.showToast?.(err.message, 'error')));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ChromeTheme };
