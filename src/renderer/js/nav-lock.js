// === The website's Back / Forward / Reload stand still under a side panel ===
//
// The toolbar's Back, Forward and Reload (and Alt+Left/Right, F5, Ctrl+R,
// Ctrl+F5, Shift+F5, Ctrl+Shift+R and Ctrl+K's Reload) act on the tab in
// front. With a side panel open over the page (Discord, WhatsApp, Spotify,
// Notes, a pinned site...) they went back, forward and reloaded the website
// hidden behind it, keys pressed inside the panel too (found 2026-10-12).
//
// They are locked while you are on a panel: it covers the page (Classic, a
// maximized panel in a browser look, Settings), or it is docked beside the
// page and the panel is what you used last (opened it, clicked or typed in
// it). Clicking the page beside a docked panel gives them back. A key pressed
// in a page is judged by that page, which main names: from a panel's page it
// is refused, from the website's own page beside a docked panel it works.
// The panel's own back/forward/reload bar is the panel's, untouched here.
//
// Every way in calls run(); the buttons show the lock (aria-disabled, greyed
// in every look) and say why in their tooltip, and otherwise show whether the
// page has anywhere to go back or forward to.

const NavLock = {
  WHY: 'not available while a side panel is open',
  ACTIONS: { back: 'goBack', forward: 'goForward', reload: 'reload', hardReload: 'hardReload', stop: 'stop' },

  // True once the panel, not the page beside it, is what you are on.
  _onPanel: false,

  // Does the open panel hide the page?
  _covers(panel) {
    if (!SidebarManager._docksBesidePage(panel)) return true;
    return document.body.hasAttribute('data-sidebar-max');
  },

  // `from`: the webContents id of the page a key was pressed in (main names
  // it), or undefined for the toolbar, Ctrl+K and keys pressed on Vex itself.
  blocked(from) {
    if (typeof SidebarManager === 'undefined') return false;
    const panel = SidebarManager.activePanel;
    if (!panel) return false;
    if (this._covers(panel)) return true;
    // A key from a page: refused from a panel's, allowed from the website's.
    const source = this._pageSide(from);
    if (source !== null) return source;
    // The toolbar, Ctrl+K and Vex's own keys: the website beside a docked
    // panel is on screen, so they act on it whichever side has the focus.
    return false;
  },

  // Which side the page with this webContents id is on: true a panel's,
  // false a tab's, null not known (no id, or a page that is neither).
  _pageSide(from) {
    if (from === undefined || from === null) return null;
    if (!Number.isInteger(from)) throw new Error('NavLock: a page is named by its webContents id, got ' + from);
    for (const wv of document.querySelectorAll('#panels-container webview, #webviews-container webview')) {
      let id;
      try { id = wv.getWebContentsId(); }
      catch (err) {
        if (/dom-ready|attached/.test(String(err && err.message))) continue;   // not loaded: not the one
        throw err;
      }
      if (id === from) return this._side(wv);
    }
    return null;
  },

  // Run fn (the registry handling a key passed up from a page) knowing which
  // page the key came from.
  fromPage(from, fn) {
    const before = this._keyFrom;
    this._keyFrom = from;
    try { return fn(); }
    finally { this._keyFrom = before; }
  },

  // true: inside the panels; false: inside the pages; null: neither.
  _side(el) {
    if (!el) return null;
    const panels = document.getElementById('panels-container');
    if (panels && panels.contains(el)) return true;
    const pages = document.getElementById('webviews-container');
    if (pages && pages.contains(el)) return false;
    return null;
  },

  // The one way the website's Back/Forward/Reload/Stop run. False when locked.
  // `from` names the page a key came from (see blocked).
  run(action, from = this._keyFrom) {
    const method = this.ACTIONS[action];
    if (!method) throw new Error('NavLock: unknown action "' + action + '"');
    if (this.blocked(from)) return false;
    WebviewManager[method]();
    return true;
  },

  // Asking a page that is not ready yet throws; that page has nowhere to go.
  _can(wv, method) {
    if (!wv || !wv._attached) return false;
    try { return !!wv[method](); }
    catch (err) {
      if (/dom-ready/.test(String(err && err.message))) return false;
      throw err;
    }
  },

  // The button's own title, whether or not the lock is showing its reason.
  realTitle(btn) {
    return btn.dataset.navLockTitle !== undefined ? btn.dataset.navLockTitle : btn.title;
  },

  // A title another module gives a button (Reload turned Stop) while locked
  // is kept as its own, and comes back when the lock goes.
  setTitle(btn, text) {
    if (btn.dataset.navLockTitle === undefined) { btn.title = text; return; }
    btn.dataset.navLockTitle = text;
    btn.title = this._lockedTitle(text);
  },

  _lockedTitle(own) {
    const name = String(own || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    return (name ? name + ' — ' : '') + this.WHY;
  },

  _paint(btn, locked, nowhere) {
    if (!btn) return;
    if (locked) {
      if (btn.dataset.navLockTitle === undefined) btn.dataset.navLockTitle = btn.title;
      btn.title = this._lockedTitle(btn.dataset.navLockTitle);
    } else if (btn.dataset.navLockTitle !== undefined) {
      btn.title = btn.dataset.navLockTitle;
      delete btn.dataset.navLockTitle;
      if (typeof VexI18nUI !== 'undefined') VexI18nUI.translateEl(btn);
    }
    if (locked || nowhere) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  },

  sync() {
    const now = this._side(document.activeElement);
    if (now !== null) this._onPanel = now;
    const locked = this.blocked();
    const wv = locked || typeof WebviewManager === 'undefined' ? null : WebviewManager.getActiveWebview();
    this._paint(document.getElementById('btn-back'), locked, !locked && !this._can(wv, 'canGoBack'));
    this._paint(document.getElementById('btn-forward'), locked, !locked && !this._can(wv, 'canGoForward'));
    this._paint(document.getElementById('btn-reload'), locked, false);
  },

  // Who you are on: the panel or the page. Anything else (the toolbar, a
  // menu, a dialog) leaves it as it was.
  _noteUse(target) {
    const onPanel = this._side(target);
    if (onPanel === null) return;
    this._onPanel = onPanel;
    this.sync();
  },

  init() {
    const use = (e) => this._noteUse(e.target);
    document.addEventListener('focusin', use, true);
    document.addEventListener('pointerdown', use, true);
    // A page taking the focus from a click often fires no focusin in this
    // window, only a focusout from what had it (and the window's blur). So
    // once the focus has moved, see where it went; a page or panel losing it
    // to the toolbar was the one in use.
    document.addEventListener('focusout', (e) => {
      const from = e.target;
      setTimeout(() => {
        if (this._side(document.activeElement) === null) this._noteUse(from);
        else this.sync();
      }, 0);
    }, true);
    const later = () => setTimeout(() => this.sync(), 0);
    window.addEventListener('blur', later);
    window.addEventListener('focus', later);
    // Opening a panel puts you on it.
    document.addEventListener('vex:panel-changed', (e) => {
      if (e.detail && e.detail.panel) this._onPanel = true;
      this.sync();
    });
    // Maximize / restore of a docked panel, a look switched.
    new MutationObserver(() => this.sync())
      .observe(document.body, { attributes: true, attributeFilter: ['data-sidebar-max', 'data-sb-side'] });
    // The page in front moved, or another tab came to the front.
    const sync = () => this.sync();
    window.addEventListener('vex:tab-activated', sync);
    window.addEventListener('vex:tab-url-changed', sync);
    document.addEventListener('vex:tab-navigated', sync);
    document.addEventListener('vex:tab-closed', sync);
    this.sync();
  },
};

if (typeof window !== 'undefined') window.NavLock = NavLock;
if (typeof module !== 'undefined' && module.exports) module.exports = { NavLock };
