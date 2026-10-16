// === Keyboard link hints and tab hints (T3-113) ================================
//
// Link hints (Ctrl+Alt+I, or Ctrl+K "Hints: click with the keyboard"): every link,
// button and field you can see gets a short yellow label. Type it and it is
// clicked (a field is focused). Shift with the last letter opens a link in a
// background tab; Backspace takes a letter back; Escape, a click or scrolling puts
// the labels away. The labels are drawn by the page's preload
// (preload-webview.js "Keyboard link hints").
//
// Tab hints (Ctrl+Alt+Q, or Ctrl+K "Hints: go to a tab"): the same, for the tabs on
// the strip.
//
// How it coexists with the page's own keys: nothing here listens for a key of its
// own. The start is a Vex shortcut (a Ctrl+Alt combination, which main hands to the
// window even from inside a page, main/guest-shortcuts.js "wanted"), so a page
// keeps every plain key and every Ctrl key it has. Once the labels are up the typed
// letters are taken from the page on purpose, and only while they are up.
const VexLinkHints = {
  KEY: 'vex.keyboardHints',   // not vex.linkHints: that older key holds the string 'off' for the press-f hints in the page (webview.js)
  DEFAULTS: { on: true },
  ALPHA: 'sadfjklewcmpgh',
  _tab: null,   // { layer, items, typed, off }

  enabled() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return this.DEFAULTS.on;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[LinkHints] the saved choice is damaged and starts again:', err); return this.DEFAULTS.on; }
    return !!(v && typeof v === 'object' && typeof v.on === 'boolean' ? v.on : this.DEFAULTS.on);
  },
  setEnabled(on) {
    localStorage.setItem(this.KEY, JSON.stringify({ on: !!on }));
    if (!on) this.stopTabs();
  },

  // The labels for n things: one letter each while they fit, else two letters each
  // (so no label is the start of another).
  labels(n) {
    const a = this.ALPHA;
    const out = [];
    if (n <= a.length) { for (let i = 0; i < n; i++) out.push(a[i]); return out; }
    const max = a.length * a.length;
    if (n > max) throw new Error('At most ' + max + ' things can be labelled');
    for (let i = 0; i < a.length && out.length < n; i++) for (let j = 0; j < a.length && out.length < n; j++) out.push(a[i] + a[j]);
    return out;
  },

  // ---- link hints (in the page) ---------------------------------------------------------
  startLinks() {
    if (!this.enabled()) throw new Error('Keyboard hints are switched off in Settings');
    this.stopTabs();
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    if (!wv || !wv._attached) throw new Error('There is no page in front to label');
    wv.send('vex-hints', 'start');
    // The labels take their letters from the page, so the page must have the focus.
    if (typeof wv.focus === 'function') wv.focus();
  },

  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', (e) => {
      if (e.channel !== 'vex-hint-tab' && e.channel !== 'vex-hints-none') return;
      if (!this.enabled()) return;
      // Only from the page in front: a page in the background cannot open tabs.
      if (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview() !== webview) return;
      if (e.channel === 'vex-hints-none') { window.showToast?.('Nothing here to click with the keyboard', 'info'); return; }
      try { this.openInBackground(e.args && e.args[0]); }
      catch (err) { window.showToast?.('The link could not be opened: ' + ((err && err.message) || err), 'error'); }
    });
  },

  // The address came from a page: a plain web address only.
  openInBackground(href) {
    if (typeof href !== 'string' || href.length > 4096) throw new Error('not an address Vex can open');
    let u;
    try { u = new URL(href); } catch { throw new Error('not an address Vex can open'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('only web links open in a tab');
    const here = TabManager.getActiveTab();
    TabManager.createTab(u.href, false, here && here.groupId, here && here.partition ? { partition: here.partition } : null);
    window.showToast?.('Opened in a background tab');
  },

  // ---- tab hints (on the strip) ---------------------------------------------------------
  tabsOn() { return !!this._tab; },

  startTabs() {
    if (!this.enabled()) throw new Error('Keyboard hints are switched off in Settings');
    this.stopTabs();
    const shown = TabManager.shownOrder().slice(0, this.ALPHA.length * this.ALPHA.length);
    const pairs = shown.map(t => ({ tab: t, el: document.querySelector('.top-tab[data-tab-id="' + t.id + '"], .tab-item[data-tab-id="' + t.id + '"], .pinned-tab[data-tab-id="' + t.id + '"]') }))
      .filter(p => p.el && p.el.getClientRects().length);
    if (!pairs.length) throw new Error('No tabs are showing to label');
    const labels = this.labels(pairs.length);
    const layer = document.createElement('div');
    layer.className = 'lh-layer';
    layer.setAttribute('role', 'status');
    layer.setAttribute('aria-live', 'polite');
    const items = pairs.map((p, i) => {
      const r = p.el.getBoundingClientRect();
      const chip = document.createElement('span');
      chip.className = 'lh-chip';
      chip.style.left = Math.max(0, Math.round(r.left)) + 'px';
      chip.style.top = Math.max(0, Math.round(r.top)) + 'px';
      const typed = document.createElement('b');
      const rest = document.createElement('span');
      rest.textContent = labels[i];
      chip.append(typed, rest);
      layer.appendChild(chip);
      return { tab: p.tab, label: labels[i], chip };
    });
    document.body.appendChild(layer);
    // The letters are typed in Vex's own window, not into the page that had the focus.
    if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    const off = [];
    const onKey = (e) => this._tabKey(e);
    const onDown = () => this.stopTabs();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onDown);
    off.push(() => document.removeEventListener('keydown', onKey, true), () => document.removeEventListener('mousedown', onDown, true), () => window.removeEventListener('blur', onDown));
    this._tab = { layer, items, typed: '', off };
  },

  stopTabs() {
    const t = this._tab;
    if (!t) return;
    this._tab = null;
    for (const f of t.off) f();
    t.layer.remove();
  },

  _paintTabs() {
    const t = this._tab;
    for (const it of t.items) {
      const on = it.label.startsWith(t.typed);
      it.chip.style.display = on ? '' : 'none';
      it.chip.firstChild.textContent = t.typed;
      it.chip.lastChild.textContent = it.label.slice(t.typed.length);
    }
  },

  _tabKey(e) {
    const t = this._tab;
    if (!t) return;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { this.stopTabs(); return; }
    if (e.key === 'Backspace') { t.typed = t.typed.slice(0, -1); this._paintTabs(); return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : '';
    if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
    const next = t.typed + k;
    const matches = t.items.filter(it => it.label.startsWith(next));
    if (!matches.length) return;
    t.typed = next;
    if (matches.length > 1) { this._paintTabs(); return; }
    const hit = matches[0];
    this.stopTabs();
    TabManager.switchTab(hit.tab.id);
  },

  init() {
    if (typeof VexExtras === 'undefined' || typeof VexExtras.registerCommand !== 'function') return;
    const run = (fn) => () => { try { fn(); } catch (err) { window.showToast?.(err.message, 'error'); } };
    VexExtras.registerCommand({ id: 'link-hints', label: 'Hints: click with the keyboard', hint: 'Label every link, button and field in view; type a label to use it (Ctrl+Alt+I)', icon: 'keyboard', action: run(() => this.startLinks()) });
    VexExtras.registerCommand({ id: 'tab-hints', label: 'Hints: go to a tab', hint: 'Label the tabs on the strip; type a label to go there (Ctrl+Alt+Q)', icon: 'tabs', action: run(() => this.startTabs()) });
  },
};

if (typeof window !== 'undefined') window.VexLinkHints = VexLinkHints;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLinkHints };
