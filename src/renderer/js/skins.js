// === Skins: what a theme is made of, not just what colour it is ===========
//
// Vex had thirty-seven themes and every one of them was a set of flat colours.
// Two of them differ only in hue, which makes "make it mine" a choice between
// shades of the same thing — and a browser you live in all day can carry more
// character than that without becoming a toy.
//
// A skin is three separate choices, each of which works with every theme and
// with every browser look:
//
//   pattern   a texture on the chrome itself — dots, graph paper, hexagons,
//             circuitry, waves, stars. Drawn as an SVG data URI in
//             currentColor, so it takes the theme's own accent and stays
//             right when the theme changes. Never on the page, only on Vex.
//   shape     the geometry: how round a corner is, how heavy a border is,
//             how much air sits between things. Sharp for a tool, soft for a
//             reading room, round for something friendlier.
//   glow      the light: flat, a lift under panels, or a coloured halo.
//
// All three are CSS variables plus one attribute on <html>, so nothing is
// rebuilt and switching is instant. The default is what Vex always looked
// like: no pattern, soft corners, ordinary shadows.
const VexSkins = {
  PATTERN_KEY: 'vex.skinPattern',
  SHAPE_KEY: 'vex.skinShape',
  GLOW_KEY: 'vex.skinGlow',
  STRENGTH_KEY: 'vex.skinStrength',

  // Each pattern is an SVG tile. `%c` is replaced with the colour to draw it
  // in, so one definition serves every theme in both light and dark.
  PATTERNS: [
    { id: 'none', name: 'None', note: 'Flat colour, as Vex ships', svg: null },
    { id: 'dots', name: 'Dots', note: 'A quiet grid of points', size: 16,
      svg: '<circle cx="2" cy="2" r="1.3" fill="%c"/>' },
    { id: 'grid', name: 'Graph paper', note: 'Squared, like a notebook', size: 20,
      svg: '<path d="M20 0H0v20" fill="none" stroke="%c" stroke-width="1"/>' },
    { id: 'lines', name: 'Ruled', note: 'Horizontal rules, like paper', size: 22,
      svg: '<path d="M0 21.5h22" stroke="%c" stroke-width="1" fill="none"/>' },
    { id: 'diagonal', name: 'Diagonal', note: 'Hatching at forty-five degrees', size: 14,
      svg: '<path d="M-2 2 2-2M0 14 14 0M12 16l4-4" stroke="%c" stroke-width="1.4" fill="none"/>' },
    { id: 'cross', name: 'Crosshatch', note: 'Both ways at once', size: 16,
      svg: '<path d="M0 0l16 16M16 0L0 16" stroke="%c" stroke-width="1" fill="none"/>' },
    { id: 'hex', name: 'Honeycomb', note: 'Hexagons, tiled', size: 28,
      svg: '<path d="M14 1l12 7v14l-12 7-12-7V8z" fill="none" stroke="%c" stroke-width="1.1"/>' },
    { id: 'triangles', name: 'Triangles', note: 'A folded-paper look', size: 24,
      svg: '<path d="M12 2 22 20H2z" fill="none" stroke="%c" stroke-width="1.1"/>' },
    { id: 'circuit', name: 'Circuit', note: 'Traces and pads', size: 32,
      svg: '<path d="M4 8h10v10h10M4 24h6v-8M22 4v8h6" fill="none" stroke="%c" stroke-width="1.1"/><circle cx="14" cy="18" r="2" fill="%c"/><circle cx="28" cy="12" r="2" fill="%c"/>' },
    { id: 'waves', name: 'Waves', note: 'A slow swell', size: 36,
      svg: '<path d="M0 12c6-8 12-8 18 0s12 8 18 0" fill="none" stroke="%c" stroke-width="1.3"/><path d="M0 26c6-8 12-8 18 0s12 8 18 0" fill="none" stroke="%c" stroke-width="1.3"/>' },
    { id: 'scales', name: 'Fish scales', note: 'Overlapping arcs', size: 24,
      svg: '<path d="M0 12a12 12 0 0 1 24 0M-12 24a12 12 0 0 1 24 0M12 24a12 12 0 0 1 24 0" fill="none" stroke="%c" stroke-width="1.1"/>' },
    { id: 'stars', name: 'Night sky', note: 'Scattered stars', size: 40,
      svg: '<path d="M8 6l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM30 20l1.2 2.4 2.4 1.2-2.4 1.2L30 27l-1.2-2.2-2.4-1.2 2.4-1.2z" fill="%c"/><circle cx="20" cy="33" r="1" fill="%c"/><circle cx="34" cy="7" r="0.9" fill="%c"/>' },
    { id: 'confetti', name: 'Confetti', note: 'Small marks, thrown', size: 30,
      svg: '<rect x="4" y="5" width="4" height="2" rx="1" fill="%c" transform="rotate(25 6 6)"/><rect x="20" y="12" width="4" height="2" rx="1" fill="%c" transform="rotate(-40 22 13)"/><rect x="10" y="22" width="4" height="2" rx="1" fill="%c" transform="rotate(70 12 23)"/>' },
    { id: 'topo', name: 'Contours', note: 'A map of some hill', size: 48,
      svg: '<path d="M2 38c10-14 22-16 30-6s12 4 14-2" fill="none" stroke="%c" stroke-width="1"/><path d="M0 26c12-16 26-16 34-4s10 2 14-4" fill="none" stroke="%c" stroke-width="1"/><path d="M4 14C14 2 28 4 36 12" fill="none" stroke="%c" stroke-width="1"/>' },
    { id: 'plaid', name: 'Plaid', note: 'Woven bands', size: 32,
      svg: '<path d="M0 6h32M0 7.5h32M6 0v32M7.5 0v32" stroke="%c" stroke-width="1" fill="none"/><path d="M0 22h32M22 0v32" stroke="%c" stroke-width="2" fill="none" opacity="0.6"/>' },
    { id: 'weave', name: 'Basket weave', note: 'Over and under', size: 20,
      svg: '<path d="M0 5h10v10H0zM10 15h10v10H10z" fill="none" stroke="%c" stroke-width="1.1"/>' },
    { id: 'chevron', name: 'Chevrons', note: 'Arrows in rows', size: 20,
      svg: '<path d="M0 12l10-8 10 8M0 20l10-8 10 8" fill="none" stroke="%c" stroke-width="1.2"/>' },
    { id: 'bricks', name: 'Brickwork', note: 'Staggered courses', size: 32,
      svg: '<path d="M0 8h32M0 24h32M8 0v8M24 0v8M16 8v16M0 24v8M32 24v8" stroke="%c" stroke-width="1" fill="none"/>' },
    { id: 'terrazzo', name: 'Terrazzo', note: 'Chips in stone', size: 36,
      svg: '<circle cx="7" cy="9" r="2.2" fill="%c"/><rect x="22" y="5" width="5" height="3" rx="1.5" fill="%c" transform="rotate(20 24 6)"/><circle cx="28" cy="26" r="1.8" fill="%c"/><rect x="8" y="24" width="6" height="3" rx="1.5" fill="%c" transform="rotate(-30 11 25)"/>' },
    { id: 'noise', name: 'Grain', note: 'A little texture, like paper', size: 90, noise: true, svg: null },
  ],

  SHAPES: [
    { id: 'soft', name: 'Soft', note: 'As Vex ships: gentle corners', vars: { radius: '10px', radiusLg: '14px', border: '1px', pad: '1' } },
    { id: 'sharp', name: 'Sharp', note: 'Square corners, hairline borders — a tool, not a toy', vars: { radius: '0px', radiusLg: '0px', border: '1px', pad: '0.92' } },
    { id: 'round', name: 'Round', note: 'Pills and circles, friendlier', vars: { radius: '16px', radiusLg: '22px', border: '1px', pad: '1.08' } },
    { id: 'heavy', name: 'Drawn', note: 'Thick outlines, like something sketched', vars: { radius: '12px', radiusLg: '16px', border: '2px', pad: '1.05' } },
    { id: 'tight', name: 'Dense', note: 'Less air — more on screen at once', vars: { radius: '8px', radiusLg: '10px', border: '1px', pad: '0.82' } },
  ],

  GLOWS: [
    { id: 'normal', name: 'Normal', note: 'The shadows Vex ships with' },
    { id: 'flat', name: 'Flat', note: 'No shadows at all' },
    { id: 'lift', name: 'Lifted', note: 'Panels sit above the page' },
    { id: 'halo', name: 'Halo', note: 'A coloured glow in the theme’s accent' },
  ],

  // How strongly a pattern shows. A texture you can read through is the point;
  // one you cannot is a wallpaper.
  STRENGTHS: [
    { id: 'whisper', name: 'Barely there', alpha: 0.035 },
    { id: 'soft', name: 'Soft', alpha: 0.07 },
    { id: 'clear', name: 'Clear', alpha: 0.13 },
    { id: 'bold', name: 'Bold', alpha: 0.22 },
  ],

  _read(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } },

  pattern() { return this.PATTERNS.find(p => p.id === this._read(this.PATTERN_KEY, 'none')) || this.PATTERNS[0]; },
  shape() { return this.SHAPES.find(s => s.id === this._read(this.SHAPE_KEY, 'soft')) || this.SHAPES[0]; },
  glow() { return this.GLOWS.find(g => g.id === this._read(this.GLOW_KEY, 'normal')) || this.GLOWS[0]; },
  strength() { return this.STRENGTHS.find(s => s.id === this._read(this.STRENGTH_KEY, 'soft')) || this.STRENGTHS[1]; },

  isDefault() {
    return this.pattern().id === 'none' && this.shape().id === 'soft' && this.glow().id === 'normal';
  },

  // The tile, as a data URI, drawn in the colour given. Patterns are stored
  // with %c where the colour goes so one definition covers every theme.
  tile(pattern, colour) {
    if (!pattern || !pattern.svg) return '';
    const size = pattern.size || 16;
    const body = pattern.svg.split('%c').join(colour);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
    return "url('data:image/svg+xml," + encodeURIComponent(svg) + "')";
  },

  set(kind, id) {
    const map = { pattern: [this.PATTERN_KEY, this.PATTERNS], shape: [this.SHAPE_KEY, this.SHAPES], glow: [this.GLOW_KEY, this.GLOWS], strength: [this.STRENGTH_KEY, this.STRENGTHS] };
    const entry = map[kind];
    if (!entry) throw new Error('A skin is a pattern, a shape, a glow or a strength');
    const found = entry[1].find(x => x.id === id);
    if (!found) throw new Error('There is no ' + kind + ' called "' + id + '"');
    try { localStorage.setItem(entry[0], id); } catch (err) { console.warn('[skins] could not remember it:', err && err.message); }
    this.apply();
    return found;
  },

  reset() {
    for (const k of [this.PATTERN_KEY, this.SHAPE_KEY, this.GLOW_KEY, this.STRENGTH_KEY]) {
      try { localStorage.removeItem(k); } catch { /* applied anyway */ }
    }
    this.apply();
  },

  apply() {
    if (typeof document === 'undefined') return null;
    const root = document.documentElement;
    const pattern = this.pattern();
    const shape = this.shape();
    const glow = this.glow();
    const strength = this.strength();

    // The pattern is drawn in the theme's own text colour at a low alpha, so
    // it reads as texture in the surface rather than as a second colour —
    // and follows the theme without a second set of definitions.
    const ink = getComputedStyle(root).getPropertyValue('--text').trim() || '#888';
    root.style.setProperty('--vex-skin-tile', pattern.svg ? this.tile(pattern, ink) : 'none');
    root.style.setProperty('--vex-skin-alpha', String(strength.alpha));
    root.style.setProperty('--vex-skin-size', (pattern.size || 16) + 'px');
    root.style.setProperty('--vex-skin-radius', shape.vars.radius);
    root.style.setProperty('--vex-skin-radius-lg', shape.vars.radiusLg);
    root.style.setProperty('--vex-skin-border', shape.vars.border);
    root.style.setProperty('--vex-skin-pad', shape.vars.pad);

    root.toggleAttribute('data-skin-noise', !!pattern.noise);
    if (pattern.id === 'none') root.removeAttribute('data-skin-pattern');
    else root.setAttribute('data-skin-pattern', pattern.id);
    if (shape.id === 'soft') root.removeAttribute('data-skin-shape');
    else root.setAttribute('data-skin-shape', shape.id);
    if (glow.id === 'normal') root.removeAttribute('data-skin-glow');
    else root.setAttribute('data-skin-glow', glow.id);

    document.dispatchEvent(new CustomEvent('vex:skin-changed', { detail: { pattern: pattern.id, shape: shape.id, glow: glow.id } }));
    return { pattern: pattern.id, shape: shape.id, glow: glow.id, strength: strength.id };
  },


  // ---- Picking one --------------------------------------------------------
  //
  // Every tile is drawn with the thing it offers: the pattern swatches carry
  // the real pattern at the real strength, the shape swatches show their own
  // corners, the light swatches cast their own shadow. A list of names would
  // make you try all twenty to find out what they are.

  open() {
    if (typeof document === 'undefined') return null;
    this.close();
    const el = document.createElement('div');
    el.className = 'vexskin-backdrop';
    el.innerHTML = `
      <div class="vexskin" role="dialog" aria-modal="true" aria-label="Skin">
        <div class="vexskin-head">
          <div style="flex:1">
            <h2>Skin</h2>
            <p>What Vex is made of, on top of whatever theme and look you are using: a texture on its own surfaces, the shape of its corners, and how it catches the light. Web pages are never touched.</p>
          </div>
          <button class="vexskin-close" aria-label="Close">&times;</button>
        </div>
        <div class="vexskin-body" id="vexskin-body"></div>
        <div class="vexskin-foot">
          <button data-reset type="button">Plain again</button>
          <span id="vexskin-now"></span>
        </div>
      </div>`;
    document.body.appendChild(el);
    this._el = el;
    el.querySelector('.vexskin-close').addEventListener('click', () => this.close());
    el.querySelector('[data-reset]').addEventListener('click', () => { this.reset(); this._draw(); });
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
    this._onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    window.addEventListener('keydown', this._onKey, true);
    this._draw();
    return el;
  },

  close() {
    if (this._onKey) { window.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    if (this._el) { this._el.remove(); this._el = null; }
  },

  _draw() {
    const el = this._el;
    if (!el) return;
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v)) : String(v));
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#888';
    const now = { pattern: this.pattern().id, shape: this.shape().id, glow: this.glow().id, strength: this.strength().id };
    const alpha = this.strength().alpha;

    const patternTiles = this.PATTERNS.map(p => {
      const bg = p.svg
        ? `background-image:${this.tile(p, ink)};background-size:${p.size || 16}px ${p.size || 16}px;opacity:${Math.min(1, alpha * 6 + 0.25)}`
        : (p.noise ? 'background-image:linear-gradient(0deg,var(--surface),var(--surface));opacity:.5' : '');
      return `
        <button class="vexskin-one${p.id === now.pattern ? ' on' : ''}" data-set="pattern" data-id="${esc(p.id)}">
          <span class="vexskin-swatch" style="${bg}"></span>
          <span class="vexskin-label"><span class="vexskin-name">${esc(p.name)}</span><span class="vexskin-note">${esc(p.note)}</span></span>
        </button>`;
    }).join('');

    const shapeTiles = this.SHAPES.map(sh => `
      <button class="vexskin-one${sh.id === now.shape ? ' on' : ''}" data-set="shape" data-id="${esc(sh.id)}">
        <span class="vexskin-swatch" style="display:flex;align-items:center;justify-content:center;gap:6px">
          <span style="width:26px;height:18px;border:${sh.vars.border} solid var(--text-muted);border-radius:${sh.vars.radius}"></span>
          <span style="width:18px;height:18px;border:${sh.vars.border} solid var(--text-muted);border-radius:${sh.id === 'round' ? '999px' : sh.vars.radius}"></span>
        </span>
        <span class="vexskin-label"><span class="vexskin-name">${esc(sh.name)}</span><span class="vexskin-note">${esc(sh.note)}</span></span>
      </button>`).join('');

    const glowShadow = { normal: '0 6px 18px rgba(0,0,0,.28)', flat: 'none', lift: '0 10px 26px rgba(0,0,0,.45)', halo: '0 0 0 1px var(--primary), 0 0 18px var(--vex-accent-glow, rgba(99,102,241,.5))' };
    const glowTiles = this.GLOWS.map(g => `
      <button class="vexskin-one${g.id === now.glow ? ' on' : ''}" data-set="glow" data-id="${esc(g.id)}">
        <span class="vexskin-swatch" style="display:flex;align-items:center;justify-content:center">
          <span style="width:46px;height:22px;border-radius:7px;background:var(--bg);border:1px solid var(--border);box-shadow:${glowShadow[g.id]}"></span>
        </span>
        <span class="vexskin-label"><span class="vexskin-name">${esc(g.name)}</span><span class="vexskin-note">${esc(g.note)}</span></span>
      </button>`).join('');

    const strengthTiles = this.STRENGTHS.map(st => `
      <button class="vexskin-one${st.id === now.strength ? ' on' : ''}" data-set="strength" data-id="${esc(st.id)}">
        <span class="vexskin-label" style="padding:9px 10px"><span class="vexskin-name">${esc(st.name)}</span><span class="vexskin-note">${Math.round(st.alpha * 100)}% of the ink</span></span>
      </button>`).join('');

    el.querySelector('#vexskin-body').innerHTML = `
      <div class="vexskin-kind">Texture<span>Drawn on Vex's own surfaces in the theme's ink, so it follows whatever colours you pick.</span></div>
      <div class="vexskin-grid">${patternTiles}</div>
      <div class="vexskin-kind">How strong<span>A texture you can read through is the point.</span></div>
      <div class="vexskin-grid">${strengthTiles}</div>
      <div class="vexskin-kind">Shape<span>Corners, borders and how much air sits between things.</span></div>
      <div class="vexskin-grid">${shapeTiles}</div>
      <div class="vexskin-kind">Light<span>What Vex's panels do above the page.</span></div>
      <div class="vexskin-grid">${glowTiles}</div>`;

    el.querySelector('#vexskin-now').textContent =
      `Now: ${this.pattern().name.toLowerCase()} texture, ${this.shape().name.toLowerCase()} shape, ${this.glow().name.toLowerCase()} light.`;

    el.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => {
      try { this.set(b.dataset.set, b.dataset.id); }
      catch (err) { window.showToast?.((err && err.message) || 'That did not work', 'error'); }
      this._draw();
    }));
  },

  // A pattern is drawn in the theme's ink, so a new theme needs a redraw.
  init() {
    this.apply();
    document.addEventListener('theme-changed', () => this.apply());
    return true;
  },
};

if (typeof window !== 'undefined') window.VexSkins = VexSkins;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSkins };
