// === Vex Discover — every feature, introduced =============================
//
// The problem this solves: a browser's features are invisible. Vex has well
// over a hundred, and until now the only complete list of them lived in the
// GitHub README — outside the browser, where nobody looks. So people used a
// fraction of what they had installed.
//
// Discover is that list, in the app: categories down the side, every feature
// with one sentence on what it is FOR, and two buttons —
//
//   Show me   spotlights the actual control on your screen (VexTour.spotlight)
//   Open      just runs it, through its real Ctrl+K command
//
// and, per category, "Tour this category", which walks its features in turn.
//
// A feature that is switched off or whose panel you hid is still listed, with
// "Turn on & show me": a feature you cannot see is one you cannot discover,
// which is the whole point of this screen.
//
// The content lives in js/feature-catalog.js. Everything here is presentation.
const VexDiscover = {
  _el: null,
  _cat: null,
  _query: '',

  open(catId) {
    this.close();
    if (typeof VexFeatures === 'undefined') throw new Error('The feature catalogue is not loaded');
    this._cat = catId || VexFeatures.CATS[0].id;
    this._query = '';

    const m = document.createElement('div');
    m.id = 'vex-discover';
    m.className = 'vexd-overlay';
    m.innerHTML = `
      <div class="vexd-card" role="dialog" aria-modal="true" aria-label="Discover Vex">
        <div class="vexd-head">
          <span class="vexd-title">Discover Vex</span>
          <span class="vexd-count" id="vexd-count"></span>
          <input id="vexd-search" class="vexd-search" placeholder="Search every feature…" spellcheck="false" autocomplete="off" aria-label="Search every feature">
          <button id="vexd-close" class="vexd-x" aria-label="Close">${VexIcons.svg('x', { size: 14 })}</button>
        </div>
        <div class="vexd-body">
          <nav class="vexd-cats" id="vexd-cats" aria-label="Feature categories"></nav>
          <div class="vexd-list" id="vexd-list"></div>
        </div>
      </div>`;
    document.body.appendChild(m);
    this._el = m;

    m.addEventListener('click', (e) => { if (e.target === m) this.close(); });
    m.querySelector('#vexd-close').addEventListener('click', () => this.close());
    const search = m.querySelector('#vexd-search');
    search.addEventListener('input', () => { this._query = search.value.trim(); this._paint(); });

    this._onKey = (e) => {
      if (e.key === 'Escape' && document.getElementById('vex-discover')) { e.preventDefault(); this.close(); }
    };
    document.addEventListener('keydown', this._onKey);

    this._paint();
    search.focus();
  },

  close() {
    document.getElementById('vex-discover')?.remove();
    if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null; }
    this._el = null;
  },

  _esc(s) { return window.escapeHtml(String(s == null ? '' : s)); },

  // What's on screen right now: a search hit list, or one category.
  _visible() {
    if (this._query) return VexFeatures.search(this._query);
    return VexFeatures.byCat(this._cat);
  },

  _paint() {
    if (!this._el) return;
    this._paintCats();
    this._paintList();
  },

  _paintCats() {
    const nav = this._el.querySelector('#vexd-cats');
    const searching = !!this._query;
    nav.innerHTML = VexFeatures.CATS.map(c => {
      const n = VexFeatures.byCat(c.id).length;
      const on = !searching && c.id === this._cat;
      return `<button class="vexd-cat${on ? ' on' : ''}" data-cat="${this._esc(c.id)}" aria-current="${on ? 'true' : 'false'}">
        <span class="vexd-cat-ic">${VexIcons.svg(c.icon, { size: 15 })}</span>
        <span class="vexd-cat-name">${this._esc(c.name)}</span>
        <span class="vexd-cat-n">${n}</span>
      </button>`;
    }).join('');
    nav.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      this._cat = b.dataset.cat;
      this._query = '';
      const search = this._el.querySelector('#vexd-search');
      if (search) search.value = '';
      this._paint();
    }));
  },

  _paintList() {
    const list = this._el.querySelector('#vexd-list');
    const items = this._visible();
    const cat = VexFeatures.CATS.find(c => c.id === this._cat);
    const total = VexFeatures.ITEMS.length;
    this._el.querySelector('#vexd-count').textContent =
      this._query ? `${items.length} of ${total}` : `${total} features`;

    if (!items.length) {
      list.innerHTML = `<div class="vexd-empty">Nothing matches “${this._esc(this._query)}”.</div>`;
      return;
    }

    const header = this._query
      ? `<div class="vexd-cathead"><div class="vexd-cathead-name">Search results</div>
           <div class="vexd-cathead-blurb">${items.length} feature${items.length === 1 ? '' : 's'} matching “${this._esc(this._query)}”.</div></div>`
      : `<div class="vexd-cathead">
           <div class="vexd-cathead-name">${this._esc(cat.name)}</div>
           <div class="vexd-cathead-blurb">${this._esc(cat.blurb)}</div>
           <button class="vexd-tourcat" id="vexd-tourcat">${VexIcons.svg('compass', { size: 13 })} Tour this category</button>
         </div>`;

    list.innerHTML = header + items.map(f => this._row(f)).join('');

    list.querySelector('#vexd-tourcat')?.addEventListener('click', () => this.tourCategory(this._cat));
    list.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => this.showMe(b.dataset.show)));
    list.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => this.openFeature(b.dataset.open)));
    list.querySelectorAll('[data-enable]').forEach(b => b.addEventListener('click', () => this.turnOn(b.dataset.enable)));
  },

  _row(f) {
    const keys = VexFeatures.keysOf(f);
    const off = VexFeatures.offState(f);
    const cmd = VexFeatures.command(f);
    const canOpen = !!cmd || !!f.setting;
    const canShow = !!f.sel || !!f.panel || !!cmd;
    return `
      <div class="vexd-item${off ? ' off' : ''}" data-id="${this._esc(f.id)}">
        <div class="vexd-item-ic">${VexIcons.svg(VexFeatures.iconOf(f), { size: 17 })}</div>
        <div class="vexd-item-main">
          <div class="vexd-item-name">${this._esc(VexFeatures.nameOf(f))}
            ${keys ? `<kbd class="vexd-keys">${this._esc(keys)}</kbd>` : ''}
            ${off ? '<span class="vexd-off">off</span>' : ''}</div>
          <div class="vexd-item-what">${this._esc(f.what)}</div>
          ${off ? `<div class="vexd-item-off">${this._esc(off.reason)}</div>` : ''}
        </div>
        <div class="vexd-item-btns">
          ${off ? `<button class="vexd-btn primary" data-enable="${this._esc(f.id)}">Turn on &amp; show me</button>` : ''}
          ${!off && canShow ? `<button class="vexd-btn" data-show="${this._esc(f.id)}">Show me</button>` : ''}
          ${!off && canOpen ? `<button class="vexd-btn primary" data-open="${this._esc(f.id)}">Open</button>` : ''}
          ${!off && !canShow && !canOpen ? '<span class="vexd-manual">built in</span>' : ''}
        </div>
      </div>`;
  },

  // The card shown beside a spotlit control.
  _card(f) {
    const keys = VexFeatures.keysOf(f);
    return {
      title: VexFeatures.nameOf(f),
      html: this._esc(f.what) + (keys ? ` <kbd>${this._esc(keys)}</kbd>` : ''),
    };
  },

  // Spotlight the real control. Discover steps out of the way first, then
  // comes back when the tour ends — otherwise it would cover what it is
  // pointing at.
  showMe(id) {
    const f = VexFeatures.get(id);
    if (!f) throw new Error('No feature "' + id + '" in the catalogue');
    const cat = this._cat;
    const target = this._targetFor(f);
    this.close();
    const back = () => this.open(cat);
    if (!target) {
      // Nothing on screen to point at: say so rather than opening an empty
      // tour, and offer the thing itself instead.
      window.showToast?.(VexFeatures.nameOf(f) + ' has no button on screen — use Open, or ' + (VexFeatures.keysOf(f) || 'Ctrl+K'), 'info');
      back();
      return;
    }
    const shown = VexTour.run([Object.assign({ sel: target }, this._card(f))], { markSeen: false, onDone: back });
    if (!shown) { window.showToast?.('That control is not on screen in this layout'); back(); }
  },

  // The selector to spotlight for a feature: its own, else its sidebar icon,
  // else the command-bar button (every command lives behind it).
  _targetFor(f) {
    if (f.sel && document.querySelector(f.sel)) return f.sel;
    if (f.panel && document.querySelector(`[data-panel="${f.panel}"]`)) return `[data-panel="${f.panel}"]`;
    if (f.cmd && document.querySelector('#btn-command')) return '#btn-command';
    return null;
  },

  // Walk every feature in a category that has something to point at.
  tourCategory(catId) {
    const items = VexFeatures.byCat(catId);
    const cat = VexFeatures.CATS.find(c => c.id === catId);
    const steps = [{ title: cat ? cat.name : 'Vex', html: this._esc(cat ? cat.blurb : '') }];
    for (const f of items) {
      const target = this._targetFor(f);
      steps.push(Object.assign({ sel: target || undefined }, this._card(f)));
    }
    this.close();
    const shown = VexTour.run(steps, { markSeen: false, onDone: () => this.open(catId) });
    if (!shown) { window.showToast?.('Nothing in that category is on screen right now'); this.open(catId); }
  },

  // Run the feature for real, through its own Ctrl+K command so there is one
  // implementation rather than two.
  openFeature(id) {
    const f = VexFeatures.get(id);
    if (!f) throw new Error('No feature "' + id + '" in the catalogue');
    const cmd = VexFeatures.command(f);
    if (cmd) {
      this.close();
      if (typeof CommandBar !== 'undefined' && typeof CommandBar._execute === 'function') CommandBar._execute(cmd);
      else cmd.action();
      return;
    }
    if (f.setting && f.setting.section) {
      this.close();
      if (window.SettingsUI?.openSection) SettingsUI.openSection(f.setting.section);
      else SidebarManager.openPanel('settings');
      return;
    }
    if (f.setting && f.setting.id) {
      this.close();
      SidebarManager.openPanel('settings');
      document.getElementById(f.setting.id)?.scrollIntoView({ block: 'center' });
      return;
    }
    throw new Error(VexFeatures.nameOf(f) + ' has nothing to open — it is always on');
  },

  // Switch a hidden panel or an off setting back on, then show it.
  turnOn(id) {
    const f = VexFeatures.get(id);
    if (!f) throw new Error('No feature "' + id + '" in the catalogue');
    const off = VexFeatures.offState(f);
    if (!off) { this.showMe(id); return; }
    off.enable();
    if (f.panel && typeof SidebarManager !== 'undefined') SidebarManager.applyPanelOverrides?.();
    window.showToast?.(VexFeatures.nameOf(f) + ' is on', 'success');
    this._paint();
    // Give the sidebar a frame to draw the icon before pointing at it.
    setTimeout(() => { try { this.showMe(id); } catch (err) { console.warn('[discover] could not show', id, err && err.message); } }, 120);
  },
};

if (typeof window !== 'undefined') window.VexDiscover = VexDiscover;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDiscover };
