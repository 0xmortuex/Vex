// === The pages behind Back and Forward (T1-015) ===============================
//
// Right-click (or press and hold) Back or Forward and the tab's history opens
// as a list: the pages you can go back to, nearest first, or the ones ahead.
// Click one to jump straight there, as in every other browser.
//
// The list comes from the page's own navigation history in the main process
// (tabs:nav-list: the entries around the current one, each with its position),
// and the jump is the webview's goToIndex. It follows the same lock as the
// buttons themselves (js/nav-lock.js): with a side panel covering the page,
// the buttons act on nothing and neither does this.
const VexNavHistoryMenu = {
  KEY: 'vex.navHistoryMenu',       // '0' = off
  HOLD_MS: 450,
  MAX_ITEMS: 25,
  _menu: null,
  _heldAt: 0,

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    if (!on) this.close();
  },

  // ---- the list (pure) -------------------------------------------------------------
  // `data`: { index, entries: [{ at, url, title }] } from tabs:nav-list.
  // → the entries on one side of the current page, nearest first, at most `max`.
  side(data, dir, max = this.MAX_ITEMS) {
    if (!data || !Array.isArray(data.entries) || !Number.isInteger(data.index)) throw new Error('Not a navigation list');
    const mine = data.entries.filter(e => (dir < 0 ? e.at < data.index : e.at > data.index));
    mine.sort((a, b) => (dir < 0 ? b.at - a.at : a.at - b.at));
    return mine.slice(0, max);
  },

  label(entry) {
    const url = String(entry.url || '');
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = ''; }
    if (/^data:/i.test(url)) return { title: entry.title || 'Vex page', sub: '' };
    return { title: entry.title || host || url, sub: host };
  },

  // ---- the menu -------------------------------------------------------------------
  async open(button, dir) {
    if (!this.enabled()) return false;
    this.close();
    if (typeof NavLock !== 'undefined' && NavLock.blocked()) return false;
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    const word = dir < 0 ? 'back' : 'forward';
    if (!wv || !wv._attached) { window.showToast?.('There is no page open to go ' + word + ' from', 'info', 2500); return false; }
    if (!window.vex || typeof window.vex.tabNavList !== 'function') throw new Error('The Back/Forward list needs the window bridge (tabNavList)');
    const data = await window.vex.tabNavList(wv.getWebContentsId());
    if (!data) { window.showToast?.('This page has no history to show', 'info', 2500); return false; }
    const items = this.side(data, dir);

    const menu = document.createElement('div');
    menu.className = 'tt-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', dir < 0 ? 'Pages before this one' : 'Pages after this one');
    if (!items.length) {
      const none = document.createElement('div');
      none.className = 'tt-menu-empty';
      none.textContent = dir < 0 ? 'No earlier pages' : 'No later pages';
      menu.appendChild(none);
    }
    items.forEach((entry) => {
      const { title, sub } = this.label(entry);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tt-menu-item';
      b.setAttribute('role', 'menuitem');
      const t = document.createElement('span'); t.className = 'tt-title'; t.textContent = title;
      b.appendChild(t);
      if (sub) { const s = document.createElement('span'); s.className = 'tt-sub'; s.textContent = sub; b.appendChild(s); }
      b.addEventListener('click', () => { this.close(); this.jump(wv, entry.at); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = button.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 340)) + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    this._menu = menu;
    this._from = button;
    const first = menu.querySelector('button');
    if (first) first.focus();
    this._arm = (e) => {
      if (e.type === 'keydown') {
        const buttons = Array.from(menu.querySelectorAll('button'));
        const at = buttons.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); const from = this._from; this.close(); if (from) from.focus(); }
        else if (e.key === 'ArrowDown' && buttons.length) { e.preventDefault(); buttons[(at + 1) % buttons.length].focus(); }
        else if (e.key === 'ArrowUp' && buttons.length) { e.preventDefault(); buttons[(at <= 0 ? buttons.length : at) - 1].focus(); }
        else if (e.key === 'Tab') this.close();
      } else if (!menu.contains(e.target)) this.close();
    };
    document.addEventListener('keydown', this._arm, true);
    document.addEventListener('mousedown', this._arm, true);
    return true;
  },

  close() {
    if (!this._menu) return;
    document.removeEventListener('keydown', this._arm, true);
    document.removeEventListener('mousedown', this._arm, true);
    this._menu.remove();
    this._menu = null;
  },

  jump(wv, at) {
    if (!Number.isInteger(at) || at < 0) throw new Error('Not a place in the history: ' + at);
    wv.goToIndex(at);
  },

  // ---- wiring ---------------------------------------------------------------------
  wire(button, dir) {
    if (!button) return;
    button.addEventListener('contextmenu', (e) => {
      if (!this.enabled()) return;
      e.preventDefault();
      this.open(button, dir).catch(err => this._failed(err));
    });
    let timer = null;
    const stop = () => { clearTimeout(timer); timer = null; };
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.enabled()) return;
      stop();
      timer = setTimeout(() => {
        timer = null;
        this._heldAt = Date.now();
        this.open(button, dir).catch(err => this._failed(err));
      }, this.HOLD_MS);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
    // The click that ends a long press must not also go back.
    button.addEventListener('click', (e) => {
      if (Date.now() - this._heldAt < 700) { e.stopImmediatePropagation(); e.preventDefault(); this._heldAt = 0; }
    }, true);
  },

  _failed(err) {
    if (typeof VexProblems !== 'undefined') VexProblems.note('Tabs', 'The Back/Forward list could not be shown', err);
    else console.error('[NavHistoryMenu]', err);
    window.showToast?.('Could not show the page history: ' + ((err && err.message) || err), 'error');
  },

  init() {
    this.wire(document.getElementById('btn-back'), -1);
    this.wire(document.getElementById('btn-forward'), 1);
  },
};

if (typeof window !== 'undefined') window.VexNavHistoryMenu = VexNavHistoryMenu;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexNavHistoryMenu };
