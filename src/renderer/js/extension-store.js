// === The Vex Extension Store ================================================
//
// A hand-picked shelf of extensions people ask for, with the honest answer to
// "will it work in Vex?" on every card. It hosts NOTHING: each Add button runs
// the install flow Vex already has, from the extension's real source:
//
//   * a Chrome Web Store extension goes through VexWebStore.install
//     (js/web-store.js): main downloads the package from Google's own update
//     server, checks its CRX3 signatures, the person sees what it can read and
//     do, and only then is it installed (src/main/webstore.js);
//   * a first-party extension (and uBlock Origin) comes from the publisher's own
//     GitHub release (src/main/extension-sources.js), after a confirmation.
//
// The list is data (js/extension-store-data.js), reviewed in one file. This file
// is the page: categories, search, one card per extension, and the Installed /
// Update available / Remove state read from the same list Settings shows.
// Pasting a Chrome Web Store link or an extension id into the search box offers
// to install that one too. The page is built only when it is opened.
const VexExtensionStore = {
  _overlay: null,
  _onKey: null,
  _installed: [],
  _installedError: null,
  _query: '',
  _category: 'all',
  _busy: new Set(),

  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  _icon(name, size = 15) { return typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : ''; },
  _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); },
  _data() {
    if (typeof VexExtensionStoreData === 'undefined') throw new Error('The store list is not loaded');
    return VexExtensionStoreData;
  },
  _tr() {
    try { return typeof VexI18nUI !== 'undefined' && VexI18nUI.locale() === 'tr'; } catch { return false; }
  },

  // ---- the list and what is installed ----------------------------------------
  // The store's entries: the Web Store ones, plus the catalogue's GitHub ones.
  entries() {
    return this._data().combined(typeof VexExtensionCatalog !== 'undefined' ? VexExtensionCatalog : null);
  },

  // The text of an entry in the language in force (Turkish text rides in the entry).
  words(entry, tr = this._tr()) {
    const t = (tr && entry.tr) || {};
    return { what: t.what || entry.what, works: t.works || entry.works, caveat: t.caveat !== undefined ? t.caveat : entry.caveat };
  },
  categoryName(cat, tr = this._tr()) { return (tr && cat.tr) || cat.name; },

  // Search + category. The query is folded the Turkish way (I/i, dotted and dotless).
  filter(entries, { query = '', category = 'all' } = {}) {
    const fold = (s) => (typeof VexTr !== 'undefined' && VexTr.fold ? VexTr.fold(s) : String(s).toLowerCase());
    const q = fold(String(query || '').trim());
    return entries.filter(e => {
      if (category !== 'all' && e.category !== category) return false;
      if (!q) return true;
      const hay = fold([e.name, e.publisher, e.what, e.tr && e.tr.what, e.alias].filter(Boolean).join(' '));
      return q.split(/\s+/).every(w => hay.includes(w));
    });
  },

  // 'installed' | 'update' | null, and the installed copy. A Web Store entry is
  // matched by the id it was installed from; a GitHub one (or one installed from a
  // file) by its name, as the Settings catalogue does.
  stateOf(entry, installed) {
    const list = Array.isArray(installed) ? installed : [];
    let have = null;
    if (entry.webstoreId) have = list.find(x => x.webstore === entry.webstoreId) || null;
    // A trade-mark sign in the package's name is the publisher's decoration, not part of the name.
    const plain = (s) => String(s || '').replace(/[™®©]/g, '').trim().toLowerCase();
    if (!have) have = list.find(x => plain(x.name) === plain(entry.name)) || null;
    if (!have) return { state: null, have: null };
    const pending = have.update && have.update.pending;
    return { state: pending ? 'update' : 'installed', have };
  },

  // The id a pasted link or id names, or null while it is something else.
  pastedId(text) {
    const t = String(text || '').trim();
    if (!t || typeof VexWebStoreLink === 'undefined') return null;
    try { return VexWebStoreLink.extensionIdFrom(t); } catch { return null; }
  },

  async refreshInstalled() {
    try {
      this._installed = await window.vex.extensionsList();
      this._installedError = null;
    } catch (err) {
      this._installed = [];
      this._installedError = (err && err.message) || String(err);
    }
  },

  // ---- drawing ---------------------------------------------------------------
  _badge(entry) {
    const map = { full: ['Works fully', 'exs-ok', 'check'], partial: ['Works partly', 'exs-part', 'warning'], none: ['Does not work in Vex', 'exs-no', 'x'] };
    const [text, cls, icon] = map[entry.level] || map.partial;
    return `<span class="exs-badge ${cls}">${this._icon(icon, 12)}<span>${text}</span></span>`;
  },

  _tile(entry, have) {
    if (have && have.iconPath && typeof ExtensionsSettings !== 'undefined' && ExtensionsSettings._fileUrl) {
      return `<span class="exs-tile"><img src="${this._esc(ExtensionsSettings._fileUrl(have.iconPath))}" alt="" width="36" height="36"></span>`;
    }
    const letter = (entry.name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0) || '?').toUpperCase();
    return `<span class="exs-tile exs-letter" aria-hidden="true">${this._esc(letter)}</span>`;
  },

  _sizeText(entry) {
    if (!entry.sizeKB) return '';
    return entry.sizeKB >= 1024 ? (entry.sizeKB / 1024).toFixed(1) + ' MB' : entry.sizeKB + ' KB';
  },

  cardHtml(entry, tr = this._tr()) {
    const cats = this._data().CATEGORIES;
    const cat = cats.find(c => c.id === entry.category);
    const w = this.words(entry, tr);
    const { state, have } = this.stateOf(entry, this._installed);
    const busy = this._busy.has(entry.key);
    const via = entry.webstoreId ? 'Chrome Web Store' : 'GitHub release';
    const size = this._sizeText(entry);
    let action;
    if (busy) action = `<button type="button" class="exs-btn exs-primary" disabled>Working…</button>`;
    else if (state === 'update') action = `<button type="button" class="exs-btn exs-primary" data-exs-act="add" data-key="${this._esc(entry.key)}">Update available</button><button type="button" class="exs-btn" data-exs-act="remove" data-folder="${this._esc(have.folder)}" data-name="${this._esc(have.name)}">Remove</button>`;
    else if (state === 'installed') action = `<span class="exs-have">${this._icon('check', 13)}<span>Installed</span></span><button type="button" class="exs-btn" data-exs-act="remove" data-folder="${this._esc(have.folder)}" data-name="${this._esc(have.name)}">Remove</button>`;
    else action = `<button type="button" class="exs-btn exs-primary" data-exs-act="add" data-key="${this._esc(entry.key)}">Add to Vex</button>`;
    return `<article class="exs-card" data-key="${this._esc(entry.key)}">
      <div class="exs-top">${this._tile(entry, have)}
        <div class="exs-head"><h3 class="exs-name">${this._esc(entry.name)}</h3>
          <div class="exs-by"><span>${this._esc(entry.publisher)}</span>${cat ? `<span class="exs-dot">·</span><span>${this._esc(this.categoryName(cat, tr))}</span>` : ''}</div></div>
        ${this._badge(entry)}</div>
      <p class="exs-what">${this._esc(w.what)}</p>
      <p class="exs-works"><strong>In Vex:</strong> ${this._esc(w.works)}</p>
      ${w.caveat ? `<p class="exs-caveat">${this._esc(w.caveat)}</p>` : ''}
      ${entry.redundant ? `<p class="exs-caveat">${this._icon('info', 12)} <span>Vex already does this by itself</span></p>` : ''}
      <div class="exs-meta"><span>${via}</span>${size ? `<span class="exs-dot">·</span><span>${size}</span>` : ''}${have ? `<span class="exs-dot">·</span><span class="exs-ver">v${this._esc(have.version)}</span>` : ''}
        <a href="#" class="exs-src" data-exs-open="${this._esc(entry.sourceUrl)}">Source</a></div>
      <div class="exs-actions">${action}</div>
    </article>`;
  },

  _pastedCard(id) {
    const known = this.entries().find(e => e.webstoreId === id);
    if (known) return '';
    return `<article class="exs-card exs-paste">
      <div class="exs-top"><span class="exs-tile exs-letter" aria-hidden="true">${this._icon('link', 18)}</span>
        <div class="exs-head"><h3 class="exs-name">Chrome Web Store extension</h3><div class="exs-by"><span class="exs-id">${this._esc(id)}</span></div></div></div>
      <p class="exs-what">This is not on Vex's shelf, but you can add it from the Chrome Web Store. Vex downloads it from Google's own update server and installs it only if its signatures check out. You see what it can do first.</p>
      <div class="exs-actions"><button type="button" class="exs-btn exs-primary" data-exs-act="paste" data-id="${this._esc(id)}">Add to Vex</button></div>
    </article>`;
  },

  chipsHtml(entries, tr = this._tr()) {
    const cats = this._data().CATEGORIES;
    const count = (id) => entries.filter(e => id === 'all' || e.category === id).length;
    const chip = (id, label) => `<button type="button" class="exs-chip${this._category === id ? ' exs-on' : ''}" data-exs-cat="${id}" aria-pressed="${this._category === id}"><span>${this._esc(label)}</span><span class="exs-n">${count(id)}</span></button>`;
    return chip('all', tr ? 'Hepsi' : 'All') + cats.filter(c => count(c.id) > 0).map(c => chip(c.id, this.categoryName(c, tr))).join('');
  },

  _paint() {
    const o = this._overlay;
    if (!o) return;
    const all = this.entries();
    const shown = this.filter(all, { query: this._query, category: this._category });
    const id = this.pastedId(this._query);
    o.querySelector('.exs-chips').innerHTML = this.chipsHtml(all);
    const grid = o.querySelector('.exs-grid');
    const pasted = id ? this._pastedCard(id) : '';
    const shownList = id ? this.entries().filter(e => e.webstoreId === id) : shown;
    grid.innerHTML = pasted + shownList.map(e => this.cardHtml(e)).join('');
    o.querySelector('.exs-empty').hidden = !!(pasted || shownList.length);
    const err = o.querySelector('.exs-error');
    err.hidden = !this._installedError;
    err.textContent = this._installedError ? 'Could not read the installed extensions: ' + this._installedError : '';
  },

  _shell() {
    return `<div class="exs-shell" role="dialog" aria-modal="true" aria-labelledby="exs-title">
      <header class="exs-header">
        <span class="exs-logo">${this._icon('grid', 20)}</span>
        <div class="exs-titles"><h2 id="exs-title" class="exs-title">Vex Extension Store</h2>
          <p class="exs-sub">Hand-picked extensions, each checked in Vex. Vex hosts no copies: every one installs from its real source, signature-checked.</p></div>
        <button type="button" class="exs-close" data-exs-act="close" aria-label="Close">${this._icon('x', 16)}</button>
      </header>
      <div class="exs-bar">
        <label class="exs-search">${this._icon('search', 14)}<input type="search" class="exs-input" spellcheck="false" autocomplete="off" placeholder="Search, or paste a Chrome Web Store link or id" aria-label="Search extensions"></label>
      </div>
      <div class="exs-chips" role="group" aria-label="Categories"></div>
      <div class="exs-error" role="alert" hidden></div>
      <div class="exs-body"><div class="exs-grid"></div>
        <div class="exs-empty" hidden>${this._icon('search', 28)}<div class="exs-empty-t">Nothing on the shelf matches that</div><div class="exs-empty-s">Try another word, or paste the extension's Chrome Web Store link.</div></div></div>
      <footer class="exs-foot">${this._icon('shield', 13)}<span>Extensions run inside Vex's limits: not in Private or Tor tabs, and no request-blocking code. Each card says what that means for it.</span></footer>
    </div>`;
  },

  // ---- opening and closing -----------------------------------------------------
  async open(opts = {}) {
    if (this._overlay) { this._overlay.querySelector('.exs-input')?.focus(); return this._overlay; }
    const overlay = document.createElement('div');
    overlay.className = 'exs-overlay';
    overlay.innerHTML = this._shell();
    document.body.appendChild(overlay);
    this._overlay = overlay;
    this._query = opts.query ? String(opts.query) : '';
    this._category = opts.category || 'all';
    const input = overlay.querySelector('.exs-input');
    input.value = this._query;
    this._onKey = (ev) => {
      if (ev.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { ev.preventDefault(); ev.stopPropagation(); this.close(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) this.close(); });
    input.addEventListener('input', () => { this._query = input.value; this._paint(); });
    overlay.addEventListener('click', (ev) => this._onClick(ev));
    this._onChanged = () => { if (this._overlay) this.refreshInstalled().then(() => this._paint()); };
    this._onLang = () => { if (this._overlay) this._paint(); };
    window.addEventListener('vex-extensions-changed', this._onChanged);
    window.addEventListener('vex-lang-changed', this._onLang);
    this._paint();
    input.focus();
    await this.refreshInstalled();
    this._paint();
    return overlay;
  },

  close() {
    if (!this._overlay) return;
    this._overlay.remove();
    this._overlay = null;
    document.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('vex-extensions-changed', this._onChanged);
    window.removeEventListener('vex-lang-changed', this._onLang);
  },

  // ---- actions ---------------------------------------------------------------
  _onClick(ev) {
    const cat = ev.target.closest('[data-exs-cat]');
    if (cat) { this._category = cat.dataset.exsCat; this._paint(); return; }
    const open = ev.target.closest('[data-exs-open]');
    if (open) { ev.preventDefault(); this.openSource(open.dataset.exsOpen); return; }
    const btn = ev.target.closest('[data-exs-act]');
    if (!btn) return;
    const act = btn.dataset.exsAct;
    if (act === 'close') this.close();
    else if (act === 'add') this.add(btn.dataset.key).catch(err => this._toast('Install failed: ' + ((err && err.message) || err), 'error'));
    else if (act === 'paste') this.addById(btn.dataset.id).catch(err => this._toast('Install failed: ' + ((err && err.message) || err), 'error'));
    else if (act === 'remove') this.remove(btn.dataset.folder, btn.dataset.name).catch(err => this._toast('Uninstall failed: ' + ((err && err.message) || err), 'error'));
  },

  openSource(url) {
    if (!/^https:\/\//i.test(String(url))) return;
    if (typeof TabManager === 'undefined') return;
    this.close();
    TabManager.createTab(url, true);
  },

  async _while(key, fn) {
    this._busy.add(key);
    this._paint();
    try { return await fn(); }
    finally {
      this._busy.delete(key);
      await this.refreshInstalled();
      this._paint();
    }
  },

  async addById(id) {
    if (typeof VexWebStore === 'undefined') { this._toast('Installing from the Web Store is not available in this window', 'error'); return { ok: false }; }
    return this._while('paste:' + id, () => VexWebStore.install(id));
  },

  async add(key) {
    const entry = this.entries().find(e => e.key === key);
    if (!entry) throw new Error('That extension is not on the shelf');
    if (entry.webstoreId) {
      if (typeof VexWebStore === 'undefined') { this._toast('Installing from the Web Store is not available in this window', 'error'); return { ok: false }; }
      return this._while(entry.key, () => VexWebStore.install(entry.webstoreId));
    }
    // A GitHub release: not signed or reviewed by any store, so say so first.
    if (!window.vex || typeof window.vex.extensionsInstallCatalog !== 'function') { this._toast('Installing is not available in this window', 'error'); return { ok: false }; }
    const yes = await window.vexConfirm({
      title: `Add "${entry.name}"?`,
      message: `Vex downloads the latest release from ${entry.publisher}'s own GitHub page and installs it. GitHub's published checksum is checked when there is one, but no store has reviewed this release. It never runs in Private or Tor tabs.`,
      okLabel: 'Add to Vex',
    });
    if (!yes) return { ok: false, cancelled: true };
    return this._while(entry.key, async () => {
      const r = await window.vex.extensionsInstallCatalog(entry.catalogId);
      if (r && r.ok) {
        this._toast(`Installed: ${r.name} v${r.version}` + (r.afterRestart ? ' — it loads when Vex restarts normally' : ''), 'success');
        window.dispatchEvent(new CustomEvent('vex-extensions-changed', { detail: { folder: r.folder } }));
      } else this._toast('Install failed: ' + ((r && r.error) || 'unknown'), 'error');
      return r;
    });
  },

  // The same path as Settings: switched off and gone at once, the files removed
  // when the Undo toast goes.
  async remove(folder, name) {
    const r = await window.vex.extensionsUninstallLater(folder);
    if (!r || !r.ok) { this._toast('Uninstall failed: ' + ((r && r.error) || 'unknown'), 'error'); return r; }
    await this.refreshInstalled();
    this._paint();
    window.dispatchEvent(new CustomEvent('vex-extensions-changed', { detail: { folder } }));
    window.VexUndo.offer({
      message: `Uninstalled “${name || folder}”`,
      undo: async () => {
        const back = await window.vex.extensionsUninstallUndo(folder);
        if (!back || !back.ok) throw new Error((back && back.error) || 'no answer');
        window.dispatchEvent(new CustomEvent('vex-extensions-changed'));
      },
      commit: async () => {
        const done = await window.vex.extensionsUninstall(folder);
        if (!done || (!done.ok && done.error !== 'Not found')) throw new Error('Could not remove its files: ' + ((done && done.error) || 'no answer'));
      },
    });
    return r;
  },
};

if (typeof window !== 'undefined') window.VexExtensionStore = VexExtensionStore;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtensionStore };
