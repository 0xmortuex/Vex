// === Hold the tab widths while you close tabs with X (T3-081) ==================
//
// The tabs stretch to fill the strip, so closing one makes every other tab wider
// and the next X is no longer under the pointer: closing three tabs in a row meant
// chasing the cross, and sometimes closing the wrong tab. As in Chrome, the tabs
// keep the width they had for as long as the pointer stays over the tab bar after
// a close: the tabs after the closed one slide left by exactly one tab's width,
// so the next X lands where the last one was. Leaving the bar (or opening, moving
// or restoring a tab, or resizing the window) lets the strip fill the bar again.
//
// Only widths are touched, and only as inline styles on the tabs and group chips
// that are already there. Nothing is added to the strip, so its height and the
// space above and beside the tabs are what each look makes them (measured by
// tests/renderer/tabHold.test.js: heights and tops of every child before and
// after). Held widths are never written to storage.
const VexTabHold = {
  KEY: 'vex.tabHold',
  DEFAULTS: { on: true },
  // The same cut-offs as HorizontalTabs.applyTabSizeClasses.
  NARROW: 80,
  VERY_NARROW: 56,

  _held: null,     // Map<key, width in px>, or null when nothing is held
  _list: null,

  enabled() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return this.DEFAULTS.on;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[TabHold] the saved choice is damaged and starts again:', err); return this.DEFAULTS.on; }
    return !!(v && typeof v === 'object' && typeof v.on === 'boolean' ? v.on : this.DEFAULTS.on);
  },
  setEnabled(on) {
    localStorage.setItem(this.KEY, JSON.stringify({ on: !!on }));
    if (!on) this.release();
  },

  // What names an element of the strip across a re-render: a tab by its id, a stack by its id, a
  // group chip by its name. Pinned tabs and anything else are left alone.
  keyOf(el) {
    if (!el || !el.classList) return null;
    if (el.classList.contains('top-group-label')) return 'g:' + el.textContent;
    if (el.dataset && el.dataset.stackId) return 's:' + el.dataset.stackId;
    if (el.classList.contains('top-tab') && el.dataset && el.dataset.tabId) return el.classList.contains('pinned') ? null : 't:' + el.dataset.tabId;
    return null;
  },

  // Called as a tab is closed with its X (or a middle click), before anything is removed.
  beforeClose(list) {
    if (!this.enabled() || !list) return;
    // Already holding: the widths from the first close stay, so a run of closes keeps one layout.
    if (this._held) return;
    const held = new Map();
    for (const el of list.children) {
      const key = this.keyOf(el);
      if (!key) continue;
      const w = el.getBoundingClientRect().width;
      if (w > 0) held.set(key, Math.round(w * 100) / 100);
    }
    if (held.size < 2) return;
    this._held = held;
    this._list = list;
  },

  // After the strip is drawn: put the held widths on what is there. A tab that was not there when the
  // widths were taken (one opened, or one brought back by Undo) ends the hold.
  apply() {
    if (!this._held || !this._list) return;
    const list = this._list;
    if (!list.isConnected) { this.release(); return; }
    const els = [...list.children].filter(el => this.keyOf(el));
    if (els.some(el => !this._held.has(this.keyOf(el)))) { this.release(); return; }
    for (const el of els) {
      const w = this._held.get(this.keyOf(el)) + 'px';
      el.style.setProperty('flex', '0 0 ' + w, 'important');
      el.style.setProperty('width', w, 'important');
      el.style.setProperty('min-width', '0', 'important');
      el.style.setProperty('max-width', w, 'important');
      el.dataset.held = '1';
    }
    this.applyClasses();
  },

  // The narrow cut-offs follow the width a tab is held at, not the share an emptier strip would give it.
  applyClasses() {
    if (!this._held || !this._list) return;
    for (const el of this._list.children) {
      const key = this.keyOf(el);
      if (!key || !key.startsWith('t:') || !this._held.has(key)) continue;
      const w = this._held.get(key);
      el.classList.toggle('narrow', w < this.NARROW);
      el.classList.toggle('very-narrow', w < this.VERY_NARROW);
    }
  },

  held() { return !!this._held; },

  release() {
    const list = this._list;
    this._held = null;
    this._list = null;
    if (!list) return;
    for (const el of list.querySelectorAll('[data-held]')) {
      for (const p of ['flex', 'width', 'min-width', 'max-width']) el.style.removeProperty(p);
      delete el.dataset.held;
    }
    // The sizes the strip would give each tab now.
    if (typeof HorizontalTabs !== 'undefined' && typeof HorizontalTabs.applyTabSizeClasses === 'function') HorizontalTabs.applyTabSizeClasses();
  },

  init() {
    const bar = document.getElementById('top-tab-bar') || document.getElementById('top-tabs-list');
    if (!bar) throw new Error('The tab bar (#top-tab-bar) is not in the page');
    bar.addEventListener('mouseleave', () => this.release());
    window.addEventListener('resize', () => this.release());
    // A tab dragged to a new place is a rearrangement, not a close.
    bar.addEventListener('dragstart', () => this.release());
  },
};

if (typeof window !== 'undefined') window.VexTabHold = VexTabHold;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabHold };
