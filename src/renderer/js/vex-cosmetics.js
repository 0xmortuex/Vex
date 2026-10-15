// === Profile frames, banners and backgrounds ===============================
//
// Things to put on the profile page, unlocked by medals and levels
// (js/vex-unlock.js) and drawn as plain SVG: no images, no emoji, no network.
//
//   VexCosmetics.KINDS                 ['frame', 'banner', 'background']
//   VexCosmetics.list(kind)            [{ id, kind, name, desc, unlock, owned, equipped, how }]
//   VexCosmetics.owned(kind)           ids owned, in catalog order
//   VexCosmetics.equipped()            { frame, banner, background } ids
//   VexCosmetics.equip(kind, id)       throws if it is not owned; true on success
//   VexCosmetics.svg(kind, id, opts)   markup: frame { size }, banner/background { width, height }
//   VexCosmetics.renderAvatar(html, { size })  wraps an avatar in the equipped frame
//
// Event: `vex:cosmetics-changed` {kind, id} on document, for a profile page to
// redraw. Storage: localStorage `vex.cosmetics` ({ equipped: {kind: id} });
// what is owned is kept by VexUnlock. Per device: nothing leaves this computer.
//
// Principles: optional (nothing is equipped until chosen, the plain defaults
// are free), no loss (owned items never go back), no nagging (no toast or
// badge on an unlock), and still pictures: nothing here animates.
const VexCosmetics = {
  KEY: 'vex.cosmetics',
  KINDS: ['frame', 'banner', 'background'],
  KIND_NAMES: { frame: 'Frames', banner: 'Banners', background: 'Backgrounds' },

  // --- the catalog ----------------------------------------------------------
  // draw(opts) returns the inside of an <svg> for the item's own viewBox:
  // frame 96x96 (drawn over the avatar), banner 600x160, background 120x120
  // (a tile; a gradient field for the plain ones).
  CATALOG: [
    // Frames
    { kind: 'frame', id: 'ring-plain', name: 'Plain ring', desc: 'A thin ring in your accent colour.', unlock: { free: true },
      draw: () => '<circle cx="48" cy="48" r="45" fill="none" stroke="var(--vex-accent, #6d5dfc)" stroke-width="3"/>' },
    { kind: 'frame', id: 'ring-double', name: 'Double ring', desc: 'Two rings, one inside the other.', unlock: { level: 2 },
      draw: () => '<circle cx="48" cy="48" r="45" fill="none" stroke="var(--vex-accent, #6d5dfc)" stroke-width="3"/><circle cx="48" cy="48" r="39" fill="none" stroke="var(--vex-accent, #6d5dfc)" stroke-opacity=".5" stroke-width="1.5"/>' },
    { kind: 'frame', id: 'ring-dashed', name: 'Stitched', desc: 'A dashed ring, like a seam.', unlock: { level: 4 },
      draw: () => '<circle cx="48" cy="48" r="44" fill="none" stroke="var(--vex-accent, #6d5dfc)" stroke-width="3.5" stroke-dasharray="7 5" stroke-linecap="round"/>' },
    { kind: 'frame', id: 'ring-laurel', name: 'Laurel', desc: 'Two leafy branches around you.', unlock: { medal: 'first-focus' },
      draw: () => {
        let s = '<circle cx="48" cy="48" r="45" fill="none" stroke="#c9a227" stroke-width="2"/>';
        for (let i = 0; i < 7; i++) {
          const a = (200 + i * 20) * Math.PI / 180, b = (340 - i * 20) * Math.PI / 180;
          const p = (t) => [Math.round((48 + 45 * Math.cos(t)) * 10) / 10, Math.round((48 + 45 * Math.sin(t)) * 10) / 10];
          const [x1, y1] = p(a), [x2, y2] = p(b);
          s += `<ellipse cx="${x1}" cy="${y1}" rx="5.5" ry="2.6" fill="#7fb069" transform="rotate(${200 + i * 20 + 90} ${x1} ${y1})"/>`;
          s += `<ellipse cx="${x2}" cy="${y2}" rx="5.5" ry="2.6" fill="#7fb069" transform="rotate(${340 - i * 20 + 90} ${x2} ${y2})"/>`;
        }
        return s;
      } },
    { kind: 'frame', id: 'ring-hex', name: 'Hexagon', desc: 'Six straight sides.', unlock: { level: 8 },
      draw: () => '<polygon points="48,3 87,25.5 87,70.5 48,93 9,70.5 9,25.5" fill="none" stroke="var(--vex-accent, #6d5dfc)" stroke-width="3.5" stroke-linejoin="round"/>' },
    { kind: 'frame', id: 'ring-orbit', name: 'Orbit', desc: 'A ring with a small moon going round it.', unlock: { medal: 'explorer' },
      draw: () => '<circle cx="48" cy="48" r="44" fill="none" stroke="var(--vex-accent, #6d5dfc)" stroke-opacity=".55" stroke-width="2"/><circle cx="82" cy="20" r="6" fill="var(--vex-accent, #6d5dfc)"/>' },

    // Banners
    { kind: 'banner', id: 'dawn', name: 'Dawn', desc: 'Soft orange into pink.', unlock: { free: true },
      draw: () => '<defs><linearGradient id="vcb-dawn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb36b"/><stop offset="1" stop-color="#ff6b9a"/></linearGradient></defs><rect width="600" height="160" fill="url(#vcb-dawn)"/><circle cx="470" cy="150" r="70" fill="#fff" fill-opacity=".25"/>' },
    { kind: 'banner', id: 'dusk', name: 'Dusk', desc: 'Violet into deep blue.', unlock: { level: 2 },
      draw: () => '<defs><linearGradient id="vcb-dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d5dfc"/><stop offset="1" stop-color="#1b1464"/></linearGradient></defs><rect width="600" height="160" fill="url(#vcb-dusk)"/><circle cx="90" cy="38" r="3" fill="#fff"/><circle cx="210" cy="24" r="2" fill="#fff"/><circle cx="330" cy="50" r="2.5" fill="#fff"/><circle cx="520" cy="30" r="3" fill="#fff"/>' },
    { kind: 'banner', id: 'waves', name: 'Waves', desc: 'Three slow waves.', unlock: { level: 3 },
      draw: () => '<rect width="600" height="160" fill="#0e3a5f"/><path d="M0 100c60-30 120-30 180 0s120 30 180 0 120-30 180 0 60 20 60 20v40H0Z" fill="#1d6fa5"/><path d="M0 125c60-26 120-26 180 0s120 26 180 0 120-26 180 0 60 18 60 18v17H0Z" fill="#4cc9f0" fill-opacity=".8"/>' },
    { kind: 'banner', id: 'peaks', name: 'Peaks', desc: 'A row of mountains.', unlock: { level: 5 },
      draw: () => '<rect width="600" height="160" fill="#a0c4ff"/><path d="M0 160 90 60l60 60 70-90 90 130 80-80 90 80 70-50 50 50v40H0Z" fill="#3a86ff"/><path d="M0 160l110-50 70 50 90-70 120 70 100-40 110 40z" fill="#264a99"/>' },
    { kind: 'banner', id: 'grid', name: 'Command grid', desc: 'A quiet grid with one bright cell.', unlock: { medal: 'command-bar-pro' },
      draw: () => {
        let s = '<rect width="600" height="160" fill="#14161c"/>';
        for (let x = 0; x <= 600; x += 40) s += `<line x1="${x}" y1="0" x2="${x}" y2="160" stroke="#2c3240" stroke-width="1"/>`;
        for (let y = 0; y <= 160; y += 40) s += `<line x1="0" y1="${y}" x2="600" y2="${y}" stroke="#2c3240" stroke-width="1"/>`;
        return s + '<rect x="320" y="40" width="40" height="40" fill="var(--vex-accent, #6d5dfc)"/>';
      } },
    { kind: 'banner', id: 'aurora', name: 'Aurora', desc: 'Green and violet ribbons of light.', unlock: { level: 12 },
      draw: () => '<defs><linearGradient id="vcb-au" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#34c38f"/><stop offset=".5" stop-color="#38bdf8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs><rect width="600" height="160" fill="#0b1020"/><path d="M0 90c100-70 200 30 300-30s200 20 300-30v80c-100 50-200-30-300 20S100 130 0 150Z" fill="url(#vcb-au)" fill-opacity=".75"/>' },

    // Backgrounds (tiles)
    { kind: 'background', id: 'plain', name: 'Plain', desc: 'No pattern: the theme colour.', unlock: { free: true },
      draw: () => '<rect width="120" height="120" fill="var(--vex-bg-base, #14161c)"/>' },
    { kind: 'background', id: 'dots', name: 'Dots', desc: 'A grid of small dots.', unlock: { level: 2 },
      draw: () => '<rect width="120" height="120" fill="var(--vex-bg-base, #14161c)"/>' + [20, 60, 100].map(x => [20, 60, 100].map(y => `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--vex-accent, #6d5dfc)" fill-opacity=".45"/>`).join('')).join('') },
    { kind: 'background', id: 'lines', name: 'Ruled', desc: 'Faint horizontal rules, like a notebook.', unlock: { medal: 'tab-whisperer' },
      draw: () => '<rect width="120" height="120" fill="var(--vex-bg-base, #14161c)"/>' + [30, 60, 90].map(y => `<line x1="0" y1="${y}" x2="120" y2="${y}" stroke="var(--vex-accent, #6d5dfc)" stroke-opacity=".25" stroke-width="1.5"/>`).join('') },
    { kind: 'background', id: 'hex', name: 'Honeycomb', desc: 'Hexagons, edge to edge.', unlock: { level: 6 },
      draw: () => '<rect width="120" height="120" fill="var(--vex-bg-base, #14161c)"/><path d="M30 10l26 15v30L30 70 4 55V25ZM86 10l26 15v30L86 70 60 55V25ZM58 60l26 15v30L58 120 32 105V75Z" fill="none" stroke="var(--vex-accent, #6d5dfc)" stroke-opacity=".35" stroke-width="2"/>' },
    { kind: 'background', id: 'stars', name: 'Constellation', desc: 'A few stars joined by thin lines.', unlock: { medal: 'night-owl' },
      draw: () => '<rect width="120" height="120" fill="#0b1020"/><polyline points="14,20 52,38 88,16 104,70 60,96" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1"/>' + [[14, 20], [52, 38], [88, 16], [104, 70], [60, 96]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#fff"/>`).join('') },
    { kind: 'background', id: 'paper', name: 'Clear desk', desc: 'Warm paper with one fold.', unlock: { medal: 'inbox-zero' },
      draw: () => '<rect width="120" height="120" fill="#f4ecd8"/><path d="M0 0 120 120" stroke="#d9cdb0" stroke-width="2"/><path d="M0 0H120V120Z" fill="#fff" fill-opacity=".25"/>' },
  ],

  // --- state ----------------------------------------------------------------
  _state() {
    let v;
    try { v = JSON.parse(localStorage.getItem(this.KEY) || 'null'); }
    catch (err) { throw new Error('Could not read the equipped items: ' + err.message, { cause: err }); }
    const eq = v && typeof v === 'object' && v.equipped && typeof v.equipped === 'object' ? v.equipped : {};
    return { equipped: eq };
  },

  _find(kind, id) { return this.CATALOG.find(c => c.kind === kind && c.id === id) || null; },

  _unlock() {
    if (typeof VexUnlock === 'undefined') throw new Error('The unlock rules are not loaded');
    return VexUnlock;
  },

  owned(kind) {
    if (!this.KINDS.includes(kind)) throw new Error('Unknown kind: ' + kind);
    const items = this.CATALOG.filter(c => c.kind === kind);
    const ids = new Set(this._unlock().settle('cosmetic-' + kind, items));
    return items.filter(i => ids.has(i.id)).map(i => i.id);
  },

  equipped() {
    const eq = this._state().equipped;
    const out = {};
    for (const k of this.KINDS) {
      const id = eq[k];
      // What is equipped must still be owned and in the catalog.
      out[k] = id && this._find(k, id) && this.owned(k).includes(id) ? id : null;
    }
    return out;
  },

  list(kind) {
    if (!this.KINDS.includes(kind)) throw new Error('Unknown kind: ' + kind);
    const own = new Set(this.owned(kind));
    const cur = this.equipped()[kind];
    return this.CATALOG.filter(c => c.kind === kind).map(c => ({
      id: c.id, kind: c.kind, name: c.name, desc: c.desc, unlock: c.unlock,
      owned: own.has(c.id), equipped: cur === c.id,
      how: own.has(c.id) ? '' : this._unlock().describe(c.unlock),
    }));
  },

  equip(kind, id) {
    if (!this.KINDS.includes(kind)) throw new Error('Unknown kind: ' + kind);
    // null/'' takes it off: the profile page shows no frame, banner or pattern.
    if (id === null || id === '') {
      const st = this._state();
      delete st.equipped[kind];
      this._write(st);
      this._emit(kind, null);
      return true;
    }
    if (!this._find(kind, id)) throw new Error('No ' + kind + ' called ' + id);
    if (!this.owned(kind).includes(id)) throw new Error('That ' + kind + ' is not unlocked yet');
    const st = this._state();
    st.equipped[kind] = id;
    this._write(st);
    this._emit(kind, id);
    return true;
  },

  _write(st) {
    try { localStorage.setItem(this.KEY, JSON.stringify(st)); }
    catch (err) { throw new Error('Could not save the choice: ' + err.message, { cause: err }); }
  },

  _emit(kind, id) {
    try { document.dispatchEvent(new CustomEvent('vex:cosmetics-changed', { detail: { kind, id } })); }
    catch { /* no document */ }
  },

  // --- drawing --------------------------------------------------------------
  _esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  // Gradient ids inside an item are fixed per item, so two copies of the same
  // banner on one page share a definition: harmless (identical).
  svg(kind, id, opts) {
    const item = this._find(kind, id);
    if (!item) throw new Error('No ' + kind + ' called ' + id);
    const o = opts || {};
    const label = this._esc(item.name + ' ' + kind);
    if (kind === 'frame') {
      const s = Number(o.size) > 0 ? Number(o.size) : 96;
      return `<svg xmlns="http://www.w3.org/2000/svg" class="vex-cosmetic vex-frame" width="${s}" height="${s}" viewBox="0 0 96 96" role="img" aria-label="${label}"><title>${label}</title>${item.draw()}</svg>`;
    }
    if (kind === 'banner') {
      const w = Number(o.width) > 0 ? Number(o.width) : 600, h = Number(o.height) > 0 ? Number(o.height) : 160;
      return `<svg xmlns="http://www.w3.org/2000/svg" class="vex-cosmetic vex-banner" width="${w}" height="${h}" viewBox="0 0 600 160" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label}"><title>${label}</title>${item.draw()}</svg>`;
    }
    const w = Number(o.width) > 0 ? Number(o.width) : 240, h = Number(o.height) > 0 ? Number(o.height) : 160;
    const pid = 'vcbg-' + item.id;
    return `<svg xmlns="http://www.w3.org/2000/svg" class="vex-cosmetic vex-background" width="${w}" height="${h}" role="img" aria-label="${label}"><title>${label}</title><defs><pattern id="${pid}" width="120" height="120" patternUnits="userSpaceOnUse">${item.draw()}</pattern></defs><rect width="100%" height="100%" fill="url(#${pid})"/></svg>`;
  },

  // `avatarHtml` (from VexMedals.avatarSvg) with the equipped frame laid over.
  // With no frame equipped the avatar is returned as it came.
  renderAvatar(avatarHtml, opts) {
    const size = (opts && Number(opts.size) > 0) ? Number(opts.size) : 96;
    const f = this.equipped().frame;
    if (!f) return avatarHtml;
    return `<span class="vex-framed" style="position:relative;display:inline-block;width:${size}px;height:${size}px;line-height:0">${avatarHtml}<span style="position:absolute;inset:0;pointer-events:none">${this.svg('frame', f, { size })}</span></span>`;
  },

  // For the medals work: every medal id the catalog names.
  referencedMedals() { return this._unlock().referenced(this.CATALOG.map(c => c.unlock)); },
};

if (typeof window !== 'undefined') window.VexCosmetics = VexCosmetics;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCosmetics };
