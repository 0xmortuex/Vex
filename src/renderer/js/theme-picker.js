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
      <div class="vtp-grid"></div>
    `;

    const grid = modal.querySelector('.vtp-grid');
    for (const t of ThemeManager.THEMES) {
      const card = document.createElement('button');
      card.className = 'vtp-card' + (t.id === current ? ' active' : '');
      card.dataset.theme = t.id;
      card.innerHTML = `
        <div class="vtp-thumb" data-theme-preview="${t.id}">
          <img src="../../assets/theme-previews/${t.preview}" alt="${t.label} preview"
               onerror="this.style.display='none';this.parentNode.classList.add('vtp-thumb-fallback')">
          <span class="vtp-thumb-name">${t.label}</span>
        </div>
        <div class="vtp-label">
          <span class="vtp-label-text">${t.label}</span>
          <span class="vtp-check" aria-hidden="true">&#10003;</span>
        </div>
      `;
      card.addEventListener('click', () => {
        ThemeManager.applyTheme(t.id);
        grid.querySelectorAll('.vtp-card').forEach(c => c.classList.toggle('active', c.dataset.theme === t.id));
        window.showToast?.(`Theme: ${t.label}`, 'info', 1500);
        // Brief beat so the active tick reads, then dismiss.
        setTimeout(() => this.close(), 180);
      });
      grid.appendChild(card);
    }

    modal.querySelector('.vtp-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

    this._keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    document.addEventListener('keydown', this._keyHandler, true);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this._overlay = overlay;
    requestAnimationFrame(() => overlay.classList.add('visible'));
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
