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
        <button class="vtp-close" aria-label="Close">&times;</button>
      </div>
      <div class="vtp-sections"></div>
    `;
    this._modal = modal;
    this._renderSections();

    modal.querySelector('.vtp-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

    this._keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    document.addEventListener('keydown', this._keyHandler, true);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this._overlay = overlay;
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

    const section = (title, themes) => {
      if (!themes.length) return;
      const h = document.createElement('div');
      h.className = 'vtp-section-title';
      h.textContent = title;
      container.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'vtp-grid';
      themes.forEach(t => grid.appendChild(this._makeCard(t, current)));
      container.appendChild(grid);
    };
    section('★ Favorites', favThemes);
    section(favThemes.length ? 'All themes' : '', ThemeManager.THEMES);
  },

  _makeCard(t, current) {
    const card = document.createElement('button');
    card.className = 'vtp-card' + (t.id === current ? ' active' : '');
    card.dataset.theme = t.id;
    const isCustom = !!t.upload;
    const fav = ThemeManager.isFavorite(t.id);
    // Live CSS preview — a mini Vex window rendered with the theme's own variables
    // (scoped via data-theme). No image files, so previews are always identical in
    // style and can never be stale/cached/mismatched between builds.
    const upload = isCustom ? '<span class="vtp-thumb-upload">&#11014; Upload image</span>' : '';
    card.innerHTML = `
      <div class="vtp-thumb" data-theme-preview="${t.id}">${this._livePreview(t.id)}${upload}
        <span class="vtp-star${fav ? ' on' : ''}" role="button" title="${fav ? 'Remove from favorites' : 'Add to favorites'}">${fav ? '★' : '☆'}</span>
      </div>
      <div class="vtp-label">
        <span class="vtp-label-text">${t.label}</span>
        <span class="vtp-check" aria-hidden="true">&#10003;</span>
      </div>
    `;
    card.querySelector('.vtp-star').addEventListener('click', (e) => {
      e.stopPropagation();
      ThemeManager.toggleFavorite(t.id);
      this._renderSections();
    });
    card.addEventListener('click', () => {
      if (isCustom) { this._applyCustom(this._modal); return; }
      ThemeManager.applyTheme(t.id);
      this._modal.querySelectorAll('.vtp-card').forEach(c => c.classList.toggle('active', c.dataset.theme === t.id));
      window.showToast?.(`Theme: ${t.label}`, 'info', 1500);
      setTimeout(() => this.close(), 180);
    });
    return card;
  },

  // A live, detailed mini Vex window (top bar, tab, sidebar + the Vex Sync
  // settings page) rendered from the theme's own CSS variables — the wrapper
  // carries data-theme so var(--bg)/--surface/--primary/etc. resolve to that
  // theme. Sizes use cqw (container-query width) units so it scales to the card
  // and stays identical in style for every theme. No image files involved.
  _livePreview(id) {
    return `<div class="vtp-live" data-theme="${id}">
        <div class="pv-top">
          <span class="pv-logo"></span>
          <span class="pv-ws"><span class="pv-ws-dot"></span>Personal</span>
          <span class="pv-ic"></span><span class="pv-ic"></span>
          <span class="pv-url"><span class="pv-url-g"></span>Search or enter URL…</span>
          <span class="pv-sp"></span>
          <span class="pv-pill">AI</span><span class="pv-pill on"></span>
        </div>
        <div class="pv-tab"><span class="pv-tab-item"><span class="pv-fav"></span>New Tab — Vex</span></div>
        <div class="pv-body">
          <div class="pv-rail"><i class="on"></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="pv-content">
            <div class="pv-label">VEX SYNC</div>
            <div class="pv-card pv-cardrow"><span class="pv-circle"></span><div><div class="pv-h3">Vex Sync</div><div class="pv-sub">Sync your tabs, notes, and settings across devices</div></div></div>
            <div class="pv-card"><div class="pv-fl">Step 1: Enter your email</div><div class="pv-field"><span class="pv-input">you@example.com</span><span class="pv-btn">Send Code</span></div></div>
            <div class="pv-lists">
              <div><div class="pv-h4">What gets synced:</div><div class="pv-li">Tabs, sessions, and workspaces</div><div class="pv-li">Notes and scheduled tasks</div><div class="pv-li">Theme and preferences</div></div>
              <div><div class="pv-h4">What stays local:</div><div class="pv-li">Saved passwords</div><div class="pv-li">Website cookies and logins</div><div class="pv-li">AI chat history</div></div>
            </div>
          </div>
        </div>
      </div>`;
  },

  // Custom Image theme: let the user pick an image, downscale it to a data URL,
  // store it (ThemeManager pushes it into the start page), then apply 'custom'.
  // If they cancel but a previous image exists, just re-apply with that one.
  _applyCustom(grid) {
    const apply = async () => {
      await ThemeManager.setCustomImage(this._pendingImage || undefined);
      ThemeManager.applyTheme('custom');
      grid?.querySelectorAll('.vtp-card').forEach(c => c.classList.toggle('active', c.dataset.theme === 'custom'));
      window.showToast?.('Theme: Custom Image', 'info', 1500);
      setTimeout(() => this.close(), 180);
    };
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) { // cancelled
        let has = false; try { has = !!localStorage.getItem('vex.customThemeImage'); } catch {}
        if (has) apply(); else window.showToast?.('Pick an image to use the Custom theme');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const maxW = 1600;
            const scale = img.width > maxW ? maxW / img.width : 1;
            const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
            const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
            cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
            this._pendingImage = cv.toDataURL('image/jpeg', 0.82);
          } catch { this._pendingImage = reader.result; }
          apply();
        };
        img.onerror = () => window.showToast?.('Could not read that image');
        img.src = reader.result;
      };
      reader.onerror = () => window.showToast?.('Could not read that file');
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
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
