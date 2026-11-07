// === Caret browsing: move through a page's text with the arrow keys (F7) =======
//
// F7, or Ctrl+K "Caret Browsing", turns it on and off. Chrome shows a question before it turns on (a person who pressed F7 by
// accident would otherwise find the arrow keys not scrolling any more), and so does this.
//
// Chromium's own switch (--enable-caret-browsing) does nothing in this build: in a real <webview> the arrow keys left the caret
// where it was (probed 2026-11-07, Electron 42 castLabs), so the caret is Vex's own, drawn and moved by the page's preload
// (preload-webview.js "Caret browsing"): arrows move it through the text, Shift extends the selection, Ctrl moves by word or to the
// ends of the page, Enter follows a link. Text fields keep their keys, and so does a page that handles an arrow key itself.
//
// The choice is kept (vex.caretBrowsing) and every page, open now or opened later, is told when it is on. It starts off.
const VexCaretBrowsing = {
  KEY: 'vex.caretBrowsing',

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  enabled() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return false;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[CaretBrowsing] the saved choice is damaged and starts again (off):', err); return false; }
    return !!(v && typeof v === 'object' && v.on === true);
  },

  // Tell one page. A page that is still loading cannot be sent to yet: it is told when it is ready (attach).
  _tell(webview, on) {
    if (!webview || !webview._attached || typeof webview.send !== 'function') return;
    try { webview.send('vex-caret', on === true); }
    catch (err) {
      // Not ready yet is the one expected failure; the page is told again on its dom-ready. Anything else is real.
      if (!/dom-ready|attached/i.test(String(err && err.message))) throw err;
    }
  },

  _tellAll(on) {
    document.querySelectorAll('webview').forEach(wv => this._tell(wv, on));
  },

  _wired: new WeakSet(),
  attach(webview) {
    if (!webview || this._wired.has(webview)) return;
    this._wired.add(webview);
    const listen = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    // A navigation makes a new page with no caret: tell it again each time one is ready.
    listen('dom-ready', () => { if (this.enabled()) this._tell(webview, true); });
  },

  set(on) {
    localStorage.setItem(this.KEY, JSON.stringify({ on: !!on }));
    this._tellAll(!!on);
  },
  // The usage switch (vex-usage-registry.js); unlike the F7 toggle it does not ask first.
  setEnabled(on) { this.set(on); },

  // F7 and the command: off turns it off; on asks first, the way Chrome does.
  async toggle() {
    if (this.enabled()) {
      this.set(false);
      window.showToast?.(this._t('Caret browsing is off'), 'info');
      return false;
    }
    const ok = await vexConfirm({
      title: 'Turn on caret browsing?',
      message: 'Caret browsing lets you move around a page with the arrow keys and select text with Shift. The arrow keys will no longer scroll pages while it is on. Press F7 to turn it off again.',
      okLabel: 'Turn on',
      cancelLabel: 'Cancel',
    });
    if (!ok) return false;
    this.set(true);
    window.showToast?.(this._t('Caret browsing is on. Click in the text or press an arrow key; F7 turns it off'), 'info');
    return true;
  },

  init() {
    // This file loads after the window is up: pages already open get their listener too.
    document.querySelectorAll('webview').forEach(wv => this.attach(wv));
    if (this.enabled()) this._tellAll(true);
  },
};

if (typeof window !== 'undefined') {
  window.VexCaretBrowsing = VexCaretBrowsing;
  if (typeof document !== 'undefined' && document.querySelectorAll) VexCaretBrowsing.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCaretBrowsing };
