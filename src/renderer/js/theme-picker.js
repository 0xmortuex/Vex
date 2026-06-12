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
      const isCustom = !!t.upload;
      // New themes ship a live CSS mini-UI mockup (drawn from their palette) so
      // they look like real previews; the original themes use their PNG.
      const thumbInner = t.mock
        ? this._mockHtml(t.mock) + (isCustom ? '<span class="vtp-thumb-upload">&#11014; Upload image</span>' : '')
        : `<img src="../../assets/theme-previews/${t.preview}" alt="${t.label} preview"
               onerror="this.style.display='none';this.parentNode.classList.add('vtp-thumb-fallback')">
           <span class="vtp-thumb-name">${t.label}</span>`;
      card.innerHTML = `
        <div class="vtp-thumb" data-theme-preview="${t.id}">${thumbInner}</div>
        <div class="vtp-label">
          <span class="vtp-label-text">${t.label}</span>
          <span class="vtp-check" aria-hidden="true">&#10003;</span>
        </div>
      `;
      card.addEventListener('click', () => {
        if (isCustom) { this._applyCustom(grid); return; }
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

  // A tiny CSS browser mockup (sidebar + tab dots + toolbar + text rows + an
  // accent button) drawn from a theme's palette, so new themes get a real-looking
  // preview without a screenshot PNG.
  _mockHtml(m) {
    const v = `--m-bg:${m.bg};--m-side:${m.side};--m-surf:${m.surf};--m-txt:${m.txt};--m-acc:${m.acc}`;
    return `<div class="vtp-mock" style="${v}">
        <div class="vtp-mock-side"><i class="on"></i><i></i><i></i><i></i></div>
        <div class="vtp-mock-main">
          <div class="vtp-mock-bar"></div>
          <div class="vtp-mock-rows"><u></u><u></u><u style="width:55%"></u></div>
          <div class="vtp-mock-pill"></div>
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
