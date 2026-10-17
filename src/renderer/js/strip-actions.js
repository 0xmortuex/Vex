// === Quick actions on the tab strip (T1-018) ==================================
//
// Four small things the strip lacked, each one switchable:
//
//   hover      rest the pointer on a tab and a little bar of four buttons floats
//              over its right end: mute, pin, duplicate, close the other tabs
//              (that one with its Undo toast). The bar is a layer on top of the
//              page, never a child of the strip, so it cannot move a tab, change
//              the height of the strip or reflow anything in any look.
//   dblNew     double-click the empty part of the strip: a new tab.
//   midReopen  middle-click the empty part of the strip, or the + button: reopen the last
//              closed tab. (Tabs stretch to fill the strip in every look, so the empty part is
//              only a few pixels at the end; the + button is the target you can really hit.)
//   wheel      the wheel over the strip: the previous or next tab (off by default;
//              a strip crowded enough to scroll keeps scrolling).
//   returnToOpener  closing a tab you opened from another goes back to that tab
//              instead of its neighbour (off by default).
//
// Right-clicking the + button lists the recently closed tabs, and opens the
// link on the clipboard when there is one.
//
// All of it is for the horizontal strip (the vertical sidebar has its own
// context menu with the same actions).
const VexStripActions = {
  KEY: 'vex.stripActions',
  DEFAULTS: { on: true, hover: true, dblNew: true, midReopen: true, wheel: false, returnToOpener: false },
  HOVER_MS: 350,
  HIDE_MS: 140,
  // A bar the pointer has left without the strip hearing of it (the pointer went straight into a page) goes by itself.
  LIFE_MS: 6000,
  MIN_TAB_WIDTH: 150,
  WHEEL_GAP_MS: 150,

  _anchor: null,
  _bar: null,
  _showTimer: null,
  _hideTimer: null,
  _lifeTimer: null,
  _wheelAt: 0,
  _menu: null,

  // ---- preferences -----------------------------------------------------------------
  prefs() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return { ...this.DEFAULTS };
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[StripActions] the saved choices are damaged and start again:', err); return { ...this.DEFAULTS }; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...this.DEFAULTS };
    const out = { ...this.DEFAULTS };
    for (const k of Object.keys(this.DEFAULTS)) if (typeof v[k] === 'boolean') out[k] = v[k];
    return out;
  },
  save(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in this.DEFAULTS)) throw new Error('Unknown strip action: ' + k);
      if (typeof v !== 'boolean') throw new Error('Strip action "' + k + '" is on or off');
    }
    localStorage.setItem(this.KEY, JSON.stringify({ ...this.prefs(), ...patch }));
    if (patch.on === false || patch.hover === false) this._hide();
  },
  enabled() { return this.prefs().on; },
  setEnabled(on) { this.save({ on: !!on }); },
  _want(name) { const p = this.prefs(); return p.on && p[name]; },

  // ---- return to the opener ---------------------------------------------------------
  // → the opener tab when closing `closing` should go back to it, else null.
  openerToReturnTo(closing, tabManager) {
    if (!this._want('returnToOpener') || !closing || typeof TabTrail === 'undefined') return null;
    const hop = TabTrail.from.get(closing.id);
    if (!hop) return null;
    const opener = tabManager.tabs.find(t => t.id === hop.id && t.id !== closing.id);
    return opener && tabManager.isOnScreen(opener) ? opener : null;
  },

  // ---- the floating bar --------------------------------------------------------------
  _tabOf(el) {
    const tabEl = el && el.closest ? el.closest('.top-tab[data-tab-id]') : null;
    return tabEl;
  },

  _scheduleShow(tabEl) {
    clearTimeout(this._showTimer);
    clearTimeout(this._hideTimer);
    if (this._anchor === tabEl && this._bar) return;
    this._hide();
    if (!this._want('hover')) return;
    this._showTimer = setTimeout(() => this._show(tabEl), this.HOVER_MS);
  },

  _scheduleHide() {
    clearTimeout(this._showTimer);
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this._hide(), this.HIDE_MS);
  },

  _hide() {
    clearTimeout(this._showTimer);
    clearTimeout(this._hideTimer);
    clearTimeout(this._lifeTimer);
    this._anchor = null;
    if (this._bar) this._bar.remove();
    this._bar = null;
  },

  _show(tabEl) {
    if (!tabEl.isConnected || document.body.classList.contains('dragging-tab')) return;
    const rect = tabEl.getBoundingClientRect();
    if (rect.width < this.MIN_TAB_WIDTH || tabEl.classList.contains('pinned')) return;
    const id = tabEl.dataset.tabId;
    const tab = TabManager.tabs.find(t => t.id === id);
    if (!tab) return;
    const bar = document.createElement('div');
    bar.className = 'tt-quick';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Quick actions for ' + (tab.title || 'this tab'));
    const icon = (name) => (typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size: 13 }) : '');
    const add = (name, label, run) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tt-quick-btn';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = icon(name);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        this._hide();
        try { run(); }
        catch (err) { window.showToast?.('That did not work: ' + ((err && err.message) || err), 'error'); }
      });
      bar.appendChild(b);
    };
    add(tab.muted ? 'volume' : 'mute', tab.muted ? 'Unmute tab' : 'Mute tab', () => TabManager.toggleMuteTab(id));
    add('pin', tab.pinned ? 'Unpin tab' : 'Pin tab', () => TabManager.togglePinTab(id));
    add('copy', 'Duplicate tab', () => TabManager.duplicateTab(tab));
    add('broom', 'Close the other tabs', () => TabManager.closeOtherTabs(id));
    bar.addEventListener('mouseenter', () => { clearTimeout(this._hideTimer); clearTimeout(this._showTimer); clearTimeout(this._lifeTimer); });
    bar.addEventListener('mouseleave', () => this._scheduleHide());
    document.body.appendChild(bar);
    // Over the right end of the tab, left of its close cross: inside the tab's own box, on top of it.
    const w = bar.offsetWidth || 4 * 24 + 8;
    bar.style.left = Math.max(rect.left + 4, rect.right - 26 - w) + 'px';
    bar.style.top = Math.round(rect.top + (rect.height - (bar.offsetHeight || 24)) / 2) + 'px';
    this._anchor = tabEl;
    this._bar = bar;
    this._lifeTimer = setTimeout(() => this._hide(), this.LIFE_MS);
  },

  // ---- the new-tab button's menu -----------------------------------------------------
  _closeMenu() {
    if (!this._menu) return;
    document.removeEventListener('mousedown', this._menuOut, true);
    document.removeEventListener('keydown', this._menuKey, true);
    this._menu.remove();
    this._menu = null;
  },

  async _newTabMenu(button) {
    this._closeMenu();
    const items = [];
    let clip = '';
    try { clip = ((await navigator.clipboard.readText()) || '').trim(); }
    catch (err) { console.warn('[StripActions] the clipboard could not be read for the new-tab menu:', err.message); }
    const typed = typeof VexTypedAddress !== 'undefined' ? VexTypedAddress : null;
    const clipUrl = clip && /^https?:\/\/\S+$/i.test(clip) ? clip : (typed && clip && !/\s/.test(clip) ? typed.addressFor(clip) : '');
    if (clipUrl) items.push({ label: 'Open the copied link', sub: clipUrl.slice(0, 70), run: () => TabManager.createTab(clipUrl, true) });
    const closed = typeof getRecentlyClosed === 'function' && !(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) ? getRecentlyClosed().slice(0, 8) : [];
    closed.forEach((entry, i) => items.push({
      label: entry.title || entry.url, sub: 'Reopen',
      run: () => {
        const list = getRecentlyClosed();
        const at = list.findIndex(e => e.url === entry.url && e.closedAt === entry.closedAt);
        if (at >= 0) { list.splice(at, 1); saveRecentlyClosed(list); }
        TabManager.createTab(entry.url, true, null, { allowDuplicate: true });
      },
    }));
    if (!items.length) items.push({ label: 'Nothing recently closed', sub: '', run: null });
    const menu = document.createElement('div');
    menu.className = 'tt-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'New tab');
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tt-menu-item'; b.setAttribute('role', 'menuitem');
      const t = document.createElement('span'); t.className = 'tt-title'; t.textContent = it.label; b.appendChild(t);
      if (it.sub) { const s = document.createElement('span'); s.className = 'tt-sub'; s.textContent = it.sub; b.appendChild(s); }
      if (!it.run) b.disabled = true;
      else b.addEventListener('click', () => { this._closeMenu(); try { it.run(); } catch (err) { window.showToast?.('That did not work: ' + ((err && err.message) || err), 'error'); } });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    if (typeof VexLayer !== 'undefined') VexLayer.popover(menu, 'strip-actions-menu');
    const r = button.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 340)) + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    this._menu = menu;
    this._menuOut = (e) => { if (!menu.contains(e.target)) this._closeMenu(); };
    this._menuKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this._closeMenu(); button.focus(); } };
    document.addEventListener('mousedown', this._menuOut, true);
    document.addEventListener('keydown', this._menuKey, true);
    const first = menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  },

  // ---- wiring ------------------------------------------------------------------------
  init() {
    const list = document.getElementById('top-tabs-list');
    if (!list) throw new Error('The tab strip (#top-tabs-list) is not in the page');
    list.addEventListener('mouseover', (e) => {
      const tabEl = this._tabOf(e.target);
      if (tabEl) this._scheduleShow(tabEl);
      else if (this._bar) this._scheduleHide();
    });
    list.addEventListener('mouseleave', () => this._scheduleHide());
    list.addEventListener('dragstart', () => this._hide());
    window.addEventListener('blur', () => this._hide());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._hide(); }, true);
    list.addEventListener('mousedown', () => this._hide());
    window.addEventListener('vex-tabs-changed', () => { if (this._anchor && !this._anchor.isConnected) this._hide(); });
    list.addEventListener('dblclick', (e) => {
      if (e.target !== list || !this._want('dblNew')) return;
      TabManager.createTab(typeof START_URL !== 'undefined' ? START_URL : 'vex://start', true);
    });
    list.addEventListener('auxclick', (e) => {
      if (e.target !== list || e.button !== 1 || !this._want('midReopen')) return;
      e.preventDefault();
      TabManager.reopenLastClosed();
    });
    list.addEventListener('wheel', (e) => {
      if (!this._want('wheel') || !e.deltaY || list.scrollWidth > list.clientWidth) return;
      e.preventDefault();
      const now = Date.now();
      if (now - this._wheelAt < this.WHEEL_GAP_MS) return;
      this._wheelAt = now;
      TabManager.cycleTab(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    const plus = document.getElementById('btn-new-tab-top');
    if (plus) {
      // Tabs stretch to fill the strip, so the + button is the one dependable place to aim a middle-click at.
      plus.addEventListener('auxclick', (e) => {
        if (e.button !== 1 || !this._want('midReopen')) return;
        e.preventDefault();
        TabManager.reopenLastClosed();
      });
      plus.addEventListener('contextmenu', (e) => {
        if (!this.enabled()) return;
        e.preventDefault();
        this._newTabMenu(plus).catch(err => {
          if (typeof VexProblems !== 'undefined') VexProblems.note('Tabs', 'The new-tab menu could not be shown', err);
          else console.error('[StripActions]', err);
        });
      });
    }
  },
};

if (typeof window !== 'undefined') window.VexStripActions = VexStripActions;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStripActions };
