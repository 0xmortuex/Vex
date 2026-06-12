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
      <div class="vtp-thumb" data-theme-preview="${t.id}">${this._livePreview(t)}${upload}
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

  _livePreview(t) {
    const m = this._themeColors(t.id);
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
