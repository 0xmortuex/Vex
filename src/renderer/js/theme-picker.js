// === Vex Theme Picker ===
//
// Visual theme chooser opened by Ctrl+Shift+Y (wired in app.js). Renders a grid
// of cards — one per ThemeManager.THEMES entry — each showing a PNG preview
// (assets/theme-previews/<id>.png) and the theme's label. Clicking a card
// applies the theme immediately and closes. Esc / backdrop click also closes.
//
// Previews are static screenshots captured by scripts/capture-theme-previews.js.
// If a preview file is missing the card falls back to a labelled color chip so
// the picker is still usable.

const ThemePicker = {
  _overlay: null,
  _keyHandler: null,

  open() {
    if (typeof ThemeManager === 'undefined') return;
    if (this._overlay) { this.close(); return; }

    const current = ThemeManager.getCurrentTheme();

    const overlay = document.createElement('div');
    overlay.id = 'vex-theme-picker-overlay';
    overlay.className = 'vex-theme-picker-overlay';

    const modal = document.createElement('div');
    modal.className = 'vex-theme-picker';
    modal.innerHTML = `
      <div class="vtp-header">
        <h2>Choose a Theme</h2>
        <button class="vtp-close" aria-label="Close" title="Close">${VexIcons.svg('x', { size: 20 })}</button>
      </div>
      <div class="vtp-sections"></div>
    `;
    this._modal = modal;
    this._renderSections();

    modal.querySelector('.vtp-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

    this._keyHandler = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); this.close();
    };
    document.addEventListener('keydown', this._keyHandler, true);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this._overlay = overlay;
    // Opened with Ctrl+Shift+Y from a page, focus stayed in the page, so Esc
    // went to the page and never reached this handler (found 2026-09-29).
    modal.querySelector('.vtp-close').focus({ preventScroll: true });
    requestAnimationFrame(() => overlay.classList.add('visible'));
  },

  // Build the Favorites + All Themes sections (re-called when a star toggles).
  _renderSections() {
    const modal = this._modal;
    if (!modal) return;
    const container = modal.querySelector('.vtp-sections');
    const current = ThemeManager.getCurrentTheme();
    const favIds = ThemeManager.getFavorites();
    const byId = {}; ThemeManager.THEMES.forEach(t => byId[t.id] = t);
    const favThemes = favIds.map(id => byId[id]).filter(Boolean);
    container.innerHTML = '';
    // Under a browser look its own colours are a choice too, and the first one:
    // picking a theme switches the look to that theme's colours, and this card
    // is the way back. While it is in force no theme card is ticked.
    const look = this._lookCard();
    const lookColours = !!look && window.VexGuiStyle.getColors() === 'look';
    // Light and dark on: say which slot a pick fills (js/theme-auto.js).
    const autoNote = (typeof ThemeAuto !== 'undefined') ? ThemeAuto.pickerNote() : '';
    if (autoNote) {
      const n = document.createElement('div');
      n.className = 'vtp-auto-note';
      n.textContent = autoNote;
      container.appendChild(n);
    }

    const section = (title, themes) => {
      if (!themes.length) return;
      const h = document.createElement('div');
      h.className = 'vtp-section-title';
      h.textContent = title;
      container.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'vtp-grid';
      themes.forEach(t => grid.appendChild(this._makeCard(t, lookColours ? null : current)));
      container.appendChild(grid);
    };
    if (look) {
      const h = document.createElement('div');
      h.className = 'vtp-section-title';
      h.textContent = 'This look';
      const grid = document.createElement('div');
      grid.className = 'vtp-grid';
      grid.appendChild(look);
      container.append(h, grid);
    }
    section('Favorites', favThemes);
    // Your own themes (js/theme-studio.js), and the way to make one.
    const own = ThemeManager.THEMES.filter(t => t.user);
    const h = document.createElement('div');
    h.className = 'vtp-section-title';
    h.textContent = 'Your themes';
    const grid = document.createElement('div');
    grid.className = 'vtp-grid';
    own.forEach(t => grid.appendChild(this._makeCard(t, lookColours ? null : current)));
    grid.appendChild(this._makeOwnCard());
    container.append(h, grid);
    section('All themes', ThemeManager.THEMES.filter(t => !t.user));
  },

  // "Make your own": the editor, starting from the theme you wear now.
  _makeOwnCard() {
    const card = document.createElement('button');
    card.className = 'vtp-card vtp-make-own';
    card.dataset.theme = 'make-own';
    card.innerHTML = `
      <div class="vtp-thumb vtp-make-own-thumb">${VexIcons.svg('palette', { size: 30 })}<span>Start from the theme you wear now</span></div>
      <div class="vtp-label"><span class="vtp-label-text">Make your own…</span></div>`;
    card.addEventListener('click', () => {
      const from = ThemeManager.getCurrentTheme();
      this.close();
      ThemeStudio.open({ from });
    });
    return card;
  },

  // The "<look> original colours" card, or null outside the browser looks.
  _lookCard() {
    const G = window.VexGuiStyle;
    if (!G || !G.isBrowserLook()) return null;
    const style = G.get();
    const name = document.querySelector(`#setting-gui-style option[value="${style}"]`)?.textContent || style;
    const card = document.createElement('button');
    card.className = 'vtp-card' + (G.getColors() === 'look' ? ' active' : '');
    card.dataset.theme = 'look-own';
    card.innerHTML = `
      <div class="vtp-thumb">${this._livePreview({ id: 'look-own' }, this._lookColors())}</div>
      <div class="vtp-label">
        <span class="vtp-label-text"></span>
        <span class="vtp-check" aria-hidden="true">${VexIcons.svg('check', { size: 14 })}</span>
      </div>`;
    card.querySelector('.vtp-label-text').textContent = `${name} — original colours`;
    card.addEventListener('click', () => {
      G.setColors('look');
      window.showToast?.(`${name}: original colours`, 'info', 1500);
      setTimeout(() => this.close(), 180);
    });
    return card;
  },

  // The look's own palette, read by switching body to look colours for the
  // length of one synchronous style read (no frame is drawn in between).
  _lookColors() {
    const body = document.body;
    const prev = body.dataset.guiColors;
    body.dataset.guiColors = 'look';
    const cs = getComputedStyle(body);
    const g = (n) => {
      const v = cs.getPropertyValue(n).trim();
      if (!v) throw new Error(`Browser look defines no ${n}`);
      return v;
    };
    const c = { bg: g('--b-page'), side: g('--b-frame-solid'), surf: g('--b-toolbar'), txt: g('--b-text'), acc: g('--b-accent'), bd: g('--b-border') };
    if (prev === undefined) delete body.dataset.guiColors; else body.dataset.guiColors = prev;
    return c;
  },

  _makeCard(t, current) {
    const card = document.createElement('button');
    card.className = 'vtp-card' + (t.id === current ? ' active' : '');
    card.dataset.theme = t.id;
    if (t.inspiredBy) card.title = `Inspired by ${t.inspiredBy}`;
    const fav = ThemeManager.isFavorite(t.id);
    // Live CSS preview — a mini Vex window rendered with the theme's own variables
    // (scoped via data-theme). No image files, so previews are always identical in
    // style and can never be stale/cached/mismatched between builds.
    const slot = (typeof ThemeAuto !== 'undefined') ? ThemeAuto.slotOf(t.id) : '';
    const slotTag = slot ? `<span class="vtp-slot" title="Your ${slot} theme (Light and dark)">${slot === 'light' ? 'Light' : 'Dark'}</span>` : '';
    // A theme of your own is edited; any other is the start of a new one.
    const editTip = t.user ? 'Edit this theme' : 'Customise this theme';
    card.innerHTML = `
      <div class="vtp-thumb" data-theme-preview="${t.id}">${this._livePreview(t)}
        <span class="vtp-edit" role="button" tabindex="0" title="${editTip}" aria-label="${editTip}">${VexIcons.svg('edit', { size: 14 })}</span>
        <span class="vtp-star${fav ? ' on' : ''}" role="button" title="${fav ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}">${VexIcons.svg('star', { size: 15 })}</span>
      </div>
      <div class="vtp-label">
        <span class="vtp-label-text"></span>${slotTag}
        <span class="vtp-check" aria-hidden="true">${VexIcons.svg('check', { size: 14 })}</span>
      </div>
    `;
    // A name you typed yourself goes in as text, never as markup.
    card.querySelector('.vtp-label-text').textContent = t.label;
    card.querySelector('.vtp-star').addEventListener('click', (e) => {
      e.stopPropagation();
      ThemeManager.toggleFavorite(t.id);
      this._renderSections();
    });
    const edit = (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.close();
      ThemeStudio.open({ from: t.id });
    };
    const editBtn = card.querySelector('.vtp-edit');
    editBtn.addEventListener('click', edit);
    editBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') edit(e); });
    card.addEventListener('click', () => {
      ThemeManager.applyTheme(t.id);
      this._modal.querySelectorAll('.vtp-card').forEach(c => c.classList.toggle('active', c.dataset.theme === t.id));
      // With Light and dark on, theme-auto.js says which slot it filled instead.
      if (typeof ThemeAuto === 'undefined' || !ThemeAuto.isOn()) window.showToast?.(`Theme: ${t.label}`, 'info', 1500);
      setTimeout(() => this.close(), 180);
    });
    return card;
  },

  // A detailed mini Vex window (top bar, tab, sidebar + Vex Sync settings) drawn
  // with the theme's EXACT colors via INLINE styles only — no external CSS class
  // rules, no CSS variables, no container queries. So it renders identically for
  // every theme and can never be defeated by stale/cached/overridden stylesheets.
  // Read a theme's actual colors from the loaded theme stylesheets (reliable —
  // theme-tokens.css always loads, or the whole app would be unstyled). Works for
  // every theme including the originals, with no per-theme data to maintain.
  _themeColors(id) {
    const probe = document.createElement('div');
    probe.setAttribute('data-theme', id);
    probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const g = (v, fb) => { const x = (cs.getPropertyValue(v) || '').trim(); return x || fb; };
    const c = {
      bg:   g('--bg',      g('--vex-bg-base', '#15151a')),
      side: g('--sidebar', g('--bg', '#1c1c22')),
      surf: g('--surface', g('--vex-glass-light', '#26262e')),
      txt:  g('--text',    g('--vex-text-primary', '#e6e6f0')),
      acc:  g('--primary', g('--vex-accent', '#8b8bff')),
      bd:   g('--border',  g('--vex-border-subtle', '#333344')),
    };
    probe.remove();
    return c;
  },

  _livePreview(t, colors) {
    const m = colors || this._themeColors(t.id);
    const bd = m.bd;                   // divider/border color
    const sp = (s) => s;               // tiny helper (readability)
    const bar = `flex:none;display:flex;align-items:center;background:${m.surf};border-bottom:1px solid ${bd}`;
    const line = (w, op) => `display:block;width:${w};height:4px;border-radius:2px;background:${m.txt};opacity:${op}`;
    return sp(`
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${m.bg};color:${m.txt};overflow:hidden;font-family:'Outfit',sans-serif">
      <div style="${bar};height:15%;gap:4px;padding:0 6px">
        <span style="width:8px;height:8px;border-radius:2px;transform:rotate(45deg);background:${m.acc};flex:none"></span>
        <span style="width:26px;height:7px;border-radius:9px;border:1px solid ${bd};flex:none"></span>
        <span style="flex:1;height:8px;border-radius:9px;background:${m.bg};border:1px solid ${bd}"></span>
        <span style="width:13px;height:8px;border-radius:3px;background:${m.acc};flex:none"></span>
      </div>
      <div style="${bar};height:11%;gap:4px;padding:0 6px">
        <span style="display:flex;align-items:center;gap:3px;height:62%;padding:0 6px;border-radius:4px;background:${m.bg};box-shadow:inset 0 0 0 1px ${m.acc}">
          <span style="width:5px;height:5px;border-radius:2px;background:${m.acc}"></span>
          <span style="width:34px;height:4px;border-radius:2px;background:${m.txt};opacity:.5"></span>
        </span>
      </div>
      <div style="flex:1;display:flex;min-height:0">
        <div style="width:13%;background:${m.side};border-right:1px solid ${bd};display:flex;flex-direction:column;align-items:center;gap:5px;padding:6px 0">
          <span style="width:55%;height:8px;border-radius:3px;background:${m.acc}"></span>
          <span style="width:55%;height:8px;border-radius:3px;background:${m.txt};opacity:.14"></span>
          <span style="width:55%;height:8px;border-radius:3px;background:${m.txt};opacity:.14"></span>
          <span style="width:55%;height:8px;border-radius:3px;background:${m.txt};opacity:.14"></span>
        </div>
        <div style="flex:1;padding:8px 11px;min-width:0">
          <div style="${line('40px', '.35')};margin-bottom:7px"></div>
          <div style="background:${m.surf};border:1px solid ${bd};border-radius:6px;padding:7px;display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="width:16px;height:16px;border-radius:5px;background:${m.acc};flex:none"></span>
            <span style="flex:1"><span style="${line('46%', '.7')};margin-bottom:3px"></span><span style="${line('76%', '.3')}"></span></span>
          </div>
          <div style="background:${m.surf};border:1px solid ${bd};border-radius:6px;padding:7px;margin-bottom:6px">
            <span style="${line('38%', '.5')};margin-bottom:6px"></span>
            <div style="display:flex;gap:5px"><span style="flex:1;height:14px;border-radius:3px;background:${m.bg};border:1px solid ${bd}"></span><span style="width:34px;height:14px;border-radius:3px;background:${m.acc};flex:none"></span></div>
          </div>
          <div style="display:flex;gap:14px">
            <div style="flex:1"><span style="${line('60%', '.5')};margin-bottom:4px"></span><span style="${line('88%', '.25')};margin-bottom:3px"></span><span style="${line('80%', '.25')}"></span></div>
            <div style="flex:1"><span style="${line('58%', '.5')};margin-bottom:4px"></span><span style="${line('86%', '.25')};margin-bottom:3px"></span><span style="${line('70%', '.25')}"></span></div>
          </div>
        </div>
      </div>
    </div>`);
  },

  close() {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    const overlay = this._overlay;
    this._overlay = null;
    if (!overlay) return;
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 180);
  },

  toggle() {
    if (this._overlay) this.close(); else this.open();
  }
};

if (typeof window !== 'undefined') {
  window.ThemePicker = ThemePicker;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThemePicker };
}
