// === Pick several tabs and act on them together (T3-071) =======================
//
// Ctrl-click a tab to add it to (or take it out of) the picked tabs; Shift-click
// picks the run of tabs from the last one you picked to this one. A plain click
// goes to the tab as always and puts the picks down. While two or more tabs are
// picked, a small bar floats under the tab strip with what can be done to all of
// them: put them in a group, mute, pin, bookmark, show them side by side, close
// them (with Undo) or let go.
//
// The picks live here, not on the tabs, so nothing about a tab changes: not what
// is saved, synced or restored. The bar is a layer on top of the window (like
// js/strip-actions.js's), never a child of the strip, so it cannot move a tab or
// change the height of a bar in any look. A picked tab is drawn with a class
// (.multi-selected) that only adds an outline and a tint.
//
// Both strips use it: horizontal-tabs.js and the side list in tabs.js call
// handleClick() and mark() as they build a tab.
const VexTabSelect = {
  KEY: 'vex.tabSelect',
  DEFAULTS: { on: true },
  MAX_SPLIT: 4,

  _sel: new Set(),
  _anchor: null,
  _bar: null,

  // ---- preferences -----------------------------------------------------------------
  enabled() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return this.DEFAULTS.on;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[TabSelect] the saved choice is damaged and starts again:', err); return this.DEFAULTS.on; }
    return !!(v && typeof v === 'object' && typeof v.on === 'boolean' ? v.on : this.DEFAULTS.on);
  },
  setEnabled(on) {
    localStorage.setItem(this.KEY, JSON.stringify({ on: !!on }));
    if (!on) this.clear();
  },

  // ---- the picks ---------------------------------------------------------------------
  isSelected(id) { return this._sel.has(id); },
  // The picked tabs that still exist, in the order the strip shows them.
  tabs() {
    if (typeof TabManager === 'undefined') return [];
    const order = typeof TabManager.shownOrder === 'function' ? TabManager.shownOrder() : (TabManager.tabs || []);
    return order.filter(t => this._sel.has(t.id));
  },
  count() { return this._sel.size; },

  // Called as a tab's element is built, by either strip.
  mark(el, tab) {
    if (this._sel.has(tab.id)) { el.classList.add('multi-selected'); el.setAttribute('aria-selected', 'true'); }
  },

  // → true when the click was a pick (the caller then does not switch tab).
  handleClick(e, tab) {
    if (!this.enabled() || !tab) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      // The tab in front counts as picked when you start a pick from it, as in Chrome.
      if (!this._sel.size && typeof TabManager !== 'undefined' && TabManager.activeTabId && TabManager.activeTabId !== tab.id) this._sel.add(TabManager.activeTabId);
      if (this._sel.has(tab.id)) this._sel.delete(tab.id); else this._sel.add(tab.id);
      this._anchor = tab.id;
      this._changed();
      return true;
    }
    if (e.shiftKey && !mod && !e.altKey) {
      const order = typeof TabManager.shownOrder === 'function' ? TabManager.shownOrder() : TabManager.tabs;
      const from = order.findIndex(t => t.id === (this._anchor || TabManager.activeTabId));
      const to = order.findIndex(t => t.id === tab.id);
      if (from < 0 || to < 0) { this._sel.add(tab.id); this._anchor = tab.id; this._changed(); return true; }
      const [lo, hi] = from < to ? [from, to] : [to, from];
      for (let i = lo; i <= hi; i++) this._sel.add(order[i].id);
      this._changed();
      return true;
    }
    // A plain click ends the picking and goes on to the tab.
    if (this._sel.size) this.clear();
    return false;
  },

  clear() {
    if (!this._sel.size && !this._bar) return;
    this._sel.clear();
    this._anchor = null;
    this._changed();
  },

  // Forget picks whose tab has gone; repaint the marks and the bar.
  refresh() {
    if (typeof TabManager === 'undefined') return;
    const live = new Set((TabManager.tabs || []).map(t => t.id));
    for (const id of [...this._sel]) if (!live.has(id)) this._sel.delete(id);
    this._changed();
  },

  _changed() {
    this._paint();
    // One tab picked is just a tab with an outline: the bar is for two or more.
    if (this._sel.size >= 2) this._showBar(); else this._hideBar();
  },

  _paint() {
    for (const el of document.querySelectorAll('[data-tab-id]')) {
      const on = this._sel.has(el.dataset.tabId);
      el.classList.toggle('multi-selected', on);
      if (on) el.setAttribute('aria-selected', 'true'); else el.removeAttribute('aria-selected');
    }
  },

  // ---- the bar -----------------------------------------------------------------------
  _hideBar() { if (this._bar) { this._bar.remove(); this._bar = null; } },

  _showBar() {
    const tabs = this.tabs();
    this._hideBar();
    if (tabs.length < 2) return;
    const bar = document.createElement('div');
    bar.className = 'ts-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', tabs.length + ' tabs picked');
    const label = document.createElement('span');
    label.className = 'ts-count';
    label.textContent = tabs.length + ' tabs';
    bar.appendChild(label);
    const icon = (name) => (typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size: 13 }) : '');
    const add = (name, text, run, extra) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-btn' + (extra ? ' ' + extra : '');
      b.title = text;
      b.setAttribute('aria-label', text);
      b.innerHTML = icon(name) + '<span>' + text + '</span>';
      // The bar must not take the focus or the click from the page or the strip.
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        Promise.resolve().then(run).catch(err => {
          if (typeof VexProblems !== 'undefined') VexProblems.note('Tabs', 'A bulk tab action did not work', err);
          window.showToast?.('That did not work: ' + ((err && err.message) || err), 'error');
        });
      });
      bar.appendChild(b);
    };
    const anyUnmuted = tabs.some(t => !t.muted);
    const anyUnpinned = tabs.some(t => !t.pinned);
    add('folder', 'Group', () => this.group());
    add(anyUnmuted ? 'mute' : 'volume', anyUnmuted ? 'Mute' : 'Unmute', () => this.mute());
    add('pin', anyUnpinned ? 'Pin' : 'Unpin', () => this.pin());
    add('star', 'Bookmark', () => this.bookmark());
    if (tabs.length <= this.MAX_SPLIT && typeof SplitScreen !== 'undefined') add('split', 'Side by side', () => this.split());
    add('trash', 'Close', () => this.close(), 'danger');
    add('x', 'Let go', () => this.clear());
    document.body.appendChild(bar);
    this._place(bar);
    this._bar = bar;
  },

  // Under the tab strip, in the middle of the window; out of the way of the page's top edge.
  _place(bar) {
    const strip = document.getElementById('top-tab-bar');
    const r = strip && strip.getClientRects().length ? strip.getBoundingClientRect() : null;
    bar.style.top = Math.round((r ? r.bottom : 44) + 6) + 'px';
  },

  // ---- the actions ---------------------------------------------------------------------
  group() {
    const tabs = this.tabs();
    if (tabs.length < 2) return Promise.resolve();
    return TabManager._newGroupFromTabs(tabs).then(() => this.clear());
  },
  mute() {
    const tabs = this.tabs();
    const mute = tabs.some(t => !t.muted);
    for (const t of tabs) if (!!t.muted !== mute) TabManager.toggleMuteTab(t.id);
    window.showToast?.(mute ? tabs.length + ' tabs muted' : tabs.length + ' tabs unmuted');
    this._changed();
  },
  pin() {
    const tabs = this.tabs();
    const pin = tabs.some(t => !t.pinned);
    for (const t of tabs) if (!!t.pinned !== pin) TabManager.togglePinTab(t.id);
    window.showToast?.(pin ? tabs.length + ' tabs pinned' : tabs.length + ' tabs unpinned');
    this._changed();
  },
  async bookmark() {
    const tabs = this.tabs();
    // Not a Tor, private or other session-only tab: its address would be written into a list that outlives it.
    const keep = tabs.filter(t => /^https?:/i.test(t.url || '') && t.url.length <= 8192 && !(t.partition && !String(t.partition).startsWith('persist:')) && !Bookmarks.has(t.url));
    const skipped = tabs.length - keep.length;
    if (!keep.length) { window.showToast?.('Nothing new to bookmark in these tabs', 'info'); return; }
    const folder = await vexPrompt({ title: 'Bookmark ' + keep.length + ' tab' + VexPlural.s(keep.length), label: 'Folder (blank = Unsorted)', okLabel: 'Bookmark' });
    if (folder === null || folder === undefined) return;
    for (const t of keep.slice().reverse()) {
      const own = typeof TabManager.windowMayAsk === 'function' && !TabManager.windowMayAsk(t.partition);
      Bookmarks.items.unshift({ id: vexId('bm'), url: t.url, title: String(t.title || t.url).slice(0, 4096), folder: String(folder).trim(), at: Date.now(), ...(own ? { ownSession: true } : {}) });
    }
    Bookmarks.save();
    window.showToast?.('Bookmarked ' + keep.length + (skipped ? ' (' + skipped + ' skipped: private, already saved or not a web page)' : ''), 'success');
  },
  split() {
    const tabs = this.tabs();
    if (tabs.length < 2 || tabs.length > this.MAX_SPLIT) throw new Error('Side by side takes two to four tabs');
    if (!SplitScreen.restore(tabs.map(t => t.id))) throw new Error('Those tabs could not be put side by side');
    TabManager.switchTab(tabs[0].id);
    this.clear();
  },
  close() {
    const tabs = this.tabs();
    if (!tabs.length) return;
    const ids = tabs.map(t => t.id);
    this.clear();
    TabManager.closeTabsWithUndo(ids, 'Closed ' + ids.length + ' tabs');
  },

  // ---- wiring ------------------------------------------------------------------------
  init() {
    window.addEventListener('vex-tabs-changed', () => { if (this._sel.size) this.refresh(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._sel.size) this.clear(); }, true);
    window.addEventListener('resize', () => { if (this._bar) this._place(this._bar); });
  },
};

if (typeof window !== 'undefined') window.VexTabSelect = VexTabSelect;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabSelect };
