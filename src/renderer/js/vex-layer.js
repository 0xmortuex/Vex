// === One layer manager for overlays, and a sweep that proves clicks get through (T2-014) ====
//
// Overlays in Vex were each written with their own position:fixed and their own z-index
// (176 of them, a handful of values between 1 and 2147483646). Two recent bugs came from
// that: a panel left covering the tab strip, and a blurred screen with an invisible bar
// that swallowed the next click. This is the one place that knows which overlays are open.
//
//   VexLayer.open(el, { tier, id, onClose, dismissible })  appends el to the page at the tier's
//                                                          z-index and remembers it
//   VexLayer.track(el, { tier, id, close })                an overlay somebody else built: only
//                                                          remembered, its z-index is untouched
//   VexLayer.close(idOrEl) / closeTop() / closeAll()       close what is registered
//   VexLayer.list()                                        what is open, lowest first
//   VexLayer.sweep()                                       close everything, then look for a
//                                                          full-window element that would take
//                                                          clicks, and test that nine points of
//                                                          the window resolve to the page
//
// Tiers, lowest to highest: chrome (bars over the page), panel, dialog, menu, toast, system.
// Escape closes the top layer that was opened with dismissible:true (and was not already
// handled by the overlay itself). Pressing Escape twice within 700 ms closes them all. Ctrl+K >
// "Close all overlays" does too. Tracked overlays are closed by sweep() and closeAll() but never by
// Escape, because they already handle that key themselves.
//
// The sweep is the test-time part: scripts/check-ui.js calls it after every surface it opens, and
// it fails when a click would not reach the page. A full-window element is allowed only when it is
// pointer-events:none (the wind-down veil is) or is a registered open layer.
const VexLayer = {
  TIERS: { chrome: 1000, panel: 5000, dialog: 10000, menu: 20000, toast: 50000, system: 100000 },
  DOUBLE_ESC_MS: 700,
  // The window's own structure covers the window by design; a blocker is something else.
  STRUCTURE: '#app, #webviews-container, #content-area, #main-content, webview, iframe',
  _layers: [],        // { el, id, tier, close, dismissible, seq }
  _seq: 0,
  _escAt: 0,

  _check(tier) {
    if (!Object.hasOwn(this.TIERS, tier)) throw new Error('Unknown overlay tier "' + tier + '". Use ' + Object.keys(this.TIERS).join(', '));
  },
  _prune() { this._layers = this._layers.filter(l => l.el.isConnected); },

  open(el, { tier = 'dialog', id = '', onClose = null, dismissible = true } = {}) {
    if (!el || el.nodeType !== 1) throw new Error('VexLayer.open needs an element');
    this._check(tier);
    this._prune();
    el.style.position = 'fixed';
    el.style.zIndex = String(this.TIERS[tier] + this._layers.filter(l => l.tier === tier).length);
    document.body.appendChild(el);
    return this._add(el, { tier, id, dismissible, close: () => { el.remove(); if (typeof onClose === 'function') onClose(); } });
  },

  track(el, { tier = 'dialog', id = '', close = null } = {}) {
    if (!el || el.nodeType !== 1) throw new Error('VexLayer.track needs an element');
    this._check(tier);
    this._prune();
    if (this._layers.some(l => l.el === el)) return el;
    return this._add(el, { tier, id, dismissible: false, close: typeof close === 'function' ? close : () => el.remove() });
  },

  _add(el, rec) {
    this._layers.push({ el, id: rec.id || el.id || '', tier: rec.tier, close: rec.close, dismissible: rec.dismissible, seq: ++this._seq });
    return el;
  },

  list() {
    this._prune();
    return this._layers.slice().sort((a, b) => (this.TIERS[a.tier] - this.TIERS[b.tier]) || (a.seq - b.seq)).map(l => ({ id: l.id, tier: l.tier, dismissible: l.dismissible }));
  },

  close(target) {
    this._prune();
    const i = this._layers.findIndex(l => l.el === target || (l.id && l.id === target));
    if (i < 0) return false;
    const [l] = this._layers.splice(i, 1);
    l.close();
    return true;
  },

  closeTop() {
    this._prune();
    const open = this._layers.filter(l => l.dismissible).sort((a, b) => (this.TIERS[b.tier] - this.TIERS[a.tier]) || (b.seq - a.seq));
    if (!open.length) return false;
    return this.close(open[0].el);
  },

  closeAll() {
    this._prune();
    const all = this._layers.splice(0);
    const failed = [];
    for (const l of all.reverse()) {
      try { l.close(); } catch (err) { failed.push(l.id + ': ' + err.message); }
    }
    if (failed.length) throw new Error('Some overlays would not close: ' + failed.join('; '));
    return all.length;
  },

  // ---- the sweep ----------------------------------------------------------------------------
  // Elements that cover most of the window, are painted and take clicks. `layers` are exempt.
  blockers(root = document, win = window) {
    const out = [];
    const vw = win.innerWidth, vh = win.innerHeight;
    const registered = new Set(this._layers.map(l => l.el));
    for (const el of root.querySelectorAll('body *')) {
      const cs = win.getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      if (cs.pointerEvents === 'none' || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0 || (w * h) / (vw * vh) < 0.5) continue;
      if (el.matches(this.STRUCTURE) || el.closest(this.STRUCTURE) || el.querySelector('webview, iframe')) continue;
      if (registered.has(el) || [...registered].some(l => l.contains(el))) continue;
      out.push({ element: this.describe(el), zIndex: cs.zIndex, covers: Math.round((w * h) / (vw * vh) * 100) });
    }
    return out;
  },

  describe(el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList && el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '');
  },

  // Nine points across the window: whatever answers must not sit inside a blocker.
  hitTest(doc = document, win = window) {
    const vw = win.innerWidth, vh = win.innerHeight;
    const bad = [];
    for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.2, 0.5, 0.8]) {
      const x = Math.round(vw * fx), y = Math.round(vh * fy);
      const hit = doc.elementFromPoint(x, y);
      if (!hit) { bad.push({ x, y, hit: 'nothing' }); continue; }
      for (let n = hit; n && n !== doc.body; n = n.parentElement) {
        const cs = win.getComputedStyle(n);
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        if (n.matches(this.STRUCTURE)) continue;
        const r = n.getBoundingClientRect();
        if (r.width * r.height >= vw * vh * 0.5) { bad.push({ x, y, hit: this.describe(hit), under: this.describe(n) }); break; }
      }
    }
    return bad;
  },

  // Close everything registered, then judge. -> { closed, blockers[], blockedPoints[], ok }
  sweep() {
    const closed = this.closeAll();
    for (const o of document.querySelectorAll('.vex-dialog-overlay')) if (typeof o._vexCancel === 'function') o._vexCancel();
    const blockers = this.blockers();
    const blockedPoints = this.hitTest();
    return { closed, blockers, blockedPoints, ok: !blockers.length && !blockedPoints.length };
  },

  _onKey(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const now = Date.now();
    const double = now - this._escAt <= this.DOUBLE_ESC_MS;
    this._escAt = now;
    if (double) { if (this._layers.length) this.closeAll(); return; }
    if (this.closeTop()) e.preventDefault();
  },
};

if (typeof window !== 'undefined') {
  window.VexLayer = VexLayer;
  document.addEventListener('keydown', (e) => VexLayer._onKey(e));
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'close-overlays', label: 'Close all overlays', hint: 'Closes every open panel, dialog and menu Vex is tracking', icon: 'x', action: () => { VexLayer.closeAll(); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLayer };
