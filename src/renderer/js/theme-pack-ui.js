// === The theme pack picker =====================================================================================================================
//
// One card per pack, each a small live picture of what the pack is made of (its colours, the shape of its tabs and toolbar and cards, and four
// of its icons), then "Customize": the design, the icons and the colours picked one by one, and a way back. Opened from the theme picker
// (js/theme-picker.js), from Settings > Appearance and from the command bar. The data and the apply logic are in js/theme-packs.js.
const ThemePackUI = {
  _el: null,
  _onKey: null,

  // Four icons, to show a pack's hand.
  SAMPLE_ICONS: ['home', 'star', 'search', 'settings'],

  open() {
    if (typeof VexThemePacks === 'undefined' && !window.VexThemePacks) throw new Error('Theme packs are not loaded');
    this.close();
    const el = document.createElement('div');
    el.className = 'vpk-backdrop';
    el.innerHTML = `
      <div class="vpk" role="dialog" aria-modal="true" aria-label="Theme packs">
        <div class="vpk-head">
          <div style="flex:1">
            <h2>Theme packs</h2>
            <p>A pack is more than colours: the shape of the tabs, toolbar and panels, a set of icons and, for some, a font. It keeps the look you chose (Classic, Firefox, Chrome...).</p>
          </div>
          <button class="vpk-close" type="button" aria-label="Close" title="Close">${VexIcons.svg('x', { size: 18 })}</button>
        </div>
        <div class="vpk-body"></div>
        <div class="vpk-foot">
          <button type="button" data-reset>Back to Vex’s own design</button>
          <span class="vpk-now"></span>
        </div>
      </div>`;
    document.body.appendChild(el);
    this._el = el;
    el.querySelector('.vpk-close').addEventListener('click', () => this.close());
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
    el.querySelector('[data-reset]').addEventListener('click', () => this._do(() => window.VexThemePacks.reset(), 'Vex’s own design is back'));
    this._onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); this.close();
    };
    window.addEventListener('keydown', this._onKey, true);
    this._draw();
    el.querySelector('.vpk-close').focus({ preventScroll: true });
    return el;
  },

  close() {
    if (this._onKey) { window.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    if (this._el) { this._el.remove(); this._el = null; }
  },

  toggle() { if (this._el) this.close(); else this.open(); },

  _do(fn, message) {
    try { fn(); }
    catch (err) { console.error('[ThemePackUI]', err); window.showToast?.((err && err.message) || 'That did not work', 'error'); }
    if (message) window.showToast?.(message, 'info', 1500);
    this._draw();
  },

  _esc(v) { return window.escapeHtml ? window.escapeHtml(String(v)) : String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  _lookName(id) {
    return document.querySelector(`#setting-gui-style option[value="${id}"]`)?.textContent || id;
  },

  // A mini window in the pack's own colours, tab shape, toolbar and card, with its icons, drawn with inline styles only (as the theme cards are),
  // so it is the same whatever stylesheet is loaded.
  _preview(colourId, designId, iconsId) {
    const m = ThemePicker._themeColors(colourId);
    const d = window.VexThemePacks.design(designId);
    const tab = {
      default: 'border-radius:5px 5px 0 0', pill: 'border-radius:99px', block: `border-radius:0;border:2px solid ${m.bd};border-bottom:none`,
      folder: 'border-radius:8px 8px 0 0', underline: `border-radius:0;border-bottom:2px solid ${m.acc};background:transparent`, soft: 'border-radius:7px',
    }[d.tabs];
    const bar = {
      default: `border-bottom:1px solid ${m.bd}`, float: `margin:3px 6px 0;border-radius:9px;border:1px solid ${m.bd};box-shadow:0 4px 10px rgba(0,0,0,.3)`,
      line: `border-bottom:2px solid ${m.acc}`, flat: '',
    }[d.bar];
    const card = {
      default: `border:1px solid ${m.bd};border-radius:6px`, glass: `border:1px solid ${m.bd};border-radius:8px;opacity:.9`,
      paper: `border:2px solid ${m.bd};border-radius:2px;box-shadow:3px 3px 0 ${m.bd}`, sheet: `border:1px solid ${m.bd};border-radius:6px;box-shadow:0 5px 10px rgba(0,0,0,.25)`,
      outline: `border:1.5px solid ${m.acc};border-radius:3px`, flat: `border:1px solid ${m.bd};border-radius:4px`, lift: `border:1px solid transparent;border-radius:10px;box-shadow:0 8px 14px rgba(0,0,0,.35)`,
    }[d.surface];
    const pad = d.density === 'compact' ? 3 : d.density === 'roomy' ? 8 : 5;
    const icons = this.SAMPLE_ICONS.map((n) => window.VexIconPacks.preview(n, iconsId, 16)).join('');
    const tabBg = (on) => `background:${on ? m.surf : 'transparent'}`;
    return `
      <span style="position:absolute;inset:0;display:flex;flex-direction:column;background:${m.bg};color:${m.txt};overflow:hidden;font-family:'Outfit',sans-serif">
        <span style="display:flex;gap:${d.tabs === 'pill' ? 5 : 2}px;padding:6px 6px 0;background:${m.side};align-items:flex-end">
          <span style="${tab};${tabBg(true)};width:46px;height:${12 + pad}px;box-shadow:inset 0 2px 0 ${m.acc}"></span>
          <span style="${tab};${tabBg(false)};width:40px;height:${12 + pad}px;opacity:.7"></span>
          <span style="${tab};${tabBg(false)};width:40px;height:${12 + pad}px;opacity:.7"></span>
        </span>
        <span style="display:flex;align-items:center;gap:4px;padding:${pad}px 7px;background:${m.surf};${bar}">
          <span style="flex:1;height:9px;border-radius:9px;background:${m.bg};border:1px solid ${m.bd}"></span>
          <span style="width:12px;height:9px;border-radius:3px;background:${m.acc}"></span>
        </span>
        <span style="flex:1;display:flex;gap:8px;padding:8px;min-height:0">
          <span style="flex:1;background:${m.surf};${card};padding:7px;display:flex;flex-direction:column;gap:5px">
            <span style="display:block;width:50%;height:5px;border-radius:2px;background:${m.txt};opacity:.7"></span>
            <span style="display:block;width:80%;height:4px;border-radius:2px;background:${m.txt};opacity:.3"></span>
            <span style="display:flex;gap:6px;color:${m.acc};margin-top:auto">${icons}</span>
          </span>
        </span>
      </span>`;
  },

  _draw() {
    const el = this._el;
    if (!el) return;
    const P = window.VexThemePacks;
    const cur = P.current();
    const body = el.querySelector('.vpk-body');
    const esc = (v) => this._esc(v);
    const check = VexIcons.svg('check', { size: 14 });

    const packCards = P.PACKS.map((p) => `
      <button type="button" class="vpk-card${cur.pack === p.id ? ' on' : ''}" data-pack="${esc(p.id)}">
        <span class="vpk-prev">${this._preview(p.colours, p.design, p.icons)}</span>
        <span class="vpk-label">
          <span class="vpk-name">${esc(p.name)}<span class="vpk-check" aria-hidden="true">${check}</span></span>
          <span class="vpk-note">${esc(p.note)}</span>
          <span class="vpk-look"><span>Made for:</span> <b data-look="${esc(p.look)}">${esc(p.look)}</b></span>
        </span>
      </button>`).join('');

    const designChips = P.DESIGNS.map((d) => `
      <button type="button" class="vpk-chip${cur.design === d.id ? ' on' : ''}" data-design="${esc(d.id)}" title="${esc(d.note)}">${esc(d.name)}</button>`).join('');

    const iconChips = window.VexIconPacks.PACKS.map((ip) => `
      <button type="button" class="vpk-chip${cur.icons === ip.id ? ' on' : ''}" data-icons="${esc(ip.id)}" title="${esc(ip.note)}">
        <span class="vpk-icons">${this.SAMPLE_ICONS.slice(0, 3).map((n) => window.VexIconPacks.preview(n, ip.id, 18)).join('')}</span>${esc(ip.name)}
      </button>`).join('');

    const themeOptions = ThemeManager.THEMES.map((t) => `<option value="${esc(t.id)}"${cur.colours === t.id ? ' selected' : ''}>${esc(t.label)}</option>`).join('');

    body.innerHTML = `
      <div class="vpk-kind">Packs<span>Colours, shape, icons and type together. Pick one, then change any part below.</span></div>
      <div class="vpk-grid">${packCards}</div>
      <div class="vpk-kind">Customize<span>Each part on its own. Changing one makes the pack your own.</span></div>
      <div class="vpk-kind" style="margin-top:8px">Design</div>
      <div class="vpk-chips">${designChips}</div>
      <div class="vpk-kind">Icons</div>
      <div class="vpk-chips">${iconChips}</div>
      <div class="vpk-kind">Colours</div>
      <div><select class="vpk-select" aria-label="Colours">${themeOptions}</select></div>`;

    // The look names on the cards read as the look's own label.
    body.querySelectorAll('[data-look]').forEach((b) => { b.textContent = b.dataset.look === 'classic' ? 'Classic' : this._lookName(b.dataset.look); });

    body.querySelectorAll('[data-pack]').forEach((b) => b.addEventListener('click', () => {
      const p = P.pack(b.dataset.pack);
      this._do(() => P.applyPack(p.id), `Theme pack: ${p.name}`);
    }));
    body.querySelectorAll('[data-design]').forEach((b) => b.addEventListener('click', () => this._do(() => P.setDesign(b.dataset.design))));
    body.querySelectorAll('[data-icons]').forEach((b) => b.addEventListener('click', () => this._do(() => P.setIcons(b.dataset.icons))));
    body.querySelector('.vpk-select').addEventListener('change', (e) => this._do(() => P.setColours(e.target.value)));

    const name = cur.pack ? P.pack(cur.pack).name : 'Custom';
    el.querySelector('.vpk-now').textContent = `Now: ${name} (design ${P.design(cur.design).name}, icons ${window.VexIconPacks.current().name}).`;
  },
};

if (typeof window !== 'undefined') window.ThemePackUI = ThemePackUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { ThemePackUI };
