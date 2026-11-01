// === Share my look: the screens (js/share-look.js holds the file format, the checks and the undo) ======================================================
//
//   Share my look       a screen with a small preview, an optional name for the look, and three ways out: a .vexlook file, a vex://look link, plain text
//   Open a shared look  a .vexlook file from the file chooser, or dropped on Vex's own toolbar / tab strip / panels
//   a pasted link       a vex://look?d=... link typed or pasted into Ctrl+K or the address bar opens the same review
//   the review          what the look holds, a preview drawn in its colours, then Apply or Cancel; Apply offers Undo (Ctrl+Z) at once
//
// Opened from Settings > Appearance, Ctrl+K and the theme pack picker. The file is read here with a file input and written with a download, the
// way theme files are (js/theme-studio.js): no path ever reaches the main process, so there is no file channel to widen.
const VexShareLookUI = {
  _wired: false,

  _need() {
    if (!window.VexShareLook) throw new Error('Share my look is not loaded');
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The Settings dialogs are not loaded');
  },

  _fail(err) {
    console.error('[ShareLook]', err);
    window.showToast?.((err && err.message) || 'That did not work', 'error', 5000);
  },

  _copy(text, done) {
    navigator.clipboard.writeText(text).then(() => window.showToast?.(done, 'info', 2000), (err) => this._fail(err));
  },

  fileName(look) {
    const slug = String(look.name || 'my-look').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'my-look';
    return slug + '.vexlook';
  },

  // A small window drawn in the look's own colours, design and icons (the theme pack picker's card).
  _preview(look) {
    if (typeof ThemePackUI === 'undefined' || typeof ThemePicker === 'undefined' || !window.VexThemePacks || !window.VexIconPacks) return null;
    let mock = null;
    if (typeof look.colours !== 'string') {
      const d = CustomThemes.derive(look.colours.colors);
      const c = d.colors;
      mock = { bg: c.background, side: d.surfaces.deep, surf: c.surface, txt: c.text, acc: c.primary, bd: c.border };
    }
    const box = document.createElement('div');
    box.style.cssText = 'position:relative;height:150px;border-radius:8px;overflow:hidden;margin:8px 0;border:1px solid var(--border,#333)';
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', 'A small preview of the look');
    box.innerHTML = ThemePackUI._preview(typeof look.colours === 'string' ? look.colours : '', look.design, look.icons, mock);
    return box;
  },

  _lines(look) {
    const d = window.VexShareLook.describe(look);
    const list = document.createElement('div');
    list.style.cssText = 'display:grid;grid-template-columns:max-content 1fr;gap:3px 12px;font-size:12.5px;margin:6px 0';
    for (const [k, v] of d.lines) {
      const a = document.createElement('span'); a.style.color = 'var(--text-muted)'; a.textContent = k;
      const b = document.createElement('span'); b.textContent = v;
      list.append(a, b);
    }
    return list;
  },

  // ---- Share ---------------------------------------------------------------------------------------------------------------------------------
  share() {
    this._need();
    const S = window.VexShareLook;
    const base = S.capture();
    const { body } = VexSettingsGroups.dialog({ id: 'vex-share-look', title: 'Share my look', sub: 'Your colours, design, icons, fonts and wallpaper choice in one small file or link.' });
    body.appendChild(VexSettingsGroups.note('Nothing personal goes in it: no bookmarks, history, names, settings or secrets, and never a picture of your own.'));
    const pv = this._preview(base);
    if (pv) body.appendChild(pv);
    body.appendChild(this._lines(base));
    if (typeof base.colours !== 'string') body.appendChild(VexSettingsGroups.note('Your own theme goes by its colours; a picture set inside it stays with you.'));
    if (!base.wallpaper) body.appendChild(VexSettingsGroups.note('No wallpaper is shared: yours is a picture of your own, or none is set.'));

    const label = document.createElement('label');
    label.style.cssText = 'display:block;font-size:12px;color:var(--text-muted);margin:8px 0 4px';
    label.textContent = 'Your name on this look (optional)';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'set-input';
    input.maxLength = S.NAME_MAX;
    input.id = 'vex-share-look-name';
    label.htmlFor = input.id;
    body.append(label, input);

    const current = () => (input.value.trim() ? { ...base, name: input.value } : base);
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px';
    const run = (fn) => () => { try { fn(current()); } catch (err) { this._fail(err); } };
    bar.append(
      VexSettingsGroups.button('Save as a file', run((look) => {
        const text = S.toFile(look);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = this.fileName(look);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        window.showToast?.('Saved the look file', 'info', 2500);
      }), { primary: true }),
      VexSettingsGroups.button('Copy link', run((look) => this._copy(S.toLink(look), 'Link copied'))),
      VexSettingsGroups.button('Copy as text', run((look) => this._copy(S.toText(look), 'Text copied'))),
    );
    body.appendChild(bar);
    input.focus({ preventScroll: true });
  },

  // ---- Open ----------------------------------------------------------------------------------------------------------------------------------
  pickFile() {
    this._need();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vexlook,.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (file) this.openFile(file).catch((err) => this._fail(err));
    });
    document.body.appendChild(input);
    input.click();
  },

  async openFile(file) {
    this._need();
    if (!file) throw new Error('No file');
    if (file.size > window.VexShareLook.FILE_MAX) throw new Error('That file is too big to be a look');
    return this.openText(await file.text());
  },

  // A file's text or a vex://look link. Throws (and says why) on anything that is not exactly a look.
  openText(text) {
    this._need();
    const look = window.VexShareLook.parse(text);
    this.review(look);
    return look;
  },

  review(look) {
    this._need();
    const S = window.VexShareLook;
    const d = S.describe(look);
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-share-look-review', title: d.title, sub: 'Look it over, then wear it. You can undo it afterwards.' });
    const pv = this._preview(look);
    if (pv) body.appendChild(pv);
    body.appendChild(this._lines(look));
    if (typeof look.colours !== 'string') body.appendChild(VexSettingsGroups.note('These colours are your own to keep; any text that would be hard to read has been adjusted so it reads at 4.5:1.'));
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px';
    const apply = VexSettingsGroups.button('Apply', async () => {
      apply.disabled = true; cancel.disabled = true;
      try {
        const r = await S.apply(look);
        close();
        for (const s of r.skipped) window.showToast?.(s, 'info', 5000);
        if (typeof VexUndo !== 'undefined') {
          VexUndo.offer({ message: 'Wearing ' + d.title, undo: () => S.undo().catch((err) => { this._fail(err); throw err; }) });
        } else window.showToast?.('Wearing ' + d.title, 'info', 3000);
      } catch (err) {
        apply.disabled = false; cancel.disabled = false;
        this._fail(err);
      }
    }, { primary: true });
    const cancel = VexSettingsGroups.button('Cancel', close);
    bar.append(apply, cancel);
    body.appendChild(bar);
    apply.focus({ preventScroll: true });
  },

  undo() {
    this._need();
    if (!window.VexShareLook.hasUndo()) { window.showToast?.('There is no shared look to undo', 'info', 2500); return Promise.resolve(); }
    return window.VexShareLook.undo().then(() => window.showToast?.('Your previous look is back', 'info', 2500));
  },

  // ---- Where it is reached from -------------------------------------------------------------------------------------------------------------------
  _isLink(v) { return window.VexShareLook && window.VexShareLook.isLink(v); },

  // A look link pasted in the address bar or in Ctrl+K opens the review at once.
  _watchBox(input, after) {
    if (!input) return;
    input.addEventListener('input', () => {
      if (!this._isLink(input.value)) return;
      const text = input.value;
      after(input);
      try { this.openText(text); } catch (err) { this._fail(err); }
    });
  },

  wire() {
    if (this._wired) return;
    this._wired = true;
    const click = (id, fn) => document.getElementById(id)?.addEventListener('click', () => { try { fn(); } catch (err) { this._fail(err); } });
    click('setting-share-look', () => this.share());
    click('setting-open-shared-look', () => this.pickFile());

    this._watchBox(document.getElementById('command-input'), (input) => { input.value = ''; if (typeof CommandBar !== 'undefined') CommandBar.close(); });
    this._watchBox(document.getElementById('url-input'), (input) => {
      const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
      input.value = tab ? TabManager.urlBarText(tab) : '';
      input.blur();
    });

    // A .vexlook dropped on Vex's own surfaces. A drop that something else already took (the AI panel) is left to it, and a file that is not
    // a look is left alone: only the drag-over is accepted, as the AI panel does.
    document.addEventListener('dragover', (e) => {
      if (e.defaultPrevented || !e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (e.defaultPrevented || !e.dataTransfer || !e.dataTransfer.files) return;
      const file = Array.from(e.dataTransfer.files).find((f) => /\.vexlook$/i.test(f.name));
      if (!file) return;
      e.preventDefault();
      this.openFile(file).catch((err) => this._fail(err));
    });

    if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
      const r = (c) => VexExtras.registerCommand({ ...c, action: () => { try { const p = c.run(); if (p && p.catch) p.catch((err) => this._fail(err)); } catch (err) { this._fail(err); } } });
      r({ id: 'share-look', label: 'Share my look', hint: 'Save your colours, design, icons, fonts and wallpaper choice as a small file or link for a friend', icon: 'palette', run: () => this.share() });
      r({ id: 'open-shared-look', label: 'Open a shared look', hint: 'Open a .vexlook file from a friend (or paste their vex://look link here), look it over, then wear it', icon: 'folder-open', run: () => this.pickFile() });
      r({ id: 'undo-shared-look', label: 'Undo shared look', hint: 'Put back the look you had before you wore a shared one', icon: 'undo', run: () => this.undo() });
    }
  },
};
if (typeof window !== 'undefined') window.VexShareLookUI = VexShareLookUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexShareLookUI };
if (typeof document !== 'undefined') VexShareLookUI.wire();
