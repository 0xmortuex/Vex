// === Your own themes: the editor, Settings › Appearance, a .vextheme file ===
//
// Start from any theme ("Customise this theme" on a picker card, or "Make your
// own"), change its colours with a colour picker or a hex value, give it a
// name and, if you like, a picture behind the New Tab page. Vex's window and
// every open New Tab wear the theme as you change it; Cancel puts back exactly
// what was there. The colour maths, the stored form and the file format are in
// js/theme-custom.js (shared with the New Tab page); the file is described for
// other apps in docs/THEME_FORMAT.md.
//
// Stored:
//   vex.customThemes        the themes (name + nine colours), synced item by item
//   main process            each theme's background image (theme-images/<id>.txt),
//                           kept on this device only
// The old Custom Image theme ('custom', one fixed palette and one picture) is
// moved into a theme of its own the first time this Vex starts.

const ThemeStudio = {
  MIGRATED_KEY: 'vex.customThemesMigrated',
  LEGACY_ID_KEY: 'vex.customImageThemeId',
  // The palette the Custom Image theme had (theme-extra.css until item #4).
  LEGACY_COLORS: {
    background: '#0e0e12', surface: '#1a1a22', text: '#e6e6f0', muted: '#7f7f92', primary: '#8b8bff',
    success: '#34d399', warning: '#fbbf24', danger: '#f87171', border: '#2a2a35',
  },
  // Images are made to fit: the widest side and the JPEG quality tried in turn.
  IMAGE_STEPS: [[1600, 0.82], [1280, 0.72], [1024, 0.62]],

  _ed: null,          // the editor's state while it is open
  _paintTimer: 0,

  // --- registering the themes with the window ------------------------------

  records() { return CustomThemes.list(); },
  record(id) { return this.records().find(r => r.id === id) || null; },

  // The colours a theme id wears now: the editor's while you edit it.
  colorsOf(id) {
    if (this._ed && this._ed.id === id) return CustomThemes.complete(this._ed.colors);
    const r = this.record(id);
    return r ? r.colors : null;
  },
  isEditing() { return !!this._ed; },
  // What a New Tab opened while you edit should show (ThemeManager asks).
  previewOf(id) {
    if (!this._ed || this._ed.id !== id) return null;
    return { colors: CustomThemes.complete(this._ed.colors), image: this._previewImage() };
  },

  // Write every theme's CSS and put them in ThemeManager's list (after the
  // built-in ones, marked user: true). A theme being made, not yet saved, is
  // included while the editor is open.
  register() {
    if (typeof ThemeManager === 'undefined') return;
    const list = this.records();
    const ed = this._ed;
    if (ed && !list.some(r => r.id === ed.id)) list.push({ id: ed.id, name: ed.name || 'New theme', colors: CustomThemes.complete(ed.colors), draft: true });
    const css = [];
    const metas = [];
    for (const r of list) {
      const colors = ed && ed.id === r.id ? CustomThemes.complete(ed.colors) : r.colors;
      css.push(CustomThemes.css(r.id, colors));
      const d = CustomThemes.derive(colors);
      metas.push({
        id: r.id, label: r.name, accent: d.colors.primary, user: true, base: r.base || null,
        mock: { bg: d.colors.background, side: d.surfaces.deep, surf: d.colors.surface, txt: d.colors.text, acc: d.colors.primary },
      });
    }
    let style = document.getElementById('vex-user-themes');
    if (!style) {
      style = document.createElement('style');
      style.id = 'vex-user-themes';
      document.head.appendChild(style);
    }
    style.textContent = css.join('\n');
    const builtIn = ThemeManager.THEMES.filter(t => !t.user);
    ThemeManager.THEMES.length = 0;
    ThemeManager.THEMES.push(...builtIn, ...metas);
  },

  // After the list changed: the Light and dark lists and Settings follow.
  _changed() {
    this.register();
    if (typeof ThemeAuto !== 'undefined' && typeof ThemeAuto.refreshThemeLists === 'function') ThemeAuto.refreshThemeLists();
    this.renderSettings();
  },

  // --- the old Custom Image theme ------------------------------------------

  async migrateLegacy() {
    this.register();
    if (localStorage.getItem(this.MIGRATED_KEY)) return;
    let saved = null;
    if (typeof VexStorage !== 'undefined' && VexStorage.load) saved = await VexStorage.load('theme');
    const img = window.vex && typeof window.vex.getCustomThemeImage === 'function' ? await window.vex.getCustomThemeImage() : null;
    if (saved === 'custom' || img) {
      const list = this.records();
      const id = CustomThemes.newId(list.map(r => r.id));
      list.push({ id, name: 'Custom Image', colors: CustomThemes.complete(this.LEGACY_COLORS), base: 'default', updated: Date.now() });
      if (img) {
        const r = await window.vex.setCustomThemeImage(img, id);
        if (!r || !r.ok) throw new Error('Could not move the Custom Image picture: ' + ((r && r.error) || 'no answer'));
      }
      CustomThemes.saveList(list);
      localStorage.setItem(this.LEGACY_ID_KEY, id);
      if (img) {
        const r = await window.vex.setCustomThemeImage(null);
        if (!r || !r.ok) console.error('[ThemeStudio] the old Custom Image file stays:', r && r.error);
      }
      if (saved === 'custom') await VexStorage.save('theme', id);
      try {
        const favs = JSON.parse(localStorage.getItem('vex.favThemes') || '[]');
        if (Array.isArray(favs) && favs.includes('custom')) localStorage.setItem('vex.favThemes', JSON.stringify(favs.map(f => (f === 'custom' ? id : f))));
      } catch (err) { console.error('[ThemeStudio] favourites unreadable:', err.message); }
    }
    localStorage.removeItem('vex.customThemeImage');
    localStorage.setItem(this.MIGRATED_KEY, '1');
    this.register();
  },

  // --- reading a built-in theme's colours ----------------------------------

  // A theme's nine colours as '#rrggbb', read from its CSS tokens.
  colorsFromTheme(id) {
    const own = this.record(id);
    if (own) return { ...own.colors };
    const probe = document.createElement('div');
    probe.setAttribute('data-theme', id);
    probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none';
    document.documentElement.appendChild(probe);
    try {
      const read = (token) => {
        const el = document.createElement('span');
        el.style.color = `var(${token})`;
        probe.appendChild(el);
        const v = getComputedStyle(el).color;
        el.remove();
        return v;
      };
      const toHex = (css, under) => {
        const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(css);
        if (!m) throw new Error(`Theme ${id}: cannot read the colour ${css}`);
        const a = m[4] == null ? 1 : Number(m[4]);
        const hex = CustomThemes.hex(Number(m[1]), Number(m[2]), Number(m[3]));
        return a >= 1 || !under ? hex : CustomThemes.mix(under, hex, a);
      };
      const background = toHex(read('--bg'));
      const map = { surface: '--surface', text: '--text', muted: '--text-muted', primary: '--primary', success: '--success', warning: '--warning', danger: '--danger', border: '--border' };
      const out = { background };
      for (const [k, token] of Object.entries(map)) out[k] = toHex(read(token), background);
      return out;
    } finally {
      probe.remove();
    }
  },

  // --- the editor ------------------------------------------------------------

  // { from: theme id }. A theme of your own is edited; any other is copied
  // into a new one.
  async open({ from } = {}) {
    if (this._ed) { this._panel?.querySelector('.vts-name')?.focus(); return; }
    if (typeof ThemeManager === 'undefined') throw new Error('Themes are not loaded');
    const cur = ThemeManager.getCurrentTheme();
    const src = from || cur;
    const own = this.record(src);
    const meta = ThemeManager.getThemeMeta(src);
    const G = window.VexGuiStyle;
    const ed = {
      mode: own ? 'edit' : 'new',
      id: own ? own.id : CustomThemes.newId(this.records().map(r => r.id)),
      name: own ? own.name : (meta.label + ' (my version)').slice(0, CustomThemes.NAME_MAX),
      base: own ? own.base || null : (meta.user ? meta.base : meta.id),
      colors: CustomThemes.complete(this.colorsFromTheme(src)),
      original: own ? { ...own.colors } : null,
      savedImage: null,
      image: undefined,     // undefined = unchanged, null = removed, string = new
      prevTheme: cur,
      prevGuiColors: G && G.isBrowserLook && G.isBrowserLook() ? G.getColors() : null,
    };
    if (own && window.vex && typeof window.vex.getCustomThemeImage === 'function') {
      ed.savedImage = await window.vex.getCustomThemeImage(own.id);
    }
    this._ed = ed;
    // applyTheme below hands the open New Tabs the picture once.
    ed.lastPaintedImage = ed.savedImage;
    // A browser look in its own colours would hide the preview in the frame.
    if (ed.prevGuiColors === 'look') G.setColors('theme');
    this.register();
    this._build();
    ThemeManager.applyTheme(ed.id, { persist: false });
    this._update();
  },

  _previewImage() {
    const ed = this._ed;
    return ed.image !== undefined ? ed.image : ed.savedImage;
  },

  _build() {
    const ed = this._ed;
    const panel = document.createElement('aside');
    panel.className = 'vts-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Theme editor');
    const rows = CustomThemes.COLOR_KEYS.map(k => `
      <div class="vts-color-row">
        <label for="vts-hex-${k}">${CustomThemes.LABELS[k]}</label>
        <input type="color" class="vts-swatch" data-key="${k}" aria-label="${CustomThemes.LABELS[k]} colour">
        <input type="text" class="vts-hex" id="vts-hex-${k}" data-key="${k}" maxlength="7" spellcheck="false" autocomplete="off">
      </div>`).join('');
    panel.innerHTML = `
      <header class="vts-head">
        <h2>${ed.mode === 'edit' ? 'Edit your theme' : 'Make your own theme'}</h2>
        <button type="button" class="vts-x" data-act="cancel" aria-label="Cancel" title="Cancel — put everything back">${VexIcons.svg('x', { size: 18 })}</button>
      </header>
      <div class="vts-body">
        <div class="vts-mini" aria-hidden="true"></div>
        <p class="vts-note">Vex and every open New Tab wear it as you change it. Cancel puts back exactly what was there.</p>
        <label class="vts-field">Name<input type="text" class="vts-name" maxlength="${CustomThemes.NAME_MAX}" spellcheck="false" autocomplete="off"></label>
        <div class="vts-colors">${rows}</div>
        <div class="vts-image">
          <span class="vts-image-label">New Tab background picture</span>
          <span class="vts-image-state"></span>
          <span class="vts-image-btns">
            <button type="button" class="btn-secondary" data-act="image">${VexIcons.svg('image', { size: 14 })} Choose…</button>
            <button type="button" class="btn-secondary" data-act="no-image">Remove</button>
          </span>
        </div>
        <div class="vts-contrast" role="status" aria-live="polite"></div>
        <button type="button" class="btn-secondary vts-newtab" data-act="newtab">Open a New Tab to see it there</button>
      </div>
      <footer class="vts-foot">
        ${ed.mode === 'edit' ? `<button type="button" class="btn-secondary vts-danger" data-act="delete">${VexIcons.svg('trash', { size: 14 })} Delete</button>` : ''}
        <span class="vts-spacer"></span>
        <button type="button" class="btn-secondary" data-act="cancel">Cancel</button>
        ${ed.mode === 'edit' ? '<button type="button" class="btn-secondary" data-act="save-new">Save as new</button>' : ''}
        <button type="button" class="vts-primary" data-act="save">Save</button>
      </footer>`;
    const name = panel.querySelector('.vts-name');
    name.value = ed.name;
    name.addEventListener('input', () => { ed.name = name.value; this._update({ colours: false }); });
    for (const input of panel.querySelectorAll('.vts-swatch, .vts-hex')) {
      input.addEventListener('input', () => {
        const v = CustomThemes.normHex(input.value);
        input.setAttribute('aria-invalid', v ? 'false' : 'true');
        if (!v) return;
        ed.colors = { ...ed.colors, [input.dataset.key]: v };
        this._update({ except: input });
      });
      // A half-typed hex value goes back to the colour in use when you leave it.
      input.addEventListener('change', () => { if (!CustomThemes.normHex(input.value)) this._fillInputs(); });
    }
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      const run = {
        cancel: () => this.cancel(),
        save: () => this.save({ asNew: false }),
        'save-new': () => this.save({ asNew: true }),
        delete: () => this._deleteFromEditor(),
        fix: () => this.fixContrast(),
        image: () => this._chooseImage(),
        'no-image': () => { ed.image = null; this._update(); },
        newtab: () => { if (typeof TabManager !== 'undefined') TabManager.createTab(); },
      }[act];
      if (!run) return;
      Promise.resolve().then(run).catch(err => window.showToast?.(err.message || String(err), 'error'));
    });
    this._keyHandler = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation();
      this.cancel();
    };
    document.addEventListener('keydown', this._keyHandler, true);
    document.body.appendChild(panel);
    this._panel = panel;
    this._fillInputs();
    name.focus({ preventScroll: true });
  },

  _fillInputs(except) {
    const c = CustomThemes.complete(this._ed.colors);
    for (const input of this._panel.querySelectorAll('.vts-swatch, .vts-hex')) {
      if (input === except) continue;
      input.value = c[input.dataset.key];
      input.setAttribute('aria-invalid', 'false');
    }
  },

  // Everything that follows a change: the window's CSS, the mini preview,
  // the warnings, and (a moment later) every open New Tab.
  _update({ except, colours = true } = {}) {
    const ed = this._ed;
    if (!ed || !this._panel) return;
    if (!colours) { this.register(); return; }
    this.register();
    this._fillInputs(except);
    const colors = CustomThemes.complete(ed.colors);
    const d = CustomThemes.derive(colors);
    if (typeof ThemePicker !== 'undefined') {
      this._panel.querySelector('.vts-mini').innerHTML = ThemePicker._livePreview({ id: ed.id }, { bg: colors.background, side: d.surfaces.deep, surf: colors.surface, txt: colors.text, acc: colors.primary, bd: colors.border });
    }
    const img = this._previewImage();
    this._panel.querySelector('.vts-image-state').textContent = img ? `A picture (${Math.round(img.length / 1024)} KB)` : 'None';
    this._panel.querySelector('[data-act="no-image"]').disabled = !img;
    this._renderContrast(colors);
    clearTimeout(this._paintTimer);
    this._paintTimer = setTimeout(() => {
      if (!this._ed) return;
      const image = this._ed.lastPaintedImage === img ? false : img;
      this._ed.lastPaintedImage = img;
      ThemeManager.paintStartPages(this._ed.id, { colors: CustomThemes.complete(this._ed.colors), image });
    }, 90);
  },

  _renderContrast(colors) {
    const box = this._panel.querySelector('.vts-contrast');
    const checks = CustomThemes.checks(colors);
    const bad = checks.filter(c => !c.ok);
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'vts-contrast-head ' + (bad.length ? 'bad' : 'ok');
    head.innerHTML = bad.length ? VexIcons.svg('warning', { size: 15 }) : VexIcons.svg('check', { size: 15 });
    const words = document.createElement('span');
    words.textContent = bad.length
      ? `${bad.length === 1 ? 'One colour is' : bad.length + ' colours are'} hard to read (below 4.5:1)`
      : 'Every text colour reads at 4.5:1 or better';
    head.appendChild(words);
    box.appendChild(head);
    if (!bad.length) return;
    const ul = document.createElement('ul');
    for (const c of bad) {
      const li = document.createElement('li');
      li.dataset.check = c.key;
      li.textContent = `${c.label} on ${c.againstName}: ${c.ratio.toFixed(2)}:1`;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    const fix = document.createElement('button');
    fix.type = 'button';
    fix.className = 'btn-secondary vts-fix';
    fix.dataset.act = 'fix';
    fix.innerHTML = VexIcons.svg('wand', { size: 14 });
    fix.append(' Fix contrast');
    fix.title = 'Make those colours lighter or darker until they read, keeping their hue';
    box.appendChild(fix);
  },

  fixContrast() {
    const ed = this._ed;
    if (!ed) return;
    const r = CustomThemes.fixContrast(ed.colors);
    ed.colors = r.colors;
    this._update();
    if (r.unresolved.length) window.showToast?.('Some colours still do not read — try a darker or lighter background', 'error');
    else window.showToast?.('Contrast fixed', 'info', 1500);
  },

  _chooseImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      try {
        this._ed.image = await this._fitImage(file);
        this._update();
      } catch (err) {
        window.showToast?.(err.message, 'error');
      }
    });
    document.body.appendChild(input);
    input.click();
  },

  // A picked picture, scaled down and made a JPEG small enough to keep.
  async _fitImage(file) {
    const src = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Could not read that file'));
      fr.readAsDataURL(file);
    });
    const img = await this._decode(src, 'That is not a picture Vex can show');
    for (const [maxW, q] of this.IMAGE_STEPS) {
      const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * scale);
      cv.height = Math.round(img.naturalHeight * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const out = cv.toDataURL('image/jpeg', q);
      if (out.length <= CustomThemes.IMAGE_MAX) return out;
    }
    throw new Error('That picture is too big even made smaller');
  },

  _decode(src, message) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => (im.naturalWidth > 0 && im.naturalWidth <= 16000 && im.naturalHeight <= 16000 ? resolve(im) : reject(new Error(message)));
      im.onerror = () => reject(new Error(message));
      im.src = src;
    });
  },

  // Close the editor; `restore` puts the theme and the look's colours back.
  _close(restore) {
    const ed = this._ed;
    if (!ed) return;
    clearTimeout(this._paintTimer);
    document.removeEventListener('keydown', this._keyHandler, true);
    this._panel?.remove();
    this._panel = null;
    this._ed = null;
    this.register();
    if (restore) {
      const back = ThemeManager.availableThemes.includes(ed.prevTheme) ? ed.prevTheme : ThemeManager.DEFAULT_THEME;
      ThemeManager.applyTheme(back, { persist: false });
      if (ed.prevGuiColors === 'look') window.VexGuiStyle.setColors('look');
    }
    if (typeof ThemeAuto !== 'undefined' && ThemeAuto.isOn()) ThemeAuto.evaluate();
  },

  cancel() { this._close(true); },

  async save({ asNew }) {
    const ed = this._ed;
    if (!ed) return;
    const name = CustomThemes.cleanName(ed.name);
    const colors = CustomThemes.complete(ed.colors);
    const list = this.records();
    let id = ed.id, finalName = name;
    if (asNew) {
      id = CustomThemes.newId(list.map(r => r.id).concat(ed.id));
      if (ed.mode === 'edit' && name === this.record(ed.id)?.name) finalName = (name.slice(0, CustomThemes.NAME_MAX - 5) + ' copy');
    }
    const rec = CustomThemes.validateRecord({ id, name: finalName, colors, ...(ed.base ? { base: ed.base } : {}), updated: Date.now() });
    // The picture first: a theme saved without the picture it was shown with
    // would be a surprise.
    const img = this._previewImage();
    const imageChanged = asNew ? !!img : ed.image !== undefined;
    if (imageChanged) {
      if (!window.vex || typeof window.vex.setCustomThemeImage !== 'function') throw new Error('The picture cannot be kept here');
      const r = await window.vex.setCustomThemeImage(img || null, id);
      if (!r || !r.ok) throw new Error('Could not keep the picture: ' + ((r && r.error) || 'no answer'));
    }
    const i = list.findIndex(r => r.id === id);
    if (i >= 0) list[i] = rec; else list.push(rec);
    CustomThemes.saveList(list);
    this._close(false);
    this._changed();
    ThemeManager.applyTheme(id);
    window.showToast?.(`Saved “${rec.name}”`, 'info', 2000);
    return rec;
  },

  async _deleteFromEditor() {
    const ed = this._ed;
    const rec = ed && this.record(ed.id);
    if (!rec) return;
    if (!await this._confirmDelete(rec)) return;
    this._close(false);
    await this.remove(rec.id);
  },

  _confirmDelete(rec) {
    const inUse = ThemeManager.getCurrentTheme() === rec.id;
    return window.vexConfirm({
      title: `Delete “${rec.name}”?`,
      message: (inUse ? 'You are wearing it now; Vex goes back to the theme it started from. ' : '')
        + 'Export it first if you might want it back. It is deleted on your other devices too when Sync is on.',
      okLabel: 'Delete', danger: true,
    });
  },

  // The theme to wear instead of a deleted one: the theme it was made from
  // when that is on the same side (light or dark), else Vex's default for
  // that side.
  fallbackFor(rec) {
    const light = CustomThemes.isLight(rec.colors);
    const base = rec.base && ThemeManager.THEMES.find(t => t.id === rec.base && !t.user);
    if (base && typeof ThemeAuto !== 'undefined' && ThemeAuto.isLightTheme(base) === light) return base.id;
    return light ? 'oxford' : 'firefox-dark';
  },

  async remove(id) {
    const rec = this.record(id);
    if (!rec) throw new Error('No such theme');
    CustomThemes.saveList(this.records().filter(r => r.id !== id));
    if (localStorage.getItem(this.LEGACY_ID_KEY) === id) localStorage.removeItem(this.LEGACY_ID_KEY);
    const fallback = this.fallbackFor(rec);
    if (typeof ThemeAuto !== 'undefined') {
      const st = ThemeAuto.state();
      if (st.light === id || st.dark === id) {
        const next = { ...st };
        if (st.light === id) next.light = CustomThemes.isLight(rec.colors) ? fallback : 'oxford';
        if (st.dark === id) next.dark = CustomThemes.isLight(rec.colors) ? 'firefox-dark' : fallback;
        ThemeAuto.save(next);
      }
    }
    this._changed();
    if (ThemeManager.getCurrentTheme() === id) ThemeManager.applyTheme(fallback);
    if (window.vex && typeof window.vex.setCustomThemeImage === 'function') {
      const r = await window.vex.setCustomThemeImage(null, id);
      if (!r || !r.ok) window.showToast?.('The theme is gone, but its picture could not be deleted: ' + ((r && r.error) || 'no answer'), 'error');
    }
    window.showToast?.(`Deleted “${rec.name}”`, 'info', 2000);
  },

  // --- the file ----------------------------------------------------------------

  async exportTheme(id) {
    const rec = this.record(id);
    if (!rec) throw new Error('No such theme');
    const img = window.vex && typeof window.vex.getCustomThemeImage === 'function' ? await window.vex.getCustomThemeImage(id) : null;
    const text = CustomThemes.toFile(rec, img);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = this.fileName(rec.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    window.showToast?.(`Exported “${rec.name}”${img ? ' with its picture' : ''}`, 'info', 2500);
    return text;
  },

  fileName(name) {
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'theme';
    return slug + '.vextheme';
  },

  async importFile(file) {
    if (!file) throw new Error('No file');
    if (file.size > CustomThemes.FILE_MAX) throw new Error('That file is too big to be a theme');
    const parsed = CustomThemes.parseFile(await file.text());
    if (parsed.image) await this._decode(parsed.image, 'The picture in that theme is broken');
    const list = this.records();
    const id = CustomThemes.newId(list.map(r => r.id));
    const names = new Set(list.map(r => r.name));
    let name = parsed.name;
    for (let n = 2; names.has(name); n++) name = `${parsed.name.slice(0, CustomThemes.NAME_MAX - 4)} ${n}`;
    const rec = CustomThemes.validateRecord({ id, name, colors: parsed.colors, updated: Date.now() });
    if (parsed.image) {
      const r = await window.vex.setCustomThemeImage(parsed.image, id);
      if (!r || !r.ok) throw new Error('Could not keep its picture: ' + ((r && r.error) || 'no answer'));
    }
    list.push(rec);
    CustomThemes.saveList(list);
    this._changed();
    ThemeManager.applyTheme(id);
    window.showToast?.(`Imported “${rec.name}” and switched to it`, 'info', 2500);
    return rec;
  },

  pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vextheme,.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      this.importFile(file).catch(err => window.showToast?.('Not imported: ' + err.message, 'error'));
    });
    document.body.appendChild(input);
    input.click();
  },

  // --- Settings › Appearance -----------------------------------------------

  wireSettings() {
    const make = document.getElementById('setting-theme-make');
    if (!make || make.dataset.wired) return;
    make.dataset.wired = '1';
    make.addEventListener('click', () => this.open({ from: ThemeManager.getCurrentTheme() }).catch(err => window.showToast?.(err.message, 'error')));
    document.getElementById('setting-theme-import')?.addEventListener('click', () => this.pickFile());
    // A .vextheme dropped anywhere on Settings is imported.
    const panel = document.getElementById('panel-settings');
    if (panel) {
      const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
      panel.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        panel.classList.add('vts-drop');
      });
      panel.addEventListener('dragleave', (e) => { if (e.target === panel || !panel.contains(e.relatedTarget)) panel.classList.remove('vts-drop'); });
      panel.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        panel.classList.remove('vts-drop');
        const file = Array.from(e.dataTransfer.files || []).find(f => /\.(vextheme|json)$/i.test(f.name));
        if (!file) { window.showToast?.('Drop a .vextheme file here to add the theme', 'error'); return; }
        this.importFile(file).catch(err => window.showToast?.('Not imported: ' + err.message, 'error'));
      });
    }
    this.renderSettings();
  },

  renderSettings() {
    const box = document.getElementById('custom-themes-list');
    if (!box) return;
    const list = this.records();
    box.innerHTML = '';
    if (!list.length) {
      const p = document.createElement('div');
      p.className = 'vts-empty';
      p.textContent = 'None yet. Make one from any theme, or import a .vextheme file (drop it on Settings).';
      box.appendChild(p);
      return;
    }
    const cur = ThemeManager.getCurrentTheme();
    for (const r of list) {
      const row = document.createElement('div');
      row.className = 'vts-row' + (r.id === cur ? ' current' : '');
      row.dataset.theme = r.id;
      const sw = document.createElement('span');
      sw.className = 'vts-chips';
      for (const k of ['background', 'surface', 'text', 'primary']) {
        const c = document.createElement('span');
        c.style.background = r.colors[k];
        sw.appendChild(c);
      }
      const name = document.createElement('span');
      name.className = 'vts-row-name';
      name.textContent = r.name + (r.id === cur ? ' — in use' : '');
      const btns = document.createElement('span');
      btns.className = 'vts-row-btns';
      const btn = (act, icon, label) => `<button type="button" class="btn-secondary" data-act="${act}" title="${label}" aria-label="${label}">${VexIcons.svg(icon, { size: 14 })}</button>`;
      btns.innerHTML = `<button type="button" class="btn-secondary" data-act="use">Use</button>`
        + btn('edit', 'edit', 'Edit') + btn('export', 'download', 'Export to a file') + btn('delete', 'trash', 'Delete');
      for (const b of btns.querySelectorAll('button')) b.setAttribute('aria-label', `${b.getAttribute('aria-label') || b.textContent} ${r.name}`);
      btns.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const run = {
          use: () => { ThemeManager.applyTheme(r.id); this.renderSettings(); },
          edit: () => this.open({ from: r.id }),
          export: () => this.exportTheme(r.id),
          delete: async () => { if (await this._confirmDelete(r)) await this.remove(r.id); },
        }[b.dataset.act];
        Promise.resolve().then(run).catch(err => window.showToast?.(err.message, 'error'));
      });
      row.append(sw, name, btns);
      box.appendChild(row);
    }
  },
};

if (typeof window !== 'undefined') {
  window.ThemeStudio = ThemeStudio;
  // Registered at once, so ThemeManager.init can restore a theme of your own.
  try { ThemeStudio.register(); }
  catch (err) { console.error('[ThemeStudio] could not load your themes:', err); }
  const wire = () => ThemeStudio.wireSettings();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  document.addEventListener('theme-changed', () => ThemeStudio.renderSettings());
  // Themes made or deleted on another device.
  window.addEventListener('vex-sync-data-applied', () => {
    ThemeStudio._changed();
    const cur = ThemeManager.getCurrentTheme();
    if (CustomThemes.ID_RE.test(cur) && !ThemeStudio.record(cur) && !ThemeStudio.isEditing()) ThemeManager.applyTheme(ThemeManager.DEFAULT_THEME, { persist: false });
    else if (CustomThemes.ID_RE.test(cur)) ThemeManager.paintStartPages(cur);
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ThemeStudio };
